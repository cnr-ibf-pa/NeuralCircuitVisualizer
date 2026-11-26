// Cached DOM references. Import from here instead of calling getElementById repeatedly.
export const $ = (id) => document.getElementById(id);

export const canvas = $("neuronCanvas");
export const hudCanvas = $("hudCanvas");
export const hudCtx = hudCanvas.getContext("2d");

// time controls
export const timebar = $("timebar");
export const currentTimeDisplay = $("current-time");
export const totalTimeDisplay = $("total-time");
export const startTimeInput = $("start-time");
export const endTimeInput = $("end-time");
export const dropdown = $("ddactivity_chunks");

// file inputs
export const networkFileInput = $("networkFileInput");
export const hdfFileInput = $("activityFileInput");
export const sonataFileInput = $("sonataFileInput");

// playback buttons
export const startButton = $("startbtn");
export const stopButton = $("pause");
export const restartButton = $("restart");

// recording buttons
export const recStartBtn = $("startRecordingBtn");
export const recStopBtn = $("stopRecordingBtn");

export const btnLoadConnection = $("btnLoadConnection");
export const connectionPanel = $("connectionPanel");

export const colorPickers = {
  DG: $("colorPickerDG"),
  CA3: $("colorPickerCA3"),
  CA2: $("colorPickerCA2"),
  CA1: $("colorPickerCA1"),
  Sub: $("colorPickerSub"),
  EC: $("colorPickerEC"),
};
