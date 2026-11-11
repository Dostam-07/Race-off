import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => (e.message || '').includes('ERR_CONNECTION_REFUSED') ? undefined : errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CONNECTION_REFUSED')) errs.push('C ' + m.text()); });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(7000);

// Race to the results panel, then exercise the SHARE button end to end.
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
});
await page.evaluate(() => {
  const g = window.game;
  g.input.applyTo = () => {};
  g.startSolo('volcano');
});
await page.evaluate(() => window.step(430));
await page.evaluate(() => {
  const g = window.game;
  g.player.lap = 4;
  g.onLap(g.player);
});
await page.evaluate(() => window.step(280));

const panel = await page.evaluate(() => ({
  on: document.getElementById('results')?.classList.contains('on'),
  shareBtn: !!document.getElementById('r-share'),
}));
console.log('results panel:', JSON.stringify(panel));

// Build the card directly and inspect the canvas.
const card = await page.evaluate(async () => {
  const g = window.game;
  const { buildShareCard, shareText } = await import('/src/core/shareCard.js');
  const opts = {
    place: g.player.rank,
    trackId: g.track.def.id,
    trackName: g.track.def.name,
    time: g.raceTime,
    lapBest: Math.min(...g.lapTimes),
    charIcon: g.hud.icons[g.player.def.id] || '',
    coins: g.player.coins,
    cc: g.cc,
    mirror: g.mirror,
  };
  const cv = await buildShareCard(opts);
  const ctx = cv.getContext('2d');
  // Sample a grid of pixels: a real card has variety, a blank one does not.
  const colors = new Set();
  for (let y = 0; y < 630; y += 30) {
    for (let px = 0; px < 1200; px += 40) {
      const d = ctx.getImageData(px, y, 1, 1).data;
      colors.add(`${d[0]},${d[1]},${d[2]}`);
    }
  }
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  return {
    w: cv.width,
    h: cv.height,
    colors: colors.size,
    png: blob && blob.size > 20000,
    text: shareText(opts),
  };
});
console.log('card:', JSON.stringify(card));

// Click the actual SHARE button (no native share sheet in headless - it must
// fall back to a download and not throw).
await page.evaluate(() => {
  const a = document.createElement('a');
  a.id = 'dl-spy';
  window.__downloads = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__downloads.push(this.download);
    orig.call(this);
  };
});
await page.click('#r-share');
await page.waitForTimeout(7000); // canvas toBlob is slow under SwiftShader
const after = await page.evaluate(() => ({
  downloads: window.__downloads,
  toast: document.getElementById('toast')?.textContent || '',
}));
console.log('share click:', JSON.stringify(after));

const ok =
  panel.on && panel.shareBtn &&
  card.w === 1200 && card.h === 630 &&
  card.colors > 40 && card.png &&
  card.text.includes('on') &&
  after.downloads.includes('race-off.png') &&
  errs.length === 0;
console.log(ok ? 'SHARE OK' : 'SHARE FAILED');
await browser.close();
process.exit(ok ? 0 : 1);
