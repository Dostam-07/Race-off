import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
page.on('pageerror', (e) => console.log('[err2]', e.message));
await page.waitForTimeout(7000);
await page.evaluate(() => {
  const g = window.game;
  g.startSolo('beach');
  g.stop();
  window.__t = performance.now();
  window.__step = (n) => {
    for (let i = 0; i < n; i++) {
      window.__t += 1000 / 60;
      g.tick(window.__t);
    }
  };
  window.__step(430);
  g.input.keys.add('ArrowUp');
  window.__step(240);
  g.renderer.render = window.__realRender || g.renderer.render.bind(g.renderer);
  g.renderer.render(g.scene, g.camera);
  g.renderer.render(g.scene, g.camera);
});
await page.waitForTimeout(500);
await page.screenshot({ path: 'tools/race_now.png', timeout: 150000 });
console.log('shot ok');
await browser.close();
