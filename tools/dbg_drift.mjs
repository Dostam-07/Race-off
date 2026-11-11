import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push('ERR ' + e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
await page.evaluate(() => {
  const g = window.game;
  g.stop();
  window.__t = performance.now();
  window.__step = (n) => { for (let i = 0; i < n; i++) { window.__t += 1000 / 60; g.tick(window.__t); } };
});
await page.evaluate(() => {
  document.getElementById('m-solo').click();
  document.querySelector('#levels .lvl[data-l="beach"]').click();
  document.getElementById('m-go').click();
  window.game.input.keys.add('ArrowUp');
  window.__step(430);
});
const trace = await page.evaluate(() => {
  const g = window.game;
  const p = g.player;
  p.speed = 26;
  for (let i = 0; i < 120 && !p.onGround; i++) window.__step(1);
  const before = { speed: p.speed, onGround: p.onGround, inp: { ...p.input } };
  g.input.keys.add('ArrowLeft');
  g.input.keys.add(' ');
  g.input.pressed.add(' ');
  const frames = [];
  for (let i = 0; i < 6; i++) {
    window.__step(1);
    frames.push({
      inp: { steer: p.input.steer, drift: p.input.drift, dp: p.input.driftPressed, turbo: p.input.turbo },
      kart: { drifting: p.drifting, onGround: p.onGround, hopT: p.hopT, vy: +p.vy.toFixed(2) },
    });
  }
  return { before, frames, keys: [...g.input.keys], pressed: [...g.input.pressed] };
});
console.log(JSON.stringify(trace, null, 1));
console.log('ERR', errs.join('\n'));
await browser.close();
