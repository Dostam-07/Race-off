// Race-Off - the kart simulation.
// All the driving feel of the game lives here: speed, steering, drifting and
// the three drift boost tiers, hop -> trick -> landing boost, airborne physics
// over gaps and ramps, wall scraping, slipstreaming, items and the visual
// squash/stretch that sells the weight.

import * as THREE from 'three';
import {
  clamp, lerp, smooth, damp, angleDelta, angleDamp, wrapIdx, mulberry32,
} from '../core/utils.js';
import { buildKart, makeBlobShadow, ROSTER } from './KartModel.js';
import { updateKart } from './physics.js';
import { syncKart, kartEffects } from './kartVisuals.js';

/** Base top speed in world units per second (33 units ~= 240 km/h). */
export const BASE_SPEED = 33;
/** Lateral road radius that counts as "on the road" before you lose grip. */
export const ROAD_HALF = 7.5;

/** Drift tier spark colours (blue, orange, purple, rainbow-ish). */
const DRIFT_SPARKS = [
  [1.6, 1.5, 1.2],
  [0.45, 1.5, 4.4],
  [4.4, 1.7, 0.25],
  [3.4, 0.6, 3.9],
];

const DRIFT_BOOST = [0, 0.7, 1.2, 1.9];
const DRIFT_BOOSTMAX = [1, 1.22, 1.28, 1.34];
const DRIFT_TURBO = [0, 0.15, 0.3, 0.45];
const DRIFT_LABEL = ['', 'MINI-TURBO', 'SUPER TURBO', 'ULTRA TURBO!'];
const DRIFT_TONE = ['', 'cyan', 'gold', 'pink'];

const _loc = { i: 0, lat: 0, y: 0, along: 0, tx: 0, tz: 1, slope: 0 };
const _v = new THREE.Vector3();

export class Kart {
  constructor(game, charId, slot, isPlayer) {
    this.game = game;
    this.id = charId;
    this.def = ROSTER.find((r) => r.id === charId) || ROSTER[0];
    this.isPlayer = !!isPlayer;
    this.slot = slot;

    const built = buildKart(game.A, charId);
    this.root = built.root;
    this.tilt = built.tilt;
    this.model = built.model;
    this.ud = built.ud;
    this.wheels = built.wheels;
    game.scene.add(this.root);

    this.remote = false;
    this.human = !!isPlayer;

    // --- driving state
    this.speed = 0;
    this.vy = 0;
    this.onGround = true;
    this.heading = 0;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.lat = 0;
    this.idx = 0;
    this.lane = 0;
    this.laneT = 0;
    this.prevGy = 0;
    this.lap = 0;
    this.progress = 0;
    this.rank = slot + 1;
    this.finished = false;
    this.finishTime = 0;
    this.maxLap = 0;

    // --- drifting
    this.drifting = false;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftVis = 0;
    this.driftLevel = 0;
    this.hopT = 0;

    // --- boosts and status
    this.boost = 0;
    this.boostMax = 1;
    this.turbo = 1;
    this.coins = 0;
    this.spin = 0;
    this.spinAng = 0;
    this.invuln = 0;
    this.star = 0;
    this.shield = 0;
    this.zap = 0;
    this.item = null;
    this.itemHold = 0;
    this.size = 1;
    this.bubble = null;
    this.emote = '';
    this.emoteT = 0;
    this.draftT = 0;
    this.wallHit = 0;
    this.scrape = 0;

    // --- tricks
    this.trick = 0;
    this.trickAng = 0;
    this.trickDir = 1;
    this.launch = false;
    this.airT = 0;

    // --- visuals
    this.steerIn = 0;
    this.steerVis = 0;
    this.wheelSpin = 0;
    this.pitch = 0;
    this.pitchT = 0;
    this.roll = 0;
    this.squash = 0;
    this.turn = 0;
    this.offroad = false;
    this.inMud = 0;
    this.inCur = 0;
    this.blob = null;
    this.blinkT = 1 + Math.random() * 3;
    this.lookY = 0;
    this.aiDrift = 0;
    this.skill = isPlayer ? 1 : 1.012 + (5 - slot) * 0.008 + Math.random() * 0.012;
    this.rail = null;

    this.input = {
      steer: 0,
      accel: 0,
      brake: 0,
      drift: false,
      driftPressed: false,
      item: false,
      turbo: false,
    };

    this.place(slot);
    this.sync(0);
  }

  /** Put the kart on the grid at `slot`. */
  place(slot) {
    const t = this.game.track;
    const back = -(9 + slot * 4.6);
    const side = slot % 2 ? 2.9 : -2.9;
    this.slot = slot;
    this.idx = wrapIdx(Math.round(back / t.seg), t.N);
    t.pointAt(this.idx, side, _v);
    this.x = _v.x;
    this.z = _v.z;
    this.y = _v.y;
    this.heading = t.headingAt(this.idx);
    this.lat = side;
    this.lane = side;
    this.prevGy = this.y;
    this.lap = 0;
    this.progress = this.idx - t.N;
    this.rank = slot + 1;
    this.speed = 0;
    this.vy = 0;
    this.onGround = true;
    this.finished = false;
    this.finishTime = 0;
    this.maxLap = 0;
    this.drifting = false;
    this.driftCharge = 0;
    this.driftLevel = 0;
    this.boost = 0;
    this.boostMax = 1;
    this.turbo = 1;
    this.coins = 0;
    this.spin = 0;
    this.spinAng = 0;
    this.invuln = 0;
    this.star = 0;
    this.shield = 0;
    this.zap = 0;
    this.item = null;
    this.itemHold = 0;
    this.trick = 0;
    this.trickAng = 0;
    this.launch = false;
    this.rail = null;
    this.sync(0);
  }

  setChar(charId) {
    this.tilt.remove(this.model);
    this.id = charId;
    this.def = ROSTER.find((r) => r.id === charId) || ROSTER[0];
    const built = buildKart(this.game.A, charId);
    this.model = built.model;
    this.tilt.add(this.model);
    this.ud = built.ud;
    this.wheels = built.wheels;
    this.ud.starOn = false;
    this.squash = 1;
    this.sync(0);
  }

  // ------------------------------------------------------------------ status

  /** Show a floating emote above the kart (used for hits and celebrations). */
  say(text, time = 1.4) {
    this.emote = text;
    this.emoteT = time;
  }

  /** Shield absorbs a hit, then pops. */
  popShield() {
    const g = this.game;
    this.shield = 0;
    this.invuln = Math.max(this.invuln, 0.9);
    g.fx.sparks(this.x, this.y + 0.8, this.z, 22, 9, [1.2, 2.6, 4.2], 0.45, 0.7);
    if (this.isPlayer || Math.hypot(this.x - g.player.x, this.z - g.player.z) < 30) {
      g.audio.sfx('pop');
    }
    if (this.isPlayer) g.hud.toast('BLOCKED!', 'cyan', 0.9);
  }

  /** Take a hit: spin out and scatter coins. Returns false if immune. */
  spinOut() {
    if (this.remote || this.invuln > 0 || this.spin > 0 || this.star > 0) return false;
    if (this.shield > 0) {
      this.popShield();
      return false;
    }
    this.say('\u{1F635}', 1.6);
    this.spin = 1.25;
    this.invuln = 2.6;
    this.drifting = false;
    this.driftCharge = 0;
    this.driftLevel = 0;
    this.boost = 0;
    this.turbo = Math.max(0, this.turbo - 0.5);
    this.vy = 6;
    this.onGround = false;
    this.trick = 0;
    this.draftT = 0;

    const g = this.game;
    if (this.coins > 0) {
      const lost = Math.min(3, this.coins);
      this.coins -= lost;
      g.fx.sparks(this.x, this.y + 0.9, this.z, lost * 5, 9, [4, 2.6, 0.4], 0.55, 0.5);
      if (this.isPlayer) g.hud.setCoins(this.coins, true);
    }
    if (this.isPlayer) g.audio.sfx('hit');
    return true;
  }

  /** Fall in the water / lava / off the world, then respawn on the road. */
  burn() {
    const g = this.game;
    const t = g.track;
    const back = t.gapExit(this.idx);
    const beach = t.def.id === 'beach';
    const jungle = t.def.id === 'jungle';
    const sky = t.def.id === 'sky';

    if (beach) {
      g.fx.burst(this.x, 0.4, this.z, 34, 11, [1.5, 1.9, 2.2], 0.7, 0.8);
      g.fx.smoke(this.x, 0.5, this.z, 10, [1, 1, 1], 2.2, 5, 0.7);
    } else if (jungle) {
      g.fx.burst(this.x, this.y + 0.5, this.z, 26, 9, [0.5, 1.5, 0.35], 0.8, 0.8);
      g.fx.smoke(this.x, this.y + 1, this.z, 8, [0.85, 0.95, 0.8], 2, 4, 0.5);
    } else if (sky) {
      g.fx.burst(this.x, this.y + 0.5, this.z, 30, 10, [2.2, 1.6, 2.6], 0.9, 0.8);
      g.fx.smoke(this.x, this.y + 1, this.z, 10, [1, 0.92, 0.98], 2.4, 4, 0.6);
    } else {
      g.fx.burst(this.x, this.y + 0.5, this.z, 30, 12, [5, 1.8, 0.25], 1, 0.8);
      g.fx.smoke(this.x, this.y + 1, this.z, 8, [0.25, 0.22, 0.22], 2, 4, 0.6);
    }

    t.pointAt(back, clamp(this.lat, -4, 4), _v);
    this.x = _v.x;
    this.z = _v.z;
    this.y = _v.y + 2.5;
    this.prevGy = _v.y;
    this.idx = back;
    this.heading = t.headingAt(back);
    this.speed = 8;
    this.vy = 0;
    this.boost = 0;
    this.drifting = false;
    this.driftLevel = 0;
    this.driftCharge = 0;
    this.trick = 0;
    this.trickAng = 0;
    this.launch = false;
    this.spin = 0;
    this.spinAng = 0;
    this.invuln = 2.2;
    this.star = 0;
    if (this.coins > 0) this.coins = Math.max(0, this.coins - 2);

    this.say(beach ? '\u{1F4A6}' : jungle || sky ? '\u{1F635}' : '\u{1F975}', 1.8);

    if (this.isPlayer) {
      g.audio.sfx(beach ? 'splash' : jungle || sky ? 'hit' : 'explode', 0.7);
      g.audio.setStar(false);
      g.hud.toast(
        beach ? 'SPLASH!' : sky ? 'SKY DIVE! CAUGHT YOU!' : jungle ? 'LONG WAY DOWN!' : 'TOO HOT!',
        beach || sky ? 'cyan' : jungle ? 'gold' : 'red',
        1.2,
      );
      g.hud.setCoins(this.coins, true);
      g.shake = 0.5;
    }
    this.sync(0);
  }

  /** Top the turbo meter up by `n` bars (capped at 3). */
  addTurbo(n) {
    if (!this.isPlayer || this.finished || this.turbo >= 3) return;
    this.turbo = Math.min(3, this.turbo + n);
    this.game.hud.turboGain();
  }

  /** Start a boost that lasts `dur` seconds and raises the cap to `max`. */
  giveBoost(dur, max = 1.32) {
    this.boost = Math.max(this.boost, dur);
    this.boostMax = Math.max(max, this.boost > dur ? this.boostMax : 0);
    if (this.isPlayer && !this.finished) {
      this.game.audio.sfx('boost');
      this.game.boostKick = 1;
    }
  }

  /** Mid-air trick: spin the body and queue a landing boost. */
  doTrick() {
    if (this.trick > 0 || this.onGround) return;
    this.trick = 0.001;
    this.trickDir = this.input.steer < 0 ? -1 : 1;
    const g = this.game;
    g.fx.sparks(this.x, this.y + 0.6, this.z, 14, 8, [3.6, 3, 0.8], 0.4, 0.6);
    if (this.isPlayer) {
      g.audio.sfx('trick');
      g.hud.toast('TRICK!', 'gold');
    }
  }

  // --------------------------------------------------------------------- AI
  /**
   * Simple but competitive driver: aim at a point down the road, bias the lane
   * away from corners and traffic, drift through real corners, and fire items
   * with situational awareness.
   */
  ai(dt) {
    const g = this.game;
    const t = g.track;
    const N = t.N;
    const inp = this.input;

    // Wander between lanes so the pack spreads out.
    this.laneT -= dt;
    if (this.laneT < 0) {
      this.lane = (Math.random() - 0.5) * 9;
      this.laneT = 1.5 + Math.random() * 4;
    }

    const look = 9 + this.speed * 0.5;
    const targetIdx = this.idx + look / t.seg;
    const corner = t.curv[wrapIdx(Math.round(this.idx + 26), N)];
    const halfWidth = t.wallAt(wrapIdx(Math.round(targetIdx), N));

    // Steer around a slower kart directly ahead.
    let avoid = 0;
    for (const other of g.karts) {
      if (other === this) continue;
      let d = other.idx - this.idx;
      if (d < -N / 2) d += N;
      if (d > 0 && d < 18 && Math.abs(other.lat - this.lat) < 1.9 && other.speed < this.speed + 1.5) {
        avoid = (this.lat >= other.lat ? 1 : -1) * 2.8;
        break;
      }
    }

    const maxOff = Math.min(6.2, halfWidth - 2.2);
    const aim = clamp(
      this.lane * 0.6 - clamp(corner * 240, -4.2, 4.2) + avoid,
      -maxOff,
      maxOff,
    );
    t.pointAt(targetIdx, aim, _v);
    const want = Math.atan2(_v.x - this.x, _v.z - this.z);

    inp.steer = clamp(angleDelta(want, this.heading) * 3.2, -1, 1);
    inp.accel = 1;
    inp.brake = 0;
    inp.drift = false;
    inp.driftPressed = false;

    // Drift through anything moderately sharp while quick.
    if (Math.abs(corner) > 0.013 && this.speed > 22 && this.onGround) {
      this.aiDrift += dt;
      this.driftDir = corner > 0 ? 1 : -1;
    } else {
      if (this.aiDrift > 1) this.giveBoost(0.55, 1.2);
      this.aiDrift = 0;
    }

    // Items.
    inp.item = false;
    if (this.item) {
      this.itemHold -= dt;
      let fire = this.itemHold <= 0;
      if (this.item === 'rocket') {
        const ahead = g.ranked[this.rank - 2];
        const gapM = ahead ? (ahead.progress - this.progress) * t.seg : 1e9;
        fire = (this.itemHold < 2 && gapM < 90) || this.itemHold < -7;
      } else if (this.item === 'durian') {
        const behind = g.ranked[this.rank];
        const gapM = behind ? (this.progress - behind.progress) * t.seg : 1e9;
        fire = (this.itemHold < 2 && gapM < 14) || this.itemHold < -7;
      } else if (this.item === 'chili' || this.item === 'star') {
        fire = this.itemHold <= 0 && Math.abs(corner) < 0.01;
      } else if (this.item === 'shield') {
        fire = this.shield <= 0;
      }
      inp.item = fire;
    }
  }

  // ----------------------------------------------------------------- network

  /** Compact wire format; one kart is 15 numbers. */
  pack() {
    const r2 = (v) => Math.round(v * 100) / 100;
    let flags = 0;
    if (this.drifting || this.aiDrift > 0.25) flags |= 1;
    if (this.onGround) flags |= 2;
    if (this.boost > 0) flags |= 4;
    if (this.spin > 0) flags |= 8;
    if (this.star > 0) flags |= 16;
    if (this.shield > 0) flags |= 32;
    if (this.zap > 0) flags |= 64;
    if (this.finished) flags |= 128;
    if (this.trick > 0) flags |= 256;
    if (this.trickDir > 0) flags |= 512;
    if (this.shield > 0 && this.shield <= 2) flags |= 1024;

    const frozen = this.isPlayer && this.game.paused;
    return [
      r2(this.x), r2(this.y), r2(this.z),
      Math.round(this.heading * 1000) / 1000,
      frozen ? 0 : r2(this.speed),
      r2(this.vy),
      flags,
      this.lap,
      r2(this.progress),
      this.idx,
      r2(this.input.steer),
      this.driftDir,
      this.isPlayer || this.remote ? this.driftLevel : this.aiDrift > 1 ? 1 : 0,
      r2(this.finishTime),
      this.emoteT > 0 ? this.emote : 0,
    ];
  }

  /** Apply a packed frame from another player. `t` is receive time, `lag` the buffer. */
  netApply(arr, t, lag) {
    const ns = this.ns || (this.ns = {});
    const flags = arr[6];
    ns.x = arr[0];
    ns.y = arr[1];
    ns.z = arr[2];
    ns.h = arr[3];
    ns.sp = clamp(arr[4], -12, 60);
    ns.idx = wrapIdx(Math.round(arr[9]), this.game.track.N);
    ns.t = t;
    ns.lag = lag;

    this.aiDrift = flags & 1 ? 0.3 : 0;
    this.onGround = !!(flags & 2);
    this.boost = flags & 4 ? 0.3 : 0;
    this.spin = flags & 8 ? 0.3 : 0;
    if (!(flags & 8)) this.spinAng = 0;
    this.star = flags & 16 ? 0.3 : 0;
    this.shield = flags & 32 ? ((flags & 1024) ? 1 : 5) : 0;
    this.zap = flags & 64 ? 0.3 : 0;
    this.finished = !!(flags & 128);
    if (flags & 256) {
      if (this.trick <= 0) this.trick = 0.001;
      this.trickDir = flags & 512 ? 1 : -1;
    } else {
      this.trick = 0;
      this.trickAng = 0;
    }
    this.lap = arr[7];
    this.progress = arr[8];
    this.input.steer = clamp(arr[10], -1, 1);
    this.driftDir = Math.sign(arr[11]);
    this.driftLevel = clamp(arr[12] | 0, 0, 3);
    this.finishTime = arr[13];
    if (arr[14]) {
      this.emote = Array.from(String(arr[14])).slice(0, 2).join('');
      this.emoteT = 0.4;
    } else {
      this.emoteT = 0;
    }
  }

  /** Advance a remote kart toward its last known network state. */
  remoteUpdate(dt, active) {
    const g = this.game;
    const t = g.track;
    const ns = this.ns;
    const prevHeading = this.heading;
    let idx = this.idx;

    if (ns) {
      const ahead = Math.min(0.3, (performance.now() - ns.t) / 1000 + ns.lag);
      const tx = ns.x + Math.sin(ns.h) * ns.sp * ahead;
      const tz = ns.z + Math.cos(ns.h) * ns.sp * ahead;

      this.speed = ns.sp;
      this.x += Math.sin(this.heading) * this.speed * dt;
      this.z += Math.cos(this.heading) * this.speed * dt;

      const dx = tx - this.x;
      const dz = tz - this.z;
      const snap = dx * dx + dz * dz > 150;
      const k = snap ? 1 : 1 - Math.exp(-10 * dt);
      this.x += dx * k;
      this.z += dz * k;
      this.heading += angleDelta(ns.h, this.heading) * (snap ? 1 : 1 - Math.exp(-13 * dt));
      if (snap) {
        idx = ns.idx;
        this.y = ns.y;
      }
    }

    t.locate(this.x, this.z, idx, _loc);
    this.idx = _loc.i;
    this.lat = _loc.lat;

    const overGap = t.inGap(_loc.i) || (g.jungleEdge && Math.abs(_loc.lat) > (g.jungleEdge(_loc.i, _loc.lat) || 99));
    const groundY = overGap
      ? _loc.y - 7
      : _loc.y + 0.04 + (g.items ? g.items.rampY(_loc.i, _loc.along, this.lat) : 0);

    if (ns) {
      this.y = this.onGround && !overGap
        ? groundY
        : Math.max(overGap ? -1e9 : groundY, damp(this.y, ns.y, 20, dt));
    }
    this.prevGy = groundY;
    this.turn = clamp(angleDelta(this.heading, prevHeading) / Math.max(dt, 0.001), -2.6, 2.6);
    this.pitchT = this.onGround
      ? -Math.atan(_loc.slope) * Math.cos(angleDelta(this.heading, Math.atan2(_loc.tx, _loc.tz)))
      : 0;
    this.offroad = Math.abs(this.lat) > ROAD_HALF + (t.def.id === 'volcano' ? 2.2 : 1);

    if (this.spin > 0) this.spinAng += dt * 13;
    this.sync(dt);
    if (t.def._sky && g.skyRailRemote) g.skyRailRemote(this);
    this.effects(dt, active);
  }

  // ------------------------------------------------------------- simulation

  /** Advance the kart. Thin wrapper so callers never import physics directly. */
  update(dt, active) {
    updateKart(this, dt, active);
  }

  /** Push current simulation state onto the 3D model. */
  sync(dt) {
    syncKart(this, dt);
  }

  /** Spawn particles for this kart's current state. */
  effects(dt, active) {
    kartEffects(this, dt, active);
  }
}
