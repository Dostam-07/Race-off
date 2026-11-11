// Race-Off - entry point.
//
// Boots the game, wires the loading bar, then hands control to the state
// machine in Game.js.

import './styles/game.css';
import { Game } from './core/Game.js';
import { installRaceFlow } from './core/raceFlow.js';
import { installLoop } from './core/loop.js';
import { installMultiplayer } from './net/Multiplayer.js';

installRaceFlow(Game);
installLoop(Game);
installMultiplayer(Game);

const bar = document.getElementById('bar');
const label = document.getElementById('loadlabel');
const splash = document.getElementById('loading');

function fail(err) {
  console.error(err);
  if (label) label.textContent = 'Error: ' + (err?.message || err);
}

async function main() {
  const params = new URLSearchParams(location.search);
  const quality = params.get('lite') !== null ? 'low' : 'high';

  const game = new Game(document.body, { quality });
  window.game = game;

  // loadModels reports a 0..1 fraction; show it as a clean percentage.
  await game.boot((fraction) => {
    const pct = Math.max(0, Math.min(100, Math.round((fraction || 0) * 100)));
    if (bar) bar.style.width = pct + '%';
    if (label) label.textContent = pct < 100 ? 'Loading ' + pct + '%' : 'Starting…';
  });

  splash?.classList.remove('on');
  setTimeout(() => splash?.remove(), 700);

  game.start();
  game.resize();
  game.resize();

  // PWA: installable + playable offline after the first visit. The service
  // worker caches static assets at runtime (stale-while-revalidate).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* dev or blocked */ });
  }
}

main().catch(fail);
