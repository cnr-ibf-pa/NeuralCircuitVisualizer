// Hover highlighting + neuron info popup.
import { state, raycaster, pointer, hoverColor } from "./state.js";
import { $ } from "./dom.js";
import { requestRender } from "./scene.js";
import { markRange } from "./gpu.js";
import { pickNeurons } from "./picking.js";
import { restoreColor } from "./spikes.js";
import { POPUP_HIDE_DELAY, POPUP_FADE_MS } from "./config.js";
import { describeHippocampomeMtype, getmtypeLabel, getmorphclassLabel, getetypeLabel, getlayerLabel, getregionLabel } from "./labels.js";

const showHideable = () => {
  document.querySelectorAll(".hideable").forEach((el) => {
    el.style.display = "flex"; // matches .info-row
  });
};

export function initRaycaster() {
  raycaster.params.Points.threshold = 3;
  if (state.particles && state.particles.geometry) {
    state.particles.geometry.computeBoundingSphere();
    state.particles.geometry.computeBoundingBox();
  }
}

function highlightParticle(index) {
  const colorAttribute = state.geometry.attributes.color;
  const colors = colorAttribute.array;
  const i3 = index * 3;

  colors[i3] = hoverColor.r;
  colors[i3 + 1] = hoverColor.g;
  colors[i3 + 2] = hoverColor.b;
  markRange(colorAttribute, i3, 3);
  requestRender();
}

// end of hover: spike colour if the neuron is spiking right now, otherwise its original colour
function resetParticleAppearance(index) {
  const colorAttribute = state.geometry.attributes.color;
  restoreColor(index); // writes the colour array
  markRange(colorAttribute, index * 3, 3);
  requestRender();
}

// pointermove fires far more often than we can raycast 100k+ points, so handle at most
// one move per animation frame, and none while a button is held (orbit / pan drag).
let pendingMove = null;
let moveRaf = 0;

export function onPointerMove(event) {
  if (event.buttons) return;
  pendingMove = event;
  if (moveRaf) return;
  moveRaf = requestAnimationFrame(() => {
    moveRaf = 0;
    const e = pendingMove;
    pendingMove = null;
    if (e) processPointerMove(e);
  });
}

function processPointerMove(event) {
  if (!state.particles || !state.scene.children.includes(state.particles)) {
    hidePopup();
    return;
  }

  try {
    // only raycast when the pointer is actually over the 3D canvas
    let intersects = [];
    if (event.target === state.renderer.domElement) {
      const rect = state.renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, state.camera);
      intersects = pickNeurons(raycaster, state.particles);
    }

    if (state.hoveredIndex !== -1) {
      resetParticleAppearance(state.hoveredIndex);
      state.hoveredIndex = -1;
    }

    if (intersects.length > 0) {
      state.hoveredIndex = intersects[0].index;
      highlightParticle(state.hoveredIndex);
      showNeuronInfo(intersects[0]);
    } else if (state.popupVisible) {
      if (!state.popupHideTimer) state.popupHideTimer = setTimeout(hidePopup, POPUP_HIDE_DELAY);
    }
  } catch (error) {
    console.error("Raycasting error:", error);
    hidePopup();
  }
}

function showNeuronInfo(intersection) {
  if (!intersection || !state.particles) return;

  if (state.popupHideTimer) {
    clearTimeout(state.popupHideTimer);
    state.popupHideTimer = null;
  }

  const popup = $("neuron-popup");
  const gid = state.particles.geometry.attributes.gid.getX(intersection.index);

  $("neuron-gid").textContent = gid;

  // extra info for the CA1 SONATA circuit (only after a "download" upload)
  if (state.isDownloadTriggered) {
    $("neuron-etype").textContent = getetypeLabel(gid);
    $("neuron-layer").textContent = getlayerLabel(gid);
    $("neuron-morph_class").textContent = getmorphclassLabel(gid);
    $("neuron-mtype").textContent = getmtypeLabel(gid);
    $("neuron-region").textContent = getregionLabel(gid);
    showHideable();
  }

  // Hippocampome circuit
  if (state.isHippocamome) {
    const mtype = state.particles.geometry.attributes.mtype.getX(intersection.index);
    const info = describeHippocampomeMtype(mtype);

    $("neuron-mtype").textContent = info.mtype;
    if (info.region) {
      $("neuron-region").textContent = info.region;
      $("neuron-morph_class").textContent = info.morph;
    }
    showHideable();

    $("rwetype").style.display = "none";
    $("rwlayer").style.display = "none";
  }

  if (!state.popupVisible) {
    popup.style.display = "block";
    popup.style.opacity = "1";
    state.popupVisible = true;
  }
}

export function hidePopup() {
  if (!state.popupVisible) return;

  const popup = $("neuron-popup");
  popup.style.opacity = "0";

  setTimeout(() => {
    popup.style.display = "none";
    state.popupVisible = false;
  }, POPUP_FADE_MS);
}

export function initPopupSystem() {
  document.addEventListener("pointermove", onPointerMove);
  // hide when the pointer leaves the window
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget && state.popupVisible) hidePopup();
  });

  const popup = $("neuron-popup");
  popup.addEventListener("mouseenter", () => {
    if (state.popupHideTimer) {
      clearTimeout(state.popupHideTimer);
      state.popupHideTimer = null;
    }
  });
  popup.addEventListener("mouseleave", () => {
    if (state.popupVisible) state.popupHideTimer = setTimeout(hidePopup, POPUP_HIDE_DELAY);
  });
}
