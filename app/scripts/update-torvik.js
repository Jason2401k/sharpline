// Saves a copy of BartTorvik's season ratings to data/torvik.csv (+ .date). barttorvik.com
// blocks GitHub's servers, so the refresh job reads this copy when the live download fails.
// Usage: npm run update:torvik
import fs from 'node:fs';
import { getText } from '../src/sources/http.js';
import { parseTorvik, torvikUrl, torvikCachePath } from '../src/sources/torvik.js';

const csv = await getText(torvikUrl());
const { count } = parseTorvik(csv);
if (count < 300) throw new Error(`Only ${count} teams in the Torvik file; not saving it.`);
const file = torvikCachePath();
const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
fs.writeFileSync(file, csv);
fs.writeFileSync(`${file}.date`, `${new Date().toISOString()}\n`);
console.log(`Torvik: ${count} teams saved to ${file}${before === csv ? ' (unchanged)' : ''}`);
