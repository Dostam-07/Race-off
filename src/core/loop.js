// Race-Off - the main loop.
//
// Installed onto Game.prototype so the shell file stays readable. One call per
// animation frame: input, physics, items, ranking, camera, HUD, audio, render.

import { clamp, damp, smooth } from './utils.js';
import { collideKarts } from '../kart/physics.js';
import { REC_EVERY, MAX_SAMPLES } from '../kart/Ghost.js';

export function installLoop(GameClass) {
  Object.assign(GameClass.prototype, loopMethods);
}

const loopMethods = {
  start() {
    this.last = performance.now();
    this.frames = 0;
    this.fpsAcc = 0;
    this.fps = 60;
    this.frameCounter = 0;
    this.prevRank = 1;
    this.rankCd = 0;
    this.boostKick = 0;
    this._rivalPrev = null; // previous distance to nearest rival, for doppler
    this.hints = {};
    this.accelHeld = 0;
    this.goT = 0;
    this._hudOn = false;

    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      this.tick(now);
    };
    this._raf = requestAnimationFrame(loop);
  },

  stop() {
    cancelAnimationFrame(this._raf);
  },

  tick(now) {
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.max(0, Math.min(raw, 0.05));

    // FPS meter.
    this.frames++;
    this.fpsAcc += dt;
    if (this.frames >= 30) {
      this.fps = Math.round(this.frames / this.fpsAcc);
      this.frames = 0;
      this.fpsAcc = 0;
    }

    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.mp) this.mp.tick();

    this.time += dt;
    this.st += dt;

    const player = this.player;
    const active = this.state === 'race' || this.state === 'finish' || this.state === 'done';
    const racing = this.state === 'race';

    if (active) this.raceTime += dt;

    // ---- input
    this.input.pollGamepad();
    this.input.applyTo(player);
    // Spectators cycle the follow camera with left/right.
    if (this.spectating && this.specKart) {
      const dir = this.input.pressed.has('ArrowRight') ? 1 : this.input.pressed.has('ArrowLeft') ? -1 : 0;
      if (dir && this.karts.length > 1) {
        const i = this.karts.indexOf(this.specKart);
        this.specKart = this.karts[(i + dir + this.karts.length) % this.karts.length];
        const nm = this.hud.names[this.specKart.def.id] || this.specKart.def.name;
        this.hud.toast('FOLLOWING ' + nm.toUpperCase(), '', 1.2);
      }
    }
    if (!racing) {
      const r = player.input;
      r.steer = 0;
      r.drift = false;
      r.driftPressed = false;
      r.item = false;
      r.turbo = false;
    }

    // ---- state transitions
    if (this.state === 'intro') this.updateIntro(dt);
    if (this.state === 'finish' && this.st > 3.6) this.showResults();

    // ---- karts
    // While hosting, the rubber-band baseline is the average human progress.
    if (this.mp && this.mp.isHost && !this.mp.dead) {
      let sum = 0;
      let n = 0;
      for (const k of this.karts) {
        if (k.human && !k.finished) {
          sum += k.progress;
          n++;
        }
      }
      this.bandP = n ? sum / n : undefined;
    }
    // Remote karts never run local physics: their owner simulates them and we
    // interpolate toward the snapshots as they arrive.
    for (const k of this.karts) {
      if (k.remote) k.remoteUpdate(dt, active);
      else k.update(dt, active);
    }
    collideKarts(this.karts);
    if (this.bumpCd > 0) this.bumpCd -= dt;

    // ---- time trial: record the current lap, replay the best-lap ghost
    if (racing && this.timeTrial && !player.finished) {
      this.ghostTick = (this.ghostTick + 1) % REC_EVERY;
      if (this.ghostTick === 0 && this.ghostRec.length < MAX_SAMPLES) {
        const p = player;
        this.ghostRec.push([
          +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.heading.toFixed(3),
        ]);
      }
      if (this.ghost.data) this.ghost.update(this.raceTime - this.lapStart);
    }

    // ---- items
    if (this.items) this.items.update(dt, active);

    // ---- ranking
    this.ranked = this.karts.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    this.ranked.forEach((k, i) => { k.rank = i + 1; });

    // ---- rank change feedback
    this.rankCd -= dt;
    if (racing && this.raceTime > 4 && player.rank !== this.prevRank && this.rankCd <= 0) {
      if (player.rank < this.prevRank) {
        this.audio.sfx('up');
        const k = this.ranked[player.rank];
        if (k && k.emoteT <= 0) k.say(Math.random() < 0.5 ? '\u{1F620}' : '\u{1F62E}');
      } else {
        this.audio.sfx('down');
        const k = this.ranked[player.rank - 2];
        if (k && !k.isPlayer && k.emoteT <= 0) {
          k.say(Math.random() < 0.5 ? '\u{1F61C}' : '\u{1F60E}');
          if (Math.hypot(k.x - player.x, k.z - player.z) < 14) this.audio.sfx('horn');
        }
      }
      this.rankCd = 1.2;
      this.prevRank = player.rank;
    }
    if (this.rankCd <= 0 || !racing) this.prevRank = player.rank;

    // ---- first-lap hints
    if (racing && player.lap <= 1) this.updateHints(player);

    // ---- screen flash
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 2.2);
      const el = document.getElementById('flash');
      if (el) el.style.opacity = (this.flash * 0.55).toFixed(2);
    }

    // ---- exhaust smoke on the title / intro screens
    if (this.state === 'title' || this.state === 'intro') {
      for (const k of this.karts) {
        if (Math.random() >= 0.16) continue;
        const s = Math.sin(k.heading);
        const c = Math.cos(k.heading);
        this.fx.smoke(
          k.x - s * 1.25 + (Math.random() - 0.5) * 0.7,
          k.y + 0.7,
          k.z - c * 1.25,
          1, [0.85, 0.85, 0.9], 0.7, 0.25, 1,
        );
      }
    }

    // ---- celebration fireworks
    if (this.fwN > 0) {
      this.fwT -= dt;
      if (this.fwT <= 0) {
        this.fwT = 0.16 + Math.random() * 0.3;
        this.fwN--;
        const t = this.track;
        this.fx.firework(
          t.px[0] + 20 + Math.random() * 90,
          26 + Math.random() * 22,
          t.pz[0] + (Math.random() - 0.5) * 70,
        );
        if (this.fwN % 2) this.audio.sfx('explode', 0.16);
      }
    }

    // ---- world animation
    this.fx.update(dt, this.camera.position);
    if (this.decor) this.decor.update(this.time);
    if (this.terrain) this.terrain.update(this.time);
    if (this.terrainMat?.uniforms?.uTime) this.terrainMat.uniforms.uTime.value = this.time;

    // The camera follows the player - or the kart a spectator is watching.
    const camTarget = this.spectating && this.specKart ? this.specKart : player;

    // Keep the shadow volume around the followed kart wherever it is.
    this.sun.target.position.set(camTarget.x, camTarget.y, camTarget.z);
    this.sun.position.set(camTarget.x + 38, camTarget.y + 62, camTarget.z + 26);
    this.sun.target.updateMatrixWorld();

    this.boostKick = damp(this.boostKick, player.boost > 0 ? 1 : 0, player.boost > 0 ? 8 : 3, dt);

    // ---- camera (spectators can cycle through the field with left/right)
    this.cameraRig.update(dt, this.state, this.st, camTarget, this.track);

    // ---- HUD
    this.hud.nameTags(this.karts, this.camera, this.state === 'race');
    if (this.state !== 'title') {
      this.hud.setTurbo(player.turbo);
      this.hud.setPos(player.rank);
      this.hud.setSpeed(player.speed, player.boost > 0);
      this.hud.setTime(player.finished ? player.finishTime : this.raceTime);
      this.hud.board(this.ranked);
      this.hud.minimap(this.karts);
      this.hud.update(dt, this.audio);
    }

    // ---- audio
    const crowdNear = clamp(
      1 - Math.hypot(player.x - this.track.px[0], player.z - this.track.pz[0]) / 170,
      0,
      1,
    );
    // Nearest rival kart + radial velocity, for the doppler engine sound.
    let rival = null;
    let bestDist = Infinity;
    for (const k of this.karts) {
      if (k === player || !k.active) continue;
      const d = Math.hypot(k.x - player.x, k.z - player.z);
      if (d < bestDist) {
        bestDist = d;
        rival = k;
      }
    }
    let rivalInfo = null;
    if (rival) {
      const rel = this._rivalPrev == null ? 0 : (bestDist - this._rivalPrev) / Math.max(dt, 0.001);
      // Smooth the radial velocity so the doppler sweep doesn't jitter.
      this._rivalRel = (this._rivalRel || 0) + (rel - (this._rivalRel || 0)) * Math.min(1, dt * 8);
      rivalInfo = { speed: rival.speed, dist: bestDist, rel: this._rivalRel };
      this._rivalPrev = bestDist;
    } else {
      this._rivalPrev = null;
    }
    this.audio.update(
      player.speed,
      player.boost > 0,
      player.drifting && player.onGround,
      this.state === 'title' ? 0 : 0.05 + 0.2 * crowdNear,
      this.state !== 'title',
      0, // tunnel amount (no tunnel surfaces in the current tracks)
      !!player.offroad,
      rivalInfo,
    );

    this.input.endFrame();
    this.renderer.render(this.scene, this.camera);
  },

  updateIntro(dt) {
    const st = this.st;
    if (st > 4.5 && !this._hudOn) {
      this._hudOn = true;
      this.hud.show(true);
    }
    const n = st < 4.1 ? 4 : 3 - Math.floor((st - 4.1) / 0.85);
    if (n !== this.countN && n < 4) {
      this.countN = n;
      if (n > 0) {
        this.hud.count(n, false);
        this.audio.sfx('beep', 4 - n); // 3..2..1: each blip a note higher
        this.trackMeshes?.lightLamp?.(3 - n, 'red');
      } else {
        this.hud.count('GO!', true);
        this.audio.sfx('go');
        this.trackMeshes?.lightLamp?.(-1, 'green');
        this.setState('race');
        this.audio.startMusic(this.track.def.id);
        const t = this.track;
        this.fx.confetti(t.px[0], t.py[0] + 10, t.pz[0], 260);
        this.decor?.releaseBalloons?.();
        this.fwT = 0;
        this.fwN = 9;

        // Rocket start for a well-timed throttle hold.
        const held = this.accelHeld;
        if (held > 0.12 && held < 1.25) {
          this.player.giveBoost(1.15, 1.32);
          this.hud.toast('ROCKET START!', 'gold');
        }
        for (const k of this.karts) {
          if (!k.isPlayer && !k.remote) k.giveBoost(0.45 + Math.random() * 0.8, 1.3);
        }
      }
    }

    const accel = this.input.keys.has('ArrowUp') || this.input.keys.has('w') ||
      this.input.touchDrift;
    this.accelHeld = accel ? this.accelHeld + dt : 0;

    if (st > 3.6 && this.state === 'finish') return;
  },

  updateHints(player) {
    const h = this.hints;
    const along = player.idx * this.track.seg;
    const def = this.track.def;
    const hints = def.hints || { turbo: [120, 400], drift: [380, 700] };
    const touch = this.hud.touch;

    if (!h.turbo && this.raceTime > 2.2 && along > hints.turbo[0] && along < hints.turbo[1]) {
      h.turbo = 1;
      this.hud.toast(touch ? 'TAP TURBO FOR A BURST' : 'SHIFT = TURBO', 'gold', 1.6);
    }
    if (h.turbo && !h.refill && player.turbo < 1 && player.boost <= 0 && this.hud.toastT <= 0) {
      h.refill = 1;
      this.hud.toast('DRIFT TO REFILL TURBO', 'gold', 1.8);
    } else if (!h.drift && along > hints.drift[0] && along < hints.drift[1]) {
      h.drift = 1;
      this.hud.toast(
        touch ? 'HOLD DRIFT + STEER' : 'HOLD SPACE + \u2190 \u2192 TO DRIFT',
        'cyan',
        2.2,
      );
    } else if (!h.item && player.item && this.hud.toastT <= 0) {
      h.item = 1;
      this.hud.toast(touch ? 'TAP ITEM TO USE IT' : 'E = USE ITEM', '', 1.6);
    }
  },
};
