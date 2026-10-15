import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {dirname, extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/player');
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex < 0 ? 8341 : process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Choose a port between 1024 and 65535.');
}
let exported;
try { exported = JSON.parse(await readFile(resolve(root, 'export.json'), 'utf8')); }
catch { throw new Error('Export the game first with _Games/voidwake/export.ps1.'); }
if (exported.renderer_mode !== 'official') {
  throw new Error('The launcher requires an official Unone player export.');
}
await stat(resolve(root, 'index.html'));

const types = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.luau':'text/plain; charset=utf-8',
  '.wasm':'application/wasm', '.png':'image/png', '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg', '.webp':'image/webp', '.woff':'font/woff',
  '.woff2':'font/woff2', '.ttf':'font/ttf', '.otf':'font/otf',
  '.wav':'audio/wav', '.mp3':'audio/mpeg', '.ogg':'audio/ogg',
};
const server = http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, {'Allow':'GET, HEAD'}).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
    if (path !== root && !path.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    if (!(await stat(path)).isFile()) { response.writeHead(404).end(); return; }
    const data = await readFile(path);
    response.writeHead(200, {
      'Content-Type':types[extname(path)] ?? 'application/octet-stream',
      'Content-Length':data.length,
      'Cache-Control':pathname.startsWith('/releases/') ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate',
      'X-Content-Type-Options':'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 400, {'Content-Type':'text/plain'});
    response.end('File unavailable.');
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`VOIDWAKE official Unone player: http://127.0.0.1:${port}/`));
