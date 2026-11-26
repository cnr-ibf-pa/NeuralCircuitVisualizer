// lil-gui settings panel (neuron size, background, camera) and the panel toggle buttons.
import { GUI } from "three/addons/libs/lil-gui.module.min.js";
import { state } from "./state.js";
import { $ } from "./dom.js";
import { params, parameters } from "./config.js";
import { requestRender } from "./scene.js";
import { markFull } from "./gpu.js";
import { savePoseNow, restorePoseOnce, resetToInitialPose, camSpeed, panCamera, dollyScale } from "./camera.js";

let _cameraFolderMade = false; // guard against duplicate folders / listeners

function makeCameraFolder(gui) {
  if (_cameraFolderMade) return;
  _cameraFolderMade = true;

  const { camera, controls } = state;
  const folder = gui.addFolder("Camera");
  const model = { px: camera.position.x, py: camera.position.y, pz: camera.position.z };

  let applyScheduled = false;
  function applyOncePerFrame() {
    if (applyScheduled) return;
    applyScheduled = true;
    requestAnimationFrame(() => {
      applyScheduled = false;
      camera.position.set(model.px, model.py, model.pz);
      controls?.update();
    });
  }

  const RANGE = 200000;
  const STEP = 1;

  // onFinishChange: fires when the user releases the slider
  const c_px = folder.add(model, "px", 0, RANGE, STEP).name("x").onFinishChange(applyOncePerFrame);
  const c_py = folder.add(model, "py", 0, RANGE, STEP).name("y").onFinishChange(applyOncePerFrame);
  const c_pz = folder.add(model, "pz", 0, RANGE, STEP).name("z").onFinishChange(applyOncePerFrame);

  const syncSliders = () => {
    model.px = camera.position.x;
    model.py = camera.position.y;
    model.pz = camera.position.z;
    c_px.updateDisplay();
    c_py.updateDisplay();
    c_pz.updateDisplay();
  };

  const btnSave = folder.add({ Save: () => savePoseNow() }, "Save").name("Save");
  const btnRestore = folder
    .add(
      {
        Restore: () => {
          if (restorePoseOnce()) syncSliders();
          else console.info("No saved pose to restore.");
        },
      },
      "Restore"
    )
    .name("Restore");
  const btnClear = folder.add({ Reset: () => resetToInitialPose() }, "Reset").name("Reset");

  // put the three buttons on one line
  const row = document.createElement("div");
  row.className = "gui-inline-row";
  row.style.display = "flex";
  row.style.gap = "8px";
  row.style.padding = "0px 8px";
  row.style.backgroundColor = "#b8b8b7";
  row.style.color = "#222";
  folder.domElement.appendChild(row);
  [btnSave, btnRestore, btnClear].forEach((ctl) => {
    row.appendChild(ctl.domElement);
    const el = ctl.domElement;
    el.style.margin = "0";
    el.style.height = "auto";
    el.style.width = "auto";
    el.style.overflow = "visible";
    el.style.flex = "0 0 auto";
  });
  folder.domElement.style.overflow = "visible";

  // throttled Trackball -> GUI sync (no storage writes here)
  let syncTimer = null;
  controls?.addEventListener("change", () => {
    if (syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      syncSliders();
    }, 120);
  });

  folder.open();
  return folder;
}

function makeCameraNavigationFolder(gui) {
  const cameraNav = gui.addFolder("Camera Navigation");

  // zoom slider
  const zoomParams = { zoomAmount: 0 };
  let lastZoom = 0;
  cameraNav
    .add(zoomParams, "zoomAmount", -1000, 1000)
    .name("Zoom Slider")
    .onChange((v) => {
      const delta = v - lastZoom;
      lastZoom = v;
      dollyScale(Math.exp(delta * 0.002)); // delta > 0 => zoom IN
    });

  const navActions = {
    zoomIn: () => dollyScale(Math.exp(+0.1)),
    zoomOut: () => dollyScale(Math.exp(-0.1)),
    up: () => panCamera(0, -camSpeed()),
    down: () => panCamera(0, +camSpeed()),
    left: () => panCamera(+camSpeed(), 0),
    right: () => panCamera(-camSpeed(), 0),
  };

  const grid = document.createElement("div");
  grid.className = "cam-grid";
  grid.innerHTML = `
        <button type="button" data-a="zoomIn">Zoom In  +</button>
        <button type="button" data-a="zoomOut">Zoom Out -</button>
        <button type="button" data-a="up">Move Up ↑</button>
        <button type="button" data-a="down">Move Down ↓</button>
        <button type="button" data-a="left">Move Left ←</button>
        <button type="button" data-a="right">Move Right →</button>
        `;
  cameraNav.domElement.appendChild(grid);

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-a]");
    if (!btn) return;
    const fn = navActions[btn.dataset.a];
    if (fn) fn();
  });

  cameraNav.domElement.style.overflow = "visible";
  cameraNav.open();
}

// mouse wheel: zoom; with SHIFT/ALT: pan (two-finger trackpad works too)
function initWheelGestures() {
  if (state.controls) state.controls.enableZoom = false; // we handle the wheel ourselves

  const WHEEL_ZOOM_SENS = 0.0015;
  const WHEEL_PAN_SENS = 0.002;

  state.renderer.domElement.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.shiftKey || e.altKey) {
        const dx = (e.deltaX || 0) * WHEEL_PAN_SENS * camSpeed();
        const dy = (e.deltaY || 0) * WHEEL_PAN_SENS * camSpeed();
        panCamera(-dx, -dy);
      } else {
        dollyScale(Math.exp(-e.deltaY * WHEEL_ZOOM_SENS)); // wheel up => zoom IN
      }
    },
    { passive: false }
  );
}

function createGui(panel) {
  panel.style.display = "block";

  const gui = new GUI({ autoPlace: false });
  gui.domElement.id = "gui";
  panel.appendChild(gui.domElement);

  const pm = gui.addFolder("Sphere Material");
  pm.add(parameters, "Neuron_Size", 1, 1000).onChange((value) => {
    const sizes = state.geometry.attributes.size.array;
    for (let i = 0; i < sizes.length; i++) sizes[i] = value;
    markFull(state.geometry.attributes.size);
    requestRender();
  });

  pm.add(parameters, "Firing_Neuron_Size", 1, 1000).onChange((value) => {
    state.spikeNeuronSize = value; // spiking neurons are drawn by the overlay; the peak size is read every step
    requestRender();
  });

  const bgcolor = gui.addFolder("Background");
  bgcolor.addColor(params, "Backgound").onChange((value) => {
    state.scene.background.set(value);
    requestRender();
  });
  bgcolor.close();

  makeCameraFolder(gui);
  makeCameraNavigationFolder(gui);
  initWheelGestures();
}

// Wire up the "settings" and "playback" panel buttons (once, after the first render).
export function initPanelToggles() {
  if (state.panelsInitialised) return;
  state.panelsInitialised = true;

  let guiCreated = false;
  let playbackToggled = false;

  $("togglePanelBtn").style.display = "block";
  $("btnopen").style.display = "block";

  $("togglePanelBtn").addEventListener("click", () => {
    const panel = $("panel");
    if (!guiCreated) {
      createGui(panel);
      guiCreated = true;
    } else {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    }
  });

  $("btnopen").addEventListener("click", () => {
    const playbackcontainer = $("playbackcontainer");
    if (!playbackToggled) {
      playbackcontainer.style.display = "block";
      playbackToggled = true;
    } else {
      playbackcontainer.style.display = playbackcontainer.style.display === "none" ? "block" : "none";
      playbackToggled = false;
    }
  });
}

// (kept from the original) opening the playback panel always makes it visible first
export function initPlaybackPanelOpen() {
  document.addEventListener("DOMContentLoaded", () => {
    $("btnopen").addEventListener("click", () => {
      $("playbackcontainer").style.display = "block";
    });
  });
}
