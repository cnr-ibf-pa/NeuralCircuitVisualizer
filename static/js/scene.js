// three.js scene/renderer/controls setup, render loop and resize handling.
import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { state } from "./state.js";
import { endFrame } from "./gpu.js";
import { canvas, startButton, stopButton, restartButton } from "./dom.js";

// ask the render loop to draw one more frame (rendering is on-demand, not 60 fps forever)
export function requestRender() {
  state.needsRender = true;
}

// centre of the neuron cloud, used to place the inset camera
export function updateSceneCenter() {
  const g = state.particles && state.particles.geometry;
  if (!g) return;
  if (!g.boundingBox) g.computeBoundingBox();
  if (g.boundingBox.isEmpty()) state.sceneCenter.set(0, 0, 0);
  else g.boundingBox.getCenter(state.sceneCenter);
}

// Huge clouds are fill-rate bound (millions of large overlapping point sprites), so above this
// many neurons render at pixel ratio 1 instead of up to 2.
const LARGE_CLOUD = 1_000_000;
const pixelRatio = () => (state.totalParticles > LARGE_CLOUD ? 1 : Math.min(window.devicePixelRatio, 2));

// re-apply the pixel ratio after the neuron count changed
export function applyPixelRatio() {
  const { renderer } = state;
  if (renderer.getPixelRatio() !== pixelRatio()) {
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  }
  updateDPR();
}

export function CreateScene() {
  state.scene = new THREE.Scene();
  state.camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 1, 100000);
  state.camera.position.set(75, 20, 0);
  state.camera.up.set(0, 0, 1);

  state.renderer = new THREE.WebGLRenderer({
    canvas,
    powerPreference: "high-performance",
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: false,
    logarithmicDepthBuffer: true,
  });

  state.renderer.setPixelRatio(pixelRatio());
  state.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  state.renderer.setClearColor(0x000000, 0);
  state.renderer.autoClear = false; // we render several viewports per frame

  // secondary (inset) view; aspect is set in animate()
  state.camera2 = new THREE.PerspectiveCamera(45, 1, 1, 100000);

  state.controls = new TrackballControls(state.camera, canvas);
  state.controls.rotateSpeed = 20.0;
  state.controls.zoomSpeed = 1.2;
  state.controls.panSpeed = 0.8;
  state.controls.minDistance = 0.1;
  state.controls.maxDistance = 100000;
  state.controls.addEventListener("change", requestRender); // orbit / pan / zoom / damping

  stopButton.disabled = true;
  startButton.disabled = true;
  restartButton.disabled = true;
}

// keep the shader's pixel-ratio uniform up to date
export function updateDPR() {
  if (state.uniforms) state.uniforms.uPixelRatio.value = state.renderer.getPixelRatio();
  requestRender();
}

export function initResizeHandlers() {
  // The three listeners below are kept separate and in the original order on purpose.
  window.addEventListener("resize", () => {
    const { camera, renderer } = state;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    requestRender();
  });

  window.addEventListener("resize", () => {
    state.renderer.setPixelRatio(pixelRatio());
    state.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    updateDPR();
  });

  window.addEventListener("resize", () => {
    const { camera, renderer } = state;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    requestRender();
  });
}

// Start the render loop exactly once (the original started a new loop on every redraw).
export function startRenderLoop() {
  if (state.renderLoopStarted) return;
  state.renderLoopStarted = true;
  animate();
}

const RECORD_FPS = 30;
let lastRecordRender = 0;

function animate() {
  requestAnimationFrame(animate);

  const { controls, renderer, scene, camera, camera2 } = state;
  if (controls) controls.update(); // may fire "change" -> needsRender

  // nothing changed -> skip the (expensive) double render; the last recorded frame stays valid
  if (!state.needsRender) return;
  const recording = state.mediaRecorder && state.mediaRecorder.state === "recording";
  if (recording) {
    // while recording, render at the capture rate only (needsRender stays set until the next slot)
    const now = performance.now();
    if (now - lastRecordRender < 1000 / RECORD_FPS - 2) return;
    lastRecordRender = now;
  }
  state.needsRender = false;
  if (state.preRender) state.preRender(); // e.g. deferred spike buffer uploads

  const width = renderer.domElement.clientWidth;
  const height = renderer.domElement.clientHeight;

  // main view
  renderer.setViewport(0, 0, width, height);
  renderer.setScissor(0, 0, width, height);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, camera);

  // --------- inset view (camera2) ---------
  const insetSize = Math.min(width, height) * 0.23;
  const insetX = 10;
  const insetY = 150;
  const border = 1;

  // border pass
  renderer.clearDepth();
  renderer.setViewport(insetX - border, insetY - border, insetSize + border * 2, insetSize + border * 2);
  renderer.setScissor(insetX - border, insetY - border, insetSize + border * 2, insetSize + border * 2);
  renderer.setScissorTest(true);
  renderer.setClearColor(0xffffff, 1);
  renderer.clear();

  // position camera2 between the camera and the scene centre
  const center = state.sceneCenter;

  const viewDir = new THREE.Vector3().subVectors(center, camera.position).normalize();
  const distance = camera.position.distanceTo(center);
  const zoomDistance = distance * 0.7;
  const mirroredPosition = new THREE.Vector3().copy(center).add(viewDir.multiplyScalar(zoomDistance));

  camera2.position.copy(mirroredPosition);
  camera2.lookAt(center);
  camera2.up.copy(camera.up);

  if (camera.isPerspectiveCamera) {
    camera2.fov = camera.fov;
    camera2.updateProjectionMatrix();
  } else if (camera.isOrthographicCamera) {
    camera2.zoom = camera.zoom;
  }

  camera2.aspect = 1;
  camera2.updateProjectionMatrix();

  renderer.clearDepth();
  renderer.setViewport(insetX, insetY, insetSize, insetSize);
  renderer.setScissor(insetX, insetY, insetSize, insetSize);
  renderer.setScissorTest(true);
  renderer.render(scene, camera2);
  endFrame(); // buffers uploaded; forget "full update" marks
  if (recording && state.postRender) state.postRender(); // copy the finished frame into the recording
}
