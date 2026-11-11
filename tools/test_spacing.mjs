// Measure the closest any two karts get during a real race - should never
// drop below the collision radius (~1.7) now that collideKarts runs.
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
  step(430); // through the intro into the race

  let minD = Infinity;
  let minPair = '';
  for (let f = 0; f < 600; f++) {
    // drive the player forward so the field spreads out and jostles
    g.input.keys.add('ArrowUp');
    step(1);
    const ks = g.karts;
    for (let i = 0; i < ks.length; i++) {
      for (let j = i + 1; j < ks.length; j++) {
        const d = Math.hypot(ks[i].x - ks[j].x, ks[i].z - ks[j].z);
        if (d < minD) {
          minD = d;
          minPair = ks[i].def.id + '+' + ks[j].def.id;
        }
      }
    }
  }
  return {
    state: g.state,
    lap: g.player.lap,
    minPairDistance: +minD.toFixed(2),
    closestPair: minPair,
    noOverlap: minD > 1.65,
  };
});
console.log(JSON.stringify(result));
await browser.close();

