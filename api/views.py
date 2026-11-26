"""
NCV backend views (optimised).

Same URL-facing view functions and the same JSON response shapes as before; the work
behind them is cheaper:

* Big JSON payloads (network.json, activity chunks, hip_form layers, human circuit) are no
  longer parsed and re-serialised on every request.  Small facts about them (counts, keys,
  ids) are cached in sidecar files and the raw bytes are streamed straight to the client
  with an exact Content-Length.
* Activity CSV -> chunk conversion is vectorised with NumPy (no per-spike Python work, no
  ujson.dumps per entry to estimate sizes) and its result is cached, so re-opening a circuit
  does not re-chunk hundreds of MB again.
* Spike histograms are computed from (unique time, spike count) pairs instead of one value
  per spike, drawn with the thread-safe object-oriented Matplotlib API, and cached on disk.
* CSV / HDF5 / SONATA -> network.json conversion is vectorised (pandas/NumPy), not row loops.
* CA3->CA1 connectivity uses plain NumPy state instead of per-neuron pandas lookups.
* Chunk upload: no fsync per chunk, large writes, temp-file move when Django already spooled
  the chunk to disk, assembly guarded by a lock so parallel last chunks cannot race.
* Upload directory names are validated (no path traversal).
"""

import base64
import csv
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from collections import defaultdict
from contextlib import contextmanager
from functools import lru_cache
from itertools import chain, islice

import h5py
import numpy as np
import pandas as pd
import ujson
from django.conf import settings
from django.http import FileResponse, HttpResponse, StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt

MB = 1024 * 1024
STREAM_BLOCK = 4 * MB
EXC_RATIO = 90.909533 / 100.0        # default excitatory share when cell_type is missing
LAST_EXC_GID = 261844                 # CA1 network: gids 1..261844 excitatory, 261845..288027 inhibitory
MAX_STD_LABELS = 400                 # per-bar std labels are unreadable above this many bins
HIST_CACHE_VERSION = 1


# =============================================================================
# Small helpers
# =============================================================================

def _dumps(obj):
    return ujson.dumps(obj, escape_forward_slashes=False)


def json_response(obj, status=200):
    """Much faster than JsonResponse (no stdlib json encoder)."""
    return HttpResponse(_dumps(obj), content_type="application/json", status=status)


def _err(message, status=500):
    return json_response({"error": message}, status)


class _FileRange:
    """A byte range of a file, spliced verbatim into a streamed JSON response."""

    __slots__ = ("path", "start", "length")

    def __init__(self, path, start=0, length=None):
        self.path = path
        self.start = start
        self.length = os.path.getsize(path) - start if length is None else length


def _stream_json(parts, status=200):
    """
    Build one JSON document from bytes/str pieces and _FileRange pieces without loading the
    files into memory or parsing them.  Content-Length is exact so the browser can show progress.
    """
    parts = [p.encode() if isinstance(p, str) else p for p in parts]
    if all(isinstance(p, bytes) for p in parts):
        return HttpResponse(b"".join(parts), content_type="application/json", status=status)

    length = sum(len(p) if isinstance(p, bytes) else p.length for p in parts)

    def generate():
        for p in parts:
            if isinstance(p, bytes):
                yield p
                continue
            remaining = p.length
            with open(p.path, "rb") as f:
                f.seek(p.start)
                while remaining > 0:
                    block = f.read(min(STREAM_BLOCK, remaining))
                    if not block:
                        break
                    remaining -= len(block)
                    yield block

    response = StreamingHttpResponse(generate(), content_type="application/json", status=status)
    response["Content-Length"] = str(length)
    # GZipMiddleware replaces Content-Length with the compressed size; the browser needs the decoded
    # size for an exact percentage.
    response["X-Uncompressed-Length"] = str(length)
    if getattr(settings, "NCV_SKIP_GZIP", False):
        # big JSON that is already dense: skip on-the-fly gzip (faster first byte, exact Content-Length)
        response["Content-Encoding"] = "identity"
    return response


def _object_tail(fields):
    """'{"a":1,"b":2}' -> '"a":1,"b":2}' so it can be appended after raw JSON and a comma."""
    return _dumps(fields)[1:]


def _user_dir(name):
    """MEDIA_ROOT/csv/<name>, or None when the name could escape that folder."""
    if not name or name in (".", "..") or any(c in name for c in ("/", "\\", "\x00")):
        return None
    return os.path.join(settings.MEDIA_ROOT, "csv", name)


def _fresh(target, *sources):
    """target exists and is at least as new as every existing source."""
    try:
        t = os.stat(target).st_mtime_ns
    except OSError:
        return False
    for s in sources:
        try:
            if os.stat(s).st_mtime_ns > t:
                return False
        except OSError:
            pass
    return True


def _signature(*paths):
    sig = []
    for p in paths:
        try:
            st = os.stat(p)
            sig.append([os.path.basename(p), st.st_mtime_ns, st.st_size])
        except OSError:
            sig.append([os.path.basename(p), None, None])
    return sig


def _read_json_file(path):
    with open(path, "rb") as f:
        return ujson.loads(f.read())


def _write_json_file(path, obj):
    try:
        with open(path, "w") as f:
            f.write(_dumps(obj))
    except OSError:
        pass  # caches are best-effort


def count_csv_lines(file_path):
    """Number of lines in a file (same as sum(1 for _ in open(...)))."""
    n = 0
    last = b"\n"
    with open(file_path, "rb") as f:
        while True:
            block = f.read(8 * MB)
            if not block:
                break
            n += block.count(b"\n")
            last = block[-1:]
    if last != b"\n":
        n += 1
    return n


# ---- gid -> index lookups (replaces {gid: index} dicts over millions of neurons) --------

def _make_lookup(gids):
    try:
        arr = np.asarray(gids, dtype=np.int64)
    except (TypeError, ValueError):
        arr = np.asarray([int(float(g)) for g in gids], dtype=np.int64)
    order = np.argsort(arr, kind="stable")
    return arr[order], order


def _lookup_indexes(lookup, active_ids):
    """{gid: index of its LAST occurrence in the gid list} for every active id that exists."""
    sorted_ids, order = lookup
    active_ids = np.asarray(active_ids).astype(np.int64, copy=False)
    if sorted_ids.size == 0 or active_ids.size == 0:
        return {}
    pos = np.searchsorted(sorted_ids, active_ids, side="right") - 1
    valid = pos >= 0
    pos_safe = np.where(valid, pos, 0)
    valid &= sorted_ids[pos_safe] == active_ids
    return dict(zip(active_ids[valid].tolist(), order[pos_safe[valid]].tolist()))


def get_activity_indexes(data_dict, Gids):
    """Maps every GID found in the spike data to its index in the Gids list."""
    try:
        flat = np.fromiter(chain.from_iterable(data_dict.values()), dtype=np.int64)
    except (TypeError, ValueError):
        flat = []
        for ids in data_dict.values():
            for a in ids:
                try:
                    flat.append(int(a))
                except (TypeError, ValueError) as e:
                    print(f"Skipping invalid activity_id '{a}': {e}")
        flat = np.asarray(flat, dtype=np.int64)
    return _lookup_indexes(_make_lookup(Gids), np.unique(flat))


# =============================================================================
# Chunked upload (CSV / HDF5)
# =============================================================================

PART_RE = re.compile(r"\.part(\d+)$")


@contextmanager
def _assembly_lock(path, stale=900):
    """O_EXCL lock file; yields True when this request owns the assembly."""
    held = False
    for _ in range(2):
        try:
            os.close(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
            held = True
            break
        except FileExistsError:
            try:
                if time.time() - os.path.getmtime(path) > stale:
                    os.remove(path)  # crashed owner
                    continue
            except OSError:
                pass
            break
    try:
        yield held
    finally:
        if held:
            try:
                os.remove(path)
            except OSError:
                pass


def _wait_unlocked(path, timeout=600):
    end = time.time() + timeout
    while os.path.exists(path) and time.time() < end:
        time.sleep(0.05)


def _save_upload(uploaded, dest):
    """Write an uploaded chunk atomically.  Moves Django's spooled temp file when there is one."""
    tmp = dest + ".tmp"
    if hasattr(uploaded, "temporary_file_path"):
        shutil.move(uploaded.temporary_file_path(), tmp)
    else:
        with open(tmp, "wb") as f:
            for piece in uploaded.chunks(STREAM_BLOCK):
                f.write(piece)
    os.replace(tmp, dest)


def _concat_files(paths, dest):
    with open(dest, "wb") as out:
        for p in paths:
            with open(p, "rb") as src:
                shutil.copyfileobj(src, out, 8 * MB)


def _existing_indices(base_dir, fname):
    """{indices of fname.part<N> files present}"""
    have = set()
    prefix = fname + ".part"
    with os.scandir(base_dir) as it:
        for entry in it:
            if entry.name.startswith(prefix):
                m = PART_RE.search(entry.name)
                if m and entry.name == f"{fname}.part{m.group(1)}":
                    have.add(int(m.group(1)))
    return have


def _missing_parts(base_dir, fname, total):
    """Returns (use_zero_based, missing_indices) for the better-matching numbering scheme."""
    have = _existing_indices(base_dir, fname)
    miss_zero = sorted(set(range(total)) - have)
    miss_one = sorted(set(range(1, total + 1)) - have)
    if len(miss_zero) <= len(miss_one):
        return True, miss_zero
    return False, miss_one


def _assemble_if_complete(base_dir, fname, total, filetype, batch=None):
    """Assemble when either the 0-based or the 1-based part set is complete."""
    use_zero, missing = _missing_parts(base_dir, fname, total)
    if missing:
        return False, {"status": "part-received",
                       "missing": [os.path.join(base_dir, f"{fname}.part{i}") for i in missing[:50]]}

    final_path = os.path.join(base_dir, fname)
    lock_path = final_path + ".lock"

    with _assembly_lock(lock_path) as owner:
        if not owner:
            # another request is assembling the same file: wait so the caller sees a finished file
            _wait_unlocked(lock_path)
            if os.path.exists(final_path) or os.path.exists(os.path.join(base_dir, "network.json")) \
                    or os.path.exists(os.path.join(base_dir, "activity.csv")):
                return True, {"status": "success", "path": final_path}
            return False, {"status": "part-received", "missing": []}

        use_zero, missing = _missing_parts(base_dir, fname, total)   # re-check under the lock
        if missing:
            return True, {"status": "success", "path": final_path}   # finished by the previous owner

        indices = range(total) if use_zero else range(1, total + 1)
        parts = [os.path.join(base_dir, f"{fname}.part{i}") for i in indices]
        assembling = final_path + ".assembling"
        _concat_files(parts, assembling)
        os.replace(assembling, final_path)
        for p in parts:
            try:
                os.remove(p)
            except FileNotFoundError:
                pass

        if filetype == "csv":
            kind = detect_file_type(final_path)
            if kind == "network":
                process_network_csv(final_path, batch)
            elif kind == "activity":
                _store_activity_slice(final_path, base_dir, batch)
        elif filetype in ("hdf5", "h5"):
            process_hdf5_file(final_path)

    return True, {"status": "success", "path": final_path}


@csrf_exempt
def upload_and_save_Network_file(request):
    try:
        if request.method != "POST" or "file" not in request.FILES:
            return _err("POST with file required", 400)

        uploaded_file = request.FILES["file"]
        chunk_index = request.POST.get("chunkIndex")
        total_chunks = request.POST.get("totalChunks")
        unique_dir = request.POST.get("uniqueDirectory")
        ext = (request.POST.get("fileType") or "").lower()

        if not all([chunk_index, total_chunks, unique_dir, ext]):
            return _err("Missing parameters", 400)
        try:
            chunk_index = int(chunk_index)
            total_chunks = int(total_chunks)
            if total_chunks <= 0:
                raise ValueError
        except ValueError:
            return _err("Invalid chunkIndex/totalChunks", 400)

        base_dir = _user_dir(unique_dir)
        if base_dir is None:
            return _err("Invalid uniqueDirectory", 400)
        os.makedirs(base_dir, exist_ok=True)

        _save_upload(uploaded_file, os.path.join(base_dir, f"{uploaded_file.name}.part{chunk_index}"))

        batch = (request.POST.get("batchId") or "").strip() or None   # files chosen together form one batch
        assembled, payload = _assemble_if_complete(base_dir, uploaded_file.name, total_chunks, ext, batch)
        status_code = 200 if assembled or payload.get("status") == "part-received" else 409
        return json_response(payload, status_code)

    except Exception as e:
        return _err(str(e))


def detect_file_type(file_path):
    """Activity file (2 columns) or network file (4/5 columns)."""
    with open(file_path, "r", newline="") as f:
        for row in csv.reader(f):
            if len(row) == 2:
                return "activity"
            if len(row) in (4, 5):
                return "network"
    return "unknown"


# =============================================================================
# network.json writing + sidecars (ids, counts)
# =============================================================================

def _count_types(n, cell_type):
    """(excitatory, inhibitory, last cell_type) — default 90.9 % excitatory without cell_type."""
    if cell_type is None:
        exc = min(int(round(n * EXC_RATIO)), n)
        return exc, n - exc, None
    exc = int((cell_type == 0).sum())
    inh = int((cell_type == 1).sum())
    return exc, inh, (int(cell_type[-1]) if n else None)


def _write_network_sidecars(out_dir, ids, cell_type):
    n = int(len(ids))
    exc, inh, last = _count_types(n, cell_type)
    meta = {"total_neurons": n, "total_excitatory": exc, "total_inhibitory": inh, "cell_type": last}
    try:
        np.save(os.path.join(out_dir, "network_ids.npy"), np.asarray(ids, dtype=np.int64))
    except OSError:
        pass
    _write_json_file(os.path.join(out_dir, "network_meta.json"), meta)
    return meta


def _write_network(out_dir, ids, x, y, z, cell_type=None):
    """Vectorised network.json writer: [{"id","x","y","z"[,"cell_type"]}, ...]."""
    ids = np.asarray(ids).astype(np.int64, copy=False)
    columns = {"id": ids,
               "x": np.asarray(x, dtype=np.float64),
               "y": np.asarray(y, dtype=np.float64),
               "z": np.asarray(z, dtype=np.float64)}
    if cell_type is not None:
        cell_type = np.asarray(cell_type).astype(np.int64, copy=False)
        columns["cell_type"] = cell_type
    path = os.path.join(out_dir, "network.json")
    pd.DataFrame(columns).to_json(path, orient="records", double_precision=15)
    _write_network_sidecars(out_dir, ids, cell_type)
    return path


def _ensure_network_meta(out_dir):
    """Counts for network.json; parses the file only when no fresh sidecar exists."""
    net = os.path.join(out_dir, "network.json")
    meta_p = os.path.join(out_dir, "network_meta.json")
    ids_p = os.path.join(out_dir, "network_ids.npy")
    if _fresh(meta_p, net) and _fresh(ids_p, net):
        return _read_json_file(meta_p)

    data = _read_json_file(net)
    n = len(data)
    ids = np.fromiter((int(d["id"]) for d in data), dtype=np.int64, count=n)
    cts = [d.get("cell_type") for d in data]

    target = int(round(n * EXC_RATIO))
    exc = inh = 0
    for i, c in enumerate(cts):
        if c is None:
            if exc < target:
                exc += 1
            else:
                inh += 1
        elif c == 0:
            exc += 1
        elif c == 1:
            inh += 1
        else:
            print(f"Warning: neuron {i} unknown cell_type={c}")

    meta = {"total_neurons": n, "total_excitatory": exc, "total_inhibitory": inh,
            "cell_type": cts[-1] if cts else None}
    try:
        np.save(ids_p, ids)
    except OSError:
        pass
    _write_json_file(meta_p, meta)
    return meta


@lru_cache(maxsize=4)
def _cached_lookup(ids_path, mtime_ns):
    ids = np.load(ids_path)
    return int(ids.size), _make_lookup(ids)


def _network_lookup(out_dir):
    """(total neurons, gid lookup) for out_dir/network.json; (0, empty) when it is missing."""
    net = os.path.join(out_dir, "network.json")
    if not os.path.exists(net):
        print(f"File not found: {net}")
        return 0, _make_lookup([])
    _ensure_network_meta(out_dir)
    ids_p = os.path.join(out_dir, "network_ids.npy")
    return _cached_lookup(ids_p, os.stat(ids_p).st_mtime_ns)


_NET_COLS = ["id", "x", "y", "z", "cell_type"]


# ---- slices: several CSV files uploaded together are merged, a new upload replaces the old one ----

@contextmanager
def _dir_lock(out_dir, timeout=600, stale=900):
    """Blocking per-directory lock: parallel uploads of several slices merge one at a time."""
    path = os.path.join(out_dir, ".merge.lock")
    end = time.time() + timeout
    while True:
        try:
            os.close(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
            break
        except FileExistsError:
            try:
                if time.time() - os.path.getmtime(path) > stale:
                    os.remove(path)
                    continue
            except OSError:
                pass
            if time.time() > end:
                raise TimeoutError("could not lock the upload directory")
            time.sleep(0.05)
    try:
        yield
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def _natural_key(name):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def _begin_slice_batch(out_dir, kind, batch):
    """
    Folder holding the slices of the current upload batch.  A different batch id (or none)
    means a new upload: the slices of the previous one are dropped.
    """
    state_p = os.path.join(out_dir, "batch.json")
    try:
        state = _read_json_file(state_p)
    except (OSError, ValueError):
        state = {}
    folder = os.path.join(out_dir, f"slices_{kind}")
    batch = batch or f"single-{time.time_ns()}"
    if state.get(kind) != batch:
        shutil.rmtree(folder, ignore_errors=True)
        state[kind] = batch
        _write_json_file(state_p, state)
    os.makedirs(folder, exist_ok=True)
    return folder


def _parse_network_csv(file_path):
    """CSV (id,x,y,z[,cell_type], optional header) -> (ids, x, y, z, cell_type|None)."""
    skip = 0
    with open(file_path, "r", newline="") as f:
        first = next(csv.reader(f), None)
    if first:
        try:
            int(first[0]); float(first[1]); float(first[2]); float(first[3])
        except (ValueError, IndexError):
            print("Header detected → skipping first row")
            skip = 1

    # needs pandas >= 1.3 for on_bad_lines
    df = pd.read_csv(file_path, header=None, names=_NET_COLS, skiprows=skip, on_bad_lines="skip")
    for c in _NET_COLS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    before = len(df)
    df = df.dropna(subset=["id", "x", "y", "z"])
    if len(df) < before:
        print(f"Skipped {before - len(df)} malformed rows")

    cell_type = None
    has_ct = df["cell_type"].notna()
    if len(df) and has_ct.all():
        cell_type = df["cell_type"].to_numpy()
    elif has_ct.any():
        print("cell_type present on some rows only → ignoring the cell_type column")
    return df["id"].to_numpy(), df["x"].to_numpy(), df["y"].to_numpy(), df["z"].to_numpy(), cell_type


def _rebuild_network_from_slices(out_dir, folder):
    names = sorted((n for n in os.listdir(folder) if n.endswith(".npz")), key=_natural_key)
    parts = []
    for n in names:
        with np.load(os.path.join(folder, n)) as z:
            parts.append((z["ids"], z["x"], z["y"], z["z"], z["ct"] if bool(z["has_ct"]) else None))
    if not parts:
        return
    ids = np.concatenate([p[0] for p in parts])
    x = np.concatenate([p[1] for p in parts])
    y = np.concatenate([p[2] for p in parts])
    zc = np.concatenate([p[3] for p in parts])
    # the cell_type column is used when every file has one.  Without it, several slices are
    # classified by gid (1..261844 excitatory, 261845..288027 inhibitory); a single file keeps
    # the default excitatory/inhibitory percentage (cell_type None -> EXC_RATIO downstream).
    if all(p[4] is not None for p in parts):
        ct = np.concatenate([p[4] for p in parts])
    elif len(parts) > 1:
        ct = (ids > LAST_EXC_GID).astype(np.int64)
    else:
        ct = None

    if len(parts) > 1:
        # a neuron present in two slices is shown once (last slice wins)
        _, rev_first = np.unique(ids[::-1], return_index=True)
        if len(rev_first) < len(ids):
            keep = np.sort(len(ids) - 1 - rev_first)
            ids, x, y, zc = ids[keep], x[keep], y[keep], zc[keep]
            ct = ct[keep] if ct is not None else None
    _write_network(out_dir, ids, x, y, zc, ct)


def process_network_csv(file_path, batch=None):
    """
    Network CSV -> network.json; removes the CSV.  Slices uploaded with the same batch id are
    merged into one network (sorted by file name); without a batch id the file replaces the network.
    """
    out_dir = os.path.dirname(file_path)
    ids, x, y, z, cell_type = _parse_network_csv(file_path)
    name = _safe_name(os.path.basename(file_path))

    with _dir_lock(out_dir):
        folder = _begin_slice_batch(out_dir, "net", batch)
        np.savez(os.path.join(folder, name + ".npz"), ids=ids, x=x, y=y, z=z,
                 ct=cell_type if cell_type is not None else np.zeros(0), has_ct=cell_type is not None)
        _rebuild_network_from_slices(out_dir, folder)

    try:
        os.remove(file_path)
    except OSError as e:
        print(f"Error deleting file {file_path}: {e}")


def _store_activity_slice(file_path, out_dir, batch=None):
    """Activity CSV slices of one batch are concatenated into activity.csv (chunking sorts by time)."""
    name = _safe_name(os.path.basename(file_path))
    with _dir_lock(out_dir):
        folder = _begin_slice_batch(out_dir, "act", batch)
        os.replace(file_path, os.path.join(folder, name))
        names = sorted(os.listdir(folder), key=_natural_key)
        tmp = os.path.join(out_dir, "activity.csv.merging")
        with open(tmp, "wb") as out:
            for n in names:
                with open(os.path.join(folder, n), "rb") as src:
                    shutil.copyfileobj(src, out, 8 * MB)
                    if src.tell() and (src.seek(-1, os.SEEK_END) or src.read(1)) not in (b"\n", b"\r"):
                        out.write(b"\n")      # the next slice must start on its own line
        os.replace(tmp, os.path.join(out_dir, "activity.csv"))


def _write_activity_csv(ids, times, path):
    ids = np.asarray(ids)
    if ids.dtype.kind == "f" and ids.size and np.isfinite(ids).all() and (ids == np.floor(ids)).all():
        ids = ids.astype(np.int64)
    pd.DataFrame({"id": ids, "t": np.asarray(times)}).to_csv(path, index=False, header=False)


def process_hdf5_file(file_path):
    out_dir = os.path.dirname(file_path)
    with h5py.File(file_path, "r") as hdf:
        if "network" in hdf:
            net = hdf["network"][:]
            if net.ndim == 2 and net.shape[1] in (4, 5):
                finite = np.isfinite(net.astype(np.float64)).all(axis=1)
                if not finite.all():
                    print(f"Skipping {int((~finite).sum())} non-finite network records")
                    net = net[finite]
                if len(net) > 0:
                    cell_type = net[:, 4] if net.shape[1] == 5 else None
                    _write_network(out_dir, net[:, 0], net[:, 1], net[:, 2], net[:, 3], cell_type)
            else:
                print(f"Dataset 'network' does not have 4 or 5 columns as expected. Found shape: {net.shape}")
        else:
            print("Dataset 'network' not found in HDF5 file.")

        name = "spikes" if "spikes" in hdf else ("activity" if "activity" in hdf else None)
        if name:
            sp = hdf[name][:]
            if sp.ndim == 2 and sp.shape[1] == 2:
                _write_activity_csv(sp[:, 0], np.round(sp[:, 1].astype(np.float64), 1),
                                    os.path.join(out_dir, "activity.csv"))
            else:
                print(f"Dataset '{name}' does not have 2 columns as expected.")
        else:
            print("Neither 'spikes' nor 'activity' dataset found in HDF5 file.")


# =============================================================================
# Activity CSV / arrays -> activity_chunk_N.json (+ .npz sidecar)
# =============================================================================

def _read_activity_csv(path):
    try:
        df = pd.read_csv(path, header=None, names=["id", "t"], encoding="utf-8")
    except UnicodeDecodeError:
        df = pd.read_csv(path, header=None, names=["id", "t"], encoding="latin1")
    total_lines = len(df)
    if df["id"].dtype == object or df["t"].dtype == object:
        df = df.apply(pd.to_numeric, errors="coerce").dropna()
    ids = df["id"].to_numpy()
    if ids.dtype.kind == "f" and ids.size and np.isfinite(ids).all() and (ids == np.floor(ids)).all():
        ids = ids.astype(np.int64)
    return ids, df["t"].to_numpy(dtype=np.float64), total_lines


def _clear_chunks(out_dir):
    for fn in os.listdir(out_dir):
        if fn.startswith("activity_chunk_") and fn.endswith((".json", ".npz")):
            try:
                os.remove(os.path.join(out_dir, fn))
            except OSError:
                pass


_POW10 = 10 ** np.arange(1, 19, dtype=np.int64)


def _spike_sizes(ids):
    """Approximate JSON size of every spike id (digits + comma)."""
    if ids.dtype.kind in "iu":
        a = np.abs(ids.astype(np.int64))
        return 1 + np.searchsorted(_POW10, a, side="right") + (ids < 0) + 1
    return np.full(ids.shape, 9, dtype=np.int64)


def _build_activity_chunks(ids, times, out_dir, chunk_bytes, n_total_network, total_lines):
    """
    Group spikes by time, cut the time-ordered sequence into ~chunk_bytes JSON files and
    return the `lstresponse` dict.  Fully vectorised; per chunk the work is one tolist().
    """
    _clear_chunks(out_dir)
    n_total = int(n_total_network) if n_total_network and int(n_total_network) > 0 else None

    order = np.argsort(times, kind="stable")        # stable: id order inside a time is kept
    times = times[order]
    ids = ids[order]
    N = len(times)

    first_last_keys, chunk_mfr_list = [], []

    if N:
        flag = np.empty(N, dtype=bool)
        flag[0] = True
        np.not_equal(times[1:], times[:-1], out=flag[1:])
        start = np.flatnonzero(flag)                # first spike of every distinct time
        keys = times[start]
        counts = np.diff(np.append(start, N))
        K = len(keys)

        key_len = np.char.str_len(keys.astype("U32"))
        spike_sz = _spike_sizes(ids)
        entry_size = key_len + 6 + np.add.reduceat(spike_sz, start)   # {"k":[a,b,...]}
        cum = np.cumsum(entry_size)

        a = 0
        chunk_number = 0
        while a < K:
            base = cum[a - 1] if a else 0
            b = int(np.searchsorted(cum, base + chunk_bytes, side="right"))
            b = max(b, a + 1)
            b = min(b, K)

            s0 = int(start[a])
            s1 = int(start[b]) if b < K else N
            ids_c, keys_c, counts_c = ids[s0:s1], keys[a:b], counts[a:b]

            id_list = ids_c.tolist()
            offs = np.concatenate(([0], np.cumsum(counts_c))).tolist()
            chunk = {str(k): id_list[offs[i]:offs[i + 1]] for i, k in enumerate(keys_c.tolist())}

            with open(os.path.join(out_dir, f"activity_chunk_{chunk_number}.json"), "wb") as f:
                f.write(_dumps(chunk).encode())
            try:
                np.savez(os.path.join(out_dir, f"activity_chunk_{chunk_number}.npz"),
                         keys=keys_c, counts=counts_c.astype(np.int64), ids=ids_c)
            except OSError:
                pass

            t_min, t_max = float(keys_c[0]), float(keys_c[-1])
            duration_ms = t_max - t_min
            total_time_sec = max(duration_ms / 1000.0, 1e-9)
            total_spikes = int(s1 - s0)
            n_active = int(np.unique(ids_c).size) or 1
            n_used = n_total if n_total is not None else n_active

            chunk_mfr_list.append({
                "chunk_number": chunk_number,
                "first_key": t_min,
                "last_key": t_max,
                "duration_ms": round(duration_ms, 1),
                "total_spikes": total_spikes,
                "n_total": int(n_used),
                "n_active": n_active,
                "MFR_total": round((total_spikes / n_used) / total_time_sec, 2),
                "MFR_active": round((total_spikes / n_active) / total_time_sec, 2),
            })
            first_last_keys.append({"chunk_number": chunk_number, "first_key": t_min, "last_key": t_max})

            a = b
            chunk_number += 1
        total_activity_files = chunk_number
    else:
        total_activity_files = 1   # same value the previous implementation reported for no data

    return {
        "OUTPUT_FOLDER": out_dir,
        "total_lines": int(total_lines),
        "total_activity_files": int(total_activity_files),
        "first_last_keys": first_last_keys,
        "chunk_mfr_list": chunk_mfr_list,
    }


def chunk_activity_csv(activity_csv_path, out_dir, chunk_size_bytes=100 * MB, network_total_neurons=None):
    """Produces activity_chunk_N.json and returns the lstresponse dict."""
    try:
        ids, times, total_lines = _read_activity_csv(activity_csv_path)
        return _build_activity_chunks(ids, times, out_dir, chunk_size_bytes, network_total_neurons, total_lines)
    except Exception as e:
        raise RuntimeError(f"Error processing activity file: {str(e)}")


def _cached_csv_activity(out_dir, csv_path, n_total, chunk_bytes):
    """chunk_activity_csv with a cache: re-chunk only if the CSV, network size or chunk size changed."""
    meta_p = os.path.join(out_dir, "activity_meta.json")
    key = {"src": _signature(csv_path), "n_total": int(n_total or 0), "chunk_bytes": int(chunk_bytes)}
    if os.path.exists(meta_p) and os.path.exists(os.path.join(out_dir, "activity_chunk_0.json")):
        try:
            cached = _read_json_file(meta_p)
            if cached.get("key") == key:
                return cached["lstresponse"]
        except (OSError, ValueError, KeyError):
            pass
    lst = chunk_activity_csv(csv_path, out_dir, chunk_bytes, n_total)
    _write_json_file(meta_p, {"key": key, "lstresponse": lst})
    return lst


# =============================================================================
# Uploaded circuits (CSV / HDF5): fetch
# =============================================================================

def _network_parts(out_dir, meta, extra_file_fields=None):
    """JSON pieces for  "files":[{... "fileData": <raw network.json> ...}]"""
    net = os.path.join(out_dir, "network.json")
    fields = {"total_neurons": meta["total_neurons"],
              "total_excitatory": meta["total_excitatory"],
              "total_inhibitory": meta["total_inhibitory"],
              "json_directory": out_dir}
    fields.update(extra_file_fields or {})
    return ['{"files":[{"filename":"network.json","fileData":', _FileRange(net), "," + _object_tail(fields), "]"]


@csrf_exempt
def fetch_user_network_data(request):
    try:
        unique_directory = request.GET.get("dir")
        if not unique_directory:
            return _err("Missing directory identifier", 400)
        out_dir = _user_dir(unique_directory)
        if out_dir is None:
            return _err("Invalid directory identifier", 400)
        if not os.path.exists(out_dir):
            return _err("Directory not found", 404)

        net = os.path.join(out_dir, "network.json")
        has_net = os.path.exists(net)
        meta = _ensure_network_meta(out_dir) if has_net else None

        lstresponse = []
        flag_check = 0
        activity = os.path.join(out_dir, "activity.csv")
        if os.path.exists(activity):
            flag_check = 1
            try:
                lstresponse = _cached_csv_activity(out_dir, activity,
                                                   meta["total_neurons"] if meta else 0, 200 * MB)
            except Exception as e:
                return _err(f"Error processing activity file: {str(e)}")

        if has_net:
            parts = _network_parts(out_dir, meta, {"cell_type": meta["cell_type"]})
            total_size = os.path.getsize(net) / MB
        else:
            parts = ['{"files":[]']
            total_size = 0

        top = {"lstresponse": lstresponse, "total_size": total_size, "flag_check": flag_check}
        parts += ["," + _object_tail(top)]
        return _stream_json(parts)

    except Exception as e:
        return _err(str(e))


# =============================================================================
# SONATA
# =============================================================================

def _safe_name(name: str) -> str:
    name = name.replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^a-zA-Z0-9._-]+", "_", name)
    return name or "upload.bin"


def _detect_h5_role(h5_path: str) -> str:
    with h5py.File(h5_path, "r") as f:
        keys = set(f.keys())
    if "nodes" in keys:
        return "nodes"
    if "spikes" in keys:
        return "spikes"
    return "unknown"


def _read_node_types_csv_any_delim(csv_path: str, nrows=None) -> pd.DataFrame:
    """node_types CSV, comma- or whitespace-separated; must contain node_type_id and ei."""
    try:
        df = pd.read_csv(csv_path, nrows=nrows)
        if "node_type_id" in df.columns and "ei" in df.columns:
            return df
    except Exception:
        pass
    return pd.read_csv(csv_path, sep=r"\s+", engine="python", nrows=nrows)


def _detect_node_types_csv(csv_path: str) -> bool:
    try:
        df = _read_node_types_csv_any_delim(csv_path, nrows=5)   # header is enough
        return "node_type_id" in df.columns and "ei" in df.columns
    except Exception:
        return False


def _load_type_map(csv_path):
    """({node_type_id: 0|1}, csv_has_e_or_i)"""
    if not os.path.exists(csv_path):
        return {}, False
    try:
        df = _read_node_types_csv_any_delim(csv_path)
    except Exception:
        return {}, False
    if "node_type_id" not in df.columns or "ei" not in df.columns:
        return {}, False

    ei = df["ei"].astype(str).str.strip().str.lower()
    used = bool(ei[df["ei"].notna()].isin(["e", "i"]).any())
    nid = pd.to_numeric(df["node_type_id"], errors="coerce")
    ok = nid.notna()
    type_map = {}
    for n, v in zip(nid[ok].astype(np.int64).tolist(), ei[ok].tolist()):
        if v == "e":
            type_map[n] = 0
        elif v == "i":
            type_map[n] = 1
    return type_map, used


@csrf_exempt
def upload_and_save_sonata_anynames(request):
    """
    Upload any SONATA files (any names).
    - H5 role detected by HDF5 keys: 'nodes' or 'spikes'
    - node types CSV detected by columns: node_type_id + ei
    """
    try:
        chunk = request.FILES.get("file")
        unique_directory = request.POST.get("uniqueDirectory")
        try:
            chunk_index = int(request.POST.get("chunkIndex", 0))
            total_chunks = int(request.POST.get("totalChunks", 1))
        except ValueError:
            return _err("Invalid chunkIndex/totalChunks", 400)
        original_name = request.POST.get("originalName") or (chunk.name if chunk else "")

        if not chunk or not unique_directory:
            return _err("Missing file or uniqueDirectory", 400)
        base_dir = _user_dir(unique_directory)
        if base_dir is None:
            return _err("Invalid uniqueDirectory", 400)
        os.makedirs(base_dir, exist_ok=True)

        safe = _safe_name(original_name)
        parts_dir = os.path.join(base_dir, f"parts_{safe}")
        os.makedirs(parts_dir, exist_ok=True)
        _save_upload(chunk, os.path.join(parts_dir, f"part_{chunk_index:08d}.bin"))

        def all_parts_present():
            try:
                names = set(os.listdir(parts_dir))
            except FileNotFoundError:
                return False
            return all(f"part_{i:08d}.bin" in names for i in range(total_chunks))

        if not all_parts_present():
            return json_response({"ok": True, "assembled": False})

        lock_path = os.path.join(base_dir, f"__asm__{safe}.lock")
        result_path = os.path.join(base_dir, f"__asm__{safe}.result")

        with _assembly_lock(lock_path) as owner:
            if not owner:
                _wait_unlocked(lock_path)
                try:
                    return json_response(_read_json_file(result_path))
                except (OSError, ValueError):
                    return json_response({"ok": True, "assembled": False})

            if not all_parts_present():                     # finished by a previous owner
                try:
                    return json_response(_read_json_file(result_path))
                except (OSError, ValueError):
                    return json_response({"ok": True, "assembled": False})

            expected = [os.path.join(parts_dir, f"part_{i:08d}.bin") for i in range(total_chunks)]
            tmp_path = os.path.join(base_dir, f"__tmp__{safe}")
            _concat_files(expected, tmp_path)
            shutil.rmtree(parts_dir, ignore_errors=True)

            lower = safe.lower()
            if lower.endswith((".h5", ".hdf5")):
                role = _detect_h5_role(tmp_path)
                if role not in ("nodes", "spikes"):
                    os.remove(tmp_path)
                    result = {"error": f"Uploaded H5 is neither nodes nor spikes: {safe}"}
                    _write_json_file(result_path, result)
                    return json_response(result, 400)
                final = os.path.join(base_dir, f"{role}.h5")
            elif lower.endswith(".csv") and _detect_node_types_csv(tmp_path):
                final = os.path.join(base_dir, "internal_node_types.csv")
            else:
                final = os.path.join(base_dir, safe)        # kept, not needed by NCV

            os.replace(tmp_path, final)
            result = {"ok": True, "assembled": True, "saved_as": os.path.basename(final)}
            _write_json_file(result_path, result)
            return json_response(result)

    except Exception as e:
        return _err(str(e))


def pick_population(names):
    if not names:
        return None
    lower = {n.lower(): n for n in names}
    return lower.get("ca1", names[0])


def sonata_nodes_to_network_json(nodes_h5_path, out_dir, preferred_pop=None):
    """
    SONATA nodes.h5 -> NCV network.json (+ sidecars).

    Coordinates: nodes/<pop>/x,y,z  |  nodes/<pop>/positions (Nx3)  |
                 nodes/<pop>/<group_id>/positions via node_group_id + node_group_index.
    Cell types:  internal_node_types.csv (ei == 'e' -> 0, 'i' -> 1); otherwise all excitatory (0).
    """
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "network.json")

    def choose_population(names):
        if not names:
            return None
        if preferred_pop:
            lower = {n.lower(): n for n in names}
            for p in preferred_pop:
                if p.lower() in lower:
                    return lower[p.lower()]
        return names[0]

    type_map, _ = _load_type_map(os.path.join(os.path.dirname(nodes_h5_path), "internal_node_types.csv"))

    with h5py.File(nodes_h5_path, "r") as f:
        if "nodes" not in f:
            raise ValueError("nodes.h5 missing top-level group 'nodes'")
        pop = choose_population(list(f["nodes"].keys()))
        if pop is None:
            raise ValueError("No population found under /nodes")
        popg = f["nodes"][pop]

        node_id = popg["node_id"][:]
        node_type_id = popg["node_type_id"][:] if "node_type_id" in popg else None
        node_group_id = popg["node_group_id"][:] if "node_group_id" in popg else None
        node_group_index = popg["node_group_index"][:] if "node_group_index" in popg else None
        n = len(node_id)

        if all(k in popg for k in ("x", "y", "z")):
            x, y, z = popg["x"][:], popg["y"][:], popg["z"][:]
        elif "positions" in popg:
            pos = popg["positions"][:]
            if pos.ndim != 2 or pos.shape[1] < 3:
                raise ValueError(f"nodes/{pop}/positions has wrong shape: {pos.shape}")
            x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]
        else:
            if node_group_id is None or node_group_index is None:
                raise ValueError(f"Could not find coordinates for nodes/{pop}. "
                                 f"Expected x/y/z or positions Nx3 OR node_group_id & node_group_index.")
            x = np.empty(n, dtype=np.float64)
            y = np.empty(n, dtype=np.float64)
            z = np.empty(n, dtype=np.float64)
            for gid in np.unique(node_group_id):
                gid_str = str(int(gid))
                if gid_str not in popg:
                    raise ValueError(f"Group '{gid_str}' not found under nodes/{pop}")
                gg = popg[gid_str]
                if "positions" in gg:
                    pos = gg["positions"][:]
                    if pos.ndim != 2 or pos.shape[1] < 3:
                        raise ValueError(f"nodes/{pop}/{gid_str}/positions has wrong shape: {pos.shape}")
                    gx, gy, gz = pos[:, 0], pos[:, 1], pos[:, 2]
                elif all(k in gg for k in ("x", "y", "z")):
                    gx, gy, gz = gg["x"][:], gg["y"][:], gg["z"][:]
                else:
                    raise ValueError(f"Could not find coordinates in nodes/{pop}/{gid_str}. "
                                     f"Expected positions or x/y/z.")
                mask = node_group_id == gid
                idxs = node_group_index[mask].astype(np.int64)
                if idxs.size == 0:
                    continue
                if idxs.min() < 0 or idxs.max() >= len(gx):
                    raise ValueError(f"node_group_index out of range for group {gid_str}: "
                                     f"min={idxs.min()}, max={idxs.max()}, group_len={len(gx)}")
                x[mask], y[mask], z[mask] = gx[idxs], gy[idxs], gz[idxs]

        if not (np.isfinite(x).all() and np.isfinite(y).all() and np.isfinite(z).all()):
            raise ValueError("Coordinates contain NaN/Inf values.")

        cell_type = np.zeros(n, dtype=np.int64)               # default: excitatory
        if node_type_id is not None and type_map:
            for raw, ct in type_map.items():
                if ct:
                    cell_type[node_type_id == raw] = 1        # unknown ids stay excitatory

    _write_network(out_dir, node_id, x, y, z, cell_type)
    return out_path


def _read_sonata_spikes(spikes_h5_path):
    """(node_ids int64, times in ms rounded to 3 decimals)"""
    with h5py.File(spikes_h5_path, "r") as f:
        if "spikes" not in f:
            raise ValueError("spikes.h5 missing top-level group 'spikes'")
        pop = pick_population(list(f["spikes"].keys()))
        g = f["spikes"][pop]

        for name in ("timestamps", "times", "time"):
            if name in g:
                times = np.array(g[name][:], dtype=np.float64)
                break
        else:
            raise ValueError(f"spikes/{pop} missing timestamps dataset")

        for name in ("node_ids", "node_id"):
            if name in g:
                node_ids = np.array(g[name][:], dtype=np.int64)
                break
        else:
            raise ValueError(f"spikes/{pop} missing node_ids dataset")

    if len(times) and times.max() < 1000.0:      # heuristic seconds -> ms
        times = times * 1000.0
    return node_ids, np.round(times, 3)


def sonata_spikes_to_activity_csv(spikes_h5_path, out_dir):
    out_path = os.path.join(out_dir, "activity.csv")
    node_ids, times = _read_sonata_spikes(spikes_h5_path)
    _write_activity_csv(node_ids, times, out_path)
    return out_path


@csrf_exempt
def fetch_user_sonata_data(request):
    try:
        unique_directory = request.GET.get("dir")
        if not unique_directory:
            return _err("Missing directory identifier", 400)
        out_dir = _user_dir(unique_directory)
        if out_dir is None:
            return _err("Invalid directory identifier", 400)
        if not os.path.exists(out_dir):
            return _err("Directory not found", 404)

        nodes_path = os.path.join(out_dir, "nodes.h5")
        spikes_path = os.path.join(out_dir, "spikes.h5")
        if not os.path.exists(nodes_path) or not os.path.exists(spikes_path):
            return _err("nodes.h5 and spikes.h5 are required", 400)

        node_types_csv = os.path.join(out_dir, "internal_node_types.csv")
        network_json_path = os.path.join(out_dir, "network.json")
        activity_csv_path = os.path.join(out_dir, "activity.csv")
        state_path = os.path.join(out_dir, "sonata_state.json")
        sig = _signature(nodes_path, spikes_path, node_types_csv)

        # derived files are rebuilt only when an input changed
        state = None
        if (os.path.exists(state_path) and os.path.exists(network_json_path)
                and _fresh(os.path.join(out_dir, "network_meta.json"), network_json_path)):
            try:
                cached = _read_json_file(state_path)
                if cached.get("sig") == sig and (not cached["lstresponse"]
                                                 or os.path.exists(os.path.join(out_dir, "activity_chunk_0.json"))):
                    state = cached
            except (OSError, ValueError, KeyError):
                state = None

        if state is None:
            for p in (network_json_path, activity_csv_path):
                if os.path.exists(p):
                    os.remove(p)
            _clear_chunks(out_dir)

            used_cell_types_csv = _load_type_map(node_types_csv)[1]

            sonata_nodes_to_network_json(nodes_path, out_dir)
            meta = _ensure_network_meta(out_dir)

            node_ids, times = _read_sonata_spikes(spikes_path)
            _write_activity_csv(node_ids, times, activity_csv_path)
            lstresponse = _build_activity_chunks(node_ids, times, out_dir, 100 * MB,
                                                 meta["total_neurons"], len(times))
            state = {"sig": sig, "lstresponse": lstresponse, "used_cell_types_csv": used_cell_types_csv,
                     "flag_check": 1}
            _write_json_file(state_path, state)

        meta = _ensure_network_meta(out_dir)
        mode = "csv" if state["used_cell_types_csv"] else "default_all_excitatory"

        parts = _network_parts(out_dir, meta, {"cell_type_mode": mode})
        top = {"lstresponse": state["lstresponse"],
               "total_size": os.path.getsize(network_json_path) / MB,
               "flag_check": state["flag_check"],
               "used_cell_types_csv": state["used_cell_types_csv"]}
        parts += ["," + _object_tail(top)]
        return _stream_json(parts)

    except Exception as e:
        return _err(str(e))


# =============================================================================
# Per-chunk data + histogram
# =============================================================================

def chunk_time_bounds_from_keys(chunk_data):
    ts = sorted(float(k) for k in chunk_data.keys())
    if not ts:
        return 0.0, 0.0
    return ts[0], ts[-1]


def _arrays_from_dict(chunk_data):
    """chunk dict {t_str: [gids]} -> (sorted unique times, spikes per time, flat gids)"""
    items = sorted(((float(k), v) for k, v in chunk_data.items()), key=lambda kv: kv[0])
    keys = np.array([k for k, _ in items], dtype=np.float64)
    counts = np.array([len(v) for _, v in items], dtype=np.int64)
    ids = np.fromiter(chain.from_iterable(v for _, v in items), dtype=np.int64, count=int(counts.sum()))
    return keys, counts, ids


def _load_chunk_arrays(out_dir, chunk_number):
    jp = os.path.join(out_dir, f"activity_chunk_{chunk_number}.json")
    npz = os.path.join(out_dir, f"activity_chunk_{chunk_number}.npz")
    if _fresh(npz, jp):
        with np.load(npz) as z:
            return z["keys"], z["counts"], z["ids"]
    arrays = _arrays_from_dict(_read_json_file(jp))
    try:
        np.savez(npz, keys=arrays[0], counts=arrays[1], ids=arrays[2])
    except OSError:
        pass
    return arrays


def _hist_data(keys, counts, n_active, total_neurons, bins=100):
    if not len(keys) or not counts.sum():
        return {"bin_edges": [], "bin_centers": [], "counts": [], "sd_poisson": [],
                "t_min": 0.0, "t_max": 0.0, "mfr_total": 0.0, "mfr_active": 0.0,
                "n_total": int(total_neurons or 0), "n_active": 0, "total_spikes": 0}

    t_min, t_max = float(keys[0]), float(keys[-1])
    edges = np.linspace(t_min, t_max, bins + 1)
    hist, _ = np.histogram(keys, bins=edges, weights=counts)
    hist = np.rint(hist).astype(np.int64)

    total_spikes = int(counts.sum())
    dur_s = max((t_max - t_min) / 1000.0, 1e-9)
    n_active = max(int(n_active), 1)
    n_total = int(total_neurons) if total_neurons and int(total_neurons) > 0 else n_active

    return {
        "bin_edges": edges.tolist(),
        "bin_centers": ((edges[:-1] + edges[1:]) / 2.0).tolist(),
        "counts": hist.tolist(),
        "sd_poisson": np.sqrt(hist).tolist(),
        "t_min": t_min,
        "t_max": t_max,
        "total_spikes": total_spikes,
        "n_total": int(n_total),
        "n_active": int(n_active),
        "mfr_total": float((total_spikes / n_total) / dur_s),
        "mfr_active": float((total_spikes / n_active) / dur_s),
    }


def compute_hist_data(chunk_data, chunk_number, bins=100, total_neurons=None):
    keys, counts, ids = _arrays_from_dict(chunk_data)
    return _hist_data(keys, counts, np.unique(ids).size, total_neurons, bins)


def _spike_histogram_png(keys, counts, n_active, total_neurons, chunk_number, color="white"):
    """1 ms-bin spike histogram as base64 PNG (same figure as before)."""
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure
    from matplotlib import ticker

    t_min, t_max = float(keys[0]), float(keys[-1])
    lo, hi = np.floor(t_min), np.ceil(t_max)
    if hi <= lo:
        hi = lo + 1
    nb = int(hi - lo)
    edges = np.linspace(lo, hi, nb + 1)

    hist, _ = np.histogram(keys, bins=edges, weights=counts)
    spike_counts = np.rint(hist).astype(np.int64)

    # population std of the spike times inside every 1 ms bin, weighted by spikes per time
    sel = keys < hi
    k, c = keys[sel], counts[sel].astype(np.float64)
    bi = np.minimum((k - lo).astype(np.int64), nb - 1)
    x = k - (lo + bi)                                    # offset inside the bin: no cancellation
    n_b = np.bincount(bi, weights=c, minlength=nb)
    s1 = np.bincount(bi, weights=c * x, minlength=nb)
    s2 = np.bincount(bi, weights=c * x * x, minlength=nb)
    with np.errstate(divide="ignore", invalid="ignore"):
        mean = s1 / n_b
        var = np.maximum(s2 / n_b - mean * mean, 0.0)
    std_per_bin = np.where(n_b > 1, np.sqrt(var), 0.0)

    total_spikes = int(counts.sum())
    total_time_sec = max((t_max - t_min) / 1000.0, 1e-9)
    n_active = int(n_active) or 1
    n_total = int(total_neurons) if (total_neurons is not None and int(total_neurons) > 0) else n_active
    mfr_total = (total_spikes / n_total) / total_time_sec
    mfr_active = (total_spikes / n_active) / total_time_sec

    fig = Figure(figsize=(12, 6), dpi=300)
    FigureCanvasAgg(fig)
    ax = fig.subplots()
    fig.patch.set_facecolor("#33373d")
    ax.set_facecolor("#33373d")

    if nb <= MAX_STD_LABELS:
        bars = ax.bar(edges[:-1], spike_counts, width=np.diff(edges), color=color, alpha=0.7,
                      edgecolor="black", align="edge")
        # thousands of overlapping 6 pt labels are unreadable and slow, so only label small histograms
        for bar, std_val in zip(bars, std_per_bin):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.5, f"{std_val:.1f}",
                    ha="center", va="bottom", fontsize=6, color="yellow", rotation=90)
    else:                            # one filled outline instead of tens of thousands of bar patches
        ax.stairs(spike_counts, edges, fill=True, color=color, alpha=0.7)

    legend_labels = {
        "# Max Spike": int(spike_counts.max()) if len(spike_counts) else 0,
        "# Min Spike": int(spike_counts.min()) if len(spike_counts) else 0,
        "# Spikes": total_spikes,
        "# Active Neurons": int(n_active),
        "# Total Neurons": int(n_total),
        "# Min Time (ms)": float(t_min),
        "# Max Time (ms)": float(t_max),
        "MFR (total-norm) Hz": float(mfr_total),
        "MFR (active-norm) Hz": float(mfr_active),
    }
    fig.text(0.80, 0.79, "\n".join(f"{k}: {v}" for k, v in legend_labels.items()), fontsize=8,
             bbox=dict(facecolor="white", alpha=0.5), color="black")

    ax.set_xlim(t_min, t_max)
    ax.set_xlabel("Time (ms)", fontsize=16, fontweight="bold", color="white")
    ax.set_ylabel("Number of Firing Neurons", fontsize=16, fontweight="bold", color="white")
    ax.set_title(f"Chunk {chunk_number} - MFR: {mfr_total:.2f} Hz", fontsize=18, fontweight="bold", color="white")
    ax.tick_params(axis="x", colors="white")
    ax.tick_params(axis="y", colors="white")
    ax.xaxis.set_major_locator(ticker.MaxNLocator(nbins=10))
    ax.grid(True, linestyle="--", alpha=0.4)

    buf = io.BytesIO()
    try:
        fig.savefig(buf, format="png", bbox_inches="tight", dpi=300, facecolor=fig.get_facecolor(),
                    pil_kwargs={"compress_level": 3})
    except TypeError:                                    # very old Matplotlib
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", dpi=300, facecolor=fig.get_facecolor())
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def generate_spike_histogram(chunk_data, chunk_number, color="white", total_neurons=None):
    try:
        if not chunk_data or not isinstance(chunk_data, dict):
            return "Error: No data available for plotting."
        keys, counts, ids = _arrays_from_dict(chunk_data)
        if not counts.sum():
            return "Error: No spike times in chunk data."
        return _spike_histogram_png(keys, counts, np.unique(ids).size, total_neurons, chunk_number, color)
    except Exception as e:
        return f"Error generating spike histogram: {str(e)}"


def get_chunk_data(request):
    try:
        chunk_number = request.GET.get("chunk_number")
        if not chunk_number:
            return _err("No chunk number provided", 400)
        try:
            chunk_number = int(chunk_number)
        except ValueError:
            return _err("Invalid chunk number", 400)
        out_dir = _user_dir(request.GET.get("dir"))
        if out_dir is None:
            return _err("Missing or invalid directory identifier", 400)

        chunk_json = os.path.join(out_dir, f"activity_chunk_{chunk_number}.json")
        try:
            keys, counts, ids = _load_chunk_arrays(out_dir, chunk_number)
        except Exception as e:
            return _err(f"Error loading activity.json: {str(e)}")

        total_neurons, lookup = _network_lookup(out_dir)
        n_active_ids = np.unique(ids)
        gids_activity_indexes = _lookup_indexes(lookup, n_active_ids)
        _write_json_file(os.path.join(out_dir, "gids_activity_indexes.json"), gids_activity_indexes)

        total_spikes = int(counts.sum())

        try:
            cache_p = os.path.join(out_dir, f"activity_chunk_{chunk_number}_hist.json")
            sig = {"v": HIST_CACHE_VERSION, "src": os.stat(chunk_json).st_mtime_ns, "n_total": int(total_neurons)}
            cached = None
            if os.path.exists(cache_p):
                try:
                    cached = _read_json_file(cache_p)
                    if cached.get("sig") != sig:
                        cached = None
                except (OSError, ValueError):
                    cached = None
            if cached is None:
                if not total_spikes:
                    hist_img = "Error: No spike times in chunk data."
                else:
                    hist_img = _spike_histogram_png(keys, counts, n_active_ids.size, total_neurons,
                                                    chunk_number, "white")
                hist = _hist_data(keys, counts, n_active_ids.size, total_neurons, bins=100)
                cached = {"sig": sig, "histogram": hist_img, "hist_data": hist}
                if not hist_img.startswith("Error"):
                    _write_json_file(cache_p, cached)

            parts = [
                '{"chunk_data":', _FileRange(chunk_json),
                f',"total_spikes":{total_spikes}',
                ',"histogram":' + _dumps(cached["histogram"]),
                ',"hist_data":' + _dumps(cached["hist_data"]),
                ',"gids_activity_indexes":' + _dumps(gids_activity_indexes),
                f',"total_neurons":{int(total_neurons)}}}',
            ]
            return _stream_json(parts)
        except Exception as e:
            return _err(f"Error generating histogram: {str(e)}")

    except Exception as e:
        return _err(str(e))


# =============================================================================
# Misc readers
# =============================================================================

@lru_cache(maxsize=1)
def _load_json_cached(path, mtime_ns):
    return _read_json_file(path)


@csrf_exempt
def get_activity_data_by_file_name(request):
    try:
        unique_directory = request.GET.get("dir")
        try:
            page = int(request.GET.get("page", 1))
            items_per_page = int(request.GET.get("items_per_page", 300))
        except ValueError:
            return _err("Invalid page parameters", 400)
        if not unique_directory:
            return _err("Missing directory identifier", 400)
        out_dir = _user_dir(unique_directory)
        if out_dir is None:
            return _err("Invalid directory identifier", 400)

        path = os.path.join(out_dir, "activity_data.json")
        if not os.path.exists(path):
            return _err("JSON file not found", 404)

        data = _load_json_cached(path, os.stat(path).st_mtime_ns)

        items_per_page = max(1, items_per_page)
        num_pages = max(1, -(-len(data) // items_per_page))
        if page < 1 or page > num_pages:             # Paginator.get_page falls back to the last page
            page = num_pages
        start = (page - 1) * items_per_page
        return json_response(dict(islice(data.items(), start, start + items_per_page)))

    except Exception as e:
        return _err(str(e))


def extract_ids_from_json(json_file_path):
    """Gids (int64 array) of a network.json; tolerates the old line-per-chunk layout."""
    try:
        try:
            return np.array([int(n["id"]) for n in _read_json_file(json_file_path)], dtype=np.int64)
        except ValueError:
            ids = []
            with open(json_file_path, "r") as f:
                for line in f:
                    try:
                        data = json.loads(line)
                        if isinstance(data, list):
                            ids.extend(int(n["id"]) for n in data)
                    except (KeyError, ValueError) as e:
                        print(f"Error processing JSON line: {line.strip()} - {e}")
            return np.array(ids, dtype=np.int64)
    except FileNotFoundError:
        print(f"File not found: {json_file_path}")
    except Exception as e:
        print(f"An error occurred: {e}")
    return np.array([], dtype=np.int64)


# ---- Hippocampome (mouse) activity ------------------------------------------------------

@lru_cache(maxsize=2)
def _hip_activity(path, mtime_ns):
    """(encoded {time: [gids]} JSON, encoded sorted keys, line count, unique gids) of an activity CSV."""
    df = pd.read_csv(path, usecols=[0, 1], header=0, names=["gid", "t"])   # first row is a header
    gid = df["gid"].to_numpy(np.int64)
    t = df["t"].to_numpy(np.float64)

    order = np.argsort(t, kind="stable")
    t, gid = t[order], gid[order]
    if len(t):
        flag = np.empty(len(t), dtype=bool)
        flag[0] = True
        np.not_equal(t[1:], t[:-1], out=flag[1:])
        start = np.flatnonzero(flag)
        bounds = np.append(start, len(t)).tolist()
        id_list = gid.tolist()
        data = {str(k): id_list[bounds[i]:bounds[i + 1]] for i, k in enumerate(t[start].tolist())}
    else:
        data = {}
    keys = sorted(data.keys(), key=float)
    return (_dumps(data).encode(), _dumps(keys).encode(), count_csv_lines(path), np.unique(gid))


@csrf_exempt
def LoadActivityData(request):
    try:
        if request.method != "POST":
            return _err("Invalid HTTP method", 405)

        file_id = request.GET.get("dir")
        if not file_id:
            return _err("Missing file ID", 400)

        folder = os.path.join(settings.MEDIA_ROOT, "hip_form", "activities")
        if file_id == "1":
            path = os.path.join(folder, "Activity_CA3.csv")
        elif file_id == "2":
            path = os.path.join(folder, "Activity_MEC.csv")
        else:
            return _err("Invalid file ID", 400)

        gids = np.array([], dtype=np.int64)
        gids_raw = request.POST.get("gIDs")
        if gids_raw:
            try:
                gids_list = json.loads(gids_raw)
            except json.JSONDecodeError:
                gids_list = gids_raw.split(",")
            try:
                gids = np.asarray([int(float(x)) for x in gids_list], dtype=np.int64)
            except (ValueError, TypeError) as e:
                return _err(f"Invalid GIDs data: {e}", 400)

        data_b, keys_b, n_lines, unique_ids = _hip_activity(path, os.stat(path).st_mtime_ns)
        indexes = _lookup_indexes(_make_lookup(gids), unique_ids) if gids.size else {}

        return _stream_json([b'{"data":', data_b, b',"keys":', keys_b,
                             ',"gids_activity_indexes":' + _dumps(indexes),
                             f',"number_of_spikes":{n_lines}}}'])

    except Exception as e:
        print("Error in LoadActivityData:", e)
        return _err(str(e))


def parse_activity_csv(filepath):
    activity_data = defaultdict(list)
    with open(filepath, newline="") as csvfile:
        reader = csv.reader(csvfile)
        next(reader)  # header
        for row in reader:
            activity_data[str(float(row[1]))].append(int(row[0]))
    return dict(activity_data)


# ---- hip_form layers ----------------------------------------------------------------------

def _layer_meta(file_path):
    """Counts for one layer file, cached in hip_form/_cache/ (parsed only when the file changed)."""
    st = os.stat(file_path)
    key = [st.st_mtime_ns, st.st_size]
    cache_dir = os.path.join(os.path.dirname(file_path), "_cache")
    cache_p = os.path.join(cache_dir, os.path.basename(file_path) + ".meta.json")
    try:
        cached = _read_json_file(cache_p)
        if cached.get("key") == key:
            return cached
    except (OSError, ValueError):
        pass

    file_data = _read_json_file(file_path)
    total = len(file_data)
    exc = sum(1 for neuro in file_data if neuro.get("type") == 1)
    meta = {"key": key, "total_neuros": total, "total_excitatory": exc, "total_inhibitory": total - exc}
    try:
        os.makedirs(cache_dir, exist_ok=True)
        _write_json_file(cache_p, meta)
    except OSError:
        pass
    return meta


@csrf_exempt
def LoadAllLayers(request):
    try:
        json_directory = os.path.join(settings.MEDIA_ROOT, "hip_form")

        parts = ['{"files":[']
        total_size = 0
        first = True
        for filename in sorted(os.listdir(json_directory)):
            if not filename.endswith(".json"):
                continue
            file_path = os.path.join(json_directory, filename)
            try:
                meta = _layer_meta(file_path)
                rng = _FileRange(file_path)                  # raw layer JSON, never re-encoded
            except ValueError as e:
                print(f"Error decoding JSON from file {file_path}: {e}")
                continue
            except Exception as e:
                print(f"Error reading file {file_path}: {e}")
                continue

            parts.append(("" if first else ",")
                         + '{"filename":' + _dumps(os.path.splitext(filename)[0]) + ',"fileData":')
            parts.append(rng)
            parts.append("," + _object_tail({"total_neuros": meta["total_neuros"],
                                             "total_excitatory": meta["total_excitatory"],
                                             "total_inhibitory": meta["total_inhibitory"]}))
            first = False
            total_size += os.path.getsize(file_path) / MB

        parts.append("]," + _object_tail({"total_size": total_size}))
        return _stream_json(parts)

    except Exception as e:
        print(f"An error occurred: {e}")
        return _err("An unexpected error occurred")


# =============================================================================
# CA3 -> CA1 connectivity
# =============================================================================

def calculate_scaling_factor(rat_volume, mouse_volume):
    return (mouse_volume / rat_volume) ** (1 / 3)


def _load_neuron_frame(file_paths):
    records = []
    for p in file_paths:
        try:
            records.extend(_read_json_file(p))
        except ValueError as e:
            print(f"Error decoding JSON from {p}: {e}")
    df = pd.DataFrame(records, columns=["id", "x", "y", "z", "type", "ntype"])
    return df.rename(columns={"id": "gid"})


def load_json_file_generator(file_path):
    try:
        for neuron in _read_json_file(file_path):
            yield {"gid": neuron.get("id"), "x": neuron.get("x"), "y": neuron.get("y"),
                   "z": neuron.get("z"), "type": neuron.get("type"), "ntype": neuron.get("ntype")}
    except ValueError as e:
        print(f"Error decoding JSON from {file_path}: {e}")


def load_neurons_from_files(file_paths):
    for file_path in file_paths:
        yield from load_json_file_generator(file_path)


def adaptive_sigma_global(ca1_df, factor=0.15):
    """One Gaussian sigma (µm) from the spatial extent of the whole CA1 pool."""
    if ca1_df.empty:
        return 100.0
    span = ca1_df[["x", "y", "z"]].max() - ca1_df[["x", "y", "z"]].min()
    return float(factor * np.mean(span.to_numpy()))


def _to_numeric_id(v):
    try:
        s = str(v)
        return int(s) if s.isdigit() else s
    except Exception:
        return str(v)


def connect_gaussian_all(ca3_df, ca1_df, avg_targets_per_ca3, d_max_um=300, sigma_factor=0.15,
                         ca1_in_degree_cap=510, rng_seed=42):
    """
    Domain-free CA3->CA1 connectivity with a per-CA1 in-degree cap.
    Each CA3 PC samples ~avg_targets_per_ca3 CA1 PCs with Gaussian distance weights; a CA1 PC
    never receives input from more than ca1_in_degree_cap CA3 PCs.

    Pure NumPy state (no per-neuron pandas lookups), squared distances (no sqrt), and the
    eligible-CA1 set is only rebuilt when some CA1 actually reaches the cap.
    """
    connections = {}
    if ca1_df.empty or ca3_df.empty:
        return connections

    rng = np.random.default_rng(rng_seed)

    ca3_keys = ca3_df["gid"].astype(str).to_numpy()
    ca1_out = np.array([_to_numeric_id(g) for g in ca1_df["gid"].astype(str).to_numpy()], dtype=object)
    ca3_xyz = ca3_df[["x", "y", "z"]].to_numpy(dtype=float)
    ca1_xyz = ca1_df[["x", "y", "z"]].to_numpy(dtype=float)

    sigma = adaptive_sigma_global(ca1_df, factor=sigma_factor)
    if not sigma > 0:
        sigma = 100.0
    inv_two_sigma2 = 1.0 / (2.0 * sigma * sigma)

    n1 = len(ca1_xyz)
    indeg = np.zeros(n1, dtype=np.int64)
    elig = np.arange(n1)
    elig_xyz = ca1_xyz
    k = int(max(1, round(avg_targets_per_ca3)))
    d_max2 = None if d_max_um is None else float(d_max_um) ** 2

    for pos in rng.permutation(len(ca3_xyz)):
        key = ca3_keys[pos]
        if elig.size == 0:
            connections[key] = []
            continue

        diff = elig_xyz - ca3_xyz[pos]
        d2 = np.einsum("ij,ij->i", diff, diff)
        idx = elig
        if d_max2 is not None:
            m = d2 <= d_max2
            if not m.any():
                connections[key] = []
                continue
            d2, idx = d2[m], elig[m]

        w = np.exp(-d2 * inv_two_sigma2)
        wsum = w.sum()
        probs = w / wsum if wsum > 0 else np.full(len(w), 1.0 / len(w))

        k_eff = min(k, len(idx), int(np.count_nonzero(probs)))
        if k_eff <= 0:
            connections[key] = []
            continue

        chosen = idx[rng.choice(len(idx), size=k_eff, replace=False, p=probs)]
        indeg[chosen] += 1
        if (indeg[chosen] >= ca1_in_degree_cap).any():
            elig = np.flatnonzero(indeg < ca1_in_degree_cap)
            elig_xyz = ca1_xyz[elig]
        connections[key] = ca1_out[chosen].tolist()

    max_in = int(indeg.max()) if n1 else 0
    print(f"[QA] Max CA1 in-degree observed = {max_in} (cap={ca1_in_degree_cap})")
    if max_in > ca1_in_degree_cap:
        print("[WARN] In-degree cap violated; check logic.")
    return connections


@lru_cache(maxsize=1)
def compute_connections():
    json_directory = os.path.join(settings.MEDIA_ROOT, "hip_form")
    os.makedirs(json_directory, exist_ok=True)
    json_path = os.path.join(json_directory, "connections.json")

    ca3_paths = [os.path.join(json_directory, f"CA3-{layer}.json") for layer in ["sl", "slm", "so", "sp", "sr"]]
    ca1_paths = [os.path.join(json_directory, f"CA1-{layer}.json") for layer in ["slm", "so", "sp", "sr"]]

    ca3_neurons = _load_neuron_frame(ca3_paths)
    ca1_neurons = _load_neuron_frame(ca1_paths)

    ca3_pyramidal = ca3_neurons[ca3_neurons["ntype"] == 19].copy()
    ca1_pyramidal = ca1_neurons[ca1_neurons["ntype"] == 49].copy()
    if ca3_pyramidal.empty:
        print("No CA3 PCs after ntype==19 filter; using all CA3 neurons.")
        ca3_pyramidal = ca3_neurons.copy()
    if ca1_pyramidal.empty:
        print("No CA1 PCs after ntype==49 filter; using all CA1 neurons.")
        ca1_pyramidal = ca1_neurons.copy()

    for name, df in (("CA3", ca3_pyramidal), ("CA1", ca1_pyramidal)):
        before = len(df)
        df[["x", "y", "z"]] = df[["x", "y", "z"]].apply(pd.to_numeric, errors="coerce")
        df.dropna(subset=["x", "y", "z"], inplace=True)
        if len(df) < before:
            print(f"[WARN] Dropped {before - len(df)} {name} rows with non-numeric coords.")
    print(f"CA3 PCs: {len(ca3_pyramidal)}, CA1 PCs: {len(ca1_pyramidal)}")

    # rat -> mouse scaling of the CA3 input zone
    sf_sr = calculate_scaling_factor(rat_volume=10.95, mouse_volume=2.83)
    sf_so = calculate_scaling_factor(rat_volume=6.47, mouse_volume=1.5)
    l_sr_mouse = 4465.3 * sf_sr
    l_so_mouse = 3795.59 * sf_so
    l_total_effective_mouse = l_sr_mouse + l_so_mouse / 2          # 100 % SR + 50 % SO

    total_spines = l_total_effective_mouse * 0.92                   # spines / µm
    unique_ca3_partners_per_ca1 = total_spines / 7.24               # contacts per connection
    avg_ca1_targets_per_ca3 = unique_ca3_partners_per_ca1 * (159341 / 75376)   # CA1 / CA3 census

    print(f"Scaling factors SR/SO: {sf_sr:.4f} / {sf_so:.4f}")
    print(f"Effective CA3 input length: {l_total_effective_mouse:.1f} µm; synapses per CA1 PC: {total_spines:.0f}")
    print(f"Partners per CA1 PC: {unique_ca3_partners_per_ca1:.0f}; targets per CA3 PC: {avg_ca1_targets_per_ca3:.0f}")

    out_degree = max(1, int(round(avg_ca1_targets_per_ca3 * 0.05)))   # fixed 5 % fan-out
    print(f"CA3 out-degree = {out_degree} (5% of {avg_ca1_targets_per_ca3:.0f})")

    connections = connect_gaussian_all(
        ca3_df=ca3_pyramidal, ca1_df=ca1_pyramidal, avg_targets_per_ca3=out_degree, d_max_um=None,
        sigma_factor=0.30, ca1_in_degree_cap=unique_ca3_partners_per_ca1)

    with open(json_path, "wb") as f:
        f.write(_dumps(connections).encode())

    nonempty = sum(1 for v in connections.values() if v)
    avg_out = sum(len(v) for v in connections.values()) / max(1, len(connections))
    print(f"CA3 with ≥1 target: {nonempty}/{len(connections)}  |  mean out-degree: {avg_out:.1f}")
    return json_path


@lru_cache(maxsize=1)
def _connections_cached(path, mtime_ns):
    data = _read_json_file(path)
    return data, list(data.keys())


@csrf_exempt
def fetchConnections(request):
    try:
        json_path = os.path.join(settings.MEDIA_ROOT, "hip_form", "connections", "connections.json")
        connections, keys = _connections_cached(json_path, os.stat(json_path).st_mtime_ns)

        chunk_size = max(1, int(request.GET.get("chunk_size", 10000)))
        page = max(1, int(request.GET.get("page", 1)))

        total_pages = (len(keys) + chunk_size - 1) // chunk_size
        start = (page - 1) * chunk_size
        end = start + chunk_size

        return json_response({
            "connections_chunk": {k: connections[k] for k in keys[start:end]},
            "page": page,
            "has_more": end < len(keys),
            "total_pages": total_pages,
            "total_keys": len(keys),
        })

    except Exception as e:
        return json_response({"error": str(e), "connections": {}}, 500)


# =============================================================================
# Human circuit
# =============================================================================

def _human_index(path):
    """
    Byte offsets for the human network.json (flat list of flat objects), cached in a sidecar:
    {"n": neurons, "half_end": byte offset just after the (n//2)-th object}.  Lets full / half
    circuits be streamed straight from disk without parsing.  None if the layout is not flat.
    """
    st = os.stat(path)
    key = [st.st_mtime_ns, st.st_size]
    side = os.path.join(os.path.dirname(path), "network.index.json")
    try:
        cached = _read_json_file(side)
        if cached.get("key") == key:
            return cached
    except (OSError, ValueError):
        pass

    opens, closes = [], []
    offset = 0
    with open(path, "rb") as f:
        head = f.read(1)
        if head != b"[":
            return None
        f.seek(0)
        while True:
            block = np.frombuffer(f.read(64 * MB), dtype=np.uint8)
            if not block.size:
                break
            opens.append(np.flatnonzero(block == 123) + offset)    # {
            closes.append(np.flatnonzero(block == 125) + offset)   # }
            offset += block.size
    opens = np.concatenate(opens) if opens else np.array([], dtype=np.int64)
    closes = np.concatenate(closes) if closes else np.array([], dtype=np.int64)
    n = int(closes.size)
    flat = (n > 0 and opens.size == n and bool((opens < closes).all())
            and bool((closes[:-1] < opens[1:]).all()))
    if not flat:
        return None

    half = n // 2
    index = {"key": key, "n": n, "half_end": int(closes[half - 1]) + 1 if half else 0}
    _write_json_file(side, index)
    return index


@csrf_exempt
def LoadHumanHipForm(request):
    path = os.path.join(settings.MEDIA_ROOT, "hip_form", "human", "network.json")
    try:
        mode = request.GET.get("mode", "full")
        total_size = os.path.getsize(path) / MB

        index = _human_index(path)
        if index is not None:
            if mode == "half":
                body = [b"[]"] if index["half_end"] == 0 else [_FileRange(path, 0, index["half_end"]), b"]"]
                count = index["n"] // 2
            else:
                body = [_FileRange(path)]
                count = index["n"]
            return _stream_json(['{"fileData":'] + body
                                + ["," + _object_tail({"total_neurons": count, "total_size": total_size})])

        networkdata = _read_json_file(path)                         # unusual layout: parse
        if mode == "half":
            networkdata = networkdata[: len(networkdata) // 2]
        return json_response({"fileData": networkdata, "total_neurons": len(networkdata),
                              "total_size": total_size})

    except Exception as e:
        print(f"Error reading file {path}: {e}")
        return _err(str(e))


@csrf_exempt
def LoadHumanActivityData(request):
    try:
        if request.method != "POST":
            return _err("Invalid HTTP method", 405)

        file_id = request.GET.get("dir")
        if not file_id:
            return _err("Missing file ID", 400)
        if file_id != "1":
            return _err("Invalid file ID", 400)

        folder = os.path.join(settings.MEDIA_ROOT, "hip_form", "human")
        act_json = os.path.join(folder, "activity.json")
        act_csv = os.path.join(folder, "activity.csv")
        gids_json = os.path.join(folder, "gids_activity_indexes.json")

        # sorted keys + line count are cached; the big JSON files are streamed untouched
        side = os.path.join(folder, "activity.keys.json")
        key = _signature(act_json, act_csv)
        info = None
        try:
            cached = _read_json_file(side)
            if cached.get("key") == key:
                info = cached
        except (OSError, ValueError):
            pass
        if info is None:
            data = _read_json_file(act_json)
            info = {"key": key, "keys": sorted(data.keys(), key=float), "n": count_csv_lines(act_csv)}
            _write_json_file(side, info)

        return _stream_json([b'{"data":', _FileRange(act_json),
                             b',"keys":' + _dumps(info["keys"]).encode(),
                             b',"gids_activity_indexes":', _FileRange(gids_json),
                             f',"number_of_spikes":{info["n"]}}}'])

    except Exception as e:
        print("Error in LoadHumanActivityData:", e)
        return _err(str(e))


# =============================================================================
# Connection types (HDF5)
# =============================================================================

def list_connection_types(request):
    file_path = os.path.join(settings.MEDIA_ROOT, "connections_inh.hdf5")
    if not os.path.exists(file_path):
        return _err("HDF5 file not found.", 404)
    with h5py.File(file_path, "r") as f:
        return json_response({"types": list(f.keys())})


def get_connection_data(request):
    conn_type = request.GET.get("type")
    if not conn_type:
        return _err("Missing connection type.", 400)

    file_path = os.path.join(settings.MEDIA_ROOT, "connections_inh.hdf5")
    if not os.path.exists(file_path):
        return _err("HDF5 file not found.", 404)

    with h5py.File(file_path, "r") as f:
        if conn_type not in f:
            return _err(f"Connection type '{conn_type}' not found.", 404)
        connections = f[conn_type][()].tolist()
    return json_response({"connections": connections})


# =============================================================================
# Small legacy helpers (not used by the views above, kept for compatibility)
# =============================================================================

def process_uploaded_file(file_path):
    """Legacy id,x,y,z,type CSV -> JSON (one list per 1000 records per line)."""
    json_path = os.path.join(os.path.dirname(file_path),
                             f"{os.path.splitext(os.path.basename(file_path))[0]}.json")
    fieldnames = ["id", "x", "y", "z", "type"]
    with open(file_path, "r") as csv_file, open(json_path, "w") as json_file:
        batch = []
        for row in csv.DictReader(csv_file, fieldnames=fieldnames):
            batch.append({"id": int(row["id"]), "x": float(row["x"]), "y": float(row["y"]),
                          "z": float(row["z"]), "type": int(row["type"])})
            if len(batch) >= 1000:
                ujson.dump(batch, json_file)
                json_file.write("\n")
                batch = []
        if batch:
            ujson.dump(batch, json_file)
            json_file.write("\n")
    try:
        os.remove(file_path)
    except OSError as e:
        print(f"Error deleting file {file_path}: {e}")


def get_activity_indexes_for_SimulationData(activity_file, Gids):
    gids_dict = {int(float(id_)): index for index, id_ in enumerate(Gids)}
    try:
        with open(activity_file, "r") as file:
            rows = sorted((row for row in csv.reader(file) if row and len(row) > 1),
                          key=lambda row: float(row[1]))
            return [gids_dict[int(row[0])] for row in rows if int(row[0]) in gids_dict]
    except ValueError as e:
        print(f"Skipping row due to ValueError: {e}")
        return {"error": f"ValueError: {e}"}
    except csv.Error as e:
        return {"error": f"CSV error: {e}"}


def generate_raster_plot(chunk_data):
    """Raster plot of a chunk as base64 PNG."""
    try:
        if not chunk_data:
            return "Error: No data available for plotting."
        from matplotlib.backends.backend_agg import FigureCanvasAgg
        from matplotlib.figure import Figure

        keys, counts, ids = _arrays_from_dict(chunk_data)
        t = np.repeat(keys, counts)
        fig = Figure(figsize=(12, 6))
        FigureCanvasAgg(fig)
        ax = fig.subplots()
        ax.scatter(t, ids, s=2, color="darkred", alpha=0.7)
        ax.set_title("Raster Plot of Spike Activity")
        ax.set_xlabel("Time (ms)")
        ax.set_ylabel("Neuron GID")
        ax.grid(True, linestyle="--", alpha=0.5)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", dpi=300)
        return base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception as e:
        return f"Error generating raster plot: {str(e)}"


def generate_network_graph(network_data):
    try:
        if not network_data:
            print("No network data available.")
            return None
        import networkx as nx
        from matplotlib.backends.backend_agg import FigureCanvasAgg
        from matplotlib.figure import Figure

        G = nx.DiGraph()
        for pre_neuron, post_neurons in network_data.items():
            for post_neuron in post_neurons:
                G.add_edge(pre_neuron, post_neuron)

        fig = Figure(figsize=(8, 6))
        FigureCanvasAgg(fig)
        ax = fig.subplots()
        nx.draw(G, nx.spring_layout(G, seed=42), ax=ax, node_size=10, edge_color="gray", width=0.5)
        ax.set_title("Neuron Connectivity Graph")
        buf = io.BytesIO()
        fig.savefig(buf, format="png")
        return base64.b64encode(buf.getvalue()).decode("utf-8")
    except Exception as e:
        return str(e)


# =============================================================================
# Recording: WebM (browsers that cannot record MP4) -> H.264 MP4
# =============================================================================

@csrf_exempt
def convert_to_mp4(request):
    """
    POST file=<webm>  ->  MP4 (H.264, yuv420p, 30 fps, faststart) via ffmpeg.
    Needs the `ffmpeg` binary on the server; replies 501 when it is missing.
    """
    if request.method != "POST" or "file" not in request.FILES:
        return _err("POST with file required", 400)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return _err("ffmpeg is not installed on the server", 501)

    work = tempfile.mkdtemp(prefix="ncv_rec_")
    try:
        src = os.path.join(work, "in.webm")
        dst = os.path.join(work, "out.mp4")
        _save_upload(request.FILES["file"], src)
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-i", src,
             "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
             "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", dst],
            check=True, timeout=900, capture_output=True)
    except subprocess.CalledProcessError as e:
        shutil.rmtree(work, ignore_errors=True)
        return _err("ffmpeg failed: " + e.stderr.decode(errors="replace")[-300:], 500)
    except Exception as e:
        shutil.rmtree(work, ignore_errors=True)
        return _err(str(e))

    f = open(dst, "rb")
    response = FileResponse(f, content_type="video/mp4", as_attachment=True, filename="neuron_visualization.mp4")
    response._resource_closers.append(lambda: shutil.rmtree(work, ignore_errors=True))   # delete after sending
    return response
