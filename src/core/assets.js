// Race-Off - asset loading.
// The original shipped every model inline as base64 GLB. Here they live as
// real files under public/models and are fetched in parallel.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const MODEL_NAMES = [
  'airship', 'arch', 'balloon', 'boat', 'bolt', 'buoy', 'bush', 'bush2', 'chili',
  'cloud1', 'cloud2', 'coin', 'coral1', 'coral2', 'coral3', 'crab', 'crystal',
  'dolphin', 'dragonhead', 'driver_bunny', 'driver_fox', 'driver_frog',
  'driver_koala', 'driver_panda', 'driver_penguin', 'durian', 'ferris', 'flag',
  'flower', 'gantry', 'grandstand', 'jcrown', 'jtrunk', 'kart', 'lamp',
  'lighthouse', 'monkey_hang', 'monkey_sit', 'palm1', 'palm2', 'palm3', 'person',
  'plane', 'plant', 'rock1', 'rock2', 'rock3', 'rocket', 'shield', 'sign', 'star',
  'tikihead', 'tires', 'totem', 'tree_green', 'tree_green2', 'tree_pink',
  'trophy', 'umbrella',
  // Per-character kart bodies (alternate liveries).
  'kart_bunny_r13a', 'kart_fox_r13a', 'kart_frog_r13a', 'kart_koala_r13a',
  'kart_panda_r13a', 'kart_penguin_r13a',
];

/**
 * Load every model and return a plain `{ name: Object3D }` map.
 * `onProgress` receives a 0..1 fraction.
 */
export async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  const out = {};
  let done = 0;

  const loadOne = (name) =>
    new Promise((resolve) => {
      loader.load(
        `./models/${name}.glb`,
        (gltf) => {
          const root = gltf.scene;
          root.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
              // The exported materials use vertex colours for the decorative
              // props; keep them from blowing out under the tone mapper.
              if (o.material) {
                o.material.envMapIntensity = 0.9;
              }
            }
          });
          out[name] = root;
          done += 1;
          if (onProgress) onProgress(done / MODEL_NAMES.length);
          resolve();
        },
        undefined,
        () => {
          // A missing model must not stop the game; it just renders nothing.
          console.warn('[assets] could not load', name);
          done += 1;
          if (onProgress) onProgress(done / MODEL_NAMES.length);
          resolve();
        },
      );
    });

  // Load in small batches so the progress bar moves smoothly.
  const BATCH = 8;
  for (let i = 0; i < MODEL_NAMES.length; i += BATCH) {
    await Promise.all(MODEL_NAMES.slice(i, i + BATCH).map(loadOne));
  }
  return out;
}

/** Deep clone that keeps the geometry shared but gives every mesh a fresh material. */
export function cloneWithMaterials(src, shareMaterial = false) {
  const clone = src.clone(true);
  if (!shareMaterial) {
    clone.traverse((o) => {
      if (o.isMesh && o.material) o.material = o.material.clone();
    });
  }
  return clone;
}

/** A shared canvas texture for soft round shadows / blobs. */
export function radialShadowTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Build a canvas texture from a draw callback. */
export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
