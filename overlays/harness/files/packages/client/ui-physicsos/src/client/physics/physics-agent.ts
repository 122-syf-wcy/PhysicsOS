/**
 * Physics Agent context and tools.
 *
 * The Agent explains physics that has ALREADY been computed and verified: it reads
 * the current scene, simulation, verification and observations, and it acts only
 * through declared tools. It never recomputes a physical quantity — if the answer
 * to "why is vₓ constant" is not already in the verification output, the honest
 * response is that the runtime does not assert it, not a fresh calculation.
 *
 * Two tool families, deliberately separated:
 *   - `physics.ui.*`   view interaction. No PhysicsEvent, no revision change.
 *   - `physics.scene.*` a real SceneCommand: revision +1, engine recompute, verify.
 */

import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'
import type { ObservableKey, VerificationCheckView } from './scene-visual-model.ts'

/** Everything the Agent may read about the live physical world. */
export interface PhysicsAgentContext {
  readonly domain: WorkspaceSnapshot['domain']
  readonly sceneTitle: string
  readonly sceneRevision: number
  readonly status: WorkspaceSnapshot['status']
  /** Scene time in seconds the canvas is currently showing. */
  readonly time: number
  readonly total: number
  /** Named verification checks, already student-readable. */
  readonly verification: readonly VerificationCheckView[]
  /** Derived facts from the verified simulation, as displayed. */
  readonly derived: readonly { label: string; symbol: string; value: string; unit: string }[]
  /** Visual ids actually drawn right now, i.e. what a highlight may target. */
  readonly drawnIds: readonly string[]
  /** Observable layers and whether they are currently on. */
  readonly observables: Readonly<Partial<Record<ObservableKey, boolean>>>
  /**
   * Sign of the (primary) source charge in an electric point-charge frame, read
   * from the Inspector's 源电荷 section — never recomputed. Absent in non-electric
   * or uniform-field frames. The Agent uses it to say "outward vs inward" without
   * re-deriving the field direction.
   */
  readonly chargeSign?: 'positive' | 'negative' | 'neutral'
  /**
   * Signs of every source charge in a multi-source electric frame, read from the
   * Inspector's 源电荷 section — one entry per source, in display order. Single-
   * source frames carry a one-element array. Absent in non-electric or uniform-
   * field frames so the Agent cannot claim a sign the runtime never published.
   * `chargeSign` stays as the first element for V1 answer compatibility.
   */
  readonly chargeSigns?: readonly ('positive' | 'negative' | 'neutral')[]
  /** Circuit-frame facts, present exactly when the domain is `circuit`. */
  readonly circuit?: CircuitAgentFacts
  /** Optics-frame facts, present exactly when the domain is `optics`. */
  readonly optics?: OpticsAgentFacts
  /** Present when the scene came from a question and was then forked. */
  readonly branch?: WorkspaceSnapshot['branch']
}

/**
 * What the runtime already published about a circuit frame, read from the
 * Inspector and the drawn schematic — never recomputed. The teaching layer
 * dispatches on these facts (electromotive source with internal resistance →
 * EMF lesson, a rheostat symbol → dynamic-circuit lesson, junction dots →
 * parallel topology) instead of trusting scene titles.
 */
export interface CircuitAgentFacts {
  /** 电源内阻 r in Ω from the Inspector's 电源 section; 0 when absent. */
  readonly internalResistance: number
  /** A variable-resistor symbol is drawn on the schematic. */
  readonly hasSlider: boolean
  /**
   * Branch-point dots on the schematic — nets where the current actually
   * splits. Voltmeter-tap dots don't count, so a series loop with its meter
   * reads 0 and only real 并联/混联 topology reads above it.
   */
  readonly junctionCount: number
}

/**
 * What the runtime already published about an optics frame, read from the
 * drawn bench — never re-imaged. The teaching layer dispatches on the element
 * that is actually on the rail (a plane mirror teaches 平面镜成像, a thin lens
 * teaches 凸透镜成像规律, a curved mirror teaches 凹面镜成像) instead of
 * trusting scene titles.
 */
export interface OpticsAgentFacts {
  /** The single imaging element drawn on the bench. */
  readonly elementKind: 'thin_lens' | 'plane_mirror' | 'curved_mirror'
  /** Nature of the image the engine formed; `none` when u = f forms no image. */
  readonly imageNature: 'real' | 'virtual' | 'none'
  /** Whether the drawn screen catches the image; absent when no screen. */
  readonly screenLit?: boolean
}

/** Build the Agent's view of the world from one workspace frame. */
export const physicsAgentContext = (snapshot: WorkspaceSnapshot): PhysicsAgentContext => {
  const chargeSigns = sourceChargeSignsOf(snapshot)
  const chargeSign = chargeSigns?.[0]
  const circuit = circuitFactsOf(snapshot)
  const optics = opticsFactsOf(snapshot)
  return {
    domain: snapshot.domain,
    sceneTitle: snapshot.title,
    sceneRevision: snapshot.sceneRevision,
    status: snapshot.status,
    time: snapshot.clock.time,
    total: snapshot.clock.total,
    verification: snapshot.verification,
    derived: snapshot.inspector.flatMap(section =>
      (section.derived ?? []).map(row => ({
        label: row.label,
        symbol: row.symbol,
        value: row.value,
        unit: row.unit,
      })),
    ),
    drawnIds: drawnVisualIds(snapshot),
    observables: snapshot.view.visible,
    ...(chargeSign === undefined ? {} : { chargeSign }),
    ...(chargeSigns === undefined ? {} : { chargeSigns }),
    ...(circuit === undefined ? {} : { circuit }),
    ...(optics === undefined ? {} : { optics }),
    ...(snapshot.branch === undefined ? {} : { branch: snapshot.branch }),
  }
}

/**
 * Read the circuit facts off the frame: internal resistance from the
 * Inspector's 电源 section (the same surface the student edits), slider and
 * junction presence from the drawn schematic. Non-circuit frames return
 * undefined so no other domain grows a claim it cannot back.
 */
const circuitFactsOf = (snapshot: WorkspaceSnapshot): CircuitAgentFacts | undefined => {
  if (snapshot.domain !== 'circuit') return undefined
  const sourceSection = snapshot.inspector.find(section => section.id === 'source')
  const internal = sourceSection?.parameters?.find(
    parameter => parameter.id === 'internal-resistance',
  )?.value
  return {
    internalResistance: internal !== undefined && Number.isFinite(internal) ? internal : 0,
    hasSlider: (snapshot.view.circuitComponents ?? []).some(
      component => component.kind === 'variable_resistor',
    ),
    junctionCount: (snapshot.view.circuitJunctions ?? []).filter(
      junction => junction.branch === true,
    ).length,
  }
}

/**
 * Read the optics facts off the drawn frame: the element kind from the bench
 * rail, the image nature from the image primitive the bridge emitted (absent
 * exactly when the engine formed no image), the screen state from the screen's
 * lit flag. Non-optics frames return undefined so no other domain grows a
 * claim it cannot back.
 */
const opticsFactsOf = (snapshot: WorkspaceSnapshot): OpticsAgentFacts | undefined => {
  if (snapshot.domain !== 'optics') return undefined
  const element = (snapshot.view.opticalElements ?? [])[0]
  if (element === undefined) return undefined
  const image = (snapshot.view.opticalImages ?? [])[0]
  const screen = (snapshot.view.opticalScreens ?? [])[0]
  return {
    elementKind: element.kind,
    imageNature: image === undefined ? 'none' : image.nature,
    ...(screen === undefined ? {} : { screenLit: screen.lit }),
  }
}

/**
 * Read the signs of every source charge from the Inspector — the only place the
 * runtime already surfaces those numbers to the student. Returns undefined for
 * non-point-charge frames (no 源电荷 section) so the Agent cannot pretend to know
 * a sign the runtime never published. Each row whose value is finite yields one
 * entry, in display order.
 */
const sourceChargeSignsOf = (
  snapshot: WorkspaceSnapshot,
): ('positive' | 'negative' | 'neutral')[] | undefined => {
  if (snapshot.domain !== 'electric') return undefined
  const sourceSection = snapshot.inspector.find(section => section.title === '源电荷')
  const parameters = sourceSection?.parameters
  if (parameters === undefined || parameters.length === 0) return undefined
  const signs: ('positive' | 'negative' | 'neutral')[] = []
  for (const parameter of parameters) {
    if (!Number.isFinite(parameter.value)) continue
    signs.push(parameter.value > 0 ? 'positive' : parameter.value < 0 ? 'negative' : 'neutral')
  }
  return signs.length === 0 ? undefined : signs
}

/** Ids present in the current frame; a highlight for anything else is a no-op. */
export const drawnVisualIds = (snapshot: WorkspaceSnapshot): readonly string[] => {
  const view = snapshot.view
  return [
    ...view.bodies.map(body => body.id),
    ...view.particles.map(particle => particle.id),
    ...view.vectors.map(vector => vector.id),
    ...view.trajectories.map(trajectory => trajectory.id),
    ...view.keyPoints.map(point => point.id),
    ...view.angles.map(angle => angle.id),
    ...view.dimensions.map(dimension => dimension.id),
    ...view.guides.map(guide => guide.id),
    /* Point-charge primitives: a source sphere, a streamline, and the probe are
       the drawable objects of an electric point-charge frame, so an Agent highlight
       or a "what can this scene answer" check must see them too. */
    ...(view.pointChargeSources ?? []).map(source => source.id),
    ...(view.fieldStreamlines ?? []).map(streamline => streamline.id),
    ...(view.probe === undefined ? [] : [view.probe.id]),
    /* Parallel-plate primitives: the two plates carry boundary ids (e.g.
       `plate-top-1`, `plate-bottom-1`); the bounded field region has no id of
       its own. Collecting plates lets an Agent highlight "the upper plate" etc. */
    ...(view.plates ?? []).map(plate => plate.id),
    /* Composite apparatus regions: the selector, the drift gap and the deflection
       region are drawable objects with scene ids, so "highlight the selector" has
       something to resolve to. */
    ...(view.compositeRegions ?? []).map(region => region.id),
    /* Circuit schematic symbols carry the component ids (`bat`, `am`, `r1`, …);
       the circuit renderer applies the highlight group per component, so these
       are exactly what a tutor highlight may target. Wires and junction dots
       have no highlight rendering and stay out. */
    ...(view.circuitComponents ?? []).map(component => component.id),
    /* Optics bench primitives: the object arrow, the imaging element, the
       formed image and the screen are highlight groups in the optics renderer.
       Rays and F/2F ticks have no highlight rendering and stay out (the same
       rule that keeps circuit wires out). */
    ...(view.opticalObjects ?? []).map(object => object.id),
    ...(view.opticalElements ?? []).map(element => element.id),
    ...(view.opticalImages ?? []).map(image => image.id),
    ...(view.opticalScreens ?? []).map(screen => screen.id),
    /* Acoustic range primitives: the speaker, the reflecting wall and the
       travelling pulse are highlight groups in the acoustics renderer.
       Wavefront arcs are decoration and stay out (the rays/wires rule). */
    ...(view.acousticSources ?? []).map(source => source.id),
    ...(view.acousticReflectors ?? []).map(reflector => reflector.id),
    ...(view.acousticPulse === undefined ? [] : [view.acousticPulse.id]),
    /* Buoyancy rig primitives: the block, the liquid body and the spring scale
       are highlight groups in the fluid renderer. The force arrows follow the
       vector rule and stay out. */
    ...(view.fluidBlock === undefined ? [] : [view.fluidBlock.id]),
    ...(view.fluidLiquid === undefined ? [] : [view.fluidLiquid.id]),
    ...(view.fluidScale === undefined ? [] : [view.fluidScale.id]),
    /* Heating bench primitives: the sample, the heater and the thermometer are
       highlight groups in the thermal renderer. A comparison rig adds the
       second beaker, heater and thermometer. */
    ...(view.thermalSample === undefined ? [] : [view.thermalSample.id]),
    ...(view.thermalHeater === undefined ? [] : [view.thermalHeater.id]),
    ...(view.thermalThermometer === undefined ? [] : [view.thermalThermometer.id]),
    ...(view.thermalComparisonSample === undefined ? [] : [view.thermalComparisonSample.id]),
    ...(view.thermalComparisonHeater === undefined ? [] : [view.thermalComparisonHeater.id]),
    ...(view.thermalComparisonThermometer === undefined
      ? []
      : [view.thermalComparisonThermometer.id]),
    /* Class-1 lever primitives: the beam, the fulcrum and the two hangers. */
    ...(view.leverBeam === undefined ? [] : [view.leverBeam.id]),
    ...(view.leverFulcrum === undefined ? [] : [view.leverFulcrum.id]),
    ...(view.leverHangers ?? []).map(hanger => hanger.id),
  ]
}

/* -------------------------------------------------------------- tool calls -- */

export interface HighlightToolCall {
  readonly tool: 'physics.ui.highlight'
  /** Visual id, or a semantic alias resolved through {@link resolveHighlightTarget}. */
  readonly targetId: string
  /** Milliseconds; omitted means "until the student does something else". */
  readonly duration?: number
}

export interface SceneParameterToolCall {
  readonly tool: 'physics.scene.setParameter'
  /** Inspector parameter id, e.g. `angle`, `height`, `friction`, `B`. */
  readonly parameterId: string
  readonly value: number
}

export type PhysicsAgentToolCall = HighlightToolCall | SceneParameterToolCall

export interface ToolOutcome {
  readonly ok: boolean
  /** Student-facing note; the Drawer shows this, never a stack trace. */
  readonly detail: string
  readonly snapshot: WorkspaceSnapshot
  /** True when the call mutated the scene, so the caller can show the revision. */
  readonly mutatedScene: boolean
  /**
   * Visual ids a highlight call resolved to. An answer that highlights several
   * quantities (电场力 + 洛伦兹力 + 合力) issues one call per target; the drawer
   * unions these so the student sees the forces TOGETHER, not only the last one.
   */
  readonly highlightIds?: readonly string[]
}

/**
 * Semantic aliases the Agent may use instead of an internal id.
 *
 * The Agent should be able to say "the horizontal velocity component" without
 * knowing that the renderer calls it `velocity-x`, and a rename in the visual
 * bridge must not silently break every Agent answer.
 */
const HIGHLIGHT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  velocity: ['velocity'],
  'velocity-x': ['velocity-x'],
  'velocity-y': ['velocity-y'],
  'horizontal-velocity': ['velocity-x'],
  'vertical-velocity': ['velocity-y'],
  acceleration: ['acceleration'],
  gravity: ['force-gravity'],
  weight: ['force-gravity'],
  'normal-force': ['force-normal'],
  friction: ['force-friction'],
  /* `net-force` is the mechanics bridge's id; the electric and composite bridges
     emit `net-force-vector`. Both are listed so one alias works in every domain. */
  'net-force': ['net-force', 'net-force-vector'],
  'gravity-parallel': ['force-gravity_parallel'],
  'gravity-normal': ['force-gravity_normal'],
  trajectory: ['trajectory', 'traj-history', 'composite-trajectory'],
  height: ['launch-height'],
  'height-dimension': ['launch-height'],
  range: ['range'],
  angle: ['launch-angle', 'incline-angle'],
  'launch-angle': ['launch-angle'],
  'incline-angle': ['incline-angle'],
  apex: ['apex'],
  impact: ['impact'],
  launch: ['launch'],
  radius: ['radius'],
  /* Electric point-charge: the E and F vectors the bridge emits at the probe,
     plus a semantic alias for "the source charge itself". */
  'electric-field-vector': ['electric-field-vector'],
  'electric-force-vector': ['electric-force-vector'],
  'electric-field': ['electric-field-vector'],
  'electric-force': ['electric-force-vector'],
  'charge-source': ['source-1'],
  /* Multi-source point-charge: the radial streamlines the bridge emits per source.
     The renderer highlights a streamline by its `sourceId` (e.g. `source-1`), not
     its own `stream-source-1-0` id, so a `field-line` highlight must target the
     source ids — this also lights the source sphere, which is the intended
     "field line and its origin" picture. `source-*` is a prefix wildcard. */
  'field-line': ['source-*'],
  'field-lines': ['source-*'],
  'electric-field-line': ['source-*'],
  /* Parallel-plate: the two plates carry boundary ids like `plate-top-1`,
     `plate-bottom-1`. A `plate-*` prefix wildcard catches any plate, while
     `plate-top` / `plate-bottom` target a single plate. */
  'plate-top': ['plate-top-*'],
  'plate-bottom': ['plate-bottom-*'],
  'plate': ['plate-top-*', 'plate-bottom-*'],
  'plates': ['plate-top-*', 'plate-bottom-*'],
  /* Composite field: the four force contributions the bridge draws at the
     particle, plus the apparatus regions. The region ids are scene-defined
     (`selector-region-1`, `spectrometer-deflection`, …), so a semantic alias maps
     the words a student uses onto whichever region this apparatus declared. */
  'magnetic-force': ['magnetic-force-vector'],
  'magnetic-force-vector': ['magnetic-force-vector'],
  'lorentz-force': ['magnetic-force-vector'],
  'gravity-force': ['gravity-force-vector'],
  'net-force-vector': ['net-force-vector'],
  'selector-region': ['selector-region-*', 'spectrometer-selector', 'multi-region-crossed'],
  'magnetic-region': ['spectrometer-deflection', 'multi-region-magnetic'],
  'drift-region': ['spectrometer-drift'],
  'field-region': ['selector-region-*', 'spectrometer-*', 'multi-region-*'],
  /* Circuit schematic symbols. The circuit templates share one id convention
     (`bat`, `sw`, `am`, `vm`, `rv`, `r0`…`r3`), so the tutor says "the battery"
     and the alias resolves to whichever of those ids this frame actually draws.
     `r*` would also catch the rheostat `rv`, so resistors are listed explicitly. */
  battery: ['bat'],
  ammeter: ['am'],
  voltmeter: ['vm'],
  'circuit-switch': ['sw'],
  rheostat: ['rv'],
  resistors: ['r0', 'r1', 'r2', 'r3'],
  /* Optics bench primitives. The junior templates share one id convention
     (`candle-object`, `lens-1` / `mirror-1`, `screen-1`) and the bridge emits
     the formed image as `optical-image`, so the tutor says "the lens" or "the
     image" and the alias resolves to whatever this bench actually draws. */
  candle: ['candle-object'],
  'optical-object': ['candle-object'],
  lens: ['lens-1'],
  mirror: ['mirror-1'],
  'optical-element': ['lens-1', 'mirror-1'],
  image: ['optical-image'],
  'optical-image': ['optical-image'],
  screen: ['screen-1'],
  'optical-screen': ['screen-1'],
  /* Acoustic range primitives. The echo template stamps `sound-source` and
     `wall-1`; the bridge emits the travelling dot as `sound-pulse`. A `wall-*`
     prefix keeps the alias working if a scene numbers its reflectors. */
  speaker: ['sound-source'],
  'sound-source': ['sound-source'],
  wall: ['wall-*'],
  cliff: ['wall-*'],
  reflector: ['wall-*'],
  pulse: ['sound-pulse'],
  'sound-pulse': ['sound-pulse'],
}

/**
 * Resolve a tool target to ids that are actually drawn.
 *
 * Returning an empty array is meaningful: it tells the caller the Agent asked to
 * point at something this frame does not show, which must surface as "not visible"
 * rather than as a silent highlight of nothing. A candidate ending in `*` matches
 * every drawn id that starts with the prefix (so `stream-*` catches every
 * `stream-source-1-0`, `stream-source-2-3`, … the bridge emits this frame).
 */
export const resolveHighlightTarget = (
  targetId: string,
  drawn: readonly string[],
): readonly string[] => {
  const candidates = HIGHLIGHT_ALIASES[targetId] ?? [targetId]
  const resolved: string[] = []
  for (const candidate of candidates) {
    if (candidate.endsWith('*')) {
      const prefix = candidate.slice(0, -1)
      for (const id of drawn) {
        if (id.startsWith(prefix) && !resolved.includes(id)) resolved.push(id)
      }
    } else if (drawn.includes(candidate)) {
      resolved.push(candidate)
    }
  }
  return resolved
}

/** Student-facing names for the ids a tool may point at. */
const HIGHLIGHT_LABELS: Readonly<Record<string, string>> = {
  velocity: '速度',
  'velocity-x': '水平速度分量',
  'velocity-y': '竖直速度分量',
  'horizontal-velocity': '水平速度分量',
  'vertical-velocity': '竖直速度分量',
  acceleration: '加速度',
  'force-gravity': '重力',
  'force-normal': '支持力',
  'normal-force': '支持力',
  'force-friction': '摩擦力',
  friction: '摩擦力',
  gravity: '重力',
  'force-gravity_parallel': '重力沿斜面分量',
  'force-gravity_normal': '重力法向分量',
  'net-force': '合力',
  'launch-height': '高度',
  'height-dimension': '高度',
  range: '水平射程',
  'launch-angle': '抛射角',
  'incline-angle': '倾角',
  trajectory: '运动轨迹',
  'traj-history': '运动轨迹',
  'composite-trajectory': '运动轨迹',
  launch: '起点',
  apex: '最高点',
  impact: '落地点',
  radius: '轨道半径',
  'electric-field-vector': '电场强度',
  'electric-force-vector': '电场力',
  'electric-field': '电场强度',
  'electric-force': '电场力',
  'electric-velocity-vector': '速度',
  'electric-acceleration-vector': '加速度',
  'electric-trajectory': '运动轨迹',
  'charge-source': '点电荷',
  'field-line': '电场线',
  'field-lines': '电场线',
  'electric-field-line': '电场线',
  'plate-top': '上极板',
  'plate-bottom': '下极板',
  'plate': '极板',
  'plates': '极板',
  'magnetic-force': '洛伦兹力',
  'magnetic-force-vector': '洛伦兹力',
  'lorentz-force': '洛伦兹力',
  'gravity-force': '重力',
  'gravity-force-vector': '重力',
  'net-force-vector': '合力',
  'selector-region': '选择器区',
  'magnetic-region': '磁偏转区',
  'drift-region': '无场过渡区',
  'field-region': '场区',
  battery: '电源',
  bat: '电源',
  ammeter: '电流表',
  am: '电流表',
  voltmeter: '电压表',
  vm: '电压表',
  'circuit-switch': '开关',
  sw: '开关',
  rheostat: '滑动变阻器',
  rv: '滑动变阻器',
  resistors: '电阻',
  r0: '定值电阻 R₀',
  r1: '电阻 R₁',
  r2: '电阻 R₂',
  r3: '电阻 R₃',
  candle: '蜡烛',
  'candle-object': '蜡烛',
  'optical-object': '发光物体',
  lens: '凸透镜',
  'lens-1': '凸透镜',
  /* `mirror-1` is the element id shared by the plane AND curved mirror
     benches, so the label stays element-agnostic. */
  mirror: '镜面',
  'mirror-1': '镜面',
  'optical-element': '成像元件',
  image: '像',
  'optical-image': '像',
  screen: '光屏',
  'screen-1': '光屏',
  'optical-screen': '光屏',
  speaker: '声源',
  'sound-source': '声源',
  wall: '峭壁',
  cliff: '峭壁',
  reflector: '峭壁',
  'wall-1': '峭壁',
  pulse: '声脉冲',
  'sound-pulse': '声脉冲',
}

/** Student-facing name for a highlight target; shared by the drawer's buttons. */
export const highlightLabel = (id: string): string => HIGHLIGHT_LABELS[id] ?? id

/**
 * Execute one Agent tool call against a workspace runtime.
 *
 * A highlight goes through `setHighlight`, which is pure view state; a parameter
 * change goes through `editParameter`, which is a revisioned SceneCommand. The
 * Agent is only ever the caller — the same gate the Inspector uses applies.
 */
export const runPhysicsAgentTool = (
  runtime: WorkspaceRuntime,
  call: PhysicsAgentToolCall,
): ToolOutcome => {
  if (call.tool === 'physics.ui.highlight') {
    const before = runtime.getSnapshot()
    const ids = resolveHighlightTarget(call.targetId, drawnVisualIds(before))
    if (ids.length === 0) {
      return {
        ok: false,
        detail: `画布当前没有显示${highlightLabel(call.targetId)}，请先打开对应的可观察量。`,
        snapshot: before,
        mutatedScene: false,
      }
    }
    const snapshot = runtime.setHighlight(ids)
    /* A view interaction must not look like a physical change. */
    return {
      ok: true,
      detail: `已在画布高亮${ids.map(highlightLabel).join('、')}`,
      snapshot,
      mutatedScene: snapshot.sceneRevision !== before.sceneRevision,
      highlightIds: ids,
    }
  }

  const before = runtime.getSnapshot()
  const editable = before.inspector
    .flatMap(section => section.parameters ?? [])
    .find(parameter => parameter.id === call.parameterId)
  if (editable === undefined) {
    return {
      ok: false,
      detail: `当前场景没有可修改的参数「${call.parameterId}」。`,
      snapshot: before,
      mutatedScene: false,
    }
  }
  if (!Number.isFinite(call.value)) {
    return { ok: false, detail: '参数值必须是有限数。', snapshot: before, mutatedScene: false }
  }
  const snapshot = runtime.editParameter(call.parameterId, call.value)
  return {
    ok: snapshot.sceneRevision !== before.sceneRevision,
    detail:
      snapshot.sceneRevision === before.sceneRevision
        ? `${editable.label} 未发生变化（可能超出允许范围）。`
        : `${editable.label} 已改为 ${call.value}${editable.unit}`,
    snapshot,
    mutatedScene: snapshot.sceneRevision !== before.sceneRevision,
  }
}
