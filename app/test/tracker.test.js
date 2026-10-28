import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeOne, recordPicks, gradePicks, MIN_SCORE } from '../src/tracker/ledger.js';
import { buildCalibration, summarize } from '../src/tracker/calibrate.js';
import { SPORTS } from '../src/config.js';

const nfl = SPORTS.find((s) => s.id === 'nfl');

test('grading spreads and totals, including pushes', () => {
  assert.equal(gradeOne({ market: 'spread', side: 'home', line: -3.5 }, 24, 20), 'win');
  assert.equal(gradeOne({ market: 'spread', side: 'home', line: -3 }, 23, 20), 'push');
  assert.equal(gradeOne({ market: 'spread', side: 'away', line: 3.5 }, 24, 20), 'loss');
  assert.equal(gradeOne({ market: 'spread', side: 'away', line: 7 }, 24, 20), 'win');
  assert.equal(gradeOne({ market: 'total', side: 'over', line: 44.5 }, 24, 21), 'win');
  assert.equal(gradeOne({ market: 'total', side: 'under', line: 45 }, 24, 21), 'push');
});

const mkBoard = (score, { live = false, start = '2026-11-01T18:00:00Z' } = {}) => ({
  sport: nfl,
  games: [{ id: 'espn-1', start, live, home: { abbr: 'BUF' }, away: { abbr: 'BAL' }, book: 'DraftKings', signals: [],
    spread: { line: -3.5 }, total: { line: 53.5 },
    analysis: { available: true, lowSample: false, notes: [{ title: 'Tempo', impact: 'total' }],
      spreadPick: { label: 'BAL +3.5', side: 'away', odds: -110, prob: 0.62, edge: 0.1, score },
      totalPick: { label: 'Under 53.5', side: 'under', odds: -110, prob: 0.55, edge: 0.03, score: 120 } } }],
});
const now = new Date('2026-10-28T12:00:00Z');

test('only pre-game picks scoring 250+ are logged, and they update until kickoff', () => {
  const ledger = { picks: [] };
  let r = recordPicks(ledger, [mkBoard(300)], now);
  assert.equal(r.added, 1);
  assert.equal(ledger.picks[0].id, 'espn-1:spread');
  assert.equal(ledger.picks[0].line, 3.5, 'away line stored from the pick side');
  assert.ok(MIN_SCORE === 250);
  r = recordPicks(ledger, [mkBoard(320)], now);
  assert.equal(r.updated, 1);
  assert.equal(ledger.picks[0].score, 320);
  r = recordPicks(ledger, [mkBoard(200)], now);
  assert.equal(r.removed, 1, 'drops out if it no longer qualifies before kickoff');
  assert.equal(ledger.picks.length, 0);
  recordPicks(ledger, [mkBoard(300)], now);
  r = recordPicks(ledger, [mkBoard(100, { live: true })], now);
  assert.equal(ledger.picks.length, 1, 'frozen once the game is live');
});

test('grading from ESPN final scores, and units', async () => {
  const ledger = { picks: [] };
  recordPicks(ledger, [mkBoard(300)], now);
  const fetchJson = async () => ({ header: { competitions: [{ status: { type: { state: 'post', completed: true } }, competitors: [{ homeAway: 'home', score: '27' }, { homeAway: 'away', score: '24' }] }] } });
  const graded = await gradePicks(ledger, new Date('2026-11-02T12:00:00Z'), fetchJson);
  assert.equal(graded, 1);
  assert.equal(ledger.picks[0].status, 'win'); // BAL +3.5, lost by 3
  assert.ok(Math.abs(ledger.picks[0].units - 0.91) < 0.01);
  assert.deepEqual(ledger.picks[0].final, { home: 27, away: 24 });
});

const fake = (n, winRate, prob, sport = 'ncaaf', market = 'total') => Array.from({ length: n }, (_, i) => ({
  sport, market, prob, rawProb: prob, status: i < Math.round(n * winRate) ? 'win' : 'loss', units: 0, score: 300, start: '2026-11-01T00:00:00Z', id: `${sport}${market}${i}`,
}));

test('learning: overconfident groups get lowered, small samples barely move', () => {
  const big = buildCalibration({ picks: fake(120, 0.45, 0.62) });
  const p = big.adjust('ncaaf', 'total', 0.62);
  assert.ok(p < 0.56, `expected a clear cut, got ${p}`);
  const small = buildCalibration({ picks: fake(4, 0, 0.62) });
  const q = small.adjust('ncaaf', 'total', 0.62);
  assert.ok(q > 0.55 && q < 0.62, `4 losses should nudge, not crater: ${q}`);
  const none = buildCalibration(null);
  assert.equal(none.adjust('nfl', 'spread', 0.6).toFixed(6), '0.600000');
  const under = buildCalibration({ picks: fake(120, 0.72, 0.6, 'nfl', 'spread') });
  assert.ok(under.adjust('nfl', 'spread', 0.6) > 0.63, 'too-cautious groups get raised');
});

test('record summary', () => {
  const picks = [...fake(10, 0.6, 0.62), { ...fake(1, 0, 0.6)[0], status: 'push' }, { ...fake(1, 0, 0.6)[0], id: 'p', status: 'pending' }];
  picks.forEach((p) => { p.units = p.status === 'win' ? 0.91 : p.status === 'loss' ? -1 : 0; });
  const s = summarize({ started: '2026-10-28T00:00:00Z', picks }, { ncaaf: 'CFB' });
  assert.deepEqual([s.overall.wins, s.overall.losses, s.overall.pushes, s.pending], [6, 4, 1, 1]);
  assert.equal(s.overall.units, 1.46);
  assert.equal(s.bySport[0].label, 'CFB');
  assert.ok(s.buckets.some((b) => b.n === 10));
});
