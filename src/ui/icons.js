// Race-Off - offscreen icon rendering.
//
// The racer portraits and item icons shown in the HUD, the item roulette and
// the results table are rendered once at load time by pointing a small
// offscreen renderer at each model and grabbing the canvas as a data URL.

import * as THREE from 'three';

/**
 * Render a 160x160 PNG of every icon the UI needs.
 * Returns `{ [key]: dataUrl }` keyed by character id, item name and 'trophy'.
 */
export function renderIcons(renderer, A, racers) {
  const out = {};
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  scene.environment = null;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445577, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(2, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5);
  rim.position.set(-3, 1, -3);
  scene.add(rim);

  const size = renderer.getSize(new THREE.Vector2());
  const dpr = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(160, 160, false);
  renderer.setClearColor(0x000000, 0);

  const shoot = (obj, eye, look, name) => {
    scene.add(obj);
    cam.position.set(eye[0], eye[1], eye[2]);
    cam.lookAt(look[0], look[1], look[2]);
    renderer.render(scene, cam);
    out[name] = renderer.domElement.toDataURL('image/png');
    scene.remove(obj);
  };

  for (const r of racers) {
    const src = A[`driver_${r.id}`];
    if (!src) continue;
    shoot(src.clone(true), [0.35, 1.22, 1.55], [0, 1.13, -0.1], r.id);
  }

  if (A.chili) shoot(A.chili.clone(true), [1, 1.1, 2.6], [0, 0.62, 0], 'chili');
  if (A.rocket) {
    const m = A.rocket.clone(true);
    m.rotation.set(-0.5, 2.2, 0);
    shoot(m, [0, 0.2, 3.3], [0, 0, 0], 'rocket');
  }
  if (A.durian) shoot(A.durian.clone(true), [0.7, 1.1, 2.9], [0, 0.55, 0], 'durian');
  if (A.coin) {
    const m = A.coin.clone(true);
    m.rotation.y = 0.5;
    shoot(m, [0, 0.1, 2.5], [0, 0, 0], 'coin');
  }
  if (A.star) {
    const m = A.star.clone(true);
    m.rotation.y = 0.35;
    shoot(m, [0, 0.1, 3], [0, 0, 0], 'star');
  }
  if (A.bolt) {
    const m = A.bolt.clone(true);
    m.rotation.y = 0.35;
    shoot(m, [0, 0, 3.4], [0, 0, 0], 'bolt');
  }
  if (A.shield) shoot(A.shield.clone(true), [0, 0.2, 3.1], [0, 0, 0], 'shield');
  if (A.trophy) shoot(A.trophy.clone(true), [0.3, 1.2, 4.1], [0, 0.78, 0], 'trophy');

  renderer.setPixelRatio(dpr);
  renderer.setSize(size.x, size.y, false);
  return out;
}
