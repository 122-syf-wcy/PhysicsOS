// Four fluid, four thermal and photoelectric experiments. Levels, fractions,
// contact widths, normalized needles and particles remain native snapshot facts.
import { finite, positive, isPoint, offset, scope, entityScope, semanticNumber } from './apparatus-geometry.js';
import { apparatusColors as c, finishes, apparatusFrame, bindingTerminal, container, liquidVolume, dialMeter, digitalMeter, thermometerTube, hotplate } from './apparatus.js';

function liquidTank(tank, kit, comparison = false) {
  if (!tank || ![tank.left, tank.right, tank.floor, tank.surface].every(finite) || tank.right <= tank.left) return;
  entityScope(kit, 'liquid-tank', tank, () => {
    const u = kit.unit, depth = Math.min((tank.right - tank.left) * 0.45, u * 2.3), rim = finite(tank.rim) && tank.rim >= 0 ? tank.rim : u * 0.75;
    const bounds = { left: tank.left, right: tank.right, floor: tank.floor, top: tank.surface + rim, depth };
    container(kit, bounds, { key: 'vessel', tag: tank.id });
    liquidVolume(kit, bounds, tank.surface, { key: 'fill', color: comparison ? '#b7c69f' : c.liquid, surfaceColor: comparison ? '#6c8a68' : '#648c9e', tag: `${tank.id}-liquid`, surfaceTag: `${tank.id}-surface` });
    kit.label(tank.densityText ?? tank.label, { x: (tank.left + tank.right) / 2, y: tank.surface + rim + u * 0.27, z: 0 }, { color: c.muted, key: 'label', tag: `${tank.id}-label` });
  });
}

function buoyancy(view, kit) {
  const u = kit.unit;
  liquidTank(view.fluidLiquid, kit);
  const block = view.fluidBlock, scale = view.fluidScale;
  if (isPoint(block?.at) && positive(block.halfWidth) && positive(block.halfHeight)) entityScope(kit, 'buoyancy-block', block, () => {
    const depth = block.halfWidth * 1.5, f = apparatusFrame(kit, block.at), bottom = block.at.y - block.halfHeight;
    const body = f.box('body', [0, 0, 0], block.halfWidth * 2, block.halfHeight * 2, depth, block.phase === 'floating' ? c.wood : c.alloy, { ...(block.phase === 'floating' ? finishes.wood : finishes.brushed), tag: block.id, rounded: false });
    if (body) body.userData.apparatus = { factory: 'buoyancy-block', origin: offset(block.at), anchors: { centerOfMass: offset(block.at), suspension: offset(block.at, 0, block.halfHeight), submergedTop: block.submergedTop }, unit: 'scene' };
    if (kit.visible('displaced') && finite(block.submergedTop) && block.submergedTop > bottom) {
      const height = block.submergedTop - bottom;
      kit.box({ x: block.at.x, y: bottom + height / 2, z: (block.at.z ?? 0) + depth / 2 + u * 0.01 }, block.halfWidth * 2, height, u * 0.018, '#7199aa', { ...finishes.liquid, opacity: 0.43, key: 'displaced-volume', tag: `${block.id}-displaced`, rounded: false });
      kit.line([{ x: block.at.x - block.halfWidth, y: block.submergedTop, z: (block.at.z ?? 0) + depth / 2 + u * 0.024 }, { x: block.at.x + block.halfWidth, y: block.submergedTop, z: (block.at.z ?? 0) + depth / 2 + u * 0.024 }], '#628d9f', { key: 'submerged-level', tag: `${block.id}-submerged-level` });
    }
    f.label('label', block.label, [-block.halfWidth - u * 0.37, 0, 0]);
    if (isPoint(scale?.at)) {
      const top = offset(block.at, 0, block.halfHeight), hookCenter = offset(top, 0, u * 0.057), hookContact = offset(hookCenter, 0, u * 0.067);
      kit.cylinder(scale.at, hookContact, u * 0.013, c.rubber, { ...finishes.rubber, key: 'suspension', tag: `${scale.id}-suspension` });
      kit.torus(hookCenter, u * 0.057, u * 0.01, c.alloy, { ...finishes.aluminum, axis: 'z', key: 'hook' });
    }
  });
  if (isPoint(scale?.at)) entityScope(kit, 'buoyancy-scale', scale, () => {
    const center = offset(scale.at, 0, u * 0.46);
    dialMeter(kit, center, u * 0.42, scale.dialFraction, { key: 'dial', tag: scale.id });
    kit.cylinder(scale.at, offset(center, 0, -u * 0.37), u * 0.035, c.alloy, { ...finishes.aluminum, key: 'hook-pin' });
    kit.torus(offset(center, 0, u * 0.54), u * 0.1, u * 0.013, c.alloy, { ...finishes.aluminum, axis: 'z', key: 'mount' });
    kit.label(scale.reading, offset(center, u * 0.72), { color: c.ink, priority: 3, key: 'reading', tag: `${scale.id}-reading` });
  });
}

function solidPressure(solid, kit) {
  if (!isPoint(solid?.at) || !positive(solid.halfHeight) || !positive(solid.plateDepth)) return;
  entityScope(kit, 'pressure-solid', solid, () => {
    for (const face of solid.faces ?? []) {
      if (!isPoint(face.at) || !positive(face.halfWidth) || (!face.loaded && !kit.visible('pressureComparison'))) continue;
      entityScope(kit, 'contact-face', face, () => {
        const width = face.halfWidth * 2, center = face.loaded ? solid.at : offset(face.at, 0, solid.halfHeight), f = apparatusFrame(kit, face.at);
        const plate = f.box('plate', [0, -solid.plateDepth / 2, 0], width, solid.plateDepth, width, '#cad5bc', { ...finishes.ceramic, rounded: false, tag: `${face.id}-plate` });
        kit.box(center, width, solid.halfHeight * 2, width, face.loaded ? '#698461' : '#a5b493', { ...finishes.enamel, rounded: false, key: 'block', tag: `${solid.id}-${face.id}` });
        if (plate) plate.userData.apparatus = { factory: 'pressure-contact', origin: offset(face.at), anchors: { contactPlane: offset(face.at), sideLength: width }, unit: 'scene' };
        // Equal X and Z side lengths retain the square-root area ratio.
        for (const [edge, z] of [['back', -face.halfWidth], ['front', face.halfWidth]]) f.line(`contact-edge:${edge}`, [[-face.halfWidth, 0, z], [face.halfWidth, 0, z]], '#b48d4f', { opacity: 0.75 });
        if (kit.visible(face.loaded ? 'pressure' : 'pressureComparison')) kit.label(face.pressureText, offset(center, 0, 0, face.halfWidth + kit.unit * 0.08), { color: c.ink, priority: 3, key: 'reading', tag: `${face.id}-reading` });
      });
    }
  });
}

function liquidPressure(view, kit) {
  const u = kit.unit;
  liquidTank(view.pressureLiquid, kit);
  if (kit.visible('pressureComparison')) liquidTank(view.pressureComparisonLiquid, kit, true);
  for (const probe of view.pressureProbes ?? []) {
    if (!isPoint(probe.at) || (!probe.primary && !kit.visible('pressureComparison'))) continue;
    entityScope(kit, 'pressure-probe', probe, () => {
      const r = u * 0.145, f = apparatusFrame(kit, probe.at);
      f.rod('diaphragm-case', [0, 0, -r], [0, 0, r], r, c.alloy, { ...finishes.brushed, tag: probe.id });
      kit.torus(f.at(0, 0, r), r * 0.72, r * 0.05, '#5e796b', { ...finishes.rubber, axis: 'z', key: 'diaphragm-rim' });
      f.rod('diaphragm', [0, 0, r], [0, 0, r * 1.05], r * 0.62, '#7c9985', finishes.rubber);
      if (finite(probe.surface)) {
        const hoseX = probe.at.x - u * (probe.primary ? 0.4 : 0.65), gaugeAt = { x: hoseX, y: probe.surface + u * 0.6, z: probe.at.z ?? 0 };
        kit.tube([probe.at, { x: hoseX, y: probe.at.y, z: probe.at.z ?? 0 }, gaugeAt], u * 0.019, c.rubber, { ...finishes.rubber, curve: 'polyline', key: 'hose', tag: `${probe.id}-hose` });
        // Digital gauge: no inferred liquid-column height or invented needle.
        digitalMeter(kit, gaugeAt, { key: 'gauge', scale: u * 0.37, unit: 'Pa', reading: probe.readingText, showReading: kit.visible(probe.primary ? 'pressure' : 'pressureComparison'), tag: `${probe.id}-meter` });
      }
      if (kit.visible(probe.primary ? 'pressure' : 'pressureComparison')) f.label('reading', probe.readingText, [u * 0.69, 0, 0], { priority: 3, tag: `${probe.id}-reading` });
    });
  }
}

function barometer(b, kit) {
  if (!isPoint(b?.at) || ![b.surface, b.columnTop, b.tubeTop, b.dishDepth].every(finite) || !positive(b.dishHalfWidth) || !positive(b.halfWidth)) return;
  entityScope(kit, 'barometer', b, () => {
    const u = Math.min(kit.unit, b.dishHalfWidth), x = b.at.x, z = b.at.z ?? 0, floor = b.surface - b.dishDepth, depth = b.dishHalfWidth * 0.9;
    const dish = { left: x - b.dishHalfWidth, right: x + b.dishHalfWidth, floor, top: b.surface + u * 0.18, depth };
    container(kit, dish, { key: 'dish', tag: `${b.id}-dish` });
    liquidVolume(kit, dish, b.surface, { key: 'reservoir', color: '#9aac9f', material: { opacity: 0.76, metalness: 0.68, roughness: 0.3 }, tag: `${b.id}-mercury-pool`, surfaceTag: `${b.id}-reservoir-surface` });
    if (b.tubeTop > floor) {
      // A hollow glass bore and sealed cap, not an opaque cylinder claiming to
      // simulate mercury. The interior column top is the measured quantity.
      kit.lathe({ x, y: floor, z }, [[b.halfWidth, 0], [b.halfWidth * 1.12, 0], [b.halfWidth * 1.12, b.tubeTop - floor], [b.halfWidth, b.tubeTop - floor], [b.halfWidth, 0]], c.glass, { ...finishes.glass, opacity: 0.17, axis: 'y', key: 'glass', tag: `${b.id}-glass` });
      kit.sphere({ x, y: b.tubeTop, z }, b.halfWidth * 1.12, c.glass, { ...finishes.glass, opacity: 0.14, scale3D: { x: 1, y: 0.32, z: 1 }, key: 'sealed-cap' });
      const columnX = x + b.dishHalfWidth + u * 0.25;
      kit.cylinder({ x: columnX, y: floor - u * 0.2, z: -depth * 0.5 }, { x: columnX, y: b.tubeTop + u * 0.16, z: -depth * 0.5 }, u * 0.045, c.alloy, { ...finishes.aluminum, key: 'support-post' });
      for (const [clamp, y] of [['lower', b.surface + (b.tubeTop - b.surface) * 0.28], ['upper', b.surface + (b.tubeTop - b.surface) * 0.8]]) kit.cylinder({ x: columnX, y, z: -depth * 0.5 }, { x, y, z: -b.halfWidth * 1.2 }, u * 0.03, c.alloy, { ...finishes.aluminum, key: `clamp:${clamp}` });
    }
    if (b.columnTop > b.surface) kit.cylinder({ x, y: b.surface, z }, { x, y: b.columnTop, z }, b.halfWidth, '#8b9d96', { ...finishes.brushed, key: 'mercury-column', tag: `${b.id}-mercury-column` });
    kit.line([{ x: x - b.halfWidth, y: b.columnTop, z }, { x: x + b.halfWidth, y: b.columnTop, z }], c.ink, { key: 'column-top', tag: `${b.id}-column-top` });
    if (b.tubeTop > b.columnTop) kit.label('真空', { x, y: (b.columnTop + b.tubeTop) / 2, z }, { color: c.muted, key: 'vacuum' });
    if (kit.visible('pressure')) {
      kit.label(b.columnText, { x: x + u * 0.91, y: b.columnTop, z }, { priority: 3, key: 'column-reading' });
      kit.label(b.pressureText, { x, y: floor - u * 0.3, z }, { priority: 3, key: 'pressure-reading' });
    }
  });
}

function hemispheres(h, kit) {
  if (!isPoint(h?.at) || !positive(h.radius) || !kit.visible('pressureComparison')) return;
  entityScope(kit, 'hemispheres', h, () => {
    const u = Math.min(kit.unit, h.radius), T = kit.THREE;
    for (const [name, side] of [['left', -1], ['right', 1]]) scope(kit, name, () => {
      kit.customMesh(h.at, side < 0 ? '#b29a65' : '#bfa974', { ...finishes.brass, materialType: 'standard', key: 'shell', geometryKey: 'hemisphere:unit:32:16', geometry: () => new T.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), rotation3D: { x: 0, y: 0, z: side < 0 ? 90 : -90 }, scale3D: { x: h.radius, y: h.radius, z: h.radius }, tag: `${h.id}-${name}` });
      const handle = offset(h.at, side * (h.radius + u * 0.13));
      kit.cylinder(offset(h.at, side * h.radius), handle, u * 0.03, c.alloy, { ...finishes.aluminum, key: 'handle-pin' });
      kit.torus(offset(handle, side * u * 0.11), u * 0.12, u * 0.018, c.alloy, { ...finishes.aluminum, axis: 'z', key: 'handle' });
    });
    kit.circle(h.at, h.radius, '#627b60', { key: 'seal-ring', tag: `${h.id}-seal` });
    kit.label(h.label, offset(h.at, 0, h.radius + u * 0.34), { key: 'label' });
    kit.label(h.forceText, offset(h.at, 0, -h.radius - u * 0.34), { priority: 3, key: 'force' });
  });
}

function calibratedThermometer(t, kit) {
  if (!isPoint(t?.at) || ![t.columnTop, t.icePoint, t.steamPoint].every(finite) || !positive(t.halfWidth) || !positive(t.bulbRadius)) return;
  entityScope(kit, 'calibrated-thermometer', t, () => {
    const u = kit.unit, upper = Math.max(t.steamPoint, t.columnTop, t.at.y) + u * 0.7, lower = Math.min(t.at.y, t.columnTop), z = t.at.z ?? 0;
    kit.box({ x: t.at.x + t.halfWidth * 0.92, y: (upper + lower) / 2, z: z - t.halfWidth * 1.12 }, t.halfWidth * 4.2, upper - lower, t.halfWidth * 0.23, '#e5dfc9', { ...finishes.wood, key: 'scale-backing', tag: `${t.id}-scale-backing` });
    thermometerTube(kit, { key: 'tube', at: t.at, lower, upper, columnTop: t.columnTop, radius: t.halfWidth, bulbRadius: t.bulbRadius, showColumn: kit.visible('thermometer'), reading: t.temperatureText, tag: t.id });
    if (kit.visible('thermometer')) kit.label(t.columnText, { x: t.at.x - u * 1.18, y: t.columnTop - u * 0.36, z }, { color: c.muted, key: 'column-reading' });
    if (kit.visible('guides')) {
      for (let station = 0; station <= 20; station += 1) {
        const y = t.icePoint + (t.steamPoint - t.icePoint) * station / 20, length = t.halfWidth * (station % 5 === 0 ? 2.1 : 1.2);
        kit.line([{ x: t.at.x + t.halfWidth, y, z: z + t.halfWidth }, { x: t.at.x + t.halfWidth + length, y, z: z + t.halfWidth }], c.muted, { key: `degree-station:${station * 5}` });
      }
      kit.label('0 °C', { x: t.at.x + t.halfWidth * 4.2, y: t.icePoint, z }, { key: 'ice-point' });
      kit.label('100 °C', { x: t.at.x + t.halfWidth * 4.2, y: t.steamPoint, z }, { key: 'steam-point' });
      kit.label(t.scaleText, { x: t.at.x - u * 1.45, y: (t.icePoint + t.steamPoint) / 2 + u * 0.65, z }, { color: c.muted, key: 'sensitivity' });
    }
  });
}

function thermalSample(sample, kit, comparison) {
  if (!isPoint(sample?.at) || !positive(sample.halfWidth) || !positive(sample.halfHeight)) return;
  entityScope(kit, 'thermal-sample', sample, () => {
    const u = kit.unit, left = sample.at.x - sample.halfWidth, right = sample.at.x + sample.halfWidth, floor = sample.at.y - sample.halfHeight, top = sample.at.y + sample.halfHeight, depth = Math.min(sample.halfWidth, u * 2.05), z = (sample.at.z ?? 0) - depth * 0.15;
    const bounds = { left, right, floor, top: top + u * 0.25, depth, z };
    container(kit, bounds, { key: 'beaker', tag: sample.id });
    const showPhase = kit.visible('phase'), fraction = semanticNumber(sample.meltedFraction);
    if (!showPhase || fraction === undefined || fraction < 0 || fraction > 1) kit.box({ ...sample.at, z }, sample.halfWidth * 2, sample.halfHeight * 2, depth * 0.93, '#cdd5c4', { ...finishes.glass, opacity: 0.23, key: 'unclassified-sample', tag: `${sample.id}-sample`, rounded: false });
    else {
      const liquidHeight = sample.halfHeight * 2 * fraction, solidHeight = sample.halfHeight * 2 - liquidHeight;
      if (liquidHeight > 0) liquidVolume(kit, { ...bounds, floor }, floor + liquidHeight, { key: 'liquid-phase', color: comparison ? '#c5b677' : '#8fbdc0', material: { opacity: 0.36 }, tag: `${sample.id}-liquid-fraction`, surfaceTag: `${sample.id}-meniscus` });
      if (solidHeight > 0) {
        kit.box({ x: sample.at.x, y: top - solidHeight / 2, z }, sample.halfWidth * 2, solidHeight, depth * 0.93, '#b7d4ce', { ...finishes.ceramic, opacity: 0.66, depthWrite: false, key: 'solid-phase', tag: `${sample.id}-solid-fraction`, rounded: false });
        for (let station = 1; station <= 3; station += 1) kit.line([{ x: left + station * sample.halfWidth / 2, y: top, z: z + depth * 0.47 }, { x: left + (station - 0.3) * sample.halfWidth / 2, y: top - solidHeight, z: z + depth * 0.47 }], '#e4eddb', { opacity: 0.6, key: `crystal-seam:${station}` });
      }
      // No fabricated bubble positions, flow or timer. The phase label conveys
      // boiling honestly; a volume of bubbles would require engine particle data.
    }
    kit.label(sample.label, { x: sample.at.x, y: top + u * 0.57, z: sample.at.z ?? 0 }, { key: 'label' });
    if (showPhase) kit.label(({ solid: '固态', melting: '熔化中', liquid: '液态', boiling: '沸腾中' })[sample.phase], { x: sample.at.x, y: floor + u * 0.32, z: z + depth * 0.49 }, { color: c.ink, key: 'phase' });
  });
}

function thermalThermometer(t, kit) {
  if (!isPoint(t?.at) || !finite(t.columnHeight)) return;
  entityScope(kit, 'thermal-thermometer', t, () => {
    const u = kit.unit, top = Math.max(15, t.columnHeight + u * 0.3), low = Math.min(0, t.columnHeight);
    // 15 is the legacy bridge's fixed schematic instrument span, not a recovered
    // temperature range. No numbers are engraved without a calibration field.
    thermometerTube(kit, { key: 'tube', at: t.at, lower: t.at.y + low, upper: t.at.y + top, columnTop: t.at.y + t.columnHeight, radius: u * 0.09, bulbRadius: u * 0.15, showColumn: kit.visible('thermometer'), reading: t.reading, tag: t.id });
    for (let station = 0; station <= 10; station += 1) {
      const y = 15 * station / 10;
      kit.line([offset(t.at, u * 0.12, y), offset(t.at, u * (station % 5 === 0 ? 0.31 : 0.23), y)], c.muted, { key: `engraving:${station}` });
    }
  });
}

function photoelectric(snapshot, kit) {
  const view = snapshot.view, u = kit.unit, rig = view.photoelectricRig;
  const cathode = (view.particles ?? []).find(item => item.id === 'modern-cathode');
  const rigValid = rig && [rig.cathodeAt, rig.collectorAt, rig.sourceAt].every(isPoint) && positive(rig.halfHeight);
  if (!rigValid) {
    // Older frames publish a cathode but no electrode topology. Preserve that
    // fact rather than infer a collector from electron trajectories or a grid.
    if (isPoint(cathode?.at)) entityScope(kit, 'legacy-cathode', cathode, () => {
      kit.sphere(cathode.at, cathode.radius, '#b0a176', { ...finishes.brushed, key: 'cathode', tag: cathode.id });
      kit.label('光电装置连接需平台语义帧', offset(cathode.at, 0, u * 1.7), { color: c.muted, key: 'caption' });
    });
  } else entityScope(kit, 'photoelectric-rig', rig, () => {
    // Fixed published schematic anchors: neither electrode nor envelope moves
    // when emission stops. Apparatus is labelled schematic, not real-size data.
    const left = Math.min(rig.cathodeAt.x, rig.collectorAt.x) - u * 0.25, right = Math.max(rig.cathodeAt.x, rig.collectorAt.x) + u * 0.25, cy = rig.cathodeAt.y, h = rig.halfHeight;
    container(kit, { left, right, floor: cy - h, top: cy + h, depth: u * 1.1, z: (rig.cathodeAt.z ?? 0) - u * 0.12 }, { key: 'vacuum-envelope', tag: 'photoelectric-vacuum-tube' });
    const cathodeFace = kit.box(offset(rig.cathodeAt, -u * 0.05), u * 0.1, h * 2, u * 0.77, '#ae9d73', { ...finishes.brass, key: 'cathode', tag: cathode?.id ?? 'modern-cathode', rounded: false });
    if (cathodeFace) cathodeFace.userData.apparatus = { factory: 'photoelectric-cathode', origin: offset(rig.cathodeAt), anchors: { activeSurface: offset(rig.cathodeAt) }, unit: 'schematic' };
    kit.line([offset(rig.cathodeAt, 0, -h), offset(rig.cathodeAt, 0, h)], '#b39150', { key: 'active-surface', tag: 'photoelectric-active-surface' });
    kit.box(offset(rig.collectorAt, u * 0.04), u * 0.08, h * 2, u * 0.69, c.alloy, { ...finishes.aluminum, key: 'collector', tag: 'photoelectric-collector', rounded: false });
    const f = apparatusFrame(kit, rig.sourceAt);
    f.box('source-housing', [-u * 0.22, 0, 0], u * 0.43, h * 1.16, u * 0.8, '#698260', { ...finishes.enamel, tag: 'photoelectric-light-source' });
    f.box('source-aperture', [-u * 0.007, 0, 0], u * 0.014, h * 0.94, u * 0.58, '#c4cba7', finishes.ceramic);
    const wireY = cy - h - u * 0.7, meter = { x: rig.cathodeAt.x + (rig.collectorAt.x - rig.cathodeAt.x) * 0.72, y: wireY, z: rig.cathodeAt.z ?? 0 }, supply = { x: rig.cathodeAt.x + (rig.collectorAt.x - rig.cathodeAt.x) * 0.28, y: wireY, z: rig.cathodeAt.z ?? 0 };
    const a = { x: rig.cathodeAt.x, y: cy - h, z: rig.cathodeAt.z ?? 0 }, b = { x: rig.collectorAt.x, y: rig.collectorAt.y - h, z: rig.collectorAt.z ?? 0 };
    bindingTerminal(kit, a, u * 0.065, '#8b9578', 'cathode-terminal');
    bindingTerminal(kit, b, u * 0.065, '#8b9578', 'collector-terminal');
    // Distinct continuous connections terminate at meter/supply sockets. No
    // smoothed tube shortcuts through boxes or pretends a bypass connection.
    const meterHalf = u * 0.39, supplyHalf = u * 0.372;
    for (const [device, center, half] of [['meter', meter, meterHalf], ['supply', supply, supplyHalf]]) {
      bindingTerminal(kit, offset(center, -half), u * 0.05, '#769276', `${device}-terminal:a`);
      bindingTerminal(kit, offset(center, half), u * 0.05, '#769276', `${device}-terminal:b`);
    }
    kit.tube([a, { ...a, y: wireY }, offset(supply, -supplyHalf)], u * 0.018, c.rubber, { ...finishes.rubber, curve: 'polyline', key: 'wire:cathode-supply' });
    kit.tube([offset(supply, supplyHalf), offset(meter, -meterHalf)], u * 0.018, c.rubber, { ...finishes.rubber, curve: 'polyline', key: 'wire:supply-meter' });
    kit.tube([offset(meter, meterHalf), { ...b, y: wireY }, b], u * 0.018, c.rubber, { ...finishes.rubber, curve: 'polyline', key: 'wire:meter-collector' });
    digitalMeter(kit, meter, { key: 'photocurrent-meter', scale: u * 0.65, unit: 'A', reading: rig.photocurrentText, showReading: kit.visible('photocurrent'), tag: 'photoelectric-ammeter' });
    digitalMeter(kit, supply, { key: 'bias-supply', scale: u * 0.62, unit: 'V', reading: rig.stoppingPotentialText, showReading: kit.visible('stoppingPotential'), tag: 'photoelectric-bias-supply' });
    kit.label('光电效应装置示意 · 非尺寸测量', { x: (left + right) / 2, y: cy + h + u * 0.5, z: rig.cathodeAt.z ?? 0 }, { color: c.muted, size: 10, priority: 0, key: 'caption' });
  });
  if (kit.visible('photocurrent')) for (const particle of view.particles ?? []) if (particle.id !== 'modern-cathode' && isPoint(particle.at) && positive(particle.radius)) entityScope(kit, 'photoelectron', particle, () => {
    kit.sphere(particle.at, particle.radius, '#668ba2', { ...finishes.enamel, key: 'particle', tag: particle.id });
    kit.label(particle.symbol, offset(particle.at, 0, -particle.radius - u * 0.2), { key: 'label' });
  });
}

export function drawMatter(snapshot, kit) {
  const view = snapshot?.view;
  if (!view || !positive(kit.unit)) return;
  scope(kit, 'matter', () => {
    const domain = view.domain ?? snapshot.domain;
    if (domain === 'modern') { photoelectric(snapshot, kit); return; }
    if (domain === 'fluid') {
      if (view.pressureRig === 'solid') solidPressure(view.pressureSolid, kit);
      else if (view.pressureRig === 'liquid') liquidPressure(view, kit);
      else if (view.pressureRig === 'atmospheric') { barometer(view.pressureBarometer, kit); hemispheres(view.pressureHemispheres, kit); }
      else buoyancy(view, kit);
      return;
    }
    if (view.thermometer) calibratedThermometer(view.thermometer, kit);
    else {
      hotplate(view.thermalHeater, kit); hotplate(view.thermalComparisonHeater, kit);
      thermalSample(view.thermalSample, kit, false); thermalSample(view.thermalComparisonSample, kit, true);
      thermalThermometer(view.thermalThermometer, kit); thermalThermometer(view.thermalComparisonThermometer, kit);
    }
  });
}
