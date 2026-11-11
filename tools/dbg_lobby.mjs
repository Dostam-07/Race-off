import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(7000);
await page.evaluate(() => {
  const g = window.game;
  g.stop();
  g.renderer.render = () => {};
  g.startMultiplayer();
});
await page.waitForTimeout(8000);
await page.evaluate(() => {
  const mp = window.game.mp;
  mp.players = [
    ...mp.players,
    { pid: 'fake-guest', name: 'Luna', racer: 1, host: false, waiting: false },
  ];
  window.game.renderLobby();
});
await page.waitForTimeout(500);

const audit = await page.evaluate(() => {
  const vis = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      text: (el.textContent || '').slice(0, 40),
    };
  };
  const rows = [...document.querySelectorAll('#l-players .lp')].map((el) => {
    const r = el.getBoundingClientRect();
    return { text: el.textContent, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
  });
  return {
    bodyClass: document.body.className,
    lobby: vis('#lobby'),
    code: vis('#l-code'),
    status: vis('#l-status'),
    start: vis('#l-start'),
    invite: vis('#l-invite'),
    leave: vis('#l-leave'),
    name: vis('#l-name'),
    rows,
  };
});
console.log(JSON.stringify(audit, null, 1));
await browser.close();
