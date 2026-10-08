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

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
/* Type-only: merges the `physics/scene` event type into SessionEventMap and
   brings the solve-summary wire shape the card renders. */
import type { PhysicsSceneSolveSummary } from '@deepseek-ai/dsh-tool-physicsos/types'
import type {
  ChatConversationViewNode, ConversationLocation, ConversationNodeDefinition,
} from './runtime-compat.ts'

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

/* The merge-extensible renderer payload registry lives in the Chat target's
   own `/client` module (see ui-plan and ui-goal, which merge it the same way);
   the Conversation package no longer declares it. */
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Inline physics-scene card published by a physics tool call. */
    'physics-scene-card': PhysicsSceneCardData
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /**
     * Newest scene this turn published, read by the turn-tail seat
     * ({@link SceneTurnCard}). A scene event is not a message, so it has no
     * place in the conversation surface of its own — the turn's own data is
     * where a card can dock beside the answer it belongs to.
     */
    'physics-scene-turn': PhysicsSceneCardData
  }
}

/**
 * The Turn-data key the scene card publishes and the turn-tail seat reads. The
 * assembler requires a published key to equal its Definition's `kind`, so this
 * is the turn Definition's kind by construction.
 */
export const PHYSICS_SCENE_TURN_KEY = 'physics-scene-turn'

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
  /** The same snapshot as the Turn publishes it to the turning card's seat. */
  readonly published: PhysicsSceneCardData | undefined
}

/** The card payload without the node-placement fields the seat does not use. */
const publishedOf = (card: PhysicsSceneCardState): PhysicsSceneCardData => ({
  sceneId: card.sceneId,
  revision: card.revision,
  title: card.title,
  domain: card.domain,
  cause: card.cause,
  commandType: card.commandType,
  solve: card.solve,
  scene: card.scene,
})

/**
 * Per-turn scene card data: the newest scene the turn produced, published as
 * the Turn's own data so the `conversation.chat.turnTail` seat can render the
 * card beside the answer it verifies.
 */
export const physicsSceneTurnDefinition: ConversationNodeDefinition<PhysicsSceneTurnState> = {
  kind: 'physics-scene-turn',
  /* No `target`: this Definition publishes Turn data for the turn-tail seat and
     builds no view node of its own. The registry enforces the pairing — a
     `target` requires `buildViewNode`, and declaring one without the other
     fails the plugin's activation, which takes the whole client down. */
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'physics/scene' && typeof event.data.turn === 'number') {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') {
      throw new Error('physics-scene-turn start requires turn/start')
    }
    return { turn: match.event.data.turn, card: undefined, published: undefined }
  },
  update: (context, match) => {
    const event = match.event
    if (event.type === 'physics/scene') {
      const next = stateOf(event)
      /* Same solve-preserving fold as the per-scene card. */
      const card = next.solve === undefined && context.state.card?.solve !== undefined
        ? { ...next, solve: context.state.card.solve }
        : next
      return { ...context.state, card, published: publishedOf(card) }
    }
    return context.state
  },
  /* The card is rendered by the `conversation.chat.turnTail` seat from this
     Turn data, not as a view node: a `physics/scene` event carries no place in
     the conversation surface, so a node built for it stays unresolved and never
     draws (see `core/session/surface.ts` — only message-producing types may
     join that surface). Publishing into the Turn puts the card where the answer
     is, which is where the reader looks for it. */
  buildLocationData: (context, scope, previous) => {
    const published = context.state?.published
    if (scope !== 'turn' || context.state === undefined || published === undefined) return null
    if (previous?.kind === 'turn'
      && previous.turn === context.state.turn
      && previous.key === PHYSICS_SCENE_TURN_KEY
      && previous.value.sceneId === published.sceneId
      && previous.value.revision === published.revision
      && previous.value.solve === published.solve) return previous
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: PHYSICS_SCENE_TURN_KEY,
      value: published,
    }
  },
}

/** Narrowing helper for tests and the card: is this event a scene snapshot?
 * @param event - any session event.
 * @returns true when the event is a `physics/scene` snapshot.
 */
export const isPhysicsSceneEvent = (
  event: SessionEvent,
): event is SessionEvent<'physics/scene'> => event.type === 'physics/scene'
