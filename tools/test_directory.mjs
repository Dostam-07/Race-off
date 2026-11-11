import { chromium } from 'playwright';
import { spawn } from 'child_process';

const PORT = 8790;
const DIR = 'http://localhost:' + PORT;

// --- 0. boot the companion directory
const server = spawn(process.execPath, ['companion/server.mjs'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
server.stdout.on('data', (d) => (serverOut += d));
server.stderr.on('data', (d) => (serverOut += d));
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try {
    const res = await fetch(DIR + '/rooms');
    if (res.ok) break;
  } catch { /* not up yet */ }
}
console.log('server:', serverOut.trim());

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const mk = async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : console.log('  [err]', e.message));
  return page;
};

// --- 1. host a PUBLIC room; the directory must list it
const host = await mk();
await host.goto('http://localhost:5173/?dir=' + DIR, { waitUntil: 'load' });
await host.waitForTimeout(7000);
await host.evaluate(() => {
  window.game.renderer.render = () => {};
  window.game.startMultiplayer(true); // public
});
await host.waitForTimeout(6500);
const code = await host.evaluate(() => window.game.mp?.code);
let listed = null;
for (let i = 0; i < 15; i++) {
  await host.waitForTimeout(1000);
  const res = await fetch(DIR + '/rooms');
  const data = await res.json();
  listed = data.rooms.find((r) => r.code === code) || null;
  if (listed) break;
}
console.log('listed:', JSON.stringify(listed));

// --- 2. quick match from a fresh page joins that room
const qm = await mk();
await qm.goto('http://localhost:5173/?dir=' + DIR, { waitUntil: 'load' });
await qm.waitForTimeout(7000);
await qm.evaluate(() => {
  window.game.renderer.render = () => {};
  window.game.quickMatch();
});
let qmJoined = false;
for (let i = 0; i < 25; i++) {
  await qm.waitForTimeout(1000);
  qmJoined = await qm.evaluate((c) => window.game.mp?.code === c && window.game.mp?.status === 'joined', code);
  if (qmJoined) break;
}
console.log('quick match joined:', qmJoined);

// --- 3. host migration: kill the host tab, the guest promotes (30s reconnect
//        grace by design), the directory points at the new generation, and a
//        fresh joiner finds it fast
await host.close();
await qm.waitForTimeout(62000); // 25s lobby timeout + 30s promotion grace
const newGen = await qm.evaluate(() => window.game.mp?.gen);
console.log('promoted guest gen:', newGen);
let dirGen = -1;
for (let i = 0; i < 15; i++) {
  await qm.waitForTimeout(1000);
  const res = await fetch(DIR + '/rooms/' + code);
  if (res.ok) {
    const r = await res.json();
    dirGen = r.gen;
    if (r.gen === newGen) break;
  }
}
console.log('directory gen after migration:', dirGen);

const late = await mk();
const t0 = Date.now();
await late.goto('http://localhost:5173/?room=' + code + '&dir=' + DIR, { waitUntil: 'load' });
await late.waitForTimeout(9000);
await late.evaluate(() => {
  window.game.renderer.render = () => {};
});
let lateJoined = false;
for (let i = 0; i < 20; i++) {
  await late.waitForTimeout(1000);
  lateJoined = await late.evaluate((c) => window.game.mp?.code === c && window.game.mp?.status === 'joined', code);
  if (lateJoined) break;
}
console.log('late joiner joined migrated room in', ((Date.now() - t0) / 1000).toFixed(1) + 's:', lateJoined);

// --- 4. the directory going away must not break anything
server.kill();
await new Promise((r) => setTimeout(r, 500));
const fallback = await late.evaluate(async () => {
  const { dirList } = await import('/src/net/directory.js');
  const list = await dirList();
  return { list: JSON.stringify(list), base: location.search.includes('dir=') };
});
console.log('directory down -> graceful:', JSON.stringify(fallback));

const ok =
  !!listed && listed.players >= 1 &&
  qmJoined &&
  dirGen === newGen &&
  lateJoined &&
  fallback.list === '[]';
console.log(ok ? 'DIRECTORY OK' : 'DIRECTORY FAILED');
await browser.close();
process.exit(ok ? 0 : 1);

