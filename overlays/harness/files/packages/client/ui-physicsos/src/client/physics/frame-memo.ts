/**
 * Frame-path memoization for workspace runtimes.
 *
 * `advance()` runs on every animation frame and returns a whole
 * `WorkspaceSnapshot`. Most of that snapshot — scene tree, charts, data table,
 * derivation, verification, timeline events, trajectory times — is a pure
 * function of the simulation (and therefore of the scene revision), not of the
 * playhead. Rebuilding it per frame costs milliseconds on long runs (a
 * collision run holds ~1 250 samples) and, because every rebuild is a fresh
 * object, defeats every `useMemo` downstream in the canvas. These helpers
 * build such panels once per simulation and hand back the same reference
 * until the simulation itself is replaced.
 */

/**
 * Cache a derivation on the identity of its key object. The key is the
 * simulation result a runtime already holds per revision; a new simulation
 * misses the cache, so a fact edit still rebuilds everything.
 * @param build - the pure derivation to cache.
 * @returns a function with the same signature that reuses results per key.
 */
export const memoizeOnIdentity = <K extends object, T>(
  build: (key: K) => T,
): ((key: K) => T) => {
  const cache = new WeakMap<K, T>()
  return (key: K): T => {
    if (cache.has(key)) return cache.get(key) as T
    const value = build(key)
    cache.set(key, value)
    return value
  }
}

/**
 * The same, for a derivation that takes the key plus extra frame-invariant
 * context (the scene, a particle id). Only the key decides cache identity;
 * the context must be a function of that key as well — true for a scene and
 * the simulation computed from it.
 * @param build - the pure derivation to cache.
 * @returns a function with the same signature that reuses results per key.
 */
export const memoizeOnIdentityWith = <K extends object, C, T>(
  build: (key: K, context: C) => T,
): ((key: K, context: C) => T) => {
  const cache = new WeakMap<K, T>()
  return (key: K, context: C): T => {
    if (cache.has(key)) return cache.get(key) as T
    const value = build(key, context)
    cache.set(key, value)
    return value
  }
}
