import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxLines, fetchDefenseVsPosition, fetchPropLines } from '../src/sources/espn-props.js';
import { recordPicks, gradePicks } from '../src/tracker/ledger.js';
import { SPORTS } from '../src/config.js';

const summary = (home, away, lines) => ({
  header: { competitions: [{ status: { type: { state: 'post', completed: true } }, competitors: [{ homeAway: 'home', score: String(home) }, { homeAway: 'away', score: String(away) }] }] },
  boxscore: { players: lines },
});
const team = (abbr, qb, rb, wr) => ({ team: { abbreviation: abbr }, statistics: [
  { name: 'passing', keys: ['completions/passingAttempts', 'passingYards', 'yardsPerPassAttempt', 'passingTouchdowns'], athletes: [{ athlete: { id: qb.id }, stats: [`${qb.cmp}/30`, String(qb.yds), '7.0', String(qb.td)] }] },
  { name: 'rushing', keys: ['rushingAttempts', 'rushingYards'], athletes: [{ athlete: { id: rb.id }, stats: [String(rb.car), String(rb.yds)] }] },
  { name: 'receiving', keys: ['receptions', 'receivingYards'], athletes: [{ athlete: { id: wr.id }, stats: [String(wr.rec), String(wr.yds)] }] },
] });

test('box score lines parse passing, rushing and receiving', () => {
  const s = summary(27, 20, [team('BUF', { id: 1, cmp: 22, yds: 260, td: 2 }, { id: 2, car: 18, yds: 90 }, { id: 3, rec: 7, yds: 95 })]);
  const m = boxLines(s);
  assert.deepEqual(m.get('1').stats, { completions: 22, pass_yds: 260, pass_tds: 2 });
  assert.deepEqual(m.get('2').stats, { carries: 18, rush_yds: 90 });
  assert.deepEqual(m.get('3').stats, { receptions: 7, rec_yds: 95 });
  assert.equal(m.get('3').team, 'BUF');
});

test('defense vs position: per-game allowed and ranks', async () => {
  const positions = new Map([['1', { pos: 'QB' }], ['2', { pos: 'RB' }], ['3', { pos: 'WR' }], ['11', { pos: 'QB' }], ['12', { pos: 'RB' }], ['13', { pos: 'WR' }]]);
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('scoreboard')) {
      const events = u.includes('week=1&') || u.endsWith('week=1') ? [{ id: 'g1', competitions: [{ status: { type: { completed: true } }, competitors: [{ team: { abbreviation: 'BUF', displayName: 'Buffalo Bills' } }, { team: { abbreviation: 'BAL', displayName: 'Baltimore Ravens' } }] }] }] : [];
      return { ok: true, json: async () => ({ events }) };
    }
    return { ok: true, json: async () => summary(27, 20, [team('BUF', { id: 1, cmp: 22, yds: 300, td: 2 }, { id: 2, car: 18, yds: 90 }, { id: 3, rec: 7, yds: 95 }), team('BAL', { id: 11, cmp: 20, yds: 200, td: 1 }, { id: 12, car: 25, yds: 140 }, { id: 13, rec: 5, yds: 60 })]) };
  };
  try {
    const { dvp, gamesCounted } = await fetchDefenseVsPosition(positions, { maxWeek: 2 });
    assert.equal(gamesCounted, 1);
    assert.equal(dvp.BAL['QB:pass_yds'].allowed, 300, 'BAL defense allowed BUF QB 300');
    assert.equal(dvp.BUF['QB:pass_yds'].allowed, 200);
    assert.equal(dvp.BUF['QB:pass_yds'].rank, 1, 'fewest allowed ranks 1');
    assert.equal(dvp.BAL['QB:pass_yds'].leagueAvg, 250);
  } finally { globalThis.fetch = orig; }
});

test('prop lines: main markets only, duplicates collapsed', async () => {
  const item = (type, ath, v) => ({ type: { id: String(type) }, athlete: { $ref: `http://x/athletes/${ath}?lang=en` }, current: { target: { value: v } }, open: { target: { value: v - 1 } } });
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ pageCount: 1, items: [item(8, 10, 238.5), item(8, 10, 238.5), item(194, 10, 250), item(31, 10, 0.5), item(13, 20, 64.5)] }) });
  try {
    const lines = await fetchPropLines(['401']);
    assert.deepEqual(lines.map((l) => `${l.athleteId}:${l.stat}:${l.line}`).sort(), ['10:pass_yds:238.5', '20:rec_yds:64.5']);
  } finally { globalThis.fetch = orig; }
});

test('props are logged pre-game and graded from the player box score', async () => {
  const nfl = SPORTS.find((s) => s.id === 'nfl');
  const game = { id: 'espn-77', start: '2026-11-01T18:00:00Z', live: false, home: { abbr: 'BUF' }, away: { abbr: 'BAL' }, analysis: { available: false } };
  const prop = (score, lean = 'Over') => ({ id: 'p', playerId: '3', player: 'Test WR', stat: 'rec_yds', statLabel: 'Receiving Yds', line: 64.5, gameId: 'espn-77', book: 'DraftKings',
    model: { lean, odds: -110, prob: 0.64, preCal: 0.64, edge: 0.12, score, dvp: { rank: 30, teams: 32 } } });
  const ledger = { picks: [] };
  let r = recordPicks(ledger, [{ sport: nfl, games: [game], props: [prop(450)] }], new Date('2026-10-30T00:00:00Z'));
  assert.equal(r.added, 0, 'toss-up props are not logged');
  r = recordPicks(ledger, [{ sport: nfl, games: [game], props: [prop(640)] }], new Date('2026-10-30T00:00:00Z'));
  assert.equal(r.added, 1);
  assert.equal(ledger.picks[0].market, 'prop');
  assert.equal(ledger.picks[0].side, 'over');
  const fetchJson = async () => summary(27, 20, [team('BUF', { id: 1, cmp: 22, yds: 260, td: 2 }, { id: 2, car: 18, yds: 90 }, { id: 3, rec: 7, yds: 95 })]);
  await gradePicks(ledger, new Date('2026-11-02T00:00:00Z'), fetchJson);
  assert.equal(ledger.picks[0].status, 'win');
  assert.equal(ledger.picks[0].actual, 95);

  const dnp = { picks: [] };
  recordPicks(dnp, [{ sport: nfl, games: [game], props: [{ ...prop(640), playerId: '99' }] }], new Date('2026-10-30T00:00:00Z'));
  await gradePicks(dnp, new Date('2026-11-02T00:00:00Z'), fetchJson);
  assert.equal(dnp.picks[0].status, 'void', 'no stat line means void, not a loss');
});
