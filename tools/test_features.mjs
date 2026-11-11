import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push('ERR ' + e.message + ' @' + (e.stack || '').split('\n')[1]));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
await page.evaluate(() => {
  const g = window.game;
  g.stop();
  window.__t = performance.now();
  window.__step = (n) => { for (let i = 0; i < n; i++) { window.__t += 1000 / 60; g.tick(window.__t); } };
});

const out = {};

// ---- 1. pick a racer
out.pickBefore = await page.evaluate(() => window.game.player.def.id);
await page.evaluate(() => document.querySelectorAll('#picks .pk')[2].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
out.pickAfter = await page.evaluate(() => window.game.player.def.id);

// ---- 2. start a GP
await page.evaluate(() => {
  document.getElementById('m-solo').click();
  document.querySelector('#levels .lvl[data-l="gp"]').click();
  document.getElementById('m-go').click();
  window.__step(300);
});
out.gp = await page.evaluate(() => ({
  state: window.game.state, track: window.game.track.def.id,
  cup: window.game.cup && { race: window.game.cup.race, total: window.game.cup.total },
}));

// ---- 3. pause / resume
await page.evaluate(() => { window.game.onPauseKey(); });
out.paused = await page.evaluate(() => ({
  paused: window.game.paused,
  on: document.getElementById('pause').classList.contains('on'),
}));
await page.evaluate(() => { window.game.onPauseKey(); });
out.resumed = await page.evaluate(() => window.game.paused);

// ---- 4. items: give one and use it
await page.evaluate(() => {
  const g = window.game;
  g.input.keys.add('ArrowUp');
  window.__step(60);
  g.player.item = 'chili';
  g.hud.setItem('chili');
  g.player.input.item = true;
});
await page.evaluate(() => window.__step(10));
out.item = await page.evaluate(() => ({
  boost: +window.game.player.boost.toFixed(2),
  item: window.game.player.item,
}));

// ---- 5. drift + turbo
await page.evaluate(() => {
  const g = window.game;
  g.input.keys.add(' ');
  g.input.keys.add('ArrowLeft');
  window.__step(60);
});
out.drift = await page.evaluate(() => ({
  drifting: window.game.player.drifting, level: window.game.player.driftLevel,
  turbo: +window.game.player.turbo.toFixed(2),
}));
await page.evaluate(() => {
  const g = window.game;
  g.input.keys.delete(' ');
  g.input.keys.delete('ArrowLeft');
  g.player.turbo = 3;
  g.input.pressed.add('Shift');
  window.__step(4);
});
out.turbo = await page.evaluate(() => ({
  boost: +window.game.player.boost.toFixed(2), turbo: +window.game.player.turbo.toFixed(2),
}));

// ---- 6. hud values
out.hud = await page.evaluate(() => ({
  lap: document.getElementById('lapn').textContent,
  time: document.getElementById('timer').textContent,
  coins: document.getElementById('coinn').textContent,
  pos: document.getElementById('pos').textContent,
  spd: document.getElementById('spd').textContent,
  boardRows: document.querySelectorAll('#board .row').length,
  turboBars: Array.from(document.querySelectorAll('#turbo i b')).map((b) => b.style.width),
}));

console.log(JSON.stringify(out, null, 1));
console.log('ERRORS', errs.slice(0, 8).join('\n'));
await browser.close();
