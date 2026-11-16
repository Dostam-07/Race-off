import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

// --- 1. Remapped keys actually drive the kart: bind accel to 'j' and steer
//        to 'h'/'l', reload, drive, and check the kart moves and turns.
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : errs.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
await page.evaluate(() => {
  localStorage.setItem('ro-keys', JSON.stringify({
    accel: ['j'], brake: ['k'], left: ['h'], right: ['l'],
    drift: ['n'], turbo: ['m'], item: ['u'],
  }));
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(6000);

const labels = await page.evaluate(() => {
  const i = window.game.input;
  return { accel: i.label('accel'), left: i.label('left'), item: i.label('item') };
});
console.log('labels:', JSON.stringify(labels));

await page.evaluate(() => {
  const g = window.game;
  g.stop();
  g.renderer.render = () => {};
  window.__t = performance.now();
  window.step = (n) => {
    for (let i = 0; i < n; i++) {
      window.__t += 1000 / 60;
      g.tick(window.__t);
    }
  };
  g.startSolo('beach');
});
await page.evaluate(() => window.step(430));

// Hold the remapped keys via real keyboard events (Input listens on window).
await page.keyboard.down('j');
await page.keyboard.down('h');
await page.evaluate(() => window.step(30));
const x1 = await page.evaluate(() => ({ x: window.game.player.x, z: window.game.player.z, accel: window.game.player.input.accel, steer: window.game.player.input.steer }));
// Straight-line speed check: release steer, keep accelerating.
await page.keyboard.up('h');
await page.evaluate(() => window.step(60));
const x2 = await page.evaluate(() => ({ x: window.game.player.x, z: window.game.player.z, speed: window.game.player.speed }));
await page.keyboard.up('j');

const moved = Math.hypot(x2.x - x1.x, x2.z - x1.z);
console.log('remapped drive:', JSON.stringify({ accel: x1.accel, steer: x1.steer, moved: moved.toFixed(1), speed: x2.speed.toFixed(1) }));

// --- 2. The item key badge reflects the remap.
await page.evaluate(() => window.step(430));
const itemKey = await page.evaluate(() => document.getElementById('itemkey')?.textContent);
console.log('item key badge:', itemKey);

// --- 3. Reduced motion: emulate the media query and check the flag + CSS.
const rm = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
rm.on('pageerror', (e) => console.log('  [err]', e.message));
await rm.goto('http://localhost:5173/', { waitUntil: 'load' });
await rm.waitForTimeout(6000);
const rmState = await rm.evaluate(() => {
  const logo = document.querySelector('.logo .logoimg') || document.querySelector('.logo');
  const anim = logo ? getComputedStyle(logo).animationName : 'none';
  return { flag: window.game.reducedMotion, logoAnim: anim };
});
console.log('reduced motion:', JSON.stringify(rmState));

// --- 4. Item icon alt text (screen readers).
await rm.evaluate(() => {
  const g = window.game;
  g.stop();
  g.renderer.render = () => {};
  window.__t = performance.now();
  window.step = (n) => { for (let i = 0; i < n; i++) { window.__t += 1000 / 60; g.tick(window.__t); } };
  g.input.applyTo = () => {};
  g.startSolo('beach');
});
await rm.evaluate(() => window.step(430));
await rm.evaluate(() => {
  const g = window.game;
  g.player.item = 'rocket';
  g.hud.setItem('rocket');
});
await rm.waitForTimeout(300);
const alt = await rm.evaluate(() => ({
  alt: document.getElementById('itemimg')?.alt,
  name: document.getElementById('itemname')?.textContent,
}));
console.log('item a11y:', JSON.stringify(alt));

const ok =
  labels.accel === 'J' && labels.left === 'H' && labels.item === 'U' &&
  x1.accel === 1 && x1.steer === 1 && moved > 5 && x2.speed > 5 &&
  itemKey === 'U' &&
  rmState.flag === true && rmState.logoAnim === 'none' &&
  alt.alt === 'HOMING ROCKET' && alt.name === 'HOMING ROCKET' &&
  errs.length === 0;
console.log(ok ? 'A11Y OK' : 'A11Y FAILED');
await browser.close();
process.exit(ok ? 0 : 1);
