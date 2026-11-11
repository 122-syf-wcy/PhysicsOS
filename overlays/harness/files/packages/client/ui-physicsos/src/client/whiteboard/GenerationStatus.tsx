import type { WhiteboardGeneration } from './api.ts'
import type { WhiteboardKey } from './locales.ts'
import css from './Whiteboard.module.css'
export interface GenerationStatusProps { readonly job?: WhiteboardGeneration | undefined; readonly t: (key: WhiteboardKey) => string; readonly onCancel: () => void; readonly cancelling?: boolean }
export function WhiteboardGenerationStatus({ job, t, onCancel, cancelling }: GenerationStatusProps) {
  if (!job) return null
  const waiting = !['ready', 'error', 'cancelled'].includes(job.status)
  return <section className={css.generation} data-generation-phase={job.status}>
    <div role="status" aria-live="polite">{waiting ? <span className={css.pulse} data-generation-waiting="true" aria-hidden="true" /> : null}{t(`whiteboard.generation.${job.status}`)}</div>
    {waiting ? <><span>{t('whiteboard.generation.waitHint')}</span><button type="button" onClick={onCancel} disabled={cancelling}>{t('whiteboard.generationCancel')}</button></> : null}
    {job.status === 'error' && job.error ? <p role="alert">{job.error}</p> : null}
    {job.status === 'ready' && job.result?.uncertainties.length ? <details open><summary>{t('whiteboard.uncertainties')}</summary><p>{t('whiteboard.uncertaintyHint')}</p><ul>{job.result.uncertainties.map((item, index) => <li key={index}>{item.message}</li>)}</ul></details> : null}
  </section>
}
