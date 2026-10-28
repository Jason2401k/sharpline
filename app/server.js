// SharpLine server: zero-dependency static file server + JSON API.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, '.env'));

const { SPORTS } = await import('./src/config.js');
const { getBoard, getPicks, getInjuries } = await import('./src/service.js');

const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const routes = {
  '/api/sports': async () => SPORTS,
  '/api/picks': getPicks,
  '/api/injuries': getInjuries,
  '/api/health': async () => ({ ok: true, oddsApi: Boolean(process.env.ODDS_API_KEY), liveInjuries: process.env.LIVE_INJURIES !== '0' }),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const m = url.pathname.match(/^\/api\/board\/([a-z]+)$/);
      const handler = m ? () => getBoard(m[1]) : routes[url.pathname];
      if (!handler) return send(res, 404, { error: 'Not found' });
      return send(res, 200, await handler());
    }
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return serveFile(res, path.join(PUBLIC, 'index.html'));
    }
    return serveFile(res, file);
  } catch (e) {
    console.error(e);
    send(res, e.status || 500, { error: e.message });
  }
});

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveFile(res, file) {
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
  console.log(`SharpLine running at http://localhost:${PORT}`);
  console.log(process.env.ODDS_API_KEY ? 'Odds API: live lines enabled' : 'Odds API: no key, using demo lines (see .env.example)');
});
