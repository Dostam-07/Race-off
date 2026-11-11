// Race-Off - shared shader/material definitions.
//
// The terrain uses a stock MeshStandardMaterial patched in onBeforeCompile:
//   aMat.x  = rock / strata mask (darkens and banding the surface)
//   aMat.y  = lava / glow mask   (animated emissive veins)
// Both are written by Terrain.js as vertex attributes.

import * as THREE from 'three';

/** Deterministic 1..4 octave value-noise texture for surface grain. */
export function grainTexture(base = '#f6f6f6', dots = 5000, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < dots; i++) {
    const v = (200 + Math.random() * 55) | 0;
    ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    const r = 2 + Math.random() * 7;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, 7);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

const TERRAIN_VERT_HEAD = /* glsl */ `
  attribute vec2 aMat;
  varying vec2 vMat;
  varying vec3 vWP;
`;

const TERRAIN_FRAG_HEAD = /* glsl */ `
  varying vec2 vMat;
  varying vec3 vWP;
  uniform float uTime;
  float thash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float tnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(thash(i), thash(i+vec2(1,0)), f.x),
               mix(thash(i+vec2(0,1)), thash(i+vec2(1,1)), f.x), f.y);
  }
`;

/**
 * Build the terrain material for a track.
 * `lava` enables the flowing-magma vein shader used by Magma Peak.
 */
export function terrainMaterial({ lava = false, texture } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: texture,
    roughness: 0.95,
    metalness: 0,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_VERT_HEAD}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vMat = aMat; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    const lavaExpr = lava
      ? /* glsl */ `
        vec2 lq = vWP.xz * 0.42;
        lq += (vec2(tnoise(lq * 0.6 + uTime * 0.05), tnoise(lq * 0.6 + 9.0 - uTime * 0.04)) - 0.5) * 1.7
            + vec2(uTime * 0.07, uTime * 0.13);
        float lc = tnoise(lq) * 0.6 + tnoise(lq * 2.4 + 3.0) * 0.4;
        float lcr = smoothstep(0.085, 0.0, abs(lc - 0.5));
        float lpl = smoothstep(0.1, 0.27, abs(lc - 0.5)) * smoothstep(0.25, 0.6, tnoise(lq * 0.5 + 17.0));
        vec3 lcol = mix(mix(vec3(3.8, 0.62, 0.04), vec3(5.0, 2.2, 0.32), crust), vec3(0.42, 0.05, 0.02), lpl * 0.9)
                  + vec3(4.2, 2.0, 0.35) * lcr * (0.65 + 0.35 * sin(uTime * 1.7 + lc * 18.0));
        totalEmissiveRadiance += lcol * lm
          * (0.8 + 0.2 * sin(uTime * 2.0 + vWP.y * 0.2))
          * mix(0.5, 1.0, smoothstep(30.0, 190.0, distance(cameraPosition, vWP))) * 0.6;`
      : /* glsl */ `
        totalEmissiveRadiance += mix(vec3(3.8, 0.62, 0.04), vec3(5.0, 2.2, 0.32), crust) * lm
          * (0.75 + 0.25 * sin(uTime * 2.0 + vWP.y * 0.2))
          * mix(0.5, 1.0, smoothstep(30.0, 190.0, distance(cameraPosition, vWP)));`;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_FRAG_HEAD}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float gn = tnoise(vWP.xz * 0.45) * 0.6 + tnoise(vWP.xz * 2.3) * 0.4;
        diffuseColor.rgb *= 0.86 + 0.28 * gn;
        float strata = 0.86 + 0.14 * sin(vWP.y * 0.85 + tnoise(vWP.xz * 0.06) * 11.0)
                     + (tnoise(vWP.xz * 0.9 + vWP.y) - 0.5) * 0.3;
        diffuseColor.rgb *= mix(1.0, strata, clamp(vMat.x, 0.0, 1.0));`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float lvn = tnoise(vWP.xz * 0.35 + vec2(0.0, uTime * 0.35));
        float lm = smoothstep(0.42, 0.62, vMat.y + (lvn - 0.5) * 0.35);
        float crust = smoothstep(0.35, 0.75, tnoise(vWP.xz * 0.9 - vec2(uTime * 0.25, uTime * 0.6)));
        ${lavaExpr}
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02), lm);`,
      );

    mat.userData.shader = shader;
    if (mat.userData.onReady) mat.userData.onReady(shader);
  };

  return mat;
}

/** A no-gravity sky-dome material for the void under Sky Castle. */
export function voidMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0x1b1436, side: THREE.BackSide, fog: false });
}
