// Builds a static snapshot of the site into dist/: the frontend plus every API response
// pre-rendered as JSON. Host dist/ anywhere that serves static files (no Node needed).
// Usage: npm run build:static            -> dist/ (claude.ai artifact: page fragment)
//        npm run build:static -- --pages -> dist-pages/ (GitHub Pages / any host: full HTML document)
// Add --record to update the pick ledger: grade finished picks, then log new qualifying picks.
// The refresh workflow passes it and commits data/pick-ledger.json afterwards.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = process.argv.includes('--pages');
const RECORD = process.argv.includes('--record');
const OUT = path.join(ROOT, PAGES ? 'dist-pages' : 'dist');

const { SPORTS } = await import('../src/config.js');
const { getBoard, getPicks, getInjuries, getRecord, resetBoards } = await import('../src/service.js');
const { loadLedger, saveLedger, gradePicks, recordPicks } = await import('../src/tracker/ledger.js');

const write = (rel, data) => {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data));
};

fs.mkdirSync(OUT, { recursive: true });

// 1. Grade finished picks first, so the boards below already use what was learned from them.
let ledger;
if (RECORD) {
  ledger = loadLedger();
  const graded = await gradePicks(ledger);
  saveLedger(ledger);
  resetBoards();
  console.log(`Ledger: graded ${graded} pick(s)`);
}

// 2. Boards with fresh data (calibrated by the ledger).
const boards = [];
write('api/sports.json', SPORTS);
for (const s of SPORTS) { const b = await getBoard(s.id); boards.push(b); write(`api/board/${s.id}.json`, b); }
write('api/picks.json', await getPicks());
write('api/injuries.json', await getInjuries());

// 3. Log new qualifying picks, then publish the record.
if (RECORD) {
  const r = recordPicks(ledger, boards);
  saveLedger(ledger);
  console.log(`Ledger: ${r.added} new, ${r.updated} updated, ${r.removed} dropped; ${ledger.picks.length} total`);
}
write('api/record.json', getRecord());
// Lets the site's Refresh button find the workflow to run (set by GitHub Actions).
write('api/site.json', { repo: process.env.GITHUB_REPOSITORY || null, workflow: 'refresh-site.yml', builtAt: new Date().toISOString() });

// Page: keep the <head> tags we need and the <body> content, and flag static mode.
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/\s*<meta charset[^>]*>|\s*<meta name="viewport"[^>]*>/g, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const flag = '<script>window.SHARPLINE_STATIC = true;</script>';
// Version stamp on the code files so browsers load new code after each refresh instead of a
// cached copy (GitHub Pages lets browsers cache files for 10 minutes).
const ver = Date.now().toString(36);
const stamp = (h) => h.replace('href="styles.css"', `href="styles.css?v=${ver}"`).replace('src="app.js"', `src="app.js?v=${ver}"`);
write('index.html', stamp(PAGES
  ? html.replace('</head>', `  ${flag}\n</head>`)
  : `${head.trim()}\n<meta name="claude:viewport-fit-sides" content="cover">\n${flag}\n${body.trim()}\n`));
for (const f of ['app.js', 'styles.css']) fs.copyFileSync(path.join(ROOT, 'public', f), path.join(OUT, f));

console.log(`Static snapshot written to ${path.relative(ROOT, OUT)}/`);
