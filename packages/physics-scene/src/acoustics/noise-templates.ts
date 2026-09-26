import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsScene } from '../scene.ts'
import { createNoiseBenchScene } from './noise-scene.ts'

export interface NoiseBarrierSceneInput {
  readonly sceneId?: string
  /** Sound power level of the source, in dB. */
  readonly soundPowerLevel?: number
  /** How far the listener stands, in metres (> 0). */
  readonly distance?: number
  /** Insertion loss of the barrier, in dB (≥ 0); 0 is no barrier at all. */
  readonly barrierAttenuation?: number
  readonly now?: IsoDateTime
}

/**
 * 噪声的减弱 — the two ways of getting quieter, which are not the same way.
 *
 * The source is rated at 100 dB. At 1 m the meter reads 89.0 dB; step back to
 * 2 m and it reads 83.0 — **6 dB, a quarter of the intensity**, purely because
 * the sound now has a bigger sphere to fill. Put a barrier in the way and its
 * insertion loss is simply subtracted: the wall and the distance are separate
 * facts, so the model keeps them as separate terms rather than one number.
 *
 * The point the scale makes is that "6 dB" sounds like a little and is in fact
 * three quarters of the energy gone — which is why 在传播过程中减弱 works.
 */
export const createNoiseBarrierScene = (input: NoiseBarrierSceneInput = {}): PhysicsScene =>
  createNoiseBenchScene({
    sceneId: input.sceneId ?? 'lab-noise-barrier',
    ...(input.now === undefined ? {} : { now: input.now }),
    soundPowerLevel: input.soundPowerLevel ?? 100,
    distance: input.distance ?? 1,
    barrierAttenuation: input.barrierAttenuation ?? 15,
    title: '噪声的减弱',
    description:
      '噪声：声源功率级 100 dB 的机器，在 1 m 处声级计读 89.0 dB；退到 2 m 只剩 83.0 dB —— 距离加倍就少 6 dB，也就是声强只剩四分之一，因为声音要摊在更大的一整个球面上。在两米处加一道隔声量 15 dB 的屏障，读数再减 15 dB。dB 是对数，所以"只降 6 dB"听起来少，实际拿掉的是四分之三的能量 —— 这正是"在传播过程中减弱"管用的原因。',
  })
