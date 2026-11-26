// Entry point: wires every module together.  Load with
//   <script type="module" src="/static/js/main.js"></script>
import { initHistogramModal } from "./ui.js";
import { initConnections } from "./connections.js";
import { initCircuitButtons } from "./circuits.js";
import { initUploads } from "./uploads.js";
import { initActivityDropdown } from "./activity.js";
import { initColorPickers } from "./colors.js";
import { initPlaybackControls, setupPlaybackConfigListeners } from "./playback.js";
import { initSelection, disableAllElements } from "./selection.js";
import { initPlaybackPanelOpen } from "./gui.js";
import { initRecordingButtons } from "./recording.js";
import { initHistDownload } from "./histogram.js";
import { CreateScene, initResizeHandlers } from "./scene.js";
import { initCameraKeys } from "./camera.js";
import { initPopupSystem } from "./popup.js";

document.querySelector(".progressbar").style.visibility = "hidden";

// UI wiring
initHistogramModal();
initColorPickers();
initConnections();
initCircuitButtons();
initUploads();
initActivityDropdown();
initPlaybackControls();
window.addEventListener("DOMContentLoaded", setupPlaybackConfigListeners);
initSelection();
initPlaybackPanelOpen();
initRecordingButtons();
initHistDownload();
initResizeHandlers();
initCameraKeys();

// 3D scene
CreateScene();
initPopupSystem();
disableAllElements();
