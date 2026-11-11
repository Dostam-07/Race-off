import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { writeFileSync } from 'fs';

const W = 640, H = 360;
const FRAMES = 48; // 48 frames x 12 game-ticks = ~9.6s of gameplay
const DELAY_MS = 125; // 8 fps

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(8000);

await page.evaluate(() => {
  const g = window.game;
  g.startSolo('beach');
  g.stop();
  g.renderer.render = g.renderer.render.bind(g.renderer);
  window.__t = performance.now();
  window.__step = (n) => {
    for (let i = 0; i < n; i++) {
      window.__t += 1000 / 60;
      g.tick(window.__t);
    }
  };
});
await page.evaluate(() => window.__step(430)); // pass intro

const frames = [];
for (let f = 0; f < FRAMES; f++) {
  const dataUrl = await page.evaluate((f) => {
    const g = window.game;
    // weave: steer with a slow sine, drift through the swing
    const s = Math.sin(f * 0.22);
    g.input.keys.delete('ArrowLeft');
    g.input.keys.delete('ArrowRight');
    g.input.keys.add(s > 0 ? 'ArrowRight' : 'ArrowLeft');
    if (Math.abs(s) > 0.75 && g.player.onGround) g.input.keys.add(' ');
    else g.input.keys.delete(' ');
    g.input.keys.add('ArrowUp');
    window.__step(12);
    // render one real frame and grab the canvas pixels
    g.renderer.render = g.renderer.render.bind(g.renderer);
    g.renderer.render(g.scene, g.camera);
    const url = g.renderer.domElement.toDataURL('image/png');
    g.renderer.render = () => {};
    return url;
  }, f);
  frames.push(Buffer.from(dataUrl.split(',')[1], 'base64'));
  if (f % 12 === 0) console.log('frame', f);
}
await browser.close();

// encode
const gif = GIFEncoder();
for (const buf of frames) {
  const png = PNG.sync.read(buf);
  const { data, width, height } = png;
  const palette = quantize(data, 256);
  const index = applyPalette(data, palette);
  gif.writeFrame(index, width, height, { palette, delay: DELAY_MS });
}
gif.finish();
writeFileSync('docs/gameplay.gif', Buffer.from(gif.bytes()));
console.log('gif written:', frames.length, 'frames');
