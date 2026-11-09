// Waves and acoustics: geometry follows the supplied samples/fronts. No local
// clock, sine wave, refraction solver or Doppler wavefront construction.
const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const at = (p, dx = 0, dy = 0, z = 0) => ({ x: p.x + dx, y: p.y + dy, z });
const validPoints = points => points?.length > 1 && points.every(point);

function speaker(center, kit, tag, scale = 1) {
  const { unit, palette: c } = kit, u = unit * scale;
  kit.box(at(center, -u * 0.21, 0, -u * 0.05), u * 0.42, u * 0.66, u * 0.5, c.green, { tag });
  // A real horn, opening to +x. Its mouth axis is at the sound source anchor.
  const horn = new kit.THREE.Mesh(new kit.THREE.CylinderGeometry(u * 0.27, u * 0.1, u * 0.34, 24, 1, true),
    new kit.THREE.MeshStandardMaterial({ color: c.metal, side: kit.THREE.DoubleSide, roughness: 0.5 }));
  horn.rotation.z = -Math.PI / 2;
  horn.position.set(center.x + u * 0.1, center.y, 0);
  horn.userData.tag = `${tag}-horn`; kit.group.add(horn);
  kit.sphere(at(center, -u * 0.035, 0), u * 0.11, c.ink);
  kit.box(at(center, -u * 0.2, -u * 0.4, -u * 0.06), u * 0.6, u * 0.13, u * 0.55, c.metal);
}

function microphone(center, kit, tag) {
  const { unit: u, palette: c } = kit;
  kit.sphere(center, u * 0.13, c.metal, { tag });
  for (let i = -2; i <= 2; i++) kit.line([at(center, -u * 0.1, i * u * 0.035, u * 0.1), at(center, u * 0.1, i * u * 0.035, u * 0.1)], c.ink, { opacity: 0.55 });
  kit.cylinder(at(center, 0, -u * 0.13), at(center, 0, -u * 0.67), u * 0.045, c.metal);
  kit.box(at(center, 0, -u * 0.7), u * 0.5, u * 0.1, u * 0.35, c.green);
}

function profileRig(snapshot, kit) {
  const v = snapshot.view, profile = v.waveProfile;
  if (!profile || !point(profile.equilibrium?.from) || !point(profile.equilibrium?.to)) return;
  const { unit: u, palette: c } = kit, { from, to } = profile.equilibrium;
  const formation = (v.trajectories ?? []).filter(path => path.id === 'wave-formation-left' || path.id === 'wave-formation-right');
  const longitudinal = snapshot.experimentId === 'wave-longitudinal' || (v.axes?.y ?? '').includes('ξ');
  if (kit.visible('guides')) kit.line([from, to], c.muted, { dashed: true, opacity: 0.6, tag: `${profile.id}-equilibrium` });
  if (longitudinal) {
    // This upstream primitive is ξ(x), not particle world positions. Keep its
    // exact graph coordinates; a physical slinky would require missing data.
    const base = at(from, -u * 0.31, 0, -u * 0.1);
    kit.box(base, u * 0.4, u * 0.8, u * 0.4, c.green, { tag: 'longitudinal-driver' });
    kit.cylinder(at(from, -u * 0.12), from, u * 0.06, c.metal);
    if (kit.visible('waveform') && validPoints(profile.points)) {
      kit.line(profile.points, c.blue, { tag: profile.id });
      profile.points.forEach((p, i) => {
        if (i % 2 === 0) kit.sphere(p, u * 0.03, c.blue, { tag: `${profile.id}-sample-${i}` });
      });
    }
    kit.label('纵向位移 ξ(x)', at(from, (to.x - from.x) * 0.5, v.extent.height * 0.39), { color: c.blue, tag: 'longitudinal-samples-label' });
    return;
  }
  for (const [i, p] of [from, to].entries()) {
    if (i === 1 && profile.kind !== 'string') continue;
    const dx = (i ? 1 : -1) * u * 0.16;
    kit.box(at(p, dx, 0, -u * 0.1), u * 0.26, u * 0.78, u * 0.45, c.green, { tag: `${profile.id}-clamp-${i}` });
    kit.box(at(p, dx, -u * 0.45, -u * 0.1), u * 0.53, u * 0.12, u * 0.6, c.metal);
    kit.sphere(at(p, dx, 0, u * 0.16), u * 0.075, c.metal);
    if ((!i && profile.kind === 'rope') || formation.length) {
      const first = profile.points?.[i ? profile.points.length - 1 : 0];
      if (point(first)) {
        // The actuator extends from its fixed housing to the live endpoint.
        // The rope sample never moves to fit the decorative driver housing.
        const housingPin = at(p, dx, 0, u * 0.16);
        const sliderPin = at(first, (i ? 1 : -1) * u * 0.13, 0, u * 0.16);
        kit.cylinder(housingPin, sliderPin, u * 0.025, c.metal, { tag: `${profile.id}-actuator` });
        kit.cylinder(sliderPin, first, u * 0.032, c.metal, { tag: `${profile.id}-driver-pin` });
      }
      if (!formation.length) kit.label('振源', at(p, -u * 0.15, u * 0.68), { tag: 'wave-driver-label' });
    }
  }
  if (kit.visible('waveform')) {
    for (const path of formation) if (validPoints(path.points)) {
      kit.line(path.points.map(p => ({ ...p, z: u * 0.08 })), path.id.endsWith('left') ? c.blue : c.orange, { opacity: 0.85, tag: path.id });
    }
    if (validPoints(profile.points)) {
      // Straight segment cylinders keep every sampled corner and endpoint;
      // a smoothed spline would change measured displacement between samples.
      for (let i = 1; i < profile.points.length; i++) kit.cylinder(profile.points[i - 1], profile.points[i], u * 0.035, formation.length ? c.green : c.blue, { tag: `${profile.id}-segment-${i}` });
      profile.points.forEach((p, i) => { if (i % 4 === 0) kit.sphere(p, u * 0.068, c.green, { tag: `${profile.id}-bead-${i}` }); });
    }
    const e = v.waveEnvelope;
    if (e) for (const side of ['upper', 'lower']) if (validPoints(e[side])) kit.line(e[side], c.muted, { dashed: true, opacity: 0.6, tag: `${e.id}-${side}` });
  }
  if (v.waveMarker && point(v.waveMarker.at) && kit.visible('waveform')) {
    kit.sphere(v.waveMarker.at, u * 0.12, c.orange, { tag: v.waveMarker.id });
    kit.label(v.waveMarker.label, at(v.waveMarker.at, 0, -u * 0.43), { color: c.orange, tag: `${v.waveMarker.id}-label` });
  }
  if (kit.visible('nodes')) for (const n of v.waveNodes ?? []) {
    if (!point(n.at)) continue;
    if (n.kind === 'node') kit.circle(n.at, u * 0.12, c.ink, { tag: n.id });
    else kit.sphere(n.at, u * 0.08, c.purple, { tag: n.id });
    if (n.label) kit.label(n.label, at(n.at, 0, u * 0.32), { tag: `${n.id}-label` });
  }
}

function rippleTank(v, kit) {
  const { unit: u, palette: c } = kit;
  const sources = (v.waveSources ?? []).filter(s => point(s.at));
  if (!sources.length) return;
  // The transparent shallow tank sits behind the xy observation plane.
  const center = { x: v.origin.x + v.extent.width / 2, y: v.origin.y + v.extent.height / 2, z: -u * 0.4 };
  kit.box(center, v.extent.width * 0.96, v.extent.height * 0.95, u * 0.16, c.glass, { opacity: 0.12, tag: 'ripple-tank' });
  for (const s of sources) {
    kit.cylinder(at(s.at, 0, 0, -u * 0.3), at(s.at, 0, 0, u * 0.28), u * 0.055, c.metal, { tag: `${s.id}-dipper` });
    kit.sphere(s.at, u * 0.115, c.green, { tag: s.id });
    kit.label(s.label, at(s.at, 0, -u * 0.38), { tag: `${s.id}-label` });
  }
  if (kit.visible('waveform')) for (const f of v.waveFronts ?? []) {
    if (point(f.center) && Number.isFinite(f.radius) && f.radius > 0) kit.circle(f.center, f.radius, c.blue, { opacity: 0.5, tag: f.id });
  }
  if (v.wavePoint && point(v.wavePoint.at) && kit.visible('superposition')) {
    const p = v.wavePoint, color = p.verdict === 'constructive' ? c.orange : p.verdict === 'destructive' ? c.blue : c.purple;
    kit.sphere(p.at, u * 0.12, color, { tag: p.id });
    kit.circle(p.at, u * 0.22, color, { opacity: 0.6 });
    kit.label(p.readout, at(p.at, 0, u * 0.43), { color, tag: `${p.id}-label` });
  }
}

function derived(snapshot, id) {
  for (const section of snapshot.inspector ?? []) {
    const row = (section.derived ?? []).find(r => r.id === id);
    if (row) return row;
  }
  return undefined;
}

function extendedWaves(snapshot, kit) {
  const v = snapshot.view, { unit: u, palette: c } = kit;
  const labels = v.labels ?? [], paths = v.trajectories ?? [];
  const boundary = labels.find(l => l.id === 'wave-boundary-label');
  if (boundary && point(boundary.at)) {
    const a = boundary.at, x = v.origin.x, width = v.extent.width;
    for (const sign of [-1, 1]) {
      const height = sign < 0 ? a.y - v.origin.y : v.origin.y + v.extent.height - a.y;
      if (height > 0) kit.box({ x: x + width / 2, y: a.y + sign * height / 2, z: -u * 0.3 }, width, height, u * 0.16,
        sign < 0 ? c.glass : '#cbdcd1', { opacity: 0.16, tag: `wave-medium-${sign}` });
    }
    kit.line([{ x, y: a.y }, { x: x + width, y: a.y }], c.metal, { tag: 'wave-medium-boundary' });
    if (kit.visible('guides')) kit.line([at(a, 0, -v.extent.height * 0.45), at(a, 0, v.extent.height * 0.45)], c.muted, { dashed: true, tag: 'wave-boundary-normal' });
    return;
  }
  const slit = labels.find(l => l.id === 'wave-slit-label');
  const screen = labels.find(l => l.id === 'wave-screen-label');
  if (slit && screen && point(slit.at) && point(screen.at)) {
    const sw = derived(snapshot, 'slit_width');
    // Unit conversion of an existing length is projection, not a wave solve.
    const width = sw && sw.unit === 'm' ? Number(sw.value) * 100 : NaN;
    const halfHeight = v.extent.height * 0.44;
    if (Number.isFinite(width) && width >= 0) {
      const panelHeight = Math.max(0, halfHeight - width / 2);
      if (panelHeight) for (const sign of [-1, 1]) kit.box(at(slit.at, 0, sign * (width / 2 + panelHeight / 2), -u * 0.09),
        u * 0.13, panelHeight, u * 0.75, c.ink, { tag: `diffraction-slit-${sign}` });
    }
    const screenDepth = u * 2.6;
    // The observation screen is a YZ plane at the supplied x, facing the slit.
    kit.box(at(screen.at, u * 0.06, 0), u * 0.12, halfHeight * 2, screenDepth, '#17251e', { tag: 'diffraction-screen' });
    const curve = paths.find(path => path.id === 'wave-diffraction-intensity');
    const scale = (v.dimensions ?? []).find(d => d.id === 'wave-intensity-scale');
    if (kit.visible('waveform') && validPoints(curve?.points) && scale) {
      const fullScale = scale.to.x - scale.from.x;
      if (fullScale > 0) for (let i = 1; i < curve.points.length; i++) {
        const p = curve.points[i], previous = curve.points[i - 1];
        const intensity = Math.max(0, Math.min(1, ((p.x + previous.x) / 2 - screen.at.x) / fullScale));
        if (intensity <= 0) continue;
        // Display gamma reveals weak side lobes; the adjacent curve retains I/I0.
        const brightness = Math.sqrt(intensity);
        const band = new kit.THREE.Mesh(
          new kit.THREE.PlaneGeometry(screenDepth * 0.96, p.y - previous.y),
          new kit.THREE.MeshBasicMaterial({ color: new kit.THREE.Color('#8eecad').multiplyScalar(brightness), side: kit.THREE.DoubleSide }),
        );
        band.rotation.y = -Math.PI / 2;
        band.position.set(screen.at.x - u * 0.001, (p.y + previous.y) / 2, 0);
        band.name = `diffraction-band-${i}`;
        kit.group.add(band);
      }
    }
    const band = (v.dimensions ?? []).find(d => d.id === 'wave-central-width');
    if (band && point(band.from) && point(band.to) && kit.visible('waveform')) {
      kit.line([at(band.from, u * 0.3), at(band.to, u * 0.3)], c.orange, { dashed: true, tag: 'diffraction-central-maximum-span' });
    }
    const minimum = paths.find(p => p.id === 'wave-first-minimum')?.points?.at(-1);
    if (point(minimum) && kit.visible('waveform')) kit.sphere(minimum, u * 0.07, c.blue, { tag: 'diffraction-first-minimum' });
    return;
  }
  if (paths.some(p => p.id === 'wave-doppler-axis')) {
    for (const s of v.waveSources ?? []) {
      if (!point(s.at)) continue;
      if (s.id.endsWith('.observer')) microphone(s.at, kit, s.id);
      else {
        speaker(s.at, kit, s.id);
        for (const dx of [-u * 0.42, u * 0.06]) kit.sphere(at(s.at, dx, -u * 0.52), u * 0.1, c.ink);
      }
      kit.label(s.label, at(s.at, 0, u * 0.65), { tag: `${s.id}-label` });
      const row = derived(snapshot, s.id.endsWith('.observer') ? 'observed_frequency' : 'source_frequency');
      if (row && kit.visible('waveSpeed')) kit.label(`${row.value} ${row.unit}`, at(s.at, 0, -u * 0.96), { color: c.blue, tag: `${s.id}-frequency` });
    }
  }
}

function echo(v, kit) {
  const { unit: u, palette: c } = kit, pulse = v.acousticPulse;
  for (const s of v.acousticSources ?? []) {
    if (!point(s.at)) continue;
    // The source foot is fixed apparatus. The pulse uses different outbound
    // and return lanes; changing its lane must never move the loudspeaker.
    const center = { x: s.at.x, y: s.at.y + u * 0.6 };
    kit.cylinder(s.at, at(center, -u * 0.15, -u * 0.4), u * 0.035, c.metal, { tag: `${s.id}-stand` });
    kit.box(at(s.at, -u * 0.15, -u * 0.055), u * 0.65, u * 0.11, u * 0.5, c.metal);
    speaker(center, kit, s.id, 0.85);
    if (s.label) kit.label(s.label, at(s.at, 0, -u * 0.45), { tag: `${s.id}-label` });
  }
  for (const wall of v.acousticReflectors ?? []) {
    if (!point(wall.at) || !(wall.halfHeight > 0)) continue;
    kit.box(at(wall.at, u * 0.16, wall.halfHeight, -u * 0.2), u * 0.32, wall.halfHeight * 2, u * 0.95, '#a4b4ad', { tag: wall.id });
    kit.line([wall.at, at(wall.at, 0, wall.halfHeight * 2)], c.ink);
    for (let i = 1; i < 8; i++) kit.line([at(wall.at, u * 0.03, wall.halfHeight * 2 * i / 8, u * 0.3), at(wall.at, u * 0.3, wall.halfHeight * 2 * i / 8 + u * 0.13, u * 0.3)], c.muted);
    if (wall.label) kit.label(wall.label, at(wall.at, 0, wall.halfHeight * 2 + u * 0.32), { tag: `${wall.id}-label` });
  }
  if (kit.visible('wavefronts')) for (const w of v.acousticWavefronts ?? []) {
    if (!point(w.at) || !(w.radius > 0)) continue;
    const forward = w.direction === 'forward';
    kit.circle(w.at, w.radius, c.blue, { start: forward ? -Math.PI / 3 : Math.PI * 2 / 3,
      end: forward ? Math.PI / 3 : Math.PI * 4 / 3, opacity: 0.62, tag: w.id });
  }
  if (pulse && point(pulse.at) && kit.visible('path')) {
    kit.sphere(pulse.at, u * 0.075, pulse.phase === 'return' ? c.purple : c.orange, { tag: pulse.id });
    kit.label(pulse.phase === 'received' ? '已接收' : pulse.phase === 'return' ? '返回声脉冲' : '发出声脉冲', at(pulse.at, 0, u * 0.38), { tag: `${pulse.id}-label` });
  }
}

function noise(r, kit) {
  if (!point(r.sourceAt) || !point(r.listenerAt)) return;
  const { unit: u, palette: c } = kit;
  speaker(r.sourceAt, kit, `${r.id}-source`, 0.9);
  const p = r.listenerAt;
  // Listener's feet are exactly at the supplied location.
  kit.sphere(at(p, 0, u * 0.82), u * 0.14, '#b4b9ac', { tag: `${r.id}-listener` });
  kit.cylinder(at(p, 0, u * 0.32), at(p, 0, u * 0.67), u * 0.12, c.green);
  for (const side of [-1, 1]) kit.cylinder(at(p, side * u * 0.09, 0), at(p, side * u * 0.045, u * 0.34), u * 0.045, c.ink);
  if (point(r.barrierAt)) {
    kit.box(at(r.barrierAt, 0, u * 0.3, -u * 0.08), u * 0.14, u * 1.3, u * 0.65, '#9aafa3', { tag: `${r.id}-barrier` });
    for (let i = 0; i < 5; i++) kit.box(at(r.barrierAt, 0, -u * 0.2 + i * u * 0.24, u * 0.26), u * 0.17, u * 0.025, u * 0.05, c.metal);
    kit.label(r.barrierText, at(r.barrierAt, 0, u * 1.12), { tag: `${r.id}-barrier-label` });
  }
  if (kit.visible('wavefronts')) for (const [i, radius] of (r.wavefronts ?? []).entries()) {
    if (Number.isFinite(radius) && radius > 0) kit.circle(r.sourceAt, radius, c.blue, { start: -0.7, end: 0.7, opacity: 0.48, tag: `${r.id}-front-${i}` });
  }
  kit.label(r.sourceText, at(r.sourceAt, -u * 0.2, -u * 0.85), { tag: `${r.id}-rating` });
  // The host reuses thermometer for the sound-level meter's observable.
  if (kit.visible('thermometer')) kit.label(r.levelText, at(p, u * 0.2, u * 1.2), { color: c.blue, tag: `${r.id}-level` });
  kit.line([at(r.sourceAt, 0, -u * 0.68), at(p, 0, -u * 0.68)], c.muted, { dashed: true, tag: `${r.id}-distance` });
  kit.label(r.distanceText, { x: (r.sourceAt.x + p.x) / 2, y: Math.min(r.sourceAt.y, p.y) - u }, { tag: `${r.id}-distance-label` });
}

export function drawWaves(snapshot, kit) {
  const v = snapshot.view;
  if (!v) return;
  if (v.domain === 'acoustics') {
    if (v.noiseRig) noise(v.noiseRig, kit); else echo(v, kit);
    return;
  }
  if (v.waveProfile) profileRig(snapshot, kit);
  else if (v.wavePoint || (v.waveSources?.length && !(v.trajectories ?? []).some(p => p.id === 'wave-doppler-axis'))) rippleTank(v, kit);
  else extendedWaves(snapshot, kit);
}
