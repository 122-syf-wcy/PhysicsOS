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
  PropsRuntime<'conversation.composer.above'>
  & PropsLocale<'physicsos'>

/** Slot props for the quick actions under the hero composer. */
export type HomeBelowProps =
  PropsRuntime<'conversation.composer.below'>
  & InjectFace<HomeHeroInjected>
  & PropsLocale<'physicsos'>

/**
 * Render the product brand stage above the hero composer.
 *
 * The shell renders this seat only in its hero phase and binds it to no
 * Session, so the brand stage is complete at a cold start too — the seat above
 * it (`conversation.input.dock`) needs a Session, and a visitor who has not
 * picked a workspace yet has none.
 * @param props - product copy.
 * @returns the brand stage.
 */
export function HomeHero({ t }: HomeHeroProps) {
  return (
    <div className={css.root} data-physicsos-home="">
      <HomeBrand t={t} />
    </div>
  )
}

/**
 * Render the product quick actions under the hero composer.
 *
 * The shell renders this seat only in its hero phase, which is what a blank
 * Session and a cold start (no Session yet) have in common — so the front page
 * is complete before a workspace is picked, and no Session gate is needed here.
 * @param props - product quick actions and copy.
 * @returns the examples and entry cards.
 */
export function HomeBelow({ useRecentExperiments, openSurface, t }: HomeBelowProps) {
  return (
    <div className={css.below} data-physicsos-home-actions="">
      <HomeActions useRecentExperiments={useRecentExperiments} openSurface={openSurface} t={t} />
    </div>
  )
}
