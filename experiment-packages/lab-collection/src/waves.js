// Seven waves and two acoustic experiments. Native profiles/fronts are samples,
// not a license to run a local sine, clock, Doppler solver or fluid simulation.
import { finite, positive, isPoint, offset, scope, entityScope, derivedReadout, diffractionFacts, semanticNumber, longitudinalProfile } from './apparatus-geometry.js';
import { apparatusColors as c, finishes, apparatusFrame, gripKnob, opticalScreen, opticalStand, loudspeaker, microphone, digitalMeter } from './apparatus.js';
const validPath = points => Array.isArray(points) && points.length > 1 && points.every(isPoint);

function waveformDriver(kit, profile, endpoint, live, side, active) {
  scope(kit, `driver:${side}`, () => {
    const u = kit.unit, sign = side === 'right' ? 1 : -1, f = apparatusFrame(kit, endpoint);
    f.box('housing', [sign * u * 0.18, 0, -u * 0.12], u * 0.28, u * 0.73, u * 0.43, '#688064', { ...finishes.enamel, tag: `${profile.id}-clamp-${side}` });
    f.box('base', [sign * u * 0.18, -u * 0.44, -u * 0.12], u * 0.52, u * 0.12, u * 0.57, c.alloy, finishes.brushed);
    gripKnob(kit, f.at(sign * u * 0.18, 0, u * 0.16), u * 0.067, u * 0.07, 'clamp-lock');
    if (active && isPoint(live)) {
      const housingPin = f.at(sign * u * 0.18, 0, u * 0.14), sliderPin = offset(live, sign * u * 0.12, 0, u * 0.14);
      kit.cylinder(housingPin, sliderPin, u * 0.023, c.alloy, { ...finishes.aluminum, key: 'actuator', tag: `${profile.id}-actuator-${side}` });
      kit.cylinder(sliderPin, live, u * 0.027, c.alloy, { ...finishes.aluminum, key: 'attachment-pin' });
    } else kit.cylinder(f.at(sign * u * 0.14), endpoint, u * 0.032, c.alloy, { ...finishes.aluminum, key: 'fixed-pin' });
  });
}

function profileRig(snapshot, kit) {
  const view = snapshot.view, profile = view.waveProfile;
  if (!isPoint(profile?.equilibrium?.from) || !isPoint(profile.equilibrium.to)) return;
  entityScope(kit, 'wave-profile', profile, () => {
    const u = kit.unit, { from, to } = profile.equilibrium, longitudinal = longitudinalProfile(snapshot);
    const formation = (view.trajectories ?? []).filter(path => path.id === 'wave-formation-left' || path.id === 'wave-formation-right');
    if (kit.visible('guides')) kit.line([from, to], c.muted, { dashed: true, opacity: 0.55, key: 'equilibrium', tag: `${profile.id}-equilibrium` });
    if (longitudinal) {
      // ξ(x) is a displacement graph, NOT world positions of slinky particles.
      // A physical longitudinal spring would require semantic particle positions.
      const f = apparatusFrame(kit, from);
      f.box('driver-housing', [-u * 0.29, 0, -u * 0.12], u * 0.39, u * 0.73, u * 0.4, '#72876a', finishes.enamel);
      f.rod('driver-pin', [-u * 0.12, 0, 0], [0, 0, 0], u * 0.047, c.alloy, finishes.aluminum);
      if (kit.visible('waveform') && validPath(profile.points)) kit.line(profile.points, '#648aa1', { key: 'displacement-samples', tag: profile.id });
      kit.label('纵向位移 ξ(x) · 非质点世界轨迹', offset(from, (to.x - from.x) * 0.5, view.extent.height * 0.37), { color: c.ink, key: 'displacement-caption', tag: 'longitudinal-samples-label' });
      return;
    }
    waveformDriver(kit, profile, from, profile.points?.[0], 'left', profile.kind === 'rope' || formation.length > 0);
    if (profile.kind === 'string') waveformDriver(kit, profile, to, profile.points?.[profile.points.length - 1], 'right', formation.length > 0);
    if (kit.visible('waveform')) {
      for (const path of formation) entityScope(kit, 'formation-path', path, () => {
        if (validPath(path.points)) kit.line(path.points, path.id.endsWith('left') ? '#2a78d6' : '#eb6834', { opacity: 0.82, key: 'path', tag: path.id });
      });
      if (validPath(profile.points)) {
        // One retained polyline tube has stable profile identity and exact
        // samples. It cannot cut corners or swap parts when sample count changes.
        kit.tube(profile.points, u * 0.031, formation.length ? '#65885f' : '#648ba2', { ...finishes.rubber, curve: 'polyline', key: 'rope', tag: profile.id });
        const seen = new Set();
        for (let station = 0; station < profile.points.length; station += 4) {
          const sample = profile.points[station], key = `sample-x:${sample.x}`;
          if (seen.has(key)) continue;
          seen.add(key);
          kit.sphere(sample, u * 0.056, '#648161', { ...finishes.enamel, key, tag: `${profile.id}-bead-x-${sample.x}` });
        }
      }
      const envelope = view.waveEnvelope;
      if (envelope) entityScope(kit, 'wave-envelope', envelope, () => {
        for (const side of ['upper', 'lower']) if (validPath(envelope[side])) kit.line(envelope[side], c.muted, { dashed: true, opacity: 0.55, key: side, tag: `${envelope.id}-${side}` });
      });
    }
    if (isPoint(view.waveMarker?.at) && kit.visible('waveform')) entityScope(kit, 'wave-marker', view.waveMarker, () => {
      kit.sphere(view.waveMarker.at, u * 0.1, '#bb9555', { ...finishes.enamel, key: 'marker', tag: view.waveMarker.id });
      kit.label(view.waveMarker.label, offset(view.waveMarker.at, 0, -u * 0.4), { key: 'label', tag: `${view.waveMarker.id}-label` });
    });
    if (kit.visible('nodes')) for (const node of view.waveNodes ?? []) if (isPoint(node.at)) entityScope(kit, 'wave-node', node, () => {
      if (node.kind === 'node') kit.circle(node.at, u * 0.11, c.ink, { key: 'node', tag: node.id });
      else if (node.kind === 'antinode') kit.sphere(node.at, u * 0.073, '#9683a4', { key: 'antinode', tag: node.id });
      kit.label(node.label, offset(node.at, 0, u * 0.3), { key: 'label' });
    });
  });
}

function rippleTank(view, kit) {
  const sources = (view.waveSources ?? []).filter(source => isPoint(source.at));
  if (!sources.length || !isPoint(view.origin) || !positive(view.extent?.width) || !positive(view.extent?.height)) return;
  scope(kit, 'ripple-tank', () => {
    const u = kit.unit, left = view.origin.x, right = left + view.extent.width, bottom = view.origin.y, top = bottom + view.extent.height;
    const center = { x: (left + right) / 2, y: (bottom + top) / 2, z: -u * 0.34 };
    // Shallow tray behind the XY observation plane. This is a material backdrop,
    // not a new free surface or a promise of volumetric CFD.
    kit.box(center, right - left, top - bottom, u * 0.12, '#c8ded0', { ...finishes.glass, opacity: 0.08, key: 'tray-bottom', tag: 'ripple-tank' });
    for (const [side, x] of [['left', left], ['right', right]]) kit.box({ x, y: center.y, z: -u * 0.22 }, u * 0.07, top - bottom, u * 0.32, '#a3b39b', { ...finishes.brushed, key: `rim:${side}` });
    for (const [side, y] of [['bottom', bottom], ['top', top]]) kit.box({ x: center.x, y, z: -u * 0.22 }, right - left, u * 0.07, u * 0.32, '#a3b39b', { ...finishes.brushed, key: `rim:${side}` });
  });
  for (const source of sources) entityScope(kit, 'wave-source', source, () => {
    const u = kit.unit;
    kit.cylinder(offset(source.at, 0, 0, -u * 0.28), offset(source.at, 0, 0, u * 0.22), u * 0.045, c.alloy, { ...finishes.aluminum, key: 'dipper', tag: `${source.id}-dipper` });
    kit.sphere(source.at, u * 0.1, '#678960', { ...finishes.enamel, key: 'source-anchor', tag: source.id });
    kit.label(source.label, offset(source.at, 0, -u * 0.35), { key: 'label' });
  });
  if (kit.visible('waveform')) for (const front of view.waveFronts ?? []) if (isPoint(front.center) && positive(front.radius)) entityScope(kit, 'wavefront', front, () => kit.circle(front.center, front.radius, '#678d9d', { opacity: 0.5, key: 'front', tag: front.id }));
  if (isPoint(view.wavePoint?.at) && kit.visible('superposition')) entityScope(kit, 'interference-probe', view.wavePoint, () => {
    const p = view.wavePoint, u = kit.unit, color = p.verdict === 'constructive' ? '#b28f4d' : p.verdict === 'destructive' ? '#60859e' : '#9281a1';
    kit.sphere(p.at, u * 0.105, color, { key: 'sensor', tag: p.id });
    kit.circle(p.at, u * 0.2, color, { opacity: 0.6, key: 'registration' });
    kit.label(p.readout, offset(p.at, 0, u * 0.4), { color: c.ink, key: 'reading', tag: `${p.id}-label` });
  });
}

function diffraction(snapshot, kit) {
  const view = snapshot.view, rig = diffractionFacts(view), u = kit.unit;
  const legacyScreen = (view.labels ?? []).find(item => item.id === 'wave-screen-label');
  if (!rig) {
    // Older V3 frames can still locate a screen. No numerical slit or stripe is
    // fabricated from formatted inspector text, a grid, curve.x or dimension.
    if (isPoint(legacyScreen?.at)) {
      opticalScreen({ id: 'diffraction-screen', at: legacyScreen.at, halfHeight: view.extent.height * 0.44, lit: false }, undefined, kit, { dark: true, halfWidth: u * 1.3 });
      kit.label('单缝数值器材需平台语义帧', offset(legacyScreen.at, 0, view.extent.height * 0.47), { color: c.muted, key: 'legacy-diffraction-caption' });
    }
    return;
  }
  entityScope(kit, 'diffraction-rig', rig, () => {
    const h = rig.screenHalfHeight, floor = Math.min(rig.slitAt.y, rig.screenAt.y) - h - u * 0.4;
    const panelHeight = Math.max(0, h - rig.slitWidth / 2), f = apparatusFrame(kit, rig.slitAt);
    if (panelHeight > 0) for (const [side, sign] of [['lower', -1], ['upper', 1]]) {
      // Inner jaw edges are exactly at ±slitWidth/2, including a closed zero slit
      // and arbitrarily narrow openings. Hardware never widens the true slit.
      const jaw = f.box(`slit-jaw:${side}`, [0, sign * (rig.slitWidth / 2 + panelHeight / 2), 0], u * 0.105, panelHeight, u * 0.74, '#33483b', { ...finishes.brushed, rounded: false, tag: `diffraction-slit-${side}` });
      if (jaw) jaw.userData.apparatus = { factory: 'diffraction-slit-jaw', origin: offset(rig.slitAt), anchors: { innerEdge: offset(rig.slitAt, 0, sign * rig.slitWidth / 2), slitWidth: rig.slitWidth }, unit: 'scene' };
    }
    opticalStand(kit, rig.slitAt, rig.slitAt.y - h - u * 0.1, floor, 'slit-stand');
    const screen = opticalScreen({ id: 'diffraction-screen', at: rig.screenAt, halfHeight: h, lit: true, label: '衍射屏' }, floor, kit, { dark: true, halfWidth: u * 1.3 });
    if (screen && kit.visible('waveform')) {
      const samples = rig.intensitySamples ?? [];
      for (let station = 1; station < samples.length; station += 1) {
        const a = samples[station - 1], b = samples[station], ay = semanticNumber(a.y), by = semanticNumber(b.y), ai = semanticNumber(a.intensity), bi = semanticNumber(b.intensity);
        if (ay === undefined || by === undefined || ai === undefined || bi === undefined || ai < 0 || bi < 0 || ay === by || !a.id || !b.id) continue;
        const intensity = (ai + bi) / 2;
        if (intensity <= 0) continue;
        // Only an explicit visual gamma maps the REAL intensity to brightness.
        // The numerical curve/readout stays upstream; no inverse pixel inference.
        const color = new kit.THREE.Color('#abd5a6').multiplyScalar(Math.sqrt(intensity));
        const band = kit.box({ x: rig.screenAt.x, y: (ay + by) / 2, z: rig.screenAt.z ?? 0 }, u * 0.001, Math.abs(by - ay), screen.halfWidth * 1.92, color, { materialType: 'basic', key: `intensity-band:${a.id}->${b.id}`, tag: `diffraction-band-${b.id}`, rounded: false, depthWrite: false, castShadow: false, receiveShadow: false });
        if (band) {
          // Paint after the non-depth-writing diffuser, not on a shifted optical plane.
          band.renderOrder = 1;
          band.userData.apparatus = { factory: 'diffraction-intensity-band', origin: offset(rig.screenAt), anchors: { sampleFrom: { id: a.id, y: ay, intensity: ai }, sampleTo: { id: b.id, y: by, intensity: bi } }, gamma: 0.5, unit: 'scene' };
        }
      }
    }
    if (kit.visible('waveform')) {
      const width = (view.dimensions ?? []).find(item => item.id === 'wave-central-width');
      if (isPoint(width?.from) && isPoint(width.to)) kit.line([offset(width.from, u * 0.28), offset(width.to, u * 0.28)], '#b88f43', { dashed: true, key: 'central-maximum-span', tag: 'diffraction-central-maximum-span' });
      const minimum = (view.trajectories ?? []).find(item => item.id === 'wave-first-minimum')?.points?.at(-1);
      if (isPoint(minimum)) kit.sphere(minimum, u * 0.062, '#6b8fa5', { key: 'first-minimum', tag: 'diffraction-first-minimum' });
    }
    kit.label('条纹：平台强度采样 · 显示 γ = 0.5', offset(rig.screenAt, 0, h + u * 0.7), { color: c.muted, size: 10, priority: 0, key: 'intensity-caption' });
  });
}

function extendedWaves(snapshot, kit) {
  const view = snapshot.view, u = kit.unit, paths = view.trajectories ?? [];
  if (snapshot.experimentId === 'wave-diffraction' || view.waveDiffraction) { diffraction(snapshot, kit); return; }
  const boundary = (view.labels ?? []).find(label => label.id === 'wave-boundary-label');
  if (isPoint(boundary?.at) && isPoint(view.origin)) {
    scope(kit, 'wave-boundary', () => {
      const x = view.origin.x, width = view.extent.width, a = boundary.at;
      for (const [medium, sign] of [['incident', -1], ['transmitted', 1]]) {
        const height = sign < 0 ? a.y - view.origin.y : view.origin.y + view.extent.height - a.y;
        if (height > 0) kit.box({ x: x + width / 2, y: a.y + sign * height / 2, z: (a.z ?? 0) - u * 0.28 }, width, height, u * 0.14, sign < 0 ? '#c7ded1' : '#d6dec8', { ...finishes.glass, opacity: 0.12, key: `medium:${medium}`, tag: `wave-medium-${medium}`, rounded: false });
      }
      kit.line([{ x, y: a.y, z: a.z ?? 0 }, { x: x + width, y: a.y, z: a.z ?? 0 }], c.alloy, { key: 'boundary', tag: 'wave-medium-boundary' });
      if (kit.visible('guides')) kit.line([offset(a, 0, -view.extent.height * 0.43), offset(a, 0, view.extent.height * 0.43)], c.muted, { dashed: true, key: 'normal', tag: 'wave-boundary-normal' });
    });
    return;
  }
  if (paths.some(path => path.id === 'wave-doppler-axis')) for (const source of view.waveSources ?? []) if (isPoint(source.at)) entityScope(kit, 'doppler-apparatus', source, () => {
    const observer = source.id?.endsWith('.observer');
    if (observer) microphone(kit, source.at, { key: 'microphone', tag: source.id });
    else {
      loudspeaker(kit, source.at, { key: 'speaker', tag: source.id });
      const f = apparatusFrame(kit, source.at);
      for (const [axle, x] of [['rear', -u * 0.42], ['front', -u * 0.1]]) f.sphere(`wheel:${axle}`, [x, -u * 0.51, 0], u * 0.095, c.rubber, finishes.rubber);
    }
    kit.label(source.label, offset(source.at, 0, u * 0.63), { key: 'label' });
    if (kit.visible('waveSpeed')) kit.label(derivedReadout(snapshot, observer ? 'observed_frequency' : 'source_frequency'), offset(source.at, 0, -u * 0.91), { color: c.ink, key: 'frequency' });
  });
}

function echo(view, kit) {
  const u = kit.unit;
  for (const source of view.acousticSources ?? []) if (isPoint(source.at)) entityScope(kit, 'echo-source', source, () => {
    const center = offset(source.at, 0, u * 0.6);
    kit.cylinder(source.at, offset(center, -u * 0.22, -u * 0.32), u * 0.03, c.alloy, { ...finishes.aluminum, key: 'stand', tag: `${source.id}-stand` });
    kit.box(offset(source.at, -u * 0.15, -u * 0.05), u * 0.61, u * 0.1, u * 0.48, c.alloy, { ...finishes.brushed, key: 'foot' });
    loudspeaker(kit, center, { key: 'speaker', tag: source.id, scale: 0.85 });
    kit.label(source.label, offset(source.at, 0, -u * 0.42), { key: 'label' });
  });
  for (const wall of view.acousticReflectors ?? []) if (isPoint(wall.at) && positive(wall.halfHeight)) entityScope(kit, 'echo-reflector', wall, () => {
    const f = apparatusFrame(kit, wall.at);
    // Front face x and foot y are the actual supplied reflecting plane.
    f.box('wall', [u * 0.14, wall.halfHeight, 0], u * 0.28, wall.halfHeight * 2, u * 0.91, '#a7b39c', { ...finishes.ceramic, rounded: false, tag: wall.id });
    f.line('reflecting-face', [[0, 0, 0], [0, wall.halfHeight * 2, 0]], c.ink);
    for (let station = 1; station < 7; station += 1) f.line(`hatch:${station}`, [[u * 0.028, wall.halfHeight * 2 * station / 7, u * 0.46], [u * 0.25, wall.halfHeight * 2 * station / 7 + u * 0.1, u * 0.46]], c.muted);
    f.label('label', wall.label, [0, wall.halfHeight * 2 + u * 0.29, 0]);
  });
  if (kit.visible('wavefronts')) for (const front of view.acousticWavefronts ?? []) if (isPoint(front.at) && positive(front.radius)) entityScope(kit, 'acoustic-wavefront', front, () => {
    const forward = front.direction === 'forward';
    kit.circle(front.at, front.radius, '#668b9d', { start: forward ? -Math.PI / 3 : Math.PI * 2 / 3, end: forward ? Math.PI / 3 : Math.PI * 4 / 3, opacity: 0.6, key: 'front', tag: front.id });
  });
  const pulse = view.acousticPulse;
  if (isPoint(pulse?.at) && kit.visible('path')) entityScope(kit, 'acoustic-pulse', pulse, () => {
    kit.sphere(pulse.at, u * 0.065, pulse.phase === 'return' ? '#9482a3' : '#b4914d', { key: 'pulse', tag: pulse.id });
    kit.label(pulse.phase === 'received' ? '已接收' : pulse.phase === 'return' ? '返回声脉冲' : '发出声脉冲', offset(pulse.at, 0, u * 0.35), { key: 'phase' });
  });
}

function noise(rig, kit) {
  if (!isPoint(rig?.sourceAt) || !isPoint(rig.listenerAt)) return;
  entityScope(kit, 'noise-rig', rig, () => {
    const u = kit.unit, p = rig.listenerAt;
    loudspeaker(kit, rig.sourceAt, { key: 'source', tag: `${rig.id}-source`, scale: 0.9 });
    // The supplied listener anchor is its foot, not a sound-level meter's COM.
    scope(kit, 'listener', () => {
      const f = apparatusFrame(kit, p);
      f.sphere('head', [0, u * 0.82, 0], u * 0.13, '#b4b59c', { ...finishes.ceramic, tag: `${rig.id}-listener` });
      f.rod('torso', [0, u * 0.32, 0], [0, u * 0.67, 0], u * 0.105, '#6a8664', finishes.enamel);
      for (const side of [-1, 1]) f.rod(`leg:${side}`, [side * u * 0.085, 0, 0], [side * u * 0.04, u * 0.34, 0], u * 0.039, c.rubber, finishes.rubber);
      digitalMeter(kit, f.at(u * 0.42, u * 0.52, u * 0.12), { key: 'sound-level-meter', scale: u * 0.28, unit: 'dB', reading: rig.levelText, showReading: kit.visible('thermometer'), tag: `${rig.id}-meter` });
    });
    if (isPoint(rig.barrierAt)) scope(kit, 'barrier', () => {
      const f = apparatusFrame(kit, rig.barrierAt);
      f.box('panel', [u * 0.065, u * 0.65, 0], u * 0.13, u * 1.3, u * 0.64, '#8fa180', { ...finishes.ceramic, tag: `${rig.id}-barrier`, rounded: false });
      for (let station = 1; station <= 4; station += 1) f.box(`absorber-rib:${station}`, [u * 0.13, station * u * 0.25, 0], u * 0.045, u * 0.026, u * 0.65, '#b5bea2', finishes.ceramic);
      f.label('label', rig.barrierText, [0, u * 1.45, 0]);
    });
    if (kit.visible('wavefronts')) for (let station = 0; station < (rig.wavefronts?.length ?? 0); station += 1) {
      const radius = rig.wavefronts[station];
      // Each front is already a snapshot fact. No vt/radius synthesis or clock.
      if (positive(radius)) scope(kit, `front-station:${station}`, () => kit.circle(rig.sourceAt, radius, '#6b8e9f', { start: -0.7, end: 0.7, opacity: 0.47, key: 'front', tag: `${rig.id}-front-${station}` }));
    }
    kit.label(rig.sourceText, offset(rig.sourceAt, -u * 0.18, -u * 0.8), { key: 'source-rating' });
    if (kit.visible('thermometer')) kit.label(rig.levelText, offset(p, u * 0.18, u * 1.15), { color: c.ink, key: 'level' });
    kit.line([offset(rig.sourceAt, 0, -u * 0.63), offset(p, 0, -u * 0.63)], c.muted, { dashed: true, key: 'distance' });
    kit.label(rig.distanceText, { x: (rig.sourceAt.x + p.x) / 2, y: Math.min(rig.sourceAt.y, p.y) - u * 0.92, z: rig.sourceAt.z ?? 0 }, { key: 'distance-label' });
  });
}

export function drawWaves(snapshot, kit) {
  const view = snapshot?.view;
  if (!view || !positive(kit.unit)) return;
  scope(kit, 'waves', () => {
    if (view.domain === 'acoustics' || snapshot.domain === 'acoustics') { if (view.noiseRig) noise(view.noiseRig, kit); else echo(view, kit); }
    else if (view.waveProfile) profileRig(snapshot, kit);
    else if (view.wavePoint || ((view.waveSources?.length ?? 0) > 0 && !(view.trajectories ?? []).some(path => path.id === 'wave-doppler-axis'))) rippleTank(view, kit);
    else extendedWaves(snapshot, kit);
  });
}
