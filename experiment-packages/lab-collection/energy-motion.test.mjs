import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { drawMechanics } from './src/mechanics.js'

assert.ok(process.env.PHYSICSOS_LAB_KIT_MODULE, 'Use the server-staged real Three.js kit')
assert.ok(process.env.PHYSICSOS_ENERGY_FIXTURE_DIR, 'Use the server-exported real engine snapshots')
const { createSceneKit, disposeGroup } = await import(pathToFileURL(process.env.PHYSICSOS_LAB_KIT_MODULE))

for (const frame of ['start', 'half', 'end']) test(`real Three cart stays on its ramp at ${frame}`, async () => {
  const snapshot = JSON.parse(await readFile(`${process.env.PHYSICSOS_ENERGY_FIXTURE_DIR}/energy-${frame}-snapshot.json`, 'utf8'))
  const before = JSON.stringify(snapshot)
  const kit = createSceneKit(snapshot.view)
  drawMechanics(snapshot, kit)
  kit.group.updateMatrixWorld(true)
  const ramp = snapshot.view.energyRamp
  const cart = kit.group.getObjectByName(`${ramp.id}-cart`)
  assert.ok(cart?.isMesh, 'inspect the real rendered chassis')
  const bounds = new kit.THREE.Box3().setFromObject(cart)
  assert.ok(bounds.min.y >= ramp.base.y - 1e-5, `cart below ground: ${bounds.min.y}`)
  const length = Math.hypot(ramp.peak.x - ramp.base.x, ramp.peak.y - ramp.base.y)
  const tx = (ramp.peak.x - ramp.base.x) / length, ty = (ramp.peak.y - ramp.base.y) / length
  const positions = cart.geometry.attributes.position
  for (let i = 0; i < positions.count; i++) {
    const vertex = new kit.THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(cart.matrixWorld)
    const dx = vertex.x - ramp.base.x, dy = vertex.y - ramp.base.y
    assert.ok(-ty * dx + tx * dy >= -1e-5, 'chassis cannot enter the ramp surface')
    assert.ok(tx * dx + ty * dy >= -1e-5, 'footprint cannot extend below the ramp foot')
    assert.ok(tx * dx + ty * dy <= length + 1e-5, 'footprint cannot extend beyond the release edge')
  }
  assert.equal(JSON.stringify(snapshot), before, 'rendering must not change the engine position')
  disposeGroup(kit.group)
})
