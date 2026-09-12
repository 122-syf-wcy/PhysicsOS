import { describe, it } from 'vitest'
import { createMassSpectrometerScene } from '@physicsos/physics-scene'
import { compositeEngine, createCompositeSimulationRequest } from '../src/index.ts'

describe('repro mass-spectrometer readout inconsistency', () => {
  it('dump states', () => {
    const scene = createMassSpectrometerScene({
      sceneId: 'ms', title: 't',
      charge: 1.6e-19, mass: 1.67e-27,
      velocity: { x: 1.0e5, y: 0, z: 0 },
      electricFieldStrength: 200, electricFieldDirection: 'up',
      magneticFieldStrength: 2.0e-3, magneticFieldOrientation: 'out_of_page',
      deflectionWidth: 1.2, deflectionHeight: 1.2, duration: 2.4e-5,
    })
    const res = compositeEngine.simulate(scene, createCompositeSimulationRequest(scene, 's', 'tr'))
    for (const st of res.states.filter((_, i) => i % 10 === 0)) {
      const obj = st.objects[0]
      const b = (obj?.values?.['magneticFluxDensity'] as any)?.vector
      const fb = st.derived.find(d => d.key === 'magnetic_force_vector')?.value as any
      const pos = (obj?.position as any)?.vector
      console.log(
        `t=${(st.time.value*1e6).toFixed(2)}us pos=(${pos?.x.toFixed(3)},${pos?.y.toFixed(3)})`,
        `B_z=${b?.z}`, `|F_B|=${fb ? Math.hypot(fb.vector.x, fb.vector.y, fb.vector.z).toExponential(2) : 'n/a'}`,
      )
    }
  })
})
