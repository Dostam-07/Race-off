import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : errs.push(e.message));
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

  // 1. Start the daily: config applied, race builds.
  g.startDaily();
  res.track = g.track.def.id;
  res.cc = g.cc;
  res.mirror = g.mirror;
  res.dailyFlag = !!g.daily;
  res.karts = g.karts.length;
  res.configSane =
    ['beach', 'jungle', 'desert', 'volcano', 'snow', 'sky'].includes(res.track) &&
    [0.85, 1, 1.15].includes(res.cc);

  // 2. Drive it to the finish.
  step(560);
  const p = g.player;
  for (let i = 0; i < 4; i++) {
    p.lap = i + 1;
    g.onLap(p);
    step(2);
  }
  step(280);
  res.state = g.state;
  res.resultsOn = document.getElementById('results').classList.contains('on');
  res.stored = JSON.parse(localStorage.getItem('ro-daily-' + g.dailyKey) || 'null');
  res.storedIsTime = res.stored && typeof res.stored.time === 'number' && res.stored.time > 1;
  res.dailyCleared = !g.daily;

  // 3. Second attempt must be refused.
  g.toTitle();
  step(5);
  const before = g.state;
  g.startDaily();
  step(5);
  res.refused = g.state === 'title' && before === 'title';
  res.refusalToast = (document.getElementById('toast')?.textContent || '').slice(0, 60);
  return res;
});
console.log(JSON.stringify(out, null, 1));
console.log('pageerrors:', errs.length, errs.slice(0, 4));

// 4. Friend link: reload with a #daily hash and expect the greeting toast.
await page.goto('http://localhost:5173/#daily=95.5', { waitUntil: 'load' });
await page.waitForTimeout(9500);
const greeted = await page.evaluate(
  () => (document.getElementById('toast')?.textContent || '').slice(0, 60),
);
console.log('greetToast:', greeted);

const ok =
  out.configSane && out.dailyFlag && out.karts === 6 && out.state === 'done' &&
  out.resultsOn && out.storedIsTime && out.dailyCleared && out.refused &&
  /DAILY/.test(greeted) && errs.length === 0;
console.log(ok ? 'DAILY OK' : 'DAILY FAILED');
await browser.close();
process.exit(ok ? 0 : 1);

