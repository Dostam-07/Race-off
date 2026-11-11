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
];

export const ROSTER_IDS = ROSTER.map((r) => r.id);
export const driverKey = (id) => `driver_${id}`;
export const kartBodyKey = (id) => `kart_${id}_r13a`;

/** Per-character handling bias, used by the AI and shown on the setup screen. */
export const CHAR_TUNING = {
  fox: { grip: 1, accel: 1, label: 'Balanced' },
  bunny: { grip: 1.16, accel: 0.94, label: 'Handy' },
  frog: { grip: 0.94, accel: 1.1, label: 'Quick' },
  panda: { grip: 1.12, accel: 0.96, label: 'Grippy' },
  koala: { grip: 0.9, accel: 1.14, label: 'Fast' },
  penguin: { grip: 1.06, accel: 1.0, label: 'Steady' },
};

const PAINT_RE = /Paint|Body|Shell|Chassis|Sculpt/i;
const ACCENT_RE = /Accent|Trim|Stripe|Seat/i;

/**
 * Assemble a drivable kart. Returns the root group, the tilt sub-group (for
 * lean/pitch), the body model, and a `ud` bag of the parts the visuals touch.
 */
export function buildKart(A, charId) {
  const char = ROSTER.find((r) => r.id === charId) || ROSTER[0];

  // Prefer the dedicated livery, fall back to the recoloured base kart.
  const liveryKey = kartBodyKey(char.id);
  const useLivery = !!A[liveryKey];
  const src = useLivery ? A[liveryKey] : A.kart;
  const body = src.clone(true);

  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  tilt.add(body);

  const paintColor = new THREE.Color(char.paint);
  const accentColor = new THREE.Color(char.accent);

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
