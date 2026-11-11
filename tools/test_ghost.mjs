import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(7000);

// Seed a best lap: 20 samples at 0.05s spacing (1s lap), moving +x.
await page.evaluate(() => {
  const samples = [];
  for (let i = 0; i < 20; i++) samples.push([i * 1.0, 0.5, 20, 0]);
  localStorage.setItem('ro-ghost-beach', JSON.stringify({ time: 1.0, char: 'fox', samples }));
});

const out = await page.evaluate(() => {
  const g = window.game;
  g.startTimeTrial('beach');
  g.stop();
  g.renderer.render = () => {};
  window.__t = performance.now();
  const step = (n) => {
    for (let i = 0; i < n; i++) {
      window.__t += 1000 / 60;
      g.tick(window.__t);
    }
  };
  step(640); // intro + countdown + a bit of racing (~3.5s race time)
  const lapT = g.raceTime - g.lapStart;
  const gp = g.ghost.root.position;
  // expected interpolation at lapT mod 1.0
  const t = ((lapT % 1.0) + 1.0) % 1.0;
  const f = t / 0.05;
  const i0 = Math.min(19, Math.floor(f));
  const i1 = Math.min(19, i0 + 1);
  const k = f - i0;
  const expX = i0 * 1.0 + (i1 * 1.0 - i0 * 1.0) * k;
  return {
    lapT: +lapT.toFixed(3),
    ghostX: +gp.x.toFixed(3),
    expectedX: +expX.toFixed(3),
    visible: g.ghost.root.visible,
    bestShown: document.getElementById('best').textContent,
  };
});
console.log(JSON.stringify(out));
console.log('pageerrors:', errors.length);
const ok = out.visible && Math.abs(out.ghostX - out.expectedX) < 0.05 && errors.length === 0;
console.log(ok ? 'GHOST PLAYBACK OK' : 'GHOST PLAYBACK FAILED');
await browser.close();
process.exit(ok ? 0 : 1);

