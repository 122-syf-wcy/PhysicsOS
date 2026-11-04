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
    if (this.writes >= 10) throw new Error('CODE_WRITE_LIMIT：本次10次写入额度已用完，未改动已有源码。仅当现有源码完整时提交title/summary，不要继续写入。')
    this.writes++
    if (content.length > 2400) throw new Error(`CODE_PART_TOO_LARGE：本段${content.length}字符，超过2400字符；本段完全未写入，已有${file}保留${this.parts[file].length}字符。剩余${10 - this.writes}次写入；拆成每段1200–1800字符后按原mode提交，后续段用append，不要重复已成功片段。`)
    const next = mode === 'append' ? this.parts[file] + content : content
    if (next.length > (file === 'rendererJs' ? 24000 : 6000)) throw new Error(`CODE_SOURCE_TOO_LARGE：${file}合计${next.length}字符超过文件上限，本段未写入；请精简代码。剩余${10 - this.writes}次写入。`)
    return { result: { file, characters: next.length, remainingWrites: 10 - this.writes }, commit: (): void => { this.parts[file] = next } }
  }
  source(): { rendererJs: string; stylesheet: string } { return { ...this.parts } }
}
