/**
 * 实验报告 panel.
 *
 * Renders {@link buildExperimentReport}'s projection of the current frame —
 * goal, parameters, derived results, region events, verification, conclusion —
 * and offers the same content as a downloadable Markdown file or a 打印版
 * (print-ready page routed through the browser's print dialog). The panel
 * shows facts; it never recomputes them.
 */

import { useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

import {
  buildExperimentReport,
  experimentReportPrintHtml,
} from './physics/experiment-report.ts'
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
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  /* Revoking immediately can cancel the download before the browser has read the
     blob; deferring keeps the anchor's URL alive until the fetch has started. */
  window.setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
}

/**
 * 打印版：load the standalone report page into a hidden iframe and hand it to
 * the browser's print dialog. An iframe (not `window.open`) survives popup
 * blockers and never navigates the student away from the Lab.
 */
const printReport = (html: string): void => {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.setAttribute('aria-hidden', 'true')
  /* `srcdoc` parses the page through the normal load pipeline, so `load` is an
     honest "laid out and ready to print" signal rather than a guessed delay.
     `print()` blocks while the dialog is open in real browsers, so removing the
     frame on the next tick after it returns is safe. */
  iframe.srcdoc = html
  iframe.addEventListener(
    'load',
    () => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      window.setTimeout(() => { iframe.remove() }, 1000)
    },
    { once: true },
  )
  document.body.appendChild(iframe)
}

export function ExperimentReportPanel({ snapshot, t, onClose }: ExperimentReportPanelProps) {
  const report = useMemo(() => buildExperimentReport(snapshot), [snapshot])
  const panelRef = useRef<HTMLDivElement>(null)
  /* Modal semantics: move focus into the dialog on open, return it on close, and
     let Esc dismiss the report like any other overlay. */
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [onClose])

  return (
    <div className={css.reportOverlay} data-physicsos-report={snapshot.domain}>
      <div
        className={css.reportPanel}
        role="dialog"
        aria-modal="true"
        aria-label={t('lab.report.title')}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className={css.panelHead}>
          <h2 className={css.panelTitle}>{t('lab.report.title')}</h2>
          <div className={css.reportHeadActions}>
            <button
              type="button"
              className={css.secondary}
              onClick={() => { printReport(experimentReportPrintHtml(report)) }}
            >
              {t('lab.report.print')}
            </button>
            <button
              type="button"
              className={css.secondary}
              onClick={() => { downloadMarkdown(report.title, report.markdown) }}
            >
              {t('lab.report.download')}
            </button>
            <button
              type="button"
              className={clsx(css.tool, css.toolIcon)}
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
