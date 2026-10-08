import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStartupController } from './startup.js'

const scheduling = () => ({ setTimeout: () => 1, clearTimeout: () => {} })

test('failed startup shows diagnostics and retry starts a new attempt', async () => {
  const screens = []
  const calls = []
  const controller = createStartupController(
    async (command) => {
      calls.push(command)
      return command === 'web_host_status'
        ? { generation: 1, phase: 'failed', message: '启动超时', logs: ['missing auth plugin'] }
        : { generation: 2, phase: 'starting', message: '正在重试', logs: [] }
    },
    (state) => screens.push(state),
    scheduling(),
  )
  await controller.poll()
  assert.equal(screens.at(-1).phase, 'failed')
  assert.deepEqual(screens.at(-1).logs, ['missing auth plugin'])
  await controller.retry()
  assert.deepEqual(calls, ['web_host_status', 'web_host_retry'])
  assert.equal(screens.at(-1).generation, 2)
  assert.equal(screens.at(-1).phase, 'starting')
})

test('an older status request cannot overwrite retry state', async () => {
  const screens = []
  let resolveOld
  const controller = createStartupController(
    (command) =>
      command === 'web_host_status'
        ? new Promise((resolve) => {
            resolveOld = resolve
          })
        : Promise.resolve({ generation: 2, phase: 'starting', message: 'new attempt', logs: [] }),
    (state) => screens.push(state),
    scheduling(),
  )
  const old = controller.poll()
  await controller.retry()
  resolveOld({ generation: 1, phase: 'failed', message: 'old failure', logs: [] })
  await old
  assert.equal(screens.at(-1).message, 'new attempt')
})

test('IPC failure remains visible and can be retried', async () => {
  const screens = []
  const controller = createStartupController(
    async () => {
      throw new Error('native command unavailable')
    },
    (state) => screens.push(state),
    scheduling(),
  )
  await controller.poll()
  assert.equal(screens.at(-1).phase, 'failed')
  assert.match(screens.at(-1).message, /native command unavailable/)
})
