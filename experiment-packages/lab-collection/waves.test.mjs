import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { drawWaves } from './src/waves.js'

assert.ok(process.env.PHYSICSOS_LAB_KIT_MODULE, 'Use the server-staged Three.js scene kit')
assert.ok(process.env.PHYSICSOS_WAVE_FIXTURE, 'Use a real platform diffraction snapshot')
const { createSceneKit, disposeGroup } = await import(pathToFileURL(process.env.PHYSICSOS_LAB_KIT_MODULE))
const snapshot = JSON.parse(await readFile(process.env.PHYSICSOS_WAVE_FIXTURE, 'utf8'))

test('diffraction stripes occupy the YZ screen face rather than a thin XY edge', () => {
  const before = JSON.stringify(snapshot)
  const kit = createSceneKit(snapshot.view)
  drawWaves(snapshot, kit)
  kit.group.updateMatrixWorld(true)
  const bands = kit.group.children.filter(object => object.name.startsWith('diffraction-band-'))
  assert.ok(bands.length > 50, 'resolved intensity samples must visibly illuminate the screen')
  const screenX = snapshot.view.labels.find(label => label.id === 'wave-screen-label').at.x
  for (const band of bands) {
    const box = new kit.THREE.Box3().setFromObject(band)
    assert.ok(box.max.z - box.min.z >= kit.unit * 2.4, 'stripes extend across the wide screen face')
    assert.ok(box.max.x - box.min.x < kit.unit * 0.01, 'screen stripes stay on a constant-x plane')
    assert.ok(Math.abs(box.min.x - screenX) < kit.unit * 0.01, 'screen remains at the platform position')
  }
  assert.equal(JSON.stringify(snapshot), before)
  disposeGroup(kit.group)
})
