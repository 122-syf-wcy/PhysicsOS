import { WorkerSession } from './runtime/worker-session.ts'
import type { WorkerRequest } from './runtime/transport.ts'

interface WorkerGlobal {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}
const worker = globalThis as unknown as WorkerGlobal
const session = new WorkerSession({ now: () => performance.now(),
  post: (message, transfer) => worker.postMessage(message, transfer),
  schedule: (callback, delay) => setTimeout(callback, delay), cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
})
// Serial commands also serialize asynchronous raw exports. Acknowledgements never mutate physics.
let commands = Promise.resolve()
worker.onmessage = (event): void => {
  if (event.data.type === 'ack') { void session.receive(event.data); return }
  commands = commands.then(() => session.receive(event.data))
}
