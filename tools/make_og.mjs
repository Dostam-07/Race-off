import { chromium } from 'playwright';

// Regenerate public/og-image.png from the live title screen at exactly
// 1200x630 - the logo composited over the track background, by construction.
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(9000); // assets + logo animation settle
await page.screenshot({ path: 'public/og-image.png', timeout: 15000 });
console.log('og-image regenerated');
await browser.close();
