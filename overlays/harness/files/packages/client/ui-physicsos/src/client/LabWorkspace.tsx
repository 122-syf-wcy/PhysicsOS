/**
 * PhysicsOS conversation-surface overlay.
 *
 * This file is only a DISPATCHER. It picks a {@link WorkspaceRuntime} for the
 * scene's domain and hands it to the single {@link PhysicsWorkspace} shell; the
 * shell and the canvas are shared by every domain. Registering a new domain means
 * adding a runtime adapter and a renderer — never another workspace page.
 */

import { useMemo } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PhysicsScene } from '@physicsos/physics-scene'

import { LabEmptyState } from './LabEmptyState.tsx'
import { LearningRecordWorkspace } from './LearningRecordWorkspace.tsx'
import { PhysicsWorkspace } from './PhysicsWorkspace.tsx'
import { QuestionWorkspace, type SelfCheckAttemptInput } from './QuestionWorkspace.tsx'
import type { LearningRecordState } from './learning-record-store.ts'
import { domainOfScene, type SupportedSceneDomain } from './physics/domain-of-scene.ts'
import { createCompositeWorkspaceRuntime } from './physics/composite-workspace-runtime.ts'
import { createElectricWorkspaceRuntime } from './physics/electric-workspace-runtime.ts'
import { createMagneticWorkspaceRuntime } from './physics/magnetic-workspace-runtime.ts'
import { createMechanicsWorkspaceRuntime } from './physics/mechanics-workspace-runtime.ts'
import type { WorkspaceRuntime } from './physics/workspace-runtime.ts'
import type {
  PhysicsSurfaceState, PhysicsSurfaceId, RecentExperimentsState,
} from './surface-store.ts'
import css from './LabWorkspace.module.css'

/** Registration-side face for {@link PhysicsSurface}. */
export interface PhysicsSurfaceInjected {
  hooks: {
    physicsSurface: SnapshotStore<PhysicsSurfaceState>
    learningRecord: SnapshotStore<LearningRecordState>
    /** Persisted recent scenes; the picker's 继续上次实验 card reads them. */
    recentExperiments: SnapshotStore<RecentExperimentsState>
  }
  openSurface?: (id: PhysicsSurfaceId, sceneRef?: { sceneId: string; scene: unknown }) => void
  /** Open the experiment chooser while keeping the active scene resumable. */
  openExperimentPicker?: () => void
  /** Write a Question Space self-check answer into the learning record. */
  recordAttempt?: (attempt: SelfCheckAttemptInput) => void
  /** Open Question Space on a golden question (学习记录 → 重新练习). */
  openQuestion?: (questionId: string) => void
  /** Question Space consumed the one-shot 重新练习 ref. */
  consumeQuestion?: () => void
}

/** Slot props for the conversation surface overlay. */
export type PhysicsSurfaceProps = PropsRuntime<'conversation.surface'> &
  PropsLocale<'physicsos'> &
  InjectFace<PhysicsSurfaceInjected>

export function PhysicsSurface({
  usePhysicsSurface,
  useLearningRecord,
  useRecentExperiments,
  t,
  openSurface,
  openExperimentPicker,
  recordAttempt,
  openQuestion,
  consumeQuestion,
  useSessions,
  useWorkspaces,
}: PhysicsSurfaceProps) {
  const surfaceState = usePhysicsSurface(snapshot => snapshot)
  const surface = surfaceState.surface
  const scene = surfaceState.sceneRef?.scene

  /* The chooser replaces the workspace when there is no scene yet — reaching
     the Lab with no scene lands on the experiment picker rather than
     auto-loading the magnetic demo — and when the student explicitly asked to
     pick/switch (the `experimentPicker` flag), in which case the active scene
     stays resumable from inside the chooser. */
  const choosing =
    surface === 'lab' &&
    (surfaceState.sceneRef === undefined || surfaceState.experimentPicker === true)

  /* A domain is decided from the scene itself, so a scene handed over from
     Question Space opens in the matching runtime without the caller saying so. */
  const domain: SupportedSceneDomain | 'unsupported' =
    scene === undefined ? 'magnetic' : domainOfScene(scene)

  /* Keyed on scene identity: a different revision is a different physical world,
     so the runtime is rebuilt rather than mutated behind the shell's back. */
  const runtimeKey = scene === undefined
    ? 'lab-empty'
    : `${domain}:${String(scene.id)}:${scene.revision}`
  const runtime = useMemo<WorkspaceRuntime | null>(
    () => choosing ? null : buildRuntime(domain, scene),
    /* runtimeKey encodes domain + scene identity; `scene` itself is a fresh object
       on every store read, which would rebuild the runtime on every render. */
    [runtimeKey, choosing],
  )

  if (surface === 'home') return null
  if (surface === 'record') {
    return (
      <LearningRecordWorkspace
        t={t}
        useLearningRecord={useLearningRecord}
        openQuestion={openQuestion ?? (() => {})}
        useSessions={useSessions}
        useWorkspaces={useWorkspaces}
      />
    )
  }
  if (surface === 'questions') {
    return (
      <QuestionWorkspace
        t={t}
        usePhysicsSurface={usePhysicsSurface}
        useSessions={useSessions}
        useWorkspaces={useWorkspaces}
        openSurface={openSurface ?? (() => {})}
        {...(recordAttempt === undefined ? {} : { recordAttempt })}
        {...(consumeQuestion === undefined ? {} : { consumeQuestion })}
      />
    )
  }
  if (choosing) {
    /* A resumable scene means the chooser was opened OVER a running experiment
       (toolbar 切换实验 / sidebar 新建), so it offers a way back. */
    const resumable = surfaceState.sceneRef
    return (
      <LabEmptyState
        t={t}
        openSurface={openSurface ?? (() => {})}
        useRecentExperiments={useRecentExperiments}
        useLearningRecord={useLearningRecord}
        {...(resumable === undefined
          ? {}
          : {
            resume: {
              title: resumable.scene.metadata.title ?? resumable.sceneId,
              /* Subject colour for the continue card. */
              domain: domainOfScene(resumable.scene),
              onResume: () => { openSurface?.('lab') },
            },
          })}
      />
    )
  }

  if (runtime === null) {
    return (
      <div className={css.cover} data-physicsos-surface="lab" data-physicsos-domain="unsupported">
        <div className={css.emptyRuntime} role="alert">
          <strong>这个复合场景尚未接入实验室</strong>
          <span>当前实验室支持独立的力学、匀强电场与匀强磁场模型。</span>
        </div>
      </div>
    )
  }

  return (
    <PhysicsWorkspace
      key={runtimeKey}
      runtime={runtime}
      t={t}
      {...(openExperimentPicker === undefined
        ? {}
        : { onSwitchExperiment: openExperimentPicker })}
    />
  )
}

const buildRuntime = (
  domain: SupportedSceneDomain | 'unsupported',
  scene: PhysicsScene | undefined,
): WorkspaceRuntime | null => {
  /* Every domain is matched explicitly and the switch has no default, so a newly
     added domain is a compile error here rather than silently being solved by
     the wrong engine — the engine would then reject the scene at canHandle and
     the surface would fail with a message about magnetism. */
  switch (domain) {
    case 'unsupported':
      return null
    case 'mechanics':
      return scene === undefined ? null : createMechanicsWorkspaceRuntime(scene)
    case 'electric':
      return scene === undefined ? null : createElectricWorkspaceRuntime(scene)
    case 'composite':
      return scene === undefined ? null : createCompositeWorkspaceRuntime(scene)
    case 'magnetic':
      return createMagneticWorkspaceRuntime(scene)
  }
}
