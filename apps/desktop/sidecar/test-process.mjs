import { spawn } from 'node:child_process'

/** Test-only child observer: never discard the evidence for a failed boot. */
export function observeChild(child) {
  let output = ''
  let failure
  const append = (chunk) => {
    output = (output + String(chunk)).slice(-16_000)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  child.on('error', (error) => {
    failure = error.message
  })
  return {
    diagnostics: () => output,
    assertRunning() {
      if (failure !== undefined || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `child exited (${failure ?? child.exitCode ?? child.signalCode}); output:\n${output}`,
        )
      }
    },
  }
}

export function spawnObserved(command, args, options) {
  const child = spawn(command, args, options)
  return { child, ...observeChild(child) }
}

export async function stopChild(child, timeoutMs = 2_000) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => {
    child.once('exit', resolve)
    child.once('error', resolve)
  })
  const wait = async (ms) => {
    let timer
    try {
      return await Promise.race([
        exited.then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), ms)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  child.kill('SIGTERM')
  if (await wait(timeoutMs)) return
  child.kill('SIGKILL')
  if (!(await wait(timeoutMs))) throw new Error('child did not exit after SIGKILL')
}

export async function registerWhenReady(baseUrl, credentials, observer, timeoutMs = 30_000) {
  let lastStatus
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    observer.assertRunning()
    try {
      const response = await fetch(`${baseUrl}/physicsos/auth/register`, {
        method: 'POST',
        signal: AbortSignal.timeout(Math.max(1, Math.min(1_000, deadline - Date.now()))),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credentials),
      })
      lastStatus = response.status
      if (response.ok) return response
      if (response.status !== 404 && response.status !== 405) {
        throw new Error(
          `registration failed with HTTP ${String(response.status)}: ${await response.text()}`,
        )
      }
    } catch (error) {
      if (lastStatus !== undefined && lastStatus !== 404 && lastStatus !== 405) throw error
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, Math.min(100, deadline - Date.now()))),
    )
  }
  throw new Error(
    `Harness register route did not become ready (last HTTP ${String(lastStatus)}); output:\n${observer.diagnostics()}`,
  )
}
