// The Odds API (https://the-odds-api.com) adapter: game lines and player props.
// Consensus line = median across US books. "Open" = first line this server saw.

import { getJson } from './http.js';
import { PROP_MARKETS } from '../config.js';

const BASE = 'https://api.the-odds-api.com/v4';
const TTL = 5 * 60 * 1000;
const firstSeen = new Map();

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const roundOdds = (x) => (x == null ? null : Math.round(x / 5) * 5);

export function abbrFor(name, known) {
  const k = known.find((t) => name === t.name || name.startsWith(t.name + ' ') || t.name.startsWith(name));
  if (k) return k.abbr;
  const words = name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean);
  return (words.length > 1 ? words.slice(0, 3).map((w) => w[0]).join('') : words[0].slice(0, 4)).toUpperCase();
}

export async function fetchGames(sport, apiKey, knownTeams) {
  const url = `${BASE}/sports/${sport.oddsKey}/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=american&apiKey=${apiKey}`;
  const events = await getJson(url, { ttlMs: TTL });
  return events.map((ev) => {
    const home = { name: ev.home_team, abbr: abbrFor(ev.home_team, knownTeams) };
    const away = { name: ev.away_team, abbr: abbrFor(ev.away_team, knownTeams) };
    const pts = { spread: [], spreadHomePx: [], spreadAwayPx: [], total: [], overPx: [], underPx: [], mlHome: [], mlAway: [] };
    for (const bk of ev.bookmakers || []) {
      for (const m of bk.markets || []) {
        const o = (n) => m.outcomes.find((x) => x.name === n);
        if (m.key === 'spreads' && o(ev.home_team)) { pts.spread.push(o(ev.home_team).point); pts.spreadHomePx.push(o(ev.home_team).price); pts.spreadAwayPx.push(o(ev.away_team)?.price); }
        if (m.key === 'totals' && o('Over')) { pts.total.push(o('Over').point); pts.overPx.push(o('Over').price); pts.underPx.push(o('Under')?.price); }
        if (m.key === 'h2h') { pts.mlHome.push(o(ev.home_team)?.price); pts.mlAway.push(o(ev.away_team)?.price); }
      }
    }
    const game = { id: ev.id, start: ev.commence_time, home, away, books: (ev.bookmakers || []).length };
    const sp = median(pts.spread);
    if (sp != null) game.spread = { line: Math.round(sp * 2) / 2, homeOdds: roundOdds(median(pts.spreadHomePx)), awayOdds: roundOdds(median(pts.spreadAwayPx)) };
    const tot = median(pts.total);
    if (tot != null) game.total = { line: Math.round(tot * 2) / 2, overOdds: roundOdds(median(pts.overPx)), underOdds: roundOdds(median(pts.underPx)) };
    if (pts.mlHome.length) game.moneyline = { home: roundOdds(median(pts.mlHome)), away: roundOdds(median(pts.mlAway)) };

    const seen = firstSeen.get(ev.id) || { spread: game.spread?.line, total: game.total?.line };
    firstSeen.set(ev.id, seen);
    if (game.spread) game.spread.open = seen.spread ?? game.spread.line;
    if (game.total) game.total.open = seen.total ?? game.total.line;
    return game;
  });
}

// Player props for the first `limit` games (each event costs API credits).
export async function fetchProps(sport, apiKey, games, limit) {
  const markets = PROP_MARKETS[sport.kind];
  if (!markets) return [];
  const preferred = ['draftkings', 'fanduel', 'betmgm', 'williamhill_us'];
  const out = [];
  for (const g of games.slice(0, limit)) {
    const url = `${BASE}/sports/${sport.oddsKey}/events/${g.id}/odds?regions=us&markets=${Object.keys(markets).join(',')}&oddsFormat=american&apiKey=${apiKey}`;
    let ev;
    try { ev = await getJson(url, { ttlMs: TTL }); } catch { continue; }
    const books = [...(ev.bookmakers || [])].sort((a, b) => rank(a.key) - rank(b.key));
    const seen = new Set();
    for (const bk of books) {
      for (const m of bk.markets || []) {
        const stat = markets[m.key];
        const byPlayer = new Map();
        for (const o of m.outcomes) {
          const e = byPlayer.get(o.description) || {};
          e[o.name] = o;
          byPlayer.set(o.description, e);
        }
        for (const [player, e] of byPlayer) {
          const key = `${player}|${stat}`;
          if (seen.has(key) || !e.Over || !e.Under) continue;
          seen.add(key);
          out.push({ id: `${g.id}-${key}`, player, stat, line: e.Over.point, overOdds: e.Over.price, underOdds: e.Under.price, book: bk.title, gameId: g.id });
        }
      }
    }
  }
  return out;
  function rank(k) { const i = preferred.indexOf(k); return i === -1 ? 99 : i; }
}
