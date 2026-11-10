export type MetricName = 'compute' | 'encode' | 'decode' | 'draw' | 'command' | 'document'
export interface MetricSummary { count: number; last: number; max: number; p50: number; p95: number; p99: number }
export interface MetricSnapshot { version: 1; durationsMs: Partial<Record<MetricName, MetricSummary>>; counters: Record<string, number> }
/** Diagnostic windows are bounded. These are measured durations, never an FPS claim. */
export class Metrics {
  private readonly samples = new Map<MetricName, number[]>()
  private readonly counts = new Map<MetricName, number>()
  private readonly counters: Record<string, number> = {}
  duration(name: MetricName, milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return
    const values = this.samples.get(name) ?? []
    if (values.length === 240) values.shift()
    values.push(milliseconds)
    this.samples.set(name, values)
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1)
  }
  count(name: string, increment = 1): void { this.counters[name] = (this.counters[name] ?? 0) + increment }
  snapshot(): MetricSnapshot {
    const durationsMs: MetricSnapshot['durationsMs'] = {}
    for (const [name, values] of this.samples) {
      const sorted = [...values].sort((a, b) => a - b)
      const percentile = (p: number): number => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0
      durationsMs[name] = { count: this.counts.get(name) ?? 0, last: values.at(-1) ?? 0,
        max: sorted.at(-1) ?? 0, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) }
    }
    return { version: 1, durationsMs, counters: { ...this.counters } }
  }
}
