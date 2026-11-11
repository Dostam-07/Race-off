import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

// Late joiner watches the running race, then returns to the lobby when it
// ends and can join the next one.
const mk = async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : console.log('  [err]', e.message));
  return page;
};

const host = await mk();
await host.goto('http://localhost:5173/', { waitUntil: 'load' });
await host.waitForTimeout(7000);
await host.evaluate(() => {
  window.game.renderer.render = () => {};
  window.game.startMultiplayer();
});
await host.waitForTimeout(6000);
const code = await host.evaluate(() => window.game.mp?.code);

const guest = await mk();
await guest.goto('http://localhost:5173/?room=' + code + '&level=beach', { waitUntil: 'load' });
await guest.waitForTimeout(9000);
await guest.evaluate(() => {
  window.game.renderer.render = () => {};
});
for (let i = 0; i < 30; i++) {
  const joined = await guest.evaluate(() => window.game.mp?.status === 'joined' && (window.game.mp?.players?.length || 0) > 1);
  if (joined) break;
  if (i === 29) { console.log('GUEST NEVER JOINED'); await browser.close(); process.exit(1); }
  await guest.waitForTimeout(1000);
}

// Host starts the race. The guest must leave the lobby and start racing.
await host.evaluate(() => window.game.mp?.start());
for (let i = 0; i < 40; i++) {
  await host.waitForTimeout(500);
  const st = await Promise.all([
    host.evaluate(() => window.game.state),
    guest.evaluate(() => window.game.state),
  ]);
  if (st[0] === 'race' && st[1] === 'race') break;
  if (i === 39) { console.log('RACE NEVER STARTED: ' + JSON.stringify(st)); await browser.close(); process.exit(1); }
}
console.log('race started for host + guest');

// A third player joins while the race is already running -> spectator.
const spec = await mk();
await spec.goto('http://localhost:5173/?room=' + code + '&level=beach', { waitUntil: 'load' });
await spec.waitForTimeout(9000);
await spec.evaluate(() => {
  window.game.renderer.render = () => {};
});
let spectating = false;
for (let i = 0; i < 25; i++) {
  spectating = await spec.evaluate(() => window.game.spectating === true && window.game.state === 'race');
  if (spectating) break;
  if (i === 24) break;
  await spec.waitForTimeout(1000);
}
const specInfo = await spec.evaluate(() => {
  const g = window.game;
  return {
    spectating: g.spectating,
    state: g.state,
    remotes: g.karts.filter((k) => k.remote).length,
    karts: g.karts.length,
    banner: document.getElementById('banner')?.textContent || '',
    waiting: g.mp?.waiting,
  };
});
console.log('spectator:', JSON.stringify(specInfo));

// The spectator receives snapshots for all six karts (including their own
// slot, which the host drives as CPU) and they actually move.
await spec.waitForTimeout(1500);
const p1 = await spec.evaluate(() => window.game.karts.map((k) => k.x.toFixed(1)));
await spec.waitForTimeout(1500);
const p2 = await spec.evaluate(() => window.game.karts.map((k) => k.x.toFixed(1)));
const moving = p1.filter((v, i) => v !== p2[i]).length;
console.log('karts moved:', moving, 'of 6');

// The spectator can cycle the follow camera with the arrow keys.
const before = await spec.evaluate(() => window.game.specKart?.def.id);
await spec.keyboard.press('ArrowRight');
await spec.waitForTimeout(300);
const after = await spec.evaluate(() => window.game.specKart?.def.id);
console.log('camera cycle:', before, '->', after);

// The host finishes the race -> the spectator returns to the lobby and the
// host can immediately start the next race (phase reset).
await host.evaluate(() => {
  const g = window.game;
  g.player.lap = 4;
  g.onLap(g.player);
});
for (let i = 0; i < 40; i++) {
  await host.waitForTimeout(500);
  const st = await host.evaluate(() => window.game.state);
  if (st === 'done') break;
  if (i === 39) console.log('  (host race end not seen - continuing)');
}
await spec.waitForTimeout(2500);
const afterOver = await spec.evaluate(() => {
  const g = window.game;
  return {
    spectating: g.spectating,
    state: g.state,
    lobbyOn: document.getElementById('lobby')?.classList.contains('on'),
    phase: g.mp?.phase,
    waiting: g.mp?.waiting,
  };
});
console.log('spectator after race over:', JSON.stringify(afterOver));

// The host starts race #2; the ex-spectator must now RACE (waiting cleared).
await host.evaluate(() => window.game.mp?.start());
let racedAgain = false;
for (let i = 0; i < 30; i++) {
  await spec.waitForTimeout(500);
  racedAgain = await spec.evaluate(() => window.game.state === 'race' && !window.game.spectating);
  if (racedAgain) break;
  if (i === 29) break;
}
console.log('ex-spectator races next:', racedAgain);

const ok =
  spectating &&
  specInfo.remotes === 6 && specInfo.karts === 6 &&
  moving >= 4 &&
  before !== after &&
  afterOver.spectating === false && afterOver.lobbyOn === true &&
  racedAgain;
console.log(ok ? 'SPECTATE OK' : 'SPECTATE FAILED');
await browser.close();
process.exit(ok ? 0 : 1);

