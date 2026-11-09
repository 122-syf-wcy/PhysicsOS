import { createSceneKit, disposeGroup, fitCameraToBox, roleColor, palette } from './scene-kit.js'
import { drawMechanics } from './mechanics.js'
import { drawOptics } from './optics.js'
import { drawWaves } from './waves.js'
import { drawMatter } from './matter.js'
import { drawCircuits } from './circuits.js'
import { drawFields } from './fields.js'

let state
const drawDomain = { mechanics: drawMechanics, optics: drawOptics, wave: drawWaves, acoustics: drawWaves, fluid: drawMatter, thermal: drawMatter, modern: drawMatter, circuit: drawCircuits, electric: drawFields, magnetic: drawFields, composite: drawFields, induction: drawFields }
const cleanMath = value => String(value).replace(/\\(?:mathrm|text)\{([^}]+)\}/g, '$1').replace(/\\theta/g, 'θ').replace(/\\mu/g, 'μ').replace(/\\Delta/g, 'Δ').replace(/\\cdot/g, '·').replace(/\\(?:sin|cos)/g, x => x.slice(1)).replace(/[{}]/g, '').replace(/_/g, '')
const comparisonColors = new Map([['comparison-30', '#477d9e'], ['comparison-45', '#b76a28'], ['comparison-60', '#8653a0']])
const comparisonLabelColors = new Map([...comparisonColors].map(([id, color]) => [id.replace('comparison-', 'comparison-label-'), color]))

function common(snapshot, kit) {
  const view = snapshot.view, u = kit.unit
  const front = p => ({ ...p, z: p.z ?? 0 })
  const overlay = object => {
    object?.traverse(child => {
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) if (material) { material.depthTest = false; material.depthWrite = false; child.renderOrder = 20 }
    })
    return object
  }
  for (const trajectory of view.trajectories ?? []) {
    // The wave renderer owns these two incoming fronts and their distinct colors.
    if (trajectory.id === 'wave-formation-left' || trajectory.id === 'wave-formation-right') continue
    const observable = ['optics'].includes(snapshot.domain) ? 'rays' : snapshot.domain === 'wave' ? 'waveform' : 'trajectory'
    if (!kit.visible(observable)) continue
    if (snapshot.domain === 'modern' && !kit.visible(trajectory.id.includes('photon') ? 'photonEnergy' : 'photocurrent')) continue
    overlay(kit.line(trajectory.points.map(front), comparisonColors.get(trajectory.id) ?? roleColor('trajectory'), { dashed: trajectory.kind === 'predicted', opacity: trajectory.kind === 'predicted' ? 0.5 : 0.85, tag: trajectory.id }))
  }
  for (const vector of view.vectors ?? []) {
    if (!kit.visible(vector.observable)) continue
    const arrow = kit.arrow(front(vector.from), front(vector.to), roleColor(vector.role), { tag: vector.id })
    overlay(arrow)
    kit.label(cleanMath(vector.symbol), front(vector.to), { color: roleColor(vector.role), priority: 3, tag: vector.id, from: front(vector.from) })
  }
  if (snapshot.domain !== 'modern') for (const particle of view.particles ?? []) {
    kit.sphere(particle.at, particle.radius, particle.sign === 'negative' ? palette.blue : palette.red, { tag: particle.id })
    kit.label(particle.symbol ?? (particle.sign === 'negative' ? '−' : '+'), front(particle.at), { priority: 4 })
  }
  for (const guide of view.guides ?? []) if (kit.visible(guide.observable)) {
    overlay(kit.line([front(guide.from), front(guide.to)], palette.muted, { dashed: true, opacity: 0.5, tag: guide.id }))
    if (guide.label) kit.label(cleanMath(guide.label), front(guide.to), { color: palette.muted })
  }
  const dimensionVisible = !view.leverBeam || kit.visible('arms')
  for (const dimension of dimensionVisible ? view.dimensions ?? [] : []) {
    if (view.energyRamp && !kit.visible('energyConversion')) continue
    if (view.fluidBlock && dimension.id === 'submerged-height' && !kit.visible('displaced')) continue
    kit.line([front(dimension.from), front(dimension.to)], palette.muted)
    const dx = dimension.to.x - dimension.from.x, dy = dimension.to.y - dimension.from.y, length = Math.hypot(dx, dy)
    const nx = length ? -dy / length * u * 0.06 : 0, ny = length ? dx / length * u * 0.06 : u * 0.06
    for (const p of [dimension.from, dimension.to]) kit.line([front({ x: p.x - nx, y: p.y - ny }), front({ x: p.x + nx, y: p.y + ny })], palette.muted)
    kit.label(cleanMath(dimension.label), front({ x: (dimension.from.x + dimension.to.x) / 2, y: (dimension.from.y + dimension.to.y) / 2 - u * 0.17 }), { color: palette.muted })
  }
  for (const angle of view.angles ?? []) {
    kit.circle(front(angle.at), angle.radius, palette.muted, { start: angle.startAngle * Math.PI / 180, end: angle.endAngle * Math.PI / 180 })
    kit.label(cleanMath(angle.value ?? angle.symbol), front({ x: angle.at.x, y: angle.at.y + angle.radius }), { color: palette.muted })
  }
  for (const label of view.labels ?? []) kit.label(cleanMath(label.text), front(label.at), {
    color: comparisonLabelColors.get(label.id) ?? roleColor(label.role), tag: label.id,
  })
  if (kit.visible('keyPoints')) for (const key of view.keyPoints ?? []) {
    kit.sphere(front(key.at), u * 0.035, palette.orange)
    kit.label(key.label, front(key.at), { priority: 2 })
  }
  if (view.center && kit.visible('center')) {
    overlay(kit.circle(view.center, u * 0.045, palette.muted))
    kit.label('O', view.center, { color: palette.muted, priority: 2 })
  }
  if (view.coordinate && kit.visible('guides')) {
    const c = view.coordinate, angle = (c.rotation ?? 0) * Math.PI / 180
    const x = { x: c.at.x + c.length * Math.cos(angle), y: c.at.y + c.length * Math.sin(angle) }
    const y = { x: c.at.x - c.length * Math.sin(angle), y: c.at.y + c.length * Math.cos(angle) }
    overlay(kit.arrow(c.at, x, palette.muted)); overlay(kit.arrow(c.at, y, palette.muted))
    kit.label(c.xLabel, x, { color: palette.muted }); kit.label(c.yLabel, y, { color: palette.muted })
  }
}

function initialize(kit) {
  const T = kit.THREE, host = document.getElementById('canvas')
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.setClearColor('#edf0ea')
  renderer.outputColorSpace = T.SRGBColorSpace
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-label', '三维实验装置')
  host.prepend(renderer.domElement)
  const scene = new T.Scene(), world = new T.Group()
  scene.add(world)
  scene.add(new T.HemisphereLight('#f4f7ff', '#89957d', 0.95))
  const light = new T.DirectionalLight('#fff1d8', 3.2); light.position.set(-8, 14, 10); light.castShadow = true
  light.shadow.mapSize.set(1024, 1024); light.shadow.camera.left = -15; light.shadow.camera.right = 15; light.shadow.camera.top = 15; light.shadow.camera.bottom = -15
  light.shadow.camera.near = 0.5; light.shadow.camera.far = 70; light.shadow.normalBias = 0.015; light.shadow.bias = -0.0001; light.shadow.radius = 3
  scene.add(light)
  const fill = new T.DirectionalLight('#dcecff', 1.2); fill.position.set(8, 5, -10); scene.add(fill)
  const environment = new T.Scene(); environment.background = new T.Color('#aab4b0')
  for (const [x, y, z, width, height] of [[-8, 5, 3, 8, 14], [6, 8, 0, 6, 16], [0, 12, 0, 16, 10]]) {
    const softbox = new T.Mesh(new T.PlaneGeometry(width, height), new T.MeshBasicMaterial({ color: '#ffffff', side: T.DoubleSide }))
    softbox.position.set(x, y, z); softbox.lookAt(0, 0, 0); environment.add(softbox)
  }
  const pmrem = new T.PMREMGenerator(renderer), envTarget = pmrem.fromScene(environment, 0.08)
  scene.environment = envTarget.texture; scene.environmentIntensity = 0.75; pmrem.dispose(); disposeGroup(environment)
  const floorMaterial = new T.MeshStandardMaterial({ color: '#dddcd1', roughness: 0.88, metalness: 0 })
  const floor = new T.Mesh(new T.PlaneGeometry(1, 1), floorMaterial); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; world.add(floor)
  const surface = new T.TextureLoader().load(new URL('../assets/lab-surface.webp', import.meta.url).href, texture => {
    texture.colorSpace = T.SRGBColorSpace; texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.set(6, 6); texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4)
    floorMaterial.map = texture; floorMaterial.needsUpdate = true; paint()
  })
  const camera = new T.OrthographicCamera(-8, 8, 5, -5, 0.1, 200)
  const labels = document.getElementById('labels')
  const measure = document.createElement('canvas').getContext('2d')
  state = { T, renderer, host, scene, world, camera, labels, measure, floor, envTarget, surface, yaw: -0.48, pitch: 0.23, full: false, kit: undefined, span: { x: 12, y: 8, z: 2 } }
  const observer = new ResizeObserver(() => paint()); observer.observe(host); state.observer = observer
  let drag
  const canvas = renderer.domElement
  canvas.addEventListener('pointerdown', event => {
    if (drag || event.button !== 0 || event.isPrimary === false) return
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch }
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return
    // Orbit the camera opposite horizontal hand motion so the near side of the
    // apparatus follows the pointer, as if the student were holding the object.
    state.yaw = Math.max(-0.85, Math.min(0.85, drag.yaw - (event.clientX - drag.x) * 0.003))
    state.pitch = Math.max(-0.2, Math.min(0.65, drag.pitch + (event.clientY - drag.y) * 0.003)); paint()
  })
  const endDrag = event => {
    if (!drag || event.pointerId !== drag.id) return
    drag = undefined
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)
  canvas.addEventListener('lostpointercapture', endDrag)
  document.getElementById('reset-view').addEventListener('click', () => { state.yaw = -0.48; state.pitch = 0.23; state.full = false; fitScene(); paint() })
  document.getElementById('front-view').addEventListener('click', () => { state.yaw = 0; state.pitch = 0; paint() })
  document.getElementById('full-view').addEventListener('click', () => { state.full = !state.full; fitScene(); paint() })
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); document.dispatchEvent(new CustomEvent('lab-render-failed')) })
}

function fitScene() {
  if (!state?.kit || !state.focusBounds) return
  const bounds = state.full ? state.overviewBounds : state.focusBounds, u = state.kit.unit
  const center = bounds.getCenter(new state.T.Vector3()), span = bounds.getSize(new state.T.Vector3()).divideScalar(u)
  state.span = span; state.world.scale.setScalar(1 / u); state.world.position.copy(center).multiplyScalar(-1 / u)
  document.getElementById('full-view').textContent = state.full ? '装置特写' : '查看全程'
}

// Work in screen pixels: moving a label must never move or rescale its vector.
function placeLabels(labels, width, height) {
  const placed = [], margin = 4, gap = 7, separation = 4
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
  const key = label => `${label.tag ?? ''}\0${label.text}`
  labels.sort((a, b) => b.priority - a.priority || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.x - b.x || a.y - b.y))
  for (const label of labels) {
    const { x, y, w, h } = label
    if (x < 0 || x > width || y < 0 || y > height || w > width - 2 * margin || h > height - 2 * margin) continue
    const angle = label.direction ?? -Math.PI / 2
    let rect, preferred
    // Nearby cardinal/diagonal alternatives first, then increasingly distant
    // rings. Clamping each candidate recovers labels at all four boundaries.
    for (const ring of [0, 1, 2, 3]) {
      for (const turn of [0, 1, -1, 2, -2, 3, -3, 4]) {
        const radians = angle + turn * Math.PI / 4, extra = ring * (h + separation)
        const candidate = {
          x: clamp(x + Math.cos(radians) * (w / 2 + gap + extra) - w / 2, margin, width - margin - w),
          y: clamp(y + Math.sin(radians) * (h / 2 + gap + extra) - h / 2, margin, height - margin - h), w, h,
        }
        preferred ??= candidate
        if (placed.some(other => candidate.x < other.rect.x + other.w + separation && candidate.x + w + separation > other.rect.x && candidate.y < other.rect.y + other.h + separation && candidate.y + h + separation > other.rect.y)) continue
        rect = candidate; break
      }
      if (rect) break
    }
    if (!rect) continue
    const end = { x: clamp(x, rect.x, rect.x + w), y: clamp(y, rect.y, rect.y + h) }
    const moved = Math.hypot(rect.x - preferred.x, rect.y - preferred.y) > 12
    placed.push({ ...label, rect, leader: moved || Math.hypot(end.x - x, end.y - y) > 12 ? { x1: x, y1: y, x2: end.x, y2: end.y } : undefined })
    if (placed.length >= (width < 600 ? 18 : 30)) break
  }
  return placed
}

function paint() {
  if (!state?.kit) return false
  const { renderer, host, camera, scene, world, kit, span } = state
  const width = host.clientWidth, height = host.clientHeight
  if (renderer.getContext().isContextLost()) throw new Error('WebGL context unavailable')
  if (width < 1 || height < 1) return false
  if (renderer.domElement.width !== Math.round(width * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(height * renderer.getPixelRatio())) renderer.setSize(width, height, false)
  const distance = Math.max(40, Math.hypot(span.x, span.y, span.z) * 1.6)
  camera.near = distance / 1000; camera.far = distance * 3
  camera.position.set(Math.sin(state.yaw), Math.sin(state.pitch), Math.cos(state.yaw) * Math.cos(state.pitch)).normalize().multiplyScalar(distance)
  camera.lookAt(0, 0, 0); fitCameraToBox(camera, span, width / height); world.updateMatrixWorld(true)
  renderer.render(scene, camera)
  const projected = [], fragment = document.createDocumentFragment()
  for (const label of kit.labels) {
    if (!state.full && label.tag === 'ground-label') continue
    const position = label.at.clone().applyMatrix4(kit.group.matrixWorld).project(camera)
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || position.z < -1 || position.z > 1) continue
    const x = (position.x + 1) * width / 2, y = (1 - position.y) * height / 2
    state.measure.font = `500 ${label.size}px Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
    const w = Math.min(width - 8, Math.ceil(state.measure.measureText(cleanMath(label.text)).width) + 20), h = Math.ceil(label.size * 1.35) + 8
    const from = label.from?.clone().applyMatrix4(kit.group.matrixWorld).project(camera)
    const direction = from && Math.hypot(position.x - from.x, position.y - from.y) > 1e-8
      ? Math.atan2((from.y - position.y) * height, (position.x - from.x) * width)
      : undefined
    projected.push({ ...label, x, y, w, h, direction })
  }
  const leaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  leaders.setAttribute('viewBox', `0 0 ${width} ${height}`)
  leaders.setAttribute('aria-hidden', 'true')
  leaders.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none'
  fragment.append(leaders)
  for (const label of placeLabels(projected, width, height)) {
    const { rect, w, h, leader } = label
    if (leader) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      for (const [name, value] of Object.entries(leader)) line.setAttribute(name, String(value))
      line.setAttribute('stroke', label.color); line.setAttribute('stroke-opacity', '0.6'); line.setAttribute('stroke-width', '1')
      leaders.append(line)
    }
    const node = document.createElement('span'); node.textContent = cleanMath(label.text)
    if (label.tag) node.dataset.labelId = label.tag
    if (label.priority === 0) node.dataset.quiet = 'true'
    node.style.cssText = `left:${rect.x + w / 2}px;top:${rect.y}px;width:${w}px;height:${h}px;color:${label.color};font-size:${label.size}px;text-align:center`
    fragment.append(node)
  }
  state.labels.replaceChildren(fragment)
  const canvas = renderer.domElement
  canvas.dataset.drawCalls = String(renderer.info.render.calls)
  canvas.dataset.triangles = String(renderer.info.render.triangles)
  return true
}

export function renderFrame(snapshot) {
  const kit = createSceneKit(snapshot.view)
  let retired
  try {
    const draw = drawDomain[snapshot.domain]
    if (!draw) throw new Error('Unsupported experiment domain')
    draw(snapshot, kit)
    if (snapshot.view.energyBar) for (const child of kit.group.children) if (child.name === snapshot.view.energyBar.id || child.name.startsWith('energy-segment-')) {
      child.castShadow = false; child.receiveShadow = false; child.renderOrder = 25
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) if (material) { material.depthTest = false; material.depthWrite = false }
    }
    const apparatusBounds = new kit.THREE.Box3().setFromObject(kit.group)
    const solidBounds = new kit.THREE.Box3()
    for (const child of kit.group.children) if (child.isMesh && !/^mark-/.test(child.name)) solidBounds.union(new kit.THREE.Box3().setFromObject(child))
    common(snapshot, kit)
    if (!state) initialize(kit)
    // Keep old material program references alive until the replacement frame
    // has acquired them; disposing first recompiles identical shaders every frame.
    retired = state.kit
    if (retired) state.world.remove(retired.group)
    state.kit = kit; state.world.add(kit.group)
    const view = snapshot.view, u = kit.unit
    const hasAngleComparison = (view.trajectories ?? []).some(trajectory => comparisonColors.has(trajectory.id))
    // Camera follows the declared observation window. Distant predicted points
    // are clipped just as on the host; they must not shrink the live apparatus.
    const bounds = new kit.THREE.Box3(new kit.THREE.Vector3(view.origin.x, view.origin.y, -u), new kit.THREE.Vector3(view.origin.x + view.extent.width, view.origin.y + view.extent.height, u))
    if (view.pendulum) bounds.expandByPoint(new kit.THREE.Vector3(view.pendulum.pivot.x, view.pendulum.pivot.y + u * 0.6, 0))
    const depth = Math.min(u * 6, Math.max(u, apparatusBounds.max.z - apparatusBounds.min.z))
    bounds.min.z = -depth / 2; bounds.max.z = depth / 2
    const observationBounds = bounds.clone()
    if (!apparatusBounds.isEmpty()) bounds.union(apparatusBounds)
    state.overviewBounds = bounds; state.focusBounds = bounds.clone()
    if (view.inductionBar) state.focusBounds = observationBounds
    // An angle comparison is a whole-flight observation; the platform expands
    // its viewport for all three paths. Following only the live ball crops it.
    if (snapshot.domain === 'mechanics' && !hasAngleComparison && view.bodies?.length && !view.energyRamp && !view.leverBeam && !view.pendulum && !view.spring) {
      const focus = new kit.THREE.Box3()
      for (const body of view.bodies) {
        focus.expandByPoint(new kit.THREE.Vector3(body.at.x - body.size * 2, body.at.y - body.size * 2.3, -depth / 2))
        focus.expandByPoint(new kit.THREE.Vector3(body.at.x + body.size * 2, body.at.y + body.size * 2.3, depth / 2))
      }
      for (const vector of view.vectors ?? []) if (kit.visible(vector.observable)) focus.expandByPoint(new kit.THREE.Vector3(vector.to.x, vector.to.y, 0))
      focus.expandByScalar(u * 0.3)
      const center = focus.getCenter(new kit.THREE.Vector3()), size = focus.getSize(new kit.THREE.Vector3())
      size.x = Math.max(size.x, u * 2.8); size.y = Math.max(size.y, u * 2)
      state.focusBounds = new kit.THREE.Box3(center.clone().sub(size.clone().multiplyScalar(0.5)), center.clone().add(size.clone().multiplyScalar(0.5)))
      if (snapshot.experimentId === 'force-composition') for (const child of kit.group.children) if (child.name.startsWith('force-table')) state.focusBounds.union(new kit.THREE.Box3().setFromObject(child).expandByScalar(u * 0.12))
    } else if (snapshot.domain === 'optics' && !apparatusBounds.isEmpty()) {
      state.focusBounds = apparatusBounds.clone().expandByScalar(u * 0.35)
    }
    const supportBounds = new kit.THREE.Box3()
    if (view.energyRamp) for (const child of kit.group.children) if (child.name === view.energyRamp.id || child.name === `${view.energyRamp.id}-surface`) supportBounds.union(new kit.THREE.Box3().setFromObject(child))
    const floorY = (supportBounds.isEmpty() ? solidBounds.isEmpty() ? view.origin.y : solidBounds.min.y : supportBounds.min.y) - u * 0.015
    state.floor.visible = snapshot.experimentId !== 'circular-orbit' && !['electric', 'composite'].includes(snapshot.domain)
    state.floor.position.set(state.focusBounds.getCenter(new kit.THREE.Vector3()).x, floorY, 0)
    state.floor.scale.set(view.extent.width * 12, Math.max(view.extent.width, view.extent.height) * 12, 1)
    fitScene()
    document.getElementById('readouts').replaceChildren(...(view.overlay?.readout ?? []).slice(1).map(text => { const node = document.createElement('span'); node.textContent = cleanMath(text); return node }))
    document.getElementById('canvas').dataset.experimentId = snapshot.experimentId
    document.getElementById('canvas').dataset.revision = String(snapshot.revision)
    if (!paint()) throw new Error('Experiment viewport has no visible area')
  } catch (error) {
    if (state?.kit === kit) { state.world.remove(kit.group); state.kit = undefined }
    disposeGroup(kit.group)
    throw error
  } finally {
    if (retired) disposeGroup(retired.group)
  }
}

export function disposeRenderer() {
  if (!state) return
  state.observer.disconnect(); if (state.kit) disposeGroup(state.kit.group)
  state.floor.geometry.dispose(); state.floor.material.dispose(); state.surface.dispose(); state.envTarget.dispose()
  state.renderer.dispose(); state.renderer.forceContextLoss(); state.renderer.domElement.remove(); state = undefined
}
