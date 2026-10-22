/** Photoelectric apparatus: all emission facts come from the runtime view. */
import type { RendererProps } from './renderer-registry.tsx'
import css from './renderers.module.css'

export function ModernRenderer({ view, projection }: RendererProps) {
  const cathode = view.particles.find(particle => particle.id === 'modern-cathode')
  if (cathode === undefined) return null
  const x = projection.px(cathode.at)
  const y = projection.py(cathode.at)
  const halfHeight = 55 * projection.scale
  const photonArrow = `photoelectric-photon-${projection.uid}`
  const electronArrow = `photoelectric-electron-${projection.uid}`

  return (
    <>
      <defs>
        <marker id={photonArrow} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L8 4 L0 8 Z" className={css.modernPhotonHead} />
        </marker>
        <marker id={electronArrow} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L8 4 L0 8 Z" className={css.modernElectronHead} />
        </marker>
      </defs>
      {view.trajectories.map(path => (
        <path
          key={path.id}
          className={path.kind === 'history' ? css.modernPhoton : css.modernElectronPath}
          d={projection.path(path.points)}
          markerEnd={`url(#${path.kind === 'history' ? photonArrow : electronArrow})`}
        />
      ))}
      <rect data-testid="photoelectric-cathode" className={css.modernCathode} x={x - 6} y={y - halfHeight} width={12} height={halfHeight * 2} rx={3} />
      <line className={css.modernCathodeFace} x1={x - 4} y1={y - halfHeight + 4} x2={x - 4} y2={y + halfHeight - 4} />
      {view.particles.filter(particle => particle.id !== cathode.id).map(particle => (
        <g key={particle.id} data-testid="photoelectric-electron">
          <circle className={css.modernElectron} cx={projection.px(particle.at)} cy={projection.py(particle.at)} r={Math.max(4, particle.radius * projection.scale)} />
          <text className={css.annotation} x={projection.px(particle.at)} y={projection.py(particle.at) + 23} textAnchor="middle">{particle.symbol}</text>
        </g>
      ))}
      {view.labels.map(label => (
        <text key={label.id} className={css.modernLabel} x={projection.px(label.at)} y={projection.py(label.at)} textAnchor={label.anchor}>{label.text}</text>
      ))}
    </>
  )
}
