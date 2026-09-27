import clsx from 'clsx'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { HomeAtmosphere } from './HomeAtmosphere.tsx'
import { PhysicsOSMark } from './PhysicsOSMark.tsx'
import css from './HomeBrand.module.css'

/** Props of the hero brand stage (the blank-Session front page). */
export interface HomeBrandProps {
  t: TranslateNS<'physicsos'>
}

/** Props of the hero brand-mark occupant the shell sizes itself. */
export type HomeBrandMarkProps =
  Pick<PropsRuntime<'conversation.hero.brand.mark'>, 'size' | 'className'>

/**
 * The product mark where the shell's blank-Session headline wants it: a square
 * glyph leading the headline, not the whole stage.
 * @param props - the shell's requested edge and its headline class.
 * @returns the orbital-lens mark.
 */
export function HomeBrandMark({ size, className }: HomeBrandMarkProps) {
  return <PhysicsOSMark size={size} className={clsx(className, css.heroMark)} />
}

/**
 * Hero copy: the product name and one-line promise lead, then the page title
 * and its supporting sentence. Copy only — the single Home input and the entry
 * cards are the page's own modules (`HomeHero.tsx` / `HomeActions.tsx`), so the
 * brand block never owns an interactive control and stays reusable as chrome.
 *
 * @param props - product copy.
 * @returns the brand copy block.
 */
export function HomeBrand({ t }: HomeBrandProps) {
  return (
    <div className={css.root}>
      <HomeAtmosphere />
      <div className={css.stage}>
        <div className={css.copy}>
          <div className={css.product}>
            <PhysicsOSMark size={26} className={css.mark} />
            <span className={css.name}>{t('brand.name')}</span>
            <span className={css.promise}>{t('home.promise')}</span>
          </div>
          <h1 className={css.tagline}>{t('brand.tagline')}</h1>
          <p className={css.support}>{t('brand.support')}</p>
        </div>
      </div>
    </div>
  )
}
