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

/** Smooth only the visible outline. Each input sample and its pressure remains in storage. */
export function inkOutline(points: readonly (readonly [number, number])[], pressures: readonly number[], width: number): string {
  if (points.length === 0) return ''
  const visible = points.map((point, index): readonly [number, number] => {
    if (index === 0 || index === points.length - 1) return point
    const before = points[index - 1]!; const after = points[index + 1]!
    return [(before[0] + point[0] * 2 + after[0]) / 4, (before[1] + point[1] * 2 + after[1]) / 4]
  })
  const radii = pressures.map(pressure => width * (0.12 + Math.max(0, Math.min(1, pressure)) * 0.88) / 2)
  const left: (readonly [number, number])[] = []; const right: (readonly [number, number])[] = []
  visible.forEach((point, index) => {
    const before = visible[Math.max(0, index - 1)]!; const after = visible[Math.min(visible.length - 1, index + 1)]!
    const length = Math.hypot(after[0] - before[0], after[1] - before[1])
    const radius = radii[index] ?? width / 2
    const nx = length ? -(after[1] - before[1]) / length * radius : 0; const ny = length ? (after[0] - before[0]) / length * radius : radius
    left.push([point[0] + nx, point[1] + ny]); right.push([point[0] - nx, point[1] - ny])
  })
  const side = (points: readonly (readonly [number, number])[]): string => points.slice(1).map((point, i) => {
    const next = points[i + 2]
    return next ? `Q ${point.join(' ')} ${(point[0] + next[0]) / 2} ${(point[1] + next[1]) / 2}` : `L ${point.join(' ')}`
  }).join(' ')
  const end = right.at(-1)!; const start = left[0]!; const reversed = [...right].reverse()
  return `M ${start.join(' ')} ${side(left)} A ${radii.at(-1) ?? width / 2} ${radii.at(-1) ?? width / 2} 0 0 1 ${end.join(' ')} ${side(reversed)} A ${radii[0] ?? width / 2} ${radii[0] ?? width / 2} 0 0 1 ${start.join(' ')} Z`
}
