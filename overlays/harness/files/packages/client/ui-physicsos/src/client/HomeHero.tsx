/**
 * PhysicsOS home front page for the blank Session's hero.
 *
 * The target shell owns the hero (headline, workspace picker, composer) and
 * offers full-width feature entries above the composer through
 * `conversation.input.dock` — the seat the product's brand stage and quick
 * actions ride. A Session that already carries messages keeps the transcript
 * to itself: the hero belongs to a conversation nobody has spoken into yet.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { HomeActions, type HomeActionsInjected } from './HomeActions.tsx'
import { HomeBrand } from './HomeBrand.tsx'
import css from './HomeHero.module.css'

/** Registration-side face: the same product actions the actions rail needs. */
export type HomeHeroInjected = HomeActionsInjected

/** Slot props for the blank-Session product front page. */
export type HomeHeroProps =
  Pick<PropsRuntime<'conversation.input.dock'>, 'useSession'>
  & InjectFace<HomeHeroInjected>
  & PropsLocale<'physicsos'>

/**
 * Render the product front page above the hero composer.
 * @param props - the current Session, product quick actions, and copy.
 * @returns the brand stage and quick actions, or nothing once the Session has content.
 */
export function HomeHero({
  useSession, useRecentExperiments, openSurface, t,
}: HomeHeroProps) {
  const blank = useSession(session => session.blank)
  if (!blank) return null
  return (
    <div className={css.root} data-physicsos-home="">
      <HomeBrand t={t} />
      <HomeActions useRecentExperiments={useRecentExperiments} openSurface={openSurface} t={t} />
    </div>
  )
}
