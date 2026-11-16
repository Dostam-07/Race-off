// Race-Off - privacy-safe funnel analytics.
//
// Tracks four funnel steps so we know where players drop off:
//   loaded -> race_start -> race_finish -> room_create
//
// Design rules:
//   - no cookies, no fingerprints, no third-party scripts, no PII
//   - events go to ONE self-hosted endpoint when configured (via
//     `?analytics=URL` or /companion-api on the same origin), else they are
//     only kept locally (localStorage `ro-funnel`, capped) for inspection
//   - delivery is fire-and-forget with sendBeacon/keepalive; failures are
//     silently ignored - analytics must never affect gameplay
//
// Inspect the local funnel: `JSON.parse(localStorage['ro-funnel'])`
// or `window.__funnel` in the console.

const LS_KEY = 'ro-funnel';
const MAX_LOCAL = 200;

let endpoint = null;
let resolved = false;

/** Where do events go? Same-origin proxy, explicit URL, or nowhere. */
function resolveEndpoint() {
  if (resolved) return endpoint;
  resolved = true;
  try {
    const q = new URLSearchParams(location.search).get('analytics');
    if (q) endpoint = q.replace(/\/$/, '');
    else if (!['localhost', '127.0.0.1'].includes(location.hostname)) {
      // Deployed: a reverse proxy may expose the companion at /companion-api.
      endpoint = '/companion-api';
    }
    // Localhost without ?analytics=: local-only (no accidental dev spam).
  } catch { /* no URLSearchParams */ }
  return endpoint;
}

/** The funnel so far this session (also mirrored to localStorage). */
export const funnel = [];

// Console handle for quick inspection (documented in the header comment).
if (typeof window !== 'undefined') window.__funnel = funnel;

/** Record one funnel step. `props` must be small and non-identifying. */
export function track(event, props = {}) {
  const e = { event, t: Date.now(), ...props };
  funnel.push(e);
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY)) || [];
    all.push(e);
    localStorage.setItem(LS_KEY, JSON.stringify(all.slice(-MAX_LOCAL)));
  } catch { /* private mode - session memory only */ }

  const base = resolveEndpoint();
  if (!base) return;
  // text/plain keeps the request CORS-safelisted (no preflight) - the
  // companion parses the JSON body regardless of the content type.
  const body = JSON.stringify(e);
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(base + '/track', new Blob([body], { type: 'text/plain' }))) {
      return;
    }
  } catch { /* fall through */ }
  try {
    void fetch(base + '/track', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body,
      keepalive: true,
    }).catch(() => { /* endpoint down - ignore */ });
  } catch { /* ignore */ }
}

/** Funnel counts from the local log (oldest -> newest). */
export function funnelCounts() {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY)) || [];
    const c = { load: 0, race_start: 0, race_finish: 0, room_create: 0 };
    for (const e of all) if (e.event in c) c[e.event]++;
    return c;
  } catch {
    return { load: 0, race_start: 0, race_finish: 0, room_create: 0 };
  }
}

/** Clear the local funnel log (used by tests). */
export function clearFunnel() {
  funnel.length = 0;
  try {
    localStorage.removeItem(LS_KEY);
  } catch { /* ignore */ }
}
