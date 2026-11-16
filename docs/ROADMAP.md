# Race-Off — Roadmap

Where the game is today: six tracks, six racers, items, drift/turbo physics,
Grand Prix + Time Trial + Daily Challenge, online multiplayer with public
rooms / quick match / spectators / emotes, per-track leaderboards, share
cards, PWA install, quality tiers, remappable keys and a first-party
analytics funnel — all deployed at
<https://race-off-lnrowm.netlify.app>.

The next phase is about **depth and retention**: more ways to play, more
reason to come back, and smoother community features.

---

## Phase 6 — Game modes & depth

1. **Battle mode** ✅ *(shipped: Balloon Brawl arena — pick BATTLE on the
   track picker; 3 balloons each, item hits pop them, last kart standing /
   most balloons at time-up wins, battle results variant, board balloon
   pips, rematch flow. Also fixed a port bug where the item roulette shared
   the kart's visual-lean field, handing out free items on lean crossings.)*
   Still open: coin-rush variant, more arenas.
2. **Elimination race** — every 20 seconds the last-place kart explodes
   (bowser-fire style banner + boom SFX). Great with 6-player online lobbies.
3. **Team race** — 3v3 with team colours on karts and a combined team score
   in the results panel. Pairs naturally with the public room list
   (`team: true` room flag).
4. **Ghost championships** — the daily challenge keeps your best ghost;
   race *your own* ghost head-to-head on every track, not just time trial.
5. **More tracks** — a night neon circuit (emissive materials + headlight
   cones) and a swamp track with slow-puddle physics zones (a new surface
   flag in the physics module).

## Phase 7 — Progression & meta

1. **XP + levels** — earn XP per race (placement, laps led, drifts); levels
   unlock kart liveries, trails and horn sounds. Local-first, syncs later.
2. **Career board** — a persistent stats page (races, wins, win rate, favourite
   track, total playtime) rendered into the menus and the share card.
3. **Achievements** — 20-ish badges ("First win", "Clean sweep: win every
   track", "Ghost buster: beat your daily ghost", "Full lobby: race with 5
   humans") with toast popups, stored in `ro-unlocks`.
4. **Weekly rotations** — the daily challenge gains a weekly GP: a fixed
   3-track cup whose seed rotates Mondays; results feed a weekly leaderboard.
5. **Custom racer names online** — the lobby name field already exists; add
   profile persistence + an avatar chip in the results board.

## Phase 8 — Social & community

1. **Friend links** — a per-player share link that opens a direct room invite
   with a name pre-filled (`?room=CODE&n=NAME`), plus a recent-players list.
2. **Spectator chat / quick reactions** — extend the emote wheel with
   spectator-visible reactions and a tiny canned chat (8 preset lines).
3. **Tournaments** — the companion server gains a `/tournaments` API: a room
   owner creates a 8-player bracket, the server tracks results, and a public
   bracket page renders on the site.
4. **Live leaderboard pages** — server-rendered HTML pages for each track's
   top times (SEO-friendly, shareable), generated from the Blobs store.
5. **Clubs** — persistent named groups with a tag shown next to names in
   lobbies and results; stored server-side, joined by invite code.

## Phase 9 — Polish & reach

1. **Replay system** — record input streams locally (already half-built via
   the ghost) and play back full races with a scrub bar and free camera.
2. **Track editor** — a lightweight spline editor that exports track
   definitions; share tracks via URL hash (the daily challenge already
   proves the format works).
3. **Gamepad rumble + adaptive triggers** where supported.
4. **Localisations** — the UI strings are centralised enough to extract;
   ship EN + DE + ES + PT-BR first.
5. **App stores** — wrap the PWA with TWA (Android) and Capacitor (iOS) for
   store presence; the offline support is already there.

## Engineering backlog (continuous)

- **Companion v2**: swap in-memory Blobs rooms for per-key room records with
  server-side TTL sweep, and add rate limiting on `/scores` and `/track`.
- **Netcode**: input-delay netcode option for 2-player duels (rollback is
  overkill at 6 players, but a 1v1 mode could use it).
- **CI**: add the multiplayer battery as a required check once it proves
  stable in CI runners (currently `continue-on-error`).
- **Analytics**: per-track funnel breakdown dashboard page fed by the
  `/companion-api/track` endpoint.
- **Performance budget**: keep the main bundle under ~250 KB gzipped; the
  Three.js chunk dominates (248 KB) — consider code-splitting track meshes.

## Known cosmetic debt

- The beach leaderboard carries one test entry (`ME 88.5`) from an API probe;
  harmless, will age out when boards are rebuilt.
- Analytics counters include a handful of probe events from testing.
- The old anonymous Netlify drop (`admirable-cupcake-5920d0`) can be deleted
  from the Netlify dashboard.
