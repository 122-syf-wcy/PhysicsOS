/**
 * Lab surface with no scene chosen — or with the chooser explicitly requested
 * over a running experiment (toolbar 切换实验, sidebar 新建).
 *
 * Both reach the experiment picker, the single chooser shared by every entry
 * point — there is one template list, not three. Picking a template builds a
 * real PhysicsScene and hands it to the one shared runtime → canvas path; this
 * screen is a chooser, not a workspace.
 */

import type { PhysicsScene } from '@physicsos/physics-scene'

import { ExperimentPicker, type ExperimentPickerProps } from './ExperimentPicker.tsx'
import type { PhysicsosKey } from './locales.ts'
import type { PhysicsSurfaceId } from './surface-store.ts'

type Translate = (key: PhysicsosKey) => string

/** Props for {@link LabEmptyState}. */
export interface LabEmptyStateProps {
  readonly t: Translate
  readonly openSurface: (
    id: PhysicsSurfaceId,
    sceneRef?: { sceneId: string; scene: PhysicsScene },
  ) => void
  /** Persisted recent scenes, for the picker's 继续上次实验 card. */
  readonly useRecentExperiments: ExperimentPickerProps['useRecentExperiments']
  /** The student's self-check history, for the picker's 为你推荐 rail. */
  readonly useLearningRecord: ExperimentPickerProps['useLearningRecord']
  /** Present when a scene is still active behind the chooser. */
  readonly resume?: ExperimentPickerProps['resume']
}

/**
 * Render the Lab chooser. Delegates to the shared {@link ExperimentPicker} so the
 * sidebar "新建", the Home quick action and the Lab empty state are one chooser.
 */
export function LabEmptyState({
  t, openSurface, useRecentExperiments, useLearningRecord, resume,
}: LabEmptyStateProps) {
  return (
    <ExperimentPicker
      t={t}
      openSurface={openSurface}
      useRecentExperiments={useRecentExperiments}
      useLearningRecord={useLearningRecord}
      {...(resume === undefined ? {} : { resume })}
    />
  )
}
