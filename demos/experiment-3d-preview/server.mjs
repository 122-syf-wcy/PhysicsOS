import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname } from 'node:path';

const local = name => fileURLToPath(new URL(name, import.meta.url));
const files = new Map([
  ['/', local('index.html')],
  ...['index.html', 'styles.css', 'chart.css', 'scene.css', 'app.mjs', 'simulation.mjs', 'chart.mjs', 'scene.mjs'].map(name => [`/${name}`, local(name)]),
  ['/shared/three.module.js', local('../experiment-directions/vendor/three.module.js')],
  ['/shared/three.core.js', local('../experiment-directions/vendor/three.core.js')],
  ['/shared/OrbitControls.js', local('../experiment-directions/vendor/OrbitControls.js')],
  ['/shared/lens-model.js', local('../experiment-directions/architecture/model.js')],
  ['/shared/THREE-LICENSE.txt', local('../experiment-directions/vendor/THREE-LICENSE.txt')],
]);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const port = Number(process.env.PHYSICSOS_3D_PREVIEW_PORT || 3098);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');

const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const file = files.get(path);
    if (!file) { response.writeHead(404).end('Not found'); return; }
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404).end('Not found');
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Preview port ${port} is already in use. Choose PHYSICSOS_3D_PREVIEW_PORT.` : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`PhysicsOS 3D preview: http://127.0.0.1:${port}`));
