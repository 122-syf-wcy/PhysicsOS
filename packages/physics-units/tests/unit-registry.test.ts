import { describe, expect, it } from 'vitest'

import {
  assertDimension,
  canonicalSymbolFor,
  canonicalUnitFor,
  DimensionMismatchError,
  dimensionOf,
  isKnownUnit,
  normalizeUnitSymbol,
  resolveUnit,
  UnknownUnitError,
} from '../src/unit-registry.ts'

describe('unit registry', () => {
  it('resolves SI symbols for the magnetic slice', () => {
    expect(dimensionOf('C')).toBe('electric_charge')
    expect(dimensionOf('kg')).toBe('mass')
    expect(dimensionOf('m')).toBe('length')
    expect(dimensionOf('s')).toBe('time')
    expect(dimensionOf('m/s')).toBe('velocity')
    expect(dimensionOf('N')).toBe('force')
    expect(dimensionOf('T')).toBe('magnetic_flux_density')
    expect(dimensionOf('rad')).toBe('angle')
    expect(dimensionOf('rad/s')).toBe('angular_velocity')
  })

  it('exposes canonical SI units per dimension', () => {
    expect(canonicalSymbolFor('mass')).toBe('kg')
    expect(canonicalSymbolFor('length')).toBe('m')
    expect(canonicalSymbolFor('velocity')).toBe('m/s')
    expect(canonicalSymbolFor('magnetic_flux_density')).toBe('T')
    expect(canonicalUnitFor('angular_velocity').key).toBe('radian_per_second')
    expect(canonicalSymbolFor('volume')).toBe('m^3')
    expect(canonicalSymbolFor('torque')).toBe('N*m')
    expect(canonicalUnitFor('torque').key).toBe('newton_meter')
    expect(dimensionOf('N*cm')).toBe('torque')
  })

  it('rejects unregistered units instead of guessing', () => {
    expect(() => resolveUnit('tesla-ish')).toThrow(UnknownUnitError)
    expect(isKnownUnit('T ')).toBe(true)
    expect(isKnownUnit('特斯拉')).toBe(false)
  })

  it('accepts documented aliases', () => {
    expect(resolveUnit('metre').key).toBe('meter')
    expect(resolveUnit('kph').key).toBe('kilometer_per_hour')
    expect(resolveUnit('N/C').key).toBe('volt_per_meter')
  })

  it('normalizes look-alike ohm codepoints onto one resistance unit', () => {
    const ohmSign = resolveUnit('\u2126')
    const greekOmega = resolveUnit('\u03a9')
    const asciiKey = resolveUnit('ohm')

    expect(ohmSign.key).toBe('ohm')
    expect(greekOmega.key).toBe('ohm')
    expect(asciiKey.key).toBe('ohm')
    expect(ohmSign).toBe(greekOmega)
    expect(ohmSign.dimension).toBe('resistance')
    expect(normalizeUnitSymbol('\u2126')).toBe(normalizeUnitSymbol('\u03a9'))
  })

  it('normalizes micro-sign variants for microsecond', () => {
    expect(resolveUnit('\u00b5s').key).toBe('microsecond')
    expect(resolveUnit('\u03bcs').key).toBe('microsecond')
  })

  it('keeps program identity ASCII while display symbol stays Unicode', () => {
    const ohm = resolveUnit('ohm')
    expect(ohm.key).toBe('ohm')
    expect(ohm.symbol).toBe('\u03a9')
  })

  it('asserts dimensions and reports mismatches', () => {
    expect(assertDimension('T', 'magnetic_flux_density').key).toBe('tesla')
    expect(() => assertDimension('T', 'mass')).toThrow(DimensionMismatchError)
  })
})
