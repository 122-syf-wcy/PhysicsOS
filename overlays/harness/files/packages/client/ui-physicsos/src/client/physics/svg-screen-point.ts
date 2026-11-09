export interface SvgClientPoint { readonly clientX: number; readonly clientY: number }
export interface SvgPoint { readonly x: number; readonly y: number }

/** Invert the actual SVG screen transform; the fallback models its axis-aligned viewBox viewport. */
export function svgPointFromClient(svg: SVGSVGElement, point: SvgClientPoint): SvgPoint | undefined {
  if (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return undefined
  let matrix: DOMMatrix | null = null
  try { matrix = svg.getScreenCTM?.() ?? null } catch { /* An unavailable SVG API uses the measured viewport below. */ }
  if (matrix !== null) {
    const coefficients = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
    if (!coefficients.every(Number.isFinite) || matrix.a * matrix.d - matrix.b * matrix.c === 0) return undefined
    try {
      const inverse = matrix.inverse()
      const x = inverse.a * point.clientX + inverse.c * point.clientY + inverse.e
      const y = inverse.b * point.clientX + inverse.d * point.clientY + inverse.f
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined
    } catch { return undefined }
  }
  const native = svg.viewBox?.baseVal
  const values = native === undefined
    ? (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
    : [native.x, native.y, native.width, native.height]
  if (values.length !== 4 || !values.every(Number.isFinite)) return undefined
  const [originX, originY, width, height] = values as [number, number, number, number]
  const rect = svg.getBoundingClientRect()
  if (width <= 0 || height <= 0 || rect.width <= 0 || rect.height <= 0
    || ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)) return undefined
  const aspect = (svg.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet').trim().split(/\s+/).filter(value => value !== 'defer')
  const sx = rect.width / width
  const sy = rect.height / height
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return undefined
  if (aspect[0] === 'none') {
    const x = originX + (point.clientX - rect.left) / sx
    const y = originY + (point.clientY - rect.top) / sy
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined
  }
  const alignment = /^(xMin|xMid|xMax)(YMin|YMid|YMax)$/.exec(aspect[0] ?? '')
  const alignX = alignment?.[1] === 'xMin' ? 0 : alignment?.[1] === 'xMax' ? 1 : 0.5
  const alignY = alignment?.[2] === 'YMin' ? 0 : alignment?.[2] === 'YMax' ? 1 : 0.5
  const scale = aspect[1] === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy)
  const x = originX + (point.clientX - rect.left - (rect.width - width * scale) * alignX) / scale
  const y = originY + (point.clientY - rect.top - (rect.height - height * scale) * alignY) / scale
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined
}
