import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : errors.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(7000);

const wait = (ms) => page.waitForTimeout(ms);

// ---- Part A: countdown blips through the real game loop
const countFreqs = await page.evaluate(() => {
  const g = window.game;
  g.startSolo('beach');
  g.stop();
  g.renderer.render = () => {};
  g.audio.resume();
  window.__t = performance.now();
  const step = (n) => {
    for (let i = 0; i < n; i++) {
      window.__t += 1000 / 60;
      g.tick(window.__t);
    }
  };
  const freqs = [];
  const A = g.audio;
  const origTone = A.tone.bind(A);
  A.tone = (type, f, ...rest) => {
    if (type === 'square' && f >= 400 && f <= 900) freqs.push(Math.round(f));
    return origTone(type, f, ...rest);
  };
  step(150); // land inside the countdown window
  step(280); // run through countdown + GO
  A.tone = origTone;
  return { freqs, ctxState: A.ctx ? A.ctx.state : 'none' };
});
console.log('countFreqs:', JSON.stringify(countFreqs));
await wait(200);

// ---- Part B: drive the new AudioEngine paths directly and let the
// setTargetAtTime automations settle in real time.
const eng = await page.evaluate(async () => {
  const A = window.game.audio;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const res = { ctxState: A.ctx.state };
  await A.ctx.resume();
  await sleep(100);

  // Skid on road vs offroad (drifting in both cases).
  A.update(20, false, true, 0.1, true, 0, false, null);
  await sleep(260);
  res.skidRoad = { f: Math.round(A.driftF.frequency.value), g: +A.driftG.gain.value.toFixed(4) };
  A.update(20, false, true, 0.1, true, 0, true, null);
  await sleep(260);
  res.skidOffroad = { f: Math.round(A.driftF.frequency.value), g: +A.driftG.gain.value.toFixed(4) };

  // Rival doppler: same rival speed, approaching vs receding.
  A.update(20, false, false, 0.1, true, 0, false, { speed: 20, dist: 8, rel: -12 });
  await sleep(260);
  res.rivApproach = { f: Math.round(A.riv.frequency.value), g: +A.rivG.gain.value.toFixed(4) };
  A.update(20, false, false, 0.1, true, 0, false, { speed: 20, dist: 8, rel: 12 });
  await sleep(260);
  res.rivRecede = { f: Math.round(A.riv.frequency.value), g: +A.rivG.gain.value.toFixed(4) };

  // Rival far away -> silent.
  A.update(20, false, false, 0.1, true, 0, false, { speed: 20, dist: 60, rel: 0 });
  await sleep(400);
  res.rivFar = +A.rivG.gain.value.toFixed(4);
  return res;
});
console.log('engine:', JSON.stringify(eng));
console.log('pageerrors:', errors.length, errors.slice(0, 3));

// Countdown: expect the three blip notes 440/550/660 (ascending) then GO 880.
const uniq = [...new Set(countFreqs.freqs)];
const blipsOk = [440, 550, 660].every((f) => uniq.includes(f));
const skidOk =
  eng.skidOffroad.f < eng.skidRoad.f - 1000 && // gravelly low rumble vs crisp tarmac
  eng.skidOffroad.g > eng.skidRoad.g;          // and louder off the road
const dopOk =
  eng.rivApproach.f > eng.rivRecede.f + 20 &&  // approaching sounds higher
  eng.rivApproach.g > 0.005 &&                 // audible when close
  eng.rivFar < 0.002;                          // silent when far
const ok = blipsOk && skidOk && dopOk && eng.ctxState === 'running' && errors.length === 0;
console.log(JSON.stringify({ blipsOk, uniq, skidOk, dopOk }));
console.log(ok ? 'AUDIO FEEL OK' : 'AUDIO FEEL FAILED');
await browser.close();
process.exit(ok ? 0 : 1);

