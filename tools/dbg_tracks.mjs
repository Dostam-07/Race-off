import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errs = [];
page.on('pageerror', (e) => errs.push('ERR ' + e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
await page.evaluate(() => { window.game.stop(); });

for (const t of ['beach', 'jungle', 'volcano', 'sky']) {
  const info = await page.evaluate((id) => {
    const g = window.game;
    g.loadTrack(id, { mode: 'title' });
    const def = g.track.def;
    return {
      id: def.id, name: def.name,
      palette: def.palette,
      terrainVerts: g.terrainMesh?.geometry?.attributes?.position?.count,
      terrainColorSample: (() => {
        const c = g.terrainMesh?.geometry?.attributes?.color;
        return c ? [c.getX(1000), c.getY(1000), c.getZ(1000)].map((v) => +v.toFixed(2)) : null;
      })(),
      worldKids: g.world.children.length,
      decorKids: g.decor?.group?.children?.length,
      sceneBg: g.scene.background?.getHexString?.(),
      fog: g.fog.color.getHexString(),
      N: g.track.N,
      groundAtStart: +g.track.heightAt(g.track.px[0], g.track.pz[0]).toFixed(2),
      lavaW: +Math.max(...Array.from(g.track.lavaW || [0])).toFixed(2),
      lagoonW: +Math.max(...Array.from(g.track.lagoonW || [0])).toFixed(2),
    };
  }, t);
  console.log(JSON.stringify(info));
}
console.log('ERR', errs.slice(0, 5).join('\n'));
await browser.close();
