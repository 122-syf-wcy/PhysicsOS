// Geometry-only contracts shared by the twelve domain adapters. Scene lengths
// have already been converted by the platform bridge. Never parse a readout,
// infer a force from an arrow's length, or recover a parameter from plot vertices.
export const finite = Number.isFinite;
export const positive = value => finite(value) && value > 0;
export const isPoint = p => p && finite(p.x) && finite(p.y) && (p.z === undefined || finite(p.z));
export const offset = (p, x = 0, y = 0, z = 0) => ({ x: p.x + x, y: p.y + y, z: (p.z ?? 0) + z });
export const interpolate = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t,
});
export const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0));
export const radiansToDegrees = value => value * 180 / Math.PI;

// Units are a contract, not a guess based on a number's magnitude. In particular
// 0.01 degrees and 0.01 radians must remain different, and zero is valid in both.
export function angleDegrees(value, unit = 'deg') {
  if (!finite(value)) return undefined;
  if (unit === 'rad' || unit === 'radians' || unit === 'radian') return radiansToDegrees(value);
  if (unit === 'deg' || unit === 'degrees' || unit === 'degree') return value;
  return undefined;
}

/** Local x/y follow the apparatus; local z is its depth, not a second plot axis. */
export function localFrame(origin, angle = 0, unit = 'deg') {
  if (!isPoint(origin)) return undefined;
  const rotation = angleDegrees(angle, unit);
  if (rotation === undefined) return undefined;
  const theta = rotation * Math.PI / 180, c = Math.cos(theta), s = Math.sin(theta);
  return {
    origin: offset(origin), rotation,
    axes: { x: { x: c, y: s, z: 0 }, y: { x: -s, y: c, z: 0 }, z: { x: 0, y: 0, z: 1 } },
    at: (x = 0, y = 0, z = 0) => offset(origin, c * x - s * y, s * x + c * y, z),
  };
}

/** A box's local +x follows an exact supplied 3D segment. */
export function segmentPose(from, to) {
  if (!isPoint(from) || !isPoint(to)) return undefined;
  const length = distance(from, to);
  if (!positive(length)) return undefined;
  const x = (to.x - from.x) / length, y = (to.y - from.y) / length, z = ((to.z ?? 0) - (from.z ?? 0)) / length;
  // Minimal rotation from +x. The antiparallel case needs a definite axis.
  const w = 1 + x, norm = Math.hypot(-z, y, w);
  const quaternion = norm > Number.EPSILON
    ? { x: 0, y: -z / norm, z: y / norm, w: w / norm }
    : { x: 0, y: 0, z: 1, w: 0 };
  return { at: interpolate(from, to, 0.5), length, quaternion, direction: { x, y, z } };
}

/** The supplied XY segment is the contact face; all thickness grows below it. */
export function surfacePose(from, to, thickness) {
  if (!isPoint(from) || !isPoint(to) || !positive(thickness)) return undefined;
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  if (!positive(length)) return undefined;
  const normal = { x: -dy / length, y: dx / length, z: 0 };
  return {
    at: offset(interpolate(from, to, 0.5), -normal.x * thickness / 2, -normal.y * thickness / 2),
    length, normal, rotation: radiansToDegrees(Math.atan2(dy, dx)),
  };
}

export function entityId(entity, singularRole) {
  const id = entity?.id;
  if (typeof id === 'string' && id.length) return id;
  if (typeof id === 'number' && finite(id)) return String(id);
  // Only singular, structurally named apparatus may omit an engine ID. Array
  // entities have an ID in SceneVisualModel and must not be keyed by frame index.
  return singularRole;
}

export function scope(kit, key, draw) {
  if (typeof key !== 'string' || !key.length) return undefined;
  return typeof kit.scope === 'function' ? kit.scope(key, () => draw(kit)) : draw(kit);
}

export function entityScope(kit, role, entity, draw, singularRole) {
  const id = entityId(entity, singularRole);
  return id === undefined ? undefined : scope(kit, `${role}:${id}`, draw);
}

// A small fixed palette is assigned by scientific role, never by filtered rank.
// Material finishes live in apparatus.js; these are data marks, not paint.
export const energyColors = Object.freeze({ potential: '#2a78d6', kinetic: '#eb6834', thermal: '#1baf7a' });
export const rayColors = Object.freeze({ parallel: '#2a78d6', central: '#eb6834', focal: '#1baf7a', incident: '#2a78d6' });

export function derivedReadout(snapshot, id) {
  for (const section of snapshot?.inspector ?? []) {
    const row = (section.derived ?? []).find(item => item.id === id);
    if (row?.value !== undefined && row.value !== null) return `${row.value} ${row.unit ?? ''}`.trim();
  }
  return undefined;
}

/** Only a semantic number is accepted. A localized/formatted string is not data. */
export const semanticNumber = value => typeof value === 'number' && finite(value) ? value : undefined;

/** Select an arrow span ON a supplied path; this is direction ink, not dynamics. */
export function pathSpan(points, fraction, spanLength) {
  if (!Array.isArray(points) || points.length < 2 || !finite(fraction) || !positive(spanLength)) return undefined;
  const segments = [], cumulative = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    if (!isPoint(a) || !isPoint(b)) return undefined;
    const length = distance(a, b);
    if (length > 0) { segments.push({ a, b, length }); cumulative.push(total); total += length; }
  }
  if (!positive(total)) return undefined;
  const center = total * Math.min(1, Math.max(0, fraction));
  const length = Math.min(spanLength, total);
  const start = Math.min(Math.max(0, center - length / 2), total - length);
  const positionAt = along => {
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      if (along <= cumulative[i] + segment.length || i === segments.length - 1) {
        return interpolate(segment.a, segment.b, Math.min(1, Math.max(0, (along - cumulative[i]) / segment.length)));
      }
    }
    return offset(points[points.length - 1]);
  };
  // Keep a marker inside one segment so its straight shaft does not shortcut an
  // authored corner or imply an electrical connection across an empty gap.
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i], low = cumulative[i], high = low + segment.length;
    if (center <= high || i === segments.length - 1) {
      const markerLength = Math.min(length, segment.length * 0.8);
      const markerStart = Math.min(high - markerLength, Math.max(low, center - markerLength / 2));
      return { from: positionAt(markerStart), to: positionAt(markerStart + markerLength) };
    }
  }
  return undefined;
}

/** Native xy displacement samples, not particle coordinates of a slinky. */
export function longitudinalProfile(snapshot) {
  return snapshot?.experimentId === 'wave-longitudinal';
}

export function diffractionFacts(view) {
  const rig = view?.waveDiffraction;
  if (!rig || !isPoint(rig.slitAt) || !isPoint(rig.screenAt)) return undefined;
  const slitWidth = semanticNumber(rig.slitWidth), halfHeight = semanticNumber(rig.screenHalfHeight);
  if (slitWidth === undefined || slitWidth < 0 || halfHeight === undefined || halfHeight <= 0) return undefined;
  return { ...rig, slitWidth, screenHalfHeight: halfHeight };
}
