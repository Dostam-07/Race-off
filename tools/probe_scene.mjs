import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const logs = [];
page.on('pageerror', (e) => logs.push('ERR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') logs.push('CONSOLE ' + m.text()); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(9000);

const info = await page.evaluate(() => {
  const g = window.game;
  const gl = document.getElementById('gl');
  const cs = gl ? getComputedStyle(gl) : null;
  return {
    state: g?.state,
    canvas: !!gl,
    canvasStyle: cs ? `${cs.position} ${cs.zIndex} ${cs.width}x${cs.height} op=${cs.opacity}` : null,
    sceneChildren: g?.scene?.children?.map((c) => `${c.type}:${c.name || ''}:${c.children.length}`),
    worldChildren: g?.world?.children?.length,
    camPos: g?.camera?.position?.toArray()?.map((n) => +n.toFixed(1)),
    camFov: g?.camera?.fov,
    renderInfo: g?.renderer?.info?.render,
    bodyClasses: document.body.className,
  };
});
console.log(JSON.stringify(info, null, 1));
console.log(logs.slice(0, 15).join('\n'));

await page.evaluate(() => {
  const t = document.getElementById('title');
  if (t) t.style.display = 'none';
});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'tools/scene.png', timeout: 15000 });
console.log('shot');
await browser.close();
