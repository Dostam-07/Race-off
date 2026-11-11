// Race-Off - multiplayer over PeerJS.
//
// One player hosts a room (a 4-character code) and everyone else dials in.
// The host owns the authoritative state: it relays every guest's kart snapshot
// to the others, assigns grid slots and racers, and starts the race. If the
// host vanishes mid-lobby the next player in line is promoted to host.
//
// Message types (all JSON):
//   hello / pick        guest -> host: joined, racer + name choice
//   lobby               host -> guests: the player list + level + cup state
//   go                  host -> guests: leave the lobby for the track
//   start               host -> guests: grid order, humans, names, start delay
//   s                   kart snapshots (host relays; guests send one)
//   ev                  item events (rockets, traps, bolts)
//   ping / pong         keepalive + rtt
//   left / bye / full   departures and room-full

import Peer from 'peerjs';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_PREFIX = 'raceoff-cc-';

export const makeCode = () =>
  Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');

/** Keep only A-Z0-9, max 6 chars - used for room codes typed by hand. */
export const cleanCode = (s) =>
  String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

/** Sanitise a player name: strip control chars, cap length, title-case words. */
const graphemes = (s) =>
  (typeof Intl < 'u' && Intl.Segmenter)
    ? Array.from(new Intl.Segmenter().segment(s), (e) => e.segment)
    : Array.from(s);

const titleCase = (s) => {
  const lo = s.toLocaleLowerCase();
  const up = s.toLocaleUpperCase();
  if (lo === up || (s !== lo && s !== up)) return s;
  const g = graphemes(s);
  return g[0].toLocaleUpperCase() + g.slice(1).join('').toLocaleLowerCase();
};

export const cleanName = (s) =>
  graphemes(
    String(s || '')
      .slice(0, 200)
      .normalize('NFC')
      .replace(/[^\p{L}\p{N}\p{M}\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\ufe0f '.\-]/gu, '')
      .replace(/(\p{M}{2})\p{M}+/gu, '$1')
      .replace(/\s+/g, ' ')
      .trim(),
  )
    .slice(0, 10)
    .join('')
    .trim()
    .split(/([ '\-])/)
    .map(titleCase)
    .join('');

const RACER_MAX = 6;

/** A racer index must be an integer in [0, 6). */
const isRacer = (n) => Number.isInteger(n) && n >= 0 && n < RACER_MAX;

/** Validate a score table ({racerIndex: points}). */
const scoreTable = (s) => {
  const out = {};
  if (s && typeof s === 'object') {
    for (let i = 0; i < RACER_MAX; i++) {
      if (Number.isFinite(s[i])) out[i] = Math.max(0, Math.min(999, s[i] | 0));
    }
  }
  return out;
};

/** Validate a cup state carried in lobby messages. */
const cupState = (s) =>
  !s || typeof s !== 'object' || !Number.isInteger(s.i) || s.i < 0 || s.i > 4
    ? null
    : { i: s.i, pts: scoreTable(s.pts), gain: s.gain ? scoreTable(s.gain) : null };

/** Validate a 15-number kart snapshot (plus one trailing emote field). */
const isSnapshot = (s, extra = 0) =>
  Array.isArray(s) &&
  s.length === 15 + extra &&
  s.every((v, i) =>
    i === 14 + extra
      ? v === 0 || typeof v === 'string'
      : Number.isFinite(v) && Math.abs(v) < 1e6,
  );

const now = () => performance.now();

/** Send immediately (or after the simulated lag when testing). */
let fakeLag = 0;
const post = (conn, msg) => {
  const send = () => {
    try {
      if (conn && conn.open) conn.send(msg);
    } catch { /* connection closed mid-send */ }
  };
  fakeLag ? setTimeout(send, fakeLag * (0.8 + Math.random() * 0.5)) : send();
};

export class Net {
  /**
   * `opts`: code, host, rehost, server, level, gp, name, racer, lag, gen,
   * promoted, had, wait. `hooks` is the set of callbacks listed below.
   */
  constructor(opts, hooks) {
    this.code = opts.code;
    this.isHost = !!opts.host;
    this.rehost = !!opts.rehost;
    this.server = opts.server || '';
    this.level = opts.level || '';
    this.gp = opts.gp || null;
    this.h = hooks;
    this.me = {
      pid: this.isHost ? 'host' : '',
      name: cleanName(opts.name),
      racer: opts.racer | 0,
    };
    this.players = this.isHost
      ? [{ pid: 'host', name: this.me.name, racer: this.me.racer, host: true, waiting: false }]
      : [];
    this.guests = new Map();
    this.hostConn = null;
    this.phase = 'lobby';
    this.status = 'connecting';
    this.dead = false;
    this.waiting = false;
    fakeLag = Math.min(400, Math.max(0, opts.lag || 0));
    this.stats = { evOut: 0, evIn: 0 };
    this.rtt = 0;
    this.q = 0;
    this.rq = 0;
    this.lv = 0;
    this.sendT = 0;
    this.pingT = 0;
    this.last = now();
    this.tries = 0;
    this.gen = (opts.gen | 0) & 3;
    this.promoted = !!opts.promoted;
    this.lost = null;
    this.miss = 0;
    this.probeN = opts.had ? 8 : 0;
    this.probeT = now();
    if (!this.isHost && opts.wait && opts.wait.rank >= 0) {
      this.lost = { to: this.gen, rank: opts.wait.rank, at: now(), fast: false, alt: false };
    }
    this.open();
  }

  setStatus(s) {
    if (this.status !== s) {
      this.status = s;
      this.h.lobby();
    }
  }

  // ------------------------------------------------------------- connections
  open() {
    if (this.dead) return;
    const cfg = { debug: 0 };
    if (this.server) {
      const [host, port] = this.server.split(':');
      Object.assign(cfg, { host, port: +port || 9000, path: '/', secure: false });
    }
    const id = this.isHost ? this.hostId() : ROOM_PREFIX + 'g-' + Math.random().toString(36).slice(2, 12);
    let peer;
    try {
      peer = this.peer = new Peer(id, cfg);
    } catch {
      this.setStatus('unsupported');
      return;
    }
    peer.on('open', () => {
      this.tries = 0;
      if (this.isHost) this.setStatus('open');
      else this.dial();
    });
    peer.on('connection', (conn) => {
      if (this.isHost) this.accept(conn);
      else conn.close();
    });
    peer.on('disconnected', () => {
      if (!this.dead && !peer.destroyed && peer === this.peer) {
        setTimeout(() => {
          try {
            if (!peer.destroyed && peer.disconnected) peer.reconnect();
          } catch { /* already gone */ }
        }, 1500);
      }
    });
    peer.on('error', (err) => this.onError(peer, err));
  }

  hostId(gen = this.gen) {
    return ROOM_PREFIX + this.code + (gen ? '-' + gen : '');
  }

  reopen(delay) {
    const peer = this.peer;
    this.peer = null;
    this.batch = null;
    try {
      if (peer) peer.destroy();
    } catch { /* already destroyed */ }
    if (!this.dead) {
      setTimeout(() => {
        if (!this.peer) this.open();
      }, delay);
    }
  }

  onError(peer, err) {
    if (this.dead || peer !== this.peer) return;
    const type = err && err.type;

    if (type === 'browser-incompatible') {
      this.dead = true;
      this.setStatus('unsupported');
      return;
    }

    // Someone already holds this room id: retry, then fall through a generation.
    if (type === 'unavailable-id') {
      if (this.rehost && !this.promoted && this.tries++ < 10) {
        this.reopen(1200);
        return;
      }
      if (this.gen > 0 || this.promoted) {
        this.dead = true;
        try {
          peer.destroy();
        } catch { /* ignore */ }
        this.h.demote(this.gen);
        return;
      }
      this.rehost = false;
      this.code = makeCode();
      this.h.code(this.code);
      this.reopen(100);
      return;
    }

    if (type === 'peer-unavailable') {
      const batch = this.batch;
      if (!this.isHost && this.phase === 'lobby' && batch && ++batch.bad >= batch.n) batch.fail();
      return;
    }

    if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
      if (this.phase === 'race') return;
      this.setStatus('offline');
      this.reopen(3000);
    }
  }

  /** Guests: open connections to every generation of the room id. */
  dial() {
    const peer = this.peer;
    if (this.dead || !peer || peer.destroyed || this.isHost || this.batch) return;
    if (peer.disconnected) {
      this.reopen(500);
      return;
    }
    this.lv = 0;
    this.rq = 0;

    const lost = this.lost;
    const targets = lost
      ? lost.alt ? [lost.to, (lost.to + 3) & 3] : [lost.to]
      : [0, 1, 2, 3].map((r) => (this.gen + r) & 3);
    const batch = (this.batch = { n: targets.length, bad: 0, cs: [] });

    batch.fail = () => {
      if (this.batch !== batch) return;
      this.batch = null;
      for (const c of batch.cs) {
        try {
          c.close();
        } catch { /* ignore */ }
      }
      if (this.status !== 'offline') {
        this.miss++;
        this.setStatus(this.lost ? 'away' : 'noroom');
        this.h.lobby();
      }
      this.redial(this.lost ? 600 : 1500);
    };
    setTimeout(batch.fail, 9000);

    for (const gen of targets) {
      let conn;
      try {
        conn = peer.connect(this.hostId(gen), { serialization: 'json' });
      } catch {
        batch.bad++;
        continue;
      }
      batch.cs.push(conn);
      let won = false;

      conn.on('open', () => {
        if (this.batch !== batch || this.dead) {
          try {
            conn.close();
          } catch { /* ignore */ }
          return;
        }
        this.batch = null;
        for (const c of batch.cs) {
          if (c !== conn) {
            try {
              c.close();
            } catch { /* ignore */ }
          }
        }
        won = true;
        this.hostConn = conn;
        this.gen = gen;
        this.last = now();
        this.lost = null;
        this.miss = 0;
        this.bye = false;
        if (this.h.gen) this.h.gen(gen);
        this.me.pid = peer.id;
        post(conn, { t: 'hello', name: this.me.name, racer: this.me.racer, level: this.level });
        this.setStatus('joined');
      });

      conn.on('data', (msg) => {
        if (conn === this.hostConn) this.guestData(msg);
      });

      const gone = () => {
        if (won) this.hostGone(conn);
      };
      conn.on('close', gone);
      conn.on('error', gone);
    }
    if (batch.bad >= batch.n) batch.fail();
  }

  redial(delay) {
    setTimeout(() => {
      if (!this.dead && !this.hostConn && !this.batch && this.phase === 'lobby') this.dial();
    }, delay);
  }

  hostGone(conn) {
    if (conn !== this.hostConn || this.dead) return;
    this.hostConn = null;
    try {
      conn.close();
    } catch { /* ignore */ }

    const guests = this.players.filter((p) => !p.host).map((p) => p.pid).sort();
    const rank = guests.indexOf(this.me.pid);
    this.lost = {
      to: (this.gen + 1) & 3,
      rank,
      at: now(),
      fast: !!this.bye,
      alt: !this.bye,
    };

    // Mid-race there is no recovering: end the session.
    if (this.phase === 'race') {
      this.dead = true;
      this.h.hostLost();
      try {
        this.peer.destroy();
      } catch { /* ignore */ }
      return;
    }

    this.players = [];
    this.miss = 0;
    this.setStatus('away');
    this.h.lobby();
    this.redial(1500);
  }

  // ------------------------------------------------------------------ guests
  guestData(msg) {
    if (!msg || typeof msg !== 'object') return;
    this.last = now();

    if (msg.t === 's') {
      if (msg.q > this.rq && Array.isArray(msg.ks)) {
        this.rq = msg.q;
        for (const k of msg.ks) {
          if (isSnapshot(k, 1) && isRacer(k[0])) {
            this.h.state(k[0], k.slice(1), this.rtt / 2000);
          }
        }
      }
    } else if (msg.t === 'ev') {
      if (this.h.event(msg.ev, -1)) this.stats.evIn++;
    } else if (msg.t === 'ping') {
      post(this.hostConn, { t: 'pong', n: msg.n });
      if (Number.isFinite(msg.rtt)) this.rtt = msg.rtt;
    } else if (msg.t === 'lobby') {
      if (!(msg.v > this.lv) || !Array.isArray(msg.players)) return;
      this.lv = msg.v;
      if (msg.level && this.level && msg.level !== this.level && this.h.level) {
        this.h.level(msg.level);
        return;
      }
      this.gp = cupState(msg.gp);
      this.players = msg.players
        .filter((p) => p && isRacer(p.racer))
        .slice(0, RACER_MAX)
        .map((p) => ({
          pid: String(p.pid),
          name: cleanName(p.name),
          racer: p.racer,
          host: !!p.host,
          waiting: !!p.waiting,
        }));
      const mine = this.players.find((p) => p.pid === this.me.pid);
      if (mine) {
        this.me.racer = mine.racer;
        this.waiting = mine.waiting;
      }
      this.h.lobby();
      if (this.h.gp) this.h.gp();
    } else if (msg.t === 'left') {
      if (isRacer(msg.racer) && this.h.gone) this.h.gone(msg.racer);
    } else if (msg.t === 'bye') {
      this.bye = true;
    } else if (msg.t === 'go') {
      if (typeof msg.level === 'string' && this.h.go) this.h.go(msg.level);
    } else if (msg.t === 'start') {
      if (this.phase !== 'lobby' || this.waiting) return;
      const grid = msg.grid;
      if (
        !Array.isArray(grid) ||
        grid.length !== RACER_MAX ||
        grid.slice().sort().join() !== '0,1,2,3,4,5' ||
        !Array.isArray(msg.humans)
      ) {
        return;
      }
      const names = {};
      for (const r of msg.humans) if (isRacer(r)) names[r] = cleanName(msg.names && msg.names[r]);
      this.phase = 'race';
      this.h.start(
        { grid, humans: msg.humans.filter(isRacer), names },
        Math.min(400, Math.max(0, +msg.delay || 0)),
      );
    } else if (msg.t === 'full') {
      this.dead = true;
      this.setStatus('full');
    }
  }

  // ------------------------------------------------------------------- host
  accept(conn) {
    const guest = {
      conn,
      pid: conn.peer,
      ok: false,
      name: '',
      racer: -1,
      rtt: 0,
      last: now(),
      q: 0,
      waiting: false,
    };
    conn.on('data', (msg) => this.hostData(guest, msg));
    const drop = () => this.drop(guest);
    conn.on('close', drop);
    conn.on('error', drop);
  }

  /** First free racer slot, starting from `want`. */
  free(want) {
    const taken = new Set(this.roster().map((p) => p.racer));
    let r = isRacer(want) ? want : 0;
    for (let i = 0; i < RACER_MAX && taken.has(r); i++) r = (r + 1) % RACER_MAX;
    return r;
  }

  roster() {
    const list = [
      { pid: 'host', name: this.me.name, racer: this.me.racer, host: true, waiting: false },
    ];
    for (const g of this.guests.values()) {
      list.push({ pid: g.pid, name: g.name, racer: g.racer, host: false, waiting: g.waiting });
    }
    return list;
  }

  /** Push the lobby state to every guest and refresh the local panel. */
  sync() {
    this.players = this.roster();
    const v = ++this.lv;
    for (const g of this.guests.values()) {
      post(g.conn, { t: 'lobby', v, players: this.players, level: this.level, gp: this.gp });
    }
    this.h.lobby();
  }

  /** Tell every guest to leave the lobby for the chosen track. */
  go(level) {
    if (this.isHost) {
      for (const g of this.guests.values()) post(g.conn, { t: 'go', level });
    }
  }

  hostData(guest, msg) {
    if (!msg || typeof msg !== 'object' || this.dead) return;
    guest.last = now();

    if (msg.t === 's') {
      if (guest.ok && !guest.waiting && this.phase === 'race' && msg.q > guest.q && isSnapshot(msg.k)) {
        guest.q = msg.q;
        this.h.state(guest.racer, msg.k, guest.rtt / 2000);
      }
    } else if (msg.t === 'pong') {
      const rtt = now() - msg.n;
      if (rtt >= 0 && rtt < 5000) guest.rtt = guest.rtt ? guest.rtt * 0.7 + rtt * 0.3 : rtt;
    } else if (msg.t === 'ev') {
      if (!guest.ok || guest.waiting || this.phase !== 'race') return;
      const ev = this.h.event(msg.ev, guest.racer);
      if (ev) {
        this.stats.evIn++;
        for (const other of this.guests.values()) {
          if (other !== guest && !other.waiting) post(other.conn, { t: 'ev', ev });
        }
      }
    } else if (msg.t === 'hello') {
      if (guest.ok) return;
      if (this.guests.size >= 5) {
        post(guest.conn, { t: 'full' });
        setTimeout(() => {
          try {
            guest.conn.close();
          } catch { /* ignore */ }
        }, 500);
        return;
      }
      if (typeof msg.level === 'string' && msg.level && this.level && msg.level !== this.level) {
        post(guest.conn, {
          t: 'lobby',
          v: this.lv + 1,
          players: this.players,
          level: this.level,
          gp: this.gp,
        });
        return;
      }
      guest.ok = true;
      guest.name = cleanName(msg.name);
      guest.racer = this.free(msg.racer);
      guest.waiting = this.phase !== 'lobby';
      this.guests.set(guest.pid, guest);
      this.sync();
    } else if (msg.t === 'pick') {
      if (!guest.ok || this.phase !== 'lobby') return;
      guest.name = cleanName(msg.name);
      if (
        isRacer(msg.racer) &&
        !(this.gp && this.gp.i > 0) &&
        !this.roster().some((p) => p.racer === msg.racer && p.pid !== guest.pid)
      ) {
        guest.racer = msg.racer;
      }
      this.sync();
    }
  }

  drop(guest) {
    if (this.guests.get(guest.pid) !== guest) return;
    this.guests.delete(guest.pid);
    try {
      guest.conn.close();
    } catch { /* ignore */ }
    if (this.phase === 'race' && !guest.waiting) {
      this.h.left(guest.racer);
      for (const g of this.guests.values()) post(g.conn, { t: 'left', racer: guest.racer });
    }
    if (!this.guests.size) {
      this.probeN = 8;
      this.probeT = now();
    }
    this.sync();
  }

  /** Host: shuffle the grid, tell everyone and start the race locally. */
  start() {
    if (!this.isHost || this.phase !== 'lobby' || this.status !== 'open') return false;
    this.phase = 'race';

    const humans = this.roster().map((p) => p.racer);
    const names = {};
    for (const p of this.roster()) names[p.racer] = p.name;
    for (let i = humans.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [humans[i], humans[j]] = [humans[j], humans[i]];
    }
    const grid = [0, 1, 2, 3, 4, 5].filter((r) => !humans.includes(r)).concat(humans);

    let worst = 0;
    for (const g of this.guests.values()) worst = Math.max(worst, Math.min(600, g.rtt));
    for (const g of this.guests.values()) {
      post(g.conn, {
        t: 'start',
        grid,
        humans,
        names,
        delay: (worst - Math.min(600, g.rtt)) / 2,
      });
    }
    return this.h.start({ grid, humans, names }, worst / 2);
  }

  pick(racer, name) {
    this.me.name = cleanName(name);
    if (isRacer(racer)) this.me.racer = racer;
    if (this.isHost) this.sync();
    else post(this.hostConn, { t: 'pick', racer: this.me.racer, name: this.me.name });
  }

  /** Broadcast an item event (rocket fired, trap dropped, ...). */
  ev(ev) {
    if (this.dead || this.phase !== 'race') return;
    this.stats.evOut++;
    if (this.isHost) {
      for (const g of this.guests.values()) {
        if (!g.waiting) post(g.conn, { t: 'ev', ev });
      }
    } else {
      post(this.hostConn, { t: 'ev', ev });
    }
  }

  // -------------------------------------------------------------- keepalive
  tick() {
    if (this.dead) return;
    const t = now();
    const racing = this.phase === 'race';
    const timeout = racing ? 6000 : 25000;

    if (this.isHost) {
      if (t - this.pingT > 1000) {
        this.pingT = t;
        for (const g of this.guests.values()) {
          if (t - g.last > timeout) this.drop(g);
          else post(g.conn, { t: 'ping', n: t, rtt: g.rtt });
        }
      }

      // When idle with no guests, check whether a newer generation took over.
      if (!racing && this.probeN > 0 && !this.guests.size && this.status === 'open' && t - this.probeT > 5000) {
        this.probeN--;
        this.probeT = t;
        const next = (this.gen + 1) & 3;
        let probe = null;
        try {
          probe = this.peer.connect(this.hostId(next), { serialization: 'json' });
        } catch { /* ignore */ }
        if (probe) {
          probe.on('open', () => {
            try {
              probe.close();
            } catch { /* ignore */ }
            if (this.dead || this.guests.size || this.phase !== 'lobby') return;
            this.dead = true;
            try {
              this.peer.destroy();
            } catch { /* ignore */ }
            this.h.demote(next);
          });
          setTimeout(() => {
            try {
              probe.close();
            } catch { /* ignore */ }
          }, 4000);
        }
      }
    } else {
      if (this.hostConn && this.hostConn.open && t - this.last > timeout) this.hostGone(this.hostConn);

      // Waiting too long for a lost host: take over the room.
      const lost = this.lost;
      if (
        lost && !racing && lost.rank >= 0 &&
        !(this.hostConn && this.hostConn.open) &&
        t - lost.at > (lost.fast ? 2500 : 30000) + lost.rank * (lost.fast ? 9000 : 15000)
      ) {
        this.dead = true;
        try {
          this.peer.destroy();
        } catch { /* ignore */ }
        this.h.promote(lost.to, this.gp);
      }
    }

    // Snapshot loop: 20 packets per second while racing.
    if (racing && t - this.sendT >= 50) {
      this.sendT = t;
      const q = ++this.q;
      if (this.isHost) {
        if (this.guests.size) {
          const all = this.h.all();
          for (const g of this.guests.values()) {
            if (!g.waiting) post(g.conn, { t: 's', q, ks: all.filter((k) => k[0] !== g.racer) });
          }
        }
      } else {
        post(this.hostConn, { t: 's', q, k: this.h.mine() });
      }
    }
  }

  leave() {
    if (this.isHost) {
      for (const g of this.guests.values()) post(g.conn, { t: 'bye' });
    }
    const peer = this.peer;
    this.dead = true;
    setTimeout(() => {
      try {
        if (peer) peer.destroy();
      } catch { /* ignore */ }
    }, this.isHost && this.guests.size ? 250 : 0);
  }

  destroy() {
    this.dead = true;
    try {
      if (this.peer) this.peer.destroy();
    } catch { /* ignore */ }
  }
}
