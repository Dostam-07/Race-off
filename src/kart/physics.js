// Race-Off - the kart physics step, sync (visuals) and effects.
// Kept separate from Kart.js purely so each file stays readable.

import * as THREE from 'three';
import {
  clamp, lerp, smooth, damp, angleDelta, angleDamp, wrapIdx,
} from '../core/utils.js';
import { BASE_SPEED, ROAD_HALF } from './Kart.js';

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

/**
 * One physics step.
 * `active` is false while the player is frozen (countdown, pause, finished).
 */
export function updateKart(kart, dt, active) {
  const g = kart.game;
  const t = g.track;
  const N = t.N;
  const inp = kart.input;

  // --- AI / idle input
  if (!kart.isPlayer && active) kart.ai(dt);
  if (!active || (kart.finished && kart.isPlayer)) {
    if (kart.finished) {
      kart.ai(dt);
    } else {
      inp.steer = 0;
      inp.accel = 0;
      inp.brake = 0;
      inp.drift = false;
      inp.item = false;
    }
  }

  kart.invuln = Math.max(0, kart.invuln - dt);

  // Sky Castle has grindable rails that take over movement entirely.
  if (t.def._sky && g.skyRail && g.skyRail(kart, dt, active)) return;

  const offroad =
    Math.abs(kart.lat) > ROAD_HALF + (t.def.id === 'volcano' ? 2.2 : 1) &&
    !(t.def.id === 'jungle' && g.jungleDeck !== undefined && g.jungleDeck(kart.idx));

  // --- top speed budget
  let top = BASE_SPEED * kart.skill * (1 + 0.008 * kart.coins);

  // Rubber banding keeps the pack together without being obvious.
  if (!kart.isPlayer && active) {
    const gapM =
      ((g.bandP === undefined ? g.player.progress : g.bandP) - kart.progress) * t.seg;
    top *=
      1 -
      0.12 * clamp(-gapM, 25, 120) / 120 -
      0.09 * clamp(-gapM, 120, 280) / 280 +
      0.12 * clamp(gapM, 8, 75) / 75;
  }

  if (kart.finished) top *= 0.7;
  if (kart.zap > 0) {
    kart.zap -= dt;
    top *= 0.7;
  }
  if (kart.star > 0) {
    kart.star -= dt;
    kart.boost = Math.max(kart.boost, 0.1);
    kart.boostMax = Math.max(kart.boostMax, 1.2);
    if (kart.star <= 0 && kart.isPlayer) g.audio.setStar(false);
  }
  if (kart.shield > 0) kart.shield -= dt;
  kart.emoteT = Math.max(0, kart.emoteT - dt);

  if (offroad && kart.boost <= 0) top *= 0.56;
  if (kart.boost > 0) {
    top = Math.max(top, BASE_SPEED * kart.boostMax);
    kart.boost -= dt;
    if (kart.boost <= 0) kart.boostMax = 1;
  }

  kart.steerIn = kart.isPlayer ? damp(kart.steerIn, inp.steer, 14, dt) : inp.steer;

  let steer = kart.steerIn;
  let turnRate = 0;

  if (kart.spin > 0) {
    kart.spin -= dt;
    kart.speed = Math.max(0, kart.speed - 30 * dt);
    kart.spinAng += dt * 13;
    steer = 0;
    if (kart.spin <= 0) kart.spinAng = 0;
  } else if (active || kart.finished) {
    // --- longitudinal
    const accel = kart.boost > 0 ? 48 : lerp(21, 5.5, clamp(kart.speed / top, 0, 1));
    if (inp.accel > 0 && kart.speed < top) {
      kart.speed = Math.min(top, kart.speed + accel * dt);
    } else if (kart.speed > top) {
      kart.speed = Math.max(top, kart.speed - (offroad ? 34 : 13) * dt);
    } else if (inp.brake) {
      kart.speed = Math.max(-9, kart.speed - 40 * dt);
    } else if (!inp.accel) {
      kart.speed = kart.speed > 0
        ? Math.max(0, kart.speed - 10 * dt)
        : Math.min(0, kart.speed + 10 * dt);
    }

    if (kart.isPlayer) {
      // Turbo meter slowly refills on its own while racing.
      if (active && !kart.finished) kart.turbo = Math.min(3, kart.turbo + dt / 16);

      if (inp.turbo) {
        if (kart.turbo >= 1 && !kart.finished) {
          kart.turbo -= 1;
          kart.giveBoost(1.3, 1.31);
          g.shake = Math.max(g.shake, 0.14);
          g.hud.toast('TURBO!', 'gold', 0.7);
          g.fx.sparks(
            kart.x, kart.y + 0.5, kart.z, 18, 9, [4, 2.4, 0.5], 0.4, 0.8,
            Math.sin(kart.heading) * kart.speed * 0.6,
            Math.cos(kart.heading) * kart.speed * 0.6,
          );
        } else if (!kart.finished) {
          g.audio.sfx('tick');
          g.hud.turboEmpty();
        }
      }

      // --- hop / drift / trick
      const steerIn = inp.steer;
      if (inp.driftPressed && !kart.onGround && kart.launch) kart.doTrick();

      if (
        inp.driftPressed && !kart.drifting && kart.onGround && kart.speed > 13
      ) {
        kart.vy = 3.6;
        kart.onGround = false;
        kart.hopT = 0.01;
        if (Math.abs(steerIn) > 0.15) {
          kart.drifting = true;
          kart.driftDir = Math.sign(steerIn);
          kart.driftCharge = 0;
          kart.driftLevel = 0;
        }
      }
      // Holding drift while already airborne starts the slide on touchdown.
      if (
        inp.drift && !kart.drifting && !kart.onGround &&
        Math.abs(steerIn) > 0.15 && kart.speed > 13 && kart.hopT > 0
      ) {
        kart.drifting = true;
        kart.driftDir = Math.sign(steerIn);
        kart.driftCharge = 0;
        kart.driftLevel = 0;
      }
      if (kart.onGround) kart.hopT = 0;

      if (kart.drifting) {
        kart.driftCharge += dt * (0.8 + 0.55 * Math.max(0, steer * kart.driftDir));
        const level =
          kart.driftCharge > 2.5 ? 3 : kart.driftCharge > 1.4 ? 2 : kart.driftCharge > 0.55 ? 1 : 0;
        if (level > kart.driftLevel) {
          kart.driftLevel = level;
          g.audio.sfx('charge', level);
          if (kart.onGround) {
            g.fx.sparks(kart.x, kart.y + 0.2, kart.z, 10, 7, DRIFT_SPARKS[level], 0.3, 0.6);
          }
        }
        if (!inp.drift || kart.speed < 9) {
          kart.drifting = false;
          if (kart.driftLevel > 0) {
            kart.giveBoost(DRIFT_BOOST[kart.driftLevel], DRIFT_BOOSTMAX[kart.driftLevel]);
            kart.addTurbo(DRIFT_TURBO[kart.driftLevel]);
            g.hud.toast(DRIFT_LABEL[kart.driftLevel], DRIFT_TONE[kart.driftLevel]);
          }
          kart.driftLevel = 0;
          kart.driftCharge = 0;
        }
      }
    }

    // --- steering
    const speedN = clamp(Math.abs(kart.speed) / BASE_SPEED, 0, 1);
    if (kart.drifting) {
      turnRate = kart.driftDir * (0.78 + 0.8 * steer * kart.driftDir);
    } else {
      turnRate = steer * lerp(2.4, 1.3, speedN) * Math.min(1, Math.abs(kart.speed) / 5);
    }
    if (!kart.onGround) turnRate *= 0.6;

    // Mud (jungle) and river rapids.
    if (t.def.id === 'jungle' && g.mudAt) {
      if (kart.onGround && g.mudAt(kart.idx, kart.lat)) {
        turnRate *= 0.45;
        kart.speed -= kart.speed * 0.35 * dt;
        kart.inMud = 1;
      } else {
        kart.inMud = 0;
      }
    }
    if (t.def.id === 'jungle' && g.rapids) {
      const r = kart.onGround ? g.rapids(kart.idx, kart.lat) : 0;
      kart.inCur = r > 0 ? 1 : 0;
      if (r > 0) {
        kart.boost = Math.max(kart.boost, 0.2);
        kart.boostMax = Math.max(kart.boostMax, 1.2);
      } else if (r < 0 && kart.boost <= 0) {
        kart.speed -= kart.speed * 0.15 * dt;
      }
    }

    kart.heading += turnRate * dt * (kart.speed < 0 ? -1 : 1);
  }

  // Sky Castle side wind pushes the kart across the road.
  if (t.def.id === 'sky' && g.skyWind && active) {
    const w = g.skyWind(kart.idx, kart.lat);
    if (w) {
      const i = kart.idx;
      kart.x -= t.tz[i] * w * dt;
      kart.z += t.tx[i] * w * dt;
    }
  }

  kart.turn = turnRate;

  // --- integrate horizontal motion
  const sinH = Math.sin(kart.heading);
  const cosH = Math.cos(kart.heading);
  kart.x += sinH * kart.speed * dt;
  kart.z += cosH * kart.speed * dt;

  const prevIdx = kart.idx;
  t.locate(kart.x, kart.z, kart.idx, _loc);
  kart.idx = _loc.i;
  kart.lat = _loc.lat;

  // --- walls
  const edge = t.def.id === 'jungle' && g.jungleEdge !== undefined ? g.jungleEdge(_loc.i, _loc.lat) : 0;
  const limit = edge ? 99 : t.wallAt(_loc.i) - 0.85;
  kart.scrape = Math.max(0, kart.scrape - dt);

  if (Math.abs(_loc.lat) > limit) {
    const sign = Math.sign(_loc.lat);
    const over = Math.abs(_loc.lat) - limit;
    kart.x -= -_loc.tz * sign * over;
    kart.z -= _loc.tx * sign * over;
    kart.lat = sign * limit;

    const roadH = Math.atan2(_loc.tx, _loc.tz);
    const d = angleDelta(roadH, kart.heading);
    if (Math.abs(d) < 1.6) kart.heading += d * Math.min(1, 5 * dt);

    if (kart.speed > 16) {
      kart.speed -= kart.speed * 1.1 * dt;
      if (kart.wallHit <= 0 && kart.isPlayer) {
        g.audio.sfx('bump');
        g.shake = Math.max(g.shake, 0.12);
      }
      kart.wallHit = 0.4;
    }
    if (kart.speed > 8) {
      kart.scrape = 0.1;
      g.fx.sparks(
        kart.x - -_loc.tz * sign * -0.8,
        kart.y + 0.35,
        kart.z - _loc.tx * sign * -0.8,
        2, 5, [3.5, 2.2, 0.6], 0.25, 0.5,
        sinH * kart.speed * 0.5,
        cosH * kart.speed * 0.5,
      );
    }
  }
  kart.wallHit -= dt;

  // --- lap counting across the start/finish seam
  if (prevIdx > N * 0.75 && kart.idx < N * 0.25) {
    kart.lap += 1;
    if (kart.lap > (kart.maxLap || 0)) {
      kart.maxLap = kart.lap;
      g.onLap(kart);
    }
  } else if (prevIdx < N * 0.25 && kart.idx > N * 0.75) {
    kart.lap -= 1;
  }

  kart.progress = (kart.lap - 1) * N + kart.idx + _loc.along / t.seg;

  // --- slipstream
  if (kart.isPlayer && active) {
    let drafting = false;
    for (const other of g.karts) {
      if (other === kart) continue;
      const dx = other.x - kart.x;
      const dz = other.z - kart.z;
      const fwd = dx * sinH + dz * cosH;
      const side = Math.abs(dx * cosH - dz * sinH);
      if (fwd > 3 && fwd < 18 && side < 1.3 + fwd * 0.07 && other.speed > 20 && Math.abs(other.y - kart.y) < 2) {
        drafting = true;
        break;
      }
    }
    kart.draftT = drafting && kart.speed > 22 && kart.boost <= 0 && kart.spin <= 0
      ? kart.draftT + dt
      : Math.max(0, kart.draftT - dt * 1.5);
    if (kart.draftT > 1.5) {
      kart.draftT = 0;
      kart.giveBoost(1.3, 1.24);
      g.hud.toast('SLIPSTREAM!', 'cyan');
    }
  }

  // --- jungle cliff edge
  if (t.def.id === 'jungle' && edge > 0 && Math.abs(_loc.lat) > edge && kart.y < _loc.y - 0.3) {
    kart.jFell = true;
  }

  // --- over a gap / off the edge / fell
  const overGap =
    t.inGap(_loc.i) ||
    (edge > 0 && Math.abs(_loc.lat) > edge) ||
    (t.def.id === 'jungle' && kart.jFell === true);

  if (overGap && kart.y < (t.def.id === 'beach' ? Math.min(_loc.y - 2.4, 0.6) : _loc.y - 2.4)) {
    kart.jFell = false;
    kart.burn();
    return;
  }

  const groundY = overGap
    ? _loc.y - 7
    : _loc.y + 0.04 + (g.items ? g.items.rampY(_loc.i, _loc.along, kart.lat) : 0);

  // --- vertical
  kart.vy -= (t.def.id === 'sky' ? 24 : 34) * dt;
  let y = kart.y + kart.vy * dt;

  if (y <= groundY) {
    if (!kart.onGround) {
      if (kart.vy < -7) {
        kart.squash = 1;
        if (kart.isPlayer) g.audio.sfx('land');
        g.fx.smoke(kart.x, groundY + 0.2, kart.z, 5, [0.9, 0.88, 0.8], 0.9, 0.8, 0.35);
      }
      // Landing a trick pays out a boost.
      if (kart.trick > 0) {
        kart.trick = 0;
        kart.trickAng = 0;
        kart.giveBoost(1, 1.27);
        kart.addTurbo(0.3);
        g.fx.sparks(
          kart.x, groundY + 0.3, kart.z, 16, 9, [3.6, 3, 0.8], 0.4, 0.7,
          sinH * kart.speed * 0.6, cosH * kart.speed * 0.6,
        );
      }
      kart.launch = false;
    }
    y = groundY;
    kart.vy = clamp((groundY - kart.prevGy) / Math.max(dt, 1e-4), -30, 30);
    kart.onGround = true;
  } else if (y > groundY + 0.06) {
    kart.onGround = false;
  }

  kart.airT = kart.onGround ? 0 : kart.airT + dt;
  kart.y = y;
  kart.prevGy = groundY;

  kart.pitchT = kart.onGround
    ? -Math.atan(_loc.slope) * Math.cos(angleDelta(kart.heading, Math.atan2(_loc.tx, _loc.tz)))
    : -Math.atan2(kart.vy, Math.max(kart.speed, 8)) * 0.6;
  kart.offroad = offroad;

  kart.sync(dt);
  kart.effects(dt, active);
}

/**
 * Kart-vs-kart collision: push overlapping karts apart, swap a little momentum,
 * let star power bowl rivals over and spark + thump on hard contacts.
 * Remote karts are never moved here - their owner simulates them.
 */
export function collideKarts(karts) {
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i];
      const b = karts[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= 2.9 || d2 <= 1e-4 || Math.abs(a.y - b.y) >= 1.2) continue;

      const d = Math.sqrt(d2);
      const push = (1.7 - d) * 0.5;
      const nx = dx / d;
      const nz = dz / d;
      const aRemote = a.remote;
      const bRemote = b.remote;
      if (aRemote && bRemote) continue;
      if (!aRemote) {
        a.x -= nx * push;
        a.z -= nz * push;
      }
      if (!bRemote) {
        b.x += nx * push;
        b.z += nz * push;
      }

      const dv = (a.speed - b.speed) * 0.08;
      if (!aRemote) a.speed -= dv;
      if (!bRemote) b.speed += dv;

      // Star power bowls the other kart over.
      if (a.star > 0 && b.star <= 0) {
        if (b.spinOut() && (a.isPlayer || b.isPlayer)) a.game.audio.sfx('explode', 0.6);
      } else if (b.star > 0 && a.star <= 0) {
        if (a.spinOut() && (a.isPlayer || b.isPlayer)) b.game.audio.sfx('explode', 0.6);
      }

      // A hard hit between the player and someone else: thump + sparks.
      const g = a.game;
      if (
        (a.isPlayer || b.isPlayer) &&
        Math.abs(a.speed - b.speed) > 2 &&
        !g.bumpCd
      ) {
        g.audio.sfx('bump');
        g.bumpCd = 0.3;
        g.fx.sparks(
          (a.x + b.x) / 2,
          a.y + 0.5,
          (a.z + b.z) / 2,
          6, 5, [3.2, 2.6, 1.2], 0.25, 0.4,
        );
      }
    }
  }
}
