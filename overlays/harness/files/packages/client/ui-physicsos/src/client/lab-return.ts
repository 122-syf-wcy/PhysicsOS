/**
 * The turn's scene hygiene.
 *
 * The agent mirroring opens the Lab on every live scene revision so the student
 * watches the world being built, and it builds several worlds on the way: a
 * first attempt, a corrected one, a variant opened only to check a relation.
 * The ending turn closes that visit and keeps only the scene the answer belongs
 * to. Pure and framework-free: the caller supplies the surface actions, and this
 * decides what deserves to survive.
 */

/**
 * Which of one turn's scenes 最近空间 should drop once the turn is over.
 *
 * Solving a question builds scenes: a first attempt, a corrected one, a variant
 * used only to verify a relation. The reader wants the world the answer belongs
 * to, not the scaffolding — so every scene the agent opened this turn goes, the
 * last one stays, and the duplicates in the list (one scene recorded as both a
 * question and an experiment row) collapse with it. Scenes the reader opened
 * themselves are not in this list and are never touched.
 * @param recorded - scene ids the agent handed over this turn, in order.
 * @returns the ids to remove, deduplicated, oldest first.
 */
export const intermediatesToPrune = (recorded: readonly string[]): readonly string[] => {
  const final = recorded[recorded.length - 1]
  const seen = new Set<string>()
  const doomed: string[] = []
  for (const sceneId of recorded) {
    if (sceneId === final || seen.has(sceneId)) continue
    seen.add(sceneId)
    doomed.push(sceneId)
  }
  return doomed
}

/**
 * Report the edges between one Session's turns as they happen.
 *
 * The turn-tail seat cannot be the trigger for the turn's Lab hygiene: the Lab
 * replaces the Conversation surface, so the seat is unmounted exactly while the
 * Lab it should close is on screen. The Conversation binding's `openTurn`
 * publishes the open turn without an active View, including while no turn is
 * open, and this reduces that stream to the two edges the hygiene knows:
 * a turn opened (whatever the last one left is no longer scaffolding) and the
 * open turn closed (hand the Lab back to the reader).
 * @param read - the currently open turn number, undefined while none is open.
 * @param subscribe - notify on every publication of that value.
 * @param onTurnStart - a turn opened.
 * @param onTurnEnd - the open turn closed.
 * @returns detach function.
 */
export const watchTurnEdges = (
  read: () => number | undefined,
  subscribe: (listener: () => void) => () => void,
  onTurnStart: () => void,
  onTurnEnd: () => void,
): (() => void) => {
  let previous = read()
  return subscribe(() => {
    const next = read()
    if (next === previous) return
    const wasOpen = previous !== undefined
    previous = next
    if (!wasOpen) onTurnStart()
    else if (next === undefined) onTurnEnd()
  })
}
