// Spike visualisation: flash neurons that fire (yellow / white), fade them back, reset the look.
//
// Performance design
//  * The base point cloud is never modified by spikes.  Spiking neurons are drawn by a small second
//    THREE.Points "overlay" (same material, drawn after the base cloud, same position so the depth
//    test passes) holding only the neurons that are spiking right now.  Per frame that is a few
//    bytes per ACTIVE neuron to upload instead of re-uploading the whole 5 M-vertex colour + size
//    buffers (84 MB per frame during a burst), which is what used to stall the browser.
//  * Active neurons live in compact typed arrays (swap-remove), no per-gid Maps / objects.
//  * The overlay is uploaded once per rendered frame (preRender hook) however many playback steps
//    ran in between.
import * as THREE from "three";
import { state } from "./state.js";
import { parameters, fadeDuration } from "./config.js";
import { getGidIndexMap } from "./lookups.js";
import { requestRender } from "./scene.js";
import { markRange } from "./gpu.js";

const INITIAL_CAPACITY = 8192;

let overlay = null; // THREE.Points
let capacity = 0;
let ovPos = null; // overlay vertex data, one slot per active neuron
let ovCol = null;
let ovSize = null;
let actIdx = null; // base vertex index of each slot
let actStart = null; // sim time the spike started
let activeCount = 0;
let slotsChanged = false; // positions / colours of slots changed since the last upload

let pos = null; // base vertex index -> slot, -1 when not spiking
let bound = null; // base geometry the arrays above belong to
let basePos = null;
let origColors = null;

// ---------- overlay management ----------
function allocate(newCapacity) {
  const keep = activeCount;
  const grow = (Type, old, stride) => {
    const a = new Type(newCapacity * stride);
    if (old) a.set(old.subarray(0, keep * stride));
    return a;
  };
  ovPos = grow(Float32Array, ovPos, 3);
  ovCol = grow(Float32Array, ovCol, 3);
  ovSize = grow(Float32Array, ovSize, 1);
  actIdx = grow(Int32Array, actIdx, 1);
  actStart = grow(Float64Array, actStart, 1);
  capacity = newCapacity;

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(ovPos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("color", new THREE.BufferAttribute(ovCol, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("size", new THREE.BufferAttribute(ovSize, 1).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, activeCount);

  if (overlay) {
    overlay.geometry.dispose();
    overlay.geometry = g;
  } else {
    overlay = new THREE.Points(g, state.material);
    overlay.frustumCulled = false; // dynamic data: no meaningful bounding sphere
    overlay.renderOrder = 1; // after the base cloud
  }
  slotsChanged = true;
}

function attachOverlay() {
  if (!overlay) allocate(INITIAL_CAPACITY);
  overlay.material = state.material;
  if (state.particles) {
    overlay.position.copy(state.particles.position);
    overlay.quaternion.copy(state.particles.quaternion);
    overlay.scale.copy(state.particles.scale);
  }
  if (overlay.parent !== state.scene) state.scene.add(overlay);
}

// (re)bind to the current base geometry; a rebuilt network drops all spike state
function ensureBound() {
  const g = state.geometry;
  if (bound === g) return;
  bound = g;
  basePos = g.attributes.position.array;
  origColors = g.attributes.originalColor.array;
  pos = new Int32Array(g.attributes.size.count).fill(-1);
  activeCount = 0;
  attachOverlay();
  overlay.geometry.setDrawRange(0, 0);
  state.preRender = flushUploads;
}

// ---------- spikes ----------
const isRed = (a, i) => a[i] === 1 && a[i + 1] === 0 && a[i + 2] === 0;

// colour of a spiking neuron, derived from its original colour
//  with CA3->CA1 connections: red (inhibitory) -> white, anything else -> yellow
//  without connections:       red -> white, blue (excitatory) -> yellow, others keep their colour
function writeSpikeColor(slot, idx) {
  const i = idx * 3;
  const o = origColors;
  const s = slot * 3;
  if (isRed(o, i)) {
    ovCol[s] = 1;
    ovCol[s + 1] = 1;
    ovCol[s + 2] = 1; // white
  } else if (state.isConnection || (o[i] === 0 && o[i + 1] === 0 && o[i + 2] === 1)) {
    ovCol[s] = 1;
    ovCol[s + 1] = 1;
    ovCol[s + 2] = 0; // yellow
  } else {
    ovCol[s] = o[i];
    ovCol[s + 1] = o[i + 1];
    ovCol[s + 2] = o[i + 2];
  }
}

// start (or restart) a spike on base vertex `idx`
function flash(idx, targetSize) {
  let p = pos[idx];
  if (p === -1) {
    if (activeCount === capacity) allocate(capacity * 2);
    p = activeCount++;
    actIdx[p] = idx;
    pos[idx] = p;
    const s = p * 3;
    const i = idx * 3;
    ovPos[s] = basePos[i];
    ovPos[s + 1] = basePos[i + 1];
    ovPos[s + 2] = basePos[i + 2];
  }
  actStart[p] = state.count;
  ovSize[p] = targetSize;
  writeSpikeColor(p, idx);
  slotsChanged = true;
}

// animate spikes with the CA3 -> CA1 connection map
function animateParticlesConnection(particleIds, targetSize) {
  const indexMap = getGidIndexMap();
  particleIds.forEach((particleId) => {
    const targets = state.ca3toca1connections[particleId]; // fire all CA1 post-synaptic targets
    if (targets) {
      targets.forEach((ca1Id) => {
        const idx = indexMap.get(ca1Id);
        if (idx !== undefined) flash(idx, targetSize);
      });
    }
    const idx = state.gids_activity_indexes[particleId]; // and the original (CA3) neuron
    if (idx !== undefined) flash(idx, targetSize);
  });
}

// animate spikes without connections
function animateParticlesPlain(particleIds, targetSize) {
  const hovered = state.hoveredIndex;
  const map = state.gids_activity_indexes;
  for (let k = 0; k < particleIds.length; k++) {
    const idx = map[particleIds[k]];
    if (idx === undefined || hovered === idx) continue;
    flash(idx, targetSize);
  }
}

// grow/shrink every spiking neuron over `fadeDuration`; a finished spike leaves the overlay
function fadeSpikes(currentTime) {
  const base = parameters.Neuron_Size;
  const range = state.spikeNeuronSize - base;

  for (let p = 0; p < activeCount; ) {
    const t = Math.min((currentTime - actStart[p]) / fadeDuration, 1); // 0..1
    if (t < 1) {
      ovSize[p] = base + range * Math.sin(t * Math.PI);
      p++;
      continue;
    }

    // finished: move the last slot into this one
    pos[actIdx[p]] = -1;
    const last = --activeCount;
    if (p !== last) {
      const moved = actIdx[last];
      actIdx[p] = moved;
      actStart[p] = actStart[last];
      ovSize[p] = ovSize[last];
      const a = p * 3;
      const b = last * 3;
      ovPos[a] = ovPos[b];
      ovPos[a + 1] = ovPos[b + 1];
      ovPos[a + 2] = ovPos[b + 2];
      ovCol[a] = ovCol[b];
      ovCol[a + 1] = ovCol[b + 1];
      ovCol[a + 2] = ovCol[b + 2];
      pos[moved] = p;
    }
    slotsChanged = true;
  }
}

// called by the render loop right before drawing: one small upload for all steps since the last frame
function flushUploads() {
  if (!overlay) return;
  const g = overlay.geometry;
  g.setDrawRange(0, activeCount);
  if (activeCount === 0) return;
  markRange(g.attributes.size, 0, activeCount); // sizes change every step
  if (slotsChanged) {
    markRange(g.attributes.position, 0, activeCount * 3);
    markRange(g.attributes.color, 0, activeCount * 3);
    slotsChanged = false;
  }
}

// ---------- public API ----------

// Advance the spike display to `currentTime` (flash new spikes, fade old ones).
export function advanceSpikes(currentTime, targetSize = state.spikeNeuronSize) {
  if (!state.geometry) return;
  ensureBound();

  const ids = state.Activitys[parseFloat(currentTime).toFixed(1)];

  if (state.isConnection) {
    if (ids !== undefined) animateParticlesConnection(ids, targetSize);
  } else {
    // numbers only here; formatted when the log is downloaded
    state.simulationLogs.push({ t: Date.now(), sim: state.count, n: ids !== undefined ? ids.length : 0 });
    if (ids !== undefined) animateParticlesPlain(ids, targetSize);
  }
  fadeSpikes(currentTime);
  requestRender();
}

// Put a neuron's base colour back to its original (used when the hover highlight ends).
export function restoreColor(idx) {
  if (!state.geometry) return;
  const colors = state.geometry.attributes.color.array;
  const o = state.geometry.attributes.originalColor.array;
  const i = idx * 3;
  colors[i] = o[i];
  colors[i + 1] = o[i + 1];
  colors[i + 2] = o[i + 2];
}

// Forget all running spikes (the base cloud is untouched, so nothing else needs resetting).
export function clearSpikes() {
  if (pos) for (let p = 0; p < activeCount; p++) pos[actIdx[p]] = -1;
  activeCount = 0;
  slotsChanged = true;
  if (overlay) overlay.geometry.setDrawRange(0, 0);
  state.spikeTimes.clear();
  state.spikeTransitions.clear();
  requestRender();
}

// Restore all neurons to their original look.
export function resetParticles() {
  if (!state.particles) return;
  clearSpikes();
}

// Drop the overlay together with the network it belongs to.
export function disposeSpikes() {
  clearSpikes();
  bound = null;
  pos = null;
  if (overlay) {
    if (overlay.parent) overlay.parent.remove(overlay);
    overlay.geometry.dispose();
    overlay = null;
    capacity = 0;
    ovPos = ovCol = ovSize = actIdx = actStart = null;
  }
}

export function downloadSimulationCSV() {
  if (state.simulationLogs.length === 0) {
    alert("No logs available.");
    return;
  }

  const rows = ["System_Time,Milliseconds,Sim_Time_ms,Spike_Count"];
  for (const log of state.simulationLogs) {
    const d = new Date(log.t);
    rows.push(`${d.toLocaleTimeString()},${String(d.getMilliseconds()).padStart(3, "0")},${log.sim},${log.n}`);
  }

  const url = URL.createObjectURL(new Blob([rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "simulation_log.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
