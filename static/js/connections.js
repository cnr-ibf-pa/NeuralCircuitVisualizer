// CA3 -> CA1 connection data (fetch) and the 3D connection wires (draw/filter/hide).
import * as THREE from "three";
import { state, raycaster, mouse } from "./state.js";
import { baseURL } from "./config.js";
import { $, btnLoadConnection } from "./dom.js";
import { getGidIndexMap } from "./lookups.js";
import { requestRender } from "./scene.js";
import { markFull } from "./gpu.js";
import { pickNeurons } from "./picking.js";
import { showLoader, hideLoader, setMessage, setProgress, showProgressText, startPhase, setPhaseDetail } from "./ui.js";

// ---------- fetch the CA3->CA1 connection map in pages ----------
async function fetchConnections() {
  let page = 1;
  let hasMore = true;
  let totalKeys = 1; // avoid division by zero
  let loadedKeys = 0;

  try {
    startPhase("Loading connections");
    while (hasMore) {
      const response = await fetch(`${baseURL}/api/fetchConnections/?page=${page}&chunk_size=10000`);
      const jsonData = await response.json();

      if (jsonData && jsonData.connections_chunk) {
        Object.assign(state.ca3toca1connections, jsonData.connections_chunk);

        if (page === 1) totalKeys = jsonData.total_keys || 1;
        loadedKeys += Object.keys(jsonData.connections_chunk).length;

        const pct = Math.min(Math.round((loadedKeys / totalKeys) * 100), 100);
        setProgress(`${pct}%`);
        setPhaseDetail(`${pct}% (${loadedKeys} / ${totalKeys} neurons)`);

        hasMore = jsonData.has_more;
        page++;
      } else {
        hasMore = false;
      }
    }

    setProgress("100%");
    await new Promise((resolve) => setTimeout(resolve, 150));
    hideLoader();

    state.isConnection = true;
  } catch (error) {
    console.error("Error fetching data:", error);
    hideLoader();
    setProgress("Error loading connections");
  }
}

// ---------- connection-type dropdown ----------
async function loadConnectionTypes(dropdown) {
  try {
    const res = await fetch(`${baseURL}/api/connection-types/`);
    const data = await res.json();
    if (data.types) {
      data.types.forEach((type) => {
        const opt = document.createElement("option");
        opt.value = type;
        opt.textContent = type;
        dropdown.appendChild(opt);
      });
    }
  } catch (error) {
    console.error("Failed to load connection types:", error);
  }
}

// used after a "download triggered" upload
export function populateConnectionDropdown() {
  return loadConnectionTypes($("connTypeDropdown"));
}

// ---------- drawing ----------
function disposeConnectionLines() {
  const lines = state.connectionLines;
  if (!lines) return;
  state.scene.remove(lines);
  lines.geometry?.dispose();
  lines.material?.dispose();
  lines.dispose?.(); // frees the instance matrix buffer
  state.connectionLines = null;
}

export function drawNeuronConnections() {
  disposeConnectionLines(); // old wires were previously leaked on every redraw

  const list = state.activeConnections || [];
  if (!list.length || state.connectionsHidden) {
    requestRender();
    return;
  }

  const baseGeometry = new THREE.CylinderGeometry(0.1, 0.1, 1, 4, 1, true);
  const baseMaterial = new THREE.MeshBasicMaterial({ color: 0xa0522d, transparent: true, opacity: 0.7 });

  const instancedMesh = new THREE.InstancedMesh(baseGeometry, baseMaterial, list.length);
  const dummy = new THREE.Object3D();
  const axis = new THREE.Vector3(0, 1, 0);

  // positions come straight from the position buffer; scratch vectors are reused
  const idxMap = getGidIndexMap();
  const pos = state.positions;
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const dir = new THREE.Vector3();

  let i = 0;
  for (const [sourceGID, targetGID] of list) {
    const si = idxMap.get(sourceGID);
    const ti = idxMap.get(targetGID);
    if (si === undefined || ti === undefined) continue;

    from.fromArray(pos, si * 3);
    to.fromArray(pos, ti * 3);
    dir.subVectors(to, from);

    dummy.position.addVectors(from, to).multiplyScalar(0.5);
    dummy.scale.set(1, dir.length(), 1);
    dummy.quaternion.setFromUnitVectors(axis, dir.normalize());
    dummy.updateMatrix();

    instancedMesh.setMatrixAt(i++, dummy.matrix);
  }

  instancedMesh.count = i;
  instancedMesh.instanceMatrix.needsUpdate = true;

  state.connectionLines = instancedMesh;
  state.scene.add(state.connectionLines);
  requestRender();
}

export function hideConnections() {
  state.connectionsHidden = true;
  state.activeConnections = [];
  if (state.scene) disposeConnectionLines();
  requestRender();
}

// ---------- click a neuron to isolate its outgoing connections ----------
function resetAllNeuronsAndConnections() {
  const colors = state.geometry.attributes.color.array;
  const sizes = state.geometry.attributes.size.array;

  for (let i = 0; i < state.gIDs.length; i++) {
    const base = i * 3;
    const isExcitatory = state.gIDs[i] < 261845;

    sizes[i] = 30;
    colors[base] = isExcitatory ? 0 : 1;
    colors[base + 1] = 0;
    colors[base + 2] = isExcitatory ? 1 : 0;
  }
  markFull(state.geometry.attributes.size);
  markFull(state.geometry.attributes.color);

  state.connectionsHidden = false;
  state.activeConnections = state.allConnections;
  drawNeuronConnections();
}

function showOnlyConnectionsFrom(sourceGID) {
  state.activeConnections = state.allConnections.filter(([from]) => from === sourceGID);

  const visibleGIDs = new Set([sourceGID]);
  for (const [, to] of state.activeConnections) visibleGIDs.add(to);

  // hide unrelated neurons by size 0, emphasise related ones
  const sizes = state.geometry.attributes.size.array;
  for (let i = 0; i < state.gIDs.length; i++) sizes[i] = visibleGIDs.has(state.gIDs[i]) ? 40 : 0;
  markFull(state.geometry.attributes.size);

  drawNeuronConnections();
}

function onNeuronClick(event) {
  if (state.connectionsHidden || !state.particles) return;
  if (event.target !== state.renderer.domElement) return; // ignore clicks on the UI

  const rect = state.renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, state.camera);
  const intersects = pickNeurons(raycaster, state.particles);

  if (intersects.length > 0) {
    const gid = state.gIDs[intersects[0].index];
    const hasConnections = state.allConnections.some(([from]) => from === gid);
    if (hasConnections) showOnlyConnectionsFrom(gid);
    else resetAllNeuronsAndConnections();
  }
}

// ---------- wiring ----------
export function initConnections() {
  btnLoadConnection.disabled = true;
  btnLoadConnection.addEventListener("click", () => {
    setMessage("Building Connection, please wait...\nCA3-PC to CA1-PC");
    showProgressText(true);
    setProgress("Loading connections: 0%");
    showLoader();
    fetchConnections();
  });

  document.addEventListener("click", onNeuronClick, false);

  document.addEventListener("DOMContentLoaded", () => {
    const dropdown = $("connTypeDropdown");
    if (!dropdown) {
      console.warn("connTypeDropdown not found");
      return;
    }

    loadConnectionTypes(dropdown);

    dropdown.addEventListener("change", async (e) => {
      const selectedType = e.target.value;

      if (selectedType === "hide") {
        hideConnections();
        return;
      }

      state.connectionsHidden = false; // selecting a dataset shows connections again

      try {
        const res = await fetch(`${baseURL}/api/connections/?type=${selectedType}`);
        const data = await res.json();
        if (data.connections) {
          state.allConnections = data.connections;
          state.activeConnections = state.allConnections;
          drawNeuronConnections();
        }
      } catch (err) {
        console.error("Error loading selected connections:", err);
      }
    });
  });
}
