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
  window.__step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      window.__t += 1000 / 60;
      g.tick(window.__t);
    }
  };
  window.__shot = () => {
    g.renderer.render = window.__realRender;
  };
});

await page.evaluate(() => document.getElementById('m-solo').click());
await page.evaluate(() => document.querySelector('#levels .lvl[data-l="beach"]')?.click());
await page.evaluate(() => document.getElementById('m-go')?.click());
await page.evaluate(() => { window.game.input.keys.add('ArrowUp'); });

const steps = +(process.argv[2] || 900);
await page.evaluate((n) => window.__step(n), steps);

const info = await page.evaluate(() => {
  const g = window.game;
  const p = g.player;
  return {
    state: g.state, t: +g.raceTime.toFixed(2), lap: p.lap, idx: p.idx,
    speed: +p.speed.toFixed(1), rank: p.rank, boost: +p.boost.toFixed(2),
    turbo: +p.turbo.toFixed(2), pos: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
    onGround: p.onGround, coins: p.coins, drift: p.drifting,
    others: g.karts.slice(1).map((k) => +k.speed.toFixed(0)),
    fov: +g.camera.fov.toFixed(1), fps: g.fps,
  };
});
console.log(JSON.stringify(info, null, 1));
console.log(errs.slice(0, 10).join('\n'));

await page.evaluate(() => window.__shot());
await page.screenshot({ path: process.argv[3] || 'tools/race1.png', timeout: 60000 });
console.log('shot ok');
await browser.close();
