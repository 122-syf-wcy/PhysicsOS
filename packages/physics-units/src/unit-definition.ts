import type { PhysicalDimension } from './dimension.ts'

/**
 * Stable, ASCII-only program identity for a unit. Never localized, never
 * Unicode-decorated: `ohm`, not `Ω`. Domain IDs must survive Unicode and
 * localization changes.
 */
export type UnitKey =
  | 'dimensionless'
  | 'meter'
  | 'centimeter'
  | 'millimeter'
  | 'kilometer'
  | 'second'
  | 'millisecond'
  | 'microsecond'
  | 'minute'
  | 'kilogram'
  | 'gram'
  | 'ampere'
  | 'kelvin'
  | 'coulomb'
  | 'millicoulomb'
  | 'microcoulomb'
  | 'nanocoulomb'
  | 'meter_per_second'
  | 'kilometer_per_hour'
  | 'kilometer_per_second'
  | 'meter_per_second_squared'
  | 'newton'
  | 'joule'
  | 'watt'
  | 'volt_per_meter'
  | 'volt'
  | 'tesla'
  | 'millitesla'
  | 'weber'
  | 'ohm'
  | 'farad'
  | 'henry'
  | 'hertz'
  | 'radian'
  | 'degree'
  | 'radian_per_second'
  | 'kilogram_meter_per_second'
  | 'pascal'
  | 'kilogram_per_cubic_meter'

/**
 * `docs/03` §12 mandates that every unit string travelling through the domain
 * contract comes from one registry. This is the contract-facing unit string
 * (`Quantity.unit`), distinct from the internal {@link UnitKey}.
 */
export interface UnitDefinition {
  readonly key: UnitKey
  readonly dimension: PhysicalDimension
  /** Contract-facing unit string used by `Quantity.unit` (docs/03 §12). */
  readonly symbol: string
  /** Multiplicative factor converting this unit into canonical SI. */
  readonly toSI: number
  /** True when the unit is the canonical SI unit for its dimension. */
  readonly canonical: boolean
  /** Accepted alternative spellings, normalized before lookup. */
  readonly aliases: readonly string[]
}

const define = (
  key: UnitKey,
  dimension: PhysicalDimension,
  symbol: string,
  toSI: number,
  canonical: boolean,
  aliases: readonly string[] = [],
): UnitDefinition => ({ key, dimension, symbol, toSI, canonical, aliases })

/**
 * Ohm is registered under the ASCII key `ohm` with GREEK CAPITAL LETTER OMEGA
 * (U+03A9) as its display symbol, matching docs/03 §12 verbatim. OHM SIGN
 * (U+2126) is an alias: NFC normalization folds U+2126 onto U+03A9, so both
 * inputs resolve to this single definition rather than two look-alike units.
 */
export const UNIT_DEFINITIONS: readonly UnitDefinition[] = [
  define('dimensionless', 'dimensionless', '', 1, true, ['1', '-']),

  define('meter', 'length', 'm', 1, true, ['metre', 'meters']),
  define('centimeter', 'length', 'cm', 1e-2, false, ['centimetre']),
  define('millimeter', 'length', 'mm', 1e-3, false, ['millimetre']),
  define('kilometer', 'length', 'km', 1e3, false, ['kilometre']),

  define('second', 'time', 's', 1, true, ['sec', 'seconds']),
  define('millisecond', 'time', 'ms', 1e-3, false),
  define('microsecond', 'time', 'us', 1e-6, false, ['\u00b5s', '\u03bcs']),
  define('minute', 'time', 'min', 60, false),

  define('kilogram', 'mass', 'kg', 1, true, ['kilogramme']),
  define('gram', 'mass', 'g', 1e-3, false, ['gramme']),

  define('ampere', 'electric_current', 'A', 1, true, ['amp']),
  define('kelvin', 'temperature', 'K', 1, true),
  define('coulomb', 'electric_charge', 'C', 1, true),
  define('millicoulomb', 'electric_charge', 'mC', 1e-3, false),
  define('microcoulomb', 'electric_charge', 'µC', 1e-6, false, ['μC', 'uC']),
  define('nanocoulomb', 'electric_charge', 'nC', 1e-9, false),

  define('meter_per_second', 'velocity', 'm/s', 1, true, ['m*s^-1', 'm s^-1', 'mps']),
  define('kilometer_per_hour', 'velocity', 'km/h', 1000 / 3600, false, ['kph', 'kmph']),
  define('kilometer_per_second', 'velocity', 'km/s', 1e3, false, ['km*s^-1']),

  define('meter_per_second_squared', 'acceleration', 'm/s^2', 1, true, [
    'm/s\u00b2',
    'm*s^-2',
  ]),

  define('newton', 'force', 'N', 1, true),
  define('joule', 'energy', 'J', 1, true),
  define('watt', 'power', 'W', 1, true),
  define('volt_per_meter', 'electric_field', 'V/m', 1, true, ['N/C']),
  define('volt', 'electric_potential', 'V', 1, true),
  define('tesla', 'magnetic_flux_density', 'T', 1, true),
  define('millitesla', 'magnetic_flux_density', 'mT', 1e-3, false),
  define('weber', 'magnetic_flux', 'Wb', 1, true),
  define('ohm', 'resistance', '\u03a9', 1, true, ['\u2126', 'ohm', 'ohms']),
  define('farad', 'capacitance', 'F', 1, true),
  define('henry', 'inductance', 'H', 1, true),
  define('hertz', 'frequency', 'Hz', 1, true, ['s^-1']),

  define('radian', 'angle', 'rad', 1, true),
  define('degree', 'angle', 'deg', Math.PI / 180, false, ['\u00b0']),
  define('radian_per_second', 'angular_velocity', 'rad/s', 1, true, ['rad*s^-1']),

  define('kilogram_meter_per_second', 'momentum', 'kg*m/s', 1, true, [
    'kg\u00b7m/s',
    'kg m/s',
  ]),
  define('pascal', 'pressure', 'Pa', 1, true),
  define('kilogram_per_cubic_meter', 'density', 'kg/m^3', 1, true, ['kg/m\u00b3']),
]
