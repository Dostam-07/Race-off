import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

// Host + guest with LIVE loops (render mocked): keepalives and snapshots flow
// in real time, exactly like two real players.
const mk = async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : console.log('  [err]', e.message));
  return page;
};

const host = await mk();
await host.goto('http://localhost:5173/', { waitUntil: 'load' });
await host.waitForTimeout(7000);
await host.evaluate(() => {
  const g = window.game;
  g.renderer.render = () => {}; // keep the RAF loop alive, skip the GPU work
  g.startMultiplayer();
});
await host.waitForTimeout(6000);
const code = await host.evaluate(() => window.game.mp?.code);

const guest = await mk();
await guest.goto('http://localhost:5173/?room=' + code + '&level=beach', { waitUntil: 'load' });
await guest.waitForTimeout(9000);
await guest.evaluate(() => {
  window.game.renderer.render = () => {};
});

// Make sure the guest is actually in the room before the host starts.
for (let i = 0; i < 30; i++) {
  const joined = await guest.evaluate(() => window.game.mp?.status === 'joined' && (window.game.mp?.players?.length || 0) > 1);
  if (joined) break;
  if (i === 29) {
    console.log('GUEST NEVER JOINED');
    await browser.close();
    process.exit(1);
  }
  await guest.waitForTimeout(1000);
}

// Start the race; both loops run live from here.
await host.evaluate(() => window.game.mp?.start());

// Wait until both sides are actually racing (live loops, so real time).
for (let i = 0; i < 40; i++) {
  await host.waitForTimeout(500);
  const st = await Promise.all([
    host.evaluate(() => window.game.state),
    guest.evaluate(() => window.game.state),
  ]);
  if (st[0] === 'race' && st[1] === 'race') break;
  if (i === 39) {
    console.log('RACE NEVER STARTED:', JSON.stringify(st));
    await browser.close();
    process.exit(1);
  }
}

// Drive the host's kart, then compare the guest's interpolated copy.
await host.evaluate(() => window.game.input.keys.add('ArrowUp'));
await host.waitForTimeout(3000);
const out = await host.evaluate(() => {
  const g = window.game;
  const me = g.player;
  return { x: me.x, y: me.y, z: me.z, racerIdx: g.rid(me), state: g.state };
});
const gOut = await guest.evaluate((want) => {
  const g = window.game;
  const kart = g.karts.find((k) => g.rid(k) === want.racerIdx);
  const d = Math.hypot(kart.x - want.x, kart.z - want.z);
  return {
    state: g.state,
    remote: kart.remote,
    x: kart.x,
    z: kart.z,
    dist: +d.toFixed(2),
    hasNs: !!kart.ns,
    buf: kart.ns ? +kart.ns.buf?.toFixed(3) : null,
  };
}, out);
console.log('HOST kart at:', out.x.toFixed(1), out.z.toFixed(1), 'state:', out.state);
console.log('GUEST copy at:', gOut.x.toFixed(1), gOut.z.toFixed(1));
console.log('distance:', gOut.dist, 'ns:', gOut.hasNs, 'remote:', gOut.remote, 'buf:', gOut.buf);

const ok = gOut.hasNs && gOut.remote && gOut.dist < 8 && out.state === 'race' && gOut.state === 'race';
console.log(ok ? 'REMOTE INTERP OK' : 'REMOTE INTERP FAILED');

// --- Scenario 2: simulated lag - the buffer must deepen with the jitter.
if (ok) {
  const host2 = await mk();
  await host2.goto('http://localhost:5173/?netlag=90', { waitUntil: 'load' });
  await host2.waitForTimeout(7000);
  await host2.evaluate(() => {
    const g = window.game;
    g.renderer.render = () => {};
    g.startMultiplayer();
  });
  await host2.waitForTimeout(6000);
  const code2 = await host2.evaluate(() => window.game.mp?.code);
  const guest2 = await mk();
  await guest2.goto('http://localhost:5173/?room=' + code2 + '&level=beach&netlag=90', { waitUntil: 'load' });
  await guest2.waitForTimeout(9000);
  await guest2.evaluate(() => {
    window.game.renderer.render = () => {};
  });
  for (let i = 0; i < 30; i++) {
    const joined = await guest2.evaluate(() => window.game.mp?.status === 'joined' && (window.game.mp?.players?.length || 0) > 1);
    if (joined) break;
    if (i === 29) {
      console.log('GUEST2 NEVER JOINED');
      await browser.close();
      process.exit(1);
    }
    await guest2.waitForTimeout(1000);
  }
  await host2.evaluate(() => window.game.mp?.start());
  for (let i = 0; i < 40; i++) {
    await host2.waitForTimeout(500);
    const st = await Promise.all([
      host2.evaluate(() => window.game.state),
      guest2.evaluate(() => window.game.state),
    ]);
    if (st[0] === 'race' && st[1] === 'race') break;
  }
  await host2.evaluate(() => window.game.input.keys.add('ArrowUp'));
  await host2.waitForTimeout(3000);
  const out2 = await host2.evaluate(() => {
    const g = window.game;
    const me = g.player;
    return { x: me.x, z: me.z, racerIdx: g.rid(me) };
  });
  const g2 = await guest2.evaluate((want) => {
    const g = window.game;
    const kart = g.karts.find((k) => g.rid(k) === want.racerIdx);
    return {
      dist: +Math.hypot(kart.x - want.x, kart.z - want.z).toFixed(2),
      buf: kart.ns ? +(kart.ns.buf || 0).toFixed(3) : null,
    };
  }, out2);
  console.log('LAGGY: dist', g2.dist, 'buf', g2.buf);
  const ok2 = g2.buf != null && g2.buf > 0.1 && g2.dist < 10;
  console.log(ok2 ? 'ADAPTIVE BUF OK' : 'ADAPTIVE BUF FAILED');
  await browser.close();
  process.exit(ok2 ? 0 : 1);
}

await browser.close();
process.exit(ok ? 0 : 1);

