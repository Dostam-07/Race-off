import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push('ERR ' + e.message + ' @' + (e.stack || '').split('\n')[1]));
page.on('console', (m) => { if (m.type() === 'error') errs.push('C ' + m.text()); });

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);

await page.evaluate(() => {
  const g = window.game;
  g.stop();
  window.__realRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = () => {};
  window.__t = performance.now();
  window.__step = (n) => { for (let i = 0; i < n; i++) { window.__t += 1000 / 60; g.tick(window.__t); } };
  window.__shot = () => { g.renderer.render = window.__realRender; };
});

const track = process.argv[2] || 'beach';
await page.evaluate(() => document.getElementById('m-solo').click());
await page.evaluate((t) => document.querySelector('#levels .lvl[data-l="' + t + '"]')?.click(), track);
await page.evaluate(() => document.getElementById('m-go')?.click());
await page.evaluate(() => { window.game.input.keys.add('ArrowUp'); });
await page.evaluate(() => window.__step(300));

const t0 = await page.evaluate(() => ({
  state: window.game.state, pos: [window.game.player.x | 0, window.game.player.z | 0],
  speed: +window.game.player.speed.toFixed(1), idx: window.game.player.idx,
}));
console.log('racing:', JSON.stringify(t0), 'errors:', errs.length);

// Fast-forward: teleport the player around the track to finish 3 laps quickly.
const res = await page.evaluate(() => {
  const g = window.game;
  const p = g.player;
  const N = g.track.N;
  const log = [];
  // Walk the player forward along the spline in 40 steps per lap.
  for (let lap = 0; lap < 4; lap++) {
    for (let i = 0; i < 40; i++) {
      const idx = Math.floor((i / 40) * N);
      const loc = p.locate ? null : null;
      window.__step(4);
      p.idx = idx;
      p.speed = 30;
    }
    window.__step(6);
    log.push({ lap: p.lap, finished: p.finished, state: g.state });
  }
  return log;
});
console.log('laps:', JSON.stringify(res));
await page.evaluate(() => window.__shot());
await page.screenshot({ path: 'tools/race_' + track + '.png', timeout: 60000 });
console.log('shot ok, errors:', errs.slice(0, 8).join('\n'));
await browser.close();
