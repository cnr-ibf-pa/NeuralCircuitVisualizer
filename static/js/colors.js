// Per-region colour pickers.
import { colorPickers } from "./dom.js";
import { state } from "./state.js";
import { hexToNormalizedRGB } from "./utils.js";
import { VisualizateNeurons } from "./neurons.js";

export function initColorPickers() {
  Object.entries(colorPickers).forEach(([region, picker]) => {
    state.regionRGB[region] = hexToNormalizedRGB(picker.value);

    picker.addEventListener("input", () => {
      const rgb = hexToNormalizedRGB(picker.value);

      // white (1,1,1) and yellow (1,1,0) are reserved for spikes
      if (rgb[0] === 1 && rgb[1] === 1 && rgb[2] === 1) {
        picker.value = "#0000FF";
        alert("Please select an other color because white color is used for spike ");
        return;
      }
      if (rgb[0] === 1 && rgb[1] === 1 && rgb[2] === 0) {
        picker.value = "#0000FF";
        alert("Please select an other color because yellow color is used for spike ");
        return;
      }

      state.regionRGB[region] = rgb;
      // human / uploaded circuits are coloured by cell type, not region: nothing to rebuild
      if (!state.flag) VisualizateNeurons();
    });
  });
}
