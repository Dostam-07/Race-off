// Race-Off companion directory - a tiny zero-dependency signalling companion.
//
// The game's peer-to-peer layer (PeerJS) never routes through this server; it
// only keeps a directory of live rooms so that:
//   - invite links resolve to the right room generation after a host migration
//   - public rooms can be listed and quick-match can find an open race
//   - a room outlives its host tab's sessionStorage (the directory is shared)
//
// Endpoints (all JSON, CORS open):
//   POST /rooms        { code, gen, level, phase, players, name }  heartbeat/register
//   GET  /rooms        list of public, open rooms
//   GET  /rooms/:code  one room (any visibility) - gen/level/phase/players
//   DELETE /rooms/:code  close a room (host leaving)
//   POST /scores       { track, cc, name, time }  submit a time-trial time
//   GET  /scores/:track?cc=1   top 10 times for that track + engine class
//
// Rooms expire after 45s without a heartbeat. The registry is mirrored to
// rooms.json every 10s and reloaded on boot so a restart keeps the directory.
// Leaderboards are mirrored to scores.json the same way (top 10 per track+cc,
// max 1000 entries total so the file stays small).
//
// Run: node companion/server.mjs   (port 8785, override with PORT)

import http from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const PORT = +(process.env.PORT || 8785);
const TTL = 45000;
const FILE = join(dirname(fileURLToPath(import.meta.url)), 'rooms.json');

const CODE_RE = /^[A-Z0-9]{4,6}$/;

/** @type {Map<string, object>} code -> room record */
const rooms = new Map();

// Reload a previous snapshot so restarts keep serving the same directory.
try {
  if (existsSync(FILE)) {
    const saved = JSON.parse(readFileSync(FILE, 'utf8'));
    const now = Date.now();
    for (const r of Array.isArray(saved) ? saved : []) {
      if (r && CODE_RE.test(r.code) && now - (r.ts || 0) < TTL) rooms.set(r.code, r);
    }
  }
} catch { /* corrupt snapshot - start empty */ }

const snap = () => {
  try {
    writeFileSync(FILE, JSON.stringify([...rooms.values()]));
  } catch { /* read-only disk - directory stays in memory */ }
};
setInterval(snap, 10000).unref();

// --------------------------------------------------------------- leaderboards
const SCORES_FILE = join(dirname(fileURLToPath(import.meta.url)), 'scores.json');
const TRACK_RE = /^[a-z]{3,10}$/;
const MAX_BOARDS = 100; // track:cc keys kept

/** @type {Map<string, Array>} "track:cc" -> sorted top-10 entries */
const boards = new Map();

try {
  if (existsSync(SCORES_FILE)) {
    const saved = JSON.parse(readFileSync(SCORES_FILE, 'utf8'));
    for (const [k, list] of Object.entries(saved || {})) {
      if (Array.isArray(list)) boards.set(k, list.slice(0, 10));
    }
  }
} catch { /* corrupt snapshot - start empty */ }

let scoresDirty = false;
setInterval(() => {
  if (!scoresDirty) return;
  scoresDirty = false;
  try {
    writeFileSync(SCORES_FILE, JSON.stringify(Object.fromEntries(boards)));
  } catch { /* read-only disk - scores stay in memory */ }
}, 5000).unref();

const validTime = (t) => Number.isFinite(t) && t > 1 && t < 1000000;

const json = (res, code, body) => {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(data);
};

const readBody = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(''));
  });

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);

  // POST /rooms - register or heartbeat a room
  if (req.method === 'POST' && parts[0] === 'rooms' && parts.length === 1) {
    let msg;
    try {
      msg = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: 'bad json' });
    }
    const code = String(msg.code || '').toUpperCase();
    if (!CODE_RE.test(code)) return json(res, 400, { error: 'bad code' });
    const prev = rooms.get(code);
    const room = {
      code,
      gen: (msg.gen | 0) & 3,
      level: String(msg.level || 'beach').slice(0, 24),
      phase: msg.phase === 'race' ? 'race' : 'lobby',
      players: Math.max(1, Math.min(6, (msg.players | 0) || 1)),
      name: String(msg.name || '').slice(0, 12),
      public: !!msg.public,
      ts: Date.now(),
    };
    // A room that switched from race back to lobby is open to joiners again.
    room.open = room.phase === 'lobby' && room.players < 6;
    rooms.set(code, room);
    return json(res, 200, { ok: true, gen: room.gen });
  }

  // GET /rooms - public open rooms for quick match / the room list
  if (req.method === 'GET' && parts[0] === 'rooms' && parts.length === 1) {
    const now = Date.now();
    const list = [...rooms.values()]
      .filter((r) => r.public && r.open && now - r.ts < TTL)
      .sort((a, b) => b.players - a.players)
      .slice(0, 24)
      .map(({ code, gen, level, phase, players, name }) => ({ code, gen, level, phase, players, name }));
    return json(res, 200, { rooms: list });
  }

  // GET or DELETE /rooms/:code
  if (parts[0] === 'rooms' && parts.length === 2) {
    const code = String(parts[1] || '').toUpperCase();
    if (!CODE_RE.test(code)) return json(res, 400, { error: 'bad code' });
    const room = rooms.get(code);
    if (req.method === 'DELETE') {
      rooms.delete(code);
      snap();
      return json(res, 200, { ok: true });
    }
    if (!room || Date.now() - room.ts >= TTL) {
      return json(res, 404, { error: 'no room' });
    }
    return json(res, 200, {
      code: room.code,
      gen: room.gen,
      level: room.level,
      phase: room.phase,
      players: room.players,
      open: room.open,
      public: room.public,
      age: Date.now() - room.ts, // ms since the last heartbeat
    });
  }

  // POST /scores - submit a time-trial time
  if (req.method === 'POST' && parts[0] === 'scores' && parts.length === 1) {
    let msg;
    try {
      msg = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: 'bad json' });
    }
    const track = String(msg.track || '');
    if (!TRACK_RE.test(track)) return json(res, 400, { error: 'bad track' });
    const cc = [0.85, 1, 1.15].includes(msg.cc) ? msg.cc : 1;
    const time = +msg.time;
    if (!validTime(time)) return json(res, 400, { error: 'bad time' });
    const name = String(msg.name || 'GHOST').slice(0, 12) || 'GHOST';
    const key = `${track}:${cc}`;
    const list = (boards.get(key) || []).filter(
      (e) => !(e.name === name && Math.round(e.time * 100) === Math.round(time * 100)),
    );
    const entry = { name, time: Math.round(time * 100) / 100, ts: Date.now() };
    list.push(entry);
    list.sort((a, b) => a.time - b.time);
    boards.set(key, list.slice(0, 10));
    while (boards.size > MAX_BOARDS) {
      const oldest = [...boards.keys()][0];
      boards.delete(oldest);
    }
    scoresDirty = true;
    const rank = list.indexOf(entry) + 1;
    return json(res, 200, { ok: true, rank: rank <= 10 ? rank : 0, top: boards.get(key) });
  }

  // GET /scores/:track?cc=1 - the top-10 board
  if (req.method === 'GET' && parts[0] === 'scores' && parts.length === 2) {
    const track = String(parts[1] || '');
    if (!TRACK_RE.test(track)) return json(res, 400, { error: 'bad track' });
    const ccQ = parseFloat(url.searchParams.get('cc'));
    const cc = [0.85, 1, 1.15].includes(ccQ) ? ccQ : 1;
    const list = boards.get(`${track}:${cc}`) || [];
    return json(res, 200, { track, cc, top: list });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log('[race-off companion] directory on http://localhost:' + PORT);
});
