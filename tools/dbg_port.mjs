import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
await page.evaluate(() => {
  window.game.stop();
  window.game.renderer.render = () => {};
});
await page.waitForTimeout(400);
const info = await page.evaluate(() => {
  const cs = (el) => el && getComputedStyle(el);
  const pick = document.getElementById('pick');
  const title = document.getElementById('title');
  const tleft = document.querySelector('.tleft');
  const tright = document.querySelector('.tright');
  const name = document.getElementById('pickname');
  return {
    ts: document.documentElement.style.getPropertyValue('--ts') || '(unset)',
    tss: document.documentElement.style.getPropertyValue('--tss') || '(unset)',
    pickZoom: cs(pick).zoom,
    pickRect: pick.getBoundingClientRect().toJSON(),
    nameFont: cs(name).fontSize,
    nameRect: name.getBoundingClientRect().toJSON(),
    titleDisplay: cs(title).display,
    tleftDisplay: cs(tleft).display,
    trightDisplay: cs(tright).display,
    titleRect: title.getBoundingClientRect().toJSON(),
    bodyClass: document.body.className,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
