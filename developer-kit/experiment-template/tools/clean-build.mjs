import { rm } from 'node:fs/promises'
// Only this template's generated dist tree. Do not serve or edit this as source.
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true })
