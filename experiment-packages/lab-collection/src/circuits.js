// All eight circuits use the same terminal contract: local a=-0.75, b=+0.75.
// XY and authored wire bends are schematic facts; depth is hardware only.
import { finite, positive, isPoint, offset, scope, entityScope, pathSpan } from './apparatus-geometry.js';
import { apparatusColors as c, finishes, apparatusFrame, instrumentCase, fastener, bindingTerminal, digitalMeter } from './apparatus.js';

export const CIRCUIT_TERMINAL_HALF = 0.75;
const hasText = text => text !== undefined && text !== null && text !== '';

function annotation(object) {
  object?.traverse(child => {
    child.renderOrder = 12;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) if (material) { material.depthTest = false; material.depthWrite = false; }
  });
  return object;
}

function wire(kit, points, radius, color, key, tag) {
  if (!Array.isArray(points) || points.length < 2 || !points.every(isPoint)) return;
  // No Catmull smoothing, no inferred junctions, no current-dependent motion.
  return kit.tube(points, radius, color, { ...finishes.rubber, curve: 'polyline', key, tag });
}

function moduleBase(f, kit, id, width = 1.25, height = 0.74, z = -0.17, depth = 0.16) {
  f.box('base', [0, 0, z], width, height, depth, '#e3dfca', { ...finishes.ceramic, tag: `${id}:base` });
  for (const x of [-0.42, 0.42]) for (const y of [-0.33, 0.33]) {
    fastener(kit, f.at(x * width, y * height, z + depth / 2 + 0.008), 0.025, `base-screw:${x}:${y}`, f.rotation);
  }
}

function source(component, f, kit) {
  moduleBase(f, kit, component.id, 1.3, 0.86, -0.19, 0.19);
  f.box('holder-liner', [0, 0, -0.079], 1.12, 0.65, 0.026, '#435d4c', finishes.rubber);
  f.rod('cell', [-0.49, 0, 0.05], [0.4, 0, 0.05], 0.234, '#537d62', finishes.enamel);
  f.rod('positive-cap', [0.4, 0, 0.05], [0.53, 0, 0.05], 0.234, c.brass, finishes.brass);
  f.rod('negative-cap', [-0.54, 0, 0.05], [-0.49, 0, 0.05], 0.224, c.alloy, finishes.aluminum);
  for (const x of [-0.45, 0.35]) f.rod(`crimp:${x}`, [x - 0.016, 0, 0.05], [x + 0.016, 0, 0.05], 0.24, c.alloy, finishes.aluminum);
  for (const x of [-0.28, 0.16]) for (const y of [-0.23, 0.23]) f.box(`clip:${x}:${y}`, [x, y, 0.035], 0.047, 0.1, 0.17, '#4b6451', finishes.rubber);
  f.box('cell-label', [-0.04, 0, 0.287], 0.43, 0.16, 0.011, c.ceramic, finishes.ceramic);
  f.rod('lead:a', [-CIRCUIT_TERMINAL_HALF, 0, 0], [-0.54, 0, 0.05], 0.034, c.alloy, finishes.aluminum);
  f.rod('lead:b', [0.53, 0, 0.05], [CIRCUIT_TERMINAL_HALF, 0, 0], 0.034, c.alloy, finishes.aluminum);
  f.label('negative', '−', [-0.48, 0.31, 0.13], { size: 12, priority: 4, tag: `${component.id}:negative` });
  f.label('positive', '+', [0.48, 0.31, 0.13], { size: 12, priority: 4, tag: `${component.id}:positive` });
  // One cartridge is apparatus styling, never a cell count inferred from volts.
}

function knifeSwitch(component, f, kit) {
  moduleBase(f, kit, component.id, 1.29, 0.71, -0.16, 0.19);
  f.box('trim', [0, 0, -0.245], 1.18, 0.61, 0.042, '#5b634d', finishes.rubber);
  for (const [side, x] of [['a', -0.48], ['b', 0.48]]) {
    f.rod(`lead:${side}`, [Math.sign(x) * CIRCUIT_TERMINAL_HALF, 0, 0], [x, 0, 0], 0.033, c.alloy, finishes.aluminum);
    f.box(`contact-seat:${side}`, [x, 0, 0.015], 0.13, 0.26, 0.1, c.brass, finishes.brass);
    f.sphere(`contact:${side}`, [x, 0, 0.08], 0.073, c.alloy, finishes.aluminum);
  }
  for (const y of [-0.075, 0.075]) f.box(`fork:${y}`, [0.48, y, 0.105], 0.16, 0.023, 0.15, c.brass, finishes.brass);
  const closed = component.closed === true, end = closed ? [0.48, 0, 0.085] : [0.31, 0.48, 0.15];
  // Stable lever identity survives an open/closed state change.
  f.rod('lever', [-0.48, 0, 0.085], end, 0.048, '#b39154', { ...finishes.brass, tag: `${component.id}:${closed ? 'closed' : 'open'}-lever` });
  f.rod('handle', [-0.48 + (end[0] + 0.48) * 0.56, end[1] * 0.56, end[2]], end, 0.079, c.rubber, finishes.rubber);
  fastener(kit, f.at(-0.48, 0, 0.135), 0.038, 'pivot-screw', f.rotation);
  f.label('state', closed ? '闭合' : '断开', [0, -0.43, 0.04], { size: 10, tag: `${component.id}:state` });
}

function meter(component, f, kit) {
  const current = component.kind === 'ammeter', observable = current ? 'current' : 'voltage';
  f.rod('lead:a', [-CIRCUIT_TERMINAL_HALF, 0, 0], [-0.59, 0, 0], 0.034, c.alloy, finishes.aluminum);
  f.rod('lead:b', [0.59, 0, 0], [CIRCUIT_TERMINAL_HALF, 0, 0], 0.034, c.alloy, finishes.aluminum);
  digitalMeter(kit, component.at, { key: 'meter', rotation: f.rotation, tag: component.id, unit: current ? 'A' : 'V', reading: component.reading, showReading: kit.visible(observable) });
}

function resistor(component, f, kit, lamp) {
  moduleBase(f, kit, component.id);
  if (lamp) {
    f.rod('lead:a', [-CIRCUIT_TERMINAL_HALF, 0, 0], [-0.3, 0, 0], 0.034, c.alloy, finishes.aluminum);
    f.rod('lead:b', [0.3, 0, 0], [CIRCUIT_TERMINAL_HALF, 0, 0], 0.034, c.alloy, finishes.aluminum);
    f.rod('socket', [0, 0, -0.03], [0, 0, 0.14], 0.3, c.alloy, finishes.aluminum);
    for (const z of [0.025, 0.06, 0.095, 0.13]) kit.torus(f.at(0, 0, z), 0.301, 0.008, '#718677', { ...finishes.brushed, axis: 'z', key: `socket-thread:${z}` });
    const glow = kit.visible('power') && finite(component.glow) ? Math.min(1, Math.max(0, component.glow)) : 0;
    f.sphere('bulb', [0, 0, 0.34], 0.36, glow > 0 ? '#f5d9a8' : '#c5dbcf', { ...finishes.glass, opacity: 0.27 + glow * 0.16, emissive: '#bd8a3c', emissiveIntensity: glow * 0.6, tag: `${component.id}:bulb` });
    wire(kit, [[-0.12, -0.12, 0.18], [-0.12, 0.03, 0.37], [-0.06, 0.09, 0.4], [0, -0.02, 0.4], [0.06, 0.09, 0.4], [0.12, 0.03, 0.37], [0.12, -0.12, 0.18]].map(p => f.at(...p)), 0.013, glow > 0 ? '#bb9755' : c.rubber, 'filament', `${component.id}:filament`);
  } else {
    f.rod('lead:a', [-CIRCUIT_TERMINAL_HALF, 0, 0], [-0.47, 0, 0], 0.034, c.alloy, finishes.aluminum);
    f.rod('lead:b', [0.47, 0, 0], [CIRCUIT_TERMINAL_HALF, 0, 0], 0.034, c.alloy, finishes.aluminum);
    f.rod('ceramic-body', [-0.43, 0, 0.07], [0.43, 0, 0.07], 0.183, '#ddd7ba', finishes.ceramic);
    for (const x of [-0.43, 0.43]) f.rod(`cap:${x}`, [x - 0.038, 0, 0.07], [x + 0.038, 0, 0.07], 0.188, c.alloy, finishes.aluminum);
    const winding = Array.from({ length: 121 }, (_, station) => {
      const t = station / 120;
      return f.at(-0.34 + 0.68 * t, Math.sin(t * Math.PI * 20) * 0.189, 0.07 + Math.cos(t * Math.PI * 20) * 0.189);
    });
    kit.tube(winding, 0.012, '#a68b57', { ...finishes.brass, curve: 'polyline', key: 'resistance-wire', tag: `${component.id}:resistance-wire` });
    for (const x of [-0.45, 0.45]) f.box(`support:${x}`, [x, 0, -0.025], 0.095, 0.36, 0.16, '#586f55', finishes.enamel);
  }
}

function rheostat(component, f, kit) {
  moduleBase(f, kit, component.id, 1.3, 0.87, -0.23, 0.15);
  f.rod('ceramic-former', [-0.51, 0, 0.01], [0.51, 0, 0.01], 0.183, '#e1ddce', finishes.ceramic);
  const points = Array.from({ length: 169 }, (_, station) => {
    const t = station / 168;
    return f.at(-0.5 + t, Math.sin(t * Math.PI * 28) * 0.193, 0.01 + Math.cos(t * Math.PI * 28) * 0.193);
  });
  kit.tube(points, 0.014, '#ae8950', { ...finishes.brass, curve: 'polyline', key: 'winding', tag: `${component.id}:winding` });
  for (const x of [-0.57, 0.57]) f.box(`support:${x}`, [x, 0.1, -0.035], 0.095, 0.65, 0.21, '#627b5e', finishes.enamel);
  f.rod('slider-rail', [-0.58, 0.34, 0.21], [0.58, 0.34, 0.21], 0.033, c.alloy, finishes.aluminum);
  f.rod('lead:a', [-CIRCUIT_TERMINAL_HALF, 0, 0], [-0.5, 0, 0], 0.034, c.alloy, finishes.aluminum);
  wire(kit, [f.at(CIRCUIT_TERMINAL_HALF), f.at(0.66), f.at(0.66, 0.34, 0.21), f.at(0.58, 0.34, 0.21)], 0.031, c.alloy, 'slider-lead', `${component.id}:slider-terminal`);
  if (finite(component.sliderPosition) && component.sliderPosition >= 0 && component.sliderPosition <= 1) {
    const x = -0.5 + component.sliderPosition;
    f.rod('slider-contact', [x, 0.34, 0.21], [x, 0.13, 0.2], 0.04, c.alloy, finishes.aluminum);
    f.box('slider', [x, 0.34, 0.29], 0.19, 0.2, 0.14, c.rubber, { ...finishes.rubber, tag: `${component.id}:slider` });
    for (const y of [-0.055, 0, 0.055]) f.box(`slider-grip:${y}`, [x, 0.34 + y, 0.366], 0.14, 0.012, 0.008, '#84947e', finishes.rubber);
  }
}

function board(view, kit) {
  const anchors = [...(view.circuitComponents ?? []).map(item => item.at), ...(view.circuitWires ?? []).flatMap(item => item.points ?? [])].filter(isPoint);
  if (!anchors.length) return;
  scope(kit, 'circuit-bench', () => {
    const left = Math.min(...anchors.map(p => p.x)) - 1.05, right = Math.max(...anchors.map(p => p.x)) + 1.05;
    const bottom = Math.min(...anchors.map(p => p.y)) - 1.05, top = Math.max(...anchors.map(p => p.y)) + 1.05;
    const z = Math.min(...anchors.map(p => p.z ?? 0)) - 0.43, center = { x: (left + right) / 2, y: (top + bottom) / 2, z };
    instrumentCase(kit, center, right - left, top - bottom, 0.22, '#819678', { key: 'frame', tag: 'circuit-bench-frame' });
    instrumentCase(kit, offset(center, 0, 0, 0.126), right - left - 0.12, top - bottom - 0.12, 0.029, '#ede5d4', { ...finishes.wood, key: 'surface', tag: 'circuit-bench-surface' });
    for (const [side, x] of [['left', left + 0.21], ['right', right - 0.21]]) for (const [edge, y] of [['bottom', bottom + 0.21], ['top', top - 0.21]]) {
      fastener(kit, { x, y, z: z + 0.15 }, 0.047, `fastener:${side}:${edge}`, 45);
      kit.cylinder({ x, y, z: z - 0.21 }, { x, y, z: z - 0.11 }, 0.12, c.rubber, { ...finishes.rubber, key: `foot:${side}:${edge}` });
    }
  });
}

export function drawCircuits(snapshot, kit) {
  const view = snapshot?.view;
  if (!view || !positive(kit.unit)) return;
  scope(kit, 'circuits', () => {
    board(view, kit);
    for (const item of view.circuitWires ?? []) entityScope(kit, 'wire', item, () => wire(kit, item.points ?? [], Math.min(0.041, kit.unit * 0.03), '#4e7359', 'conductor', item.id));
    for (const junction of view.circuitJunctions ?? []) if (isPoint(junction.at)) entityScope(kit, 'junction', junction, () => kit.sphere(junction.at, junction.branch ? 0.083 : 0.064, c.rubber, { ...finishes.rubber, key: 'contact', tag: junction.id }));
    for (const component of view.circuitComponents ?? []) {
      if (!isPoint(component.at)) continue;
      entityScope(kit, 'component', component, () => {
        const f = apparatusFrame(kit, component.at, finite(component.rotation) ? component.rotation : 0, component.rotationUnit ?? 'deg');
        if (!f) return;
        const kind = component.kind;
        if (kind === 'voltage_source') source(component, f, kit);
        else if (kind === 'switch') knifeSwitch(component, f, kit);
        else if (kind === 'ammeter' || kind === 'voltmeter') meter(component, f, kit);
        else if (kind === 'variable_resistor') rheostat(component, f, kit);
        else if (kind === 'resistor') resistor(component, f, kit, snapshot.experimentId === 'bulb-power' && component.id === 'r0');
        else return;
        bindingTerminal(kit, f.at(-CIRCUIT_TERMINAL_HALF), 0.075, kind === 'voltage_source' ? '#5a7e97' : '#70876e', 'terminal:a');
        bindingTerminal(kit, f.at(CIRCUIT_TERMINAL_HALF), 0.075, kind === 'voltage_source' ? '#b87862' : '#70876e', 'terminal:b');
        const name = [component.label, component.value].filter(hasText).join(' · ');
        if (name && kind !== 'ammeter' && kind !== 'voltmeter') f.label('nameplate', name, [0, 0.87, 0.1], { size: 11, priority: 3, tag: `${component.id}:nameplate` });
        const readings = [kit.visible('current') && kind !== 'ammeter' ? component.currentText : undefined, kit.visible('voltage') ? component.voltageText : undefined, kit.visible('power') ? component.powerText : undefined].filter(hasText);
        if (readings.length) f.label('readout', readings.join(' · '), [0, -0.82, 0.1], { color: c.muted, size: 10, tag: `${component.id}:readout` });
        if (kit.visible('current') && (component.currentDirection === 'forward' || component.currentDirection === 'reverse') && !(kind === 'switch' && component.closed !== true)) {
          const a = f.at(-0.3, -0.51, 0.1), b = f.at(0.3, -0.51, 0.1);
          annotation(kit.arrow(component.currentDirection === 'reverse' ? b : a, component.currentDirection === 'reverse' ? a : b, '#b28a44', { key: 'current-direction', tag: `${component.id}:current-direction` }));
        }
      });
    }
    if (kit.visible('current')) for (const flow of view.chargeFlows ?? []) {
      if (!finite(flow.current) || flow.current === 0) continue;
      entityScope(kit, 'current-flow', flow, () => {
        const path = flow.current > 0 ? flow.path : flow.path?.slice().reverse(), marker = pathSpan(path, 0.5, Math.min(0.48, kit.unit * 0.4));
        if (marker) annotation(kit.arrow(marker.from, marker.to, '#b28a44', { key: 'direction', tag: `${flow.id}:direction` }));
      });
    }
  });
}
