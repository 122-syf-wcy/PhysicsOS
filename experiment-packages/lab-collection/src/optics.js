// Six optical experiments: all optical centers, signed heights, real/virtual
// images and every ray vertex come from the platform. Glass is presentation,
// never an invented thick-lens/refraction solver.
import { finite, positive, isPoint, offset, scope, entityScope, pathSpan, rayColors } from './apparatus-geometry.js';
import { apparatusColors as c, finishes, apparatusFrame, fastener, retainingRing, opticalRail, opticalStand, opticalScreen, lensApparatus, mirrorApparatus } from './apparatus.js';

function mark(object) {
  object?.traverse(child => {
    child.renderOrder = 12;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) if (material) { material.depthTest = false; material.depthWrite = false; }
  });
  return object;
}

function ray(kit, points, color, key, tag, dashed = false) {
  if (!Array.isArray(points) || points.length < 2 || !points.every(isPoint)) return;
  scope(kit, key, () => {
    mark(kit.line(points, color, { dashed, key: 'path', tag }));
    if (dashed) return;
    const direction = pathSpan(points, 0.57, kit.unit * 0.4);
    if (direction) mark(kit.arrow(direction.from, direction.to, color, { key: 'direction', tag: `${tag}-direction` }));
  });
}

function imageArrow(kit, from, to, virtual, key, tag) {
  if (!isPoint(from) || !isPoint(to)) return;
  scope(kit, key, () => {
    const color = '#8875a0';
    if (!virtual) { mark(kit.arrow(from, to, color, { key: 'shaft', tag })); return; }
    mark(kit.line([from, to], color, { dashed: true, key: 'shaft', tag }));
    const height = to.y - from.y;
    if (height === 0) return;
    const head = Math.min(Math.abs(height) * 0.24, kit.unit * 0.2), sign = Math.sign(height);
    mark(kit.line([offset(to, -head * 0.5, -sign * head), to, offset(to, head * 0.5, -sign * head)], color, { dashed: true, key: 'head', tag: `${tag}-head` }));
  });
}

function candle(o, floor, kit) {
  const h = o.height, u = Math.min(kit.unit, h), f = apparatusFrame(kit, o.at), radius = Math.min(u * 0.09, h * 0.08);
  opticalStand(kit, o.at, o.at.y - u * 0.11, floor, 'stand', u);
  f.rod('holder', [0, -u * 0.14, 0], [0, 0, 0], radius * 1.3, c.brass, finishes.brass);
  const bodyHeight = h * 0.78, flameHeight = h * 0.2, flameBase = h - flameHeight;
  kit.lathe(o.at, [[0, 0], [radius * 0.88, 0], [radius, bodyHeight * 0.03], [radius, bodyHeight * 0.94], [radius * 0.93, bodyHeight], [radius * 0.64, bodyHeight], [0, bodyHeight * 0.965]], '#eee5c8', { ...finishes.ceramic, axis: 'y', key: 'wax', tag: o.id });
  f.rod('wick', [0, bodyHeight * 0.965, 0], [0, flameBase + flameHeight * 0.16, 0], radius * 0.05, '#493f2c', finishes.rubber);
  const profile = [[0, 0], [0.52, 0.07], [0.96, 0.23], [1, 0.35], [0.72, 0.58], [0.3, 0.82], [0, 1]];
  kit.lathe(f.at(0, flameBase), profile.map(([r, y]) => [r * radius * 0.58, y * flameHeight]), '#e8b56d', { axis: 'y', materialType: 'basic', opacity: 0.76, depthWrite: false, castShadow: false, receiveShadow: false, key: 'flame', tag: `${o.id}-flame` });
  kit.lathe(f.at(0, flameBase + flameHeight * 0.04), profile.map(([r, y]) => [r * radius * 0.28, y * flameHeight * 0.72]), '#f9eaca', { axis: 'y', materialType: 'basic', opacity: 0.85, depthWrite: false, castShadow: false, receiveShadow: false, key: 'flame-core' });
  // Static flame's tip is exactly the optical object's luminous endpoint.
}

function luminousObject(o, floor, kit) {
  if (!isPoint(o?.at) || !finite(o.height)) return;
  entityScope(kit, 'optical-object', o, () => {
    const p = o.at, h = o.height, u = h > 0 ? Math.min(kit.unit, h) : kit.unit;
    if (h <= 0) { mark(kit.arrow(p, offset(p, 0, h), '#bb954e', { key: 'object-arrow', tag: o.id })); return; }
    // Optional semantic kind only. A localized display label is not a type.
    if (o.kind === 'candle') candle(o, floor, kit);
    else {
      opticalStand(kit, p, p.y - u * 0.12, floor, 'stand', u);
      const f = apparatusFrame(kit, p), shaft = Math.min(u * 0.08, h * 0.08), head = Math.min(u * 0.25, h * 0.25), neck = h - Math.min(h * 0.22, u * 0.3);
      f.box('lightbox', [0, -u * 0.18, 0], u * 0.44, u * 0.27, u * 0.49, '#425548', finishes.brushed);
      f.box('aperture', [0, -u * 0.018, 0], u * 0.32, u * 0.036, u * 0.4, c.brass, finishes.brass);
      const target = kit.polygon([f.at(-shaft), f.at(shaft), f.at(shaft, neck), f.at(head, neck), f.at(0, h), f.at(-head, neck), f.at(-shaft, neck)], u * 0.075, '#d6b36a', { ...finishes.ceramic, emissive: '#bb9343', emissiveIntensity: 0.25, key: 'luminous-target', tag: o.id });
      if (target) target.userData.apparatus = { factory: 'backlit-optical-target', origin: offset(p), anchors: { objectFoot: offset(p), luminousTip: offset(p, 0, h) }, unit: 'scene' };
      fastener(kit, f.at(0, -u * 0.18, u * 0.25), u * 0.027, 'lightbox-screw');
    }
    kit.label(o.label, offset(p, 0, h + u * 0.3), { priority: 2, key: 'label', tag: `${o.id}-label` });
  });
}

function opticalBench(view, kit) {
  const u = kit.unit, elements = view.opticalElements ?? [], screens = view.opticalScreens ?? [], objects = view.opticalObjects ?? [];
  const bottoms = [...elements.filter(e => isPoint(e.at) && positive(e.halfAperture)).map(e => e.at.y - e.halfAperture), ...screens.filter(s => isPoint(s.at) && positive(s.halfHeight)).map(s => s.at.y - s.halfHeight)];
  const floor = bottoms.length ? Math.min(...bottoms) - u * 0.45 : (view.origin?.y ?? 0) + u * 0.5;
  const xs = [...elements, ...screens, ...objects].filter(e => isPoint(e.at)).map(e => e.at.x);
  if (xs.length) opticalRail(kit, Math.min(...xs) - u * 0.62, Math.max(...xs) + u * 0.62, floor, view.tickStep, 'optical-bench');
  const first = elements.find(e => isPoint(e.at));
  if (first && kit.visible('guides') && isPoint(view.origin) && positive(view.extent?.width)) kit.line([{ x: view.origin.x, y: first.at.y, z: first.at.z ?? 0 }, { x: view.origin.x + view.extent.width, y: first.at.y, z: first.at.z ?? 0 }], c.muted, { dashed: true, opacity: 0.5, key: 'optical-axis', tag: 'optical-axis' });
  for (const s of screens) opticalScreen(s, floor, kit);
  for (const e of elements) {
    if (!isPoint(e.at) || !positive(e.halfAperture)) continue;
    if (e.kind === 'thin_lens') lensApparatus(e, floor, kit);
    else if (e.kind === 'plane_mirror' || e.kind === 'curved_mirror') mirrorApparatus(e, floor, kit);
    entityScope(kit, 'optical-element-label', e, () => kit.label(e.label, offset(e.at, 0, e.halfAperture + Math.min(u, e.halfAperture) * 0.3), { priority: 2, key: 'label', tag: `${e.id}-label` }));
  }
  for (const o of objects) luminousObject(o, floor, kit);
  if (kit.visible('rays')) {
    const kinds = new Set();
    for (const r of view.opticalRays ?? []) entityScope(kit, 'ray', r, () => {
      const color = rayColors[r.kind] ?? rayColors.incident;
      ray(kit, r.points, color, 'physical-path', r.id);
      if (r.extension) ray(kit, r.extension, color, 'virtual-extension', `${r.id}-extension`, true);
      kinds.add(r.kind);
    });
    if (kinds.size >= 2 && first) scope(kit, 'ray-legend', () => {
      const names = { parallel: '平行光线', central: '中心光线', focal: '焦点光线', incident: '入射光线' };
      let station = 0;
      for (const kind of ['parallel', 'central', 'focal', 'incident'].filter(kind => kinds.has(kind))) {
        const p = offset(first.at, -u * 0.75, first.halfAperture + u * (0.78 + station * 0.36));
        kit.line([offset(p, -u * 0.28), offset(p, -u * 0.1)], rayColors[kind], { key: `swatch:${kind}` });
        kit.label(names[kind], p, { color: c.ink, priority: 0, size: 10, key: `label:${kind}` });
        station += 1;
      }
    });
  }
  if (kit.visible('image')) for (const im of view.opticalImages ?? []) {
    if (!isPoint(im.at) || !finite(im.height) || (im.nature !== 'real' && im.nature !== 'virtual')) continue;
    entityScope(kit, 'optical-image', im, () => {
      const top = offset(im.at, 0, im.height), virtual = im.nature === 'virtual';
      imageArrow(kit, im.at, top, virtual, 'image', im.id);
      kit.label(`${im.label ?? '像'} · ${virtual ? '虚像' : '实像'}`, offset(top, u * 0.18, (im.height < 0 ? -1 : 1) * u * 0.29), { color: c.ink, priority: 2, key: 'label', tag: `${im.id}-label` });
    });
  }
  if (kit.visible('guides')) for (const m of view.opticalAxisMarks ?? []) if (isPoint(m.at)) entityScope(kit, 'axis-mark', m, () => {
    kit.line([offset(m.at, 0, -u * 0.06), offset(m.at, 0, u * 0.06)], c.muted, { key: 'tick', tag: m.id });
    kit.label(m.label, offset(m.at, 0, -u * 0.25), { color: c.muted, key: 'label' });
  });
}

function pinhole(r, kit) {
  if (![r.at, r.objectAt, r.screenAt].every(isPoint) || !positive(r.cardHalfHeight) || !positive(r.screenHalfHeight) || !finite(r.objectHalfHeight)) return;
  entityScope(kit, 'pinhole', r, () => {
    const u = Math.min(kit.unit, r.cardHalfHeight), floor = r.at.y - Math.max(r.cardHalfHeight, r.screenHalfHeight) - u * 0.52;
    opticalRail(kit, Math.min(r.objectAt.x, r.screenAt.x) - u * 0.52, Math.max(r.objectAt.x, r.screenAt.x) + u * 0.52, floor, undefined, 'bench');
    const holeRadius = Math.min(u * 0.075, r.cardHalfHeight * 0.035);
    const card = retainingRing(kit, r.at, holeRadius, r.cardHalfHeight, u * 0.075, 'card', 'x', '#35483c');
    if (card) card.userData.apparatus = { factory: 'pinhole-card', origin: offset(r.at), anchors: { hole: offset(r.at) }, unit: 'scene' };
    retainingRing(kit, r.at, r.cardHalfHeight, r.cardHalfHeight + u * 0.1, u * 0.13, 'card-rim', 'x', '#536d52');
    retainingRing(kit, offset(r.at, -u * 0.04), holeRadius, holeRadius + u * 0.018, u * 0.009, 'hole-bezel', 'x', c.brass);
    opticalStand(kit, r.at, r.at.y - r.cardHalfHeight - u * 0.1, floor, 'card-stand', u);
    opticalScreen({ id: `${r.id}-screen`, at: r.screenAt, halfHeight: r.screenHalfHeight, lit: true, label: '光屏' }, floor, kit);
    luminousObject({ id: `${r.id}-object`, at: offset(r.objectAt, 0, -r.objectHalfHeight), height: r.objectHalfHeight * 2 }, floor, kit);
    if (kit.visible('lightRays')) for (const p of r.rays ?? []) entityScope(kit, 'pinhole-ray', p, () => ray(kit, p.points, rayColors.parallel, 'path', p.id));
    // imageFrom is the image tip and imageTo its foot (signed orientation).
    if (kit.visible('image')) imageArrow(kit, r.imageTo, r.imageFrom, false, 'image', `${r.id}-image`);
    kit.label('小孔', offset(r.at, 0, r.cardHalfHeight + u * 0.27), { key: 'label', tag: r.id });
  });
}

function refraction(r, view, kit) {
  if (![r.at, r.boundaryFrom, r.boundaryTo, r.normalFrom, r.normalTo, r.incidentFrom, r.reflectedTo].every(isPoint)) return;
  entityScope(kit, 'refraction', r, () => {
    const u = kit.unit, nx = r.normalTo.x - r.normalFrom.x, ny = r.normalTo.y - r.normalFrom.y, length = Math.hypot(nx, ny);
    if (length > 0 && positive(view.extent?.width) && positive(view.extent?.height)) {
      const depth = Math.min(view.extent.width, view.extent.height) * 0.43;
      for (const [medium, side] of [['incident', -1], ['transmitted', 1]]) {
        const dx = nx / length * depth * side, dy = ny / length * depth * side;
        kit.polygon([r.boundaryFrom, r.boundaryTo, offset(r.boundaryTo, dx, dy), offset(r.boundaryFrom, dx, dy)], u * 0.2, side > 0 ? '#c4dacf' : '#d7dfcc', { ...finishes.glass, opacity: side > 0 ? 0.14 : 0.085, key: `medium:${medium}`, tag: `${r.id}-medium-${medium}` });
      }
    }
    kit.line([r.boundaryFrom, r.boundaryTo], c.alloy, { key: 'boundary', tag: `${r.id}-boundary` });
    if (kit.visible('guides')) kit.line([r.normalFrom, r.normalTo], c.muted, { dashed: true, key: 'normal', tag: `${r.id}-normal` });
    if (kit.visible('lightRays')) {
      ray(kit, [r.incidentFrom, r.at], rayColors.central, 'incident', `${r.id}-incident`);
      ray(kit, [r.at, r.reflectedTo], rayColors.parallel, 'reflected', `${r.id}-reflected`);
      if (r.total !== true && isPoint(r.refractedTo)) ray(kit, [r.at, r.refractedTo], rayColors.focal, 'refracted', `${r.id}-refracted`);
      if (isPoint(r.criticalTo)) ray(kit, [r.at, r.criticalTo], c.muted, 'critical', `${r.id}-critical`, true);
      kit.label(r.incidentText, offset(r.incidentFrom, u * 0.18, u * 0.28), { color: c.ink, key: 'incident-angle' });
      if (r.total === true) kit.label('全反射', offset(r.at, u * 0.72, -u * 0.55), { key: 'total-reflection' });
      kit.label('入射 / 反射 / 折射 · 线型与真实路径', offset(r.boundaryFrom, u * 1.3, u * 0.85), { color: c.muted, priority: 0, key: 'ray-caption' });
    }
    kit.sphere(r.at, u * 0.038, c.ink, { key: 'incidence', tag: `${r.id}-incidence` });
    kit.label(r.indicesText, offset(r.boundaryFrom, u * 1.3, u * 0.45), { key: 'indices', tag: `${r.id}-indices` });
  });
}

export function drawOptics(snapshot, kit) {
  const view = snapshot?.view;
  if (!view || !positive(kit.unit)) return;
  scope(kit, 'optics', () => {
    if (view.lightRefraction) refraction(view.lightRefraction, view, kit);
    else if (view.lightRig) pinhole(view.lightRig, kit);
    else opticalBench(view, kit);
  });
}
