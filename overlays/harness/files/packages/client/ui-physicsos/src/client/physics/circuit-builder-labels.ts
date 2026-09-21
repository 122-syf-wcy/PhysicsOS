/**
 * Display vocabulary shared by the free-build bench and its canvas.
 *
 * Kept apart from `circuit-builder.ts` so the authoring model stays pure logic
 * with no presentation in it, and apart from the panel so the renderer can name
 * a terminal without importing the panel.
 */

import type { BuilderComponentType } from './circuit-builder.ts'

/** Kinds whose default is the ideal (zero / infinite resistance) element. */
export const CIRCUIT_METER_KINDS: readonly BuilderComponentType[] = ['ammeter', 'voltmeter']

/** Short terminal names for the compact readouts beside a part. */
export const TERMINAL_LABELS: Readonly<Record<string, string>> = {
  a: 'A',
  b: 'B',
  positive: '+',
  negative: '−',
}

/**
 * Which sprite a part draws as, from its kind and its actual rating.
 *
 * The bench stocks more than one of some parts — a dry cell, a battery pack and
 * a bench supply are all voltage sources — so the drawn apparatus has to follow
 * the value the student set, not just the element type. Palette and canvas both
 * call this with the same numbers, so the part you pick is the part you see.
 *
 * Ratings are compared with slack because the inspector accepts any number: a
 * value between two stocked sizes keeps the smaller part rather than dropping
 * to nothing.
 */
export const spriteIdFor = (
  kind: BuilderComponentType,
  rating: number | undefined,
  closed: boolean | undefined,
): string => {
  switch (kind) {
    case 'voltage_source':
      if (rating === undefined) return 'battery'
      if (rating <= 2) return 'cell-aa'
      if (rating <= 9) return 'battery-pack'
      return 'supply-dc'
    case 'resistor':
      if (rating === undefined) return 'resistor'
      if (rating <= 5) return 'resistor-5'
      if (rating >= 50) return 'resistor-50'
      return 'resistor'
    case 'variable_resistor':
      return rating !== undefined && rating >= 50 ? 'rheostat-50' : 'rheostat'
    case 'switch':
      return closed === false ? 'switch-open' : 'switch-closed'
    case 'ammeter':
    case 'voltmeter':
      return 'meter'
  }
}

/** The rating a kind is judged by; meters have none. */
export const ratingOfParams = (
  kind: BuilderComponentType,
  params: { readonly voltage?: number; readonly resistance?: number; readonly totalResistance?: number },
): number | undefined => {
  switch (kind) {
    case 'voltage_source':
      return params.voltage
    case 'resistor':
      return params.resistance
    case 'variable_resistor':
      return params.totalResistance
    default:
      return undefined
  }
}

