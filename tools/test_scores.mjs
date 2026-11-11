import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { rmSync } from 'fs';

const PORT = 8792;
const DIR = 'http://localhost:' + PORT;

// --- boot the companion (scores live on the same server as the directory)
try {
  rmSync('companion/scores.json', { force: true }); // fresh board every run
} catch { /* ignore */ }
const server = spawn(process.execPath, ['companion/server.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try { if ((await fetch(DIR + '/rooms')).ok) break; } catch { /* booting */ }
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('  [err]', e.message));
await page.goto('http://localhost:5173/?dir=' + DIR, { waitUntil: 'load' });
await page.waitForTimeout(7000);

// --- 1. direct API: submit three times, board must sort them
const api = await page.evaluate(async (dir) => {
  localStorage.removeItem('ro-scores');
  const post = (t, cc, name, time) =>
    fetch(dir + '/scores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: t, cc, name, time }),
    }).then((r) => r.json());
  const a = await post('volcano', 1, 'AAA', 100);
  const b = await post('volcano', 1, 'BBB', 90);
  const c = await post('volcano', 1, 'CCC', 120);
  const board = await fetch(dir + '/scores/volcano?cc=1').then((r) => r.json());
  return {
    rankB: b.rank,
    top: board.top.map((e) => e.name + ':' + e.time),
  };
}, DIR);
console.log('api:', JSON.stringify(api));

// --- 2. client module: submitScore + fetchScores merge with the local mirror
const client = await page.evaluate(async (dir) => {
  const { submitScore, fetchScores } = await import('/src/net/scores.js');
  const r1 = submitScore('volcano', 1, 95, 'ME'); // beats AAA, loses to BBB
  const top = await fetchScores('volcano', 1);
  return { rank: r1, names: top.map((e) => e.name), times: top.map((e) => e.time) };
}, DIR);
console.log('client:', JSON.stringify(client));

// --- 3. full game flow: finish a time trial -> board appears in the results
await page.evaluate(() => {
  const g = window.game;
  g.stop();
  g.renderer.render = () => {};
  window.__t = performance.now();
  window.step = (n) => {
    for (let i = 0; i < n; i++) {
      window.__t += 1000 / 60;
      g.tick(window.__t);
    }
  };
  g.input.applyTo = () => {};
  g.startTimeTrial('volcano');
});
await page.evaluate(() => window.step(430));
await page.evaluate(() => {
  const g = window.game;
  g.player.lap = 4;
  g.onLap(g.player);
});
await page.evaluate(() => window.step(280));
let boardShown = false;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1000);
  boardShown = await page.evaluate(() => {
    const rows = document.querySelectorAll('#lboard-body .lb-r');
    return document.getElementById('lboard') && rows.length >= 3;
  });
  if (boardShown) break;
}
const boardText = await page.evaluate(() => document.getElementById('lboard-body')?.textContent || '');
console.log('board in results:', boardShown, JSON.stringify(boardText.slice(0, 80)));

// --- 4. companion down -> local board still works
server.kill();
await new Promise((r) => setTimeout(r, 400));
const offline = await page.evaluate(async () => {
  const { fetchScores } = await import('/src/net/scores.js');
  const top = await fetchScores('volcano', 1);
  return top.length;
});
console.log('offline board entries:', offline);

const ok =
  api.rankB === 1 &&
  api.top.length === 3 && api.top[0] === 'BBB:90' &&
  client.names[0] === 'BBB' && client.names[1] === 'ME' &&
  boardShown && boardText.includes('ME') &&
  offline >= 2;
console.log(ok ? 'SCORES OK' : 'SCORES FAILED');
await browser.close();
process.exit(ok ? 0 : 1);
