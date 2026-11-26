// Activity (spike) data loading: demo activity for the built-in circuits and the
// chunk dropdown ("Activity windows") for uploaded circuits.
import { state } from "./state.js";
import { baseURL } from "./config.js";
import { $, dropdown, timebar, currentTimeDisplay, totalTimeDisplay, startButton, stopButton, recStartBtn } from "./dom.js";
import { showLoader, hideLoader, setMessage, setProgress, setSpikePanels, fetchJson } from "./ui.js";
import { resetSpikeState, resetTimeUI, resetPlaybackConfig } from "./playback.js";
import { resetParticles } from "./spikes.js";
import { buildOrUpdateHistChart } from "./histogram.js";

// last time key (sorted numerically) -> state.lasttime + slider range
function applyLastKey(sortedKeys, parse = parseInt) {
  state.lastKey = sortedKeys[sortedKeys.length - 1];
  state.lasttime = parse(state.lastKey);
  totalTimeDisplay.textContent = state.lasttime;
  timebar.max = state.lasttime;
}

const sortKeys = (obj) => Object.keys(obj).sort((a, b) => parseFloat(a) - parseFloat(b));

// ---------- Hippocampal formation demo activity ----------
async function LoadActivityData(file_id) {
  try {
    showLoader();
    setProgress("0%");
    setMessage("Loading activity data...");

    const formData = new FormData();

    const ca3checkbox = $("AllCA3RegSwitchCheck");
    const eccheckbox = $("AllECRegSwitchCheck");
    const selectedActivity = dropdown.options[dropdown.selectedIndex].text;

    if (selectedActivity.includes("CA3") && !ca3checkbox.checked) {
      alert("You selected a CA3 activity file. Please enable the CA3 region in the network.");
      dropdown.selectedIndex = 0;
      return;
    }
    if (selectedActivity.includes("EC") && !eccheckbox.checked) {
      alert("You selected an EC activity file. Please enable the EC region in the network.");
      dropdown.selectedIndex = 0;
      return;
    }

    if (ca3checkbox.checked || eccheckbox.checked) {
      formData.append("gIDs", JSON.stringify(Array.from(state.geometry.attributes.gid.array)));
    } else {
      alert("Select spike region from network.");
      dropdown.selectedIndex = 0;
      return;
    }

    const data = await fetchJson(`${baseURL}/api/LoadActivityData/?dir=${file_id}`, { method: "POST", body: formData }, "activity");
    state.Activitys = data.data;
    state.timeRanges = data.keys;
    state.gids_activity_indexes = data.gids_activity_indexes;
    $("lblspikes").innerText = "# spikes: " + data.number_of_spikes;

    const sortedKeys = sortKeys(state.Activitys);
    if (sortedKeys.length > 0) applyLastKey(sortedKeys);

    startButton.disabled = false;
    recStartBtn.style.display = "block";
  } catch (error) {
    console.error("Error fetching data:", error);
    alert("An error occurred while loading activity data. Please try again.");
  } finally {
    hideLoader();
  }
}

async function loadActivity() {
  const ddindex = dropdown.selectedIndex;
  if (ddindex === 1 || ddindex === 2) await LoadActivityData(ddindex);
}

// ---------- Human circuit demo activity ----------
async function LoadHumanActivityData(file_id) {
  try {
    showLoader();
    setProgress("0%");
    setMessage("Loading Human activity data...");
    setSpikePanels(true, { table: false });

    const data = await fetchJson(`${baseURL}/api/LoadHumanActivityData/?dir=${file_id}`, { method: "POST" }, "human activity");
    state.Activitys = data.data;
    state.timeRanges = data.keys;
    state.gids_activity_indexes = data.gids_activity_indexes;
    $("lblspikes").innerText = "# spikes: " + data.number_of_spikes;

    const sortedKeys = sortKeys(state.Activitys);
    if (sortedKeys.length > 0) {
      applyLastKey(sortedKeys);
      state.spikeNeuronSize = 100;
    }

    startButton.disabled = false;
  } catch (error) {
    console.error("Error fetching data:", error);
    alert("An error occurred while loading activity data. Please try again.");
  } finally {
    hideLoader();
  }
}

async function loadHumanActivity() {
  const ddindex = dropdown.selectedIndex;
  if (ddindex == 1 || ddindex == 2) await LoadHumanActivityData(ddindex);
  else alert("select activity..");
}

// ---------- uploaded circuit: one activity chunk ----------
async function loadChunk() {
  try {
    showLoader();
    setMessage("Loading data..., please wait...");

    const data = await fetchJson(`${baseURL}/api/get_chunk_data/?dir=${state.uniqueDirectory}&chunk_number=${state.selectedChunkNumber}`, undefined, "activity chunk");

    setMessage("Chunk data loaded successfully!");

    if (!data.chunk_data || !data.gids_activity_indexes) {
      throw new Error("Missing chunk_data or gids_activity_indexes in API response.");
    }

    if (data.histogram) {
      $("histogramImage").src = "data:image/png;base64," + data.histogram;
      $("histChartContainer").style.display = "block";
    }

    state.Activitys = data.chunk_data;

    // interactive histogram
    if (data.hist_data && data.hist_data.bin_centers && data.hist_data.counts) buildOrUpdateHistChart(data.hist_data);

    const sortedKeys = sortKeys(state.Activitys);
    if (sortedKeys.length > 0) applyLastKey(sortedKeys, parseFloat);

    if (state.selectedChunkNumber > 0 && sortedKeys.length > 0) {
      state.firstKey = sortedKeys[0];
      state.count = parseFloat(state.firstKey).toFixed(1);
      currentTimeDisplay.textContent = state.count;
    } else {
      state.count = 0.0;
      currentTimeDisplay.textContent = state.count.toFixed(1);
    }

    state.timeRanges = sortedKeys;
    state.gids_activity_indexes = data.gids_activity_indexes;

    $("lblspikes").innerText = "# spikes :" + data.total_spikes;

    if (state.counter_check > 1) {
      clearInterval(state.interval);
      state.interval = null;
      state.isPaused = true;
      resetParticles();
    }

    state.previousTimeDisplay = parseFloat(currentTimeDisplay.textContent).toFixed(1);

    startButton.disabled = false;
    stopButton.disable = true; // (sic) original code - has no effect

    setSpikePanels(true);
  } catch (error) {
    console.error("Error fetching chunk data:", error);
    alert("Failed to fetch chunk data. Please try again.");
    setProgress("0%");
    setMessage("Error loading chunk.");
  } finally {
    hideLoader();
  }
}

export function initActivityDropdown() {
  dropdown.addEventListener("change", async function () {
    resetSpikeState();
    resetPlaybackConfig();
    resetTimeUI();
    state.counter_check += 1;
    state.selectedChunkNumber = this.value;

    if (!state.selectedChunkNumber || state.selectedChunkNumber === "Select Activity Chunk") return;

    if (state.circuitstatus == 1) loadHumanActivity();
    else if (state.circuitstatus == 2) loadActivity();
    else if (state.circuitstatus == 3) await loadChunk();
  });
}
