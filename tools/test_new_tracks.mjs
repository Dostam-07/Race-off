import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : errs.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);

const results = [];
for (const track of ['desert', 'snow']) {
  const r = await page.evaluate((t) => {
    const g = window.game;
    if (g.state !== 'title') g.toTitle();
    g.startSolo(t);
    g.stop();
    g.renderer.render = () => {};
    window.__t = performance.now();
    const step = (n) => {
      for (let i = 0; i < n; i++) {
        window.__t += 1000 / 60;
        g.tick(window.__t);
      }
    };
    step(560); // intro + countdown
    const ai = g.karts.find((k) => k !== g.player);
    const info = {
      track: t,
      N: g.track.N,
      lenM: Math.round(g.track.length),
      boxes: g.items.boxes.length,
      pads: g.items.pads.length,
      coins: g.items.coinList.length,
      sections: g.track.sections.length,
      aiLap0: ai.lap,
      respawns: 0,
    };
    // Simulate ~75s of racing and watch the AI kart complete laps.
    for (let i = 0; i < 4500; i++) step(1);
    info.aiLapEnd = ai.lap;
    info.aiFinished = !!ai.finished;
    // Movement check: the AI must still be making progress at the end.
    const i0 = ai.idx;
    step(60);
    let d = ai.idx - i0;
    if (d < -info.N / 2) d += info.N; // unwrap wrap-around
    if (d > info.N / 2) d -= info.N;
    info.moved60 = d;
    info.playerLap = g.player.lap;
    info.state = g.state;
    return info;
  }, track);
  results.push(r);
  console.log(JSON.stringify(r));
}
console.log('pageerrors:', errs.length, errs.slice(0, 3));
const ok = results.every(
  (r) =>
    r.N > 1500 && r.boxes === 24 && r.pads >= 5 && r.coins > 40 && r.sections >= 6 &&
    r.aiLapEnd >= 2 && r.moved60 > 15 && errs.length === 0,
);
console.log(ok ? 'NEW TRACKS OK' : 'NEW TRACKS FAILED');
await browser.close();
process.exit(ok ? 0 : 1);

