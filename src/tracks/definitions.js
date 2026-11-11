// Race-Off - track definitions.
// Every track is authored the same way: a list of control points that a closed
// CatmullRom curve runs through, plus feature ranges measured in metres along
// that curve (gaps, ramps, boosts, coins, item boxes and sector labels).

import { smooth, lerp } from '../core/utils.js';

/** Deterministic 0..1 hash, used for the volcano's surface bumps. */
const hash1 = (n) => {
  const e = Math.sin(n * 91.7 + 3.1) * 43758.5453;
  return e - Math.floor(e);
};

// ---------------------------------------------------------------- volcano math
// Magma Peak is not authored as control points; it is generated: a spiral that
// climbs the cone, runs around the crater rim, then drops off the lip and falls
// back to the coast.

const DEG = Math.PI / 180;
const RIM_FROM = 10;
const RIM_TO = 410;
const FLOOR_R = 175 / Math.cos(RIM_FROM * DEG);
const TURNS = 590;
const TURN_R = 56;
const BASE_Z = -55;
const RIM_Y = 90;
const FLOOR_Y = 30;
const CLIFF_H = 83;

/** Rim radius as a function of the spiral angle (degrees). */
function spiralRadius(s) {
  const e = Math.min(1, Math.max(0, (s - RIM_FROM) / (RIM_TO - RIM_FROM)));
  return (
    FLOOR_R -
    (FLOOR_R - TURN_R) * Math.pow(Math.sin((e * Math.PI) / 2), 4) +
    6 *
      Math.sin((5 * s - 120) * DEG) *
      smooth(0.06, 0.2, e) *
      (1 - smooth(0.72, 0.92, e))
  );
}

const rimArc = [0];
{
  let s = 0;
  let prev = spiralRadius(RIM_FROM);
  for (let t = RIM_FROM + 1; t <= RIM_TO; t++) {
    const r = spiralRadius(t);
    s += Math.hypot(r - prev, ((r + prev) / 2) * DEG);
    prev = r;
    rimArc.push(s);
  }
}

/** Height of the spiral rim as a function of angle. */
function spiralHeight(s) {
  const e = Math.min(RIM_TO - RIM_FROM, Math.max(0, s - RIM_FROM));
  const t = Math.min(RIM_TO - RIM_FROM - 1, Math.floor(e));
  const n = (rimArc[t] + (rimArc[t + 1] - rimArc[t]) * (e - t)) / rimArc[rimArc.length - 1];
  return (
    3 +
    (RIM_Y - 3) * n +
    3.4 *
      Math.sin(n * Math.PI * 10) *
      smooth(0.1, 0.22, n) *
      (1 - smooth(0.8, 0.92, n))
  );
}

// Build the volcano control points and remember the named landmarks.
const volcanoPts = [];
const volcanoMarks = {};
const markAt = (s, e, t, n) => {
  if (n) volcanoMarks[n] = volcanoPts.length;
  volcanoPts.push([+s.toFixed(2), +e.toFixed(2), +t.toFixed(2)]);
};

markAt(0, 3, 120, 'start');
for (let s = 10; s < 405; s += 26 / spiralRadius(s) / DEG) {
  markAt(spiralRadius(s) * Math.sin(s * DEG), spiralHeight(s), BASE_Z + spiralRadius(s) * Math.cos(s * DEG));
}
markAt(TURN_R * Math.sin(RIM_TO * DEG), RIM_Y, BASE_Z + TURN_R * Math.cos(RIM_TO * DEG), 'rim');
for (let s = RIM_TO + 22.5; s < TURNS - 5; s += 22.5) {
  markAt(TURN_R * Math.sin(s * DEG), RIM_Y, BASE_Z + TURN_R * Math.cos(s * DEG));
}
markAt(TURN_R * Math.sin(TURNS * DEG), RIM_Y, BASE_Z + TURN_R * Math.cos(TURNS * DEG), 'turn');

// The lip: the road runs out over the crater, then falls away.
const lipX = TURN_R * Math.sin(TURNS * DEG) + 28 * Math.sin(TURNS * DEG);
const lipZ = BASE_Z + TURN_R * Math.cos(TURNS * DEG) + 28 * Math.cos(TURNS * DEG);
for (const [a, y] of [
  [217.5, 89.8],
  [205, 89.5],
  [192.5, 89.2],
  [180, 89],
]) {
  markAt(lipX - 28 * Math.sin(a * DEG), y, lipZ - 28 * Math.cos(a * DEG));
}
const dropZ = lipZ + 28;
const dropX = lipX - 30;
markAt(dropX - 12, 89, dropZ);
markAt(dropX + 6, 89, dropZ);
markAt(dropX, 89, dropZ, 'lip');
markAt(dropX - 8, 87.2, dropZ);
markAt(dropX - 34, 66, dropZ);
markAt(dropX - 64, 43.5, dropZ, 'land');
markAt(dropX - 90, 34.5, dropZ);
markAt(dropX - 120, 27, dropZ);

// The lower plateau: two hairpins down to the coast.
const g2x = dropX - 125;
const g2z = dropZ + 55;
markAt(dropX - 125, 26, dropZ);
for (const [a, y] of [
  [202.5, 25],
  [225, 23.8],
  [247.5, 22.4],
  [270, 21],
]) {
  markAt(g2x + 55 * Math.sin(a * DEG), y, g2z + 55 * Math.cos(a * DEG));
}
const g3x = g2x - 55;
markAt(g3x, 17.5, g2z + 35, 'g2');
markAt(g3x, 14, 45);
const coastX = g3x + 75;
for (const [a, y] of [
  [292.5, 11],
  [315, 8],
  [337.5, 5.5],
  [360, 4],
]) {
  markAt(coastX + 75 * Math.sin(a * DEG), y, 45 + 75 * Math.cos(a * DEG));
}
markAt(coastX + 24, 3.5, 120);
markAt(coastX + 49, 3.2, 120, 'g3');
markAt(-100, 3, 120);
markAt(-50, 3, 120);

// Volcanic "spurs" - the rocky shelf that juts from the cone's flank.
const volcanoSpur = (a, r, t) => {
  const n = a < 60 ? a + 360 : a;
  return (
    15 *
    smooth(262, 288, n) *
    (1 - smooth(384, 404, n)) *
    (0.45 + 0.9 * t) *
    smooth(37, 47, r) *
    (1 - smooth(51, 62, r))
  );
};

/** Height of the volcano cone (outside the road) at radius r / angle a. */
function volcanoTerrain(x, z, jitter, noise) {
  const y = volcanoSurface(x, z, jitter, noise);
  return Number.isFinite(y) ? Math.max(-40, Math.min(140, y)) : 0.45;
}

/** Raw volcano height field before clamping. */
function volcanoSurface(x, z, jitter, noise) {
  const dx = x - 0;
  const dz = z - BASE_Z;
  const r = Math.hypot(dx, dz);
  let a = Math.atan2(dx, dz) / DEG;
  if (a < 0) a += 360;
  if (r < TURN_R) return 30 + 2 * smooth(34, 42, r) + (RIM_Y - 30 - 2) * smooth(40, 47, r) + volcanoSpur(a, r, jitter);
  let outer = 0;
  let outerY = 0;
  let inner = TURN_R;
  let innerY = RIM_Y;
  const u = a >= RIM_FROM ? a : a + 360;
  const u2 = u + 360;
  const p = spiralRadius(u);
  const pp = spiralHeight(u);
  if (u2 <= RIM_TO) {
    const e = spiralRadius(u2);
    const b = spiralHeight(u2);
    if (r >= e) {
      outer = p; outerY = pp; inner = e; innerY = b;
    } else {
      outer = e; outerY = b;
    }
  } else {
    outer = p; outerY = pp;
  }
  if (r >= outer) {
    const width = Math.min(96 + 8 * jitter, 45 + 1.2 * innerY + 22 * jitter);
    const b = r - outer;
    if (b < width) return lerp(innerY, 0.45, smooth(0, width, b));
    return lerp(0.45, -10, smooth(width + 18 + 20 * jitter, width + 75 + 20 * jitter, b));
  }
  if (outer - inner < 1) return innerY;
  const m = (outer - r) / (outer - inner);
  const g = Math.sin(Math.PI * m);
  const h = Math.floor((a * DEG * outer) / 5);
  const bump =
    Math.min(24, 0.42 * (innerY - outerY)) *
    smooth(1, 12, outer - r) *
    smooth(9, 22, outerY) *
    (0.7 + 0.3 * hash1(h));
  return innerY + bump + (innerY - outerY - bump) * Math.pow(m, 1.8) +
    g * ((jitter - 0.5) * 9 + (noise - 0.5) * 5) + volcanoSpur(a, r, jitter);
}

// ---------------------------------------------------------------- sky track
// Sky Castle is a loop of floating islands; the road itself is a ribbon of glass.
const skyPts = [];
const skyMarks = {};
const SKY_SCALE = 0.86;
const skyAt = (s, e, t, n) => {
  if (n) skyMarks[n] = skyPts.length;
  skyPts.push([+(s * SKY_SCALE).toFixed(2), e, +(t * SKY_SCALE).toFixed(2)]);
};
skyAt(-90, 30, 100);
skyAt(-45, 30, 100);
skyAt(0, 30, 100, 'start');
skyAt(45, 30, 100);
skyAt(88, 31, 96);
skyAt(126, 33, 78);
skyAt(150, 36, 46);
skyAt(158, 39, 10);
skyAt(160, 41, -22, 'leap0');
skyAt(160, 41.5, -44, 'leap');
skyAt(160, 42, -66, 'leap1');
skyAt(156, 43.5, -96);
skyAt(138, 46, -126);
skyAt(104, 49, -146);
skyAt(62, 52, -156);
skyAt(22, 54, -158);
skyAt(-14, 56, -160, 'gate');
skyAt(-50, 57, -162);
skyAt(-86, 57, -162);
skyAt(-120, 56, -160, 'gate2');
skyAt(-150, 54, -148);
skyAt(-170, 52, -122);
skyAt(-178, 50, -88, 'wind0');
skyAt(-180, 48, -50);
skyAt(-180, 46, -14, 'wind1');
skyAt(-170, 44, 16);
skyAt(-142, 41, 36);
skyAt(-100, 37, 46);
skyAt(-62, 34, 50, 'dive');
skyAt(-38, 29.5, 51);
skyAt(-14, 25, 52, 'dland');
skyAt(12, 22, 52);
skyAt(34, 21, 52, 'loop0');
skyAt(80, 21, 33, 'loop1');
skyAt(104, 20.5, 33);
skyAt(140, 19.5, 36, 'under');
skyAt(176, 19.5, 40);
skyAt(204, 20, 62);
skyAt(224, 21, 96);
skyAt(214, 22.5, 130);
skyAt(184, 24, 152);
skyAt(152, 25, 160, 'storm0');
skyAt(132, 25, 160, 'cork0');
skyAt(72, 25, 160, 'cork1');
skyAt(48, 26, 160);
skyAt(20, 27, 160, 'sgap');
skyAt(-12, 28.5, 159);
skyAt(-60, 30, 156, 'storm1');
skyAt(-112, 30, 146);
skyAt(-140, 30, 124);
skyAt(-128, 30, 104);

// ---------------------------------------------------------------- track table

/** Coral Cove - the beach opener. Gently rolling, with a big wave and a lagoon. */
export const BEACH = {
  id: 'beach',
  name: 'BEACH BLAST',
  sub: 'CORAL COVE GRAND PRIX',
  loading: ['Raising the island', 'Planting palm trees'],
  ctrl: [
    [0, 2, 60],
    [70, 2, 60],
    [130, 2.3, 57],
    [192, 3, 63],
    [250, 4.2, 77],
    [295, 4.6, 80],
    [330, 4.6, 59],
    [344.6, 4.6, 17],
    [332, 4.6, -22],
    [300, 5, -55],
    [245, 6.2, -75],
    [192, 9, -76],
    [152, 12.5, -96],
    [122, 14.5, -134],
    [70, 16.5, -166],
    [0, 17.5, -174],
    [-75, 16.7, -158],
    [-108, 15.2, -160],
    [-140, 13.6, -161],
    [-175, 13.4, -159],
    [-208, 12.2, -149],
    [-236, 9.6, -131],
    [-256, 7.4, -111],
    [-275, 6.2, -92],
    [-289, 4.2, -70],
    [-295, 2.4, -42],
    [-296, 1.6, -10],
    [-294, 1.6, 30],
    [-286, 1.6, 62],
    [-262, 2.2, 88],
    [-228, 3.6, 96],
    [-190, 4.2, 90],
    [-150, 3, 74],
    [-110, 2.2, 63],
    [-60, 2, 60],
  ],
  volcano: { x: 5, z: -58, r: 105, h: 0 },
  bridge: (s, e) => (s < -168 && s > -236 && e > 70) || (s > 172 && s < 298 && e > 50),
  gorge: (s, e) => e < -150 && Math.abs(s) < 62,
  lagoon: (s) => smooth(50, 84, s) * (1 - smooth(162, 200, s)),
  lava: () => 0,
  gaps: [[1084.2, 1097.2]],
  fall: [948.2, 990.2],
  barrel: [1186.2, 1260.2],
  boxes: [95, 336, 628, 1023, 1298, 1478],
  pads: [
    [236, 0, 0],
    [474, 3, 0],
    [743, -3, 0],
    [1071.8, 0, 1, 7.4],
    [1172, 0, 0],
    [1431, 0, 1],
  ],
  coins: [
    [28, 5, 7, 0, 0, 0],
    [128, 5, 7, 3.5, -4, 0],
    [214, 5, 7, 0, 0, 0],
    [262, 5, 7, 4, -4, 0],
    [304, 5, 7, -3, -4.5, 0],
    [388, 5, 7, -4, -4, 0],
    [440, 5, 7, -4, 3, 0],
    [506, 5, 7, 3.5, -3.5, 0],
    [566, 4, 7, 0, 4, 0],
    [664, 5, 7, 0, -4, 0],
    [708, 4, 7, -4, -4.5, 0],
    [786, 6, 7, -3.5, 3.5, 0],
    [830, 6, 7, 3.5, -3.5, 0],
    [900, 5, 7, -4, -2, 0],
    [952, 6, 6.5, 0, 0, 0],
    [1004, 3, 7, -3, -4, 0],
    [1084.2, 3, 6.5, 0, 0, 1],
    [1126, 5, 7, -2, -4, 0],
    [1192, 5, 7, -3.5, 3.5, 0],
    [1228, 5, 7, 3.5, -3.5, 0],
    [1284, 4, 7, -4, -4.5, 0],
    [1354, 6, 7, 0, 0, 0],
    [1443, 3, 6.5, 0, 0, 1],
    [1507, 4, 8, -3.2, -3.2, 0],
    [1507, 4, 8, 3.2, 3.2, 0],
  ],
  sections: [
    [54, 'DOLPHIN LAGOON', '#12c4d6', '#0b7fd0'],
    [204, 'LANTERN PIER', '#ffb347', '#e0562a'],
    [556, 'PALM HILL', '#19b56b', '#0c7a52'],
    [726, 'CRYSTAL CAVE', '#a04cff', '#3a1fa8'],
    [914, 'THUNDER FALLS', '#19c8e8', '#0b6fd0'],
    [1004, 'SHIPWRECK COVE', '#ffb02e', '#c0562a'],
    [1160, 'THE BIG WAVE', '#12d6c4', '#0b7fd0'],
    [1420, 'FINAL STRAIGHT', '#ff7a1a', '#e0243c'],
  ],
  flags: [
    [20, 48, [-1, 1]],
    [604, 640, [-1, 1]],
    [1424, 1531, [1]],
    [1424, 1465, [-1]],
  ],
  fans: [
    [40, 66, 1], [40, 66, -1],
    [446, 474, 1], [446, 474, -1],
    [500, 526, 1],
    [624, 644, -1],
    [712, 738, 1], [712, 738, -1],
    [1114, 1138, -1],
    [1418, 1438, 1], [1418, 1438, -1],
    [1467, 1495, 1], [1467, 1495, -1],
  ],
  stands: [
    [-52, -1], [-22, -1], [8, -1], [-37, 1],
  ],
  hints: { turbo: [20, 60], drift: [286, 330] },
  intro: {
    p0: [-335, 100, 215],
    p1: [-235, 58, 135],
    l0: [-70, 22, 0],
    l1: [-25, 22, -30],
  },
  shadow: { wide: [-20, 5, -40], title: [-14, 2, 60], intro: [-10, 2, 60] },
  start: [-20, 60],
  palette: ['#434a5e', '#33303c', '#f2e2c0', '#d9c79a', '#7fa463', '#5e8a4a', '#3a2a1e'],
  water: 'beach',
};

/** Thunder Temple - mud, rope bridges, a river of rapids and a gorge. */
export const JUNGLE = {
  id: 'jungle',
  name: 'JUNGLE DASH',
  sub: 'THUNDER TEMPLE GRAND PRIX',
  loading: ['Growing the jungle', 'Waking the temple'],
  ctrl: [
    [0, 5, 90],
    [70, 5, 90],
    [135, 5.4, 82],
    [182, 6.5, 55],
    [200, 8.5, 10],
    [185, 11, -35],
    [145, 13, -62],
    [95, 14, -60],
    [55, 15, -80],
    [47, 17, -116],
    [57, 20, -155],
    [95, 23, -185],
    [112, 26, -225],
    [90, 29, -262],
    [45, 30, -275],
    [-10, 29, -262],
    [-60, 26, -235],
    [-110, 22, -215],
    [-165, 18, -205],
    [-215, 14, -180],
    [-240, 11, -135],
    [-235, 9, -85],
    [-215, 7, -40],
    [-205, 5, 10],
    [-180, 4, 55],
    [-130, 4.6, 84],
    [-60, 5, 90],
  ],
  volcano: { x: 0, z: -120, r: 100, h: 0 },
  bridge: (s, e) => s > -100 && s < -25 && e < -205,
  gorge: (s, e) => s > 150 && s < 30 && e > -45,
  lagoon: (s) => smooth(548 - 30, 548, s) * (1 - smooth(716, 716 + 30, s)),
  lava: () => 0,
  gaps: [
    [676, 688],
    [810, 822],
  ],
  mud: [
    [338, 360, -7.2, -0.8],
    [384, 404, 0.8, 7.2],
    [440, 456, -7.2, -1.6],
    [486, 502, 1.2, 7.2],
  ],
  boxes: [112, 425, 742, 900, 1330],
  pads: [
    [150, 0, 1],
    [318, 3, 0],
    [666.7, 0, 1, 10.7],
    [800.7, 0, 1, 8.3],
    [1040, -4, 1, 3.2],
    [1258, 0, 1, 4.4],
    [1318, 0, 0],
  ],
  coins: [
    [26, 6, 7, 0, 0, 0],
    [160, 5, 5, 0, 0, 1],
    [236, 7, 7, -4, 4, 0],
    [344, 4, 6, 4, 4, 0],
    [390, 4, 6, -4, -4, 0],
    [452, 4, 6, 4, 4, 0],
    [590, 7, 7, -3.5, 3.5, 0],
    [642, 4, 6, 3.5, 0, 0],
    [675, 6, 3.2, 0, 0, 1],
    [772, 4, 7, 0, 0, 0],
    [809, 6, 3.2, 0, 0, 1],
    [834, 3, 7, 0, 0, 0],
    [960, 5, 8, 5, 5, 0],
    [1050, 5, 5, -4, -4, 1],
    [1110, 5, 8, -5, 4, 0],
    [1206, 6, 8, -4, 1, 0],
    [1268, 5, 3.2, 0, 0, 1],
  ],
  sections: [
    [58, 'VINE VALLEY', '#19b56b', '#0c7a52'],
    [204, 'TEMPLE RUINS', '#d9a23a', '#7a5a14'],
    [330, 'MUD MARSH', '#a8743a', '#5a3a18'],
    [520, 'CANOPY ROAD', '#5ec45a', '#1f6b2a'],
    [766, 'ROPE BRIDGE', '#e0b46a', '#7a4a1c'],
    [916, 'BOULDER RUN', '#e2553a', '#7a2414'],
    [1158, 'RIVER RAPIDS', '#39c6d6', '#12707e'],
  ],
  flags: [[20, 48, [-1, 1]]],
  fans: [
    [40, 66, 1],
    [40, 66, -1],
  ],
  stands: [
    [-52, -1], [-22, -1], [8, -1], [-37, 1],
  ],
  hints: { turbo: [20, 60], drift: [170, 210] },
  intro: {
    p0: [-264, 134, 428],
    p1: [-90, 30, 150],
    l0: [40, 30, -140],
    l1: [-10, 10, 80],
  },
  shadow: { wide: [0, 5, -60], title: [-14, 5, 90], intro: [-10, 5, 90] },
  start: [-20, 90],
  palette: ['#6b5a3a', '#4a3a26', '#3f9a34', '#1c6b2e', '#6f7a5e', '#525c48', '#3a2c2a'],
  water: 'jungle',
  rapids: [[562, 588, 1, 11.6], [620, 654, 1, 11.6], [792, 838, 1, 8.5], [792, 838, -1, 8.5]],
};

/** Magma Peak - a night race on a live volcano. */
export const VOLCANO = {
  id: 'volcano',
  name: 'VOLCANO RUSH',
  sub: 'MAGMA PEAK NIGHT RACE',
  loading: ['Waking the volcano', 'Lighting the torches'],
  ctrl: volcanoPts,
  volcano: { x: 0, z: BASE_Z, r: 190, h: RIM_Y },
  marks: volcanoMarks,
  bridge: () => false,
  gorge: () => false,
  lagoon: () => 0,
  lava: (s) =>
    0.12 +
    0.43 * smooth(170, 260, s) * (1 - smooth(540, 620, s)) +
    0.13 * smooth(540, 620, s) +
    0.75 * smooth(volcanoMarks.rim - 70, volcanoMarks.rim, s) -
    0.6 * smooth(volcanoMarks.g3 + 20, volcanoMarks.g3 + 80, s),
  palette: ['#4b5068', '#2b2d42', '#4a5170', '#3c4360', '#565d7a', '#383d57', '#1b1c2a'],
  gaps: [], // filled in below once the curve lengths are known
  noBarrier: (s, e) =>
    e > 0 ? s > 185 && s < volcanoMarks.rim - 14 : s > volcanoMarks.rim + 8 && s < volcanoMarks.turn - 10,
  shapeTerrain(x, z, jitter, noise) {
    return volcanoTerrain(x, z, jitter, noise);
  },
  boxes: [110, 0, 0, 0, 0, 0], // patched below
  pads: [
    [150, -3, 0],
    [0, 3, 0],
    [0, -3, 0],
    [0, 0, 0],
    [0, -2, 0],
    [0, 0, 0],
    [0, 0, 0, 7.4],
    [0, 0, 1, 11.6],
    [0, 0, 1, 7.4],
    [0, 0, 1, 7.4],
    [0, 0, 0],
  ],
  coins: [],
  sections: [],
  flags: [[20, 48, [-1, 1]]],
  fans: [],
  stands: [
    [-52, -1], [-22, -1], [8, -1], [-37, 1],
  ],
  hints: { turbo: [20, 60], drift: [150, 200] },
  intro: {
    p0: [-380, 150, 300],
    p1: [-150, 60, 215],
    l0: [0, 70, -55],
    l1: [-10, 12, 100],
  },
  shadow: { wide: [0, 5, -10], title: [-14, 3, 120], intro: [-10, 3, 120] },
  start: [-20, 120],
  water: 'lava',
  _volcano: true,
};

/** Sky Castle - the floating-island finale. */
export const SKY = {
  id: 'sky',
  name: 'SKY SPRINT',
  sub: 'SKY CASTLE NIGHT FINALE',
  loading: ['Lifting the islands', 'Polishing the glass road'],
  ctrl: skyPts,
  volcano: { x: -60, z: -40, r: 100, h: 0 },
  marks: skyMarks,
  bridge: () => false,
  gorge: () => false,
  lagoon: () => 0,
  lava: () => 0,
  palette: ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff'],
  gaps: [],
  boxes: [],
  hide: [],
  rails: [],
  pads: [],
  coins: [],
  sections: [],
  flags: [],
  fans: [],
  stands: [
    [-52, -1], [-22, -1], [8, -1], [-37, 1],
  ],
  noGround: true,
  hints: { turbo: [20, 60], drift: [70, 130] },
  intro: {
    p0: [-220, 140, 260],
    p1: [-60, 48, 150],
    l0: [-45, 60, -140],
    l1: [-10, 30, 86],
  },
  shadow: { wide: [0, 30, -20], title: [-14, 30, 86], intro: [-10, 30, 86] },
  start: [-20, 86],
  water: 'sky',
  _sky: true,
};

export const TRACKS = { beach: BEACH, jungle: JUNGLE, volcano: VOLCANO, sky: SKY };
export const TRACK_ORDER = ['beach', 'jungle', 'volcano', 'sky'];

export const volcanoMeta = { RIM_Y, RIM_TO, TURNS, TURN_R, BASE_Z, marks: volcanoMarks };
