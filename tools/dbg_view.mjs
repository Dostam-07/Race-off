import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
await page.evaluate(() => {
  const g = window.game;
  g.stop();
  window.__realRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = () => {};
  window.__t = performance.now();
  window.__step = (n) => { for (let i = 0; i < n; i++) { window.__t += 1000 / 60; g.tick(window.__t); } };
});
for (const t of ['volcano', 'sky', 'jungle']) {
  const info = await page.evaluate((id) => {
    const g = window.game;
    if (g.state !== 'title') g.toTitle();
    document.getElementById('m-solo').click();
    document.querySelector('#levels .lvl[data-l="' + id + '"]')?.click();
    document.getElementById('m-go')?.click();
    g.input.keys.add('ArrowUp');
    window.__step(560);
    const p = g.player;
    return {
      id: g.track.def.id, idx: p.idx, kart: [p.x, p.y, p.z].map((v) => +v.toFixed(1)),
      roadY: +g.track.py[p.idx].toFixed(1),
      cam: [g.camera.position.x, g.camera.position.y, g.camera.position.z].map((v) => +v.toFixed(1)),
      look: [g.cameraRig.look.x, g.cameraRig.look.y, g.cameraRig.look.z].map((v) => +v.toFixed(1)),
      terrAtCam: +g.terrain.heightAt(g.camera.position.x, g.camera.position.z).toFixed(1),
      fov: +g.camera.fov.toFixed(1), speed: +p.speed.toFixed(0),
    };
  }, t);
  console.log(JSON.stringify(info));
  await page.evaluate(() => { window.game.renderer.render = () => {}; });
}
await browser.close();
