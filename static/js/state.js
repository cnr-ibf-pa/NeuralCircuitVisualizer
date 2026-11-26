// Single shared mutable state. ES modules cannot reassign imported `let` bindings,
// so every former top-level global lives on this object (state.count, state.scene, ...).
import * as THREE from "three";
import { getTimestampDirectory } from "./utils.js";

export const state = {
  // ---- three.js core ----
  scene: null,
  camera: null,
  camera2: null,
  renderer: null,
  controls: null,
  material: null,
  geometry: null,
  particles: null,
  uniforms: null,
  arrowsScene: null,
  arrowsCamera: null,
  connectionLines: null,
  initialPose: null,
  renderLoopStarted: false,

  // upload session folder on the server (generated once per page load)
  uniqueDirectory: getTimestampDirectory(),

  // ---- network data ----
  NetworkArray: [],
  ca3toca1connections: [],
  total_neurons: 0,
  total_excitatory: 0,
  total_inhibitory: 0,
  cell_type: 0,
  positions: [],
  sizes: [],
  gIDs: [],
  neuron_class: [],
  vertexColors: [],
  totalParticles: 0,
  gidIndexMap: null, // gid -> vertex index, built lazily (see lookups.js)
  needsRender: true, // on-demand rendering flag (see scene.js requestRender)
  sceneCenter: new THREE.Vector3(),
  regionRGB: {}, // filled by colors.js

  // ---- activity data ----
  Activitys: undefined,
  timeRanges: undefined,
  gids_activity_indexes: {},
  total_activity_files: undefined,
  firstLastKeys: undefined,
  lasttime: undefined,
  lastKey: undefined,
  firstKey: undefined,
  selectedChunkNumber: -1,
  counter_check: 0,
  circuitstatus: 0, // 1 human, 2 hippocampome, 3 user upload

  // ---- mode flags ----
  flag: false,
  ishuman: false,
  ishalf: false,
  isHippocamome: false,
  isDownloadTriggered: false,
  isConnection: false,
  loadmouseflag: false,
  panelsInitialised: false,

  // ---- playback ----
  count: 0.0,
  isPaused: false,
  isFinished: false,
  interval: undefined,
  spikeNeuronSize: 100,
  previousTimeDisplay: undefined,
  wasEverStarted: false,
  spikeTimes: new Map(),
  spikeTransitions: new Map(), // gid -> { startTime }
  simulationLogs: [], // { t: Date.now(), sim, n }
  preRender: null, // function called by the render loop before drawing
  postRender: null, // function called after a frame was drawn while recording

  // ---- hover / popup ----
  hoveredIndex: -1,
  popupVisible: false,
  popupHideTimer: null,

  // ---- connections ----
  allConnections: [],
  activeConnections: [],
  connectionsHidden: false,

  // ---- checkbox selection ----
  selectedCheckboxByLayer: [],
  selectedCheckboxIds: [],

  // ---- histogram ----
  histChart: null,
  histX: [],
  histY: [],
  histSD: [],
  currentCursorMs: null,

  // ---- recording ----
  mediaRecorder: null,
  combinedCanvas: null,
  combinedCtx: null,
  recordedChunks: [],
};

// three.js helper objects (never reassigned)
export const raycaster = new THREE.Raycaster();
export const pointer = new THREE.Vector2();
export const mouse = new THREE.Vector2();
export const hoverColor = new THREE.Color(0, 1, 1); // bright cyan
