import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push('ERR ' + e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
await page.evaluate(() => {
  const g = window.game;
  g.stop();
  g.renderer.render = () => {};
  let t = performance.now();
  window.__step = (n) => { for (let i = 0; i < n; i++) { t += 1000 / 60; g.tick(t); } };
});

const out = {};
await page.evaluate(() => {
  document.getElementById('m-solo').click();
  document.querySelector('#levels .lvl[data-l="gp"]').click();
  document.getElementById('m-go').click();
  window.__step(430);
});
out.race1 = await page.evaluate(() => ({
  state: window.game.state, track: window.game.track.def.id,
  cup: window.game.cup && { race: window.game.cup.race, total: window.game.cup.total },
}));

// finish race 1
out.finish1 = await page.evaluate(() => {
  const g = window.game;
  const p = g.player;
  for (let i = 0; i < 200 && g.state !== 'done'; i++) { p.lap = 4; g.onLap(p); window.__step(2); }
  window.__step(280);
  return {
    state: g.state,
    resultsOn: document.getElementById('results').classList.contains('on'),
    cup: g.cup && { race: g.cup.race, total: g.cup.total, final: g.cup.final },
    pts: g.cup ? g.cup.pts : null,
    headline: document.querySelector('#results h2')?.textContent,
  };
});

// race again -> should load track 2 of the cup
out.race2 = await page.evaluate(() => {
  const g = window.game;
  g.raceAgain();
  window.__step(430);
  return {
    state: g.state, track: g.track.def.id,
    cup: g.cup && { race: g.cup.race, total: g.cup.total },
  };
});

console.log(JSON.stringify(out, null, 1));
console.log('ERRORS', errs.slice(0, 6).join('\n'));
await browser.close();
