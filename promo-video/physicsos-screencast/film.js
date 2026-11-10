// 《小球飞起来了》timeline: voice and word anchors, camera, the ball, the cursor, UI state, HUD and sound events.
// One source for picture and sound: everything the mixer needs is pushed into EV.
import { clamp, lerp, seg, ss, eio, eo, back, hash } from '/core/lib.js';
import { W2, BENCH, CARD, CARDS, THUMB_BALL, TAB_X, TAB_W, physics, launchPt, ballAt, BLOCKS } from './ui.js';
import * as BL from './ball.js';

export const BPM = 104, B = 60 / BPM, BAR = 4 * B, Q16 = B / 4;
export const bar = n => (n - 1) * BAR;
export const DUR = 71.45;
export const VO = { v01: .35, v02: 4.6, v03: 9.7, v04: 15.95, v05: 21.4, v06: 30.9, v07: 37.15, v08: 42.55, v09: 46.45, v10: 53.1, v11: 58.5, v12: 63.25 };
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
const snap16 = t => Math.round(t / Q16) * Q16;

// ───────── sound / cue events
export const EV = [];
const ev = (t, type, o = {}) => EV.push({ t: +t.toFixed(3), type, ...o });

// ───────── screen-recorder camera: one take, moves may overlap, zoom ≥ 1 and never past the monitor
const EASE = { eio, ss, eo, lin: x => clamp(x), whip: x => { x = clamp(x); return x < .5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2; } };
const MOVES = []; let CAM0 = [1280, 812, 3.4];
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
const typing = (t0, n, cps, seed) => { const T = []; let t = t0; for (let i = 0; i < n; i++) { t += (1 / cps) * (.6 + hash(seed * 31 + i * 7.3) * .8); T.push(t); ev(t, 'key', { v: .5 + hash(seed + i) * .4 }); } return T; };

export const SUBS = [], T = {};
let BALLA, CUR;
const P5 = physics(5, 5), P20 = physics(20, 10);
const CH = [], WIPES = [];
const PROJ = 'projectile-horizontal';

export function build(lines, words, durs) {
  LINES = Object.fromEntries(lines.map(l => [l.id, l])); WORDS = words; DURS = durs;
  EV.length = 0; MOVES.length = 0; SUBS.length = 0; CH.length = 0; WIPES.length = 0;
  BALLA = new Ball(); CUR = new Cursor();
  const ids = Object.keys(VO);
  ids.forEach((id, i) => {
    ev(VO[id], 'vo', { id });
    const t0 = VO[id] - .05, nxt = i + 1 < ids.length ? VO[ids[i + 1]] - .1 : DUR - .2;
    SUBS.push({ id, t0, t1: Math.min(nxt, Math.max(t0 + 1.8, VO[id] + durs[id] + .58)), text: LINES[id].sub });
  });
  const C = BALLA;

  // ═════ 序 · the ball printed in a picture (0 – 9.2)
  const cx0 = CARD.x0 + 3 * CARD.dx;
  const ballC = W2(cx0 + THUMB_BALL.x, CARD.y + THUMB_BALL.y);
  const slab = W2(cx0 + THUMB_BALL.x, CARD.y + 13 + (205 - 96) * .375);
  T.ballC = ballC; T.slab = slab;
  CAM0 = [ballC.x + 30, ballC.y + 14, 4.6];
  T.pop = W('v01', '小球') + .04; T.born = T.pop + .55;
  ev(T.pop, 'hatch'); ev(T.born + .05, 'blink');
  cam(.2, T.pop - .3, [ballC.x + 14, ballC.y + 6, 5.2], 'ss');
  cam(T.pop - .1, .9, [ballC.x + 8, ballC.y - 4, 5.6], 'eio');
  T.look = W('v02', '从来'); T.sad = W('v02', '飞过');
  T.out0 = Math.max(VO.v02 + durs.v02 + .2, T.sad + .9); T.out1 = T.out0 + .42;
  C.hide(0, T.born)
    .stand(T.born, T.out0, pt(slab.x, slab.y), { px: 3, eyes: t => t < T.born + .6 ? 'wide' : t < T.look - .15 ? 'r' : t < T.sad ? 'n' : 'd' })
    .jump(T.out0, T.out1, pt(slab.x, slab.y), at(`card-${PROJ}`, .32, 0), 30, { px: t => lerp(3, 4, seg(t, T.out0, T.out1)) });
  cam(T.out0 - .15, .7, [ballC.x + 22, ballC.y - 30, 4.0], 'eio');

  // ═════ 01 实验中心 (9.2 – 16.7)
  T.pull = bar(5); cam(T.pull, 1.45, [960, 540, 1.0], 'eio'); ev(T.pull, 'cue', { n: 'band' }); ev(T.pull - .05, 'whoosh', { d: 1 });
  CH.push([T.pull + .7, '01', '实验中心']);
  const cardTop = i => at(`card-${CARDS[i][0]}`, .5, 0);
  T.hops = [];
  let th = T.pull + 1.35, from = at(`card-${PROJ}`, .32, 0);
  C.stand(T.out1, th, from, { eyes: t => t < T.pull ? 'happy' : 'l' });
  for (const i of [2, 1, 0]) { const to = cardTop(i); C.jump(th, th + .44, from, to, 46); T.hops.push([CARDS[i][0], th + .44]); C.stand(th + .44, th + .6, to, { eyes: 'l' }); from = to; th += .6; }
  const tab = i => at(`tab-${i}`, .5, 0);
  C.jump(th, th + .46, from, tab(1), 70); T.onTab = th + .46;
  T.run0 = snap16(Math.max(W('v03', '分成') - .04, T.onTab + .35));
  C.stand(T.onTab, T.run0, tab(1), { eyes: t => t < T.onTab + .5 ? 'u' : 'r' });
  cam(T.onTab - .5, 1.0, [985, 640, 1.42], 'eio');
  T.tabs = [];
  for (let i = 1; i < 12; i++) { const a = T.run0 + (i - 1) * Q16, b = a + Q16; C.jump(a, b, tab(i), tab(i + 1), 12, { silent: true, nodust: true }); T.tabs.push([i + 1, b]); ev(b, 'tab', { i: i + 1 }); }
  ev(T.run0 - .02, 'tab', { i: 1 }); T.tabs.unshift([1, T.run0]);
  T.runEnd = T.run0 + 11 * Q16;
  T.click1 = Math.max(W('v04', '点开') + .12, T.runEnd + .35);
  C.stand(T.runEnd, T.click1 + .02, tab(12), { eyes: t => t < T.runEnd + .45 ? 'happy' : 'dl' });
  cam(T.runEnd - .2, .9, [1290, 770, 1.75], 'eio');
  CUR.show(T.click1 - .9, T.click1 + .45).move(T.click1 - .9, T.click1 - .9, pt(1740, 1050)).move(T.click1 - .85, T.click1 - .04, at(`card-${PROJ}`, .55, .5), 40).click(T.click1);
  T.wipe2 = bar(8) + B;
  C.jump(T.click1 + .02, T.click1 + .4, tab(12), at(`card-${PROJ}`, .45, .32), 50, { nodust: true });
  C.hide(T.click1 + .4, T.wipe2 + .62);
  WIPES.push([T.wipe2, '02', '实验台']); ev(T.wipe2, 'wipe');

  // ═════ 02 实验台 (16.7 – 41.5)
  cam(T.wipe2 + .36, .05, [1010, 560, 1.22], 'eio');
  CH.push([T.wipe2 + .62, '02', '实验台']);
  const rest = h => W2(launchPt(h).x, BENCH.ground - h * BENCH.k);
  T.drop0 = T.wipe2 + .62; T.drop1 = T.drop0 + .5;
  const above = W2(launchPt(5).x, BENCH.y0 + 6);
  C.path(T.drop0, T.drop1, t => { const p = seg(t, T.drop0, T.drop1) ** 2, r = rest(5); return { x: r.x, y: lerp(above.y, r.y, p) }; }, { eyes: 'd', sqv: (t, s) => -.16 * seg(t, T.drop0, T.drop1) });
  C.jumps.push({ t0: T.drop0, t1: T.drop1, big: true }); ev(T.drop1, 'land', { v: 1 });
  C.stand(T.drop1, T.drop1 + .24, rest(5), { still: true, eyes: 'wide' });
  C.jump(T.drop1 + .24, T.drop1 + .5, rest(5), rest(5), 14, { silent: true, nodust: true }); ev(T.drop1 + .5, 'land', { v: .3 });
  T.fClick = Math.min(VO.v05 - .25, 21.15);
  CUR.show(T.fClick - .75, 26.2).move(T.fClick - .75, T.fClick - .75, pt(1700, 940)).move(T.fClick - .7, T.fClick - .04, at('f-h', .55, .5), 30).click(T.fClick);
  T.k1 = Math.max(W('v05', '高度') + .02, T.fClick + .3); T.k2 = T.k1 + .17; T.tab1 = T.k2 + .3;
  T.k3 = Math.max(W('v05', '初速度') + .1, T.tab1 + .25); T.k4 = T.k3 + .17; T.ent = T.k4 + .3;
  [T.k1, T.k2, T.k3, T.k4].forEach(x => ev(x, 'key', { v: .8 })); ev(T.tab1, 'enter'); ev(T.ent, 'enter');
  ev(T.tab1 + .01, 'commit', { n: 'h' }); ev(T.ent + .01, 'commit', { n: 'v0' });
  C.stand(T.drop1 + .5, T.tab1, rest(5), { eyes: t => t < T.fClick - .8 ? 'r' : t < T.tab1 - .4 ? 'ur' : 'u' })
    .jump(T.tab1, T.tab1 + .34, rest(5), rest(20), 10, { silent: true, nodust: true });
  ev(T.tab1 + .34, 'land', { v: .5 });
  T.toRun0 = T.ent + .25; T.toRun1 = T.toRun0 + .85;
  T.launch = bar(12) + B; T.land = T.launch + P20.t / .5; T.click2 = T.launch - .16;
  CUR.move(T.toRun0, T.toRun1, at('run', .5, .55), 40).click(T.click2);
  cam(T.fClick - .5, .85, [1150, 450, 1.55], 'eio');
  cam(T.toRun0 - .05, .95, [1205, 232, 2.35], 'eio');
  cam(T.click2 + .02, .34, [985, 520, 1.45], 'whip'); ev(T.click2 + .02, 'whoosh', { d: -1 });
  C.stand(T.tab1 + .34, T.launch, rest(20), { eyes: t => t < T.ent + .2 ? 'happy' : t < T.toRun1 ? 'ur' : t < T.click2 ? 'u' : 'r' });
  ev(T.launch - .13, 'crouch'); ev(T.launch, 'launch'); ev(T.launch, 'fly', { d: T.land - T.launch }); ev(T.land, 'touch');
  ev(T.toRun1 - .9, 'cue', { n: 'drop' }); ev(T.click2, 'cue', { n: 'click' }); ev(T.land, 'cue', { n: 'land' });
  C.jumps.push({ t0: T.launch, t1: T.land, big: true });
  C.path(T.launch, T.land, t => { const b = ballAt(20, 10, (t - T.launch) * .5), w = W2(b.x, b.y); return { x: w.x, y: w.y + 22 }; },
    { eyes: t => t < T.launch + .5 ? 'wide' : 'dr', sqv: (t, s) => { const tau = (t - T.launch) * .5, v = Math.hypot(10, 9.8 * tau); return s > 0 ? s : -.05 - .1 * (v - 10) / 12; } });
  cam(T.launch + .3, T.land - T.launch - .3, [1030, 535, 1.45], 'lin');
  const landPt = W2(launchPt(20).x + P20.R * BENCH.k, BENCH.ground);
  T.whipI = T.land + .42; T.toDer0 = T.land + .5; T.toDer1 = T.toDer0 + .62;
  C.stand(T.land, T.toDer0, pt(landPt.x, landPt.y), { eyes: t => t < T.land + .25 ? 'shut' : 'happy' })
    .jump(T.toDer0, T.toDer1, pt(landPt.x, landPt.y), at('derived', .84, 0), 170, { big: true });
  cam(T.whipI, .36, [1400, 595, 1.9], 'whip'); ev(T.whipI - .05, 'whoosh', { d: 1 });
  T.rows = [['flight', W('v06', '飞了多久') - .08], ['range', W('v06', '落在哪里') - .08], ['landing', W('v06', '落地多快') - .08]];
  CUR.show(T.land + .55, T.rows[2][1] + 2.2).move(T.land + .5, T.land + .52, pt(1770, 960));
  T.rows.forEach(([k, tr], i) => { CUR.move(tr - .42, tr, at(`row-${k}`, .62, .55), 18); ev(tr, 'hover', { i }); });
  T.spot = bar(17); T.toB0 = T.spot - .64;
  C.stand(T.toDer1, T.toB0, at('derived', .84, 0), { eyes: t => t < T.rows[0][1] ? 'd' : 'dl' })
    .jump(T.toB0, T.spot, at('derived', .84, 0), at('badge', .5, 0), 120, { big: true });
  cam(T.toB0 + .02, .62, [1146, 183, 3.0], 'eio'); ev(T.spot, 'ding'); ev(T.spot - .7, 'cue', { n: 'spot' });
  T.spotEnd = VO.v07 + durs.v07 + .25;
  C.stand(T.spot, bar(19) + .62, at('badge', .5, 0), { eyes: t => t < T.spot + .45 ? 'wide' : t < W('v07', '徽章') ? 'd' : 'happy' });
  T.wipe3 = bar(19);
  WIPES.push([T.wipe3, '03', 'AI 助教']); ev(T.wipe3, 'wipe');

  // ═════ 03 AI 助教 (41.5 – 52.9)
  cam(T.wipe3 + .36, .05, [1083, 520, 1.6], 'eio');
  CH.push([T.wipe3 + .62, '03', 'AI 助教']);
  T.drop2 = T.wipe3 + .62; T.drop3 = T.drop2 + .46;
  C.path(T.drop2, T.drop3, (t, A) => { const r = at('composer', .62, 0)(A); if (!r) return null; return { x: r.x, y: lerp(r.y - 260, r.y, seg(t, T.drop2, T.drop3) ** 2) }; }, { eyes: 'd' });
  C.jumps.push({ t0: T.drop2, t1: T.drop3 }); ev(T.drop3, 'land', { v: .7 });
  T.cClick = T.drop3 + .3;
  CUR.show(T.cClick - .7, T.cClick + .9).move(T.cClick - .7, T.cClick - .7, pt(1650, 1000)).move(T.cClick - .65, T.cClick - .04, at('composer', .32, .3), 30).click(T.cClick);
  T.ime = []; let tc = T.cClick + .3;
  for (const [i, n] of [[0, 6], [1, 9], [2, 6], [3, 1]].map(([i, n]) => [i, n])) { const ks = typing(tc, n, 16, 11 + i); tc = ks[ks.length - 1] + .06; ev(tc, 'key', { v: .9 }); T.ime.push(tc); tc += .12; }
  T.send = Math.max(VO.v08 + durs.v08 + .12, tc + .25); ev(T.send, 'enter'); ev(T.send + .03, 'send');
  C.stand(T.drop3, T.send + .12, at('composer', .62, 0), { eyes: t => t < T.cClick ? 'n' : t < T.send - .2 ? 'dl' : 'u' });
  T.chat = T.send + .12;
  cam(T.chat, .7, [1185, 420, 1.45], 'eio');
  T.s0 = T.chat + .85; T.s1 = Math.max(T.s0 + 4.6, W('v09', '完整跑一遍') + .3);
  const blockAt = i => T.s0 + (T.s1 - T.s0) * i / BLOCKS.length;
  for (let i = 0; i < BLOCKS.length; i++) ev(blockAt(i) + .05, 'stream', { i });
  const hopsB = []; let tb = T.chat + .78;
  for (const i of [0, 2, 8, 9]) { const ta = Math.max(tb + .05, blockAt(i) + .12); hopsB.push([i, ta]); tb = ta + .34; }
  C.stand(T.chat, hopsB[0][1], at('bubble', .82, 0), { still: true, eyes: 'u' });
  let fromB = at('bubble', .82, 0);
  hopsB.forEach(([i, ta], j) => {
    const to = at(`blk-${i}`, .9, 0); C.jump(ta, ta + .34, fromB, to, j === 0 ? 70 : 34);
    if (j + 1 < hopsB.length) C.stand(ta + .34, hopsB[j + 1][1], to, { eyes: 'd' });
    fromB = to; if (i === 9) T.onVerify = ta + .34;
  });
  T.sel0 = W('v09', '完整跑一遍') + .05; T.sel1 = T.sel0 + .62;
  T.whipS = Math.max(T.sel1 + 1.0, VO.v10 - .2);
  C.stand(T.onVerify, T.whipS - .1, at('blk-9', .9, 0), { eyes: t => t < T.sel0 ? 'd' : 'dl' });
  cam(T.s0 + .4, 3.0, [1150, 470, 1.5], 'ss');
  cam(T.sel0 - .7, .8, [1010, 470, 2.05], 'eio');
  CUR.show(T.sel0 - .75, T.sel1 + .7).move(T.sel0 - .75, T.sel0 - .75, pt(1300, 900)).move(T.sel0 - .7, T.sel0 - .02, at('vsel', 0, .55), 25).move(T.sel0, T.sel1, at('vsel', 1, .55), 0);
  ev(T.sel0, 'select'); ev(T.sel1, 'tick');

  // ═════ 04 也在这里 (52.9 – 57.7)
  cam(T.whipS, .38, [505, 420, 1.9], 'whip'); ev(T.whipS - .05, 'whoosh', { d: -1 }); ev(T.whipS, 'cue', { n: 'side' });
  CH.push([T.whipS + .25, '04', '也在这里']);
  T.onExam = T.whipS + .62;
  C.jump(T.whipS - .1, T.onExam, at('blk-9', .9, 0), at('nav-exam', .82, 0), 150, { big: true });
  T.toLib0 = Math.max(W('v10', '找题') - .32, T.onExam + .5); T.onLib = T.toLib0 + .36;
  C.stand(T.onExam, T.toLib0, at('nav-exam', .82, 0), { eyes: 'dl' })
    .jump(T.toLib0, T.onLib, at('nav-exam', .82, 0), at('nav-lib', .82, 0), 36);
  ev(T.onExam, 'glock', { n: 0 }); ev(T.onLib, 'glock', { n: 1 });

  // ═════ 尾声 · back into the mark (57.7 – end)
  T.pullE = VO.v11 - .2; cam(T.pullE, 1.6, [960, 540, 1.0], 'eio'); ev(T.pullE, 'cue', { n: 'outro' });
  T.home0 = W('v12', 'PhysicsOS');
  cam(T.home0 - .15, 1.1, [369, 211, 2.6], 'eio');
  T.toHome0 = T.home0 + .05; T.onHome = T.toHome0 + .42; T.toLogo0 = T.onHome + .18; T.onLogo = T.toLogo0 + .46;
  C.stand(T.onLib, T.toHome0, at('nav-lib', .82, 0), { eyes: t => t < T.pullE + 1.4 ? 'l' : 'u' })
    .jump(T.toHome0, T.onHome, at('nav-lib', .82, 0), at('nav-home', .82, 0), 40, { px: t => lerp(4, 3, seg(t, T.toHome0, T.onHome)) })
    .stand(T.onHome, T.toLogo0, at('nav-home', .82, 0), { px: 3, eyes: 'ul' })
    .jump(T.toLogo0, T.onLogo, at('nav-home', .82, 0), at('logo', .5, 0), 46, { px: t => lerp(3, 1.6, seg(t, T.toLogo0, T.onLogo)) });
  T.dive = Math.max(W('v12', '看不见') - .05, T.onLogo + .35); T.dived = T.dive + .45;
  C.stand(T.onLogo, T.dive, at('logo', .5, 0), { px: 1.6, eyes: t => t < T.dive - .25 ? 'n' : 'shut' }).hide(T.dive, DUR + 1);
  ev(T.dive, 'dive');
  cam(T.dive - .45, .75, [176, 99, 5.5], 'eio');
  T.wink = Math.max(W('v12', '被看见') + .08, T.dived + .6); ev(T.wink, 'wink');
  cam(T.wink + .5, 1.3, [369, 211, 2.6], 'eio');
  T.fade = DUR - .42; ev(DUR - 2.4, 'cue', { n: 'final' });
  MOVES.sort((a, b) => a.t0 - b.t0);
  EV.sort((a, b) => a.t - b.t);
  return { C, CUR };
}

// ───────── per-frame state
export function frame(t) {
  const F = { t, hud: {}, fx: [], ball: BALLA, cursor: CUR };
  F.cam = camAt(t);
  const standCard = () => { let id = null; for (const [cid, tl] of T.hops) if (t >= tl - .02 && t < tl + .17) id = cid; return id; };
  if (t < T.wipe2 + .42) {
    F.page = 'ec';
    let lit = -1; for (const [i, tl] of T.tabs) if (t >= tl - .02 && t < tl + .26) lit = i;
    F.ec = { hatch: t >= T.pop ? seg(t, T.pop, T.pop + .2) : 0, hoverCard: t >= T.click1 - .3 ? PROJ : standCard(), downCard: t >= T.click1 && t < T.click1 + .14 ? PROJ : null, litTab: lit };
    F.side = { active: 'lab' };
  } else if (t < T.wipe3 + .42) {
    F.page = 'bench';
    const B2 = F.bench = { hC: t >= T.tab1 ? 20 : 5, v0C: t >= T.ent ? 10 : 5 };
    B2.hText = t < T.k1 ? '5' : t < T.k2 ? '2' : '20';
    B2.v0Text = t < T.k3 ? (t < T.tab1 ? '5' : '5') : t < T.k4 ? '1' : '10';
    B2.focus = t >= T.fClick && t < T.tab1 ? 'h' : t >= T.tab1 && t < T.ent ? 'v0' : null;
    B2.sel = (t >= T.fClick && t < T.k1) ? 'h' : (t >= T.tab1 && t < T.k3) ? 'v0' : null;
    B2.caret = B2.focus && !B2.sel && Math.floor(t * 2.2) % 2 === 0;
    B2.run = t < T.launch ? 'idle' : t < T.land ? 'fly' : 'done';
    B2.tau = B2.run === 'idle' ? 0 : Math.min((t - T.launch) * .5, P20.t);
    B2.runHover = t >= T.toRun1 - .05 && t < T.click2 + .3; B2.runDown = t >= T.click2 && t < T.click2 + .12;
    let hr = null; for (const [k, tr] of T.rows) if (t >= tr - .05) hr = k; if (t > T.toB0) hr = null; B2.hoverRow = hr;
    if (B2.run === 'idle' && t >= T.drop1) { const L = launchPt(B2.hC); B2.vArrow = { x: L.x, y: L.y, vx: B2.v0C, vy: 0 }; }
    if (B2.run === 'fly') { const b = ballAt(20, 10, B2.tau); B2.vArrow = { x: b.x, y: b.y, vx: b.vx, vy: b.vy }; }
    B2.trajOp = seg(t, T.land + .15, T.land + .6); B2.markOp = seg(t, T.land + .02, T.land + .3); B2.dimOp = seg(t, T.land + .3, T.land + .75);
    F.side = { active: 'lab', newRecent: '平抛运动', recentOn: true };
    // the ball's pixel trail through the air
    if (t >= T.launch && t < T.land + 1.4) F.fx.push(() => trail(t));
  } else if (t < T.chat) {
    F.page = 'home';
    let typed = ''; ['为什么', '洛伦兹力', '不做功', '？'].forEach((c, i) => { if (t >= T.ime[i]) typed += c; });
    F.home = { typed, focus: t >= T.cClick, caret: t >= T.cClick && Math.floor(t * 2.2) % 2 === 0, balls: heroBalls(t) };
    F.side = { active: 'home', newRecent: '平抛运动' };
  } else {
    F.page = 'chat';
    const k = seg(t, T.chat, T.chat + .62), e = back(k, 1.15);
    F.chat = { reveal: BLOCKS.length * seg(t, T.s0, T.s1), scroll: 232 * ss(seg(t, T.s0 + 1.4, T.s1 + .1)), sel: seg(t, T.sel0, T.sel1),
      bub: k < 1 ? { tf: `translate(${((1 - e) * -426).toFixed(1)}px,${((1 - e) * 342).toFixed(1)}px)`, op: Math.min(1, k * 5) } : null };
    let hov = null; if (t >= T.onExam - .02 && t < T.toLib0 + .05) hov = 'exam'; if (t >= T.onLib - .02 && t < T.toHome0 + .05) hov = 'lib';
    if (t >= T.onHome - .02 && t < T.toLogo0 + .05) hov = 'home';
    F.side = { newRecent: '平抛运动', newHist: '为什么洛伦兹力不做功？', hover: hov, logoFx: logoFx(t) };
  }
  // hatch: printed ball → square pixels
  if (t >= T.pop && t < T.born + .02) F.fx.push(() => hatch(t));
  // dive: square pixels → the mark's centre
  if (t >= T.dive && t < T.dived + .05) F.fx.push(A => dive(t, A));
  hud(F, t);
  return F;
}

function trail(t) {
  const tau = Math.min((t - T.launch) * .5, P20.t), fade = 1 - seg(t, T.land + .6, T.land + 1.4); let h = '';
  for (let i = 1; i * .1 < tau - .04; i++) { const b = ballAt(20, 10, i * .1), w = W2(b.x, b.y); h += BL.dot(w.x, w.y, 4, .75 * fade * (.45 + .55 * (i * .1) / P20.t)); }
  return h;
}
function hatch(t) {
  const p = seg(t, T.pop, T.born), px = 3, dst = BL.pixels({ x: T.slab.x, y: T.slab.y, px, eyes: 'wide' }); let h = '';
  dst.forEach((d, i) => {
    const k = eio(clamp((p - hash(i * 1.7) * .35) / .65)), sx = T.ballC.x + (d.x - T.slab.x) * .2, sy = T.ballC.y + (d.y - (T.slab.y - 5.5 * px)) * .2;
    const x = lerp(sx, d.x, k) + Math.sin(k * Math.PI) * (hash(i * 3.1) - .5) * 14, y = lerp(sy, d.y, k) - Math.sin(k * Math.PI) * 10 * hash(i * 5.3), s = lerp(.7, px, k);
    h += `<div class="pp" style="left:${(x - s / 2).toFixed(2)}px;top:${(y - s / 2).toFixed(2)}px;width:${(s + .3).toFixed(2)}px;height:${(s + .3).toFixed(2)}px;background:${k > .5 ? d.col : '#2B4C8C'}"></div>`;
  });
  return h;
}
function dive(t, A) {
  const lg = A('logo', .5, .5); if (!lg) return '';
  const p = seg(t, T.dive, T.dived), px = 1.6, top = A('logo', .5, 0), src = BL.pixels({ x: top.x, y: top.y, px, eyes: 'shut' }); let h = '';
  src.forEach((d, i) => {
    const k = eio(clamp((p - hash(i * 2.9) * .3) / .7)), x = lerp(d.x, lg.x, k), y = lerp(d.y, lg.y, k) - Math.sin(k * Math.PI) * 4 * hash(i * 1.3), s = lerp(px, .35, k);
    h += `<div class="pp" style="left:${(x - s / 2).toFixed(2)}px;top:${(y - s / 2).toFixed(2)}px;width:${(s + .2).toFixed(2)}px;height:${(s + .2).toFixed(2)}px;background:${d.col};opacity:${(1 - k * .6).toFixed(3)}"></div>`;
  });
  return h;
}
// the mark's centre ball winks back once, in the ball's own pixels (page px inside the 22 px mark)
function logoFx(t) {
  if (t < T.dived - .05) return '';
  const k = Math.min(seg(t, T.dived - .05, T.dived + .15), 1 - seg(t, T.wink + .7, T.wink + 1.0)); if (k <= 0) return '';
  const g = .62, eyes = t >= T.wink && t < T.wink + .7 ? [[-2, 0], [-1, -1], [0, 0], [2, 0], [3, -1], [4, 0]] : [[-1, -1], [-1, 0], [3, -1], [3, 0]];
  let h = `<div style="position:absolute;left:${11 - 3.1}px;top:${11 - 3.1}px;width:6.2px;height:6.2px;border-radius:50%;background:${BL.ORANGE};opacity:${(k * .95).toFixed(3)}"></div>`;
  for (const [c, r] of eyes) h += `<div style="position:absolute;left:${(10.4 + (c - 1) * g).toFixed(2)}px;top:${(10.6 + r * g).toFixed(2)}px;width:${g}px;height:${g}px;background:${BL.EYE};opacity:${k.toFixed(3)}"></div>`;
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
  CH.forEach(([t0, no, nm], i) => { const t1 = i + 1 < CH.length ? CH[i + 1][0] - .7 : T.pullE; if (t >= t0 && t < t1) H.chap = { no, nm, op: Math.min(seg(t, t0, t0 + .3), 1 - seg(t, t1 - .3, t1)) }; });
  for (const [t0, no, nm] of WIPES) if (t >= t0 && t < t0 + .85) H.wipe = { p: (t - t0) / .85, no, nm };
  if (H.wipe) H.chap = null;
  const KC = [[T.k1 - .3, [['2', T.k1], ['0', T.k2], ['⇥', T.tab1], ['1', T.k3], ['0', T.k4], ['↵', T.ent]], '初始高度 → 初速度', T.ent + 2.2],
    [T.send - .65, [['↵', T.send]], '发送', T.send + 1.9]];
  for (const [t0, keys, label, t1] of KC) if (t >= t0 && t < t1) {
    const shown = keys.filter(([, kt], i) => i === 0 || t >= kt - .02);
    H.keys = { keys: shown.map(([k]) => k), dn: shown.map(([, kt]) => t >= kt && t < kt + .16), label, op: Math.min(seg(t, t0, t0 + .15), 1 - seg(t, t1 - .25, t1)), y: (1 - back(seg(t, t0, t0 + .3))) * 20 };
  }
  if (t > T.s0 - .1 && t < T.s1 + .25) H.ramp = { op: Math.min(seg(t, T.s0 - .1, T.s0 + .05), 1 - seg(t, T.s1, T.s1 + .25)), blink: Math.floor(t * 4) % 2 };
  if (t > T.spot - .35 && t < T.spotEnd + .3) H.spot = { key: 'badge', op: Math.min(seg(t, T.spot - .35, T.spot), 1 - seg(t, T.spotEnd, T.spotEnd + .3)) };
  if (t > T.fade) H.fade = seg(t, T.fade, DUR);
}
export { CH, WIPES };
