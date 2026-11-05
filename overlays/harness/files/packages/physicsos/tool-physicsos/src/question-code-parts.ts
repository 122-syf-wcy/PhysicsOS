/** Bounded byte-preserving source assembly. Never executes or supplies renderer code. */
export class QuestionCodeParts {
  private writes = 0
  private readonly parts = { rendererJs: '', stylesheet: '' }
  private readonly pending = new Set<string>()
  write(file: 'rendererJs' | 'stylesheet', mode: 'replace' | 'append', content: string): { file: string; characters: number; remainingWrites: number } {
    const staged = this.stage(file, mode, content)
    staged.commit()
    return staged.result
  }
  stage(file: 'rendererJs' | 'stylesheet', mode: 'replace' | 'append', content: string) {
    if (this.writes >= 10) throw new Error('CODE_WRITE_LIMIT')
    this.writes++
    if (this.pending.has(file)) throw new Error('CODE_WRITE_PENDING: await the previous write before continuing this file')
    if (content.length > 2400) throw new Error('CODE_PART_TOO_LARGE')
    const next = mode === 'append' ? this.parts[file] + content : content
    if (next.length > (file === 'rendererJs' ? 24000 : 6000)) throw new Error('CODE_SOURCE_TOO_LARGE')
    this.pending.add(file)
    let settled = false
    const settle = (accepted: boolean): void => {
      if (settled) return
      settled = true
      this.pending.delete(file)
      if (accepted) this.parts[file] = next
    }
    return { result: { file, characters: next.length, remainingWrites: 10 - this.writes },
      commit: (): void => { settle(true) }, discard: (): void => { settle(false) } }
  }
  source(): { rendererJs: string; stylesheet: string } { return { ...this.parts } }
}
