import type { AuthController } from './auth-store.ts'
import type { PhysicsSurfaceController } from './surface-store.ts'
import { createUsageApi, type UsageEventInput } from './usage-api.ts'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

/** One page visit per signed-in account, and real product-surface entries as uses. */
export function startUsageTelemetry(auth: AuthController, surface: PhysicsSurfaceController): () => void {
  let previous = '',
    ownerKey = '',
    stopped = false
  const visited = new Set<string>()
  const pending = new Map<string, { owner: { schoolId: string; username: string }; input: UsageEventInput }>()
  const sending = new Set<string>()
  const flush = (): void => {
    const user = auth.store.getSnapshot().user
    if (stopped || user === undefined) return
    for (const [id, event] of pending) {
      if (sending.has(id) || event.owner.schoolId !== user.schoolId || event.owner.username !== user.username) continue
      sending.add(id)
      // Pin the event's original account even if the cookie changes while it is in flight.
      const pinned = createUsageApi({ owner: () => event.owner })
      void pinned
        .recordEvent(event.input)
        .then(
          () => pending.delete(id),
          () => {},
        )
        .finally(() => sending.delete(id))
    }
  }
  const observe = (): void => {
    const state = auth.store.getSnapshot(),
      user = state.user
    if (state.status !== 'authed' || user === undefined) {
      previous = ''
      ownerKey = ''
      return
    }
    const key = `${user.schoolId}:${user.username}`,
      active = surface.store.getSnapshot().surface
    const add = (kind: UsageEventInput['kind']): void => {
      const id = randomUUID()
      const name =
        active === 'paper'
          ? 'papers'
          : active === 'library' || active === 'contribute'
            ? 'community'
            : active === 'notice'
              ? 'profile'
              : active
      pending.set(id, { owner: { schoolId: user.schoolId, username: user.username }, input: { id, kind, surface: name, action: 'view' } })
    }
    if (!visited.has(key)) {
      visited.add(key)
      add('visit')
    }
    if (ownerKey !== key || previous !== active) {
      ownerKey = key
      previous = active
      add('use')
    }
    flush()
  }
  const stopAuth = auth.store.subscribe(observe),
    stopSurface = surface.store.subscribe(observe)
  const timer = setInterval(flush, 15_000)
  window.addEventListener('online', flush)
  observe()
  return () => {
    stopped = true
    stopAuth()
    stopSurface()
    clearInterval(timer)
    window.removeEventListener('online', flush)
  }
}
