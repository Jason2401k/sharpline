// Fails (exit 1) if a static snapshot didn't get live data, so CI never publishes an empty site
// over a good one when ESPN is down. Usage: node scripts/check-snapshot.js dist-pages
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'dist-pages';
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, 'api', f), 'utf8'));
const picks = read('picks.json');
const sports = read('sports.json');
const boards = sports.map((s) => read(`board/${s.id}.json`));
const live = boards.filter((b) => b.sources.lines === 'live');
const games = boards.reduce((n, b) => n + b.games.length, 0);

for (const b of boards) console.log(`${b.sport.short.padEnd(6)} lines:${b.sources.lines} games:${b.games.length} splits:${b.sources.public} injuries:${b.sources.injuries}${b.sources.errors.length ? ` errors: ${b.sources.errors.join(' | ')}` : ''}`);
console.log(`picks: ${picks.value.length} value, ${picks.locks.length} locks`);

if (!live.length || !picks.live) {
  console.error('No sport loaded live lines. Not publishing this snapshot.');
  process.exit(1);
}
if (picks.demo) {
  console.error('Snapshot contains sample data. Not publishing.');
  process.exit(1);
}
console.log(`OK: ${live.length}/${boards.length} sports live, ${games} games.`);
