import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKenpom, findKenpom } from '../src/sources/kenpom.js';
import { mergeSbdSplits } from '../src/sources/sbd.js';
import { analyzeGame } from '../src/model/game.js';
import { SPORTS } from '../src/config.js';

const CSV = `2027 Pomeroy College Basketball Ratings
Rk,Team,Conf,W-L,AdjEM,AdjO,AdjO Rk,AdjD,AdjD Rk,AdjT,AdjT Rk
1,Duke,ACC,0-0,+30.10,124.5,2,94.4,3,70.1,90
2,Connecticut,BE,0-0,+28.40,123.0,4,94.6,4,64.2,330
3,"St. John's",BE,0-0,+22.00,116.0,30,94.0,2,69.0,120
4,Michigan St.,B10,0-0,+20.00,115.5,33,95.5,8,68.0,180
`;

test('KenPom CSV parses and matches ESPN names', () => {
  const kp = parseKenpom(CSV);
  assert.equal(kp.count, 4);
  assert.equal(kp.teams[0].adjEM, 30.1);
  assert.equal(findKenpom(kp, { location: 'UConn', name: 'UConn Huskies' })?.name, 'Connecticut');
  assert.equal(findKenpom(kp, { location: 'Michigan State', name: 'Michigan State Spartans' })?.name, 'Michigan St.');
  assert.equal(findKenpom(kp, { location: "St. John's", name: "St. John's Red Storm" })?.name, "St. John's");
  assert.equal(findKenpom(kp, { location: 'Nowhere', name: 'Nowhere Tech' }), null);
  assert.throws(() => parseKenpom('Team,Foo\nDuke,1'), /AdjEM/);
});

test('KenPom drives the college basketball model and lifts the last-season flag', () => {
  const kp = parseKenpom(CSV);
  const kpOf = (n) => ({ ...kp.teams.find((t) => t.name === n), avgEff: kp.avgEff, avgTempo: kp.avgTempo });
  const c = { tempo: 68, threeRate: 39, toRate: 16, ats: null, record: '0-0' };
  const sample = { games: 34, priorSeason: true };
  const teams = {
    DUKE: { name: 'Duke', ratings: { off: 120, def: 95 }, coaching: c, sample, kenpom: kpOf('Duke') },
    MSU: { name: 'Michigan State', ratings: { off: 112, def: 96 }, coaching: c, sample, kenpom: kpOf('Michigan St.') },
  };
  const a = analyzeGame(SPORTS.find((s) => s.id === 'ncaab'), { home: { abbr: 'DUKE' }, away: { abbr: 'MSU' } }, teams);
  assert.ok(a.modelSpread < -5, `Duke should be a clear favorite, got ${a.modelSpread}`);
  assert.equal(a.lowSample, false);
  assert.ok(a.notes.some((n) => n.title === 'KenPom'));
});

test('SportsBettingDime splits attach to the right game', () => {
  const games = [
    { start: '2026-10-30T00:15:00Z', home: { abbr: 'GB', name: 'Green Bay Packers' }, away: { abbr: 'CAR', name: 'Carolina Panthers' } },
    { start: '2026-11-01T18:00:00Z', home: { abbr: 'BUF', name: 'Buffalo Bills' }, away: { abbr: 'BAL', name: 'Baltimore Ravens' } },
  ];
  const rows = [{ start: '2026-10-30T00:15:00+00:00', home: { abbr: 'GB', name: 'Green Bay Packers', market: 'Green Bay' }, away: { abbr: 'CAR', name: 'Carolina Panthers', market: 'Carolina' },
    spread: { homeTickets: 70, homeMoney: 64 }, total: { overTickets: 41, overMoney: 41 }, moneyline: { homeTickets: 84, homeMoney: 69 } }];
  assert.equal(mergeSbdSplits(games, rows), 1);
  assert.equal(games[0].public.spread.homeTickets, 70);
  assert.equal(games[1].public, undefined);
});

test('SportsBettingDime rows with no bets yet carry no splits', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [{ scheduled: '2026-11-01T18:00:00+00:00',
    competitors: { home: { abbreviation: 'A', market: 'Aa', name: 'Ants' }, away: { abbreviation: 'B', market: 'Bb', name: 'Bees' } },
    bettingSplits: { spread: { home: { betsPercentage: 0, stakePercentage: 0 }, away: { betsPercentage: 0, stakePercentage: 0 } },
      total: { over: { betsPercentage: 62.4, stakePercentage: 55 }, under: { betsPercentage: 37.6, stakePercentage: 45 } } } }] }) });
  try {
    const { fetchSplits } = await import('../src/sources/sbd.js');
    const [row] = await fetchSplits(SPORTS.find((s) => s.id === 'nfl'));
    assert.equal(row.spread, null);
    assert.deepEqual(row.total, { overTickets: 62, overMoney: 55 });
  } finally { globalThis.fetch = orig; }
});

test('schedule keeps tonight\'s games after midnight UTC, with pre-game lines for live games', async () => {
  const { fetchSchedule } = await import('../src/sources/espn-live.js');
  const asked = [];
  const odds = { provider: { name: 'DraftKings' }, details: 'VGK -162', moneyline: { home: { close: { odds: '-162' } }, away: { close: { odds: '+136' } } } };
  const ev = (id, date, state, withOdds) => ({ id, date, competitions: [{ status: { type: { state, shortDetail: state === 'in' ? '11:24 - 2nd' : '' } }, competitors: [
    { homeAway: 'home', team: { id: '1', abbreviation: 'VGK', displayName: 'Vegas Golden Knights' } },
    { homeAway: 'away', team: { id: '2', abbreviation: 'OTT', displayName: 'Ottawa Senators' } }],
    odds: withOdds ? [odds] : undefined }] });
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/summary?event=live')) return { ok: true, json: async () => ({ pickcenter: [odds] }) };
    const d = u.match(/dates=(\d+)/)[1];
    asked.push(d);
    const events = d === '20261027' ? [ev('late', '2026-10-28T02:00Z', 'pre', true), ev('live', '2026-10-28T00:00Z', 'in', false), ev('done', '2026-10-27T23:00Z', 'post', false)] : [];
    return { ok: true, json: async () => ({ events }) };
  };
  try {
    const { games } = await fetchSchedule(SPORTS.find((s) => s.id === 'nhl'), { days: 2, now: new Date('2026-10-28T01:15:00Z') });
    assert.ok(asked.includes('20261027'), 'asks for the previous (Eastern) date');
    assert.deepEqual(games.map((g) => g.id), ['espn-live', 'espn-late'], 'keeps live and upcoming games, drops finished');
    assert.equal(games[0].live, true);
    assert.equal(games[0].status, '11:24 - 2nd');
    assert.equal(games[0].moneyline.home, -162, 'live game carries its pre-game line from the summary');
  } finally { globalThis.fetch = orig; }
});
