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
//
// Rooms expire after 45s without a heartbeat. The registry is mirrored to
// rooms.json every 10s and reloaded on boot so a restart keeps the directory.
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

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log('[race-off companion] directory on http://localhost:' + PORT);
});
