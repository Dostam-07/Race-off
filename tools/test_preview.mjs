import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errs = [];
page.on('pageerror', (e) => errs.push('ERR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('C ' + m.text()); });
await page.goto('http://localhost:4173/', { waitUntil: 'load' });
await page.waitForTimeout(9000);

const info = await page.evaluate(() => ({
  title: document.title,
  logo: [1, 2].map((n) => document.querySelector('#title .w' + n + ' .a')?.textContent),
  tagline: document.querySelector('#title .b')?.textContent,
  loading: document.getElementById('loading')?.textContent?.trim(),
  hasHow: !!document.getElementById('how'),
  hasSub: !!document.getElementById('sub'),
  youtubeLinks: document.querySelectorAll('a[href*="youtube"]').length,
  containsYouTubeText: /youtube|subscribe/i.test(document.body.innerText),
  racers: window.game ? window.game.karts.map((k) => k.def.name) : [],
  pickName: document.getElementById('pickname')?.textContent,
  roster: window.game ? null : null,
  state: window.game?.state,
}));
console.log(JSON.stringify(info, null, 1));
console.log('ERRORS', errs.slice(0, 6).join('\n'));
await page.screenshot({ path: 'tools/preview.png', timeout: 60000 });
await browser.close();
