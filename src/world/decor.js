// Race-Off - track-side decoration.
//
// Everything that is not road geometry lives here: palm trees and rocks, flags,
// grandstand crowds, tyres on the corners, lamps on the bridges, the balloons
// over Coral Cove, dolphins in the bay, the ferris wheel, flaming torches at
// Magma Peak and the floating confetti clouds of Sky Castle.
//
// Models come from `assets` and are placed as InstancedMesh, so a thousand palm
// trees cost one draw call.

import * as THREE from 'three';
import { clamp, lerp, smooth, wrapIdx } from '../core/utils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Build a transform from position / yaw (YXZ) / scale (+ optional extra axes). */
export function instanceAt(x, y, z, ry = 0, scale = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  if (typeof scale === 'number') _s.set(scale, scale, scale);
  else _s.set(scale[0], scale[1], scale[2]);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, _s);
}

/**
 * Turn a model plus a list of matrices into a group of InstancedMeshes, one per
 * mesh inside the model, preserving the model's own hierarchy.
 */
export function instanceModel(src, matrices, castShadow = true, tint = null) {
  const group = new THREE.Group();
  if (!matrices.length) return group;
  src.updateMatrixWorld(true);
  src.traverse((node) => {
    if (!node.isMesh) return;
    const inst = new THREE.InstancedMesh(node.geometry, node.material, matrices.length);
    for (let i = 0; i < matrices.length; i++) {
      _m.multiplyMatrices(matrices[i], node.matrixWorld);
      inst.setMatrixAt(i, _m);
    }
    if (tint) {
      for (let i = 0; i < matrices.length; i++) inst.setColorAt(i, tint);
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
    inst.castShadow = castShadow;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  });
  return group;
}

/** Deterministic PRNG so the world looks the same every load. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FLAG_COLORS = [0xff3b4f, 0xffd24a, 0x22b8f0, 0xffffff, 0x35d24a, 0xff8a2a, 0xb15cff];
const SHIRT_COLORS = [0xff5c5c, 0xf2d0a0, 0xc9a35a, 0x8a6a44, 0xffd24a];
const SKIN_COLORS = [0xffce8f, 0xff9f6a, 0x33b862, 0x4a6ae0, 0xffffff, 0xff8a2a, 0x22b8f0, 0x2fa85a];

/**
 * Build the decorative dressing for a track.
 * Returns `{ group, update(t) }`.
 */
export function buildDecor(track, A, fx, quality = 'high') {
  const group = new THREE.Group();
  group.name = 'decor';
  const updates = [];
  let releaseBalloons = () => {};
  const rnd = rng(4242);
  const N = track.N;
  const def = track.def;
  const idxAt = (metres) => wrapIdx(Math.round(metres / track.seg), N);
  const headAt = (i) => Math.atan2(track.tx[wrapIdx(i, N)], track.tz[wrapIdx(i, N)]);
  const groundAt = (i, lat) => {
    track.pointAt(wrapIdx(i, N), lat, _p);
    return { x: _p.x, z: _p.z, y: track.heightAt ? track.heightAt(_p.x, _p.z) : _p.y, ty: track.py[wrapIdx(i, N)] };
  };
  const isSky = def.id === 'sky';
  const isVolcano = def.id === 'volcano';
  const isDesert = def.id === 'desert';
  const isSnow = def.id === 'snow';
  const lowQ = quality === 'low';

  // ---------------------------------------------------------------- palms etc
  if (!isSky) {
    // Palms for beach, broadleaf trees for jungle, crystals for volcano,
    // icy spires for snow (no green foliage on the ice), cacti for desert.
    const treeKey = isVolcano ? 'crystal'
      : isSnow ? 'crystal'
      : def.id === 'jungle' ? 'tree_green'
      : isDesert ? 'plant'
      : 'palm1';
    const altKey = isSnow ? 'rock2'
      : def.id === 'jungle' ? 'tree_green2'
      : isDesert ? 'bush2'
      : 'palm2';
    const rockKey = isVolcano ? 'rock3' : isDesert ? 'rock2' : 'rock1';
    const bushKey = isSnow ? 'rock1'
      : def.id === 'beach' ? 'bush' : isDesert ? 'plant' : 'plant';

    const place = (key, count, minLat, maxLat, minScale, maxScale, yOff = 0, tint = null) => {
      const src = A[key];
      if (!src) return;
      const mats = [];
      const total = lowQ ? Math.round(count * 0.5) : count;
      for (let n = 0; n < total; n++) {
        let tries = 0;
        let i;
        let lat;
        let g;
        do {
          i = (rnd() * N) | 0;
          const side = rnd() < 0.5 ? -1 : 1;
          lat = side * lerp(minLat, maxLat, rnd() * rnd());
          g = groundAt(i, lat);
          tries++;
        } while (
          tries < 6 &&
          (track.bridgeW[i] > 0.1 || track.gorgeW[i] > 0.1 || track.lavaW[i] > 0.1 || g.y < 0.6)
        );
        if (g.y < 0.6) continue;
        mats.push(instanceAt(g.x, g.y + yOff, g.z, rnd() * Math.PI * 2, lerp(minScale, maxScale, rnd())));
      }
      group.add(instanceModel(src, mats, true, tint));
    };

    // Snow: icy spires instead of trees; no foliage tint needed.
    place(treeKey, isSnow ? 120 : isDesert ? 90 : def.id === 'beach' ? 190 : 260, 11, 44, 0.75, 1.5);
    place(altKey, isSnow ? 70 : isDesert ? 40 : 90, 13, 52, 0.7, 1.25);
    place(rockKey, isDesert ? 120 : 70, 12, 40, 0.6, 1.6);
    place(bushKey, isSnow ? 60 : isDesert ? 60 : 130, 10.5, 34, 0.7, 1.3);

    if (isSnow) {
      // Snowdrift boulders and extra icy spires high on the slopes.
      place('rock3', 40, 16, 48, 0.8, 1.7);
      place('crystal', 30, 14, 40, 0.7, 1.2);
    }
    if (isDesert) {
      // Bones of the canyon: big rocks and the odd totem.
      place('rock3', 50, 14, 46, 0.8, 1.8);
      place('totem', 18, 13, 36, 0.9, 1.3);
    }

    if (def.id === 'beach') {
      // Corals and umbrellas along the shoreline.
      place('coral1', 60, 13, 30, 0.8, 1.6);
      place('coral2', 45, 14, 32, 0.8, 1.5);
      place('umbrella', 30, 12, 22, 0.9, 1.15);
      place('boat', 12, 30, 60, 1, 1.4);
    }
    if (def.id === 'jungle') {
      place('totem', 26, 12, 20, 0.85, 1.25);
      place('jtrunk', 40, 12, 26, 0.9, 1.6);
      place('bush2', 110, 10.5, 30, 0.7, 1.25);
      place('flower', 120, 10.2, 26, 0.7, 1.2);
    }
    if (isVolcano) {
      place('tikihead', 30, 12, 24, 0.9, 1.4);
      place('dragonhead', 8, 16, 30, 1, 1.4);
    }
  }

  // ------------------------------------------------------------------ flags
  if (def.flags && A.flag && !isSky) {
    const mats = [];
    const colors = [];
    for (const [from, to, sides] of def.flags) {
      for (let m = from; m <= to; m += 6.5) {
        for (const side of sides) {
          const i = idxAt(m);
          const g = groundAt(i, side * (14.3 + rnd() * 0.5));
          if (g.y < 0.8) continue;
          mats.push(instanceAt(g.x, g.y - 0.1, g.z, headAt(i) + (rnd() - 0.5) * 0.5, 1.05 + rnd() * 0.25));
          colors.push(FLAG_COLORS[Math.floor(m / 6.5) % FLAG_COLORS.length]);
        }
      }
    }
    if (mats.length) {
      const grp = instanceModel(A.flag, mats, false);
      // Recolour the cloth so the stands look festive.
      let k = 0;
      grp.children.forEach((inst) => {
        if (inst.material && inst.material.name === 'FlagCloth') {
          inst.material = inst.material.clone();
          inst.material.side = THREE.DoubleSide;
          inst.material.vertexColors = false;
          for (let i = 0; i < colors.length; i++) inst.setColorAt(i, _c.set(colors[i]));
          inst.instanceColor.needsUpdate = true;
        }
        k++;
      });
      group.add(grp);
    }
  }

  // ------------------------------------------------------------------- fans
  if (def.fans && A.person && !isSky) {
    const src = A.person;
    const body = src.getObjectByName('PersonBody');
    const head = src.getObjectByName('PersonHead');
    const list = [];
    for (const [from, to, side] of def.fans) {
      for (let m = from; m <= to; m += 0.95) {
        if (rnd() < 0.22) continue;
        const i = idxAt(m);
        const g = groundAt(i, side * (14.1 + rnd() * 1.9));
        if (g.y < 0.9 || Math.abs(g.y - g.ty) > 2.5) continue;
        list.push({
          x: g.x, y: g.y - 0.05, z: g.z,
          ry: headAt(i) + ((side < 0 ? -1 : 1) * Math.PI) / 2 + (rnd() - 0.5) * 0.6,
          ph: rnd() * 6.28, sp: 5 + rnd() * 4, amp: 0.1 + rnd() * 0.28,
          s: 0.95 + rnd() * 0.3,
          c1: SHIRT_COLORS[(rnd() * SHIRT_COLORS.length) | 0],
          c2: SKIN_COLORS[(rnd() * SKIN_COLORS.length) | 0],
        });
      }
    }
    if (list.length && body && head) {
      const bm = new THREE.InstancedMesh(body.geometry, new THREE.MeshStandardMaterial({ roughness: 0.7 }), list.length);
      const hm = new THREE.InstancedMesh(head.geometry, new THREE.MeshStandardMaterial({ roughness: 0.6 }), list.length);
      list.forEach((p, i) => {
        bm.setColorAt(i, _c.set(p.c1));
        hm.setColorAt(i, _c.set(p.c2));
      });
      bm.castShadow = true;
      bm.frustumCulled = hm.frustumCulled = false;
      group.add(bm, hm);
      let warm = false;
      updates.push((t) => {
        if (warm && group.parent === null) return;
        const player = (globalThis.__G && globalThis.__G.player) || { x: 0, z: 0 };
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          const near = (p.x - player.x) ** 2 + (p.z - player.z) ** 2 < 3600 ? 1.5 : 0.5;
          const bounce = Math.max(0, Math.sin(t * p.sp * (0.7 + near * 0.4) + p.ph)) * p.amp * near;
          _e.set(0, p.ry, 0);
          _q.setFromEuler(_e);
          _m.compose(_p.set(p.x, p.y + bounce, p.z), _q, _s.set(p.s, p.s, p.s));
          bm.setMatrixAt(i, _m);
          hm.setMatrixAt(i, _m);
        }
        warm = true;
        bm.instanceMatrix.needsUpdate = true;
        hm.instanceMatrix.needsUpdate = true;
      });
    }
  }

  // ------------------------------------------------------------------ tires
  if (A.tires && !isSky) {
    const mats = [];
    for (let i = 0; i < N; i += 2) {
      const curv = track.curv[i];
      if (Math.abs(curv) < 0.0115) continue;
      if (track.bridgeW[i] > 0.2 || track.gorgeW[i] > 0.2 || track.lagoonW[i] > 0.2) continue;
      const side = curv > 0 ? 1 : -1;
      track.pointAt(i, side * 12.42, _p);
      mats.push(instanceAt(_p.x, track.py[i] - 0.02, _p.z, rnd() * 6.28, 0.92 + rnd() * 0.1));
    }
    if (mats.length) group.add(instanceModel(A.tires, mats, true));
  }

  // ------------------------------------------------------------------ lamps
  if (A.lamp && !isSky) {
    const mask = new Float32Array(N);
    for (let i = 0; i < N; i++) mask[i] = track.bridgeW[i] > 0.3 ? 1 : 0;
    const mats = [];
    for (const [a, b] of track.ranges(mask)) {
      for (let i = a + 4; i < b; i += 16) {
        for (const side of [-1, 1]) {
          track.pointAt(i, side * (7.5 + 1.45), _p);
          const h = headAt(i) + (side < 0 ? -Math.PI / 2 : Math.PI / 2);
          mats.push(instanceAt(_p.x, track.py[i], _p.z, h, 1.15));
        }
      }
    }
    if (mats.length) group.add(instanceModel(A.lamp, mats, false));
  }

  // ------------------------------------------------------------ landmark props
  const landmarks = [];

  if (def.id === 'beach') {
    // Ferris wheel on the beach, spinning slowly.
    if (A.ferris) {
      const g = groundAt(idxAt(22), 54);
      const wheel = A.ferris.clone(true);
      wheel.position.set(g.x, Math.max(g.y, 0.4) - 0.2, g.z);
      wheel.rotation.y = headAt(idxAt(22)) + 1.1;
      wheel.scale.setScalar(1.05);
      group.add(wheel);
      const hub = wheel.getObjectByName('FerrisWheel');
      const gondolas = [];
      wheel.traverse((o) => { if (/^Gondola_/.test(o.name)) gondolas.push(o); });
      if (hub) {
        updates.push((t) => {
          const a = t * 0.14;
          hub.rotation.z = a;
          for (const g2 of gondolas) g2.rotation.z = -a;
        });
      }
    }
    // Airship circling the bay.
    if (A.airship) {
      const ship = A.airship.clone(true);
      ship.scale.setScalar(1.5);
      ship.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      group.add(ship);
      updates.push((t) => {
        const a = -0.55 + t * 0.012;
        const r = 135;
        ship.position.set(40 + Math.cos(a) * r, 78 + Math.sin(t * 0.3) * 2, 10 + Math.sin(a) * r);
        ship.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
        ship.rotation.z = Math.sin(t * 0.4) * 0.03;
      });
    }
    // Lighthouse on the point.
    if (A.lighthouse) {
      const g = groundAt(idxAt(120), 46);
      const lh = A.lighthouse.clone(true);
      lh.position.set(g.x, g.y - 0.2, g.z);
      lh.scale.setScalar(1.2);
      group.add(lh);
    }
    // Leaping dolphins.
    if (A.dolphin) {
      const pods = [
        [30, 116, 1.57, 0], [-70, 124, 1.2, 0.5], [110, 122, 1.9, 0.9],
        [-228, 8, 0.2, 0.3], [-236, -24, 2.9, 0.75], [-150, 18, 4, 0.15],
        [-128, 2, 0.8, 0.6],
      ].map(([x, z, h, ph]) => {
        const d = A.dolphin.clone(true);
        d.scale.setScalar(1.7);
        d.rotation.order = 'YXZ';
        d.rotation.y = h;
        group.add(d);
        return { d, x, z, h, ph, was: false };
      });
      updates.push((t) => {
        for (const p of pods) {
          const u = (t * 0.42 + p.ph * 1.7) % 1.7;
          const on = u < 1;
          if (on) {
            const along = (u - 0.5) * 9;
            const y = -1.6 + 5.2 * 4 * u * (1 - u);
            const slope = 5.2 * 4 * (1 - 2 * u);
            p.d.position.set(p.x + Math.sin(p.h) * along, y, p.z + Math.cos(p.h) * along);
            p.d.rotation.x = -Math.atan2(slope, 9) * 0.9;
            p.d.visible = true;
          } else {
            p.d.visible = false;
          }
          if (on !== p.was || (on && Math.abs(u - 0.93) < 0.02)) {
            const splash = on && u < 0.5 ? -4 : 4;
            if (fx) {
              fx.smoke(p.x + Math.sin(p.h) * splash, 0.3, p.z + Math.cos(p.h) * splash, 7, [1, 1, 1], 1.6, 3.5, 0.6);
            }
          }
          p.was = on;
        }
      });
    }
    // Balloon cluster that can be released on the podium.
    if (A.balloon) {
      const balloons = [];
      for (let m = -72; m <= 34; m += 8.5) {
        for (const side of [-1, 1]) {
          const g2 = groundAt(idxAt(m + (side > 0 ? 4 : 0)), side * 13.4);
          for (let k = 0; k < 4; k++) {
            balloons.push({
              ax: g2.x, ay: g2.ty + 0.9, az: g2.z,
              h: 2 + k * 0.42 + rnd() * 0.3,
              ox: (rnd() - 0.5) * 0.9, oz: (rnd() - 0.5) * 0.9,
              ph: rnd() * 6.28, vy: 3.5 + rnd() * 4,
              c: FLAG_COLORS[(rnd() * FLAG_COLORS.length) | 0],
              x: 0, y: 0, z: 0,
            });
          }
        }
      }
      const geo = new THREE.SphereGeometry(0.42, 16, 12);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.22, metalness: 0.05 });
      const inst = new THREE.InstancedMesh(geo, mat, balloons.length);
      balloons.forEach((b, i) => inst.setColorAt(i, _c.set(b.c)));
      inst.castShadow = true;
      inst.frustumCulled = false;
      group.add(inst);
      let released = false;
      let shown = false;
      let t0 = 0;
      releaseBalloons = () => { released = true; };
      updates.push((t) => {
        if (shown) return;
        if (t0 === 0) t0 = t;
        let gone = 0;
        balloons.forEach((b, i) => {
          if (released) {
            if (b.y < 400) {
              b.y += b.vy * 0.033;
              b.x += (1.5 + Math.sin(t + b.ph) * 1.2) * 0.033;
              b.z += Math.cos(t * 0.7 + b.ph) * 1.2 * 0.033;
            } else gone++;
          } else {
            b.x = b.ax + b.ox + Math.sin(t * 1.3 + b.ph) * 0.18;
            b.z = b.az + b.oz + Math.cos(t * 1.1 + b.ph) * 0.18;
            b.y = b.ay + b.h + Math.sin(t * 2 + b.ph) * 0.05;
          }
          _q.identity();
          _m.compose(_p.set(b.x, b.y, b.z), _q, _s.set(1, 1.22, 1));
          inst.setMatrixAt(i, _m);
        });
        inst.instanceMatrix.needsUpdate = true;
        if (released && gone === balloons.length) {
          inst.visible = false;
          shown = true;
        }
      });
      landmarks.push({
        release: () => { released = true; },
      });
    }
  }

  if (A.trophy && !isSky) {
    // Podium prop used by the results screen.
    const g = groundAt(idxAt(6), -30);
    const t = A.trophy.clone(true);
    t.position.set(g.x, g.y + 1.4, g.z);
    t.scale.setScalar(2.2);
    t.visible = false;
    group.add(t);
    landmarks.push({ trophy: t });
  }

  // ------------------------------------------------------- sky castle extras
  if (isSky) {
    if (A.cloud1) {
      const mats = [];
      for (let i = 0; i < (lowQ ? 30 : 60); i++) {
        const i2 = (rnd() * N) | 0;
        const side = rnd() < 0.5 ? -1 : 1;
        const g = groundAt(i2, side * (24 + rnd() * 80));
        mats.push(instanceAt(g.x, g.y + rnd() * 40 - 20, g.z, rnd() * 6.28, 3 + rnd() * 6));
      }
      group.add(instanceModel(A.cloud1, mats, false));
    }
    if (A.cloud2) {
      const mats = [];
      for (let i = 0; i < (lowQ ? 20 : 40); i++) {
        const i2 = (rnd() * N) | 0;
        const side = rnd() < 0.5 ? -1 : 1;
        const g = groundAt(i2, side * (30 + rnd() * 90));
        mats.push(instanceAt(g.x, g.y - 30 + rnd() * 30, g.z, rnd() * 6.28, 4 + rnd() * 8));
      }
      group.add(instanceModel(A.cloud2, mats, false));
    }
    if (A.balloon) {
      const mats = [];
      for (let i = 0; i < 40; i++) {
        const i2 = (rnd() * N) | 0;
        const side = rnd() < 0.5 ? -1 : 1;
        const g = groundAt(i2, side * (20 + rnd() * 40));
        mats.push(instanceAt(g.x, g.y + rnd() * 30 - 10, g.z, rnd() * 6.28, 0.8 + rnd() * 0.6));
      }
      group.add(instanceModel(A.balloon, mats, false));
    }
    if (A.crystal) {
      const mats = [];
      for (let i = 0; i < 70; i++) {
        const i2 = (rnd() * N) | 0;
        const side = rnd() < 0.5 ? -1 : 1;
        const g = groundAt(i2, side * (14 + rnd() * 30));
        mats.push(instanceAt(g.x, g.y - 4 + rnd() * 10, g.z, rnd() * 6.28, 1 + rnd() * 2.4));
      }
      group.add(instanceModel(A.crystal, mats, false));
    }
  }

  // ------------------------------------------------------------- volcano bits
  if (isVolcano && A.crystal) {
    const mats = [];
    for (let i = 0; i < 60; i++) {
      const i2 = (rnd() * N) | 0;
      const side = rnd() < 0.5 ? -1 : 1;
      const g = groundAt(i2, side * (13 + rnd() * 26));
      if (g.y < 0.5) continue;
      mats.push(instanceAt(g.x, g.y, g.z, rnd() * 6.28, 0.8 + rnd() * 1.6));
    }
    if (mats.length) group.add(instanceModel(A.crystal, mats, false));
  }

  return {
    group,
    update(t) {
      for (const u of updates) u(t);
    },
    releaseBalloons() {
      releaseBalloons();
    },
    landmarks,
  };
}
