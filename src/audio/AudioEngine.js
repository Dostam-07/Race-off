// Race-Off - the audio engine.
//
// Everything is synthesised with the Web Audio API, except the five soundtrack
// MP3s which are decoded from public/music. If a track fails to decode, the
// built-in 16-bar tracker from ./music.js takes over, so there is always music.
//
// Node graph:
//   master gain -> compressor -> out
//   music / fxg gains feed master
//   engine oscillators + wind + drift + crowd noise feed master / fxg

import {
  noteToFreq, CHORDS, PROGRESSION, ROOTS, MELODY, STAR_LEAD, FANFARE,
} from './music.js';

const TRACK_FILES = {
  beach: 'beach',
  jungle: 'jungle',
  volcano: 'volcano',
  sky: 'sky',
  title: 'title',
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.tempo = 150;
    this.transpose = 0;
    this.step = 0;
    this.total = 0;
    this.starOn = false;
    this.trackOn = false;
    this.currentTrack = null;
    try {
      this.muted = localStorage.getItem('ro-mute') === '1';
    } catch {
      this.muted = false;
    }
  }

  init(trackId) {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;

    const out = ctx.createGain();
    out.gain.value = 0.84;
    this.master.connect(comp);
    comp.connect(out);
    out.connect(ctx.destination);
    this.out = out;

    this.music = ctx.createGain();
    this.music.gain.value = 0.5;
    this.music.connect(this.master);

    this.fxg = ctx.createGain();
    this.fxg.gain.value = 0.42;
    this.fxg.connect(this.master);

    this.track = null;
    this.trackSrc = null;
    this.trackWanted = false;

    // ---- soundtrack
    this.loadTrack(trackId);
    this.loadTitle = () => this.loadTrackBuffer(TRACK_FILES.title, true);
    this.loadTitle();

    // ---- reverb send (used by the music bus)
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.2;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(this.music);
    this.send = delay;

    // ---- 1.5s of white noise, reused for every noise source
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.buildEngineLayers(ctx, buf);
  }

  buildEngineLayers(ctx, noise) {
    // Engine: saw + square through a lowpass, pitch tracks speed.
    this.eng = ctx.createOscillator();
    this.eng.type = 'sawtooth';
    this.eng2 = ctx.createOscillator();
    this.eng2.type = 'square';
    this.engF = ctx.createBiquadFilter();
    this.engF.type = 'lowpass';
    this.engF.frequency.value = 500;
    this.engF.Q.value = 2;
    this.engG = ctx.createGain();
    this.engG.gain.value = 0;
    this.eng.connect(this.engF);
    this.eng2.connect(this.engF);
    this.engF.connect(this.engG);
    this.engG.connect(this.master);
    this.eng.start();
    this.eng2.start();

    // Wind rush.
    this.windG = ctx.createGain();
    this.windG.gain.value = 0;
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = noise;
    windSrc.loop = true;
    windSrc.playbackRate.value = 0.6;
    this.windF = ctx.createBiquadFilter();
    this.windF.type = 'bandpass';
    this.windF.frequency.value = 600;
    this.windF.Q.value = 0.6;
    windSrc.connect(this.windF);
    this.windF.connect(this.windG);
    this.windG.connect(this.master);
    windSrc.start();

    // Cave / tunnel echo on the master.
    const cdelay = ctx.createDelay(0.5);
    cdelay.delayTime.value = 0.14;
    const cfb = ctx.createGain();
    cfb.gain.value = 0.52;
    const cfilter = ctx.createBiquadFilter();
    cfilter.type = 'lowpass';
    cfilter.frequency.value = 2400;
    this.caveG = ctx.createGain();
    this.caveG.gain.value = 0;
    this.master.connect(this.caveG);
    this.caveG.connect(cdelay);
    cdelay.connect(cfilter);
    cfilter.connect(cfb);
    cfb.connect(cdelay);
    cfilter.connect(this.out);

    // Tyre screech.
    this.driftG = ctx.createGain();
    this.driftG.gain.value = 0;
    const dsrc = ctx.createBufferSource();
    dsrc.buffer = noise;
    dsrc.loop = true;
    const dfilter = ctx.createBiquadFilter();
    dfilter.type = 'bandpass';
    dfilter.frequency.value = 3200;
    dfilter.Q.value = 0.8;
    dsrc.connect(dfilter);
    dfilter.connect(this.driftG);
    this.driftG.connect(this.fxg);
    dsrc.start();

    // Crowd murmur.
    this.crowdG = ctx.createGain();
    this.crowdG.gain.value = 0;
    const csrc = ctx.createBufferSource();
    csrc.buffer = noise;
    csrc.loop = true;
    csrc.playbackRate.value = 0.7;
    const cfilter2 = ctx.createBiquadFilter();
    cfilter2.type = 'bandpass';
    cfilter2.frequency.value = 1100;
    cfilter2.Q.value = 0.5;
    csrc.connect(cfilter2);
    cfilter2.connect(this.crowdG);
    this.crowdG.connect(this.fxg);
    csrc.start();
  }

  // ------------------------------------------------------------- soundtrack
  async loadTrack(trackId) {
    this.currentTrack = trackId;
    await this.loadTrackBuffer(trackId, false);
  }

  async loadTrackBuffer(trackId, isTitle) {
    if (!this.ctx || !trackId) return;
    const file = TRACK_FILES[trackId];
    if (!file) return;
    try {
      const res = await fetch(`./music/${file}.mp3`);
      if (!res.ok) throw new Error(`music ${file} ${res.status}`);
      const arr = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      if (isTitle) {
        this.titleBuf = buf;
        this.titleLoop = [0, buf.duration];
        if (this.titleWanted) this.startTitle();
      } else {
        this.hasTrack = true;
        this.track = buf;
        this.loopStart = 0;
        this.loopEnd = buf.duration;
        if (this.trackWanted) this.playTrack();
      }
    } catch (err) {
      if (isTitle) return;
      // Fall back to the procedural tracker.
      this.hasTrack = false;
      this.trackOn = false;
      if (this.trackWanted) {
        this.trackWanted = false;
        this.playing = false;
        this.startMusic();
      }
    }
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem('ro-mute', this.muted ? '1' : '0');
    } catch { /* private mode */ }
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  setStar(on) {
    this.starOn = on;
  }

  // ---- envelopes and primitives
  env(gain, at, attack, peak, decay, floor = 1e-4) {
    gain.gain.setValueAtTime(1e-4, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 1e-4), at + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(floor, 1e-4), at + attack + decay);
  }

  tone(type, freq, at, dur, peak, dest, opts = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, at + dur);
    if (opts.detune) osc.detune.value = opts.detune;
    this.env(gain, at, opts.a || 0.005, peak, dur);
    let tail = osc;
    if (opts.lp) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(opts.lp, at);
      if (opts.lpEnd) filter.frequency.exponentialRampToValueAtTime(opts.lpEnd, at + dur);
      filter.Q.value = opts.q || 1;
      osc.connect(filter);
      tail = filter;
    }
    tail.connect(gain);
    gain.connect(dest || this.fxg);
    if (opts.send) gain.connect(this.send);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  noise(at, dur, peak, type, freq, dest, q = 1, sweepTo) {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = this.noiseBuf;
    src.loop = true;
    filter.type = type;
    filter.frequency.setValueAtTime(freq, at);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
    filter.Q.value = q;
    this.env(gain, at, 0.003, peak, dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest || this.fxg);
    src.start(at, Math.random());
    src.stop(at + dur + 0.05);
  }

  // ---------------------------------------------------------------- title
  startTitle() {
    this.titleWanted = true;
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.titleBuf || this.titleSrc) return;
    const src = (this.titleSrc = ctx.createBufferSource());
    const gain = (this.titleG = ctx.createGain());
    src.buffer = this.titleBuf;
    src.loop = true;
    src.loopStart = this.titleLoop[0];
    src.loopEnd = this.titleLoop[1];
    gain.gain.value = 1e-4;
    gain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.4);
    src.connect(gain);
    gain.connect(this.music);
    src.start(ctx.currentTime + 0.02, 0);
  }

  stopTitle() {
    this.titleWanted = false;
    if (!this.titleSrc) return;
    const t = this.ctx.currentTime;
    this.titleG.gain.setTargetAtTime(1e-4, t, 0.1);
    this.titleSrc.stop(t + 0.5);
    this.titleSrc = null;
  }

  // ----------------------------------------------------------------- music
  playTrack() {
    const ctx = this.ctx;
    if (!this.track || this.trackSrc) return;
    const src = (this.trackSrc = ctx.createBufferSource());
    const gain = (this.trackG = ctx.createGain());
    src.buffer = this.track;
    src.loop = true;
    src.loopStart = this.loopStart;
    src.loopEnd = this.loopEnd;
    src.playbackRate.value = this.tempo > 150 ? 1.07 : 1;
    gain.gain.value = 1e-4;
    gain.gain.exponentialRampToValueAtTime(1.25, ctx.currentTime + 0.12);
    src.connect(gain);
    gain.connect(this.music);
    src.start(ctx.currentTime + 0.02, this.loopStart);
  }

  startMusic() {
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.total = 0;
    if (this.hasTrack) {
      this.trackWanted = true;
      this.trackOn = true;
      this.playTrack();
    }
    this.nextT = this.ctx.currentTime + 0.06;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    this.playing = false;
    this.trackWanted = false;
    clearInterval(this.timer);
    if (this.trackSrc) {
      const t = this.ctx.currentTime;
      this.trackG.gain.setTargetAtTime(1e-4, t, 0.12);
      this.trackSrc.stop(t + 0.6);
      this.trackSrc = null;
    }
  }

  setFinalLap() {
    this.tempo = 168;
    this.transpose = 1;
    if (this.trackSrc) {
      this.trackSrc.playbackRate.setTargetAtTime(1.07, this.ctx.currentTime, 0.25);
    }
  }

  schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextT < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextT);
      this.nextT += (60 / this.tempo / 4) * (this.starOn ? 0.86 : 1);
      this.step = (this.step + 1) % 256;
      this.total++;
    }
  }

  /** Play one sixteenth-note of the tracker. */
  playStep(step, at) {
    const bar = Math.floor(step / 16) % 16;
    const s = step % 16;
    const chord = PROGRESSION[bar];
    const tr = this.transpose;
    const bus = this.music;
    const stepDur = 60 / this.tempo / 4;

    // With a real MP3 playing we only add the star arpeggio on top.
    if (this.trackOn) {
      if (this.starOn) {
        const n = STAR_LEAD[s % 8] + tr;
        this.tone('square', noteToFreq(n), at, 0.09, 0.085, this.fxg, { lp: 5200 });
        if (s % 2 === 0) this.tone('sine', noteToFreq(n - 24), at, 0.12, 0.2, this.fxg);
      }
      return;
    }

    const fill = bar % 8 === 7 && s >= 12;

    // Kick.
    if (s % 4 === 0) this.tone('sine', 150, at, 0.16, 0.9, bus, { slide: 42 });
    // Snare.
    if (s % 8 === 4 || fill) {
      this.noise(at, 0.13, fill ? 0.3 : 0.42, 'bandpass', 1900, bus, 0.7);
      this.tone('triangle', 210, at, 0.08, 0.25, bus, { slide: 120 });
    }
    // Hats.
    if (s % 2 === 0) {
      this.noise(at, s % 4 === 2 ? 0.09 : 0.035, s % 4 === 2 ? 0.16 : 0.09, 'highpass', 7500, bus);
    } else {
      this.noise(at, 0.02, 0.04, 'highpass', 9000, bus);
    }

    // Bass.
    if ([0, 3, 6, 8, 11, 14].includes(s)) {
      const n = ROOTS[chord] + tr + (s === 6 || s === 14 ? 12 : s === 11 ? 7 : 0);
      this.tone('sawtooth', noteToFreq(n), at, stepDur * 2.2, 0.34, bus, { lp: 700, lpEnd: 180, q: 3 });
      this.tone('sine', noteToFreq(n), at, stepDur * 2.4, 0.3, bus);
    }

    // Off-beat chord stabs.
    if (s % 4 === 2) {
      for (const n of CHORDS[chord]) {
        this.tone('square', noteToFreq(n + 12 + tr), at, stepDur * 1.3, 0.05, bus, { lp: 2600 });
        this.tone('sawtooth', noteToFreq(n + 12 + tr), at, stepDur * 1.3, 0.045, bus, { lp: 3200, detune: 9 });
      }
    }
    // Pad at the top of the bar.
    if (s === 0) {
      for (const n of CHORDS[chord]) {
        this.tone('triangle', noteToFreq(n + 12 + tr), at, stepDur * 15, 0.035, bus, { a: 0.08 });
      }
    }

    // Melody.
    const line = MELODY[bar];
    for (const [at2, note, len] of line) {
      if (at2 !== s) continue;
      const f = noteToFreq(note + tr);
      const d = Math.min(stepDur * len * 1.25, 0.9);
      this.tone('sine', f, at, d, 0.2, bus, { send: true });
      this.tone('sine', f * 2, at, d * 0.55, 0.085, bus, { send: true });
      this.tone('sine', f * 3.01, at, d * 0.25, 0.035, bus);
      this.tone('square', f, at, d * 0.8, 0.035, bus, { lp: 1800 });
    }

    // B section doubles the melody an octave up with a snapped snare.
    if (Math.floor(this.total / 256) % 2 === 1) {
      if (s % 8 === 4) {
        this.noise(at, 0.05, 0.2, 'bandpass', 1300, bus, 1.4);
        this.noise(at + 0.012, 0.07, 0.2, 'bandpass', 1300, bus, 1.4);
      }
      for (const [at2, note, len] of line) {
        if (at2 !== s) continue;
        this.tone('triangle', noteToFreq(note + tr + 12), at, Math.min(stepDur * len, 0.5), 0.05, bus, { send: true });
      }
    }

    if (this.starOn) {
      const n = STAR_LEAD[s % 8] + tr;
      this.tone('square', noteToFreq(n), at, 0.09, 0.085, this.fxg, { lp: 5200 });
      if (s % 2 === 0) this.tone('sine', noteToFreq(n - 24), at, 0.12, 0.2, this.fxg);
    }

    // Sparkle on the second half of the progression.
    if (bar >= 8 && s % 2 === 1) {
      const ch = CHORDS[chord];
      this.tone('sine', noteToFreq(ch[(s >> 1) % 3] + 36 + tr), at, 0.12, 0.03, bus, { send: true });
    }
  }

  /** The podium fanfare. */
  fanfare() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.05;
    const bus = this.music;
    for (const [offset, chord, dur] of FANFARE) {
      for (const n of CHORDS[chord]) {
        for (const oct of [12, 24]) {
          this.tone('sawtooth', noteToFreq(n + oct), t0 + offset, dur, 0.07, bus, { lp: 3000, lpEnd: 900, a: 0.02 });
          this.tone('square', noteToFreq(n + oct), t0 + offset, dur, 0.03, bus, { lp: 2000, detune: -8, a: 0.02 });
        }
      }
      this.tone('sine', 110, t0 + offset, 0.25, 0.7, bus, { slide: 45 });
      this.noise(t0 + offset, 0.2, 0.25, 'highpass', 5000, bus);
    }
    for (let i = 0; i < 12; i++) {
      this.noise(t0 + 1.5 + i * 0.055, 0.05, 0.1 + i * 0.012, 'bandpass', 1800, bus, 0.8);
    }
  }

  /**
   * Per-frame continuous mix: engine pitch, wind, tyre screech and crowd.
   * speed (units/s), boosting, drifting, crowd closeness 0..1, inTunnel 0..1
   */
  update(speed, boosting, drifting, crowd, audible, tunnel = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const norm = Math.abs(speed) / 33;
    const gear = Math.min(3, Math.floor(norm * 3.4));
    const withinGear = norm * 3.4 - gear;
    const freq = 56 + gear * 15 + withinGear * 42 + (boosting ? 26 : 0) + Math.sin(t * 40) * 1.5;

    this.windG.gain.setTargetAtTime(audible ? Math.min(0.02, norm * norm * 0.011) : 0, t, 0.1);
    this.windF.frequency.setTargetAtTime(450 + norm * 500, t, 0.1);
    this.caveG.gain.setTargetAtTime(tunnel * 0.3, t, 0.15);
    this.eng.frequency.setTargetAtTime(freq, t, 0.05);
    this.eng2.frequency.setTargetAtTime(freq * 0.5, t, 0.05);
    this.engF.frequency.setTargetAtTime(240 + norm * 620, t, 0.05);
    this.engG.gain.setTargetAtTime(audible ? 0.012 + norm * 0.014 : 0, t, 0.08);
    this.driftG.gain.setTargetAtTime(drifting ? 0.035 : 0, t, 0.04);
    this.crowdG.gain.setTargetAtTime(crowd * 0.35, t, 0.3);
  }

  // ------------------------------------------------------------------- sfx
  sfx(name, param = 1) {
    if (!this.ctx) return;
    const n = this.ctx.currentTime + 0.005;
    switch (name) {
      case 'beep':
        this.tone('square', 440, n, 0.22, 0.28, null, { lp: 2500 });
        this.tone('sine', 440, n, 0.3, 0.3);
        break;
      case 'go':
        this.tone('square', 880, n, 0.7, 0.3, null, { lp: 3500 });
        this.tone('sine', 880, n, 0.8, 0.35);
        this.tone('sine', 1320, n, 0.6, 0.12);
        break;
      case 'boost':
        this.noise(n, 0.7, 0.4, 'bandpass', 500, null, 1.2, 4500);
        this.tone('sawtooth', 160, n, 0.5, 0.16, null, { slide: 620, lp: 2200 });
        break;
      case 'charge':
        this.tone('square', 500 + param * 260, n, 0.12, 0.16, null, { slide: 900 + param * 300, lp: 4000 });
        break;
      case 'pickup':
        [784, 988, 1175, 1568].forEach((f, i) =>
          this.tone('square', f, n + i * 0.05, 0.1, 0.13, null, { lp: 5000 }));
        break;
      case 'coin': {
        const f = 988 * Math.pow(2, Math.min(param, 10) / 24);
        this.tone('sine', f, n, 0.09, 0.2);
        this.tone('sine', f * 1.335, n + 0.07, 0.32, 0.22);
        this.tone('square', f * 1.335, n + 0.07, 0.1, 0.04, null, { lp: 5000 });
        break;
      }
      case 'trick':
        [660, 880, 1109, 1319, 1760].forEach((f, i) => {
          this.tone('square', f, n + i * 0.045, 0.1, 0.1, null, { lp: 5000 });
          this.tone('sine', f, n + i * 0.045, 0.16, 0.14);
        });
        this.noise(n, 0.3, 0.14, 'bandpass', 900, null, 1.2, 5000);
        break;
      case 'warn':
        this.tone('square', 1480, n, 0.07, 0.16, null, { lp: 5000 });
        this.tone('square', 1480, n + 0.1, 0.07, 0.16, null, { lp: 5000 });
        break;
      case 'pop':
        this.noise(n, 0.12, 0.4, 'highpass', 2500);
        this.tone('sine', 900, n, 0.22, 0.3, null, { slide: 180 });
        break;
      case 'shield':
        [660, 990, 1320].forEach((f, i) =>
          this.tone('sine', f, n + i * 0.06, 0.5, 0.14, null, { a: 0.05 }));
        break;
      case 'thunder':
        this.noise(n, 1.1, 0.9, 'lowpass', 2600, null, 0.7, 70);
        this.tone('sawtooth', 70, n, 0.8, 0.5, null, { slide: 30, lp: 400 });
        this.noise(n, 0.08, 0.5, 'highpass', 4000);
        break;
      case 'up':
        this.tone('square', 784, n, 0.08, 0.1, null, { lp: 5000 });
        this.tone('square', 1175, n + 0.08, 0.16, 0.1, null, { lp: 5000 });
        this.tone('sine', 1175, n + 0.08, 0.25, 0.14);
        break;
      case 'down':
        this.tone('square', 523, n, 0.09, 0.09, null, { lp: 3000 });
        this.tone('square', 392, n + 0.09, 0.2, 0.09, null, { lp: 3000 });
        break;
      case 'horn':
        for (const d of [0, 0.16]) {
          this.tone('square', 370, n + d, 0.11, 0.1, null, { lp: 2200 });
          this.tone('square', 466, n + d, 0.11, 0.1, null, { lp: 2200 });
        }
        break;
      case 'splash':
        this.noise(n, 0.5, 0.5, 'bandpass', 1400, null, 0.6, 500);
        this.noise(n, 0.25, 0.3, 'highpass', 3500);
        break;
      case 'flyby':
        this.noise(n, 4.2 * param, 0.42, 'bandpass', 220, null, 0.8, 90);
        this.tone('sawtooth', 96, n, 3.6 * param, 0.22, null, { slide: 62, lp: 600, a: 0.9 });
        this.tone('sawtooth', 145, n, 3.6 * param, 0.14, null, { slide: 92, lp: 700, a: 0.9 });
        break;
      case 'tick':
        this.tone('square', 1250, n, 0.035, 0.09, null, { lp: 4000 });
        break;
      case 'itemget':
        [1047, 1319, 1568, 2093].forEach((f, i) => {
          this.tone('sine', f, n + i * 0.07, 0.25, 0.2);
          this.tone('square', f, n + i * 0.07, 0.12, 0.06, null, { lp: 4000 });
        });
        break;
      case 'rocket':
        this.noise(n, 0.9, 0.4, 'bandpass', 2500, null, 1.5, 500);
        this.tone('sawtooth', 700, n, 0.6, 0.12, null, { slide: 150, lp: 2000 });
        break;
      case 'explode':
        this.noise(n, 0.7, 0.75 * param, 'lowpass', 1800, null, 0.7, 90);
        this.tone('sine', 120, n, 0.5, 0.7 * param, null, { slide: 30 });
        break;
      case 'hit':
        this.tone('sawtooth', 600, n, 0.5, 0.2, null, { slide: 90, lp: 2500 });
        break;
      case 'drop':
        this.tone('sine', 520, n, 0.18, 0.25, null, { slide: 180 });
        break;
      case 'bump':
        this.noise(n, 0.12, 0.35, 'lowpass', 700);
        this.tone('sine', 95, n, 0.12, 0.4, null, { slide: 50 });
        break;
      case 'land':
        this.noise(n, 0.1, 0.22, 'lowpass', 500);
        break;
      case 'lap':
        [523, 659, 784, 1047, 1319].forEach((f, i) => {
          this.tone('square', f, n + i * 0.09, 0.2, 0.13, null, { lp: 4000 });
          this.tone('sine', f, n + i * 0.09, 0.3, 0.16);
        });
        break;
      case 'finish':
        [[0, 523], [0.15, 523], [0.3, 523], [0.45, 698], [0.75, 659],
          [0.9, 698], [1.05, 880], [1.35, 1047]].forEach(([d, f]) => {
          const long = d > 1.2 ? 1.2 : 0.22;
          this.tone('sawtooth', f, n + d, long, 0.12, null, { lp: 3500 });
          this.tone('sine', f * 2, n + d, long, 0.1);
          this.tone('sawtooth', f * 0.75, n + d, long, 0.07, null, { lp: 2500 });
        });
        break;
      default:
        break;
    }
  }
}
