import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('[err]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
await page.evaluate(() => {
  const g = window.game;
  g.startSolo('beach');
  g.stop();
  g.renderer.render = () => {};
  window.__t = performance.now();
  window.__step = (n) => {
    for (let i = 0; i < n; i++) {
      window.__t += 1000 / 60;
      g.tick(window.__t);
    }
  };
  window.__step(490);
});
await page.waitForTimeout(400);
const info = await page.evaluate(() => {
  const probe = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.right), Math.round(r.bottom)],
      transform: cs.transform === 'none' ? 'none' : cs.transform.slice(0, 40),
      opacity: cs.opacity,
      parent: el.parentElement.id || el.parentElement.className,
      zoom: cs.zoom,
    };
  };
  const rows = [...document.querySelectorAll('#board .row')].slice(0, 3).map((el) => ({
    t: getComputedStyle(el).transform.slice(0, 30),
    rect: [Math.round(el.getBoundingClientRect().y), Math.round(el.getBoundingClientRect().bottom)],
  }));
  return {
    howto: probe('#howto'),
    pos: probe('#pos'),
    spd: probe('#spd'),
    spdtrack: probe('#spdtrack'),
    speed: probe('#speed'),
    hs: document.documentElement.style.getPropertyValue('--hs') || '(unset)',
    rows,
    howtoParentChain: (() => {
      let el = document.getElementById('howto');
      const chain = [];
      while (el && el !== document.body) {
        chain.push((el.id || el.className) + ':' + getComputedStyle(el).transform.slice(0, 12) + '/z' + getComputedStyle(el).zoom);
        el = el.parentElement;
      }
      return chain;
    })(),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
