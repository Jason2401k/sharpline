// SportsBettingDime public betting splits (bet % = tickets, stake % = money).
// This is the internal feed behind their public-betting-trends pages, not a documented API, so
// it can change without notice. Set LIVE_SBD=0 to turn it off.

import { getJson } from './http.js';

const BASE = 'https://www.sportsbettingdime.com/wp-json/adpt/v1';
// League keys as used by the srwc-public-betting-trends widget on each sport's page.
const LEAGUE = { nfl: 'nfl', ncaab: 'ncaamb', ncaaf: 'ncaafb', nba: 'nba', nhl: 'nhl', mlb: 'mlb' };
// Book ids the public page itself requests.
const BOOKS = 'sr:book:7612,sr:book:31520,sr:book:28901,sr:book:32784';

export const sbdSupports = (sport) => sport.id in LEAGUE;

export async function fetchSplits(sport) {
  const url = `${BASE}/${LEAGUE[sport.id]}-odds?books=${encodeURIComponent(BOOKS)}&format=us`;
  const d = await getJson(url, { ttlMs: 10 * 60 * 1000, headers: { 'user-agent': 'Mozilla/5.0 (SharpLine research)' } });
  const pct = (x) => (x == null ? null : Math.round(Number(x)));
  return (d.data || []).filter((g) => g.bettingSplits).map((g) => {
    const team = (c) => ({ abbr: c?.abbreviation || c?.alias, name: [c?.market, c?.name].filter(Boolean).join(' '), market: c?.market });
    const s = g.bettingSplits;
    // A market nobody has bet on yet comes back as 0% / 0% on both sides; treat that as no data.
    const has = (m, a, b) => m && m[a]?.betsPercentage != null && Number(m[a].betsPercentage) + Number(m[b]?.betsPercentage || 0) > 0;
    const split = (m, a, b) => (has(m, a, b) ? { tickets: pct(m[a].betsPercentage), money: pct(m[a].stakePercentage), otherTickets: pct(m[b]?.betsPercentage), otherMoney: pct(m[b]?.stakePercentage) } : null);
    const sp = split(s.spread, 'home', 'away'), tot = split(s.total, 'over', 'under'), ml = split(s.moneyline, 'home', 'away');
    return {
      start: g.scheduled,
      home: team(g.competitors?.home),
      away: team(g.competitors?.away),
      updated: s.spread?.updated || s.moneyline?.updated || s.total?.updated || null,
      spread: sp && { homeTickets: sp.tickets, homeMoney: sp.money },
      total: tot && { overTickets: tot.tickets, overMoney: tot.money },
      moneyline: ml && { homeTickets: ml.tickets, homeMoney: ml.money },
    };
  });
}

// Attach splits to our games by team name (or abbreviation) and start time within 36 hours.
export function mergeSbdSplits(games, rows) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Full name ("Green Bay Packers"), or same abbreviation plus same city/school prefix.
  const same = (ours, theirs) =>
    (theirs.name && norm(ours.name) === norm(theirs.name)) ||
    (theirs.abbr && theirs.market && norm(ours.abbr) === norm(theirs.abbr) && norm(ours.name).startsWith(norm(theirs.market)));
  let matched = 0;
  for (const g of games) {
    const t = Date.parse(g.start);
    const row = rows.find((r) => same(g.home, r.home) && same(g.away, r.away) && Math.abs(Date.parse(r.start) - t) < 36 * 3600 * 1000);
    if (!row || !row.spread && !row.total && !row.moneyline) continue;
    g.public = { spread: row.spread, total: row.total, moneyline: row.moneyline, updated: row.updated, source: 'SportsBettingDime' };
    matched++;
  }
  return matched;
}
