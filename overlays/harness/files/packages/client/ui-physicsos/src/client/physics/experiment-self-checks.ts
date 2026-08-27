/**
 * Lab self-checks (实验自测) — topic resolution for the current frame.
 *
 * The bank itself is hand-audited DATA in `@physicsos/question-core`; this
 * module only decides WHICH topic the live frame is about, from facts the
 * runtime already published (the same dispatch style as the tutor):
 *   电源内阻 > 0 → 电动势与内阻; 有滑动变阻器 → 动态电路;
 *   有并联结点 → 并联/混联; 否则 → 串联.
 * A template id is never consulted, so a student-modified or question-forked
 * circuit still gets the probes that match what the canvas shows.
 *
 * Two 初中 measurement rigs (伏安法测电阻 / 测灯泡功率) are physically the
 * same rheostat loop — their topic is the measurement intent, which no circuit
 * fact can carry. That intent lives in the scene title the template stamped,
 * so the slider branch sub-dispatches on the title (exactly how the tutor
 * tells mechanics lessons apart); a renamed or rebuilt circuit falls back to
 * the honest 动态电路 topic. 测平均速度 resolves the same way on mechanics
 * frames. Optics frames resolve on the imaging element actually drawn on the
 * bench (plane mirror → 平面镜成像, thin lens → 凸透镜成像规律, curved mirror
 * → 凹面镜成像) — a fact, not a title. Acoustics frames are all echo ranging:
 * the domain itself is the topic, since the acoustic bench models exactly one
 * apparatus.
 *
 * Each topic also names the experiment template that trains it, so a mistake
 * recorded in the lab can deep-link back to a fresh instance of the same
 * apparatus (学习记录 → 重新练习).
 */

import {
  experimentSelfChecksOfTopic,
  type ExperimentSelfCheckSet,
} from '@physicsos/question-core'

import type { PhysicsAgentContext } from './physics-agent.ts'

/**
 * The lab topic of a circuit frame, undefined for other domains or failed
 * frames. Order matters: an EMF rig also carries a rheostat, and a rheostat
 * rig is also a series loop — the most specific fact wins.
 */
export const circuitTopicOf = (context: PhysicsAgentContext): string | undefined => {
  if (context.status === 'failed' || context.domain !== 'circuit') return undefined
  const facts = context.circuit
  if (facts === undefined) return undefined
  if (facts.internalResistance > 0) return 'circuit-emf'
  if (facts.hasSlider) {
    if (/伏安法|voltmeter|volt-ampere/i.test(context.sceneTitle)) return 'circuit-va'
    if (/灯泡|电功率|bulb/i.test(context.sceneTitle)) return 'circuit-bulb'
    return 'circuit-rheostat'
  }
  if (facts.junctionCount > 0) return 'circuit-parallel'
  return 'circuit-series'
}

/**
 * The lab topic of a mechanics frame — currently only the 初中 测平均速度 run,
 * recognised by the title its template stamped. Other mechanics frames return
 * undefined so the drawer keeps the 自测 tab off where the bank has nothing.
 */
export const mechanicsTopicOf = (context: PhysicsAgentContext): string | undefined => {
  if (context.status === 'failed' || context.domain !== 'mechanics') return undefined
  return /平均速度|average speed/i.test(context.sceneTitle)
    ? 'mechanics-average-speed'
    : undefined
}

/**
 * The lab topic of an optics frame, read from the bench itself: the single
 * imaging element IS the topic, so a renamed or question-forked bench still
 * gets the probes that match what the canvas shows.
 */
export const opticsTopicOf = (context: PhysicsAgentContext): string | undefined => {
  if (context.status === 'failed' || context.domain !== 'optics') return undefined
  const facts = context.optics
  if (facts === undefined) return undefined
  return facts.elementKind === 'plane_mirror'
    ? 'optics-plane-mirror'
    : facts.elementKind === 'curved_mirror'
      ? 'optics-curved-mirror'
      : 'optics-convex-lens'
}

/**
 * The lab topic of an acoustics frame. The acoustic bench models exactly one
 * apparatus (a source facing a reflector), so the domain IS the topic — a
 * renamed scene still gets the echo-ranging probes.
 */
export const acousticsTopicOf = (context: PhysicsAgentContext): string | undefined =>
  context.status !== 'failed' && context.domain === 'acoustics' ? 'acoustics-echo' : undefined

/**
 * The lab topic of a fluid frame. The tank models exactly one apparatus (a
 * block on a spring scale over one liquid), so the domain IS the topic — a
 * renamed scene still gets the buoyancy probes.
 */
export const fluidTopicOf = (context: PhysicsAgentContext): string | undefined =>
  context.status !== 'failed' && context.domain === 'fluid' ? 'fluid-buoyancy' : undefined

/**
 * The lab topic of a thermal frame. Two apparatuses share the domain: a
 * melting bench vs a two-beaker comparison. The second sample being drawn is
 * the fact that tells them apart — a renamed scene still gets the probes that
 * match the canvas.
 */
export const thermalTopicOf = (context: PhysicsAgentContext): string | undefined => {
  if (context.status === 'failed' || context.domain !== 'thermal') return undefined
  return context.drawnIds.includes('sample-2') ? 'thermal-heat-capacity' : 'thermal-melting'
}

/** The lab topic of any frame; undefined where no domain resolver claims it. */
export const labTopicOf = (context: PhysicsAgentContext): string | undefined =>
  circuitTopicOf(context)
  ?? mechanicsTopicOf(context)
  ?? opticsTopicOf(context)
  ?? acousticsTopicOf(context)
  ?? fluidTopicOf(context)
  ?? thermalTopicOf(context)

/** The self-check set for the current frame; undefined keeps the tab hidden. */
export const experimentSelfChecksOf = (
  context: PhysicsAgentContext,
): ExperimentSelfCheckSet | undefined => {
  const topic = labTopicOf(context)
  return topic === undefined ? undefined : experimentSelfChecksOfTopic(topic)
}

/**
 * Lab topic → the experiment template that re-practises it. Hand-audited like
 * KNOWLEDGE_EXPERIMENT; the 并联 topic re-opens the pure parallel rig even when
 * it was resolved on a mixed circuit, because that rig is the topic's model.
 */
export const SELF_CHECK_EXPERIMENT: Readonly<Record<string, string>> = {
  'circuit-series': 'series-circuit',
  'circuit-parallel': 'parallel-circuit',
  'circuit-rheostat': 'rheostat-circuit',
  'circuit-va': 'va-resistance',
  'circuit-bulb': 'bulb-power',
  'circuit-emf': 'emf-measurement',
  'mechanics-average-speed': 'average-speed',
  'optics-plane-mirror': 'plane-mirror',
  'optics-convex-lens': 'convex-lens',
  'optics-curved-mirror': 'concave-mirror',
  'acoustics-echo': 'echo-ranging',
  'fluid-buoyancy': 'buoyancy',
  'thermal-melting': 'crystal-melting',
  'thermal-heat-capacity': 'heat-capacity-comparison',
}
