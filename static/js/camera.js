// Camera pose persistence, framing, panning/zooming helpers and keyboard navigation.
import * as THREE from "three";
import { state } from "./state.js";
import { $ } from "./dom.js";
import { CAM_POSE_KEY, CAM_HAS_KEY } from "./config.js";
import { resetHistChart } from "./histogram.js";
import { requestRender } from "./scene.js";

// ---------- saved pose (localStorage) ----------
const setHasSaved = (v) => localStorage.setItem(CAM_HAS_KEY, v ? "1" : "0");
const getHasSaved = () => localStorage.getItem(CAM_HAS_KEY) === "1";

export function savePoseNow() {
  const { camera, controls } = state;
  try {
    localStorage.setItem(
      CAM_POSE_KEY,
      JSON.stringify({
        px: camera.position.x,
        py: camera.position.y,
        pz: camera.position.z,
        tx: controls?.target.x ?? 0,
        ty: controls?.target.y ?? 0,
        tz: controls?.target.z ?? 0,
        up: [camera.up.x, camera.up.y, camera.up.z],
        fov: camera.fov,
      })
    );
    setHasSaved(true);
  } catch (e) {
    console.warn("savePoseNow failed:", e);
  }
}

export function restorePoseOnce() {
  const { camera, controls } = state;
  try {
    if (!getHasSaved()) return false;
    const raw = localStorage.getItem(CAM_POSE_KEY);
    if (!raw) return false;
    const { px, py, pz, tx, ty, tz, up, fov } = JSON.parse(raw);
    if (![px, py, pz, tx, ty, tz].every(Number.isFinite)) return false;

    if (Array.isArray(up) && up.length === 3) camera.up.set(up[0], up[1], up[2]);
    if (Number.isFinite(fov)) camera.fov = fov;

    camera.position.set(px, py, pz);
    controls?.target.set(tx, ty, tz);
    camera.lookAt(controls ? controls.target : new THREE.Vector3(tx, ty, tz));
    controls?.update();
    return true;
  } catch (e) {
    console.warn("restorePoseOnce failed:", e);
    return false;
  }
}

export function resetToInitialPose() {
  const { camera, controls, initialPose } = state;
  if (!initialPose) return;
  camera.up.copy(initialPose.up);
  camera.fov = initialPose.fov;
  camera.position.copy(initialPose.pos);
  controls.target.copy(initialPose.tgt);
  controls.update();
}

// ---------- framing ----------
export function centerCameraToObject(object) {
  const { camera, controls } = state;
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  const fovRad = (camera.fov * Math.PI) / 180;
  const dist = maxDim / 2 / Math.tan(fovRad / 2);

  // keep current view direction
  const viewDir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  const newPos = center.clone().add(viewDir.multiplyScalar(dist * 1.9));

  camera.position.copy(newPos);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();

  // snapshot of the pose considered "initial after loading data"
  state.initialPose = {
    pos: camera.position.clone(),
    tgt: controls.target.clone(),
    up: camera.up.clone(),
    fov: camera.fov,
  };
}

export function resetCamera() {
  const { camera, controls } = state;
  camera.position.set(90, 354, 1450);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);

  $("panel").style.display = "none";
  $("playbackcontainer").style.display = "none";
  $("histogramImage").style.display = "none";
  resetHistChart();
  if (controls) {
    controls.reset();
    controls.update();
  }
}

// ---------- pan / zoom ----------
function getBasis(cam) {
  const f = new THREE.Vector3();
  cam.getWorldDirection(f).normalize();
  const r = new THREE.Vector3().crossVectors(f, cam.up).normalize();
  const u = new THREE.Vector3().crossVectors(r, f).normalize();
  return { forward: f, right: r, up: u };
}

export function camSpeed(mult = 0.02) {
  const { camera, controls } = state;
  const d = camera.position.distanceTo(controls ? controls.target : new THREE.Vector3());
  return Math.max(0.001, d * mult);
}

export function panCamera(dx, dy) {
  const { camera, controls } = state;
  const { right, up } = getBasis(camera);
  const v = new THREE.Vector3().addScaledVector(right, dx).addScaledVector(up, dy);
  camera.position.add(v);
  if (controls) controls.target.add(v);
  requestRender();
}

// s > 1 = zoom IN (closer), s < 1 = zoom OUT
export function dollyScale(s) {
  const { camera, controls } = state;
  if (controls && controls.dollyIn) {
    if (s > 1) controls.dollyIn(s);
    else controls.dollyOut(1 / s);
    controls.update();
  } else {
    const { forward } = getBasis(camera);
    const step = Math.log(s) * camSpeed(1);
    camera.position.addScaledVector(forward, step);
  }
  requestRender();
}

// ---------- keyboard ----------
export function initCameraKeys() {
  document.addEventListener("keydown", (event) => {
    const { camera } = state;
    const moveStep = 100;
    const zoomStep = 100;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);

    switch (event.key) {
      case "+":
      case "=":
        camera.position.addScaledVector(forward, zoomStep);
        break;
      case "-":
      case "_":
        camera.position.addScaledVector(forward, -zoomStep);
        break;
      case "ArrowUp":
        event.preventDefault();
        camera.position.y += moveStep;
        break;
      case "ArrowDown":
        event.preventDefault();
        camera.position.y -= moveStep;
        break;
      case "ArrowLeft":
        event.preventDefault();
        camera.position.x -= moveStep;
        break;
      case "ArrowRight":
        event.preventDefault();
        camera.position.x += moveStep;
        break;
    }
    requestRender();
  });
}
