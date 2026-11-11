import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(8000);

const shot = (name, timeout = 120000) =>
  page.screenshot({ path: `docs/${name}.png`, timeout });

for (const t of ['desert', 'snow']) {
  await page.evaluate((id) => {
    const g = window.game;
    g.startSolo(id);
    g.stop();
    g.renderer.render = g.renderer.render.bind(g.renderer);
    window.__t = performance.now();
    const step = (n) => {
      for (let i = 0; i < n; i++) {
        window.__t += 1000 / 60;
        g.tick(window.__t);
      }
    };
    window.__drive = (n) => {
      g.renderer.render = () => {};
      step(n);
      g.renderer.render = g.renderer.render.bind(g.renderer);
      g.renderer.render(g.scene, g.camera);
      g.renderer.render(g.scene, g.camera);
    };
  }, t);
  await page.evaluate(() => window.__drive(700)); // pass intro + countdown
  await page.evaluate(() => {
    const c = document.getElementById('count');
    if (c) c.style.display = 'none';
    window.game.input.keys.add('ArrowUp');
    window.game.input.keys.add('ArrowRight');
    window.game.input.keys.add(' ');
  });
  await page.evaluate(() => window.__drive(50));
  await page.evaluate(() => window.game.input.keys.delete(' '));
  await page.evaluate(() => window.__drive(60));
  await shot(`shot-${t}`);
  await page.evaluate(() => {
    window.game.input.keys.delete('ArrowUp');
    window.game.input.keys.delete('ArrowRight');
  });
  console.log('captured', t);
}
await browser.close();
