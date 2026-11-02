import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

const root = resolve('.')
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', webp: 'image/webp', jpg: 'image/jpeg' }
const port = Number(process.env.PORT ?? 4175)
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://preview')
    const path = url.pathname === '/' ? '/preview/index.html' : decodeURIComponent(url.pathname)
    if (!path.startsWith('/dist/') && !path.startsWith('/preview/')) { response.writeHead(404).end(); return }
    const full = resolve(root, `.${path}`)
    if (!full.startsWith(root + sep)) { response.writeHead(403).end(); return }
    const data = await readFile(full)
    response.writeHead(200, { 'Content-Type': types[full.split('.').at(-1)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' })
    response.end(data)
  } catch { response.writeHead(404).end('Not found') }
}).listen(port, process.env.HOST ?? '127.0.0.1', () => console.log(`Independent experiment preview: http://127.0.0.1:${port}`))
