import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(); const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname.replace(/^\/eiken-vocabulary(?=\/|$)/, '') || '/';
    const file = path.resolve(root, '.' + (relative.endsWith('/') ? relative + 'index.html' : relative));
    if (!file.startsWith(root + path.sep) || relative.split('/').some(p => p.startsWith('.'))) { res.writeHead(403); return res.end(); }
    const content = await readFile(file); res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`WORD RECALL http://127.0.0.1:${port}/eiken-vocabulary/`));
