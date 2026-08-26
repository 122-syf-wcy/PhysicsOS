import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsScene } from '../scene.ts'
import { createAcousticBenchScene } from './acoustics-scene.ts'

/**
 * Acoustics experiment templates (初中声学).
 *
 * Same shape as the optics templates: each creator returns a complete
 * PhysicsScene through the acoustic bench factory with textbook-friendly
 * defaults, so the Lab, tests and the agent all start from identical worlds.
 */

export interface EchoRangingSceneInput {
  readonly sceneId?: string
  /** Wall distance from the source in metres (> 0). */
  readonly wallDistance?: number
  /** Speed of sound in m/s (> 0); 340 is the textbook value for 15 °C air. */
  readonly soundSpeed?: number
  readonly now?: IsoDateTime
}

/**
 * 回声测距 — a sound source facing a cliff / wall on an open range. The pulse
 * leaves at t = 0, reflects and returns after t = 2d/v; the student measures
 * the echo delay and recovers the distance with d = v·t/2. Defaults put the
 * wall 340 m out in 15 °C air, so the round trip is exactly 2.0 s — the number
 * every 初中 textbook uses.
 */
export const createEchoRangingScene = (input: EchoRangingSceneInput = {}): PhysicsScene => {
  const wallDistance = input.wallDistance ?? 340
  const soundSpeed = input.soundSpeed ?? 340
  return createAcousticBenchScene({
    sceneId: input.sceneId ?? 'lab-echo-ranging',
    ...(input.now === undefined ? {} : { now: input.now }),
    source: { id: 'sound-source', name: '声源（喇叭）', position: 0 },
    reflector: { id: 'wall-1', name: '峭壁', position: wallDistance },
    soundSpeed,
    title: '回声测距',
    description: '利用回声测距离：声音以声速直线传播，遇峭壁反射；往返时间的一半乘以声速即为距离 d = v·t/2。',
  })
}
