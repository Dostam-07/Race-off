// Race-Off - the menus.
//
// Title screen, racer picker, cup / track selection, the pause overlay and the
// results screen. Everything here only manipulates DOM and calls into Game;
// the game state machine lives in Game.js.

import { $ } from '../core/utils.js';
import { ROSTER, CHAR_TUNING } from '../kart/KartModel.js';
import { TRACK_ORDER } from '../tracks/definitions.js';
const STORE_RACER = 'ro-racer';

export class Menus {
  constructor(game) {
    this.game = game;
    this.pick = 0;
    this.mode = 'gp';
    this.tt = false;
    this.lastFocus = null;
    this.buildPicks();
    this.wire();
    this.restoreRacer();
  }

  // ------------------------------------------------------------------ wiring
  wire() {
    const g = this.game;

    $('m-solo')?.addEventListener('click', () => {
      g.audio.resume();
      g.audio.sfx('tick');
      document.body.classList.add('solo');
      this.showCup();
    });
    $('mp-new')?.addEventListener('click', () => {
      g.audio.resume();
      g.startMultiplayer();
    });
    $('l-invite')?.addEventListener('click', () => g.copyInvite());
    $('l-leave')?.addEventListener('click', () => g.leaveRoom());
    $('l-start')?.addEventListener('click', () => {
      if (g.mp && g.mp.isHost) g.mp.start();
    });
    $('l-name')?.addEventListener('input', (e) => {
      try {
        localStorage.setItem('ro-name', e.target.value);
      } catch { /* private mode */ }
      if (g.mp) g.mp.pick(g.mp.me.racer, e.target.value);
    });
    $('l-name')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.target.blur();
      e.stopPropagation();
    });
    document.querySelectorAll('#l-mode .mchip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const mp = g.mp;
        const m = chip.dataset.m;
        if (!mp || !mp.isHost || g.state !== 'title' || mp.phase !== 'lobby') return;
        if (m === 'gp') {
          if (mp.gp) return;
          mp.gp = { i: 0, pts: {} };
          if (g.track.def.id !== TRACK_ORDER[0]) {
            g.loadTrack(TRACK_ORDER[0], { mode: 'title' });
          }
        } else {
          mp.gp = null;
          if (m !== g.track.def.id) g.loadTrack(m, { mode: 'title' });
        }
        mp.sync();
      });
    });
    $('pick')?.addEventListener('click', (e) => e.stopPropagation());
    $('m-back')?.addEventListener('click', () => this.showModes());
    $('m-go')?.addEventListener('click', () => {
      g.audio.resume();
      document.body.classList.remove('solo');
      if (this.tt && this.mode !== 'gp') g.startTimeTrial(this.mode);
      else g.startCupOrTrack(this.mode);
    });

    document.querySelectorAll('#levels .lvl').forEach((el) => {
      el.addEventListener('click', () => {
        const l = el.dataset.l;
        document.querySelectorAll('#levels .lvl').forEach((e) => e.classList.toggle('on', e === el));
        this.mode = l;
        this.updateGoLabel(el.querySelector('b')?.textContent);
        g.audio.sfx('tick');
      });
    });

    $('p-resume')?.addEventListener('click', () => g.togglePause(false));
    $('p-restart')?.addEventListener('click', () => { g.togglePause(false); g.restartRace(); });
    $('p-menu')?.addEventListener('click', () => { g.togglePause(false); g.toTitle(); });
    $('p-sound')?.addEventListener('click', () => this.updateSoundBtn());

    // Time-trial toggle on the track picker.
    document.querySelectorAll('#ttmode .mchip').forEach((el) => {
      el.addEventListener('click', () => {
        this.tt = el.dataset.tt === '1';
        document.querySelectorAll('#ttmode .mchip').forEach((e) =>
          e.classList.toggle('on', e === el));
        this.updateGoLabel();
        g.audio.sfx('tick');
      });
    });

    $('results')?.addEventListener('click', (e) => {
      if (e.target.closest('.again')) g.raceAgain();
    });
  }

  // ------------------------------------------------------------- racer picker
  buildPicks() {
    const host = $('picks');
    if (!host) return;
    host.innerHTML = '';

    const arrow = (label, delta) => {
      const el = document.createElement('div');
      el.className = 'arrow';
      el.textContent = label;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.select(this.pick + delta);
      });
      return el;
    };

    host.appendChild(arrow('\u25C0', -1));
    ROSTER.forEach((r, i) => {
      const el = document.createElement('div');
      el.className = 'pk';
      el.style.setProperty('--c', r.css);
      el.dataset.id = r.id;
      el.innerHTML = `<img src="${this.game.icons?.[r.id] || ''}" alt="${r.name}">`;
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.select(i);
      });
      host.appendChild(el);
    });
    host.appendChild(arrow('\u25B6', 1));
  }

  restoreRacer() {
    let saved = null;
    try {
      saved = localStorage.getItem(STORE_RACER);
    } catch { /* private mode */ }
    const idx = ROSTER.findIndex((r) => r.id === saved);
    this.select(idx >= 0 ? idx : 0, true);
  }

  select(index, silent = false) {
    const g = this.game;
    this.pick = (index + ROSTER.length) % ROSTER.length;
    const char = ROSTER[this.pick];

    document.querySelectorAll('#picks .pk').forEach((el, i) => {
      el.classList.toggle('on', i === this.pick);
    });

    const nameEl = $('pickname');
    if (nameEl) {
      const tuning = CHAR_TUNING[char.id];
      nameEl.innerHTML = `${char.name}<small>${(tuning?.label || '').toUpperCase()}</small>`;
      nameEl.style.color = char.css;
    }

    if (g.player) {
      g.player.setChar(char.id);
      g.player.squash = 1;
      if (!silent) g.audio.sfx('pickup');
    }
    g.hud?.setPlayer(char.id);

    try {
      localStorage.setItem(STORE_RACER, char.id);
    } catch { /* private mode */ }

    // Tell the room about the new racer (unless this is a host assignment).
    if (g.mp && !silent) g.mp.pick(this.pick, $('l-name')?.value || '');
  }

  // ------------------------------------------------------------------ screens
  showTitle() {
    $('title')?.classList.add('on');
    $('hud')?.classList.remove('on');
    $('results')?.classList.remove('on');
    this.showModes();
  }

  showModes() {
    document.body.classList.remove('solo');
    $('cup')?.classList.remove('on');
    $('lobby')?.classList.remove('on');
    $('modes')?.classList.add('on');
    $('mp')?.classList.add('on');
    this.game.fitUI();
  }

  /** Start button label reflects GP vs track vs time trial. */
  updateGoLabel(trackName) {
    const go = $('m-go');
    if (!go) return;
    if (this.mode === 'gp') go.textContent = 'START GRAND PRIX';
    else {
      const name = trackName || document.querySelector('#levels .lvl.on b')?.textContent || 'RACE';
      go.textContent = this.tt ? `TIME TRIAL: ${name}` : `START ${name}`;
    }
  }

  showCup() {
    $('modes')?.classList.remove('on');
    $('cup')?.classList.add('on');
    document.querySelectorAll('#ttmode .mchip').forEach((e) =>
      e.classList.toggle('on', (e.dataset.tt === '1') === !!this.tt));
    const first = document.querySelector('#levels .lvl.on') || document.querySelector('#levels .lvl[data-l="gp"]');
    if (first) {
      document.querySelectorAll('#levels .lvl').forEach((e) => e.classList.toggle('on', e === first));
      this.mode = first.dataset.l;
      const go = $('m-go');
      if (go) {
        go.textContent = this.mode === 'gp'
          ? 'START GRAND PRIX'
          : `START ${first.querySelector('b').textContent}`;
      }
    }
    this.game.fitUI();
  }

  showLobby() {
    $('modes')?.classList.remove('on');
    $('cup')?.classList.remove('on');
    $('lobby')?.classList.add('on');
    this.game.fitUI();
  }

  hideAll() {
    $('title')?.classList.remove('on');
    $('mutechip')?.classList.remove('on');
  }

  muteChip(muted) {
    const el = $('mutechip');
    if (!el) return;
    el.textContent = muted ? '\u{1F507} Sound off \u00B7 press M' : '\u{1F50A} Sound on \u00B7 press M';
    el.classList.toggle('off', muted);
    el.classList.add('on');
    clearTimeout(this._muteT);
    this._muteT = setTimeout(() => el.classList.remove('on'), 1800);
  }

  updateSoundBtn() {
    const muted = this.game.audio.toggleMute();
    const btn = $('p-sound');
    if (btn) btn.textContent = muted ? 'SOUND: OFF' : 'SOUND: ON';
  }

  pause(on) {
    $('pause')?.classList.toggle('on', on);
    const btn = $('p-sound');
    if (btn && on) btn.textContent = this.game.audio.muted ? 'SOUND: OFF' : 'SOUND: ON';
  }

  // ------------------------------------------------------------------- input
  onKey(key) {
    const g = this.game;
    if (g.state === 'title') {
      if (key === 'ArrowLeft' || key === 'a') this.select(this.pick - 1);
      if (key === 'ArrowRight' || key === 'd') this.select(this.pick + 1);
      if (key === ' ' || key === 'Enter') g.startSolo();
    }
  }

  onEnter() {
    const g = this.game;
    if (g.state === 'title') g.startSolo();
    else if (g.state === 'results' || g.state === 'done') g.raceAgain();
    else if (g.state === 'race' && g.finishedCount && g.player.finished) g.raceAgain();
  }
}
