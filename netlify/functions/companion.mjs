// Race-Off companion API as a Netlify Function (v2).
//
// Same contract as companion/server.mjs, but stateless: records live in
// Netlify Blobs instead of JSON files on disk, so the live site gets public
// rooms, quick match, leaderboards and the analytics funnel with zero extra
// hosting. The game client already targets same-origin `/companion-api/*`
// when it is not running on localhost, so no client changes are needed.
//
//   POST /companion-api/rooms          register/heartbeat a room
//   GET  /companion-api/rooms          public, open rooms
//   GET  /companion-api/rooms/:code    one room (gen/level/phase/players)
//   DELETE /companion-api/rooms/:code  close a room
//   POST /companion-api/scores         submit a time-trial time
//   GET  /companion-api/scores/:track?cc=1   top-10 board
//   POST /companion-api/track          funnel event counter
//   GET  /companion-api/track          funnel summary
//
// Rooms expire after 45s without a heartbeat (filtered on read).

import { getStore } from '@netlify/blobs';

const TTL = 45000;
const CODE_RE = /^[A-Z0-9]{4,6}$/;
const TRACK_RE = /^[a-z]{3,10}$/;
const EVENTS = new Set(['load', 'race_start', 'race_finish', 'room_create', 'room_join']);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const json = (status, body) => ({
  statusCode: status,
  headers: {
    ...CORS,
    'content-type': 'application/json',
    'cache-control': 'no-store',
  },
  body: JSON.stringify(body),
});

// Blobs can be unavailable (local preview, misconfigured site) - every store
// access degrades to an empty answer rather than a 500.
let storeWarned = false;
const store = (name) => {
  try {
    return getStore({ name, consistency: 'strong' });
  } catch (e) {
    if (!storeWarned) {
      console.warn('[companion] blobs unavailable:', e?.message || e);
      storeWarned = true;
    }
    return null;
  }
};

const readJson = async (st, key) => {
  if (!st) return null;
  try {
    return await st.get(key, { type: 'json' });
  } catch {
    return null;
  }
};

export default async (req) => {
  const url = new URL(req.url);
  // config.path = '/companion-api/*' strips that prefix from the pathname.
  const parts = url.pathname.replace(/^\/companion-api\/?/, '').split('/').filter(Boolean);
  const method = req.method;

  if (method === 'OPTIONS') return json(204, {});

  // ------------------------------------------------------------- rooms
  if (parts[0] === 'rooms' && parts.length === 1) {
    const st = store('raceoff-rooms');
    if (method === 'POST') {
      let msg = {};
      try {
        msg = JSON.parse(await req.text());
      } catch { /* fall through to validation */ }
      const code = String(msg.code || '').toUpperCase();
      if (!CODE_RE.test(code)) return json(400, { error: 'bad code' });
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
      room.open = room.phase === 'lobby' && room.players < 6;
      if (st) {
        try {
          await st.set(code, room);
        } catch { /* best effort */ }
      }
      return json(200, { ok: true, gen: room.gen });
    }
    // GET: list public open rooms
    const now = Date.now();
    const list = [];
    if (st) {
      try {
        const res = await st.list();
        for (const b of (res?.blobs || []).slice(0, 100)) {
          const r = await readJson(st, b.key);
          if (r && r.public && r.open && now - (r.ts || 0) < TTL) {
            list.push({
              code: r.code, gen: r.gen, level: r.level,
              phase: r.phase, players: r.players, name: r.name,
            });
          }
        }
      } catch { /* empty list */ }
    }
    list.sort((a, b) => b.players - a.players);
    return json(200, { rooms: list.slice(0, 24) });
  }

  if (parts[0] === 'rooms' && parts.length === 2) {
    const code = String(parts[1] || '').toUpperCase();
    if (!CODE_RE.test(code)) return json(400, { error: 'bad code' });
    const st = store('raceoff-rooms');
    if (method === 'DELETE') {
      if (st) {
        try {
          await st.delete(code);
        } catch { /* best effort */ }
      }
      return json(200, { ok: true });
    }
    const room = await readJson(st, code);
    if (!room || Date.now() - (room.ts || 0) >= TTL) {
      return json(404, { error: 'no room' });
    }
    return json(200, {
      code: room.code, gen: room.gen, level: room.level, phase: room.phase,
      players: room.players, open: room.open, public: room.public,
      age: Date.now() - room.ts,
    });
  }

  // ------------------------------------------------------------ scores
  if (parts[0] === 'scores' && parts.length === 1 && method === 'POST') {
    let msg = {};
    try {
      msg = JSON.parse(await req.text());
    } catch { /* fall through */ }
    const trackName = String(msg.track || '');
    if (!TRACK_RE.test(trackName)) return json(400, { error: 'bad track' });
    const cc = [0.85, 1, 1.15].includes(msg.cc) ? msg.cc : 1;
    const time = +msg.time;
    if (!(Number.isFinite(time) && time > 1 && time < 1000000)) {
      return json(400, { error: 'bad time' });
    }
    const name = String(msg.name || 'GHOST').slice(0, 12) || 'GHOST';
    const key = `${trackName}:${cc}`;
    const st = store('raceoff-scores');
    let list = (await readJson(st, key)) || [];
    list = list.filter(
      (e) => !(e.name === name && Math.round(e.time * 100) === Math.round(time * 100)),
    );
    const entry = { name, time: Math.round(time * 100) / 100, ts: Date.now() };
    list.push(entry);
    list.sort((a, b) => a.time - b.time);
    const top = list.slice(0, 10);
    if (st) {
      try {
        await st.setJSON(key, top);
      } catch {
        try {
          await st.set(key, top);
        } catch { /* best effort */ }
      }
    }
    const rank = top.findIndex((e) => e.ts === entry.ts) + 1;
    return json(200, { ok: true, rank: rank >= 1 && rank <= 10 ? rank : 0, top });
  }

  if (parts[0] === 'scores' && parts.length === 2) {
    const trackName = String(parts[1] || '');
    if (!TRACK_RE.test(trackName)) return json(400, { error: 'bad track' });
    const ccQ = parseFloat(url.searchParams.get('cc'));
    const cc = [0.85, 1, 1.15].includes(ccQ) ? ccQ : 1;
    const top = (await readJson(store('raceoff-scores'), `${trackName}:${cc}`)) || [];
    return json(200, { track: trackName, cc, top });
  }

  // ------------------------------------------------------------- funnel
  if (parts[0] === 'track' && parts.length === 1) {
    const st = store('raceoff-funnel');
    const data = (await readJson(st, 'counts')) || {
      counts: { load: 0, race_start: 0, race_finish: 0, room_create: 0, room_join: 0 },
      byTrack: {},
    };
    if (method === 'GET') return json(200, data);
    let msg = {};
    try {
      msg = JSON.parse(await req.text());
    } catch { /* fall through */ }
    const ev = String(msg.event || '');
    if (!EVENTS.has(ev)) return json(400, { error: 'bad event' });
    data.counts[ev] = (data.counts[ev] || 0) + 1;
    const trackName = typeof msg.track === 'string' ? msg.track.slice(0, 10) : '';
    if (trackName) {
      data.byTrack[ev] = data.byTrack[ev] || {};
      data.byTrack[ev][trackName] = (data.byTrack[ev][trackName] || 0) + 1;
    }
    if (st) {
      try {
        await st.setJSON('counts', data);
      } catch {
        try {
          await st.set('counts', data);
        } catch { /* best effort */ }
      }
    }
    return json(204, {});
  }

  return json(404, { error: 'not found' });
};

export const config = {
  path: '/companion-api/*',
};
