import { chromium } from 'playwright';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(8000);
const info = await page.evaluate(() => {
  const g = window.game;
  const k = g.player;
  return {
    fov: g.camera.fov,
    campos: [g.camera.position.x, g.camera.position.y, g.camera.position.z],
    rigid: [g.cameraRig.pos.x, g.cameraRig.pos.y, g.cameraRig.pos.z],
    riglook: [g.cameraRig.look.x, g.cameraRig.look.y, g.cameraRig.look.z],
    kart: [k.x, k.y, k.z],
    heading: k.heading,
    state: g.state,
    st: g.st,
    trackN: g.track.N,
    p0: [g.track.px[0], g.track.py[0], g.track.pz[0]],
    worldVisible: g.world.visible,
    terrainVis: g.terrainMesh?.visible,
    decorVis: g.decor?.group?.visible,
    terrainPos: g.terrainMesh ? [g.terrainMesh.position.x, g.terrainMesh.position.y, g.terrainMesh.position.z] : null,
    terrainBB: (() => { if (!g.terrainMesh) return null; g.terrainMesh.geometry.computeBoundingBox(); const b = g.terrainMesh.geometry.boundingBox; return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z]; })(),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
