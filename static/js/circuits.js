// Built-in circuits: Hippocampal formation (all layers) and the human circuit (full / half).
import { state } from "./state.js";
import { baseURL } from "./config.js";
import { btnLoadConnection, dropdown, recStartBtn } from "./dom.js";
import { hideLoader, showLoader, setMessage, setProgress, showProgressText, popupDropdownActivity, fetchJson, startPhase, nextFrame } from "./ui.js";
import { clearScene, VisualizateNeurons } from "./neurons.js";
import { resetSpikeState, resetTimeUI, resetPlaybackConfig } from "./playback.js";
import { resetCamera, centerCameraToObject } from "./camera.js";
import { resetAndDisableAllCheckboxes, enableAllElements } from "./selection.js";

async function LoadHipForm() {
  try {
    clearScene();
    resetSpikeState();
    resetPlaybackConfig();
    resetTimeUI();
    state.flag = false;

    const files = (await fetchJson(`${baseURL}/api/LoadAllLayers/`, undefined, "hippocampal layers")).files;
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
      const file = files[i];
      setMessage(`Please wait a moment while we process data for visualization. Your patience is appreciated. \n` + file.filename);
      setProgress(`${Math.round(((i + 1) / totalFiles) * 100)}%`);

      state.NetworkArray.push(file.fileData);
      state.total_neurons += file.total_neurons;
    }

    hideLoader();
    btnLoadConnection.disabled = false;
    state.isHippocamome = true;
  } catch (error) {
    console.error("Error fetching data:", error);
    hideLoader();
  }
}

async function LoadHumanHipForm(mode = "full") {
  try {
    btnLoadConnection.disabled = true;

    resetSpikeState();
    resetPlaybackConfig();
    resetTimeUI();
    clearScene();

    const data = await fetchJson(`${baseURL}/api/LoadHumanHipForm/?mode=${mode}`, undefined, `human circuit (${mode})`);

    state.NetworkArray.push(data.fileData);
    state.total_neurons = data.total_neurons;

    startPhase("Building 3D scene");
    setMessage("Building 3D scene...");
    await nextFrame();
    resetAndDisableAllCheckboxes();
    state.flag = true;

    state.ishuman = true;
    VisualizateNeurons();
    resetCamera();
    centerCameraToObject(state.particles);

    recStartBtn.style.display = "block";
    hideLoader();
  } catch (error) {
    console.error("Error fetching data:", error);
    hideLoader();
  }
}

export function initCircuitButtons() {
  window.addEventListener("load", () => {
    const humanActivity = ["Activity demo"];

    document.getElementById("btnLoadHumanNetwork_full").addEventListener("click", () => {
      setMessage("Loading full circuit, please wait...");
      showProgressText(false);
      showLoader({ build: true });
      LoadHumanHipForm("full");
      popupDropdownActivity(dropdown, humanActivity);
      state.circuitstatus = 1;
    });

    document.getElementById("btnLoadHumanNetwork_half").addEventListener("click", () => {
      setMessage("Loading half circuit, please wait...");
      showProgressText(false);
      showLoader({ build: true });
      LoadHumanHipForm("half");
      state.ishalf = true;
      popupDropdownActivity(dropdown, humanActivity);
      state.circuitstatus = 1;
    });

    document.getElementById("btnLoadAllLayers").addEventListener("click", () => {
      setMessage("Loading Hippocampal formation data, please wait...");
      showProgressText(false);
      showLoader();
      LoadHipForm();
      enableAllElements();
      state.loadmouseflag = true;
      popupDropdownActivity(dropdown, ["CA3 Activity", "MEC Activity"]);
      state.circuitstatus = 2;
    });
  });
}
