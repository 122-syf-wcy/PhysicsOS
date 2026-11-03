import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { spawnSync } from 'node:child_process'
const built = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' })
if (built.status !== 0) throw new Error('Development build failed')
const root = process.cwd()
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' }
createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const name = pathname === '/' ? 'tools/preview.html' : pathname.slice(1)
  if (!/^(?:dist\/|tools\/preview\.(?:html|js)$)/.test(name) || name.split('/').some(part => part.startsWith('.')) || /[%\\]/.test(name)) { response.writeHead(404); response.end(); return }
  try { response.setHeader('content-type', mime[extname(name)] ?? 'application/octet-stream'); response.end(await readFile(resolve(root, name))) }
  catch { response.writeHead(404); response.end() }
}).listen(Number(process.env.PORT ?? 4173), '127.0.0.1', () => console.log(`Fixed platform-snapshot preview: http://127.0.0.1:${process.env.PORT ?? 4173}`))
