import { cp, mkdir, rm } from 'node:fs/promises'
await rm('dist', { recursive: true, force: true })
await mkdir('dist/runtime', { recursive: true })
await cp('public', 'dist', { recursive: true })
await cp('src', 'dist/runtime', { recursive: true })
console.log('Built self-contained browser resources')
