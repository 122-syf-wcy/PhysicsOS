import { canonicalBytes, canonicalStringify } from '@physicsos/physics-workbench/json'

/** Hash the canonical persisted representation, not a formatted view. */
export async function payloadDigest(value: unknown): Promise<string> {
  const bytes = new Uint8Array(canonicalBytes(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.buffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** One owner can reuse canonical hashes only for recursively frozen plain JSON values. */
export function createCanvasDigest(hash: (value: unknown) => Promise<string> = payloadDigest) {
  const immutable = new WeakSet<object>()
  const digests = new WeakMap<object, Promise<string>>()
  const canonical = new WeakMap<object, string>()
  const recursivelyFrozen = (value: unknown, ancestors = new Set<object>(), depth = 0): value is object => {
    if (depth > 512) return false
    if (value === null || typeof value !== 'object') return false
    if (immutable.has(value)) return true
    if (!Object.isFrozen(value) || ancestors.has(value) || Object.getOwnPropertySymbols(value).length > 0) return false
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) return false
    ancestors.add(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Array.isArray(value) && Object.keys(descriptors).length !== value.length + 1) {
      ancestors.delete(value)
      return false
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue
      if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
        ancestors.delete(value)
        return false
      }
      if (!('value' in descriptor) || !descriptor.enumerable || ['__proto__', 'constructor', 'prototype'].includes(key)) {
        ancestors.delete(value)
        return false
      }
      const child: unknown = descriptor.value
      if (child !== null && typeof child === 'object' && !recursivelyFrozen(child, ancestors, depth + 1)) {
        ancestors.delete(value)
        return false
      }
      if (typeof child === 'function' || typeof child === 'symbol' || typeof child === 'bigint' || child === undefined ||
        typeof child === 'number' && !Number.isFinite(child)) {
        ancestors.delete(value)
        return false
      }
    }
    ancestors.delete(value)
    immutable.add(value)
    return true
  }
  const stringify = (value: unknown): string => {
    if (!recursivelyFrozen(value)) return canonicalStringify(value)
    const cached = canonical.get(value)
    if (cached !== undefined) return cached
    const result = canonicalStringify(value)
    canonical.set(value, result)
    return result
  }
  const digest = (value: unknown): Promise<string> => {
    if (!recursivelyFrozen(value)) return hash(value)
    const cached = digests.get(value)
    if (cached !== undefined) return cached
    const result = hash(value)
    digests.set(value, result)
    void result.catch(() => { if (digests.get(value) === result) digests.delete(value) })
    return result
  }
  return { digest, stringify }
}

/** Independent document, node, and mutation identities never reuse scene IDs. */
export function canvasId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}
