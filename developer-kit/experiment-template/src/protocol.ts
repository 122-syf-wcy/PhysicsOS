/** Convex-lens protocol v1: platform engine snapshots and an explicitly marked local fixture. */
export interface ExperimentSnapshot {
  readonly revision: number
  readonly source: 'preview-fixture' | 'platform-engine'
  readonly parameters: {
    readonly objectDistanceCm: number
    readonly objectHeightCm: number
    readonly focalLengthCm: number
    readonly screenDistanceCm: number
  }
  readonly visible: { readonly image: boolean; readonly rays: boolean }
  /** Lens-relative x/y coordinates in centimetres; production paths come from the engine. */
  readonly rays: readonly {
    readonly points: readonly { readonly x: number; readonly y: number }[]
    readonly extension?: readonly { readonly x: number; readonly y: number }[]
  }[]
  readonly result: {
    readonly imageDistanceCm: number | null
    readonly imageHeightCm: number | null
    readonly imageKind: 'real' | 'virtual' | 'none'
    readonly screenSharp: boolean
  }
}

export type ParameterId = 'objectDistanceCm' | 'focalLengthCm' | 'screenDistanceCm'
export type ExperimentIntent =
  | {
      readonly type: 'parameter/preview' | 'parameter/commit'
      readonly id: ParameterId
      readonly value: number
    }
  | { readonly type: 'parameter/cancel' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRayPath(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 16 &&
    value.every((point) => isRecord(point) && finite(point.x) && finite(point.y))
  )
}

export function isSnapshot(value: unknown): value is ExperimentSnapshot {
  if (
    !isRecord(value) ||
    !isRecord(value.parameters) ||
    !isRecord(value.result) ||
    !isRecord(value.visible)
  )
    return false
  const parameters = value.parameters
  const result = value.result
  return (
    finite(value.revision) &&
    Number.isInteger(value.revision) &&
    value.revision >= 0 &&
    (value.source === 'preview-fixture' || value.source === 'platform-engine') &&
    finite(parameters.objectDistanceCm) &&
    parameters.objectDistanceCm > 0 &&
    finite(parameters.objectHeightCm) &&
    parameters.objectHeightCm > 0 &&
    typeof value.visible.image === 'boolean' &&
    typeof value.visible.rays === 'boolean' &&
    Array.isArray(value.rays) &&
    value.rays.length <= 12 &&
    value.rays.every(
      (ray) =>
        isRecord(ray) &&
        isRayPath(ray.points) &&
        (ray.extension === undefined || isRayPath(ray.extension)),
    ) &&
    finite(parameters.focalLengthCm) &&
    parameters.focalLengthCm > 0 &&
    finite(parameters.screenDistanceCm) &&
    parameters.screenDistanceCm > 0 &&
    (result.imageDistanceCm === null || finite(result.imageDistanceCm)) &&
    (result.imageHeightCm === null || finite(result.imageHeightCm)) &&
    ['real', 'virtual', 'none'].includes(String(result.imageKind)) &&
    typeof result.screenSharp === 'boolean'
  )
}

export interface ExperimentConnection {
  send: (intent: ExperimentIntent) => void
  dispose: () => void
}

/** Validate source, exact host origin and one-use channel token before accepting a port. */
export function connectExperiment(
  onFrame: (frame: ExperimentSnapshot) => void,
): ExperimentConnection {
  const query = new URLSearchParams(location.search)
  const host = query.get('hostOrigin')
  const token = query.get('channel')
  if (!host || !token || !/^[a-zA-Z0-9-]{16,80}$/.test(token))
    throw new Error('请从模板预览器打开实验。')
  const origin = new URL(host)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== host)
    throw new Error('无效宿主来源。')
  let port: MessagePort | undefined
  const receive = (event: MessageEvent<unknown>): void => {
    if (event.source !== parent || event.origin !== host || !isRecord(event.data)) return
    if (
      event.data.type !== 'experiment/connect' ||
      event.data.protocolVersion !== 1 ||
      event.data.channel !== token
    )
      return
    const received = event.ports[0]
    if (!received || port) return
    port = received
    removeEventListener('message', receive)
    received.onmessage = (message: MessageEvent<unknown>): void => {
      if (!isRecord(message.data) || message.data.type !== 'experiment/snapshot') return
      if (isSnapshot(message.data.snapshot)) onFrame(message.data.snapshot)
    }
    received.start()
    received.postMessage({ type: 'experiment/connected', protocolVersion: 1 })
  }
  addEventListener('message', receive)
  parent.postMessage({ type: 'experiment/ready', protocolVersion: 1, channel: token }, host)
  return {
    send: (intent): void => {
      port?.postMessage(intent)
    },
    dispose: (): void => {
      removeEventListener('message', receive)
      port?.close()
    },
  }
}
