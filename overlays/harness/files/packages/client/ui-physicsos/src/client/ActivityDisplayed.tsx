import { useEffect, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ActivityModule } from './activity-api.ts'
import { reportActivityDisplayed } from './activity-telemetry.ts'

/** Mount INSIDE successful content (after loading/error/permission gates). Never mount around a request. */
export function ActivityDisplayed({ module, entryId, accountKey }: {
  readonly module: ActivityModule
  /** A new presentation/navigation generation; omit when this boundary remounts for every genuine entry. */
  readonly entryId?: string
  /** Re-run after a real account switch, not after an avatar/profile snapshot update. */
  readonly accountKey: string
}): null {
  const [instance] = useState(randomUUID)
  useEffect(() => { reportActivityDisplayed(module, entryId ?? instance, accountKey) }, [module, entryId, instance, accountKey])
  return null
}
