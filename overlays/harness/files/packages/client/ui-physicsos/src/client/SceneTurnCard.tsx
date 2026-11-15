/** A completed Turn's compact experiment attachment and durable solution. */

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
  turn, t, openSceneInLab, openScenePreview, recordAttempt, endTurnHygiene, usePhysicsSceneTurn,
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
      presentation="attachment"
      t={t}
      openSceneInLab={openSceneInLab}
      {...openScenePreview === undefined ? {} : { openScenePreview }}
      {...recordAttempt === undefined ? {} : { recordAttempt }}
    />
  )
}
