// Neuron picking. three.js Points.raycast tests every point (5 M tests per hover for the human
// circuit). For big clouds we bucket points into a uniform grid once and only test the cells the
// ray passes through. Small clouds keep using the stock raycaster.
import * as THREE from "three";
import { state } from "./state.js";

const GRID_MIN_POINTS = 200000;
let grid = null;

export function resetPickGrid() {
  grid = null;
}

function buildGrid() {
  const pos = state.positions;
  const n = pos.length / 3;
  const g = state.particles.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const bmin = g.boundingBox.min;
  const bmax = g.boundingBox.max;
  const ext = new THREE.Vector3().subVectors(bmax, bmin);
  const maxExt = Math.max(ext.x, ext.y, ext.z, 1e-6);

  const dimsFor = (s) => [Math.max(1, Math.ceil(ext.x / s)), Math.max(1, Math.ceil(ext.y / s)), Math.max(1, Math.ceil(ext.z / s))];
  const target = Math.min(4e6, Math.max(1, n / 8)); // ~8 points per cell
  let s = maxExt;
  while (s > maxExt * 1e-4) {
    const [a, b, c] = dimsFor(s);
    if (a * b * c >= target) break;
    s *= 0.85;
  }
  const [nx, ny, nz] = dimsFor(s);
  const cells = nx * ny * nz;

  const cellOf = new Uint32Array(n);
  const start = new Uint32Array(cells + 1);
  for (let i = 0; i < n; i++) {
    const cx = Math.min(nx - 1, Math.floor((pos[i * 3] - bmin.x) / s));
    const cy = Math.min(ny - 1, Math.floor((pos[i * 3 + 1] - bmin.y) / s));
    const cz = Math.min(nz - 1, Math.floor((pos[i * 3 + 2] - bmin.z) / s));
    const c = (cz * ny + cy) * nx + cx;
    cellOf[i] = c;
    start[c + 1]++;
  }
  for (let c = 0; c < cells; c++) start[c + 1] += start[c];

  const cursor = start.slice(0, cells);
  const items = new Uint32Array(n);
  for (let i = 0; i < n; i++) items[cursor[cellOf[i]]++] = i;

  grid = { bmin: bmin.clone(), bmax: bmax.clone(), s, nx, ny, nz, start, items, stamp: new Uint32Array(cells), stampId: 0 };
}

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _box = new THREE.Box3();
const _hit = new THREE.Vector3();

// nearest point (to the ray origin) within `threshold` of the ray, or null
function pickGrid(ray, threshold) {
  if (!grid) buildGrid();
  const { bmin, bmax, s, nx, ny, nz, start, items, stamp } = grid;
  const pos = state.positions;
  const thr2 = threshold * threshold;
  const r = Math.min(3, Math.ceil(threshold / s));

  _box.min.copy(bmin).subScalar(threshold);
  _box.max.copy(bmax).addScalar(threshold);

  let t = 0;
  if (!_box.containsPoint(ray.origin)) {
    if (!ray.intersectBox(_box, _hit)) return null;
    t = ray.origin.distanceTo(_hit);
  }

  const id = ++grid.stampId;
  const step = s * 0.5;
  let best = -1;
  let bestDist = Infinity;

  for (let k = 0; k < 8192; k++, t += step) {
    _p.copy(ray.direction).multiplyScalar(t).add(ray.origin);
    if (!_box.containsPoint(_p)) break;

    const cx = Math.max(0, Math.min(nx - 1, Math.floor((_p.x - bmin.x) / s)));
    const cy = Math.max(0, Math.min(ny - 1, Math.floor((_p.y - bmin.y) / s)));
    const cz = Math.max(0, Math.min(nz - 1, Math.floor((_p.z - bmin.z) / s)));

    for (let z = Math.max(0, cz - r); z <= Math.min(nz - 1, cz + r); z++) {
      for (let y = Math.max(0, cy - r); y <= Math.min(ny - 1, cy + r); y++) {
        for (let x = Math.max(0, cx - r); x <= Math.min(nx - 1, cx + r); x++) {
          const c = (z * ny + y) * nx + x;
          if (stamp[c] === id) continue;
          stamp[c] = id;
          for (let j = start[c]; j < start[c + 1]; j++) {
            const i = items[j];
            _v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
            if (ray.distanceSqToPoint(_v) > thr2) continue;
            const d = ray.origin.distanceToSquared(_v);
            if (d < bestDist) {
              bestDist = d;
              best = i;
            }
          }
        }
      }
    }
  }

  return best < 0 ? null : { index: best, point: new THREE.Vector3(pos[best * 3], pos[best * 3 + 1], pos[best * 3 + 2]) };
}

// drop-in for raycaster.intersectObject(points): returns [{ index, point }] or []
export function pickNeurons(raycaster, points) {
  if (state.positions.length / 3 >= GRID_MIN_POINTS) {
    const hit = pickGrid(raycaster.ray, raycaster.params.Points.threshold);
    return hit ? [hit] : [];
  }
  return raycaster.intersectObject(points);
}
