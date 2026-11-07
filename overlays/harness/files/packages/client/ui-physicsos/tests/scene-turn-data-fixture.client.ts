import { ConversationLocationIndex } from '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation/location-index.ts'
import type { ConversationLocationData } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PHYSICS_SCENE_TURN_KEY, type PhysicsSceneCardData } from '../src/client/scene-chat-node.ts'

/** Real Harness keyed data, with one closed Turn whose identity never changes. */
export function sceneTurnData(initial?: PhysicsSceneCardData) {
  const index = new ConversationLocationIndex()
  index.rebuild([
    { type: 'event', event: { seq: 0, time: 1, type: 'turn/start', data: { turn: 1 } } },
    { type: 'event', event: { seq: 1, time: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } },
  ] as unknown as Parameters<ConversationLocationIndex['rebuild']>[0])
  const turn = index.snapshot().turns.get(1)
  if (turn === undefined) throw new Error('missing closed turn')
  let previous: ConversationLocationData | null = null
  const publish = (value: PhysicsSceneCardData): void => {
    const next: ConversationLocationData = { kind: 'turn', turn: 1, key: PHYSICS_SCENE_TURN_KEY, value }
    index.applyData([{ owner: 'physics-scene-turn:1', previous, next }])
    previous = next
    index.publishData()
  }
  if (initial !== undefined) publish(initial)
  return { turn, publish }
}
