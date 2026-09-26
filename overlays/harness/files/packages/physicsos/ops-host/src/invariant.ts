/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-ops-host`.
 *
 * The metrics cache is deliberately ephemeral and bounded. It is rebuilt from
 * authoritative probes on expiry and owns no durable business record.
 */

const PACKAGE_NAME = '@deepseek-ai/dsh-ops-host'

export const name = 'ops-host-invariant'
export const inject = ['invariants']

interface InvariantContext {
  readonly invariants: {
    register(
      packageName: string,
      install: (ctx: unknown, fail: (message: string) => void) => void,
    ): () => void
  }
}

const install = (): void => {}

export const apply = (ctx: InvariantContext): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
