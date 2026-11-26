// Small pure helpers.

// keep a time value as a number rounded to 1 decimal
export const toNum1 = (v) => Number.parseFloat(Number(v).toFixed(1));

export function hexToNormalizedRGB(hex) {
  const bigint = parseInt(hex.replace("#", ""), 16);
  return [((bigint >> 16) & 255) / 255, ((bigint >> 8) & 255) / 255, (bigint & 255) / 255];
}

export function getTimestampDirectory() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const ms = now.getMilliseconds().toString().padStart(3, "0");
  // NOTE: ms is added as a number (unpadded) - kept identical to the original naming.
  return "NCV_" + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + Number(ms);
}

// symmetric box smoother; w must be odd
export function smoothSeries(y, w = 7) {
  if (w < 3 || w % 2 === 0) return y.slice();
  const n = y.length;
  const k = (w - 1) / 2;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let j = -k; j <= k; j++) {
      const t = i + j;
      if (t >= 0 && t < n) {
        s += y[t];
        c++;
      }
    }
    out[i] = s / c;
  }
  return out;
}

// binary search for the index of the value in sorted xs closest to x
export function nearestIndex(xs, x) {
  if (!xs?.length) return null;
  let lo = 0;
  let hi = xs.length - 1;
  if (x <= xs[lo]) return lo;
  if (x >= xs[hi]) return hi;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    xs[mid] <= x ? (lo = mid) : (hi = mid);
  }
  return x - xs[lo] <= xs[hi] - x ? lo : hi;
}

export const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
