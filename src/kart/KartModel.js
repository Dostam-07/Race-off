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
// Turn a species id into a readable animal bust. The six shipped GLB drivers
// carry their own art; the procedural path exists so adding a racer to the
// roster never leaves a blank face on the grid or in the picker.
// --- procedural racers -------------------------------------------------------
//
// The six original racers ship as GLB models and share one silhouette: a
// seated body group plus a head group, standing about 1.3 units tall with the
// body resting at y = 0.23, so the head sits clear of the steering wheel. A
// racer added to the roster without art must match those proportions or it
// reads as sunk into the seat - so this builder mirrors the same measurements
// while adding rounded, cartoonier forms than plain boxes.

const SHAPES = new Map();
function geo(key, make) {
  let g = SHAPES.get(key);
  if (!g) { g = make(); SHAPES.set(key, g); }
  return g;
}

function part(parent, g, mat, [x, y, z], name, rot, scale) {
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scale) m.scale.set(scale[0], scale[1], scale[2]);
  if (name) m.name = name;
  parent.add(m);
  return m;
}

/**
 * Build a seated animal racer. Matches the shipped drivers' scale (body from
 * y 0.23, total height ~1.3-1.6) so every racer sits in the kart the same way.
 * Cartoon treatment: rounded capsules, big eyes, soft muzzle - not box parts.
 */
export function fallbackDriver(paint, accent, species) {
  const root = new THREE.Group();
  // Shipped racers put the head between y 0.9 and 1.8 after the kart's 0.02
  // seat offset. Author at the same height so nobody looks sunk in the seat.
  root.scale.setScalar(1.1);
  const skin = new THREE.MeshLambertMaterial({ color: paint });
  const trim = new THREE.MeshLambertMaterial({ color: accent });
  const dark = new THREE.MeshLambertMaterial({ color: 0x241a13 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x14131a });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const cream = new THREE.MeshLambertMaterial({ color: 0xf6efe2 });

  const isLion = species === 'lion';

  // --- BODY: the seated torso, the same group the shipped drivers use.
  const body = new THREE.Group();
  body.name = 'Body';
  body.position.set(0, 0.23, 0);
  root.add(body);

  const torso = part(
    body,
    geo('torso', () => new THREE.CapsuleGeometry(0.2, 0.26, 6, 14)),
    trim, [0, 0.28, 0],
  );
  torso.scale.set(1.06, 1, 0.92);

  // Arms reaching forward to the wheel, with paws on the rim. Without these
  // the figure just floats in the seat instead of driving the kart.
  for (const sx of [-1, 1]) {
    const arm = part(body, geo('arm', () => new THREE.CapsuleGeometry(0.062, 0.2, 4, 10)),
      skin, [sx * 0.19, 0.36, 0.1]);
    arm.rotation.set(-0.85, 0, sx * 0.16);
    // Paw gripping the wheel.
    part(body, geo('paw', () => new THREE.SphereGeometry(0.075, 12, 10)), skin,
      [sx * 0.16, 0.3, 0.27], null, [1, 0.9, 1.1]);
  }

  // --- HEAD: the shipped racers keep head parts under a `Head` group so the
  // visuals can bob it; keep that contract.
  const head = new THREE.Group();
  head.name = 'Head';
  head.position.set(0, 0.80, 0.02);
  root.add(head);

  const skullGeo = geo('skull', () => new THREE.SphereGeometry(0.26, 20, 16));
  const skull = part(head, skullGeo, skin, [0, 0.18, 0]);
  skull.scale.set(1, 0.96, 0.98);

  // Muzzle: a rounded snout that pushes forward from the skull.
  const muzzle = part(head, geo('muzzle', () => new THREE.SphereGeometry(0.13, 16, 12)),
    isLion ? cream : trim, [0, 0.1, 0.2]);
  muzzle.scale.set(1.16, 0.82, 1.0);

  // Nose pad.
  part(head, geo('nose', () => new THREE.SphereGeometry(0.052, 12, 10)), dark,
    [0, 0.14, 0.31], null, [1.3, 0.9, 1]);

  // Eyes: big and round with a specular dot - this is what sells the face.
  const eyeGeo = geo('eye', () => new THREE.SphereGeometry(0.055, 14, 12));
  const glintGeo = geo('glint', () => new THREE.SphereGeometry(0.018, 8, 8));
  for (const sx of [-1, 1]) {
    part(head, eyeGeo, eyeMat, [sx * 0.1, 0.23, 0.21], 'Eyes');
    part(head, glintGeo, glintMat, [sx * 0.1 + 0.018, 0.248, 0.252]);
  }

  if (isLion) {
    // Raja: a shaggy mane built from overlapping cones around the face.
    const maneGroup = new THREE.Group();
    maneGroup.name = 'Mane';
    maneGroup.position.set(0, 0.0, -0.06);
    head.add(maneGroup);
    const tuft = geo('tuft', () => new THREE.ConeGeometry(0.1, 0.26, 8));
    const rings = [
      { r: 0.3, n: 12, y: 0.18, lean: 0.55 },
      { r: 0.34, n: 14, y: 0.05, lean: 0.9 },
      { r: 0.3, n: 11, y: 0.32, lean: 0.3 },
    ];
    for (const ring of rings) {
      for (let i = 0; i < ring.n; i++) {
        const a = (i / ring.n) * Math.PI * 2 + ring.y;
        const m = part(maneGroup, tuft, dark,
          [Math.cos(a) * ring.r, ring.y, Math.sin(a) * ring.r * 0.72]);
        // Point each cone outward, away from the face.
        m.rotation.set(ring.lean, 0, -a + Math.PI / 2);
      }
    }
    // Round ears poking above the mane.
    const earGeo = geo('earRound', () => new THREE.SphereGeometry(0.085, 12, 10));
    for (const sx of [-1, 1]) {
      const e = part(head, earGeo, skin, [sx * 0.2, 0.4, -0.02], sx < 0 ? 'Wob_EarL' : 'Wob_EarR');
      e.scale.set(1, 1, 0.55);
      part(head, earGeo, cream, [sx * 0.2, 0.4, 0.02], null, [0.55, 0.55, 0.3]);
    }
    // Chin scruff + tail.
    part(head, geo('scruff', () => new THREE.SphereGeometry(0.1, 12, 10)), trim,
      [0, -0.02, 0.12], null, [1, 0.7, 0.8]);
    const tail = part(body, geo('tail', () => new THREE.CapsuleGeometry(0.045, 0.3, 4, 10)),
      skin, [0, 0.42, -0.24], 'Wob_Tail', [-0.5, 0, 0]);
    const tip = part(body, geo('tailtip', () => new THREE.SphereGeometry(0.07, 12, 10)),
      dark, [0, 0.54, -0.36]);
    tip.name = 'Wob_TailTip';
  } else {
    // Rusty: long snout, floppy ears hanging past the jaw, pale blaze.
    muzzle.scale.set(1.0, 0.75, 1.35);
    muzzle.position.set(0, 0.08, 0.23);
    part(head, geo('snoutTip', () => new THREE.SphereGeometry(0.1, 14, 12)), trim,
      [0, 0.09, 0.3], null, [1.05, 0.8, 1.1]);
    // Blaze between the eyes.
    part(head, geo('blaze', () => new THREE.SphereGeometry(0.075, 12, 10)), cream,
      [0, 0.27, 0.19], null, [0.7, 1.5, 0.5]);

    // Floppy ears: flattened capsules that HANG from the sides of the skull
    // and hang past the jaw, the way a hound's do. Anchored high on the head
    // and angled outward so the tips droop below the muzzle line.
    const earGeo = geo('earFloppy', () => new THREE.CapsuleGeometry(0.085, 0.24, 5, 10));
    for (const sx of [-1, 1]) {
      const ear = new THREE.Group();
      ear.name = sx < 0 ? 'Wob_EarL' : 'Wob_EarR';
      ear.position.set(sx * 0.21, 0.34, 0.0);
      head.add(ear);
      const e = new THREE.Mesh(earGeo, trim);
      e.castShadow = true;
      // Hangs down and slightly out from the pivot.
      e.position.set(sx * 0.05, -0.15, 0.0);
      e.rotation.z = sx * 0.30;
      e.scale.set(0.5, 1.15, 1.0);
      ear.add(e);
    }

    const tail = part(body, geo('dogtail', () => new THREE.CapsuleGeometry(0.04, 0.26, 4, 10)),
      skin, [0, 0.44, -0.18], 'Wob_Tail', [-1.0, 0, 0]);
    tail.scale.set(1, 1, 1);
  }

  // Brow ridge gives both species a determined expression.
  part(head, geo('brow', () => new THREE.BoxGeometry(0.24, 0.03, 0.05)), skin,
    [0, 0.3, 0.2], null, [1, 1, 1]);

  return root;
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
    driver = fallbackDriver(char.paint, char.accent, char.id);
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
