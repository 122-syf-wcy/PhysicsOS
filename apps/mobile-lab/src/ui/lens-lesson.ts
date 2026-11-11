import { lensParameter } from '@lab/client/experiments/lens-bench.ts'
import type { WorkspaceFrame } from '@lab/physics/workspace-runtime.ts'
import { LabError } from '../shared/protocol.ts'

export const LENS_PRESETS = [
  { id: 'camera', factor: 3, label: '照相机', condition: 'u = 3f' },
  { id: 'equal', factor: 2, label: '等大成像', condition: 'u = 2f' },
  { id: 'projector', factor: 1.5, label: '投影仪', condition: 'u = 1.5f' },
  { id: 'focus', factor: 1, label: '焦点', condition: 'u = f' },
  { id: 'magnifier', factor: 0.5, label: '放大镜', condition: 'u = 0.5f' },
] as const

/** Shared dedicated bench assumptions; other optical scenes retain their general renderer. */
export function convexLensLesson(frame: WorkspaceFrame): boolean {
  return frame.domain === 'optics' && frame.view.opticalElements?.length === 1 &&
    frame.view.opticalElements[0]?.kind === 'thin_lens' && frame.view.opticalElements[0].at.x === 0 &&
    frame.view.opticalObjects?.length === 1 && frame.view.opticalScreens?.length === 1 && lensParameter(frame, 'focal-length') > 0
}

/** Presets only position a control. Image distances and light paths are never solved here. */
export function lensPresetDistance(frame: WorkspaceFrame, preset: string): number {
  const choice = LENS_PRESETS.find(item => item.id === preset)
  if (!convexLensLesson(frame) || choice === undefined) throw new LabError('LENS_PRESET_INVALID', '当前场景不支持这个透镜探究条件。')
  const value = lensParameter(frame, 'focal-length') * choice.factor
  if (!Number.isFinite(value) || value <= 0) throw new LabError('LENS_PRESET_INVALID', '物距无效；原场景未修改。')
  return value
}
