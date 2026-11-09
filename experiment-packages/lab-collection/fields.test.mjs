import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { drawFields } from './src/fields.js'

assert.ok(process.env.PHYSICSOS_LAB_KIT_MODULE, 'Use the server-staged Three.js scene kit')
const { createSceneKit, disposeGroup } = await import(pathToFileURL(process.env.PHYSICSOS_LAB_KIT_MODULE))
const center = { x: 2, y: -1 }

function snapshot(sign, experimentId = 'point-charge', visible = true) {
  const fieldStreamlines = Array.from({ length: 12 }, (_, i) => {
    const angle = i * Math.PI / 6
    const points = Array.from({ length: 45 }, (_, j) => ({
      x: center.x + Math.cos(angle) * (0.2 + j * 0.06),
      y: center.y + Math.sin(angle) * (0.2 + j * 0.06),
    }))
    if (sign === 'negative') points.reverse()
    return { id: `stream-source-${i}`, sourceId: 'source', points, arrowAt: points[22] }
  })
  return { experimentId, domain: 'electric', view: {
    origin: { x: -4, y: -7 }, extent: { width: 12, height: 12 },
    visible: { electricField: visible }, fieldStreamlines,
    pointChargeSources: [{ id: 'source', at: center, radius: 0.15, sign }],
  } }
}

for (const sign of ['positive', 'negative']) test(`${sign} single charge has spatial rays and clearly directed arrows`, () => {
  const frame = snapshot(sign), before = JSON.stringify(frame)
  const kit = createSceneKit(frame.view)
  drawFields(frame, kit)
  const lines = kit.group.children.filter(item => item.isLine && item.name.startsWith('stream-source-'))
  assert.ok(lines.some(line => Array.from(line.geometry.attributes.position.array).some((v, i) => i % 3 === 2 && Math.abs(v) > 0.2)), 'single-charge field must extend outside the xy plane')
  const arrows = kit.group.children.filter(item => item.type === 'ArrowHelper')
  assert.ok(arrows.length >= lines.length, 'each displayed field line has a direction arrow')
  for (const arrow of arrows) {
    const direction = new kit.THREE.Vector3(0, 1, 0).applyQuaternion(arrow.quaternion)
    const radial = arrow.position.clone().sub(new kit.THREE.Vector3(center.x, center.y, 0))
    assert.ok(direction.dot(radial) * (sign === 'positive' ? 1 : -1) > 0, 'arrow follows the electric field sign')
    assert.ok(arrow.cone.scale.y >= 0.3 * kit.unit, 'field arrowheads must remain readable at phone viewport scale')
  }
  assert.equal(JSON.stringify(frame), before, 'drawing cannot change platform field samples')
  disposeGroup(kit.group)
})

test('multi-charge fields keep their supplied geometry and visibility still hides all field lines', () => {
  for (const visible of [true, false]) {
    const frame = snapshot('positive', 'multi-point-charge', visible)
    frame.view.pointChargeSources.push({ id: 'other', at: { x: -2, y: 1 }, radius: 0.15, sign: 'negative' })
    const kit = createSceneKit(frame.view)
    drawFields(frame, kit)
    const lines = kit.group.children.filter(item => item.isLine && item.name.startsWith('stream-source-'))
    assert.equal(lines.length, visible ? frame.view.fieldStreamlines.length : 0)
    assert.ok(lines.every(line => Array.from(line.geometry.attributes.position.array).every((v, i) => i % 3 !== 2 || v === 0)), 'multiple charges have no assumed spherical symmetry')
    disposeGroup(kit.group)
  }
})
