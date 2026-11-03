import { AdminCard, AdminCardHead, AdminCardMeta, AdminCardTitle } from './AdminPrimitives.tsx'
import { ContributionPanel } from './experiments/ContributionPanel.tsx'
import type { PhysicsosKey } from './locales.ts'
import css from './AdminExperimentTab.module.css'

/** The admin entry shares the candidate renderer and publication workflow. */
export function AdminExperimentTab({ t }: { t: (key: PhysicsosKey) => string }) {
  return (
    <div className={css.root} data-experiment-review="">
      <AdminCard className={css.overview}>
        <AdminCardHead className={css.heading}>
          <img
            src="/physicsos/developers/assets/studio/icon-review.webp"
            width="68"
            height="68"
            alt=""
          />
          <div>
            <span className={css.eyebrow}>{t('admin.experimentReview.eyebrow')}</span>
            <AdminCardTitle className={css.title}>{t('admin.tab.experimentReview')}</AdminCardTitle>
            <AdminCardMeta>{t('admin.experimentReview.hint')}</AdminCardMeta>
          </div>
        </AdminCardHead>
      </AdminCard>
      <ContributionPanel embedded mode="review" />
    </div>
  )
}
