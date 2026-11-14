import clsx from 'clsx'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PhysicsOSMark } from './PhysicsOSMark.tsx'
import css from './HomeBrand.module.css'

export interface HomeBrandProps { t: TranslateNS<'physicsos'> }
export type HomeBrandMarkProps = Pick<PropsRuntime<'conversation.hero.brand.mark'>, 'size' | 'className'>
export function HomeBrandMark({ size, className }: HomeBrandMarkProps) {
  return <PhysicsOSMark size={size} className={clsx(className, css.heroMark)} />
}
/** The home stage gives the user's input the page's single focal point. */
export function HomeBrand({ t }: HomeBrandProps) {
  return <div className={css.root}>
    <div className={css.product}><PhysicsOSMark size={32} /><span>{t('home.brandline')}</span></div>
    <h1 className={css.tagline}>{t('home.greeting')}</h1>
    <p className={css.support}>{t('home.subtitle')}</p>
  </div>
}
