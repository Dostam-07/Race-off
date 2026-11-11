// Race-Off - race flow.
//
// The state machine that sits on top of Game: starting a race, the intro fly-
// through, the countdown, the racing loop, crossing the line, the results and
// returning to the title. Kept separate from Game.js so the shell stays small.

import { clamp, lerp, damp, formatTime, ordinal } from '../core/utils.js';
import { ROSTER, CHAR_TUNING } from '../kart/KartModel.js';
import { TRACK_ORDER, TRACKS } from '../tracks/definitions.js';
import { Kart } from '../kart/Kart.js';
import { addUnlock } from '../kart/KartModel.js';
import { Ghost, loadGhost, saveGhost, REC_EVERY, MAX_SAMPLES, REC_DT } from '../kart/Ghost.js';
import { dailyConfig, dailyResult, dailySave, dailySaveStarted, dailyRng, dailyFriendTime } from './daily.js';
import { STORE, sset } from '../net/Multiplayer.js';

export const GRID = 6;
export const POINTS = [15, 12, 10, 8, 6, 4];

/** Attach the race-flow methods to a Game instance. */
export function installRaceFlow(GameClass) {
  Object.assign(GameClass.prototype, raceFlow);
}

const raceFlow = {
  // ------------------------------------------------------------------- setup
  setState(state, st = 0) {
    this.state = state;
    this.st = st;
    this.menus?.onStateChange?.(state);
  },

  /** Build the full field of karts for a race on the loaded track. */
  buildField(playerChar, aiCount = GRID - 1) {
    for (const k of this.karts) this.scene.remove(k.root);
    this.karts.length = 0;

    const used = new Set();
    const player = new Kart(this, playerChar, 0, true);
    player.isPlayer = true;
    player.human = true;
    used.add(playerChar);
    this.karts.push(player);
    this.player = player;

    // AI fills the remaining grid slots with the unused racers.
    const pool = ROSTER.filter((r) => r.id !== playerChar);
    for (let i = 0; i < aiCount; i++) {
      const char = pool[i % pool.length];
      const k = new Kart(this, char.id, i + 1, false);
      k.skill = 0.82 + this.rnd() * 0.3 - i * 0.02;
      this.karts.push(k);
    }

    this.karts.forEach((k, i) => k.place(i));
    this.ranked = this.karts.slice();
    this.lapTimes = [];
    this.raceTime = 0;
    this.lapStart = 0;
    this.finishedCount = 0;
    this.countN = 4;
    this.countT = 0;
    this.finishT = 0;
    this.hud.setLap(1);
    this.hud.setTime(0);
    this.hud.setMode(this.cc, this.mirror);
    this.hud.setCoins(0);
    this.hud.setItem(null);
    this.hud.setTurbo(0);
    this.hud.buildBoard?.(this.ranked);
    this.audio.setStar(false);

    // Time trial: load the track's best-lap ghost and start recording a new one.
    this.ghostRec = [];
    this.ghostTick = 0;
    this.newRecord = false;
    this.noItems = !!this.timeTrial;
    this.ghost = this.ghost || new Ghost(this);
    if (this.timeTrial) {
      const best = loadGhost(this.currentTrackId);
      this.ghostBest = best;
      this.hud.setBest(best ? best.time : 0);
      if (best) this.ghost.setData(best);
      else this.ghost.hide();
    } else {
      this.ghostBest = null;
      this.hud.setBest(0);
      this.ghost.hide();
    }
  },

  // -------------------------------------------------------------- entry points
  startSolo(trackId) {
    this.audio.resume();
    this.cup = null;
    this.daily = null;
    this.timeTrial = false;
    this.noItems = false;
    const id = trackId || this.currentTrackId || 'beach';
    this.currentTrackId = id;
    this.loadTrack(id);
    this.buildField(this.pickChar());
    this.beginIntro();
  },

  /** Time trial: solo, no items, racing your own best-lap ghost. */
  startTimeTrial(trackId) {
    this.audio.resume();
    this.cup = null;
    this.daily = null;
    this.timeTrial = true;
    this.noItems = true; // must be set before loadTrack - Items builds there
    const id = trackId || this.currentTrackId || 'beach';
    this.currentTrackId = id;
    this.loadTrack(id);
    this.buildField(this.pickChar(), 0);
    this.beginIntro();
  },

  /** Daily challenge: one seeded attempt per day, time shared via URL. */
  startDaily() {
    const d = dailyConfig();
    const done = dailyResult(d.key);
    if (done) {
      this.menus.showTitle();
      this.hud.toast(
        done.time
          ? 'DAILY DONE: ' + formatTime(done.time) + ' - BACK TOMORROW!'
          : 'DAILY ATTEMPT USED - BACK TOMORROW!',
        'gold',
        2.6,
      );
      this.audio.sfx('tick');
      return;
    }
    this.audio.resume();
    this.cup = null;
    this.timeTrial = false;
    this.noItems = false;
    this.daily = { key: d.key };
    this.dailyKey = d.key;
    this.dailyCfg = d;
    this.cc = d.cc;
    this.mirror = d.mirror;
    this.rnd = dailyRng(d.seed); // fixed AI skills + item rolls
    this.currentTrackId = d.track;
    this.loadTrack(d.track);
    this.buildField(this.pickChar());
    this.beginIntro();
    dailySaveStarted(d.key);
    const label =
      this.track.def.name + (d.cc === 0.85 ? ' - 50CC' : d.cc === 1.15 ? ' - 150CC' : '') + (d.mirror ? ' - MIRROR' : '');
    this.hud.toast('DAILY: ' + label, 'gold', 3);
  },

  startCupOrTrack(mode) {
    if (mode === 'gp') return this.startCup();
    this.startSolo(mode);
  },

  startCup() {
    this.cup = {
      race: 0,
      total: TRACK_ORDER.length,
      order: TRACK_ORDER.slice(),
      pts: {},
      gain: {},
      final: false,
      key: (k) => k.def.id,
    };
    for (const r of ROSTER) this.cup.pts[r.id] = 0;
    this.startCupRace();
  },

  startCupRace() {
    const cup = this.cup;
    const id = cup.order[cup.race];
    cup.race++;
    this.currentTrackId = id;
    this.timeTrial = false;
    this.noItems = false;
    this.daily = null;
    this.audio.resume();
    this.loadTrack(id);
    this.buildField(this.pickChar());
    for (const k of this.karts) k.cupPts = cup.pts[k.def.id] || 0;
    this.beginIntro();
  },

  pickChar() {
    return ROSTER[this.menus.pick]?.id || 'frog';
  },

  /** Title -> intro fly-through -> countdown -> race. */
  beginIntro() {
    this.menus.hideAll();
    this.audio.init();
    this.audio.resume();
    this.audio.stopTitle();
    this.audio.fanfare();
    this.setState('intro');
    this.countN = 4;
    this.countT = 0;
    this.hud.show(true);
    this.cameraRig.reset();
  },

  // ------------------------------------------------------------------ looping
  startCountdown() {
    this.setState('race');
    this.countN = 3;
    this.countT = 0;
    this.audio.startMusic(this.track.def.id);
  },

  updateCountdown(dt) {
    this.countT += dt;
    const beepAt = [0, 1, 2, 3];
    const step = Math.floor(this.countT / 1);
    if (step !== this._countStep && step <= 3) {
      this._countStep = step;
      if (step < 3) {
        this.hud.count(3 - step);
        this.audio.sfx('beep', step + 1); // 3..2..1: each blip a note higher
        this.audio.setRev(0.35 + step * 0.2);
      } else {
        this.hud.count('GO!', true);
        this.audio.sfx('go');
        this.audio.setRev(0);
        this.goT = 0.85;
      }
    }
  },

  onLap(kart) {
    if (kart.isPlayer && kart.lap > 1 && !kart.finished) {
      const lapTime = this.raceTime - this.lapStart;
      this.lapTimes.push(lapTime);
      this.lapStart = this.raceTime;
      if (this.timeTrial) { this.pendingTTLap = lapTime; }
    }
    if (kart.lap > this.LAPS && !kart.finished) {
      kart.finished = true;
      kart.finishTime = this.raceTime;
      this.finishedCount = this.ranked.filter((k) => k.finished).length;
      if (kart.isPlayer) {
        // The final lap still counts for the personal best.
        if (this.pendingTTLap != null) {
          this.onTTLap(this.pendingTTLap);
          this.pendingTTLap = null;
        }
        this.onPlayerFinish();
      }
      return;
    }

    if (!kart.isPlayer || kart.finished) return;

    this.hud.setLap(kart.lap);
    // A fresh personal-best banner takes precedence over the lap banner.
    let recordBanner = false;
    if (this.pendingTTLap != null) {
      recordBanner = this.onTTLap(this.pendingTTLap);
      this.pendingTTLap = null;
    }
    if (recordBanner) {
      // 'NEW RECORD!' banner already shown by onTTLap.
    } else if (kart.lap === this.LAPS) {
      this.hud.banner('FINAL LAP!', 'final', 2.4);
      this.audio.sfx('lap');
      this.audio.setFinalLap();
    } else if (kart.lap > 1) {
      this.hud.banner('LAP ' + kart.lap, '', 1.6);
      this.audio.sfx('lap');
    }
    if (kart.lap > 1) {
      const t = this.track;
      this.fx.confetti(t.px[0], t.py[0] + 9, t.pz[0], 90);
    }
  },

  /** Daily challenge finished: record the time, share it, compare with any
   *  friend time carried in the URL hash. */
  onDailyFinish() {
    const d = this.daily;
    this.daily = null;
    if (!d) return;
    const t = this.player.finishTime;
    dailySave(d.key, t);
    const friend = dailyFriendTime();
    let msg = 'DAILY: ' + formatTime(t);
    if (friend != null) {
      msg += t <= friend ? ' - YOU BEAT ' + formatTime(friend) + '!' : ' - TARGET ' + formatTime(friend);
    } else {
      msg += ' - LINK COPIED, CHALLENGE A FRIEND!';
      try {
        const url = location.origin + location.pathname + '#daily=' + t.toFixed(3);
        navigator.clipboard?.writeText(url).catch(() => { /* clipboard blocked */ });
      } catch { /* clipboard unavailable */ }
    }
    this.hud.toast(msg, 'gold', 4);
  },

  /** Time trial: a lap just completed - maybe a new personal best.
   *  Returns true when a new record was saved (its banner is already up). */
  onTTLap(lapTime) {
    const samples = this.ghostRec.slice(0, MAX_SAMPLES);
    this.ghostRec = []; // start recording the next lap fresh
    if ((!this.ghostBest || lapTime < this.ghostBest.time) && samples.length >= 8) {
      const data = { time: +lapTime.toFixed(3), char: this.player.def.id, samples };
      saveGhost(this.currentTrackId, data);
      this.ghostBest = data;
      this.ghost.setData(data);
      this.newRecord = true;
      this.hud.setBest(lapTime);
      this.hud.banner('NEW RECORD!', 'final', 2.2);
      this.audio.sfx('lap');
      return true;
    }
    return false;
  },

  onPlayerFinish() {
    if (this.paused) this.togglePause(false);
    this.player.item = null;
    this.player.roll = 0;
    this.hud.setItem(null);
    this.setState('finish');
    const head = this.timeTrial ? 'FINISH!' : this.player.rank === 1 ? 'YOU WIN!' : 'FINISH!';
    this.hud.banner(head, 'final', 3.5);
    this.audio.stopMusic();
    this.audio.sfx('finish');
    if (this.daily) this.onDailyFinish();
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const t = this.track;
        this.fx.confetti(t.px[0], t.py[0] + 10, t.pz[0], 150);
      }, i * 500);
    }
    if (this.player.rank <= 3) {
      this.player.say(['\u{1F3C6}', '\u{1F948}', '\u{1F949}'][this.player.rank - 1], 6);
    }
    this.audio.setStar(false);
  },

  showResults() {
    this.setState('done');
    this.fitUI(); // the panel scales to the viewport
    // The race is over: free the room's phase so the host can start the next
    // race, waiting guests become racers again, spectators return to the lobby.
    if (this.mp && this.mp.isHost && !this.mp.dead) this.mp.raceOver();
    const cup = this.cup;
    if (cup) {
      for (const k of this.karts) {
        const gain = POINTS[Math.min(k.rank - 1, POINTS.length - 1)] ?? 0;
        cup.gain[k.def.id] = gain;
        cup.pts[k.def.id] = (cup.pts[k.def.id] || 0) + gain;
      }
      cup.final = cup.race >= cup.total;
      // Persist the room cup state so the reload between races keeps score.
      if (cup.room && this.mp && this.mp.isHost && !this.mp.dead) {
        sset(STORE.mgp, JSON.stringify({
          code: this.mp.code,
          gp: cup.final ? { i: 0, pts: {} } : { i: cup.race, pts: cup.pts },
        }));
      }
      // Grand Prix champion: the winner's racer earns the gold rim livery.
      if (cup.final) {
        const best = Object.keys(cup.pts).reduce((a, b) => (cup.pts[b] > cup.pts[a] ? b : a));
        if (best === this.player.def.id) {
          const char = this.player.def;
          if (addUnlock('gold', char.id)) {
            setTimeout(() => {
              this.hud.toast(char.name + ' CHAMPION LIVERY UNLOCKED!', 'gold', 4);
              this.audio.sfx('finish');
            }, 1600);
          }
        }
      }
    }
    this.hud.results(this.ranked, this.player, this.lapTimes, '', false, cup,
      this.timeTrial ? (this.newRecord ? 'NEW RECORD!' : 'TIME TRIAL!') : null);
    // Fit the panel now that its content (and real height) is known.
    this.fitUI();
    this.menus.hideResults = null;
    // Time trial: submit the run to the leaderboard and show the top times.
    if (this.timeTrial && this.player.finished) {
      this.updateBoard();
    }
  },

  /** Submit my time-trial time and fill the results leaderboard. */
  async updateBoard() {
    try {
      const { submitScore, fetchScores } = await import('../net/scores.js');
      const track = this.track.def.id;
      const myName = this.hud.names?.[this.player.def.id] || 'GHOST';
      submitScore(track, this.cc, this.raceTime, myName);
      const top = await fetchScores(track, this.cc);
      // My standing in the merged board (local + remote).
      const mine = top.findIndex(
        (e) => e.name === myName && Math.abs(e.time - this.raceTime) < 0.01,
      );
      if (mine >= 0 && mine < 10) {
        setTimeout(() => this.hud.toast(`TOP ${mine + 1} TIME!`, 'gold', 3), 900);
      }
      const body = document.getElementById('lboard-body');
      if (!body) return;
      body.innerHTML = top.length
        ? top.map(
            (e, i) =>
              `<div class="lb-r${i === 0 ? ' first' : ''}"><span class="lb-n">${i + 1}</span><span class="lb-name">${e.name}</span><span class="lb-t">${formatTime(e.time)}</span></div>`,
          ).join('')
        : '<div class="lb-r"><span class="lb-name">NO TIMES YET</span></div>';
    } catch { /* board is a bonus - never break the results panel */ }
  },

  raceAgain() {
    if (this.cup) {
      if (this.cup.race < this.cup.total) {
        // Room Grand Prix: everyone reloads into the next track (a reload
        // resets the netcode cleanly), then the host starts the next race.
        if (this.cup.room && this.mp && this.mp.isHost && !this.mp.dead) {
          const next = this.cup.order[this.cup.race];
          this.mp.go(next);
          setTimeout(() => {
            try {
              const p = new URLSearchParams(location.search);
              p.set('level', next);
              location.replace(location.href.split(/[?#]/)[0] + '?' + p.toString());
            } catch { /* sandboxed - stay put */ }
          }, 350);
          return;
        }
        return this.startCupRace();
      }
      this.cup = null;
    }
    this.startSolo();
  },

  restartRace() {
    this.hud.hideResults();
    if (this.cup) {
      this.cup.race = Math.max(0, this.cup.race - 1);
      return this.startCupRace();
    }
    this.startSolo();
  },

  toTitle() {
    this.cup = null;
    this.hud.show(false);
    this.hud.hideResults();
    this.audio.stopMusic();
    this.audio.startTitle();
    this.setState('title');
    this.loadTrack(this.currentTrackId || 'beach', { mode: 'title' });
  },

  // ------------------------------------------------------------------ pause
  onPauseKey() {
    if (this.state !== 'race' && this.state !== 'finish') return;
    this.togglePause(!this.paused);
  },

  togglePause(on) {
    this.paused = on;
    this.menus.pause(on);
    if (this.audio.ctx) {
      if (on) this.audio.ctx.suspend();
      else this.audio.ctx.resume();
    }
  },
};
