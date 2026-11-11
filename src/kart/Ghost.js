// Race-Off - the time-trial ghost.
//
// A translucent replay of the player's best lap. The ghost is recorded at a
// fixed 20 Hz (every 3rd tick) as [x, y, z, heading] samples; playback
// interpolates between samples by lap time. The ghost never collides, is
// never ranked and never appears in results - it is purely a pace reference.

import { ROSTER, buildKart } from './KartModel.js';
import { angleDelta } from '../core/utils.js';

/** Samples are taken every REC_EVERY ticks (60 Hz base). */
export const REC_EVERY = 3;
export const REC_DT = REC_EVERY / 60;
/** Hard cap so a stuck player can't blow up localStorage (~2 min of driving). */
export const MAX_SAMPLES = 2400;

const ghostKey = (trackId) => `ro-ghost-${trackId}`;

export function loadGhost(trackId) {
  try {
    const raw = localStorage.getItem(ghostKey(trackId));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.samples) || d.samples.length < 8 || !(d.time > 0)) return null;
    if (!ROSTER.some((r) => r.id === d.char)) return null;
    return d;
  } catch {
    return null;
  }
}

export function saveGhost(trackId, data) {
  try {
    localStorage.setItem(ghostKey(trackId), JSON.stringify(data));
  } catch { /* private mode / quota */ }
}

export class Ghost {
  constructor(game, charId) {
    this.game = game;
    this.charId = charId;
    this.data = null;
    this.root = null;
    this.tilt = null;
  }

  /** Build (or rebuild) the translucent model for the ghost's character. */
  setData(data) {
    this.data = data;
    if (!data) return this.hide();
    if (this.root && this.charId === data.char) return this.show();
    this.charId = data.char;

    if (this.root) this.game.scene.remove(this.root);
    const built = buildKart(this.game.A, data.char);
    this.root = built.root;
    this.tilt = built.tilt;
    // Translucent, shadowless, non-interactive.
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.38;
        o.material.depthWrite = false;
      }
    });
    this.root.visible = false;
    this.game.scene.add(this.root);
    return this.show();
  }

  show() {
    if (this.root) this.root.visible = true;
    return this;
  }

  hide() {
    if (this.root) this.root.visible = false;
    return this;
  }

  dispose() {
    if (this.root) this.game.scene.remove(this.root);
    this.root = null;
    this.data = null;
  }

  /**
   * Place the ghost at the point `lapT` seconds into its best lap.
   * Called every tick while a time trial is running.
   */
  update(lapT) {
    const d = this.data;
    if (!d || !this.root) return;
    const s = d.samples;
    const t = ((lapT % d.time) + d.time) % d.time;
    const f = t / REC_DT;
    const i0 = Math.min(s.length - 1, Math.max(0, Math.floor(f)));
    const i1 = Math.min(s.length - 1, i0 + 1);
    const k = f - i0;
    const a = s[i0];
    const b = s[i1];
    this.root.position.set(
      a[0] + (b[0] - a[0]) * k,
      a[1] + (b[1] - a[1]) * k,
      a[2] + (b[2] - a[2]) * k,
    );
    // Heading needs the short-way-around lerp.
    const dh = angleDelta(b[3], a[3]);
    this.root.rotation.y = a[3] + dh * k;
  }
}
