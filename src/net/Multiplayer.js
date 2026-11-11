// Race-Off - the multiplayer glue.
//
// Sits between the Net transport (Net.js) and the game: owns the lobby panel,
// assigns grid slots when the host starts, feeds remote kart snapshots into the
// simulation and relays item events. Host migration (promote / demote) is
// handled here too.
//
// The room lives in the URL as ?room=CODE&level=beach so an invite link is
// just a copy of the address bar.

import { Net, makeCode, cleanCode, cleanName, ROOM_PREFIX, EMOTES } from './Net.js';
import { dirAvailable, dirQuick, dirList, dirPublish } from './directory.js';
import { ROSTER } from '../kart/KartModel.js';
import { TRACK_ORDER, TRACKS } from '../tracks/definitions.js';

export const STORE = {
  host: 'ro-host',
  had: 'ro-had',
  mgp: 'ro-mgp',
  gen: 'ro-gen',
  heir: 'ro-heir',
  name: 'ro-name',
  pub: 'ro-mpub',
};

const sget = (k) => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
export const sset = (k, v) => {
  try {
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch { /* private mode */ }
};

/** Read the room / level from the URL. */
export function roomFromUrl() {
  const p = new URLSearchParams(location.search);
  return {
    room: cleanCode(p.get('room')),
    level: p.get('level') || '',
    server: p.get('ps') || '',
    lag: +p.get('netlag') || 0,
  };
}

/** Rewrite the URL to carry (or drop) the room code. */
export function setRoomUrl(code, level) {
  const p = new URLSearchParams(location.search);
  if (code) p.set('room', code);
  else p.delete('room');
  if (level) p.set('level', level);
  const qs = p.toString();
  const url = location.href.split(/[?#]/)[0] + (qs ? '?' + qs : '');
  try {
    history.replaceState(null, '', url);
  } catch { /* sandboxed */ }
  return url;
}

export function installMultiplayer(GameClass) {
  Object.assign(GameClass.prototype, mpMethods);
  // The original tears the room down when the tab goes away - this also
  // removes hosted rooms from the companion directory.
  addEventListener('pagehide', () => {
    try {
      if (window.game?.mp) window.game.mp.destroy();
    } catch { /* ignore */ }
  });
}

const mpMethods = {
  // ------------------------------------------------------------- entry points
  /** Host a fresh room. */
  startMultiplayer(isPublic = false) {
    if (this.mp || this.state !== 'title') return;
    const code = makeCode();
    for (const k of [STORE.mgp, STORE.gen, STORE.heir, STORE.had]) sset(k, null);
    this.openRoom(code, { host: true, rehost: false, public: isPublic });
  },

  /** Quick match: join the fullest open public room, else host one. */
  async quickMatch() {
    if (this.mp || this.state !== 'title') return;
    this.hud.toast('LOOKING FOR A RACE\u2026', 'cyan', 2);
    const r = dirAvailable() ? await dirQuick() : null;
    if (r && r.code) {
      this.hud.toast('FOUND A ROOM! JOINING\u2026', 'gold', 2);
      this.joinRoom(r.code);
    } else {
      this.hud.toast('NO OPEN ROOMS - HOSTING ONE', 'gold', 2.5);
      this.startMultiplayer(true);
    }
  },

  /** Host: flip the room between public (listed) and invite-only. */
  setRoomPublic(v) {
    const mp = this.mp;
    if (!mp || !mp.isHost) return;
    mp.isPublic = !!v;
    try {
      localStorage.setItem(STORE.pub, v ? '1' : '0');
    } catch { /* private mode */ }
    dirPublish(mp);
    this.renderLobby();
  },

  /** Join an existing room by code (from the URL or typed in). */
  joinRoom(code) {
    if (this.mp || this.state !== 'title') return;
    this.openRoom(cleanCode(code), { host: false, rehost: false });
  },

  /** Shared setup for host and guest. */
  openRoom(code, opts) {
    const url = roomFromUrl();
    const heir = (sget(STORE.heir) || '').split(':');
    const wait = !opts.host && heir[0] === code ? { rank: +heir[1] || 0 } : null;

    const gpRaw = sget(STORE.mgp);
    let gp = null;
    if (opts.host && gpRaw) {
      try {
        const parsed = JSON.parse(gpRaw);
        if (parsed && parsed.code === code) gp = parsed.gp || null;
      } catch { /* ignore */ }
    }

    document.body.classList.remove('solo');
    document.body.classList.add('mp');
    sset(STORE.host, opts.host ? code : null);
    setRoomUrl(code, this.track.def.id);
    const nameInput = document.getElementById('l-name');
    const savedName = (() => {
      try {
        return localStorage.getItem(STORE.name) || '';
      } catch {
        return '';
      }
    })();
    if (nameInput && !nameInput.value) nameInput.value = cleanName(savedName);

    this.mp = new Net(
      {
        code,
        host: opts.host,
        rehost: opts.rehost,
        gp,
        gen: this.netGen(code),
        promoted: !!opts.promoted,
        wait,
        had: opts.host && sget(STORE.had) === '1',
        name: nameInput ? nameInput.value : '',
        racer: this.menus.pick,
        server: url.server,
        lag: url.lag,
        level: this.track.def.id,
        public:
          !!opts.public ||
          (() => {
            try {
              return localStorage.getItem(STORE.pub) === '1';
            } catch {
              return false;
            }
          })(),
      },
      this.netHooks(code),
    );
    this.renderLobby();
  },

  netGen(code) {
    const raw = sget(STORE.gen) || '';
    const [, gen] = raw.split(':');
    return raw.startsWith(code + ':') ? (+gen | 0) & 3 : 0;
  },

  /** The kart currently wearing a given roster slot. */
  kartOf(racer) {
    return this.karts.find((k) => k.def.id === ROSTER[racer]?.id) || null;
  },

  // ------------------------------------------------------------------- hooks
  netHooks(code) {
    return {
      lobby: () => {
        if (this.mp && this.mp.isHost && this.mp.players.length > 1) sset(STORE.had, '1');
        this.renderLobby();
      },

      gen: (gen) => {
        sset(STORE.gen, code + ':' + gen);
        sset(STORE.heir, null);
      },

      // The host vanished and this client is next in line: become the host.
      promote: (gen, gp) => {
        if (this.state !== 'title') return;
        this.mp = null;
        sset(STORE.gen, code + ':' + gen);
        sset(STORE.heir, null);
        sset(STORE.had, '1');
        sset(STORE.host, code);
        sset(STORE.mgp, JSON.stringify({ code, gp: gp ? { i: gp.i, pts: gp.pts } : null }));
        this.hud.toast('THE HOST LEFT. YOU ARE THE HOST NOW.', 'gold', 4);
        setTimeout(() => this.openRoom(code, { host: true, rehost: false, promoted: true }), 100);
      },

      // Another room already owns this id: fall back to joining instead.
      demote: (gen) => {
        if (this.state !== 'title') return;
        this.mp = null;
        sset(STORE.gen, code + ':' + gen);
        sset(STORE.host, null);
        sset(STORE.had, null);
        sset(STORE.mgp, null);
        this.openRoom(code, { host: false, rehost: true });
      },

      // The host moved the room to another track: follow it.
      level: (level) => {
        if (!TRACKS[level]) return;
        setRoomUrl(code, level);
        location.replace(location.href);
      },

      code: (newCode) => {
        sset(STORE.host, newCode);
        setRoomUrl(newCode, this.track.def.id);
        this.renderLobby();
      },

      gp: () => this.renderLobby(),

      go: (level) => {
        if (!TRACKS[level]) return;
        const racing = this.state === 'race' || this.state === 'finish' || this.state === 'done';
        if ((racing && this.cup && this.cup.room) || (this.state === 'title' && this.mp.waiting)) {
          setRoomUrl(level, level);
          location.replace(location.href);
        }
      },

      // The host pressed START: build the grid after the sync delay.
      start: (info, delay) => setTimeout(() => this.startNetRace(info), delay),

      // Joining mid-race: watch the current race as a spectator.
      spec: (info) => this.startNetSpectate(info),

      // The host's race just ended: spectators return to the lobby.
      over: () => {
        if (this.spectating) this.endSpectate();
      },

      // A remote snapshot arrived for roster slot `racer`.
      state: (racer, arr, lag) => {
        const kart = this.kartOf(racer);
        if (kart && kart.remote) kart.netApply(arr, performance.now(), lag);
      },

      // An item event (rocket, trap, bolt) from another player.
      event: (ev, from) => {
        const active = this.state === 'race' || this.state === 'finish' || this.state === 'done' || this.state === 'intro';
        return active ? this.items.netEvent(ev, from) : null;
      },

      left: (racer) => {
        const kart = this.kartOf(racer);
        if (kart) {
          kart.remote = false;
          kart.human = false;
          this.mp.h.gone(racer);
        }
      },

      gone: (racer) => {
        const kart = this.kartOf(racer);
        const names = { ...this.hud.names };
        if (!kart || names[kart.def.id] === undefined) return;
        const racing = this.state === 'race' || this.state === 'finish' || this.state === 'done';
        if (racing) this.hud.toast(names[kart.def.id] + ' LEFT', '', 1.6);
        delete names[kart.def.id];
        this.hud.setNames(names);
      },

      // An emote from another player (or my own echo on the host).
      emote: (racer, e) => {
        const kart = this.kartOf(racer);
        const racing = this.state === 'race' || this.state === 'finish' || this.state === 'intro';
        if (!kart || !racing || !EMOTES[e]) return;
        kart.say(EMOTES[e], 1.6);
        if (kart !== this.player) {
          const d = Math.hypot(kart.x - this.player.x, kart.z - this.player.z);
          if (d < 40) this.audio.sfx('pop', 0.5);
        }
      },

      // The host disappeared mid-race: everyone's kart goes back to the CPU.
      hostLost: () => {
        for (const k of this.karts) {
          k.remote = false;
          if (!k.isPlayer) k.human = false;
        }
        this.bandP = undefined;
        const racing = this.state === 'race' || this.state === 'finish' || this.state === 'done';
        if (racing && !this.player.finished) this.hud.toast('HOST LEFT \u00B7 CPU TAKES OVER', 'red', 2.2);
        if (this.state === 'done') this.showResults();
      },

      mine: () => this.player.pack(),
      all: () => this.karts.map((k) => [this.rid(k), ...k.pack()]),
    };
  },

  // ------------------------------------------------------------------ lobby
  renderLobby() {
    const mp = this.mp;
    if (!mp || this.state !== 'title') return;
    const players = mp.players;
    const myPid = mp.me.pid;
    const host = document.getElementById('l-players');

    const codeEl = document.getElementById('l-code');
    if (codeEl) codeEl.textContent = mp.code;

    // If the host assigned me a different racer, switch the picker over.
    if (mp.me.racer !== this.menus.pick && players.some((p) => p.pid === myPid)) {
      const clash = players.some((p) => p.racer === this.menus.pick && p.pid !== myPid);
      if (clash) {
        this.hud.toast(
          ROSTER[this.menus.pick].name.toUpperCase() + ' IS TAKEN. YOU ARE ' +
          ROSTER[mp.me.racer].name.toUpperCase() + '.',
          'red',
          4,
        );
      }
      this.menus.select(mp.me.racer, true);
    }

    const cup = mp.gp;
    const midCup = !!(cup && cup.i > 0 && cup.i < TRACK_ORDER.length);
    document.body.classList.toggle('gplock', midCup);

    const modeEl = document.getElementById('l-mode');
    if (modeEl) {
      modeEl.classList.toggle('ro', !mp.isHost);
      modeEl.querySelectorAll('.mchip').forEach((chip) => {
        const m = chip.dataset.m;
        chip.classList.toggle('on', cup ? m === 'gp' : m === this.track.def.id);
        if (m === 'gp') {
          chip.textContent = 'GRAND PRIX' + (midCup ? ' \u00B7 RACE ' + (cup.i + 1) + ' OF 3' : '');
        }
      });
    }

    const start = document.getElementById('l-start');
    if (start) {
      start.textContent = cup ? (midCup ? 'START RACE ' + (cup.i + 1) : 'START GRAND PRIX') : 'START RACE';
      start.style.display = mp.isHost ? '' : 'none';
      start.classList.toggle('off', mp.status !== 'open');
    }

    if (host) {
      host.textContent = '';
      for (const p of players) {
        const char = ROSTER[p.racer];
        const row = document.createElement('div');
        row.className = 'lp' + (p.pid === myPid ? ' me' : '') + (p.waiting ? ' wait' : '');
        row.style.setProperty('--c', char.css);
        const img = new Image();
        img.src = this.hud.icons[char.id];
        const label = document.createElement('span');
        label.textContent = (p.name || char.name) + (p.host ? ' \u2605' : '');
        row.append(img, label);
        host.appendChild(row);
      }
      if (players.length && players.length < 6) {
        const cpu = document.createElement('div');
        cpu.className = 'lp cpu';
        cpu.textContent = '+ ' + (6 - players.length) + ' CPU';
        host.appendChild(cpu);
      }
    }

    // Mark racers already claimed by other players.
    document.querySelectorAll('#picks .pk').forEach((el, i) => {
      const other = players.find((p) => p.racer === i && p.pid !== myPid);
      el.classList.toggle('taken', !!other);
      el.dataset.by = other ? other.name || 'TAKEN' : '';
    });

    const nameEl = document.getElementById('l-name');
    if (nameEl) {
      nameEl.classList.toggle('need', !mp.me.name && document.activeElement !== nameEl);
    }

    const status = document.getElementById('l-status');
    if (status) status.textContent = this.lobbyStatus();

    // Privacy chip (host only, meaningful only with a directory around).
    const vis = document.getElementById('l-vis');
    if (vis) {
      const on = !!mp.isPublic;
      vis.textContent = on ? 'PUBLIC ROOM' : 'PRIVATE ROOM';
      vis.classList.toggle('on', on);
      vis.style.display = mp.isHost && dirAvailable() ? '' : 'none';
    }
  },

  lobbyStatus() {
    const mp = this.mp;
    if (!mp) return '';
    const s = mp.status;
    const n = mp.players.length;
    if (this.bumpT > performance.now()) return this.bumpMsg || '';
    if (s === 'unsupported') return 'THIS BROWSER CANNOT JOIN ROOMS';
    if (s === 'full') return 'THIS ROOM IS FULL (6 RACERS)';
    if (s === 'offline') return 'CANNOT REACH THE MATCHMAKER. RETRYING\u2026';
    if (mp.isHost) {
      if (s !== 'open') return 'OPENING THE ROOM\u2026';
      return n > 1 ? n + ' RACERS IN THE ROOM' : 'SEND THE LINK. FRIENDS SHOW UP HERE.';
    }
    if (s === 'connecting') return 'JOINING THE ROOM\u2026';
    if (s === 'away') {
      return mp.lost && mp.lost.rank === 0
        ? 'THE HOST DROPPED OUT. YOU HOST NEXT IF THEY STAY AWAY.'
        : 'THE HOST DROPPED OUT. HOLDING THE ROOM\u2026';
    }
    if (s === 'noroom') {
      return mp.miss >= 2
        ? 'NO ROOM WITH THIS CODE YET. CHECK THE LINK WITH YOUR FRIEND.'
        : 'LOOKING FOR THE ROOM. IS THE HOST\u2019S GAME OPEN?';
    }
    return mp.waiting ? 'RACE IN PROGRESS. YOU ARE IN THE NEXT ONE.' : 'WAITING FOR THE HOST TO START';
  },

  /** Copy (or share) the invite link. */
  copyInvite() {
    const url = location.href;
    const btn = document.getElementById('l-invite');
    const say = (text) => {
      if (!btn) return;
      const old = btn.textContent;
      btn.textContent = text;
      clearTimeout(btn._t);
      btn._t = setTimeout(() => {
        btn.textContent = old;
      }, 1600);
    };
    if (navigator.share) {
      navigator.share({ url }).then(() => say('SENT!')).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(url).then(() => say('LINK COPIED!')).catch(() => say(url));
  },

  // ------------------------------------------------------------- race set-up
  /** Build the grid from the host's start message and begin the intro. */
  startNetRace(info) {
    const mp = this.mp;
    if (!mp || this.state !== 'title') return;
    this.timeTrial = false;
    this.noItems = false;
    // The host's engine class and mirror choice rule the room.
    if (Number.isFinite(info.cc)) this.cc = info.cc;
    this.mirror = !!info.mirror;

    // Make sure I am driving the racer the host assigned me.
    if (this.rid(this.player) !== mp.me.racer) this.menus.select(mp.me.racer, true);

    this.spectating = false;
    this.specKart = null;
    // A full six-kart field; humans drive their slots, the CPU fills the rest.
    this.buildField(this.pickChar(), 5);

    info.grid.forEach((racer, slot) => {
      const kart = this.kartOf(racer);
      if (!kart) return;
      kart.place(slot);
      kart.human = info.humans.includes(racer);
      // Guests see every human as remote; the host only sees the others.
      kart.remote = !kart.isPlayer && (mp.isHost ? kart.human : true);
      kart.sync(0);
    });

    const names = {};
    for (const r of info.humans) names[ROSTER[r].id] = info.names[r] || ROSTER[r].name;
    this.hud.setNames(names);

    if (mp.gp && mp.gp.i < TRACK_ORDER.length) {
      this.cup = { race: mp.gp.i + 1, room: true };
    }
    this.cameraRig.reset();
    const restart = document.getElementById('p-restart');
    if (restart) restart.textContent = 'LEAVE RACE';
    this.beginIntro();
  },

  /** Watch the race that is already running (late joiners). Every kart is
   *  remote-driven; the camera follows the slot the host assigned me. */
  startNetSpectate(info) {
    const mp = this.mp;
    if (!mp || this.state !== 'title') return;
    if (info.level && TRACKS[info.level] && info.level !== this.track.def.id) {
      // The room moved to another track mid-race; follow it.
      setRoomUrl(mp.code, info.level);
      location.replace(location.href);
      return;
    }
    this.timeTrial = false;
    this.noItems = false;
    if (Number.isFinite(info.cc)) this.cc = info.cc;
    this.mirror = !!info.mirror;

    if (this.rid(this.player) !== mp.me.racer) this.menus.select(mp.me.racer, true);
    this.buildField(this.pickChar(), 5);
    info.grid.forEach((racer, slot) => {
      const kart = this.kartOf(racer);
      if (!kart) return;
      kart.place(slot);
      kart.human = info.humans.includes(racer);
      kart.remote = true; // spectators drive nothing
      kart.sync(0);
    });
    this.spectating = true;
    this.specKart = this.player;

    const names = {};
    for (const r of info.humans) names[ROSTER[r].id] = info.names[r] || ROSTER[r].name;
    this.hud.setNames(names);

    this.menus.hideAll();
    this.audio.init(this.track.def.id);
    this.audio.resume();
    this.audio.stopTitle();
    this.audio.startMusic(this.track.def.id);
    this.setState('race'); // no countdown - the race is already underway
    this.raceTime = 0;
    this.lapStart = 0;
    this.hud.show(true);
    this.hud.setLap(1);
    this.hud.setMode(this.cc, this.mirror);
    this.hud.buildBoard?.(this.ranked);
    this.cameraRig.reset();
    this.hud.banner('SPECTATING', 'cyan', 2.5);
    this.hud.toast('WATCHING THE RACE - YOU ARE IN THE NEXT ONE', 'cyan', 3);
  },

  /** Leave spectator view and sit in the lobby for the next race. */
  endSpectate() {
    if (!this.spectating) return;
    this.spectating = false;
    this.specKart = null;
    this.setState('title');
    this.hud.show(false);
    this.audio.stopMusic();
    this.audio.startTitle();
    this.loadTrack(this.currentTrackId || 'beach', { mode: 'title' });
    this.menus.showLobby(); // after loadTrack - it resets the screens
  },

  /** Show an emote above my kart and relay it (multiplayer only). */
  emitEmote(i) {
    const mp = this.mp;
    if (!mp || mp.dead || mp.phase !== 'race' || !EMOTES[i]) return;
    if (!this.player || (this.state !== 'race' && this.state !== 'intro')) return;
    const t = performance.now();
    if (t - (this.emoteT0 || 0) < 1200) return;
    this.emoteT0 = t;
    this.player.say(EMOTES[i], 1.6); // show it on my own kart too - my
    mp.emote(i);                    // snapshots then carry it to everyone
  },

  /** Leave the room and go back to the single-player menus. */
  leaveRoom() {
    if (!this.mp || this.state !== 'title') return;
    this.spectating = false;
    this.specKart = null;
    this.mp.leave();
    this.mp = null;
    document.body.classList.remove('mp');
    for (const k of Object.values(STORE)) sset(k, null);
    setRoomUrl('', '');
    document.body.classList.remove('gplock');
    document.querySelectorAll('#picks .pk').forEach((el) => el.classList.remove('taken'));
    this.menus.showModes();
  },
};
