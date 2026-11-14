/**
 * Revision fingerprint over every local desktop-account input.
 *
 * It sits beside the host spec that asserts it, because that spec belongs to
 * the Host aggregate: importing the package's `tsdown.config.ts` (or anything
 * under its `src/client`) would drag the Client aggregate's build setup into a
 * host type-check, which the two aggregates deliberately keep separate.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Keep the parent's immutable resource revision coupled to every local desktop input. */
export function desktopAccountFingerprint(root: string): string {
  const files = ['tsdown.config.ts', 'package.json']
  const visit = (relative: string): void => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`
      if (entry.isDirectory()) visit(name)
      else files.push(name)
    }
  }
  visit('src')
  const hash = createHash('sha256').update('desktop-account-inputs\0')
  for (const name of files.sort()) {
    const bytes = readFileSync(join(root, name))
    hash.update(`${Buffer.byteLength(name)}:${name}${bytes.length}:`).update(bytes)
  }
  return hash.digest('hex')
}
