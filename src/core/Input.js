// Race-Off - input.
//
// Keyboard, gamepad and touch all feed the same `input` object on the player's
// kart. Edge-triggered actions (drift press, item use, turbo) are latched for
// exactly one frame so a physics step never misses a tap.

import { clamp, isTouch } from './utils.js';

// Remappable driving controls. Each action maps to a list of keys; the first
// entry is the "primary" binding shown in the UI. Stored in localStorage as
// `ro-keys`. System keys (pause, mute, restart, emotes, Enter) stay fixed.
export const DEFAULT_KEYS = {
  accel: ['ArrowUp', 'w'],
  brake: ['ArrowDown', 's'],
  left: ['ArrowLeft', 'a'],
  right: ['ArrowRight', 'd'],
  drift: [' ', 'Shift'],
  turbo: ['Shift'],
  item: ['e'],
};

const ACTIONS = Object.keys(DEFAULT_KEYS);

export const ACTION_LABELS = {
  accel: 'ACCELERATE',
  brake: 'BRAKE / REVERSE',
  left: 'STEER LEFT',
  right: 'STEER RIGHT',
  drift: 'DRIFT / HOP',
  turbo: 'TURBO',
  item: 'USE ITEM',
};

/** Load the saved keymap, filling any missing actions with the defaults. */
export function loadKeymap() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('ro-keys')) || {};
  } catch { /* private mode or corrupt */ }
  const map = {};
  for (const a of ACTIONS) {
    const v = saved[a];
    map[a] = Array.isArray(v) && v.length && v.every((k) => typeof k === 'string')
      ? v.slice(0, 3)
      : DEFAULT_KEYS[a].slice();
  }
  return map;
}

export function saveKeymap(map) {
  try {
    localStorage.setItem('ro-keys', JSON.stringify(map));
  } catch { /* private mode */ }
}

export class Input {
  constructor(game) {
    this.game = game;
    this.isTouch = isTouch;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.touchSteer = 0;
    this.touchSteerRaw = 0;
    this.touchDrift = false;
    this.touchBrake = false;
    this.touchTurbo = 0;
    this.touchItem = 0;
    this.gamepad = null;
    this.enabled = false;
    this.keymap = loadKeymap();
    this.capturing = null; // action name while waiting for a remap keypress
    this.bind();
  }

  /** Is any key bound to `action` currently held down? */
  has(action) {
    const list = this.keymap[action];
    for (let i = 0; i < list.length; i++) if (this.keys.has(list[i])) return true;
    return false;
  }

  /** Was any key bound to `action` pressed this exact frame? */
  hit(action) {
    const list = this.keymap[action];
    for (let i = 0; i < list.length; i++) if (this.pressed.has(list[i])) return true;
    return false;
  }

  /** The primary binding for an action, pretty-printed for the UI. */
  label(action) {
    const k = this.keymap[action][0];
    if (k === ' ') return 'SPACE';
    const names = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT' };
    return names[k] || k.toUpperCase();
  }

  /** Start listening for the next keypress to rebind `action`. */
  capture(action, onDone) {
    this.capturing = { action, onDone };
  }

  bind() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      // Remap capture: the next key becomes the action's primary binding.
      if (this.capturing) {
        e.preventDefault();
        const cap = this.capturing;
        this.capturing = null;
        if (k !== 'Escape') {
          this.keymap[cap.action] = [k];
          saveKeymap(this.keymap);
        }
        cap.onDone && cap.onDone(k);
        return;
      }
      this.keys.add(k);
      this.pressed.add(k);
      const g = this.game;
      const bound = Object.values(this.keymap).some((l) => l.includes(k));
      if (bound || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
      if (k === 'm') {
        const muted = g.audio.toggleMute();
        g.menus.muteChip(muted);
      }
      if (k === 'p' || k === 'Escape') g.onPauseKey();
      if (k === 'r' && g.state === 'race') g.restartRace();
      if (k >= '1' && k <= '6') g.emitEmote(k.charCodeAt(0) - 49);
      if (k === 'Enter') g.menus.onEnter();
      g.menus.onKey(k);
    });

    addEventListener('keyup', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.delete(k);
      this.released.add(k);
    });

    addEventListener('blur', () => {
      this.keys.clear();
      this.touchDrift = false;
      this.touchBrake = false;
      this.touchSteerRaw = 0;
    });

    // ---- touch controls
    if (isTouch) {
      document.body.classList.add('touch');
      // Touch users have no accelerate button (original design): the kart
      // auto-throttles during a race unless they hold BRAKE.
      this.game.autoAccel = true;
    }
    this.bindTouch();
  }

  bindTouch() {
    const pill = document.getElementById('tpill');
    const knob = document.getElementById('tknob');
    const steer = document.getElementById('tsteer');
    if (!steer) return;
    let active = null;
    let startX = 0;

    const setKnob = () => {
      if (knob) knob.style.transform = `translateX(${this.touchSteerRaw * 46}px)`;
    };

    const move = (e) => {
      // Use the touch that started on the pad, not touches[0] - another
      // finger (drift/brake) must not hijack the steering.
      const t = e.changedTouches
        ? Array.from(e.changedTouches).find((x) => x.identifier === active) || e.changedTouches[0]
        : e;
      if (active && e.touches && !Array.from(e.touches).some((x) => x.identifier === active)) return;
      const rect = steer.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      this.touchSteerRaw = clamp((t.clientX - cx) / (rect.width / 2), -1, 1);
      setKnob();
    };

    steer.addEventListener('touchstart', (e) => {
      active = e.changedTouches[0].identifier;
      startX = e.changedTouches[0].clientX;
      move(e);
      e.preventDefault();
    }, { passive: false });
    steer.addEventListener('touchmove', (e) => {
      const t = Array.from(e.changedTouches).find((x) => x.identifier === active);
      if (!t) return;
      const rect = steer.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      this.touchSteerRaw = clamp((t.clientX - cx) / (rect.width / 2), -1, 1);
      setKnob();
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      const t = Array.from(e.changedTouches).find((x) => x.identifier === active);
      if (!t) return;
      active = null;
      this.touchSteerRaw = 0;
      setKnob();
    };
    steer.addEventListener('touchend', end);
    steer.addEventListener('touchcancel', end);

    const hold = (id, onDown, onUp) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => { onDown(); e.preventDefault(); }, { passive: false });
      el.addEventListener('touchend', (e) => { onUp(); e.preventDefault(); }, { passive: false });
      el.addEventListener('touchcancel', () => onUp());
      el.addEventListener('mousedown', (e) => { e.preventDefault(); onDown(); });
      el.addEventListener('mouseup', () => onUp());
      el.addEventListener('mouseleave', () => onUp());
    };

    hold('tb-drift', () => { this.touchDrift = true; this.pressed.add('touch-drift'); }, () => { this.touchDrift = false; });
    hold('tb-brake', () => { this.touchBrake = true; }, () => { this.touchBrake = false; });
    hold('tb-turbo', () => { this.pressed.add('touch-turbo'); }, () => {});
    hold('tb-item', () => { this.pressed.add('touch-item'); }, () => {});
    hold('tb-pause', () => this.game.onPauseKey(), () => {});
  }

  /** Read the first connected gamepad into the raw fields. */
  pollGamepad() {
    if (!navigator.getGamepads) return null;
    const pad = Array.from(navigator.getGamepads()).find((p) => p && p.connected);
    this.gamepad = pad || null;
    return this.gamepad;
  }

  /** Last raw steering from the left stick / dpad, +1 = left (original convention). */
  padSteer() {
    const p = this.gamepad;
    if (!p) return 0;
    const btn = (i) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.3));
    const x = p.axes[0] || 0;
    if (btn(14)) return 1; // dpad left
    if (btn(15)) return -1; // dpad right
    if (Math.abs(x) > 0.14) {
      return -Math.sign(x) * Math.pow((Math.abs(x) - 0.14) / 0.86, 1.3);
    }
    return 0;
  }

  padButton(i) {
    return !!(this.gamepad && this.gamepad.buttons[i] && this.gamepad.buttons[i].pressed);
  }

  /** Push this frame's state onto the player's kart. */
  applyTo(kart) {
    if (!kart) return;
    const inp = kart.input;

    const left = this.has('left');
    const right = this.has('right');
    // Steering convention (matches the original bundle and the AI, which
    // steers by heading delta): +1 = left, -1 = right.
    let steer = (left ? 1 : 0) - (right ? 1 : 0);
    steer -= this.touchSteerRaw; // touch raw is +1 = drag right
    steer += this.padSteer();
    inp.steer = clamp(steer, -1, 1);

    const up = this.has('accel');
    const down = this.has('brake');
    inp.accel = up || this.padButton(0) ? 1 : 0;
    inp.brake = down || this.touchBrake || this.padButton(1) ? 1 : 0;

    // Auto-throttle once the race starts unless the player brakes.
    if (this.game.state === 'race' && !this.game.paused) {
      if (!inp.brake) inp.accel = Math.max(inp.accel, this.game.autoAccel ? 1 : inp.accel);
    }

    const driftDown = this.has('drift') || this.touchDrift || this.padButton(5) || this.padButton(4);
    if (inp.turbo && !inp.drift) inp.driftPressed = false;
    inp.driftPressed = !inp.drift && driftDown && !inp.turbo;
    inp.drift = driftDown && !inp.turbo;

    inp.turbo = this.hit('turbo') || this.pressed.has('touch-turbo') ||
      this.padButton(2) || this.padButton(6);

    inp.item = this.hit('item') || this.pressed.has('touch-item') || this.padButton(3);
  }

  /** Call at the end of every frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.touchTurbo = 0;
    this.touchItem = 0;
  }
}
