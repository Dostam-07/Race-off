import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);

const out = await page.evaluate(() => {
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
  step(430); // pass intro
  const k = g.player;

  const run = (key, frames) => {
    const h0 = k.heading;
    g.input.keys.add(key);
    step(frames);
    g.input.keys.delete(key);
    return k.heading - h0;
  };

  // settle: drive straight briefly so speed is up
  g.input.keys.add('ArrowUp');
  step(40);
  const dRight = run('ArrowRight', 50);
  const dLeft = run('ArrowLeft', 50);
  g.input.keys.delete('ArrowUp');
  return { dRight: +dRight.toFixed(3), dLeft: +dLeft.toFixed(3) };
});
console.log(JSON.stringify(out));
console.log(
  out.dRight < 0 && out.dLeft > 0
    ? 'STEERING CORRECT (right turns screen-right)'
    : 'STEERING WRONG',
);
await browser.close();
