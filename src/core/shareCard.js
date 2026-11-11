// Race-Off - auto-generated share cards for race results.
//
// After a race the results panel offers a SHARE button. This module paints a
// 1200x630 card ("I finished 1st on Volcano Rush - 1:42.3") on an offscreen
// canvas - same technique as icons.js, which already renders models to
// offscreen canvases - and then:
//   1. navigator.share() with a PNG file when the platform supports it
//   2. otherwise downloads the PNG and copies the text to the clipboard

import { formatTime } from './utils.js';

const W = 1200;
const H = 630;

const PLACE = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'];

/** Track accent colours for the card backdrop (matches the in-game skies). */
const SKINS = {
  beach: ['#37b6ff', '#7fe3ff'],
  jungle: ['#2fae4e', '#8fe07a'],
  desert: ['#f2a13c', '#ffd98a'],
  volcano: ['#c93a2c', '#ff9a4d'],
  snow: ['#5fb7e8', '#cfeeff'],
  sky: ['#6a7bff', '#b9c6ff'],
};

/**
 * Paint the share card. Resolves with the canvas once the character icon
 * (if any) has loaded. opts: { place, trackId, trackName, time, lapBest,
 * charIcon, coins, cc, mirror }
 */
export async function buildShareCard(opts) {
  const icon = opts.charIcon ? await loadImage(opts.charIcon) : null;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d');
  const [c1, c2] = SKINS[opts.trackId] || SKINS.beach;

  // Sky gradient + simple sun and road sweep for a "kart poster" feel.
  const sky = x.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, c1);
  sky.addColorStop(1, c2);
  x.fillStyle = sky;
  x.fillRect(0, 0, W, H);

  x.fillStyle = 'rgba(255,255,255,.35)';
  x.beginPath();
  x.arc(W - 170, 120, 70, 0, Math.PI * 2);
  x.fill();

  // Road: a wide dark sweep with dashes.
  x.fillStyle = '#3c3f52';
  x.beginPath();
  x.moveTo(-80, H);
  x.bezierCurveTo(W * 0.3, H * 0.45, W * 0.62, H * 0.95, W + 80, H * 0.42);
  x.lineTo(W + 80, H);
  x.closePath();
  x.fill();
  x.strokeStyle = 'rgba(255,255,255,.75)';
  x.lineWidth = 10;
  x.setLineDash([46, 40]);
  x.beginPath();
  x.moveTo(-60, H - 40);
  x.bezierCurveTo(W * 0.3, H * 0.56, W * 0.62, H * 0.99, W + 60, H * 0.52);
  x.stroke();
  x.setLineDash([]);

  // Dark vignette so the text pops.
  const vig = x.createLinearGradient(0, 0, 0, H);
  vig.addColorStop(0, 'rgba(8,16,50,.42)');
  vig.addColorStop(0.55, 'rgba(8,16,50,.05)');
  vig.addColorStop(1, 'rgba(8,16,50,.55)');
  x.fillStyle = vig;
  x.fillRect(0, 0, W, H);

  const italic = (px, weight = 900) =>
    `italic ${weight} ${px}px "Segoe UI", system-ui, sans-serif`;

  // Headline: the finishing position.
  x.textAlign = 'left';
  x.fillStyle = '#fff';
  x.shadowColor = 'rgba(8,16,50,.6)';
  x.shadowBlur = 18;
  x.shadowOffsetY = 6;
  x.font = italic(120);
  x.fillText(`I FINISHED ${PLACE[opts.place - 1] || 'RACING'}!`, 70, 165);

  // Track name.
  x.font = italic(58, 800);
  x.strokeStyle = 'rgba(8,16,50,.85)';
  x.lineWidth = 10;
  x.lineJoin = 'round';
  x.strokeText(`ON ${String(opts.trackName || '').toUpperCase()}`, 74, 238);
  x.fillStyle = '#ffe14a';
  x.fillText(`ON ${String(opts.trackName || '').toUpperCase()}`, 74, 238);

  // Big time (or points for GP rounds).
  x.font = italic(150);
  x.fillStyle = '#fff';
  const big = opts.time != null ? formatTime(opts.time) : String(opts.points ?? '');
  x.fillText(big, 66, 420);
  if (opts.time != null) {
    x.font = italic(40, 800);
    x.fillStyle = 'rgba(255,255,255,.85)';
    x.fillText('RACE TIME', 74, 472);
  }

  // Best lap + coins strip.
  x.font = italic(36, 800);
  x.fillStyle = 'rgba(255,255,255,.92)';
  const extras = [];
  if (opts.lapBest != null) extras.push(`BEST LAP ${formatTime(opts.lapBest)}`);
  if (opts.coins != null) extras.push(`${opts.coins} COINS`);
  if (opts.cc && opts.cc !== 1) extras.push(opts.cc < 1 ? '50CC' : '150CC');
  if (opts.mirror) extras.push('MIRROR');
  if (extras.length) x.fillText(extras.join('   \u00B7   '), 74, 530);

  // Character portrait top-right.
  if (icon) x.drawImage(icon, W - 300, 60, 220, 220);

  // Brand footer.
  x.textAlign = 'right';
  x.font = italic(46, 900);
  x.fillStyle = '#fff';
  x.fillText('RACE-OFF', W - 70, H - 56);
  x.font = italic(28, 700);
  x.lineWidth = 6;
  x.strokeText(location.origin.replace(/^https?:\/\//, '') || 'play race-off', W - 70, H - 20);
  x.fillStyle = 'rgba(255,255,255,.92)';
  x.fillText(location.origin.replace(/^https?:\/\//, '') || 'play race-off', W - 70, H - 20);
  x.shadowColor = 'transparent';
  x.shadowBlur = 0;
  x.shadowOffsetY = 0;

  return cv;
}

/** Load an image (data URL or path) as a decode-ready <img>. */
const loadImage = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/** The text that accompanies the card ("I finished 1st on ... - 1:42.3"). */
export function shareText(opts) {
  const place = PLACE[opts.place - 1] || 'raced';
  const t = opts.time != null ? ` - ${formatTime(opts.time)}` : '';
  return `I finished ${place} on ${opts.trackName}${t}`;
}

/** Offer the card to the user: native share sheet, else download + clipboard. */
export async function shareCard(canvas, text) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return 'none';
  const file = new File([blob], 'race-off.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch {
      /* user cancelled - fall through to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'race-off.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  try {
    await navigator.clipboard.writeText(text);
    return 'downloaded+copied';
  } catch {
    return 'downloaded';
  }
}
