/**
 * One-dimensional collisions. The collision engine already solved this scene;
 * what was missing was the parser that names it, the scene builder that feeds
 * it, and a capability entry so the engine is actually reached. Before those,
 * every 碰撞 question parsed to nothing (PARSE_FAILED) — and once a naive
 * registration existed, the single-body mechanics engine claimed every
 * mechanics question and the collision engine was never consulted.
 */

import { describe, expect, it } from 'vitest'
import { readCollisionBodies, readRestitution } from '../src/deterministic-collision-parser.ts'

describe('collision stem reading', () => {
  it('reads both masses and both velocities, keeping a stated zero', () => {
    /* "v2 = 0 m/s" is a stated fact. Dropping it made the second body inherit
       the first body's speed, which silently changed the question. */
    const bodies = readCollisionBodies(
      '质量 m1 = 2 kg 的小球以速度 v1 = 6 m/s 与静止的质量 m2 = 4 kg 的小球发生碰撞，'
      + '碰后两球粘在一起共同运动。已知：m1 = 2 kg，v1 = 6 m/s，m2 = 4 kg，v2 = 0 m/s',
    )
    expect(bodies).toBeDefined()
    expect(bodies!.a.mass).toBe(2)
    expect(bodies!.a.velocity).toBe(6)
    expect(bodies!.b.mass).toBe(4)
    expect(bodies!.b.velocity).toBe(0)
  })

  it('treats a stationary second body with no stated speed as at rest', () => {
    const bodies = readCollisionBodies('质量 1 kg 的小球以 5 m/s 与静止的质量 3 kg 的小球正碰')
    expect(bodies!.a.mass).toBe(1)
    expect(bodies!.b.mass).toBe(3)
    expect(bodies!.b.velocity).toBe(0)
  })

  it('is undefined when the stem does not name two masses', () => {
    expect(readCollisionBodies('一个质量 2 kg 的物块沿斜面下滑')).toBeUndefined()
  })
})

describe('restitution from how the stem describes the outcome', () => {
  it('reads 粘在一起 as perfectly inelastic', () => {
    expect(readRestitution('碰后两球粘在一起共同运动')).toBe(0)
  })

  it('reads 弹性碰撞 as elastic', () => {
    expect(readRestitution('两球发生弹性碰撞')).toBe(1)
  })
})

describe('LaTeX stems', () => {
  it('reads a stem whose units are written as \\mathrm', () => {
    /* Drafted papers write "$m_1 = 2\\ \\mathrm{kg}$". The hand-written tests
       above passed while the real paper's Q6 still failed, because no pattern
       matched the LaTeX form. */
    const tex = String.raw`质量 $m_1 = 2\ \mathrm{kg}$ 的小球以速度 $v_1 = 6\ \mathrm{m/s}$ 与静止的质量 $m_2 = 4\ \mathrm{kg}$ 的小球发生碰撞`
    const bodies = readCollisionBodies(tex)
    expect(bodies!.a).toEqual({ mass: 2, velocity: 6 })
    expect(bodies!.b).toEqual({ mass: 4, velocity: 0 })
  })
})
