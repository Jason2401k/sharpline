// Builds a static snapshot of the site into dist/: the frontend plus every API response
// pre-rendered as JSON. Host dist/ anywhere that serves static files (no Node needed).
// Usage: npm run build:static            -> dist/ (claude.ai artifact: page fragment)
//        npm run build:static -- --pages -> dist-pages/ (GitHub Pages / any host: full HTML document)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = process.argv.includes('--pages');
const OUT = path.join(ROOT, PAGES ? 'dist-pages' : 'dist');

const { SPORTS } = await import('../src/config.js');
const { getBoard, getPicks, getInjuries } = await import('../src/service.js');

const write = (rel, data) => {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data));
};

fs.mkdirSync(OUT, { recursive: true });
write('api/sports.json', SPORTS);
for (const s of SPORTS) write(`api/board/${s.id}.json`, await getBoard(s.id));
write('api/picks.json', await getPicks());
write('api/injuries.json', await getInjuries());

// Page: keep the <head> tags we need and the <body> content, and flag static mode.
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/\s*<meta charset[^>]*>|\s*<meta name="viewport"[^>]*>/g, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const flag = '<script>window.SHARPLINE_STATIC = true;</script>';
write('index.html', PAGES
  ? html.replace('</head>', `  ${flag}\n</head>`)
  : `${head.trim()}\n<meta name="claude:viewport-fit-sides" content="cover">\n${flag}\n${body.trim()}\n`);
for (const f of ['app.js', 'styles.css']) fs.copyFileSync(path.join(ROOT, 'public', f), path.join(OUT, f));

console.log(`Static snapshot written to ${path.relative(ROOT, OUT)}/`);
