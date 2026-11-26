// Anatomical-axis arrows computed from a PCA of the neuron positions.
import * as THREE from "three";
import { state } from "./state.js";

function createTextLabel(text) {
  const canvas = document.createElement("canvas");
  const size = 128;
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  ctx.font = "bold 48px Arial";
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
}

function addAnatomicalArrowsFromPCA(scene, origin, length, pcaAxes) {
  const labels = [
    { label: "A", dir: pcaAxes[0].clone().negate(), color: 0xff00ff },
    { label: "P", dir: pcaAxes[0], color: 0xffff00 },
    { label: "D", dir: pcaAxes[1], color: 0x00ff00 },
    { label: "V", dir: pcaAxes[1].clone().negate(), color: 0xffffff },
    { label: "M", dir: pcaAxes[2], color: 0xff0000 },
    { label: "L", dir: pcaAxes[2].clone().negate(), color: 0x0000ff },
  ];

  labels.forEach(({ label, dir, color }) => {
    scene.add(new THREE.ArrowHelper(dir.clone().normalize(), origin, length, color, 0.3 * length, 0.2 * length));

    const sprite = createTextLabel(label);
    sprite.position.copy(origin.clone().add(dir.clone().normalize().multiplyScalar(length + 0.4)));
    scene.add(sprite);
  });
}

// PCA axes of the neuron positions. Requires the global `numeric` library (only for the 3x3 eigen-solve).
// Covariance is accumulated in one pass (the old version built N x 3 arrays of arrays).
// Returns THREE.Vector3[] or null on failure / empty input.
export function computePCA(positions, maxPoints = 200000) {
  try {
    const total = positions.length / 3;
    if (total < 1) return null;
    const stride = Math.max(1, Math.floor(total / maxPoints)); // sample large clouds
    const step = stride * 3;
    const n = Math.ceil(total / stride);

    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < positions.length; i += step) {
      mx += positions[i];
      my += positions[i + 1];
      mz += positions[i + 2];
    }
    mx /= n; my /= n; mz /= n;

    let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    for (let i = 0; i < positions.length; i += step) {
      const x = positions[i] - mx;
      const y = positions[i + 1] - my;
      const z = positions[i + 2] - mz;
      xx += x * x; xy += x * y; xz += x * z;
      yy += y * y; yz += y * z; zz += z * z;
    }

    const cov = [
      [xx, xy, xz],
      [xy, yy, yz],
      [xz, yz, zz],
    ];
    const eig = numeric.eig(cov);

    return eig.E.x.map((v) => new THREE.Vector3(...v));
  } catch (e) {
    console.warn("PCA failed. Skipping PCA.", e);
    return null;
  }
}

export function createArrowOverlayFromPCA(pcaAxes) {
  state.arrowsScene = new THREE.Scene();
  state.arrowsScene.background = null; // transparent
  state.arrowsCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  state.arrowsCamera.position.set(0, 0, 5);
  state.arrowsCamera.lookAt(0, 0, 0);
  state.arrowsScene.add(new THREE.AmbientLight(0xffffff, 2));

  addAnatomicalArrowsFromPCA(state.arrowsScene, new THREE.Vector3(0, 0, 0), 1.0, pcaAxes);
}
