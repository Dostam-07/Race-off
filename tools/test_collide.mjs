import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : console.log('[err]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : console.log('[err2]', e.message));
await page.waitForTimeout(7000);

const result = await page.evaluate(() => {
  const g = window.game;
  g.startSolo('beach');
  g.stop();
  g.renderer.render = () => {};
  window.__t = performance.now();
  const step = (n) => {
    for (let i = 0; i < n; i++) {
      window.__t += 1000 / 60;
      g.tick(window.__t);
    }
  };

  g.state = 'race';
  g.st = 5;
  const a = g.karts[1];
  const b = g.karts[2];

  // Park them overlapping but not exactly coincident, engines off.
  b.x = a.x + 0.8;
  b.z = a.z;
  b.y = a.y;
  a.speed = 0;
  b.speed = 0;
  a.input.accel = 0;
  b.input.accel = 0;
  const d0 = Math.hypot(a.x - b.x, a.z - b.z);

  let bumpFired = false;
  const orig = g.audio.sfx.bind(g.audio);
  g.audio.sfx = (name, ...rest) => {
    if (name === 'bump') bumpFired = true;
    return orig(name, ...rest);
  };

  step(20);
  const d1 = Math.hypot(a.x - b.x, a.z - b.z);
  return {
    distBefore: +d0.toFixed(2),
    distAfter: +d1.toFixed(2),
    separated: d1 > 1.7,
    bumpFired,
  };
});
console.log(JSON.stringify(result));
await browser.close();

