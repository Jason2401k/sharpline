// Pick ledger: every spread/total pick scoring >= MIN_SCORE is logged before its game starts,
// then graded from ESPN final scores. The ledger is a JSON file committed to the repo by the
// refresh job, so the record survives rebuilds. Entries freeze once their game starts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJson } from '../sources/http.js';
import { profitPerUnit, STRONG_SCORE } from '../model/math.js';
import { boxLines } from '../sources/espn-props.js';

export const MIN_SCORE = STRONG_SCORE; // same cutoff as the old 250 on the original scale
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const VOID_AFTER_MS = 4 * 86400000; // postponed/cancelled games are voided after 4 days

export const ledgerPath = () => process.env.LEDGER_PATH || path.join(ROOT, 'data', 'pick-ledger.json');

export function loadLedger(file = ledgerPath()) {
  if (!fs.existsSync(file)) return { version: 1, started: new Date().toISOString(), minScore: MIN_SCORE, picks: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveLedger(ledger, file = ledgerPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  ledger.picks.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  fs.writeFileSync(file, `${JSON.stringify(ledger, null, 1)}\n`);
}

// Log (or update) qualifying picks from the current boards. A pending pick whose game hasn't
// started is replaced by the latest pre-game version; if it no longer qualifies it's removed.
export function recordPicks(ledger, boards, now = new Date()) {
  const byId = new Map(ledger.picks.map((p) => [p.id, p]));
  const t = now.getTime();
  let added = 0, updated = 0, removed = 0;
  for (const b of boards) {
    for (const g of b.games) {
      if (!String(g.id).startsWith('espn-') || g.live || Date.parse(g.start) <= t) continue;
      const a = g.analysis;
      for (const market of ['spread', 'total']) {
        const id = `${g.id}:${market}`;
        const existing = byId.get(id);
        const pick = market === 'spread' ? a?.spreadPick : a?.totalPick;
        const ok = a?.available && !a.lowSample && pick && pick.score >= MIN_SCORE;
        if (!ok) {
          if (existing?.status === 'pending') { byId.delete(id); removed++; }
          continue;
        }
        const entry = {
          id, eventId: g.id.slice(5), sport: b.sport.id, sportName: b.sport.short, espn: b.sport.espn, market,
          start: g.start, matchup: `${g.away.abbr} @ ${g.home.abbr}`, home: g.home.abbr, away: g.away.abbr,
          label: pick.label, side: pick.side,
          line: market === 'spread' ? (pick.side === 'home' ? g.spread.line : -g.spread.line) : g.total.line,
          odds: pick.odds, prob: pick.prob, rawProb: pick.rawProb ?? pick.prob, edge: pick.edge, score: pick.score,
          book: g.book || null,
          factors: {
            sharp: (g.signals || []).some((s) => s.market === market && (market === 'total' ? s.side === pick.side : s.side === g[pick.side]?.abbr)),
            notes: (a.notes || []).filter((n) => n.impact === market || n.impact === 'variance').map((n) => n.title),
          },
          recordedAt: existing?.recordedAt || now.toISOString(), updatedAt: now.toISOString(), status: 'pending',
        };
        if (existing && existing.status !== 'pending') continue; // never rewrite a graded pick
        byId.set(id, entry);
        existing ? updated++ : added++;
      }
    }
    // Player props, same rules: logged before kickoff while they score MIN_SCORE+.
    for (const pr of b.props || []) {
      const g = b.games.find((x) => x.id === pr.gameId);
      if (!g || !String(g.id).startsWith('espn-') || !pr.playerId) continue;
      if (g.live || Date.parse(g.start) <= t) continue;
      const id = `${g.id}:prop:${pr.playerId}:${pr.stat}`;
      const existing = byId.get(id);
      const m = pr.model;
      if (!m || m.score < MIN_SCORE) {
        if (existing?.status === 'pending') { byId.delete(id); removed++; }
        continue;
      }
      if (existing && existing.status !== 'pending') continue;
      byId.set(id, {
        id, eventId: g.id.slice(5), sport: b.sport.id, sportName: b.sport.short, espn: b.sport.espn, market: 'prop',
        start: g.start, matchup: `${g.away.abbr} @ ${g.home.abbr}`, home: g.home.abbr, away: g.away.abbr,
        label: `${pr.player} ${m.lean} ${pr.line} ${pr.statLabel}`, side: m.lean.toLowerCase(), line: pr.line,
        athleteId: pr.playerId, player: pr.player, stat: pr.stat, statLabel: pr.statLabel,
        odds: m.odds, prob: m.prob, rawProb: m.preCal ?? m.prob, edge: m.edge, score: m.score, book: pr.book || null,
        factors: { sharp: false, notes: m.dvp ? [`Defense rank ${m.dvp.rank}/${m.dvp.teams}`] : [] },
        recordedAt: existing?.recordedAt || now.toISOString(), updatedAt: now.toISOString(), status: 'pending',
      });
      existing ? updated++ : added++;
    }
  }
  ledger.picks = [...byId.values()];
  return { added, updated, removed };
}

// Grade pending picks whose games have started, using ESPN's game summary.
export async function gradePicks(ledger, now = new Date(), fetchJson = (u) => getJson(u, { ttlMs: 0 })) {
  let graded = 0;
  for (const p of ledger.picks) {
    if (p.status !== 'pending' || Date.parse(p.start) > now.getTime()) continue;
    let sum;
    try { sum = await fetchJson(`${SITE}/${p.espn}/summary?event=${p.eventId}`); } catch { continue; }
    const comp = sum?.header?.competitions?.[0];
    const type = comp?.status?.type || {};
    if (type.state !== 'post' || !type.completed) {
      if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED/i.test(type.name || '') && now.getTime() - Date.parse(p.start) > VOID_AFTER_MS) {
        Object.assign(p, { status: 'void', units: 0, gradedAt: now.toISOString() });
        graded++;
      }
      continue;
    }
    const score = (h) => Number(comp.competitors?.find((c) => c.homeAway === h)?.score);
    const home = score('home'), away = score('away');
    if (!Number.isFinite(home) || !Number.isFinite(away)) continue;
    p.final = { home, away };
    if (p.market === 'prop') {
      // Graded from the player's box-score line; a player who didn't record a stat line is void.
      const v = boxLines(sum).get(String(p.athleteId))?.stats?.[p.stat];
      if (!Number.isFinite(v)) {
        Object.assign(p, { status: 'void', units: 0, gradedAt: now.toISOString(), note: 'No stat line (did not play)' });
        graded++;
        continue;
      }
      p.actual = v;
    }
    p.status = gradeOne(p, home, away);
    p.units = p.status === 'win' ? round2(profitPerUnit(p.odds)) : p.status === 'loss' ? -1 : 0;
    p.gradedAt = now.toISOString();
    graded++;
  }
  return graded;
}

export function gradeOne(p, home, away) {
  let diff;
  if (p.market === 'prop') diff = p.side === 'over' ? p.actual - p.line : p.line - p.actual;
  else if (p.market === 'spread') diff = (p.side === 'home' ? home - away : away - home) + p.line;
  else diff = p.side === 'over' ? home + away - p.line : p.line - (home + away);
  return diff > 0 ? 'win' : diff < 0 ? 'loss' : 'push';
}

const round2 = (x) => Math.round(x * 100) / 100;
