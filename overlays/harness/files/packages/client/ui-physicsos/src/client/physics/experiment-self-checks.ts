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
 * @returns the string.
 * @param context - the agent context.
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
 * The lab topic of a mechanics frame — 测平均速度 is recognised by the title
 * its template stamped; the class-1 lever is recognised by the hangers the
 * runtime actually drew. Other mechanics frames return undefined so the drawer
 * keeps the 自测 tab off where the bank has nothing.
 * @returns the string.
 * @param context - the agent context.
 */
export const mechanicsTopicOf = (context: PhysicsAgentContext): string | undefined => {
  if (context.status === 'failed' || context.domain !== 'mechanics') return undefined
  if (context.drawnIds.includes('hanger-left')) return 'mechanics-lever'
  /* Connector rigs resolve on the verification the engine actually ran — a
     check id is a fact about the model, so a rebuilt or question-forked rig
     still gets the probes that match what the canvas shows. */
  const checkIds = new Set(context.verification.map(check => check.id))
  if (checkIds.has('rope_length')) return 'mechanics-pendulum'
  if (checkIds.has('restoring_force')) return 'mechanics-spring-oscillator'
  if (checkIds.has('hooke_equilibrium')) return 'mechanics-spring-statics'
  if (checkIds.has('static_friction_balance')) return 'mechanics-friction'
  return /平均速度|average speed/i.test(context.sceneTitle)
    ? 'mechanics-average-speed'
    : undefined
}

/**
 * The lab topic of an optics frame, read from the bench itself: the single
 * imaging element IS the topic, so a renamed or question-forked bench still
 * gets the probes that match what the canvas shows.
 * @returns the string.
 * @param context - the agent context.
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
 * @returns the string.
 * @param context - the agent context.
 */
export const acousticsTopicOf = (context: PhysicsAgentContext): string | undefined =>
  context.status !== 'failed' && context.domain === 'acoustics' ? 'acoustics-echo' : undefined

/**
 * The lab topic of a fluid frame. The tank models exactly one apparatus (a
 * block on a spring scale over one liquid), so the domain IS the topic — a
 * renamed scene still gets the buoyancy probes.
 * @returns the string.
 * @param context - the agent context.
 */
export const fluidTopicOf = (context: PhysicsAgentContext): string | undefined =>
  context.status !== 'failed' && context.domain === 'fluid' ? 'fluid-buoyancy' : undefined

/**
 * The lab topic of a thermal frame. Two apparatuses share the domain: a
 * melting bench vs a two-beaker comparison. The second sample being drawn is
 * the fact that tells them apart — a renamed scene still gets the probes that
 * match the canvas.
 * @returns the string.
 * @param context - the agent context.
 */
export const thermalTopicOf = (context: PhysicsAgentContext): string | undefined => {
  if (context.status === 'failed' || context.domain !== 'thermal') return undefined
  return context.drawnIds.includes('sample-2') ? 'thermal-heat-capacity' : 'thermal-melting'
}

/**
 * The lab topic of a magnetic frame. The magnetic bench models exactly one
 * apparatus — a single charge in a uniform field — so the domain IS the topic:
 * a renamed scene still gets the 洛伦兹力 / 圆周运动 probes, the same dispatch
 * style as the acoustics and fluid benches.
 * @returns the string.
 * @param context - the agent context.
 */
export const magneticTopicOf = (context: PhysicsAgentContext): string | undefined =>
  context.status !== 'failed' && context.domain === 'magnetic' ? 'magnetic-circular' : undefined

/**
 * The lab topic of an electric frame, read from the apparatus actually drawn:
 * the two plate boundaries of a parallel-plate rig vs the source sphere(s) of a
 * point-charge rig. A renamed or question-forked bench still resolves from what
 * the canvas shows — exactly how the optics topic reads the imaging element.
 * @returns the string.
 * @param context - the agent context.
 */
export const electricTopicOf = (context: PhysicsAgentContext): string | undefined => {
  if (context.status === 'failed' || context.domain !== 'electric') return undefined
  return context.drawnIds.some(id => id.startsWith('plate-'))
    ? 'electric-parallel-plate'
    : 'electric-point-charge'
}

/**
 * The lab topic of a composite frame, read from the apparatus regions the
 * runtime drew — the same dispatch the tutor uses to tell its composite
 * lessons apart. The mass-spectrometer deflection region is a fact, not a
 * title; a non-zero gravity (read from the derived row the runtime already
 * published) selects the three-field world; a velocity_selection_condition
 * verifier check selects the selector; everything else is the crossed E+B
 * rig. Order matters — the deflection arc also carries a magnetic field, and
 * the selector also carries gravity-free E+B, so the most specific fact wins.
 * @returns the string.
 * @param context - the agent context.
 */
export const compositeTopicOf = (context: PhysicsAgentContext): string | undefined => {
  if (context.status === 'failed' || context.domain !== 'composite') return undefined
  if (context.drawnIds.includes('spectrometer-deflection')) return 'composite-mass-spectrometer'
  const gravity = context.derived.find(row => row.label === '重力大小')
  if (gravity !== undefined && !/^0(\.0+)?$/.test(gravity.value)) return 'composite-three-field'
  if (context.verification.some(check => check.id === 'velocity_selection_condition')) {
    return 'composite-velocity-selector'
  }
  return 'composite-crossed-field'
}

/**
 * The lab topic of an induction frame, read from the bench the runtime drew:
 * the rod object (`…​.bar`) only exists on the cutting rig, everything else is
 * the flux-changing coil. A renamed or question-forked bench still resolves
 * from what the canvas shows.
 * @returns the string.
 * @param context - the agent context.
 */
export const inductionTopicOf = (context: PhysicsAgentContext): string | undefined => {
  if (context.status === 'failed' || context.domain !== 'induction') return undefined
  return context.drawnIds.some(id => id.endsWith('.bar'))
    ? 'induction-bar-motion'
    : 'induction-flux-change'
}

/**
 * The lab topic of a wave frame, read from the rig the runtime drew: a marked
 * particle only exists on the rope, sources only on the interference tank,
 * nodes only on the clamped string. A renamed or question-forked bench still
 * resolves from what the canvas shows.
 * @returns the string.
 * @param context - the agent context.
 */
export const waveTopicOf = (context: PhysicsAgentContext): string | undefined => {
  if (context.status === 'failed' || context.domain !== 'wave') return undefined
  if (context.drawnIds.some(id => id.endsWith('.marker'))) return 'wave-travelling'
  if (context.drawnIds.some(id => id.endsWith('.source-1'))) return 'wave-interference'
  if (context.drawnIds.some(id => id.includes('.node.'))) return 'wave-standing'
  return undefined
}

/**
 * The lab topic of any frame; undefined where no domain resolver claims it.
 * @returns the string.
 * @param context - the agent context.
 */
export const labTopicOf = (context: PhysicsAgentContext): string | undefined =>
  circuitTopicOf(context)
  ?? mechanicsTopicOf(context)
  ?? opticsTopicOf(context)
  ?? acousticsTopicOf(context)
  ?? fluidTopicOf(context)
  ?? thermalTopicOf(context)
  ?? electricTopicOf(context)
  ?? magneticTopicOf(context)
  ?? compositeTopicOf(context)
  ?? inductionTopicOf(context)
  ?? waveTopicOf(context)

/**
 * The self-check set for the current frame; undefined keeps the tab hidden.
 * @returns the experiment self check set.
 * @param context - the agent context.
 */
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
  'mechanics-lever': 'lever-balance',
  'mechanics-spring-statics': 'hooke-law',
  'mechanics-spring-oscillator': 'spring-oscillator',
  'mechanics-pendulum': 'simple-pendulum',
  'mechanics-friction': 'friction-static',
  'optics-plane-mirror': 'plane-mirror',
  'optics-convex-lens': 'convex-lens',
  'optics-curved-mirror': 'concave-mirror',
  'acoustics-echo': 'echo-ranging',
  'fluid-buoyancy': 'buoyancy',
  'thermal-melting': 'crystal-melting',
  'thermal-heat-capacity': 'heat-capacity-comparison',
  'magnetic-circular': 'magnetic-circular',
  'electric-point-charge': 'point-charge',
  'electric-parallel-plate': 'parallel-plate',
  'composite-velocity-selector': 'velocity-selector',
  'composite-mass-spectrometer': 'mass-spectrometer',
  'composite-crossed-field': 'composite-eb',
  'composite-three-field': 'composite-ebg',
  'induction-bar-motion': 'induction-bar-motion',
  'induction-flux-change': 'induction-flux-change',
  'wave-travelling': 'wave-travelling',
  'wave-interference': 'wave-interference',
  'wave-standing': 'wave-standing',
  'wave-expanded': 'wave-longitudinal',
}
