import { describe, expect, it } from 'vitest'
import { createThermalBenchScene } from '@physicsos/physics-scene'
import { createThermalSimulationRequest, thermalEngine } from '../src/index.ts'
import { resolveThermalModel } from '../src/thermal-model.ts'
import { heatingTimingOf, thermalStateAt } from '../src/heating-curve.ts'

/* 0.5 kg of water from 20 °C, heated at 500 W: c = 4200 J/(kg·K), so it reaches
   100 °C after 336 s and then sits there while it boils. */
const waterScene = () =>
  createThermalBenchScene({
    sample: {
      id: 'water',
      name: '水',
      mass: 500,
      solidSpecificHeat: 2100,
      liquidSpecificHeat: 4200,
      latentHeat: 334_000,
      meltingPoint: 0,
      boilingPoint: 100,
      vaporizationHeat: 2_260_000,
      initialTemperature: 20,
    },
    heaterPower: 500,
    runDuration: 3600,
  })

const modelOf = () => resolveThermalModel(waterScene())

describe('the second plateau', () => {
  it('warms the liquid from where it is to the boiling point, in 336 s', () => {
    const timing = heatingTimingOf(modelOf())
    /* 20 °C → 100 °C at 500 W over 0.5 kg: 0.5·4200·80/500 = 336 s. Timing it
       from the MELTING point instead would give 420 s and credit the water with
       warming it never had to do. */
    expect(timing.boilingStartTime).toBeCloseTo(336, 6)
    /* Then 0.5·2.26e6/500 = 2260 s of boiling. */
    expect(timing.boilingDuration).toBeCloseTo(2260, 6)
  })

  it('holds the temperature at 100 °C all the way through the boil', () => {
    const model = modelOf()
    for (const t of [0, 168, 336, 800, 1500, 2596]) {
      const state = thermalStateAt(model, t)
      const expected = t < 336 ? 293.15 + (500 * t) / (0.5 * 4200) : 373.15
      expect(state.temperature).toBeCloseTo(expected, 6)
      expect(state.phase).toBe(t < 336 ? 'liquid' : 'boiling')
    }
  })

  it('keeps delivering power while the temperature does not move', () => {
    const model = modelOf()
    const start = thermalStateAt(model, 336)
    const later = thermalStateAt(model, 1000)
    /* The reading the 水的沸腾 experiment takes: the heat is still going in —
       more of it has been absorbed — and the thermometer has stopped moving. */
    expect(later.temperature).toBeCloseTo(start.temperature, 9)
    expect(later.heatAbsorbed).toBeGreaterThan(start.heatAbsorbed)
    expect((later.heatAbsorbed - start.heatAbsorbed) / (1000 - 336)).toBeCloseTo(500, 6)
  })

  it('still verifies, and still ends the curve at the end of the plateau', () => {
    const model = modelOf()
    const simulation = thermalEngine.simulate(
      waterScene(),
      createThermalSimulationRequest(waterScene(), 'sim-boil', 'trace-boil'),
    )
    if (simulation.verification.status !== 'passed') {
      console.log(
        JSON.stringify(
          simulation.verification.checks
            .filter((c) => !c.passed)
            .map((c) => ({ id: c.id, message: c.message, details: c.details })),
          null,
          1,
        ),
      )
    }
    expect(simulation.verification.status).toBe('passed')
    /* 336 s of warming plus 2260 s of boiling: the physics decides where the run
       ends when the bench does not say. */
    const open = heatingTimingOf(
      resolveThermalModel(
        createThermalBenchScene({
          sample: {
            id: 'water',
            mass: 500,
            solidSpecificHeat: 2100,
            liquidSpecificHeat: 4200,
            latentHeat: 334_000,
            meltingPoint: 0,
            boilingPoint: 100,
            vaporizationHeat: 2_260_000,
            initialTemperature: 20,
          },
          heaterPower: 500,
        }),
      ),
    )
    expect(open.totalTime).toBeCloseTo(336 + 2260, 6)
    expect(model.boilingPoint).toBeCloseTo(373.15, 9)
  })

  it('leaves a rig that never boils exactly as it was', () => {
    const melting = createThermalBenchScene({
      sample: {
        id: 'ice',
        mass: 200,
        solidSpecificHeat: 2100,
        liquidSpecificHeat: 4200,
        latentHeat: 334_000,
        meltingPoint: 0,
        initialTemperature: -20,
      },
      heaterPower: 200,
      runDuration: 900,
    })
    const model = resolveThermalModel(melting)
    expect(model.boilingPoint).toBeUndefined()
    const timing = heatingTimingOf(model)
    expect(timing.boilingStartTime).toBeUndefined()
    expect(timing.totalTime).toBe(900)
    /* The two-phase reading is untouched: still 0 °C through the melt. */
    expect(thermalStateAt(model, timing.meltingEndTime).temperature).toBeCloseTo(273.15, 9)
  })
})
