import * as THREE from 'three'
import type { ExperimentIntent, ExperimentSnapshot } from './protocol.js'

/** Only presents host-provided facts. All dimensions below are display centimetres. */
export function mountLens(
  host: HTMLElement,
  send: (intent: ExperimentIntent) => void,
): {
  update: (snapshot: ExperimentSnapshot) => void
  dispose: () => void
} {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.setAttribute('aria-label', '三维凸透镜装置，参数由宿主控件调整')
  renderer.domElement.setAttribute('role', 'img')
  host.append(renderer.domElement)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#f7f5ed')
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb4a58e, 2.5))
  const light = new THREE.DirectionalLight(0xfff4da, 3)
  light.position.set(-35, 55, 65)
  scene.add(light)
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500)
  let yaw = -0.38
  const root = new THREE.Group()
  scene.add(root)
  const material = (color: number): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
  const addBox = (
    parent: THREE.Object3D,
    size: readonly [number, number, number],
    color: number,
    y = 0,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color))
    mesh.position.y = y
    parent.add(mesh)
    return mesh
  }
  addBox(root, [125, 1, 30], 0xd8c4a2, -12)
  addBox(root, [110, 1, 8], 0x53636b, -10)
  const stand = (): THREE.Group => {
    const group = new THREE.Group()
    addBox(group, [6, 1.5, 7], 0x567d70, -8.8)
    addBox(group, [0.6, 8, 0.6], 0x8b989d, -4.5)
    root.add(group)
    return group
  }
  const object = stand()
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 5, 20), material(0xf3e8cc))
  candle.position.y = 2.5
  object.add(candle)
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xf3b45c }),
  )
  flame.scale.set(0.65, 1.4, 0.65)
  flame.position.y = 5.7
  object.add(flame)
  const lens = stand()
  const ring = new THREE.Mesh(new THREE.TorusGeometry(8, 0.3, 12, 48), material(0x5e7277))
  ring.rotation.y = Math.PI / 2
  lens.add(ring)
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(8, 32, 24),
    new THREE.MeshPhysicalMaterial({
      color: 0x9ec9cc,
      transparent: true,
      opacity: 0.24,
      roughness: 0.1,
      depthWrite: false,
    }),
  )
  glass.scale.set(0.12, 1, 1)
  lens.add(glass)
  const screen = stand()
  addBox(screen, [0.6, 17, 13], 0xf8f7ef)
  const image = new THREE.Group()
  root.add(image)
  const imageArrow = addBox(image, [0.28, 1, 0.28], 0x689588)
  let last: ExperimentSnapshot | undefined
  let disposed = false
  let scheduled: number | undefined
  const draw = (): void => {
    if (disposed || document.hidden || scheduled !== undefined) return
    scheduled = requestAnimationFrame(() => {
      scheduled = undefined
      if (!disposed) renderer.render(scene, camera)
    })
  }
  const resize = (): void => {
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    const distance = Math.max(115, 74 / camera.aspect)
    camera.position.set(Math.sin(yaw) * distance, 40, Math.cos(yaw) * distance)
    camera.lookAt(0, -3, 0)
    draw()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  let pointer: { x: number; yaw: number } | undefined
  const down = (event: PointerEvent): void => {
    if (event.button !== 0) return
    pointer = { x: event.clientX, yaw }
    renderer.domElement.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent): void => {
    if (!pointer) return
    yaw = Math.max(-0.8, Math.min(0.8, pointer.yaw + (event.clientX - pointer.x) * 0.006))
    resize()
  }
  const up = (): void => {
    pointer = undefined
  }
  const lost = (event: Event): void => {
    event.preventDefault()
    send({ type: 'parameter/cancel' })
    host.dataset.error = '三维上下文已丢失，请在预览器重新载入实验。'
  }
  const visibility = (): void => {
    if (document.hidden && scheduled !== undefined) {
      cancelAnimationFrame(scheduled)
      scheduled = undefined
    } else draw()
  }
  renderer.domElement.addEventListener('pointerdown', down)
  renderer.domElement.addEventListener('pointermove', move)
  renderer.domElement.addEventListener('pointerup', up)
  renderer.domElement.addEventListener('pointercancel', up)
  renderer.domElement.addEventListener('webglcontextlost', lost)
  document.addEventListener('visibilitychange', visibility)
  resize()
  return {
    update: (snapshot): void => {
      last = snapshot
      object.position.x = -snapshot.parameters.objectDistanceCm
      screen.position.x = snapshot.parameters.screenDistanceCm
      const { imageDistanceCm: x, imageHeightCm: height } = snapshot.result
      image.visible = x !== null && height !== null && Math.abs(x) <= 100 && Math.abs(height) <= 50
      if (x !== null && height !== null) {
        image.position.x = x
        imageArrow.scale.y = Math.abs(height)
        imageArrow.position.y = height / 2
      }
      host.dataset.source = last.source
      draw()
    },
    dispose: (): void => {
      if (disposed) return
      disposed = true
      if (scheduled !== undefined) cancelAnimationFrame(scheduled)
      observer.disconnect()
      document.removeEventListener('visibilitychange', visibility)
      renderer.domElement.removeEventListener('pointerdown', down)
      renderer.domElement.removeEventListener('pointermove', move)
      renderer.domElement.removeEventListener('pointerup', up)
      renderer.domElement.removeEventListener('pointercancel', up)
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      root.traverse((entry) => {
        if (!(entry instanceof THREE.Mesh)) return
        const mesh = entry as THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>
        mesh.geometry.dispose()
        for (const item of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          item.dispose()
      })
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
