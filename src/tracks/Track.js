// Race-Off - the track builder.
// A track is a closed CatmullRom curve plus a dense sample table. Everything
// else in the game (physics, AI, minimap, cameras) asks this object questions
// about where the road is, so the sample table is built once and reused.

import * as THREE from 'three';
import {
  wrapIdx, smooth, lerp, angleDelta, clamp,
} from '../core/utils.js';

const SEG = 0.7555; // metres between samples - the resolution of everything

export class Track {
  constructor(def) {
    this.def = def;
    const pts = def.ctrl.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();

    const N = (this.N = Math.round(this.length / SEG));
    const spaced = this.curve.getSpacedPoints(N);
    this.seg = this.length / N;

    this.px = new Float32Array(N);
    this.py = new Float32Array(N);
    this.pz = new Float32Array(N);
    this.tx = new Float32Array(N);
    this.tz = new Float32Array(N);
    this.ty = new Float32Array(N);
    this.curv = new Float32Array(N);
    this.bridge = new Float32Array(N);
    this.gorge = new Float32Array(N);
    this.lagoonW = new Float32Array(N);
    this.lavaW = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      this.px[i] = spaced[i].x;
      this.py[i] = spaced[i].y;
      this.pz[i] = spaced[i].z;
    }

    // Lagoon/lava slowly sink the road where those features live.
    for (let i = 0; i < N; i++) {
      const s = i * this.seg;
      this.lagoonW[i] = def.lagoon(s) || 0;
      this.lavaW[i] = def.lava ? def.lava(s) : 0;
      this.py[i] = lerp(this.py[i], -0.2, this.lagoonW[i]);
    }

    // Gaps: stretches where the road is missing entirely (you must jump).
    this.gaps = (def.gaps || []).map(([a, b]) => [
      Math.round(a / this.seg),
      Math.round(b / this.seg),
    ]);
    this.gap = this.gaps[0];
    this.gapMask = new Uint8Array(N);
    for (const [a, b] of this.gaps) for (let i = a; i <= b; i++) this.gapMask[wrapIdx(i, N)] = 1;
    this.gapW = this.blur(this.gapMask, 5);

    // Forward tangents.
    for (let i = 0; i < N; i++) {
      const a = wrapIdx(i - 1, N);
      const b = wrapIdx(i + 1, N);
      const dx = this.px[b] - this.px[a];
      const dz = this.pz[b] - this.pz[a];
      const dy = this.py[b] - this.py[a];
      const len = Math.hypot(dx, dz) || 1e-6;
      this.tx[i] = dx / len;
      this.tz[i] = dz / len;
      this.ty[i] = dy / len;
    }

    // Signed curvature, used by AI steering and corner signs.
    for (let i = 0; i < N; i++) {
      const a = wrapIdx(i - 6, N);
      const b = wrapIdx(i + 6, N);
      const a0 = Math.atan2(this.tx[a], this.tz[a]);
      let d = Math.atan2(this.tx[b], this.tz[b]) - a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.curv[i] = d / (12 * this.seg);

      const x = this.px[i];
      const z = this.pz[i];
      this.bridge[i] = def.bridge(x, z) ? 1 : 0;
      this.gorge[i] = def.gorge(x, z) ? 1 : 0;
    }
    this.bridgeW = this.blur(this.bridge, 22);
    this.gorgeW = this.blur(this.gorge, 14);

    // Sector boundaries measured in metres.
    this.totalLength = this.length;
    this.sections = (def.sections || []).map(([at, name, a, b]) => ({ at, name, a, b }));
  }

  /** Apply the derived data for tracks that are generated rather than authored. */
  patchGenerated() {
    const def = this.def;
    if (def._volcano) {
      const M = def.marks;
      const N = this.N;
      // Find the sample index nearest to a landmark by brute force over the
      // control-point positions, then map that to arc length.
      const idxOf = (pt) => {
        let best = 0;
        let bd = 1e18;
        for (let i = 0; i < N; i++) {
          const d =
            (this.px[i] - pt[0]) ** 2 + (this.py[i] - pt[1]) ** 2 + (this.pz[i] - pt[2]) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
        return best;
      };
      const at = (name) => idxOf(def.ctrl[M[name]]) * this.seg;
      const v = (name) => Math.round(at(name) * 10) / 10;
      this.gaps = [[v('lip'), v('land')], [v('g2') - 6.5, v('g2') + 6.5], [v('g3') - 6.5, v('g3') + 6.5]];
      this.regap();

      const rim = at('rim');
      const land = at('land');
      const total = this.length;
      def.boxes = [
        Math.round(1100) / 10,
        Math.round(rim * 0.36 * 10) / 10,
        Math.round(rim * 0.66 * 10) / 10,
        Math.round((rim + 70) * 10) / 10,
        Math.round((land + 95) * 10) / 10,
        Math.round((total - 105) * 10) / 10,
      ];
      def.pads = [
        [150, -3, 0],
        [Math.round(rim * 0.3 * 10) / 10, 3, 0],
        [Math.round(rim * 0.52 * 10) / 10, -3, 0],
        [Math.round(rim * 0.74 * 10) / 10, 0, 0],
        [Math.round(rim * 0.9 * 10) / 10, -2, 0],
        [Math.round((rim + 110) * 10) / 10, 0, 0],
        [Math.round((at('lip') - 36) * 10) / 10, 0, 0, 7.4],
        [Math.round((at('lip') - 12.4) * 10) / 10, 0, 1, 11.6],
        [Math.round((at('g2') - 6.5 - 12.4) * 10) / 10, 0, 1, 7.4],
        [Math.round((at('g3') - 6.5 - 12.4) * 10) / 10, 0, 1, 7.4],
        [Math.round((total - 70) * 10) / 10, 0, 0],
      ];
      const c = (x) => Math.round(x * 10) / 10;
      def.coins = [
        [28, 5, 7, 0, 0, 0],
        [118, 5, 7, 3.5, -4, 0],
        [200, 5, 7, -4.5, -3, 0],
        [c(rim * 0.27), 5, 7, -4, 0, 0],
        [c(rim * 0.34), 5, 7, 3, -3.5, 0],
        [c(rim * 0.42), 5, 7, -3.5, 4, 0],
        [c(rim * 0.5), 5, 7, 4, -4, 0],
        [c(rim * 0.58), 5, 7, 0, 0, 0],
        [c(rim * 0.66), 5, 7, -4, 4, 0],
        [c(rim * 0.74), 4, 7, 4, 4, 0],
        [c(rim * 0.82), 6, 7, -5, -5, 0],
        [c(rim * 0.9), 4, 7, 0, 0, 0],
        [c(rim + 15), 6, 7, -4.5, -4.5, 0],
        [c(rim + 75), 6, 7, -4.5, -4.5, 0],
        [c(rim + 135), 5, 7, -4.5, -2, 0],
        [c(land + 34), 4, 7, 0, 0, 0],
        [c(land + 80), 5, 7, -4, -4, 0],
        [c(at('g2')), 3, 6.5, 0, 0, 1],
        [c(at('g2') + 50), 5, 7, -4, -4, 0],
        [c(at('g3')), 3, 6.5, 0, 0, 1],
        [c(total - 118), 5, 7, 0, 0, 0],
        [c(total - 52), 4, 8, -3.2, -3.2, 0],
        [c(total - 52), 4, 8, 3.2, 3.2, 0],
      ];
      def.sections = [
        [60, 'EMBER COAST', '#ff8a1a', '#b3121f'],
        [c(rim * 0.22), 'SUMMIT CLIMB', '#8a5cff', '#2a1a6a'],
        [c(rim * 0.6), 'STORM RIDGE', '#ff4fd8', '#6a1280'],
        [c(rim + 8), 'CRATER RIM', '#ffb02e', '#d0300c'],
        [c(at('g2') - 44), 'LAVA FALLS', '#ff7a1a', '#8a1010'],
        [c(total - 128), 'FINAL STRAIGHT', '#ff7a1a', '#e0243c'],
      ];
      def.flags = [
        [20, 48, [-1, 1]],
        [c(total - 108), c(total - 34), [1]],
        [c(total - 108), c(total - 66), [-1]],
      ];
      def.fans = [
        [40, 66, 1], [40, 66, -1],
        [c(total - 126), c(total - 100), 1],
        [c(total - 126), c(total - 100), -1],
      ];
      this.sections = def.sections.map(([at, name, a, b]) => ({ at, name, a, b }));
    }

    if (def._sky) {
      const M = def.marks;
      const N = this.N;
      const idxOf = (name) => {
        const pt = def.ctrl[M[name]];
        let best = 0;
        let bd = 1e18;
        for (let i = 0; i < N; i++) {
          const d = (this.px[i] - pt[0]) ** 2 + (this.py[i] - pt[1]) ** 2 + (this.pz[i] - pt[2]) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
        return best;
      };
      const at = (name) => idxOf(name) * this.seg;
      const H = (x) => Math.round(x * 10) / 10;
      this.gaps = [
        [H(at('leap') - 7), H(at('leap') + 7)],
        [H(at('dive') + 3), H(at('dive') + 21)],
        [H(at('sgap') - 6), H(at('sgap') + 6)],
      ];
      this.regap();

      // Reorder the curve so the start line is index 0.
      const start = M.start;
      def.ctrl = def.ctrl.slice(start).concat(def.ctrl.slice(0, start));

      def.hide = [
        [H(at('loop0')), H(at('loop1'))],
        [H(at('cork0')), H(at('cork1'))],
      ];
      def.rails = [
        { kind: 'loop', a: H(at('loop0')), b: H(at('loop1')), r: 14 },
        { kind: 'cork', a: H(at('cork0')), b: H(at('cork1')), r: 9 },
      ];
      def.boxes = [
        H(105),
        H(at('leap1') + 40),
        H(at('gate') - 30),
        H(at('wind1') + 25),
        H(at('loop1') + 26),
        H(at('cork1') + 14),
      ];
      def.pads = [
        [H(60), 0, 0],
        [H(at('leap') - 7 - 9.2), 0, 1, 7.4],
        [H(at('leap1') + 70), -3, 0],
        [H(at('gate2') + 30), 3, 0],
        [H(at('dive') + 3 - 9.2), 0, 1, 7.4],
        [H(at('under')), 0, 0],
        [H(at('sgap') - 6 - 9.2), 0, 1, 7.4],
        [H(this.length - 40), 0, 0],
      ];
      def.coins = [
        [H(25), 5, 7, 0, 0, 0],
        [H(130), 5, 7, -4, 4, 0],
        [H(at('leap1') + 20), 5, 7, 4, -4, 0],
        [H(at('leap1') + 110), 5, 7, -4, 0, 0],
        [H(at('gate') + 20), 5, 7, 0, 0, 0],
        [H(at('gate2') + 60), 5, 7, 4, 4, 0],
        [H(at('wind0') + 20), 5, 7, -3, 3, 0],
        [H(at('dland') + 25), 5, 7, 0, 0, 0],
        [H(at('under') + 30), 5, 7, -4, -4, 0],
        [H(at('cork1') + 30), 5, 7, 4, -4, 0],
        [H(at('storm1') + 20), 5, 7, 0, 0, 0],
      ];
      def.sections = [
        [H(60), 'RAINBOW RISE', '#ff5fd2', '#7a3cff'],
        [H(at('leap0') - 25), 'RING LEAP', '#ffd23e', '#ff8a1a'],
        [H(at('leap1') + 45), 'CLOUD HIGHWAY', '#5ad8ff', '#3a6cff'],
        [H(at('gate') - 40), 'SKY CASTLE', '#ffe27a', '#c08a1a'],
        [H(at('wind0') - 22), 'CLOUD HOP', '#bfe6ff', '#6a7cff'],
        [H(at('dive') - 60), 'SKY DIVE', '#ff7ab8', '#c0246a'],
        [H(at('storm0') - 24), 'STORM CORKSCREW', '#b48cff', '#3a1a7a'],
      ];
      this.sections = def.sections.map(([at, name, a, b]) => ({ at, name, a, b }));
    }
    return this;
  }

  /** Recompute the gap mask after `this.gaps` changed. */
  regap() {
    const N = this.N;
    this.gapMask = new Uint8Array(N);
    for (const [a, b] of this.gaps) {
      const i0 = Math.round(a / this.seg);
      const i1 = Math.round(b / this.seg);
      for (let i = i0; i <= i1; i++) this.gapMask[wrapIdx(i, N)] = 1;
    }
    this.gapW = this.blur(this.gapMask, 5);
  }

  inGap(i) {
    return this.gapMask[wrapIdx(i, this.N)] === 1;
  }

  /** Where a kart re-enters the road after falling through a gap. */
  gapExit(i) {
    for (const [a, b] of this.gaps) {
      const ai = a / this.seg;
      const bi = b / this.seg;
      if (i >= ai - 40 && i <= bi + 4) return wrapIdx(Math.round(bi) + 9, this.N);
    }
    return wrapIdx(i + 9, this.N);
  }

  blur(src, radius) {
    const N = this.N;
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let a = -radius; a <= radius; a++) acc += src[wrapIdx(i + a, N)];
      out[i] = clamp(acc / (2 * radius + 1), 0, 1);
    }
    return out;
  }

  /** Half-width of the road at sample i. Narrower on bridges and gorges. */
  wallAt(i) {
    let w = lerp(12, 8.75, smooth(0.3, 0.9, this.bridgeW[i]));
    w = lerp(w, this.def.id === 'jungle' ? 10.6 : 9.4, smooth(0.3, 0.9, this.gorgeW[i]));
    return w;
  }

  /**
   * Project a world position onto the road, filling `out` with
   * { i, along, lat, y, tx, tz, slope }.
   */
  locate(x, z, hint, out) {
    const N = this.N;
    out = out || {};
    let best = 0;
    let bd = 1e18;

    if (hint == null || hint < 0) {
      for (let i = 0; i < N; i += 2) {
        const dx = x - this.px[i];
        const dz = z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      hint = best;
    }
    for (let k = -30; k <= 30; k++) {
      const i = wrapIdx(hint + k, N);
      const dx = x - this.px[i];
      const dz = z - this.pz[i];
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }

    const i = best;
    const dx = x - this.px[i];
    const dz = z - this.pz[i];
    const along = dx * this.tx[i] + dz * this.tz[i];
    out.i = i;
    out.along = along;
    out.lat = dx * -this.tz[i] + dz * this.tx[i];
    out.y = this.py[i] + this.ty[i] * along;
    out.tx = this.tx[i];
    out.tz = this.tz[i];
    out.slope = this.ty[i];
    return out;
  }

  /** World position `lat` metres left of the centreline at sample index i. */
  pointAt(i, lat, target) {
    const N = this.N;
    const a = wrapIdx(Math.floor(i), N);
    const b = wrapIdx(a + 1, N);
    const f = i - Math.floor(i);
    const x = lerp(this.px[a], this.px[b], f);
    const y = lerp(this.py[a], this.py[b], f);
    const z = lerp(this.pz[a], this.pz[b], f);
    const tx = lerp(this.tx[a], this.tx[b], f);
    const tz = lerp(this.tz[a], this.tz[b], f);
    return target.set(x - tz * lat, y, z + tx * lat);
  }

  headingAt(i) {
    const a = wrapIdx(Math.floor(i), this.N);
    return Math.atan2(this.tx[a], this.tz[a]);
  }

  /** Arc length (metres) at sample index i. */
  distAt(i) {
    return wrapIdx(Math.round(i), this.N) * this.seg;
  }

  /** Sample index for an arc-length position in metres. */
  idxAt(meters) {
    return Math.round(meters / this.seg);
  }

  /**
   * Build a ribbon mesh that follows the road.
   * `profile` is a list of [lateralOffset, heightOffset] pairs.
   */
  ribbon(from, to, profile, texScaleU = 1, step = 1, warp = null) {
    const N = this.N;
    const pos = [];
    const uv = [];
    const idx = [];
    const count = profile.length;

    let total = 0;
    const arc = [0];
    for (let i = 1; i < count; i++) {
      total += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
      arc.push(total);
    }

    let rows = 0;
    const f0 = Math.round(from);
    const f1 = Math.round(to);
    for (let m = f0; m <= f1; m += step) {
      const g = wrapIdx(m, N);
      for (let k = 0; k < count; k++) {
        let E = profile[k][0];
        let b = profile[k][1];
        if (warp) {
          const w = warp(m, k, E, b);
          E += w[0];
          b += w[1];
        }
        pos.push(this.px[g] - this.tz[g] * E, this.py[g] + b, this.pz[g] + this.tx[g] * E);
        uv.push(arc[k] / total, m * this.seg * texScaleU);
      }
      rows++;
    }
    for (let m = 0; m < rows - 1; m++) {
      for (let k = 0; k < count - 1; k++) {
        const v = m * count + k;
        const v1 = v + 1;
        const v2 = v + count;
        const v3 = v2 + 1;
        idx.push(v, v1, v2, v1, v3, v2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // Degenerate normals from sharp folds break lighting; lay them flat instead.
    const nrm = geo.attributes.normal;
    for (let k = 0; k < nrm.count; k++) {
      if (!(Math.hypot(nrm.getX(k), nrm.getY(k), nrm.getZ(k)) > 1e-4)) nrm.setXYZ(k, 0, 1, 0);
    }
    return geo;
  }

  /** Contiguous sample ranges where `field[i] > threshold`. */
  ranges(field, threshold = 0.5) {
    const N = this.N;
    const out = [];
    let start = -1;
    for (let i = 0; i < N; i++) {
      const on = field[i] > threshold;
      if (on && start < 0) start = i;
      if (!on && start >= 0) { out.push([start, i - 1]); start = -1; }
    }
    if (start >= 0) out.push([start, N - 1]);
    return out;
  }
}
