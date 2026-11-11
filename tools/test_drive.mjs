import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : errs.push('ERR ' + e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
await page.evaluate(() => {
  const g = window.game;
  g.stop();
  window.__realRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = () => {};
  window.__t = performance.now();
  window.__step = (n) => { for (let i = 0; i < n; i++) { window.__t += 1000 / 60; g.tick(window.__t); } };
});

const out = {};
await page.evaluate(() => {
  document.getElementById('m-solo').click();
  document.querySelector('#levels .lvl[data-l="beach"]').click();
  document.getElementById('m-go').click();
  window.game.input.keys.add('ArrowUp');
  window.__step(430);
});

// Drive by following the road centreline: steer toward the point ahead.
out.drive = await page.evaluate(() => {
  const g = window.game;
  const p = g.player;
  const t = g.track;
  const N = t.N;
  const seen = { coins: 0, boxes: 0, laps: 0 };
  const coin0 = p.coins;
  let maxIdx = 0;
  for (let f = 0; f < 3600; f++) {
    // aim at a point ~40 segments ahead of the current index
    const ahead = (p.idx + 46) % N;
    const dx = t.px[ahead] - p.x;
    const dz = t.pz[ahead] - p.z;
    const want = Math.atan2(dx, dz);
    let d = want - p.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const inp = p.input;
    inp.steer = Math.max(-1, Math.min(1, d * 2.2));
    inp.accel = 1;
    g.tick((window.__t += 1000 / 60));
    if (p.coins > coin0 + seen.coins) seen.coins = p.coins - coin0;
    if (p.idx > maxIdx) maxIdx = p.idx;
    if (p.lap > 1 + seen.laps) seen.laps = p.lap - 1;
    if (p.finished) break;
  }
  return {
    lap: p.lap, finished: p.finished, coins: p.coins, coinGain: seen.coins,
    maxIdx, idx: p.idx, speed: +p.speed.toFixed(1), rank: p.rank,
    turbo: +p.turbo.toFixed(2), state: g.state, raceTime: +g.raceTime.toFixed(1),
  };
});

// GP: finish this race then check the cup advances
out.gp = await page.evaluate(() => {
  const g = window.game;
  const p = g.player;
  for (let i = 0; i < 400 && g.state !== 'done'; i++) {
    p.lap = 4;
    g.onLap(p);
    window.__step(2);
  }
  window.__step(280);
  return {
    state: g.state,
    resultsOn: document.getElementById('results').classList.contains('on'),
    cup: g.cup && { race: g.cup.race, total: g.cup.total, final: g.cup.final },
    pts: g.cup ? g.cup.pts : null,
  };
});

console.log(JSON.stringify(out, null, 1));
console.log('ERRORS', errs.slice(0, 6).join('\n'));
await browser.close();

