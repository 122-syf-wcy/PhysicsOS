import { useEffect, useState, type ReactNode } from 'react'
import { LoadingState } from '../LoadingState.tsx'
import { CommunityExperimentFrame } from './CommunityExperimentFrame.tsx'
import { contributionApi, contributionReleaseIdentity, selectContributionRelease,
  type ExperimentPackageView } from './contribution-api.ts'
import type { ExperimentSession } from './experiment-session.ts'
import { useExperimentAppearance } from './use-experiment-appearance.ts'
import css from './CommunityWorkspaceCanvas.module.css'

interface Props {
  readonly experimentId: string
  readonly session: ExperimentSession
  readonly fallback: ReactNode
}

/** Replaces only the drawing; controls, clock, records and physical facts stay in the platform session. */
export function CommunityWorkspaceCanvas({ experimentId, session, fallback }: Props) {
  const savedRelease = session.getScene()?.metadata.experimentRelease
  const officialPin = savedRelease?.kind === 'official' && savedRelease.experimentId === experimentId
  const [release, setRelease] = useState<ExperimentPackageView | null | undefined>(officialPin ? null : undefined)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const appearance = useExperimentAppearance(session, experimentId)
  const offerAppearance = appearance.offer
  useEffect(() => {
    let alive = true
    setRelease(undefined)
    setError('')
    const pinned = session.getScene()?.metadata.experimentRelease
    if (pinned !== undefined && pinned.experimentId !== experimentId) {
      setError('该记录的实验版本与当前实验不匹配。参数和记录已保留。')
      return
    }
    if (pinned?.kind === 'official') {
      setRelease(null)
      void contributionApi.catalog(experimentId).then((catalog) => {
        if (alive) offerAppearance(catalog.active)
      }).catch(() => {})
      return () => { alive = false }
    }
    void contributionApi.catalog(experimentId).then((catalog) => {
      if (!alive) return
      const selected = selectContributionRelease(catalog, pinned, experimentId)
      if (selected === undefined || (selected !== null && (
        selected.experimentId !== experimentId || selected.status !== 'approved' ||
        !selected.entryUrl || selected.protocolVersion !== 3
      ))) {
        setError('该记录使用的实验版本暂时无法载入。参数和记录已保留。')
        return
      }
      setRelease(selected)
      // Existing records keep their exact release identity, including official
      // pins. A fresh scene records the active renderer once for future resumes.
      if (pinned === undefined) session.setRelease(contributionReleaseIdentity(selected, experimentId))
      offerAppearance(catalog.active)
    }).catch(() => {
      if (alive) setError('暂时无法读取实验版本，请检查网络后重试。')
    })
    return () => { alive = false }
  }, [experimentId, session, attempt, offerAppearance])
  const displayed = appearance.pending ?? appearance.applied ?? release
  const footer = <div className={css.credit}>
    <span className={css.creditLabel}>{displayed ? `${displayed.author.name} · v${displayed.version}` : 'PhysicsOS'}</span>
    {appearance.available ? <button type="button" className={css.updateButton} disabled={appearance.busy}
      onClick={() => { void appearance.start() }}>{appearance.busy ? '正在载入新版外观…' : '使用新版实验外观'}</button> : null}
    {appearance.error ? <p className={css.updateError} role="alert">{appearance.error}</p> : null}
  </div>
  if (officialPin && displayed === null && !appearance.available && !appearance.error) return fallback
  if (error) return <div className={css.status} role="alert"><strong>{error}</strong>
    <button type="button" onClick={() => { setAttempt(value => value + 1) }}>重试载入实验版本</button></div>
  if (displayed === undefined) return <div className={css.status}><LoadingState inline>正在读取实验版本…</LoadingState></div>
  if (displayed === null) return appearance.available || appearance.error
    ? <div className={css.community}><div className={css.viewport}>{fallback}</div>{footer}</div> : fallback
  if (displayed.entryUrl === undefined) return <div className={css.status} role="alert">实验版本暂时无法载入。</div>
  return <div className={css.community} data-experiment-release={displayed.id}>
    <CommunityExperimentFrame key={displayed.id} entryUrl={displayed.entryUrl} session={session}
      experimentId={experimentId} protocolVersion={3} presentation={{ mode: 'embedded' }}
      onStatusChange={(status) => { appearance.onStatus(displayed.id, status) }}
      title={`${session.getSnapshot().title} · 社区实验`} />
    {footer}
  </div>
}
