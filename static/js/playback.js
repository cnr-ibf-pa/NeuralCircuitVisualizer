// Playback timeline: animation loop, start/pause/restart, time inputs, step settings.
import { state } from "./state.js";
import { playbackConfig } from "./config.js";
import { $, hudCtx, timebar, currentTimeDisplay, startTimeInput, endTimeInput, startButton, stopButton, restartButton } from "./dom.js";
import { toNum1 } from "./utils.js";
import { advanceSpikes, resetParticles, clearSpikes, downloadSimulationCSV } from "./spikes.js";
import { updateHistCursor } from "./histogram.js";
import { stopRecordingIfActive } from "./recording.js";

// ---------- HUD ----------
function drawHUDTimeToCanvas2D(ctx, count, endVal) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.font = "bold 32px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "white";
  ctx.fillText(`t = ${parseFloat(count).toFixed(1)} / ${parseFloat(endVal).toFixed(1)} ms`, ctx.canvas.width / 2, 10);
}

// ---------- animation loop ----------
// Playback is paced by the wall clock: one simulation step per `stepDuration` ms (browser timers
// never fire faster than ~4 ms).  When a frame takes long to draw (millions of big overlapping
// spikes) timer ticks are delayed; instead of silently slowing the simulation down, the ticks that
// were missed are caught up here, within a small CPU budget per tick.
const MIN_PERIOD_MS = 4;
const MAX_STEPS_PER_TICK = 50;
const TICK_BUDGET_MS = 10;

export function startAnimation(startVal, endVal) {
  if (state.interval) clearInterval(state.interval);

  let last = null; // time of the previous tick
  let owed = 0; // fractional steps that are due

  // run one step; returns false when playback finished
  const step = () => {
    advanceSpikes(state.count, state.spikeNeuronSize);

    if (state.count >= endVal || state.count >= state.lasttime) {
      clearInterval(state.interval);
      state.interval = null;
      resetParticles();

      state.count = 0.0;
      stopRecordingIfActive();

      state.isPaused = true; // allow future play
      stopButton.disabled = true;
      startButton.disabled = false;
      restartButton.disabled = false;

      state.count = startVal; // reset for next run
      if (state.selectedChunkNumber > 0) {
        state.count = parseFloat(state.firstKey).toFixed(1);
        currentTimeDisplay.textContent = state.count;
      }
      state.isFinished = true;
      return false;
    }

    state.count = parseFloat((parseFloat(state.count) + parseFloat(playbackConfig.simTimestep)).toFixed(1));
    return true;
  };

  state.interval = setInterval(() => {
    if (state.isPaused) {
      last = null;
      return;
    }

    const now = performance.now();
    const period = Math.max(playbackConfig.stepDuration, MIN_PERIOD_MS);
    owed += last === null ? 1 : (now - last) / period;
    last = now;
    const steps = Math.max(1, Math.min(Math.floor(owed), MAX_STEPS_PER_TICK));
    owed = Math.min(owed - steps, MAX_STEPS_PER_TICK); // never build an unbounded backlog

    for (let i = 0; i < steps; i++) {
      if (!step()) return;
      if (performance.now() - now > TICK_BUDGET_MS) break; // keep the page responsive
    }
    timebar.value = state.count;
    currentTimeDisplay.textContent = parseFloat(state.count).toFixed(1);
    drawHUDTimeToCanvas2D(hudCtx, state.count, endVal);
    updateHistCursor(+state.count);
  }, playbackConfig.stepDuration);
}

// ---------- resets ----------
export function resetSpikeState() {
  clearInterval(state.interval);
  state.interval = null;
  state.isPaused = true;
  state.count = 0;

  state.Activitys = {};
  state.gids_activity_indexes = {};
  state.timeRanges = [];

  currentTimeDisplay.textContent = "0.0";
  timebar.value = 0;
}

export function resetTimeUI() {
  $("current-time").textContent = "0.0";
  $("total-time").textContent = "0.0";

  timebar.min = 0;
  timebar.max = 100; // updated once new data is loaded
  timebar.value = 0;

  $("start-time").value = "";
  $("end-time").value = "";

  startButton.disabled = true;
  stopButton.disabled = true;
  restartButton.disabled = true;
}

export function resetPlaybackConfig() {
  const defaultSimTimestep = 0.1;
  const defaultStepDuration = 0;

  playbackConfig.simTimestep = defaultSimTimestep;
  playbackConfig.stepDuration = defaultStepDuration;

  const simSlider = $("simTimestepRange");
  const stepSlider = $("stepDurationRange");

  simSlider.value = defaultSimTimestep;
  $("simTimestepValue").value = defaultSimTimestep;
  stepSlider.value = defaultStepDuration;
  $("stepDurationValue").value = defaultStepDuration;

  updateSliderTrack(simSlider, defaultSimTimestep);
  updateSliderTrack(stepSlider, defaultStepDuration);
}

// ---------- sliders ----------
function updateSliderTrack(slider, value) {
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const val = value !== undefined ? parseFloat(value) : parseFloat(slider.value);
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.background = `linear-gradient(to right, #2a6b38 0%, #2a6b38 ${pct}%, #2b2727 ${pct}%, #2b2727 100%)`;
}

function restartWithNewStepDuration() {
  if (state.interval) {
    clearInterval(state.interval);
    startAnimation(state.count, state.lasttime);
  }
}

export function setupPlaybackConfigListeners() {
  const simSlider = $("simTimestepRange");
  const simInput = $("simTimestepValue");
  const stepSlider = $("stepDurationRange");
  const stepInput = $("stepDurationValue");

  simSlider.addEventListener("input", () => {
    simInput.value = simSlider.value;
    playbackConfig.simTimestep = parseFloat(simSlider.value);
    updateSliderTrack(simSlider);
  });

  simInput.addEventListener("input", () => {
    const val = parseFloat(simInput.value);
    if (!isNaN(val)) {
      simSlider.value = val;
      playbackConfig.simTimestep = val;
      updateSliderTrack(simSlider, val);
    }
  });

  stepSlider.addEventListener("input", () => {
    stepInput.value = stepSlider.value;
    playbackConfig.stepDuration = parseInt(stepSlider.value);
    updateSliderTrack(stepSlider);
    restartWithNewStepDuration();
  });

  stepInput.addEventListener("input", () => {
    const val = parseInt(stepInput.value);
    if (!isNaN(val)) {
      stepSlider.value = val;
      playbackConfig.stepDuration = val;
      updateSliderTrack(stepSlider, val);
      restartWithNewStepDuration();
    }
  });

  updateSliderTrack(simSlider);
  updateSliderTrack(stepSlider);
}

// ---------- transport controls ----------
export function initPlaybackControls() {
  // start time input
  startTimeInput.addEventListener("change", () => {
    let newStart = parseFloat(startTimeInput.value) || 0.0;

    if (newStart < 0) {
      alert("Start time cannot be negative");
      startTimeInput.value = "";
    } else if (newStart < parseFloat(state.previousTimeDisplay).toFixed(1)) {
      alert("Start time cannot be less than start simulation time");
      startTimeInput.value = "";
    } else if (newStart === 0.0) {
      startTimeInput.value = "";
      state.count = parseFloat(state.previousTimeDisplay).toFixed(1);
      timebar.value = state.count;
      currentTimeDisplay.textContent = parseFloat(state.previousTimeDisplay).toFixed(1);
    } else {
      newStart = Math.max(0, newStart);
      startTimeInput.value = newStart.toFixed(1);
      state.count = newStart;
      timebar.value = newStart;
      currentTimeDisplay.textContent = newStart.toFixed(1);
    }

    resetParticles();
  });

  // end time input
  endTimeInput.addEventListener("change", () => {
    const newEnd = parseFloat(endTimeInput.value) || parseFloat(state.lasttime);

    if (parseFloat(startTimeInput.value) >= parseFloat(endTimeInput.value)) {
      alert("End time can not be less than or equal to start time");
    } else if (newEnd < 0) {
      alert("End time cannot be negative");
      endTimeInput.value = "";
    } else if (newEnd > parseFloat(state.lasttime)) {
      alert("End time cannot be greater than simulation time");
      endTimeInput.value = "";
    } else if (startTimeInput.value == "") {
      endTimeInput.value = "";
    }

    resetParticles();
  });

  // timeline slider (scrubbing)
  timebar.addEventListener("input", (event) => {
    state.count = parseFloat(event.target.value);
    currentTimeDisplay.textContent = state.count.toFixed(1);
    resetParticles();

    updateHistCursor(parseFloat(event.target.value));
    // resetParticles() above already restored every colour and size

    if (state.isPaused) advanceSpikes(state.count, state.spikeNeuronSize);
  });

  // start / resume
  startButton.addEventListener("click", () => {
    const startVal = Math.max(0, parseFloat(startTimeInput.value)) || 0.0;
    const endVal = Math.max(0, parseFloat(endTimeInput.value)) || parseFloat(state.lasttime);

    const enableRunningButtons = () => {
      startButton.disabled = true;
      stopButton.disabled = false;
      restartButton.disabled = false;
    };

    // RESUME: keep bounds and current count
    if (state.isPaused && state.interval === null) {
      state.isPaused = false;
      state.count = toNum1(state.count);
      timebar.value = state.count;
      currentTimeDisplay.textContent = state.count.toFixed(1);

      enableRunningButtons();
      startAnimation(state.count, parseFloat(timebar.max) || endVal);
      return;
    }

    // FRESH start after a finished chunk
    if (state.selectedChunkNumber > 0 && state.isFinished) {
      state.isFinished = false;
      state.isPaused = false;

      const freshStart = parseFloat(state.firstKey);
      state.count = toNum1(freshStart);
      timebar.value = state.count;
      currentTimeDisplay.textContent = state.count.toFixed(1);

      timebar.min = state.count;
      timebar.max = endVal;

      enableRunningButtons();
      startAnimation(freshStart, endVal);
      state.wasEverStarted = true;
      return;
    }

    // first ever start (or restart with new inputs)
    if (!state.interval && !state.isPaused) {
      state.isPaused = false;
      state.count = toNum1(Math.max(Number(state.count) || 0, startVal));
      timebar.value = state.count;
      currentTimeDisplay.textContent = state.count.toFixed(1);

      timebar.min = state.count;
      timebar.max = endVal;

      enableRunningButtons();
      startAnimation(state.count, endVal);
      state.wasEverStarted = true;
    }
  });

  // pause
  stopButton.addEventListener("click", () => {
    clearInterval(state.interval);
    state.interval = null;
    state.isPaused = true;

    startButton.disabled = false;
    stopButton.disabled = true;
  });

  // restart
  restartButton.addEventListener("click", () => {
    let startVal, endVal;

    if (state.selectedChunkNumber > 0) {
      clearSpikes();
      startVal = toNum1(state.firstKey);
      endVal = toNum1(state.lasttime);
      state.count = startVal;
    } else {
      startVal = parseFloat(startTimeInput.value) || 0.0;
      endVal = parseFloat(endTimeInput.value) || parseFloat(state.lasttime);
      state.count = toNum1(startVal);
    }

    currentTimeDisplay.textContent = state.count.toFixed(1);

    clearInterval(state.interval);
    state.interval = null;
    resetParticles();

    timebar.min = startVal;
    timebar.max = endVal;
    timebar.value = state.count;

    state.isPaused = false;
    startButton.disabled = true;
    stopButton.disabled = false;

    startAnimation(startVal, endVal);
  });

  $("downloadLogBtn").addEventListener("click", downloadSimulationCSV);
}
