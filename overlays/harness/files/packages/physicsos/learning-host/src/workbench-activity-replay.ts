/** Metadata-only replay index. Business receipts remain the durable source; this index is rebuilt on boot. */
import { activitySuccessCapsuleSchema, type ActivityReplaySource, type ActivitySource, type ActivitySuccessCapsule } from './activity-contract.ts'

export class WorkbenchActivityReplay {
  private readonly capsules = new Map<string, ActivitySuccessCapsule>()
  private ordered: readonly { readonly id: string; readonly at: number; readonly capsule: ActivitySuccessCapsule }[] | undefined
  constructor(private readonly kind: ActivitySource) {}
  record(input: ActivitySuccessCapsule | undefined): void {
    if (input === undefined) return
    const capsule = activitySuccessCapsuleSchema.parse(input)
    if (capsule.source !== this.kind) throw new Error('Workbench activity capsule has a different source')
    const id = JSON.stringify([capsule.owner.schoolId, capsule.owner.userKey, capsule.operationId])
    const previous = this.capsules.get(id)
    if (previous !== undefined) {
      if (JSON.stringify(previous) !== JSON.stringify(capsule)) throw new Error('Workbench activity capsule changed its original durable fact')
      return
    }
    this.capsules.set(id, capsule); this.ordered = undefined
  }
  get source(): ActivityReplaySource { return {
    source: this.kind,
    read: async query => {
      query.signal.throwIfAborted()
      const from = Date.parse(query.from); const to = Date.parse(query.to)
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 500) throw new Error('Invalid workbench activity replay bounds')
      let after: { readonly at: number; readonly id: string } | undefined
      if (query.cursor !== undefined) {
        if (query.cursor.length > 4096) throw new Error('Invalid workbench activity replay cursor')
        const value: unknown = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))
        if (!value || typeof value !== 'object' || !('v' in value) || value.v !== 1 || !('source' in value) || value.source !== this.kind ||
          !('from' in value) || value.from !== query.from || !('to' in value) || value.to !== query.to ||
          !('at' in value) || typeof value.at !== 'number' || !Number.isFinite(value.at) || !('id' in value) || typeof value.id !== 'string') throw new Error('Workbench activity replay cursor does not match its bounds')
        after = { at: value.at, id: value.id }
      }
      // Sort compact metadata only once per changed index; subsequent pages visit at most limit + 1 entries.
      this.ordered ??= [...this.capsules].map(([id, capsule]) => ({ id, at: Date.parse(capsule.occurredAt), capsule }))
        .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      const ordered = this.ordered
      let low = 0; let high = ordered.length
      while (low < high) {
        const middle = (low + high) >>> 1; const item = ordered[middle]!
        if (item.at < from || after !== undefined && (item.at < after.at || item.at === after.at && item.id <= after.id)) low = middle + 1
        else high = middle
      }
      const page: typeof ordered[number][] = []
      for (let index = low; index < ordered.length && page.length <= query.limit; index++) {
        query.signal.throwIfAborted()
        const item = ordered[index]!
        if (item.at >= to) break
        page.push(item)
      }
      const more = page.length > query.limit
      const retained = page.slice(0, query.limit); const last = retained.at(-1)
      return { capsules: retained.map(item => item.capsule), ...(more && last ? { nextCursor: Buffer.from(JSON.stringify({ v: 1, source: this.kind,
        from: query.from, to: query.to, at: last.at, id: last.id })).toString('base64url') } : {}) }
    },
  } }
}
