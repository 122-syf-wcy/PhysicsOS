import css from './LoadingState.module.css'

/**
 * Lightweight startup artwork; readiness is controlled only by the feature loader.
 *
 * `inline` lays the same three characters out beside a short label, for waits
 * inside a card, list or status row. It keeps the caller's visible text so every
 * existing acceptance probe and screen reader still sees the same words.
 */
export function LoadingState({ compact = false, inline = false, label = '正在准备你的物理世界', children }: {
  compact?: boolean
  inline?: boolean
  label?: string
  /** Visible wait text; the default label is only announced when this is absent. */
  children?: React.ReactNode
}) {
  const className = `${css.root} ${compact ? css.compact : ''} ${inline ? css.inline : ''}`
  return <div className={className} role="status" aria-label={children === undefined ? label : undefined}>
    <div className={css.scene} aria-hidden="true">
      <div className={css.halo} />
      <img className={css.boy} src="/physicsos/loading/boy.webp" alt="" width="320" height="320" />
      <img className={css.girl} src="/physicsos/loading/girl.webp" alt="" width="320" height="320" />
      <img className={css.cat} src="/physicsos/loading/cat.webp" alt="" width="320" height="320" />
    </div>
    {children === undefined ? null : <span className={css.label}>{children}</span>}
    {inline ? null : <span className={css.brand} aria-hidden="true">PhysicsOS</span>}
    {inline ? null : <span className={css.track} aria-hidden="true"><span /></span>}
  </div>
}
