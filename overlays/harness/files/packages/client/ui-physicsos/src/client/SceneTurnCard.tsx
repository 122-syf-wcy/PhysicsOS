/**
 * The scene card at the closing end of a Turn.
 *
 * The conversation-flow card ({@link SceneChatCard}) renders from a
 * `physics/scene` *event*, and a scene event is not a message: it has no place
 * in the conversation surface, so that node never draws. This seat renders the
 * same card from the Turn's own published data instead — docked with the answer
 * it explains, which is where a reader looks for the physical world a question
 * was solved in.
 */

import { useEffect } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
/* Type-only: pulls the Chat target's SlotMap entry and the turn-tail seat's
   owner props (`turn`, `seq`, `openFile`). */
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SceneChatCardInjected } from './SceneChatCard.tsx'
import { OptionalSceneCardBody as SceneCardBody } from './optional-surfaces.tsx'
import type { PhysicsSceneCardData } from './scene-chat-node.ts'
import type { CanvasObservable } from './canvas/types.ts'

export interface SceneTurnInjected {
  readonly keyedHooks: {
    readonly physicsSceneTurn: (key: string) => CanvasObservable<PhysicsSceneCardData | undefined>
  }
}

export type SceneTurnCardProps =
  PropsRuntime<'conversation.chat.turnTail'>
  & InjectFace<SceneChatCardInjected>
  & InjectFace<SceneTurnInjected>
  & PropsLocale<'physicsos'>

/** Render this Turn's newest scene beside its answer, or nothing when it had none. */
export function SceneTurnCard({
  turn, t, openSceneInLab, requestSceneInCanvas, recordAttempt, regenerateQuestionCode, questionCodeOwner, endTurnHygiene, usePhysicsSceneTurn,
}: SceneTurnCardProps) {
  const data = usePhysicsSceneTurn(String(turn.turn))
  /* The turn closed — this seat only exists once `turn/end` is in the log. That
     is a fallback trigger for the Lab hygiene: the primary one is the
     Conversation binding's `openTurn`, which also fires while the Lab has
     replaced this Conversation and this seat is unmounted. */
  useEffect(() => { endTurnHygiene?.() }, [endTurnHygiene])
  if (data === undefined) return null
  return (
    <SceneCardBody
      data={data}
      t={t}
      openSceneInLab={openSceneInLab}
      {...requestSceneInCanvas === undefined ? {} : { requestSceneInCanvas }}
      {...questionCodeOwner === undefined ? {} : { questionCodeOwner }}
      {...regenerateQuestionCode === undefined ? {} : { regenerateQuestionCode }}
      {...recordAttempt === undefined ? {} : { recordAttempt }}
    />
  )
}
