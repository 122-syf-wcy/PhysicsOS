import type { WorkspaceFrame } from '@lab/physics/workspace-runtime.ts'
import type { WorkbenchInstanceSummary } from '@lab/physics/workbench-instance-runtime.ts'
import type { TimelineEvent } from '@lab/physics/scene-visual-model.ts'
import { LabError, object } from '../shared/protocol.ts'

export const MAX_TRANSFER_BYTES = 8 * 1024 * 1024
export const MAX_DISPLAY_POINTS = 4096
export const MAX_IN_FLIGHT_FRAMES = 1
export const MAX_PENDING_EVENTS = 4096
export interface WorkerTag { version: 1; generation: string; sceneId: string; revision: number }
export interface WorkerRequest extends WorkerTag { id: string; type: 'load' | 'action' | 'query' | 'visible' | 'presentation' | 'ack' | 'dispose'; payload: unknown; buffer?: ArrayBuffer }
export interface Occurrence { seq: number; event: TimelineEvent; sceneId: string; revision: number; cycle: number }
export type WireSummary = Omit<WorkbenchInstanceSummary, 'workspace'>
export interface FramePacket extends WorkerTag {
  type: 'frame'; serial: number; full: boolean; patch: unknown; buffer: ArrayBuffer; used: number
  summary?: WireSummary; events: Occurrence[]; sampleIndices: number[]; sentAt: number
}
export interface WorkerReply extends WorkerTag { type: 'reply' | 'error'; id: string; payload: unknown }
export type WorkerOutput = FramePacket | WorkerReply
interface Segment { __labF64: 'number' | 'xy' | 'tv'; offset: number; count: number }
interface Encoding { json: unknown; buffer: ArrayBuffer; used: number }

/** One owned transfer buffer. The main thread returns it only after decoding copied values. */
export class TransferPool {
  private available: ArrayBuffer | undefined
  recycle(buffer: ArrayBuffer): void { if (buffer.byteLength > 0 && buffer.byteLength <= MAX_TRANSFER_BYTES) this.available = buffer }
  take(bytes: number): ArrayBuffer {
    if (bytes > MAX_TRANSFER_BYTES) throw new LabError('FRAME_LIMIT', '画面缓冲超过上限，已暂停；原始计算数据没有截断。')
    const size = Math.max(1024, 2 ** Math.ceil(Math.log2(Math.max(1, bytes))))
    const buffer = this.available
    this.available = undefined
    return buffer !== undefined && buffer.byteLength >= size ? buffer : new ArrayBuffer(size)
  }
}
export function encodeData(value: unknown, pool: TransferPool): Encoding {
  const numbers: number[] = []
  const walk = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      let kind: Segment['__labF64'] | undefined
      if (item.length >= 8 && item.every(entry => typeof entry === 'number')) kind = 'number'
      else if (item.length >= 8 && item.every(entry => object(entry) && Object.keys(entry).length === 2 && typeof entry.x === 'number' && typeof entry.y === 'number')) kind = 'xy'
      else if (item.length >= 8 && item.every(entry => object(entry) && Object.keys(entry).length === 2 && typeof entry.t === 'number' && typeof entry.value === 'number')) kind = 'tv'
      if (kind !== undefined) {
        const offset = numbers.length
        for (const entry of item) {
          if (kind === 'number') numbers.push(entry as number)
          else { numbers.push(entry[kind === 'xy' ? 'x' : 't'], entry[kind === 'xy' ? 'y' : 'value']) }
        }
        if (numbers.length * 8 > MAX_TRANSFER_BYTES) throw new LabError('FRAME_LIMIT', '画面缓冲超过限制。')
        return { __labF64: kind, offset, count: item.length } satisfies Segment
      }
      return item.map(walk)
    }
    if (object(item)) {
      const output: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(item)) if (child !== undefined) output[key] = walk(child)
      return output
    }
    if (typeof item === 'function') throw new LabError('FRAME_BEHAVIOR', '画面不能传递函数。')
    return item
  }
  const json = walk(value)
  const buffer = pool.take(numbers.length * 8)
  new Float64Array(buffer).set(numbers)
  return { json, buffer, used: numbers.length }
}
export function decodeData(json: unknown, buffer: ArrayBuffer, used: number): unknown {
  if (!Number.isSafeInteger(used) || used < 0 || used * 8 > buffer.byteLength || buffer.byteLength > MAX_TRANSFER_BYTES) throw new LabError('FRAME_INVALID', '画面缓冲描述无效。')
  const numbers = new Float64Array(buffer, 0, used)
  let nodes = 0
  const walk = (item: unknown, depth: number): unknown => {
    if (++nodes > 500_000 || depth > 64) throw new LabError('FRAME_INVALID', '画面层级超过限制。')
    if (Array.isArray(item)) return item.map(child => walk(child, depth + 1))
    if (!object(item)) return item
    if ('__labF64' in item) {
      const { __labF64: kind, offset, count } = item
      const stride = kind === 'number' ? 1 : kind === 'xy' || kind === 'tv' ? 2 : 0
      if (!stride || !Number.isSafeInteger(offset) || !Number.isSafeInteger(count) || (offset as number) < 0 || (count as number) < 0
        || (offset as number) + (count as number) * stride > used) throw new LabError('FRAME_INVALID', '数值缓冲索引无效。')
      return Array.from({ length: count as number }, (_, index) => {
        const at = (offset as number) + index * stride
        return kind === 'number' ? numbers[at]! : kind === 'xy' ? { x: numbers[at]!, y: numbers[at + 1]! } : { t: numbers[at]!, value: numbers[at + 1]! }
      })
    }
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(item)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new LabError('FRAME_INVALID', '画面字段无效。')
      output[key] = walk(child, depth + 1)
    }
    return output
  }
  return walk(json, 0)
}

/** Display selection only. Full engine results/charts stay in the Worker for queries/CSV. */
export function sampleIndices(length: number, limit = MAX_DISPLAY_POINTS): number[] {
  if (length <= limit) return Array.from({ length }, (_, index) => index)
  return Array.from({ length: limit }, (_, index) => Math.round(index * (length - 1) / (limit - 1)))
}
export function displayFrame(input: WorkspaceFrame): { frame: WorkspaceFrame; indices: number[] } {
  const first = input.view.trajectories[0]
  let indices = sampleIndices(input.trajectoryTimes.length)
  let times = indices.map(index => input.trajectoryTimes[index]!)
  const groups = new Map<string, typeof input.view.trajectories[number][]>()
  for (const trajectory of input.view.trajectories) groups.set(trajectory.id, [...(groups.get(trajectory.id) ?? []), trajectory])
  const trajectories: typeof input.view.trajectories[number][] = []
  for (const [id, parts] of groups) {
    const ordered = [...parts.filter(part => part.kind === 'history'), ...parts.filter(part => part.kind === 'predicted')]
    const total = ordered.reduce((sum, part) => sum + part.points.length, 0)
    const chosen = sampleIndices(total)
    // Keep discontinuous split endpoints visible without touching authoritative event order.
    let offset = 0
    const retained = new Set(chosen)
    for (const part of ordered) { if (part.points.length) { retained.add(offset); retained.add(offset + part.points.length - 1) }; offset += part.points.length }
    const sorted = [...retained].sort((a, b) => a - b)
    offset = 0
    for (const part of ordered) {
      const start = offset
      trajectories.push({ ...part, points: sorted.filter(index => index >= start && index < start + part.points.length).map(index => part.points[index - start]!) })
      offset += part.points.length
    }
    if (id === first?.id && total === input.trajectoryTimes.length) { indices = sorted; times = sorted.map(index => input.trajectoryTimes[index]!) }
  }
  const view = { ...input.view, trajectories,
    ...(input.view.waveProfile === undefined ? {} : { waveProfile: { ...input.view.waveProfile,
      points: sampleIndices(input.view.waveProfile.points.length).map(index => input.view.waveProfile!.points[index]!) } }),
  }
  return { frame: { ...input, view, trajectoryTimes: times,
    charts: input.charts.map(chart => chart.points.length <= MAX_DISPLAY_POINTS ? chart : { ...chart,
      points: sampleIndices(chart.points.length).map(index => chart.points[index]!) }),
    table: input.table.rows.length <= 256 ? input.table : { ...input.table, rows: input.table.rows.slice(0, 256) },
  }, indices }
}
export function framePatch(next: WorkspaceFrame, previous?: WorkspaceFrame): { patch: Partial<WorkspaceFrame>; removed: string[] } {
  const patch: Partial<WorkspaceFrame> = {}
  const current = next as unknown as Record<string, unknown>
  const before = previous as unknown as Record<string, unknown> | undefined
  for (const [key, value] of Object.entries(current)) if (value !== before?.[key]) (patch as Record<string, unknown>)[key] = value
  return { patch, removed: before === undefined ? [] : Object.keys(before).filter(key => !(key in current)) }
}
