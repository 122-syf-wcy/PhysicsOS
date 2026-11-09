import { quantityVector, type ObjectState } from '@physicsos/physics-core'
import { quantity } from '@physicsos/physics-units'
import { singleSlitIntensityRatio, type ResolvedWaveModel } from './wave-model.ts'

/** Exact solution of the 1-D wave equation with prescribed endpoint pulses.
 * Both ends drive for L/v, with the relative phase selected by n. Initially
 * the string is at rest; after one transit their sum is exactly the existing
 * A sin(nπx/L) cos(ωt) mode, with both endpoints at rest again. The individual
 * components continue as the decomposition of that fixed-end standing wave.
 */
export function standingFormationObjects(model: ResolvedWaveModel, time: number, count: number): ObjectState[] {
  const length = model.stringLength ?? 0
  const harmonic = model.harmonic ?? 1
  const objects: ObjectState[] = []
  const signal = (delay: number) => delay <= 0 ? 0 : Math.sin(2 * Math.PI * model.frequency * delay)
  for (let index = 0; index <= count; index++) {
    const x = length * index / count
    const left = -model.amplitude / 2 * signal(time - x / model.waveSpeed)
    const right = (harmonic % 2 ? -1 : 1) * model.amplitude / 2 * signal(time - (length - x) / model.waveSpeed)
    for (const [kind, y] of [['left', left], ['right', right], ['sum', left + right]] as const) {
      objects.push({ id: `${model.benchId}.formation-${kind}.${index}`, position: quantityVector({ x, y, z: 0 }, 'm', 'length') })
    }
  }
  return objects
}

/** Far-field intensities and propagation geometry, all in SI units. Wavefronts
 * show phase propagation; their radius is not a second intensity calculation.
 * The screen turns on only after the incident wave and the diffracted front
 * have travelled the required path. Finite aperture near-field structure is
 * outside the Fraunhofer model and is not represented as a solved wave field.
 */
export function diffractionDisplayObjects(model: ResolvedWaveModel, time: number): ObjectState[] {
  const distance = model.screenDistance ?? 0, slit = model.slitWidth ?? 0
  const sourceDistance = Math.max(2 * model.wavelength, slit * 0.75)
  const halfHeight = Math.min(distance * 3, Math.max(slit, (model.centralMaximumWidth ?? distance) * 1.2))
  const objects: ObjectState[] = []
  for (let index = 0; index <= 128; index++) {
    const y = halfHeight * (index / 64 - 1)
    const ratio = singleSlitIntensityRatio(model, Math.atan2(y, distance))
    objects.push({
      id: `${model.benchId}.intensity.${index}`,
      position: quantityVector({ x: distance, y, z: 0 }, 'm', 'length'),
      values: {
        intensity_ratio: quantity(ratio, '', 'dimensionless'),
        illumination: quantity(model.waveSpeed * time >= sourceDistance + Math.hypot(distance, y) ? 1 : 0, '', 'dimensionless'),
      },
    })
  }
  // Sample the entire visible emission interval rather than only the newest
  // crests: at high frequency those would all remain upstream of the slit.
  const period = 1 / model.frequency
  const newest = Math.floor(time / period - 0.25)
  const oldest = Math.max(0, Math.ceil((time - (sourceDistance + distance) / model.waveSpeed) / period - 0.25))
  const count = Math.max(0, Math.min(16, newest - oldest + 1))
  for (let index = 0; index < count; index++) {
    const emission = count === 1 ? newest : oldest + Math.round(index * (newest - oldest) / (count - 1))
    const travelled = model.waveSpeed * (time - (emission + 0.25) * period)
    if (travelled <= sourceDistance) {
      const x = travelled - sourceDistance
      for (const [index, y] of [-halfHeight, halfHeight].entries()) objects.push({
        id: `${model.benchId}.diffraction-incident.${emission}.${index}`,
        position: quantityVector({ x, y, z: 0 }, 'm', 'length'),
      })
    } else {
      const radius = travelled - sourceDistance
      if (radius > distance) continue
      for (let index = 0; index <= 32; index++) {
        const angle = (index / 32 - 0.5) * Math.PI
        objects.push({ id: `${model.benchId}.diffraction-front.${emission}.${index}`,
          position: quantityVector({ x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: 0 }, 'm', 'length') })
      }
    }
  }
  return objects
}
