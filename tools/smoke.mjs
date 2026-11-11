import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5173/';
const wait = +(process.argv[3] || 12000);
const shot = process.argv[4] || 'tools/shot.png';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.message}\n${(e.stack||'').split('\n').slice(0,6).join('\n')}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(wait);

const state = await page.evaluate(() => {
  const g = window.game;
  if (!g) return { state: 'NO GAME' };
  return {
    state: g.state,
    karts: g.karts?.length,
    track: g.track?.def?.id,
    fps: g.fps,
    err: g._bootErr || null,
    loadlabel: document.getElementById('loadlabel')?.textContent,
  };
});

console.log('STATE', JSON.stringify(state));
console.log(logs.slice(0, 40).join('\n'));
try {
  await page.screenshot({ path: shot, timeout: 15000, animations: 'disabled', caret: 'initial' });
  console.log('SHOT OK');
} catch (e) {
  console.log('SHOT FAIL', e.message.split('\n')[0]);
}
await browser.close();
