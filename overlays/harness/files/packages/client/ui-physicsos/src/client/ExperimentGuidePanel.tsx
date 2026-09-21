/**
 * 实验指南 overlay.
 *
 * Renders the template's authored procedure — guide steps, the errors section
 * of its summary and the textbook mapping — in a dialog with the same modal
 * semantics as {@link ExperimentReportPanel} (focus in, Esc out, focus back).
 * Content comes from {@link ExperimentMeta}; it is teaching copy, not engine
 * output, so the panel only ever displays it.
 */

import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

import type { ExperimentMeta } from './physics/experiment-summaries.ts'
import type { PhysicsosKey } from './locales.ts'
import css from './LabWorkspace.module.css'

type Translate = (key: PhysicsosKey) => string

export interface ExperimentGuidePanelProps {
  readonly meta: ExperimentMeta
  /** Scene title shown under the dialog heading. */
  readonly title: string
  readonly t: Translate
  readonly onClose: () => void
}

export function ExperimentGuidePanel({ meta, title, t, onClose }: ExperimentGuidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
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
    <div className={css.reportOverlay} data-physicsos-guide="true">
      <div
        className={css.reportPanel}
        role="dialog"
        aria-modal="true"
        aria-label={t('lab.guide')}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className={css.panelHead}>
          <h2 className={css.panelTitle}>{t('lab.guide')}</h2>
          <div className={css.reportHeadActions}>
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
          <h3 className={css.reportName}>{title}</h3>
          <p className={css.sectionLabel}>{t('lab.summary.coreModel')}</p>
          <p className={css.reportGoal}>{meta.summary.coreModel}</p>

          {meta.guide === undefined || meta.guide.length === 0 ? null : (
            <>
              <p className={css.sectionLabel}>{t('lab.guide.steps')}</p>
              <ol className={css.guideSteps}>
                {meta.guide.map(step => <li key={step}>{step}</li>)}
              </ol>
            </>
          )}

          <p className={css.sectionLabel}>{t('lab.summary.errors')}</p>
          <ul className={css.guideList}>
            {meta.summary.errors.map(item => <li key={item}>{item}</li>)}
          </ul>

          {meta.textbook === undefined || meta.textbook.length === 0 ? null : (
            <>
              <p className={css.sectionLabel}>{t('lab.summary.textbook')}</p>
              <ul className={css.guideList}>
                {meta.textbook.map(entry => (
                  <li key={`${entry.volume}-${entry.chapter}`}>
                    {entry.edition} · {entry.volume} · {entry.chapter}
                    {entry.topics.length === 0 ? '' : `（${entry.topics.join('、')}）`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
