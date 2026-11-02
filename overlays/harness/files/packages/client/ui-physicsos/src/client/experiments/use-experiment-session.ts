import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { WorkspaceRuntime } from '../physics/workspace-runtime.ts'
import { useAnimationClock } from '../animation-clock.ts'
import { createExperimentSession } from './experiment-session.ts'

export function useExperimentSession(runtime: WorkspaceRuntime, onSceneChange?: (scene: PhysicsScene) => void) {
  const onChange = useRef(onSceneChange)
  onChange.current = onSceneChange
  const session = useMemo(() => createExperimentSession(runtime, scene => onChange.current?.(scene)), [runtime])
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  useAnimationClock(snapshot.clock.running, session.advance)
  useEffect(() => () => { runtime.cancelParameterPreview?.() }, [runtime])
  return { session, snapshot, commit: session.commit, frameSource: session.frames }
}
