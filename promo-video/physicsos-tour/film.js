// 《PhysicsOS 的一天》timeline: voice and word anchors, camera, the ball, the cursor, UI state, HUD and sound events.
// One source for picture and sound: everything the mixer needs is pushed into EV.
import { clamp, lerp, seg, ss, eio, eo, back, hash } from '/core/lib.js';
import { W2, BLOCKS, TRACE, LOOP, loopPt, WAVE, waveY, IND, LABS } from './ui.js';
import * as BL from './ball.js';

export const BPM = 96, B = 60 / BPM, BAR = 4 * B, Q16 = B / 4;
export const bar = n => (n - 1) * BAR;
export const DUR = 107.5;
export const VO = { v01: 1.25, v02: 7.5, v03: 15, v04: 22.5, v05: 30.05, v06: 38.75, v07: 46.25, v08: 51.25, v09: 60, v10: 64.6, v11: 72.6, v12: 80, v13: 88.75, v14: 98.75 };
let LINES = {}, WORDS = null, DURS = {};

// ───────── word anchors: whisper word timestamps when present, otherwise proportional to the spoken length
const clean = s => s.toLowerCase().replace(/[\s，。、？！：；“”「」…—,.!?:;"'·]/g, '');
const weight = ch => /[a-z0-9]/i.test(ch) ? .38 : /[，、]/.test(ch) ? 1.6 : /[。？！]/.test(ch) ? 0 : 1;
export function W(id, frag, end = false) {
  const ws = WORDS && WORDS[id], target = clean(frag);
  if (ws && ws.length) {
    const chars = [];
    for (const w of ws) {
      const [wt, a, b] = Array.isArray(w) ? w : [w.word ?? w.w, w.start ?? w.s, w.end ?? w.e];
      const c = clean(String(wt)); for (let i = 0; i < c.length; i++) chars.push([c[i], a + (b - a) * i / c.length, a + (b - a) * (i + 1) / c.length]);
    }
    const k = chars.map(c => c[0]).join('').indexOf(target);
    if (k >= 0) return VO[id] + Math.max(0, end ? chars[k + target.length - 1][2] : chars[k][1]);
  }
  const text = LINES[id].text.replace(/\s+/g, ''), f = frag.replace(/\s+/g, '');
  const k = text.toLowerCase().indexOf(f.toLowerCase());
  if (k < 0) throw new Error(`"${frag}" not in ${id}`);
  let before = 0, total = 0; const upto = end ? k + f.length : k;
  for (let i = 0; i < text.length; i++) { const w = weight(text[i]); total += w; if (i < upto) before += w; }
  return VO[id] + (DURS[id] - .12) * before / total;
}

// ───────── sound / cue events
export const EV = [];
const ev = (t, type, o = {}) => EV.push({ t: +t.toFixed(3), type, ...o });

// ───────── screen-recorder camera: one take, moves may overlap, zoom ≥ 1 and never past the monitor
const EASE = { eio, ss, eo, lin: x => clamp(x), whip: x => { x = clamp(x); return x < .5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2; } };
const MOVES = []; let CAM0 = [960, 540, 1.0];
const cam = (t0, d, to, e = 'eio') => MOVES.push({ t0, d, to, e });
export function camAt(t) {
  let v = [CAM0[0], CAM0[1], Math.log(CAM0[2])];
  for (const m of MOVES) { if (t <= m.t0) break; const p = EASE[m.e]((t - m.t0) / m.d); v = [lerp(v[0], m.to[0], p), lerp(v[1], m.to[1], p), lerp(v[2], Math.log(m.to[2]), p)]; }
  const z = Math.exp(v[2]), hw = 960 / z, hh = 540 / z;
  const cx = v[0] + Math.sin(t * .7) * 1.6 / z, cy = v[1] + Math.sin(t * .53 + 1) * 1.2 / z;   // a hand on the trackpad
  return [clamp(cx, hw, 1920 - hw), clamp(cy, hh, 1080 - hh), z];
}

// ───────── the ball
class Ball {
  constructor() { this.segs = []; this.jumps = []; }
  add(s) { this.segs.push(s); return this; }
  hide(t0, t1) { return this.add({ k: 'hide', t0, t1 }); }
  stand(t0, t1, at, o = {}) { return this.add({ k: 'stand', t0, t1, at, ...o }); }
  path(t0, t1, fn, o = {}) { return this.add({ k: 'path', t0, t1, fn, ...o }); }
  jump(t0, t1, from, to, h = 60, o = {}) {
    this.jumps.push({ t0, t1, big: o.big, nodust: o.nodust });
    if (!o.silent) { ev(t0 - .02, 'jump', { d: t1 - t0, big: !!o.big }); ev(t1, 'land', { v: o.big ? 1 : .6 }); }
    return this.add({ k: 'jump', t0, t1, from, to, h, ...o });
  }
  seg(t) { for (const x of this.segs) if (x.t0 <= t && t < x.t1) return x; return null; }
  eval(t, A) {
    const s = this.seg(t); if (!s || s.k === 'hide') return null;
    const px = typeof s.px === 'function' ? s.px(t) : (s.px || 4);
    const P = f => typeof f === 'function' ? f(A, t) : f;
    let pos, sq = 0, eyes = 'n';
    if (s.k === 'stand') pos = P(s.at);
    if (s.k === 'path') pos = s.fn(t, A);
    if (s.k === 'jump') {
      const a = P(s.from), b = P(s.to); if (!a || !b) return null;
      const p = seg(t, s.t0, s.t1), ap = Math.min(a.y, b.y) - s.h, cy = 2 * ap - (a.y + b.y) / 2;
      pos = { x: lerp(a.x, b.x, p), y: (1 - p) ** 2 * a.y + 2 * (1 - p) * p * cy + p * p * b.y };
      sq = p < .5 ? -.2 * (1 - p * 2) : -.1 * (p * 2 - 1);
      eyes = b.x > a.x + 4 ? 'r' : b.x < a.x - 4 ? 'l' : (b.y < a.y ? 'u' : 'd');
    }
    if (!pos) return null;
    for (const j of this.jumps) {
      if (t >= j.t0 - .13 && t < j.t0) sq = Math.max(sq, .3 * ss(seg(t, j.t0 - .13, j.t0)));
      if (t >= j.t1 && t < j.t1 + .24) { const k = seg(t, j.t1, j.t1 + .24); sq = (j.big ? .42 : .3) * (1 - k) * Math.cos(k * 7); }
    }
    if (s.k === 'stand' && !s.still) { const bp = ((t % B) + B) % B; if (bp < .12) sq += .06 * Math.sin(bp / .12 * Math.PI); }
    if (s.sqv) sq = s.sqv(t, sq);
    if (s.eyes) { const e = typeof s.eyes === 'function' ? s.eyes(t) : s.eyes; if (e) eyes = e; }
    const bl = Math.floor(t / 2.7), bt = t - bl * 2.7 - hash(bl * 3.7) * 1.9;
    if (bt > 0 && bt < .1 && ['n', 'l', 'r', 'u', 'd', 'dr', 'dl', 'ur'].includes(eyes)) eyes = 'blink';
    const x = Math.round(pos.x / (px / 2)) * (px / 2);
    return { x, y: pos.y, px, sq, eyes, op: s.op ? s.op(t) : 1 };
  }
}

// ───────── the cursor (the user)
class Cursor {
  constructor() { this.moves = []; this.clicks = []; this.vis = []; }
  show(t0, t1) { this.vis.push([t0, t1]); return this; }
  move(t0, t1, to, arc = 40) { this.moves.push({ t0, t1, to, arc }); return this; }
  click(t, kind = 'click') { this.clicks.push(t); ev(t, kind); return this; }
  eval(t, A) {
    let op = 0; for (const [a, b] of this.vis) op = Math.max(op, Math.min(seg(t, a, a + .15), 1 - seg(t, b - .2, b)));
    if (op <= 0) return null;
    let p = null, prev = null;
    for (const m of this.moves) {
      const to = m.to(A, t); if (!to) continue;
      if (t < m.t0) break;
      if (!prev) { p = to; prev = to; continue; }
      const k = seg(t, m.t0, m.t1), e = eio(k), from = prev, dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy) || 1;
      p = { x: lerp(from.x, to.x, e) - dy / L * m.arc * Math.sin(Math.PI * e), y: lerp(from.y, to.y, e) + dx / L * m.arc * Math.sin(Math.PI * e), sp: Math.abs(Math.sin(Math.PI * k)) * L / (m.t1 - m.t0 + 1e-6) };
      prev = k >= 1 ? to : from; if (k < 1) break;
    }
    if (!p) return null;
    let sc = 1, ring = 0; for (const c of this.clicks) { if (t >= c && t < c + .1) sc = .82; if (t >= c && t < c + .45) ring = seg(t, c, c + .45); }
    return { ...p, op, sc, ring };
  }
}

// anchors: a point on a live DOM element (reuses its last position while the element is absent)
const at = (key, fx = .5, fy = 0, dx = 0, dy = 0) => { let last = null; return A => { const p = A(key, fx, fy); if (p) last = { x: p.x + dx, y: p.y + dy }; return last; }; };
const pt = (x, y) => () => ({ x, y });

export const SUBS = [], T = {};
let BALLA = null, CUR = null;
const CH = [], WIPES = [];

// fixed world points on the sidebar (it is the same on every page), for jumps that outlive a page
const sideX = fx => 96 + .9 * (14 + 252 * fx);
const RS = (i, fx = .76) => ({ x: sideX(fx), y: 76 + .9 * (502 + 33 * i) });
const RSC = i => pt(sideX(.34), 76 + .9 * (502 + 33 * i + 15));
const NAVY = { home: 150, lab: 228, exam: 268, lib: 348, up: 388 };
const NAV = (k, fx = .8) => ({ x: sideX(fx), y: 76 + .9 * NAVY[k] });
const NAVC = k => pt(sideX(.36), 76 + .9 * (NAVY[k] + 18));
const fixed = p => () => p;
// a point in the lab canvas (SVG units are page px)
const cvp = (A, lx, ly) => A('canvas', lx / 883, ly / 440);
const cv = (lx, ly) => A => cvp(A, lx, ly);
const SENDP = W2(1548, 507), BUBBLEP = W2(1520, 99);
let PASS = { x: 1450, y: 366 };

// the labs' clocks
const FLOW = 550;                                  // current dots in the circuit, SVG px/s
const WAVE_HZ = .8;                                // the standing wave as drawn: one swing every two beats
const BAR_V = 90;                                  // the conductor bar, SVG px per simulated second
const LAP = 2 * ((LOOP.y1 - LOOP.y0) + (LOOP.x1 - LOOP.x0));
const ph = t => 2 * Math.PI * WAVE_HZ * (t - T.ph0);     // swings land on the beat
const barX = t => IND.start + BAR_V * clamp(t - T.play, 0, 5);
const WX = k => WAVE.xa + (WAVE.xb - WAVE.xa) * k;
const onString = k => (A, t) => cvp(A, WX(k), waveY(WX(k), ph(t)) - 2);
const onBar = (A, t) => cvp(A, barX(t), IND.top - 14);
// riding the current round the loop: over R₁, the ammeter and the cell, beside the switch and R₂
function ridePt(s) {
  const { x0, x1, y0, y1 } = LOOP, a = y1 - y0, b = x1 - x0;
  s = ((s % LAP) + LAP) % LAP; const p = loopPt(s);
  const bump = (u, lo, hi, h) => u > lo && u < hi ? h * Math.sin(Math.PI * (u - lo) / (hi - lo)) : 0;
  const side = d => Math.min(1, d / 40, (a - d) / 40);
  if (s < a) { const r = side(s); return { x: x0 - 30 * r, y: p.y - 2 + 22 * r, e: 'u' }; }
  if (s < a + b) return { x: p.x, y: y0 - 2 - bump(p.x, 334, 446, 30) - bump(p.x, 530, 590, 38), e: 'r' };
  if (s < 2 * a + b) { const r = side(s - a - b); return { x: x1 + 30 * r, y: p.y - 2 + 22 * r, e: 'd' }; }
  return { x: p.x, y: y1 - 2 - bump(p.x, 412, 488, 34), e: 'l' };
}

// 最近空间 as each page shows it
const R_CIRCUIT = [['串联电路', '刚刚'], ['斜面运动', '14 小时前'], ['两端固定的弦驻波', '1 天前'], ['导体棒切割磁感线', '1 天前'], ['光电效应', '1 天前'], ['凸透镜成像规律', '1 天前'], ['速度选择器', '1 天前'], ['磁场中的带电粒子运动', '1 天前']];
const R_WAVE = [['两端固定的弦驻波', '刚刚'], ['串联电路', '1 分钟前'], ['斜面运动', '14 小时前'], ['导体棒切割磁感线', '1 天前'], ['光电效应', '1 天前'], ['凸透镜成像规律', '1 天前'], ['速度选择器', '1 天前'], ['磁场中的带电粒子运动', '1 天前']];
const R_IND = [['导体棒切割磁感线', '刚刚'], ['两端固定的弦驻波', '1 分钟前'], ['串联电路', '1 分钟前'], ['斜面运动', '14 小时前'], ['光电效应', '1 天前'], ['凸透镜成像规律', '1 天前'], ['速度选择器', '1 天前'], ['磁场中的带电粒子运动', '1 天前']];
const R_PM = h => [['导体棒切割磁感线', `${h} 小时前`], ['两端固定的弦驻波', `${h} 小时前`], ['串联电路', `${h} 小时前`], ['斜面运动', h + 14 < 24 ? `${h + 14} 小时前` : '1 天前'],
  ['光电效应', '1 天前'], ['凸透镜成像规律', '1 天前'], ['速度选择器', '1 天前'], ['磁场中的带电粒子运动', '1 天前']];
const Q = '为什么洛伦兹力不做功？';

export function build(lines, words, durs) {
  LINES = Object.fromEntries(lines.map(l => [l.id, l])); WORDS = words; DURS = durs;
  EV.length = 0; MOVES.length = 0; SUBS.length = 0; CH.length = 0; WIPES.length = 0;
  for (const k of Object.keys(T)) delete T[k];
  BALLA = new Ball(); CUR = new Cursor();
  const ids = Object.keys(VO);
  ids.forEach((id, i) => {
    ev(VO[id], 'vo', { id });
    const t0 = VO[id] - .05, nxt = i + 1 < ids.length ? VO[ids[i + 1]] - .1 : DUR - .2;
    SUBS.push({ id, t0, t1: Math.min(nxt, Math.max(t0 + 1.8, VO[id] + durs[id] + .58)), text: LINES[id].sub });
  });
  const C = BALLA;
  const wipe = (t0, no, nm) => { WIPES.push([t0, no, nm]); ev(t0, 'wipe'); CH.push([t0 + .62, no, nm]); };
  const drop = (t0, t1, to, h = 240, o = {}) => {
    C.path(t0, t1, (t, A) => { const p = to(A, t); return p && { x: p.x, y: p.y - h * (1 - seg(t, t0, t1) ** 2) }; }, { eyes: 'd', ...o });
    C.jumps.push({ t0, t1, big: true }); ev(t1, 'land', { v: .8 });
  };

  // ═════ 07:30 早晨 (0 – 13.75): the clock ticks over; the ball drops out of the menu bar into the composer
  CAM0 = [960, 540, 1.0];
  T.tick = W('v01', '七点半') - .02; ev(T.tick, 'tick');
  CH.push([T.tick + .45, '07:30', '早晨']);
  T.landC = bar(3); T.pop = T.landC - .92;                       // lands on “PhysicsOS”; the band comes in
  const clockPt = A => { const p = A('clock', .5, 1); return p && { x: p.x, y: p.y + 4 }; };
  const cmpTop = at('composer', .72, 0);
  C.hide(0, T.pop).jump(T.pop, T.landC, clockPt, cmpTop, 12, { big: true, px: t => lerp(1.4, 4, eio(seg(t, T.pop, T.landC))) });
  ev(T.pop, 'pop'); ev(T.landC, 'cue', { n: 'band' });
  cam(.3, T.landC - .3, [1000, 500, 1.08], 'ss');                // wide enough to see the ball fall from the clock
  cam(T.landC + .05, 1.0, [1150, 470, 1.5], 'eio');
  T.toNav0 = VO.v02 - .7; T.toNav1 = T.toNav0 + .5;
  C.stand(T.landC, T.toNav0, cmpTop, { eyes: t => t < T.landC + .6 ? 'wide' : t < T.toNav0 - .7 ? 'n' : 'l' })
    .jump(T.toNav0, T.toNav1, cmpTop, fixed(NAV('lab')), 90);
  cam(T.toNav0 - .1, .85, [700, 400, 1.45], 'eio');
  T.labClick = W('v02', '学习') - .55;
  CUR.show(T.toNav1 - .1, T.labClick + .5).move(T.toNav1 - .1, T.toNav1 - .1, pt(980, 760)).move(T.toNav1 - .05, T.labClick - .04, NAVC('lab'), 30).click(T.labClick);
  T.toCont0 = T.labClick + .22; T.toCont1 = T.toCont0 + .5;
  C.stand(T.toNav1, T.toCont0, fixed(NAV('lab')), { eyes: t => t < T.labClick - .3 ? 'dr' : 'r' })
    .jump(T.toCont0, T.toCont1, fixed(NAV('lab')), at('cont', .62, 0), 70);
  cam(T.labClick + .05, 1.0, [1110, 400, 1.38], 'eio');
  T.toRk = W('v02', '该补') - .05;
  C.stand(T.toCont1, T.toRk - .45, at('cont', .62, 0), { eyes: t => t < T.toCont1 + .5 ? 'd' : 'r' })
    .jump(T.toRk - .45, T.toRk, at('cont', .62, 0), at('rk', .5, 0), 50);
  T.recs = [W('v02', '推荐') - .3, W('v02', '推荐') + .25, W('v02', '眼前') + .05];
  T.recs.forEach((tl, i) => ev(tl, 'glock', { n: i }));
  C.stand(T.toRk, bar(6) + 2 * B + .3, at('rk', .5, 0), { eyes: t => t < T.recs[0] - .2 ? 'r' : t < T.recs[2] + .6 ? 'd' : 'happy' });
  cam(T.recs[0] - .4, 1.4, [1250, 380, 1.62], 'eio');

  // ═════ 09:00 实验课 (13.75 – 37.5)
  T.w1 = bar(6) + 2 * B; wipe(T.w1, '09:00', '实验课');
  cam(T.w1 + .36, .05, [958, 532, 1.9], 'eio'); ev(T.w1, 'cue', { n: 'labs' });
  const sTop = 300;
  const ride = s => A => { const r = ridePt(s); return cvp(A, r.x, r.y); };
  T.cDrop0 = T.w1 + .62; T.cDrop1 = T.cDrop0 + .45;
  C.hide(bar(6) + 2 * B + .3, T.cDrop0);
  drop(T.cDrop0, T.cDrop1, ride(sTop), 260, { px: 3.6 });
  T.ride0 = W('v03', '电流') - .5; T.ride1 = T.ride0 + LAP / FLOW;   // one lap at the current's own speed
  const sAt = t => sTop + FLOW * (t - T.ride0);
  C.stand(T.cDrop1, T.ride0, ride(sTop), { px: 3.6, eyes: t => t < T.cDrop1 + .5 ? 'wide' : 'r' })
    .path(T.ride0, T.ride1, (t, A) => ride(sAt(t))(A), { px: 3.6, eyes: t => ridePt(sAt(t)).e });
  ev(T.ride0, 'ride', { d: T.ride1 - T.ride0 });
  const R1TOP = cv(390, LOOP.y0 - 13), R2TOP = cv(LOOP.x0, 185);
  T.onR1 = W('v03', '电压') + .06; T.r2 = W('v03', '电阻');
  C.jump(T.ride1, T.onR1, ride(sTop), R1TOP, 30, { px: 3.6 })
    .stand(T.onR1, T.r2 - .4, R1TOP, { px: 3.6, eyes: 'd' })
    .jump(T.r2 - .4, T.r2, R1TOP, R2TOP, 50, { px: 3.6 });
  ev(T.onR1, 'glock', { n: 2 }); ev(T.r2, 'glock', { n: 4 });
  // → 两端固定的弦驻波 through 最近空间
  T.sw1 = VO.v03 + durs.v03 + .05; T.sw1L = T.sw1 + .5; T.sw1c = T.sw1L + .2; T.ph0 = Math.round(T.sw1c / B) * B;
  C.stand(T.r2, T.sw1, R2TOP, { px: 3.6, eyes: t => t < T.r2 + .8 ? 'd' : 'l' })
    .jump(T.sw1, T.sw1L, R2TOP, fixed(RS(2)), 110, { big: true, px: t => lerp(3.6, 4, seg(t, T.sw1, T.sw1L)) });
  cam(T.sw1 - .15, .65, [700, 560, 1.55], 'eio');
  CUR.show(T.sw1 + .05, T.sw1c + .45).move(T.sw1 + .05, T.sw1 + .05, pt(1020, 900)).move(T.sw1 + .1, T.sw1c - .04, RSC(2), 30).click(T.sw1c);
  T.wLand = T.sw1c + .62;
  C.stand(T.sw1L, T.sw1c + .08, fixed(RS(2)), { eyes: 'r' }).jump(T.sw1c + .08, T.wLand, fixed(RS(2)), onString(.25), 90, { big: true });
  cam(T.sw1c + .05, .8, [962, 505, 1.9], 'eio');
  T.node = W('v04', '波节'); T.anti = W('v04', '波腹');
  const bob = s => t => Math.sin(ph(t)) * s > 0 ? 'd' : 'u';
  C.path(T.wLand, T.node - .36, (t, A) => onString(.25)(A, t), { eyes: bob(1) })
    .jump(T.node - .36, T.node, onString(.25), onString(.5), 36)
    .stand(T.node, T.anti - .34, onString(.5), { still: true, eyes: t => Math.sin(ph(t) * .5) > 0 ? 'l' : 'r' })
    .jump(T.anti - .34, T.anti, onString(.5), onString(.75), 36);
  ev(T.wLand, 'cue', { n: 'string' });
  // → 导体棒切割磁感线
  T.sw2 = VO.v04 + durs.v04 + .05; T.sw2L = T.sw2 + .5; T.sw2c = T.sw2L + .2;
  for (let tp = T.ph0; tp < T.sw2 + .3; tp += B) if (tp > T.wLand - .2) ev(tp, 'pluck', { up: Math.round((tp - T.ph0) / B) % 2 ? 0 : 1 });
  C.path(T.anti, T.sw2, (t, A) => onString(.75)(A, t), { eyes: bob(-1) })
    .jump(T.sw2, T.sw2L, onString(.75), fixed(RS(3)), 130, { big: true });
  cam(T.sw2 - .15, .65, [700, 590, 1.55], 'eio');
  T.play = W('v05', '切过') + .05; T.iLand = T.sw2c + .55;
  T.rowE = W('v05', '感应'); T.rowI = W('v05', '电流'); T.live = W('v05', '引擎');
  CUR.show(T.sw2 + .05, T.rowI + 1.1).move(T.sw2 + .05, T.sw2 + .05, pt(1020, 900)).move(T.sw2 + .1, T.sw2c - .04, RSC(3), 30).click(T.sw2c)
    .move(T.sw2c + .12, T.play - .04, at('play', .5, .55), 40).click(T.play)
    .move(T.rowE - .55, T.rowE - .02, at('row-E', .45, .55), 30).move(T.rowI - .35, T.rowI - .02, at('row-I', .45, .55), 8);
  ev(T.rowE, 'hover'); ev(T.rowI, 'hover'); ev(T.play + .02, 'slide', { d: 5 });
  C.stand(T.sw2L, T.sw2c + .06, fixed(RS(3)), { eyes: 'r' }).jump(T.sw2c + .06, T.iLand, fixed(RS(3)), onBar, 80, { big: true });
  C.path(T.iLand, bar(16) + .3, (t, A) => onBar(A, t), { eyes: t => t < T.play ? 'd' : t < T.play + 5 ? 'r' : 'happy' });
  cam(T.sw2c + .05, .8, [985, 690, 1.66], 'eio');
  cam(T.rowE - .75, .9, [1250, 640, 1.5], 'eio');
  cam(T.live - .25, 1.2, [1010, 560, 1.7], 'eio');

  // ═════ 16:00 自习 (37.5 – 58.75): a suggested question, the answer, then its trace
  T.w2 = bar(16); wipe(T.w2, '16:00', '自习'); ev(T.w2, 'cue', { n: 'study' });
  cam(T.w2 + .36, .05, [1090, 560, 1.75], 'eio');
  T.chD0 = T.w2 + .62; T.chD1 = T.chD0 + .45;
  const chip = at('chip-2', .62, 0);
  C.hide(bar(16) + .3, T.chD0); drop(T.chD0, T.chD1, chip, 240);
  T.chip = W('v06', '想不通') + .12; T.send = W('v06', '就问') + .1; T.chat = T.send + .1;
  CUR.show(T.chip - .9, T.send + .4).move(T.chip - .9, T.chip - .9, pt(1500, 820)).move(T.chip - .85, T.chip - .04, at('chip-2', .36, .55), 30).click(T.chip)
    .move(T.send - .55, T.send - .04, at('send', .5, .55), 30).click(T.send);
  ev(T.chip + .03, 'fill'); ev(T.send + .03, 'send');
  const sendTop = at('send', .5, 0);
  C.stand(T.chD1, T.chip + .15, chip, { eyes: t => t < T.chip - .5 ? 'n' : 'dl' })
    .jump(T.chip + .15, T.chip + .55, chip, sendTop, 50)
    .stand(T.chip + .55, T.send + .02, sendTop, { eyes: 'dl' })
    .jump(T.send + .02, T.chat + .55, fixed(SENDP), at('bubble', .8, 0), 110, { big: true });
  T.s0 = T.chat + .45; T.s1 = T.s0 + 3.5; T.rampX = Math.round(140 / (T.s1 - T.s0));   // the real answer took 2 min 20 s
  for (let i = 0; i < BLOCKS.length; i++) ev(T.s0 + (T.s1 - T.s0) * i / BLOCKS.length + .05, 'stream', { i });
  cam(T.send + .05, .7, [1100, 470, 1.3], 'eio');
  T.trClick = W('v07', '轨迹') + .1;
  CUR.show(T.trClick - .9, T.trClick + .45).move(T.trClick - .9, T.trClick - .9, pt(1000, 640)).move(T.trClick - .85, T.trClick - .04, at('tab-trace', .45, .6), 30).click(T.trClick);
  cam(T.s1 + .05, .8, [700, 360, 1.5], 'eio');
  T.toTab0 = T.s1 + .1; T.toTab1 = T.toTab0 + .6;
  C.stand(T.chat + .55, T.toTab0, at('bubble', .8, 0), { eyes: t => t < T.s1 - .3 ? 'dl' : 'l' })
    .jump(T.toTab0, T.toTab1, at('bubble', .8, 0), at('tab-chat', .5, 0), 90, { big: true })
    .stand(T.toTab1, T.trClick + .1, at('tab-chat', .5, 0), { eyes: t => t < T.trClick - .5 ? 'd' : 'r' })
    .jump(T.trClick + .1, T.trClick + .55, at('tab-chat', .5, 0), at('trtab', .5, 0), 26);
  T.tr0 = T.trClick + .15; T.tr1 = T.tr0 + 2.6;
  TRACE.forEach((r, i) => ev(T.tr0 + (T.tr1 - T.tr0) * i / TRACE.length, 'row', { tool: r[0] === '工具' ? 1 : 0 }));
  cam(T.trClick + .1, 1.0, [820, 420, 1.55], 'eio');
  T.hopsT = [[4, W('v08', '实验') - .05], [6, W('v08', '跑模拟') - .05], [8, W('v08', '取数据') - .05], [9, W('v08', '取数据') + .38], [10, W('v08', '取数据') + .76]];
  let fromT = at('trtab', .5, 0), tt = T.trClick + .55;
  T.hopsT.forEach(([i, tl], j) => { const to = at(`tn-${i}`, .5, 0); C.stand(tt, tl - .34, fromT, { eyes: j ? 'd' : 'dr' }).jump(tl - .34, tl, fromT, to, j > 2 ? 18 : 30); ev(tl, 'hover'); fromT = to; tt = tl; });
  T.onPass = W('v08', '67') + .05; T.toPass = T.onPass - .5;
  C.stand(tt, T.toPass, fromT, { eyes: 'u' }).jump(T.toPass, T.onPass, fromT, at('pass', .5, 0), 60, { big: true });
  cam(T.toPass - .1, .75, [PASS.x, PASS.y + 40, 2.2], 'eio');
  T.ding = W('v08', '全部通过'); ev(T.ding, 'ding'); ev(T.ding - B / 2, 'cue', { n: 'hush' });
  T.spot = T.ding - .3; T.spotEnd = VO.v08 + durs.v08 + .45;
  C.stand(T.onPass, bar(24) + 2 * B + .3, at('pass', .5, 0), { eyes: t => t < T.ding ? 'd' : 'happy' });

  // ═════ 19:00 备课 (58.75 – 87.5): the exam workbench, then the library
  T.w3 = bar(24) + 2 * B; wipe(T.w3, '19:00', '备课'); ev(T.w3, 'cue', { n: 'prep' });
  cam(T.w3 + .36, .05, [960, 540, 1.0], 'eio');
  T.eD0 = T.w3 + .62; T.eD1 = T.eD0 + .5;
  C.hide(T.w3 + .3, T.eD0); drop(T.eD0, T.eD1, fixed(NAV('exam')), 200);
  cam(T.eD1 + .6, 1.4, [640, 380, 1.5], 'eio');
  T.exClick = W('v09', '出卷') + .05;
  CUR.show(T.exClick - 1.0, T.exClick + .4).move(T.exClick - 1.0, T.exClick - 1.0, pt(900, 700)).move(T.exClick - .95, T.exClick - .04, NAVC('exam'), 30).click(T.exClick);
  C.stand(T.eD1, T.exClick + .06, fixed(NAV('exam')), { eyes: t => t < T.exClick - .9 ? 'n' : 'dl' })
    .jump(T.exClick + .06, T.exClick + .56, fixed(NAV('exam')), at('ex-new', .5, 0), 60);
  cam(T.exClick + .05, .85, [1086, 400, 1.35], 'eio');
  T.f1 = W('v10', '结构'); T.f2 = W('v10', '章节'); T.f3 = W('v10', 'AI'); T.f4 = W('v10', '物理验证'); T.f5 = W('v10', '考试规范');
  CUR.show(T.f1 - .8, T.f2 + 1.0).move(T.f1 - .8, T.f1 - .8, pt(1300, 760)).move(T.f1 - .75, T.f1 - .02, at('ex-tpl', .3, .55), 30).move(T.f2 - .45, T.f2 - .02, at('ex-ta', .3, .45), 20);
  ev(T.f1, 'hover'); ev(T.f2, 'hover');
  let fromE = at('ex-new', .5, 0), te = T.exClick + .56;
  [['ex-note', T.f3, .12], ['ex-verify', T.f4, .3], ['ex-compl', T.f5, .3]].forEach(([k, tl, fx], j) => {
    const to = at(k, fx, 0); C.stand(te, tl - .4, fromE, { eyes: j ? 'd' : 'r' }).jump(tl - .4, tl, fromE, to, j ? 30 : 80); ev(tl, 'glock', { n: j + 2 }); fromE = to; te = tl;
  });
  T.dClick = VO.v11 - .3; T.rev = W('v11', '审核'); T.fClick = W('v11', '稿') + .05;
  C.stand(te, T.dClick - .55, fromE, { eyes: 'u' }).jump(T.dClick - .55, T.dClick - .1, fromE, at('ex-drafts', .86, 0), 70)
    .stand(T.dClick - .1, T.rev - .4, at('ex-drafts', .86, 0), { eyes: 'd' }).jump(T.rev - .4, T.rev, at('ex-drafts', .86, 0), at('draft-2', .74, 0), 40)
    .stand(T.rev, T.fClick - .5, at('draft-2', .74, 0), { eyes: 'd' }).jump(T.fClick - .5, T.fClick - .1, at('draft-2', .74, 0), at('ex-final', .86, 0), 60)
    .stand(T.fClick - .1, T.fClick + .2, at('ex-final', .86, 0), { eyes: 'd' }).jump(T.fClick + .2, T.fClick + .6, at('ex-final', .86, 0), at('fcard', .8, 0), 30);
  CUR.show(T.dClick - .8, T.fClick + 2.4).move(T.dClick - .8, T.dClick - .8, pt(1200, 700)).move(T.dClick - .75, T.dClick - .04, at('ex-drafts', .4, .5), 30).click(T.dClick)
    .move(T.fClick - .6, T.fClick - .04, at('ex-final', .4, .5), 20).click(T.fClick);
  ev(T.dClick + .02, 'tab'); ev(T.fClick + .02, 'tab'); ev(T.rev, 'glock', { n: 4 });
  cam(T.dClick - .1, .8, [760, 420, 1.55], 'eio');
  T.fl1 = W('v11', '试卷'); T.fl2 = W('v11', '答案解析'); T.fPdf = W('v11', 'PDF'); T.fDoc = W('v11', 'Word');
  CUR.move(T.fl1 - .45, T.fl1 - .02, at('f-pdf', .45, .55), 20).move(T.fl2 - .35, T.fl2 - .02, at('f-apdf', .45, .55), 12);
  ev(T.fl1, 'hover'); ev(T.fl2, 'hover');
  C.stand(T.fClick + .6, T.fPdf - .36, at('fcard', .8, 0), { eyes: 'dl' })
    .jump(T.fPdf - .36, T.fPdf, at('fcard', .8, 0), at('f-pdf', .5, 0), 40)
    .stand(T.fPdf, T.fDoc - .36, at('f-pdf', .5, 0), { eyes: 'r' })
    .jump(T.fDoc - .36, T.fDoc, at('f-pdf', .5, 0), at('f-docx', .5, 0), 40);
  ev(T.fPdf, 'pop', { n: 0 }); ev(T.fDoc, 'pop', { n: 1 });
  cam(T.fClick + .1, .8, [640, 330, 2.2], 'eio');
  // 资源库
  T.libClick = VO.v12 - .45;
  C.stand(T.fDoc, T.libClick - .75, at('f-docx', .5, 0), { eyes: 'l' }).jump(T.libClick - .75, T.libClick - .3, at('f-docx', .5, 0), fixed(NAV('lib')), 70);
  CUR.show(T.libClick - .95, T.libClick + .45).move(T.libClick - .95, T.libClick - .95, pt(820, 640)).move(T.libClick - .9, T.libClick - .04, NAVC('lib'), 30).click(T.libClick);
  cam(T.libClick - 1.0, .8, [640, 400, 1.6], 'eio');
  cam(T.libClick + .05, .9, [1000, 420, 1.4], 'eio');
  T.lb1 = W('v12', '教材'); T.lb2 = W('v12', '题目'); T.lb3 = W('v12', '同步'); T.lb4 = W('v12', '整理');
  C.stand(T.libClick - .3, T.lb1 - .5, fixed(NAV('lib')), { eyes: 'r' }).jump(T.lb1 - .5, T.lb1, fixed(NAV('lib')), at('lb-ch', .7, 0), 50)
    .stand(T.lb1, T.lb2 - .5, at('lb-ch', .7, 0), { eyes: 'r' }).jump(T.lb2 - .5, T.lb2, at('lb-ch', .7, 0), at('lbs-0', .5, 0), 90, { big: true })
    .stand(T.lb2, T.lb3 - .5, at('lbs-0', .5, 0), { eyes: 'dl' }).jump(T.lb3 - .5, T.lb3, at('lbs-0', .5, 0), at('lb-courses', .5, 0), 50)
    .stand(T.lb3, bar(36) + .3, at('lb-courses', .5, 0), { eyes: t => t < T.lb4 ? 'd' : 'happy' });
  ev(T.lb1, 'glock', { n: 0 }); ev(T.lb2, 'glock', { n: 2 }); ev(T.lb3, 'glock', { n: 4 });
  cam(T.lb3 - .2, 1.6, [1000, 540, 1.4], 'eio');
  cam(T.lb4 + .3, 1.6, [960, 540, 1.12], 'eio');

  // ═════ 21:30 开源 (87.5 – 96.25): anyone can ship a new version of any experiment
  T.w4 = bar(36); wipe(T.w4, '21:30', '开源'); ev(T.w4, 'cue', { n: 'open' });
  cam(T.w4 + .36, .05, [1000, 400, 1.35], 'eio');
  T.uD0 = T.w4 + .62; T.uD1 = T.uD0 + .46;
  C.hide(bar(36) + .3, T.uD0); drop(T.uD0, T.uD1, at('up-all', .12, 0), 220);
  T.u76 = W('v13', '76'); T.uZip = W('v13', '提交'); T.uRev = W('v13', '审核'); T.uOn = W('v13', '上线');
  C.stand(T.uD1, T.u76 - .3, at('up-all', .12, 0), { eyes: 'r' }).jump(T.u76 - .3, T.u76, at('up-all', .12, 0), at('up-76', .5, 0), 24)
    .stand(T.u76, T.uZip - .2, at('up-76', .5, 0), { eyes: t => t < T.u76 + .6 ? 'd' : 'dr' }).jump(T.uZip - .2, T.uZip + .3, at('up-76', .5, 0), at('up-zip', .62, 0), 60)
    .stand(T.uZip + .3, T.uRev - .2, at('up-zip', .62, 0), { eyes: 'dl' }).jump(T.uRev - .2, T.uRev + .35, at('up-zip', .62, 0), at('up-p', .46, 0), 70, { big: true });
  ev(T.u76, 'glock', { n: 1 }); ev(T.uOn, 'glock', { n: 4 });
  CUR.show(T.uZip - .7, T.uRev + .2).move(T.uZip - .7, T.uZip - .7, pt(1500, 900)).move(T.uZip - .65, T.uZip - .02, at('up-zip', .3, .55), 30);
  ev(T.uZip, 'hover');
  cam(T.uZip - .4, .9, [1000, 640, 1.35], 'eio');
  cam(T.uRev - .3, .9, [1000, 400, 1.35], 'eio');
  T.toBrand0 = VO.v13 + durs.v13 - .9; T.toBrand1 = T.toBrand0 + .75;
  C.stand(T.uRev + .35, T.toBrand0, at('up-p', .46, 0), { eyes: t => t < T.uOn ? 'd' : 'happy' })
    .jump(T.toBrand0, T.toBrand1, at('up-p', .46, 0), at('newc', .78, 0), 80, { big: true, px: t => lerp(4, 3, seg(t, T.toBrand0, T.toBrand1)) });
  cam(T.toBrand0 - .2, 1.5, [960, 540, 1.0], 'eio');

  // ═════ 22:30 晚安 (96.25 – end): night falls; the ball falls asleep on 新会话, under the name
  T.night = bar(39) + 2 * B; ev(T.night, 'tick'); ev(T.night, 'cue', { n: 'night' });
  CH.push([T.night + .4, '22:30', '晚安']);
  T.sleep = W('v14', '明天见'); ev(T.sleep, 'cue', { n: 'final' }); ev(T.sleep + .3, 'snore');
  C.stand(T.toBrand1, DUR + 1, at('newc', .78, 0), { px: 3, still: true,
    eyes: t => t < T.toBrand1 + .5 ? 'happy' : t < VO.v14 ? 'u' : t < T.sleep - .5 ? 'd' : t < T.sleep ? 'blink' : 'shut',
    sqv: (t, s) => t < T.sleep ? s : s + .05 * Math.sin(2 * Math.PI * .4 * (t - T.sleep)) });
  cam(T.night + .9, T.sleep - T.night - .4, [369, 208, 2.6], 'ss');
  T.fade = DUR - .9;
  MOVES.sort((a, b) => a.t0 - b.t0);
  EV.sort((a, b) => a.t - b.t);
  return { C, CUR };
}

// the pass chip's place, measured once the page is live (the camera needs a number)
export function setPass(p) { PASS = p; }

// ───────── per-frame state
export function frame(t) {
  const F = { t, hud: {}, fx: [], ball: BALLA, cursor: CUR };
  F.cam = camAt(t);
  F.clock = t < T.tick ? '周一 07:29' : t < T.w1 + .42 ? '周一 07:30' : t < T.w2 + .42 ? '周一 09:00' : t < T.w3 + .42 ? '周一 16:00' : t < T.w4 + .42 ? '周一 19:00' : t < T.night ? '周一 21:30' : '周一 22:30';
  F.wall = { day: 1, dusk: t >= T.w3 + .42 ? 1 : 0, night: t >= T.night ? .45 + .55 * ss(seg(t, T.night, T.night + 1.6)) : t >= T.w4 + .42 ? .45 : 0 };
  if (t >= T.night) F.dim = .3 * ss(seg(t, T.night + .2, T.night + 1.8));
  const hist = t >= T.w4 + .42 ? [Q, '5 小时前'] : t >= T.w3 + .42 ? [Q, '3 小时前'] : t >= T.chat ? [Q, '刚刚'] : null;
  if (t < T.labClick) {
    F.page = 'home';
    F.home = { focus: true, caret: Math.floor(t * 2.2) % 2 === 0, balls: heroBalls(t) };
    F.side = { active: 'home', hover: t >= T.toNav1 - .05 ? 'lab' : null };
  } else if (t < T.w1 + .42) {
    F.page = 'ec';
    let rh = null; T.recs.forEach((tl, i) => { if (t >= tl - .04) rh = i; }); if (t > T.recs[2] + 1.2) rh = null;
    F.ec = { contHover: t >= T.toCont1 - .03 && t < T.toRk - .3, recHover: rh };
    F.side = { active: 'lab' };
  } else if (t < T.sw1c) {
    F.page = 'lab';
    F.lab = { cfg: LABS.circuit, flow: FLOW * t, hi: { r1: t >= T.onR1, r2: t >= T.r2 } };
    F.side = { active: 'lab', recent: R_CIRCUIT, recentOnName: '串联电路', recentHover: t >= T.sw1L - .1 ? '两端固定的弦驻波' : null };
  } else if (t < T.sw2c) {
    F.page = 'lab';
    F.lab = { cfg: LABS.wave, phase: ph(t), nodeOp: .3 + .7 * seg(t, T.node - .1, T.node + .25), antiOp: .3 + .7 * seg(t, T.anti - .1, T.anti + .25) };
    F.side = { active: 'lab', recent: R_WAVE, recentOnName: '两端固定的弦驻波', recentHover: t >= T.sw2L - .1 ? '导体棒切割磁感线' : null };
  } else if (t < T.w2 + .42) {
    F.page = 'lab';
    const sim = clamp(t - T.play, 0, 5), run = t >= T.play && t < T.play + 5;
    F.lab = { cfg: LABS.induction, barX: barX(t), arrowOp: t < T.play ? 0 : Math.min(seg(t, T.play, T.play + .3), 1 - seg(t, T.play + 5, T.play + 5.3)),
      tm: sim, tk: sim / 5, playing: run, playHover: t >= T.play - .3 && t < T.play + .3, playDown: t >= T.play && t < T.play + .12,
      hoverRow: t >= T.rowI - .02 && t < T.rowI + 1.1 ? 'I' : t >= T.rowE - .02 && t < T.rowI ? 'E' : null };
    F.side = { active: 'lab', recent: R_IND, recentOnName: '导体棒切割磁感线' };
  } else if (t < T.chat) {
    F.page = 'home';
    F.home = { typed: t >= T.chip ? Q : '', focus: t >= T.chip, caret: t >= T.chip && Math.floor(t * 2.2) % 2 === 0, balls: heroBalls(t), chipHover: t >= T.chip - .3 && t < T.chip + .2 ? 2 : null };
    F.side = { active: 'home', recent: R_PM(7) };
  } else if (t < T.trClick) {
    F.page = 'chat';
    const k = seg(t, T.chat, T.chat + .62), e = back(k, 1.15);
    F.chat = { reveal: BLOCKS.length * seg(t, T.s0, T.s1), scroll: 232 * ss(seg(t, T.s0 + 1.0, T.s1)), trHover: t >= T.trClick - .3,
      bub: k < 1 ? { tf: `translate(${((1 - e) * -426).toFixed(1)}px,${((1 - e) * 342).toFixed(1)}px)`, op: Math.min(1, k * 5) } : null };
    F.side = { recent: R_PM(7), newHist: hist };
  } else if (t < T.w3 + .42) {
    F.page = 'trace';
    let hv = null; for (const [i, tl] of T.hopsT) if (t >= tl - .05) hv = i; if (t >= T.toPass) hv = 6;
    F.trace = { n: TRACE.length * seg(t, T.tr0, T.tr1), hover: hv };
    F.side = { recent: R_PM(7), newHist: hist };
  } else if (t < T.exClick) {
    F.page = 'home';
    F.home = { balls: heroBalls(t) };
    F.side = { active: 'home', recent: R_PM(10), newHist: hist, histOn: false, hover: t >= T.eD1 - .05 ? 'exam' : null };
  } else if (t < T.libClick) {
    F.page = 'exam';
    const tab = t < T.dClick ? 'new' : t < T.fClick ? 'drafts' : 'final';
    F.exam = { tab, f: t >= T.f2 - .02 && t < T.f2 + 1.0 ? 'ta' : t >= T.f1 - .02 && t < T.f2 ? 'tpl' : null,
      chk: t >= T.f5 - .02 ? 'compl' : t >= T.f4 - .02 ? 'verify' : null, hover: t >= T.rev - .05 ? 2 : null,
      file: t >= T.fl2 - .02 && t < T.fl2 + 1.4 ? 'f-apdf' : t >= T.fl1 - .02 && t < T.fl2 ? 'f-pdf' : null };
    F.side = { active: 'exam', recent: R_PM(10), newHist: hist, histOn: false, hover: t >= T.libClick - .3 ? 'lib' : null };
  } else if (t < T.w4 + .42) {
    F.page = 'lib';
    F.lib = { stat: t >= T.lb2 - .05 && t < T.lb3 + .3 ? 0 : null };
    F.side = { active: 'lib', recent: R_PM(10), newHist: hist, histOn: false };
  } else {
    F.page = 'upload';
    F.upload = { zip: t >= T.uZip - .05 && t < T.uRev + .2 };
    F.side = { active: 'up', recent: R_PM(12), newHist: hist, histOn: false };
  }
  if (t >= T.pop - .05 && t < T.pop + .5) F.fx.push(A => { const p = A('clock', .5, 1); if (!p) return ''; const k = seg(t, T.pop - .05, T.pop + .5); return BL.spark(p.x + 14 + k * 6, p.y - 2 - k * 8, 1.6, 1 - k); });
  if (t >= T.ding && t < T.ding + .8) F.fx.push(A => { const p = A('pass', .5, .5); if (!p) return ''; const k = seg(t, T.ding, T.ding + .8); return BL.spark(p.x - 70 - k * 14, p.y - 24 - k * 12, 2.4, 1 - k) + BL.spark(p.x + 74 + k * 14, p.y - 30 - k * 12, 2.4, 1 - k); });
  if (t >= T.sleep + .3) F.fx.push(A => zzz(t, A));
  hud(F, t);
  return F;
}

// sleeping: little pixel z's rise off the ball, one every 1.3 s
function zzz(t, A) {
  const p = A('newc', .78, 0); if (!p) return ''; let h = '';
  const Z = ['xxxx', '..x.', '.x..', 'xxxx'];
  for (let i = 0; i < 4; i++) {
    const t0 = T.sleep + .3 + i * 1.3; if (t < t0) continue;
    const k = (t - t0) / 3.2; if (k >= 1) continue;
    const px = 1.3 + k * 1.2, x0 = p.x + 14 + k * 26 + Math.sin(k * 5) * 4, y0 = p.y - 36 - k * 46, op = Math.min(1, k * 6) * (1 - k);
    Z.forEach((row, r) => [...row].forEach((c, cI) => { if (c === 'x') h += BL.dot(x0 + cI * px, y0 + r * px, px, op, '#E8EDF7'); }));
  }
  return h;
}
function heroBalls(t) {
  const base = [[300, 40, 1, .6], [416, 84, -.7, .9], [566, 188, .8, -.5], [638, 208, -.5, -.8]];
  return base.map(([x, y, vx, vy], i) => {
    const X = 120 + ((x - 120 + vx * 22 * t) % 620 + 620) % 620, Y = 30 + ((y - 30 + vy * 14 * t) % 200 + 200) % 200;
    return { x: X, y: Y, l: 26 + 10 * hash(i), a: Math.atan2(vy, vx) };
  });
}

function hud(F, t) {
  const H = F.hud;
  const s = SUBS.find(x => t >= x.t0 && t < x.t1);
  if (s) H.cap = { text: s.text, op: Math.min(seg(t, s.t0, s.t0 + .12), 1 - seg(t, s.t1 - .15, s.t1)), y: (1 - eo(seg(t, s.t0, s.t0 + .2))) * 10 };
  CH.forEach(([t0, no, nm], i) => { const t1 = i + 1 < CH.length ? CH[i + 1][0] - .7 : T.sleep - .2; if (t >= t0 && t < t1) H.chap = { no, nm, op: Math.min(seg(t, t0, t0 + .3), 1 - seg(t, t1 - .3, t1)) }; });
  for (const [t0, no, nm] of WIPES) if (t >= t0 && t < t0 + .85) H.wipe = { p: (t - t0) / .85, no, nm };
  if (H.wipe) H.chap = null;
  if (t > T.s0 - .1 && t < T.s1 + .25) H.ramp = { op: Math.min(seg(t, T.s0 - .1, T.s0 + .05), 1 - seg(t, T.s1, T.s1 + .25)), blink: Math.floor(t * 4) % 2, label: `${T.rampX}×` };
  if (t > T.spot - .35 && t < T.spotEnd + .3) H.spot = { key: 'pass', op: Math.min(seg(t, T.spot - .35, T.spot), 1 - seg(t, T.spotEnd, T.spotEnd + .3)) };
  if (t > T.fade) H.fade = seg(t, T.fade, DUR);
}
export { CH, WIPES };
