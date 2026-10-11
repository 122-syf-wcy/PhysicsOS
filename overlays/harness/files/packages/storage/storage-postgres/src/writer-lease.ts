/**
 * Another live process holds this database/schema's writer lease. Retrying
 * cannot succeed while that owner is alive, so startup must stop here.
 */
export class WriterLeaseConflictError extends Error {
  /** @param message - Conflict description surfaced at startup. */
  constructor(message: string) {
    super(message)
    this.name = 'WriterLeaseConflictError'
  }
}

/** A database/schema has one writer while storage-domain caches rows in memory. */
export interface WriterConnection {
  connect(): Promise<unknown>
  query(sql: string, values?: string[]): Promise<{ rows: Record<string, unknown>[] }>
  end(): Promise<void>
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

/** Own a session-scoped advisory lock; it is never renewed by reacquiring it. */
export class PostgresWriterLease {
  private state: 'new' | 'held' | 'lost' | 'closed' = 'new'
  private heartbeat: ReturnType<typeof setTimeout> | undefined
  private deadline: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly connection: WriterConnection,
    private readonly schema: string,
    private readonly onLost: (error: Error) => void,
    private readonly timing = { intervalMs: 1_000, timeoutMs: 2_000 },
  ) {
    // A dead owning session releases its lock on the server. Continuing with
    // process-local snapshots would let an old writer coexist with its successor.
    connection.on('error', () => { this.lose() })
    connection.on('end', () => { this.lose() })
  }

  async acquire(): Promise<void> {
    if (this.state !== 'new') throw new Error('Postgres writer lease cannot be reacquired')
    try {
      await this.connection.connect()
      const result = await this.connection.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
        [`physicsos:single-writer:${this.schema}`],
      )
      if (result.rows[0]?.acquired !== true) {
        throw new WriterLeaseConflictError('Another PhysicsOS writer already owns this PostgreSQL schema; run one app replica')
      }
      this.state = 'held'
      this.schedule()
    } catch (error) {
      await this.close()
      throw error
    }
  }

  assertHeld(): void {
    // Loss is detected by the connection's own events and by unanswered
    // probes; a slow request must never turn a busy event loop into a kill.
    if (this.state !== 'held') throw new Error('Postgres writer lease is unavailable')
  }

  private schedule(): void {
    this.heartbeat = setTimeout(() => { void this.probe() }, this.timing.intervalMs)
    this.heartbeat.unref()
  }

  private held(): boolean { return this.state === 'held' }

  private async probe(): Promise<void> {
    if (!this.held()) return
    const state = { settled: false }
    const alive = this.connection.query('SELECT 1 AS alive')
    this.deadline = setTimeout(() => {
      // A deadline timer fires late when a synchronous request (for example
      // password verification) stalls the event loop. Give the queued probe
      // response one loop turn to settle before treating the lease as lost;
      // an unanswered probe still loses ownership on the next turn.
      setTimeout(() => { if (!state.settled) this.lose() }, 0).unref()
    }, this.timing.timeoutMs)
    this.deadline.unref()
    try {
      await alive
      state.settled = true
      clearTimeout(this.deadline)
      if (!this.held()) return
      this.schedule()
    } catch {
      state.settled = true
      this.lose()
    }
  }

  private lose(): void {
    if (!this.held()) return
    this.state = 'lost'
    if (this.heartbeat !== undefined) clearTimeout(this.heartbeat)
    if (this.deadline !== undefined) clearTimeout(this.deadline)
    this.onLost(new Error('Postgres writer session lost; stopping to protect cached business state'))
  }

  async close(): Promise<void> {
    if (this.state === 'closed') return
    this.state = 'closed'
    if (this.heartbeat !== undefined) clearTimeout(this.heartbeat)
    if (this.deadline !== undefined) clearTimeout(this.deadline)
    // No global key deletion or unlock from another connection: closing this
    // exact session can only release locks that this session owns.
    await this.connection.end().catch(() => {})
  }
}
