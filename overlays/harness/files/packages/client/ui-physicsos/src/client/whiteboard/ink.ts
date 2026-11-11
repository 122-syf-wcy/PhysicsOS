export interface InkSample { readonly x: number; readonly y: number; readonly pressure: number; readonly time: number }
export interface InkViewport { readonly offsetLeft: number; readonly offsetTop: number; readonly scrollX: number; readonly scrollY: number; readonly zoom: { readonly value: number } }
export interface InkPointer { readonly clientX: number; readonly clientY: number; readonly pressure: number; readonly timeStamp: number; readonly getCoalescedEvents?: () => readonly InkPointer[] }
export function readInkSamples(event: InkPointer, viewport: InkViewport): readonly InkSample[] {
  const events = [...(event.getCoalescedEvents?.() ?? [])]
  const last = events.at(-1)
  if (!last || last.clientX !== event.clientX || last.clientY !== event.clientY || last.pressure !== event.pressure || last.timeStamp !== event.timeStamp) events.push(event)
  return events.map(point => ({ x: (point.clientX - viewport.offsetLeft) / viewport.zoom.value - viewport.scrollX, y: (point.clientY - viewport.offsetTop) / viewport.zoom.value - viewport.scrollY, pressure: point.pressure, time: point.timeStamp }))
}
export function inkElementPoints(samples: readonly InkSample[], origin: { readonly x: number; readonly y: number }): { readonly points: readonly (readonly [number, number])[]; readonly pressures: readonly number[] } {
  return { points: samples.map(point => [point.x - origin.x, point.y - origin.y]), pressures: samples.map(point => point.pressure) }
}
