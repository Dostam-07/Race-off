import { chromium } from 'playwright';
import { spawn } from 'child_process';

const PORT = 8793;
const DIR = 'http://localhost:' + PORT;

// Companion server doubles as the analytics collector.
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
await page.goto('http://localhost:5173/?analytics=' + DIR, { waitUntil: 'load' });
await page.waitForTimeout(7000);

// --- 1. load event reached the endpoint
let summary = await (await fetch(DIR + '/track')).json();
console.log('after load:', JSON.stringify(summary.counts));

// --- 2. run a race: race_start + race_finish must arrive
await page.evaluate(() => {
  const g = window.game;
  g.stop();
  g.renderer.render = () => {};
  window.__t = performance.now();
  window.step = (n) => { for (let i = 0; i < n; i++) { window.__t += 1000 / 60; g.tick(window.__t); } };
  g.input.applyTo = () => {};
  g.startSolo('volcano');
});
await page.evaluate(() => window.step(430));
await page.evaluate(() => {
  const g = window.game;
  g.player.lap = 4;
  g.onLap(g.player);
});
await page.evaluate(() => window.step(280));
await page.waitForTimeout(1500); // beacon flush
summary = await (await fetch(DIR + '/track')).json();
console.log('after race:', JSON.stringify(summary.counts), 'volcano starts:', summary.byTrack.race_start?.volcano);

// --- 3. local mirror + window.__funnel
const local = await page.evaluate(() => ({
  mirror: JSON.parse(localStorage.getItem('ro-funnel') || '[]').map((e) => e.event),
  live: window.__funnel ? window.__funnel.map((e) => e.event) : null,
}));
console.log('local funnel:', JSON.stringify(local));

// --- 4. create a room -> room_create
await page.evaluate(() => window.game.toTitle());
await page.waitForTimeout(1500);
await page.evaluate(() => {
  window.game.renderer.render = () => {};
  window.game.startMultiplayer();
});
await page.waitForTimeout(3000);
await page.evaluate(() => window.game.mp?.leave());
await page.waitForTimeout(800);
summary = await (await fetch(DIR + '/track')).json();
console.log('after room:', JSON.stringify(summary.counts));

// --- 5. no endpoint configured -> nothing leaves the page, local only
const p2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await p2.goto('http://localhost:5173/', { waitUntil: 'load' });
await p2.waitForTimeout(6000);
const quiet = await p2.evaluate(() => {
  const mirror = JSON.parse(localStorage.getItem('ro-funnel') || '[]').map((e) => e.event);
  return { mirror, hasLoad: mirror.includes('load') };
});
console.log('no-endpoint page:', JSON.stringify(quiet));

const ok =
  summary.counts.load >= 1 && // the no-endpoint page correctly stays local
  summary.counts.race_start >= 1 &&
  summary.counts.race_finish >= 1 &&
  summary.counts.room_create >= 1 &&
  summary.byTrack.race_start?.volcano >= 1 &&
  local.mirror.includes('load') && local.mirror.includes('race_start') && local.mirror.includes('race_finish') &&
  quiet.hasLoad;
console.log(ok ? 'ANALYTICS OK' : 'ANALYTICS FAILED');
await browser.close();
server.kill();
process.exit(ok ? 0 : 1);
