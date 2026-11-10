// 小球: an 11×11 pixel ball, the engine made visible. Its props share the same square-pixel grid.
import { hash } from '/core/lib.js';

export const ORANGE = '#FF6A3D', ORANGE_D = '#D9481F', ORANGE_L = '#FFB596', SHINE = '#FFE6DA', EYE = '#1E2028';
const MASK = ['...xxxxx...', '..xxxxxxx..', '.xxxxxxxxx.', 'xxxxxxxxxxx', 'xxxxxxxxxxx', 'xxxxxxxxxxx',
  'xxxxxxxxxxx', 'xxxxxxxxxxx', '.xxxxxxxxx.', '..xxxxxxx..', '...xxxxx...'];
const IN = (c, r) => r >= 0 && r < 11 && c >= 0 && c < 11 && MASK[r][c] === 'x';
const EYES = {
  n: [[3, 4], [3, 5], [7, 4], [7, 5]], r: [[4, 4], [4, 5], [8, 4], [8, 5]], l: [[2, 4], [2, 5], [6, 4], [6, 5]],
  u: [[3, 3], [3, 4], [7, 3], [7, 4]], d: [[3, 5], [3, 6], [7, 5], [7, 6]], dr: [[4, 5], [4, 6], [8, 5], [8, 6]],
  dl: [[2, 5], [2, 6], [6, 5], [6, 6]], ur: [[4, 3], [4, 4], [8, 3], [8, 4]], ul: [[2, 3], [2, 4], [6, 3], [6, 4]],
  wide: [[3, 3], [3, 4], [3, 5], [7, 3], [7, 4], [7, 5]], blink: [[3, 5], [7, 5]],
  happy: [[2, 5], [3, 4], [4, 5], [6, 5], [7, 4], [8, 5]], shut: [[2, 5], [3, 5], [4, 5], [6, 5], [7, 5], [8, 5]],
};

/** [[c, r, colour]] for one pose. */
export function cells(eyes = 'n') {
  const out = [], E = new Set((EYES[eyes] || EYES.n).map(([c, r]) => c + ',' + r));
  for (let r = 0; r < 11; r++) for (let c = 0; c < 11; c++) {
    if (!IN(c, r)) continue;
    let col = ORANGE;
    const rim = !IN(c + 1, r) || !IN(c, r + 1) || !IN(c + 1, r + 1);
    if (rim && c + r >= 11) col = ORANGE_D;
    if ((c === 4 && r === 2) || (c === 2 && r === 4)) col = ORANGE_L;
    if (c === 3 && r === 3) col = SHINE;
    if (E.has(c + ',' + r)) col = EYE;
    out.push([c, r, col]);
  }
  return out;
}

// x, y = bottom centre (world); px = side of one pixel; sq > 0 squash, < 0 stretch
export function sprite({ x, y, px = 4, sq = 0, eyes = 'n', op = 1, tint = null }) {
  const sy = 1 - sq, sx = 1 + sq * .7, w = 11 * px * sx, h = 11 * px * sy;
  let s = '';
  for (const [c, r, col] of cells(eyes)) s += `<rect x="${c}" y="${r}" width="1.04" height="1.04" fill="${tint && col !== EYE ? tint : col}"/>`;
  return `<svg class="px" viewBox="0 0 11 11" width="${w.toFixed(2)}" height="${h.toFixed(2)}" style="left:${(x - w / 2).toFixed(2)}px;top:${(y - h).toFixed(2)}px;opacity:${op}" shape-rendering="crispEdges">${s}</svg>`;
}

/** world centre of every pixel of a pose, for hatching and the final dive */
export function pixels({ x, y, px = 4, eyes = 'n' }) {
  return cells(eyes).map(([c, r, col]) => ({ x: x + (c - 5) * px, y: y - (11 - r) * px + px / 2, col }));
}

const sq = (x, y, s, col, op = 1) => `<div class="pp" style="left:${(x - s / 2).toFixed(2)}px;top:${(y - s / 2).toFixed(2)}px;width:${s.toFixed(2)}px;height:${s.toFixed(2)}px;background:${col};opacity:${op.toFixed(3)}"></div>`;

/** landing dust: k 0→1, puffs spread to both sides */
export function dust(x, y, k, px = 4, n = 6, seed = 1) {
  if (k <= 0 || k >= 1) return '';
  let s = '';
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1, j = (i >> 1) + 1, e = 1 - (1 - k) ** 2;
    const dx = side * (px * 3 + j * px * 3 + hash(seed * 7 + i) * px * 2) * e, dy = -(px * 1.6 + j * px) * Math.sin(Math.PI * k * .9);
    s += sq(x + dx, y + dy - px / 2, px * (1 - k * .6), '#D7D2C6', 1 - k);
  }
  return s;
}

/** pixels flying outward (k 0→1) */
export function burst(x, y, k, px = 4, n = 16, seed = 3, cols = [ORANGE, ORANGE_L, '#FFC24D']) {
  if (k <= 0 || k >= 1) return '';
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = hash(seed + i * 2.3) * Math.PI * 2, r = (px * 4 + hash(seed + i * 7.7) * px * 14) * (1 - (1 - k) ** 2);
    s += sq(x + Math.cos(a) * r, y + Math.sin(a) * r * .8, px * (1 - k * .5), cols[i % cols.length], 1 - k);
  }
  return s;
}

export const dot = (x, y, px, op = 1, col = ORANGE) => sq(x, y, px, col, op);

/** a pixel sparkle (plus sign) */
export function spark(x, y, px, op = 1, col = '#FFC24D') {
  return [[0, -2], [0, -1], [-2, 0], [-1, 0], [1, 0], [2, 0], [0, 1], [0, 2]].map(([c, r]) => sq(x + c * px, y + r * px, px, col, op)).join('');
}
