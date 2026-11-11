import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
const info = await page.evaluate(() => {
  const g = window.game;
  const k = g.player;
  const out = [];
  new (window.THREE_BOX || Object)();
  const box = { min: { x: 1e9, y: 1e9, z: 1e9 }, max: { x: -1e9, y: -1e9, z: -1e9 } };
  k.root.updateWorldMatrix(true, true);
  k.root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox.clone();
    b.applyMatrix4(o.matrixWorld);
    box.min.x = Math.min(box.min.x, b.min.x); box.min.y = Math.min(box.min.y, b.min.y); box.min.z = Math.min(box.min.z, b.min.z);
    box.max.x = Math.max(box.max.x, b.max.x); box.max.y = Math.max(box.max.y, b.max.y); box.max.z = Math.max(box.max.z, b.max.z);
  });
  const t = g.track;
  return {
    kartY: k.y, rootY: k.root.position.y, size: k.size,
    worldMinY: +box.min.y.toFixed(3), worldMaxY: +box.max.y.toFixed(3),
    trackY: +t.pointAt(0, 0, new window.game.camera.position.constructor()).y.toFixed(3),
    rootChildren: k.root.children.map((c) => `${c.type}:${c.name}:y=${c.position.y.toFixed(3)}`),
    tiltChildren: k.tilt?.children?.map((c) => `${c.type}:${c.name}:y=${c.position.y.toFixed(3)}`),
    modelChildren: k.model?.children?.map((c) => `${c.type}:${c.name}:y=${c.position.y.toFixed(3)}`),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
