/** Compatibility binding for legacy presentations; new owners use bare sources. */
import { useSyncExternalStore } from 'react'
import type { BareFrameSource } from './frame-source.ts'

export const useFrameSource = <T>(source: BareFrameSource<T>): T => {
  const read = source.getSnapshot ?? source.get
  if (read === undefined) throw new TypeError('A frame source needs getSnapshot or get.')
  return useSyncExternalStore(source.subscribe, read, read)
}
