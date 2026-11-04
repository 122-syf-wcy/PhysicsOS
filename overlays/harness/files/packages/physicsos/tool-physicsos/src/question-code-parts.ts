/** Bounded byte-preserving source assembly. Never executes or supplies renderer code. */
export class QuestionCodeParts {
  private writes = 0
  private readonly parts = { rendererJs: '', stylesheet: '' }
  write(file: 'rendererJs' | 'stylesheet', mode: 'replace' | 'append', content: string): { file: string; characters: number; remainingWrites: number } {
    const staged = this.stage(file, mode, content)
    staged.commit()
    return staged.result
  }
  stage(file: 'rendererJs' | 'stylesheet', mode: 'replace' | 'append', content: string) {
    if (this.writes >= 10) throw new Error('CODE_WRITE_LIMIT')
    this.writes++
    if (content.length > 2400) throw new Error('CODE_PART_TOO_LARGE')
    const next = mode === 'append' ? this.parts[file] + content : content
    if (next.length > (file === 'rendererJs' ? 24000 : 6000)) throw new Error('CODE_SOURCE_TOO_LARGE')
    return { result: { file, characters: next.length, remainingWrites: 10 - this.writes }, commit: (): void => { this.parts[file] = next } }
  }
  source(): { rendererJs: string; stylesheet: string } { return { ...this.parts } }
}
