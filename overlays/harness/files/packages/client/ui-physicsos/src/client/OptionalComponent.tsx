import { useEffect, useState, type ComponentType } from 'react'
import { LoadingState } from './LoadingState.tsx'

/** Optional feature loading with a visible, retryable network failure. */
export function OptionalComponent<P extends object>({ load, componentProps, loading = 'main' }: {
  load: () => Promise<{ default: ComponentType<P> }>
  componentProps: P
  loading?: 'main' | 'compact' | 'none'
}) {
  const [Component, setComponent] = useState<ComponentType<P> | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setFailed(false)
    void load().then((module) => {
      if (live) setComponent(() => module.default)
    }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [load, attempt])
  if (failed) return <div role="alert">功能加载失败，请检查网络。<button type="button" onClick={() => { setAttempt(value => value + 1) }}>重试</button></div>
  if (Component === null) return loading === 'none' ? null : <LoadingState compact={loading === 'compact'} />
  return <Component {...componentProps} />
}
