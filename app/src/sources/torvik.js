// BartTorvik T-Rank ratings for college basketball: the public season CSV (barttorvik.com allows
// this file in robots.txt; its .json files are disallowed). Adjusted efficiencies are points per
// 100 possessions, opponent-adjusted, like KenPom's.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getText } from './http.js';

// barttorvik.com blocks GitHub's servers, so the refresh job falls back to a copy saved in the
// repo (data/torvik.csv). `npm run update:torvik` refreshes that copy from a normal connection.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const torvikCachePath = () => process.env.TORVIK_CSV || path.join(ROOT, 'data', 'torvik.csv');
export const torvikUrl = (now = new Date()) => `https://barttorvik.com/${torvikSeason(now)}_team_results.csv`;

// A season is named for the year it ends: November 2026 is the 2027 season.
export const torvikSeason = (now = new Date()) => now.getUTCFullYear() + (now.getUTCMonth() >= 6 ? 1 : 0);

// Live download first; if that fails, the saved copy (with its date).
export async function fetchTorvik(now = new Date()) {
  try {
    const csv = await getText(torvikUrl(now), { ttlMs: 6 * 60 * 60 * 1000 });
    return { ...parseTorvik(csv), from: 'live', asOf: now.toISOString() };
  } catch (e) {
    const file = torvikCachePath();
    if (!fs.existsSync(file)) throw e;
    const t = parseTorvik(fs.readFileSync(file, 'utf8'));
    return { ...t, from: 'saved copy', asOf: fs.readFileSync(`${file}.date`, 'utf8').trim() || null, liveError: e.message };
  }
}

export function parseTorvik(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const head = splitCsv(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (n) => head.indexOf(n);
  const ix = { rank: col('rank'), team: col('team'), o: col('adjoe'), d: col('adjde'), t: col('adjt') };
  for (const k of ['team', 'o', 'd']) if (ix[k] < 0) throw new Error(`Torvik CSV is missing the ${k === 'o' ? 'adjoe' : k === 'd' ? 'adjde' : 'team'} column`);
  const teams = [];
  for (const line of lines.slice(1)) {
    const r = splitCsv(line);
    const adjO = Number(r[ix.o]), adjD = Number(r[ix.d]);
    if (!r[ix.team] || !Number.isFinite(adjO) || !Number.isFinite(adjD)) continue;
    teams.push({ name: r[ix.team].trim(), rank: Number(r[ix.rank]) || null, adjO, adjD, adjEM: adjO - adjD, adjT: ix.t >= 0 ? Number(r[ix.t]) : null });
  }
  return { teams, count: teams.length };
}

function splitCsv(line) {
  const out = []; let cell = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cell); cell = ''; }
    else cell += c;
  }
  out.push(cell);
  return out;
}
