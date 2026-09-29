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
