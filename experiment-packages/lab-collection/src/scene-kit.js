import * as THREE from '../vendor/three.module.js'
import { createResourceOwner, ownObjectResources, disposeObjectResources } from './render-resources.js'
import { dynamicGeometry, updateLine, updateCircle, updateTube, updatePolygon, updateLathe, updateTorus } from './retained-geometry.js'

export const palette = Object.freeze({ ink: '#23312f', muted: '#77847b', metal: '#b8c1c1', green: '#315e52', blue: '#477d9e', orange: '#c69c53', red: '#b6654f', wood: '#b99b74', glass: '#c6e4df', purple: '#9b84b5' })
export const roleColor = role => ({ velocity: palette.blue, 'velocity-component': '#86aec4', acceleration: palette.orange, force: palette.red, gravity: '#727b87', normal: palette.green, friction: palette.purple, 'net-force': '#c48247', 'electric-force': palette.blue, 'magnetic-force': palette.purple, trajectory: palette.green, field: '#90afa6', spring: palette.orange, tension: palette.blue })[role] ?? palette.ink
const positive = n => Number.isFinite(n) && n > 0
const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.z === undefined || Number.isFinite(p.z))
const pointInto = (target, p) => target.set(p.x, p.y, p.z ?? 0)
const kits = new WeakMap()

function materialClass(type) {
  return type === 'basic' ? THREE.MeshBasicMaterial : type === 'standard' ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial
}

// All mutable materials are private to an entity/part. Common overlays and an
// adapter's finish() may safely change them without affecting another bulb.
function updateMaterial(material, color, opts, unit, line = false) {
  material.color?.set(color ?? palette.ink)
  const opacity = opts.opacity ?? 1
  const values = {
    opacity, transparent: line || opacity < 1, depthTest: opts.depthTest ?? true,
    depthWrite: opts.depthWrite ?? (line ? true : opacity >= 0.8),
    side: opts.side ?? THREE.DoubleSide, toneMapped: opts.toneMapped ?? true,
    roughness: opts.roughness ?? (color === palette.metal ? 0.24 : 0.43),
    metalness: opts.metalness ?? (color === palette.metal ? 0.85 : color === palette.orange ? 0.62 : 0.06),
    clearcoat: opts.clearcoat ?? 0.2, clearcoatRoughness: opts.clearcoatRoughness ?? 0.32,
    emissiveIntensity: opts.emissiveIntensity ?? 1, wireframe: opts.wireframe ?? false,
    dashSize: opts.dashSize ?? unit * 0.12, gapSize: opts.gapSize ?? unit * 0.08,
  }
  for (const [name, value] of Object.entries(values)) if (name in material && material[name] !== value) {
    material[name] = value
    if (['transparent', 'side', 'toneMapped', 'wireframe'].includes(name)) material.needsUpdate = true
  }
  material.emissive?.set(opts.emissive ?? '#000000')
  // Maps are borrowed unless explicitly supplied in ownedTextures. A material
  // does not own the environment target or another display's texture.
  for (const name of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'emissiveMap']) if (name in material) {
    const value = opts[name] ?? null
    if (material[name] !== value) { material[name] = value; material.needsUpdate = true }
  }
}

function transform(object, at, opts, scale = { x: 1, y: 1, z: 1 }) {
  pointInto(object.position, at)
  object.rotation.set(0, 0, (opts.rotation ?? 0) * Math.PI / 180)
  if (opts.rotation3D) object.rotation.set((opts.rotation3D.x ?? 0) * Math.PI / 180, (opts.rotation3D.y ?? 0) * Math.PI / 180, (opts.rotation3D.z ?? 0) * Math.PI / 180)
  if (opts.quaternion) object.quaternion.set(opts.quaternion.x, opts.quaternion.y, opts.quaternion.z, opts.quaternion.w).normalize()
  const extra = opts.scale3D ?? opts.scale
  object.scale.set(scale.x * (extra?.x ?? 1), scale.y * (extra?.y ?? 1), scale.z * (extra?.z ?? 1))
}

const axisRotation = new THREE.Quaternion(), axisEuler = new THREE.Euler()
function transformAxis(object, at, opts, defaultAxis) {
  transform(object, at, opts)
  if (opts.quaternion) return
  const axis = opts.axis ?? defaultAxis
  if (defaultAxis === 'y') axisEuler.set(axis === 'z' ? Math.PI / 2 : 0, 0, axis === 'x' ? -Math.PI / 2 : 0)
  else axisEuler.set(axis === 'y' ? Math.PI / 2 : 0, axis === 'x' ? Math.PI / 2 : 0, 0)
  axisRotation.setFromEuler(axisEuler)
  // Local primitive axis, then the apparatus' supplied world XY rotation.
  object.quaternion.multiply(axisRotation)
}

function roundedBox() {
  const r = 0.09, shape = new THREE.Shape()
  shape.moveTo(r, r); shape.lineTo(1 - r, r); shape.lineTo(1 - r, 1 - r); shape.lineTo(r, 1 - r); shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1 - 2 * r, steps: 1, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 3, curveSegments: 3 })
  geometry.translate(-0.5, -0.5, -0.5 + r)
  geometry.attributes.position.setUsage(THREE.DynamicDrawUsage)
  geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage)
  return geometry
}

function resizeRoundedBox(entry, width, height, depth) {
  if (entry.dimensions?.[0] === width && entry.dimensions[1] === height && entry.dimensions[2] === depth) return
  const geometry = entry.object.geometry, attribute = geometry.attributes.position
  entry.template ??= attribute.array.slice()
  const dimensions = [width, height, depth], r = Math.min(width, height, depth) * 0.09
  for (let i = 0; i < attribute.array.length; i++) {
    const p = entry.template[i], core = dimensions[i % 3] / 2 - r
    attribute.array[i] = Math.abs(p) <= 0.41 ? p / 0.41 * core : Math.sign(p) * (core + (Math.abs(p) - 0.41) / 0.09 * r)
  }
  attribute.clearUpdateRanges(); attribute.addUpdateRange(0, attribute.array.length); attribute.needsUpdate = true
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere()
  entry.dimensions = dimensions
}

/**
 * One kit per display. scope/entity/part are identity, tag is only a readable
 * name. Legacy calls use factory-local slots inside their scope; adapters can
 * progressively replace slots with opts.key without collapsing repeated tags.
 */
export function createSceneKit(initialView) {
  const group = new THREE.Group(), labels = [], objects = [], entries = new Map(), labelEntries = new Map()
  const counters = new Map(), claimed = new Set(), path = []
  const stats = { frames: 0, meshAllocations: 0, geometryAllocations: 0, materialAllocations: 0, bufferAllocations: 0, bufferGrowths: 0, labelAllocations: 0, retiredParts: 0 }
  let view, unit, epoch = 0, closed = false, namespace = ''
  const origin = { x: 0, y: 0, z: 0 }, a = new THREE.Vector3(), b = new THREE.Vector3(), direction = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0)

  const identity = (kind, opts = {}) => {
    if (closed) throw new Error('Scene kit is disposed')
    let suffix
    if (opts.key !== undefined) {
      if (!['string', 'number'].includes(typeof opts.key)) throw new Error('Part key must be a string or number')
      suffix = ['part', String(opts.key)]
    } else {
      const bucket = JSON.stringify([path, kind]), slot = counters.get(bucket) ?? 0
      counters.set(bucket, slot + 1); suffix = ['slot', kind, slot]
    }
    const key = JSON.stringify([namespace, kind === 'label' ? 'label' : 'object', path, suffix])
    if (claimed.has(key)) throw new Error(`Duplicate retained part identity: ${key}`)
    claimed.add(key)
    return key
  }
  const hide = key => {
    const entry = entries.get(key)
    if (entry) {
      entry.object.visible = false; entry.seen = epoch; entry.active = false
      const geometry = entry.object.geometry
      if (geometry?.userData.capacity !== undefined) {
        geometry.setDrawRange(0, 0); geometry.userData.activeVertexCount = 0; geometry.userData.sampleCount = 0
        geometry.boundingBox.makeEmpty(); geometry.boundingSphere.center.set(0, 0, 0); geometry.boundingSphere.radius = 0
        for (const attribute of Object.values(geometry.attributes)) attribute.count = 0
      }
    }
    return undefined
  }
  const acquire = (key, kind, make) => {
    let entry = entries.get(key)
    if (entry && entry.kind !== kind) {
      group.remove(entry.object); entry.owner.dispose(); entries.delete(key); stats.retiredParts++
      entry = undefined
    }
    if (!entry) {
      const object = make(), owner = createResourceOwner()
      ownObjectResources(owner, object)
      entry = { object, owner, kind, seen: epoch, active: true }
      entries.set(key, entry)
      object.userData.retainedKey = key
      object.traverse(child => {
        if (child.isMesh || child.isLine) stats.meshAllocations++
        if (child.geometry) stats.geometryAllocations++
        stats.materialAllocations += (Array.isArray(child.material) ? child.material : child.material ? [child.material] : []).length
      })
    }
    entry.seen = epoch; entry.active = true
    return entry
  }
  const activate = (entry, opts) => {
    const object = entry.object
    object.name = opts.tag ?? ''
    object.visible = opts.visible !== false
    entry.active = object.visible
    object.renderOrder = opts.renderOrder ?? 0
    if (object.isMesh) {
      object.castShadow = opts.castShadow ?? (opts.opacity ?? 1) >= 0.8
      object.receiveShadow = opts.receiveShadow ?? true
    }
    if (object.parent !== group) group.add(object)
    objects.push(object)
    for (const texture of opts.ownedTextures ?? []) entry.owner.own(texture)
    return object
  }
  const meshEntry = (key, kind, geometry, color, opts) => {
    const type = opts.materialType ?? 'physical'
    const entry = acquire(key, kind, () => new THREE.Mesh(geometry(), new (materialClass(type))()))
    if (entry.materialType !== undefined && entry.materialType !== type) {
      entry.owner.release(entry.object.material)
      entry.object.material = entry.owner.own(new (materialClass(type))()); stats.materialAllocations++
    }
    entry.materialType = type
    updateMaterial(entry.object.material, color, opts, unit)
    return entry
  }
  const lineEntry = (key, kind, color, opts) => {
    const dashed = opts.dashed === true
    const entry = acquire(key, kind, () => new THREE.Line(dynamicGeometry(THREE), dashed ? new THREE.LineDashedMaterial() : new THREE.LineBasicMaterial()))
    if (entry.dashed !== undefined && entry.dashed !== dashed) {
      entry.owner.release(entry.object.material)
      entry.object.material = entry.owner.own(dashed ? new THREE.LineDashedMaterial() : new THREE.LineBasicMaterial()); stats.materialAllocations++
    }
    entry.dashed = dashed
    updateMaterial(entry.object.material, color, opts, unit, true)
    transform(entry.object, origin, opts)
    return entry
  }
  const retire = (key, entry) => {
    group.remove(entry.object); entry.owner.dispose(); entries.delete(key); stats.retiredParts++
  }
  const clear = () => {
    for (const [key, entry] of entries) retire(key, entry)
    labelEntries.clear(); labels.length = 0; objects.length = 0
    // Compatibility for legacy direct group.add; upgraded apparatus factories
    // use customMesh's lazy geometry factory instead.
    disposeObjectResources(group); group.clear()
  }
  const scope = (key, draw) => {
    if (!['string', 'number'].includes(typeof key) || String(key).length === 0 || typeof draw !== 'function') throw new Error('Invalid retained entity scope')
    path.push(String(key))
    try { return draw(kit) } finally { path.pop() }
  }

  const kit = {
    THREE, group, labels, objects, palette, stats,
    get unit() { return unit },
    get disposed() { return closed },
    get retainedPartCount() { return entries.size },
    scope, entity: scope, part: scope,
    beginFrame(nextView, nextNamespace = namespace) {
      if (closed) throw new Error('Scene kit is disposed')
      if (!positive(nextView?.extent?.width) || !positive(nextView.extent.height)) throw new Error('Invalid observation extent')
      if (String(nextNamespace) !== namespace) { clear(); namespace = String(nextNamespace) }
      view = nextView; unit = Math.max(view.extent.width, view.extent.height) / 12
      epoch++; stats.frames++; path.length = 0; counters.clear(); claimed.clear(); labels.length = 0; objects.length = 0
      for (const entry of entries.values()) { entry.object.visible = false; entry.active = false }
      return kit
    },
    endFrame() {
      let inactive = 0
      for (const [key, entry] of entries) if (!entry.active) {
        group.remove(entry.object)
        // A bounded inactive cache lets observables toggle without allocating,
        // while ever-new wavefront/particle IDs cannot leak a whole session.
        if (epoch - entry.seen > 120 || ++inactive > 512) retire(key, entry)
      }
      for (const [key, entry] of labelEntries) if (epoch - entry.seen > 120) labelEntries.delete(key)
      group.updateMatrixWorld(true)
      return kit
    },
    bounds(predicate = () => true, target = new THREE.Box3()) {
      target.makeEmpty(); group.updateWorldMatrix(true, true)
      const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert(), matrix = new THREE.Matrix4(), box = new THREE.Box3()
      for (const object of objects) if (object.visible && predicate(object)) object.traverse(child => {
        if (!child.visible || !child.geometry) return
        const geometry = child.geometry
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return
        // Strip the display/camera normalization, retaining apparatus-local
        // rotations/scales and dynamic live-sample bounds.
        matrix.multiplyMatrices(inverse, child.matrixWorld)
        target.union(box.copy(geometry.boundingBox).applyMatrix4(matrix))
      })
      return target
    },
    visible: key => view.visible?.[key] !== false,
    box(at, width, height, depth, color, opts = {}) {
      const key = identity('box', opts)
      if (!finitePoint(at) || ![width, height, depth].every(positive)) return hide(key)
      const kind = opts.rounded === false ? 'box' : 'rounded-box'
      const entry = meshEntry(key, kind, () => kind === 'box' ? new THREE.BoxGeometry(width, height, depth) : roundedBox(), color, opts)
      let scale
      if (kind === 'rounded-box') resizeRoundedBox(entry, width, height, depth)
      else { entry.base ??= [width, height, depth]; scale = { x: width / entry.base[0], y: height / entry.base[1], z: depth / entry.base[2] } }
      transform(entry.object, at, opts, scale)
      return activate(entry, opts)
    },
    sphere(at, radius, color, opts = {}) {
      const key = identity('sphere', opts)
      if (!finitePoint(at) || !positive(radius)) return hide(key)
      const entry = meshEntry(key, 'sphere', () => new THREE.SphereGeometry(radius, 32, 20), color, opts)
      entry.radius ??= radius
      const ratio = radius / entry.radius
      transform(entry.object, at, opts, { x: ratio, y: ratio, z: ratio })
      return activate(entry, opts)
    },
    ellipsoid(at, rx, ry, rz, color, opts = {}) {
      const key = identity('ellipsoid', opts)
      if (!finitePoint(at) || ![rx, ry, rz].every(positive)) return hide(key)
      const entry = meshEntry(key, 'ellipsoid', () => new THREE.SphereGeometry(1, 32, 20), color, opts)
      transform(entry.object, at, opts, { x: rx, y: ry, z: rz })
      return activate(entry, opts)
    },
    cylinder(from, to, radius, color, opts = {}) {
      const key = identity('cylinder', opts)
      if (!finitePoint(from) || !finitePoint(to) || !positive(radius)) return hide(key)
      pointInto(a, from); pointInto(b, to); direction.copy(b).sub(a)
      const length = direction.length()
      if (!positive(length)) return hide(key)
      const top = opts.radiusTop ?? radius, bottom = opts.radiusBottom ?? radius
      if (![top, bottom].every(n => Number.isFinite(n) && n >= 0) || Math.max(top, bottom) <= 0) return hide(key)
      const entry = meshEntry(key, 'cylinder', () => new THREE.CylinderGeometry(radius, radius, length, opts.segments ?? 24, 1, opts.openEnded ?? false), color, opts)
      entry.base ??= { radius, length }
      const object = entry.object
      if (entry.top !== top || entry.bottom !== bottom || entry.length !== length) {
        const geometry = object.geometry, positions = geometry.attributes.position
        entry.template ??= positions.array.slice()
        for (let i = 0; i < positions.array.length; i += 3) {
          const fraction = entry.template[i + 1] / entry.base.length + 0.5, width = bottom + (top - bottom) * fraction
          positions.array[i] = entry.template[i] * width / entry.base.radius
          positions.array[i + 1] = entry.template[i + 1] * length / entry.base.length
          positions.array[i + 2] = entry.template[i + 2] * width / entry.base.radius
        }
        positions.setUsage(THREE.DynamicDrawUsage); positions.clearUpdateRanges(); positions.addUpdateRange(0, positions.array.length); positions.needsUpdate = true
        geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere()
        entry.top = top; entry.bottom = bottom; entry.length = length
      }
      object.position.copy(a).add(b).multiplyScalar(0.5)
      object.quaternion.setFromUnitVectors(up, direction.multiplyScalar(1 / length))
      object.scale.set(1, 1, 1)
      if (opts.quaternion) object.quaternion.set(opts.quaternion.x, opts.quaternion.y, opts.quaternion.z, opts.quaternion.w).normalize()
      return activate(entry, opts)
    },
    lathe(at, profile, color, opts = {}) {
      const key = identity('lathe', opts), segments = Math.max(3, Math.min(128, Math.floor(opts.segments ?? 32)))
      if (!finitePoint(at) || !Array.isArray(profile) || profile.length < 2 || !profile.every(p => Array.isArray(p) && Number.isFinite(p[0]) && p[0] >= 0 && Number.isFinite(p[1]))) return hide(key)
      const entry = meshEntry(key, 'lathe', () => dynamicGeometry(THREE), color, opts)
      updateLathe(THREE, entry.object.geometry, profile, segments, stats)
      transformAxis(entry.object, at, opts, 'y')
      return activate(entry, opts)
    },
    torus(at, radius, wire, color, opts = {}) {
      const key = identity('torus', opts)
      if (!finitePoint(at) || !positive(radius) || !positive(wire)) return hide(key)
      const entry = meshEntry(key, 'torus', () => dynamicGeometry(THREE), color, opts)
      updateTorus(THREE, entry.object.geometry, radius, wire, stats)
      transformAxis(entry.object, at, opts, 'z')
      return activate(entry, opts)
    },
    line(points, color, opts = {}) {
      const key = identity('line', opts)
      if (!Array.isArray(points) || points.length < 2 || !points.every(finitePoint)) return hide(key)
      const entry = lineEntry(key, 'line', color, opts)
      updateLine(THREE, entry.object.geometry, points, entry.dashed, stats)
      return activate(entry, opts)
    },
    tube(points, radius, color, opts = {}) {
      const key = identity('tube', opts)
      if (!Array.isArray(points) || points.length < 2 || !points.every(finitePoint) || !positive(radius)) return hide(key)
      const entry = meshEntry(key, 'tube', () => dynamicGeometry(THREE), color, opts)
      transform(entry.object, origin, opts)
      if (!updateTube(THREE, entry.object.geometry, points, radius, stats, opts.sides ?? 6)) return hide(key)
      return activate(entry, opts)
    },
    arrow(from, to, color, opts = {}) {
      const key = identity('arrow', opts)
      if (!finitePoint(from) || !finitePoint(to)) return hide(key)
      pointInto(a, from); pointInto(direction, to).sub(a)
      const length = direction.length()
      if (!positive(length)) return hide(key)
      const entry = acquire(key, 'arrow', () => {
        const object = new THREE.ArrowHelper(up, origin, 1, color)
        // ArrowHelper's module-global geometries are borrowed. Each part owns
        // clones so retiring one arrow cannot dispose every other arrow's GPU.
        object.line.geometry = object.line.geometry.clone()
        object.cone.geometry = object.cone.geometry.clone()
        return object
      })
      const object = entry.object, head = Math.min(unit * 0.15, length * 0.28)
      object.position.copy(a); object.scale.set(1, 1, 1)
      object.setDirection(direction.multiplyScalar(1 / length)); object.setLength(length, head, head * 0.52)
      // ArrowHelper clamps the shaft to .0001; a scientific tiny vector must
      // not acquire a nonzero shaft longer than its supplied endpoint.
      object.line.scale.y = Math.max(0, length - head)
      object.line.renderOrder = object.cone.renderOrder = opts.renderOrder ?? 0
      updateMaterial(object.line.material, color, opts, unit, true)
      updateMaterial(object.cone.material, color, opts, unit)
      object.cone.castShadow = opts.castShadow ?? false
      object.cone.receiveShadow = opts.receiveShadow ?? false
      return activate(entry, opts)
    },
    circle(at, radius, color, opts = {}) {
      const key = identity('circle', opts)
      if (!finitePoint(at) || !positive(radius) || !Number.isFinite(opts.start ?? 0) || !Number.isFinite(opts.end ?? Math.PI * 2)) return hide(key)
      const entry = lineEntry(key, 'circle', color, opts)
      updateCircle(THREE, entry.object.geometry, at, radius, opts.start ?? 0, opts.end ?? Math.PI * 2, entry.dashed, stats)
      return activate(entry, opts)
    },
    polygon(points, depth, color, opts = {}) {
      const key = identity('polygon', opts)
      if (!Array.isArray(points) || points.length < 3 || !points.every(finitePoint) || !positive(depth)) return hide(key)
      const entry = meshEntry(key, 'polygon', () => dynamicGeometry(THREE), color, opts)
      transform(entry.object, origin, opts)
      if (!updatePolygon(THREE, entry.object.geometry, points, depth, stats)) return hide(key)
      return activate(entry, opts)
    },
    customMesh(at, color, opts = {}) {
      const key = identity('customMesh', opts)
      if (!finitePoint(at)) return hide(key)
      if (typeof opts.geometry !== 'function' || opts.geometryKey === undefined) throw new Error('customMesh requires a lazy geometry factory and geometryKey')
      const entry = meshEntry(key, 'customMesh', opts.geometry, color, opts)
      if (entry.geometryKey !== undefined && entry.geometryKey !== opts.geometryKey) {
        const geometry = opts.geometry()
        entry.owner.release(entry.object.geometry); entry.object.geometry = entry.owner.own(geometry); stats.geometryAllocations++
      }
      entry.geometryKey = opts.geometryKey
      transform(entry.object, at, opts)
      return activate(entry, opts)
    },
    add(factory, opts = {}) {
      const key = identity('add', opts)
      const existing = entries.get(key)
      // Prefer a lazy factory. The object overload is retained for old callers
      // but cannot undo allocations already performed outside the kit.
      const entry = acquire(key, 'add', () => typeof factory === 'function' ? factory() : factory)
      if (existing && typeof factory !== 'function' && factory !== entry.object) { disposeObjectResources(factory); factory.removeFromParent() }
      opts.update?.(entry.object)
      return activate(entry, opts)
    },
    label(text, at, opts = {}) {
      const key = identity('label', opts)
      if (text === undefined || text === null || String(text).length === 0 || !finitePoint(at)) return
      let entry = labelEntries.get(key)
      if (!entry) {
        entry = { key, at: new THREE.Vector3() }; labelEntries.set(key, entry); stats.labelAllocations++
      }
      entry.seen = epoch; entry.text = String(text); pointInto(entry.at, at)
      entry.color = opts.color ?? palette.ink; entry.size = opts.size ?? 11; entry.priority = opts.priority ?? 1; entry.tag = opts.tag
      if (finitePoint(opts.from)) { entry.from ??= new THREE.Vector3(); pointInto(entry.from, opts.from) }
      else entry.from = undefined
      labels.push(entry)
      return entry
    },
    dispose() {
      if (closed) return
      closed = true; clear(); counters.clear(); claimed.clear(); path.length = 0
    },
  }
  kits.set(group, kit)
  kit.beginFrame(initialView)
  return kit
}

export function disposeGroup(group) {
  const kit = kits.get(group)
  if (kit) { kit.dispose(); return }
  disposeObjectResources(group)
  group.clear()
}

/** Fit the actual camera-plane projections, preserving one scale on all axes. */
export function fitCameraToBox(camera, span, aspect, padding = 1.11) {
  camera.updateMatrixWorld(true)
  let width = 0, height = 0
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const p = new THREE.Vector3(x * span.x / 2, y * span.y / 2, z * span.z / 2).applyMatrix4(camera.matrixWorldInverse)
    width = Math.max(width, Math.abs(p.x)); height = Math.max(height, Math.abs(p.y))
  }
  const half = Math.max(height, width / aspect, 0.01) * padding
  camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half
  camera.updateProjectionMatrix()
}
