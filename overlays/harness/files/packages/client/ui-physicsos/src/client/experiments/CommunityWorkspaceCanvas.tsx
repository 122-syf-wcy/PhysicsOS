import { useEffect, useState, type ReactNode } from 'react'
import { CommunityExperimentFrame } from './CommunityExperimentFrame.tsx'
import { contributionApi, contributionReleaseIdentity, selectContributionRelease,
  type ExperimentPackageView } from './contribution-api.ts'
import type { ExperimentSession } from './experiment-session.ts'
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
      return
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
    }).catch(() => {
      if (alive) setError('暂时无法读取实验版本，请检查网络后重试。')
    })
    return () => { alive = false }
  }, [experimentId, session, attempt])
  if (officialPin) return fallback
  if (error) return <div className={css.status} role="alert"><strong>{error}</strong>
    <button type="button" onClick={() => { setAttempt(value => value + 1) }}>重试载入实验版本</button></div>
  if (release === undefined) return <div className={css.status} role="status">正在读取实验版本…</div>
  if (release === null) return fallback
  if (release.entryUrl === undefined) return <div className={css.status} role="alert">实验版本暂时无法载入。</div>
  return <div className={css.community} data-experiment-release={release.id}>
    <div className={css.credit}><span>{release.author.name}</span><span>v{release.version}</span></div>
    <CommunityExperimentFrame key={release.id} entryUrl={release.entryUrl} session={session}
      experimentId={experimentId} protocolVersion={3} title={`${session.getSnapshot().title} · 社区实验`} />
  </div>
}
