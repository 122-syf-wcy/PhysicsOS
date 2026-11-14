import type { EventTable, JobEvent, JobTable, TaskRecord } from './types.ts'

/** In-memory tables for tests and local development; production binds storage-domain tables. */
export class MemoryJobTable implements JobTable {
  private readonly rows = new Map<string, TaskRecord>()
  get(id: string): TaskRecord | undefined { return this.rows.get(id) }
  entries(): Iterable<readonly [string, TaskRecord]> { return this.rows.entries() }
  async put(id: string, record: TaskRecord): Promise<unknown> { this.rows.set(id, structuredClone(record)); return undefined }
  async delete(id: string): Promise<unknown> { this.rows.delete(id); return undefined }
}

export class MemoryEventTable implements EventTable {
  private readonly rows = new Map<string, JobEvent>()
  get(id: string): JobEvent | undefined { return this.rows.get(id) }
  entries(): Iterable<readonly [string, JobEvent]> { return this.rows.entries() }
  async put(id: string, record: JobEvent): Promise<unknown> { this.rows.set(id, structuredClone(record)); return undefined }
  async delete(id: string): Promise<unknown> { this.rows.delete(id); return undefined }
  size(): number { return this.rows.size }
}
