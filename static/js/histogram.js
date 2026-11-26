// Interactive spike histogram (Chart.js is expected as a global `Chart`).
import { state } from "./state.js";
import { $, currentTimeDisplay } from "./dom.js";
import { smoothSeries, nearestIndex } from "./utils.js";

const fmtThousands = (v) => Number(v).toLocaleString();

// vertical white line marking the current simulation time
const cursorPlugin = {
  id: "timeCursor",
  afterDraw(chart) {
    if (state.currentCursorMs == null) return;
    const {
      ctx,
      chartArea,
      scales: { x },
    } = chart;
    if (state.currentCursorMs < x.min || state.currentCursorMs > x.max) return;
    const xPix = x.getPixelForValue(state.currentCursorMs);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(xPix, chartArea.top);
    ctx.lineTo(xPix, chartArea.bottom);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.stroke();
    ctx.restore();
  },
};

// ±SD whiskers drawn every `stride` points of the mean dataset (index 2)
const errorBarsPlugin = {
  id: "errorBars",
  afterDatasetsDraw(chart, _args, opts) {
    const { stride = 8, capWidth = 8, color = "rgba(0,0,0,0.9)", lineWidth = 1 } = opts || {};
    const {
      ctx,
      scales: { x, y },
    } = chart;
    const meanMeta = chart.getDatasetMeta(2);
    if (!meanMeta?.data?.length) return;
    ctx.save();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    for (let i = 0; i < meanMeta.data.length; i += stride) {
      const xMs = chart.config.data.datasets[2].data[i].x;
      const yMean = chart.config.data.datasets[2].data[i].y;
      const sd = chart.$histSD?.[i] ?? 0;
      if (sd <= 0) continue;
      const xPix = x.getPixelForValue(xMs);
      const yTop = y.getPixelForValue(yMean + sd);
      const yBot = y.getPixelForValue(Math.max(0, yMean - sd));
      ctx.beginPath();
      ctx.moveTo(xPix, yTop);
      ctx.lineTo(xPix, yBot);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xPix - capWidth / 2, yTop);
      ctx.lineTo(xPix + capWidth / 2, yTop);
      ctx.moveTo(xPix - capWidth / 2, yBot);
      ctx.lineTo(xPix + capWidth / 2, yBot);
      ctx.stroke();
    }
    ctx.restore();
  },
};

export function buildOrUpdateHistChart(hist_data) {
  const ctx = $("histChart").getContext("2d");

  // X = ms, Y = counts
  state.histX = (hist_data.bin_centers || []).map(Number);
  state.histY = (hist_data.counts || []).map(Number);
  state.histSD = (hist_data.sd_poisson || []).map(Number);
  const { histX, histY, histSD } = state;

  // total-normalised MFR (matches benchmark / total network neurons)
  const mfr = Number(hist_data.mfr_total ?? hist_data.mfr ?? 0);
  const tMin = Number.isFinite(hist_data.t_min) ? Number(hist_data.t_min) : Math.min(...histX);
  const tMax = Number.isFinite(hist_data.t_max) ? Number(hist_data.t_max) : Math.max(...histX);

  if (!histX.length || !histY.length) return;

  // axis ranges from the raw counts
  const yMinRaw = Math.min(...histY);
  const yMaxRaw = Math.max(...histY);
  const ySpan = Math.max(1, yMaxRaw - yMinRaw);
  const yPad = Math.max(1, 0.08 * ySpan);
  const yMin = Math.max(0, yMinRaw - yPad);
  const yMax = yMaxRaw + yPad;
  const xMin = tMin;
  const xMax = tMax;

  const ySmooth = smoothSeries(histY, 7);
  const sdSmooth = smoothSeries(histSD, 7);

  const lower = ySmooth.map((v, i) => Math.max(0, v - (sdSmooth[i] || 0)));
  const upper = ySmooth.map((v, i) => v + (sdSmooth[i] || 0));

  const ptsMean = histX.map((x, i) => ({ x, y: ySmooth[i] }));
  const ptsLower = histX.map((x, i) => ({ x, y: lower[i] }));
  const ptsUpper = histX.map((x, i) => ({ x, y: upper[i] }));

  const config = {
    type: "line",
    data: {
      datasets: [
        { label: "Lower", data: ptsLower, borderWidth: 0, pointRadius: 0, fill: false, tooltip: { enabled: false } },
        { label: "SD band", data: ptsUpper, borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: "rgba(255,255,255,0.2)", borderColor: "rgba(128,128,128,0.2)", tooltip: { enabled: false } },
        { label: "Spikes/bin (smoothed)", data: ptsMean, borderWidth: 2, pointRadius: 0, spanGaps: true, tension: 0.3, borderColor: "white", backgroundColor: "white" },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      parsing: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      scales: {
        x: {
          type: "linear",
          min: xMin,
          max: xMax,
          title: { display: true, text: "Time (ms)", color: "#FFFFFF", font: { weight: "bold" } },
          ticks: { color: "#FFFFFF", maxTicksLimit: 8 },
          grid: { color: "rgba(255,255,255,0.15)" },
        },
        y: {
          beginAtZero: false,
          min: yMin,
          max: yMax,
          title: { display: true, text: "Spikes", color: "#FFFFFF", font: { weight: "bold" } },
          ticks: { color: "#FFFFFF", callback: fmtThousands },
          grid: { color: "rgba(255,255,255,0.15)" },
        },
      },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `Chunk ${state.selectedChunkNumber} — MFR: ${mfr.toFixed(2)} Hz`,
          color: "#FFFFFF",
          font: { weight: "bold", size: 14 },
          padding: { top: 4, bottom: 8 },
          align: "center",
        },
        tooltip: {
          filter: (c) => c.dataset.label === "Spikes/bin (smoothed)",
          backgroundColor: "rgba(0,0,0,0.90)",
          titleColor: "#FFFFFF",
          bodyColor: "#FFFFFF",
          titleFont: { weight: "bold" },
          bodyFont: { size: 12 },
          callbacks: {
            label: (c) => {
              const idx = nearestIndex(histX, c.parsed.x);
              const s = histSD[idx] ?? 0;
              return `Count: ${fmtThousands(histY[idx])}  ±SD≈ ${s.toFixed(2)}`;
            },
          },
        },
        errorBars: { stride: 10, capWidth: 10, color: "rgba(0,0,0,0.9)", lineWidth: 2 },
      },
      onClick: (evt, _els, chart) => {
        const x = chart.scales.x.getValueForPixel(evt.x);
        const idx = nearestIndex(histX, x);
        if (idx != null) seekToTime(histX[idx]);
      },
    },
    plugins: [Chart.registry.getPlugin("decimation") || { id: "noop" }, cursorPlugin, errorBarsPlugin],
  };

  if (state.histChart) state.histChart.destroy();
  state.histChart = new Chart(ctx, config);
  state.histChart.$histSD = sdSmooth;

  const ms0 = parseFloat($("timebar")?.value ?? hist_data.t_min ?? xMin);
  updateHistCursor(ms0);
  $("histChartContainer").style.display = "block";
}

// Redrawing the whole chart for every playback step is expensive; draw at most once per frame.
let cursorRaf = 0;
export function updateHistCursor(ms) {
  state.currentCursorMs = ms;
  if (!state.histChart || cursorRaf) return;
  cursorRaf = requestAnimationFrame(() => {
    cursorRaf = 0;
    if (state.histChart) state.histChart.draw();
  });
}

function seekToTime(ms) {
  const slider = $("timebar");
  if (slider) slider.value = ms.toFixed(1);
  currentTimeDisplay.textContent = (+ms).toFixed(1);
  state.previousTimeDisplay = currentTimeDisplay.textContent;
  updateHistCursor(+ms);
}

export function resetHistChart() {
  if (state.histChart) {
    state.histChart.destroy();
    state.histChart = null;
  }
  const container = $("histChartContainer");
  if (container) container.style.display = "none";
}

// "Download PNG" button
export function initHistDownload() {
  $("dlHistBtn").addEventListener("click", () => {
    if (!state.histChart) {
      alert("No chart to download yet.");
      return;
    }

    // draw onto an offscreen canvas with a solid background
    const src = state.histChart.canvas;
    const w = src.width;
    const h = src.height;
    const bg = getComputedStyle(src).backgroundColor || "#2b2f39";

    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d");
    ctx.fillStyle = bg === "rgba(0, 0, 0, 0)" ? "#2b2f39" : bg;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const link = document.createElement("a");
    link.href = off.toDataURL("image/png");
    link.download = `NCV_hist_chunk-${state.selectedChunkNumber}_${stamp}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
}
