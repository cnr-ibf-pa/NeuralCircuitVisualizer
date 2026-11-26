// Builds the neuron point cloud (geometry + shader material) from the loaded network data.
import * as THREE from "three";
import { state } from "./state.js";
import { $, recStartBtn, connectionPanel } from "./dom.js";
import { parameters, params } from "./config.js";
import { regionOfNtype } from "./labels.js";
import { setSpikePanels, generateTable, removeTable } from "./ui.js";
import { startRenderLoop, requestRender, updateSceneCenter, applyPixelRatio } from "./scene.js";
import { restorePoseOnce, centerCameraToObject, resetCamera } from "./camera.js";
import { resetPickGrid } from "./picking.js";
import { initRaycaster, onPointerMove, hidePopup } from "./popup.js";
import { computePCA, createArrowOverlayFromPCA } from "./arrows.js";
import { drawNeuronConnections, hideConnections } from "./connections.js";
import { initPanelToggles } from "./gui.js";
import { disposeSpikes } from "./spikes.js";

const HUMAN_FULL_EXC_LIMIT = 4800001;
const HUMAN_HALF_EXC_LIMIT = 2400001;

// ---------- 1. clear previous cloud (only when not loading a prepared network) ----------
function resetVisualization() {
  state.positions = [];
  state.sizes = [];
  state.gIDs = [];
  state.neuron_class = [];
  state.vertexColors = [];

  if (state.particles) {
    state.scene.remove(state.particles);
    if (state.particles.geometry) state.particles.geometry.dispose();
    state.particles = null; // the ShaderMaterial is shared and reused, so it is not disposed
  }

  $("lblnetwork").innerText = "# neurons :";
  setSpikePanels(false);
  removeTable();
  state.total_excitatory = 0;
  state.total_inhibitory = 0;
}

// ---------- 2. collect vertex data ----------
// Human circuit (full or half) and uploaded circuits (HDF5 / SONATA) are converted straight into
// pre-sized typed arrays (no per-component push), then the raw per-neuron objects are released.
function countNeurons() {
  return state.NetworkArray.reduce((n, net) => n + net.length, 0);
}

// excitatory/inhibitory split by gid
function collectHuman() {
  const total = countNeurons();
  const limit = state.ishalf ? HUMAN_HALF_EXC_LIMIT : HUMAN_FULL_EXC_LIMIT;
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const gIDs = new Float64Array(total);
  let exc = 0;
  let inh = 0;
  let k = 0;

  state.NetworkArray.forEach((net) => {
    for (let i = 0; i < net.length; i++, k++) {
      const p = net[i];
      const k3 = k * 3;
      positions[k3] = p.x;
      positions[k3 + 1] = p.y;
      positions[k3 + 2] = p.z;
      gIDs[k] = p.id;
      if (p.id < limit) {
        colors[k3 + 2] = 1; // blue
        exc++;
      } else {
        colors[k3] = 1; // red
        inh++;
      }
    }
    state.totalParticles += net.length;
  });

  state.positions = positions;
  state.vertexColors = colors;
  state.sizes = new Float32Array(total).fill(30);
  state.gIDs = gIDs;
  state.total_excitatory = exc;
  state.total_inhibitory = inh;
  state.ishalf = false;
  state.ishuman = false;
}

// colour by cell_type if present, else by gid threshold
function collectUploaded() {
  const total = countNeurons();
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const gIDs = new Float64Array(total);
  const byCellType = state.cell_type > 0;
  const excLimit = state.total_excitatory;
  let k = 0;

  state.NetworkArray.forEach((net) => {
    for (let i = 0; i < net.length; i++, k++) {
      const p = net[i];
      const k3 = k * 3;
      positions[k3] = p.x;
      positions[k3 + 1] = p.y;
      positions[k3 + 2] = p.z;
      gIDs[k] = p.id;

      // use the record's own cell_type (the server fills it from the gid ranges when the CSV has none)
      const hasType = p.cell_type !== undefined && p.cell_type !== null;
      const excitatory = hasType ? p.cell_type == 0 : byCellType ? false : p.id < excLimit;
      const inhibitory = hasType ? p.cell_type == 1 : byCellType ? false : !excitatory;
      if (excitatory) colors[k3 + 2] = 1; // blue
      else if (inhibitory) colors[k3] = 1; // red
    }
    state.totalParticles += net.length;
  });

  state.positions = positions;
  state.vertexColors = colors;
  state.sizes = new Float32Array(total).fill(parameters.Neuron_Size);
  state.gIDs = gIDs;
}

// Hippocampal formation: only the ticked neuron types / layers; colour by region.
// Two passes (count, then fill typed arrays) with Set lookups - no per-neuron string
// conversion, array spreading or intermediate arrays.
function collectHippocampome() {
  const ntypes = new Set();
  state.selectedCheckboxIds.forEach((id) => {
    const n = Number(id);
    if (Number.isFinite(n)) ntypes.add(n);
  });
  const layers = new Set(state.selectedCheckboxByLayer);

  // pass 1: how many neurons match?
  let total = 0;
  state.NetworkArray.forEach((net, index) => {
    const layerOn = layers.has(index);
    for (let i = 0; i < net.length; i++) if (layerOn || ntypes.has(+net[i].ntype)) total++;
  });

  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const sizes = new Float32Array(total).fill(parameters.Neuron_Size);
  const gIDs = new Float64Array(total);
  const classes = new Float32Array(total);

  // pass 2: fill
  let k = 0;
  let exc = 0;
  let inh = 0;
  state.NetworkArray.forEach((net, index) => {
    const layerOn = layers.has(index);
    for (let i = 0; i < net.length; i++) {
      const p = net[i];
      if (!(layerOn || ntypes.has(+p.ntype))) continue;

      const k3 = k * 3;
      if (p.type === 1) {
        const region = regionOfNtype(Number(p.ntype));
        if (region) {
          const rgb = state.regionRGB[region.name];
          colors[k3] = rgb[0];
          colors[k3 + 1] = rgb[1];
          colors[k3 + 2] = rgb[2];
        }
        exc++;
      } else {
        colors[k3] = 1;
        colors[k3 + 1] = 0;
        colors[k3 + 2] = 0;
        inh++;
      }

      positions[k3] = p.x;
      positions[k3 + 1] = p.y;
      positions[k3 + 2] = p.z;
      gIDs[k] = p.id;
      classes[k] = Number(p.ntype);
      k++;
    }
  });

  state.positions = positions;
  state.vertexColors = colors;
  state.sizes = sizes;
  state.gIDs = gIDs;
  state.neuron_class = classes;
  state.totalParticles += total;
  state.total_excitatory += exc;
  state.total_inhibitory += inh;
}

// ---------- 3. geometry + material ----------
const attr = (arr, itemSize) => (arr instanceof Float32Array ? new THREE.BufferAttribute(arr, itemSize) : new THREE.Float32BufferAttribute(arr, itemSize));

function buildGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", attr(state.positions, 3));
  g.setAttribute("color", attr(state.vertexColors, 3));
  g.setAttribute("size", attr(state.sizes, 1));
  g.setAttribute("gid", attr(state.gIDs, 1));
  g.setAttribute("mtype", attr(state.neuron_class, 1));
  // separate copy: the live colour buffer is modified by spikes / hover
  g.setAttribute("originalColor", new THREE.Float32BufferAttribute(state.vertexColors, 3));
  state.geometry = g;
}

// The ShaderMaterial is created once (shader compile is slow) and reused for every rebuild.
function buildMaterial() {
  if (state.material) {
    state.uniforms.uPixelRatio.value = state.renderer.getPixelRatio();
    return;
  }

  const gl = state.renderer.getContext();
  const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE); // [min, max]

  state.uniforms = {
    uPixelRatio: { value: state.renderer.getPixelRatio() },
    uBaseSize: { value: parameters.Neuron_Size },
    uMaxSize: { value: range ? range[1] : 2048.0 }, // clamp by GPU
    uBrightness: { value: 1.0 },
    pointTexture: { value: null },
  };

  state.material = new THREE.ShaderMaterial({
    uniforms: state.uniforms,
    vertexShader: $("vertexshader").textContent,
    fragmentShader: $("fragmentshader").textContent,
    transparent: true,
    vertexColors: true,
    depthTest: true,
    depthWrite: true,
    blending: THREE.NormalBlending,
  });
}

// ---------- main entry ----------
export function VisualizateNeurons() {
  // flagged (human / uploaded) circuits release their raw data after the first build, and their
  // look does not depend on any control, so a repeat call has nothing to do
  if (state.flag && state.particles && state.NetworkArray.length === 0) return;

  if (!state.flag) resetVisualization();

  state.totalParticles = 0;

  if (state.flag) {
    if (state.ishuman) collectHuman();
    else collectUploaded();
  } else if (state.selectedCheckboxIds.length > 0 || state.selectedCheckboxByLayer.length > 0) {
    collectHippocampome();
  }

  if (state.flag) state.NetworkArray = []; // free millions of per-neuron objects
  setSpikePanels(true);
  $("lblnetwork").innerText = "# neurons :" + state.totalParticles;
  generateTable(state.totalParticles, state.total_excitatory, state.total_inhibitory);

  // flagged circuits keep the old cloud until here; drop it so it is not drawn twice
  if (state.particles) {
    state.scene.remove(state.particles);
    state.particles.geometry.dispose();
  }
  disposeSpikes(); // spikes of the previous network

  buildGeometry();
  buildMaterial();
  applyPixelRatio();
  resetPickGrid();

  state.particles = new THREE.Points(state.geometry, state.material);
  state.scene.add(state.particles);

  // restore a user-saved camera pose, otherwise frame the data (without saving)
  if (!restorePoseOnce()) centerCameraToObject(state.particles);

  state.gidIndexMap = null; // rebuilt lazily when spikes / connections need it
  initRaycaster();
  document.removeEventListener("pointermove", onPointerMove);
  document.addEventListener("pointermove", onPointerMove, { passive: false });

  if (state.loadmouseflag) {
    resetCamera();
    centerCameraToObject(state.particles);
  }
  state.scene.background = new THREE.Color(params.Backgound);

  initPanelToggles(); // only acts the first time

  const pcaAxes = computePCA(state.positions);
  if (pcaAxes) createArrowOverlayFromPCA(pcaAxes);

  updateSceneCenter();
  drawNeuronConnections();
  startRenderLoop();
  requestRender();
}

// ---------- reset everything that belongs to the currently loaded network ----------
export function clearScene() {
  disposeSpikes();
  if (state.particles) {
    state.scene.remove(state.particles);
    state.isHippocamome = false;
    state.isDownloadTriggered = false;

    if (state.particles.geometry) state.particles.geometry.dispose();
    if (state.particles.material) {
      if (Array.isArray(state.particles.material)) state.particles.material.forEach((m) => m.dispose());
      else state.particles.material.dispose();
    }
    state.particles = null;

    // clear popup content and hide it
    hidePopup();
    ["neuron-gid", "neuron-etype", "neuron-layer", "neuron-morph_class", "neuron-mtype", "neuron-region"].forEach((id) => {
      $(id).textContent = "";
    });
    document.querySelectorAll(".hideable").forEach((el) => {
      el.style.display = "none";
    });

    state.hoveredIndex = -1;
  }

  state.positions = [];
  state.sizes = [];
  state.gIDs = [];
  state.vertexColors = [];
  state.neuron_class = [];
  state.NetworkArray = [];
  state.totalParticles = 0;
  state.total_neurons = 0;

  $("lblnetwork").innerText = "# neurons :";
  setSpikePanels(false);
  removeTable();
  recStartBtn.style.display = "none";
  connectionPanel.style.visibility = "hidden";
  hideConnections();
  requestRender();
}
