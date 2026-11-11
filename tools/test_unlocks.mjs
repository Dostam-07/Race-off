import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : errs.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);

// Fresh unlock state.
await page.evaluate(() => localStorage.removeItem('ro-unlocks'));

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
  const res = { races: [] };

  // Start a Grand Prix through the real menu flow.
  document.getElementById('m-solo').click();
  document.querySelector('#levels .lvl[data-l="gp"]').click();
  document.getElementById('m-go').click();
  step(430);

  // Win all 6 races: force-finish each, keep the player top of the standings.
  for (let race = 0; race < 8; race++) {
    const p = g.player;
    for (let i = 0; i < 200 && g.state !== 'done'; i++) {
      p.lap = 4;
      g.onLap(p);
      step(2);
    }
    step(280);
    const info = {
      track: g.track.def.id,
      state: g.state,
      final: g.cup ? !!g.cup.final : null,
      pts: g.cup ? { ...g.cup.pts } : null,
    };
    res.races.push(info);
    if (g.state !== 'done' || (g.cup && g.cup.final)) break;
    g.raceAgain();
    step(430);
  }
  res.unlocks = JSON.parse(localStorage.getItem('ro-unlocks') || 'null');
  return res;
});
console.log(JSON.stringify(out, null, 1));
console.log('pageerrors:', errs.length, errs.slice(0, 4));

// Fresh page: unlock persisted -> star badge + gold star on the title kart.
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(7000);
const after = await page.evaluate(() => {
  const g = window.game;
  const res = {};
  res.star = !!document.querySelector('.pk .goldstar');
  const champ = g.player.ud.champStar;
  res.champStar = !!champ;
  let gold = false;
  if (champ) {
    champ.traverse((o) => {
      if (o.isMesh) {
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m.color.getHex() === 0xffd21e) gold = true;
      }
    });
  }
  res.champGold = gold;
  res.char = g.player.def.id;
  return res;
});
console.log(JSON.stringify(after));
const ok =
  out.unlocks && out.unlocks.gold && out.unlocks.gold.length === 1 &&
  after.star && after.champStar && after.champGold && errs.length === 0;
console.log(ok ? 'UNLOCKS OK' : 'UNLOCKS FAILED');
await browser.close();
process.exit(ok ? 0 : 1);

