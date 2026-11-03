// Compatibility command: never package a stale dist or skip author checks.
import { releasePackage } from './release.mjs'
try { await releasePackage() }
catch (error) { console.error(error.message); process.exitCode = 1 }
