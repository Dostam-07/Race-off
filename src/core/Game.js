// Race-Off - the game shell.
//
// Owns the renderer, the scene, the camera rig, the race state machine and the
// main loop. Everything else (tracks, karts, items, HUD, audio) is a module
// this class composes.

import * as THREE from 'three';
import { clamp, lerp, damp, smooth, angleDelta, wrapIdx, mulberry32 } from '../core/utils.js';
import { loadModels, radialShadowTexture } from '../core/assets.js';
import { Track } from '../tracks/Track.js';
import { TRACKS, TRACK_ORDER, BEACH } from '../tracks/definitions.js';
import { TrackMeshes } from '../world/TrackMeshes.js';
import { Terrain } from '../world/Terrain.js';
import { terrainMaterial, grainTexture } from '../world/materials.js';
import { buildDecor } from '../world/decor.js';
import { FX } from '../fx/FX.js';
import { Kart } from '../kart/Kart.js';
import { makeBlobShadow, ROSTER } from '../kart/KartModel.js';
import { Items } from '../items/Items.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { HUD } from '../ui/HUD.js';
import { renderIcons } from '../ui/icons.js';
import { Input } from './Input.js';
import { CameraRig } from './CameraRig.js';
import { Menus } from '../ui/Menus.js';
import { installMultiplayer } from '../net/Multiplayer.js';
import { roomFromUrl } from '../net/Multiplayer.js';

export const LAPS = 3;

export class Game {
  constructor(container, opts = {}) {
    this.container = container;
    this.quality = opts.quality || 'high';
    this.state = 'loading';
    this.st = 0;
    this.time = 0;
    this.raceTime = 0;
    this.LAPS = LAPS;
    this.karts = [];
    this.ranked = [];
    this.shake = 0;
    this.bumpCd = 0;
    this.flash = 0;
    this.boostKick = 0;
    this.paused = false;
    this.finishedCount = 0;
    this.cup = null;
    this.players = [];
    this.chars = {};
    this.mp = null;
    this.bandP = undefined;
    this.bumpMsg = '';
    this.bumpT = 0;
    this.input = new Input(this);
    this.rnd = mulberry32(0xbead);

    this.initRenderer();
    this.initScene();
    this.audio = new AudioEngine();
  }

  // ------------------------------------------------------------ infrastructure
  initRenderer() {
    const renderer = new THREE.WebGLRenderer({
      antialias: this.quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality === 'low' ? 1 : 1.8));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.id = 'gl';
    document.body.prepend(renderer.domElement);
    this.renderer = renderer;

    addEventListener('resize', () => this.resize());
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.35, 1800);
    this.camera.position.set(0, 6, 14);
    this.cameraRig = new CameraRig(this.camera);

    this.hemi = new THREE.HemisphereLight(0xbfd9ff, 0x445566, 1.15);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(
      this.quality === 'low' ? 1024 : 2048,
      this.quality === 'low' ? 1024 : 2048,
    );
    const d = 90;
    Object.assign(this.sun.shadow.camera, {
      left: -d, right: d, top: d, bottom: -d, near: 1, far: 420,
    });
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.fog = new THREE.Fog(0xbfe0ff, 140, 620);
    this.scene.fog = this.fog;

    this.blobTex = radialShadowTexture();
    this.makeBlob = () => makeBlobShadow(this.blobTex);

    this.fx = new FX(this.scene, this.camera, this.quality);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.fx.setPointScale(h * 0.62);
    this.fitUI();
  }

  /**
   * Keep the UI screen-agnostic: measure the title-screen columns and the HUD
   * at the current size and set the CSS zoom factors (--ts for the menus, --hs
   * for the HUD widgets) so nothing overflows or overlaps on any display.
   */
  fitUI() {
    const s = document.documentElement.style;

    // Title menus: find the widest/tallest fixed-size block in each column and
    // shrink both columns by the same factor until everything fits. In the
    // portrait layout the columns are `display: contents` (no box of their
    // own), so measure against the title screen itself in that case.
    let zoom = 1;
    s.setProperty('--ts', '1');
    s.setProperty('--tss', '1');
    const titleEl = document.getElementById('title');
    const cols = [
      ['.tright', '#pick'],
      ['.tleft', '#mp'],
    ];
    for (const [colSel, innerSel] of cols) {
      const col = document.querySelector(colSel);
      const inner = col && col.querySelector(innerSel);
      if (!col || !inner) continue;
      const boxW = col.clientWidth > 40 ? col.clientWidth : titleEl ? titleEl.clientWidth : innerWidth;
      const boxH = col.clientHeight > 40 ? col.clientHeight : titleEl ? titleEl.clientHeight : innerHeight;
      const zw = boxW > 40 && inner.scrollWidth > boxW ? boxW / inner.scrollWidth : 1;
      const zh = boxH > 40 && inner.scrollHeight > boxH ? boxH / inner.scrollHeight : 1;
      zoom = Math.min(zoom, zw, zh);
    }

    // In the portrait layout everything stacks in one column; if the whole
    // stack is taller than the screen, shrink it to fit as well.
    if (titleEl && titleEl.scrollHeight > titleEl.clientHeight + 4) {
      zoom = Math.min(zoom, titleEl.clientHeight / titleEl.scrollHeight);
    }

    const ts = Math.max(0.4, zoom).toFixed(4);
    s.setProperty('--ts', ts);
    s.setProperty('--tss', ts); // the solo panel uses its own var for the same job

    // HUD widgets shrink gently on small screens, never grow past 1.
    const hs = Math.min(1, Math.max(0.68, Math.min(innerWidth / 1150, innerHeight / 700)));
    s.setProperty('--hs', hs.toFixed(3));

    // Results panel: scale down until it fits with a margin.
    const results = document.getElementById('results');
    if (results) {
      const rw = results.scrollWidth || 470;
      const rh = results.scrollHeight || 520;
      const rs = Math.min(1, (innerWidth - 20) / rw, (innerHeight - 20) / rh);
      s.setProperty('--rs', Math.max(0.45, rs).toFixed(3));
    }
  }

  // ------------------------------------------------------------------- boot

  /** Stable integer id for a kart, used by item events and networking. */
  rid(kart) {
    return this.karts.indexOf(kart);
  }

  async boot(onProgress) {
    this.A = await loadModels(onProgress);
    this.icons = renderIcons(this.renderer, this.A, ROSTER);
    this.resize();
    this.fx.setPointScale(innerHeight * 0.62);

    this.menus = new Menus(this);
    this.hud = new HUD(this.icons, ROSTER);

    // The title screen immediately needs a track to stand on.
    this.loadTrack('beach', { mode: 'title' });

    // A room code in the URL joins (or rehosts) that room straight away.
    const room = roomFromUrl();
    if (room.room) {
      const wasHost = (() => {
        try {
          return sessionStorage.getItem('ro-host') === room.room;
        } catch {
          return false;
        }
      })();
      this.openRoom(room.room, { host: wasHost, rehost: wasHost });
    }
  }

  // -------------------------------------------------------------- track load
  disposeWorld() {
    if (this.ghost) this.ghost.dispose();
    if (this.world) {
      this.scene.remove(this.world);
      this.world.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) m.dispose();
        }
      });
      this.world = null;
    }
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      this.terrainMesh = null;
    }
    if (this.decor) {
      this.scene.remove(this.decor.group);
      this.decor = null;
    }
    if (this.items) {
      for (const b of this.items.boxes) this.scene.remove(b.mesh);
      if (this.items.coinMesh) this.scene.remove(this.items.coinMesh);
      this.items.reset();
      this.items = null;
    }
    for (const k of this.karts) {
      this.scene.remove(k.root);
    }
    this.karts.length = 0;
    this.ranked.length = 0;
  }

  loadTrack(trackId, opts = {}) {
    if (this.track && this.track.def.id === trackId && this.world && opts.reuse) {
      return;
    }
    this.disposeWorld();
    const def = TRACKS[trackId] || BEACH;
    const track = new Track(def);
    track.patchGenerated();
    this.track = track;

    // Palette drives fog, sun colour and the ambient tint.
    this.applyPalette(def);

    // Terrain first so decoration can sample its height.
    const tex = grainTexture('#f6f6f6', 5000, 256);
    const mat = terrainMaterial({ lava: def.palette && def.id === 'volcano', texture: tex });
    this.terrainMat = mat;
    this.terrain = new Terrain(track, { terrain: mat });
    track.heightAt = (x, z) => this.terrain.heightAt(x, z);
    const tmesh = this.terrain.build();
    if (tmesh.isMesh) this.scene.add(tmesh);
    this.terrainMesh = tmesh.isMesh ? tmesh : null;

    const world = new THREE.Group();
    world.name = 'world';
    this.scene.add(world);
    this.world = world;

    const meshes = new TrackMeshes(track);
    world.add(meshes.build());
    this.trackMeshes = meshes;

    this.decor = buildDecor(track, this.A, this.fx, this.quality);
    if (!def.noGround) world.add(this.decor.group);

    this.items = new Items(this);
    this.hud.initMinimap(track);

    this.audio.init(trackId);
    if (opts.mode !== 'title') this.audio.stopTitle();

    this.titleMode = opts.mode === 'title';
    this.spawnTitleKarts();
    this.cameraRig.reset();
  }

  applyPalette(def) {
    const palette = def.palette || [];
    const sky = {
      beach: [0x9fd8ff, 0xffffff, 0xdff0ff],
      jungle: [0xa8d8b0, 0xfff3cc, 0xdfeecb],
      volcano: [0x2a1f38, 0xffb066, 0x4a3040],
      sky: [0x2a2350, 0xd8c6ff, 0x4a3f70],
    }[def.id] || [0x9fd8ff, 0xffffff, 0xffffff];

    this.scene.background = new THREE.Color(sky[0]);
    this.fog.color.set(sky[2]);
    this.hemi.color.set(sky[1]);
    this.hemi.groundColor.set(palette[6] || '#4a3a38');
    this.sun.color.set(def.id === 'volcano' ? 0xffb070 : def.id === 'sky' ? 0xc8b8ff : 0xfff2d8);

    const night = def.id === 'volcano' || def.id === 'sky';
    this.hemi.intensity = night ? 1.6 : 1.15;
    this.sun.intensity = night ? 2.2 : 2.4;
    this.fog.near = night ? 90 : def.id === 'sky' ? 220 : 140;
    this.fog.far = night ? 420 : def.id === 'sky' ? 900 : 620;

    // A warm bounce light so night tracks do not go pitch black.
    if (!this.fillLight) {
      this.fillLight = new THREE.DirectionalLight(0xffffff, 0);
      this.fillLight.position.set(-60, 40, -50);
      this.scene.add(this.fillLight);
    }
    this.fillLight.intensity = night ? 0.85 : 0;
    this.fillLight.color.set(def.id === 'volcano' ? 0xff8855 : 0x8f7fff);

    this.renderer.toneMappingExposure = night ? 1.5 : 1.05;
  }

  spawnTitleKarts() {
    this.karts.length = 0;
    // Just the selected racer on the title screen - a full grid of parked
    // karts crowds the camera view and makes drivers look like they are
    // sitting in each other's karts. Races build their own field.
    let charId = 'fox';
    try {
      charId = localStorage.getItem('ro-racer') || 'fox';
    } catch { /* private mode */ }
    if (!ROSTER.some((r) => r.id === charId)) charId = 'fox';
    const k = new Kart(this, charId, 0, true);
    k.place(0);
    this.karts.push(k);
    this.player = k;
    this.ranked = [k];
    this.state = 'title';
    this.menus.showTitle();
  }
}
