// Race-Off - daily challenge.
// One seeded race per day: the date picks the track, engine class and mirror
// flag, and seeds the item roulette. No backend - results are shared as a URL
// hash (#daily=<seconds>) and compared locally.

import { TRACK_ORDER } from '../tracks/definitions.js';
import { mulberry32 } from './utils.js';

/** FNV-1a over the UTC date, e.g. "2026-11-11". */
function dateHash(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Today's daily challenge: deterministic from the UTC date. */
export function dailyConfig(date = new Date()) {
  const key =
    date.getUTCFullYear() + '-' + (date.getUTCMonth() + 1) + '-' + date.getUTCDate();
  const h = dateHash(key);
  const track = TRACK_ORDER[h % TRACK_ORDER.length];
  const cc = [1, 0.85, 1.15][h % 3];
  const mirror = !!(h & 64);
  return { key, seed: h, track, cc, mirror };
}

const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null');
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch { /* private mode */ }
  },
};

/** The attempt for a day: { time } when finished, { started: true } when the
 *  attempt was consumed, or null when today's daily is still available. */
export function dailyResult(key) {
  return store.get('ro-daily-' + key);
}

/** Consume today's attempt (called when the daily race starts). */
export function dailySaveStarted(key) {
  if (!store.get('ro-daily-' + key)) store.set('ro-daily-' + key, { started: true });
}

export function dailySave(key, time) {
  store.set('ro-daily-' + key, { time: +time.toFixed(3) });
}

/** Streak of consecutive completed days, ending today (or yesterday). */
export function dailyStreak() {
  let streak = 0;
  const day = 86400000;
  for (let i = 0; i < 60; i++) {
    const d = dailyConfig(new Date(Date.now() - i * day));
    if (dailyResult(d.key)) streak++;
    else if (i > 0) break;
  }
  return streak;
}

/** Build the seeded RNG for today's challenge. */
export function dailyRng(seed) {
  return mulberry32(seed);
}

/** A friend's time from the URL hash (#daily=<seconds>), if present. */
export function dailyFriendTime() {
  const m = /#daily=([0-9.]+)/.exec(location.hash || '');
  if (!m) return null;
  const t = parseFloat(m[1]);
  return Number.isFinite(t) && t > 1 && t < 100000 ? t : null;
}
