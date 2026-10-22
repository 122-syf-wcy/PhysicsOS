/** Fit canvas readouts without clipping quantities or changing their text. */
export interface ReadoutLine {
  readonly text: string
  readonly title: boolean
}

const glyphWidth = (glyph: string): number =>
  (glyph.codePointAt(0)! > 0x2e80 ? 1 : 0.62) * 11.5

export function layoutReadout(readings: readonly string[], availableWidth: number): {
  lines: readonly ReadoutLine[]
  width: number
  height: number
} {
  if (readings.length === 0) return { lines: [], width: 0, height: 0 }
  const textWidth = Math.max(12, availableWidth - 24)
  const lines: ReadoutLine[] = []
  let widest = 0
  readings.forEach((reading, index) => {
    let text = ''
    let width = 0
    for (const glyph of reading) {
      const next = glyphWidth(glyph)
      if (text.length > 0 && width + next > textWidth) {
        lines.push({ text, title: index === 0 })
        widest = Math.max(widest, width)
        text = ''
        width = 0
      }
      text += glyph
      width += next
    }
    lines.push({ text, title: index === 0 })
    widest = Math.max(widest, width)
  })
  return { lines, width: widest + 24, height: 20 + lines.length * 16 }
}
