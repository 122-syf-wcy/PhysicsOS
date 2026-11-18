import { VisualMaterialError, type VisualMaterialLimits, type VisualMaterialQuota, type VisualMaterialUsage } from './visual-material-contracts.ts'

export const emptyVisualMaterialUsage = (): VisualMaterialUsage => ({ bytes: 0, count: 0, operations: 0, activeCount: 0, stageBytes: 0 })
export function assertVisualMaterialQuota(quota: VisualMaterialQuota, limits: VisualMaterialLimits,
  addition: { readonly bytes?: number; readonly count?: number; readonly operations?: number; readonly activeCount?: number; readonly stageBytes?: number }): void {
  const bytes = addition.bytes ?? 0, count = addition.count ?? 0, operations = addition.operations ?? 0
  const active = addition.activeCount ?? 0, stage = addition.stageBytes ?? 0
  const fits = (used: number, added: number, maximum: number): boolean => Number.isSafeInteger(used + added) && used + added <= maximum
  if (!fits(quota.account.bytes, bytes, limits.maxAccountBytes) || !fits(quota.global.bytes, bytes, limits.maxGlobalBytes)
    || !fits(quota.account.count, count, limits.maxAccountCount) || !fits(quota.global.count, count, limits.maxGlobalCount)
    || !fits(quota.account.operations, operations, limits.maxAccountOperations) || !fits(quota.global.operations, operations, limits.maxGlobalOperations)) {
    throw new VisualMaterialError(429, 'RETENTION_QUOTA', 'Visual material retention quota is exhausted; existing images are not evicted.')
  }
  if (!fits(quota.account.activeCount, active, limits.maxAccountConcurrent) || !fits(quota.global.activeCount, active, limits.maxGlobalConcurrent)) {
    throw new VisualMaterialError(429, 'CONCURRENCY_QUOTA', 'Visual material publication concurrency is exhausted.')
  }
  if (!fits(quota.global.stageBytes, stage, limits.maxStageBytes)) {
    throw new VisualMaterialError(429, 'STAGING_QUOTA', 'Visual material staging quota is exhausted.')
  }
}
export function addVisualMaterialUsage(usage: VisualMaterialUsage,
  delta: Partial<VisualMaterialUsage>): VisualMaterialUsage {
  const updated = {
    bytes: usage.bytes + (delta.bytes ?? 0), count: usage.count + (delta.count ?? 0),
    operations: usage.operations + (delta.operations ?? 0), activeCount: usage.activeCount + (delta.activeCount ?? 0),
    stageBytes: usage.stageBytes + (delta.stageBytes ?? 0),
  }
  if (Object.values(updated).some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new VisualMaterialError(503, 'QUOTA_INTEGRITY', 'Visual material quota ledger is inconsistent.')
  }
  return updated
}
