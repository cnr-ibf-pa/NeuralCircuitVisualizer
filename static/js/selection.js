// Neuron-type / layer checkbox logic for the hippocampal formation selection panel.
import { state } from "./state.js";
import { $, dropdown, colorPickers } from "./dom.js";
import { range } from "./utils.js";
import { setSpikePanels, removeTable } from "./ui.js";
import { VisualizateNeurons } from "./neurons.js";
import { resetSpikeState, resetTimeUI, resetPlaybackConfig } from "./playback.js";

// ======================= static data =======================

// one entry per anatomical region
const SECTIONS = [
  { container: ".DG_checkbox_container", reg: "AllDGRegSwitchCheck", all: "AllDGSwitchCheck", rank: [1, 3, 4, 7, 8, 9, 10, 11, 17], canonical: [1] },
  { container: ".CA3_checkbox_container", reg: "AllCA3RegSwitchCheck", all: "AllCA3SwitchCheck", rank: [19, 20, 23, 25, 26, 27, 28, 31, 33, 34, 36, 40, 43], canonical: [19] },
  { container: ".CA2_checkbox_container", reg: "AllCA2RegSwitchCheck", all: "AllCA2SwitchCheck", rank: [44, 45, 47], canonical: [] },
  { container: ".CA1_checkbox_container", reg: "AllCA1RegSwitchCheck", all: "AllCA1SwitchCheck", rank: [49, 52, 53, 54, 55, 57, 58, 60, 63, 66, 67, 68, 69, 74, 77, 79, 82, 84, 86, 87], canonical: [49] },
  { container: ".Sub_checkbox_container", reg: "AllSubRegSwitchCheck", all: "AllSubSwitchCheck", rank: [90, 91], canonical: [] },
  { container: ".EC_checkbox_container", reg: "AllECRegSwitchCheck", all: "AllECSwitchCheck", rank: [93, 95, 97, 100, 104, 106, 107, 108, 111, 115, 117, 121, 122], canonical: [95] },
];
const ALL_CONTAINERS_SELECTOR = SECTIONS.map((s) => s.container + " .form-check-input").join(", ");
const NT_MODE_IDS = ["AllNT", "RankNT", "CanonicalNT"];

// region "all" checkbox -> its layer checkboxes (disabled while the region box is ticked)
const REGION_LAYERS = {
  AllDGRegSwitchCheck: ["DGSG", "DGSMi", "DGSMo", "DGH"],
  AllCA3RegSwitchCheck: ["CA3SL", "CA3SLM", "CA3SO", "CA3SP", "CA3SR"],
  AllCA2RegSwitchCheck: ["CA2SP"],
  AllCA1RegSwitchCheck: ["CA1SLM", "CA1SO", "CA1SP", "CA1SR"],
  AllSubRegSwitchCheck: ["SubSM", "SubSP"],
  AllECRegSwitchCheck: ["LECI", "LECII", "LECIII", "LECIV", "LECV", "LECVI", "MECI", "MECII", "MECIII", "MECIV", "MECV", "MECVI"],
};

// layer checkbox ids; the array index is the "layer index" used below
const LAYER_IDS = ["CA1SLM", "CA1SO", "CA1SP", "CA1SR", "CA2SP", "CA3SL", "CA3SLM", "CA3SO", "CA3SP", "CA3SR", "DGSG", "DGSMi", "DGSMo", "DGH", "LECI", "LECII", "LECIII", "LECIV", "LECV", "LECVI", "MECI", "MECII", "MECIII", "MECIV", "MECV", "MECVI", "SubSM", "SubSP"];

// layer indexes belonging to each region (to lock the region checkbox while a layer is ticked)
const LAYER_REGION_GROUPS = [
  { reg: "AllDGRegSwitchCheck", layers: [10, 11, 12, 13] },
  { reg: "AllCA3RegSwitchCheck", layers: [5, 6, 7, 8, 9] },
  { reg: "AllCA2RegSwitchCheck", layers: [4] },
  { reg: "AllCA1RegSwitchCheck", layers: [0, 1, 2, 3] },
  { reg: "AllSubRegSwitchCheck", layers: [26, 27] },
  { reg: "AllECRegSwitchCheck", layers: range(14, 25) }, // LEC + MEC
];

// layer index -> neuron-type ids that live in that layer
const LAYER_NT = {
  0: [50, 57, 61, 63, 65, 66, 67, 77, 79, 82, 84],
  1: [52, 53, 54, 55, 56, 57, 58, 60, 68, 79, 70, 71, 73, 74, 75, 85, 86, 87],
  2: [49, 51, 52, 55, 56, 57, 58, 60, 62, 64, 72, 76, 80, 83, 85, 87, 88],
  3: [51, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 72, 76, 77, 78, 79, 81, 82, 83, 84, 85, 87, 88],
  4: [44, 45, 46, 47, 48],
  5: [22, 28, 30, 31, 32, 33, 34, 35, 38, 39],
  6: [29],
  7: [23, 24, 27, 35, 36, 37, 38, 39, 42, 43],
  8: [19, 20, 23, 25, 26, 27, 32, 35, 38, 39],
  9: [21, 22, 34, 38, 39, 40, 41],
  10: [1, 2, 7, 8, 10, 11, 14, 15, 16],
  11: [3, 9, 13, 14, 17],
  12: [14, 17, 18],
  13: [4, 5, 6, 10, 11, 12],
  14: [92, 93],
  15: [92, 93, 97, 115, 117],
  16: [97, 98, 100, 101, 104, 105, 106, 118, 121],
  17: [106, 107, 108],
  18: [106, 107, 108, 111],
  19: [108, 114],
  20: [92, 93],
  21: [92, 93, 94, 95, 96, 97, 115, 116, 117],
  22: [96, 97, 99, 100, 102, 103, 104, 105, 106, 119, 120, 121, 122],
  23: [106, 107, 108],
  24: [106, 107, 108, 109, 110, 111, 112, 113],
  25: [108, 113],
  26: [91],
  27: [89, 90, 91],
};
// the original code un-ticked a different list than it ticked for layer 19 (kept as-is)
const LAYER_NT_UNSELECT_OVERRIDE = { 19: [106, 107, 108, 111] };

// "N/M" counters on the region buttons
const COUNT_BUTTONS = [
  { container: ".DG_checkbox_container", all: "AllDGSwitchCheck", btn: "btnDG", label: "DG Neuron Types" },
  { container: ".CA3_checkbox_container", all: "AllCA3SwitchCheck", btn: "btnCA3", label: "CA3 Neuron Types" },
  { container: ".CA2_checkbox_container", all: "AllCA2SwitchCheck", btn: "btnCA2", label: "CA2 Neuron Types" },
  { container: ".CA1_checkbox_container", all: "AllCA1SwitchCheck", btn: "btnCA1", label: "CA1 Neuron Types" },
  { container: ".Sub_checkbox_container", all: "AllSubSwitchCheck", btn: "btnSub", label: "Subiculum (Sub) Neuron Types" },
  { container: ".EC_checkbox_container", all: "AllECSwitchCheck", btn: "btnEC", label: "Entorhinal Cortex (EC) Neuron Types" },
];

// ======================= small helpers =======================

const regionCheckboxes = () => SECTIONS.map((s) => $(s.reg));
const setChecked = (selector, value) => document.querySelectorAll(selector).forEach((c) => (c.checked = value));
const setNtModesDisabled = (value) => NT_MODE_IDS.forEach((id) => ($(id).disabled = value));

function selectCheckboxes(ids) {
  ids.forEach((id) => {
    const checkbox = $(id);
    if (checkbox) checkbox.checked = true;
  });
}

function unselectCheckboxes(ids) {
  ids.forEach((id) => {
    const checkbox = $(id);
    if (checkbox) {
      checkbox.checked = false;
      state.selectedCheckboxByLayer = state.selectedCheckboxByLayer.filter((i) => i !== id);
    }
  });
}

export function updateSelectedCount() {
  COUNT_BUTTONS.forEach(({ container, all, btn, label }) => {
    const base = `${container} .form-check-input`;
    const total = document.querySelectorAll(`${base}:not(#${all})`).length;
    const selected = document.querySelectorAll(`${base}:checked:not(#${all})`).length;
    $(btn).textContent = `${label} (${selected}/${total})`;
  });
}

function updateSelectedCheckboxIds() {
  state.selectedCheckboxIds = [];
  document.querySelectorAll(".form-check-input").forEach((checkbox) => {
    if (checkbox.checked && !checkbox.id.startsWith("All")) state.selectedCheckboxIds.push(checkbox.id);
  });
}

function checkAllNTStatus() {
  $("AllNT").checked = Array.from(document.querySelectorAll(ALL_CONTAINERS_SELECTOR)).some((c) => c.checked);
}

// One user click can fire several change handlers; each used to rebuild the whole point
// cloud. Redraws are now coalesced into a single rebuild on the next animation frame.
let vizToken = 0;
function scheduleVisualize() {
  const token = ++vizToken;
  requestAnimationFrame(() => {
    if (token === vizToken) VisualizateNeurons();
  });
}
function visualizeNow() {
  vizToken++; // cancels any pending scheduled rebuild
  VisualizateNeurons();
}

// redraw + refresh counters after any selection change
function refresh({ count = true } = {}) {
  updateSelectedCheckboxIds();
  scheduleVisualize();
  if (count) updateSelectedCount();
}

// ======================= main "apply" logic =======================

function applySelection() {
  const SelectAll = $("SelectAll");
  const UnselectAll = $("UnselectAll");
  const AllNT = $("AllNT");
  const RankNT = $("RankNT");
  const CanonicalNT = $("CanonicalNT");

  // sync every neuron-type checkbox with its region's "all" checkbox
  SECTIONS.forEach((section) => {
    const reg = $(section.reg);
    const all = $(section.all);
    if (reg && all) {
      setChecked(section.container + " .form-check-input", reg.checked);
      all.checked = reg.checked;
    }
  });
  updateSelectedCount();

  if (SelectAll && SelectAll.checked) {
    document.querySelectorAll(".form-check-input").forEach((c) => {
      if (c.id !== "UnselectAll") c.checked = true;
    });
    SECTIONS.forEach((s) => ($(s.all).checked = true));

    AllNT.checked = true;
    regionCheckboxes().forEach((c) => (c.checked = true));

    refresh();
    return;
  }

  if (UnselectAll && UnselectAll.checked) {
    resetSpikeState();
    resetPlaybackConfig();
    resetTimeUI();
    dropdown.selectedIndex = 0;

    // re-enable everything
    regionCheckboxes().forEach((c) => (c.disabled = false));
    setNtModesDisabled(false);
    Object.values(REGION_LAYERS)
      .flat()
      .forEach((id) => {
        const c = $(id);
        if (c) c.disabled = false;
      });

    setChecked(".form-check-input", false);
    SECTIONS.forEach((s) => ($(s.all).checked = false));

    state.selectedCheckboxIds = [];
    unselectCheckboxes(range(1, 122));
    visualizeNow();
    updateSelectedCount();

    setSpikePanels(false);
    removeTable();
    return;
  }

  const anyRegion = regionCheckboxes().some((c) => c && c.checked);

  if (anyRegion && RankNT.checked) {
    setChecked(ALL_CONTAINERS_SELECTOR, false);
    SECTIONS.forEach((s) => {
      if ($(s.reg).checked) s.rank.forEach((id) => $(id) && ($(id).checked = RankNT.checked));
    });
    refresh();
  } else if (anyRegion && CanonicalNT.checked) {
    setChecked(ALL_CONTAINERS_SELECTOR, false);
    SECTIONS.forEach((s) => {
      if ($(s.reg).checked) s.canonical.forEach((id) => $(id) && ($(id).checked = CanonicalNT.checked));
    });
    refresh();
  } else if (anyRegion) {
    // plain region selection
    SelectAll.checked = false;
    UnselectAll.checked = false;

    SECTIONS.forEach((section) => {
      const reg = $(section.reg);
      const all = $(section.all);
      if (reg && all) {
        setChecked(section.container + " .form-check-input", reg.checked);
        all.checked = reg.checked;
        if (reg.checked) AllNT.checked = true;
      }
    });
    refresh({ count: false });
  } else if (AllNT && AllNT.checked) {
    SECTIONS.forEach((section) => {
      setChecked(section.container + " .form-check-input", AllNT.checked);
      $(section.all).checked = AllNT.checked;
    });
    refresh();
  } else if (RankNT && RankNT.checked) {
    AllNT.checked = false;
    setChecked(".form-check-input", false);
    SECTIONS.flatMap((s) => s.rank).forEach((id) => $(id) && ($(id).checked = true));
    RankNT.checked = true;
    refresh();
  } else if (CanonicalNT && CanonicalNT.checked) {
    setChecked(".form-check-input", false);
    SECTIONS.flatMap((s) => s.canonical).forEach((id) => $(id) && ($(id).checked = true));
    CanonicalNT.checked = true;
    refresh();
  }
}

// ======================= layer checkboxes =======================

function onLayerChange(checkbox, index) {
  if (checkbox.checked) {
    if (!state.selectedCheckboxByLayer.includes(index)) {
      state.selectedCheckboxByLayer.push(index);
      LAYER_REGION_GROUPS.forEach((g) => {
        if (g.layers.includes(index)) $(g.reg).disabled = true;
      });
      setNtModesDisabled(true);
    }
  } else {
    state.selectedCheckboxByLayer = state.selectedCheckboxByLayer.filter((i) => i !== index);

    LAYER_REGION_GROUPS.forEach((g) => {
      if (!g.layers.some((v) => state.selectedCheckboxByLayer.includes(v))) $(g.reg).disabled = false;
    });

    unselectCheckboxes(LAYER_NT_UNSELECT_OVERRIDE[index] ?? LAYER_NT[index] ?? []);

    setNtModesDisabled(true);
    setSpikePanels(false);
    removeTable();
  }

  if (state.selectedCheckboxByLayer.length > 0) {
    Object.entries(LAYER_NT).forEach(([layer, ids]) => {
      if (state.selectedCheckboxByLayer.includes(Number(layer))) selectCheckboxes(ids);
    });
  } else {
    setNtModesDisabled(false);
    state.selectedCheckboxByLayer = [];
  }

  updateSelectedCount();
  scheduleVisualize();
}

// ======================= enable / disable / reset =======================

const MODE_AND_REGION_IDS = ["SelectAll", "UnselectAll", ...SECTIONS.map((s) => s.reg), ...NT_MODE_IDS];

function setAllDisabled(disabled) {
  Object.values(colorPickers).forEach((p) => (p.disabled = disabled));
  MODE_AND_REGION_IDS.forEach((id) => {
    const el = $(id);
    if (el) el.disabled = disabled;
  });
  document.querySelectorAll(".form-check-input").forEach((c) => (c.disabled = disabled));
}
export const disableAllElements = () => setAllDisabled(true);
export const enableAllElements = () => setAllDisabled(false);

export function resetAndDisableAllCheckboxes() {
  document.querySelectorAll(".form-check-input").forEach((c) => {
    c.checked = false;
    c.disabled = true;
  });

  ["AllNT", "RankNT", "CanonicalNT", "SelectAll", "UnselectAll"].forEach((id) => {
    const el = $(id);
    if (el) {
      el.checked = false;
      el.disabled = true;
    }
  });

  state.selectedCheckboxIds = [];
  state.selectedCheckboxByLayer = [];

  updateSelectedCount();
  setSpikePanels(false, { table: false });
  removeTable();
}

// ======================= wiring =======================

// "all" checkbox of a section toggles its children; children refresh the scene
function wireSection(section) {
  const all = $(section.all);
  if (!all) return;

  all.addEventListener("change", () => {
    setChecked(section.container + " .form-check-input", all.checked);
    refresh({ count: false });
    checkAllNTStatus();
    updateSelectedCount();
  });

  document.querySelectorAll(`${section.container} .form-check-input:not(#${section.all})`).forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      refresh({ count: false });
      checkAllNTStatus();
      updateSelectedCount();
    });
  });
}

export function initSelection() {
  document.addEventListener("DOMContentLoaded", () => {
    // mode / region controls re-run the apply logic
    [...MODE_AND_REGION_IDS].forEach((id) => $(id).addEventListener("change", applySelection));

    // ticking a region disables its layer checkboxes
    Object.entries(REGION_LAYERS).forEach(([regionId, layerIds]) => {
      const regionCheckbox = $(regionId);
      if (!regionCheckbox) return;
      regionCheckbox.addEventListener("change", () => {
        layerIds.forEach((layerId) => {
          const layerCheckbox = $(layerId);
          if (layerCheckbox) layerCheckbox.disabled = regionCheckbox.checked;
        });
      });
    });

    // individual layer checkboxes
    LAYER_IDS.forEach((id, index) => {
      const checkbox = $(id);
      if (checkbox) checkbox.addEventListener("change", () => onLayerChange(checkbox, index));
    });

    SECTIONS.forEach(wireSection);
    applySelection();
  });
}
