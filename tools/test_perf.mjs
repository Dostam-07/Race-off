import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

const mk = async (url) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('  [err]', e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(6000);
  return page;
};

// --- 1. quality tiers: URL override + renderer caps + FX budgets
const low = await mk('http://localhost:5173/?quality=low');
const lowInfo = await low.evaluate(() => {
  const g = window.game;
  const fx = g.fx;
  return {
    quality: g.quality,
    ratio: g.renderer.getPixelRatio(),
    cap: g.resCap,
    fx: { alpha: fx.alpha.max, streaks: fx.streaks.max, glow: fx.glow.max, skids: fx.skids.max },
  };
});
console.log('low:', JSON.stringify(lowInfo));
await low.close();

const med = await mk('http://localhost:5173/?quality=medium');
const medInfo = await med.evaluate(() => ({
  quality: window.game.quality,
  cap: window.game.resCap,
}));
console.log('medium:', JSON.stringify(medInfo));
await med.close();

const high = await mk('http://localhost:5173/?quality=high');
const highInfo = await high.evaluate(() => {
  const g = window.game;
  const fx = g.fx;
  return {
    quality: g.quality,
    cap: g.resCap,
    fx: { alpha: fx.alpha.max, streaks: fx.streaks.max, glow: fx.glow.max, skids: fx.skids.max },
  };
});
console.log('high:', JSON.stringify(highInfo));

// --- 2. adaptive resolution: feed slow frames (25fps) through the clock and
//        watch the render buffer shrink; then feed fast frames and watch it
//        climb back.
const adapt = await high.evaluate(() => {
  const g = window.game;
  g.stop();
  g.renderer.render = () => {};
  window.__t = performance.now();
  window.stepMs = (n, ms) => {
    for (let i = 0; i < n; i++) {
      window.__t += ms;
      g.tick(window.__t);
    }
  };
  window.stepMs(40, 40); // 40 frames at 25fps -> fps meter settles low
  return { fps: g.fps, scale: g.resScale, ratio: g.renderer.getPixelRatio() };
});
console.log('after slow frames:', JSON.stringify(adapt));

const adapt2 = await high.evaluate(() => {
  const g = window.game;
  window.stepMs(120, 40); // more slow samples: scale must keep dropping
  const lowState = { scale: g.resScale, ratio: g.renderer.getPixelRatio() };
  window.stepMs(400, 1000 / 60); // sustained fast frames -> climbs back up
  return { lowState, after: { scale: g.resScale, ratio: g.renderer.getPixelRatio() } };
});
console.log('adaptive:', JSON.stringify(adapt2));

// --- 3. particle budgets live in the tier info above (fx.alpha etc.)

const ok =
  lowInfo.quality === 'low' && lowInfo.cap === 1 &&
  medInfo.quality === 'medium' && medInfo.cap === 1.35 &&
  highInfo.quality === 'high' && highInfo.cap === 1.8 &&
  adapt.fps <= 30 && adapt.scale < 1 &&
  adapt2.lowState.scale < adapt.scale &&
  adapt2.after.scale > adapt2.lowState.scale &&
  lowInfo.fx.alpha < highInfo.fx.alpha && lowInfo.fx.skids < highInfo.fx.skids;
console.log(ok ? 'PERF OK' : 'PERF FAILED');
await browser.close();
process.exit(ok ? 0 : 1);
