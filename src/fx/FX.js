// Race-Off - the particle systems.
// Three GPU-friendly pools:
//   PointFX     - soft billboarded points (smoke, dust, flames, confetti motes)
//   StreakFX    - camera-facing quads stretched along their velocity (sparks)
//   SkidMarks   - persistent ribbon quads on the ground under drifting wheels
// Plus the one-off helpers the game calls everywhere: sparks, smoke, burst.

import * as THREE from 'three';

const _v = new THREE.Vector3();

// ---------------------------------------------------------------- point pool
export class PointFX {
  constructor(parent, max, soft) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.a0 = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: soft ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: {
        uScale: { value: 600 },
        uSoft: { value: soft ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        attribute float aSize;
        varying vec4 vC;
        uniform float uScale;
        void main(){
          vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vC;
        uniform float uSoft;
        void main(){
          vec2 p = gl_PointCoord - 0.5;
          float r = length(p) * 2.0;
          if (r > 1.0) discard;
          float star = max(0.0, 1.0 - abs(p.x * p.y) * 110.0) * (1.0 - r) * 0.55;
          float a = mix(smoothstep(1.0, 0.15, r), pow(1.0 - r, 2.3) + star, uSoft);
          gl_FragColor = vec4(vC.rgb, vC.a * a);
        }`,
    });

    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = soft ? 6 : 5;
    parent.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a = 1, grav = 0, drag = 0) {
    const i = this.n;
    this.n = (this.n + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = s0;
    this.s1[i] = s1;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.a0[i] = a;
    this.col[i * 4] = r;
    this.col[i * 4 + 1] = g;
    this.col[i * 4 + 2] = b;
    this.col[i * 4 + 3] = a;
  }

  update(dt) {
    const { pos, vel, life, maxLife, size, col } = this;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) {
        if (size[i] !== 0) { size[i] = 0; alive++; }
        continue;
      }
      alive++;
      life[i] -= dt;
      const f = 1 - Math.max(life[i], 0) / maxLife[i];
      const k = Math.exp(-this.drag[i] * dt);
      vel[i * 3] *= k;
      vel[i * 3 + 1] = vel[i * 3 + 1] * k - this.grav[i] * dt;
      vel[i * 3 + 2] *= k;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] = life[i] <= 0 ? 0 : this.s0[i] + (this.s1[i] - this.s0[i]) * f;
      col[i * 4 + 3] = this.a0[i] * (1 - f * f);
    }
    if (!alive) return;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
}

// --------------------------------------------------------------- streak pool
export class StreakFX {
  constructor(parent, max = 520) {
    this.max = max;
    this.n = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ml = new Float32Array(max);
    this.len = new Float32Array(max);
    this.st = new Float32Array(max);
    this.w = new Float32Array(max);
    this.c = new Float32Array(max * 4);
    this.grav = new Float32Array(max);
    this.rv = new Float32Array(max * 2);
    this.dead = new Uint8Array(max).fill(1);
    this.pos = new Float32Array(max * 12);
    this.col = new Float32Array(max * 16);

    const idx = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) {
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));

    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    parent.add(this.mesh);
  }

  spawn(x, y, z, vx, vy, vz, life, len, width, r, g, b, a = 1, grav = 0, stretch = 99, cx = 0, cz = 0) {
    const i = this.n;
    this.n = (this.n + 1) % this.max;
    this.dead[i] = 0;
    this.rv[i * 2] = cx;
    this.rv[i * 2 + 1] = cz;
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    this.life[i] = this.ml[i] = life;
    this.len[i] = len;
    this.st[i] = stretch;
    this.w[i] = width * 0.5;
    this.grav[i] = grav;
    this.c[i * 4] = r;
    this.c[i * 4 + 1] = g;
    this.c[i * 4 + 2] = b;
    this.c[i * 4 + 3] = a;
  }

  update(dt, camPos) {
    const { p: n, v: vel, pos: r, col: o, c: a } = this;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.dead[i]) continue;
      alive++;
      const f = i * 12;
      const u = i * 16;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.dead[i] = 1;
        for (let k = 0; k < 12; k++) r[f + k] = 0;
        continue;
      }
      vel[i * 3 + 1] -= this.grav[i] * dt;
      const px = (n[i * 3] += vel[i * 3] * dt);
      const py = (n[i * 3 + 1] += vel[i * 3 + 1] * dt);
      const pz = (n[i * 3 + 2] += vel[i * 3 + 2] * dt);

      const bx = vel[i * 3] - this.rv[i * 2];
      const by = vel[i * 3 + 1];
      const bz = vel[i * 3 + 2] - this.rv[i * 2 + 1];
      const mag = Math.hypot(bx, by, bz) || 1;
      const k = Math.min(this.len[i], mag * this.st[i]) / mag;
      const tx = px - bx * k;
      const ty = py - by * k;
      const tz = pz - bz * k;

      const dx = camPos.x - px;
      const dy = camPos.y - py;
      const dz = camPos.z - pz;
      let sx = (by / mag) * dz - (bz / mag) * dy;
      let sy = (bz / mag) * dx - (bx / mag) * dz;
      let sz = (bx / mag) * dy - (by / mag) * dx;
      const w = this.w[i] / (Math.hypot(sx, sy, sz) || 1);
      sx *= w; sy *= w; sz *= w;

      r[f] = px + sx; r[f + 1] = py + sy; r[f + 2] = pz + sz;
      r[f + 3] = px - sx; r[f + 4] = py - sy; r[f + 5] = pz - sz;
      r[f + 6] = tx + sx; r[f + 7] = ty + sy; r[f + 8] = tz + sz;
      r[f + 9] = tx - sx; r[f + 10] = ty - sy; r[f + 11] = tz - sz;

      const fade = 1 - this.life[i] / this.ml[i];
      const alpha = a[i * 4 + 3] * (1 - fade * fade);
      for (let v = 0; v < 4; v++) {
        o[u + v * 4] = a[i * 4];
        o[u + v * 4 + 1] = a[i * 4 + 1];
        o[u + v * 4 + 2] = a[i * 4 + 2];
        o[u + v * 4 + 3] = v < 2 ? alpha : 0;
      }
    }
    if (!alive) return;
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}

// -------------------------------------------------------------- skid marks
export class SkidMarks {
  constructor(parent, max = 1400) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 12);
    this.col = new Float32Array(max * 16);
    this.age = new Float32Array(max).fill(1e9);

    const idx = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) {
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));

    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    parent.add(this.mesh);
    this.geo = geo;
  }

  /** `prev` and `now` are each [x,y,z, x,y,z] pairs for the two edges of the tyre. */
  quad(prev, now) {
    const i = this.n;
    this.n = (this.n + 1) % this.max;
    this.age[i] = 0;
    const f = i * 12;
    const u = i * 16;
    const p = this.pos;
    p[f] = now[0]; p[f + 1] = now[1]; p[f + 2] = now[2];
    p[f + 3] = now[3]; p[f + 4] = now[4]; p[f + 5] = now[5];
    p[f + 6] = prev[0]; p[f + 7] = prev[1]; p[f + 8] = prev[2];
    p[f + 9] = prev[3]; p[f + 10] = prev[4]; p[f + 11] = prev[5];
    for (let k = 0; k < 4; k++) {
      this.col[u + k * 4] = 0.09;
      this.col[u + k * 4 + 1] = 0.08;
      this.col[u + k * 4 + 2] = 0.08;
      this.col[u + k * 4 + 3] = 0.55;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  update(dt) {
    // Skid marks fade out after ~14 seconds so the buffer recycles.
    let dirty = false;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] > 20) continue;
      this.age[i] += dt;
      if (this.age[i] > 20) {
        const u = i * 16;
        for (let k = 0; k < 4; k++) this.col[u + k * 4 + 3] = 0;
        dirty = true;
      } else if (this.age[i] > 12) {
        const fade = 1 - (this.age[i] - 12) / 8;
        const u = i * 16;
        for (let k = 0; k < 4; k++) this.col[u + k * 4 + 3] = 0.55 * fade;
        dirty = true;
      }
    }
    if (dirty) this.geo.attributes.color.needsUpdate = true;
  }
}

// ------------------------------------------------------------- the facade
export class FX {
  constructor(scene, camera, quality = 'high') {
    const n = quality === 'low' ? 0.5 : 1;
    this.camera = camera;
    this.alpha = new PointFX(scene, Math.round(1400 * n), true);
    this.streaks = new StreakFX(scene, Math.round(520 * n));
    this.glow = new PointFX(scene, Math.round(900 * n), false);
    this.skids = new SkidMarks(scene, Math.round(1400 * n));
    this.points = [this.alpha, this.glow];

    // Sparkle / confetti pool reuses the soft point buffer.
  }

  /** Radial spark burst - the workhorse effect. */
  sparks(x, y, z, count, speed, color, life = 0.35, size = 0.6, vx = 0, vz = 0) {
    const [r, g, b] = color;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random();
      const s = speed * (0.35 + Math.random() * 0.9);
      this.glow.spawn(
        x, y, z,
        Math.cos(a) * s * (1 - e * 0.5) + vx,
        1.5 + Math.random() * s * 0.7,
        Math.sin(a) * s * (1 - e * 0.5) + vz,
        life * (0.6 + Math.random() * 0.7),
        size * (0.5 + Math.random()),
        size * 0.15,
        r, g, b, 1, 26, 1.6,
      );
    }
  }

  /** A puff of billowing smoke. */
  smoke(x, y, z, count, color, life = 1.4, spread = 1.6, size = 0.6) {
    const [r, g, b] = color;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = spread * Math.random();
      this.alpha.spawn(
        x + (Math.random() - 0.5) * size,
        y + (Math.random() - 0.5) * size,
        z + (Math.random() - 0.5) * size,
        Math.cos(a) * s,
        0.8 + Math.random() * 1.6,
        Math.sin(a) * s,
        life * (0.7 + Math.random() * 0.6),
        size * 0.6,
        size * (2.4 + Math.random()),
        r, g, b, 0.5, -1.2, 1.4,
      );
    }
  }

  /** Big radial explosion used for rockets, respawns and sector flares. */
  burst(x, y, z, count, speed, color, life = 0.8, size = 0.8) {
    this.sparks(x, y, z, count, speed, color, life, size);
    this.smoke(x, y + 0.3, z, Math.round(count * 0.35), [color[0] * 0.5, color[1] * 0.5, color[2] * 0.5], life * 1.4, speed * 0.35, size);
  }

  /** Confetti raining down at the start and finish. */
  confetti(x, y, z, count = 200) {
    const palette = [
      [1, 0.3, 0.55], [1, 0.78, 0.25], [0.35, 0.72, 1],
      [0.66, 0.42, 1], [0.4, 1, 0.6], [1, 0.5, 0.25], [0.95, 0.95, 1],
    ];
    for (let i = 0; i < count; i++) {
      const c = palette[(Math.random() * palette.length) | 0];
      this.alpha.spawn(
        x + (Math.random() - 0.5) * 26,
        y + Math.random() * 18,
        z + (Math.random() - 0.5) * 26,
        (Math.random() - 0.5) * 3,
        2 + Math.random() * 4,
        (Math.random() - 0.5) * 3,
        2.4 + Math.random() * 1.6,
        0.22 + Math.random() * 0.2,
        0.16,
        c[0], c[1], c[2], 1, 2.4, 0.9,
      );
    }
  }

  /** Fireworks shell: a bright core plus a spreading ring of sparks. */
  firework(x, y, z, color) {
    const c = color || [
      0.6 + Math.random() * 0.8,
      0.6 + Math.random() * 0.8,
      0.6 + Math.random() * 0.8,
    ];
    this.burst(x, y, z, 46, 13, c, 1.5, 1.5);
    this.alpha.spawn(x, y, z, 0, 0, 0, 0.5, 6, 2, c[0], c[1], c[2], 0.9, 0, 0);
    this.glow.spawn(x, y, z, 0, 0, 0, 0.7, 7, 1, c[0], c[1], c[2], 1, 0, 0);
  }

  update(dt) {
    for (const p of this.points) p.update(dt);
    this.streaks.update(dt, this.camera.position);
    this.skids.update(dt);
  }

  setPointScale(scale) {
    for (const p of this.points) p.mat.uniforms.uScale.value = scale;
  }
}
