// Race-Off - the in-race heads-up display.
//
// Wires the HUD markup in index.html to the game state: lap counter, timer,
// coin count, the animated position board, the minimap, the item slot with its
// roulette, the speedometer, the turbo pips, floating name tags, toasts,
// banners and the big countdown.

import * as THREE from 'three';
import { clamp, formatTime } from '../core/utils.js';
import { ITEM_NAMES } from '../items/Items.js';

const $ = (id) => document.getElementById(id);
const SUFFIX = ['st', 'nd', 'rd', 'th', 'th', 'th'];

export class HUD {
  constructor(icons, racers) {
    this.icons = icons;
    this.racers = racers;
    this.rouletteT = 0;
    this.rouletteI = 0;
    this.lastPos = 0;
    this.bannerT = 0;
    this.toastT = 0;
    this.warnOn = false;
    this.rows = {};
    this.names = {};
    this._tn = -1;
    this._tq = null;
    this._time = '';
    this._board = '';
    this.rowsEl = $('board');

    // Position board rows, one per racer.
    for (const r of racers) {
      const row = document.createElement('div');
      row.className = 'row' + (r.id === racers[0].id ? ' me' : '');
      row.innerHTML = `<span class="n"></span><img src="${icons[r.id] || ''}" alt=""><span class="nm">${r.name}</span>`;
      row.style.setProperty('--c', r.css);
      this.rowsEl.appendChild(row);
      this.rows[r.id] = row;
    }

    // Floating name tags.
    this.tagEls = racers.map((r) => {
      const el = document.createElement('div');
      el.className = 'tag';
      el.style.setProperty('--c', r.css);
      el.innerHTML = `<b></b><span>${r.name}</span><i></i>`;
      $('tags').appendChild(el);
      return { el, id: r.id, n: el.children[0], e: el.children[2], on: false, emo: '', rank: 0 };
    });

    this.tpips = Array.from(document.querySelectorAll('#turbo i b'));
    this.mm = $('minimap');
    this.mctx = this.mm.getContext('2d');
    this.coinImg = $('coinimg');
    if (icons.coin) this.coinImg.src = icons.coin;

    this.itemBox = $('itembox');
    this.itemImg = $('itemimg');
    this.itemNameEl = $('itemname');
    this.speedEl = $('speed');
    this.turboEl = $('turbo');
    this.turboBtn = $('tb-turbo');
    this.toastEl = $('toast');
    this.bannerEl = $('banner');
    this.countEl = $('count');
    this.posEl = $('pos');
    this.warnEl = $('warn');
    this.touch = false;
  }

  show(on) {
    $('hud').classList.toggle('on', !!on);
  }

  // ------------------------------------------------------------------ basics
  setLap(lap, total = 3) {
    $('lapn').textContent = Math.min(Math.max(lap, 1), total);
  }

  setTime(sec) {
    const s = formatTime(sec);
    if (s !== this._time) {
      this._time = s;
      $('timer').textContent = s;
    }
  }

  /** Best-lap readout under the timer (time trial only). */
  setBest(sec) {
    const el = $('best');
    if (!el) return;
    if (!(sec > 0)) {
      el.style.display = 'none';
      this._best = '';
      return;
    }
    const s = `BEST ${formatTime(sec)}`;
    if (s !== this._best) {
      this._best = s;
      el.textContent = s;
    }
    el.style.display = '';
  }

  /** Engine-class / mirror badge under the lap counter. */
  setMode(cc, mirror) {
    const el = $('mode');
    if (!el) return;
    const parts = [];
    if (cc === 0.85) parts.push('50cc');
    if (cc === 1.15) parts.push('150cc');
    if (mirror) parts.push('MIRROR');
    const s = parts.join(' ');
    if (s !== this._mode) {
      this._mode = s;
      el.textContent = s;
      el.style.display = s ? '' : 'none';
    }
  }

  setPos(rank) {
    if (rank === this.lastPos) return;
    this.lastPos = rank;
    const el = this.posEl;
    el.innerHTML = `${rank}<sup>${SUFFIX[rank - 1]}</sup>`;
    el.className = 'p' + rank;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  setSpeed(speed, boosting) {
    const n = Math.round(Math.abs(speed) * 4.2);
    if (n === this._sp && boosting === this._sb) return;
    this._sp = n;
    this._sb = boosting;
    $('spd').textContent = n;
    this.speedEl.classList.toggle('boost', !!boosting);
    $('spdbar').style.width = `${Math.min(100, (Math.abs(speed) / 44) * 100).toFixed(0)}%`;
  }

  setCoins(n, lost = false) {
    const el = $('coins');
    $('coinn').textContent = n;
    el.classList.toggle('max', n >= 10);
    el.classList.remove('pop', 'lost');
    void el.offsetWidth;
    el.classList.add(lost ? 'lost' : 'pop');
  }

  // ------------------------------------------------------------------- items
  setItem(item) {
    this.rouletteT = 0;
    $('tb-item').classList.toggle('has', !!item);
    if (item) $('tb-itemimg').src = this.icons[item] || '';
    this.itemBox.classList.remove('roll');
    if (!item) {
      this.itemImg.style.display = 'none';
      this.itemBox.classList.remove('has');
      this.itemNameEl.textContent = '';
      return;
    }
    this.itemImg.src = this.icons[item] || '';
    this.itemImg.style.display = 'block';
    this.itemBox.classList.add('has');
    this.itemBox.classList.remove('pop');
    void this.itemBox.offsetWidth;
    this.itemBox.classList.add('pop');
    this.itemNameEl.textContent = ITEM_NAMES[item] || '';
  }

  startRoulette() {
    this.rouletteT = 1.5;
    this.itemImg.style.display = 'block';
    this.itemBox.classList.remove('has');
    this.itemBox.classList.add('roll');
  }

  // ------------------------------------------------------------------- turbo
  setTurbo(bars) {
    const q = Math.round(bars * 40);
    if (q === this._tq) return;
    this._tq = q;
    const whole = Math.floor(bars + 1e-4);
    let ring = '';
    for (let i = 0; i < 3; i++) {
      const a = Math.max(0, Math.min(1, bars - i));
      if (this.tpips[i]) {
        this.tpips[i].style.width = `${(a * 100).toFixed(0)}%`;
        this.tpips[i].parentNode.classList.toggle('full', a >= 1);
      }
      const from = i * 120 + 6;
      const to = (from + 108 * a).toFixed(1);
      ring += `transparent ${from - 6}deg ${from}deg, ${a >= 1 ? '#ffe14a' : '#ff9a1e'} ${from}deg ${to}deg, rgba(255,255,255,.3) ${to}deg ${from + 108}deg, transparent ${from + 108}deg ${from + 114}deg${i < 2 ? ', ' : ''}`;
    }
    if (this.turboBtn) {
      this.turboBtn.style.setProperty('--ring', `conic-gradient(${ring})`);
      this.turboBtn.classList.toggle('empty', whole < 1);
      const tbN = $('tb-n');
      if (tbN) tbN.textContent = whole;
    }
    if (whole > this._tn && this._tn >= 0) this.kick('ready');
    this._tn = whole;
  }

  kick(cls) {
    for (const el of [this.turboBtn, this.turboEl]) {
      if (!el) continue;
      el.classList.remove('ready', 'gain', 'nope');
      void el.offsetWidth;
      el.classList.add(cls);
    }
  }

  turboGain() {
    this.kick('gain');
  }

  turboEmpty() {
    this.kick('nope');
    if (this.toastT <= 0) this.toast('TURBO EMPTY', 'red', 0.9);
  }

  // -------------------------------------------------------------------- text
  toast(text, tone = '', time = 1.1) {
    const el = this.toastEl;
    el.textContent = text;
    el.className = tone;
    void el.offsetWidth;
    el.classList.add('show');
    this.toastT = time;
  }

  banner(text, tone = '', time = 2) {
    const el = this.bannerEl;
    el.textContent = text;
    el.className = `show ${tone}`;
    void el.offsetWidth;
    this.bannerT = time;
  }

  count(text, isGo = false) {
    const el = this.countEl;
    el.textContent = text;
    el.className = isGo ? 'go' : 'num';
    void el.offsetWidth;
    el.classList.add('anim');
  }

  warn(on) {
    if (on === this.warnOn) return;
    this.warnOn = on;
    this.warnEl.classList.toggle('on', on);
  }

  setNames(names) {
    this.names = names;
    for (const r of this.racers) {
      const n = names[r.id];
      const nm = this.rows[r.id].querySelector('.nm');
      if (nm) nm.textContent = n || r.name;
      this.rows[r.id].classList.toggle('hu', n !== undefined);
      const tag = this.tagEls.find((t) => t.id === r.id);
      if (tag) {
        tag.el.children[1].textContent = n || r.name;
        tag.el.classList.toggle('hu', n !== undefined);
      }
    }
  }

  setPlayer(id) {
    for (const k in this.rows) this.rows[k].classList.toggle('me', k === id);
  }

  // ------------------------------------------------------------------- board
  board(ranked) {
    const key = ranked.map((k) => k.def.id).join(',');
    if (key === this._board) return;
    this._board = key;
    ranked.forEach((k, i) => {
      const row = this.rows[k.def.id];
      if (!row) return;
      // Spacing comes from --rowh so short screens can compact the board.
      row.style.transform = `translateY(calc(${i} * var(--rowh, 46px)))`;
      row.firstChild.textContent = i + 1;
    });
  }

  // ------------------------------------------------------------------ tags
  nameTags(karts, camera, enabled) {
    const v = this._v || (this._v = new THREE.Vector3());
    const w = innerWidth;
    const h = innerHeight;
    for (const t of this.tagEls) {
      const k = karts.find((x) => x.def.id === t.id);
      let visible = false;
      if (enabled && k && !k.isPlayer) {
        v.set(k.x, k.y + 2.25 * k.size, k.z);
        const dist = v.distanceTo(camera.position);
        v.project(camera);
        if (v.z < 1 && dist < 46 && dist > 2.5 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05) {
          visible = true;
          const scale = clamp(11 / dist, 0.45, 1.15);
          // Keep the tag inside the viewport - karts near the screen edge
          // would otherwise drag their tag halfway out of view.
          const px = clamp(((v.x + 1) / 2) * w, 70, w - 70);
          const py = clamp(((1 - v.y) / 2) * h, 30, h - 12);
          t.el.style.transform =
            `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
          t.el.style.opacity = clamp((46 - dist) / 12, 0, 1).toFixed(2);
          if (t.rank !== k.rank) {
            t.rank = k.rank;
            t.n.textContent = k.rank;
          }
          const emo = k.emoteT > 0 ? k.emote : '';
          if (emo !== t.emo) {
            t.emo = emo;
            t.e.textContent = emo;
            t.el.classList.toggle('emo', !!emo);
          }
        }
      }
      if (visible !== t.on) {
        t.on = visible;
        t.el.style.display = visible ? 'flex' : 'none';
      }
    }
  }

  // ---------------------------------------------------------------- minimap
  initMinimap(track) {
    let minX = 1e9;
    let maxX = -1e9;
    let minZ = 1e9;
    let maxZ = -1e9;
    for (let i = 0; i < track.N; i++) {
      minX = Math.min(minX, track.px[i]);
      maxX = Math.max(maxX, track.px[i]);
      minZ = Math.min(minZ, track.pz[i]);
      maxZ = Math.max(maxZ, track.pz[i]);
    }
    const W = this.mm.width;
    const H = this.mm.height;
    const pad = 16;
    const scale = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
    this.mp = (x, z) => [
      pad + (x - minX) * scale + (W - pad * 2 - (maxX - minX) * scale) / 2,
      pad + (z - minZ) * scale + (H - pad * 2 - (maxZ - minZ) * scale) / 2,
    ];

    const bg = document.createElement('canvas');
    bg.width = W;
    bg.height = H;
    const f = bg.getContext('2d');
    f.lineJoin = f.lineCap = 'round';
    f.beginPath();
    for (let i = 0; i <= track.N; i += 4) {
      const [x, y] = this.mp(track.px[i % track.N], track.pz[i % track.N]);
      if (i) f.lineTo(x, y);
      else f.moveTo(x, y);
    }
    f.closePath();
    f.strokeStyle = 'rgba(10,20,50,0.75)';
    f.lineWidth = 11;
    f.stroke();
    f.strokeStyle = '#fff';
    f.lineWidth = 5.5;
    f.stroke();

    const [sx, sy] = this.mp(track.px[0], track.pz[0]);
    f.fillStyle = '#ffd21e';
    f.fillRect(sx - 2, sy - 8, 4, 16);
    this.mbg = bg;
    this._mf = 0;
  }

  minimap(karts) {
    this._mf = (this._mf | 0) + 1;
    if (this._mf & 1) return;
    const t = this.mctx;
    t.clearRect(0, 0, this.mm.width, this.mm.height);
    if (this.mbg) t.drawImage(this.mbg, 0, 0);
    for (let i = karts.length - 1; i >= 0; i--) {
      const k = karts[i];
      const [x, y] = this.mp(k.x, k.z);
      t.beginPath();
      t.arc(x, y, k.isPlayer ? 7.5 : 5, 0, 7);
      t.fillStyle = k.def.css;
      t.fill();
      t.lineWidth = k.isPlayer ? 3 : 2;
      t.strokeStyle = k.isPlayer ? '#fff' : 'rgba(10,20,50,0.9)';
      t.stroke();
    }
  }

  // ------------------------------------------------------------------ update
  update(dt, audio) {
    if (this.rouletteT > 0) {
      const tick = Math.floor(this.rouletteT * 14);
      this.rouletteT -= dt;
      if (Math.floor(this.rouletteT * 14) !== tick) {
        const pool = Object.keys(ITEM_NAMES);
        this.rouletteI = (this.rouletteI + 1) % pool.length;
        this.itemImg.src = this.icons[pool[this.rouletteI]] || '';
        if (audio) audio.sfx('tick');
      }
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.classList.remove('show');
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.bannerEl.className = '';
    }
  }

  // --------------------------------------------------------------- results
  results(ranked, player, lapTimes = [], hint = '', quit = false, cup = null, headOverride = null) {
    const el = $('results');
    const best = lapTimes.length ? Math.min(...lapTimes) : 0;
    let place = player.rank;
    let head = headOverride;

    if (cup) {
      el.classList.add('gp');
      if (cup.final) {
        const sorted = ranked.slice().sort(
          (a, b) => cup.pts[cup.key(b)] - cup.pts[cup.key(a)] || a.rank - b.rank,
        );
        place = sorted.indexOf(player) + 1;
        head = ['GRAND PRIX CHAMPION!', '2ND OVERALL!', '3RD OVERALL!', '4TH OVERALL', '5TH OVERALL', '6TH OVERALL'][place - 1];
      } else {
        head = `RACE ${cup.race} OF ${cup.total}: ${['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'][place - 1]}`;
      }
    }

    let html = `<div class="rhead">${place <= 3 && !headOverride ? `<img class="cup c${place}" src="${this.icons.trophy || ''}" alt="">` : ''}<h2>${head || ['YOU WIN!', '2ND PLACE!', '3RD PLACE!', '4TH PLACE', '5TH PLACE', '6TH PLACE'][place - 1]}</h2></div>`;

    ranked.forEach((k, i) => {
      html += `<div class="rr${k === player ? ' me' : ''} m${i + 1}" style="--c:${k.def.css};animation-delay:${i * 0.09}s"><span class="n">${i + 1}</span><img src="${this.icons[k.def.id] || ''}" alt=""><span class="nm">${this.names[k.def.id] || k.def.name}</span><span class="t">${cup ? (cup.final ? '' : `<i>+${cup.gain[cup.key(k)]}</i>`) + `<b>${cup.pts[cup.key(k)]}</b> PTS` : k.finished ? formatTime(k.finishTime) : '\u2014'}</span></div>`;
    });

    html += `<div class="laps">${lapTimes.map((t, i) => `<span class="${t === best ? 'best' : ''}">LAP ${i + 1} <b>${formatTime(t)}</b></span>`).join('')}<span><img src="${this.icons.coin || ''}" alt=""><b>${player.coins}</b></span></div>`;
    html += `<div class="again">${hint || (this.touch ? 'TAP TO RACE AGAIN' : 'PRESS ENTER TO RACE AGAIN')}</div>`;

    el.innerHTML = html;
    el.classList.toggle('q', !!quit);
    el.classList.add('on');
  }

  hideResults() {
    $('results').classList.remove('on');
  }
}
