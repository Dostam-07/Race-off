// Race-Off - shared math utilities.
// Reconstructed from the original bundle. Function names mirror intent, not the
// original minified identifiers.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite smoothstep between edges `a` and `b`. */
export const smooth = (a, b, t) => {
  const n = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return n * n * (3 - 2 * n);
};

/** Frame-rate independent exponential smoothing. */
export const damp = (from, to, rate, dt) =>
  from + (to - from) * (1 - Math.exp(-rate * dt));

/** Wrap an integer index into [0, n). */
export const wrapIdx = (i, n) => ((i % n) + n) % n;

/** Shortest signed angular difference from `from` to `to`, in (-PI, PI]. */
export const angleDelta = (to, from) => {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export const angleDamp = (to, from, rate, dt) =>
  from + angleDelta(to, from) * (1 - Math.exp(-rate * dt));

export const rand = (a, b) => a + Math.random() * (b - a);

/** Deterministic value noise in 0..1 (hash-based, smooth interpolation). */
function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h ^= h >> 16;
  return ((h >>> 0) % 100000) / 100000;
}

function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return lerp(
    lerp(hash2(xi, yi), hash2(xi + 1, yi), u),
    lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u),
    v,
  );
}

/** Fractal value noise in 0..1; `octaves` layers, each at 2.03x frequency. */
export function noise2(x, y, octaves = 4) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x, y);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Deterministic PRNG (mulberry32) used for repeatable world decoration. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Format seconds as m:ss.mm for the race timer. */
export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Ordinal suffix used by the position HUD. */
export function ordinal(n) {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Distance from point to a 2D segment. */
export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(px - x1 - dx * t, py - y1 - dy * t);
}

/** Distance from point to a polyline of [x,y] pairs. */
export function distToPath(px, py, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

export const isTouch =
  typeof matchMedia !== 'undefined' &&
  matchMedia('(pointer: coarse)').matches &&
  matchMedia('(hover: none)').matches;

export const $ = (id) => document.getElementById(id);
