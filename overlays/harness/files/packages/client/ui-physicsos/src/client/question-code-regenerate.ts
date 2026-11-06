/**
 * Direct 「重新生成」: ask the host to start the trusted code generation for a
 * saved scene instead of routing the request through a tutor turn.
 *
 * The host answers 202 with the `generating` snapshot as soon as the job has
 * been published to the session; the card then follows the `physicsScenes`
 * projection exactly as it does for a tool-started generation. `undefined`
 * means "this host has no direct route" (404/503), and the caller falls back
 * to the chat prompt; every other failure is final and surfaces its message.
 */

export type RegenerateOutcome = { ok: true } | { ok: false; error: string }

export const QUESTION_CODE_REGENERATE_PATH = '/physicsos/question-code/regenerate'

export interface DirectRegenerationOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly path?: string
}

/**
 * @param sessionId - the student's current learning session.
 * @param sceneId - the saved scene whose code experiment should be regenerated.
 * @param options - fetch override for tests.
 * @returns the outcome, or `undefined` when the host offers no direct route.
 */
export async function requestDirectRegeneration(
  sessionId: string,
  sceneId: string,
  options: DirectRegenerationOptions = {},
): Promise<RegenerateOutcome | undefined> {
  const call = options.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await call(options.path ?? QUESTION_CODE_REGENERATE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, sceneId }),
    })
  } catch {
    /* Network failure: the chat prompt goes through the session channel,
       which has its own reconnect story, so let it try. */
    return undefined
  }
  if (response.status === 404 || response.status === 503) return undefined
  if (response.ok) return { ok: true }
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } }
  return { ok: false, error: body.error?.message ?? `重新生成请求失败（HTTP ${response.status}）。` }
}
