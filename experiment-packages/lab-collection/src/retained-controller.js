// This controller schedules drawing, never simulation. V3 awaits submit() and
// may ACK only when its EXACT submitted trusted snapshot has really drawn.
export function createRetainedController({ draw, recover = () => {}, visible = () => true, pageVisible = visible, onState = () => {}, onFailure = () => {}, onLoss = () => {}, timeout = 10000,
  now = () => performance.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) }) {
  let phase = 'ready', latest, suspended = false, failure, timer, started, remaining = timeout, recoveryPending = false
  const pending = []
  const transition = next => { if (phase !== next) { phase = next; onState(next) } }
  const canDraw = () => !suspended && visible()
  const budgetActive = () => !suspended && pageVisible()
  const stopTimer = () => {
    if (timer === undefined) return
    clearTimer(timer); timer = undefined
    remaining = Math.max(0, remaining - (now() - started))
  }
  const refreshTimer = () => {
    const waiting = ['contextlost', 'recovering'].includes(phase) || pending.length > 0
    if (!waiting || !budgetActive()) { stopTimer(); return }
    if (timer !== undefined) return
    started = now()
    timer = setTimer(() => {
      timer = undefined; remaining = Math.max(0, remaining - (now() - started))
      if (!budgetActive()) return
      fail(new Error(['contextlost', 'recovering'].includes(phase) ? 'WebGL recovery timed out' : 'Experiment viewport remained undrawable'))
    }, Math.max(1, remaining))
  }
  function fail(error) {
    if (phase === 'disposed' || phase === 'failed') return
    stopTimer(); failure = error instanceof Error ? error : new Error(String(error)); transition('failed')
    for (const request of pending.splice(0)) request.reject(failure)
    onFailure(failure)
  }
  const ready = () => { stopTimer(); remaining = timeout; recoveryPending = false; transition('ready') }
  function contextLost() {
    if (phase === 'disposed' || phase === 'failed') return
    if (phase !== 'contextlost' && phase !== 'recovering') remaining = timeout
    if (phase !== 'contextlost') { onLoss(); transition('contextlost') }
    recoveryPending = true; refreshTimer()
  }
  function resume(repaint = true) {
    if (phase === 'disposed' || phase === 'failed') return false
    refreshTimer()
    if (!canDraw() || phase === 'contextlost') return false
    try {
      if (phase === 'recovering' && recoveryPending) {
        // The renderer keeps its CPU scene, camera, materials and trusted frame;
        // only context-owned environment/shadow targets need regeneration.
        recover()
        if (phase === 'contextlost') return false
        recoveryPending = false
      }
      let drew = false
      while (pending.length) {
        const request = pending[0]
        if (!draw(request.snapshot, false)) { refreshTimer(); return false }
        pending.shift(); request.resolve(true); drew = true
        if (phase === 'contextlost' || !canDraw()) return drew
      }
      if (!drew && repaint && latest !== undefined) {
        if (!draw(latest, true)) { refreshTimer(); return false }
        drew = true
      }
      if (drew || latest === undefined) ready()
      return drew
    } catch (error) { fail(error); return false }
  }
  function submit(snapshot) {
    if (phase === 'disposed') throw new Error('Experiment display is disposed')
    if (phase === 'failed') throw failure
    latest = snapshot
    if (!pending.length && phase === 'ready' && canDraw()) {
      try {
        if (draw(snapshot, false)) return true
        // A loss discovered by draw() moves to contextlost. A plain zero-area
        // draw stays ready but still has a bounded pending visible-page budget.
      } catch (error) { fail(error); throw error }
    }
    const promise = new Promise((resolve, reject) => pending.push({ snapshot, resolve, reject }))
    refreshTimer()
    if (phase !== 'contextlost') resume(false)
    return promise
  }
  return {
    submit, resume, fail, contextLost,
    contextRestored() {
      if (phase !== 'contextlost') return
      transition('recovering'); recoveryPending = true; refreshTimer(); resume()
    },
    suspend(value) { suspended = value; refreshTimer(); if (!value) resume() },
    visibilityChanged() { refreshTimer(); resume() },
    dispose() {
      if (phase === 'disposed') return
      stopTimer(); transition('disposed')
      for (const request of pending.splice(0)) request.reject(new Error('Experiment display is disposed'))
      latest = undefined
    },
    get state() { return phase },
    get latestSnapshot() { return latest },
    get pendingCount() { return pending.length },
  }
}
