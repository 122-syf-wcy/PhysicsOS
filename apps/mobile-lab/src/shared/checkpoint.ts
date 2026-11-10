import type { PhysicsScene } from '@physicsos/physics-scene'
import type { InstanceSource } from '@physicsos/physics-workbench/types'
import type { CircuitDraft } from '@lab/physics/circuit-builder.ts'
import type { WorkbenchHistory } from '@lab/physics/workbench-instance-runtime.ts'
import { assertJson, exactKeys, fail, finite, object, text } from './protocol.ts'

export const PANELS = ['parameters', 'apparatus', 'data', 'guide', 'report'] as const
export type Panel = (typeof PANELS)[number]
export interface EditingState {
  instanceKey: string
  instanceEditRevision: number
  source: InstanceSource
  buildMode: 'inspect' | 'construct'
  draft?: CircuitDraft
  selectedIds: string[]
  observables: Record<string, boolean>
  viewport: { x: number; y: number; zoom: number }
  activePanel: Panel
}
export interface LabCheckpoint {
  version: 1
  scene: PhysicsScene
  originScene: PhysicsScene
  templateId?: string
  playback: { time: number; duration: number; rate: number; running: boolean }
  editing: EditingState
  history: WorkbenchHistory
}
export type PresentationState = Pick<EditingState, 'viewport' | 'activePanel'>
export const initialPresentation = (): PresentationState => ({ viewport: { x: 0, y: 0, zoom: 1 }, activePanel: 'parameters' })

/** Scene, source, history and draft semantics are decoded again by the shared Worker owner. */
export function readCheckpointEnvelope(input: unknown): LabCheckpoint {
  assertJson(input)
  if (!object(input)) fail('CHECKPOINT_INVALID', '存档格式无效。')
  exactKeys(input, ['version', 'scene', 'originScene', 'templateId', 'playback', 'editing', 'history'])
  if (input.version !== 1 || !object(input.scene) || !object(input.originScene) || !object(input.playback)
    || !object(input.editing) || !object(input.history)) fail('CHECKPOINT_INVALID', '存档缺少完整场景、来源、播放或编辑历史。')
  if (input.templateId !== undefined && !text(input.templateId)) fail('CHECKPOINT_INVALID', '实验目录标识无效。')
  const p = input.playback
  exactKeys(p, ['time', 'duration', 'rate', 'running'])
  if (!finite(p.time) || p.time < 0 || !finite(p.duration) || p.duration < 0
    || !finite(p.rate) || p.rate <= 0 || p.rate > 100 || typeof p.running !== 'boolean') fail('CHECKPOINT_INVALID', '存档的播放时钟无效。')
  const e = input.editing
  exactKeys(e, ['instanceKey', 'instanceEditRevision', 'source', 'buildMode', 'draft', 'selectedIds', 'observables', 'viewport', 'activePanel'])
  if (!text(e.instanceKey) || !Number.isSafeInteger(e.instanceEditRevision) || (e.instanceEditRevision as number) < 0
    || !object(e.source) || !['inspect', 'construct'].includes(String(e.buildMode)) || !object(e.observables)
    || !Array.isArray(e.selectedIds) || e.selectedIds.length > 256 || !e.selectedIds.every(id => text(id))
    || !Object.values(e.observables).every(value => typeof value === 'boolean')) fail('CHECKPOINT_INVALID', '存档的编辑状态无效。')
  validatePresentation(e)
  exactKeys(input.history, ['past', 'future'])
  if (!Array.isArray(input.history.past) || !Array.isArray(input.history.future)) fail('CHECKPOINT_INVALID', '存档的撤销重做历史无效。')
  return input as unknown as LabCheckpoint
}
export function validatePresentation(input: unknown): asserts input is PresentationState {
  if (!object(input) || !object(input.viewport) || !PANELS.includes(input.activePanel as Panel)) fail('CHECKPOINT_INVALID', '面板或画布视口无效。')
  const v = input.viewport
  exactKeys(v, ['x', 'y', 'zoom'])
  if (!finite(v.x) || !finite(v.y) || Math.abs(v.x) > 1e7 || Math.abs(v.y) > 1e7
    || !finite(v.zoom) || v.zoom < 0.25 || v.zoom > 8) fail('CHECKPOINT_INVALID', '画布缩放或位置超出范围。')
}
