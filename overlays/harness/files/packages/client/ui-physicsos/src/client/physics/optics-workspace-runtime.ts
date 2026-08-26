/**
 * Optics → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + OpticsEngine for a pure single-bench optics scene and
 * reports frames in the shared {@link WorkspaceSnapshot} shape, so the optics
 * domain renders through the same `PhysicsWorkspace` shell and `PhysicsCanvas`
 * as every other domain. Parameter edits (物距/物高/焦距/屏距) go through real
 * scene commands, so a change is an auditable revision bump rather than local
 * component state.
 *
 * Geometric imaging is STATIC: the timeline is zero-length, playback is a
 * no-op, and every frame is the configuration itself. No physics is computed
 * here — every number comes from the engine's verified imaging result,
 * projected by the optics visual bridge.
 */

import {
  OpticsEngine,
  createOpticsSimulationRequest,
  resolveOpticalImaging,
  type LensZone,
  type OpticalImagingResult,
} from '@physicsos/engine-optics'
import { isScalarQuantity, type SimulationResult } from '@physicsos/physics-core'
import { canonicalValue } from '@physicsos/physics-units'
import {
  SceneRuntime,
  createSceneCommand,
  opticalBenchOf,
  type OpticalBench,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import {
  branchBadgeOf,
  forkExperimentalScene,
  requiresExperimentalFork,
} from './experimental-branch.ts'
import {
  fmtOpticsValue,
  imageNatureText,
  opticsObservableKeyOf,
  opticsSceneVisual,
} from './optics-visual-bridge.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  DataTableView,
  DerivedQuantityView,
  InspectorSection,
  ObservableKey,
  QuantityParameter,
  SceneTreeNode,
  VerificationCheckView,
} from './scene-visual-model.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

const CM_PER_METRE = 100

const OBSERVABLE_LABELS: Record<string, string> = {
  rays: '主光线光路',
  image: '像',
}

const DERIVED_LABELS: Record<string, string> = {
  object_distance: '物距 u',
  object_height: '物高 h',
  focal_length: '焦距 f',
  image_distance: '像距 v',
  image_height: '像高 h′',
  magnification: '放大率 m',
  screen_offset: '光屏偏离 Δ',
}

const VERIFICATION_LABELS: Record<string, string> = {
  scene_valid: '场景结构有效',
  thin_lens_equation: '薄透镜公式 1/u + 1/v = 1/f',
  curved_mirror_equation: '球面镜公式 1/u + 1/v = 1/f（f = R/2）',
  mirror_image_symmetry: '平面镜对称性（v = u · 等大 · 虚像）',
  principal_rays_converge: '主光线作图交汇于像点',
  rays_parallel_at_focus: 'u = f 时出射光线平行，不成像',
  virtual_image_uncatchable: '虚像不能被光屏承接',
}

const LENS_ZONE_TEXT: Record<LensZone, string> = {
  beyond_2f: 'u > 2f',
  at_2f: 'u = 2f',
  between_f_2f: 'f < u < 2f',
  at_f: 'u = f',
  within_f: 'u < f',
}

const verificationLabelOf = (id: string): string => VERIFICATION_LABELS[id] ?? id
const derivedLabelOf = (key: string): string => DERIVED_LABELS[key] ?? key

const cmQuantity = (value: number) => ({ value, unit: 'cm', dimension: 'length' as const })

interface Computed {
  readonly simulation: SimulationResult
  readonly result: OpticalImagingResult
}

export class OpticsWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new OpticsEngine()
  private rate = 1
  private commandSequence = 0
  private highlighted: readonly string[] = []
  private failure: string | undefined
  private computed: Computed | undefined
  /** The scene as the source stated it, kept so an experimental branch can be discarded. */
  private readonly origin: PhysicsScene | undefined

  constructor(scene: PhysicsScene) {
    this.sceneRuntime = new SceneRuntime(scene)
    this.origin = scene.metadata.sourceQuestionId === undefined ? undefined : scene
    this.recompute()
  }

  private recompute(): void {
    const scene = this.sceneRuntime.getScene()
    try {
      const support = this.engine.canHandle(scene)
      if (!support.supported) {
        this.failure = support.failedConditions.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const simulation = this.engine.simulate(
        scene,
        createOpticsSimulationRequest(
          scene,
          `optics-lab-${String(scene.id)}-${scene.revision}`,
          `optics-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const result = resolveOpticalImaging(scene)
      this.failure = undefined
      this.computed = { simulation, result }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '光学 Runtime 无法启动。'
      this.computed = undefined
    }
  }

  private command<T extends SceneCommandType>(type: T, payload: SceneCommandPayloadMap[T]): void {
    /* Changing a physical fact on a question scene forks first: the solution the
       student just read was verified against the original conditions. Observable
       toggles are NOT facts and never fork. */
    if (requiresExperimentalFork(this.sceneRuntime.getScene(), type)) {
      this.sceneRuntime = new SceneRuntime(
        forkExperimentalScene({ scene: this.sceneRuntime.getScene() }),
      )
    }
    const scene = this.sceneRuntime.getScene()
    this.commandSequence += 1
    const result = this.sceneRuntime.execute(
      createSceneCommand<T>({
        commandId: `optics-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `optics-ui-trace-${this.commandSequence}`,
      }) as SceneCommand,
    )
    if (!result.ok) {
      this.failure = result.error.message
      return
    }
    this.recompute()
  }

  getSnapshot(): WorkspaceSnapshot {
    const scene = this.sceneRuntime.getScene()
    const title = scene.metadata.title ?? '几何光学实验'
    const badge = branchBadgeOf(scene)
    const bench = opticalBenchOf(scene)

    if (this.computed === undefined || bench === undefined) {
      return {
        domain: 'optics',
        title,
        subtitle: scene.metadata.description ?? '真实几何光学 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('optics'),
        ariaLabel: title,
        tree: bench === undefined ? [] : this.treeOf(scene, bench),
        inspector: bench === undefined ? [] : this.inspectorOf(bench, undefined),
        charts: [],
        table: { columns: [], rows: [] },
        derivation: [],
        verification: [],
        events: [],
        clock: { time: 0, total: 0, running: false, rate: this.rate },
        trajectoryTimes: [],
        error: {
          code: 'OPTICS_RUNTIME_FAILED',
          message: this.failure ?? '当前光学场景不满足 Optics Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, result } = this.computed
    const view = opticsSceneVisual({ scene, result })

    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'optics',
      title,
      subtitle: scene.metadata.description ?? '真实几何光学 Runtime',
      status,
      sceneRevision: scene.revision,
      view: this.highlighted.length === 0 ? view : { ...view, highlighted: this.highlighted },
      ariaLabel: `${title}的可验证物理画布`,
      tree: this.treeOf(scene, bench),
      inspector: this.inspectorOf(bench, result),
      charts: [],
      table: tableOf(result),
      derivation: simulation.derivedQuantities
        .filter(derived => derived.formula !== undefined && isScalarQuantity(derived.value))
        .map(derived => ({
          id: derived.key,
          title: derivedLabelOf(derived.key),
          expression: derived.formula?.expression ?? '',
          result: {
            symbol: derivedLabelOf(derived.key),
            value: isScalarQuantity(derived.value) ? fmtOpticsValue(derived.value.value) : '—',
            unit: derived.value.unit,
          },
        })),
      verification: simulation.verification.checks.map(check => ({
        id: check.id,
        label: verificationLabelOf(check.id),
        status: (check.passed ? 'passed' : 'failed') as VerificationCheckView['status'],
        ...(check.message === undefined ? {} : { detail: check.message }),
      })),
      events: [],
      /* Imaging is static: a zero-length timeline is a reading, not an animation. */
      clock: { time: 0, total: 0, running: false, rate: this.rate },
      trajectoryTimes: [],
      ...(badge === undefined
        ? {}
        : {
          branch: {
            originQuestionTitle: this.origin?.metadata.title,
            parentRevision: badge.parentRevision,
            canRestore: this.origin !== undefined,
          },
        }),
    }
  }

  private treeOf(scene: PhysicsScene, bench: OpticalBench): readonly SceneTreeNode[] {
    const result = this.computed?.result
    const element = bench.elements[0]
    const benchChildren: SceneTreeNode[] = [
      {
        id: bench.object.id,
        label: bench.object.name ?? '发光物体',
        secondary: result === undefined
          ? ''
          : `h = ${fmtOpticsValue(result.model.objectHeight * CM_PER_METRE)} cm · u = ${fmtOpticsValue(result.model.objectDistance * CM_PER_METRE)} cm`,
        icon: 'body' as const,
        kind: 'object' as const,
      },
    ]
    if (element !== undefined) {
      benchChildren.push({
        id: element.id,
        label:
          element.name ??
          (element.type === 'thin_lens'
            ? '凸透镜'
            : element.type === 'curved_mirror'
              ? canonicalValue(element.focalLength) > 0
                ? '凹面镜'
                : '凸面镜'
              : '平面镜'),
        secondary:
          element.type === 'thin_lens' || element.type === 'curved_mirror'
            ? `f = ${fmtOpticsValue(canonicalValue(element.focalLength) * CM_PER_METRE)} cm`
            : '镜面反射成虚像',
        icon: 'field' as const,
        kind: 'object' as const,
      })
    }
    if (bench.screen !== undefined) {
      benchChildren.push({
        id: bench.screen.id,
        label: bench.screen.name ?? '光屏',
        secondary: `x = ${fmtOpticsValue(canonicalValue(bench.screen.position) * CM_PER_METRE)} cm`,
        icon: 'ground' as const,
        kind: 'object' as const,
      })
    }
    const observableChildren: SceneTreeNode[] = scene.observableDefinitions.flatMap(
      (definition) => {
        const key = opticsObservableKeyOf(definition)
        if (key === undefined) return []
        return [{
          id: String(definition.id),
          label: OBSERVABLE_LABELS[key] ?? key,
          icon: 'observable' as const,
          kind: 'observable' as const,
          observable: key,
        }]
      },
    )
    return [
      { id: 'bench', label: '光具座', icon: 'folder', kind: 'group', children: benchChildren },
      { id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren },
    ]
  }

  private inspectorOf(
    bench: OpticalBench,
    result: OpticalImagingResult | undefined,
  ): readonly InspectorSection[] {
    const sections: InspectorSection[] = []
    const element = bench.elements[0]
    const model = result?.model

    const parameters: QuantityParameter[] = [
      {
        id: 'object-distance',
        label: '物距',
        symbol: 'u',
        unit: 'cm',
        value: model === undefined
          ? Number.NaN
          : Number.parseFloat((model.objectDistance * CM_PER_METRE).toFixed(2)),
        min: 1,
        step: 1,
        highlights: bench.object.id,
      },
      {
        id: 'object-height',
        label: '物高',
        symbol: 'h',
        unit: 'cm',
        value: model === undefined
          ? Number.NaN
          : Number.parseFloat((model.objectHeight * CM_PER_METRE).toFixed(2)),
        min: 0.5,
        step: 0.5,
        highlights: bench.object.id,
      },
    ]
    if (element?.type === 'thin_lens') {
      parameters.push({
        id: 'focal-length',
        label: '焦距',
        symbol: 'f',
        unit: 'cm',
        value: Number.parseFloat((canonicalValue(element.focalLength) * CM_PER_METRE).toFixed(2)),
        min: 1,
        step: 1,
        highlights: element.id,
      })
    }
    if (element?.type === 'curved_mirror') {
      /* Signed: f > 0 keeps the concave mirror, dragging below zero flips it
         into a convex one (f = 0 is rejected by the scene command). */
      parameters.push({
        id: 'mirror-focal-length',
        label: '焦距（>0 凹面镜，<0 凸面镜）',
        symbol: 'f',
        unit: 'cm',
        value: Number.parseFloat((canonicalValue(element.focalLength) * CM_PER_METRE).toFixed(2)),
        min: -100,
        max: 100,
        step: 1,
        highlights: element.id,
      })
    }
    if (bench.screen !== undefined && model?.screenX !== undefined) {
      /* Reflection folds the light back: the curved mirror's screen stands in
         FRONT of the mirror, so its distance grows towards −x. */
      const mirrorSide = element?.type === 'curved_mirror'
      parameters.push({
        id: 'screen-distance',
        label:
          element?.type === 'plane_mirror'
            ? '光屏位置（镜后）'
            : mirrorSide
              ? '光屏到镜距离（镜前）'
              : '光屏到镜距离',
        symbol: 'd',
        unit: 'cm',
        value: Number.parseFloat(
          ((mirrorSide
            ? model.elementX - model.screenX
            : model.screenX - model.elementX) * CM_PER_METRE).toFixed(2),
        ),
        min: 1,
        step: 1,
        highlights: bench.screen.id,
      })
    }
    /* One-tap 凹/凸面镜 switch: same vertex, same |f|, only the curvature sign
       flips — so the student compares the two mirrors on an otherwise identical
       bench. The numeric field stays for free-form focal edits. */
    const mirrorTypeChoices =
      element?.type === 'curved_mirror'
        ? [{
          id: 'mirror-type',
          label: '镜面类型',
          value: canonicalValue(element.focalLength) > 0 ? 'concave' : 'convex',
          options: [
            { value: 'concave', label: '凹面镜（会聚）' },
            { value: 'convex', label: '凸面镜（发散）' },
          ],
        }]
        : undefined
    sections.push({
      id: 'bench',
      title: '光具座',
      parameters,
      ...(mirrorTypeChoices === undefined ? {} : { choices: mirrorTypeChoices }),
    })

    if (result !== undefined) {
      const derived: DerivedQuantityView[] = this.computed === undefined
        ? []
        : this.computed.simulation.derivedQuantities
          .filter(entry => isScalarQuantity(entry.value))
          .map(entry => ({
            id: entry.key,
            label: derivedLabelOf(entry.key),
            symbol: '',
            value: isScalarQuantity(entry.value) ? fmtOpticsValue(entry.value.value) : '—',
            unit: entry.value.unit,
            ...(entry.targetId === undefined ? {} : { highlights: entry.targetId }),
          }))
      /* The verified outcome, in the words the exam asks for. Both rows come
         from the imaging result, never re-derived here. */
      derived.push({
        id: 'image-nature',
        label: '像的性质',
        symbol: '',
        value: imageNatureText(result),
        unit: '',
        highlights: 'optical-image',
      })
      if (result.lensZone !== undefined) {
        derived.push({
          id: 'lens-zone',
          label: '物距区间',
          symbol: '',
          value: LENS_ZONE_TEXT[result.lensZone],
          unit: '',
          highlights: result.model.elementId,
        })
      }
      if (result.mirrorZone !== undefined) {
        derived.push({
          id: 'mirror-zone',
          label: '物距区间',
          symbol: '',
          value: LENS_ZONE_TEXT[result.mirrorZone],
          unit: '',
          highlights: result.model.elementId,
        })
      }
      if (result.imageOnScreen !== undefined) {
        derived.push({
          id: 'image-on-screen',
          label: '光屏承接',
          symbol: '',
          value: result.imageOnScreen ? '清晰的实像在光屏上' : '光屏上无像',
          unit: '',
          ...(result.model.screenId === undefined ? {} : { highlights: result.model.screenId }),
        })
      }
      sections.push({ id: 'derived', title: '派生量', derived })
    }
    return sections
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    const scene = this.sceneRuntime.getScene()
    const bench = opticalBenchOf(scene)
    const model = this.computed?.result.model
    if (bench === undefined || model === undefined) return this.getSnapshot()
    const elementXCm = model.elementX * CM_PER_METRE

    if (id === 'object-distance') {
      this.command('SetOpticalObjectPosition', {
        benchId: bench.id,
        position: cmQuantity(elementXCm - value),
      })
    } else if (id === 'object-height') {
      this.command('SetOpticalObjectHeight', {
        benchId: bench.id,
        height: cmQuantity(value),
      })
    } else if (id === 'focal-length') {
      this.command('SetLensFocalLength', {
        benchId: bench.id,
        elementId: model.elementId,
        focalLength: cmQuantity(value),
      })
    } else if (id === 'mirror-focal-length') {
      this.command('SetMirrorFocalLength', {
        benchId: bench.id,
        elementId: model.elementId,
        focalLength: cmQuantity(value),
      })
    } else if (id === 'screen-distance') {
      /* The curved mirror's screen distance is measured in front (−x). */
      const signed = model.elementType === 'curved_mirror' ? -value : value
      this.command('SetOpticalScreenPosition', {
        benchId: bench.id,
        position: cmQuantity(elementXCm + signed),
      })
    }
    return this.getSnapshot()
  }

  setChoice(id: string, value: string): WorkspaceSnapshot {
    if (id === 'mirror-type' && (value === 'concave' || value === 'convex')) {
      const scene = this.sceneRuntime.getScene()
      const bench = opticalBenchOf(scene)
      const element = bench?.elements[0]
      if (bench !== undefined && element?.type === 'curved_mirror') {
        const focalCm = canonicalValue(element.focalLength) * CM_PER_METRE
        const wantPositive = value === 'concave'
        /* Flip the curvature sign, keep |f| — a no-op when already that type. */
        if ((focalCm > 0) !== wantPositive) {
          this.command('SetMirrorFocalLength', {
            benchId: bench.id,
            elementId: element.id,
            focalLength: cmQuantity(-focalCm),
          })
        }
      }
    }
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => opticsObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  setRunning(): WorkspaceSnapshot {
    /* A zero-length timeline has nothing to play. */
    return this.getSnapshot()
  }

  setRate(rate: number): WorkspaceSnapshot {
    if (Number.isFinite(rate) && rate > 0) this.rate = rate
    return this.getSnapshot()
  }

  seek(): WorkspaceSnapshot {
    return this.getSnapshot()
  }

  step(): WorkspaceSnapshot {
    return this.getSnapshot()
  }

  advance(): WorkspaceSnapshot {
    return this.getSnapshot()
  }

  setHighlight(ids: readonly string[]): WorkspaceSnapshot {
    this.highlighted = ids
    return this.getSnapshot()
  }

  /** Discard an experimental branch and return to the scene the question stated. */
  restoreOrigin(): WorkspaceSnapshot {
    if (this.origin === undefined) return this.getSnapshot()
    this.sceneRuntime = new SceneRuntime(this.origin)
    this.highlighted = []
    this.recompute()
    return this.getSnapshot()
  }
}

/** One-row reading table: u, v, m and the image nature at this configuration. */
const tableOf = (result: OpticalImagingResult): DataTableView => {
  const { model, outcome } = result
  const image = outcome.kind === 'image' ? outcome.image : undefined
  return {
    columns: ['u / cm', 'v / cm', 'm', '像的性质'],
    rows: [{
      step: 0,
      values: [
        fmtOpticsValue(model.objectDistance * CM_PER_METRE),
        image === undefined ? '—' : fmtOpticsValue(image.distance * CM_PER_METRE),
        image === undefined ? '—' : fmtOpticsValue(image.magnification),
        imageNatureText(result),
      ],
    }],
  }
}

export const createOpticsWorkspaceRuntime = (scene: PhysicsScene): OpticsWorkspaceRuntime =>
  new OpticsWorkspaceRuntime(scene)
