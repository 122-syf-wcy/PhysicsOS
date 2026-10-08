/** Bounded reconciliation retries. A reconnect starts a fresh retry budget. */
export function startSyncRetry(sync: () => Promise<void>) {
  let disposed = false
  const isLive = (): boolean => !disposed
  let active = false
  let retries = 0
  let rerun = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const attempt = async (): Promise<void> => {
    if (disposed || active) return
    active = true
    try {
      await sync()
      retries = 0
    } catch {
      if (isLive() && retries < 6) {
        timer = setTimeout(() => { timer = undefined; void attempt() }, 1000 * 2 ** retries++)
      }
    } finally {
      active = false
      if (rerun && isLive()) { rerun = false; run() }
    }
  }
  const run = (): void => {
    if (disposed) return
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    retries = 0
    if (active) { rerun = true; return }
    void attempt()
  }
  window.addEventListener('online', run)
  run()
  return {
    run,
    dispose: (): void => {
      disposed = true
      window.removeEventListener('online', run)
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}
