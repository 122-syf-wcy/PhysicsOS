import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PHYSICSOS_SITE_PREVIEW_PORT || 3096);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.gif':'image/gif','.txt':'text/plain; charset=utf-8'};
http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const url = new URL(req.url, 'http://localhost');
    let path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (path !== resolve(root) && !path.startsWith(resolve(root) + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, {'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`PhysicsOS website preview: http://127.0.0.1:${port}`));
