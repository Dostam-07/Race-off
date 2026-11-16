// Race-Off - the character roster and the kart model assembly.
//
// Real GLB structure (verified against the shipped files):
//   driver_<id>.glb : Wob_Tail, Body, Eyes, Wob_EarL, Wob_EarR, Head
//                     materials Fur, Cream, Scarf, SuitDark, Gold, Glove, ...
//   kart_<id>_r13a.glb : chassis, Head, wheel_FL/FR/RL/RR, Wob_Tail
//                     materials Sculpt_angry_cat (a single baked livery)
//   kart.glb : KartBody, wheel_FL..RR
//                     materials Paint, Accent, Chrome, Headlight,
//                     ExhaustGlow, DarkMetal, Taillight, Seat, Rubber, RimDark

import * as THREE from 'three';

/**
 * The six racers. `paint` recolours the plain `kart.glb` body, `accent` its
 * trim, and `css` drives the racer-picker button.
 */
export const ROSTER = [
  { id: 'fox', name: 'Blaze', kind: 'the Fox', paint: 0xe8301e, accent: 0xffffff, css: '#ff3b2e' },
  { id: 'bunny', name: 'Luna', kind: 'the Rabbit', paint: 0xff8fc4, accent: 0xffffff, css: '#ff6fb5' },
  { id: 'frog', name: 'Turbo', kind: 'the Turtle', paint: 0x3fc23f, accent: 0xffd21e, css: '#4fd44f' },
  { id: 'panda', name: 'Misty', kind: 'the Cat', paint: 0x9a4cf0, accent: 0xffffff, css: '#a05cff' },
  { id: 'koala', name: 'Rocky', kind: 'the Raccoon', paint: 0xffd21e, accent: 0x9a3a10, css: '#ffd21e' },
  { id: 'penguin', name: 'Zoomy', kind: 'the Penguin', paint: 0x2f8cff, accent: 0xffd21e, css: '#3b82ff' },
  { id: 'dog', name: 'Rusty', kind: 'the Hound', paint: 0xa4642f, accent: 0xffe0b0, css: '#c07a3f' },
  { id: 'lion', name: 'Raja', kind: 'the Lion', paint: 0xf0a01e, accent: 0x7a3f10, css: '#ffb020' },
];

export const ROSTER_IDS = ROSTER.map((r) => r.id);
export const driverKey = (id) => `driver_${id}`;
export const kartBodyKey = (id) => `kart_${id}_r13a`;

/** Characters that have earned rewards, persisted in the browser.
 *  Shape: { gold: ['fox', ...] } - gold = champion rim livery from a GP win. */
export function getUnlocks() {
  try {
    const u = JSON.parse(localStorage.getItem('ro-unlocks') || '{}');
    return u && Array.isArray(u.gold) ? u : { gold: [] };
  } catch {
    return { gold: [] };
  }
}

/** Record an unlock; returns true when it is newly earned. */
export function addUnlock(kind, id) {
  const u = getUnlocks();
  u[kind] = u[kind] || [];
  if (u[kind].includes(id)) return false;
  u[kind].push(id);
  try {
    localStorage.setItem('ro-unlocks', JSON.stringify(u));
  } catch { /* private mode */ }
  return true;
}

/** Per-character handling bias, used by the AI and shown on the setup screen. */
export const CHAR_TUNING = {
  fox: { grip: 1, accel: 1, label: 'Balanced' },
  bunny: { grip: 1.16, accel: 0.94, label: 'Handy' },
  frog: { grip: 0.94, accel: 1.1, label: 'Quick' },
  panda: { grip: 1.12, accel: 0.96, label: 'Grippy' },
  koala: { grip: 0.9, accel: 1.14, label: 'Fast' },
  penguin: { grip: 1.06, accel: 1.0, label: 'Steady' },
  dog: { grip: 1.08, accel: 1.02, label: 'Bold' },
  lion: { grip: 0.92, accel: 1.12, label: 'Roaring' },
};

const PAINT_RE = /Paint|Body|Shell|Chassis|Sculpt/i;
const ACCENT_RE = /Accent|Trim|Stripe|Seat/i;

/** Last-resort kart body when even the base model failed to load. */
function fallbackKartMesh(paint, accent) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.5, 1.7),
    new THREE.MeshLambertMaterial({ color: paint }),
  );
  body.position.y = 0.45;
  body.castShadow = true;
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.35, 0.5),
    new THREE.MeshLambertMaterial({ color: accent }),
  );
  seat.position.set(0, 0.85, -0.2);
  g.add(body, seat);
  return g;
}

/** A blocky driver figure for racers that have no `driver_<id>.glb` yet.
 *  Keeps every kart on the grid looked-inhabited, and reuses the same
 *  `Wob_*` naming so the ear/tail wobble code drives it unchanged. */
function fallbackDriver(paint, accent) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: paint });
  const trim = new THREE.MeshLambertMaterial({ color: accent });

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.4), skin);
  head.name = 'Head';
  head.position.set(0, 0.52, 0.06);
  head.castShadow = true;

  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.18), trim);
  muzzle.position.set(0, 0.44, 0.26);

  const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.04), new THREE.MeshBasicMaterial({ color: 0x101014 }));
  eyes.name = 'Eyes';
  eyes.position.set(0, 0.58, 0.26);

  const earL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.2, 0.08), skin);
  earL.name = 'Wob_EarL';
  earL.position.set(-0.14, 0.74, 0.05);
  const earR = earL.clone();
  earR.name = 'Wob_EarR';
  earR.position.x = 0.14;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.28), trim);
  torso.position.set(0, 0.24, 0);
  torso.castShadow = true;

  g.add(head, muzzle, eyes, earL, earR, torso);
  return g;
}

/**
 * Assemble a drivable kart. Returns the root group, the tilt sub-group (for
 * lean/pitch), the body model, and a `ud` bag of the parts the visuals touch.
 */
export function buildKart(A, charId, opts = {}) {
  const char = ROSTER.find((r) => r.id === charId) || ROSTER[0];

  // Prefer the dedicated livery, fall back to the recoloured base kart, and
  // finally to a primitive box kart so a missing model can never make a
  // racer invisible on the grid.
  const paintColor = new THREE.Color(char.paint);
  const accentColor = new THREE.Color(char.accent);
  const liveryKey = kartBodyKey(char.id);
  const useLivery = !!A[liveryKey];
  const src = useLivery ? A[liveryKey] : A.kart;
  const body = src
    ? src.clone(true)
    : fallbackKartMesh(paintColor, accentColor);

  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  tilt.add(body);

  // A dedicated livery is already baked with the character's colours, so only
  // the shared `kart.glb` gets repainted.
  const paintMats = [];
  let glowMat = null;
  let head = null;

  body.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = false;
    o.material = o.material.clone();
    const mat = o.material;
    const mname = mat.name || '';
    const id = `${mname} ${o.name}`;

    if (!useLivery) {
      if (PAINT_RE.test(id)) mat.color.copy(paintColor);
      else if (ACCENT_RE.test(id)) mat.color.copy(accentColor);
    }
    // Champion livery: gold rims earned by winning a Grand Prix.
    if (opts.gold && /Rim/i.test(mname)) {
      mat.color.set('#ffd21e');
      mat.metalness = 1;
      mat.roughness = 0.3;
      if (mat.emissive) mat.emissive.set('#3a2a00');
    }
    if (/Paint|Sculpt/i.test(mname)) paintMats.push(mat);
    if (/ExhaustGlow|Headlight|Taillight/i.test(mname)) glowMat = mat;
  });

  if (!head) head = body.getObjectByName('Head');

  // --- wheels, found by the exported node names
  const wheels = [];
  for (const n of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']) {
    const w = body.getObjectByName(n);
    if (w) wheels.push(w);
  }
  if (wheels.length === 0) {
    body.traverse((o) => { if (/^wheel/i.test(o.name)) wheels.push(o); });
  }

  // --- driver figure
  const driverSrc = A[driverKey(char.id)];
  let driver = null;
  let driverEyes = null;
  const wob = [];

  if (driverSrc) {
    driver = driverSrc.clone(true);
  } else {
    driver = fallbackDriver(char.paint, char.accent);
  }
  {
    driver.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.material = o.material.clone();
      }
    });
    if (driver.getObjectByName('Eyes')) driverEyes = driver.getObjectByName('Eyes');
    if (driver.getObjectByName('Head')) head = driver.getObjectByName('Head');
    for (const o of driver.children) {
      if (/^Wob_/.test(o.name)) {
        o.userData.w = {
          x: 0, z: 0, vx: 0, vz: 0, ph: Math.random() * 6.28,
          amp: /Ear|Tail/i.test(o.name) ? 1 : 0.6,
        };
        wob.push(o);
      }
    }
    driver.position.y = 0.02;
    body.add(driver);
  }

  // Champion reward: a spinning gold star floats above the kart.
  let champStar = null;
  if (opts.gold && A.star) {
    champStar = A.star.clone(true);
    champStar.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.material = (Array.isArray(o.material) ? o.material[0] : o.material).clone();
        o.material.color.set('#ffd21e');
        if (o.material.emissive) o.material.emissive.set('#7a5200');
        o.material.metalness = 1;
        o.material.roughness = 0.25;
      }
    });
    champStar.scale.setScalar(0.55);
    champStar.position.set(0, 2.6, 0);
    root.add(champStar);
  }

  const ud = {
    paint: paintMats[0] || null,
    paints: paintMats,
    glow: glowMat,
    wheels,
    driver,
    body,
    head,
    eyes: driverEyes,
    wob,
    starOn: false,
    champStar,
  };

  return { root, tilt, model: body, ud, wheels };
}

/** Flat blob shadow for parked karts (menus, grid). */
export function makeBlobShadow(map) {
  const geo = new THREE.PlaneGeometry(2.6, 3.6);
  const mat = new THREE.MeshBasicMaterial({
    map,
    color: 0x000000,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.05;
  mesh.renderOrder = 1;
  return mesh;
}
