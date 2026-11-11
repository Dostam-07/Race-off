// Screen-agnostic UI audit: loads the game at several viewport sizes and walks
// the main screens (title, cup picker, race HUD, pause, results), reporting
// any pairs of visible UI elements that overlap plus elements that spill
// outside the viewport.
//
// Usage: node tools/audit_ui.mjs [url]
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5173/';
const SIZES = [
  { name: 'desktop-xl', width: 1920, height: 1080 },
  { name: 'desktop', width: 1366, height: 768 },
  { name: 'laptop', width: 1280, height: 720 },
  { name: 'small-laptop', width: 960, height: 600 },
  { name: 'tablet-land', width: 1024, height: 768 },
  { name: 'tablet-port', width: 768, height: 1024 },
  { name: 'phone-land', width: 740, height: 360 },
  { name: 'phone-port', width: 390, height: 844 },
];

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const out = {};
for (const size of SIZES) {
  out[size.name] = await auditSize(size);
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
process.exit(0);

async function auditSize(size) {
  const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
  page.on('pageerror', (e) => console.log(`[${size.name}] err:`, e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const g = window.game;
    g.stop();
    g.renderer.render = () => {};
    window.__t = performance.now();
    window.__step = (n) => {
      for (let i = 0; i < n; i++) {
        window.__t += 1000 / 60;
        g.tick(window.__t);
      }
    };
  });

  const screens = {};

  // 1. title
  screens.title = await page.evaluate(scan);

  // 2. cup picker
  await page.evaluate(() => {
    document.getElementById('m-solo')?.click();
    window.game.fitUI();
  });
  await page.waitForTimeout(300);
  screens.cup = await page.evaluate(scan);

  // 3. race HUD
  await page.evaluate(() => {
    document.body.classList.remove('solo');
    window.game.startSolo('beach');
    window.__step(430); // through the intro
    window.__step(60);
  });
  await page.waitForTimeout(300);
  screens.race = await page.evaluate(scan);

  // 4. pause
  await page.evaluate(() => {
    window.game.onPauseKey();
  });
  await page.waitForTimeout(200);
  screens.pause = await page.evaluate(scan);
  await page.evaluate(() => window.game.onPauseKey());

  // 5. results
  await page.evaluate(() => {
    const g = window.game;
    g.player.lap = 4;
    g.onLap(g.player);
    window.__step(260);
  });
  await page.waitForTimeout(300);
  screens.results = await page.evaluate(scan);

  await page.close();
  return screens;
}

/** Scan the current screen for overlapping / offscreen UI elements. */
function scan() {
  // Freeze transitions/animations so mid-flight states don't skew geometry
  // (headless pages throttle the animation timeline).
  let style = document.getElementById('__audit-freeze');
  if (!style) {
    style = document.createElement('style');
    style.id = '__audit-freeze';
    style.textContent = '*, *::before, *::after { transition: none !important; animation-duration: 0s !important; animation-delay: 0s !important; }';
    document.head.appendChild(style);
  }
  const vw = innerWidth;
  const vh = innerHeight;
  const visible = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return false;
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    // An ancestor with opacity 0 / display none hides this element too.
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (pcs.display === 'none' || pcs.visibility === 'hidden' || pcs.opacity === '0') return false;
    }
    return true;
  };
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.x, t: r.y, r: r.x + r.width, b: r.y + r.height };
  };
  const overlap = (a, b) =>
    Math.min(a.r, b.r) - Math.max(a.l, b.l) > 3 &&
    Math.min(a.b, b.b) - Math.max(a.t, b.t) > 3;
  const desc = (el) =>
    (el.id || el.className.toString().split(' ')[0] || el.tagName) +
    (el.textContent ? ` "${el.textContent.trim().slice(0, 16)}"` : '');

  const problems = [];

  // Pairwise overlaps between direct children of each UI layer.
  const layers = ['#title', '#hud', '#pause', '#results', '#howto'];
  for (const sel of layers) {
    const root = document.querySelector(sel);
    if (!root) continue;
    const kids = [...root.children].filter((el) => visible(el) && !el.closest('#toast'));
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        if (overlap(box(kids[i]), box(kids[j]))) {
          problems.push(`overlap ${sel}: ${desc(kids[i])} × ${desc(kids[j])}`);
        }
      }
    }
    // grandchildren inside structured panels
    for (const sub of ['#pick', '#mp', '#modes', '#cup', '#sgo', '#lobby', '#board', '#speed', '#lap', '#itembox']) {
      const s = root.querySelector(sub);
      if (!s) continue;
      const inner = [...s.children].filter(visible);
      for (let i = 0; i < inner.length; i++) {
        for (let j = i + 1; j < inner.length; j++) {
          if (inner[i].contains(inner[j]) || inner[j].contains(inner[i])) continue;
          if (overlap(box(inner[i]), box(inner[j]))) {
            problems.push(`overlap ${sub}: ${desc(inner[i])} × ${desc(inner[j])}`);
          }
        }
      }
    }
  }

  // Anything spilling out of the viewport (decorative bleeds excluded).
  for (const el of document.querySelectorAll('#title *, #hud *, #pause *, #results *, #howto *')) {
    if (!visible(el)) continue;
    if (el.closest('.streaks, .logo .tail')) continue;
    const b = box(el);
    if (b.l < -4 || b.t < -4 || b.r > vw + 4 || b.b > vh + 4) {
      problems.push(`offscreen ${desc(el)} (${Math.round(b.l)},${Math.round(b.t)}-${Math.round(b.r)},${Math.round(b.b)} vs ${vw}x${vh})`);
    }
  }

  return { problems: problems.slice(0, 20), count: problems.length };
}
