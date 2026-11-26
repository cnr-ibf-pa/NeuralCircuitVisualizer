// Loader overlay / progress text / generic UI helpers.
import { $ } from "./dom.js";

// ---------- loader: step list, overall progress, transfer speed / ETA, timings ----------
// The loader shows the stages of a load (Upload -> Server -> Download -> Parse -> Build 3D) as a
// list with a live timer per stage.  The progress bar is ONE overall percentage that only moves
// forward (weighted by stage), and the status line shows elapsed time plus MB, speed and ETA of
// the running transfer.  When the loader closes, a toast lists the exact time of every stage.
//
//   showLoader({ upload: true, build: true })  - optional: which stages this load is expected to have
//   startPhase("Uploading" | "Server: ..." | "Downloading ..." | "Parsing ..." | "Building ...")
//   setProgress("NN%")  - progress of the running stage        setTransfer(done, total) - bytes

const STAGES = {
  upload: { label: "Upload files", weight: 30 },
  server: { label: "Server processing", weight: 20 },
  download: { label: "Download", weight: 30 },
  parse: { label: "Parse data", weight: 10 },
  build: { label: "Build 3D scene", weight: 10 },
};
const CUSTOM_WEIGHT = 20;

let loaderStart = 0;
let stages = []; // { key, label, weight, state: pending|active|done|skipped, ms, frac, started }
let active = null;
let detail = "";
let transfer = null; // { done, total, samples:[[t, done]], speed }
let overall = 0;
let timerId = 0;
let rootEl = null;
let toastEl = null;
let toastTimer = 0;

export const fmtDuration = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`);
const fmtMB = (n) => `${(n / 1048576).toFixed(n < 10485760 ? 2 : 1)} MB`;

const STYLE = `
#ncv-loader{margin-top:14px;width:100%;text-align:left;font-size:12.5px;line-height:1.35}
#ncv-loader ol{list-style:none;margin:0 0 10px;padding:0}
#ncv-loader li{display:flex;align-items:center;gap:10px;padding:3px 2px;opacity:.45;transition:opacity .25s}
#ncv-loader li.active,#ncv-loader li.done{opacity:1}
#ncv-loader li.skipped{display:none}
#ncv-loader .ico{flex:0 0 16px;height:16px;border-radius:50%;border:2px solid currentColor;box-sizing:border-box;position:relative}
#ncv-loader li.active .ico{border-color:rgba(255,255,255,.25);border-top-color:#2dd4bf;animation:ncvspin .8s linear infinite}
#ncv-loader li.done .ico{background:#2dd4bf;border-color:#2dd4bf}
#ncv-loader li.done .ico:after{content:"";position:absolute;left:4px;top:1px;width:3px;height:7px;border:solid #06201d;border-width:0 2px 2px 0;transform:rotate(45deg)}
#ncv-loader .lbl{flex:1}
#ncv-loader .t{font-variant-numeric:tabular-nums;opacity:.8}
#ncv-loader li.active .lbl{font-weight:600}
#ncv-loader .sub{height:2px;margin:2px 0 4px 26px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden;display:none}
#ncv-loader li.active + .sub{display:block}
#ncv-loader .sub i{display:block;height:100%;width:var(--f,0%);background:#2dd4bf;transition:width .15s}
#ncv-loader .sub.ind i{width:35%;animation:ncvslide 1.1s ease-in-out infinite}
#ncv-status{font-variant-numeric:tabular-nums;opacity:.85;text-align:center;min-height:1.4em}
@keyframes ncvspin{to{transform:rotate(360deg)}}
@keyframes ncvslide{0%{margin-left:-35%}100%{margin-left:100%}}
`;

function ensureRoot() {
  if (rootEl && rootEl.isConnected) return;
  if (!document.getElementById("ncv-loader-style")) {
    const st = document.createElement("style");
    st.id = "ncv-loader-style";
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  const old = document.getElementById("loader-timer");
  if (old) old.remove();
  rootEl = document.createElement("div");
  rootEl.id = "ncv-loader";
  rootEl.innerHTML = '<ol></ol><div id="ncv-status"></div>';
  $("progress-percentage").insertAdjacentElement("afterend", rootEl);
}

function overallFraction() {
  let total = 0;
  let done = 0;
  for (const s of stages) {
    if (s.state === "skipped") continue;
    total += s.weight;
    if (s.state === "done") done += s.weight;
    else if (s.state === "active") done += s.weight * s.frac;
  }
  return total ? done / total : 0;
}

function paint() {
  ensureRoot();
  const now = performance.now();

  overall = Math.max(overall, overallFraction()); // never goes backwards
  $("progress-percentage").textContent = `${Math.min(100, Math.floor(overall * 100))}%`;

  // stage list
  const list = rootEl.querySelector("ol");
  if (list.children.length !== stages.length * 2) {
    list.innerHTML = stages.map(() => '<li><span class="ico"></span><span class="lbl"></span><span class="t"></span></li><div class="sub"><i></i></div>').join("");
  }
  stages.forEach((s, i) => {
    const li = list.children[i * 2];
    const sub = list.children[i * 2 + 1];
    li.className = s.state;
    li.children[1].textContent = s.label;
    const ms = s.state === "active" ? s.ms + (now - s.started) : s.ms;
    li.children[2].textContent = s.state === "done" || s.state === "active" ? fmtDuration(ms) : "";
    sub.className = "sub" + (s.state === "active" && s.frac === 0 && !s.determinate ? " ind" : "");
    sub.firstChild.style.setProperty("--f", `${Math.round(s.frac * 100)}%`);
    if (s.state === "active" && s.determinate) sub.classList.remove("ind");
  });

  // status line
  const visible = stages.filter((s) => s.state !== "skipped");
  const step = active ? visible.indexOf(active) + 1 : 0;
  const parts = [`Elapsed ${fmtDuration(now - loaderStart)}`];
  if (active && visible.length > 1) parts.unshift(`Step ${step} of ${visible.length}`);
  if (transfer && active && (active.key === "upload" || active.key === "download")) {
    parts.push(transfer.total ? `${fmtMB(transfer.done)} / ${fmtMB(transfer.total)}` : fmtMB(transfer.done));
    if (transfer.speed > 0) {
      parts.push(`${fmtMB(transfer.speed)}/s`);
      const eta = transfer.total > transfer.done ? ((transfer.total - transfer.done) / transfer.speed) * 1000 : 0;
      if (eta >= 1000) parts.push(`~${fmtDuration(eta)} left`); // a sub-second estimate is just noise
    }
  } else if (detail) parts.push(detail);
  $("ncv-status").textContent = parts.join(" · ");
}

const stageKey = (label) => {
  if (/^upload/i.test(label)) return "upload";
  if (/^server/i.test(label)) return "server";
  if (/^download/i.test(label)) return "download";
  if (/^pars/i.test(label)) return "parse";
  if (/^build/i.test(label)) return "build";
  return label;
};

const makeStage = (key, label) => ({
  key,
  label: label ?? STAGES[key]?.label ?? key,
  weight: STAGES[key]?.weight ?? CUSTOM_WEIGHT,
  state: "pending",
  ms: 0,
  frac: 0,
  determinate: false,
  started: 0,
});

function finishActive(now) {
  if (!active) return;
  active.ms += now - active.started;
  active.state = "done";
  active.frac = 1;
  active = null;
}

// close the running stage and start a new one (the label picks the stage)
export function startPhase(label) {
  const now = performance.now();
  finishActive(now);
  if (!label) return;
  const key = stageKey(label);
  let idx = stages.findIndex((s) => s.key === key);
  if (idx === -1) {
    stages.push(makeStage(key, STAGES[key] ? undefined : label));
    idx = stages.length - 1;
  }
  stages.slice(0, idx).forEach((s) => {
    if (s.state === "pending") s.state = "skipped"; // this load has no such stage
  });
  active = stages[idx];
  active.state = "active";
  active.frac = 0;
  active.determinate = false;
  active.started = now;
  detail = "";
  transfer = null;
  if (timerId) paint();
}

export const setPhaseDetail = (text) => {
  detail = text;
};

// progress (0..1) of the running stage
export function setStageProgress(fraction) {
  if (!active) return;
  active.frac = Math.max(0, Math.min(1, fraction));
  active.determinate = true;
}

// bytes moved so far in the running upload / download; derives speed and ETA from the last ~2 s
export function setTransfer(done, total = 0) {
  const now = performance.now();
  if (!transfer) transfer = { done: 0, total: 0, samples: [], speed: 0 };
  transfer.done = done;
  transfer.total = total;
  transfer.samples.push([now, done]);
  while (transfer.samples.length > 2 && now - transfer.samples[0][0] > 2000) transfer.samples.shift();
  const [t0, d0] = transfer.samples[0];
  if (now - t0 > 250) transfer.speed = ((done - d0) / (now - t0)) * 1000;
  if (total) setStageProgress(Math.min(0.99, done / total));
}

// resolves after the browser has painted, so a message set before heavy synchronous work is visible
export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

function showToast(text) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.style.cssText =
      "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:100000;max-width:90vw;padding:10px 16px;border-radius:8px;background:rgba(20,22,28,0.92);color:#fff;font:13px/1.4 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);pointer-events:none;transition:opacity .3s";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.style.opacity = "1";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.style.opacity = "0"), 8000);
}

// opts: { upload, build } - stages this load is expected to have (server, download and parse are always listed)
export function showLoader(opts = {}) {
  $("page-loader").style.display = "block";
  if (timerId) return; // already running: keep the original start time
  loaderStart = performance.now();
  active = null;
  detail = "";
  transfer = null;
  overall = 0;
  const plan = [...(opts.upload ? ["upload"] : []), "server", "download", "parse", ...(opts.build ? ["build"] : [])];
  stages = plan.map((k) => makeStage(k));
  if (rootEl) rootEl.querySelector("ol").innerHTML = "";
  paint();
  timerId = setInterval(paint, 100);
}

export function hideLoader() {
  $("page-loader").style.display = "none";
  if (!timerId) return;

  finishActive(performance.now());
  clearInterval(timerId);
  timerId = 0;

  const total = performance.now() - loaderStart;
  if (total < 400) return;
  const done = stages.filter((s) => s.state === "done" && s.ms > 0);
  const text = `Done in ${fmtDuration(total)}` + (done.length ? ` — ${done.map((s) => `${s.label} ${fmtDuration(s.ms)}`).join(" · ")}` : "");
  console.info("[NCV] " + text);
  showToast(text);
}

// fetch + JSON with the stages timed separately and a real download percentage, speed and ETA.
// The total comes from X-Uncompressed-Length, or Content-Length when the body is not compressed.
export async function fetchJson(url, init, label = "data") {
  startPhase(`Server: preparing ${label}`);
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);

  startPhase(`Downloading ${label}`);
  if (!response.body || !response.body.getReader) return response.json();

  const encoded = response.headers.get("Content-Encoding");
  const total = Number(response.headers.get("X-Uncompressed-Length")) || (!encoded || encoded === "identity" ? Number(response.headers.get("Content-Length")) : 0) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  let lastPaint = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;

    const now = performance.now();
    if (now - lastPaint > 100) {
      lastPaint = now;
      setTransfer(received, total);
    }
  }
  setTransfer(received, total);

  startPhase(`Parsing ${label}`);
  await nextFrame();
  const blob = new Blob(chunks);
  let data;
  try {
    data = await new Response(blob).json();
  } catch (err) {
    // diagnose: truncated body vs. invalid content (NaN / Infinity / HTML error page)
    const text = await blob.text();
    const head = text.slice(0, 200);
    const tail = text.slice(-200);
    console.error(`[fetchJson] ${label}: invalid JSON. received ${received} bytes, expected ${total || "unknown"}` + ` (${total && received < total ? "TRUNCATED" : "length ok"}); ` + `contains NaN: ${/\bNaN\b/.test(text)}, Infinity: ${/\bInfinity\b/.test(text)}`, { head, tail });
    throw new Error(`${label}: invalid JSON (${received}/${total || "?"} bytes). ${err.message}`);
  }
  setStageProgress(1);
  return data;
}

export const setMessage = (text) => ($("msgprogress").innerText = text);
export function setProgress(text) {
  const m = /(\d{1,3})\s*%/.exec(String(text));
  if (m && active) setStageProgress(+m[1] / 100); // the bar shows the overall progress, painted by the loader
  else if (!m) $("progress-percentage").textContent = text; // errors / blank
}
export const showProgressText = (show) => ($("progress-percentage").style.display = show ? "block" : "none");

// Show/hide the spike statistics panels.
// `table:false` leaves #spikeTableWidget untouched (some original code paths did that).
export function setSpikePanels(visible, { table = true } = {}) {
  const v = visible ? "visible" : "hidden";
  $("Neurons_firing_attributes").style.visibility = v;
  $("networkspikes").style.visibility = v;
  if (table) $("spikeTableWidget").style.visibility = v;
}

// Fill the "Activity windows" dropdown from a chunk_mfr_list returned by the server.
// emptyDefault: give the placeholder option value="" (SONATA flow) instead of its text.
export function populateChunkDropdown(dropdown, chunks, { emptyDefault = false } = {}) {
  dropdown.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.textContent = "Activity windows";
  if (emptyDefault) defaultOption.value = "";
  dropdown.appendChild(defaultOption);

  chunks.forEach((chunk) => {
    const option = document.createElement("option");
    option.value = chunk.chunk_number;

    const timeRange = `[${Number(chunk.first_key).toFixed(1)} - ${Number(chunk.last_key).toFixed(1)}]ms`;
    const mfrVal = Number(chunk.MFR_total ?? chunk.MFR ?? 0);
    option.textContent = `Chunk ${String(chunk.chunk_number)}  ${timeRange}   MFR: ${mfrVal.toFixed(2)} Hz`;
    dropdown.appendChild(option);
  });
}

// Reset the activity dropdown to its first option and append new items.
export function popupDropdownActivity(dropdown, lst) {
  while (dropdown.options.length > 1) dropdown.remove(1);
  dropdown.selectedIndex = 0;

  lst.forEach((item) => {
    const option = document.createElement("option");
    option.value = item;
    option.text = item;
    dropdown.appendChild(option);
  });
}

// Click the histogram thumbnail to open it in the modal.
export function initHistogramModal() {
  const modal = $("myModal");
  const img = $("histogramImage");
  const modalImg = $("img01");
  const captionText = $("caption");

  img.onclick = function () {
    modal.style.display = "block";
    modalImg.src = this.src;
    captionText.innerHTML = this.alt;
  };
  document.getElementsByClassName("close")[0].onclick = () => {
    modal.style.display = "none";
  };
}

// Neuron stats block (total / excitatory / inhibitory)
export function generateTable(total_neuros, total_excitatory, total_inhibitory) {
  const containerDiv = document.createElement("div");
  containerDiv.className = "container-fluid px-2 mt-3";

  const row = document.createElement("div");
  row.className = "row";

  const addRow = (label, value, last = false) => {
    const col = document.createElement("div");
    col.className = "col-12 d-flex justify-content-between small py-1" + (last ? "" : " border-bottom");
    col.innerHTML = `<span><strong>${label}</strong></span><span>${value}</span>`;
    row.appendChild(col);
  };
  addRow("Total Neurons", total_neuros);
  addRow("Excitatory Neurons", total_excitatory);
  addRow("Inhibitory Neurons", total_inhibitory, true);

  containerDiv.appendChild(row);

  const previous = document.querySelector("#Neurons_firing_attributes .stats-block");
  if (previous) previous.remove();

  containerDiv.classList.add("stats-block");
  $("Neurons_firing_attributes").appendChild(containerDiv);
}

export function removeTable() {
  const containerDiv = document.querySelector(".generateTable");
  if (containerDiv) containerDiv.remove();
}
