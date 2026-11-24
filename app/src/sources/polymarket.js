// Polymarket college basketball spreads (public Gamma API, no key).
//
// Polymarket lists many alternate spread lines per game, and most CBB lines are thinly traded or
// sit at an untraded 50/50 placeholder. A game's Polymarket spread is the line whose market is
// actually tradeable (a real bid and ask no more than MAX_GAP apart, with MIN_LIQUIDITY posted)
// and whose midpoint is closest to 50%. Games without such a market get no Polymarket line.

import { getJson } from './http.js';

const GAMMA = 'https://gamma-api.polymarket.com';
const CBB_SERIES = 10470;
const MAX_GAP = 0.10;
const MIN_LIQUIDITY = 500;
const MAX_FROM_EVEN = 0.12; // the chosen line must be priced 38-62%

const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };

export async function fetchPolymarketCbb(now = new Date()) {
  const events = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const page = await getJson(`${GAMMA}/events?series_id=${CBB_SERIES}&closed=false&limit=50&offset=${offset}&end_date_min=${now.toISOString()}`, { ttlMs: 5 * 60 * 1000 });
    if (!Array.isArray(page) || !page.length) break;
    events.push(...page);
    if (page.length < 50) break;
  }
  return events.map(parseEvent).filter(Boolean);
}

// Title is "Away vs. Home" (the series orders the away team first).
export function parseEvent(e) {
  const [away, home] = String(e.title || '').split(/\s+vs\.?\s+/i).map((s) => s?.trim());
  if (!away || !home) return null;
  const pick = pickSpread(e.markets || []);
  return { away, home, start: e.startTime || e.endDate || null, slug: e.slug, spread: pick ? { ...pick, homeLine: pick.team === home ? pick.line : pick.team === away ? -pick.line : null } : null };
}

export function pickSpread(markets) {
  let best = null;
  for (const m of markets) {
    if (m.sportsMarketType !== 'spreads' || m.closed || !Number.isFinite(Number(m.line))) continue;
    const bid = Number(m.bestBid), ask = Number(m.bestAsk);
    if (!(bid > 0) || !(ask > 0) || ask - bid > MAX_GAP || (Number(m.liquidityNum) || 0) < MIN_LIQUIDITY) continue;
    const mid = (bid + ask) / 2;
    const team = parse(m.outcomes)?.[0] || String(m.question || '').match(/Spread:\s*(.+?)\s*\(/)?.[1];
    if (!team || Math.abs(mid - 0.5) > MAX_FROM_EVEN) continue;
    if (!best || Math.abs(mid - 0.5) < Math.abs(best.price - 0.5)) best = { team, line: Number(m.line), price: Math.round(mid * 1000) / 1000, bid, ask, liquidity: Math.round(Number(m.liquidityNum) || 0) };
  }
  return best;
}

// Attach to our games by full team names (ESPN and Polymarket both use "School Mascot") and date.
export function matchPolymarket(games, events) {
  const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const out = new Map();
  for (const g of games) {
    const t = Date.parse(g.start);
    const ev = events.find((e) => norm(e.home) === norm(g.home.name) && norm(e.away) === norm(g.away.name) && (!e.start || Math.abs(Date.parse(e.start) - t) < 36 * 3600 * 1000))
      || events.find((e) => norm(e.home) === norm(g.away.name) && norm(e.away) === norm(g.home.name) && (!e.start || Math.abs(Date.parse(e.start) - t) < 36 * 3600 * 1000) && (e.flipped = true));
    if (!ev) continue;
    // If Polymarket lists the teams the other way round, flip the line to our home team.
    const homeLine = ev.spread?.homeLine == null ? null : ev.flipped ? -ev.spread.homeLine : ev.spread.homeLine;
    out.set(g.id, { listed: true, spread: ev.spread && homeLine != null ? { ...ev.spread, homeLine } : null, slug: ev.slug });
  }
  return out;
}
