// Race-Off - the terrain shell around the road.
//
// The world is a fixed grid (see WORLD_BOUNDS) of height samples. Each sample
// is pushed away from the nearest road centreline by a radial falloff, is
// lifted for hills, sliced down along bridges, bulged up along gorges, dented
// under gaps and finally merged into a flat "below the road" shelf right next
// to the tarmac. Vertex colours blend the per-track palette, and the `aMat`
// attribute marks lava / water / snow so the terrain shader can animate them.

import * as THREE from 'three';
import { clamp, lerp, smooth, noise2 } from '../core/utils.js';

/** The fixed terrain grid. Chosen to contain every track with margin. */
export const WORLD_BOUNDS = { X0: -360, X1: 360, Z0: -330, Z1: 240, cell: 2.5 };

/**
 * Point-in-polygon test against the road centreline (sampled every 7th point),
 * used to decide whether a terrain sample is inside the track loop.
 */
function insideLoop(track, x, z) {
  const px = track.px;
  const pz = track.pz;
  const N = track.N;
  let inside = false;
  for (let a = 0, b = N - 7; a < N; b = a, a += 7) {
    const zi = pz[a];
    const zj = pz[b];
    if (zi > z !== zj > z && x < ((px[b] - px[a]) * (z - zi)) / (zj - zi) + px[a]) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from (x,z) to the nearest road sample, plus the index of that sample. */
function nearestRoad(track, x, z, coarse) {
  let best = 1e18;
  let idx = 0;
  for (let i = 0; i < track.N; i += coarse) {
    const dx = x - track.px[i];
    const dz = z - track.pz[i];
    const d = dx * dx + dz * dz;
    if (d < best) { best = d; idx = i; }
  }
  return { dist: Math.sqrt(best), idx };
}

/** Aggregate everything the terrain builder needs from a track definition. */
function trackShape(track) {
  const def = track.def;
  return {
    volcano: def.volcano && def.volcano.h > 0 ? def.volcano : null,
    shapeTerrain: def.shapeTerrain || null,
    terrainPost: def.terrainPost || null,
    gapLava: def.gapLava || null,
    noGround: !!def.noGround,
    flat: !!def.flatTerrain,
    sky: def.id === 'sky',
  };
}

export class Terrain {
  constructor(track, materials) {
    this.track = track;
    this.mats = materials;
    this.uniforms = { uTime: { value: 0 } };
    this.mesh = null;
    this.nx = 0;
    this.nz = 0;
    this.H = null;
  }

  build() {
    const { X0, X1, Z0, Z1, cell } = WORLD_BOUNDS;
    const nx = Math.round((X1 - X0) / cell) + 1;
    const nz = Math.round((Z1 - Z0) / cell) + 1;
    const N = this.track.N;
    const t = this.track;
    const shape = trackShape(t);
    const pal = t.def.palette || [];
    const colors = pal.map((c) => new THREE.Color(c));
    const flat = pal.length >= 7 ? colors : [
      new THREE.Color('#ffe3a3'), new THREE.Color('#e2c283'),
      new THREE.Color('#7ccf4c'), new THREE.Color('#4fae3c'),
      new THREE.Color('#9a8d80'), new THREE.Color('#6e625c'),
      new THREE.Color('#3a2c2a'),
    ];

    this.nx = nx;
    this.nz = nz;
    const H = (this.H = new Float32Array(nx * nz));

    if (shape.noGround) {
      // Sky Castle floats in the void; there is no terrain at all.
      H.fill(-300);
      this.mesh = new THREE.Group();
      return this.mesh;
    }

    // Pass 1: heights.
    const colorArr = new Float32Array(nx * nz * 3);
    const matArr = new Float32Array(nx * nz * 2);
    const insideCache = new Uint8Array(nx * nz);

    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        const x = X0 + i * cell;
        const z = Z0 + k * cell;
        const near = nearestRoad(t, x, z, 2);
        const dist = near.dist;
        const idx = near.idx;
        const roadY = t.py[idx] - 0.14 - 0.75 * smooth(0.1, -0.15, t.py[idx]);
        const big = noise2(x * 0.011 + 3.1, z * 0.011 + 7.7, 4);
        const small = noise2(x * 0.045, z * 0.045, 3);
        const bridgeW = t.bridgeW[idx];
        const gorgeW = t.gorgeW[idx];
        const inside = insideLoop(t, x, z);
        insideCache[k * nx + i] = inside ? 1 : 0;

        let y;
        if (shape.volcano && (Math.hypot(x - shape.volcano.x, z - shape.volcano.z) < 118 || inside)) {
          const vd = Math.hypot(x - shape.volcano.x, z - shape.volcano.z);
          const hill = smooth(38, 64, vd);
          const rough = smooth(14, 75, dist) * (9 + 16 * big) * hill;
          const cone =
            shape.volcano.h *
            Math.pow(Math.max(0, 1 - vd / shape.volcano.r), 1.55) *
            smooth(40, 70, vd) *
            smooth(12, 55, dist);
          y = roadY + rough + cone + (small - 0.5) * 3 * smooth(14, 32, dist) * hill -
            4.2 * smooth(34, 27, vd);
        } else if (inside) {
          const rough = smooth(14, 75, dist) * (9 + 16 * big);
          let peak = 0;
          if (shape.volcano) {
            const vd = Math.hypot(x - shape.volcano.x, z - shape.volcano.z);
            peak = shape.volcano.h * Math.pow(Math.max(0, 1 - vd / shape.volcano.r), 1.55);
            peak -= 16 * smooth(20, 5, vd);
            peak *= smooth(12, 55, dist);
          }
          y = roadY + rough + peak + (small - 0.5) * 3 * smooth(14, 32, dist);
        } else {
          // Outside the loop the ground runs out to open water / sky.
          const bank = 46 + 22 * big;
          y = dist < bank
            ? lerp(roadY, 0.45, smooth(13.5, bank, dist))
            : lerp(0.45, -10, smooth(bank, bank + 55, dist));
          y += (small - 0.5) * 2.4 * smooth(15, 34, dist) * smooth(-2, 2, y);
        }

        // Gorges push the ground up into cliffs either side of the road.
        y += gorgeW * smooth(9.8, 16, dist) * (14 + 7 * big + (small - 0.5) * 6);

        if (shape.shapeTerrain) {
          y = shape.shapeTerrain(y, x, z, dist, idx, t, big, small);
        }

        // Sit just below the tarmac so the road never z-fights the ground.
        y = lerp(y, -7.5 + small * 1.5, bridgeW * smooth(0, 0.6, bridgeW));

        if (shape.terrainPost) {
          y = shape.terrainPost(y, x, z, dist, idx, t, big, small);
        }

        // Never let the far terrain bury the road: right next to the tarmac the
        // ground has to stay roughly level with it, whatever the shaper decided.
        if (shape.volcano) {
          const cap = roadY + 26 * smooth(8, 40, dist);
          if (y > cap) y = lerp(y, cap, smooth(60, 14, dist));
        }

        // Under a gap the ground drops away.
        const gw = t.gapW[idx];
        if (gw > 0.01 && !shape.sky) {
          y -= gw * (
            dist < 15
              ? 6.5
              : 6.5 * (1 - smooth(15, 85, dist)) + 1.2 * smooth(15, 30, dist) * (1 - smooth(60, 110, dist))
          );
        }

        H[k * nx + i] = y;

        // --- vertex colour blend
        const c = new THREE.Color();
        const n1 = noise2(x * 0.03 + 11, z * 0.03 + 5, 3);
        const n2 = noise2(x * 0.12, z * 0.12, 2);
        c.copy(flat[2]).lerp(flat[3], smooth(0.3, 0.7, n1));
        c.lerp(flat[0], smooth(3.4, 2.5, y - n2 * 0.9));
        c.lerp(flat[1], smooth(0.7, 0, y));

        // Lava / water mask, stored in matArr[0].
        let lava = 0;
        if (shape.volcano) {
          const vd = Math.hypot(x - shape.volcano.x, z - shape.volcano.z);
          lava = smooth(30, 58, y + n1 * 14);
          c.lerp(flat[4], lava);
          c.lerp(flat[5], smooth(70, 86, y));
          if (vd < 250 && idx > 6) {
            const ang = Math.atan2(z - shape.volcano.z, x - shape.volcano.x);
            for (let f = 0; f < 5; f++) {
              let a = ang - (f * 1.2566 + 0.5 + 0.28 * Math.sin(idx * 0.065 + f * 2.1));
              a = Math.atan2(Math.sin(a), Math.cos(a));
              const spread = Math.abs(a) * idx;
              const w = Math.min(6.2, 3.6 + idx * 0.035 - f * 0.3);
              const strength =
                (smooth(245, 215, idx) * smooth(-0.4, 0.9, y) * smooth(40, 52, idx)) /
                Math.max(0.001, smooth(9, 17, idx));
              const m = smooth(w, w * 0.25, spread) * strength;
              if (m > lava) lava = m;
              c.lerp(flat[6], smooth(w * 2.6, w, spread) * strength * 0.85);
            }
          }
        }

        // Lagoon / lake blending.
        const lw = t.lagoonW[idx];
        if (lw > 0.01 && dist > 7.6) {
          const m = lw * smooth(7.6, 8.6, dist) * (1 - smooth(110, 150, dist));
          c.lerp(flat[6], m * 0.97);
          lava = Math.max(lava, m);
        }

        // Brighten peaks slightly.
        const shade = 0.9 + n2 * 0.2;
        colorArr[(k * nx + i) * 3] = c.r * shade;
        colorArr[(k * nx + i) * 3 + 1] = c.g * shade;
        colorArr[(k * nx + i) * 3 + 2] = c.b * shade;
        matArr[(k * nx + i) * 2] = lava;
        matArr[(k * nx + i) * 2 + 1] = 0;
      }
    }

    // Pass 2: smooth the lava mask so it reads as flowing rather than blocky.
    for (let pass = 0; pass < 10; pass++) {
      const src = matArr.slice();
      for (let k = 1; k < nz - 1; k++) {
        for (let i = 1; i < nx - 1; i++) {
          const o = (k * nx + i) * 2;
          const avg =
            (src[o - 2] + src[o + 2] + src[o - nx * 2] + src[o + nx * 2]) * 0.2 +
            (src[o - nx * 2 - 2] + src[o - nx * 2 + 2] + src[o + nx * 2 - 2] + src[o + nx * 2 + 2]) * 0.05;
          matArr[o] = lerp(src[o], avg, 0.9);
        }
      }
    }

    // Pass 3: geometry.
    const geo = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, nx - 1, nz - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);

    const pos = geo.attributes.position;
    for (let i = 0; i < nx * nz; i++) pos.setY(i, H[i]);
    geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
    geo.setAttribute('aMat', new THREE.BufferAttribute(matArr, 2));
    geo.computeVertexNormals();

    const uv = geo.attributes.uv;
    for (let i = 0; i < nx * nz; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      uv.setXY(i, x / 9, z / 9);
    }

    const mat = this.mats.terrain;
    mat.uniforms = this.uniforms;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'terrain';
    return this.mesh;
  }

  /** Height of the terrain at a world position (bilinear on the grid). */
  heightAt(x, z) {
    const { X0, Z0, cell } = WORLD_BOUNDS;
    const fx = (x - X0) / cell;
    const fz = (z - Z0) / cell;
    const i = Math.floor(fx);
    const k = Math.floor(fz);
    if (i < 0 || k < 0 || i >= this.nx - 1 || k >= this.nz - 1) return -10;
    const tx = fx - i;
    const tz = fz - k;
    const H = this.H;
    const a = H[k * this.nx + i];
    const b = H[k * this.nx + i + 1];
    const c = H[(k + 1) * this.nx + i];
    const d = H[(k + 1) * this.nx + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  update(time) {
    this.uniforms.uTime.value = time;
  }
}
