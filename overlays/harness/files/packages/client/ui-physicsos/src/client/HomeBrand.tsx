import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { HomeAtmosphere } from './HomeAtmosphere.tsx'
import { PhysicsOSMark } from './PhysicsOSMark.tsx'
import css from './HomeBrand.module.css'

export type HomeBrandProps =
  & PropsRuntime<'conversation.hero.brand'>
  & PropsLocale<'physicsos'>

/** Hero brand: product name, welcome line, and supporting prompt. */
export function HomeBrand({ t }: HomeBrandProps) {
  return (
    <div className={css.root}>
      <HomeAtmosphere />
      <div className={css.heroVisual}>
        <img
          className={css.heroImage}
          src="/physicsos/magnetic-lab-hero.jpg"
          alt="磁场实验器材"
        />
        <div className={css.heroGlass} aria-hidden="true" />
        <div className={css.heroMeta} aria-hidden="true">
          <span className={css.heroMetaDot} />
          <span>LIVE PHYSICS</span>
        </div>
      </div>
      <div className={css.copy}>
        <div className={css.product}>
          <PhysicsOSMark size={28} className={css.mark} />
          <span className={css.name}>{t('brand.name')}</span>
        </div>
        <p className={css.tagline}>{t('brand.tagline')}</p>
        <p className={css.support}>{t('brand.support')}</p>
      </div>
    </div>
  )
}
