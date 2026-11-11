import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

// Host + guest with live loops: emotes must hop from guest to host and show
// above the right kart.
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

// 1. The emote wheel exists and opens.
const wheel = await guest.evaluate(() => {
  const w = document.getElementById('ewheel');
  const btn = document.getElementById('ewheel-btn');
  btn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  return {
    present: !!w,
    buttons: document.querySelectorAll('#ewheel-grid div').length,
    open: w?.classList.contains('open'),
  };
});
console.log('wheel:', JSON.stringify(wheel));

// 2. The guest sends emote #5 (angry); the host's copy of the guest's kart
//    must show it (via the relayed message and/or the guest's snapshots).
const gRacer = await guest.evaluate(() => window.game.mp.me.racer);
await guest.evaluate(() => window.game.emitEmote(4));
await host.waitForTimeout(300);
const seen = await host.evaluate((racer) => {
  const g = window.game;
  const kart = g.kartOf(racer);
  return { emote: kart?.emote, t: kart?.emoteT > 0 };
}, gRacer);
console.log('host saw guest emote:', JSON.stringify(seen));

// 3. The host sends one back; the guest's copy of the host kart shows it.
const hRacer = await host.evaluate(() => window.game.mp.me.racer);
await host.evaluate(() => window.game.emitEmote(5));
await guest.waitForTimeout(300);
const seen2 = await guest.evaluate((racer) => {
  const g = window.game;
  const kart = g.kartOf(racer);
  return { emote: kart?.emote, t: kart?.emoteT > 0 };
}, hRacer);
console.log('guest saw host emote:', JSON.stringify(seen2));

// 4. The sender sees their own emote (my snapshots carry it to everyone).
const own = await guest.evaluate(() => {
  const k = window.game.player;
  return { emote: k.emote, t: k.emoteT > 0 };
});
console.log('sender saw own emote:', JSON.stringify(own));

// 5. Rate limit: a second emote 1.3s later is allowed, one 300ms later is not.
await guest.waitForTimeout(1000); // first emote is 1.3s old now
await guest.evaluate(() => window.game.emitEmote(0)); // allowed
await guest.waitForTimeout(200);
await guest.evaluate(() => window.game.emitEmote(1)); // blocked
const seen3 = await host.evaluate((racer) => {
  const kart = window.game.kartOf(racer);
  return kart?.emote;
}, gRacer);
console.log('rate-limited emote (should be thumbs-up, not heart):', seen3);

const ok =
  wheel.present && wheel.buttons === 6 && wheel.open &&
  seen.emote === '😡' && seen.t &&
  seen2.emote === '🎉' && seen2.t &&
  own.emote === '😡' && own.t &&
  seen3 === '👍';
console.log(ok ? 'EMOTES OK' : 'EMOTES FAILED');
await browser.close();
process.exit(ok ? 0 : 1);

