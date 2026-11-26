// Canvas + HUD video recording (WebM download).
import { clearSpikes } from "./spikes.js";
import { state } from "./state.js";
import { requestRender } from "./scene.js";
import { $, canvas, hudCanvas, recStartBtn, recStopBtn } from "./dom.js";
import { baseURL } from "./config.js";
import { showLoader, hideLoader, setMessage, setProgress } from "./ui.js";

const RECORD_FPS = 30;
const OUT_W = 1920; // Full HD output
const OUT_H = 1080;

// MP4 (H.264) first - plays everywhere; WebM only when the browser cannot record MP4
const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.640028", // H.264 High, level 4.0 (1080p)
  "video/mp4;codecs=avc1.4d0028",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=h264",
  "video/webm;codecs=vp8",
  "video/webm;codecs=vp9",
];
const pickMimeType = () => MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));

// Ask the server (ffmpeg) to turn the WebM into an MP4; null when that is not possible.
async function convertToMp4(webm) {
  try {
    showLoader();
    setMessage("Converting the recording to MP4, please wait...");
    setProgress("");
    const fd = new FormData();
    fd.append("file", webm, "recording.webm");
    const response = await fetch(`${baseURL}/api/convert_to_mp4/`, { method: "POST", body: fd, headers: { "X-Requested-With": "XMLHttpRequest" } });
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    return await response.blob();
  } catch (err) {
    console.warn("MP4 conversion failed:", err);
    return null;
  } finally {
    hideLoader();
  }
}

function startRecording(mainCanvas, hud) {
  // the 3D view is scaled to fit inside 1920x1080 (centred, black bars if the aspect differs)
  const fit = Math.min(OUT_W / mainCanvas.width, OUT_H / mainCanvas.height);
  const dw = Math.round(mainCanvas.width * fit);
  const dh = Math.round(mainCanvas.height * fit);
  const dx = Math.floor((OUT_W - dw) / 2);
  const dy = Math.floor((OUT_H - dh) / 2);

  state.combinedCanvas = document.createElement("canvas");
  state.combinedCanvas.width = OUT_W;
  state.combinedCanvas.height = OUT_H;
  state.combinedCtx = state.combinedCanvas.getContext("2d", { alpha: false });
  state.combinedCtx.fillStyle = "#000";
  state.combinedCtx.fillRect(0, 0, OUT_W, OUT_H);
  state.combinedCtx.imageSmoothingQuality = "high";

  const stream = state.combinedCanvas.captureStream(RECORD_FPS);

  const options = { videoBitsPerSecond: 16_000_000 };
  const mimeType = pickMimeType();
  if (mimeType) options.mimeType = mimeType;

  state.mediaRecorder = new MediaRecorder(stream, options);
  state.recordedChunks = [];

  state.mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) state.recordedChunks.push(e.data);
  };

  state.mediaRecorder.onstop = async () => {
    state.postRender = null;
    const type = (state.mediaRecorder.mimeType || "video/webm").split(";")[0];
    let blob = new Blob(state.recordedChunks, { type });
    state.recordedChunks = [];
    let ext = type.includes("mp4") ? "mp4" : "webm";

    if (ext === "webm") blob = (await convertToMp4(blob)) ?? blob; // browser could not record MP4
    if (blob.type.includes("mp4")) ext = "mp4";
    else console.warn("MP4 not available; saved as WebM instead.");

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neuron_visualization.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // the render loop calls this right after drawing (the WebGL buffer is only valid then)
  state.postRender = () => {
    const ctx = state.combinedCtx;
    ctx.drawImage(mainCanvas, dx, dy, dw, dh);
    ctx.drawImage(hud, dx, dy, dw, dh);
  };

  // keep frames coming while the simulation runs (the HUD clock changes even if the 3D view is idle)
  const interval = 1000 / RECORD_FPS;
  let last = 0;
  function tick(time) {
    if (!state.mediaRecorder || state.mediaRecorder.state !== "recording") return;
    if (time - last >= interval - 2) {
      last = time;
      requestRender();
    }
    requestAnimationFrame(tick);
  }

  state.mediaRecorder.start(1000); // emit data in 1 s slices instead of holding one huge buffer
  requestRender();
  requestAnimationFrame(tick);
}

function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") state.mediaRecorder.stop();
}

function showRecordingUI(recording) {
  $("rec-indicator").style.display = recording ? "block" : "none";
  recStartBtn.style.display = recording ? "none" : "inline-block";
  recStopBtn.style.display = recording ? "inline-block" : "none";
}

// Called when playback ends: finish the recording (and download it) if one is running.
export function stopRecordingIfActive() {
  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    stopRecording();
    showRecordingUI(false);
    clearSpikes();
  }
}

export function initRecordingButtons() {
  recStartBtn.addEventListener("click", () => {
    startRecording(canvas, hudCanvas);
    showRecordingUI(true);
  });

  recStopBtn.addEventListener("click", () => {
    stopRecording();
    showRecordingUI(false);
  });
}
