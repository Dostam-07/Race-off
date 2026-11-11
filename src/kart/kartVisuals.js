// Race-Off - kart visual sync and particle effects.
// `sync` drives everything you see on the model (lean, pitch, hop squash,
// wheel spin, drift angle, tricks, shield bubble, star glow) and `effects`
// spawns the particles that sell speed and grip loss.

import * as THREE from 'three';
import { clamp, lerp, smooth, damp, angleDelta } from '../core/utils.js';
import { BASE_SPEED } from './Kart.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Position a point in kart-local space, in world coordinates. */
function localToWorld(kart, side, up, back, out) {
  const c = Math.cos(kart.root.rotation.y);
  const s = Math.sin(kart.root.rotation.y);
  return out.set(kart.x + side * c + back * s, kart.y + up, kart.z - side * s + back * c);
}

export function syncKart(kart, dt) {
  const ud = kart.ud;
  const g = kart.game;
  const drifting = kart.drifting || kart.aiDrift > 0.25;

  // Drift lean, steering lean, pitch, roll and squash all ease toward targets.
  kart.driftVis = damp(kart.driftVis, drifting ? kart.driftDir * 0.46 : 0, drifting ? 7 : 9, dt || 1);
  kart.steerVis = damp(kart.steerVis, kart.input.steer, 10, dt || 1);
  kart.pitch = damp(kart.pitch, kart.pitchT || 0, 10, dt || 1);
  kart.roll = damp(
    kart.roll,
    clamp(kart.turn * kart.speed * 0.0022, -0.12, 0.12) + kart.driftVis * 0.12,
    8,
    dt || 1,
  );
  kart.squash = Math.max(0, kart.squash - dt * 5);

  // Mid-air trick rotation, eased so it reads as a deliberate flip.
  if (kart.trick > 0) {
    kart.trick += dt;
    const f = Math.min(1, kart.trick / 0.48);
    kart.trickAng = kart.trickDir * Math.PI * 2 * (f * f * (3 - 2 * f));
  }

  kart.size = damp(kart.size, kart.zap > 0 ? 0.58 : 1, 8, dt || 1);
  kart.root.scale.setScalar(kart.size);

  // Shield bubble.
  if (kart.shield > 0 && !kart.bubble) {
    const src = g.A.shield;
    if (src) {
      kart.bubble = src.clone(true);
      kart.bubble.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.material = o.material.clone();
        o.material.depthWrite = false;
        o.renderOrder = 8;
        if (o.material.name === 'ShieldGlass') {
          o.material.opacity = 0.2;
          o.material.transparent = true;
        }
      });
      kart.bubble.scale.setScalar(1.95);
      kart.bubble.position.y = 0.75;
      kart.root.add(kart.bubble);
    }
  }
  if (kart.bubble) {
    kart.bubble.visible = kart.shield > 0 && (kart.shield > 2 || Math.sin(g.time * 30) > 0);
    kart.bubble.rotation.y = g.time * 1.4;
    kart.bubble.rotation.x = g.time * 0.9;
  }

  // Star power: rainbow emissive on the paint.
  if (ud && ud.paint) {
    if (kart.star > 0) {
      ud.paint.emissive.setHSL((g.time * 1.7) % 1, 1, 0.5);
      ud.paint.emissiveIntensity = 1.3;
      ud.starOn = true;
    } else if (ud.starOn) {
      ud.paint.emissive.setRGB(0, 0, 0);
      ud.starOn = false;
    }
  }

  kart.root.position.set(kart.x, kart.y, kart.z);
  kart.root.rotation.y = kart.heading + kart.driftVis + kart.spinAng;
  kart.tilt.rotation.x = kart.pitch;
  kart.tilt.rotation.z = kart.roll;
  kart.tilt.rotation.y = kart.trickAng;

  // Landing squash & boost stretch.
  const squash = 1 - 0.18 * Math.sin(kart.squash * Math.PI);
  const stretch = kart.boost > 0 ? 1.04 : 1;
  kart.model.scale.set((2 - squash) * 0.5 + 0.5, squash, stretch);

  // Blob shadow only while parked (the sun shadow takes over once moving).
  const state = g.state;
  const parked = state !== 'race' && kart.onGround !== false && Math.abs(kart.speed) < 3;
  if (parked && !kart.blob) {
    kart.blob = g.makeBlob();
    kart.root.add(kart.blob);
  }
  if (kart.blob) {
    const m = kart.blob.material;
    m.opacity = damp(m.opacity, parked ? 0.62 : 0, 8, dt || 1);
    kart.blob.visible = m.opacity > 0.01;
  }

  // Wheel spin and steer.
  kart.wheelSpin += (kart.speed * dt) / 0.27;
  const idleBob = g.state !== 'race' ? Math.sin(g.time * 38 + kart.slot) * 0.006 : 0;
  kart.model.position.y = idleBob + (kart.offroad && kart.speed > 5 ? Math.sin(g.time * 50) * 0.02 : 0);

  kart.wheels.forEach((w, i) => {
    w.rotation.x = kart.wheelSpin;
    if (i < 2) w.rotation.y = kart.steerVis * 0.42 - kart.driftVis * 0.5;
  });

  // Champion star: slow spin and a gentle bob.
  if (ud.champStar) {
    ud.champStar.rotation.y += dt * 2.2;
    ud.champStar.position.y = 2.6 + Math.sin(g.time * 2.4 + kart.slot) * 0.12;
  }

  // Body float, head look-at and blink.
  if (dt > 0) {
    const accel = clamp((kart.speed - kart.prevSpeed) / dt, -40, 40);
    const lateral = kart.turn * kart.speed;
    const speedN = clamp(kart.speed / BASE_SPEED, 0, 1.3);
    kart.prevSpeed = kart.speed;

    if (ud && ud.wob) {
      for (const part of ud.wob) {
        const w = part.userData.w;
        const targetPitch =
          -accel * 0.011 - speedN * 0.3 +
          Math.sin(g.time * 19 + w.ph) * 0.05 * speedN +
          (kart.onGround ? 0 : -0.25);
        const targetRoll = clamp(lateral * 0.007, -0.5, 0.5) + Math.sin(g.time * 2.3 + w.ph) * 0.04;
        w.vx += ((targetPitch - w.x) * 150 - w.vx * 9) * dt;
        w.vz += ((targetRoll - w.z) * 150 - w.vz * 9) * dt;
        w.x += w.vx * dt;
        w.z += w.vz * dt;
        part.rotation.x = clamp(w.x, -0.9, 0.6) * w.amp;
        part.rotation.z = clamp(w.z, -0.7, 0.7) * w.amp;
      }
    }

    kart.blinkT -= dt;
    if (kart.blinkT < -0.11) kart.blinkT = 1.6 + Math.random() * 3.6;
    if (ud && ud.eyes) {
      ud.eyes.scale.y = kart.spin > 0 ? 0.35 : kart.blinkT < 0 ? 0.12 : 1;
    }

    // Look toward the camera on the menus, at nearby karts while racing.
    let look = 0;
    if (g.state === 'title' || g.state === 'intro') {
      const cam = g.camera.position;
      look = clamp(angleDelta(Math.atan2(cam.x - kart.x, cam.z - kart.z), kart.heading), -1.15, 1.15) *
        (Math.hypot(cam.x - kart.x, cam.z - kart.z) < 22 ? 1 : 0);
    } else {
      for (const other of g.karts) {
        if (other === kart) continue;
        const dx = other.x - kart.x;
        const dz = other.z - kart.z;
        if (dx * dx + dz * dz < 30) {
          look = clamp(angleDelta(Math.atan2(dx, dz), kart.heading), -1, 1) * 0.8;
          break;
        }
      }
    }
    kart.lookY = damp(kart.lookY, look, 5, dt);
  }

  if (ud && ud.head) {
    ud.head.rotation.y = damp(ud.head.rotation.y, kart.steerVis * 0.45 + kart.lookY, 8, dt || 1);
    const idle = g.state === 'title' ? 1 : 0;
    ud.head.rotation.z = -kart.roll * 1.5 + idle * Math.sin(g.time * 1.15 + kart.slot) * 0.07;
    ud.head.rotation.x =
      idle * Math.sin(g.time * 0.8 + kart.slot * 1.7) * 0.05 +
      Math.sin(g.time * 9 + kart.slot * 2) * 0.025 * Math.min(1, kart.speed / 10) +
      (kart.boost > 0 ? -0.12 : 0) +
      (kart.trick > 0 ? -0.3 : 0);
  }
  if (ud && ud.body) ud.body.rotation.z = kart.steerVis * -0.06;
  if (ud && ud.glow) {
    ud.glow.emissiveIntensity = kart.boost > 0 ? 5 : 1.2 + Math.min(kart.speed / BASE_SPEED, 1) * 1.6;
  }
}

export function kartEffects(kart, dt, active) {
  const fx = kart.game.fx;
  const t = kart.game.track;
  const rot = kart.root.rotation.y;
  const sr = Math.sin(rot);
  const cr = Math.cos(rot);
  const sh = Math.sin(kart.heading);
  const ch = Math.cos(kart.heading);
  const vx = sh * kart.speed;
  const vz = ch * kart.speed;
  const drifting = kart.drifting || kart.aiDrift > 0.25;

  const wet = t.lagoonW[kart.idx] > 0.5 && kart.y < 0.3;
  const near = kart.isPlayer ||
    (kart.x - kart.game.player.x) ** 2 + (kart.z - kart.game.player.z) ** 2 < 3600;

  // Splash trail through the lagoon.
  if (wet && kart.onGround && Math.abs(kart.speed) > 3 && near) {
    const p = Math.min(1, kart.speed / 30);
    for (const side of [-0.78, 0.78]) {
      const x = kart.x + side * cr + -0.55 * sr;
      const z = kart.z - side * sr + -0.55 * cr;
      const sign = Math.sign(side);
      for (let i = 0; i < 2; i++) {
        fx.streaks.spawn(
          x, 0.12, z,
          vx * 0.6 + cr * sign * (2.5 + Math.random() * 5) * p,
          (2 + Math.random() * 4.5) * p,
          vz * 0.6 - sr * sign * (2.5 + Math.random() * 5) * p,
          0.22 + Math.random() * 0.2,
          0.9, 0.05, 1.2, 1.5, 1.8, 0.8, 16, 0.08, vx, vz,
        );
      }
      if (Math.random() < 0.3) {
        fx.alpha.spawn(x, 0.15, z, vx * 0.5 + cr * sign * 3 * p, 1.6 * p + Math.random(), vz * 0.5 - sr * sign * 3 * p,
          0.3 + Math.random() * 0.2, 0.3, 0.8, 1, 1, 1, 0.3, 7, 1.2);
      }
    }
    if (Math.random() < (kart.isPlayer ? 0.6 : 0.3)) {
      fx.alpha.spawn(
        kart.x + (Math.random() - 0.5) * 0.9, 0.05, kart.z + (Math.random() - 0.5) * 0.9,
        0, 0, 0, 0.9, 0.5, 1.5, 1, 1, 1, 0.2, 0, 0,
      );
    }
  }
  if (wet && !kart.wasWet && kart.speed > 9) {
    for (let i = 0; i < 18; i++) {
      fx.streaks.spawn(
        kart.x + (Math.random() - 0.5) * 1.6, 0.15, kart.z + (Math.random() - 0.5) * 1.6,
        vx * 0.7 + (Math.random() - 0.5) * 10,
        4 + Math.random() * 8,
        vz * 0.7 + (Math.random() - 0.5) * 10,
        0.4 + Math.random() * 0.3, 0.8, 0.035, 1.4, 1.7, 2, 0.9, 18, 0.06, vx, vz,
      );
    }
    fx.smoke(kart.x, 0.3, kart.z, 4, [1, 1, 1], 0.9, 2.5, 0.4);
    if (kart.isPlayer) {
      kart.game.audio.sfx('splash');
      kart.game.hud.toast('SPLASH!', 'cyan', 0.8);
    }
  }
  kart.wasWet = wet;

  // Skid marks from the rear wheels while drifting.
  if (!kart.skid) kart.skid = [null, null];
  for (let i = 0; i < 2; i++) {
    if (drifting && kart.onGround && kart.speed > 10 && !wet) {
      const side = i ? 0.69 : -0.69;
      const a = localToWorld(kart, side - 0.16, 0.1, -0.6, _v).clone();
      const pts = [a.x, a.y, a.z];
      const b = localToWorld(kart, side + 0.16, 0.1, -0.6, _v);
      pts.push(b.x, b.y, b.z);
      const prev = kart.skid[i];
      if (prev) {
        if ((pts[0] - prev[0]) ** 2 + (pts[2] - prev[2]) ** 2 > 0.3) {
          fx.skids.quad(prev, pts);
          kart.skid[i] = pts;
        }
      } else {
        kart.skid[i] = pts;
      }
    } else {
      kart.skid[i] = null;
    }
  }

  // Drift sparks at each tier.
  if (drifting && kart.onGround && kart.speed > 10 && !wet && active) {
    if (Math.random() < 0.85) {
      const sparks = [
        [1.6, 1.5, 1.2], [0.45, 1.5, 4.4], [4.4, 1.7, 0.25], [3.4, 0.6, 3.9],
      ][Math.min(3, kart.driftLevel)];
      const side = Math.random() < 0.5 ? 0.69 : -0.69;
      localToWorld(kart, side, 0.1, -0.6, _v);
      fx.sparks(_v.x, _v.y, _v.z, 1, 4, sparks, 0.22, 0.5);
    }
  }

  // Turbo flames behind the exhaust while boosting.
  if (kart.boost > 0) {
    for (const side of [-0.45, 0.45]) {
      localToWorld(kart, side, 0.42, -1.15, _v);
      fx.alpha.spawn(
        _v.x, _v.y, _v.z,
        (Math.random() - 0.5) * 1.5 - vx * 0.12,
        1.2 + Math.random() * 1.6,
        (Math.random() - 0.5) * 1.5 - vz * 0.12,
        0.22 + Math.random() * 0.12,
        0.7 + Math.random() * 0.5, 0.9, 1,
        0.55, 0.16, 1,
        14, 0.9, vx * 0.25, vz * 0.25,
      );
    }
  }

  // Dust while off-road.
  if (kart.offroad && kart.onGround && kart.speed > 8 && Math.random() < 0.6) {
    const side = (Math.random() - 0.5) * 1.4;
    localToWorld(kart, side, 0.15, -0.8, _v);
    fx.smoke(_v.x, _v.y, _v.z, 1, [0.78, 0.72, 0.6], 0.5, 1.6, 0.5);
  }
}
