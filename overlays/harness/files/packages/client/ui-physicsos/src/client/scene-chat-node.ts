/**
 * Chat card for durable `physics/scene` snapshots.
 *
 * One card per answer: every snapshot the agent publishes is complete
 * (`scene` is the whole PhysicsScene at that revision), so the turn context
 * keeps only the newest — an abandoned first modeling attempt folds into the
 * corrected scene instead of stacking cards down the reply. While the turn
 * runs, the card sits where the tool call left it; once the turn ends it
 * docks directly above the closing answer message. Per-scene contexts still
 * publish their own card one anchor-step below the turn card, so the
 * renderer's supersede rule hides them whenever the turn card exists and
 * they transparently take over on logs whose `turn/start` fell outside the
 * loaded window (including every log written before the `turn` field).
 */

import type { JsonValue, SessionEvent } from '@deepseek-ai/dsh-session/types'
/* Type-only: merges the `physics/scene` event type into SessionEventMap and
   brings the solve-summary wire shape the card renders. */
import type { PhysicsSceneSolveSummary } from '@deepseek-ai/dsh-tool-physicsos/types'
import type {
  ChatConversationViewNode, ConversationLocation, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'

/** One frozen scene snapshot as the chat card renders it. */
export interface PhysicsSceneCardData {
  readonly sceneId: string
  readonly revision: number
  readonly title: string
  readonly domain: string
  readonly cause: 'created' | 'solved' | 'command'
  readonly commandType: string | undefined
  /** Structured solve result — present when `cause === 'solved'`. */
  readonly solve: PhysicsSceneSolveSummary | undefined
  readonly scene: JsonValue
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Inline physics-scene card published by a physics tool call. */
    'physics-scene-card': PhysicsSceneCardData
  }
}

interface PhysicsSceneCardState extends PhysicsSceneCardData {
  readonly seq: number
  /** Owning turn for new snapshots; undefined on pre-`turn` logs. */
  readonly turn: number | undefined
}

const stateOf = (event: SessionEvent<'physics/scene'>): PhysicsSceneCardState => ({
  seq: event.seq,
  sceneId: event.data.sceneId,
  revision: event.data.revision,
  title: event.data.title,
  domain: event.data.domain,
  cause: event.data.cause,
  commandType: event.data.commandType,
  solve: event.data.solve,
  turn: event.data.turn,
  scene: event.data.scene,
})

const viewNode = (
  context: { key: string; id: string; start?: { location?: ConversationLocation } | undefined },
  state: PhysicsSceneCardState,
  anchorSeq: number,
): ChatConversationViewNode => {
  const { seq: _seq, turn: _turn, ...data } = state
  return {
    key: context.key,
    kind: 'physics-scene-card',
    id: context.id,
    target: 'chat',
    anchorSeq,
    location: context.start?.location ?? { kind: 'unresolved' },
    visibility: 'visible',
    data,
  }
}

/**
 * Per-scene card, the fallback presenter for every snapshot. It anchors at
 * `seq - 0.2` — strictly below the turn card's `seq - 0.1` for the same
 * snapshot — so the card component's same-block supersede rule hides it
 * whenever a turn card covers this answer, while it still draws when the
 * log gives the turn definition nothing to start from.
 */
export const physicsSceneCardDefinition: ConversationNodeDefinition<PhysicsSceneCardState> = {
  kind: 'physics-scene-card',
  target: 'chat',
  match: event =>
    event.type === 'physics/scene'
      /* revision 0 is the scene's first publish (created/solved); commands
         carry revision ≥ 1 and fold into the open card. */
      ? { id: `scene:${event.data.sceneId}`, role: event.data.revision === 0 ? 'start' : 'update' }
      : null,
  start: (_context, match) => {
    if (match.event.type !== 'physics/scene') {
      throw new Error('physics-scene-card start requires physics/scene')
    }
    return stateOf(match.event)
  },
  update: (context, match) => {
    if (match.event.type !== 'physics/scene') {
      throw new Error('physics-scene-card update requires physics/scene')
    }
    const next = stateOf(match.event)
    /* A command revision carries no solve payload — but it is still the same
       question's scene being tuned, so the analysis stays attached. Only a
       snapshot that brings its own solve replaces it. */
    return next.solve === undefined && context.state.solve !== undefined
      ? { ...next, solve: context.state.solve }
      : next
  },
  buildViewNode: context =>
    context.state !== undefined
      ? viewNode(context, context.state, context.state.seq - 0.2)
      : null,
}

interface PhysicsSceneTurnState {
  readonly turn: number
  /** Newest scene snapshot this turn published. */
  readonly card: PhysicsSceneCardState | undefined
  /** Closing Assistant message seq — the card docks right above it. */
  readonly answerSeq: number | undefined
  readonly ended: boolean
}

/**
 * Per-turn scene card: one chat node per turn, showing the newest scene the
 * turn produced. While the turn is open the card follows the latest scene
 * event (live progress); on `turn/end` it docks above the closing Assistant
 * message, next to the answer it verifies.
 */
export const physicsSceneTurnDefinition: ConversationNodeDefinition<PhysicsSceneTurnState> = {
  kind: 'physics-scene-turn',
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'physics/scene' && typeof event.data.turn === 'number') {
      return { id: String(event.data.turn), role: 'update' }
    }
    if (event.type === 'turn/end') return { id: String(event.data.turn), role: 'update' }
    /* Only appended assistant messages anchor the dock: a compaction
       replacement carries a message the surface no longer renders. */
    if (event.type === 'assistant/message' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') {
      throw new Error('physics-scene-turn start requires turn/start')
    }
    return { turn: match.event.data.turn, card: undefined, answerSeq: undefined, ended: false }
  },
  update: (context, match) => {
    const event = match.event
    if (event.type === 'physics/scene') {
      const next = stateOf(event)
      /* Same solve-preserving fold as the per-scene card. */
      const card = next.solve === undefined && context.state.card?.solve !== undefined
        ? { ...next, solve: context.state.card.solve }
        : next
      return { ...context.state, card }
    }
    if (event.type === 'assistant/message') {
      return { ...context.state, answerSeq: event.seq }
    }
    if (event.type === 'turn/end') return { ...context.state, ended: true }
    return context.state
  },
  publication: match =>
    match.event.type === 'assistant/message' ? 'none' : 'immediate',
  buildViewNode: (context) => {
    const card = context.state?.card
    if (card === undefined || context.state === undefined) return null
    /* Open turn: the card lives where the tool call left it, so work in
       progress stays visible. Closed turn: dock it directly above the
       answer message (anchored at its event seq). */
    const anchorSeq = context.state.ended && context.state.answerSeq !== undefined
      ? context.state.answerSeq - 0.1
      : card.seq - 0.1
    return viewNode(context, card, anchorSeq)
  },
}

/** Narrowing helper for tests and the card: is this event a scene snapshot?
 * @param event - any session event.
 * @returns true when the event is a `physics/scene` snapshot.
 */
export const isPhysicsSceneEvent = (
  event: SessionEvent,
): event is SessionEvent<'physics/scene'> => event.type === 'physics/scene'
