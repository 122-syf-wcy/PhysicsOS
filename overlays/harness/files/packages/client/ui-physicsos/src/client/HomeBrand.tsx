import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { HomeAtmosphere } from './HomeAtmosphere.tsx'
import { HomePlayground } from './HomePlayground.tsx'
import { Mascot } from './Mascot.tsx'
import { PhysicsOSMark } from './PhysicsOSMark.tsx'
import css from './HomeBrand.module.css'

export type HomeBrandProps =
  & PropsRuntime<'conversation.hero.brand'>
  & PropsLocale<'physicsos'>

/**
 * Hero brand: one stage.
 *
 * The copy (mark, tagline, prompt) is the single focal point on the left; the
 * right half is a live elastic-collision playground with the mascot floating in
 * it as a collider. One element to read, one to play with — no stacked photo,
 * caption and copy competing for the eye.
 */
export function HomeBrand({ t }: HomeBrandProps) {
  return (
    <div className={css.root}>
      <HomeAtmosphere />
      <div className={css.stage}>
        <HomePlayground className={css.playground} />
        <div className={css.copy}>
          <div className={css.product}>
            <PhysicsOSMark size={26} className={css.mark} />
            <span className={css.name}>{t('brand.name')}</span>
          </div>
          <h1 className={css.tagline}>{t('brand.tagline')}</h1>
          <p className={css.support}>{t('brand.support')}</p>
        </div>
        <Mascot pose="wave" size={172} className={css.mascot} />
        <div className={css.heroMeta} aria-hidden="true">
          <span className={css.heroMetaDot} />
          <span>LIVE PHYSICS</span>
        </div>
      </div>
    </div>
  )
}
