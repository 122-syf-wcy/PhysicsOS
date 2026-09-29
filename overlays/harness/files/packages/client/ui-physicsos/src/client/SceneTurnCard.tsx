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

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
/* Type-only: pulls the Chat target's SlotMap entry and the turn-tail seat's
   owner props (`turn`, `seq`, `openFile`). */
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { SceneCardBody, type SceneChatCardInjected } from './SceneChatCard.tsx'
import { PHYSICS_SCENE_TURN_KEY } from './scene-chat-node.ts'

export type SceneTurnCardProps =
  PropsRuntime<'conversation.chat.turnTail'>
  & InjectFace<SceneChatCardInjected>
  & PropsLocale<'physicsos'>

/** Render this Turn's newest scene beside its answer, or nothing when it had none. */
export function SceneTurnCard({
  turn, t, openSceneInLab, recordAttempt,
}: SceneTurnCardProps): React.ReactNode {
  const data = turn.data.get(PHYSICS_SCENE_TURN_KEY)
  if (data === undefined) return null
  return (
    <SceneCardBody
      data={data}
      t={t}
      openSceneInLab={openSceneInLab}
      {...recordAttempt === undefined ? {} : { recordAttempt }}
    />
  )
}
