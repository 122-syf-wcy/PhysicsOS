// All 24 mechanics experiments share apparatus frames. Motion, forces, contact
// surfaces and strobe samples are platform facts; this adapter owns no clock.
import { finite, positive, isPoint, offset, interpolate, distance, angleDegrees, radiansToDegrees, scope, entityScope, derivedReadout, energyColors } from './apparatus-geometry.js';
import { apparatusColors as colors, finishes, apparatusFrame, fastener, beam, contactBoard, cartApparatus, blockApparatus, hangingMass, precisionRail, suspensionClamp, gripKnob } from './apparatus.js';

function ground(view, kit, id) {
  const g = view.ground;
  if (!g || ![g.from, g.to, g.y].every(finite) || g.from === g.to) return;
  scope(kit, 'ground', () => {
    const u = kit.unit, rough = id.startsWith('friction-');
    const rail = (view.apparatus ?? []).some(item => item.part === 'track-rail') || id.startsWith('collision-') || id === 'chase-meeting';
    if (rail && !rough) {
      const cart = (view.bodies ?? []).find(body => body.kind === 'cart' && positive(body.size));
      precisionRail(g, kit, { gauge: cart?.size === undefined ? undefined : cart.size * 0.9, major: positive(view.tickStep) ? view.tickStep : view.grid?.major, key: 'precision', tag: 'mechanics-ground' });
    } else {
      const from = { x: Math.min(g.from, g.to), y: g.y, z: 0 }, to = { x: Math.max(g.from, g.to), y: g.y, z: 0 };
      contactBoard(kit, from, to, u * 0.16, u * 1.2, rough ? colors.wood : '#d6d6c9', { key: 'contact-board', tag: 'mechanics-ground' });
      for (const [side, t] of [['left', 0.1], ['right', 0.9]]) {
        const p = interpolate(from, to, t);
        kit.box(offset(p, 0, -u * 0.28), u * 0.35, u * 0.18, u * 1.35, colors.rubber, { ...finishes.rubber, key: `foot:${side}` });
      }
      if (rough) {
        // Restrained grain lies on the board, never above the contact plane.
        for (let station = 1; station <= 8; station += 1) {
          const p = interpolate(from, to, station / 9);
          kit.line([offset(p, -u * 0.16, -u * 0.001, -u * 0.5), offset(p, u * 0.16, -u * 0.001, u * 0.5)], '#a88e65', { opacity: 0.42, key: `wood-grain:${station}` });
        }
      }
    }
    if (g.label) kit.label(g.label, { x: Math.min(g.from, g.to), y: g.y - u * 0.83, z: u * 0.55 }, { color: colors.muted, priority: 0, key: 'label', tag: 'ground-label' });
  });
}

function incline(view, kit) {
  const ramp = view.incline;
  if (!ramp || !isPoint(ramp.origin) || !positive(ramp.base)) return;
  scope(kit, 'incline', () => {
    const u = kit.unit;
    let corner, foot, peak;
    if (Array.isArray(ramp.points) && ramp.points.length >= 3 && ramp.points.every(isPoint)) {
      // Native polygon is authoritative; do not solve a second sloped surface.
      [corner, foot, peak] = ramp.points;
    } else {
      const angle = angleDegrees(ramp.angle, ramp.angleUnit ?? 'deg');
      if (angle === undefined) return;
      const rise = ramp.base * Math.tan(angle * Math.PI / 180);
      if (!finite(rise)) return;
      corner = ramp.origin; foot = offset(corner, ramp.base); peak = offset(corner, 0, rise);
    }
    if (Math.abs((foot.x - corner.x) * (peak.y - corner.y) - (foot.y - corner.y) * (peak.x - corner.x)) > 0) {
      kit.polygon([corner, foot, peak], u * 0.84, '#c8d3c2', { ...finishes.enamel, key: 'wedge', tag: 'incline-wedge' });
    }
    contactBoard(kit, peak, foot, u * 0.065, u * 1.08, colors.wood, { key: 'surface', tag: 'incline-surface' });
    beam(kit, offset(corner, 0, -u * 0.055), offset(foot, 0, -u * 0.055), u * 0.11, u * 1.17, colors.alloy, { key: 'base', tag: 'incline-base' });
    for (const [side, point] of [['left', corner], ['right', foot]]) kit.box(offset(point, 0, -u * 0.16), u * 0.28, u * 0.18, u * 1.16, colors.rubber, { ...finishes.rubber, key: `foot:${side}` });
  });
}

function launchPlatform(view, kit) {
  const p = view.platform;
  if (!isPoint(p?.at) || !positive(p.width) || !positive(p.height)) return;
  scope(kit, 'launch-platform', () => {
    const u = kit.unit;
    kit.box(offset(p.at, -p.width / 2, -p.height / 2), p.width, p.height, u * 1.35, '#acbdb0', { ...finishes.brushed, key: 'support', tag: 'launch-platform', rounded: false });
    const from = offset(p.at, -p.width), to = offset(p.at);
    contactBoard(kit, from, to, Math.min(p.height, u * 0.022), u * 1.37, colors.alloy, { key: 'contact-plate' });
  });
}

function extensionRuler(a, kit) {
  entityScope(kit, 'extension-ruler', a, () => {
    const f = apparatusFrame(kit, a.at), s = a.size, w = s * 0.085;
    f.box('backing', [0, -s / 2, -w], w, s, w * 0.28, '#d7c99f', { ...finishes.wood, tag: a.id });
    // Engraved stations without numbers: size is icon height, not a measurement.
    for (let station = 0; station <= 26; station += 1) {
      const y = -s * station / 26;
      f.line(`engraving:${station}`, [[-w / 2, y, -w * 0.82], [-w / 2 + w * (station % 5 === 0 ? 0.8 : 0.45), y, -w * 0.82]], colors.muted);
    }
  });
}

function protractor(a, kit) {
  entityScope(kit, 'protractor', a, () => {
    const center = offset(a.at, 0, 0, -kit.unit * 0.24), r = a.size;
    const points = [center];
    for (let station = 0; station <= 36; station += 1) {
      const angle = Math.PI + station * Math.PI / 36;
      points.push(offset(center, r * Math.cos(angle), r * Math.sin(angle)));
    }
    kit.polygon(points, kit.unit * 0.018, '#dcd7bb', { ...finishes.glass, opacity: 0.2, key: 'plate', tag: a.id });
    kit.circle(center, r, colors.alloy, { start: Math.PI, end: Math.PI * 2, key: 'rim' });
    for (let station = 0; station <= 18; station += 1) {
      const angle = Math.PI + station * Math.PI / 18, inner = r * (station % 3 === 0 ? 0.84 : 0.91);
      kit.line([offset(center, Math.cos(angle) * inner, Math.sin(angle) * inner, kit.unit * 0.016), offset(center, Math.cos(angle) * r, Math.sin(angle) * r, kit.unit * 0.016)], colors.muted, { key: `degree-station:${station * 10}` });
    }
  });
}

function pullerScale(a, kit) {
  entityScope(kit, 'puller-scale', a, () => {
    const s = a.size, rotation = a.flip === true ? 0 : 180, f = apparatusFrame(kit, a.at, rotation);
    // Origin is the hook attached to the block, not the center of the case.
    f.rod('hook', [0, 0, 0], [s * 0.42, 0, 0], s * 0.032, colors.alloy, { ...finishes.aluminum, tag: `${a.id}-hook` });
    f.box('housing', [s * 1.7, 0, 0], s * 2.56, s * 0.65, s * 0.58, '#5a735d', { ...finishes.enamel, tag: a.id });
    f.box('window', [s * 1.7, 0, s * 0.3], s * 2.24, s * 0.39, s * 0.018, colors.ceramic, finishes.ceramic);
    for (let station = 0; station <= 10; station += 1) f.line(`scale-tick:${station}`, [[s * (0.7 + station * 0.2), -s * 0.18, s * 0.316], [s * (0.7 + station * 0.2), s * (station % 5 === 0 ? 0.06 : -0.04), s * 0.316]], colors.muted);
    f.rod('handle-pin', [s * 3, 0, 0], [s * 3.2, 0, 0], s * 0.035, colors.alloy, finishes.aluminum);
    kit.torus(f.at(s * 3.42), s * 0.21, s * 0.035, colors.alloy, { ...finishes.aluminum, axis: 'z', key: 'handle' });
    // No pointer: SceneVisualModel does not supply a gauge fraction/range here.
  });
}

function apparatus(view, kit) {
  for (const a of view.apparatus ?? []) {
    if (!isPoint(a.at) || !positive(a.size)) continue;
    if (a.part === 'support-clamp') suspensionClamp(a, kit);
    else if (a.part === 'ruler-vertical') extensionRuler(a, kit);
    else if (a.part === 'protractor') protractor(a, kit);
    else if (a.part === 'spring-scale') pullerScale(a, kit);
    else if (a.part === 'track-rail' && !view.ground && positive(a.width)) entityScope(kit, 'apparatus-rail', a, () => precisionRail({ y: a.at.y, from: a.at.x - a.width / 2, to: a.at.x + a.width / 2, z: a.at.z }, kit, { key: 'track', major: view.tickStep }));
  }
}

function spring(view, kit) {
  const s = view.spring;
  if (!isPoint(s?.anchor) || !isPoint(s.end)) return;
  entityScope(kit, 'spring', s, () => {
    const a = s.anchor, b = s.end, length = distance(a, b), u = kit.unit;
    if (length > 0) {
      const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length, nx = -dy, ny = dx;
      const radius = Math.min(u * 0.21, length * 0.12), points = [offset(a)];
      // Fixed material winding. Only pitch changes with the real endpoint.
      for (let station = 0; station <= 128; station += 1) {
        const t = station / 128, phase = t * Math.PI * 16, taper = Math.min(1, t * 16, (1 - t) * 16);
        const center = interpolate(a, b, 0.1 + t * 0.8);
        points.push(offset(center, nx * Math.sin(phase) * radius * taper, ny * Math.sin(phase) * radius * taper, Math.cos(phase) * radius * taper));
      }
      points.push(offset(b));
      kit.tube(points, Math.min(u * 0.021, length * 0.012), colors.alloy, { ...finishes.aluminum, curve: 'polyline', key: 'wire', tag: s.id });
    }
    kit.sphere(a, u * 0.047, colors.rubber, { ...finishes.rubber, key: 'anchor', tag: `${s.id}-anchor` });
    kit.sphere(b, u * 0.036, colors.alloy, { ...finishes.aluminum, key: 'end', tag: `${s.id}-end` });
    if (s.axis === 'horizontal') {
      const side = b.x < a.x ? -1 : 1;
      kit.box(offset(a, -side * u * 0.04), u * 0.08, u * 0.76, u * 0.73, '#acbcb0', { ...finishes.brushed, key: 'wall', tag: `${s.id}-wall` });
      for (const y of [-0.24, 0.24]) fastener(kit, offset(a, 0, y * u, u * 0.38), u * 0.032, `wall-screw:${y}`);
    }
    if (kit.visible('guides') && finite(s.equilibrium)) {
      const rest = s.axis === 'vertical' ? { x: a.x, y: s.equilibrium, z: a.z ?? 0 } : { x: s.equilibrium, y: a.y, z: a.z ?? 0 };
      const x = s.axis === 'vertical' ? u * 0.28 : 0, y = s.axis === 'vertical' ? 0 : u * 0.28;
      kit.line([offset(rest, -x, -y, u * 0.3), offset(rest, x, y, u * 0.3)], colors.muted, { dashed: true, key: 'equilibrium', tag: `${s.id}-equilibrium` });
      kit.label('原长参考', offset(rest, x + u * 0.12, y + u * 0.08, u * 0.3), { color: colors.muted, priority: 0, key: 'equilibrium-label' });
    }
  });
}

function pendulum(view, kit) {
  const p = view.pendulum;
  if (!isPoint(p?.pivot) || !isPoint(p.bob)) return;
  entityScope(kit, 'pendulum', p, () => {
    const u = kit.unit;
    const bob = (view.bodies ?? []).find(body => body.kind === 'ball' && isPoint(body.at) && body.at.x === p.bob.x && body.at.y === p.bob.y && (body.at.z ?? 0) === (p.bob.z ?? 0));
    const length = distance(p.pivot, p.bob), contact = positive(bob?.size) && length > bob.size ? interpolate(p.pivot, p.bob, (length - bob.size) / length) : p.bob;
    kit.cylinder(p.pivot, contact, u * 0.014, colors.rubber, { ...finishes.rubber, key: 'string', tag: p.id });
    kit.cylinder(offset(p.pivot, 0, 0, -u * 0.13), offset(p.pivot, 0, 0, u * 0.12), u * 0.056, colors.alloy, { ...finishes.aluminum, key: 'pivot', tag: `${p.id}-pivot` });
    if (kit.visible('guides') && finite(p.length) && p.length >= 0) kit.line([offset(p.pivot, 0, 0, -u * 0.14), offset(p.pivot, 0, -p.length, -u * 0.14)], colors.muted, { dashed: true, opacity: 0.5, key: 'rest', tag: `${p.id}-rest` });
  });
}

function lever(view, kit) {
  const fulcrum = view.leverFulcrum, b = view.leverBeam, u = kit.unit;
  if (isPoint(fulcrum?.at)) entityScope(kit, 'fulcrum', fulcrum, () => {
    const f = apparatusFrame(kit, fulcrum.at);
    kit.polygon([f.at(), f.at(-u * 0.63, -u * 1.2), f.at(u * 0.63, -u * 1.2)], u * 0.65, '#6b856a', { ...finishes.enamel, key: 'head', tag: fulcrum.id });
    f.rod('column', [0, -u * 1.2, 0], [0, -u * 2.56, 0], u * 0.09, colors.alloy, finishes.aluminum);
    f.box('base', [0, -u * 2.68, 0], u * 2.7, u * 0.22, u * 1.25, colors.rubber, finishes.rubber);
    f.rod('axle', [0, 0, -u * 0.5], [0, 0, u * 0.5], u * 0.1, colors.alloy, { ...finishes.aluminum, tag: `${fulcrum.id}-axle` });
  });
  if (isPoint(b?.from) && isPoint(b.to)) entityScope(kit, 'lever-beam', b, () => {
    beam(kit, b.from, b.to, u * 0.22, u * 0.72, '#b7bda4', { key: 'beam', tag: b.id });
    const length = Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y);
    if (length > 0) {
      const nx = -(b.to.y - b.from.y) / length, ny = (b.to.x - b.from.x) / length;
      // Already-tilted endpoints are interpolated once, never tilted again.
      for (let station = 1; station < 40; station += 1) {
        const p = interpolate(b.from, b.to, station / 40), tick = station % 5 === 0 ? -u * 0.05 : u * 0.02;
        kit.line([offset(p, nx * u * 0.1, ny * u * 0.1, u * 0.365), offset(p, nx * tick, ny * tick, u * 0.365)], colors.muted, { key: `engraving:${station}` });
      }
    }
  });
  for (const h of view.leverHangers ?? []) {
    if (!isPoint(h.attach) || !isPoint(h.massAt)) continue;
    entityScope(kit, 'lever-load', h, () => {
      kit.cylinder(h.attach, offset(h.massAt, 0, u * 0.44), u * 0.021, colors.alloy, { ...finishes.aluminum, key: 'hanger', tag: `${h.id}-hanger` });
      kit.torus(offset(h.attach, 0, -u * 0.045, u * 0.4), u * 0.1, u * 0.021, colors.alloy, { ...finishes.aluminum, axis: 'z', key: 'hook' });
      hangingMass({ id: h.id, at: h.massAt, size: u * 0.44 }, kit, colors.alloy);
      kit.label(h.massText, offset(h.massAt, h.side === 'left' ? -u * 0.75 : u * 0.75, -u * 0.2, u * 0.5), { priority: 2, key: 'mass-label', tag: `${h.id}-mass` });
    });
  }
}

// A force table is anchored at the supplied body, not sized from force arrows.
// Those arrows are display-scaled quantities, not positions of cord end fixtures.
function forceTable(body, kit) {
  const u = kit.unit, z = (body.at.z ?? 0) - body.size * 0.86;
  scope(kit, 'force-table', () => {
    kit.box({ x: body.at.x, y: body.at.y, z: z - u * 0.12 }, u * 3.8, u * 3.2, u * 0.18, '#6a826a', { ...finishes.enamel, key: 'frame', tag: 'force-table-frame' });
    kit.box({ x: body.at.x, y: body.at.y, z: z - u * 0.018 }, u * 3.64, u * 3.04, u * 0.024, '#e2e4d4', { ...finishes.ceramic, key: 'face', tag: 'force-table-face' });
    for (const x of [-1.68, 1.68]) for (const y of [-1.36, 1.36]) fastener(kit, { x: body.at.x + x * u, y: body.at.y + y * u, z: z + u * 0.01 }, u * 0.033, `panel-screw:${x}:${y}`);
    for (const side of [-1, 1]) kit.box({ x: body.at.x + side * u * 1.25, y: body.at.y - u * 1.73, z: z - u * 0.1 }, u * 0.48, u * 0.16, u * 0.65, colors.rubber, { ...finishes.rubber, key: `foot:${side}`, tag: 'force-table-foot' });
  });
}

function satellite(body, kit) {
  entityScope(kit, 'satellite', body, () => {
    const s = body.size, f = apparatusFrame(kit, body.at, finite(body.rotation) ? body.rotation : 0, body.rotationUnit ?? 'deg');
    if (!f) return;
    f.box('bus', [0, 0, 0], 2 * s, 2 * s, 1.2 * s, colors.alloy, { ...finishes.brushed, tag: body.id });
    f.box('insulation', [0, 0, 0.64 * s], 1.54 * s, 1.54 * s, 0.07 * s, '#bca46a', finishes.brass);
    for (const side of [-1, 1]) {
      f.rod(`panel-arm:${side}`, [side * s, 0, 0], [side * 1.28 * s, 0, 0], 0.045 * s, colors.alloy, finishes.aluminum);
      f.box(`solar-panel:${side}`, [side * 1.72 * s, 0, 0], 0.96 * s, 1.42 * s, 0.07 * s, '#526e81', finishes.enamel);
      for (const y of [-0.44, 0, 0.44]) f.line(`cell-row:${side}:${y}`, [[side * 1.26 * s, y * s, 0.04 * s], [side * 2.16 * s, y * s, 0.04 * s]], '#afc4ca');
    }
  });
}

function apparentScale(body, snapshot, kit) {
  scope(kit, 'weighing-platform', () => {
    const s = body.size, f = apparatusFrame(kit, body.at);
    f.box('pan', [0, -s * 1.12, 0], s * 2.9, s * 0.24, s * 2.05, colors.alloy, { ...finishes.brushed, tag: `${body.id}-scale-pan`, rounded: false });
    f.box('housing', [0, -s * 1.4, 0], s * 2.45, s * 0.32, s * 1.76, '#637d66', finishes.enamel);
    f.box('display', [0, -s * 1.41, s * 0.9], s * 1.55, s * 0.2, s * 0.028, '#e0e6d2', finishes.ceramic);
    f.label('reading', derivedReadout(snapshot, 'N'), [0, -s * 1.41, s * 0.925], { size: 10, priority: 3, tag: 'apparent-weight-reading' });
  });
}

function bodies(view, kit, id, snapshot) {
  for (const body of view.bodies ?? []) {
    if (!isPoint(body.at) || !positive(body.size) || (view.energyRamp && body.id === 'energy-cart')) continue;
    entityScope(kit, 'body', body, () => {
      const color = id.startsWith('friction-') ? colors.wood : colors.enamel;
      if ((id === 'force-composition' || id === 'concurrent-equilibrium') && body.kind === 'block') forceTable(body, kit);
      if (id === 'circular-orbit' && body.kind === 'block') satellite(body, kit);
      else if (body.kind === 'cart') cartApparatus(body, kit, color);
      else if (body.kind === 'weight-hook') hangingMass(body, kit);
      else if (body.kind === 'block') blockApparatus(body, kit, color, id === 'force-composition' || id === 'concurrent-equilibrium');
      else if (body.kind === 'ball') {
        kit.sphere(body.at, body.size, color, { ...finishes.enamel, key: 'sphere', tag: body.id });
        // Recessed seam does not change the sphere radius or collision contact.
        kit.circle(offset(body.at, 0, 0, body.size * 0.015), body.size * 0.9998, '#d6ded1', { key: 'equator', tag: `${body.id}-seam` });
      }
      if (id === 'apparent-weight') apparentScale(body, snapshot, kit);
      if (body.label) kit.label(body.label, offset(body.at, 0, body.size + kit.unit * 0.18, body.size), { priority: 2, key: 'label', tag: `${body.id}-label` });
    });
  }
}

function energy(view, kit, id) {
  const r = view.energyRamp, u = kit.unit;
  if (r && isPoint(r.base) && isPoint(r.peak) && kit.visible('energyConversion')) entityScope(kit, 'energy-ramp', r, () => {
    const length = distance(r.base, r.peak);
    if (length > 0) {
      const tx = (r.peak.x - r.base.x) / length, ty = (r.peak.y - r.base.y) / length, nx = -ty, ny = tx;
      if ((r.peak.x - r.base.x) * (r.peak.y - r.base.y) !== 0) kit.polygon([r.base, r.peak, { x: r.peak.x, y: r.base.y, z: r.base.z ?? 0 }], u * 0.84, '#cbd4c3', { ...finishes.enamel, key: 'wedge', tag: r.id });
      contactBoard(kit, r.base, r.peak, u * 0.058, u * 1.08, id === 'ramp-friction' ? colors.wood : colors.alloy, { key: 'surface', tag: `${r.id}-surface` });
      const body = (view.bodies ?? []).find(item => item.id === 'energy-cart');
      if (isPoint(body?.at) && positive(r.cartLength) && positive(r.cartHalfHeight)) {
        // A finite apparatus shell is fitted inside the ramp footprint. The
        // engine point is retained separately; it is never clamped or rewritten.
        const cartLength = Math.min(r.cartLength, length), halfHeight = r.cartHalfHeight * cartLength / r.cartLength;
        const station = Math.min(length - cartLength / 2, Math.max(cartLength / 2, (body.at.x - r.base.x) * tx + (body.at.y - r.base.y) * ty));
        const center = offset(r.base, tx * station + nx * halfHeight, ty * station + ny * halfHeight), f = apparatusFrame(kit, center, radiansToDegrees(Math.atan2(ty, tx)));
        scope(kit, `carriage:${body.id}`, () => {
          const shell = f.box('shell', [0, 0, 0], cartLength, halfHeight * 2, u * 0.66, '#58785d', { ...finishes.enamel, rounded: false, tag: `${r.id}-cart` });
          if (shell) shell.userData.apparatus = { factory: 'energy-carriage', origin: offset(body.at), anchors: { enginePoint: offset(body.at), displayCenter: center }, unit: 'scene' };
          f.box('deck', [0, halfHeight * 0.65, 0], cartLength * 0.78, halfHeight * 0.18, u * 0.68, colors.alloy, finishes.aluminum);
          for (const x of [-0.32, 0.32]) f.rod(`wheel:${x}`, [x * cartLength, -halfHeight * 0.65, -u * 0.39], [x * cartLength, -halfHeight * 0.65, u * 0.39], halfHeight * 0.3, colors.rubber, finishes.rubber);
          kit.sphere(body.at, Math.min(halfHeight * 0.055, u * 0.032), colors.ink, { key: 'engine-anchor', tag: `${body.id}-engine-anchor` });
        });
      }
    }
    if (kit.visible('energy')) {
      kit.label(r.potentialText, offset(r.peak, -u * 0.6, u * 0.65), { priority: 2, key: 'potential-label', tag: 'release-energy' });
      kit.label(r.kineticText, offset(r.base, -u * 0.05, u * 1.05), { priority: 2, key: 'kinetic-label', tag: 'terminal-energy' });
      kit.label(r.speedText, offset(r.base, -u * 0.05, u * 0.62), { color: colors.muted, key: 'speed-label' });
    }
  });
  const bar = view.energyBar;
  if (!kit.visible('energy') || !isPoint(bar?.at) || !positive(bar.width) || !positive(bar.height)) return;
  entityScope(kit, 'energy-ledger', bar, () => {
    const depth = u * 0.11;
    kit.box(offset(bar.at, bar.width / 2, bar.height / 2, -depth), bar.width, bar.height, depth, '#e3e2d3', { ...finishes.ceramic, key: 'track', tag: bar.id, rounded: false, castShadow: false });
    let cursor = bar.at.x;
    for (const segment of bar.segments ?? []) {
      if (!finite(segment.fraction) || segment.fraction < 0) continue;
      const width = bar.width * segment.fraction;
      entityScope(kit, 'segment', segment, () => {
        // Exact shares, including zero and arbitrarily small values. No minimum
        // width, normalization, or perspective exaggeration of the ledger.
        if (width > 0) kit.box({ x: cursor + width / 2, y: bar.at.y + bar.height / 2, z: bar.at.z ?? 0 }, width, bar.height, depth, energyColors[segment.role] ?? colors.muted, { ...finishes.ceramic, key: 'fill', tag: `energy-segment-${segment.id}`, rounded: false, castShadow: false, receiveShadow: false, depthTest: false });
      });
      cursor += width;
    }
    kit.label(bar.totalText, offset(bar.at, bar.width / 2, -u * 0.34, depth), { priority: 3, key: 'total', tag: 'energy-total' });
    // Direct legend is always present: values readable without relying on hues.
    let station = 0;
    for (const segment of bar.segments ?? []) entityScope(kit, 'legend', segment, () => {
      const p = offset(bar.at, bar.width + u * 0.62, bar.height - station * u * 0.47, depth);
      kit.line([offset(p, -u * 0.27), offset(p, -u * 0.11)], energyColors[segment.role] ?? colors.muted, { key: 'swatch' });
      kit.label(segment.text, p, { color: colors.ink, priority: 2, key: 'text', tag: `energy-label-${segment.id}` });
      station += 1;
    });
  });
}

function strobeMarks(view, kit) {
  if (!kit.visible('trajectory')) return;
  for (const mark of view.motionMarks ?? []) if (isPoint(mark.at)) entityScope(kit, 'strobe', mark, () => {
    kit.sphere(offset(mark.at, 0, 0, -kit.unit * 0.11), kit.unit * 0.03, colors.muted, { opacity: 0.5, key: 'mark', tag: mark.id });
    kit.label(mark.label, offset(mark.at, 0, -kit.unit * 0.23, kit.unit * 0.15), { color: colors.muted, priority: 0, key: 'label', tag: `${mark.id}-label` });
  });
}

export function drawMechanics(snapshot, kit) {
  const view = snapshot?.view;
  if (!view || !positive(kit.unit)) return;
  scope(kit, 'mechanics', () => {
    const id = snapshot.experimentId ?? '';
    ground(view, kit, id); incline(view, kit); launchPlatform(view, kit); apparatus(view, kit);
    spring(view, kit); pendulum(view, kit); lever(view, kit); energy(view, kit, id); strobeMarks(view, kit); bodies(view, kit, id, snapshot);
  });
}
