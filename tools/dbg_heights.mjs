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

for (const t of ['volcano', 'sky']) {
  const info = await page.evaluate((id) => {
    const g = window.game;
    g.loadTrack(id, { mode: 'title' });
    const tr = g.track;
    const samples = [];
    for (let i = 0; i < tr.N; i += Math.floor(tr.N / 8)) {
      samples.push({
        i, roadY: +tr.py[i].toFixed(1),
        ground: +tr.heightAt(tr.px[i], tr.pz[i]).toFixed(1),
        gap: +tr.gapW[i].toFixed(2), lava: +tr.lavaW[i].toFixed(2),
      });
    }
    return { id, N: tr.N, samples };
  }, t);
  console.log(JSON.stringify(info));
}
console.log('ERR', errs.join('\n'));
await browser.close();
