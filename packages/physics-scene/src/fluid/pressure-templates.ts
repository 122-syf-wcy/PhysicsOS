import type { IsoDateTime } from '@physicsos/shared'

import type { PhysicsScene } from '../scene.ts'
import {
  createPressureBenchScene,
  type AtmosphericPressureSpec,
  type LiquidPressureSpec,
  type SolidPressureSpec,
} from './pressure-scene.ts'

/**
 * Pressure experiment templates (初中压强 · 液体压强 · 大气压).
 *
 * Same shape as the buoyancy and thermal templates: each creator returns a
 * complete PhysicsScene through the bench factory with textbook-friendly
 * defaults, so the Lab, tests and the agent all start from identical worlds.
 */

export interface SolidPressureSceneInput {
  readonly sceneId?: string
  /** Perpendicular force on the contact face, in newtons (≥ 0). */
  readonly force?: number
  /** Loaded contact area in cm² (> 0). */
  readonly area?: number
  /** The same force on another face, in cm² (> 0). */
  readonly comparisonArea?: number
  readonly now?: IsoDateTime
}

/**
 * 探究压力的作用效果 — the same force pressing on two different contact faces.
 *
 * The defaults are the textbook demonstration: 20 N on 200 cm² gives exactly
 * 1000 Pa, and the identical 20 N on the 50 cm² face gives exactly 4000 Pa.
 * Nothing about the force changed, so the four-fold pressure ratio is the
 * area's doing alone — which is the whole point of separating 压力 from 压强.
 */
export const createSolidPressureScene = (
  input: SolidPressureSceneInput = {},
): PhysicsScene => {
  const bench: SolidPressureSpec = {
    benchId: 'pressure-bench-1',
    type: 'solid',
    force: input.force ?? 20,
    area: input.area ?? 200,
    comparisonArea: input.comparisonArea ?? 50,
  }
  return createPressureBenchScene({
    sceneId: input.sceneId ?? 'lab-solid-pressure',
    ...(input.now === undefined ? {} : { now: input.now }),
    bench,
    title: '探究压力的作用效果',
    description:
      '压强 p = F/S：20 N 的压力压在 200 cm² 的面上是 1000 Pa，压在 50 cm² 的面上就是 4000 Pa。压力没变，受力面积变成四分之一，压强就变成四倍 —— 压力与压强不是同一件事。',
  })
}

export interface LiquidPressureSceneInput {
  readonly sceneId?: string
  /** Density of the probed liquid in kg/m³ (> 0). */
  readonly liquidDensity?: number
  /** Probe depth below the surface in cm (≥ 0). */
  readonly depth?: number
  /** A second probe depth in the same liquid, in cm (≥ 0). */
  readonly comparisonDepth?: number
  /** A second liquid probed at `depth`, in kg/m³ (> 0). */
  readonly comparisonLiquidDensity?: number
  readonly now?: IsoDateTime
}

/**
 * 探究液体内部的压强 — one probe moved deeper, then into a denser liquid.
 *
 * The defaults give clean readings twice over: water at 20 cm reads 1960 Pa and
 * at 40 cm reads 3920 Pa (twice the depth, twice the pressure), and brine at the
 * original 20 cm reads 2156 Pa. Both dependences — depth and density — are
 * visible without changing the apparatus.
 */
export const createLiquidPressureScene = (
  input: LiquidPressureSceneInput = {},
): PhysicsScene => {
  const bench: LiquidPressureSpec = {
    benchId: 'pressure-bench-1',
    type: 'liquid',
    liquidDensity: input.liquidDensity ?? 1000,
    depth: input.depth ?? 20,
    comparisonDepth: input.comparisonDepth ?? 40,
    comparisonLiquidDensity: input.comparisonLiquidDensity ?? 1100,
  }
  return createPressureBenchScene({
    sceneId: input.sceneId ?? 'lab-liquid-pressure',
    ...(input.now === undefined ? {} : { now: input.now }),
    bench,
    title: '探究液体内部的压强',
    description:
      '液体压强 p = ρgh：水中 20 cm 深处是 1960 Pa，40 cm 深处是 3920 Pa —— 深度加倍，压强加倍；同样 20 cm 深处换成盐水（1100 kg/m³）则是 2156 Pa。压强只由液体密度和深度决定，与容器形状、液体总量无关。',
  })
}

export interface AtmosphericPressureSceneInput {
  readonly sceneId?: string
  /** Atmospheric pressure both instruments read, in pascals (> 0). */
  readonly atmosphericPressure?: number
  /** Density of the barometer fluid in kg/m³ (> 0). */
  readonly barometerFluidDensity?: number
  /** Radius of each Magdeburg hemisphere in cm (> 0). */
  readonly hemisphereRadius?: number
  readonly now?: IsoDateTime
}

/**
 * 大气压的测量 — one p₀ read by two instruments that share nothing but the air.
 *
 * At the standard 101300 Pa the mercury column settles at ρ_Hg·g·h = p₀, i.e.
 * 760 mm, which is where the textbook's 760 mmHg comes from; the same p₀ over a
 * 5 cm-radius hemisphere pair needs πr²·p₀ ≈ 796 N to pull apart, the weight of
 * an 81 kg person. Neither number is entered anywhere — both are consequences
 * of the one pressure the scene states.
 */
export const createAtmosphericPressureScene = (
  input: AtmosphericPressureSceneInput = {},
): PhysicsScene => {
  const bench: AtmosphericPressureSpec = {
    benchId: 'pressure-bench-1',
    type: 'atmospheric',
    atmosphericPressure: input.atmosphericPressure ?? 101_300,
    barometerFluidDensity: input.barometerFluidDensity ?? 13_600,
    hemisphereRadius: input.hemisphereRadius ?? 5,
  }
  return createPressureBenchScene({
    sceneId: input.sceneId ?? 'lab-atmospheric-pressure',
    ...(input.now === undefined ? {} : { now: input.now }),
    bench,
    title: '大气压的测量',
    description:
      '托里拆利实验：p₀ = ρ_汞·g·h，101300 Pa 对应 760 mm 汞柱 —— 这就是课本上 760 mmHg 的来历。同一个 p₀ 作用在半径 5 cm 的马德堡半球上，需要约 796 N 才能拉开，相当于提起一个 81 kg 的人。',
  })
}
