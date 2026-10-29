import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPORTS } from '../src/config.js';
import { impliedProb, expectedValue, normCdf } from '../src/model/math.js';
import { projectProp } from '../src/model/props.js';
import { analyzeGame } from '../src/model/game.js';
import { publicSignals } from '../src/model/public.js';
import { fetchGames, fetchProps } from '../src/sources/odds-api.js';
import { fetchInjuries } from '../src/sources/espn.js';

process.env.LIVE_INJURIES = '0';
process.env.LIVE_ESPN = '0';
process.env.SHOW_DEMO = '1';
const nfl = SPORTS.find((s) => s.id === 'nfl');
const ncaab = SPORTS.find((s) => s.id === 'ncaab');

test('odds math', () => {
  assert.ok(Math.abs(impliedProb(-110) - 0.5238) < 1e-3);
  assert.ok(Math.abs(impliedProb(150) - 0.4) < 1e-9);
  assert.ok(Math.abs(expectedValue(0.5238, -110)) < 1e-3);
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
});

const player = { name: 'Test WR', team: 'AAA', pos: 'WR', logs: { rec_yds: [90, 85, 95, 100, 88, 70, 75, 80, 72, 78] } };
const game = { home: { abbr: 'AAA' }, away: { abbr: 'BBB' }, spread: { line: -3 }, total: { line: 44.5 } };
const prop = { stat: 'rec_yds', line: 70.5, overOdds: -110, underOdds: -110 };

test('prop model leans over when the player beats the line and the defense is soft', () => {
  const soft = { allowed: 170, leagueAvg: 150, rank: 30, teams: 32, oppName: 'BBB' };
  const m = projectProp({ prop, player, defense: soft, game, leagueTotal: 44.5 });
  assert.equal(m.lean, 'Over');
  assert.ok(m.projection > 84, `projection ${m.projection}`);
  assert.ok(m.edge > 0);
  assert.ok(m.prob < 0.9, 'market shrinkage keeps probability below 90%');
});

test('tough defense lowers the projection', () => {
  const soft = projectProp({ prop, player, defense: { allowed: 170, leagueAvg: 150, rank: 30, teams: 32, oppName: 'X' }, game, leagueTotal: 44.5 });
  const tough = projectProp({ prop, player, defense: { allowed: 125, leagueAvg: 150, rank: 2, teams: 32, oppName: 'X' }, game, leagueTotal: 44.5 });
  assert.ok(tough.projection < soft.projection);
  assert.ok(tough.factors.defense < 1 && soft.factors.defense > 1);
});

test('injury tag lowers confidence', () => {
  const healthy = projectProp({ prop, player, defense: null, game, leagueTotal: 44.5 });
  const hurt = projectProp({ prop, player, defense: null, game, leagueTotal: 44.5, injury: { status: 'Doubtful' } });
  assert.ok(hurt.confidence < healthy.confidence);
});

test('game model favors the better team and produces coaching notes', () => {
  const coachingFB = (o) => ({ playsPerGame: 63, passRate: 58, fourthDownAgg: 50, redZoneTd: 57, secondHalfDiff: 0, blitzRate: 28, defScheme: 'Two-high shell', ats: '4-4', atsHome: '2-2', atsAway: '2-2', ...o });
  const teams = {
    AAA: { name: 'Alpha', ratings: { off: 30, def: 17 }, coaching: coachingFB({ fourthDownAgg: 90, playsPerGame: 67 }) },
    BBB: { name: 'Beta', ratings: { off: 18, def: 26 }, coaching: coachingFB({ playsPerGame: 67 }) },
  };
  const a = analyzeGame(nfl, { ...game, spread: { line: -3, homeOdds: -110, awayOdds: -110 }, total: { line: 44.5, overOdds: -110, underOdds: -110 } }, teams);
  assert.ok(a.modelSpread < -3, 'home should be a bigger favorite than the book');
  assert.equal(a.spreadPick.side, 'home');
  assert.ok(a.notes.some((n) => n.title === 'Tempo'));
  assert.ok(a.notes.some((n) => n.title === '4th-down aggression'));
});

test('basketball: slower team dictates college tempo', () => {
  const c = (o) => ({ tempo: 68, threeRate: 39, defScheme: 'Pack line man', toRate: 16, atoPPP: 0.92, closeRecord: '2-1', benchMinutes: 30, ats: '5-5', atsHome: '3-2', atsAway: '2-3', ...o });
  const teams = { AAA: { name: 'Slow U', ratings: { off: 110, def: 95 }, coaching: c({ tempo: 62 }) }, BBB: { name: 'Fast St', ratings: { off: 110, def: 95 }, coaching: c({ tempo: 74 }) } };
  const a = analyzeGame(ncaab, { home: { abbr: 'AAA' }, away: { abbr: 'BBB' } }, teams);
  assert.ok(a.notes.some((n) => n.title === 'Tempo battle'));
  assert.ok(a.modelTotal < (68 * 2 * 1.025), 'total should reflect the slower pace');
});

test('public signals: sharp split and reverse line move', () => {
  const g = { home: { abbr: 'H' }, away: { abbr: 'A' }, spread: { line: -2.5, open: -3.5 }, total: { line: 44, open: 45 },
    public: { spread: { homeTickets: 72, homeMoney: 50 }, total: { overTickets: 70, overMoney: 68 } } };
  const s = publicSignals(g);
  assert.ok(s.some((x) => x.type === 'sharp' && x.side === 'A'));
  assert.ok(s.some((x) => x.type === 'rlm' && x.market === 'spread' && x.side === 'A'));
  assert.ok(s.some((x) => x.type === 'rlm' && x.market === 'total' && x.side === 'under'));
});

test('service builds boards and picks for every sport (demo mode)', async () => {
  const { getBoard, getPicks } = await import('../src/service.js');
  for (const s of SPORTS) {
    const b = await getBoard(s.id);
    assert.equal(b.sources.lines, 'demo');
    for (const g of b.games) assert.ok(g.analysis.available, `${s.id} ${g.id} has analysis`);
  }
  const p = await getPicks();
  assert.ok(p.value.length > 0 && p.locks.length > 0);
  for (const l of p.locks) assert.ok(l.prob >= 0.57 && ['A', 'B'].includes(l.grade));
});

// ---- live adapters against recorded response shapes (no network) ----
function mockFetch(routes) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const hit = Object.entries(routes).find(([k]) => String(url).includes(k));
    if (!hit) return { ok: false, status: 404, statusText: 'nf', json: async () => ({}) };
    return { ok: true, status: 200, json: async () => hit[1] };
  };
  return () => { globalThis.fetch = orig; };
}

test('Odds API adapter: consensus lines and props', async () => {
  const ev = {
    id: 'ev1', commence_time: '2026-11-01T18:00:00Z', home_team: 'Buffalo Bills', away_team: 'Kansas City Chiefs',
    bookmakers: [
      { key: 'draftkings', title: 'DraftKings', markets: [
        { key: 'spreads', outcomes: [{ name: 'Buffalo Bills', price: -110, point: -2.5 }, { name: 'Kansas City Chiefs', price: -110, point: 2.5 }] },
        { key: 'totals', outcomes: [{ name: 'Over', price: -110, point: 47.5 }, { name: 'Under', price: -110, point: 47.5 }] },
        { key: 'h2h', outcomes: [{ name: 'Buffalo Bills', price: -140 }, { name: 'Kansas City Chiefs', price: 120 }] }] },
      { key: 'fanduel', title: 'FanDuel', markets: [
        { key: 'spreads', outcomes: [{ name: 'Buffalo Bills', price: -105, point: -3 }, { name: 'Kansas City Chiefs', price: -115, point: 3 }] },
        { key: 'totals', outcomes: [{ name: 'Over', price: -112, point: 48 }, { name: 'Under', price: -108, point: 48 }] }] },
    ],
  };
  const props = { bookmakers: [{ key: 'fanduel', title: 'FanDuel', markets: [{ key: 'player_pass_yds', outcomes: [
    { name: 'Over', description: 'Josh Allen', price: -115, point: 245.5 }, { name: 'Under', description: 'Josh Allen', price: -105, point: 245.5 }] }] }] };
  const restore = mockFetch({ '/events/ev1/odds': props, '/odds?': [ev] });
  try {
    const games = await fetchGames(nfl, 'k', [{ abbr: 'BUF', name: 'Buffalo Bills' }, { abbr: 'KC', name: 'Kansas City Chiefs' }]);
    assert.equal(games[0].home.abbr, 'BUF');
    assert.equal(games[0].spread.line, -2.5); // median of -2.5 and -3 = -2.75 -> nearest half-point
    assert.equal(games[0].total.line, 48);
    assert.equal(games[0].moneyline.home, -140);
    const pr = await fetchProps(nfl, 'k', games, 3);
    assert.deepEqual([pr[0].player, pr[0].stat, pr[0].line, pr[0].book], ['Josh Allen', 'pass_yds', 245.5, 'FanDuel']);
  } finally { restore(); }
});

test('ESPN injuries adapter', async () => {
  const restore = mockFetch({ '/injuries': { injuries: [{ displayName: 'Buffalo Bills', injuries: [
    { status: 'Questionable', date: '2026-10-27T15:00Z', shortComment: 'Limited Wednesday', details: { type: 'Ankle' }, athlete: { displayName: 'Josh Allen', position: { abbreviation: 'QB' }, team: { abbreviation: 'BUF' } } }] }] } });
  try {
    const list = await fetchInjuries(SPORTS.find((s) => s.id === 'nba'));
    assert.deepEqual([list[0].player, list[0].team, list[0].status, list[0].note], ['Josh Allen', 'BUF', 'Questionable', 'Ankle — Limited Wednesday']);
  } finally { restore(); }
});

test('confidence score is 1-1000 and rises with probability and data quality', async () => {
  const { confidenceScore } = await import('../src/model/math.js');
  const s = (p, o) => confidenceScore(p, o);
  assert.ok(s(0.5) >= 1 && s(0.5) < 20);
  assert.ok(s(0.6) < s(0.65) && s(0.65) < s(0.75));
  assert.ok(s(1) <= 999, 'never reaches 1000');
  assert.ok(s(0.65, { sharp: true }) > s(0.65));
  assert.ok(s(0.65, { injury: { status: 'Questionable' } }) < s(0.65));
  assert.ok(s(0.65, { games: 3 }) < s(0.65, { games: 8 }));
});

test('live games never become picks', async () => {
  const { buildPicks } = await import('../src/model/picks.js');
  const pick = { label: 'H -3', side: 'home', odds: -110, prob: 0.7, edge: 0.18, ev: 0.3, grade: 'A', confidence: 0.9, score: 500 };
  const game = (live) => ({ id: live ? 'L' : 'P', start: '2026-11-01T18:00:00Z', live, home: { abbr: live ? 'LH' : 'PH' }, away: { abbr: live ? 'LA' : 'PA' }, signals: [],
    analysis: { available: true, lowSample: false, spreadPick: { ...pick }, totalPick: null, notes: [], summary: '' } });
  const boards = [{ sport: SPORTS.find((s) => s.id === 'nfl'), games: [game(true), game(false)], props: [] }];
  const p = buildPicks(boards);
  const all = [...p.value, ...p.locks];
  assert.ok(all.length > 0);
  assert.ok(all.every((c) => !c.matchup.includes('LH')), 'live game excluded');
});

test('stretched confidence scale: strong plays read high, toss-ups stay low', async () => {
  const { confidenceScore, STRONG_SCORE } = await import('../src/model/math.js');
  assert.ok(confidenceScore(0.55) < STRONG_SCORE, '55% is a toss-up');
  assert.ok(confidenceScore(0.6) >= STRONG_SCORE, '60% clears the bar');
  assert.ok(confidenceScore(0.7) > 750);
  assert.ok(confidenceScore(0.9) <= 999);
});

test('top 10: ranked by confidence, toss-ups and overpriced plays excluded', async () => {
  const { buildPicks } = await import('../src/model/picks.js');
  const mk = (id, score, edge, prob = 0.65) => ({ id, start: '2026-11-01T18:00:00Z', home: { abbr: `H${id}` }, away: { abbr: `A${id}` }, signals: [],
    analysis: { available: true, lowSample: false, notes: [], summary: '', totalPick: null, spreadPick: { label: `H${id} -3`, side: 'home', odds: -110, prob, edge, ev: edge, grade: 'A', confidence: 0.9, score } } });
  const p = buildPicks([{ sport: SPORTS.find((s) => s.id === 'nfl'), props: [], games: [mk(1, 700, 0.08), mk(2, 900, -0.01), mk(3, 450, 0.1), mk(4, 800, 0.05)] }]);
  assert.deepEqual(p.top.map((c) => c.score), [800, 700]);
});

test('prop guards: role changes, tiny lines and thin samples are flagged', async () => {
  const { projectProp } = await import('../src/model/props.js');
  const base = { stat: 'rush_yds', overOdds: -110, underOdds: -110 };
  const player = (logs) => ({ team: 'AAA', pos: 'RB', logs: { rush_yds: logs } });
  const g = { home: { abbr: 'AAA' }, away: { abbr: 'BBB' }, spread: { line: -3 }, total: { line: 44.5 } };
  const backup = projectProp({ prop: { ...base, line: 55.5 }, player: player([12, 8, 20, 15, 10, 9]), game: g, leagueTotal: 44.5 });
  assert.ok(backup.cautions.some((c) => /role/.test(c)), 'line far above history = role change');
  const tiny = projectProp({ prop: { ...base, line: 6.5 }, player: player([5, 8, 4, 7, 6]), game: g, leagueTotal: 44.5 });
  assert.ok(tiny.cautions.some((c) => /too small/.test(c)));
  const thin = projectProp({ prop: { ...base, line: 70.5 }, player: player([75, 66, 80]), game: g, leagueTotal: 44.5 });
  assert.ok(thin.cautions.some((c) => /3 games/.test(c)));
  const normal = projectProp({ prop: { ...base, line: 70.5 }, player: player([75, 66, 80, 71, 62, 90]), game: g, leagueTotal: 44.5 });
  assert.deepEqual(normal.cautions, []);
});
