import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : errs.push('ERR ' + e.message + ' @' + (e.stack || '').split('\n')[1]));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);

await page.evaluate(() => {
  const g = window.game;
  g.stop();
  window.__realRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = () => {};
  window.__t = performance.now();
  window.__step = (n) => { for (let i = 0; i < n; i++) { window.__t += 1000 / 60; g.tick(window.__t); } };
  window.__shot = () => { window.__realRender(g.scene, g.camera); window.__realRender(g.scene, g.camera); };
});

await page.evaluate(() => {
  document.getElementById('m-solo').click();
  document.querySelector('#levels .lvl[data-l="beach"]')?.click();
  document.getElementById('m-go')?.click();
  window.game.input.keys.add('ArrowUp');
  window.__step(560);
});

const laps = await page.evaluate(() => {
  const g = window.game;
  const p = g.player;
  const out = [];
  for (let i = 0; i < 4; i++) {
    p.lap = i + 1;
    g.onLap(p);
    window.__step(2);
    out.push({ lap: p.lap, fin: p.finished, state: g.state });
  }
  return out;
});
console.log('laps', JSON.stringify(laps));

await page.evaluate(() => window.__step(260));
const after = await page.evaluate(() => ({
  state: window.game.state,
  resultsOn: document.getElementById('results')?.classList.contains('on'),
  text: (document.getElementById('results')?.textContent || '').replace(/\s+/g, ' ').slice(0, 240),
}));
console.log('after', JSON.stringify(after));
await page.evaluate(() => window.__shot());
await page.screenshot({ path: 'tools/results.png', timeout: 60000 });
console.log('ERRORS', errs.slice(0, 6).join('\n'));
await browser.close();

