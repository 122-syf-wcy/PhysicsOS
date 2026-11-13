import css from './LoadingState.module.css'

/** Lightweight startup artwork; readiness is controlled only by the feature loader. */
export function LoadingState({ compact = false, label = '正在准备你的物理世界' }: {
  compact?: boolean
  label?: string
}) {
  return <div className={`${css.root} ${compact ? css.compact : ''}`} role="status" aria-label={label}>
    <div className={css.scene} aria-hidden="true">
      <div className={css.halo} />
      <img className={css.boy} src="/physicsos/loading/boy.webp" alt="" width="320" height="320" />
      <img className={css.girl} src="/physicsos/loading/girl.webp" alt="" width="320" height="320" />
      <img className={css.cat} src="/physicsos/loading/cat.webp" alt="" width="320" height="320" />
    </div>
    <span className={css.brand} aria-hidden="true">PhysicsOS</span>
    <span className={css.track} aria-hidden="true"><span /></span>
  </div>
}
