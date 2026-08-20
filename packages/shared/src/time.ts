export type IsoDateTime = string

export function isIsoDateTime(value: string): value is IsoDateTime {
  return Number.isFinite(Date.parse(value))
}
