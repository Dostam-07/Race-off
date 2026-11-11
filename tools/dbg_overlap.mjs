import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(8000);

// Title screen
await page.evaluate(() => {
  const g = window.game;
  g.stop();
  g.renderer.render = window.__realRender || g.renderer.render.bind(g.renderer);
  g.renderer.render(g.scene, g.camera);
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'tools/shot_title.png', timeout: 60000 });
console.log('title shot ok');

// Racer picker
await page.evaluate(() => {
  document.getElementById('pick')?.classList.add('on');
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'tools/shot_pick.png', timeout: 60000 });
console.log('pick shot ok');

// Grid positions of the title karts (world space)
const karts = await page.evaluate(() =>
  window.game.karts.map((k) => ({
    id: k.def.id, x: +k.x.toFixed(1), z: +k.z.toFixed(1), y: +k.y.toFixed(1), slot: k.slot,
  })),
);
console.log('title karts:', JSON.stringify(karts));
await browser.close();
