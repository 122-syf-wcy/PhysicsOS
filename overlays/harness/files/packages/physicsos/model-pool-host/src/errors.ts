/**
 * The failure envelope every model-pool surface answers with.
 *
 * One class for the host, the proxy, and the store: the admin API turns it
 * into `{ error: { code, message } }` with the status it carries, and the
 * OpenAI-compatible proxy reuses the same code in its own error envelope so a
 * deployment can grep one vocabulary across both.
 */
export class PoolError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'PoolError'
  }
}
