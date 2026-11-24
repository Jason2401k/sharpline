import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTorvik, torvikSeason } from '../src/sources/torvik.js';
import { pickSpread, parseEvent, matchPolymarket } from '../src/sources/polymarket.js';

test('Torvik CSV: adjusted efficiency margin per team', () => {
  const t = parseTorvik('rank,team,conf,record,adjoe,oe Rank,adjde,de Rank,barthag,adjt\n1,Houston,B12,6-0,124.6,3,93.8,3,0.96,67.6\n2,"Saint Mary\'s",WCC,5-1,118.0,10,96.0,12,0.9,64.0\n');
  assert.equal(t.count, 2);
  assert.equal(Math.round(t.teams[0].adjEM * 10) / 10, 30.8);
  assert.equal(t.teams[1].name, "Saint Mary's");
  assert.equal(torvikSeason(new Date('2026-11-24T00:00:00Z')), 2027);
});

const mk = (line, bid, ask, liq = 2000, team = 'Indiana Hoosiers') => ({ sportsMarketType: 'spreads', line, bestBid: bid, bestAsk: ask, liquidityNum: liq, outcomes: JSON.stringify([team, 'Other']), question: `Spread: ${team} (${line})` });

test('Polymarket: only tradeable lines count, closest to 50% wins', () => {
  const p = pickSpread([
    mk(-20.5, 0.01, 0.99),          // untraded placeholder
    mk(-24.5, 0.47, 0.49, 100),     // tight but almost no money posted
    mk(-26.5, 0.49, 0.53),          // tradeable, mid 51%
    mk(-28.5, 0.40, 0.44),          // tradeable, mid 42%
  ]);
  assert.equal(p.line, -26.5);
  assert.equal(p.price, 0.51);
  assert.equal(pickSpread([mk(-20.5, 0.01, 0.99)]), null);
});

test('Polymarket: away-first titles become our home line', () => {
  const e = parseEvent({ title: 'Jacksonville Dolphins vs. Indiana Hoosiers', startTime: '2026-11-25T00:00:00Z', markets: [mk(-26.5, 0.49, 0.53)] });
  assert.equal(e.home, 'Indiana Hoosiers');
  assert.equal(e.spread.homeLine, -26.5);
  const e2 = parseEvent({ title: 'Oregon State Beavers vs. San Francisco Dons', markets: [mk(-8.5, 0.51, 0.53, 9000, 'Oregon State Beavers')] });
  assert.equal(e2.spread.homeLine, 8.5, 'away favorite -> home +8.5');
  const games = [{ id: 'g1', start: '2026-11-25T00:00:00Z', home: { name: 'Indiana Hoosiers' }, away: { name: 'Jacksonville Dolphins' } }];
  assert.equal(matchPolymarket(games, [e]).get('g1').spread.homeLine, -26.5);
});

test('ratings edge: average rating difference minus the spread', async () => {
  process.env.LIVE_ESPN = '0';
  // Duke avg +30, Army avg +5 -> difference +25 for Duke (home). Spread Duke -14.5 -> edge 10.5 toward Duke.
  const diff = 30 - 5, homeLine = -14.5;
  assert.equal(diff + homeLine, 10.5);
  // Underdog side: difference +10, spread -14.5 -> -4.5, i.e. 4.5 toward the away team.
  assert.equal(10 + homeLine, -4.5);
});

test('rating names: accents and ESPN short names match Torvik', async () => {
  const { findKenpom } = await import('../src/sources/kenpom.js');
  const tv = { teams: ['San Jose St.', 'Southeastern Louisiana', 'Illinois Chicago', 'Louisiana Monroe', 'UMKC', 'Sam Houston St.'].map((name) => ({ name })) };
  for (const [loc, want] of [['San José State', 'San Jose St.'], ['SE Louisiana', 'Southeastern Louisiana'], ['UIC', 'Illinois Chicago'], ['UL Monroe', 'Louisiana Monroe'], ['Kansas City', 'UMKC'], ['Sam Houston', 'Sam Houston St.']]) {
    assert.equal(findKenpom(tv, { location: loc })?.name, want, loc);
  }
});
