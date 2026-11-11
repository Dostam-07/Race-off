// Race-Off - the camera rig.
//
// One function drives every camera mode: the slow orbit on the title screen,
// the fly-through intro, the chase cam during the race and the slow orbit on
// the finish screen. FOV widens with speed and kicks out on boosts.

import * as THREE from 'three';
import { clamp, lerp, damp, smooth, angleDelta } from './utils.js';

const _cam = new THREE.Vector3();
const _look = new THREE.Vector3();
const _target = new THREE.Vector3();

/** Ease-in-out used by the scripted camera moves. */
const ease = (t) => {
  const n = clamp(t, 0, 1);
  return n * n * (3 - 2 * n);
};

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.focus = 6;
    this.fov = 62;
    this.initialised = false;
  }

  reset() {
    this.initialised = false;
  }

  /** Base chase offsets: distance and height, scaled for portrait screens. */
  chase(kart, dt) {
    const portrait = this.camera.aspect < 1 ? 1.12 : 1;
    const heading = kart.heading + (kart.drifting ? kart.driftDir * 0.3 : 0);
    this.yaw += angleDelta(heading, this.yaw) * (1 - Math.exp(-5.5 * dt));

    const dist = (3.65 + kart.game.boostKick * 0.8 - (kart.speed < 0 ? 1 : 0)) * portrait;
    const height = 1.72 * (this.camera.aspect < 1 ? 1.2 : 1);
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);

    _cam.set(kart.x - s * dist, kart.y + height, kart.z - c * dist);
    _look.set(kart.x + s * 4, kart.y + 1.05, kart.z + c * 4);
    this.focus = dist;
  }

  /**
   * Update the camera for the current game state.
   * `state`, `st` (time in state), `kart` (the player), `track`.
   */
  update(dt, state, st, kart, track, opts = {}) {
    const cam = this.camera;
    let fov = 62;
    let focus = 1;

    if (state === 'title') {
      // Slow orbit around the parked kart.
      const u = (st % 9) / 9;
      const e = ease(u);
      this.pos.set(
        kart.x + Math.sin(kart.heading - lerp(1.2, 0.3, e)) * 6.3,
        kart.y + lerp(1, 1.5, e),
        kart.z + Math.cos(kart.heading - lerp(1.2, 0.3, e)) * 6.3,
      );
      this.look.set(kart.x, kart.y + 0.5, kart.z);
      fov = 40;
      focus = 6.3;
    } else if (state === 'intro') {
      if (st < 2.3) {
        const e = ease(st / 2.3);
        const f = track.def.intro || {
          p0: [-40, 40, 60], p1: [-20, 20, 20], l0: [0, 5, 0], l1: [0, 2, 0],
        };
        this.pos.set(
          lerp(f.p0[0], f.p1[0], e),
          lerp(f.p0[1], f.p1[1], e),
          lerp(f.p0[2], f.p1[2], e),
        );
        this.look.set(
          lerp(f.l0[0], f.l1[0], e),
          lerp(f.l0[1], f.l1[1], e),
          lerp(f.l0[2], f.l1[2], e),
        );
        fov = 50;
      } else if (st < 4.5) {
        // Sweep down the grid.
        const e = ease((st - 2.3) / 2.2);
        const along = lerp(-2, -35, e);
        track.pointAt(along / track.seg, lerp(8.2, 7, e), _cam);
        _cam.y += lerp(1.7, 1.15, e);
        track.pointAt((along - 2.5) / track.seg, -1.5, _look);
        _look.y += 0.95;
        this.pos.copy(_cam);
        this.look.copy(_look);
        fov = 38;
        focus = 8.5;
      } else {
        // Settle into the chase cam behind the player.
        const e = ease(clamp((st - 4.5) / 1.9, 0, 1));
        const ang = lerp(0.45, Math.PI, e);
        const dist = lerp(4.2, 4, e);
        this.chase(kart, dt);
        this.pos.set(
          kart.x + Math.sin(kart.heading + ang) * dist,
          kart.y + lerp(1.2, 1.85, e),
          kart.z + Math.cos(kart.heading + ang) * dist,
        );
        this.look.copy(_look).lerp(_look, 0);
        this.look.set(kart.x, kart.y + 0.95, kart.z);
        fov = lerp(44, 55, e);
        focus = lerp(dist, 4.2, e);
      }
    } else if (state === 'finish' || state === 'done') {
      const ang = kart.heading + 2.4 + st * 0.35;
      this.pos.set(
        kart.x + Math.sin(ang) * 6.5,
        kart.y + 2.2,
        kart.z + Math.cos(ang) * 6.5,
      );
      this.look.set(kart.x, kart.y + 0.9, kart.z);
      fov = 50;
    } else {
      // Racing: chase cam with a lagged position and a snappier look target.
      this.chase(kart, dt);
      this.pos.copy(_cam);
      this.look.copy(_look);

      const speedN = clamp(kart.speed / 33, 0, 1.3);
      fov = 53 + 13 * speedN + 8 * kart.game.boostKick;
    }

    // Portrait screens need a wider vertical FOV to keep the road in frame.
    if (cam.aspect < 1) {
      fov = Math.min(
        100,
        (2 * Math.atan(Math.tan((fov * Math.PI) / 360) * clamp(0.8 / cam.aspect, 1, 1.75)) * 180) / Math.PI,
      );
    }

    cam.position.copy(this.pos);

    // Screen shake.
    const shake = kart.game.shake;
    if (shake > 0) {
      cam.position.x += (Math.random() - 0.5) * shake;
      cam.position.y += (Math.random() - 0.5) * shake;
      kart.game.shake = Math.max(0, shake - dt * 1.4);
    }

    // Never let the camera sink into the ground.
    if (track.heightAt) {
      const ground = track.heightAt(cam.position.x, cam.position.z);
      if (cam.position.y < ground + 0.7) cam.position.y = ground + 0.7;
    }

    cam.lookAt(this.look);

    // On the title screen the big logo lives in the top-left corner, so shift
    // the whole render down-right a touch to keep the parked kart clear of it.
    if (state === 'title') {
      const w = innerWidth || 1;
      const h = innerHeight || 1;
      cam.setViewOffset(w, h, -w * 0.06, -h * 0.05, w, h);
    } else if (cam.view) {
      cam.clearViewOffset();
    }

    const rate = state === 'intro' || state === 'title' ? 50 : 6;
    if (!Number.isFinite(cam.fov) || cam.fov < 10 || cam.fov > 140) cam.fov = fov;
    if (!Number.isFinite(fov)) fov = 62;
    cam.fov = clamp(damp(cam.fov, fov, rate, dt), 20, 120);
    this.fov = cam.fov;
    cam.updateProjectionMatrix();
    this.focus = focus ?? 6;
  }
}
