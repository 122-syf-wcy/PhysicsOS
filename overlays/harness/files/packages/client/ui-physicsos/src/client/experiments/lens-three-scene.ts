import * as THREE from 'three'
import type { ScenePoint, SceneVisualModel } from '../physics/scene-visual-model.ts'

const LIMIT = 240
const bound = (value: number): number => Math.max(-LIMIT, Math.min(LIMIT, value))

/** Clip an engine ray segment to the viewing volume, without moving its intersection. */
function clipSegment(a: ScenePoint, b: ScenePoint): [THREE.Vector3, THREE.Vector3] | undefined {
  let from = 0
  let to = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return undefined
  for (const [p, q] of [
    [-dx, a.x + LIMIT],
    [dx, LIMIT - a.x],
    [-dy, a.y + 70],
    [dy, 70 - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return undefined
      continue
    }
    const t = q / p
    if (p < 0) from = Math.max(from, t)
    else to = Math.min(to, t)
    if (from > to) return undefined
  }
  return [
    new THREE.Vector3(a.x + from * dx, a.y + from * dy, 0),
    new THREE.Vector3(a.x + to * dx, a.y + to * dy, 0),
  ]
}

function disposeGraph(group: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  group.traverse((object) => {
    const drawable = object as { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] }
    if (drawable.geometry) geometries.add(drawable.geometry)
    if (drawable.material)
      for (const material of Array.isArray(drawable.material)
        ? drawable.material
        : [drawable.material]) {
        materials.add(material)
        const textured = material as THREE.MeshStandardMaterial
        if (textured.map) textures.add(textured.map)
      }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  for (const texture of textures) texture.dispose()
}

function label(text: string, color = '#65778e'): THREE.Sprite | undefined {
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  canvas.width = 384
  canvas.height = 96
  const context = canvas.getContext('2d')
  if (context === null) return undefined
  context.font = '500 32px "PingFang SC", "Noto Sans CJK SC", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = color
  context.fillText(text, 192, 48)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  )
  sprite.scale.set(16, 4, 1)
  sprite.renderOrder = 10
  return sprite
}

/** Small procedural apparatus: no remote model downloads and no physics calculations. Units are cm. */
export function createLensThreeScene(initial: SceneVisualModel) {
  const group = new THREE.Group()
  group.name = 'optical-bench'
  let disposed = false
  let pickables: THREE.Object3D[] = []
  const mesh = (
    geometry: THREE.BufferGeometry,
    color: number,
    roughness = 0.5,
    metalness = 0,
  ): THREE.Mesh =>
    new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness, metalness }))
  const box = (
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: number,
    metalness = 0,
  ): THREE.Mesh => {
    const part = mesh(new THREE.BoxGeometry(w, h, d), color, 0.45, metalness)
    part.position.set(x, y, z)
    parent.add(part)
    return part
  }
  const cylinder = (
    parent: THREE.Object3D,
    r: number,
    h: number,
    x: number,
    y: number,
    z: number,
    color: number,
  ): THREE.Mesh => {
    const part = mesh(new THREE.CylinderGeometry(r, r, h, 24), color)
    part.position.set(x, y, z)
    parent.add(part)
    return part
  }
  const tag = (parent: THREE.Object3D, text: string, x: number, y: number, z = 0): void => {
    const sprite = label(text)
    if (sprite) {
      sprite.position.set(x, y, z)
      parent.add(sprite)
    }
  }
  const base = (parent: THREE.Object3D, color: number): void => {
    box(parent, 7, 1.7, 8, 0, -9.8, 0, color, 0.35)
    cylinder(parent, 0.45, 8, 0, -5, 0, 0xb3becb)
    box(parent, 3.4, 1, 3.4, 0, -0.5, 0, color)
  }
  const update = (view: SceneVisualModel): void => {
    if (disposed) return
    disposeGraph(group)
    group.clear()
    pickables = []
    const object = view.opticalObjects?.[0]
    const element = view.opticalElements?.[0]
    const screen = view.opticalScreens?.[0]
    const lo = Math.max(-LIMIT, Math.min(-55, (object?.at.x ?? -30) - 15))
    const hi = Math.min(LIMIT, Math.max(55, (screen?.at.x ?? 15) + 18))
    const length = hi - lo
    const center = (hi + lo) / 2
    box(group, length + 8, 1.3, 23, center, -12.7, 0, 0xc7a173)
    for (const z of [-3, 3]) box(group, length, 1, 1.2, center, -11, z, 0x94a3b5, 0.7)
    box(group, length, 0.3, 2.3, center, -10.8, 6, 0xf8fafb)
    for (let x = Math.ceil(lo / 5) * 5; x <= hi; x += 5) {
      const major = x % 10 === 0
      box(group, 0.08, 0.08, major ? 1.2 : 0.6, x, -10.59, 5.7, 0x8c9daf)
      if (major) {
        const text = label(String(x))
        if (text) {
          text.position.set(x, -10, 8.5)
          text.scale.set(5, 1.25, 1)
          group.add(text)
        }
      }
    }
    if (object) {
      const candle = new THREE.Group()
      candle.name = 'object'
      candle.position.x = bound(object.at.x)
      candle.userData.parameter = 'object-distance'
      base(candle, 0x58735a)
      const height = Math.max(1, Math.min(40, object.height))
      cylinder(candle, 0.65, Math.max(0.5, height - 1.1), 0, (height - 1.1) / 2, 0, 0xf6efe2)
      const flame = mesh(new THREE.SphereGeometry(0.65, 16, 12), 0xf4a83d)
      flame.scale.set(0.65, 1.3, 0.65)
      flame.position.set(0, height - 0.4, 0)
      candle.add(flame)
      tag(candle, '物体', 0, height + 5)
      group.add(candle)
      pickables.push(candle)
    }
    if (element) {
      const lens = new THREE.Group()
      lens.name = 'lens'
      lens.position.x = bound(element.at.x)
      base(lens, 0x435c48)
      const aperture = Math.max(2, Math.min(25, element.halfAperture))
      const rim = mesh(new THREE.TorusGeometry(aperture, 0.35, 12, 64), 0x526b8d, 0.3, 0.55)
      rim.rotation.y = Math.PI / 2
      lens.add(rim)
      const glass = new THREE.Mesh(
        new THREE.SphereGeometry(aperture, 40, 24),
        new THREE.MeshPhysicalMaterial({
          color: 0x8bc9ed,
          transparent: true,
          opacity: 0.24,
          roughness: 0.12,
          metalness: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      )
      glass.scale.set(0.13, 1, 1)
      lens.add(glass)
      tag(lens, '凸透镜', 0, aperture + 5)
      group.add(lens)
    }
    if (screen) {
      const plate = new THREE.Group()
      plate.name = 'screen'
      plate.position.x = bound(screen.at.x)
      plate.userData.parameter = 'screen-distance'
      base(plate, 0x596c54)
      const half = Math.min(25, screen.halfHeight)
      box(plate, 0.6, half * 2 + 1, 13.5, 0, 0, 0, 0x8798ac)
      box(plate, 0.64, half * 2, 12.5, -0.03, 0, 0, screen.lit ? 0xf1f4ed : 0xf7f8fa)
      tag(plate, '光屏', 0, half + 5)
      group.add(plate)
      pickables.push(plate)
    }
    const image = view.visible.image ? view.opticalImages?.[0] : undefined
    if (image && Math.abs(image.at.x) <= LIMIT && Math.abs(image.height) < 70) {
      const formed = new THREE.Group()
      formed.name = 'image'
      formed.position.x = image.at.x
      formed.userData.nature = image.nature
      const color = image.nature === 'virtual' ? 0x9366bc : 0x3b8f88
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, image.height, 0),
        ]),
        image.nature === 'virtual'
          ? new THREE.LineDashedMaterial({ color, dashSize: 0.8, gapSize: 0.5, depthTest: false })
          : new THREE.LineBasicMaterial({ color, depthTest: false }),
      )
      line.computeLineDistances()
      line.renderOrder = 5
      formed.add(line)
      const head = mesh(new THREE.ConeGeometry(0.65, 1.5, 12), color)
      head.position.y = image.height
      if (image.height < 0) head.rotation.z = Math.PI
      formed.add(head)
      tag(
        formed,
        image.nature === 'virtual' ? '虚像' : '实像',
        0,
        image.height + (image.height < 0 ? -4 : 4),
        4,
      )
      group.add(formed)
    }
    if (view.visible.rays)
      for (const ray of view.opticalRays ?? []) {
        for (const [points, virtual] of [
          [ray.points, false],
          [ray.extension, true],
        ] as const) {
          if (points === undefined) continue
          const segments: THREE.Vector3[] = []
          for (let i = 1; i < points.length; i++) {
            const from = points[i - 1]
            const to = points[i]
            if (from === undefined || to === undefined) continue
            const clipped = clipSegment(from, to)
            if (clipped) segments.push(...clipped)
          }
          if (segments.length === 0) continue
          const material = virtual
            ? new THREE.LineDashedMaterial({
              color: 0xb8a1c5,
              dashSize: 1,
              gapSize: 0.7,
              transparent: true,
              opacity: 0.65,
            })
            : new THREE.LineBasicMaterial({ color: 0xe49a2e, transparent: true, opacity: 0.85 })
          const line = new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(segments),
            material,
          )
          line.computeLineDistances()
          group.add(line)
        }
      }
    for (const mark of view.opticalAxisMarks ?? [])
      if (mark.at.x >= lo && mark.at.x <= hi) {
        const dot = mesh(new THREE.SphereGeometry(0.23, 8, 8), 0x8c9db4)
        dot.position.set(mark.at.x, 0, 0)
        group.add(dot)
        tag(group, mark.label, mark.at.x, -3, 2)
      }
  }
  update(initial)
  return {
    group,
    update,
    get pickables() {
      return pickables
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      disposeGraph(group)
      group.clear()
      pickables = []
    },
  }
}
