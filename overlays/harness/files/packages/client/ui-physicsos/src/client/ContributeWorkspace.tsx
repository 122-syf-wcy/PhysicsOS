/** The original contribution landing page, now connected to the shared real uploader. */
import type { ReactElement } from 'react'
import type { ProductSurfaceBaseProps } from './surface-props.ts'
import { IconContribution } from './icons/physics-icons.tsx'
import { ContributionPanel } from './experiments/ContributionPanel.tsx'
import { experimentHref } from './experiments/experiment-navigation.ts'
import css from './ContributeWorkspace.module.css'

export function ContributeWorkspace({ t }: Pick<ProductSurfaceBaseProps, 't'>): ReactElement {
  return (
    <div className={css.cover} data-physicsos-surface="contribute">
      <header className={css.header}>
        <span className={css.icon} aria-hidden="true">
          <IconContribution size={28} />
        </span>
        <div className={css.headerCopy}>
          <span className={css.eyebrow}>{t('contribute.eyebrow')}</span>
          <h1 className={css.title}>{t('contribute.title')}</h1>
          <p className={css.subtitle}>{t('contribute.subtitle')}</p>
          <a
            className={css.action}
            href="/physicsos/developers/index.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('contribute.openDocs')}
          </a>
        </div>
        <img
          className={css.mascot}
          src="/physicsos/developers/assets/studio/mascot-studio-480.webp"
          width="240"
          height="240"
          alt=""
        />
      </header>
      <div className={css.supported}>
        <strong>{t('contribute.supported')}</strong>
        <a href={experimentHref('convex-lens')}>{t('contribute.openExperiment')} →</a>
      </div>
      <ContributionPanel embedded />
    </div>
  )
}
