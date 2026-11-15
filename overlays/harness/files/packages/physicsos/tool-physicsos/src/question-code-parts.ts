/** Bounded byte-preserving source assembly. Never executes or supplies renderer code. */
export const MAX_CODE_PART_CHARACTERS = 24000
/** Keep ordinary tool completions well below the output cap, without rejecting larger valid writes. */
export const CODE_PART_TARGET_CHARACTERS = 6000
export const CODE_FILE_LIMITS = { rendererJs: 24000, stylesheet: 6000 } as const
export interface CodeWriteReceipt {
  file: string
  characters: number
  remainingWrites: number
  remainingCharacters: number
  suggestedPartCharacters: number
}
export class QuestionCodeParts {
  private writes = 0
  private readonly parts = { rendererJs: '', stylesheet: '' }
  private readonly pending = new Set<string>()
  write(file: 'rendererJs' | 'stylesheet', mode: 'replace' | 'append', content: string): CodeWriteReceipt {
    const staged = this.stage(file, mode, content)
    staged.commit()
    return staged.result
  }
  stage(file: 'rendererJs' | 'stylesheet', mode: 'replace' | 'append', content: string) {
    if (this.writes >= 10) throw new Error('CODE_WRITE_LIMIT')
    this.writes++
    if (this.pending.has(file)) throw new Error('CODE_WRITE_PENDING: await the previous write before continuing this file')
    if (content.length > MAX_CODE_PART_CHARACTERS) throw new Error('CODE_PART_TOO_LARGE')
    const next = mode === 'append' ? this.parts[file] + content : content
    if (next.length > CODE_FILE_LIMITS[file]) throw new Error('CODE_SOURCE_TOO_LARGE')
    this.pending.add(file)
    let settled = false
    const settle = (accepted: boolean): void => {
      if (settled) return
      settled = true
      this.pending.delete(file)
      if (accepted) this.parts[file] = next
    }
    const remainingCharacters = CODE_FILE_LIMITS[file] - next.length
    return { result: { file, characters: next.length, remainingWrites: 10 - this.writes,
      remainingCharacters, suggestedPartCharacters: Math.min(CODE_PART_TARGET_CHARACTERS, remainingCharacters) },
      commit: (): void => { settle(true) }, discard: (): void => { settle(false) } }
  }
  source(): { rendererJs: string; stylesheet: string } { return { ...this.parts } }
}
