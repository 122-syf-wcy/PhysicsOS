import * as THREE from '../vendor/three.module.js'

export const palette = Object.freeze({ ink: '#23312f', muted: '#77847b', metal: '#b8c1c1', green: '#315e52', blue: '#477d9e', orange: '#c69c53', red: '#b6654f', wood: '#b99b74', glass: '#c6e4df', purple: '#9b84b5' })
export const roleColor = role => ({ velocity: palette.blue, 'velocity-component': '#86aec4', acceleration: palette.orange, force: palette.red, gravity: '#727b87', normal: palette.green, friction: palette.purple, 'net-force': '#c48247', 'electric-force': palette.blue, 'magnetic-force': palette.purple, trajectory: palette.green, field: '#90afa6', spring: palette.orange, tension: palette.blue })[role] ?? palette.ink
const point = p => new THREE.Vector3(p.x, p.y, p.z ?? 0)
const positive = n => Number.isFinite(n) && n > 0

export function createSceneKit(view) {
  const group = new THREE.Group(), labels = []
  const unit = Math.max(view.extent.width, view.extent.height) / 12
  const material = (color, opts = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: opts.roughness ?? (color === palette.metal ? 0.24 : 0.43), metalness: opts.metalness ?? (color === palette.metal ? 0.85 : color === palette.orange ? 0.62 : 0.06), clearcoat: opts.clearcoat ?? 0.2, clearcoatRoughness: 0.32, transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1, depthWrite: (opts.opacity ?? 1) >= 0.8, side: THREE.DoubleSide })
  const add = (object, opts = {}) => {
    if (opts.tag) object.name = opts.tag
    if (object.isMesh) { object.castShadow = (opts.opacity ?? 1) >= 0.8; object.receiveShadow = true }
    group.add(object); return object
  }
  const mesh = (geometry, at, color, opts) => {
    const object = new THREE.Mesh(geometry, material(color, opts))
    object.position.copy(point(at)); object.rotation.z = (opts.rotation ?? 0) * Math.PI / 180
    return add(object, opts)
  }
  const kit = {
    THREE, group, labels, unit, palette,
    visible: key => view.visible?.[key] !== false,
    box(at, width, height, depth, color, opts = {}) {
      if (![width, height, depth].every(positive)) return undefined
      if (opts.rounded === false) return mesh(new THREE.BoxGeometry(width, height, depth), at, color, opts)
      const r = Math.min(width, height, depth) * 0.09
      const shape = new THREE.Shape()
      shape.moveTo(r, r); shape.lineTo(width - r, r); shape.lineTo(width - r, height - r); shape.lineTo(r, height - r); shape.closePath()
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: depth - 2 * r, steps: 1, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 3, curveSegments: 3 })
      geometry.translate(-width / 2, -height / 2, -depth / 2 + r)
      return mesh(geometry, at, color, opts)
    },
    sphere(at, radius, color, opts = {}) {
      if (!positive(radius)) return undefined
      return mesh(new THREE.SphereGeometry(radius, 32, 20), at, color, opts)
    },
    cylinder(from, to, radius, color, opts = {}) {
      const a = point(from), b = point(to), direction = b.clone().sub(a), length = direction.length()
      if (!positive(length) || !positive(radius)) return undefined
      const object = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 24), material(color, opts))
      object.position.copy(a.add(b).multiplyScalar(0.5))
      object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
      return add(object, opts)
    },
    line(points, color, opts = {}) {
      if (points.length < 2) return undefined
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point))
      const common = { color, transparent: true, opacity: opts.opacity ?? 1, depthTest: true }
      const stroke = opts.dashed ? new THREE.LineDashedMaterial({ ...common, dashSize: unit * 0.12, gapSize: unit * 0.08 }) : new THREE.LineBasicMaterial(common)
      const line = new THREE.Line(geometry, stroke); if (opts.dashed) line.computeLineDistances()
      return add(line, opts)
    },
    tube(points, radius, color, opts = {}) {
      if (points.length < 2 || !positive(radius)) return undefined
      const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(point), false, 'centripetal'), Math.min(400, Math.max(8, points.length * 2)), radius, 6, false)
      return add(new THREE.Mesh(geometry, material(color, opts)), opts)
    },
    arrow(from, to, color, opts = {}) {
      const start = point(from), direction = point(to).sub(start), length = direction.length()
      if (!positive(length)) return undefined
      const head = Math.min(unit * 0.15, length * 0.28)
      const arrow = new THREE.ArrowHelper(direction.normalize(), start, length, color, head, head * 0.52)
      return add(arrow, opts)
    },
    circle(at, radius, color, opts = {}) {
      if (!positive(radius)) return undefined
      const start = opts.start ?? 0, end = opts.end ?? Math.PI * 2
      return kit.line(Array.from({ length: 65 }, (_, i) => ({ x: at.x + radius * Math.cos(start + (end - start) * i / 64), y: at.y + radius * Math.sin(start + (end - start) * i / 64), z: at.z ?? 0 })), color, opts)
    },
    polygon(points, depth, color, opts = {}) {
      if (points.length < 3 || !positive(depth)) return undefined
      const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, p.y)))
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
      geometry.translate(0, 0, (points[0].z ?? 0) - depth / 2)
      return add(new THREE.Mesh(geometry, material(color, opts)), opts)
    },
    label(text, at, opts = {}) {
      if (text === undefined || text === null || String(text).length === 0) return
      labels.push({ text: String(text), at: point(at), color: opts.color ?? palette.ink, size: opts.size ?? 11, priority: opts.priority ?? 1, tag: opts.tag, from: opts.from === undefined ? undefined : point(opts.from) })
    },
  }
  return kit
}

export function disposeGroup(group) {
  const geometries = new Set(), materials = new Set()
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) materials.add(material)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
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
