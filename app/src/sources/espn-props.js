// NFL player props from ESPN's public data:
//  - prop lines: DraftKings main lines from ESPN's odds feed (no prices are published, so -110 is
//    assumed on both sides);
//  - player game logs for this season;
//  - defense vs position, computed from every completed box score this season.

import { getJson } from './http.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl';
const TTL = { lines: 5 * 60 * 1000, stats: 6 * 60 * 60 * 1000 };
export const ASSUMED_ODDS = -110;

// ESPN prop type id -> our stat key. Main lines only (no milestones/alternates, no TD scorers).
export const PROP_TYPES = { 8: 'pass_yds', 9: 'completions', 10: 'pass_tds', 11: 'carries', 12: 'rush_yds', 13: 'rec_yds', 14: 'receptions' };
// Game-log / box-score stat names -> our stat keys.
const GAMELOG_STATS = { passingYards: 'pass_yds', completions: 'completions', passingTouchdowns: 'pass_tds', rushingAttempts: 'carries', rushingYards: 'rush_yds', receivingYards: 'rec_yds', receptions: 'receptions' };
const BOX = { passing: { completions: 'completions', passingYards: 'pass_yds', passingTouchdowns: 'pass_tds' }, rushing: { rushingAttempts: 'carries', rushingYards: 'rush_yds' }, receiving: { receptions: 'receptions', receivingYards: 'rec_yds' } };

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); }
  }));
  return out;
}

// Main prop lines for the given ESPN event ids. Duplicate over/under entries collapse to one.
export async function fetchPropLines(eventIds) {
  const out = [];
  await pool(eventIds, 4, async (id) => {
    const seen = new Set();
    for (let page = 1; page <= 4; page++) {
      const d = await getJson(`${CORE}/events/${id}/competitions/${id}/odds/100/propBets?lang=en&region=us&limit=1000&page=${page}`, { ttlMs: TTL.lines });
      for (const it of d.items || []) {
        const stat = PROP_TYPES[it.type?.id];
        const athleteId = it.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1];
        const line = it.current?.target?.value;
        if (!stat || !athleteId || line == null) continue;
        const key = `${athleteId}:${stat}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ eventId: String(id), athleteId, stat, line, open: it.open?.target?.value ?? line, updated: it.lastUpdated || null });
      }
      if (!d.pageCount || page >= d.pageCount) break;
    }
  });
  return out;
}

// athleteId -> { name, pos, team } for the given ESPN team ids.
export async function fetchRosters(teamIds) {
  const map = new Map();
  await pool([...new Set(teamIds)], 6, async (tid) => {
    const d = await getJson(`${SITE}/teams/${tid}/roster`, { ttlMs: TTL.stats });
    const abbr = d.team?.abbreviation;
    for (const group of d.athletes || []) for (const a of group.items || []) {
      map.set(String(a.id), { name: a.displayName || a.fullName, pos: a.position?.abbreviation || '', team: abbr, teamId: String(tid) });
    }
  });
  return map;
}

export async function fetchAllTeamIds() {
  const d = await getJson(`${SITE}/teams`, { ttlMs: TTL.stats });
  return (d.sports?.[0]?.leagues?.[0]?.teams || []).map((t) => String(t.team.id));
}

// This season's regular-season game log, most recent first: { logs: { stat: [..] }, games: [{ date, opp }] }.
export async function fetchGamelog(athleteId) {
  const d = await getJson(`${WEB}/athletes/${athleteId}/gamelog`, { ttlMs: TTL.stats });
  const names = d.names || [];
  const st = (d.seasonTypes || []).find((s) => /regular season/i.test(s.displayName || '')) || d.seasonTypes?.[0];
  const rows = (st?.categories || []).flatMap((c) => c.events || []);
  const games = rows.map((r) => {
    const meta = d.events?.[r.eventId] || {};
    const vals = {};
    names.forEach((n, i) => { if (GAMELOG_STATS[n] && !(GAMELOG_STATS[n] in vals)) vals[GAMELOG_STATS[n]] = Number(r.stats?.[i]); });
    return { eventId: r.eventId, date: meta.gameDate || '', opp: meta.opponent?.abbreviation || '', vals };
  }).filter((g) => g.date).sort((a, b) => b.date.localeCompare(a.date));
  const logs = {};
  for (const stat of new Set(Object.values(GAMELOG_STATS))) {
    const series = games.map((g) => g.vals[stat]).filter((v) => Number.isFinite(v));
    if (series.length === games.length && series.length) logs[stat] = series;
  }
  return { logs, games: games.map((g) => ({ date: g.date, opp: g.opp })) };
}

// Box-score stat lines by athlete for one game: Map(athleteId -> { stat: value }) plus team per athlete.
export function boxLines(summary) {
  const out = new Map();
  for (const team of summary?.boxscore?.players || []) {
    const abbr = team.team?.abbreviation;
    for (const cat of team.statistics || []) {
      const want = BOX[cat.name];
      if (!want) continue;
      const idx = Object.fromEntries((cat.keys || []).map((k, i) => [k, i]));
      // "completions/passingAttempts" comes as one combined key in passing.
      const combo = (cat.keys || []).findIndex((k) => k === 'completions/passingAttempts');
      for (const a of cat.athletes || []) {
        const id = String(a.athlete?.id);
        const row = out.get(id) || { team: abbr, stats: {} };
        for (const [k, stat] of Object.entries(want)) {
          let v = idx[k] != null ? a.stats?.[idx[k]] : undefined;
          if (k === 'completions' && v === undefined && combo >= 0) v = String(a.stats?.[combo] || '').split('/')[0];
          const n = Number(v);
          if (Number.isFinite(n)) row.stats[stat] = n;
        }
        out.set(id, row);
      }
    }
  }
  return out;
}

export const fetchSummary = (eventId) => getJson(`${SITE}/summary?event=${eventId}`, { ttlMs: TTL.stats });

// Defense vs position from every completed regular-season game so far.
// Returns { [defenseAbbr]: { 'POS:stat': { allowed, leagueAvg, rank, teams, oppName } } }.
export async function fetchDefenseVsPosition(positions, { maxWeek = 18 } = {}) {
  const weeks = await pool(Array.from({ length: maxWeek }, (_, i) => i + 1), 6, (w) => getJson(`${SITE}/scoreboard?seasontype=2&week=${w}`, { ttlMs: TTL.stats }));
  const done = [];
  const names = {};
  for (const wk of weeks) for (const ev of wk?.events || []) {
    const c = ev.competitions?.[0];
    if (!c?.status?.type?.completed) continue;
    for (const t of c.competitors) names[t.team.abbreviation] = t.team.displayName;
    done.push({ id: ev.id, teams: c.competitors.map((t) => t.team.abbreviation) });
  }
  const sums = {}; // defense -> key -> total
  const gamesPlayed = {};
  await pool(done, 8, async (g) => {
    const lines = boxLines(await fetchSummary(g.id));
    for (const [id, row] of lines) {
      const defense = g.teams.find((t) => t !== row.team);
      if (!defense) continue;
      const pos = positions.get(id)?.pos || (row.stats.pass_yds != null ? 'QB' : null);
      if (!['QB', 'RB', 'WR', 'TE'].includes(pos)) continue;
      const bucket = (sums[defense] ||= {});
      for (const [stat, v] of Object.entries(row.stats)) bucket[`${pos}:${stat}`] = (bucket[`${pos}:${stat}`] || 0) + v;
    }
    for (const t of g.teams) gamesPlayed[t] = (gamesPlayed[t] || 0) + 1;
  });

  const keys = new Set(Object.values(sums).flatMap((b) => Object.keys(b)));
  const teams = Object.keys(gamesPlayed);
  const result = Object.fromEntries(teams.map((t) => [t, {}]));
  for (const key of keys) {
    const per = teams.map((t) => ({ t, v: (sums[t]?.[key] || 0) / gamesPlayed[t] }));
    const avg = per.reduce((a, x) => a + x.v, 0) / per.length;
    if (!(avg > 0)) continue;
    per.sort((a, b) => a.v - b.v); // rank 1 = allows the least
    per.forEach((x, i) => { result[x.t][key] = { allowed: x.v, leagueAvg: avg, rank: i + 1, teams: per.length, oppName: names[x.t] || x.t }; });
  }
  return { dvp: result, gamesCounted: done.length };
}
