import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push('ERR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
await page.evaluate(() => {
  const g = window.game;
  g.stop();
  window.__t = performance.now();
  window.__step = (n) => { for (let i = 0; i < n; i++) { window.__t += 1000 / 60; g.tick(window.__t); } };
});
const a = await page.evaluate(() => {
  document.getElementById('m-solo').click();
  document.querySelector('#levels .lvl[data-l="beach"]').click();
  document.getElementById('m-go').click();
  const g = window.game;
  return {
    state: g.state, hasPlayer: !!g.player, karts: g.karts.length,
    mode: g.menus.mode, track: g.track?.def?.id,
  };
});
console.log('after clicks', JSON.stringify(a));
const b = await page.evaluate(() => {
  window.game.input.keys.add('ArrowUp');
  window.__step(5);
  const g = window.game;
  return { state: g.state, hasPlayer: !!g.player, st: +g.st.toFixed(2) };
});
console.log('after 5 steps', JSON.stringify(b));
console.log('ERR', errs.join('\n'));
await browser.close();
