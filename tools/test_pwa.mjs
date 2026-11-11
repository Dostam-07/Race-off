import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:4173/', { waitUntil: 'load' });
await page.waitForTimeout(8000);

const out = await page.evaluate(async () => {
  const res = {};
  // 1. manifest + icons + sw are served
  const check = async (u) => {
    const r = await fetch(u);
    return { status: r.status, type: r.headers.get('content-type') };
  };
  res.manifest = await check('/manifest.webmanifest');
  res.icon192 = await check('/icon-192.png');
  res.icon512 = await check('/icon-512.png');
  res.maskable = await check('/icon-maskable.png');
  res.sw = await check('/sw.js');
  res.og = await check('/og-image.png');
  // 2. manifest parsed by the browser
  const link = document.querySelector('link[rel="manifest"]');
  res.linkHref = link ? link.getAttribute('href') : null;
  try {
    const m = await fetch(link.getAttribute('href')).then((r) => r.json());
    res.manifestName = m.name;
    res.manifestIcons = m.icons.length;
    res.display = m.display;
  } catch (e) {
    res.manifestError = e.message;
  }
  // 3. service worker registers and activates
  const reg = await navigator.serviceWorker.getRegistration();
  res.swState = reg ? (reg.active ? 'active' : reg.installing ? 'installing' : 'other') : 'none';
  if (reg && reg.active) {
    const keys = await caches.keys();
    res.cacheName = keys[0] || null;
  }
  // 4. start Solo race still works from the menu
  document.querySelector('.solo')?.click();
  await new Promise((r) => setTimeout(r, 800));
  const lvls = document.querySelectorAll('.lvl');
  res.levels = lvls.length;
  lvls[0]?.click();
  await new Promise((r) => setTimeout(r, 300));
  res.goLabel = document.getElementById('m-go')?.textContent;
  return res;
});
console.log(JSON.stringify(out, null, 1));
console.log('pageerrors:', errors.length, errors.slice(0, 3));
const ok =
  out.manifest.status === 200 && out.icon192.status === 200 && out.icon512.status === 200 &&
  out.maskable.status === 200 && out.sw.status === 200 && out.og.status === 200 &&
  out.manifestName === 'Race-Off — Cartoon Kart Racing' && out.manifestIcons === 3 &&
  out.display === 'fullscreen' && out.swState === 'active' &&
  out.levels >= 4 && /START|TIME TRIAL/.test(out.goLabel || '') && errors.length === 0;
console.log(ok ? 'PWA PREVIEW OK' : 'PWA PREVIEW FAILED');
await browser.close();
process.exit(ok ? 0 : 1);
