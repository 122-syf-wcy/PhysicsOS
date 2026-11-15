// Warm Lab apparatus library. Factories emit retained kit primitives, never a
// new scene graph per frame. Each factory returns its local frame and contacts;
// all dimensions are scene units already chosen by the platform visual bridge.
import { finite, positive, isPoint, offset, localFrame, segmentPose, surfacePose, scope, entityScope } from './apparatus-geometry.js';

export const finishes = Object.freeze({
  aluminum: Object.freeze({ roughness: 0.3, metalness: 0.82, clearcoat: 0.08 }),
  brushed: Object.freeze({ roughness: 0.46, metalness: 0.7, clearcoat: 0.04 }),
  brass: Object.freeze({ roughness: 0.34, metalness: 0.76, clearcoat: 0.06 }),
  enamel: Object.freeze({ roughness: 0.5, metalness: 0.12, clearcoat: 0.16 }),
  rubber: Object.freeze({ roughness: 0.9, metalness: 0, clearcoat: 0 }),
  wood: Object.freeze({ roughness: 0.76, metalness: 0, clearcoat: 0.02 }),
  ceramic: Object.freeze({ roughness: 0.72, metalness: 0, clearcoat: 0.04 }),
  glass: Object.freeze({ roughness: 0.19, metalness: 0, clearcoat: 0.12, opacity: 0.15, depthWrite: false, castShadow: false, receiveShadow: false }),
  liquid: Object.freeze({ roughness: 0.48, metalness: 0, clearcoat: 0, opacity: 0.24, depthWrite: false, castShadow: false, receiveShadow: false }),
});
export const apparatusColors = Object.freeze({
  alloy: '#bcc8c4', brass: '#b59c68', rubber: '#283735', enamel: '#526e62',
  wood: '#b99b74', ceramic: '#eee8d7', glass: '#c6e4df', liquid: '#84b2be', ink: '#23312f', muted: '#6c776f',
});
const c = apparatusColors;

function contract(object, factory, frame, anchors) {
  if (object) object.userData = { ...object.userData, apparatus: { factory, origin: frame?.origin, axes: frame?.axes, anchors, unit: 'scene' } };
  return object;
}

/** A local painter transforms hardware and its attachment points together. */
export function apparatusFrame(kit, origin, rotation = 0, angleUnit = 'deg') {
  const frame = localFrame(origin, rotation, angleUnit);
  if (!frame) return undefined;
  const at = frame.at;
  const options = (key, opts = {}) => ({ ...opts, rotation: frame.rotation, key });
  return {
    ...frame,
    box: (key, p, width, height, depth, color = c.enamel, opts = {}) => kit.box(at(...p), width, height, depth, color, options(key, opts)),
    sphere: (key, p, radius, color = c.alloy, opts = {}) => kit.sphere(at(...p), radius, color, { ...opts, key }),
    rod: (key, a, b, radius, color = c.alloy, opts = {}) => kit.cylinder(at(...a), at(...b), radius, color, { ...opts, key }),
    line: (key, points, color = c.ink, opts = {}) => kit.line(points.map(p => at(...p)), color, { ...opts, key }),
    label: (key, text, p, opts = {}) => kit.label(text, at(...p), { color: c.ink, ...opts, key }),
  };
}

export function fastener(kit, center, radius, key = 'fastener', rotation = 0) {
  if (!isPoint(center) || !positive(radius)) return;
  return scope(kit, key, () => {
    const f = apparatusFrame(kit, center, rotation), r = radius;
    f.rod('washer', [0, 0, -r * 0.15], [0, 0, -r * 0.05], r * 1.22, '#697c75', finishes.brushed);
    const head = f.rod('head', [0, 0, -r * 0.05], [0, 0, r * 0.2], r, c.alloy, finishes.aluminum);
    f.line('slot', [[-r * 0.55, 0, r * 0.205], [r * 0.55, 0, r * 0.205]], c.rubber);
    return head;
  });
}

export function gripKnob(kit, center, radius, depth, key = 'knob', axis = 'z') {
  if (!isPoint(center) || !positive(radius) || !positive(depth)) return;
  return scope(kit, key, () => {
    const profile = [[0, -depth / 2], [radius * 0.85, -depth / 2], [radius, -depth * 0.3], [radius, depth * 0.3], [radius * 0.85, depth / 2], [0, depth / 2]];
    const knob = kit.lathe(center, profile, c.rubber, { ...finishes.rubber, axis, key: 'body' });
    // Fixed angular stations are machining features, not frame-based identities.
    for (let station = 0; station < 12; station += 1) {
      const phase = station * Math.PI / 6, a = Math.cos(phase) * radius, b = Math.sin(phase) * radius;
      const from = axis === 'x' ? offset(center, -depth * 0.26, a, b) : axis === 'y' ? offset(center, a, -depth * 0.26, b) : offset(center, a, b, -depth * 0.26);
      const to = axis === 'x' ? offset(center, depth * 0.26, a, b) : axis === 'y' ? offset(center, a, depth * 0.26, b) : offset(center, a, b, depth * 0.26);
      kit.cylinder(from, to, radius * 0.022, '#52645b', { ...finishes.rubber, key: `flute:${station}` });
    }
    return knob;
  });
}

export function retainingRing(kit, center, inner, outer, depth, key = 'ring', axis = 'x', color = c.rubber, options = {}) {
  if (!isPoint(center) || !positive(inner) || !positive(outer) || outer <= inner || !positive(depth)) return;
  return kit.lathe(center, [[inner, -depth / 2], [outer, -depth / 2], [outer, depth / 2], [inner, depth / 2], [inner, -depth / 2]], color, { ...finishes.brushed, ...options, axis, key });
}

export function beam(kit, from, to, thickness, depth, color = c.alloy, opts = {}) {
  const pose = segmentPose(from, to);
  if (!pose || !positive(thickness) || !positive(depth)) return;
  return kit.box(pose.at, pose.length, thickness, depth, color, { ...finishes.brushed, ...opts, quaternion: pose.quaternion });
}

export function contactBoard(kit, from, to, thickness, depth, color = c.wood, opts = {}) {
  const pose = surfacePose(from, to, thickness);
  if (!pose || !positive(depth)) return;
  const board = kit.box(pose.at, pose.length, thickness, depth, color, { ...(color === c.wood ? finishes.wood : finishes.brushed), ...opts, rotation: pose.rotation, rounded: false });
  return contract(board, 'contact-board', localFrame(pose.at, pose.rotation), { surfaceFrom: offset(from), surfaceTo: offset(to) });
}

export function cartApparatus(body, kit, color = c.enamel) {
  if (!isPoint(body?.at) || !positive(body.size)) return;
  return entityScope(kit, 'cart', body, () => {
    const s = body.size, frame = apparatusFrame(kit, body.at, finite(body.rotation) ? body.rotation : 0, body.rotationUnit ?? 'deg');
    if (!frame) return;
    const f = frame, anchors = {
      centerOfMass: f.at(), towLeft: f.at(-1.5 * s, -0.12 * s), towRight: f.at(1.5 * s, -0.12 * s),
      contactRear: f.at(-s, -s), contactFront: f.at(s, -s), socket: f.at(0, 0.75 * s),
    };
    const shell = f.box('shell', [0, 0, 0], 2.76 * s, 1.02 * s, 1.56 * s, color, { ...finishes.enamel, tag: body.id });
    contract(shell, 'cart', f, anchors);
    f.box('chassis', [0, -0.4 * s, 0], 2.85 * s, 0.2 * s, 1.62 * s, '#435951', { ...finishes.brushed, tag: `${body.id}-chassis` });
    f.box('deck', [0, 0.57 * s, 0], 2.61 * s, 0.14 * s, 1.61 * s, c.alloy, finishes.aluminum);
    f.box('deck-pad', [0, 0.66 * s, 0], 1.8 * s, 0.035 * s, 1.12 * s, '#718579', finishes.rubber);
    for (const side of [-1, 1]) {
      f.box(`trim:${side}`, [0, 0.3 * s, side * 0.795 * s], 2.3 * s, 0.13 * s, 0.028 * s, '#d4d9cb', finishes.ceramic);
      f.box(`nameplate:${side}`, [0, -0.1 * s, side * 0.8 * s], 1.25 * s, 0.26 * s, 0.025 * s, c.ceramic, finishes.ceramic);
      for (const x of [-1.05, 1.05]) fastener(kit, f.at(x * s, 0.25 * s, side * 0.83 * s), 0.052 * s, `case-screw:${x}:${side}`, f.rotation);
    }
    f.rod('socket-collar', [0, 0.674 * s, 0], [0, 0.75 * s, 0], 0.15 * s, c.brass, finishes.brass);
    f.rod('socket-bore', [0, 0.751 * s, 0], [0, 0.758 * s, 0], 0.067 * s, c.rubber, finishes.rubber);
    for (const [axle, x] of [['rear', -s], ['front', s]]) {
      f.rod(`axle:${axle}`, [x, -0.66 * s, -1.04 * s], [x, -0.66 * s, 1.04 * s], 0.066 * s, c.alloy, finishes.aluminum);
      for (const [side, z] of [['left', -0.9 * s], ['right', 0.9 * s]]) scope(kit, `wheel:${axle}:${side}`, () => {
        const center = f.at(x, -0.66 * s, z);
        // Outer tyre radius .265s + .075s = .34s. Contact is exactly local -s.
        kit.torus(center, 0.265 * s, 0.075 * s, c.rubber, { ...finishes.rubber, axis: 'z', key: 'tyre', tag: `${body.id}-wheel-${axle}-${side}` });
        f.rod('hub', [x, -0.66 * s, z - 0.055 * s], [x, -0.66 * s, z + 0.055 * s], 0.246 * s, c.alloy, finishes.aluminum);
        for (const face of [-1, 1]) {
          kit.torus(offset(center, 0, 0, face * 0.06 * s), 0.19 * s, 0.012 * s, '#70877a', { ...finishes.brushed, axis: 'z', key: `rim:${face}` });
        }
        fastener(kit, offset(center, 0, 0, 0.08 * s), 0.07 * s, 'axle-cap', f.rotation);
      });
    }
    for (const side of [-1, 1]) {
      f.box(`bumper:${side}`, [side * 1.48 * s, -0.12 * s, 0], 0.19 * s, 0.46 * s, 1.44 * s, c.rubber, finishes.rubber);
      for (const z of [-0.44, 0.44]) f.rod(`bumper-pin:${side}:${z}`, [side * 1.35 * s, -0.12 * s, z * s], [side * 1.5 * s, -0.12 * s, z * s], 0.07 * s, c.alloy, finishes.aluminum);
    }
    return { frame: f, anchors, shell };
  });
}

export function blockApparatus(body, kit, color = c.enamel, attachmentEye = false) {
  if (!isPoint(body?.at) || !positive(body.size)) return;
  return entityScope(kit, 'block', body, () => {
    const s = body.size, f = apparatusFrame(kit, body.at, finite(body.rotation) ? body.rotation : 0, body.rotationUnit ?? 'deg');
    if (!f) return;
    const anchors = { centerOfMass: f.at(), top: f.at(0, s), bottom: f.at(0, -s), eye: f.at(0, 0, s * 0.85) };
    const shell = f.box('shell', [0, 0, 0], 2 * s, 2 * s, 1.5 * s, color, { ...(color === c.wood ? finishes.wood : finishes.enamel), tag: body.id });
    contract(shell, 'block', f, anchors);
    for (const y of [-0.73, 0.73]) f.box(`face-strip:${y}`, [0, y * s, 0.763 * s], 1.66 * s, 0.075 * s, 0.027 * s, c.alloy, finishes.brushed);
    for (const x of [-0.72, 0.72]) for (const y of [-0.72, 0.72]) fastener(kit, f.at(x * s, y * s, 0.78 * s), 0.045 * s, `face-screw:${x}:${y}`, f.rotation);
    if (attachmentEye) {
      f.rod('eye-seat', [0, 0, 0.76 * s], [0, 0, 0.85 * s], 0.3 * s, '#556e62', finishes.enamel);
      kit.torus(f.at(0, 0, 0.92 * s), 0.2 * s, 0.036 * s, c.brass, { ...finishes.brass, axis: 'z', key: 'attachment-eye' });
    }
    return { frame: f, anchors, shell };
  });
}

export function hangingMass(body, kit, color = c.alloy) {
  if (!isPoint(body?.at) || !positive(body.size)) return;
  return entityScope(kit, 'mass', body, () => {
    const s = body.size, f = apparatusFrame(kit, body.at, finite(body.rotation) ? body.rotation : 0, body.rotationUnit ?? 'deg');
    if (!f) return;
    const anchors = { centerOfMass: f.at(), suspension: f.at(0, s) };
    const mass = f.rod('stack', [0, -0.91 * s, 0], [0, 0.43 * s, 0], 0.66 * s, color, { ...finishes.brushed, tag: body.id });
    contract(mass, 'hanging-mass', f, anchors);
    for (const y of [-0.83, -0.42, -0.01, 0.4]) f.rod(`slot:${y}`, [0, (y - 0.02) * s, 0], [0, (y + 0.02) * s, 0], 0.69 * s, '#7d8d83', finishes.brushed);
    f.rod('hanger-pin', [0, 0.4 * s, 0], [0, 0.62 * s, 0], 0.06 * s, c.alloy, finishes.aluminum);
    kit.torus(f.at(0, 0.79 * s), 0.18 * s, 0.03 * s, c.alloy, { ...finishes.aluminum, axis: 'z', key: 'hanger-eye' });
    f.rod('attachment-tip', [0, 0.97 * s, 0], [0, s, 0], 0.025 * s, c.alloy, finishes.aluminum);
    return { frame: f, anchors };
  });
}

export function precisionRail(ground, kit, options = {}) {
  if (!ground || !finite(ground.from) || !finite(ground.to) || !finite(ground.y) || ground.from === ground.to) return;
  return scope(kit, options.key ?? 'rail', () => {
    const u = kit.unit, left = Math.min(ground.from, ground.to), right = Math.max(ground.from, ground.to), length = right - left;
    const gauge = positive(options.gauge) ? options.gauge : u * 0.28, depth = Math.max(u * 1.08, gauge * 2 + u * 0.32);
    const f = apparatusFrame(kit, { x: (left + right) / 2, y: ground.y, z: ground.z ?? 0 });
    const anchors = { contactLeft: f.at(-length / 2), contactRight: f.at(length / 2), wheelGauge: gauge };
    const rail = f.box('web', [0, -u * 0.2, 0], length, u * 0.34, depth, c.alloy, { ...finishes.brushed, tag: options.tag ?? 'mechanics-ground' });
    contract(rail, 'precision-rail', f, anchors);
    f.box('recess', [0, -u * 0.034, 0], length, u * 0.014, gauge * 1.4, '#65796e', finishes.enamel);
    for (const [side, z] of [['back', -gauge], ['front', gauge]]) {
      f.box(`running-shoulder:${side}`, [0, -u * 0.031, z], length, u * 0.062, u * 0.12, '#d6dfd6', { ...finishes.aluminum, rounded: false, tag: `mechanics-rail-${side}` });
      for (const y of [-0.1, -0.28]) f.box(`extrusion-rib:${side}:${y}`, [0, y * u, Math.sign(z) * depth / 2], length - u * 0.08, u * 0.018, u * 0.021, '#dbe1d7', finishes.aluminum);
    }
    const front = depth / 2 + u * 0.02;
    f.box('ruler-backing', [0, -u * 0.14, front], length - u * 0.16, u * 0.13, u * 0.012, c.ceramic, finishes.ceramic);
    graduatedAxis(kit, { from: { x: left, y: ground.y - u * 0.085, z: (ground.z ?? 0) + front + u * 0.01 }, to: { x: right, y: ground.y - u * 0.085, z: (ground.z ?? 0) + front + u * 0.01 }, major: options.major, length: u * 0.085, labels: true, key: 'rail-graduation' });
    for (const [end, x] of [['left', -length / 2], ['right', length / 2]]) {
      f.box(`endcap:${end}`, [x, -u * 0.2, 0], u * 0.09, u * 0.36, depth + u * 0.025, '#526f62', finishes.enamel);
      fastener(kit, f.at(x, -u * 0.16, front), u * 0.028, `endcap-screw:${end}`);
    }
    for (const [support, x] of [['left', -length * 0.43], ['right', length * 0.43]]) {
      f.box(`cross-member:${support}`, [x, -u * 0.415, 0], u * 0.44, u * 0.12, depth * 1.12, '#657d70', finishes.enamel);
      for (const [side, z] of [['back', -depth * 0.48], ['front', depth * 0.48]]) {
        f.rod(`level-stud:${support}:${side}`, [x, -u * 0.46, z], [x, -u * 0.67, z], u * 0.035, c.alloy, finishes.aluminum);
        f.rod(`level-nut:${support}:${side}`, [x, -u * 0.54, z], [x, -u * 0.58, z], u * 0.073, c.brass, finishes.brass);
        f.rod(`level-pad:${support}:${side}`, [x, -u * 0.67, z], [x, -u * 0.73, z], u * 0.13, c.rubber, finishes.rubber);
      }
    }
    return { frame: f, anchors };
  });
}

/** Graduation uses an explicitly supplied scene step; it never labels guesses. */
export function graduatedAxis(kit, options) {
  const { from, to, major, length, labels = false } = options;
  if (!isPoint(from) || !isPoint(to) || !positive(major) || !positive(length)) return;
  return scope(kit, options.key ?? 'graduation', () => {
    const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
    const start = horizontal ? from.x : from.y, end = horizontal ? to.x : to.y, low = Math.min(start, end), high = Math.max(start, end);
    if (!(high > low)) return;
    let divisor = 10;
    while ((high - low) / (major / divisor) > 160 && divisor > 1) divisor /= 2;
    let step = major / divisor;
    while ((high - low) / step > 160) step *= 2;
    const first = Math.ceil(low / step), last = Math.floor(high / step);
    let count = 0;
    for (let station = first; station <= last; station += 1) {
      const coordinate = station * step, t = (coordinate - start) / (end - start);
      const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: (from.z ?? 0) + ((to.z ?? 0) - (from.z ?? 0)) * t };
      const full = Math.abs(coordinate / major - Math.round(coordinate / major)) < 1e-8;
      const half = Math.abs(coordinate / major * 2 - Math.round(coordinate / major * 2)) < 1e-8;
      const size = length * (full ? 1 : half ? 0.72 : 0.43);
      kit.line([p, offset(p, horizontal ? 0 : size, horizontal ? -size : 0)], c.muted, { key: `tick:${coordinate.toPrecision(12)}` });
      if (labels && full && count < 14) {
        kit.label(String(Number(coordinate.toPrecision(6))), offset(p, horizontal ? 0 : length * 1.5, horizontal ? -length * 1.7 : 0), { color: c.muted, size: 9, priority: 0, key: `number:${coordinate.toPrecision(12)}` });
        count += 1;
      }
    }
  });
}

/** Suspension anchor is the bottom tip; hardware is entirely above/behind it. */
export function suspensionClamp(apparatus, kit) {
  if (!isPoint(apparatus?.at) || !positive(apparatus.size)) return;
  return entityScope(kit, 'suspension-clamp', apparatus, () => {
    const s = apparatus.size, f = apparatusFrame(kit, apparatus.at);
    const anchors = { suspension: f.at(), column: f.at(-0.36 * s, s, -0.18 * s) };
    const jaw = f.box('jaw', [-s * 0.27, s * 0.25, -s * 0.1], s * 0.38, s * 0.26, s * 0.34, c.enamel, { ...finishes.enamel, tag: apparatus.id });
    contract(jaw, 'suspension-clamp', f, anchors);
    f.rod('column', [-s * 0.36, s * 0.13, -s * 0.18], [-s * 0.36, s, -s * 0.18], s * 0.065, c.alloy, finishes.aluminum);
    f.rod('arm', [-s * 0.37, s * 0.09, 0], [0, s * 0.09, 0], s * 0.045, c.alloy, finishes.aluminum);
    f.rod('suspension-tip', [0, s * 0.09, 0], [0, 0, 0], s * 0.03, c.alloy, finishes.aluminum);
    f.rod('jaw-screw', [-s * 0.27, s * 0.25, s * 0.07], [-s * 0.27, s * 0.25, s * 0.3], s * 0.031, c.brass, finishes.brass);
    gripKnob(kit, f.at(-s * 0.27, s * 0.25, s * 0.34), s * 0.1, s * 0.08, 'jaw-knob');
    return { frame: f, anchors };
  });
}

/** top is a hardware attachment height, bottom is the rail's contact plane. */
export function opticalStand(kit, anchor, top, bottom, key = 'stand', scale) {
  if (!isPoint(anchor) || !finite(top) || !finite(bottom)) return;
  const u = positive(scale) ? scale : kit.unit;
  return scope(kit, key, () => {
    const f = apparatusFrame(kit, { x: anchor.x, y: bottom, z: anchor.z ?? 0 });
    const carriage = f.box('carriage', [0, u * 0.11, 0], u * 0.8, u * 0.22, u * 1.12, '#748677', { ...finishes.enamel, tag: `${key}-carriage` });
    f.box('clamping-shoe', [0, u * 0.245, 0], u * 0.66, u * 0.048, u * 0.84, '#45574f', finishes.brushed);
    f.rod('carriage-screw', [0, u * 0.12, u * 0.48], [0, u * 0.12, u * 0.66], u * 0.038, c.brass, finishes.brass);
    gripKnob(kit, f.at(0, u * 0.12, u * 0.71), u * 0.115, u * 0.12, 'carriage-lock');
    f.line('index', [[-u * 0.05, u * 0.27, u * 0.43], [0, u * 0.27, u * 0.54], [u * 0.05, u * 0.27, u * 0.43]], c.ceramic);
    const low = bottom + u * 0.27;
    if (top > low) {
      kit.cylinder({ x: anchor.x, y: low, z: anchor.z ?? 0 }, { x: anchor.x, y: top, z: anchor.z ?? 0 }, u * 0.067, c.alloy, { ...finishes.aluminum, key: 'post' });
      const collar = low + Math.min((top - low) * 0.42, u * 0.43);
      kit.cylinder({ x: anchor.x, y: low, z: anchor.z ?? 0 }, { x: anchor.x, y: collar, z: anchor.z ?? 0 }, u * 0.107, '#4c6154', { ...finishes.brushed, key: 'sleeve' });
      gripKnob(kit, { x: anchor.x, y: collar, z: (anchor.z ?? 0) + u * 0.15 }, u * 0.09, u * 0.12, 'height-lock');
    }
    const anchors = { railContact: f.at(), mount: { x: anchor.x, y: top, z: anchor.z ?? 0 } };
    contract(carriage, 'optical-stand', f, anchors);
    return { frame: f, anchors };
  });
}

export function opticalRail(kit, left, right, floor, major, key = 'optical-bench') {
  if (![left, right, floor].every(finite) || right <= left) return;
  return scope(kit, key, () => {
    const u = kit.unit, length = right - left, f = apparatusFrame(kit, { x: (left + right) / 2, y: floor, z: 0 });
    const rail = f.box('extrusion', [0, -u * 0.15, 0], length, u * 0.3, u * 1.58, '#35483d', { ...finishes.brushed, tag: key });
    for (const side of [-1, 1]) {
      f.box(`guide:${side}`, [0, -u * 0.014, side * u * 0.32], length, u * 0.028, u * 0.16, c.alloy, { ...finishes.aluminum, rounded: false });
      f.box(`trim:${side}`, [0, -u * 0.17, side * u * 0.8], length - u * 0.07, u * 0.025, u * 0.015, c.brass, finishes.brass);
    }
    f.box('slot', [0, -u * 0.025, 0], length - u * 0.09, u * 0.012, u * 0.13, '#26382d', finishes.rubber);
    for (const [end, x] of [['left', -length / 2], ['right', length / 2]]) {
      f.box(`endcap:${end}`, [x, -u * 0.15, 0], u * 0.075, u * 0.34, u * 1.63, '#526552', finishes.enamel);
      f.box(`foot:${end}`, [x - Math.sign(x) * Math.min(u * 0.42, length * 0.1), -u * 0.4, 0], u * 0.65, u * 0.18, u * 1.65, '#81917c', finishes.enamel);
    }
    graduatedAxis(kit, { from: { x: left, y: floor + u * 0.003, z: u * 0.69 }, to: { x: right, y: floor + u * 0.003, z: u * 0.69 }, major, length: u * 0.13, key: 'ruler' });
    contract(rail, 'optical-rail', f, { contactFrom: f.at(-length / 2), contactTo: f.at(length / 2), axis: 'x' });
    return { frame: f };
  });
}

/** A physical diffuser in YZ. The scientific plane is exactly screen.at.x. */
export function opticalScreen(screen, floor, kit, options = {}) {
  if (!isPoint(screen?.at) || !positive(screen.halfHeight)) return;
  return entityScope(kit, 'screen', screen, () => {
    const h = screen.halfHeight, u = Math.min(kit.unit, h), halfWidth = positive(options.halfWidth) ? options.halfWidth : Math.max(u * 0.68, h * 0.72);
    const rim = Math.min(u * 0.1, h * 0.08), f = apparatusFrame(kit, screen.at);
    const anchors = { opticalPlane: f.at(), center: f.at(), top: f.at(0, h), bottom: f.at(0, -h), normal: 'x' };
    const face = f.box('diffuser', [0, 0, 0], u * 0.022, 2 * h, 2 * halfWidth, options.dark ? '#24372b' : screen.lit && kit.visible('image') ? '#f3eddb' : '#e1e1d2', { ...finishes.ceramic, opacity: options.dark ? 1 : 0.7, depthWrite: false, castShadow: false, rounded: false, tag: screen.id });
    contract(face, 'optical-screen', f, anchors);
    for (const [edge, y] of [['bottom', -h - rim / 2], ['top', h + rim / 2]]) f.box(`frame:${edge}`, [0, y, 0], u * 0.17, rim, 2 * halfWidth + rim * 2, '#405545', finishes.brushed);
    for (const [edge, z] of [['back', -halfWidth - rim / 2], ['front', halfWidth + rim / 2]]) f.box(`frame:${edge}`, [0, 0, z], u * 0.17, h * 2, rim, '#405545', finishes.brushed);
    for (const y of [-h, h]) for (const z of [-halfWidth, halfWidth]) f.rod(`frame-bolt:${y}:${z}`, [-u * 0.09, y, z], [-u * 0.12, y, z], u * 0.025, c.brass, finishes.brass);
    if (finite(floor)) opticalStand(kit, screen.at, screen.at.y - h - rim, floor, 'stand', u);
    if (screen.label) f.label('label', screen.label, [0, h + u * 0.3, 0], { tag: `${screen.id}-label` });
    return { frame: f, anchors, face, halfWidth };
  });
}

/** Mount and glass are presentation only; ray paths remain thin-lens facts. */
export function lensApparatus(element, floor, kit) {
  if (!isPoint(element?.at) || !positive(element.halfAperture)) return;
  return entityScope(kit, 'lens', element, () => {
    const h = element.halfAperture, u = Math.min(kit.unit, h), rim = Math.min(u * 0.17, h * 0.15), depth = Math.min(u * 0.24, h * 0.2);
    const f = apparatusFrame(kit, element.at), anchors = { opticalCenter: f.at(), apertureTop: f.at(0, h), apertureBottom: f.at(0, -h), opticalAxis: 'x', model: 'thin_lens' };
    const mount = retainingRing(kit, element.at, h + u * 0.01, h + rim, depth, 'mount', 'x');
    contract(mount, 'thin-lens-mount', f, anchors);
    for (const [face, x] of [['left', -depth * 0.55], ['right', depth * 0.55]]) retainingRing(kit, f.at(x), h + u * 0.006, h + rim * 0.38, u * 0.025, `retainer:${face}`, 'x', c.brass);
    // A neutral, thin transparent disk depicts the clear aperture, NOT a
    // thick refractive lens with invented curvatures, focal length, ior or CFD.
    const glass = kit.cylinder(f.at(-u * 0.01), f.at(u * 0.01), h, '#d0e2d9', { ...finishes.glass, key: 'aperture-pane', tag: element.id, opacity: 0.18 });
    contract(glass, 'thin-lens-aperture', f, anchors);
    for (const side of [-1, 1]) {
      f.rod(`radial-screw:${side}`, [0, 0, side * (h + rim)], [0, 0, side * (h + rim + u * 0.09)], u * 0.035, c.brass, finishes.brass);
      gripKnob(kit, f.at(0, 0, side * (h + rim + u * 0.14)), u * 0.08, u * 0.1, `centering:${side}`);
    }
    if (finite(floor)) opticalStand(kit, element.at, element.at.y - h - u * 0.1, floor, 'stand', u);
    f.box('saddle', [0, -h - u * 0.07, 0], u * 0.29, u * 0.14, u * 0.36, '#425849', finishes.brushed);
    return { frame: f, anchors };
  });
}

/** A mirror's vertex stays at the supplied center; curvature is only a glyph. */
export function mirrorApparatus(element, floor, kit) {
  if (!isPoint(element?.at) || !positive(element.halfAperture)) return;
  return entityScope(kit, 'mirror', element, () => {
    const h = element.halfAperture, u = Math.min(kit.unit, h), f = apparatusFrame(kit, element.at);
    const anchors = { opticalVertex: f.at(), normal: 'x', apertureTop: f.at(0, h), apertureBottom: f.at(0, -h) };
    let face;
    if (element.kind === 'plane_mirror') {
      const hw = h * 0.64;
      f.box('back', [u * 0.08, 0, 0], u * 0.16, h * 2 + u * 0.18, hw * 2 + u * 0.18, '#465b4d', finishes.brushed);
      // Front surface, not the case center, is the scientific x plane.
      face = f.box('reflecting-face', [u * 0.006, 0, 0], u * 0.012, h * 2, hw * 2, '#c6d5cf', { roughness: 0.12, metalness: 0.93, clearcoat: 0, rounded: false, tag: element.id });
      for (const y of [-h, h]) f.box(`retainer:${y}`, [-u * 0.018, y, 0], u * 0.024, u * 0.024, hw * 2, c.brass, finishes.brass);
      gripKnob(kit, f.at(u * 0.2, 0, hw + u * 0.11), u * 0.085, u * 0.12, 'tilt-lock', 'x');
    } else {
      const bow = Math.min(h * 0.13, u * 0.28) * (element.curvature === 'convex' ? 1 : -1);
      const surface = Array.from({ length: 17 }, (_, station) => [h * station / 16, bow * (station / 16) ** 2]);
      const section = [...surface, ...surface.slice().reverse().map(([r, x]) => [r, x + u * 0.06])];
      face = kit.lathe(element.at, section, '#c6d6cf', { axis: 'x', roughness: 0.15, metalness: 0.92, clearcoat: 0, key: 'reflecting-face', tag: element.id });
      retainingRing(kit, f.at(bow + u * 0.03), h + u * 0.007, h + u * 0.12, u * 0.16, 'retainer', 'x');
      gripKnob(kit, f.at(bow + u * 0.22, 0, h + u * 0.11), u * 0.085, u * 0.12, 'tilt-lock', 'x');
      anchors.curvatureGlyph = element.curvature;
    }
    contract(face, 'mirror', f, anchors);
    if (finite(floor)) opticalStand(kit, element.at, element.at.y - h - u * 0.1, floor, 'stand', u);
    return { frame: f, anchors, face };
  });
}

/** Exact connection tip at at; body/insulator grow behind the scene plane. */
export function bindingTerminal(kit, at, radius = 0.075, color = c.enamel, key = 'terminal') {
  if (!isPoint(at) || !positive(radius)) return;
  return scope(kit, key, () => {
    kit.cylinder(offset(at, 0, 0, -radius * 1.2), offset(at, 0, 0, -radius * 0.45), radius * 1.48, color, { ...finishes.rubber, key: 'collar' });
    kit.cylinder(offset(at, 0, 0, -radius * 0.48), offset(at, 0, 0, radius * 0.25), radius * 1.08, c.alloy, { ...finishes.aluminum, key: 'stud' });
    const contact = kit.sphere(at, radius * 0.72, color, { ...finishes.enamel, key: 'contact' });
    fastener(kit, offset(at, 0, 0, radius * 0.6), radius * 0.5, 'binding-screw', 45);
    contract(contact, 'binding-terminal', localFrame(at), { electricalContact: offset(at) });
    return { contact: offset(at), object: contact };
  });
}

export function instrumentCase(kit, at, width, height, depth, color = c.enamel, options = {}) {
  if (!isPoint(at) || ![width, height, depth].every(positive)) return;
  const object = kit.box(at, width, height, depth, color, { ...finishes.enamel, ...options });
  return object;
}

/** Readout is supplied text, never a solved value or an inferred needle range. */
export function digitalMeter(kit, center, options = {}) {
  if (!isPoint(center)) return;
  const s = positive(options.scale) ? options.scale : 1;
  return scope(kit, options.key ?? 'digital-meter', () => {
    const f = apparatusFrame(kit, center, options.rotation ?? 0, options.rotationUnit ?? 'deg');
    if (!f) return;
    const housing = f.box('housing', [0, 0, 0.015 * s], 1.16 * s, 1.02 * s, 0.38 * s, '#496b58', { ...finishes.enamel, tag: options.tag });
    f.box('gasket', [0, 0, 0.212 * s], 1.06 * s, 0.91 * s, 0.028 * s, '#344d3f', finishes.rubber);
    f.box('faceplate', [0, 0, 0.235 * s], 1.01 * s, 0.86 * s, 0.026 * s, c.ceramic, finishes.ceramic);
    f.box('display-bezel', [0, 0.07 * s, 0.258 * s], 0.83 * s, 0.31 * s, 0.024 * s, '#87967c', finishes.rubber);
    f.box('display', [0, 0.07 * s, 0.275 * s], 0.76 * s, 0.25 * s, 0.012 * s, '#dce5cd', finishes.ceramic);
    for (const x of [-0.43, 0.43]) for (const y of [-0.34, 0.34]) fastener(kit, f.at(x * s, y * s, 0.255 * s), 0.023 * s, `face-screw:${x}:${y}`, f.rotation);
    gripKnob(kit, f.at(0.27 * s, -0.24 * s, 0.3 * s), 0.09 * s, 0.075 * s, 'range-knob');
    f.box('range-index', [0.27 * s, -0.2 * s, 0.341 * s], 0.012 * s, 0.041 * s, 0.009 * s, c.ceramic, finishes.ceramic);
    for (const x of [-0.23, -0.1, 0.03]) f.box(`key:${x}`, [x * s, -0.24 * s, 0.272 * s], 0.075 * s, 0.075 * s, 0.024 * s, '#b0b7a2', finishes.rubber);
    for (const x of [-0.43, 0.43]) f.box(`foot:${x}`, [x * s, -0.51 * s, -0.075 * s], 0.22 * s, 0.05 * s, 0.31 * s, c.rubber, finishes.rubber);
    f.label('unit', options.unit, [0, 0.32 * s, 0.283 * s], { size: 11, priority: 3, tag: options.tag ? `${options.tag}:unit` : undefined });
    if (options.showReading !== false && options.reading !== undefined && options.reading !== null && options.reading !== '') f.label('reading', options.reading, [0, 0.07 * s, 0.292 * s], { size: 11, priority: 5, tag: options.tag ? `${options.tag}:reading` : undefined });
    contract(housing, 'digital-meter', f, { displayCenter: f.at(0, 0.07 * s, 0.292 * s) });
    return { frame: f, housing };
  });
}

/** A normalized pointer only when the engine supplies a normalized fraction. */
export function dialMeter(kit, center, radius, fraction, options = {}) {
  if (!isPoint(center) || !positive(radius)) return;
  return scope(kit, options.key ?? 'dial', () => {
    const f = apparatusFrame(kit, center), r = radius;
    const caseMesh = f.rod('case', [0, 0, -r * 0.19], [0, 0, r * 0.17], r, c.alloy, { ...finishes.brushed, tag: options.tag });
    f.rod('face', [0, 0, r * 0.17], [0, 0, r * 0.19], r * 0.88, c.ceramic, finishes.ceramic);
    for (let station = 0; station <= 8; station += 1) {
      const phase = Math.PI * (1.2 - station * 1.4 / 8);
      f.line(`tick:${station}`, [[Math.cos(phase) * r * 0.68, Math.sin(phase) * r * 0.68, r * 0.21], [Math.cos(phase) * r * 0.8, Math.sin(phase) * r * 0.8, r * 0.21]], c.muted);
    }
    if (finite(fraction) && fraction >= 0 && fraction <= 1) {
      const phase = Math.PI * (1.2 - fraction * 1.4);
      f.line('needle', [[0, 0, r * 0.23], [Math.cos(phase) * r * 0.62, Math.sin(phase) * r * 0.62, r * 0.23]], '#b08745', { tag: options.tag ? `${options.tag}-needle` : undefined });
      f.sphere('needle-pivot', [0, 0, r * 0.235], r * 0.057, c.rubber, finishes.rubber);
    }
    contract(caseMesh, 'dial-meter', f, { readingFraction: finite(fraction) ? fraction : undefined });
    return { frame: f };
  });
}

/** Helix is a material winding glyph; loops is explicitly a visual loop count. */
export function winding(kit, center, halfLength, radius, loops, options = {}) {
  if (!isPoint(center) || !positive(halfLength) || !positive(radius) || !positive(loops)) return;
  return scope(kit, options.key ?? 'winding', () => {
    const count = Math.max(1, Math.min(40, Math.round(loops))), depthRatio = positive(options.depthRatio) ? options.depthRatio : 1;
    const f = localFrame(center, options.rotation ?? 0, options.rotationUnit ?? 'deg');
    if (!f) return;
    const points = Array.from({ length: count * 24 + 1 }, (_, station) => {
      const t = station / (count * 24), phase = t * Math.PI * 2 * count;
      return f.at(-halfLength + 2 * halfLength * t, radius * Math.sin(phase), radius * Math.cos(phase) * depthRatio);
    });
    const wireRadius = Math.min(kit.unit * 0.034, radius * 0.057, halfLength / count * 0.26);
    const coil = kit.tube(points, wireRadius, options.color ?? '#b18a55', { ...finishes.brass, curve: 'polyline', key: 'wire', tag: options.tag });
    const anchors = { axisCenter: offset(center), wireStart: points[0], wireEnd: points[points.length - 1], visualLoops: count };
    contract(coil, 'winding-glyph', f, anchors);
    if (options.former) kit.cylinder(f.at(-halfLength), f.at(halfLength), radius * 0.86, c.glass, { ...finishes.glass, key: 'former', opacity: 0.08 });
    if (options.flange) for (const [end, x] of [['left', -halfLength], ['right', halfLength]]) retainingRing(kit, f.at(x), radius * 0.72, radius * 1.1, Math.min(kit.unit * 0.08, halfLength * 0.12), `flange:${end}`, 'x', '#768b73', { rotation: f.rotation });
    return { frame: f, anchors, coil };
  });
}

/** A real rectangular vessel with clear walls; interior limits remain exact. */
export function container(kit, bounds, options = {}) {
  const { left, right, floor, top, depth } = bounds ?? {};
  if (![left, right, floor, top, depth].every(finite) || right <= left || top <= floor || depth <= 0) return;
  return scope(kit, options.key ?? 'container', () => {
    const u = Math.min(kit.unit, (right - left) / 3, (top - floor) / 3, depth), wall = u * 0.045;
    const centerZ = bounds.z ?? -depth * 0.15, f = apparatusFrame(kit, { x: (left + right) / 2, y: floor, z: centerZ });
    const anchors = { interiorLeft: left, interiorRight: right, interiorFloor: floor, rim: top, front: centerZ + depth / 2, rear: centerZ - depth / 2 };
    for (const [side, x] of [['left', left - wall / 2], ['right', right + wall / 2]]) {
      kit.box({ x, y: (top + floor) / 2, z: centerZ }, wall, top - floor, depth, c.glass, { ...finishes.glass, key: `wall:${side}`, tag: options.tag ? `${options.tag}-wall-${side}` : undefined, rounded: false });
      kit.line([{ x: x + (side === 'left' ? wall / 2 : -wall / 2), y: floor, z: centerZ + depth / 2 }, { x: x + (side === 'left' ? wall / 2 : -wall / 2), y: top, z: centerZ + depth / 2 }], '#889b8c', { opacity: 0.66, key: `edge:${side}` });
    }
    const base = kit.box({ x: (left + right) / 2, y: floor - wall / 2, z: centerZ }, right - left + wall * 2, wall, depth, c.glass, { ...finishes.glass, opacity: 0.25, key: 'floor', tag: options.tag ? `${options.tag}-floor` : undefined, rounded: false });
    contract(base, 'container', f, anchors);
    kit.box({ x: (left + right) / 2, y: (top + floor) / 2, z: centerZ - depth / 2 - wall / 2 }, right - left, top - floor, wall, c.glass, { ...finishes.glass, opacity: 0.07, key: 'rear', rounded: false });
    kit.box({ x: (left + right) / 2, y: (top + floor) / 2, z: centerZ + depth / 2 + wall / 2 }, right - left, top - floor, wall, c.glass, { ...finishes.glass, opacity: 0.045, key: 'front', rounded: false });
    for (const [edge, z] of [['front', centerZ + depth / 2], ['rear', centerZ - depth / 2]]) kit.line([{ x: left, y: top, z }, { x: right, y: top, z }], '#899e8f', { opacity: 0.68, key: `rim:${edge}` });
    kit.line([{ x: left, y: floor, z: centerZ + depth / 2 }, { x: right, y: floor, z: centerZ + depth / 2 }], '#87998d', { opacity: 0.75, key: 'floor-edge' });
    return { frame: f, anchors, bounds: { ...bounds, z: centerZ } };
  });
}

/** Liquid fill is a statics/phase schematic, not a simulated free surface. */
export function liquidVolume(kit, bounds, surface, options = {}) {
  if (!bounds || ![bounds.left, bounds.right, bounds.floor, surface, bounds.depth].every(finite) || bounds.right <= bounds.left || bounds.depth <= 0) return;
  return scope(kit, options.key ?? 'liquid', () => {
    const height = surface - bounds.floor, z = bounds.z ?? -bounds.depth * 0.15;
    let volume;
    if (height > 0) volume = kit.box({ x: (bounds.left + bounds.right) / 2, y: bounds.floor + height / 2, z }, bounds.right - bounds.left, height, bounds.depth * 0.96, options.color ?? c.liquid, { ...finishes.liquid, ...options.material, key: 'volume', tag: options.tag, rounded: false });
    kit.line([{ x: bounds.left, y: surface, z }, { x: bounds.right, y: surface, z }], options.surfaceColor ?? '#588599', { opacity: 0.8, key: 'surface', tag: options.surfaceTag });
    contract(volume, 'liquid-statics-volume', localFrame({ x: (bounds.left + bounds.right) / 2, y: bounds.floor, z }), { floor: bounds.floor, surface });
    return { surface, volume };
  });
}

/** Acoustic center is the mouth, the foot contract is handled by the adapter. */
export function loudspeaker(kit, acousticCenter, options = {}) {
  if (!isPoint(acousticCenter)) return;
  const u = kit.unit * (positive(options.scale) ? options.scale : 1);
  return scope(kit, options.key ?? 'loudspeaker', () => {
    const f = apparatusFrame(kit, acousticCenter, options.rotation ?? 0);
    const housing = f.box('housing', [-u * 0.29, 0, 0], u * 0.39, u * 0.66, u * 0.48, '#536e58', { ...finishes.enamel, tag: options.tag });
    // Flare ends at the source plane rather than moving its mouth into space.
    f.rod('horn', [-u * 0.23, 0, 0], [0, 0, 0], u * 0.25, '#a9b8ac', { ...finishes.brushed, radiusTop: u * 0.25, radiusBottom: u * 0.09, openEnded: true });
    kit.torus(f.at(), u * 0.25, u * 0.018, '#d0d8ca', { ...finishes.aluminum, axis: 'x', key: 'mouth-rim' });
    f.sphere('driver-cap', [-u * 0.23, 0, 0], u * 0.08, c.rubber, finishes.rubber);
    f.box('foot', [-u * 0.29, -u * 0.39, 0], u * 0.55, u * 0.12, u * 0.53, c.alloy, finishes.brushed);
    for (const y of [-0.22, 0.22]) fastener(kit, f.at(-u * 0.29, y * u, u * 0.25), u * 0.026, `case-screw:${y}`);
    contract(housing, 'loudspeaker', f, { acousticCenter: f.at(), mouth: f.at(), mouthNormal: 'x' });
    return { frame: f, anchors: { acousticCenter: f.at(), mouth: f.at() } };
  });
}

export function microphone(kit, sensingCenter, options = {}) {
  if (!isPoint(sensingCenter)) return;
  const u = kit.unit * (positive(options.scale) ? options.scale : 1);
  return scope(kit, options.key ?? 'microphone', () => {
    const f = apparatusFrame(kit, sensingCenter);
    const capsule = f.sphere('capsule', [0, 0, 0], u * 0.13, c.alloy, { ...finishes.brushed, tag: options.tag });
    for (let station = -2; station <= 2; station += 1) f.line(`grille:${station}`, [[-u * 0.085, station * u * 0.035, u * 0.1], [u * 0.085, station * u * 0.035, u * 0.1]], '#5b7061', { opacity: 0.65 });
    f.rod('stem', [0, -u * 0.13, 0], [0, -u * 0.58, 0], u * 0.038, c.alloy, finishes.aluminum);
    f.box('base', [0, -u * 0.65, 0], u * 0.48, u * 0.12, u * 0.36, '#68816a', finishes.enamel);
    contract(capsule, 'microphone', f, { sensingCenter: f.at() });
    return { frame: f, anchors: { sensingCenter: f.at() } };
  });
}

/** Heater.at is the contact plane under the beaker, not the hotplate COM. */
export function hotplate(heater, kit) {
  if (!isPoint(heater?.at) || !positive(heater.halfWidth)) return;
  return entityScope(kit, 'heater', heater, () => {
    const u = Math.min(kit.unit, heater.halfWidth), f = apparatusFrame(kit, heater.at), width = heater.halfWidth * 2;
    const housing = f.box('housing', [0, -u * 0.24, 0], width, u * 0.42, u * 1.62, '#657b61', { ...finishes.enamel, tag: heater.id });
    f.box('contact-plate', [0, -u * 0.025, 0], width, u * 0.05, u * 1.64, c.alloy, { ...finishes.brushed, rounded: false, tag: `${heater.id}-plate` });
    gripKnob(kit, f.at(heater.halfWidth * 0.6, -u * 0.25, u * 0.84), u * 0.085, u * 0.09, 'power-knob');
    for (const x of [-0.7, 0.7]) f.box(`foot:${x}`, [heater.halfWidth * x, -u * 0.49, 0], u * 0.25, u * 0.08, u * 1.3, c.rubber, finishes.rubber);
    f.label('power', heater.power, [0, -u * 0.67, u * 0.25], { tag: `${heater.id}-power` });
    contract(housing, 'hotplate', f, { contactPlane: f.at() });
    return { frame: f, anchors: { contactPlane: f.at() } };
  });
}

/** A normalized glass thermometer; column endpoints are given scene coordinates. */
export function thermometerTube(kit, options) {
  const { at, lower, upper, columnTop, radius, bulbRadius, showColumn = true } = options ?? {};
  if (!isPoint(at) || ![lower, upper, columnTop].every(finite) || !positive(radius) || !positive(bulbRadius) || upper <= lower) return;
  return scope(kit, options.key ?? 'thermometer-tube', () => {
    const f = apparatusFrame(kit, at), bulb = offset(at, 0, -bulbRadius * 0.65), z = at.z ?? 0;
    const tube = kit.cylinder({ x: at.x, y: lower, z }, { x: at.x, y: upper, z }, radius * 1.08, c.glass, { ...finishes.glass, opacity: 0.2, key: 'glass', tag: options.tag ? `${options.tag}-tube` : undefined });
    kit.sphere(bulb, bulbRadius, c.glass, { ...finishes.glass, opacity: 0.24, key: 'bulb-glass' });
    if (showColumn) {
      if (columnTop !== at.y) kit.cylinder(at, { x: at.x, y: columnTop, z }, radius * 0.58, '#b36753', { ...finishes.enamel, key: 'column', tag: options.tag ? `${options.tag}-column` : undefined });
      kit.sphere(bulb, bulbRadius * 0.76, '#b36753', { ...finishes.enamel, key: 'bulb-liquid' });
      kit.label(options.reading, { x: at.x - radius * 5, y: columnTop, z }, { color: c.ink, priority: 3, key: 'reading', tag: options.tag ? `${options.tag}-reading` : undefined });
    }
    contract(tube, 'thermometer-tube', f, { columnFoot: offset(at), columnTop: { x: at.x, y: columnTop, z }, bulbCenter: bulb });
    return { frame: f, anchors: { columnFoot: offset(at), columnTop: { x: at.x, y: columnTop, z }, bulbCenter: bulb } };
  });
}
