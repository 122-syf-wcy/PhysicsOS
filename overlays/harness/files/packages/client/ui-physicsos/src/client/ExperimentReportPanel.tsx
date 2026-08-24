/**
 * 实验报告 panel.
 *
 * Renders {@link buildExperimentReport}'s projection of the current frame —
 * goal, parameters, derived results, region events, verification, conclusion —
 * and offers the same content as a downloadable Markdown file. The panel shows
 * facts; it never recomputes them.
 */

import { useMemo } from 'react'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

import { buildExperimentReport } from './physics/experiment-report.ts'
import type { WorkspaceSnapshot } from './physics/workspace-runtime.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './LabWorkspace.module.css'

type Translate = (key: PhysicsosKey) => string

export interface ExperimentReportPanelProps {
  readonly snapshot: WorkspaceSnapshot
  readonly t: Translate
  readonly onClose: () => void
}

const downloadMarkdown = (title: string, markdown: string): void => {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${title}-实验报告.md`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function ExperimentReportPanel({ snapshot, t, onClose }: ExperimentReportPanelProps) {
  const report = useMemo(() => buildExperimentReport(snapshot), [snapshot])
  return (
    <div className={css.reportOverlay} data-physicsos-report={snapshot.domain}>
      <div className={css.reportPanel} role="dialog" aria-label={t('lab.report.title')}>
        <div className={css.panelHead}>
          <h2 className={css.panelTitle}>{t('lab.report.title')}</h2>
          <div className={css.reportHeadActions}>
            <button
              type="button"
              className={css.secondary}
              onClick={() => { downloadMarkdown(report.title, report.markdown) }}
            >
              {t('lab.report.download')}
            </button>
            <button
              type="button"
              className={css.toolIcon}
              aria-label={t('lab.collapse')}
              onClick={onClose}
            >
              <IconCloseOutline16 size={14} />
            </button>
          </div>
        </div>

        <div className={css.reportBody}>
          <h3 className={css.reportName}>{report.title}</h3>
          <p className={css.reportGoal}>{report.goal}</p>

          <p className={css.sectionLabel}>{t('lab.report.parameters')}</p>
          <dl className={css.reportGrid}>
            {report.parameters.map(row => (
              <div key={row.label} className={css.reportRow}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>

          <p className={css.sectionLabel}>{t('lab.report.derived')}</p>
          <dl className={css.reportGrid}>
            {report.derived.map(row => (
              <div key={row.label} className={css.reportRow}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>

          {report.events.length === 0 ? null : (
            <>
              <p className={css.sectionLabel}>{t('lab.report.events')}</p>
              <dl className={css.reportGrid}>
                {report.events.map((row, index) => (
                  <div key={`${row.label}-${index}`} className={css.reportRow}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          <p className={css.sectionLabel}>{t('lab.report.verification')}</p>
          <ul className={css.reportChecks}>
            {report.verification.map(check => (
              <li key={check.label} data-status={check.status}>
                <span>{check.label}</span>
                <span className={css.reportCheckStatus}>{check.status}</span>
              </li>
            ))}
          </ul>

          <p className={css.sectionLabel}>{t('lab.report.conclusion')}</p>
          <p className={css.reportConclusion}>{report.conclusion}</p>
        </div>
      </div>
    </div>
  )
}
