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

import { OptionalAdminWorkspace as AdminWorkspace } from './optional-surfaces.tsx'
import type { AdminApi } from './auth-api.ts'
import type { NoticeApi } from './notice-api.ts'
import type { ModelPoolApi } from './model-pool-api.ts'
import { NoticeBoard } from './NoticeBoard.tsx'
import type { AuthState } from './auth-store.ts'
import { LabEmptyState } from './LabEmptyState.tsx'
import { LearningRecordWorkspace } from './LearningRecordWorkspace.tsx'
import { LibraryWorkspace } from './LibraryWorkspace.tsx'
import { PaperWorkspace } from './PaperWorkspace.tsx'
import type { PaperApi } from './paper-api.ts'
import { PhysicsWorkspace } from './PhysicsWorkspace.tsx'
import type { LearningRecordState, SelfCheckAttemptInput } from './learning-record-store.ts'
import { domainOfScene, type SupportedSceneDomain } from './physics/domain-of-scene.ts'
import { FREE_BUILD_SCENE_ID, draftToScene, starterDraft } from './physics/circuit-builder.ts'
import { createExperimentSceneRef, findExperimentTemplate } from './physics/experiment-templates.ts'
import { experimentMetaOf } from './physics/experiment-summaries.ts'
import { artTemplateIdOfSceneId } from './physics/experiment-artwork.tsx'
import type { WorkspaceRuntime } from './physics/workspace-runtime.ts'
import type {
  PhysicsSceneRef,
  PhysicsSurfaceState,
  PhysicsSurfaceId,
  RecentExperimentsState,
} from './surface-store.ts'
import { buildWorkspaceRuntime } from './physics/build-workspace-runtime.ts'
export { buildWorkspaceRuntime } from './physics/build-workspace-runtime.ts'
import css from './LabWorkspace.module.css'

/** Registration-side face for {@link PhysicsSurface}. */
export interface PhysicsSurfaceInjected {
  hooks: {
    physicsSurface: SnapshotStore<PhysicsSurfaceState>
    learningRecord: SnapshotStore<LearningRecordState>
    /** Persisted recent scenes; the picker's 继续上次实验 card reads them. */
    recentExperiments: SnapshotStore<RecentExperimentsState>
    /** Session principal — the admin surface reads the role from it. */
    auth: SnapshotStore<AuthState>
  }
  /** 出卷专区 REST client — absent only in stripped test compositions. */
  paperApi?: PaperApi
  /** `/physicsos/admin` client — absent in stripped test compositions. */
  adminApi?: AdminApi
  /** `/physicsos/notice` client — absent in stripped test compositions. */
  noticeApi?: NoticeApi
  /** `/physicsos/model-pool` client — absent in stripped test compositions. */
  modelPoolApi?: ModelPoolApi
  openSurface?: (id: PhysicsSurfaceId, sceneRef?: PhysicsSceneRef) => void
  /** Open the Lab assembling a circuit from scratch (实验中心 → 自由搭建). */
  updateScene?: (scene: PhysicsScene) => void
  openBuilder?: (sceneRef: PhysicsSceneRef) => void
  /** Open the experiment chooser while keeping the active scene resumable. */
  openExperimentPicker?: () => void
  /** Write a self-check answer (Lab 自测 tab or a golden question's card) into
      the learning record. */
  recordAttempt?: (attempt: SelfCheckAttemptInput) => void
  /**
   * Send a golden question's stem to the current session's tutor as one queued
   * prompt, then return to the conversation so the solve card streams in.
   * Powers both 学习记录 → 重新练习 and the record page's 题库练习.
   */
  practiceQuestion?: (
    questionId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
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
  openBuilder,
  updateScene,
  openExperimentPicker,
  recordAttempt,
  practiceQuestion,
  useSessions,
  useWorkspaces,
  paperApi,
  adminApi,
  noticeApi,
  modelPoolApi,
  useAuth,
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

  /* A domain is decided from the scene itself, so a scene handed over from a
     solved question opens in the matching runtime without the caller saying so. */
  const domain: SupportedSceneDomain | 'unsupported' =
    scene === undefined ? 'magnetic' : domainOfScene(scene)

  /* Only an explicit scene handover replaces the runtime. Discrete write-backs
     update the saved revision while the same runtime and its clock stay alive. */
  const runtimeKey =
    scene === undefined ? 'lab-empty' : String(surfaceState.sceneGeneration ?? `${domain}:${String(scene.id)}:${scene.revision}`)
  const runtime = useMemo<WorkspaceRuntime | null>(
    () => buildWorkspaceRuntime(domain, scene, surfaceState.sceneRef?.originScene),
    /* Persisting an edit and opening the picker must not recreate this runtime. */
    [runtimeKey],
  )

  if (surface === 'home') return null
  /* 出卷专区 is a teacher workflow over the host REST surface, not a lab
     scene: it renders without the physics runtime and covers the composer. */
  if (surface === 'paper') {
    /* `useAuth` goes in so the surface can refuse itself to a student rather
       than mounting a studio whose every button would 403. The host refuses
       them anyway — this is about not offering a room they cannot use. */
    return paperApi === undefined
      ? null
      : (
        <PaperWorkspace
          api={paperApi}
          t={t}
          useAuth={useAuth}
          useSessions={useSessions}
          useWorkspaces={useWorkspaces}
        />
      )
  }
  /* 资源库 is a catalog surface like 学习记录: no physics runtime, it reads
     the curriculum catalog and hands actions off to the Lab / the tutor. */
  if (surface === 'library') {
    return (
      <LibraryWorkspace
        t={t}
        useLearningRecord={useLearningRecord}
        useSessions={useSessions}
        useWorkspaces={useWorkspaces}
        {...(openSurface === undefined ? {} : { openSurface })}
        {...(practiceQuestion === undefined ? {} : { practiceQuestion })}
        {...(paperApi === undefined ? {} : { paperApi })}
      />
    )
  }
  /* 管理后台 is role-gated twice: the sidebar only offers the entry to
     SCHOOL_ADMIN/SUPER_ADMIN and the host re-checks every admin call, so a
     missing role or api simply renders nothing actionable. */
  if (surface === 'notice') {
    if (noticeApi === undefined) return null
    return (
      <NoticeBoard
        api={noticeApi}
        context="/notice"
        t={t}
      />
    )
  }
  if (surface === 'admin') {
    if (adminApi === undefined) return null
    /* `useAuth` is a required prop — the old `useAuth === undefined` branch
       was unreachable, which the compiler flagged as a dead condition. */
    return (
      <AdminWorkspace
        api={adminApi}
        {...(paperApi === undefined ? {} : { paperApi })}
        {...(noticeApi === undefined ? {} : { noticeApi })}
        {...(modelPoolApi === undefined ? {} : { modelPoolApi })}
        useAuth={useAuth}
        t={t}
      />
    )
  }
  if (surface === 'record') {
    return (
      <LearningRecordWorkspace
        t={t}
        useLearningRecord={useLearningRecord}
        practiceQuestion={practiceQuestion}
        /* 重做实验: a lab attempt deep-links to a FRESH instance of the template
           that trains its topic — the same scene the picker would build. */
        openExperiment={(experimentId: string) => {
          const template = findExperimentTemplate(experimentId)
          if (template === undefined || template.comingSoon === true) return
          openSurface?.('lab', createExperimentSceneRef(template, t(template.label)))
        }}
        useSessions={useSessions}
        useWorkspaces={useWorkspaces}
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
              /* Subject colour + template artwork for the continue card. */
              domain: domainOfScene(resumable.scene),
              sceneId: resumable.sceneId,
              onResume: () => {
                openSurface?.('lab')
              },
            },
          })}
        {...(openBuilder === undefined
          ? {}
          : {
            onFreeBuild: () => {
              openBuilder(freeBuildRef())
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

  /* Teaching metadata (要点 cards, 实验指南) resolves through the stamped
     scene id — free builds and question hand-overs match no template and
     simply get no summary. */
  const sceneId = surfaceState.sceneRef?.sceneId
  const templateId = sceneId === undefined ? undefined : artTemplateIdOfSceneId(sceneId)
  const experimentMeta = templateId === undefined ? undefined : experimentMetaOf(templateId)

  return (
    <PhysicsWorkspace
      key={runtimeKey}
      runtime={runtime}
      {...(updateScene === undefined ? {} : { onSceneChange: updateScene })}
      t={t}
      {...(surfaceState.buildMode === true ? { buildMode: true } : {})}
      {...(openExperimentPicker === undefined ? {} : { onSwitchExperiment: openExperimentPicker })}
      {...(openSurface === undefined
        ? {}
        : {
          /* The cover slot returns null on 'home', so the transcript shows
             through — the lab scene stays resumable from 最近空间. */
          onReturnToChat: () => {
            openSurface('home')
          },
        })}
      {...(recordAttempt === undefined ? {} : { recordAttempt })}
      {...(experimentMeta === undefined ? {} : { experimentMeta })}
    />
  )
}

/**
 * The Lab handover for a free build: a real, solvable starter circuit.
 *
 * Opening on an empty grid would greet a student with a circuit that has no
 * solution before they have done anything, so the bench starts as the smallest
 * loop that reads — one they can immediately change, take apart and rebuild.
 */
const freeBuildRef = (): PhysicsSceneRef => ({
  sceneId: FREE_BUILD_SCENE_ID,
  scene: draftToScene(starterDraft(), { sceneId: FREE_BUILD_SCENE_ID }),
})
