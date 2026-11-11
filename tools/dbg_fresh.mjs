import { chromium } from 'playwright';

// Real page load at the user's window size - no clock stubs, exactly what a
// refreshed browser would show.
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 940 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(9000);
await page.screenshot({ path: 'tools/fresh_title.png', timeout: 120000 });

// Also flip through three characters to prove only one kart is ever shown.
for (const i of [1, 3, 5]) {
  await page.evaluate((idx) => window.game.menus.select(idx, true), i);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `tools/fresh_pick_${i}.png`, timeout: 120000 });
}
const info = await page.evaluate(() => ({
  karts: window.game.karts.length,
  shown: window.game.karts.map((k) => k.def.id),
  pick: window.game.menus.pick,
}));
console.log('state:', JSON.stringify(info));
await browser.close();
