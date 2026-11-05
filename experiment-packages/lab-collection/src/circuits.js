/* Circuit apparatus in the platform's scene coordinates. The two terminal
 * anchors are ±0.75 along the local a→b axis, as in circuit-builder.ts.
 * Ratings, readings, switch state and direction are exclusively snapshot facts. */
const TERMINAL_HALF = 0.75;
const point = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

function currentAnnotation(object) {
  object?.traverse(child => {
    child.renderOrder = 12;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (material) { material.depthTest = false; material.depthWrite = false; }
    }
  });
  return object;
}

function finish(object, properties) {
  if (object?.material) Object.assign(object.material, properties);
  return object;
}

// Instrument cases have moulded corners and a small bevel rather than sharp
// toy-block edges. These dimensions are apparatus styling, not circuit facts.
function caseBody(kit, at, width, height, depth, color, tag, rotation = 0, radius = 0.08) {
  const T = kit.THREE, x = -width / 2, y = -height / 2;
  const r = Math.min(radius, width / 4, height / 4);
  const shape = new T.Shape();
  shape.moveTo(x + r, y); shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  const geometry = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: r * 0.16, bevelThickness: r * 0.16, bevelSegments: 2, curveSegments: 6 });
  geometry.translate(0, 0, -depth / 2);
  const material = new T.MeshPhysicalMaterial({ color, roughness: 0.42, metalness: 0.08, clearcoat: 0.22, clearcoatRoughness: 0.38 });
  const mesh = new T.Mesh(geometry, material);
  mesh.position.set(at.x, at.y, at.z || 0); mesh.rotation.z = rotation * Math.PI / 180;
  mesh.name = tag; mesh.castShadow = true; mesh.receiveShadow = true;
  kit.group.add(mesh);
  return mesh;
}

function screw(kit, at, radius = 0.039, tag = 'apparatus-screw', rotation = 0) {
  finish(kit.cylinder({ ...at, z: (at.z || 0) - radius * 0.3 }, { ...at, z: (at.z || 0) + radius * 0.22 }, radius, kit.palette.metal, { tag }), { metalness: 0.85, roughness: 0.25 });
  const c = Math.cos(rotation), s = Math.sin(rotation);
  kit.line([{ x: at.x - c * radius * 0.62, y: at.y - s * radius * 0.62, z: (at.z || 0) + radius * 0.25 },
    { x: at.x + c * radius * 0.62, y: at.y + s * radius * 0.62, z: (at.z || 0) + radius * 0.25 }], '#5b6461', { tag: `${tag}:slot` });
}

function localPoint(component, x, y = 0, z = 0) {
  const angle = (component.rotation || 0) * Math.PI / 180;
  return {
    x: component.at.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: component.at.y + x * Math.sin(angle) + y * Math.cos(angle),
    z: (component.at.z || 0) + z,
  };
}

function wirePath(kit, points, radius, color, tag) {
  // Separate straight cylinders keep every authored bend and junction exact;
  // a smoothed spline would cut corners and can change apparent connectivity.
  for (let index = 1; index < points.length; index += 1) {
    if (point(points[index - 1]) && point(points[index])) {
      kit.cylinder(points[index - 1], points[index], radius, color, { tag });
    }
  }
}

function componentFrame(component, kit) {
  const at = (x, y = 0, z = 0) => localPoint(component, x, y, z);
  const { palette: p } = kit;
  const cylinder = (a, b, radius, color, tag = component.id) => kit.cylinder(at(...a), at(...b), radius, color, { tag });
  const box = (xyz, width, height, depth, color, tag = component.id) => kit.box(at(...xyz), width, height, depth, color, { rotation: component.rotation, tag });
  const terminal = (x, color) => {
    kit.sphere(at(x), 0.066, color, { tag: `${component.id}:terminal:${x < 0 ? 'a' : 'b'}` });
    finish(cylinder([x, 0, -0.08], [x, 0, 0.025], 0.092, p.metal), { metalness: 0.8, roughness: 0.22 });
    cylinder([x, 0, -0.10], [x, 0, -0.067], 0.113, color === p.metal ? '#345b51' : color, `${component.id}:terminal-collar`);
    screw(kit, at(x, 0, 0.058), 0.046, `${component.id}:binding-screw`, Math.PI / 4);
  };
  const lead = (a, b) => cylinder(a, b, 0.036, p.metal);
  return { at, cylinder, box, terminal, lead };
}

function drawSource(component, kit, frame) {
  const { palette: p } = kit;
  const { at, box, cylinder, lead } = frame;
  caseBody(kit, at(0, 0, -0.19), 1.3, 0.86, 0.19, '#d8ddd3', `${component.id}:holder`, component.rotation);
  caseBody(kit, at(0, 0, -0.086), 1.13, 0.66, 0.025, '#334c45', `${component.id}:holder-liner`, component.rotation, 0.055);
  finish(cylinder([-0.49, 0, 0.05], [0.4, 0, 0.05], 0.235, '#397967'), { roughness: 0.3, metalness: 0.22 });
  finish(cylinder([0.4, 0, 0.05], [0.53, 0, 0.05], 0.235, '#c7a678'), { roughness: 0.25, metalness: 0.7 });
  cylinder([-0.54, 0, 0.05], [-0.49, 0, 0.05], 0.225, p.metal);
  // Crimped cell shoulders and two retaining clips read as a real battery
  // cartridge without inferring a cell count from its voltage rating.
  for (const x of [-0.45, 0.35]) finish(cylinder([x - 0.018, 0, 0.05], [x + 0.018, 0, 0.05], 0.244, p.metal), { metalness: 0.8, roughness: 0.2 });
  for (const x of [-0.28, 0.16]) {
    box([x, 0.23, 0.035], 0.05, 0.1, 0.18, '#334c45');
    box([x, -0.23, 0.035], 0.05, 0.1, 0.18, '#334c45');
  }
  box([-0.04, 0, 0.286], 0.44, 0.17, 0.01, '#e2e8d8');
  for (const x of [-0.15, -0.09, -0.03, 0.03, 0.09]) box([x, -0.01, 0.294], 0.015, 0.095, 0.008, '#537568');
  for (const x of [-0.53, 0.53]) for (const y of [-0.32, 0.32]) screw(kit, at(x, y, -0.078), 0.027, `${component.id}:mounting-screw`);
  lead([-TERMINAL_HALF, 0, 0], [-0.54, 0, 0.05]);
  lead([0.53, 0, 0.05], [TERMINAL_HALF, 0, 0]);
  // Polarity is fixed to the a→b axis, including when the source is rotated.
  kit.label('−', at(-0.48, 0.31, 0.13), { size: 12, color: p.blue, priority: 4, tag: `${component.id}:negative` });
  kit.label('+', at(0.48, 0.31, 0.13), { size: 12, color: p.red, priority: 4, tag: `${component.id}:positive` });
}

function drawSwitch(component, kit, frame) {
  const { palette: p } = kit;
  const { at, box, cylinder, lead } = frame;
  caseBody(kit, at(0, 0, -0.16), 1.29, 0.71, 0.19, '#d9d4be', `${component.id}:insulating-base`, component.rotation);
  caseBody(kit, at(0, 0, -0.245), 1.18, 0.61, 0.045, '#424d44', `${component.id}:base-trim`, component.rotation, 0.045);
  for (const x of [-0.51, 0.51]) for (const y of [-0.25, 0.25]) screw(kit, at(x, y, -0.047), 0.026, `${component.id}:mounting-screw`);
  lead([-TERMINAL_HALF, 0], [-0.48, 0]);
  lead([0.48, 0], [TERMINAL_HALF, 0]);
  for (const x of [-0.48, 0.48]) {
    box([x, 0, 0.015], 0.13, 0.26, 0.1, '#bd9d70');
    kit.sphere(at(x, 0, 0.08), 0.075, p.metal, { tag: `${component.id}:contact` });
  }
  for (const y of [-0.075, 0.075]) box([0.48, y, 0.105], 0.16, 0.024, 0.15, '#bd9d70', `${component.id}:contact-fork`);
  const closed = component.closed === true;
  const end = closed ? [0.48, 0, 0.085] : [0.31, 0.48, 0.15];
  cylinder([-0.48, 0, 0.085], end, 0.052, '#b68a4e', `${component.id}:${closed ? 'closed' : 'open'}-lever`);
  const startHandle = [-0.48 + (end[0] + 0.48) * 0.55, end[1] * 0.55, end[2]];
  finish(cylinder(startHandle, end, 0.085, p.ink, `${component.id}:handle`), { roughness: 0.32 });
  screw(kit, at(-0.48, 0, 0.135), 0.041, `${component.id}:pivot-screw`, Math.PI / 3);
  kit.label(closed ? '闭合' : '断开', at(0, -0.43, 0.04), { color: closed ? p.green : p.muted, size: 10, tag: `${component.id}:state` });
}

function drawMeter(component, kit, frame) {
  const { palette: p } = kit;
  const { at, cylinder, lead, box } = frame;
  const color = component.kind === 'ammeter' ? p.orange : p.blue;
  lead([-TERMINAL_HALF, 0], [-0.59, 0]);
  lead([0.59, 0], [TERMINAL_HALF, 0]);
  caseBody(kit, at(0, 0, 0.015), 1.18, 1.02, 0.4, '#35584e', `${component.id}:housing`, component.rotation, 0.11);
  caseBody(kit, at(0, 0, 0.226), 1.09, 0.92, 0.036, '#263c35', `${component.id}:gasket`, component.rotation, 0.09);
  caseBody(kit, at(0, 0, 0.25), 1.03, 0.85, 0.035, '#e9e7d9', `${component.id}:faceplate`, component.rotation, 0.072);
  for (const x of [-0.445, 0.445]) for (const y of [-0.35, 0.35]) screw(kit, at(x, y, 0.279), 0.026, `${component.id}:face-screw`, Math.PI / 4);
  // A digital face avoids inventing an analogue needle range not in snapshot.
  caseBody(kit, at(0, 0.065, 0.28), 0.84, 0.32, 0.026, '#6d7c67', `${component.id}:display-bezel`, component.rotation, 0.027);
  caseBody(kit, at(0, 0.065, 0.297), 0.77, 0.253, 0.014, '#dbe5ce', `${component.id}:display`, component.rotation, 0.018);
  kit.label(component.kind === 'ammeter' ? 'A' : 'V', at(0, 0.315, 0.308), { color, size: 11, priority: 4, tag: `${component.id}:unit` });
  finish(cylinder([0.265, -0.24, 0.277], [0.265, -0.24, 0.348], 0.105, '#34473e', `${component.id}:range-knob`), { roughness: 0.3 });
  for (let i = 0; i < 12; i += 1) {
    const a = Math.PI * 2 * i / 12;
    cylinder([0.265 + Math.cos(a) * 0.1, -0.24 + Math.sin(a) * 0.1, 0.298], [0.265 + Math.cos(a) * 0.1, -0.24 + Math.sin(a) * 0.1, 0.34], 0.01, '#202f2a', `${component.id}:knob-grip`);
  }
  box([0.265, -0.19, 0.351], 0.012, 0.054, 0.008, '#e7e6d6');
  finish(kit.sphere(at(-0.34, -0.235, 0.292), 0.028, '#6ba77c', { tag: `${component.id}:status-led` }), { emissive: new kit.THREE.Color('#294c30'), emissiveIntensity: 0.4, roughness: 0.2 });
  for (const x of [-0.24, -0.11, 0.02]) caseBody(kit, at(x, -0.245, 0.298), 0.079, 0.079, 0.026, '#a0aa92', `${component.id}:front-key`, component.rotation, 0.018);
  for (const x of [-0.44, 0.44]) box([x, -0.51, -0.08], 0.22, 0.055, 0.35, '#34443a', `${component.id}:rubber-foot`);
  const observable = component.kind === 'ammeter' ? 'current' : 'voltage';
  if (kit.visible(observable) && component.reading) {
    kit.label(component.reading, at(0, 0.065, 0.315), { color: '#304238', size: 11, priority: 5, tag: `${component.id}:reading` });
  }
}

function drawResistor(component, kit, frame, lamp) {
  const { palette: p } = kit;
  const { at, box, cylinder, lead } = frame;
  caseBody(kit, at(0, 0, -0.17), 1.25, 0.74, 0.16, '#e3ddc8', `${component.id}:base`, component.rotation);
  for (const x of [-0.53, 0.53]) for (const y of [-0.27, 0.27]) screw(kit, at(x, y, -0.073), 0.025, `${component.id}:mounting-screw`);
  if (lamp) {
    lead([-TERMINAL_HALF, 0], [-0.3, 0]);
    lead([0.3, 0], [TERMINAL_HALF, 0]);
    cylinder([0, 0, -0.03], [0, 0, 0.14], 0.3, p.metal);
    for (const z of [0.025, 0.06, 0.095, 0.13]) kit.circle(at(0, 0, z), 0.303, '#7a8074', { tag: `${component.id}:socket-thread` });
    const glow = kit.visible('power') && Number.isFinite(component.glow) ? Math.max(0, Math.min(1, component.glow)) : 0;
    const bulb = kit.sphere(at(0, 0, 0.34), 0.36, glow > 0 ? '#ffdea2' : '#c6dcda', { opacity: 0.4 + glow * 0.22, tag: `${component.id}:bulb` });
    if (bulb?.material?.emissive) {
      bulb.material.emissive.set('#df9a35');
      bulb.material.emissiveIntensity = glow * 0.8;
    }
    wirePath(kit, [at(-0.12, -0.12, 0.18), at(-0.12, 0.03, 0.37), at(-0.06, 0.09, 0.4), at(0, -0.02, 0.4), at(0.06, 0.09, 0.4), at(0.12, 0.03, 0.37), at(0.12, -0.12, 0.18)], 0.015, glow > 0 ? p.orange : p.ink, `${component.id}:filament`);
  } else {
    lead([-TERMINAL_HALF, 0], [-0.47, 0]);
    lead([0.47, 0], [TERMINAL_HALF, 0]);
    finish(cylinder([-0.43, 0, 0.07], [0.43, 0, 0.07], 0.185, '#e0d8bd'), { roughness: 0.37 });
    for (const x of [-0.43, 0.43]) cylinder([x - 0.04, 0, 0.07], [x + 0.04, 0, 0.07], 0.19, p.metal);
    const winding = Array.from({ length: 121 }, (_, i) => {
      const t = i / 120;
      return at(-0.34 + 0.68 * t, Math.sin(t * Math.PI * 20) * 0.19, 0.07 + Math.cos(t * Math.PI * 20) * 0.19);
    });
    finish(kit.tube(winding, 0.015, '#8c6e4e', { tag: `${component.id}:resistance-wire` }), { roughness: 0.25, metalness: 0.62 });
    for (const x of [-0.45, 0.45]) box([x, 0, -0.025], 0.1, 0.37, 0.17, '#425b4d', `${component.id}:ceramic-support`);
  }
}

function drawRheostat(component, kit, frame) {
  const { palette: p } = kit;
  const { at, box, cylinder, lead } = frame;
  caseBody(kit, at(0, 0, -0.23), 1.3, 0.87, 0.15, '#dcd9c5', `${component.id}:base`, component.rotation);
  for (const x of [-0.53, 0.53]) for (const y of [-0.32, 0.32]) screw(kit, at(x, y, -0.136), 0.027, `${component.id}:mounting-screw`);
  cylinder([-0.51, 0, 0.01], [0.51, 0, 0.01], 0.185, '#e5e0d2');
  const winding = Array.from({ length: 169 }, (_, i) => {
    const t = i / 168;
    return at(-0.5 + t, Math.sin(t * Math.PI * 28) * 0.194, 0.01 + Math.cos(t * Math.PI * 28) * 0.194);
  });
  finish(kit.tube(winding, 0.018, '#ad8051', { tag: `${component.id}:winding` }), { roughness: 0.24, metalness: 0.7 });
  for (const x of [-0.57, 0.57]) box([x, 0.1, -0.035], 0.1, 0.66, 0.22, p.green);
  cylinder([-0.58, 0.34, 0.21], [0.58, 0.34, 0.21], 0.035, p.metal, `${component.id}:slider-rail`);
  lead([-TERMINAL_HALF, 0], [-0.5, 0]);
  wirePath(kit, [at(TERMINAL_HALF, 0), at(0.66, 0), at(0.66, 0.34, 0.21), at(0.58, 0.34, 0.21)], 0.032, p.metal, `${component.id}:slider-terminal`);
  if (Number.isFinite(component.sliderPosition)) {
    const x = -0.5 + Math.max(0, Math.min(1, component.sliderPosition));
    cylinder([x, 0.34, 0.21], [x, 0.13, 0.2], 0.044, p.metal, `${component.id}:slider-contact`);
    caseBody(kit, at(x, 0.34, 0.29), 0.2, 0.21, 0.14, p.ink, `${component.id}:slider`, component.rotation, 0.04);
    for (const dy of [-0.06, 0, 0.06]) box([x, 0.34 + dy, 0.367], 0.14, 0.014, 0.009, '#75857a', `${component.id}:slider-grip`);
  }
}

function drawFlowDirections(flow, kit) {
  if (!Number.isFinite(flow.current) || flow.current === 0) return;
  const points = flow.path || [];
  let longest;
  let maxLength = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!point(a) || !point(b)) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > maxLength) { maxLength = length; longest = [a, b]; }
  }
  if (!longest || maxLength === 0) return;
  const [a, b] = flow.current > 0 ? longest : [...longest].reverse();
  const half = Math.min(0.3, kit.unit * 0.22, maxLength * 0.18) / maxLength;
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 };
  currentAnnotation(kit.arrow(
    { x: middle.x - (b.x - a.x) * half, y: middle.y - (b.y - a.y) * half, z: middle.z },
    { x: middle.x + (b.x - a.x) * half, y: middle.y + (b.y - a.y) * half, z: middle.z },
    kit.palette.orange,
    { tag: `${flow.id}:direction` },
  ));
}

export function drawCircuits(snapshot, kit) {
  const view = snapshot.view;
  if (!view) return;
  const { palette: p } = kit;
  const components = view.circuitComponents || [];
  const anchors = [...components.map(component => component.at), ...(view.circuitWires || []).flatMap(wire => wire.points || [])].filter(point);
  if (anchors.length) {
    const left = Math.min(...anchors.map(at => at.x)) - 1.07;
    const right = Math.max(...anchors.map(at => at.x)) + 1.07;
    const bottom = Math.min(...anchors.map(at => at.y)) - 1.07;
    const top = Math.max(...anchors.map(at => at.y)) + 1.07;
    const center = { x: (left + right) / 2, y: (top + bottom) / 2, z: -0.43 };
    caseBody(kit, center, right - left, top - bottom, 0.22, '#b7c4b7', 'circuit-bench-frame', 0, 0.24);
    caseBody(kit, { ...center, z: -0.304 }, right - left - 0.12, top - bottom - 0.12, 0.03, '#ece6d7', 'circuit-bench-surface', 0, 0.2);
    for (const x of [left + 0.22, right - 0.22]) for (const y of [bottom + 0.22, top - 0.22]) {
      screw(kit, { x, y, z: -0.279 }, 0.055, 'circuit-bench-fastener', Math.PI / 4);
      finish(kit.cylinder({ x, y, z: -0.65 }, { x, y, z: -0.55 }, 0.13, '#405449', { tag: 'circuit-bench-foot' }), { roughness: 0.85 });
    }
  }
  for (const wire of view.circuitWires || []) {
    wirePath(kit, wire.points || [], Math.min(0.043, kit.unit * 0.032), p.green, wire.id);
  }
  for (const junction of view.circuitJunctions || []) {
    if (point(junction.at)) kit.sphere(junction.at, junction.branch ? 0.088 : 0.07, p.ink, { tag: junction.id });
  }
  for (const component of components) {
    if (!point(component.at)) continue;
    const frame = componentFrame(component, kit);
    const kind = component.kind;
    if (kind === 'voltage_source') drawSource(component, kit, frame);
    else if (kind === 'switch') drawSwitch(component, kit, frame);
    else if (kind === 'ammeter' || kind === 'voltmeter') drawMeter(component, kit, frame);
    else if (kind === 'variable_resistor') drawRheostat(component, kit, frame);
    else if (kind === 'resistor') drawResistor(component, kit, frame, snapshot.experimentId === 'bulb-power' && component.id === 'r0');
    else continue;
    frame.terminal(-TERMINAL_HALF, kind === 'voltage_source' ? p.blue : p.metal);
    frame.terminal(TERMINAL_HALF, kind === 'voltage_source' ? p.red : p.metal);
    const name = [component.label, component.value].filter(Boolean).join(' · ');
    if (name && kind !== 'ammeter' && kind !== 'voltmeter') {
      kit.label(name, { ...component.at, y: component.at.y + 0.88, z: (component.at.z || 0) + 0.1 }, { color: p.ink, size: 11, priority: 3, tag: `${component.id}:nameplate` });
    }
    // These strings were formatted by the runtime; no display parses or solves
    // voltage, current, resistance, power or any analogue meter range.
    const readings = [
      kit.visible('current') && kind !== 'ammeter' && component.currentText,
      kit.visible('voltage') && component.voltageText,
      kit.visible('power') && component.powerText,
    ].filter(Boolean);
    if (readings.length) kit.label(readings.join(' · '), { ...component.at, y: component.at.y - 0.82, z: (component.at.z || 0) + 0.1 }, { color: p.muted, size: 10, priority: 1, tag: `${component.id}:readout` });
    if (kit.visible('current') && component.currentDirection && !(kind === 'switch' && component.closed !== true)) {
      const a = frame.at(-0.32, -0.51, 0.1);
      const b = frame.at(0.32, -0.51, 0.1);
      currentAnnotation(kit.arrow(component.currentDirection === 'reverse' ? b : a, component.currentDirection === 'reverse' ? a : b, p.orange, { tag: `${component.id}:current-direction` }));
    }
  }
  if (kit.visible('current')) for (const flow of view.chargeFlows || []) drawFlowDirections(flow, kit);
}
