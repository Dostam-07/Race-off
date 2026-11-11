// Race-Off - pickups and the six items.
//
// Coins, item boxes, boost pads and jump ramps live here along with the items
// themselves: chili, rocket, durian trap, super star, bubble shield and bolt.
//
// Item odds are rank-weighted: the further back you are the better the roll.

import * as THREE from 'three';
import { clamp, lerp, smooth, wrapIdx } from '../core/utils.js';

export const ITEM_NAMES = {
  chili: 'CHILI BOOST',
  rocket: 'HOMING ROCKET',
  durian: 'DURIAN TRAP',
  star: 'SUPER STAR',
  bolt: 'THUNDER BOLT',
  shield: 'BUBBLE SHIELD',
};

/** Which items can appear, and the icon order used by the HUD roulette. */
export const ITEM_ORDER = ['chili', 'rocket', 'durian', 'shield', 'star', 'bolt'];

export const MAX_COINS = 10;
export const RAMP_H = 0.95;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class Items {
  constructor(game) {
    this.game = game;
    this.boxes = [];
    this.rockets = [];
    this.traps = [];
    this.pads = [];
    this.coinList = [];
    this.trapN = 0;
    this.warnT = 0;
    this.gone = new Set();
    this.build();
  }

  // ----------------------------------------------------------------- build
  build() {
    const g = this.game;
    const t = g.track;
    const def = t.def;
    const scene = g.scene;

    // ---- item box look: rainbow cube with a big "?"
    this.boxTex = canvasTex(256, 256, (d, w, h) => {
      const grad = d.createLinearGradient(0, 0, w, h);
      ['#ff4d6d', '#ffb02e', '#ffe14a', '#3fe08a', '#35b8ff', '#a66bff', '#ff4dd2']
        .forEach((c, i, arr) => grad.addColorStop(i / (arr.length - 1), c));
      d.fillStyle = grad;
      d.fillRect(0, 0, w, h);
      d.strokeStyle = 'rgba(255,255,255,0.9)';
      d.lineWidth = 10;
      d.strokeRect(8, 8, w - 16, h - 16);
      d.font = '900 190px "Arial Rounded MT Bold", Arial, sans-serif';
      d.textAlign = 'center';
      d.textBaseline = 'middle';
      d.lineWidth = 16;
      d.strokeStyle = '#3a2a6a';
      d.strokeText('?', w / 2, h / 2 + 8);
      d.fillStyle = '#fff';
      d.fillText('?', w / 2, h / 2 + 8);
    });

    const boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5, 4, 4, 4);
    const boxMat = new THREE.MeshStandardMaterial({
      map: this.boxTex,
      emissive: 0xffffff,
      emissiveMap: this.boxTex,
      emissiveIntensity: 0.85,
      roughness: 0.12,
      metalness: 0,
      transparent: true,
      opacity: 0.93,
    });

    for (const m of this.game.noItems ? [] : def.boxes || []) {
      for (const lat of [-4.8, -1.6, 1.6, 4.8]) {
        const i = wrapIdx(Math.round(m / t.seg), t.N);
        t.pointAt(i, lat, _v);
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.position.set(_v.x, _v.y + 1.25, _v.z);
        box.castShadow = true;
        scene.add(box);
        this.boxes.push({
          mesh: box, x: _v.x, y: _v.y + 1.25, z: _v.z,
          cd: 0, ph: Math.random() * 6,
        });
      }
    }

    // ---- boost pad art
    this.padMat = new THREE.MeshBasicMaterial({
      map: canvasTex(128, 256, (d, w, h) => {
        d.fillStyle = '#ff5a00';
        d.fillRect(0, 0, w, h);
        d.fillStyle = '#ffe94a';
        for (let i = 0; i < 4; i++) {
          const y = i * 64;
          d.beginPath();
          d.moveTo(0, y + 64);
          d.lineTo(w / 2, y + 20);
          d.lineTo(w, y + 64);
          d.lineTo(w, y + 40);
          d.lineTo(w / 2, y - 4);
          d.lineTo(0, y + 40);
          d.fill();
        }
      }),
      color: new THREE.Color(1.5, 1.5, 1.5),
      polygonOffset: true,
      polygonOffsetFactor: -6,
    });

    const chevronMat = new THREE.MeshStandardMaterial({
      map: canvasTex(64, 64, (d, w, h) => {
        d.fillStyle = '#ffffff';
        d.fillRect(0, 0, w, h);
        d.fillStyle = '#ff3b6b';
        for (let i = -1; i < 3; i++) {
          d.beginPath();
          d.moveTo(i * 32, h);
          d.lineTo(i * 32 + 16, h);
          d.lineTo(i * 32 + 48, 0);
          d.lineTo(i * 32 + 32, 0);
          d.fill();
        }
      }),
      roughness: 0.4,
      side: THREE.DoubleSide,
    });

    const RAMP_LEN = 12;
    for (const [m, lat, isJump, hw] of def.pads || []) {
      const i0 = wrapIdx(Math.round(m / t.seg), t.N);
      const halfW = hw || (isJump ? 3.2 : 2.6);
      const lift = (k) =>
        isJump ? RAMP_H * Math.pow(clamp((k - i0) / RAMP_LEN, 0, 1), 1.4) : 0;

      const pad = new THREE.Mesh(
        t.ribbon(i0, i0 + RAMP_LEN, [[lat - halfW, 0.085], [lat + halfW, 0.085]], 1 / (RAMP_LEN * t.seg), 1, (k) => [0, lift(k)]),
        this.padMat,
      );
      scene.add(pad);

      if (isJump) {
        for (const side of [-1, 1]) {
          const wall = new THREE.Mesh(
            t.ribbon(i0, i0 + RAMP_LEN, [[lat + side * halfW, 0], [lat + side * halfW, 0.085]], 1 / 3, 1, (k, c) => [0, c ? lift(k) : 0]),
            chevronMat,
          );
          wall.castShadow = true;
          scene.add(wall);
        }
        const lip = new THREE.Mesh(
          t.ribbon(i0 + RAMP_LEN, i0 + RAMP_LEN + 1, [[lat - halfW, 0], [lat + halfW, 0]], 1 / 3, 1, (k) => [0, k === i0 + RAMP_LEN ? RAMP_H + 0.085 : 0.02]),
          chevronMat,
        );
        scene.add(lip);
      }
      this.pads.push({ i0, i1: i0 + RAMP_LEN, lat, jump: isJump, hw: halfW });
    }

    // ---- coins as a single InstancedMesh (skipped in time trial)
    const coinSrc = g.A.coin && !g.noItems && (g.A.coin.getObjectByName('Coin') || g.A.coin.children[0]);
    if (coinSrc) {
      g.A.coin.updateMatrixWorld(true);
      const geo = coinSrc.geometry.clone().applyMatrix4(coinSrc.matrixWorld);
      for (const [from, count, spacing, lat0, lat1, jump] of def.coins || []) {
        for (let k = 0; k < count; k++) {
          const i = wrapIdx(Math.round((from + k * spacing) / t.seg), t.N);
          const lat = count > 1 ? lerp(lat0, lat1, k / (count - 1)) : lat0;
          t.pointAt(i, lat, _v);
          this.coinList.push({
            x: _v.x,
            y: _v.y + (jump ? 1.9 + Math.sin(((k + 0.5) / count) * Math.PI) * 1 : 0.95),
            z: _v.z,
            cd: 0,
            ph: k * 0.7,
            s: 1,
          });
        }
      }
      coinSrc.material.emissiveIntensity = 0.9;
      this.coinMesh = new THREE.InstancedMesh(geo, coinSrc.material, this.coinList.length);
      this.coinMesh.frustumCulled = false;
      this.coinMesh.castShadow = true;
      scene.add(this.coinMesh);
    }

    // ---- the animated coin halo
    this.models = { rocket: g.A.rocket, durian: g.A.durian };
  }

  /** Extra ground height from a jump ramp at a given sample + offset. */
  rampY(idx, along, lat) {
    const t = this.game.track;
    for (const p of this.pads) {
      if (!p.jump) continue;
      let d = idx - p.i0;
      if (d < -t.N / 2) d += t.N;
      const k = d + along / t.seg;
      if (k >= 0 && k <= p.i1 - p.i0 && Math.abs(lat - p.lat) < p.hw + 0.4) {
        return RAMP_H * Math.pow(k / (p.i1 - p.i0), 1.4);
      }
    }
    return 0;
  }

  // ------------------------------------------------------------------ items
  /** Rank-weighted item roll. */
  pick(kart) {
    const table = {
      1: { durian: 4, shield: 3, chili: 2.5, rocket: 0.5 },
      2: { chili: 3, rocket: 3, durian: 2, shield: 2 },
      3: { chili: 3, rocket: 3, durian: 2, shield: 2 },
      4: { chili: 3, rocket: 3.5, shield: 1.5, star: 1, durian: 1 },
      5: { star: 2.6, bolt: 2, rocket: 2.6, chili: 2.4 },
      6: { star: 3.2, bolt: 2.6, rocket: 2.4, chili: 1.8 },
    }[kart.rank] || { chili: 1 };

    if (!kart.isPlayer && table.bolt) table.bolt *= 0.4;
    let total = 0;
    for (const k in table) total += table[k];
    let roll = Math.random() * total;
    for (const k in table) {
      roll -= table[k];
      if (roll <= 0) return k;
    }
    return 'chili';
  }

  /** Fire the kart's held item. */
  use(kart) {
    const g = this.game;
    const item = kart.item;
    if (!item) return;

    kart.item = null;
    if (kart.isPlayer) g.hud.setItem(null);

    if (item === 'chili') {
      kart.giveBoost(1.9, 1.36);
      if (!kart.isPlayer) g.fx.burst(kart.x, kart.y + 1, kart.z, 10, 5, [4, 1, 0.2], 0.5);
      return;
    }

    if (item === 'rocket') {
      const target = g.ranked[kart.rank - 2] || null;
      const from = kart.idx + 3;
      const speed = Math.max(kart.speed + 26, 58);
      this.spawnRocket(kart, target, from, kart.lat, speed);
      g.mp?.ev({
        e: 'rocket', by: g.rid(kart), tg: target ? g.rid(target) : -1,
        fi: from, lat: kart.lat, sp: speed,
      });
      return;
    }

    if (item === 'star') {
      kart.star = 6.5;
      kart.zap = 0;
      kart.giveBoost(6.5, 1.2);
      kart.say('\u{1F929}', 2);
      g.fx.sparks(kart.x, kart.y + 0.8, kart.z, 24, 10, [4, 3.4, 0.8], 0.5, 0.8);
      if (kart.isPlayer) {
        g.audio.setStar(true);
        g.hud.toast('SUPER STAR!', 'gold', 1.4);
      }
      return;
    }

    if (item === 'shield') {
      kart.shield = 12;
      if (kart.isPlayer) {
        g.audio.sfx('shield');
        g.hud.toast('SHIELD UP', 'cyan', 1);
      }
      return;
    }

    if (item === 'bolt') {
      this.bolt(kart);
      g.mp?.ev({ e: 'bolt', by: g.rid(kart) });
      return;
    }

    if (item === 'durian') {
      const x = kart.x - Math.sin(kart.heading) * 2.6;
      const z = kart.z - Math.cos(kart.heading) * 2.6;
      const id = g.rid(kart) * 1000 + ((this.trapN = (this.trapN || 0) + 1) % 1000);
      this.spawnTrap(kart, id, x, kart.y, z, kart.heading);
      g.mp?.ev({
        e: 'trap', by: g.rid(kart), id, x, y: kart.y, z, h: kart.heading,
      });
      if (kart.isPlayer) g.audio.sfx('drop');
    }
  }

  spawnRocket(owner, target, fromIdx, lat, speed) {
    const g = this.game;
    if (!this.models.rocket) return;
    const mesh = this.models.rocket.clone(true);
    mesh.scale.setScalar(1.7);
    g.scene.add(mesh);
    this.rockets.push({
      mesh, owner, target, fi: fromIdx, lat, life: 5, speed,
    });
    if (owner.isPlayer || target === g.player) g.audio.sfx('rocket');
  }

  spawnTrap(owner, id, x, y, z, heading) {
    if (!this.models.durian) return;
    const mesh = this.models.durian.clone(true);
    mesh.scale.setScalar(1.5);
    mesh.position.set(x, y, z);
    mesh.rotation.y = heading + Math.PI;
    this.game.scene.add(mesh);
    this.traps.push({ mesh, id, x, z, y, owner, age: 0 });
  }

  /** Thunder bolt: shrinks and slows everyone ahead of `caster`. */
  bolt(caster) {
    const g = this.game;
    g.flash = 1;
    g.audio.sfx('thunder');
    let hit = 0;
    for (const k of g.karts) {
      if (k === caster || k.progress < caster.progress || k.finished) continue;
      if (k.star > 0) continue;
      if (k.shield > 0) {
        if (!k.remote) k.popShield();
        continue;
      }
      hit++;
      for (let i = 0; i < 7; i++) {
        g.fx.streaks.spawn(
          k.x + (Math.random() - 0.5) * 1.5,
          k.y + 14 + Math.random() * 10,
          k.z + (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 4, -90, (Math.random() - 0.5) * 4,
          0.22, 9, 0.16, 4, 3.8, 1.5, 1, 0, 1,
        );
      }
      if (!k.remote) {
        k.zap = 4;
        k.boost = 0;
        k.drifting = false;
        k.speed *= 0.7;
        k.say('\u26A1', 2.2);
        if (k.isPlayer) {
          g.hud.toast('ZAPPED!', 'red', 1.3);
          g.shake = 0.5;
        }
      }
    }
    if (caster.isPlayer) {
      g.hud.toast(hit ? `THUNDER! \u00D7${hit}` : 'THUNDER!', 'gold', 1.3);
    }
  }

  /** Apply an item event received over the network. */
  netEvent(ev, fromId) {
    const g = this.game;
    if (!ev || typeof ev !== 'object') return null;
    const owner = g.kartOf(ev.by);
    if (!owner || !owner.remote || (fromId >= 0 && ev.by !== fromId)) return null;
    const finite = Number.isFinite;

    if (ev.e === 'rocket') {
      if (![ev.fi, ev.lat, ev.sp].every(finite) || this.rockets.length > 12) return null;
      const out = {
        e: 'rocket', by: ev.by, tg: ev.tg | 0, fi: ev.fi,
        lat: clamp(ev.lat, -12, 12), sp: clamp(ev.sp, 30, 90),
      };
      this.spawnRocket(owner, g.kartOf(out.tg) || null, out.fi, out.lat, out.sp);
      return out;
    }
    if (ev.e === 'bolt') {
      this.bolt(owner);
      return { e: 'bolt', by: ev.by };
    }
    if (ev.e === 'trap') {
      if (![ev.id, ev.x, ev.y, ev.z, ev.h].every(finite) || this.traps.length > 24) return null;
      const out = { e: 'trap', by: ev.by, id: ev.id | 0, x: ev.x, y: ev.y, z: ev.z, h: ev.h };
      if (!this.gone.has(out.id)) this.spawnTrap(owner, out.id, out.x, out.y, out.z, out.h);
      return out;
    }
    if (ev.e === 'untrap') {
      const id = ev.id | 0;
      const idx = this.traps.findIndex((t) => t.id === id);
      if (idx >= 0) {
        const trap = this.traps[idx];
        g.fx.burst(trap.x, trap.y + 0.6, trap.z, 26, 9, [1.6, 2.6, 0.4], 0.6, 0.6);
        g.scene.remove(trap.mesh);
        this.traps.splice(idx, 1);
      } else {
        this.gone.add(id);
      }
      return { e: 'untrap', by: ev.by, id };
    }
    return null;
  }

  explode(x, y, z) {
    const fx = this.game.fx;
    fx.burst(x, y + 0.6, z, 46, 15, [4.5, 1.6, 0.3], 0.9, 0.8);
    fx.burst(x, y + 0.6, z, 20, 8, [4, 3.5, 2], 1.3, 0.4);
    fx.smoke(x, y + 0.5, z, 14, [0.35, 0.33, 0.36], 2.4, 3.5, 0.6);
  }

  // ----------------------------------------------------------------- update
  update(dt, active) {
    const g = this.game;
    const t = g.track;
    const time = g.time;

    this.padMat.map.offset.y = -time * 2.2;

    // ---- coins
    if (this.coinMesh) {
      const list = this.coinList;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.cd > 0) {
          c.cd -= dt;
          c.s = 0;
        } else {
          c.s = Math.min(1, c.s + dt * 3);
        }
        _e.set(0, time * 3.2 + c.ph, 0);
        _q.setFromEuler(_e);
        _m.compose(
          _p.set(c.x, c.y + Math.sin(time * 2.6 + c.ph) * 0.1, c.z),
          _q,
          _s.setScalar(c.s * 0.95),
        );
        this.coinMesh.setMatrixAt(i, _m);

        if (!active || c.cd > 0) continue;
        for (const k of g.karts) {
          const dx = k.x - c.x;
          const dz = k.z - c.z;
          if (dx * dx + dz * dz < 2.6 && Math.abs(k.y + 0.7 - c.y) < 1.7) {
            c.cd = k.isPlayer ? 9 : 1.2;
            g.fx.sparks(c.x, c.y, c.z, 7, 5, [4, 2.8, 0.5], 0.3, 0.45);
            g.fx.glow.spawn(c.x, c.y, c.z, 0, 0, 0, 0.14, 2.2, 0.4, 2.4, 1.8, 0.5, 0.9, 0, 0);
            if (k.coins < MAX_COINS) k.coins++;
            if (k.isPlayer) {
              g.audio.sfx('coin', k.coins);
              g.hud.setCoins(k.coins);
              k.speed += 0.5;
              k.addTurbo(0.15);
            }
            break;
          }
        }
      }
      this.coinMesh.instanceMatrix.needsUpdate = true;
    }

    // ---- item boxes
    for (const b of this.boxes) {
      if (b.cd > 0) {
        b.cd -= dt;
        b.mesh.scale.setScalar(b.cd <= 0 ? 0.01 : 0);
        if (b.cd <= 0) b.mesh.visible = true;
        continue;
      }
      const s = b.mesh.scale.x;
      if (s < 1) b.mesh.scale.setScalar(Math.min(1, s + dt * 3));
      b.mesh.rotation.y = time * 1.6 + b.ph;
      b.mesh.rotation.x = Math.sin(time * 1.1 + b.ph) * 0.35;
      b.mesh.position.y = b.y + Math.sin(time * 2.4 + b.ph) * 0.18;

      if (!active) continue;
      for (const k of g.karts) {
        const dx = k.x - b.x;
        const dz = k.z - b.z;
        if (dx * dx + dz * dz < 3.6 && Math.abs(k.y + 0.8 - b.y) < 2.2) {
          b.cd = 3.2;
          b.mesh.visible = false;
          g.fx.burst(b.x, b.y, b.z, 22, 9, [2.5, 2.2, 1.2], 0.55, 0.5);
          g.fx.burst(b.x, b.y, b.z, 12, 6, [0.6, 1.6, 3.5], 0.45, 0.5);
          if (!k.remote && !k.item && !(k.roll > 0) && !k.finished) {
            k.roll = k.isPlayer ? 1.5 : 0.8;
            if (k.isPlayer) {
              g.audio.sfx('pickup');
              g.hud.startRoulette();
            }
          } else if (k.isPlayer) {
            g.audio.sfx('pickup');
          }
          break;
        }
      }
    }

    if (!active) return;

    // ---- roulette finishing, item use, pads
    for (const k of g.karts) {
      if (k.remote) continue;

      if (k.roll > 0) {
        k.roll -= dt;
        if (k.roll <= 0) {
          k.item = this.pick(k);
          k.itemHold = 1 + Math.random() * 4;
          if (k.isPlayer) {
            g.hud.setItem(k.item);
            g.audio.sfx('itemget');
          }
        }
      }
      if (k.input.item && k.item && k.spin <= 0) this.use(k);

      if (k.onGround) {
        for (const pad of this.pads) {
          let d = k.idx - pad.i0;
          if (d < 0) d += t.N;
          if (d > pad.i1 - pad.i0) continue;
          if (Math.abs(k.lat - pad.lat) >= pad.hw + 0.5) continue;

          if (!(k.pad > 0)) k.giveBoost(pad.jump ? 0.9 : 1.2, 1.3);
          k.pad = 0.5;
          if (pad.jump && d >= pad.i1 - pad.i0 - 1 && !k.launch) {
            k.vy = Math.max(k.vy, 9.6);
            k.onGround = false;
            k.launch = true;
            if (k.isPlayer && (this.hintN = (this.hintN || 0) + 1) <= 3) {
              g.hud.toast('SPACE = TRICK', '', 0.9);
            } else if (Math.random() < 0.8) {
              k.trickAt = 0.12 + Math.random() * 0.15;
            }
          }
        }
      }
      if (k.trickAt > 0 && !k.onGround) {
        k.trickAt -= dt;
        if (k.trickAt <= 0) k.doTrick();
      }
      k.pad -= dt;
    }

    // ---- rockets
    let incoming = false;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      r.fi += (r.speed * dt) / t.seg;
      let hit = null;

      if (r.target === g.player) incoming = true;
      if (r.target) {
        r.lat = lerp(r.lat, r.target.lat, Math.min(1, dt * 4));
        let gap = wrapIdx(r.target.idx - r.fi, t.N);
        if (gap > t.N / 2) gap -= t.N;
        if (gap < 2.5 && gap > -4) hit = r.target;
      }
      t.pointAt(r.fi, r.lat, _v);
      const y = _v.y + 0.9;
      r.mesh.position.set(_v.x, y, _v.z);
      const si = wrapIdx(Math.floor(r.fi), t.N);
      r.mesh.rotation.y = Math.atan2(t.tx[si], t.tz[si]);
      r.mesh.rotation.z = time * 9;

      g.fx.glow.spawn(_v.x, y, _v.z,
        (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2,
        0.3, 0.9, 0.1, 4.5, 1.6, 0.3, 1, 0, 1);
      if (Math.random() < 0.6) {
        g.fx.alpha.spawn(_v.x, y, _v.z, 0, 0.5, 0, 0.6, 0.4, 1.4, 0.9, 0.9, 0.92, 0.35, -0.5, 1);
      }

      if (!hit) {
        for (const k of g.karts) {
          if (k === r.owner || (r.target && k !== r.target)) continue;
          const dx = k.x - _v.x;
          const dz = k.z - _v.z;
          if (dx * dx + dz * dz < 5) {
            hit = k;
            break;
          }
        }
      }

      if (hit || r.life <= 0) {
        if (hit) {
          hit.spinOut();
          this.explode(hit.x, hit.y, hit.z);
          const d = Math.hypot(hit.x - g.player.x, hit.z - g.player.z);
          if (d < 60) g.audio.sfx('explode', clamp(1 - d / 60, 0.15, 1));
          if (d < 14) g.shake = 0.5;
        }
        g.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
      }
    }
    if (incoming) {
      this.warnT -= dt;
      if (this.warnT <= 0) {
        this.warnT = 0.28;
        g.audio.sfx('warn');
      }
    } else {
      this.warnT = 0;
    }
    g.hud.warn(incoming);

    // ---- traps
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const trap = this.traps[i];
      trap.age += dt;
      trap.mesh.position.y = trap.y + Math.abs(Math.sin(trap.age * 3)) * 0.15;
      trap.mesh.rotation.y += dt * 0.8;
      let dead = trap.age > 28;

      for (const k of g.karts) {
        if (k.remote || (k === trap.owner && trap.age < 1.2)) continue;
        const dx = k.x - trap.x;
        const dz = k.z - trap.z;
        if (dx * dx + dz * dz < 2.9 && Math.abs(k.y - trap.y) < 1.5) {
          if (k.spinOut()) {
            g.fx.burst(trap.x, trap.y + 0.6, trap.z, 26, 9, [1.6, 2.6, 0.4], 0.6, 0.6);
            if (Math.hypot(k.x - g.player.x, k.z - g.player.z) < 40) {
              g.audio.sfx('explode', k.isPlayer ? 1 : 0.4);
            }
          }
          dead = true;
          g.mp?.ev({ e: 'untrap', by: g.rid(k), id: trap.id });
          break;
        }
      }
      if (dead) {
        g.scene.remove(trap.mesh);
        this.traps.splice(i, 1);
      }
    }
  }

  /** Drop everything (used when restarting a race). */
  reset() {
    for (const r of this.rockets) this.game.scene.remove(r.mesh);
    for (const t of this.traps) this.game.scene.remove(t.mesh);
    this.rockets.length = 0;
    this.traps.length = 0;
    this.gone.clear();
    for (const b of this.boxes) {
      b.cd = 0;
      b.mesh.visible = true;
      b.mesh.scale.setScalar(1);
    }
    for (const c of this.coinList) {
      c.cd = 0;
      c.s = 1;
    }
  }
}
