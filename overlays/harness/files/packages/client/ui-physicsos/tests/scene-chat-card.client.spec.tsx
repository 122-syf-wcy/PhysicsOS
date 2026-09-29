// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ChatConversationViewNode, ChatSnapshot, ConversationEventInput,
  ConversationNodeDefinition, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
/* These business Definitions moved to the Chat target package in 0.1.7; the
   card's kind is a renderer of that target, so its test assembles through the
   same Definitions the Chat view registers. */
import { commandDefinition } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/command.ts'
import { chatViewDefinition } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts'
import { SceneChatCard } from '../src/client/SceneChatCard.tsx'
import {
  isPhysicsSceneEvent, physicsSceneCardDefinition, physicsSceneTurnDefinition,
  PHYSICS_SCENE_TURN_KEY, type PhysicsSceneCardData,
} from '../src/client/scene-chat-node.ts'
import {
  createExperimentSceneRef, findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import type { PhysicsSceneRef } from '../src/client/surface-store.ts'
import { zh } from '../src/client/locales.ts'
import type { SelfCheckAttemptInput } from '../src/client/learning-record-store.ts'
import { solvedCardData } from './solved-card-fixture.client.ts'

afterEach(cleanup)

const t = (key: string): string => (zh as Record<string, string>)[key] ?? key

/** A real production scene — the 斜抛 template — so the card test runs the
    same runtime the Lab mounts. */
const ref: PhysicsSceneRef = (() => {
  const template = findExperimentTemplate('projectile-oblique')
  if (template === undefined) throw new Error('missing projectile-oblique template')
  return createExperimentSceneRef(template, '斜抛运动')
})()

const sceneEvent = (
  seq: number,
  cause: 'created' | 'solved' | 'command' = 'solved',
  revision = 0,
  sceneId = ref.sceneId,
  turn?: number,
) =>
  entry(seq, 'physics/scene', {
    sceneId,
    revision,
    domain: 'mechanics',
    engineId: 'engine-mechanics',
    title: '斜抛运动',
    cause,
    ...(turn === undefined ? {} : { turn }),
    scene: ref.scene,
  })

const assistantMessage = (seq: number, turn: number, step = 1) => {
  const input = entry(seq, 'assistant/message', {
    turn,
    step,
    message: { id: `m-${seq}`, role: 'assistant', content: [{ type: 'text', text: '解' }] },
  })
  /* The turn definition only docks on append-surface messages; the durable
     log stamps surfaceOp at append time, so the fixture must carry it. */
  ;(input.event as { surfaceOp?: string }).surfaceOp = 'append'
  return input
}

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return [commandDefinition, physicsSceneCardDefinition, physicsSceneTurnDefinition]
  }

  fallbackEntry(): undefined {
    return undefined
  }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [chatViewDefinition]
  }
}

type DurableEntry = Extract<ConversationEventInput, { readonly type: 'event' }>

function entry(seq: number, type: string, data: unknown): DurableEntry {
  return {
    type: 'event',
    event: { seq, time: 1_700_000_000_000 + seq, type, data } as DurableEntry['event'],
  }
}

function snapshot(entries: readonly ConversationEventInput[], hasMore = false): ChatSnapshot {
  const assembler = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  assembler.replaceWindow(entries, hasMore)
  assembler.activateTarget('chat')
  assembler.flush()
  const value = assembler.snapshot('chat') as ChatSnapshot | undefined
  if (value === undefined) throw new Error('chat view was not registered')
  return value
}

function node(value: ChatSnapshot, kind: string): ChatConversationViewNode | undefined {
  return value.nodes.values().find(candidate => candidate.kind === kind)
}

/** Minimal Chat-target snapshot the card's supersede selector reads. */
const useChatOf = (
  nodes: readonly { key: string; kind: string; anchorSeq: number }[],
  turns: ReadonlyMap<number, unknown> = new Map(),
) => {
  const map = new Map(nodes.map(candidate => [candidate.key, candidate]))
  return (
    selector: (snapshot: {
      nodes: typeof map
      timeline: { turns: ReadonlyMap<number, unknown> }
    }) => unknown,
  ) => selector({ nodes: map, timeline: { turns } })
}

const cardProps = (
  data: PhysicsSceneCardData,
  openSceneInLab = vi.fn(),
  nodes: readonly { key: string; kind: string; anchorSeq: number }[] = [],
  recordAttempt?: (attempt: SelfCheckAttemptInput) => void,
  turn?: { readonly number: number; readonly state: unknown },
) => ({
  node: {
    key: 'physics-scene-card:test',
    kind: 'physics-scene-card',
    anchorSeq: 1.9,
    data,
    location: turn === undefined ? { kind: 'session' } : { kind: 'turn', turn: { turn: turn.number } },
  },
  t,
  openSceneInLab,
  ...(recordAttempt === undefined ? {} : { recordAttempt }),
  useChat: useChatOf(nodes, turn === undefined ? new Map() : new Map([[turn.number, turn.state]])),
}) as unknown as Parameters<typeof SceneChatCard>[0]

describe('physics scene chat card', () => {
  it('materializes one inline card at the snapshot event position', () => {
    const value = snapshot([
      entry(1, 'turn/start', { turn: 1 }),
      sceneEvent(2),
      entry(3, 'turn/end', { turn: 1, reason: 'completed' }),
    ])

    const card = node(value, 'physics-scene-card')
    expect(card).toMatchObject({
      /* Per-scene anchor: one step below the turn card's -0.1 so the
         supersede rule can order them for the same snapshot. */
      anchorSeq: 1.8,
      visibility: 'visible',
      data: {
        sceneId: ref.sceneId,
        revision: ref.scene.revision,
        title: '斜抛运动',
        cause: 'solved',
      },
    })
  })

  it('folds later revisions of the same scene into one card at the newest position', () => {
    const value = snapshot([
      entry(1, 'turn/start', { turn: 1 }),
      sceneEvent(2, 'solved', 0),
      sceneEvent(3, 'command', 1),
      entry(4, 'turn/end', { turn: 1, reason: 'completed' }),
    ])

    const cards = [...value.nodes.values()].filter(n => n.kind === 'physics-scene-card')
    /* One card per scene: it carries the latest revision and sits after the
       last physics event, where the answer text follows. */
    expect(cards.map(c => c.anchorSeq)).toEqual([2.8])
    const data = cards[0]?.data as PhysicsSceneCardData
    expect(data.cause).toBe('command')
    expect(data.revision).toBe(1)
  })

  it('keeps separate scenes on separate cards', () => {
    const value = snapshot([
      entry(1, 'turn/start', { turn: 1 }),
      sceneEvent(2, 'solved', 0),
      sceneEvent(3, 'solved', 0, 'scene-other'),
      entry(4, 'turn/end', { turn: 1, reason: 'completed' }),
    ])

    const cards = [...value.nodes.values()].filter(n => n.kind === 'physics-scene-card')
    expect(cards.map(c => c.anchorSeq)).toEqual([1.8, 2.8])
  })

  /* The turn card renders from the Turn's own published data (the turn-tail
     seat), not from a view node: a `physics/scene` event is not a message, so a
     node built for it has no place on the conversation surface. */
  const turnDataOf = (
    events: readonly DurableEntry[],
  ): ReturnType<NonNullable<typeof physicsSceneTurnDefinition.buildLocationData>> => {
    const startEvent = events[0]
    if (startEvent === undefined) throw new Error('fixture missing turn/start')
    let state = physicsSceneTurnDefinition.start({} as never, {
      ...startEvent, role: 'start', location: { kind: 'session' },
    } as never, {} as never)
    for (const event of events.slice(1)) {
      state = physicsSceneTurnDefinition.update({ state } as never, {
        ...event, role: 'update', location: { kind: 'session' },
      } as never)
    }
    return physicsSceneTurnDefinition.buildLocationData!(
      { state } as never, 'turn', null,
    )
  }

  it('publishes the newest scene of the turn as the turn-tail seat\'s data', () => {
    const published = turnDataOf([
      entry(1, 'turn/start', { turn: 1 }),
      sceneEvent(2, 'solved', 0, ref.sceneId, 1),
      sceneEvent(3, 'solved', 0, 'scene-second', 1),
      sceneEvent(4, 'command', 1, 'scene-second', 1),
      assistantMessage(5, 1),
      entry(6, 'turn/end', { turn: 1, reason: 'completed' }),
    ])
    expect(published).toMatchObject({
      kind: 'turn',
      turn: 1,
      key: 'physics-scene-turn',
      value: { sceneId: 'scene-second', revision: 1, cause: 'command' },
    })
  })

  it('publishes live while the turn is still open', () => {
    const published = turnDataOf([
      entry(1, 'turn/start', { turn: 1 }),
      sceneEvent(2, 'solved', 0, ref.sceneId, 1),
      sceneEvent(3, 'command', 1, ref.sceneId, 1),
    ])
    expect(published).toMatchObject({
      kind: 'turn',
      turn: 1,
      key: 'physics-scene-turn',
      value: { sceneId: ref.sceneId, revision: 1, cause: 'command' },
    })
    /* A turn that published nothing has nothing to dock. */
    expect(turnDataOf([entry(1, 'turn/start', { turn: 2 })])).toBeNull()
  })

  /* The registry refuses a Definition declaring `target` without
     `buildViewNode` — and that refusal fails the whole plugin's activation,
     which takes the client down. Mirroring the rule here is what catches it in
     a unit run: driving the Definitions directly never touches the registry. */
  it('declares a view target and its node builder together, or neither', () => {
    for (const definition of [physicsSceneCardDefinition, physicsSceneTurnDefinition]) {
      /* `Object.hasOwn` rather than reading the members: the properties are
         what the rule is about, and reading a method off its object to compare
         it is exactly the unbound reference the linter refuses. */
      expect(Object.hasOwn(definition, 'target')).toBe(Object.hasOwn(definition, 'buildViewNode'))
    }
    expect(Object.hasOwn(physicsSceneTurnDefinition, 'target')).toBe(false)
    expect(Object.hasOwn(physicsSceneTurnDefinition, 'buildLocationData')).toBe(true)
  })

  it('ignores unrelated events and stays total across the interface', () => {
    expect(physicsSceneCardDefinition.match(
      entry(1, 'turn/start', { turn: 1 }).event,
    )).toBeNull()

    const matched = sceneEvent(5)
    const match = physicsSceneCardDefinition.match(matched.event)
    expect(match).toEqual({ id: `scene:${ref.sceneId}`, role: 'start' })
    /* A later revision of the same scene is an update, not a second card. */
    expect(physicsSceneCardDefinition.match(sceneEvent(6, 'command', 1).event))
      .toEqual({ id: `scene:${ref.sceneId}`, role: 'update' })
    expect(isPhysicsSceneEvent(matched.event)).toBe(true)
    expect(isPhysicsSceneEvent(entry(6, 'tool/call', {}).event)).toBe(false)

    const state = physicsSceneCardDefinition.start({} as never, {
      ...matched, role: 'start', location: { kind: 'session' },
    }, {} as never)
    expect(state.title).toBe('斜抛运动')
    const revised = sceneEvent(6, 'command', 1)
    const folded = physicsSceneCardDefinition.update({ state } as never, {
      ...revised, role: 'update', location: { kind: 'session' },
    })
    expect(folded.revision).toBe(1)
    expect(folded.seq).toBe(6)
    expect(physicsSceneCardDefinition.buildViewNode!({ state: undefined } as never)).toBeNull()
    expect(() => physicsSceneCardDefinition.start({} as never, {
      ...entry(7, 'turn/start', { turn: 1 }), role: 'start', location: { kind: 'session' },
    } as never, {} as never)).toThrow('physics-scene-card start requires physics/scene')
  })

  it('renders badge, title, canvas and transport, and opens the Lab on request', () => {
    const openSceneInLab = vi.fn()
    const data: PhysicsSceneCardData = {
      sceneId: ref.sceneId,
      revision: ref.scene.revision,
      title: '斜抛运动',
      domain: 'mechanics',
      cause: 'solved',
      commandType: undefined,
      solve: undefined,
      scene: ref.scene as never,
    }
    const view = render(<SceneChatCard {...cardProps(data, openSceneInLab)} />)

    expect(view.getByText('物理场景')).toBeTruthy()
    expect(view.getByText('斜抛运动')).toBeTruthy()
    expect(view.container.querySelector('svg')).not.toBeNull()

    const play = view.getByRole('button', { name: '播放 / 暂停' })
    expect(play.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(play)
    expect(view.getByRole('button', { name: '播放 / 暂停' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(view.getByRole('button', { name: '在物理世界中打开' }))
    expect(openSceneInLab).toHaveBeenCalledWith({ sceneId: ref.sceneId, scene: ref.scene })
  })

  it('yields to a newer scene card inside the same answer block', () => {
    const data: PhysicsSceneCardData = {
      sceneId: ref.sceneId,
      revision: ref.scene.revision,
      title: '斜抛运动',
      domain: 'mechanics',
      cause: 'solved',
      commandType: undefined,
      solve: undefined,
      scene: ref.scene as never,
    }
    /* Same answer block (no user message between the cards): this card is
       the abandoned attempt — it renders nothing. */
    const superseded = render(<SceneChatCard {...cardProps(data, vi.fn(), [
      { key: 'physics-scene-card:test', kind: 'physics-scene-card', anchorSeq: 1.9 },
      { key: 'physics-scene-card:newer', kind: 'physics-scene-card', anchorSeq: 2.9 },
      { key: 'user:next', kind: 'user', anchorSeq: 4 },
    ])} />)
    expect(superseded.container.querySelector('svg')).toBeNull()
    expect(superseded.container.querySelector('[data-scene-card]')).toBeNull()

    /* A user message in between means a new question: this card stays. */
    const kept = render(<SceneChatCard {...cardProps(data, vi.fn(), [
      { key: 'physics-scene-card:test', kind: 'physics-scene-card', anchorSeq: 1.9 },
      { key: 'user:next', kind: 'user', anchorSeq: 2.5 },
      { key: 'physics-scene-card:newer', kind: 'physics-scene-card', anchorSeq: 3.9 },
    ])} />)
    expect(kept.container.querySelector('[data-scene-card]')).not.toBeNull()
  })

  it('yields to the Turn card once its Turn has closed', () => {
    const data: PhysicsSceneCardData = {
      sceneId: ref.sceneId,
      revision: ref.scene.revision,
      title: '斜抛运动',
      domain: 'mechanics',
      cause: 'solved',
      commandType: undefined,
      solve: undefined,
      scene: ref.scene as never,
    }
    const turnData = new Map([[PHYSICS_SCENE_TURN_KEY, { sceneId: ref.sceneId }]])
    /* The Turn card is drawn from `turn/end`, so once the Turn closes it owns
       this answer and the per-scene card must go — otherwise the reader sees
       the same scene twice. */
    const yielded = render(<SceneChatCard {...cardProps(data, vi.fn(), [], undefined,
      { number: 1, state: { turn: 1, status: 'closed', data: turnData } })} />)
    expect(yielded.container.querySelector('[data-scene-card]')).toBeNull()

    /* While the Turn runs the Turn card does not exist yet: the inline card is
       the only thing showing the world being built, so it stays. */
    const kept = render(<SceneChatCard {...cardProps(data, vi.fn(), [], undefined,
      { number: 1, state: { turn: 1, status: 'open', data: turnData } })} />)
    expect(kept.container.querySelector('[data-scene-card]')).not.toBeNull()

    /* A closed Turn that published no scene leaves this card alone: it is the
       fallback for logs whose scenes carry no turn number. */
    const unowned = render(<SceneChatCard {...cardProps(data, vi.fn(), [], undefined,
      { number: 1, state: { turn: 1, status: 'closed', data: new Map() } })} />)
    expect(unowned.container.querySelector('[data-scene-card]')).not.toBeNull()
  })

  it('shows the unsupported note for a scene no domain runtime accepts', () => {
    /* domainOfScene classifies on content, not a domain field: strip the
       bodies so no domain runtime accepts the scene. */
    const broken = { ...ref.scene, bodies: [] }
    const data: PhysicsSceneCardData = {
      sceneId: 'scene-broken',
      revision: 1,
      title: '未接入场景',
      domain: 'unsupported',
      cause: 'created',
      commandType: undefined,
      solve: undefined,
      scene: broken as never,
    }
    const view = render(<SceneChatCard {...cardProps(data)} />)

    expect(view.getByRole('status').textContent)
      .toBe('这个场景暂不支持内嵌预览，请在物理世界中查看。')
    expect(view.queryByRole('button', { name: '播放 / 暂停' })).toBeNull()
  })

  it('renders the solve summary: knowns, targets, answers, steps and the verdict', () => {
    const data = solvedCardData('mech-01-uniform-acceleration')
    const view = render(<SceneChatCard {...cardProps(data)} />)

    expect(view.getByText('题目理解')).toBeTruthy()
    expect(view.getByText('已验证')).toBeTruthy()
    expect(view.getByText('已知条件')).toBeTruthy()
    expect(view.getByText('求解目标')).toBeTruthy()
    expect(view.getByText('答案')).toBeTruthy()
    expect(view.getByText('解题步骤')).toBeTruthy()
    expect(view.getByText('物理验证')).toBeTruthy()
    /* Knowns carry the recognized quantities; v0 is drawn so it is a control. */
    expect(view.getAllByRole('button', { name: /在画布中高亮/ }).length).toBeGreaterThan(0)
    /* Answers restate the solved targets with units. */
    expect(view.container.textContent).toContain('20.00 m/s')
  })

  it('lights the mapped primitive on the canvas when a known chip is toggled', () => {
    const view = render(<SceneChatCard {...cardProps(solvedCardData('mech-01-uniform-acceleration'))} />)
    /* The spec's `t` does not interpolate, so every chip shares the raw
       template name — the MathText title picks the v0 one. */
    const chip = view.getAllByRole('button', { name: '在画布中高亮 {symbol}' })
      .find(button => button.querySelector('[title="v_0"]') !== null)
    if (chip === undefined) throw new Error('v0 chip missing')
    expect(view.container.querySelector('g[class*="highlightGroup"]')).toBeNull()

    fireEvent.click(chip)
    expect(view.container.querySelector('g[class*="highlightGroup"]')).not.toBeNull()
    expect(chip.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(view.getByRole('button', { name: '取消高亮 {symbol}' }))
    expect(view.container.querySelector('g[class*="highlightGroup"]')).toBeNull()
  })

  it('keeps the solve payload when a command revision folds into the card', () => {
    const solved = solvedCardData('01-proton-basic')
    const value = snapshot([
      entry(1, 'turn/start', { turn: 1 }),
      entry(2, 'physics/scene', {
        sceneId: solved.sceneId, revision: 0, domain: 'magnetic',
        engineId: 'engine-magnetic', title: solved.title, cause: 'solved',
        solve: solved.solve, scene: solved.scene,
      }),
      entry(3, 'physics/scene', {
        sceneId: solved.sceneId, revision: 1, domain: 'magnetic',
        engineId: 'engine-magnetic', title: solved.title, cause: 'command',
        commandType: 'set_field', scene: solved.scene,
      }),
      entry(4, 'turn/end', { turn: 1, reason: 'completed' }),
    ])

    const card = node(value, 'physics-scene-card')
    const data = card?.data as PhysicsSceneCardData
    /* The revision folded forward; the solve survives so the derivation stays. */
    expect(data.revision).toBe(1)
    expect(data.cause).toBe('command')
    expect(data.solve?.goldenQuestionId).toBe('01-proton-basic')
  })

  it('renders the golden self-check bank inside the solved card', () => {
    const recordAttempt = vi.fn<(attempt: SelfCheckAttemptInput) => void>()
    const view = render(
      <SceneChatCard {...cardProps(solvedCardData('01-proton-basic'), vi.fn(), [], recordAttempt)} />,
    )
    expect(view.getByText('自测')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '不做功，速率保持不变' }))
    expect(recordAttempt).toHaveBeenCalledOnce()
    expect(recordAttempt.mock.calls[0]![0].questionId).toBe('01-proton-basic')
    expect(recordAttempt.mock.calls[0]![0].correct).toBe(true)
  })

  it('mounts the verification block on the solved card, next to the answer', () => {
    const data = solvedCardData('mech-01-uniform-acceleration')
    const provenance = data.solve?.answers[0]?.provenance
    if (provenance === undefined || provenance === null) throw new Error('fixture has no provenance')
    const view = render(<SceneChatCard {...cardProps(data)} />)

    /* One verification section, not a second copy beside it. */
    expect(view.getAllByText('物理验证').length).toBe(1)
    expect(view.getByText('物理已验证')).toBeTruthy()
    expect(view.container.querySelector('[data-verification-level="physics-verified"]')).not.toBeNull()
    /* The engine and verifier are named from the answer's OWN provenance, not
       from the scene domain. */
    expect(view.container.querySelector(`[data-engine="${provenance.engineId}"]`)).not.toBeNull()
    expect(view.container.querySelector(`[data-verifier="${provenance.verifierId}"]`)).not.toBeNull()
    expect(view.getByText('验证项')).toBeTruthy()
    /* The primary answer reaches the block with its unit. */
    expect(view.container.querySelector('[data-verified-value]')?.textContent).toContain('m/s')
  })

  it('falls back to the unverified state when the solve answers carry no provenance', () => {
    const data = solvedCardData('mech-01-uniform-acceleration')
    const solve = data.solve
    if (solve === undefined) throw new Error('fixture has no solve')
    /* A formatted answer and passing local checks are NOT provenance: without a
       trace on the answer the block must warn, never show a check or name an
       engine. */
    const stripped = solve.answers.map(answer => ({ ...answer, provenance: null }))
    const view = render(<SceneChatCard {...cardProps({ ...data, solve: { ...solve, answers: stripped } })} />)

    expect(view.getByText('未验证')).toBeTruthy()
    expect(view.container.textContent).not.toContain('物理已验证')
    expect(view.container.querySelector('[data-verification-level="unverified"]')).not.toBeNull()
    /* No engine or verifier is named without a trace. */
    expect(view.container.querySelector('[data-engine]')).toBeNull()
    expect(view.container.querySelector('[data-verifier]')).toBeNull()
  })
})
