import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('C ' + m.text()); });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);

const out = await page.evaluate(() => {
  const g = window.game;
  g.stop();
  g.renderer.render = () => {};
  window.__t = performance.now();
  const step = (n) => {
    for (let i = 0; i < n; i++) {
      window.__t += 1000 / 60;
      g.tick(window.__t);
    }
  };
  const res = {};

  // --- 50cc vs 150cc top speed, measured solo (time trial: no AI traffic)
  const topAt = (cc) => {
    if (g.state !== 'title') g.toTitle();
    g.cc = cc;
    g.startTimeTrial('beach');
    g.stop();
    step(560); // intro + countdown
    g.input.keys.add('ArrowUp');
    let vmax = 0;
    for (let i = 0; i < 500; i++) {
      step(1);
      if (g.player.onGround) vmax = Math.max(vmax, g.player.speed);
    }
    g.input.keys.delete('ArrowUp');
    g.toTitle();
    return vmax;
  };
  res.cc50 = +topAt(0.85).toFixed(1);
  res.cc100 = +topAt(1).toFixed(1);
  res.cc150 = +topAt(1.15).toFixed(1);

  // --- mirror mode: geometry actually flips
  g.mirror = false;
  g.startSolo('beach');
  g.stop();
  step(10);
  const fx0 = g.track.px[500];
  const xMin0 = Math.min(...Array.from(g.track.px).filter((_, i) => i % 40 === 0));
  const xMax0 = Math.max(...Array.from(g.track.px).filter((_, i) => i % 40 === 0));
  g.toTitle();
  g.mirror = true;
  g.startSolo('beach');
  g.stop();
  step(10);
  const fx1 = g.track.px[500];
  const xMin1 = Math.min(...Array.from(g.track.px).filter((_, i) => i % 40 === 0));
  res.mirrorX = { normal: +fx0.toFixed(1), mirrored: +fx1.toFixed(1), xMin0: +xMin0.toFixed(1), xMin1: +xMin1.toFixed(1), xMax0: +xMax0.toFixed(1) };
  res.mirrorFlipped = Math.abs(fx1 + fx0) < 0.5 && Math.abs(xMin1 + xMax0) < 0.5;

  // --- mirrored track is fully drivable: AI completes laps on it
  step(560);
  const ai = g.karts.find((k) => k !== g.player);
  for (let i = 0; i < 4500; i++) step(1);
  res.mirrorAiLaps = ai.lap;
  const i0 = ai.idx;
  step(60);
  let d = ai.idx - i0;
  if (d < -g.track.N / 2) d += g.track.N;
  if (d > g.track.N / 2) d -= g.track.N;
  res.mirrorAiMoving = d;
  res.state = g.state;

  // --- HUD badge
  res.modeText = document.getElementById('mode').textContent;
  res.modeShown = document.getElementById('mode').style.display !== 'none';
  return res;
});
console.log(JSON.stringify(out, null, 1));
console.log('pageerrors:', errs.length, errs.slice(0, 4));

const ccOk = out.cc150 > out.cc100 * 1.1 && out.cc50 < out.cc100 * 0.9 && out.cc100 > 15;
const mirrorOk = out.mirrorFlipped && out.mirrorAiLaps >= 2 && out.mirrorAiMoving > 15;
const badgeOk = out.modeText.includes('MIRROR');
const ok = ccOk && mirrorOk && badgeOk && errs.length === 0;
console.log(JSON.stringify({ ccOk, mirrorOk, badgeOk }));
console.log(ok ? 'CLASS+MIRROR OK' : 'CLASS+MIRROR FAILED');
await browser.close();
process.exit(ok ? 0 : 1);
