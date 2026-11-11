// Race-Off - per-track time-trial leaderboards.
//
// Times are submitted to the companion directory (`companion/server.mjs`,
// POST /scores) and the top-10 board is fetched from it. A local mirror in
// localStorage keeps the board working when the companion is not running
// (offline, self-hosted without the server) - the two lists are merged and
// deduped by time+name.

import { dirBase } from './directory.js';

const LS_KEY = 'ro-scores';
const CC_KEY = (cc) => (cc === 0.85 ? '50' : cc === 1.15 ? '150' : '100');

const readLocal = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY)) || {};
  } catch {
    return {};
  }
};

const writeLocal = (all) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch { /* private mode - memory only */ }
};

const key = (track, cc) => `${track}:${CC_KEY(cc)}`;

const cleanName = (n) =>
  String(n || 'GHOST')
    .toUpperCase()
    .replace(/[^A-Z0-9 _.-]/g, '')
    .trim()
    .slice(0, 12) || 'GHOST';

/** Submit a time-trial result. Returns the local rank (1-based) or 0. */
export function submitScore(track, cc, time, name) {
  if (!Number.isFinite(time) || time <= 1) return 0;
  const all = readLocal();
  const k = key(track, cc);
  const list = all[k] || [];
  const entry = { name: cleanName(name), time: Math.round(time * 100) / 100, ts: Date.now() };
  list.push(entry);
  list.sort((a, b) => a.time - b.time);
  all[k] = list.slice(0, 10);
  writeLocal(all);
  const rank = all[k].indexOf(entry) + 1;
  // Fire-and-forget to the companion when it is reachable.
  const base = dirBase();
  if (base) {
    void fetch(base + '/scores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track, cc, name: entry.name, time: entry.time }),
    }).catch(() => { /* companion down - local board still works */ });
  }
  return rank <= 10 ? rank : 0;
}

/** The merged top-10 board for a track+class (remote when available + local). */
export async function fetchScores(track, cc) {
  const k = key(track, cc);
  const local = (readLocal()[k] || []).slice();
  let remote = [];
  const base = dirBase();
  if (base) {
    try {
      const res = await fetch(
        `${base}/scores/${encodeURIComponent(track)}?cc=${cc}`,
        { signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined },
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.top)) remote = data.top;
      }
    } catch { /* companion down */ }
  }
  const seen = new Set();
  const merged = [];
  for (const e of [...remote, ...local]) {
    const id = `${e.name}|${Math.round(e.time * 100)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push({ name: cleanName(e.name), time: +e.time });
  }
  merged.sort((a, b) => a.time - b.time);
  return merged.slice(0, 10);
}

/** Clear the local mirror (used by tests). */
export function clearScores() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch { /* ignore */ }
}
