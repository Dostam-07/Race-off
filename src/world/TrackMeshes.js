// Race-Off - the road itself.
//
// Everything is built from `track.ribbon()`, which sweeps a 2D profile
// ([lateralOffset, height] pairs) along a range of track samples. That one
// primitive gives us the tarmac, the kerbs, the walls, the bridges and the
// giant glass tube of Sky Castle.
//
// Geometry facts taken from the original:
//   ROAD_HALF  = 7.5   (ci) - edge of the driving surface
//   KERB_W     = 1.2   (wo) - width of the striped run-off
//   wall inner = 12.9 * scale, outer = +0.5 * scale
//   bridge deck sits at -1.3 with the ribbon starting at R = 10.1

import * as THREE from 'three';
import { wrapIdx, smooth } from '../core/utils.js';

export const ROAD_HALF = 7.5;
export const KERB_W = 1.2;
export const ROAD_EDGE = ROAD_HALF + KERB_W; // 8.7

const C = {
  beach: {
    road: '#434a5e', roadSpeck: '#6b7590', kerbA: '#f2283a', kerbB: '#fafafa',
    wall: '#fafbff', wallTop: '#f2283a', bridge: '#f4e6c6', rail: '#ffd24a',
  },
  jungle: {
    road: '#4a4539', roadSpeck: '#6d6450', kerbA: '#e8a81c', kerbB: '#3a2a1c',
    wall: '#6b4a2a', wallTop: '#c9a35a', bridge: '#8a6a44', rail: '#c9a35a',
  },
  volcano: {
    road: '#33303c', roadSpeck: '#5a5568', kerbA: '#ff5a12', kerbB: '#2a2228',
    wall: '#241d24', wallTop: '#ff4a14', bridge: '#2c2224', rail: '#ff7a1a',
  },
  sky: {
    road: '#33303c', roadSpeck: '#5a5568', kerbA: '#b9a6ff', kerbB: '#fafafa',
    wall: '#ffffff', wallTop: '#b9a6ff', bridge: '#cfd8f0', rail: '#ffd24a',
  },
};

/** Track-editor style palette lookup so a new track only needs a `look` key. */
function scheme(def) {
  return C[def.look] || C[def.id] || C.beach;
}

// ---------------------------------------------------------------- textures
function makeCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** The tarmac: base colour, aggregate speckle, cracks and lane markings. */
function roadTexture(s) {
  return makeCanvas(1024, 2048, (v, W, H) => {
    v.fillStyle = s.road;
    v.fillRect(0, 0, W, H);
    for (let i = 0; i < 90000; i++) {
      const g = (50 + Math.random() * 70) | 0;
      v.fillStyle = `rgba(${g},${g + 6},${g + 20},${0.22 + Math.random() * 0.3})`;
      v.fillRect(Math.random() * W, Math.random() * H, 1.6, 1.6 + Math.random() * 2.4);
    }
    for (let i = 0; i < 26; i++) {
      v.fillStyle = `rgba(${Math.random() < 0.5 ? '20,22,34' : '120,128,150'},${0.05 + Math.random() * 0.06})`;
      v.beginPath();
      v.ellipse(Math.random() * W, Math.random() * H, 30 + Math.random() * 90, 60 + Math.random() * 200, 0, 0, 7);
      v.fill();
    }
    // Tar seams.
    v.strokeStyle = 'rgba(14,15,24,0.18)';
    v.lineWidth = 9;
    for (let i = 0; i < 7; i++) {
      const z = W * (0.2 + Math.random() * 0.6);
      v.beginPath();
      v.moveTo(z, 0);
      v.bezierCurveTo(z + 60, H * 0.3, z - 60, H * 0.7, z, H);
      v.stroke();
      v.beginPath();
      v.moveTo(z + 38, 0);
      v.bezierCurveTo(z + 98, H * 0.3, z - 22, H * 0.7, z + 38, H);
      v.stroke();
    }
    // Edge darkening so the road reads as recessed.
    const g = v.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.22)');
    g.addColorStop(0.18, 'rgba(0,0,0,0)');
    g.addColorStop(0.82, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    v.fillStyle = g;
    v.fillRect(0, 0, W, H);
    // Wheel-worn bands.
    v.fillStyle = 'rgba(30,32,44,0.16)';
    v.fillRect(W * 0.27, 0, W * 0.1, H);
    v.fillRect(W * 0.63, 0, W * 0.1, H);
    // White edge lines.
    v.fillStyle = '#f6f7fb';
    v.fillRect(W * 0.035, 0, W * 0.018, H);
    v.fillRect(W * (1 - 0.053), 0, W * 0.018, H);
    // Coloured outer line.
    v.fillStyle = s.kerbA;
    v.fillRect(W * 0.012, 0, W * 0.014, H);
    v.fillRect(W * (1 - 0.026), 0, W * 0.014, H);
  });
}

/** Red/white striped kerb. */
function kerbTexture(s) {
  return makeCanvas(64, 64, (v, W, H) => {
    v.fillStyle = s.kerbA;
    v.fillRect(0, 0, W, H / 2);
    v.fillStyle = s.kerbB;
    v.fillRect(0, H / 2, W, H / 2);
  });
}

/** Barrier: a dark body with the accent band along the top. */
function wallTexture(s) {
  return makeCanvas(64, 64, (v, W, H) => {
    v.fillStyle = s.wall;
    v.fillRect(0, 0, W, H);
    v.fillStyle = s.wallTop;
    v.fillRect(0, 0, W, H / 2);
    v.fillStyle = 'rgba(0,0,0,0.12)';
    v.fillRect(0, 0, W, 2);
    v.fillRect(0, H / 2, W, 2);
  });
}

/** The chequered start/finish strip. */
function startTexture() {
  return makeCanvas(256, 64, (v) => {
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 16; b++) {
        v.fillStyle = (b + a) % 2 ? '#111' : '#fff';
        v.fillRect(b * 16, a * 16, 16, 16);
      }
    }
  });
}

/** Diamond-plate glass for the Sky Castle tube. */
function glassTexture() {
  return makeCanvas(512, 1024, (v, W, H) => {
    v.fillStyle = 'rgba(190,225,255,0.30)';
    v.fillRect(0, 0, W, H);
    const z = 26;
    v.strokeStyle = 'rgba(220,240,255,0.22)';
    v.lineWidth = 2;
    for (let a = 0; a * z * 0.866 < H + z; a++) {
      for (let b = -1; b * z * 1.5 < W + z; b++) {
        const x = b * z * 1.5;
        const y = a * z * 1.732 + (b % 2 ? z * 0.866 : 0);
        v.beginPath();
        for (let k = 0; k < 7; k++) {
          const ang = (k * Math.PI) / 3;
          v.lineTo(x + Math.cos(ang) * z * 0.5, y + Math.sin(ang) * z * 0.5);
        }
        v.stroke();
      }
    }
    // Bright edges.
    const grad = v.createLinearGradient(0, 0, W * 0.08, 0);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(150,230,255,0.9)');
    grad.addColorStop(1, 'rgba(150,230,255,0)');
    v.fillStyle = grad;
    v.fillRect(0, 0, W * 0.08, H);
    v.save();
    v.translate(W, 0);
    v.scale(-1, 1);
    v.fillStyle = grad;
    v.fillRect(0, 0, W * 0.08, H);
    v.restore();
    v.fillStyle = 'rgba(255,255,255,0.85)';
    for (let a = 0; a < 4; a++) v.fillRect(W * 0.494, H * (a / 4 + 0.03), W * 0.012, H * 0.12);
    // Chevrons down the middle.
    v.fillStyle = 'rgba(200,240,255,0.32)';
    for (let a = 0; a < 8; a++) {
      const y = (H * a) / 8 + H * 0.06;
      for (const o of [0.18, 0.66]) {
        v.beginPath();
        v.moveTo(W * o, y + H * 0.04);
        v.lineTo(W * (o + 0.08), y);
        v.lineTo(W * (o + 0.16), y + H * 0.04);
        v.lineTo(W * (o + 0.16), y + H * 0.055);
        v.lineTo(W * (o + 0.08), y + H * 0.015);
        v.lineTo(W * o, y + H * 0.055);
        v.fill();
      }
    }
  });
}

/**
 * Build every piece of road furniture for a track.
 * Returns the group to add to the scene.
 */
export class TrackMeshes {
  constructor(track) {
    this.track = track;
    this.def = track.def;
    this.s = scheme(this.def);
    this.group = new THREE.Group();
    this.group.name = 'roadMesh';
    this.sky = this.def.id === 'sky';
    this.bridges = [];
  }

  build() {
    this.buildRoad();
    this.buildKerbs();
    this.buildWalls();
    this.buildStartLine();
    this.buildBridgeDecks();
    this.buildGapRamps();
    return this.group;
  }

  /** Full-track index list [0..N] closed. */
  all() {
    const out = [];
    for (let i = 0; i <= this.track.N; i++) out.push(i);
    return out;
  }

  /** Index ranges where `mask[i] > 0.5`, as [from, to] pairs. */
  ranges(mask, threshold = 0.5) {
    return this.track.ranges(mask, threshold);
  }

  // ------------------------------------------------------------------ road
  buildRoad() {
    const s = this.s;
    const t = this.track;
    const tex = roadTexture(s);

    // Sky Castle is a sealed glass tube; the others are open tarmac.
    if (this.sky) {
      // Inner driving surface.
      const inner = this.def.noGround ? this.ribbonClosed([[ROAD_HALF, -0.1], [0, 0], [-ROAD_HALF, -0.1]]) : null;
      if (inner) {
        const m = new THREE.Mesh(inner, new THREE.MeshStandardMaterial({
          map: tex, roughness: 0.52, metalness: 0, side: THREE.DoubleSide,
        }));
        m.receiveShadow = true;
        this.group.add(m);
      }
    }

    const profile = [[-ROAD_HALF, 0.03], [0, 0.05], [ROAD_HALF, 0.03]];
    const geo = this.track.ribbon(0, t.N, profile, 1 / 24);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: this.sky ? 0.35 : 0.52,
      metalness: 0,
      clearcoat: this.sky ? 0.35 : 0.32,
      clearcoatRoughness: 0.3,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'road';
    this.group.add(mesh);
  }

  /** ribbon() wrapper that always returns geometry (Track handles the sweep). */
  ribbonClosed(profile) {
    const t = this.track;
    return t.ribbon(0, t.N, profile, 1 / 24);
  }

  buildKerbs() {
    const s = this.s;
    const tex = kerbTexture(s);
    tex.repeat.set(1, 1);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
    if (this.def.id === 'volcano') {
      mat.emissiveMap = tex;
      mat.emissive.set(0xffffff);
      mat.emissiveIntensity = 0.6;
    }
    if (this.sky) {
      mat.map = null;
      mat.color.set(0xffffff);
      mat.emissive.set(0x9fe0ff);
      mat.emissiveIntensity = 0.8;
    }
    const ramp = this.ranges(
      this.track.bridgeW.map((v) => (v > 0.12 ? 1 : 0)),
      0.5,
    );

    // Kerbs on both sides, full length.
    for (const sign of [1, -1]) {
      const profile = sign > 0
        ? [[ROAD_HALF, 0.06], [ROAD_EDGE - 0.15, 0.1], [ROAD_EDGE, 0]]
        : [[-ROAD_EDGE, 0], [-ROAD_EDGE + 0.15, 0.1], [-ROAD_HALF, 0.06]];
      const g = this.track.ribbon(0, this.track.N, profile, 0.238);
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  allRanges() {
    return [[0, this.track.N]];
  }

  buildWalls() {
    const s = this.s;
    const t = this.track;
    const tex = wallTexture(s);
    tex.repeat.set(1, 1);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.35,
      metalness: 0.05,
    });
    if (this.def.id === 'volcano') {
      mat.emissiveMap = tex;
      mat.emissive.set(0xffffff);
      mat.emissiveIntensity = 0.55;
    }

    // The wall exists wherever there is no bridge, gorge, lagoon or gap.
    const mask = new Float32Array(t.N);
    for (let i = 0; i < t.N; i++) {
      mask[i] =
        t.bridgeW[i] < 0.25 &&
        t.gorgeW[i] < 0.25 &&
        t.lagoonW[i] < 0.3 &&
        !t.gapMask[i] &&
        !t.gapMask[wrapIdx(i - 1, t.N)] &&
        !t.gapMask[wrapIdx(i + 1, t.N)] &&
        !(t.hideMask && t.hideMask[i])
          ? 1
          : 0;
    }

    if (this.sky) {
      // Glass tube: an arch of panes with a lit rail at the seam.
      const paneMat = new THREE.MeshStandardMaterial({
        color: 0xbfe1ff, transparent: true, opacity: 0.18,
        roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false,
      });
      const railMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0xffb0f0, emissiveIntensity: 1.1, roughness: 0.3,
      });
      const R = ROAD_HALF + KERB_W + 1.2;
      for (const [a, b] of t.ranges(mask)) {
        const pane = this.track.ribbon(a, b, [[R, -0.2], [R, 1.15]], 1 / 6);
        const pm = new THREE.Mesh(pane, paneMat);
        pm.renderOrder = 3;
        this.group.add(pm);
        const rail = this.track.ribbon(a, b, [
          [R - 0.14, 1.12], [R, 1.3], [R + 0.14, 1.12], [R, 1], [R - 0.14, 1.12],
        ], 1 / 6);
        this.group.add(new THREE.Mesh(rail, railMat));
      }
      return;
    }

    const scale = this.def.wallScale || 1;
    const inner = 12.9 * scale;
    const outer = inner + 0.5 * scale;
    for (const [a, b] of t.ranges(mask)) {
      const profile = [
        [inner, -0.3],
        [inner, 0.8],
        [(inner + outer) / 2, 0.92],
        [outer, 0.8],
        [outer, -0.3],
      ];
      const g = this.track.ribbon(a, b, profile, 1 / 6);
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  buildStartLine() {
    const s = this.s;
    const t = this.track;
    const tex = startTexture();
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const profile = [[-ROAD_HALF, 0.065], [0, 0.085], [ROAD_HALF, 0.065]];
    const g = t.ribbon(-2, 2, profile, 1 / (4 * t.seg));
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -4,
    });
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.name = 'startLine';
    this.group.add(m);

    // Gantry over the line.
    const pal = t.def.palette || [];
    const accent = pal[0] || '#ff3b6b';
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5, metalness: 0.5 });
    const bannerMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accent), emissive: new THREE.Color(accent),
      emissiveIntensity: 0.35, roughness: 0.5,
    });
    const gantry = new THREE.Group();
    for (const side of [-10.6, 10.6]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), legMat);
      leg.position.set(side, 3.5, 0);
      leg.castShadow = true;
      gantry.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(22, 1.6, 0.7), bannerMat);
    beam.position.y = 7;
    beam.castShadow = true;
    gantry.add(beam);
    const i = 0;
    gantry.position.set(t.px[i], t.py[i], t.pz[i]);
    gantry.rotation.y = Math.atan2(t.tx[i], t.tz[i]);
    gantry.name = 'gantry';

    // Start lamps: red / red / red then all green when the race begins.
    this.lamps = [];
    for (let k = 0; k < 3; k++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x3a1010, emissive: 0x220000, emissiveIntensity: 0.2, roughness: 0.4,
      });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.52, 14, 10), mat);
      lamp.position.set(-3.2 + k * 3.2, 6.4, 0.42);
      gantry.add(lamp);
      this.lamps.push(mat);
    }

    this.group.add(gantry);
  }

  /** Light one start lamp (0..2), or all of them for `-1` = green. */
  lightLamp(n, color) {
    if (!this.lamps) return;
    const hex = color === 'green' ? 0x22ff44 : 0xff2200;
    const targets = n < 0 ? this.lamps : [this.lamps[n]].filter(Boolean);
    for (const m of targets) {
      m.emissive.setHex(hex);
      m.emissiveIntensity = 6;
      m.color.setHex(hex);
    }
  }

  buildBridgeDecks() {
    const t = this.track;
    const s = this.s;
    const deckMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(s.bridge), roughness: 0.7 });
    const railMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(s.rail), roughness: 0.4, emissive: new THREE.Color(s.rail), emissiveIntensity: 0.2,
    });
    const mask = new Float32Array(t.N);
    for (let i = 0; i < t.N; i++) mask[i] = t.bridgeW[i] > 0.12 ? 1 : 0;

    for (const [a, b] of t.ranges(mask)) {
      const R = ROAD_EDGE + 0.6;
      const deck = this.track.ribbon(a, b, [
        [R, 0], [R, -1.3], [-R, -1.3], [-R, 0],
      ], 1 / 8);
      const dm = new THREE.Mesh(deck, deckMat);
      dm.castShadow = true;
      dm.receiveShadow = true;
      this.group.add(dm);
      this.bridges.push(dm);

      // Side rails.
      for (const sign of [1, -1]) {
        const rp = sign > 0
          ? [[R - 0.35, 0.55], [R - 0.25, 0.55], [R - 0.25, 0.75], [R - 0.35, 0.75], [R - 0.35, 0.55]]
          : [[-R + 0.35, 0.55], [-R + 0.25, 0.55], [-R + 0.25, 0.75], [-R + 0.35, 0.75], [-R + 0.35, 0.55]];
        this.group.add(new THREE.Mesh(this.track.ribbon(a, b, rp, 1 / 8), railMat));
      }
    }
  }

  buildGapRamps() {
    const t = this.track;
    if (!t.gaps || !t.gaps.length) return;
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.def.id === 'volcano' ? 0xcdd1d6 : 0x2b2c30, roughness: 0.9,
    });
    const lipMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: new THREE.Color(this.def.id === 'volcano' ? 0xffc400 : 0xffd24a),
      emissiveIntensity: 0.6, roughness: 0.4,
    });
    const halfW = ROAD_HALF + KERB_W;
    for (const [a, b] of t.gaps.flatMap(([x, y]) => [[x, -1], [y, 1]])) {
      const ang = Math.atan2(t.tx[a], t.tz[a]);
      const body = new THREE.Mesh(new THREE.BoxGeometry(2 * halfW + 3, 9, 2.4), bodyMat);
      body.position.set(
        t.px[a] + t.tx[a] * b * 1.25,
        t.py[a] - 4.56,
        t.pz[a] + t.tz[a] * b * 1.25,
      );
      body.rotation.y = ang;
      body.castShadow = true;
      body.receiveShadow = true;
      this.group.add(body);

      const lip = new THREE.Mesh(new THREE.BoxGeometry(2 * halfW, 0.16, 0.5), lipMat);
      lip.position.set(
        t.px[a] + t.tx[a] * b * 0.3,
        t.py[a] + 0.08,
        t.pz[a] + t.tz[a] * b * 0.3,
      );
      lip.rotation.y = ang;
      this.group.add(lip);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) m.dispose();
      }
    });
  }
}
