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
import { track as trackEvent } from './analytics.js';

// A full field is ten karts - enough for a small team plus CPU fillers.
export const GRID = 10;
export const GRID_MIN = 6;
export const POINTS = [20, 16, 13, 11, 9, 7, 5, 4, 3, 2];

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

    // AI fills the remaining grid slots, cycling through the unused racers
    // (with 10 slots and 8 racers the pool wraps for the tail of the field).
    const pool = ROSTER.filter((r) => r.id !== playerChar);
    for (let i = 0; i < aiCount; i++) {
      const char = pool[i % pool.length];
      const k = new Kart(this, char.id, i + 1, false);
      // The field is longer now, so the difficulty ramp is gentler: the front
      // of the grid is quick, the tail is beatable, and nobody is a runaway.
      k.skill = 0.86 + this.rnd() * 0.22 - i * 0.012;
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

    // Battle: three balloons apiece, no laps.
    if (this.battle) {
      for (const k of this.karts) {
        k.balloons = 3;
        k.eliminated = false;
      }
      this.hud.setBattleMode(true);
      this.hud.setBattle(3, this.battle.time);
    } else {
      this.hud.setBattleMode?.(false);
      for (const k of this.karts) k.eliminated = false;
      if (this.elim) this.hud.setElimTimer(this.elim.time);
    }

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
    this.battle = null;
    this.elim = null;
    this.team = null;
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
    this.battle = null;
    this.elim = null;
    this.team = null;
    const id = trackId || this.currentTrackId || 'beach';
    this.currentTrackId = id;
    this.loadTrack(id);
    this.buildField(this.pickChar(), 0);
    this.beginIntro();
  },

  /** Battle arena: no laps - pop balloons, last kart standing wins. */
  startBattle(arenaId) {
    this.audio.resume();
    this.cup = null;
    this.daily = null;
    this.timeTrial = false;
    this.noItems = false;
    this.battle = { time: 120, over: false, order: [], playerOut: false };
    this.elim = null;
    this.team = null;
    const id = arenaId || 'arena1';
    this.currentTrackId = id;
    this.loadTrack(id);
    this.buildField(this.pickChar());
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
    this.battle = null;
    this.elim = null;
    this.team = null;
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

  /** Team race: 3 v 3 (or as evenly as the field allows). Every finish banks
   *  points for the whole team, so the leaderboard sorts by team total. */
  startTeamRace(trackId) {
    this.audio.resume();
    this.cup = null;
    this.daily = null;
    this.timeTrial = false;
    this.noItems = false;
    this.battle = null;
    this.elim = null;
    this.team = { pts: { red: 0, blue: 0 }, members: { red: [], blue: [] } };
    const id = trackId || this.currentTrackId || 'beach';
    this.currentTrackId = id;
    this.loadTrack(id);
    this.buildField(this.pickChar());
    this.assignTeams();
    this.beginIntro();
  },

  /** Split the field into two teams by GRID SLOT (even = red, odd = blue).
   *  Deriving it from the slot rather than from randomness means every client
   *  computes the identical split with nothing extra on the wire, solo and
   *  online alike. The human player's side is then called 'red' so the
   *  results panel can always say "your team". */
  assignTeams(byRacer = null) {
    const team = this.team;
    team.pts = { red: 0, blue: 0 };
    team.members = { red: [], blue: [] };
    if (byRacer) {
      // Online: the host's authoritative racer -> side map, so every client
      // agrees even though each sees its own player in a different slot.
      for (const k of this.karts) k.team = byRacer[k.def.id] || 'red';
    } else {
      // Solo: alternate by grid slot, which is deterministic locally.
      const bySlot = this.karts.slice().sort((a, b) => a.slot - b.slot);
      bySlot.forEach((k) => {
        k.team = k.slot % 2 === 0 ? 'red' : 'blue';
      });
      // Mirror the labels if the player landed on the odd side, so "red" is
      // always the player's side.
      const me = this.player;
      if (me && me.team === 'blue') {
        this.karts.forEach((k) => {
          k.team = k.team === 'red' ? 'blue' : 'red';
        });
      }
    }
    for (const k of this.karts) team.members[k.team].push(k);
  },

  /** Build the racer -> side map the host sends with a team race start. */
  teamMap() {
    const map = {};
    for (const k of this.karts) {
      if (k.team) map[k.def.id] = k.team;
    }
    return map;
  },

  /** Team standings for the HUD/results: [{id, pts, karts}] sorted by points. */
  teamStandings() {
    if (!this.team) return [];
    return ['red', 'blue']
      .map((id) => ({ id, pts: this.team.pts[id] || 0, karts: this.team.members[id] || [] }))
      .sort((a, b) => b.pts - a.pts || a.id.localeCompare(b.id));
  },

  /** Which team is ahead right now, by summed live progress. */
  teamLiveLeaders() {
    if (!this.team) return { red: 0, blue: 0 };
    const sum = { red: 0, blue: 0 };
    for (const k of this.karts) if (k.team) sum[k.team] += k.progress;
    return sum;
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
    this.battle = null;
    this.elim = null;
    this.team = null;
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
    // Funnel: a race was started (every entry path funnels through here).
    trackEvent('race_start', {
      track: this.track?.def?.id || '',
      mode: this.mp ? 'mp'
        : this.timeTrial ? 'tt'
        : this.daily ? 'daily'
        : this.battle ? 'battle'
        : this.elim ? 'elim'
        : this.cup ? 'gp' : 'solo',
    });
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
    if (this.battle) return; // battles have no laps and no finish line
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
      // Team race: every finisher banks its place-points for the whole side.
      if (this.team && kart.team) {
        const gain = POINTS[Math.min(this.finishedCount - 1, POINTS.length - 1)] ?? 0;
        this.team.pts[kart.team] += gain;
      }
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

  // ------------------------------------------------------------------ battle
  /** A balloon just popped on `kart` (called from Kart.spinOut in battle). */
  onBalloonPop(kart) {
    if (!this.battle || this.battle.over || kart.eliminated) return;
    kart.balloons = Math.max(0, kart.balloons - 1);
    this.audio.sfx('pop');
    // Only the player's own pops drive the HUD pip readout.
    if (kart.isPlayer) this.hud.setBattle(kart.balloons, this.battle.time);
    if (kart.balloons <= 0) return this.eliminate(kart);
    if (kart.isPlayer) {
      this.hud.toast('BALLOON POPPED! ' + '\u{1F388}'.repeat(kart.balloons), 'red', 1.4);
    } else if (this.battle.order.length || Math.random() < 0.6) {
      this.hud.toast(kart.def.name.toUpperCase() + ' POPPED!', 'cyan', 1.2);
    }
  },

  /** A kart is out (battle balloons gone, or elimination clock): poof. */
  eliminate(kart) {
    if (kart.eliminated || this.state === 'done') return;
    const mode = this.battle && !this.battle.over ? this.battle : this.elim && !this.elim.over ? this.elim : null;
    if (!mode) return;
    kart.eliminated = true;
    mode.order.push(kart.def.id);
    kart.say('\u{1F4A5}', 2.2);
    kart.spin = Math.max(kart.spin, 1.1);
    kart.invuln = 2;
    this.fx.burst?.(kart.x, kart.y + 0.8, kart.z, 26, 10, [4, 2.2, 2.4], 0.6, 0.55);
    this.audio.sfx('explode', 0.9);
    this.hud.toast('\u{1F4A5} ' + kart.def.name.toUpperCase() + (this.battle ? ' IS OUT!' : ' ELIMINATED!'), 'red', 2);
    const alive = this.karts.filter((k) => !k.eliminated).length;
    if (this.battle) {
      if (kart.isPlayer) {
        this.battle.playerOut = true;
        this.endBattle();
      } else if (alive <= 1) {
        this.endBattle();
      }
    } else if (this.elim) {
      if (kart.isPlayer) {
        this.elim.playerOut = true;
        this.endElimination();
      } else if (alive <= 1) {
        this.endElimination();
      }
    }
  },

  /** Battle ranking: survivors by balloons, then the popped in reverse order. */
  battleRanking() {
    const alive = this.karts
      .filter((k) => !k.eliminated)
      .sort((a, b) => b.balloons - a.balloons || b.progress - a.progress);
    const out = this.battle.order
      .slice()
      .reverse()
      .map((id) => this.karts.find((k) => k.def.id === id))
      .filter(Boolean);
    return [...alive, ...out];
  },

  /** Battle clock + end conditions, driven from the race loop. */
  updateBattle(dt) {
    const b = this.battle;
    if (!b || b.over || this.state !== 'race') return;
    b.time -= dt;
    this.hud.setBattleTime(Math.max(0, b.time));
    if (b.time <= 0) return this.endBattle();
    if (this.karts.filter((k) => !k.eliminated).length <= 1) this.endBattle();
  },

  /** Settle the battle: rank the field, banner, then the results panel. */
  endBattle() {
    const b = this.battle;
    if (!b || b.over) return;
    b.over = true;
    this.ranked = this.battleRanking();
    this.ranked.forEach((k, i) => {
      k.rank = i + 1;
      k.finished = true;
      if (!k.finishTime) k.finishTime = 0;
    });
    if (this.paused) this.togglePause(false);
    this.player.item = null;
    this.player.roll = 0;
    this.hud.setItem(null);
    this.setState('finish');
    const won = this.player.rank === 1 && !b.playerOut;
    this.hud.banner(won ? 'VICTORY!' : 'POPPED!', 'final', 3.5);
    this.audio.stopMusic();
    this.audio.sfx('finish');
    if (won) {
      this.player.say('\u{1F3C6}', 6);
      const t = this.track;
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          this.fx.confetti(t.px[0], t.py[0] + 10, t.pz[0], 150);
        }, i * 500);
      }
    }
    this.audio.setStar(false);
  },

  // ------------------------------------------------------------- elimination
  /** Elimination race: normal laps, but every 20s the last kart explodes. */
  startElimination(trackId) {
    this.audio.resume();
    this.cup = null;
    this.daily = null;
    this.timeTrial = false;
    this.noItems = false;
    this.battle = null;
    this.elim = { time: 20, order: [], playerOut: false, over: false };
    const id = trackId || this.currentTrackId || 'beach';
    this.currentTrackId = id;
    this.loadTrack(id);
    this.buildField(this.pickChar());
    this.beginIntro();
  },

  /** Elimination ranking: finishers, then survivors by progress, then the
   *  eliminated in reverse pop order (last one out places highest). */
  elimRanking() {
    const alive = this.karts.filter((k) => !k.eliminated).sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    const out = this.elim.order
      .slice()
      .reverse()
      .map((id) => this.karts.find((k) => k.def.id === id))
      .filter(Boolean);
    return [...alive, ...out];
  },

  /** Elimination clock, driven from the race loop. */
  updateElimination(dt) {
    const e = this.elim;
    if (!e || e.over || this.state !== 'race') return;
    e.time -= dt;
    this.hud.setElimTimer(Math.max(0, e.time));
    if (e.time > 0) return;
    e.time = 20;
    // ranked is one frame stale - close enough for "who is last".
    const last = this.ranked.filter((k) => !k.eliminated).pop();
    if (last) this.eliminate(last);
  },

  /** Settle an elimination race: banner, then the normal results flow. */
  endElimination() {
    const e = this.elim;
    if (!e || e.over) return;
    e.over = true;
    this.ranked = this.elimRanking();
    this.ranked.forEach((k, i) => {
      k.rank = i + 1;
    });
    if (this.paused) this.togglePause(false);
    this.player.item = null;
    this.player.roll = 0;
    this.hud.setItem(null);
    this.setState('finish');
    const won = this.player.rank === 1 && !e.playerOut;
    this.hud.banner(won ? 'LAST KART STANDING!' : 'ELIMINATED!', 'final', 3.5);
    this.hud.setBest(0); // clear the NEXT OUT countdown
    this.audio.stopMusic();
    this.audio.sfx('finish');
    if (won) {
      this.player.say('\u{1F3C6}', 6);
      const t = this.track;
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          this.fx.confetti(t.px[0], t.py[0] + 10, t.pz[0], 150);
        }, i * 500);
      }
    }
    this.audio.setStar(false);
  },

  onPlayerFinish() {
    if (this.paused) this.togglePause(false);
    this.player.item = null;
    this.player.roll = 0;
    this.hud.setItem(null);
    if (this.elim) this.hud.setBest(0); // clear the NEXT OUT countdown
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
    // Funnel: the race ran to the results.
    trackEvent('race_finish', {
      track: this.track?.def?.id || '',
      place: this.player?.rank || 0,
    });
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
      this.timeTrial ? (this.newRecord ? 'NEW RECORD!' : 'TIME TRIAL!') : null,
      this.battle ? 'battle' : this.elim ? 'elim' : this.team ? 'team' : null,
      this.team ? this.teamStandings() : null);
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
    if (this.battle) return this.startBattle();
    if (this.elim) return this.startElimination();
    if (this.team) return this.startTeamRace();
    if (this.cup) {
      this.cup.race = Math.max(0, this.cup.race - 1);
      return this.startCupRace();
    }
    this.startSolo();
  },

  toTitle() {
    this.cup = null;
    this.battle = null;
    this.elim = null;
    this.team = null;
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
