export type PhysicalDimension =
  | 'dimensionless'
  | 'length'
  | 'time'
  | 'mass'
  | 'electric_current'
  | 'temperature'
  | 'electric_charge'
  | 'velocity'
  | 'acceleration'
  | 'force'
  | 'energy'
  | 'power'
  | 'electric_field'
  | 'electric_potential'
  | 'magnetic_flux_density'
  | 'magnetic_flux'
  | 'resistance'
  | 'capacitance'
  | 'inductance'
  | 'frequency'
  | 'angle'
  | 'angular_velocity'
  | 'momentum'
  | 'pressure'
  | 'density'

const ALL_DIMENSIONS: readonly PhysicalDimension[] = [
  'dimensionless',
  'length',
  'time',
  'mass',
  'electric_current',
  'temperature',
  'electric_charge',
  'velocity',
  'acceleration',
  'force',
  'energy',
  'power',
  'electric_field',
  'electric_potential',
  'magnetic_flux_density',
  'magnetic_flux',
  'resistance',
  'capacitance',
  'inductance',
  'frequency',
  'angle',
  'angular_velocity',
  'momentum',
  'pressure',
  'density',
]

const DIMENSION_SET: ReadonlySet<string> = new Set(ALL_DIMENSIONS)

export const physicalDimensions = (): readonly PhysicalDimension[] => ALL_DIMENSIONS

export const isPhysicalDimension = (value: unknown): value is PhysicalDimension =>
  typeof value === 'string' && DIMENSION_SET.has(value)
