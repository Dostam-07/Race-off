import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : errs.push('ERR ' + e.message + ' @' + (e.stack || '').split('\n')[1]));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CONNECTION_REFUSED')) errs.push('C ' + m.text()); });

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

for (const track of ['beach', 'jungle', 'desert', 'volcano', 'snow', 'sky']) {
  await page.evaluate((t) => {
    const g = window.game;
    if (g.state !== 'title') g.toTitle();
    document.getElementById('m-solo').click();
    document.querySelector('#levels .lvl[data-l="' + t + '"]')?.click();
    document.getElementById('m-go')?.click();
    g.input.keys.add('ArrowUp');
    window.__step(560);
  }, track);

  const info = await page.evaluate(() => {
    const g = window.game;
    const p = g.player;
    return {
      track: g.track.def.id, state: g.state, t: +g.raceTime.toFixed(1),
      lap: p.lap, idx: p.idx, speed: +p.speed.toFixed(0), onGround: p.onGround,
      dist: +Math.hypot(p.x - g.track.px[p.idx], p.z - g.track.pz[p.idx]).toFixed(1),
    };
  });
  console.log(JSON.stringify(info));
  await page.evaluate(() => window.__shot());
  await page.screenshot({ path: 'tools/track_' + track + '.png', timeout: 60000 });
  await page.evaluate(() => {
    window.game.renderer.render = () => {};
    window.game.input.keys.delete('ArrowUp');
  });
}

console.log('ERRORS:\n' + errs.slice(0, 12).join('\n'));
await browser.close();


