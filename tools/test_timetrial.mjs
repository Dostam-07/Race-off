import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// Fresh profile: no saved racer, no ghost.
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(7000);

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
  step(640); // intro + countdown + early race
  const res = { karts: g.karts.length, tt: !!g.timeTrial };
  res.boxes = g.items.boxes.length;
  res.coins = g.items.coinList.length;
  res.noItems = !!g.noItems;
  res.ghostHiddenNoRecord = !(g.ghost.root && g.ghost.root.visible);
  res.bestHiddenNoRecord = document.getElementById('best').style.display === 'none';

  // Drive lap 1 (samples accumulate), cross the line via the lap handler.
  g.input.keys.add('ArrowUp');
  step(300);
  g.player.lap = 2; // completing lap 1 -> crossing counts lap 2
  g.onLap(g.player);
  step(2);
  res.lap1 = g.lapTimes[0];
  const rec1 = JSON.parse(localStorage.getItem('ro-ghost-beach') || 'null');
  res.rec1Time = rec1 ? rec1.time : null;
  res.rec1Samples = rec1 ? rec1.samples.length : 0;
  res.rec1Char = rec1 ? rec1.char : null;
  res.bannerAfterLap1 = document.getElementById('banner').textContent;
  res.ghostVisibleAfterRecord = !!(g.ghost.root && g.ghost.root.visible);
  res.bestShown = document.getElementById('best').textContent;

  // Lap 2 driven FASTER (400 ticks < lap 1's 300+300 ticks): must overwrite.
  step(400);
  g.player.lap = 3;
  g.onLap(g.player);
  step(2);
  res.lap2 = g.lapTimes[1];
  const rec2 = JSON.parse(localStorage.getItem('ro-ghost-beach') || 'null');
  res.rec2Time = rec2 ? rec2.time : null;
  res.rec2Samples = rec2 ? rec2.samples.length : 0;

  // Lap 3 driven SLOWER: must NOT overwrite.
  step(500);
  g.player.lap = 4; // also finishes the 3-lap race
  g.onLap(g.player);
  step(2);
  res.lap3 = g.lapTimes[2];
  const rec3 = JSON.parse(localStorage.getItem('ro-ghost-beach') || 'null');
  res.rec3Time = rec3 ? rec3.time : null;
  res.rec3Samples = rec3 ? rec3.samples.length : 0;
  res.lapTimes = g.lapTimes.length;

  step(280);
  res.state = g.state;
  res.resultsOn = document.getElementById('results').classList.contains('on');
  res.head = document.querySelector('#results .rhead h2')?.textContent;
  res.lapRows = (document.querySelector('#results .laps')?.textContent || '').replace(/\s+/g, ' ').slice(0, 80);
  return res;
});
console.log(JSON.stringify(out, null, 1));
console.log('pageerrors:', errors.length, errors.slice(0, 3));

const ok =
  out.karts === 1 && out.tt && out.noItems && out.boxes === 0 && out.coins === 0 &&
  out.ghostHiddenNoRecord && out.bestHiddenNoRecord &&
  out.rec1Time > 0 && out.rec1Samples >= 40 && out.rec1Char === 'fox' &&
  out.bannerAfterLap1 === 'NEW RECORD!' && out.ghostVisibleAfterRecord &&
  out.rec2Time < out.rec1Time && out.rec2Samples > 0 && // faster lap overwrote
  out.rec3Time === out.rec2Time && // slower lap did not
  out.lapTimes === 3 && out.state === 'done' && out.resultsOn &&
  out.head === 'NEW RECORD!' && errors.length === 0;
console.log(ok ? 'TIME TRIAL OK' : 'TIME TRIAL FAILED');
await browser.close();
process.exit(ok ? 0 : 1);
