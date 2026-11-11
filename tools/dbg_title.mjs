import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const sizes = [
  { name: 'xl', width: 1920, height: 1080 },
  { name: 'std', width: 1366, height: 768 },
  { name: 'small', width: 960, height: 600 },
];
for (const s of sizes) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height } });
  page.on('pageerror', (e) => console.log('[err]', e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'load' });
  await page.waitForTimeout(7000);
  await page.evaluate(() => {
    const g = window.game;
    g.stop();
    g.renderer.render = g.renderer.render.bind(g.renderer);
    g.renderer.render(g.scene, g.camera);
    g.renderer.render(g.scene, g.camera);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `tools/title_${s.name}.png`, timeout: 120000 });
  const info = await page.evaluate(() => ({
    karts: window.game.karts.length,
    ids: window.game.karts.map((k) => k.def.id),
  }));
  console.log(s.name, JSON.stringify(info));
  await page.close();
}
await browser.close();
