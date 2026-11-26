// Static configuration + tweakable parameter objects shared across modules.
import { $ } from "./dom.js";

export const baseURL = "";
export const fadeDuration = 2.0; // ms of sim-time a spike takes to fade
export const POPUP_HIDE_DELAY = 900; // ms before hover popup hides
export const POPUP_FADE_MS = 900; // must match the CSS transition

// camera pose persistence
export const CAM_POSE_KEY = "ncv_cam_pose_v2";
export const CAM_HAS_KEY = "ncv_cam_pose_has_user_save_v2";

export const params = { Backgound: "#000000" };
export const parameters = {
  Neuron_Size: 30,
  Firing_Neuron_Size: 100,
};

// Global playback config (kept in sync with the slider/inputs in playback.js)
export const playbackConfig = {
  simTimestep: parseFloat($("simTimestepValue").value),
  stepDuration: parseInt($("stepDurationValue").value),
};

// Upload chunk size for large files
export const UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
