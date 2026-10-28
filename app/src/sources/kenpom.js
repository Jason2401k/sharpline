// KenPom ratings from a CSV you export from your kenpom.com subscription (KenPom doesn't allow
// automated access). Drop it at data/kenpom.csv (or set KENPOM_CSV). Needed columns, matched by
// header name: Team, AdjEM, AdjO, AdjD, AdjT; Rk/Rank optional. The file is re-read when it changes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let cached = { file: null, mtime: 0, data: null };

export function kenpomPath() {
  return process.env.KENPOM_CSV || path.join(ROOT, 'data', 'kenpom.csv');
}

export function loadKenpom() {
  const file = kenpomPath();
  if (!fs.existsSync(file)) return null;
  const mtime = fs.statSync(file).mtimeMs;
  if (cached.file === file && cached.mtime === mtime) return cached.data;
  const data = parseKenpom(fs.readFileSync(file, 'utf8'));
  data.updated = new Date(mtime).toISOString();
  cached = { file, mtime, data };
  return data;
}

export function parseKenpom(text) {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  // Find the header row (KenPom exports sometimes start with a title line).
  const hi = rows.findIndex((r) => r.some((c) => /^team$/i.test(c.trim())) && r.some((c) => /adj\s*em|adjem|netrtg/i.test(c)));
  if (hi < 0) throw new Error('KenPom CSV needs a header row with Team and AdjEM columns');
  const head = rows[hi].map((c) => c.trim().toLowerCase().replace(/[^a-z]/g, ''));
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const ix = { team: col('team'), rank: col('rk', 'rank'), em: col('adjem', 'netrtg'), o: col('adjo', 'ortg'), d: col('adjd', 'drtg'), t: col('adjt', 'tempo') };
  for (const k of ['team', 'em', 'o', 'd', 't']) if (ix[k] < 0) throw new Error(`KenPom CSV is missing the ${k === 'em' ? 'AdjEM' : k === 'o' ? 'AdjO' : k === 'd' ? 'AdjD' : k === 't' ? 'AdjT' : 'Team'} column`);
  const teams = [];
  for (const r of rows.slice(hi + 1)) {
    const name = (r[ix.team] || '').replace(/\s*\d+$/, '').trim(); // strip tournament seed suffix
    const num = (i) => Number(String(r[i] ?? '').replace(/[+,]/g, ''));
    if (!name || !Number.isFinite(num(ix.em))) continue;
    teams.push({ name, rank: ix.rank >= 0 ? num(ix.rank) : null, adjEM: num(ix.em), adjO: num(ix.o), adjD: num(ix.d), adjT: num(ix.t) });
  }
  teams.forEach((t, i) => { if (!Number.isFinite(t.rank)) t.rank = i + 1; });
  const avg = (k) => teams.reduce((a, t) => a + t[k], 0) / (teams.length || 1);
  return { teams, avgEff: avg('adjO'), avgTempo: avg('adjT'), count: teams.length };
}

// KenPom uses short school names ("Connecticut", "St. John's"); ESPN uses location ("UConn").
const ALIAS = {
  uconn: 'connecticut', olemiss: 'mississippi', pitt: 'pittsburgh', umass: 'massachusetts', vcu: 'virginiacommonwealth',
  smu: 'southernmethodist', tcu: 'texaschristian', ucf: 'centralflorida', unlv: 'nevadalasvegas', lsu: 'louisianastate',
  byu: 'brighamyoung', usc: 'southerncalifornia', ncst: 'northcarolinast', miami: 'miamifl', utep: 'texaselpaso',
  appst: 'appalachianst', mcneese: 'mcneesest', olemissrebels: 'mississippi', ul: 'louisianalafayette',
};
const key = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\bstate\b/g, 'st').replace(/\bsaint\b/g, 'st').replace(/[^a-z0-9]/g, '');

export function findKenpom(kp, team) {
  if (!kp) return null;
  const byKey = kp._byKey || (kp._byKey = new Map(kp.teams.map((t) => [key(t.name), t])));
  for (const cand of [team.location, team.shortName, team.name]) {
    if (!cand) continue;
    const k = key(cand);
    const hit = byKey.get(k) || byKey.get(ALIAS[k]) || byKey.get(key(ALIAS[k] || ''));
    if (hit) return hit;
  }
  return null;
}

function parseCsv(text) {
  const out = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}
