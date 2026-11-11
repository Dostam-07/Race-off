// Race-Off - client for the companion directory (companion/server.mjs).
//
// The directory is optional: everything degrades gracefully when it is not
// running. It gives us three things the pure PeerJS layer cannot do:
//   1. room lookup across host migrations (which generation is live right now)
//   2. a public room list for the "find a race" panel
//   3. quick match: join the first open public room, or host one
//
// Base URL resolution: `?dir=URL` wins, then same-origin `/companion-api`
// (a reverse proxy), then http://localhost:8785 while on localhost.

const TTL_MS = 45000;

let base = null;
let probed = false;
let dead = false; // endpoint unreachable - stop asking this session

const isLocal = () =>
  ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** Resolve the directory base URL once; null when no directory is available. */
export function dirBase() {
  if (probed) return base;
  probed = true;
  try {
    const p = new URLSearchParams(location.search);
    const q = p.get('dir');
    if (q) {
      base = q.replace(/\/$/, '');
      return base;
    }
  } catch { /* no URLSearchParams */ }
  base = isLocal() ? 'http://localhost:8785' : '';
  return base;
}

/** True when a directory is configured (probes lazily). */
export function dirAvailable() {
  return !!dirBase();
}

const req = async (path, opts = {}) => {
  const b = dirBase();
  if (!b || dead) return null;
  try {
    const res = await fetch(b + path, {
      ...opts,
      headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
      signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    dead = true; // network error (not a 404): the directory is not there
    return null;
  }
};

/** Publish/heartbeat the room I am hosting. Fire and forget. */
export function dirPublish(room) {
  if (!room || !room.isHost) return;
  void req('/rooms', {
    method: 'POST',
    body: JSON.stringify({
      code: room.code,
      gen: room.gen,
      level: room.level,
      phase: room.phase,
      players: room.players ? room.players.length : 1,
      name: room.me?.name || '',
      public: room.isPublic,
    }),
  });
}

/** Take the room down when the host leaves cleanly. */
export function dirClose(code) {
  if (!code) return;
  void req('/rooms/' + encodeURIComponent(code), { method: 'DELETE' });
}

/** Where is this room now? Returns { gen, level, phase, players } or null. */
export function dirLookup(code) {
  return req('/rooms/' + encodeURIComponent(code));
}

/** List public open rooms. Returns [] when the directory is unreachable. */
export async function dirList() {
  const res = await req('/rooms');
  return res && Array.isArray(res.rooms) ? res.rooms : [];
}

/** Quick match: pick the fullest open public room (ties -> newest). */
export async function dirQuick() {
  const list = await dirList();
  return list.length ? list[0] : null;
}
