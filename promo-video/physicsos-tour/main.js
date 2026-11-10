import { clamp, seg, hash } from '/core/lib.js';
import * as UI from './ui.js';
import * as BL from './ball.js';
import * as FM from './film.js';

const Q = new URLSearchParams(location.search), NOSUBS = Q.has('nosubs');
const worldEl = document.getElementById('world'), spr = document.getElementById('spr'), hudEl = document.getElementById('hud');
const mbg = document.getElementById('mbg'), mbw = document.getElementById('mbw');

const lines = await (await fetch('lines.json')).json();
const durs = await (await fetch('voices/dur.json')).json();
let words = null;
try { const r = await fetch('voices/words.json'); if (r.ok) words = await r.json(); } catch { words = null; }

const tf = ([cx, cy, z]) => `translate(960px,540px) scale(${z}) translate(${-cx}px,${-cy}px)`;
// world position of a live element, through the current camera
function anchors([cx, cy, z]) {
  const cache = {};
  return (key, fx = .5, fy = 0) => {
    const el = key in cache ? cache[key] : (cache[key] = worldEl.querySelector(`[data-a="${key}"]`));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width * fx - 960) / z + cx, y: (r.top + r.height * fy - 540) / z + cy, w: r.width / z, h: r.height / z };
  };
}
function render(t) {
  const F = FM.frame(t), [cx, cy, z] = F.cam;
  worldEl.innerHTML = UI.world(F);
  worldEl.style.transform = spr.style.transform = tf(F.cam);
  const A = anchors(F.cam);
  // motion blur from camera speed, only on whips (slow pushes stay sharp); applied to the untransformed wrapper
  const [px, py] = FM.camAt(t - 1 / 30), vx = (cx - px) * z, vy = (cy - py) * z;
  const bx = Math.min(22, Math.max(0, Math.abs(vx) - 26) * .24), by = Math.min(22, Math.max(0, Math.abs(vy) - 26) * .24);
  mbg.setAttribute('stdDeviation', `${bx.toFixed(2)} ${by.toFixed(2)}`);
  mbw.style.filter = bx > .6 || by > .6 ? 'url(#mb)' : '';
  spr.innerHTML = sprites(F, t, A, z) + F.fx.map(f => f(A)).join('');
  hudEl.innerHTML = hud(F, t, A, z, cx, cy);
  window.DBG = { cam: F.cam, bx, by };
  return A;
}

function sprites(F, t, A, z) {
  let h = '';
  const c = F.ball.eval(t, A);
  if (c) {
    h += BL.sprite(c);
    for (const j of F.ball.jumps) if (!j.nodust && t >= j.t1 && t < j.t1 + .42) {
      const L = F.ball.eval(j.t1 + .001, A); if (L) h += BL.dust(L.x, L.y, seg(t, j.t1, j.t1 + .42), Math.max(2, L.px * .8), 6, j.t1 * 10);
    }
  }
  const cu = F.cursor.eval(t, A);
  if (cu) {
    if (cu.sp > 900) for (let i = 1; i <= 4; i++) { const g = F.cursor.eval(t - i * .012, A); if (g) h += cursorSvg(g.x, g.y, 1, cu.op * .16 * (5 - i) / 4, z); }
    if (cu.ring > 0) { const r = (12 + 24 * cu.ring) / z; h += `<div class="ring" style="left:${cu.x - r}px;top:${cu.y - r}px;width:${2 * r}px;height:${2 * r}px;opacity:${((1 - cu.ring) * .75).toFixed(3)};border-width:${3 / z}px"></div>`; }
    h += cursorSvg(cu.x, cu.y, cu.sc, cu.op, z);
  }
  return h;
}
// the cursor keeps its screen size (1.6× the system size, as screen recorders do)
const cursorSvg = (x, y, sc, op, z) => {
  const s = 1.6 * sc / z;
  return `<svg style="position:absolute;left:${x - 2 * s}px;top:${y - 2 * s}px;opacity:${op};filter:drop-shadow(0 ${2 / z}px ${3 / z}px rgba(0,0,0,.3))" width="${22 * s}" height="${30 * s}" viewBox="0 0 22 30"><path d="M2 2 L2 24 L7.5 18.5 L11 27 L15 25.2 L11.6 17 L19 17 Z" fill="#000" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
};
const tri = (n, fill) => `<svg width="${n * 16}" height="18" viewBox="0 0 ${n * 16} 18" style="vertical-align:-2px">${Array.from({ length: n }, (_, i) => `<path d="M${i * 16 + 2} 2 L${i * 16 + 14} 9 L${i * 16 + 2} 16 Z" fill="${fill ? '#fff' : 'none'}" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>`).join('')}</svg>`;

function hud(F, t, A, z, cx, cy) {
  const H = F.hud; let h = '';
  const scr = p => ({ x: (p.x - cx) * z + 960, y: (p.y - cy) * z + 540 });
  if (H.spot) { const p = A(H.spot.key, .5, .5); if (p) { const s = scr(p), r = Math.max(p.w, p.h) * z * .7 + 70;
    h += `<div class="spot" style="opacity:${H.spot.op.toFixed(3)};background:radial-gradient(ellipse ${(r * 1.7).toFixed(0)}px ${r.toFixed(0)}px at ${s.x.toFixed(0)}px ${s.y.toFixed(0)}px, transparent 55%, rgba(14,22,40,.58) 100%)"></div>`; } }
  if (H.chap) h += `<div class="chap" style="opacity:${H.chap.op.toFixed(3)}"><b>${H.chap.no}</b>${H.chap.nm}</div>`;
  if (H.ramp) h += `<div class="ramp" style="opacity:${H.ramp.op.toFixed(3)}">${tri(2, H.ramp.blink)} ${H.ramp.label}</div>`;
  if (H.cap && !NOSUBS) h += `<div class="cap" style="opacity:${H.cap.op.toFixed(3)};transform:translate(-50%,${H.cap.y.toFixed(1)}px)">${H.cap.text}</div>`;
  if (H.wipe) h += wipe(H.wipe);
  if (H.fade) h += `<div class="fade" style="opacity:${H.fade.toFixed(3)}"></div>`;
  return h;
}
// chapter seam: blue pixel blocks sweep across, the hour and its name, and the ball bouncing over the cover in white
function wipe(W) {
  const S = 60, cols = 32, rows = 18, p = W.p, pal = ['#4176E6', '#3A6BD8', '#5A8AF0']; let s = '<div class="wipe">';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = (c / cols) * .55 + ((rows - r) / rows) * .2 + hash(c * 13.1 + r * 7.7) * .12;
    const a = clamp((p / .42 - d) / .18), b = clamp(((p - .55) / .42 - d) / .18), k = a * (1 - b);
    if (k <= 0) continue; const sz = S * k;
    s += `<b style="left:${(c * S + (S - sz) / 2).toFixed(1)}px;top:${(r * S + (S - sz) / 2).toFixed(1)}px;width:${(sz + .5).toFixed(1)}px;height:${(sz + .5).toFixed(1)}px;background:${pal[Math.floor(hash(c * 3.7 + r * 11.3) * 3)]}"></b>`;
  }
  const lo = clamp(Math.min((p - .3) / .12, (.82 - p) / .1));
  if (lo > 0) {
    s += `<div class="wlabel" style="opacity:${lo.toFixed(3)};transform:translateY(calc(-50% + ${((1 - lo) * 16).toFixed(1)}px))"><div class="no">${W.no}</div><div class="nm">${W.nm}</div></div>`;
    const hop = Math.abs(Math.sin(p * Math.PI * 3)), x = 300 + p * 1320, y = 830 - hop * 96;
    s += BL.sprite({ x, y, px: 6, eyes: 'r', sq: hop < .14 ? .26 * (1 - hop / .14) : -.08, op: lo, tint: '#FFFFFF' });
  }
  return s + '</div>';
}

window.TEXTS = t => {
  const H = FM.frame(t).hud, out = [];
  if (H.chap && H.chap.op > .98) out.push({ id: 'chap-' + H.chap.no, text: H.chap.no + ' ' + H.chap.nm, x0: 56, y0: 46, x1: 430, y1: 106 });
  if (H.ramp && H.ramp.op > .98) out.push({ id: 'ramp', text: H.ramp.label, x0: 1690, y0: 46, x1: 1864, y1: 98 });
  return out;
};

window.render = render;
await Promise.all(['16px NotoSC', '600 16px NotoSC', '700 16px NotoSC', '16px JBMono', '600 16px JBMono', '16px KMain', '16px KMainB', '16px KMath'].map(f => document.fonts.load(f)));
const imgs = ['wallpaper.jpg', 'wallpaper-dusk.jpg', 'wallpaper-night.jpg', 'mark.png', 'mascot-wave-320.webp', 'mascot-wave-640.webp', 'mascot-developer-640.webp', 'paper-empty.jpg', 'library-hero.png',
  'lab-portal-hero.jpg', 'question-portal-hero.jpg',
  ...['uniform-linear', 'average-speed', 'uniform-acceleration', 'projectile-horizontal', 'projectile-oblique', 'newton-second-law', 'incline', 'mechanical-energy', 'ramp-friction', 'lever-balance', 'parallel-plate', 'magnetic-circular', 'lab'].map(n => `art/${n}.jpg`)];
await Promise.all(imgs.map(src => new Promise(res => { const im = new Image(); im.onload = im.onerror = () => res(); im.src = 'assets/' + src; })));
// the camera's push onto the 67/67 chip needs the chip's place on the live page
FM.build(lines, words, durs);
{ const p = render(FM.T.tr1 + .3)('pass', .5, .5); if (p) { FM.setPass({ x: p.x, y: p.y }); FM.build(lines, words, durs); } }
window.DUR = FM.DUR;
window.EV = FM.EV;
window.T = FM.T;
window.SUBS = FM.SUBS.map(s => ({ t0: +s.t0.toFixed(2), t1: +s.t1.toFixed(2), text: s.text }));
render(+(Q.get('t') || 0));
window.READY = true;
