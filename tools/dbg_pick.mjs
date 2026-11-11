import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(8000);
await page.evaluate(() => {
  document.getElementById('pick')?.classList.add('on');
});
await page.waitForTimeout(400);
const audit = await page.evaluate(() => {
  const pks = [...document.querySelectorAll('#picks .pk')].map((el) => {
    const r = el.getBoundingClientRect();
    return { i: el.dataset.i, x: +r.x.toFixed(1), w: +r.width.toFixed(1), on: el.classList.contains('on') };
  });
  // visual boxes: .pk.on is scaled 1.36 about its centre, plus a 5px ring
  const boxes = pks.map((p) => {
    const scale = p.on ? 1.36 : 1;
    const ring = p.on ? 5 : 0;
    const w = p.w * scale + ring * 2;
    return { ...p, left: +(p.x + (p.w - w) / 2).toFixed(1), right: +(p.x + (p.w - w) / 2 + w).toFixed(1) };
  });
  const overlaps = [];
  for (let i = 0; i < boxes.length - 1; i++) {
    const a = boxes[i], b = boxes[i + 1];
    const ov = +(Math.min(a.right, b.right) - Math.max(a.left, b.left)).toFixed(1);
    overlaps.push({ pair: [a.i, b.i], overlapPx: ov });
  }
  return { boxes, overlaps };
});
console.log(JSON.stringify(audit, null, 1));
await browser.close();
