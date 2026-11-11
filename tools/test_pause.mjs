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
out.state = await page.evaluate(() => window.game.state);

// ---- drift via the real input path (build speed first, then hop)
await page.evaluate(() => { window.__step(150); });
out.preDrift = await page.evaluate(() => {
  const p = window.game.player;
  p.speed = 26; // put the kart well above the drift hop threshold
  // settle onto the ground before pressing drift
  for (let i = 0; i < 120 && !p.onGround; i++) window.__step(1);
  return { speed: +p.speed.toFixed(1), onGround: p.onGround };
});
await page.evaluate(() => {
  const g = window.game;
  g.input.keys.add('ArrowLeft');
  g.input.keys.add(' ');
  g.input.pressed.add(' ');
  window.__step(3);
  g.input.pressed.delete(' ');
  window.__step(2);
});
out.drift = await page.evaluate(() => ({
  drifting: window.game.player.drifting,
  level: window.game.player.driftLevel,
  turbo: +window.game.player.turbo.toFixed(2),
  speed: +window.game.player.speed.toFixed(0),
}));
// release: a charged drift pays out a boost
await page.evaluate(() => {
  window.game.input.keys.delete(' ');
  window.game.input.keys.delete('ArrowLeft');
  window.__step(6);
});
out.driftEnd = await page.evaluate(() => ({
  drifting: window.game.player.drifting,
  boost: +window.game.player.boost.toFixed(2),
}));

// ---- item: shield from the real item path
await page.evaluate(() => {
  const g = window.game;
  g.player.item = 'shield';
  g.hud.setItem('shield');
  g.input.pressed.add('e');
  window.__step(2);
});
out.shield = await page.evaluate(() => ({
  shield: window.game.player.shield,
  item: window.game.player.item,
}));

// ---- pause / resume / restart
await page.evaluate(() => window.game.onPauseKey());
out.pause = await page.evaluate(() => ({
  paused: window.game.paused,
  on: document.getElementById('pause').classList.contains('on'),
}));
await page.evaluate(() => window.game.onPauseKey());
out.unpause = await page.evaluate(() => window.game.paused);
await page.evaluate(() => { window.game.onPauseKey(); document.getElementById('p-restart').click(); });
out.restart = await page.evaluate(() => ({ state: window.game.state, paused: window.game.paused }));

// ---- back to title
await page.evaluate(() => { window.__step(430); window.game.toTitle(); });
out.title = await page.evaluate(() => ({
  state: window.game.state,
  titleOn: document.getElementById('title').classList.contains('on'),
  hudOn: document.getElementById('hud').classList.contains('on'),
}));

console.log(JSON.stringify(out, null, 1));
console.log('ERRORS', errs.slice(0, 6).join('\n'));
await browser.close();

