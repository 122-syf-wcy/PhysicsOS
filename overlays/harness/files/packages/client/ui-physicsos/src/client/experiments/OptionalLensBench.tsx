import { useEffect, useState, type ComponentType } from 'react'
import { LoadingState } from '../LoadingState.tsx'
import { loadOptics3DModule } from '../optional-modules.ts'
import type { LensBenchProps } from './lens-bench.ts'
import css from './ExperimentPage.module.css'

type Props = LensBenchProps
/** Only this mounted view requests Three.js; a download failure never traps the experiment. */
export function OptionalLensBench(props: Props) {
  const [View, setView] = useState<ComponentType<Props> | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setFailed(false)
    void loadOptics3DModule().then(
      (module) => {
        if (alive) setView(() => module.LensBench3D)
      },
      () => {
        if (alive) setFailed(true)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])
  if (View) return <View {...props} />
  return (
    <div role={failed ? 'alert' : undefined} className={css.threeStatus}>
      {failed ? <strong>三维装置未能加载</strong> : <LoadingState inline>正在准备三维光具座</LoadingState>}
      <span>
        {failed
          ? '检查网络后重试，当前参数和实验记录已保留。'
          : '首次打开需要加载三维组件，实验条件将保持不变。'}
      </span>
      <div className={css.actions}>
        {failed ? (
          <button
            type="button"
            className={css.subtleButton}
            onClick={() => {
              setAttempt(value => value + 1)
            }}
          >
            重新加载
          </button>
        ) : null}
      </div>
    </div>
  )
}
