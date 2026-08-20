import { describe, expect, it } from 'vitest'

import { magnitude, vec3 } from '@physicsos/physics-math'
import { DimensionMismatchError } from '@physicsos/physics-units'

import {
  fromCanonicalVector,
  NonFiniteVectorError,
  quantityVector,
  toCanonicalVector,
  vectorMagnitudeQuantity,
} from '../src/quantity-vector.ts'
import {
  check,
  summarizeVerification,
  verificationPassed,
  type VerificationIssue,
} from '../src/verification.ts'
import { DEFAULT_TOLERANCE, toleranceError, withinTolerance } from '../src/tolerance.ts'
import {
  invalidModelCondition,
  supported,
  unsupportedModel,
  EngineUnsupportedError,
} from '../src/engine.ts'
import { derivedScalar, derivedVector, type DerivedQuantity } from '../src/simulation-state.ts'

describe('QuantityVector', () => {
  it('carries unit and dimension alongside the vector', () => {
    const b = quantityVector(vec3(0, 0, -0.5), 'T', 'magnetic_flux_density')
    expect(b.unit).toBe('T')
    expect(b.dimension).toBe('magnetic_flux_density')
    expect(b.vector.z).toBe(-0.5)
  })

  it('copies coordinates so independent facts cannot alias the source vector', () => {
    const source = vec3(1, 2, 3)
    const first = quantityVector(source, 'N', 'force')
    const second = quantityVector(source, 'N', 'force')

    first.vector.x = 9

    expect(source.x).toBe(1)
    expect(second.vector.x).toBe(1)
  })

  it('rejects a unit whose dimension does not match', () => {
    expect(() => quantityVector(vec3(1, 0, 0), 'kg', 'velocity')).toThrow(DimensionMismatchError)
  })

  it('rejects non-finite components', () => {
    expect(() => quantityVector(vec3(Number.NaN, 0, 0), 'm', 'length')).toThrow(
      NonFiniteVectorError,
    )
  })

  it('converts to canonical SI componentwise', () => {
    const position = quantityVector(vec3(100, 200, 0), 'cm', 'length')
    const canonical = toCanonicalVector(position)
    expect(canonical.vectorSI.x).toBeCloseTo(1, 12)
    expect(canonical.vectorSI.y).toBeCloseTo(2, 12)
    expect(canonical.dimension).toBe('length')
  })

  it('round-trips back into canonical display units', () => {
    const back = fromCanonicalVector({ vectorSI: vec3(1, 2, 0), dimension: 'length' })
    expect(back.unit).toBe('m')
    expect(back.vector.x).toBe(1)
  })

  it('produces the magnitude as a scalar Quantity in SI', () => {
    const velocity = quantityVector(vec3(3, 4, 0), 'm/s', 'velocity')
    const speed = vectorMagnitudeQuantity(velocity)
    expect(speed.value).toBe(5)
    expect(speed.unit).toBe('m/s')
    expect(speed.dimension).toBe('velocity')
  })

  it('computes magnitude after unit conversion, not before', () => {
    const position = quantityVector(vec3(300, 400, 0), 'cm', 'length')
    expect(vectorMagnitudeQuantity(position).value).toBeCloseTo(5, 12)
    expect(magnitude(position.vector)).toBe(500)
  })
})

describe('verification summary', () => {
  it('reports passed when every check passes', () => {
    const result = summarizeVerification([check('unit', 'dimension', true)], [], [])
    expect(result.status).toBe('passed')
    expect(verificationPassed(result)).toBe(true)
  })

  it('reports passed_with_warnings when warnings exist', () => {
    const warning: VerificationIssue = {
      code: 'LOW_SAMPLE_RATE',
      severity: 'warning',
      message: 'sample rate is coarse',
    }
    const result = summarizeVerification([check('unit', 'dimension', true)], [warning], [])
    expect(result.status).toBe('passed_with_warnings')
    expect(verificationPassed(result)).toBe(true)
  })

  it('promotes a failed check into an error and fails overall', () => {
    const result = summarizeVerification(
      [check('speed', 'conservation', false, { message: 'speed drifted' })],
      [],
      [],
    )
    expect(result.status).toBe('failed')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.code).toBe('speed')
    expect(verificationPassed(result)).toBe(false)
  })

  it('does not duplicate an error already reported explicitly', () => {
    const explicit: VerificationIssue = {
      code: 'speed',
      severity: 'error',
      message: 'speed drifted',
    }
    const result = summarizeVerification([check('speed', 'conservation', false)], [], [explicit])
    expect(result.errors).toHaveLength(1)
  })
})

describe('tolerance policy', () => {
  it('accepts values inside the relative band', () => {
    expect(withinTolerance(1, 1 + 1e-12)).toBe(true)
    expect(withinTolerance(0.5, 0.5)).toBe(true)
  })

  it('rejects values outside the band', () => {
    expect(withinTolerance(1, 1.1)).toBe(false)
  })

  it('exposes a stable default policy', () => {
    expect(DEFAULT_TOLERANCE.relative).toBe(1e-9)
    expect(DEFAULT_TOLERANCE.absolute).toBe(1e-12)
  })

  it('measures relative error', () => {
    expect(toleranceError(1.1, 1)).toBeCloseTo(0.1, 12)
  })
})

describe('model support verdicts', () => {
  it('marks a supported model', () => {
    const verdict = supported('uniform-magnetic-field-charged-particle', 'magnetic')
    expect(verdict.supported).toBe(true)
  })

  it('reports invalid conditions rather than pretending to solve', () => {
    const verdict = invalidModelCondition('uniform-magnetic-field-charged-particle', [
      { condition: 'v_perpendicular_b', message: 'velocity is not perpendicular to B' },
    ])
    expect(verdict.supported).toBe(false)
    if (!verdict.supported) {
      expect(verdict.reason).toBe('invalid_model_condition')
      expect(verdict.failedConditions).toHaveLength(1)
    }
  })

  it('converts an unsupported verdict into a DomainError envelope', () => {
    const verdict = unsupportedModel([
      { condition: 'magnetic_field_present', message: 'no magnetic field in scene' },
    ])
    if (verdict.supported) throw new Error('expected unsupported verdict')
    const error = new EngineUnsupportedError('engine-magnetic', verdict)
    expect(error.domainError.code).toBe('UNSUPPORTED_MODEL')
    expect(error.domainError.category).toBe('unsupported')
    expect(error.domainError.retryable).toBe(false)
  })
})

describe('derived quantity access', () => {
  const derived: DerivedQuantity[] = [
    {
      key: 'orbit_radius',
      value: { value: 0.5, unit: 'm', dimension: 'length' },
      formula: { expression: 'r = mv / |q|B' },
    },
    {
      key: 'net_force',
      value: { vector: vec3(0, -1, 0), unit: 'N', dimension: 'force' },
    },
  ]

  it('reads scalars by key', () => {
    expect(derivedScalar(derived, 'orbit_radius').value).toBe(0.5)
  })

  it('reads vectors by key', () => {
    expect(derivedVector(derived, 'net_force').vector.y).toBe(-1)
  })

  it('throws when a key is absent', () => {
    expect(() => derivedScalar(derived, 'period')).toThrow(/absent/)
  })

  it('throws when a scalar is requested but the value is a vector', () => {
    expect(() => derivedScalar(derived, 'net_force')).toThrow(/vector/)
  })
})
