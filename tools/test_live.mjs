import { chromium } from 'playwright';

const LIVE = 'https://race-off-lnrowm.netlify.app';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => {
  const m = e.message || '';
  if (!m.includes('ERR_CONNECTION_REFUSED')) errs.push(m);
});
page.on('console', (c) => {
  if (c.type() === 'error' && !(c.text() || '').includes('ERR_CONNECTION_REFUSED')) {
    errs.push(c.text());
  }
});

// --- 1. the deployed page boots clean
await page.goto(LIVE + '/', { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(9000);
const boot = await page.evaluate(() => ({
  booted: !!window.game,
  title: !!document.querySelector('#title, .title, #m-title'),
  sw: 'serviceWorker' in navigator,
}));
console.log('boot:', JSON.stringify(boot));

// --- 2. the title screen's room list is served by the companion function
//        (refreshRooms runs on showModes and every 6s after that)
await page.waitForSelector('#title.on', { timeout: 30000 });
await page.waitForTimeout(1500);

// --- 3. a public room registered on the server shows up in the client list
await fetch(LIVE + '/companion-api/rooms', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: 'LIV3', gen: 0, level: 'beach', phase: 'lobby', players: 3, name: 'HOST', public: true }),
});
let listed = [];
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(1500);
  listed = await page.evaluate(() =>
    [...document.querySelectorAll('#roomlist .rl')].map((n) => n.textContent),
  );
  if (listed.some((t) => t.includes('LIV3'))) break;
}
console.log('rooms seen by client:', JSON.stringify(listed));

// --- 4. funnel: a real UI action (create room) reaches the counter
const c0 = (await (await fetch(LIVE + '/companion-api/track')).json()).counts;
await page.evaluate(() => document.getElementById('mp-new')?.click());
await page.waitForTimeout(2500);
const counts = await (await fetch(LIVE + '/companion-api/track')).json();
console.log('counts:', JSON.stringify(counts.counts));

const okAll =
  boot.booted &&
  listed.some((t) => t.includes('LIV3')) &&
  counts.counts.room_create > (c0.room_create || 0) &&
  errs.length === 0;
console.log('errors:', JSON.stringify(errs.slice(0, 3)));
console.log(okAll ? 'LIVE OK' : 'LIVE FAILED');
await browser.close();
process.exit(okAll ? 0 : 1);
