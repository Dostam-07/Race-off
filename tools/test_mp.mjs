import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const mk = async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : console.log('  [err]', e.message));
  return page;
};

// ---- host
const host = await mk();
await host.goto('http://localhost:5173/', { waitUntil: 'load' });
await host.waitForTimeout(7000);
await host.evaluate(() => {
  const g = window.game;
  g.stop();
  g.renderer.render = () => {};
  g.startMultiplayer();
});
await host.waitForTimeout(6000);
const hInfo = await host.evaluate(() => ({
  status: window.game.mp?.status,
  code: window.game.mp?.code,
  players: window.game.mp?.players?.length,
  lobbyShown: document.getElementById('lobby')?.classList.contains('on') || document.body.classList.contains('mp'),
  codeText: document.getElementById('l-code')?.textContent,
  statusText: document.getElementById('l-status')?.textContent,
}));
console.log('HOST:', JSON.stringify(hInfo));
const code = hInfo.code;
if (!code) {
  console.log('NO ROOM CODE - cannot continue');
  await browser.close();
  process.exit(1);
}

// ---- guest joins via the URL
const guest = await mk();
await guest.goto('http://localhost:5173/?room=' + code + '&level=beach', { waitUntil: 'load' });
await guest.waitForTimeout(9000);
await guest.evaluate(() => {
  const g = window.game;
  g.stop();
  g.renderer.render = () => {};
});
await guest.waitForTimeout(4000);
const gInfo = await guest.evaluate(() => ({
  status: window.game.mp?.status,
  players: window.game.mp?.players?.length,
  names: window.game.mp?.players?.map((p) => p.name + (p.host ? '*' : '')),
}));
console.log('GUEST:', JSON.stringify(gInfo));
await host.waitForTimeout(2000);
const hInfo2 = await host.evaluate(() => ({
  players: window.game.mp?.players?.length,
  statusText: document.getElementById('l-status')?.textContent,
}));
console.log('HOST after join:', JSON.stringify(hInfo2));

// ---- host starts the race
await host.evaluate(() => {
  if (window.game.mp?.isHost) window.game.mp.start();
});
await host.waitForTimeout(5000);
await guest.waitForTimeout(5000);
const hRace = await host.evaluate(() => ({
  state: window.game.state, karts: window.game.karts.length,
  humans: window.game.karts.filter((k) => k.human).length,
  remote: window.game.karts.filter((k) => k.remote).length,
  names: window.game.hud.names,
}));
const gRace = await guest.evaluate(() => ({
  state: window.game.state,
  humans: window.game.karts.filter((k) => k.human).length,
  remote: window.game.karts.filter((k) => k.remote).length,
}));
console.log('HOST race:', JSON.stringify(hRace));
console.log('GUEST race:', JSON.stringify(gRace));

await browser.close();

