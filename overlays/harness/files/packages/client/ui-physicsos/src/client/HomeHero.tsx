/**
 * PhysicsOS home front page for the blank Session's hero.
 *
 * The target shell owns the hero (headline, workspace picker, composer) and
 * offers two seats the product page rides: `conversation.input.dock`, the
 * full-width entry above the composer, which carries the brand stage, and
 * `conversation.composer.below`, the page-level seat under the composer, which
 * carries the quick actions. Split across the two so the composer sits between
 * the brand stage and the actions, the way the product page reads.
 *
 * A Session that already carries messages keeps the transcript to itself: the
 * hero belongs to a conversation nobody has spoken into yet.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { HomeActions, type HomeActionsInjected } from './HomeActions.tsx'
import { HomeBrand } from './HomeBrand.tsx'
import css from './HomeHero.module.css'

/** Registration-side face: the same product actions the actions rail needs. */
export type HomeHeroInjected = HomeActionsInjected

/** Slot props for the brand stage above the hero composer. */
export type HomeHeroProps =
  Pick<PropsRuntime<'conversation.input.dock'>, 'useSession'>
  & PropsLocale<'physicsos'>

/** Slot props for the quick actions under the hero composer. */
export type HomeBelowProps =
  PropsRuntime<'conversation.composer.below'>
  & InjectFace<HomeHeroInjected>
  & PropsLocale<'physicsos'>

/**
 * Render the product brand stage above the hero composer.
 * @param props - the current Session and copy.
 * @returns the brand stage, or nothing once the Session has content.
 */
export function HomeHero({ useSession, t }: HomeHeroProps) {
  const blank = useSession(session => session.blank)
  if (!blank) return null
  return (
    <div className={css.root} data-physicsos-home="">
      <HomeBrand t={t} />
    </div>
  )
}

/**
 * Render the product quick actions under the hero composer.
 * @param props - the current Session, product quick actions, and copy.
 * @returns the examples and entry cards, or nothing once the Session has content.
 */
export function HomeBelow({ useSession, useRecentExperiments, openSurface, t }: HomeBelowProps) {
  const blank = useSession(session => session.blank)
  if (!blank) return null
  return (
    <div className={css.below} data-physicsos-home-actions="">
      <HomeActions useRecentExperiments={useRecentExperiments} openSurface={openSurface} t={t} />
    </div>
  )
}
