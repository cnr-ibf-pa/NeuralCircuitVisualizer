import base64
from django.http import HttpResponseBadRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
import numpy as np
import json, csv
from django.http import JsonResponse
from django.conf import settings
import ujson
import pandas as pd
import os
import array
import requests
from time import sleep
import time
from django.core.paginator import Paginator
from functools import lru_cache
import h5py
import matplotlib
matplotlib.use('Agg')  # Use non-GUI backend for Matplotlib
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import io
import networkx as nx
from collections import defaultdict
import shutil, re

import platform
import psutil
import subprocess


def get_cpu_model():
    """
    Returns exact CPU model depending on OS.
    """
    try:
        system = platform.system()

        if system == "Windows":
            return platform.processor()

        elif system == "Darwin":  # macOS
            cmd = ["sysctl", "-n", "machdep.cpu.brand_string"]
            return subprocess.check_output(cmd).decode().strip()

        elif system == "Linux":
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if "model name" in line:
                        return line.split(":")[1].strip()

        return "Unknown"
    except Exception as e:
        return f"Error: {str(e)}"


@csrf_exempt
def system_info(request):
    try:
        cpu_model = get_cpu_model()
        total_ram_gb = round(psutil.virtual_memory().total / (1024**3), 2)

        os_name = platform.system()
        os_version = platform.version()
        proc = psutil.Process(os.getpid())
        server_rss_mb = round(proc.memory_info().rss / (1024**2), 1)


        return JsonResponse({
            "cpu_model": cpu_model,
            "total_ram_gb": total_ram_gb,
            "os_name": os_name,
            "os_version": os_version,
            "server_rss_mb": server_rss_mb

        })

    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
    


# benchmark accuracy code
# @csrf_exempt
# def benchmark_accuracy(request):
#     try:
#         if request.method != 'POST':
#             return JsonResponse({'error': 'POST required'}, status=400)

#         payload = json.loads(request.body.decode('utf-8'))
#         unique_directory = payload.get('dir')
#         from_ms = float(payload.get('from_ms', 0))
#         to_ms = float(payload.get('to_ms', 0))
#         shown = payload.get('shown', {})  # {"8.3":[gid,...], "8.4":[...], ...}

#         if not unique_directory or to_ms <= from_ms:
#             return JsonResponse({'error': 'Missing/invalid parameters'}, status=400)

#         base_dir = os.path.join(settings.MEDIA_ROOT, 'csv', unique_directory)
#         activity_path = os.path.join(base_dir, "activity.csv")
#         if not os.path.exists(activity_path):
#             return JsonResponse({'error': 'activity.csv not found'}, status=404)

#         df = pd.read_csv(activity_path, header=None, names=['id','t'], dtype={'id': int, 't': float})
#         df = df[(df['t'] >= from_ms) & (df['t'] <= to_ms)]

#         gt_map = {str(t): set(map(int, grp['id'].tolist())) for t, grp in df.groupby('t')}
#         sh_map = {str(float(t)): set(map(int, gids)) for t, gids in shown.items()}
#         times = set(gt_map.keys()) | set(sh_map.keys())

#         tp = fp = fn = exact_hits = 0
#         total_bins = 0
#         for t in times:
#             gt = gt_map.get(t, set())
#             sh = sh_map.get(t, set())
#             total_bins += 1
#             if gt == sh: exact_hits += 1
#             tp += len(gt & sh)
#             fp += len(sh - gt)
#             fn += len(gt - sh)

#         precision = tp / (tp + fp) if (tp + fp) else 1.0
#         recall    = tp / (tp + fn) if (tp + fn) else 1.0
#         exact     = exact_hits / total_bins if total_bins else 1.0

#         return JsonResponse({
#             'from_ms': from_ms, 'to_ms': to_ms,
#             'precision': precision, 'recall': recall, 'exact_match': exact,
#             'tp': tp, 'fp': fp, 'fn': fn, 'bins': total_bins
#         })
#     except Exception as e:
#         return JsonResponse({'error': str(e)}, status=500)
   



 

PART_RE = re.compile(r"\.part(\d+)$")
def _existing_indices(base_dir, fname):
    # return {indices_found}, e.g. {0,1,2}
    have = set()
    prefix = os.path.join(base_dir, f"{fname}.part")
    for entry in os.scandir(base_dir):
        if not entry.is_file():
            continue
        name = entry.path
        if not name.startswith(prefix):
            continue
        m = PART_RE.search(name)
        if m:
            have.add(int(m.group(1)))
    return have

def _assemble_if_complete(base_dir, fname, total, filetype):
    """Try to assemble if either 0-based or 1-based set is complete.
       Returns (assembled_bool, response_dict_or_None)."""
    # detect which scheme we’re on using the current file list
    have = _existing_indices(base_dir, fname)

    # candidate schemes
    zero = set(range(total))              # 0..N-1
    one  = set(range(1, total + 1))       # 1..N

    # figure out missing for both
    miss_zero = sorted(list(zero - have))
    miss_one  = sorted(list(one  - have))

    # Prefer the scheme with fewer missing (ties prefer zero-based)
    use_zero = (len(miss_zero) <= len(miss_one))
    scheme_missing = miss_zero if use_zero else miss_one

    if scheme_missing:
        # Not complete yet
        missing_paths = [
            os.path.join(base_dir, f"{fname}.part{i}") for i in scheme_missing
        ]
        return False, {'status': 'part-received', 'missing': missing_paths[:50]}

    # --- COMPLETE → assemble atomically ---
    parts = [os.path.join(base_dir, f"{fname}.part{i}") for i in (zero if use_zero else one)]
    final_path = os.path.join(base_dir, fname)
    assembling = final_path + ".assembling"

    with open(assembling, 'wb') as out_f:
        for p in parts:
            with open(p, 'rb') as in_f:
                shutil.copyfileobj(in_f, out_f, length=1024 * 1024)
        out_f.flush()
        os.fsync(out_f.fileno())
    os.replace(assembling, final_path)

    # cleanup
    for p in parts:
        try: os.remove(p)
        except FileNotFoundError: pass

    # post-process
    if filetype == 'csv':
        file_type = detect_file_type(final_path)
        if file_type == 'network':
            process_network_csv(final_path)
        elif file_type == 'activity':
            os.replace(final_path, os.path.join(base_dir, 'activity.csv'))
    elif filetype in ('hdf5', 'h5'):
        process_hdf5_file(final_path)

    return True, {'status': 'success', 'path': final_path}

@csrf_exempt
def upload_and_save_Network_file(request):
    try:
        if request.method != 'POST' or 'file' not in request.FILES:
            return JsonResponse({'error': 'POST with file required'}, status=400)

        uploaded_file = request.FILES['file']
        chunk_index   = request.POST.get('chunkIndex')
        total_chunks  = request.POST.get('totalChunks')
        unique_dir    = request.POST.get('uniqueDirectory')
        ext           = (request.POST.get('fileType') or '').lower()

        if not all([chunk_index, total_chunks, unique_dir, ext]):
            return JsonResponse({'error': 'Missing parameters'}, status=400)

        try:
            chunk_index  = int(chunk_index)
            total_chunks = int(total_chunks)
            if total_chunks <= 0: raise ValueError
        except ValueError:
            return JsonResponse({'error': 'Invalid chunkIndex/totalChunks'}, status=400)

        base_dir = os.path.join(settings.MEDIA_ROOT, 'csv', unique_dir)
        os.makedirs(base_dir, exist_ok=True)

        # Save this chunk atomically
        part_path = os.path.join(base_dir, f"{uploaded_file.name}.part{chunk_index}")
        tmp_path  = part_path + ".tmp"
        with open(tmp_path, 'wb') as f:
            for ch in uploaded_file.chunks():
                f.write(ch)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, part_path)

        # Try assemble immediately (don’t wait for "last")
        assembled, payload = _assemble_if_complete(base_dir, uploaded_file.name, total_chunks, ext)
        status_code = 200 if assembled or payload.get('status') == 'part-received' else 409
        return JsonResponse(payload, status=status_code)

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

def detect_file_type(file_path):
    """ Detects if the file is an activity (2 columns) or network (4 columns) file. """
    with open(file_path, 'r') as csv_file:
        reader = csv.reader(csv_file)
        for row in reader:
            if len(row) == 2:
                return 'activity'
            elif len(row) == 4 or len(row) == 5:
                return 'network'
    return 'unknown'



def process_network_csv(file_path):
    json_directory = os.path.dirname(file_path)

    json_path = os.path.join(json_directory, f"network.json")

   # Read the CSV and write to JSON
    with open(file_path, 'r') as csv_file, open(json_path, 'w') as json_file:
        json_data = []
        csv_reader = csv.reader(csv_file)  # Use csv.reader to avoid treating the first row as a header

        first_row = True

        for row in csv_reader:
            try:
                # ---- NEW: skip header if first row is non-numeric ----
                if first_row:
                    first_row = False
                    try:
                        int(row[0])
                        float(row[1])
                        float(row[2])
                        float(row[3])
                    except ValueError:
                        print("Header detected → skipping first row")
                        continue
                # -----------------------------------------------------

                # Ensure the row has at least 4 values
                if len(row) == 5:
                    json_data.append({
                        'id': int(row[0]),
                        'x': float(row[1]),
                        'y': float(row[2]),
                        'z': float(row[3]),
                        # Uncomment if the `type` column is present in the data
                        'cell_type': int(row[4]),
                    })
                elif len(row) == 4:
                    json_data.append({
                        'id': int(row[0]),
                        'x': float(row[1]),
                        'y': float(row[2]),
                        'z': float(row[3]),
                    })
                

            except (ValueError, IndexError) as e:
                print(f"Error processing row: {row} - {e}")

    # Write all data to JSON in a single valid structure
    with open(json_path, 'w') as json_file:
        json.dump(json_data, json_file)
        # json.dump(json_data, json_file, indent=4)   ## for valid json structure use of indent

    # Delete the original CSV file after processing
    try:
        os.remove(file_path)
    except OSError as e:
        print(f"Error deleting file {file_path}: {e}")


def process_hdf5_file(file_path):
    json_directory = os.path.dirname(file_path)
    network_json_path = os.path.join(json_directory, "network.json")
    activity_csv_path = os.path.join(json_directory, "activity.csv")

    with h5py.File(file_path, 'r') as hdf_file:
        # Process the 'network' dataset
        if 'network' in hdf_file:
            network_data = hdf_file['network'][:]

            network_json = []

            # ---- SAME FUNCTIONALITY AS process_network_csv: handle 4 or 5 columns ----
            if network_data.ndim == 2 and network_data.shape[1] == 5:
                for record in network_data:
                    try:
                        network_json.append({
                            'id': int(record[0]),
                            'x': float(record[1]),
                            'y': float(record[2]),
                            'z': float(record[3]),
                            'cell_type': int(record[4]),
                        })
                    except (ValueError, IndexError) as e:
                        print(f"Error processing network record: {record} - {e}")

            elif network_data.ndim == 2 and network_data.shape[1] == 4:
                for record in network_data:
                    try:
                        network_json.append({
                            'id': int(record[0]),
                            'x': float(record[1]),
                            'y': float(record[2]),
                            'z': float(record[3])
                        })
                    except (ValueError, IndexError) as e:
                        print(f"Error processing network record: {record} - {e}")

            else:
                print(f"Dataset 'network' does not have 4 or 5 columns as expected. Found shape: {network_data.shape}")

            # Save network JSON (only if we parsed something)
            if len(network_json) > 0:
                with open(network_json_path, 'w') as json_file:
                    json.dump(network_json, json_file)
        else:
            print("Dataset 'network' not found in HDF5 file.")

        # Process the 'spikes' or 'activity' dataset
        if 'spikes' in hdf_file or 'activity' in hdf_file:
            dataset_name = 'spikes' if 'spikes' in hdf_file else 'activity'
            spikes_data = hdf_file[dataset_name][:]

            if spikes_data.shape[1] == 2:
                # Round second column (index 1)
                spikes_data[:, 1] = np.round(spikes_data[:, 1], decimals=1)  # or change decimals=X as needed
                df = pd.DataFrame(spikes_data)
                df.to_csv(activity_csv_path, index=False, header=False)
            else:
                print(f"Dataset '{dataset_name}' does not have 2 columns as expected.")
        else:
            print("Neither 'spikes' nor 'activity' dataset found in HDF5 file.")

################### SONATA Implemenation #####################

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

def _detect_node_types_csv(csv_path: str) -> bool:
    # supports comma or whitespace separated
    try:
        df = pd.read_csv(csv_path)
        if "node_type_id" in df.columns and "ei" in df.columns:
            return True
    except Exception:
        pass
    try:
        df = pd.read_csv(csv_path, sep=r"\s+", engine="python")
        return ("node_type_id" in df.columns and "ei" in df.columns)
    except Exception:
        return False

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
        chunk_index = int(request.POST.get("chunkIndex", 0))
        total_chunks = int(request.POST.get("totalChunks", 1))
        original_name = request.POST.get("originalName") or (chunk.name if chunk else "")

        if not chunk or not unique_directory:
            return JsonResponse({"error": "Missing file or uniqueDirectory"}, status=400)

        base_dir = os.path.join(settings.MEDIA_ROOT, "csv", unique_directory)
        os.makedirs(base_dir, exist_ok=True)

        safe = _safe_name(original_name)

        # store as parts (order independent)
        parts_dir = os.path.join(base_dir, f"parts_{safe}")
        os.makedirs(parts_dir, exist_ok=True)

        part_path = os.path.join(parts_dir, f"part_{chunk_index:08d}.bin")
        with open(part_path, "wb") as f:
            for piece in chunk.chunks():
                f.write(piece)

        expected = [os.path.join(parts_dir, f"part_{i:08d}.bin") for i in range(total_chunks)]
        if not all(os.path.exists(p) for p in expected):
            return JsonResponse({"ok": True, "assembled": False})

        # assemble to temp file
        tmp_path = os.path.join(base_dir, f"__tmp__{safe}")
        with open(tmp_path, "wb") as out:
            for p in expected:
                with open(p, "rb") as inp:
                    shutil.copyfileobj(inp, out, length=1024 * 1024)

        # cleanup parts
        for p in expected:
            os.remove(p)
        os.rmdir(parts_dir)

        # classify by content and rename canonically
        lower = safe.lower()
        if lower.endswith((".h5", ".hdf5")):
            role = _detect_h5_role(tmp_path)
            if role == "nodes":
                final = os.path.join(base_dir, "nodes.h5")
            elif role == "spikes":
                final = os.path.join(base_dir, "spikes.h5")
            else:
                os.remove(tmp_path)
                return JsonResponse({"error": f"Uploaded H5 is neither nodes nor spikes: {safe}"}, status=400)

            os.replace(tmp_path, final)
            return JsonResponse({"ok": True, "assembled": True, "saved_as": os.path.basename(final)})

        elif lower.endswith(".csv"):
            # detect node_types.csv
            if _detect_node_types_csv(tmp_path):
                final = os.path.join(base_dir, "internal_node_types.csv")
                os.replace(tmp_path, final)
                return JsonResponse({"ok": True, "assembled": True, "saved_as": os.path.basename(final)})
            else:
                # keep it but don't block
                final = os.path.join(base_dir, safe)
                os.replace(tmp_path, final)
                return JsonResponse({"ok": True, "assembled": True, "saved_as": os.path.basename(final)})

        else:
            # save other files (not needed for NCV)
            final = os.path.join(base_dir, safe)
            os.replace(tmp_path, final)
            return JsonResponse({"ok": True, "assembled": True, "saved_as": os.path.basename(final)})

    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
    
def pick_population(names):
    if not names:
        return None
    lower = {n.lower(): n for n in names}
    return lower.get("ca1", names[0])

def _read_node_types_csv_any_delim(csv_path: str) -> pd.DataFrame:
    """
    Reads SONATA node_types CSV that may be comma-separated OR whitespace-separated.
    Must contain columns: node_type_id, ei
    """
    # Try comma separated
    try:
        df = pd.read_csv(csv_path)
        if "node_type_id" in df.columns and "ei" in df.columns:
            return df
    except Exception:
        pass

    # Fallback: whitespace-separated
    df = pd.read_csv(csv_path, sep=r"\s+", engine="python")
    return df


def sonata_nodes_to_network_json(nodes_h5_path, out_dir, preferred_pop=None):
    """
    SONATA nodes.h5 -> NCV network.json

    Coordinates:
      - nodes/<pop>/x,y,z
      - OR nodes/<pop>/positions (Nx3)
      - OR nodes/<pop>/<group_id>/positions using node_group_id + node_group_index

    Cell types:
      - If internal_node_types.csv exists and has (node_type_id, ei):
            ei == 'e' -> cell_type = 0
            ei == 'i' -> cell_type = 1
      - Otherwise: DEFAULT ALL to excitatory (cell_type = 0)
        (NO heuristic guessing)
    """
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "network.json")

    def pick_population(names):
        if not names:
            return None
        if preferred_pop:
            lower = {n.lower(): n for n in names}
            for p in preferred_pop:
                if p.lower() in lower:
                    return lower[p.lower()]
        return names[0]

    # --- OPTIONAL E/I mapping from CSV ---
    type_map = {}
    node_types_csv = os.path.join(os.path.dirname(nodes_h5_path), "internal_node_types.csv")
    if os.path.exists(node_types_csv):
        try:
            df = _read_node_types_csv_any_delim(node_types_csv)
            if "node_type_id" in df.columns and "ei" in df.columns:
                for _, row in df.iterrows():
                    try:
                        nid = int(row["node_type_id"])
                        ei = str(row["ei"]).strip().lower()
                        if ei == "e":
                            type_map[nid] = 0
                        elif ei == "i":
                            type_map[nid] = 1
                    except Exception:
                        pass
        except Exception:
            # If CSV fails to parse, just ignore and default to excitatory
            type_map = {}

    with h5py.File(nodes_h5_path, "r") as f:
        if "nodes" not in f:
            raise ValueError("nodes.h5 missing top-level group 'nodes'")

        pop = pick_population(list(f["nodes"].keys()))
        if pop is None:
            raise ValueError("No population found under /nodes")

        popg = f["nodes"][pop]

        node_id = popg["node_id"][:]
        node_type_id = popg["node_type_id"][:] if "node_type_id" in popg else None
        node_group_id = popg["node_group_id"][:] if "node_group_id" in popg else None
        node_group_index = popg["node_group_index"][:] if "node_group_index" in popg else None

        n = len(node_id)

        # ---- COORDINATES ----
        if all(k in popg for k in ("x", "y", "z")):
            x = popg["x"][:]
            y = popg["y"][:]
            z = popg["z"][:]

        elif "positions" in popg:
            pos = popg["positions"][:]
            if pos.ndim != 2 or pos.shape[1] < 3:
                raise ValueError(f"nodes/{pop}/positions has wrong shape: {pos.shape}")
            x, y, z = pos[:, 0], pos[:, 1], pos[:, 2]

        else:
            # subgroup storage: nodes/<pop>/<group_id>/positions
            if node_group_id is None or node_group_index is None:
                raise ValueError(
                    f"Could not find coordinates for nodes/{pop}. "
                    f"Expected x/y/z or positions Nx3 OR node_group_id & node_group_index."
                )

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
                    raise ValueError(
                        f"Could not find coordinates in nodes/{pop}/{gid_str}. "
                        f"Expected positions or x/y/z."
                    )

                mask = (node_group_id == gid)
                idxs = node_group_index[mask].astype(np.int64)

                if idxs.size == 0:
                    continue
                if idxs.min() < 0 or idxs.max() >= len(gx):
                    raise ValueError(
                        f"node_group_index out of range for group {gid_str}: "
                        f"min={idxs.min()}, max={idxs.max()}, group_len={len(gx)}"
                    )

                x[mask] = gx[idxs]
                y[mask] = gy[idxs]
                z[mask] = gz[idxs]

        if not np.isfinite(x).all() or not np.isfinite(y).all() or not np.isfinite(z).all():
            raise ValueError("Coordinates contain NaN/Inf values.")

        # ---- WRITE network.json ----
        network = []
        for i in range(n):
            rec = {
                "id": int(node_id[i]),
                "x": float(x[i]),
                "y": float(y[i]),
                "z": float(z[i]),
            }

            # Default: excitatory
            ct = 0

            # If node_types CSV mapping exists, apply it (unknown -> excitatory)
            if node_type_id is not None and type_map:
                raw = int(node_type_id[i])
                ct = int(type_map.get(raw, 0))

            rec["cell_type"] = ct
            network.append(rec)

    with open(out_path, "w") as fp:
        json.dump(network, fp)

    return out_path



def sonata_spikes_to_activity_csv(spikes_h5_path, out_dir):
    out_path = os.path.join(out_dir, "activity.csv")

    with h5py.File(spikes_h5_path, "r") as f:
        if "spikes" not in f:
            raise ValueError("spikes.h5 missing top-level group 'spikes'")

        pop = pick_population(list(f["spikes"].keys()))
        g = f["spikes"][pop]

        # common names
        if "timestamps" in g:
            times = np.array(g["timestamps"][:], dtype=np.float64)
        elif "times" in g:
            times = np.array(g["times"][:], dtype=np.float64)
        elif "time" in g:
            times = np.array(g["time"][:], dtype=np.float64)
        else:
            raise ValueError(f"spikes/{pop} missing timestamps dataset")

        if "node_ids" in g:
            node_ids = np.array(g["node_ids"][:], dtype=np.int64)
        elif "node_id" in g:
            node_ids = np.array(g["node_id"][:], dtype=np.int64)
        else:
            raise ValueError(f"spikes/{pop} missing node_ids dataset")

    # heuristic seconds->ms
    if len(times) and times.max() < 1000.0:
        times = times * 1000.0

    # times = np.round(times, 1)
    times = np.round(times, 3)

    pd.DataFrame({"id": node_ids, "t": times}).to_csv(out_path, index=False, header=False)
    return out_path


@csrf_exempt
def fetch_user_sonata_data(request):
    try:
        unique_directory = request.GET.get("dir")
        if not unique_directory:
            return JsonResponse({"error": "Missing directory identifier"}, status=400)

        out_dir = os.path.join(settings.MEDIA_ROOT, "csv", unique_directory)
        if not os.path.exists(out_dir):
            return JsonResponse({"error": "Directory not found"}, status=404)

        nodes_path = os.path.join(out_dir, "nodes.h5")
        spikes_path = os.path.join(out_dir, "spikes.h5")
        if not os.path.exists(nodes_path) or not os.path.exists(spikes_path):
            return JsonResponse({"error": "nodes.h5 and spikes.h5 are required"}, status=400)

        # 1) Convert SONATA -> NCV files
        network_json_path = os.path.join(out_dir, "network.json")
        activity_csv_path = os.path.join(out_dir, "activity.csv")

        # Always regenerate derived files
        if os.path.exists(network_json_path):
            os.remove(network_json_path)
        if os.path.exists(activity_csv_path):
            os.remove(activity_csv_path)

        # remove old chunks
        for fn in os.listdir(out_dir):
            if fn.startswith("activity_chunk_") and fn.endswith(".json"):
                os.remove(os.path.join(out_dir, fn))

        # ---- Determine whether a valid node_types CSV exists (and likely usable) ----
        # upload endpoint stores a detected one as internal_node_types.csv
        node_types_csv = os.path.join(out_dir, "internal_node_types.csv")
        used_cell_types_csv = False
        if os.path.exists(node_types_csv):
            try:
                df = _read_node_types_csv_any_delim(node_types_csv)
                if "node_type_id" in df.columns and "ei" in df.columns:
                    # "used" if it contains at least one E or I mapping
                    eis = set(str(v).strip().lower() for v in df["ei"].dropna().tolist())
                    used_cell_types_csv = ("e" in eis) or ("i" in eis)
            except Exception:
                used_cell_types_csv = False

        # Generate network.json + activity.csv
        sonata_nodes_to_network_json(nodes_path, out_dir)
        sonata_spikes_to_activity_csv(spikes_path, out_dir)

        # 2) Load network.json for visualization
        with open(network_json_path, "r") as f:
            file_data = ujson.load(f)

        total_neurons = len(file_data)
        total_excitatory = 0
        total_inhibitory = 0

        # cell_type counts derived from network.json (source of truth)
        for neuro in file_data:
            ct = neuro.get("cell_type", 0)
            if ct == 0:
                total_excitatory += 1
            elif ct == 1:
                total_inhibitory += 1

        # 3) Chunk activity.csv and compute MFR_total + MFR_active
        lstresponse = {}
        flag_check = 0

        if os.path.exists(activity_csv_path):
            flag_check = 1
            lstresponse = chunk_activity_csv(
                activity_csv_path,
                out_dir,
                chunk_size_bytes=100 * 1024 * 1024,
                network_total_neurons=total_neurons,
            )

        data_list = [{
            "filename": "network.json",
            "fileData": file_data,
            "total_neurons": total_neurons,
            "total_excitatory": total_excitatory,
            "total_inhibitory": total_inhibitory,
            "json_directory": out_dir,
            "cell_type_mode": "csv" if used_cell_types_csv else "default_all_excitatory",
        }]

        response_data = {
            "files": data_list,
            "lstresponse": lstresponse,
            "total_size": (os.path.getsize(network_json_path) / (1024 * 1024)) if os.path.exists(network_json_path) else 0,
            "flag_check": flag_check,
            "used_cell_types_csv": used_cell_types_csv,   # ✅ NEW FLAG for UI
        }
        return JsonResponse(response_data, safe=False)

    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
    


def chunk_activity_csv(
    activity_csv_path,
    out_dir,
    chunk_size_bytes=100 * 1024 * 1024,
    network_total_neurons=None,
):
    """
    Produces activity_chunk_N.json and returns lstresponse dict.
    Adds:
      - MFR_total (normalized by total network neurons)
      - MFR_active (normalized by active neurons in chunk)
      - n_total, n_active, total_spikes, duration_ms
    """
    try:
        try:
            csv_data = pd.read_csv(activity_csv_path, header=None, names=["id", "t"], encoding="utf-8")
        except UnicodeDecodeError:
            csv_data = pd.read_csv(activity_csv_path, header=None, names=["id", "t"], encoding="latin1")

        # group by time
        data_dict = csv_data.groupby("t")["id"].agg(list).to_dict()

        chunk_number = 0
        first_last_keys = []
        chunk_mfr_list = []
        current_chunk_size = 0
        current_data_dict = {}

        # total neurons for MFR_total
        n_total = int(network_total_neurons) if network_total_neurons and int(network_total_neurons) > 0 else None

        def finalize_chunk(chunk_data, chunk_number):
            times_in_chunk = sorted(chunk_data.keys())
            t_min = float(times_in_chunk[0])
            t_max = float(times_in_chunk[-1])

            duration_ms = t_max - t_min
            total_time_sec = max(duration_ms / 1000.0, 1e-9)

            total_spikes = sum(len(v) for v in chunk_data.values())
            unique_neurons = set(gid for v in chunk_data.values() for gid in v)
            n_active = len(unique_neurons) or 1

            n_total_used = n_total if n_total is not None else n_active

            mfr_total = round((total_spikes / n_total_used) / total_time_sec, 2)
            mfr_active = round((total_spikes / n_active) / total_time_sec, 2)

            # save chunk json
            chunk_file_path = os.path.join(out_dir, f"activity_chunk_{chunk_number}.json")
            with open(chunk_file_path, "w") as f:
                ujson.dump(chunk_data, f)

            meta = {
                "chunk_number": chunk_number,
                "first_key": t_min,
                "last_key": t_max,
                "duration_ms": round(duration_ms, 1),
                "total_spikes": int(total_spikes),
                "n_total": int(n_total_used),
                "n_active": int(n_active),
                "MFR_total": mfr_total,
                "MFR_active": mfr_active,
            }
            return meta

        # IMPORTANT: ensure time sorted iteration
        for key in sorted(data_dict.keys()):
            values = data_dict[key]
            entry_size = len(ujson.dumps({key: values}))

            if current_chunk_size + entry_size > chunk_size_bytes and current_data_dict:
                meta = finalize_chunk(current_data_dict, chunk_number)

                chunk_mfr_list.append(meta)
                first_last_keys.append({
                    "chunk_number": chunk_number,
                    "first_key": meta["first_key"],
                    "last_key": meta["last_key"],
                })

                current_data_dict = {}
                current_chunk_size = 0
                chunk_number += 1

            current_data_dict[key] = values
            current_chunk_size += entry_size

        if current_data_dict:
            meta = finalize_chunk(current_data_dict, chunk_number)
            chunk_mfr_list.append(meta)
            first_last_keys.append({
                "chunk_number": chunk_number,
                "first_key": meta["first_key"],
                "last_key": meta["last_key"],
            })

        total_activity_files = chunk_number + 1

        return {
            "OUTPUT_FOLDER": out_dir,
            "total_lines": int(len(csv_data)),
            "total_activity_files": int(total_activity_files),
            "first_last_keys": first_last_keys,
            "chunk_mfr_list": chunk_mfr_list,
        }

    except Exception as e:
        raise RuntimeError(f"Error processing activity file: {str(e)}")




############################################################
@csrf_exempt
def fetch_user_network_data(request):
    try:
        unique_directory = request.GET.get('dir')
        if not unique_directory:
            return JsonResponse({'error': 'Missing directory identifier'}, status=400)

        json_directory = os.path.join(settings.MEDIA_ROOT, 'csv', unique_directory)
        if not os.path.exists(json_directory):
            return JsonResponse({'error': 'Directory not found'}, status=404)

        data_list = []
        lstresponse = []
        total_size = 0
        flag_check = 0

        
        network_file_path = os.path.join(json_directory, "network.json")

        if os.path.exists(network_file_path):
            with open(network_file_path, 'r') as f:
                file_data = ujson.load(f)

            total_excitatory = 0
            total_inhibitory = 0
            total_invalid = 0

            network_total_neurons = len(file_data)


            # ---- NEW: default ratio when cell_type missing ----
            excit_ratio = 90.909533 / 100.0
            target_excitatory = int(round(network_total_neurons * excit_ratio))
            # ---------------------------------------------------

            for i, neuro in enumerate(file_data):
                cell_type = neuro.get('cell_type', None)

                # ---- VALIDATION / DEFAULT ----
                if cell_type is None:
                    
                    if total_excitatory < target_excitatory:
                        total_excitatory += 1
                    else:
                        total_inhibitory += 1
                    continue
                # ------------------------------

                if cell_type == 0:
                    total_excitatory += 1
                elif cell_type == 1:
                    total_inhibitory += 1
                else:
                    print(f"Warning: neuron {i} unknown cell_type={cell_type}")
                    total_invalid += 1

            # print("excit:", total_excitatory)
            # print("inh:", total_inhibitory)
            # print("cell_type:", cell_type)
            
            
            data_list.append({
                'filename': "network.json",
                'fileData': file_data,
                'total_neurons': network_total_neurons,
                'total_excitatory': total_excitatory,
                'total_inhibitory': total_inhibitory,
                # 'total_invalid': total_invalid,
                'json_directory': json_directory,
                'cell_type':cell_type,
            })

            total_size += (os.path.getsize(network_file_path) / (1024 * 1024))


        activity_file_path = os.path.join(json_directory, "activity.csv")
        if os.path.exists(activity_file_path):
            flag_check = 1
            

            try:
                CHUNK_SIZE = 200 * 1024 * 1024 
                try:
                    csv_data = pd.read_csv(activity_file_path, header=None, names=['id', 't'], encoding='utf-8')
                except UnicodeDecodeError:

                    csv_data = pd.read_csv(activity_file_path, header=None, names=['id', 't'], encoding='latin1')

                data_dict = csv_data.groupby('t')['id'].agg(list).to_dict()

                chunk_number = 0
                first_last_keys = []
                chunk_mfr_list = []
                current_chunk_size = 0
                current_data_dict = {}

                for key in sorted(data_dict.keys()):
                    values = data_dict[key]

                    entry_size = len(ujson.dumps({key: values}))

                    if current_chunk_size + entry_size > CHUNK_SIZE and current_data_dict:
                        times_in_chunk = list(current_data_dict.keys())
                        
                        t_min = float(times_in_chunk[0])
                        
                        t_max = float(times_in_chunk[-1])
                        
                        total_time_sec = (t_max - t_min) / 1000.0
                        
                        total_spikes = sum(len(v) for v in current_data_dict.values())
                        
                        
                        # active neurons in this chunk (optional, keep if you want)
                        unique_neurons = set(gid for v in current_data_dict.values() for gid in v)
                        n_active = len(unique_neurons) or 1

                        # total neurons from network.json (this is what you want for dropdown)
                        n_total = network_total_neurons if network_total_neurons > 0 else n_active

                        mfr_total  = round((total_spikes / n_total) / total_time_sec, 2)
                        mfr_active = round((total_spikes / n_active) / total_time_sec, 2)

                        chunk_mfr_list.append({
                                "first_key": t_min,
                                "last_key": t_max,
                                "chunk_number": chunk_number,
                                "MFR_total": mfr_total,
                                "MFR_active": mfr_active,
                                "n_total": int(n_total),
                                "n_active": int(n_active),
                                "total_spikes": int(total_spikes),
                            })

                        first_last_keys.append({'chunk_number': chunk_number, 'first_key': t_min, 'last_key': t_max})

                        chunk_file_path = os.path.join(json_directory, f'activity_chunk_{chunk_number}.json')
                        with open(chunk_file_path, 'w') as f:
                            ujson.dump(current_data_dict, f)

                        current_data_dict = {}
                        current_chunk_size = 0
                        chunk_number += 1

                    current_data_dict[key] = values
                    current_chunk_size += entry_size

                if current_data_dict:
                    times_in_chunk = list(current_data_dict.keys())
                        
                    t_min = float(times_in_chunk[0])
                    
                    t_max = float(times_in_chunk[-1])
                    
                    total_time_sec = (t_max - t_min) / 1000.0
                    
                    total_spikes = sum(len(v) for v in current_data_dict.values())
                    
                    
                    # active neurons in this chunk (optional, keep if you want)
                    unique_neurons = set(gid for v in current_data_dict.values() for gid in v)
                    n_active = len(unique_neurons) or 1

                    # total neurons from network.json (this is what you want for dropdown)
                    n_total = network_total_neurons if network_total_neurons > 0 else n_active

                    mfr_total  = round((total_spikes / n_total) / total_time_sec, 2)
                    mfr_active = round((total_spikes / n_active) / total_time_sec, 2)

                    chunk_mfr_list.append({
                            "first_key": t_min,
                            "last_key": t_max,
                            "chunk_number": chunk_number,
                            "MFR_total": mfr_total,
                            "MFR_active": mfr_active,
                            "n_total": int(n_total),
                            "n_active": int(n_active),
                            "total_spikes": int(total_spikes),
                        })
                    first_last_keys.append({'chunk_number': chunk_number, 'first_key': t_min, 'last_key': t_max})

                    final_chunk_file_path = os.path.join(json_directory, f'activity_chunk_{chunk_number}.json')
                    with open(final_chunk_file_path, 'w') as f:
                        ujson.dump(current_data_dict, f)

                total_activity_files = chunk_number + 1
                lstresponse = {
                    'OUTPUT_FOLDER': json_directory,
                    'total_lines': len(csv_data),
                    'total_activity_files': total_activity_files,
                    'first_last_keys': first_last_keys,
                    'chunk_mfr_list': chunk_mfr_list
                }

            except Exception as e:
                return JsonResponse({'error': f'Error processing activity file: {str(e)}'}, status=500)

        response_data = {
            'files': data_list,
            'lstresponse': lstresponse,
            'total_size': total_size,
            'flag_check': flag_check
        }
        return JsonResponse(response_data, safe=False, content_type='application/json')

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)




# def get_chunk_data(request):

#     chunk_number = request.GET.get("chunk_number")  # Get chunk number from request
#     unique_directory = request.GET.get("dir")  # Get chunk number from request

#     if not chunk_number:
#         return JsonResponse({"error": "No chunk number provided"}, status=400)

#     chunk_file_path = os.path.join(settings.MEDIA_ROOT, 'csv', unique_directory)
#     unique_directory = os.path.join(settings.MEDIA_ROOT, 'csv', unique_directory)

#     activity_file_path = os.path.join(chunk_file_path,  f"activity_chunk_{chunk_number}.json")
#     try:
#         with open(activity_file_path, "r") as f:
#             chunk_data = ujson.load(f)
#     except Exception as e:
#         return JsonResponse({"error": f"Error loading activity.json: {str(e)}"}, status=500)



#     # Process GIDs from network.json
#     network_file_path = os.path.join(unique_directory, "network.json")
#     Gids_array = extract_ids_from_json(network_file_path)

#     gids_activity_indexes = get_activity_indexes(chunk_data, Gids_array)
#     # print("length gids:    ",len(gids_activity_indexes))

#     # Cache GIDs activity indexes
#     cache_file_path = os.path.join(chunk_file_path, 'gids_activity_indexes.json')
#     try:
#         with open(cache_file_path, 'w') as f:
#             ujson.dump(gids_activity_indexes, f)
#     except Exception as e:
#         return JsonResponse({"error": f"Error saving gids_activity_indexes.json: {str(e)}"}, status=500)


#     # Extract `t` values (time) and count spikes per time bin
#     try:

#         total_spikes = sum(len(activity_ids) for activity_ids in chunk_data.values())
#         # Generate visualization images
#         # raster_img = generate_raster_plot(chunk_data)
#         hist_img = generate_spike_histogram(chunk_data, chunk_number)
        
#         # in get_chunk_data(...) right before the final JsonResponse
#         hist = compute_hist_data(chunk_data, chunk_number, bins=100)

#        # Return both chunk data and GIDs activity indexes in a single response
#         return JsonResponse({
#             "chunk_data": chunk_data,
#             "total_spikes": total_spikes,  # Total spikes count
#             # "raster_plot": raster_img,
#             "histogram": hist_img,
#              "hist_data": hist,                     # NEW: JSON for interactive plot
#             "gids_activity_indexes": gids_activity_indexes
#         })

#     except Exception as e:
#         return JsonResponse({"error": f"Error generating histogram: {str(e)}"}, status=500)





def get_chunk_data(request):

    chunk_number = request.GET.get("chunk_number")  # Get chunk number from request
    unique_directory = request.GET.get("dir")  # Get chunk number from request

    if not chunk_number:
        return JsonResponse({"error": "No chunk number provided"}, status=400)

    chunk_file_path = os.path.join(settings.MEDIA_ROOT, 'csv', unique_directory)
    unique_directory = os.path.join(settings.MEDIA_ROOT, 'csv', unique_directory)

    activity_file_path = os.path.join(chunk_file_path,  f"activity_chunk_{chunk_number}.json")
    try:
        with open(activity_file_path, "r") as f:
            chunk_data = ujson.load(f)
    except Exception as e:
        return JsonResponse({"error": f"Error loading activity.json: {str(e)}"}, status=500)



    # Process GIDs from network.json
    network_file_path = os.path.join(unique_directory, "network.json")
    Gids_array = extract_ids_from_json(network_file_path)

    gids_activity_indexes = get_activity_indexes(chunk_data, Gids_array)
    # print("length gids:    ",len(gids_activity_indexes))


    # --- after you load Gids_array ---
    total_neurons = len(Gids_array)  # total neurons in the uploaded network

    

    # Cache GIDs activity indexes
    cache_file_path = os.path.join(chunk_file_path, 'gids_activity_indexes.json')
    try:
        with open(cache_file_path, 'w') as f:
            ujson.dump(gids_activity_indexes, f)
    except Exception as e:
        return JsonResponse({"error": f"Error saving gids_activity_indexes.json: {str(e)}"}, status=500)


    # Extract `t` values (time) and count spikes per time bin
    try:

        total_spikes = sum(len(activity_ids) for activity_ids in chunk_data.values())
        # Generate visualization images
        # raster_img = generate_raster_plot(chunk_data)
        
        # Pass total_neurons so UI MFR matches benchmark definition
        hist_img = generate_spike_histogram(chunk_data, chunk_number, color="white", total_neurons=total_neurons)

        
        # Interactive histogram JSON (includes MFR values)
        hist = compute_hist_data(chunk_data, chunk_number, bins=100, total_neurons=total_neurons)

       # Return both chunk data and GIDs activity indexes in a single response
        return JsonResponse({
            "chunk_data": chunk_data,
            "total_spikes": total_spikes,  # Total spikes count
            # "raster_plot": raster_img,
            "histogram": hist_img,
             "hist_data": hist,                     # NEW: JSON for interactive plot
            "gids_activity_indexes": gids_activity_indexes,
            "total_neurons": total_neurons,  #  expose to frontend
        })

    except Exception as e:
        return JsonResponse({"error": f"Error generating histogram: {str(e)}"}, status=500)




def generate_raster_plot(chunk_data):
    try:
        if not chunk_data:
            return "Error: No data available for plotting."

        spike_times = []
        for t_str, gids in chunk_data.items():
            t = float(t_str)
            for gid in gids:
                spike_times.append((t, gid))

        # Convert to DataFrame
        raster_df = pd.DataFrame(spike_times, columns=["t", "gid"])

        # Create raster plot
        plt.figure(figsize=(12, 6))
        plt.scatter(raster_df["t"], raster_df["gid"], s=2, color="darkred", alpha=0.7)
        plt.title("Raster Plot of Spike Activity")
        plt.xlabel("Time (ms)")
        plt.ylabel("Neuron GID")
        plt.grid(True, linestyle="--", alpha=0.5)
        plt.tight_layout()
        plt.show()

        # Save as High-Resolution Image
        img_buffer = io.BytesIO()
        plt.savefig(img_buffer, format="png", bbox_inches="tight", dpi=900)
        img_buffer.seek(0)
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode("utf-8")




        return img_base64

    except Exception as e:
        return f"Error generating raster plot: {str(e)}"

# def compute_hist_data(chunk_data, chunk_number, bins=100, total_neurons=None):
#     # flatten (t,gids)
#     times = []
#     times_gids = []  # list of (t, set(gids)) per unique t
#     gid_set = set()
#     for t_str, gids in chunk_data.items():
#         t = float(t_str)
#         gids_set = set(gids)
#         gid_set |= gids_set
#         times.extend([t] * len(gids))
#         times_gids.append((t, gids_set))

#     if not times:
#         return {"bin_edges": [], "bin_centers": [], "counts": [], "sd_poisson": [], "sd_binomial": [], "t_min": 0, "t_max": 0, "mfr": 0}

#     t_min = 0.0 if str(chunk_number) == "0" else min(times)
#     t_max = max(times)
#     edges = np.linspace(t_min, t_max, bins + 1)
#     counts, _ = np.histogram(times, bins=edges)

#     # Poisson SD
#     sd_poisson = np.sqrt(counts)

#     # Binomial SD (unique neurons per bin)
#     N = total_neurons if total_neurons is not None else (len(gid_set) or 1)
#     uniq_per_bin = np.zeros(bins, dtype=int)
#     # bucket times_gids by bin (fast pass)
#     for t, gids in times_gids:
#         if t < t_min or t >= t_max: 
#             continue
#         i = np.searchsorted(edges, t, side='right') - 1
#         if 0 <= i < bins:
#             # accumulate per-bin unique neurons
#             # WARNING: for huge data this set-per-bin can be heavy;
#             # replace with a counting bloom or skip if not needed.
#             pass
#     # Memory-light alternative: approximate k with counts capped at 1 per neuron per bin
#     # If you can compute uniqs, do:
#     # p = uniq_per_bin / float(N)
#     # sd_binomial = np.sqrt(N * p * (1.0 - p))
#     sd_binomial = None  # optional

#     total_spikes = len(times)
#     total_time_sec = max((t_max - t_min) / 1000.0, 1e-9)
#     mfr = (total_spikes / max(N, 1)) / total_time_sec

#     return {
#         "bin_edges": edges.tolist(),
#         "bin_centers": ((edges[:-1] + edges[1:]) / 2.0).tolist(),
#         "counts": counts.tolist(),
#         "sd_poisson": sd_poisson.tolist(),
#         "sd_binomial": sd_binomial.tolist() if sd_binomial is not None else [],
#         "t_min": float(t_min),
#         "t_max": float(t_max),
#         "mfr": float(mfr),
#     }
     




def compute_hist_data(chunk_data, chunk_number, bins=100, total_neurons=None):
    # flatten all spikes
    all_times = []
    active_neurons = set()

    for t_str, gids in chunk_data.items():
        t = float(t_str)
        all_times.extend([t] * len(gids))
        active_neurons.update(gids)

    if not all_times:
        return {"bin_edges": [], "bin_centers": [], "counts": [], "sd_poisson": [],
                "t_min": 0.0, "t_max": 0.0, "mfr_total": 0.0, "mfr_active": 0.0,
                "n_total": int(total_neurons or 0), "n_active": 0, "total_spikes": 0}


    t_min, t_max = chunk_time_bounds_from_keys(chunk_data)


    edges = np.linspace(t_min, t_max, bins + 1)
    counts, _ = np.histogram(all_times, bins=edges)
    sd_poisson = np.sqrt(counts)

    total_spikes = len(all_times)
    dur_s = max((t_max - t_min) / 1000.0, 1e-9)

    n_active = max(len(active_neurons), 1)
    n_total = int(total_neurons) if total_neurons and int(total_neurons) > 0 else n_active

    mfr_total = (total_spikes / n_total) / dur_s
    mfr_active = (total_spikes / n_active) / dur_s

    return {
        "bin_edges": edges.tolist(),
        "bin_centers": ((edges[:-1] + edges[1:]) / 2.0).tolist(),
        "counts": counts.tolist(),
        "sd_poisson": sd_poisson.tolist(),
        "t_min": t_min,
        "t_max": t_max,
        "total_spikes": int(total_spikes),
        "n_total": int(n_total),
        "n_active": int(n_active),
        "mfr_total": float(mfr_total),
        "mfr_active": float(mfr_active),
    }

     


     
# def generate_spike_histogram(chunk_data, chunk_number, bins=100, color="white"):
#     try:
#         if not chunk_data or not isinstance(chunk_data, dict):
#             return "Error: No data available for plotting."

#         # Convert spike times and collect active neurons
#         all_spike_times = []
#         active_neurons = set()
#         for t_str, gids in chunk_data.items():
#             t = float(t_str)
#             all_spike_times.extend([t] * len(gids))
#             active_neurons.update(gids)

#         if not all_spike_times:
#             return "Error: No spike times in chunk data."

#         # Sort times to get actual range
#         min_time = min(all_spike_times)
#         max_time = max(all_spike_times)

#         # Set time range based on chunk number
#         if str(chunk_number) == "0":
#             t_min = 0
#         else:
#             t_min = min_time

#         t_max = max_time

#         # Compute histogram
#         bin_edges = np.linspace(t_min, t_max, bins + 1)
#         spike_counts, _ = np.histogram(all_spike_times, bins=bin_edges)

#         # Compute per-bin standard deviation
#         std_per_bin = []
#         for i in range(len(bin_edges) - 1):
#             bin_start, bin_end = bin_edges[i], bin_edges[i + 1]
#             bin_spikes = [t for t in all_spike_times if bin_start <= t < bin_end]
#             if len(bin_spikes) > 1:
#                 std_per_bin.append(np.std(bin_spikes))
#             else:
#                 std_per_bin.append(0.0)  # No variation if ≤1 spike

#         # Compute Mean Firing Rate (MFR)
#         total_spikes = len(all_spike_times)
#         total_neurons = len(active_neurons)
#         total_time_sec = (t_max - t_min) / 1000.0
#         mfr = (total_spikes / total_neurons) / total_time_sec if total_neurons > 0 and total_time_sec > 0 else 0

#         # Plot histogram
#         fig, ax = plt.subplots(figsize=(12, 6), dpi=300)
#         fig.patch.set_facecolor("#33373d")
#         ax.set_facecolor("#33373d")

#         bars = ax.bar(bin_edges[:-1], spike_counts, width=np.diff(bin_edges), 
#                       color=color, alpha=0.7, edgecolor="black", align="edge")

#         # Annotate each bar with its std
#         for bar, std_val in zip(bars, std_per_bin):
#             height = bar.get_height()
#             ax.text(bar.get_x() + bar.get_width() / 2, height + 0.5,
#                     f"{std_val:.1f}", ha="center", va="bottom", fontsize=6, color="yellow", rotation=90)

#         # Legend info
#         legend_labels = {
#             "# Max Spike": max(spike_counts),
#             "# Min Spike": min(spike_counts),
#             "# Spikes": total_spikes,
#             "# Neurons": total_neurons,
#             "# Min Time (ms)": round(t_min, 1),
#             "# Max Time (ms)": round(t_max, 1),
#         }
#         legend_text = "\n".join([f"{key}: {value}" for key, value in legend_labels.items()])
#         plt.gcf().text(0.80, 0.79, legend_text, fontsize=8, 
#                        bbox=dict(facecolor='white', alpha=0.5), color='black')

#         ax.set_xlim(t_min, t_max)
#         ax.set_xlabel("Time (ms)", fontsize=16, fontweight="bold", color="white")
#         ax.set_ylabel("Number of Firing Neurons", fontsize=16, fontweight="bold", color="white")
#         ax.set_title(f"Chunk {chunk_number} - MFR: {mfr:.2f} Hz", fontsize=18, fontweight="bold", color="white")

#         ax.tick_params(axis='x', colors='white')
#         ax.tick_params(axis='y', colors='white')
#         ax.xaxis.set_major_locator(ticker.MaxNLocator(nbins=10))
#         ax.grid(True, linestyle="--", alpha=0.4)

#         for label in ax.get_xticklabels() + ax.get_yticklabels():
#             label.set_color("white")

#         # Convert to base64 image
#         img_buffer = io.BytesIO()
#         plt.savefig(img_buffer, format="png", bbox_inches="tight", dpi=300, facecolor=fig.get_facecolor())
#         img_buffer.seek(0)
#         img_base64 = base64.b64encode(img_buffer.getvalue()).decode("utf-8")
#         plt.close()

#         return img_base64

#     except Exception as e:
#         return f"Error generating spike histogram: {str(e)}"



def generate_spike_histogram(chunk_data, chunk_number,  color="white", total_neurons=None):
    try:
        if not chunk_data or not isinstance(chunk_data, dict):
            return "Error: No data available for plotting."

        all_spike_times = []
        active_neurons = set()

        for t_str, gids in chunk_data.items():
            t = float(t_str)
            all_spike_times.extend([t] * len(gids))
            active_neurons.update(gids)

        if not all_spike_times:
            return "Error: No spike times in chunk data."

        min_time = min(all_spike_times)
        max_time = max(all_spike_times)

        t_min, t_max = chunk_time_bounds_from_keys(chunk_data)


        bin_edges = np.linspace(np.floor(t_min), np.ceil(t_max), np.ceil(t_max)-np.floor(t_min)+1)
        spike_counts, _ = np.histogram(all_spike_times, bins=bin_edges)

        # Std per bin (your existing approach)
        std_per_bin = []
        for i in range(len(bin_edges) - 1):
            bin_start, bin_end = bin_edges[i], bin_edges[i + 1]
            bin_spikes = [t for t in all_spike_times if bin_start <= t < bin_end]
            std_per_bin.append(float(np.std(bin_spikes)) if len(bin_spikes) > 1 else 0.0)

        total_spikes = len(all_spike_times)
        total_time_sec = max((t_max - t_min) / 1000.0, 1e-9)

        n_active = len(active_neurons) or 1
        n_total = int(total_neurons) if (total_neurons is not None and int(total_neurons) > 0) else n_active

        # Two MFRs:
        mfr_total = (total_spikes / n_total) / total_time_sec   # matches benchmark definition
        mfr_active = (total_spikes / n_active) / total_time_sec # old behavior

        # Plot
        fig, ax = plt.subplots(figsize=(12, 6), dpi=300)
        fig.patch.set_facecolor("#33373d")
        ax.set_facecolor("#33373d")

        bars = ax.bar(
            bin_edges[:-1], spike_counts, width=np.diff(bin_edges),
            color=color, alpha=0.7, edgecolor="black", align="edge"
        )

        for bar, std_val in zip(bars, std_per_bin):
            height = bar.get_height()
            ax.text(
                bar.get_x() + bar.get_width() / 2, height + 0.5,
                f"{std_val:.1f}", ha="center", va="bottom",
                fontsize=6, color="yellow", rotation=90
            )

        legend_labels = {
            "# Max Spike": int(max(spike_counts)) if len(spike_counts) else 0,
            "# Min Spike": int(min(spike_counts)) if len(spike_counts) else 0,
            "# Spikes": int(total_spikes),
            "# Active Neurons": int(n_active),
            "# Total Neurons": int(n_total),
            "# Min Time (ms)": float(t_min),
            "# Max Time (ms)": float(t_max),
            "MFR (total-norm) Hz": float(mfr_total),
            "MFR (active-norm) Hz": float(mfr_active),
        }
        legend_text = "\n".join([f"{k}: {v}" for k, v in legend_labels.items()])
        plt.gcf().text(0.80, 0.79, legend_text, fontsize=8,
                       bbox=dict(facecolor='white', alpha=0.5), color='black')

        ax.set_xlim(t_min, t_max)
        ax.set_xlabel("Time (ms)", fontsize=16, fontweight="bold", color="white")
        ax.set_ylabel("Number of Firing Neurons", fontsize=16, fontweight="bold", color="white")

        # IMPORTANT: title now shows total-normalized MFR (matches benchmark)
        ax.set_title(f"Chunk {chunk_number} - MFR: {mfr_total:.2f} Hz", fontsize=18, fontweight="bold", color="white")

        ax.tick_params(axis='x', colors='white')
        ax.tick_params(axis='y', colors='white')
        ax.xaxis.set_major_locator(ticker.MaxNLocator(nbins=10))
        ax.grid(True, linestyle="--", alpha=0.4)

        for label in ax.get_xticklabels() + ax.get_yticklabels():
            label.set_color("white")

        img_buffer = io.BytesIO()
        plt.savefig(img_buffer, format="png", bbox_inches="tight", dpi=300, facecolor=fig.get_facecolor())
        img_buffer.seek(0)
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode("utf-8")
        plt.close()

        return img_base64

    except Exception as e:
        return f"Error generating spike histogram: {str(e)}"


def chunk_time_bounds_from_keys(chunk_data):
    # chunk_data keys are your time bins (strings)
    ts = sorted(float(k) for k in chunk_data.keys())
    if not ts:
        return 0.0, 0.0
    return ts[0], ts[-1]



def generate_network_graph(network_data):
    try:
        if not network_data:
            print("No network data available.")
            return None
        # Create a directed graph
        G = nx.DiGraph()

        # Add edges (connections)
        for pre_neuron, post_neurons in network_data.items():
            for post_neuron in post_neurons:
                G.add_edge(pre_neuron, post_neuron)

        # Draw the network
        plt.figure(figsize=(8, 6))
        pos = nx.spring_layout(G, seed=42)  # Layout for better visualization
        nx.draw(G, pos, node_size=10, edge_color="gray", width=0.5)
        plt.title("Neuron Connectivity Graph")

        # Convert to Base64
        img_buffer = io.BytesIO()
        plt.savefig(img_buffer, format="png")
        img_buffer.seek(0)
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode("utf-8")

        plt.close()  # Free memory
        return img_base64
    except Exception as e:
        return str(e)

@csrf_exempt
def get_activity_data_by_file_name(request):
    try:


        unique_directory = request.GET.get('dir')
        page = int(request.GET.get('page', 1))
        items_per_page = int(request.GET.get('items_per_page', 300))

        if not unique_directory:
            return JsonResponse({'error': 'Missing directory identifier'}, status=400)

        json_directory = os.path.join(settings.MEDIA_ROOT, 'csv', unique_directory)
        final_json_file_path = os.path.join(json_directory, 'activity_data.json')

        if not os.path.exists(final_json_file_path):
            return JsonResponse({'error': 'JSON file not found'}, status=404)

        with open(final_json_file_path, 'r') as f:
            data_dict = ujson.load(f)

        # Paginate the data dictionary
        paginator = Paginator(list(data_dict.items()), items_per_page)
        paginated_data = paginator.get_page(page)

        paginated_data_dict = {key: value for key, value in paginated_data}

        return JsonResponse(paginated_data_dict, safe=False)

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

# Cache the JSON data in memory
@lru_cache(maxsize=1)
def load_gids_activity_indexes(cache_file_path):
    with open(cache_file_path, 'r') as f:
        return ujson.load(f)

def extract_ids_from_json(json_file_path):
    """Extract IDs from the JSON file."""
    Gids_array = []

    # Read and process the JSON file
    try:
        with open(json_file_path, 'r') as json_file:
            for line in json_file:
                try:
                    json_data = json.loads(line)
                    if isinstance(json_data, list):
                        for node in json_data:
                            Gids_array.append(int(node['id']))
                except (KeyError, ValueError, json.JSONDecodeError) as e:
                    print(f"Error processing JSON line: {line.strip()} - {e}")
    except FileNotFoundError:
        print(f"File not found: {json_file_path}")
    except Exception as e:
        print(f"An error occurred: {e}")

    return array.array('i', Gids_array)

@csrf_exempt
def LoadActivityData(request):
    try:
        if request.method == 'POST':
            Gids_array = []
            gids_activity_indexes = {}
            number_of_spikes = 0

            file_id = request.GET.get('dir')
            if not file_id:
                return JsonResponse({'error': 'Missing file ID'}, status=400)

            json_directory = os.path.join(settings.MEDIA_ROOT, 'hip_form', "activities")
            if file_id == '1':
                final_csv_file_path = os.path.join(json_directory, 'Activity_CA3.csv')
            elif file_id == '2':
                final_csv_file_path = os.path.join(json_directory, 'Activity_MEC.csv')
            else:
                return JsonResponse({'error': 'Invalid file ID'}, status=400)

            # Handle GIDs if they are present
            gIDs_raw = request.POST.get('gIDs')
            if gIDs_raw:
                try:
                    Gids_list = json.loads(gIDs_raw)
                except json.JSONDecodeError:
                    Gids_list = gIDs_raw.split(',')

                try:
                    Gids_array = array.array('i', map(lambda x: int(float(x)), Gids_list))
                except ValueError as e:
                    return JsonResponse({'error': f'Invalid GIDs data: {e}'}, status=400)

            data = parse_activity_csv(final_csv_file_path)
            keys = sorted(data.keys(), key=float)


            gids_activity_indexes = get_activity_indexes(data, Gids_array)
            number_of_spikes = count_csv_lines(final_csv_file_path)

            response_data = {
                'data': data,
                'keys': keys,
                'gids_activity_indexes': gids_activity_indexes,
                'number_of_spikes': number_of_spikes,
            }
            return JsonResponse(response_data, safe=False)

        return JsonResponse({'error': 'Invalid HTTP method'}, status=405)

    except Exception as e:
        print("Error in LoadActivityData:", e)
        return JsonResponse({'error': str(e)}, status=500)

def parse_activity_csv(filepath):
    activity_data = defaultdict(list)
    with open(filepath, newline='') as csvfile:
        reader = csv.reader(csvfile)
        header = next(reader)  # Skip header, if present

        for row in reader:
            gid = int(row[0])
            time = float(row[1])
            activity_data[str(time)].append(gid)

    return dict(activity_data)

@csrf_exempt
def LoadAllLayers(request):
    try:

        json_directory = os.path.join(settings.MEDIA_ROOT, "hip_form")

        data_list = []
        total_size = 0
        # connections = {}
        # Iterate over each JSON file in the directory
        for filename in sorted(os.listdir(json_directory)):
            if filename.endswith(".json"):
                file_path = os.path.join(json_directory, filename)
                filename_without_ext = os.path.splitext(filename)[0]
                try:
                    with open(file_path, 'r') as f:
                        file_data = ujson.load(f)

                        total_excitatory = sum(1 for neuro in file_data if neuro.get('type') == 1)  # Count occurrences of 1 in the 'type' column
                        total_inhibitory = sum(1 for neuro in file_data if neuro.get('type') != 1)  # Count occurrences of 0 in the 'type' column
                        total_neuros = len(file_data)  # Count total neurons

                        data_list.append({
                            'filename': filename_without_ext,
                            'fileData': file_data,
                            'total_neuros': total_neuros,
                            'total_excitatory': total_excitatory,
                            'total_inhibitory': total_inhibitory,
                            # 'connections':connections
                        })
                        total_size += os.path.getsize(file_path)/ (1024 * 1024)  # Calculate total size in MB
                except json.JSONDecodeError as e:
                    print(f"Error decoding JSON from file {file_path}: {e}")
                except Exception as e:
                    print(f"Error reading file {file_path}: {e}")



        # response_data = {'files': "", 'total_size': total_size, 'connections': connections}
        response_data = {'files': data_list, 'total_size': total_size}
        return JsonResponse(response_data, safe=False)

    except requests.RequestException as e:
        print(f"Request error: {e}")
        return JsonResponse({'error': 'Failed to fetch data from EBRAINS'}, status=500)

    except Exception as e:
        print(f"An error occurred: {e}")
        return JsonResponse({'error': 'An unexpected error occurred'}, status=500)

def count_csv_lines(file_path):
    with open(file_path, 'r') as f:
        return sum(1 for line in f)

@lru_cache(maxsize=1)
def compute_connections():
    json_directory = os.path.join(settings.MEDIA_ROOT, "hip_form")
    os.makedirs(json_directory, exist_ok=True)
    json_path = os.path.join(json_directory, "connections.json")

    ca3_file_paths = [
        os.path.join(json_directory, f"CA3-{layer}.json") for layer in ["sl", "slm", "so", "sp", "sr"]
    ]
    ca1_file_paths = [
        os.path.join(json_directory, f"CA1-{layer}.json") for layer in ["slm", "so", "sp", "sr"]
    ]

    ca3_neurons = pd.DataFrame(load_neurons_from_files(ca3_file_paths))
    ca1_neurons = pd.DataFrame(load_neurons_from_files(ca1_file_paths))

    # Select pyramidal cells (robust in case ntype codes differ or missing)
    ca3_pyramidal = ca3_neurons[ca3_neurons['ntype'] == 19].copy()
    ca1_pyramidal = ca1_neurons[ca1_neurons['ntype'] == 49].copy()

    # Fallback if filtering empties the set
    if ca3_pyramidal.empty:
        print("No CA3 PCs after ntype==19 filter; using all CA3 neurons.")
        ca3_pyramidal = ca3_neurons.copy()
    if ca1_pyramidal.empty:
        print("No CA1 PCs after ntype==49 filter; using all CA1 neurons.")
        ca1_pyramidal = ca1_neurons.copy()
    
    # Ensure coordinates are numeric and drop NaNs
    for df_name, df in [("CA3", ca3_pyramidal), ("CA1", ca1_pyramidal)]:
        before = len(df)
        df[['x','y','z']] = df[['x','y','z']].apply(pd.to_numeric, errors='coerce')
        df.dropna(subset=['x','y','z'], inplace=True)
        after = len(df)
        if after < before:
            print(f"[WARN] Dropped {before-after} {df_name} rows with non-numeric coords.")

    print(f"CA3 PCs: {len(ca3_pyramidal)}, CA1 PCs: {len(ca1_pyramidal)}")


    # 1. Scale lengths from rat to mouse
    SF_SR = calculate_scaling_factor(rat_volume=10.95, mouse_volume=2.83)
    SF_SO = calculate_scaling_factor(rat_volume=6.47, mouse_volume=1.5)

    # Apply the scaling factors to the original RAT lengths to get MOUSE lengths.
    L_SR_mouse = 4465.3 * SF_SR  # Previously used division, which was incorrect.
    L_SO_mouse = 3795.59 * SF_SO # Scale the full SO length first...
    L_SO_mouse_effective = L_SO_mouse / 2 # ...then apply the 50% adjustment for SO
    L_total_effective_mouse = L_SR_mouse + L_SO_mouse_effective # 100% of SR + 50% of SO

    # 2. Calculate total spines (CORRECTED STEP)
    spine_density = 0.92  # spines/micrometer
    # The total number of spines is the effective length multiplied by the density.
    total_spines = L_total_effective_mouse * spine_density
    # The 'inter_spine_distance' variable is not needed for the calculation and can be removed.

    # 3. & 4. Calculate unique presynaptic partners.
    avg_contacts_per_connection = 7.24 # From Hippocampome CA3-CA3 data
    unique_ca3_partners_per_ca1 = total_spines / avg_contacts_per_connection

    # 5. Calculate CA3 output divergence
    CA1PC_census = 159341
    CA3PC_census = 75376
    # The number of CA1 cells a single CA3 cell targets is given by:
    # (Partners per CA1) * (Total CA1 Population / Total CA3 Population)
    avg_ca1_targets_per_ca3 = unique_ca3_partners_per_ca1 * (CA1PC_census / CA3PC_census)

    # --- Print results for verification ---
    print(f"Scaling Factor SR: {SF_SR:.4f}")
    print(f"Scaling Factor SO: {SF_SO:.4f}")
    print(f"Scaled Mouse Length SR: {L_SR_mouse:.1f} µm")
    print(f"Scaled Mouse Length SO: {L_SO_mouse:.1f} µm")
    print(f"Effective Length for CA3 Input: {L_total_effective_mouse:.1f} µm")
    print(f"Total CA3 Synapses per CA1 PC: {total_spines:.0f}")
    print(f"Avg. CA3 Partners per CA1 PC: {unique_ca3_partners_per_ca1:.0f}")
    print(f"Avg. CA1 Targets per CA3 PC: {avg_ca1_targets_per_ca3:.0f}")

    
    # --- Fixed 05% fan-out (≈54) and in-degree cap (510) ---
    OUTDEG_TARGETS_PER_CA3 = max(1, int(round(avg_ca1_targets_per_ca3 * 0.05)))  # ~54 from 1077
    print(f"CA3 out-degree = {OUTDEG_TARGETS_PER_CA3} (05% of {avg_ca1_targets_per_ca3:.0f})")

    connections = connect_gaussian_all(
    ca3_df=ca3_pyramidal,
    ca1_df=ca1_pyramidal,            # or ca1_eligible if you keep the subset trick
    avg_targets_per_ca3=OUTDEG_TARGETS_PER_CA3,  # or your scaled fanout
    d_max_um=None,                   # or a value if you want locality
    sigma_factor=0.30,                # your chosen σ scaling
    ca1_in_degree_cap=unique_ca3_partners_per_ca1            # << hard cap per CA1
    )

    with open(json_path, 'w') as f:
        json.dump(connections, f)
        
    num_ca3 = len(connections)
    nonempty = sum(1 for v in connections.values() if v)
    avg_out = (sum(len(v) for v in connections.values()) / max(1, num_ca3))
    print(f"CA3 with ≥1 target: {nonempty}/{num_ca3}  |  mean out-degree: {avg_out:.1f}")

    # Check that all CA1 targets exist in the CA1 set
    ca1_ids_set = set(ca1_pyramidal['gid'].astype(str))
    missing = 0
    for ca3_id, targets in connections.items():
        for t in targets:
            if str(t) not in ca1_ids_set:
                missing += 1
    if missing:
        print(f"{missing} targets not found in CA1 pool (ID mismatch).")

    return json_path

@csrf_exempt
def fetchConnections(request):
    try:
        
        #json_path = compute_connections()
        json_path = os.path.join(settings.MEDIA_ROOT, "hip_form","connections", "connections.json")
        
        # Load full data from file
        with open(json_path, 'r') as f:
            connections = json.load(f)

        # Chunking logic
        chunk_size = int(request.GET.get("chunk_size", 10000))
        page = int(request.GET.get("page", 1))

        keys = list(connections.keys())
        total_pages = (len(keys) + chunk_size - 1) // chunk_size
        start = (page - 1) * chunk_size
        end = start + chunk_size

        chunk = {k: connections[k] for k in keys[start:end]}
        response_data = {
            'connections_chunk': chunk,
            'page': page,
            'has_more': end < len(keys),
            'total_pages': total_pages,
            'total_keys': len(keys)
        }
        return JsonResponse(response_data)

    except Exception as e:
        return JsonResponse({'error': str(e), 'connections': {}}, status=500)

def load_neurons_from_files(file_paths):
    for file_path in file_paths:
        yield from load_json_file_generator(file_path)

# Generator to load JSON files and yield one neuron at a time
def load_json_file_generator(file_path):
    try:
        with open(file_path, 'r') as file:
            data = json.load(file)
            for neuron in data:
                yield {
                    'gid': neuron.get('id'),
                    'x': neuron.get('x'),
                    'y': neuron.get('y'),
                    'z': neuron.get('z'),
                    'type': neuron.get('type'),
                    'ntype': neuron.get('ntype')
                }
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON from {file_path}: {e}")

def calculate_scaling_factor(rat_volume,mouse_volume):
    scaling_factor = (mouse_volume / rat_volume) ** (1/3)
    return scaling_factor

def connect_all_pyramidal(ca3_neurons, ca1_neurons, average_CA1_contacted_by_CA3):
    connections = {}

    try:
        # Process region-based connections (Dorsal/Ventral, Proximal/Distal)

        # Dorsal-Dorsal connections
        ca3_dorsal = ca3_neurons[ca3_neurons['dorsal_ventral'] == 'dorsal']
        ca1_dorsal = ca1_neurons[ca1_neurons['dorsal_ventral'] == 'dorsal']
        connections.update(connect_regions_regionally(ca3_dorsal, ca1_dorsal, average_CA1_contacted_by_CA3))

        # Ventral-Ventral connections
        ca3_ventral = ca3_neurons[ca3_neurons['dorsal_ventral'] == 'ventral']
        ca1_ventral = ca1_neurons[ca1_neurons['dorsal_ventral'] == 'ventral']
        connections.update(connect_regions_regionally(ca3_ventral, ca1_ventral, average_CA1_contacted_by_CA3))

        # Proximal-Proximal connections
        ca3_proximal = ca3_neurons[ca3_neurons['prox_dist'] == 'proximal']
        ca1_proximal = ca1_neurons[ca1_neurons['prox_dist'] == 'proximal']
        connections.update(connect_regions_regionally(ca3_proximal, ca1_proximal, average_CA1_contacted_by_CA3))

        # Distal-Distal connections
        ca3_distal = ca3_neurons[ca3_neurons['prox_dist'] == 'distal']
        ca1_distal = ca1_neurons[ca1_neurons['prox_dist'] == 'distal']
        connections.update(connect_regions_regionally(ca3_distal, ca1_distal, average_CA1_contacted_by_CA3))

    except Exception as e:
        print(f"Error in connect_all_pyramidal: {e}")

    return connections

def compute_sigma(ca1_subset, factor=0.3):
    bbox_size = np.max(ca1_subset[['x', 'y', 'z']].values, axis=0) - np.min(ca1_subset[['x', 'y', 'z']].values, axis=0)
    avg_extent = np.mean(bbox_size)
    return factor * avg_extent  # Adaptive σ

def connect_regions_regionally(ca3_subset, ca1_subset, average_CA1_contacted_by_CA3):
    # Connects neurons within the same anatomical region using Gaussian-weighted sampling.
    try:
        connections = {}
        sigma = compute_sigma(ca1_subset)  # Dynamic sigma
        d_max = 500  # Optional: maximum radius in micrometers
        for _, ca3_neuron in ca3_subset.iterrows():
            connected_ids = safe_gaussian_connection(
                ca3_neuron, ca1_subset,
                num_targets=int(average_CA1_contacted_by_CA3),
                sigma=sigma,
                d_max=d_max
            )
            connections[ca3_neuron['gid']] = connected_ids
        return connections
    except Exception as e:
        print(f"Error in connect_regions_regionally: {e}")
        return {}

def safe_gaussian_connection(ca3_neuron, ca1_subset, num_targets=10, sigma=150, d_max=None):
    # Attempts probabilistic sampling; falls back to nearest-neighbors if necessary.
    
    ca3_xyz = ca3_neuron[['x', 'y', 'z']].values.astype(float)
    ca1_xyz = ca1_subset[['x', 'y', 'z']].values.astype(float)
    
    distances = np.linalg.norm(ca1_xyz - ca3_xyz, axis=1)
    
    # Optional cutoff to avoid distant targets
    if d_max is not None:
        mask = distances <= d_max
        if not np.any(mask):
            return []
        ca1_xyz = ca1_xyz[mask]
        distances = distances[mask]
        ca1_subset = ca1_subset.iloc[mask]

    # Compute Gaussian weights
    weights = np.exp(- (distances ** 2) / (2 * sigma ** 2))
    probs = weights / np.sum(weights)

    try:
        selected_indices = np.random.choice(
            ca1_subset.index,
            size=min(num_targets, len(ca1_subset)),
            replace=False,
            p=probs
        )
        return ca1_subset.loc[selected_indices, 'gid'].tolist()
    except Exception as e:
        # Fallback to nearest neighbors
        print(f"[Fallback] Gaussian sampling failed: {e}")
        ca1_subset = ca1_subset.copy()
        ca1_subset['distance'] = distances
        nearest = ca1_subset.nsmallest(num_targets, 'distance')
        return nearest['gid'].tolist()

def adaptive_sigma_global(ca1_df: pd.DataFrame, factor: float = 0.15) -> float:
    """
    Compute a single Gaussian σ (µm) from the spatial extent of the whole CA1 pool.
    Smaller factor -> tighter locality; larger -> broader spread.
    """
    if ca1_df.empty:
        return 100.0
    bbox = ca1_df[['x', 'y', 'z']].agg(['min', 'max'])
    span = (bbox.loc['max'] - bbox.loc['min']).to_numpy()
    return float(factor * np.mean(span))

def connect_gaussian_all(ca3_df: pd.DataFrame,
                         ca1_df: pd.DataFrame,
                         avg_targets_per_ca3: float,
                         d_max_um: int = 300,
                         sigma_factor: float = 0.15,
                         ca1_in_degree_cap: int = 510,
                         rng_seed: int = 42) -> dict:
    """
    Domain-free CA3→CA1 connectivity with *per-CA1 in-degree cap*.
      - For each CA3 PC, we sample ~avg_targets_per_ca3 CA1 PCs
        using Gaussian distance weights.
      - A CA1 PC will never receive inputs from > ca1_in_degree_cap CA3 PCs.
    """
    connections = {}
    if ca1_df.empty or ca3_df.empty:
        return connections

    rng = np.random.default_rng(rng_seed)

    # Ensure string gids
    ca3_df = ca3_df.copy()
    ca3_df['gid'] = ca3_df['gid'].astype(str)
    ca1_df = ca1_df.copy()
    ca1_df['gid'] = ca1_df['gid'].astype(str)

    # Precompute one global σ from CA1 spatial extent
    sigma_um = adaptive_sigma_global(ca1_df, factor=sigma_factor)

    # In-degree tracker for CA1 targets
    ca1_gids = ca1_df['gid'].to_numpy()
    indeg = pd.Series(0, index=ca1_gids, dtype=int)

    # For fairness, randomize CA3 order slightly
    ca3_order = rng.permutation(ca3_df.index.values)

    k = int(max(1, round(avg_targets_per_ca3)))

    # Preload CA1 coords for speed
    ca1_xyz_all = ca1_df[['x', 'y', 'z']].to_numpy(dtype=float)

    for idx in ca3_order:
        row = ca3_df.loc[idx]
        q = row[['x','y','z']].to_numpy(dtype=float)

        # Eligible CA1 = under cap (and optionally within d_max_um)
        under_cap_mask = (indeg[ca1_gids].to_numpy() < ca1_in_degree_cap)

        if not np.any(under_cap_mask):
            # everyone hit the cap; this CA3 gets no targets
            connections[row['gid']] = []
            continue

        ca1_xyz = ca1_xyz_all[under_cap_mask]
        ca1_gids_elig = ca1_gids[under_cap_mask]

        # Distances
        dists = np.linalg.norm(ca1_xyz - q, axis=1)

        # Optional hard radius
        if d_max_um is not None:
            rad_mask = (dists <= d_max_um)
            if not np.any(rad_mask):
                connections[row['gid']] = []
                continue
            dists = dists[rad_mask]
            ca1_gids_elig = ca1_gids_elig[rad_mask]

        # Gaussian weights
        w = np.exp(-(dists ** 2) / (2 * sigma_um ** 2))
        wsum = w.sum()
        if wsum <= 0:
            # fallback: uniform among eligible
            probs = np.ones_like(w) / len(w)
        else:
            probs = w / wsum

        k_eff = int(min(k, len(ca1_gids_elig)))
        if k_eff <= 0:
            connections[row['gid']] = []
            continue

        sel_idx = rng.choice(len(ca1_gids_elig), size=k_eff, replace=False, p=probs)
        chosen = ca1_gids_elig[sel_idx].tolist()

        # Update in-degree counts immediately
        indeg.loc[chosen] += 1

        # Save connections (use bare ints where possible)
        connections[row['gid']] = [_to_numeric_id(t) for t in chosen]

    # QA: check cap compliance
    max_in = int(indeg.max()) if len(indeg) else 0
    print(f"[QA] Max CA1 in-degree observed = {max_in} (cap={ca1_in_degree_cap})")
    if max_in > ca1_in_degree_cap:
        print("[WARN] In-degree cap violated; check logic.")

    return connections

def _to_numeric_id(v):
    try:
        s = str(v)
        return int(s) if s.isdigit() else s
    except Exception:
        return str(v)

def process_uploaded_file(file_path):
    # Determine paths and filenames
    json_directory = os.path.dirname(file_path)
    original_file_name = os.path.basename(file_path)
    file_name_without_extension = os.path.splitext(original_file_name)[0]
    json_path = os.path.join(json_directory, f"{file_name_without_extension}.json")

    fieldnames = ['id', 'x', 'y', 'z','type']

    # Read the CSV and write to JSON
    with open(file_path, 'r') as csv_file, open(json_path, 'w') as json_file:
        json_data = []
        csv_reader = csv.DictReader(csv_file, fieldnames=fieldnames)
        for row in csv_reader:

            # Convert row values and handle missing or invalid data
            json_data.append({
                'id': int(row['id']),
                'x': float(row['x']),
                'y': float(row['y']),
                'z': float(row['z']),
                'type': int(row['type'])
            })


            # Write to JSON every 1000 records to manage memory usage
            if len(json_data) >= 1000:
                ujson.dump(json_data, json_file)
                json_file.write('\n')
                json_data = []

        # Write any remaining data
        if json_data:
            ujson.dump(json_data, json_file)
            json_file.write('\n')

    # Delete the original CSV file after processing
    try:
        os.remove(file_path)
    except OSError as e:
        print(f"Error deleting file {file_path}: {e}")

def get_activity_indexes_for_SimulationData(activity_file, Gids):
    # Create a dictionary for quick lookup
    gids_dict = {int(float(id_)): index for index, id_ in enumerate(Gids)}

    try:
        with open(activity_file, 'r') as file:
            reader = csv.reader(file)

            # Sort rows based on the second column (index 1) and filter valid rows
            sorted_rows = sorted(
                (row for row in reader if row and len(row) > 1),  # Filter empty or malformed rows
                key=lambda row: float(row[1])
            )

            # Use a generator expression to build the result
            gids_activity_indexes = [
                gids_dict[int(row[0])]  # Map activity_id to its index
                for row in sorted_rows
                if int(row[0]) in gids_dict  # Only include valid activity IDs
            ]

    except ValueError as e:
        # Handle cases where the ID cannot be converted to int
        print(f"Skipping row due to ValueError: {e}")
        return {'error': f'ValueError: {e}'}

    except csv.Error as e:
        return {'error': f'CSV error: {e}'}

    return gids_activity_indexes

def get_activity_indexes(data_dict, Gids):

    """  Returns a dictionary mapping GIDs from spike activity to their index in the Gids list.  """
    # Create a lookup for Gids: {gid: index}
    gids_dict = {int(float(id_)): index for index, id_ in enumerate(Gids)}

    # Create the mapping for all GIDs found in activity data
    activity_index_map = {}

    for t, activity_ids in data_dict.items():
        for activity_id in activity_ids:
            try:
                gid = int(activity_id)
                if gid in gids_dict:
                    activity_index_map[gid] = gids_dict[gid]
            except ValueError as e:
                print(f"Skipping invalid activity_id '{activity_id}': {e}")

    return activity_index_map

@csrf_exempt
def LoadHumanHipForm(request):
    try:
        json_directory = os.path.join(settings.MEDIA_ROOT, "hip_form", "human")
        final_json_file_path = os.path.join(json_directory, 'network.json')

        with open(final_json_file_path, 'r') as f:
            networkdata = ujson.load(f)
            total_neurons = len(networkdata)
            total_size = os.path.getsize(final_json_file_path) / (1024 * 1024)  # in MB

            mode = request.GET.get("mode", "full")

            if mode == "half":
                networkdata = networkdata[:total_neurons // 2]

            return JsonResponse({
                'fileData': networkdata,
                'total_neurons': len(networkdata),
                'total_size': total_size
            })

    except ujson.JSONDecodeError as e:
        print(f"Error decoding JSON from file {final_json_file_path}: {e}")
    except Exception as e:
        print(f"Error reading file {final_json_file_path}: {e}")
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
def LoadHumanActivityData(request):
    try:
        if request.method == 'POST':

            gids_activity_indexes = []
            number_of_spikes = 0

            # Get the file ID from the request
            file_id = request.GET.get('dir')
            if not file_id:
                return JsonResponse({'error': 'Missing file ID'}, status=400)

            # Determine the file path based on the selected value
            json_directory = os.path.join(settings.MEDIA_ROOT, 'hip_form', "human")
            if file_id == '1':
                final_json_file_path = os.path.join(json_directory, 'activity.json')
                final_csv_file_path = os.path.join(json_directory, 'activity.csv')
                final_json_file_path_gids = os.path.join(json_directory, 'gids_activity_indexes.json')
            # elif file_id == '2':
            #     final_json_file_path = os.path.join(json_directory, 'Activity_MEC.json')
            #     final_csv_file_path = os.path.join(json_directory, 'Activity_MEC.csv')
            else:
                return JsonResponse({'error': 'Invalid file ID'}, status=400)


            # Read the JSON file and prepare the response data
            with open(final_json_file_path_gids, "r") as file:
                gids_activity_indexes = ujson.load(file)

            # gids_activity_indexes = get_activity_indexes_for_SimulationData(final_csv_file_path, Gids_array)
            number_of_spikes = count_csv_lines(final_csv_file_path)

            # Read the JSON file and prepare the response data
            with open(final_json_file_path, "r") as file:
                data = ujson.load(file)
                keys = sorted(data.keys(), key=float)  # Sort keys as floats

            # Return the data and keys in a JSON response
            response_data = {
                'data': data,
                'keys': keys,
                'gids_activity_indexes': gids_activity_indexes,
                'number_of_spikes': number_of_spikes,
            }
            return JsonResponse(response_data, safe=False)

        else:
            return JsonResponse({'error': 'Invalid HTTP method'}, status=405)

    except Exception as e:
        print("Error in LoadActivityData:", e)  # Debugging
        return JsonResponse({'error': str(e)}, status=500)

def list_connection_types(request):
    file_path = os.path.join(settings.MEDIA_ROOT,"connections_inh.hdf5")
    
    if not os.path.exists(file_path):
        return JsonResponse({"error": "HDF5 file not found."}, status=404)

    with h5py.File(file_path, "r") as f:
        connection_types = list(f.keys())

    return JsonResponse({"types": connection_types})

def get_connection_data(request):
    conn_type = request.GET.get("type")
    if not conn_type:
        return JsonResponse({"error": "Missing connection type."}, status=400)

    file_path = os.path.join(settings.MEDIA_ROOT,"connections_inh.hdf5")
    
    if not os.path.exists(file_path):
        return JsonResponse({"error": "HDF5 file not found."}, status=404)

    with h5py.File(file_path, "r") as f:
        if conn_type not in f:
            return JsonResponse({"error": f"Connection type '{conn_type}' not found."}, status=404)
        dataset = f[conn_type][()]
        connections = dataset.tolist()

    return JsonResponse({"connections": connections})
