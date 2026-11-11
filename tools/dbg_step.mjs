import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push('ERR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
const res = await page.evaluate(() => {
  const g = window.game;
  g.stop();
  g.renderer.render = () => {};
  let t0 = performance.now();
  const step = (n) => { for (let i = 0; i < n; i++) { t0 += 1000 / 60; g.tick(t0); } };
  document.getElementById('m-solo').click();
  document.querySelector('#levels .lvl[data-l="beach"]').click();
  document.getElementById('m-go').click();
  g.input.keys.add('ArrowUp');
  const log = [];
  try {
    for (let i = 0; i < 430; i++) {
      step(1);
      if (!g.player) { log.push('LOST PLAYER at step ' + i + ' state ' + g.state); break; }
    }
  } catch (e) {
    log.push('THROW at step: ' + e.message);
  }
  return { log, state: g.state, hasPlayer: !!g.player, st: +g.st.toFixed(2) };
});
console.log(JSON.stringify(res, null, 1));
console.log('ERR', errs.join('\n'));
await browser.close();
