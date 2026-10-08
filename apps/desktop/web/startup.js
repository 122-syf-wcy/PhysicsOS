export function createStartupController(invoke, render, timers = globalThis) {
  let revision = 0
  let timer
  const update = async (command) => {
    const current = ++revision
    timers.clearTimeout(timer)
    try {
      const state = await invoke(command)
      if (current !== revision) return
      render(state)
      if (state.phase !== 'ready')
        timer = timers.setTimeout(() => {
          void update('web_host_status')
        }, 500)
    } catch (error) {
      if (current === revision)
        render({
          phase: 'failed',
          message: `无法连接桌面服务：${error instanceof Error ? error.message : String(error)}`,
          logs: [],
        })
    }
  }
  return {
    poll: () => update('web_host_status'),
    retry: () => {
      render({ phase: 'starting', message: '正在重新启动…', logs: [] })
      return update('web_host_retry')
    },
    dispose: () => {
      revision++
      timers.clearTimeout(timer)
    },
  }
}

if (typeof document !== 'undefined') {
  const message = document.querySelector('#message')
  const retry = document.querySelector('#retry')
  const diagnostics = document.querySelector('#diagnostics')
  const logs = document.querySelector('#logs')
  const controller = createStartupController(
    (command) => {
      const invoke = globalThis.__TAURI__?.core?.invoke
      if (typeof invoke !== 'function')
        return Promise.reject(new Error('请从 PhysicsOS 桌面应用打开此页面'))
      return invoke(command)
    },
    (state) => {
      message.textContent = state.message
      retry.hidden = state.phase !== 'failed'
      retry.disabled = state.phase === 'starting'
      document.body.dataset.phase = state.phase
      diagnostics.hidden = state.phase !== 'failed' || state.logs.length === 0
      logs.textContent = state.logs.join('\n')
    },
  )
  retry.addEventListener('click', () => {
    void controller.retry()
  })
  globalThis.addEventListener('pagehide', () => controller.dispose(), { once: true })
  void controller.poll()
}
