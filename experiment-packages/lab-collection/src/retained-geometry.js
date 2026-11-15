// Dynamic buffers contain only supplied samples (or a decorative cross-section
// around their exact straight segments). Spare capacity is never a draw count.
export function dynamicGeometry(T) {
  const geometry = new T.BufferGeometry()
  geometry.boundingBox = new T.Box3()
  geometry.boundingSphere = new T.Sphere()
  geometry.userData.capacity = 0
  return geometry
}

function writer(T, geometry, count, attributes, stats) {
  // Keep the changed set alongside the writer, rather than allocating arrays
  // of Vector3s or replacing a BufferAttribute for every incoming frame.
  let capacity = geometry.userData.capacity
  const growing = count > capacity
  if (growing) {
    if (capacity) { geometry.dispose(); if (stats) stats.bufferGrowths++ }
    capacity = capacity ? Math.max(count, Math.ceil(capacity * 1.5)) : count
    geometry.userData.capacity = capacity
  }
  const changed = new Set()
  for (const [name, size] of Object.entries(attributes)) {
    if (growing || !geometry.getAttribute(name)) {
      geometry.setAttribute(name, new T.BufferAttribute(new Float32Array(capacity * size), size).setUsage(T.DynamicDrawUsage))
      changed.add(name)
      if (stats) stats.bufferAllocations++
    }
    geometry.getAttribute(name).count = count
  }
  return {
    set(name, offset, value) {
      const array = geometry.getAttribute(name).array, rounded = Math.fround(value)
      if (array[offset] !== rounded) { array[offset] = rounded; changed.add(name) }
      return rounded
    },
    finish() {
      geometry.setDrawRange(0, count)
      geometry.userData.activeVertexCount = count
      for (const name of changed) {
        const attribute = geometry.getAttribute(name)
        attribute.clearUpdateRanges()
        if (count) attribute.addUpdateRange(0, count * attribute.itemSize)
        attribute.needsUpdate = true
      }
      // BufferGeometry.computeBounding* normally sees the entire attribute.
      // Explicit live counts/bounds exclude old tail data after a path shrinks.
      const box = geometry.boundingBox, sphere = geometry.boundingSphere
      box.makeEmpty()
      const position = geometry.getAttribute('position')?.array
      for (let i = 0; i < count * 3; i += 3) {
        box.min.x = Math.min(box.min.x, position[i]); box.max.x = Math.max(box.max.x, position[i])
        box.min.y = Math.min(box.min.y, position[i + 1]); box.max.y = Math.max(box.max.y, position[i + 1])
        box.min.z = Math.min(box.min.z, position[i + 2]); box.max.z = Math.max(box.max.z, position[i + 2])
      }
      if (!count) { sphere.center.set(0, 0, 0); sphere.radius = 0; return }
      box.getCenter(sphere.center)
      let radiusSquared = 0
      for (let i = 0; i < count * 3; i += 3) radiusSquared = Math.max(radiusSquared,
        (position[i] - sphere.center.x) ** 2 + (position[i + 1] - sphere.center.y) ** 2 + (position[i + 2] - sphere.center.z) ** 2)
      sphere.radius = Math.sqrt(radiusSquared)
    },
  }
}

function updateParametric(T, geometry, rows, columns, sample, stats) {
  const write = writer(T, geometry, Math.max(0, rows - 1) * columns * 6, { position: 3, normal: 3 }, stats)
  let vertex = 0
  const emit = (row, column) => {
    const p = sample(row, column), offset = vertex++ * 3
    write.set('position', offset, p[0]); write.set('position', offset + 1, p[1]); write.set('position', offset + 2, p[2])
    write.set('normal', offset, p[3]); write.set('normal', offset + 1, p[4]); write.set('normal', offset + 2, p[5])
  }
  for (let row = 0; row < rows - 1; row++) for (let column = 0; column < columns; column++) {
    emit(row, column); emit(row, column + 1); emit(row + 1, column + 1)
    emit(row, column); emit(row + 1, column + 1); emit(row + 1, column)
  }
  write.finish()
}

export function updateLathe(T, geometry, profile, segments, stats) {
  const normals = profile.map((p, i) => {
    const a = profile[Math.max(0, i - 1)], b = profile[Math.min(profile.length - 1, i + 1)]
    const dr = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dr, dy) || 1
    return [dy / length, -dr / length]
  })
  updateParametric(T, geometry, profile.length, segments, (row, column) => {
    const angle = column * Math.PI * 2 / segments, [radius, y] = profile[row], [nr, ny] = normals[row]
    return [radius * Math.sin(angle), y, radius * Math.cos(angle), nr * Math.sin(angle), ny, nr * Math.cos(angle)]
  }, stats)
}

export function updateTorus(T, geometry, radius, wire, stats, radial = 8, tubular = 36) {
  updateParametric(T, geometry, radial + 1, tubular, (row, column) => {
    const cross = row * Math.PI * 2 / radial, angle = column * Math.PI * 2 / tubular
    const nx = Math.cos(cross) * Math.cos(angle), ny = Math.cos(cross) * Math.sin(angle), nz = Math.sin(cross)
    return [(radius + wire * Math.cos(cross)) * Math.cos(angle), (radius + wire * Math.cos(cross)) * Math.sin(angle), wire * Math.sin(cross), nx, ny, nz]
  }, stats)
}

export function updateLine(T, geometry, points, dashed, stats) {
  const count = points.length, write = writer(T, geometry, count, dashed ? { position: 3, lineDistance: 1 } : { position: 3 }, stats)
  let distance = 0, previous
  for (let i = 0; i < count; i++) {
    const p = points[i], offset = i * 3
    const x = write.set('position', offset, p.x), y = write.set('position', offset + 1, p.y), z = write.set('position', offset + 2, p.z ?? 0)
    if (dashed) {
      if (previous) distance += Math.hypot(x - previous[0], y - previous[1], z - previous[2])
      write.set('lineDistance', i, distance)
      previous = [x, y, z]
    }
  }
  geometry.userData.sampleCount = count
  write.finish()
}

export function updateCircle(T, geometry, at, radius, start, end, dashed, stats) {
  const count = 65, write = writer(T, geometry, count, dashed ? { position: 3, lineDistance: 1 } : { position: 3 }, stats)
  let distance = 0, px, py, pz
  for (let i = 0; i < count; i++) {
    const angle = start + (end - start) * i / (count - 1)
    const x = write.set('position', i * 3, at.x + radius * Math.cos(angle))
    const y = write.set('position', i * 3 + 1, at.y + radius * Math.sin(angle))
    const z = write.set('position', i * 3 + 2, at.z ?? 0)
    if (dashed) {
      if (i) distance += Math.hypot(x - px, y - py, z - pz)
      write.set('lineDistance', i, distance)
      px = x; py = y; pz = z
    }
  }
  write.finish()
}

/** Piecewise straight tube: no spline, resampling, invented motion or corner cut. */
export function updateTube(T, geometry, points, radius, stats, sides = 6) {
  let segments = 0
  for (let i = 1; i < points.length; i++) if (Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, (points[i].z ?? 0) - (points[i - 1].z ?? 0)) > 0) segments++
  const count = segments * sides * 6, write = writer(T, geometry, count, { position: 3, normal: 3 }, stats)
  let vertex = 0
  const emit = (p, nx, ny, nz) => {
    const offset = vertex++ * 3
    write.set('position', offset, p.x + radius * nx); write.set('position', offset + 1, p.y + radius * ny); write.set('position', offset + 2, (p.z ?? 0) + radius * nz)
    write.set('normal', offset, nx); write.set('normal', offset + 1, ny); write.set('normal', offset + 2, nz)
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    const dx = b.x - a.x, dy = b.y - a.y, dz = (b.z ?? 0) - (a.z ?? 0), length = Math.hypot(dx, dy, dz)
    if (!length) continue
    const tx = dx / length, ty = dy / length, tz = dz / length
    // Cross the direction with an axis that is not parallel to it.
    let nx = Math.abs(ty) < 0.9 ? -tz : 0, ny = Math.abs(ty) < 0.9 ? 0 : tz, nz = Math.abs(ty) < 0.9 ? tx : -ty
    const normalLength = Math.hypot(nx, ny, nz)
    nx /= normalLength; ny /= normalLength; nz /= normalLength
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx
    for (let j = 0; j < sides; j++) {
      const angle = j * Math.PI * 2 / sides, next = (j + 1) * Math.PI * 2 / sides
      const x1 = nx * Math.cos(angle) + bx * Math.sin(angle), y1 = ny * Math.cos(angle) + by * Math.sin(angle), z1 = nz * Math.cos(angle) + bz * Math.sin(angle)
      const x2 = nx * Math.cos(next) + bx * Math.sin(next), y2 = ny * Math.cos(next) + by * Math.sin(next), z2 = nz * Math.cos(next) + bz * Math.sin(next)
      emit(a, x1, y1, z1); emit(b, x1, y1, z1); emit(b, x2, y2, z2)
      emit(a, x1, y1, z1); emit(b, x2, y2, z2); emit(a, x2, y2, z2)
    }
  }
  geometry.userData.sampleCount = points.length
  geometry.userData.pathKind = 'polyline'
  write.finish()
  return count > 0
}

const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
function triangulate(points) {
  const indices = points.map((_, i) => i), triangles = []
  const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y }, 0)
  if (!Number.isFinite(area) || Math.abs(area) < 1e-14) return []
  if (area < 0) indices.reverse()
  let attempts = indices.length ** 2
  while (indices.length > 3 && attempts-- > 0) {
    let found = false
    for (let i = 0; i < indices.length; i++) {
      const a = indices[(i + indices.length - 1) % indices.length], b = indices[i], c = indices[(i + 1) % indices.length]
      if (cross(points[a], points[b], points[c]) <= 1e-14) continue
      if (indices.some(k => k !== a && k !== b && k !== c && cross(points[a], points[b], points[k]) >= -1e-14 && cross(points[b], points[c], points[k]) >= -1e-14 && cross(points[c], points[a], points[k]) >= -1e-14)) continue
      triangles.push([a, b, c]); indices.splice(i, 1); found = true; break
    }
    if (!found) throw new Error('Invalid apparatus polygon')
  }
  if (indices.length === 3) triangles.push(indices)
  return triangles
}

export function updatePolygon(T, geometry, points, depth, stats) {
  const triangles = triangulate(points), count = triangles.length ? triangles.length * 6 + points.length * 6 : 0
  const write = writer(T, geometry, count, { position: 3, normal: 3 }, stats)
  const z = points[0].z ?? 0, bottom = z - depth / 2, top = z + depth / 2
  let vertex = 0
  const emit = (p, height, nx, ny, nz) => {
    const offset = vertex++ * 3
    write.set('position', offset, p.x); write.set('position', offset + 1, p.y); write.set('position', offset + 2, height)
    write.set('normal', offset, nx); write.set('normal', offset + 1, ny); write.set('normal', offset + 2, nz)
  }
  for (const [a, b, c] of triangles) {
    for (const k of [a, b, c]) emit(points[k], top, 0, 0, 1)
    for (const k of [c, b, a]) emit(points[k], bottom, 0, 0, -1)
  }
  if (count) for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1
    const nx = dy / length, ny = -dx / length
    emit(a, bottom, nx, ny, 0); emit(b, bottom, nx, ny, 0); emit(b, top, nx, ny, 0)
    emit(a, bottom, nx, ny, 0); emit(b, top, nx, ny, 0); emit(a, top, nx, ny, 0)
  }
  write.finish()
  return count > 0
}
