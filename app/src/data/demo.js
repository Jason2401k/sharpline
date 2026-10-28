// Demo dataset. Deterministic (seeded) so the site looks the same on every load.
// Team names are real; every number (stats, lines, splits, coaching metrics, injuries) is
// SAMPLE DATA for showing how the site works. College players are fictional because
// college rosters turn over every year.

import { SPORT_PARAMS } from '../config.js';
import { normCdf, round } from '../model/math.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const between = (r, lo, hi) => lo + r() * (hi - lo);
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const half = (x) => Math.round(x * 2) / 2;
const pickOne = (r, xs) => xs[Math.floor(r() * xs.length)];

// ---------------------------------------------------------------------------------------------
// Teams: [abbr, name, offense, defense]. Football: points scored/allowed per game.
// Basketball: points per 100 possessions scored/allowed. Others: goals/runs per game.
const TEAMS = {
  nfl: [
    ['BAL', 'Baltimore Ravens', 27.5, 21.0], ['CIN', 'Cincinnati Bengals', 26.0, 25.5],
    ['KC', 'Kansas City Chiefs', 25.0, 19.0], ['BUF', 'Buffalo Bills', 28.0, 20.5],
    ['MIN', 'Minnesota Vikings', 22.0, 20.0], ['DET', 'Detroit Lions', 29.0, 22.0],
    ['PHI', 'Philadelphia Eagles', 25.5, 18.5], ['DAL', 'Dallas Cowboys', 24.0, 26.0],
    ['LAR', 'Los Angeles Rams', 24.5, 21.0], ['SF', 'San Francisco 49ers', 24.0, 21.5],
    ['WAS', 'Washington Commanders', 25.0, 23.0], ['ATL', 'Atlanta Falcons', 22.5, 24.0],
    ['GB', 'Green Bay Packers', 24.5, 19.5], ['CHI', 'Chicago Bears', 23.0, 22.5],
    ['LAC', 'Los Angeles Chargers', 22.0, 18.5], ['DEN', 'Denver Broncos', 23.0, 18.0],
  ],
  ncaab: [
    ['KU', 'Kansas', 114, 94], ['DUKE', 'Duke', 120, 93], ['UK', 'Kentucky', 116, 99],
    ['UCONN', 'UConn', 118, 96], ['HOU', 'Houston', 112, 88], ['ALA', 'Alabama', 121, 101],
    ['PUR', 'Purdue', 119, 98], ['GONZ', 'Gonzaga', 118, 97], ['UNC', 'North Carolina', 114, 98],
    ['MSU', 'Michigan State', 112, 94], ['ARIZ', 'Arizona', 117, 96], ['TENN', 'Tennessee', 111, 90],
    ['AUB', 'Auburn', 117, 96], ['FLA', 'Florida', 119, 95], ['ILL', 'Illinois', 116, 97], ['BAY', 'Baylor', 115, 99],
  ],
  nba: [
    ['DEN', 'Denver Nuggets', 119, 114], ['OKC', 'Oklahoma City Thunder', 119, 106],
    ['BOS', 'Boston Celtics', 116, 110], ['NYK', 'New York Knicks', 118, 112],
    ['SAS', 'San Antonio Spurs', 115, 111], ['MIN', 'Minnesota Timberwolves', 115, 110],
    ['DET', 'Detroit Pistons', 116, 110], ['CLE', 'Cleveland Cavaliers', 119, 111],
    ['LAL', 'Los Angeles Lakers', 116, 115], ['GSW', 'Golden State Warriors', 114, 112],
  ],
  ncaaf: [
    ['TEX', 'Texas', 34, 16], ['UGA', 'Georgia', 33, 17], ['OSU', 'Ohio State', 37, 12],
    ['PSU', 'Penn State', 32, 19], ['ORE', 'Oregon', 38, 17], ['USC', 'USC', 33, 24],
    ['LSU', 'LSU', 29, 20], ['ALA', 'Alabama', 32, 18], ['MICH', 'Michigan', 27, 17],
    ['IND', 'Indiana', 39, 15], ['MIA', 'Miami', 36, 20], ['CLEM', 'Clemson', 30, 22],
  ],
  nhl: [
    ['TOR', 'Toronto Maple Leafs', 3.3, 2.9], ['FLA', 'Florida Panthers', 3.2, 2.7],
    ['EDM', 'Edmonton Oilers', 3.4, 3.0], ['VGK', 'Vegas Golden Knights', 3.2, 2.8],
    ['NYR', 'New York Rangers', 3.0, 3.0], ['BOS', 'Boston Bruins', 2.9, 2.9],
    ['COL', 'Colorado Avalanche', 3.5, 2.7], ['DAL', 'Dallas Stars', 3.2, 2.6],
  ],
  epl: [
    ['ARS', 'Arsenal', 2.0, 0.8], ['CHE', 'Chelsea', 1.8, 1.1], ['LIV', 'Liverpool', 2.0, 1.1],
    ['MCI', 'Manchester City', 2.1, 1.0], ['TOT', 'Tottenham', 1.5, 1.4], ['MUN', 'Manchester United', 1.4, 1.3],
  ],
  mlb: [],
};

// Games: [away, home, ISO start (UTC)].
const GAMES = {
  nfl: [
    ['BAL', 'CIN', '2026-10-30T00:15:00Z'], ['GB', 'CHI', '2026-11-01T18:00:00Z'],
    ['WAS', 'ATL', '2026-11-01T18:00:00Z'], ['MIN', 'DET', '2026-11-01T18:00:00Z'],
    ['LAR', 'SF', '2026-11-01T21:05:00Z'], ['KC', 'BUF', '2026-11-01T21:25:00Z'],
    ['PHI', 'DAL', '2026-11-02T01:20:00Z'], ['LAC', 'DEN', '2026-11-03T01:15:00Z'],
  ],
  ncaab: [
    ['DUKE', 'KU', '2026-11-03T00:00:00Z'], ['UK', 'UCONN', '2026-11-03T02:00:00Z'],
    ['ALA', 'HOU', '2026-11-04T00:30:00Z'], ['PUR', 'GONZ', '2026-11-04T03:00:00Z'],
    ['UNC', 'MSU', '2026-11-05T00:00:00Z'], ['TENN', 'ARIZ', '2026-11-05T03:30:00Z'],
    ['AUB', 'FLA', '2026-11-06T00:00:00Z'], ['BAY', 'ILL', '2026-11-06T01:00:00Z'],
  ],
  nba: [
    ['DEN', 'OKC', '2026-10-28T23:30:00Z'], ['BOS', 'NYK', '2026-10-29T00:00:00Z'],
    ['SAS', 'MIN', '2026-10-29T01:00:00Z'], ['DET', 'CLE', '2026-10-29T23:00:00Z'],
    ['LAL', 'GSW', '2026-10-30T02:00:00Z'],
  ],
  ncaaf: [
    ['TEX', 'UGA', '2026-10-31T19:30:00Z'], ['OSU', 'PSU', '2026-10-31T16:00:00Z'],
    ['USC', 'ORE', '2026-10-31T23:30:00Z'], ['LSU', 'ALA', '2026-11-01T00:30:00Z'],
    ['IND', 'MICH', '2026-10-31T19:30:00Z'], ['MIA', 'CLEM', '2026-10-31T23:00:00Z'],
  ],
  nhl: [
    ['TOR', 'FLA', '2026-10-28T23:00:00Z'], ['EDM', 'VGK', '2026-10-29T02:00:00Z'],
    ['NYR', 'BOS', '2026-10-29T23:00:00Z'], ['COL', 'DAL', '2026-10-30T00:30:00Z'],
  ],
  epl: [
    ['CHE', 'ARS', '2026-10-31T15:00:00Z'], ['MCI', 'LIV', '2026-11-01T16:30:00Z'],
    ['MUN', 'TOT', '2026-11-01T14:00:00Z'],
  ],
  mlb: [],
};

// Players: [name, team, pos, { stat: average }]. Pro players are real names with SAMPLE stats.
const PLAYERS = {
  nfl: [
    ['Lamar Jackson', 'BAL', 'QB', { pass_yds: 228, rush_yds: 58 }], ['Derrick Henry', 'BAL', 'RB', { rush_yds: 98 }], ['Zay Flowers', 'BAL', 'WR', { rec_yds: 71, receptions: 5.4 }],
    ['Joe Burrow', 'CIN', 'QB', { pass_yds: 268, pass_tds: 2.1 }], ["Ja'Marr Chase", 'CIN', 'WR', { rec_yds: 96, receptions: 7.6 }], ['Tee Higgins', 'CIN', 'WR', { rec_yds: 64, receptions: 4.9 }],
    ['Jordan Love', 'GB', 'QB', { pass_yds: 241, pass_tds: 1.8 }], ['Josh Jacobs', 'GB', 'RB', { rush_yds: 84 }],
    ['Caleb Williams', 'CHI', 'QB', { pass_yds: 236, pass_tds: 1.5 }], ["D'Andre Swift", 'CHI', 'RB', { rush_yds: 66 }], ['Rome Odunze', 'CHI', 'WR', { rec_yds: 68, receptions: 4.8 }],
    ['Jayden Daniels', 'WAS', 'QB', { pass_yds: 239, rush_yds: 44 }], ['Terry McLaurin', 'WAS', 'WR', { rec_yds: 66, receptions: 4.7 }],
    ['Michael Penix Jr.', 'ATL', 'QB', { pass_yds: 248, pass_tds: 1.6 }], ['Bijan Robinson', 'ATL', 'RB', { rush_yds: 92, receptions: 3.9 }], ['Drake London', 'ATL', 'WR', { rec_yds: 81, receptions: 6.6 }],
    ['J.J. McCarthy', 'MIN', 'QB', { pass_yds: 221, pass_tds: 1.5 }], ['Justin Jefferson', 'MIN', 'WR', { rec_yds: 92, receptions: 6.4 }],
    ['Jared Goff', 'DET', 'QB', { pass_yds: 262, pass_tds: 2.0 }], ['Jahmyr Gibbs', 'DET', 'RB', { rush_yds: 89 }], ['Amon-Ra St. Brown', 'DET', 'WR', { rec_yds: 84, receptions: 7.4 }], ['Sam LaPorta', 'DET', 'TE', { rec_yds: 46, receptions: 4.1 }],
    ['Matthew Stafford', 'LAR', 'QB', { pass_yds: 251, pass_tds: 1.9 }], ['Puka Nacua', 'LAR', 'WR', { rec_yds: 94, receptions: 7.8 }],
    ['Brock Purdy', 'SF', 'QB', { pass_yds: 257, pass_tds: 1.8 }], ['Christian McCaffrey', 'SF', 'RB', { rush_yds: 76, receptions: 5.2 }],
    ['Patrick Mahomes', 'KC', 'QB', { pass_yds: 247, pass_tds: 1.9 }], ['Rashee Rice', 'KC', 'WR', { rec_yds: 72, receptions: 6.1 }],
    ['Josh Allen', 'BUF', 'QB', { pass_yds: 239, rush_yds: 41, pass_tds: 1.9 }], ['James Cook', 'BUF', 'RB', { rush_yds: 82 }], ['Khalil Shakir', 'BUF', 'WR', { rec_yds: 58, receptions: 5.3 }],
    ['Jalen Hurts', 'PHI', 'QB', { pass_yds: 214, rush_yds: 36 }], ['Saquon Barkley', 'PHI', 'RB', { rush_yds: 101 }], ['A.J. Brown', 'PHI', 'WR', { rec_yds: 74, receptions: 5.1 }],
    ['Dak Prescott', 'DAL', 'QB', { pass_yds: 272, pass_tds: 2.0 }], ['CeeDee Lamb', 'DAL', 'WR', { rec_yds: 89, receptions: 6.8 }],
    ['Justin Herbert', 'LAC', 'QB', { pass_yds: 246, pass_tds: 1.7 }], ['Ladd McConkey', 'LAC', 'WR', { rec_yds: 67, receptions: 5.5 }],
    ['Bo Nix', 'DEN', 'QB', { pass_yds: 229, pass_tds: 1.8 }], ['Courtland Sutton', 'DEN', 'WR', { rec_yds: 63, receptions: 4.7 }],
  ],
  nba: [
    ['Nikola Jokic', 'DEN', 'C', { points: 29.1, rebounds: 12.6, assists: 10.2 }], ['Jamal Murray', 'DEN', 'G', { points: 21.4, assists: 6.1, threes: 2.6 }],
    ['Shai Gilgeous-Alexander', 'OKC', 'G', { points: 31.2, assists: 6.3 }], ['Chet Holmgren', 'OKC', 'C', { points: 17.8, rebounds: 8.4 }],
    ['Jaylen Brown', 'BOS', 'F', { points: 24.1, rebounds: 6.2 }], ['Derrick White', 'BOS', 'G', { points: 16.9, threes: 3.2 }],
    ['Jalen Brunson', 'NYK', 'G', { points: 27.4, assists: 7.0 }], ['Karl-Anthony Towns', 'NYK', 'C', { points: 23.6, rebounds: 12.1 }],
    ['Victor Wembanyama', 'SAS', 'C', { points: 25.3, rebounds: 11.4, threes: 2.9 }], ["De'Aaron Fox", 'SAS', 'G', { points: 21.8, assists: 6.5 }],
    ['Anthony Edwards', 'MIN', 'G', { points: 27.9, threes: 4.0, rebounds: 5.8 }],
    ['Cade Cunningham', 'DET', 'G', { points: 26.2, assists: 9.1 }], ['Donovan Mitchell', 'CLE', 'G', { points: 25.8, threes: 3.4 }], ['Evan Mobley', 'CLE', 'F', { points: 19.0, rebounds: 9.3 }],
    ['Luka Doncic', 'LAL', 'G', { points: 31.8, rebounds: 8.4, assists: 8.6 }], ['Austin Reaves', 'LAL', 'G', { points: 20.3, assists: 5.7 }],
    ['Stephen Curry', 'GSW', 'G', { points: 25.6, threes: 4.6 }], ['Jimmy Butler', 'GSW', 'F', { points: 18.4, rebounds: 5.6 }],
  ],
};

// College rosters: fictional names, generated per team.
const FIRST = ['Jalen', 'Marcus', 'Tyler', 'Cam', 'Isaiah', 'Darius', 'Trey', 'Malik', 'Jordan', 'Elijah', 'Kobe', 'Devin', 'Caleb', 'Aiden', 'Xavier', 'Bryce', 'Jace', 'Micah', 'Nate', 'Quinn'];
const LAST = ['Carter', 'Brooks', 'Holloway', 'Pierce', 'Mitchell', 'Rowe', 'Bennett', 'Sutton', 'Hayes', 'Vance', 'Whitaker', 'Fields', 'Langford', 'Dawson', 'Grant', 'Ellison', 'Moss', 'Tate', 'Reid', 'Barnes'];
function collegeRoster(sportId) {
  const out = [];
  for (const [abbr] of TEAMS[sportId]) {
    const r = rng(hash(sportId + abbr));
    const name = () => `${pickOne(r, FIRST)} ${pickOne(r, LAST)}`;
    if (sportId === 'ncaab') {
      out.push([name(), abbr, 'G', { points: half(between(r, 14, 20)), assists: half(between(r, 3, 6)), threes: half(between(r, 1.8, 3.2)) }]);
      out.push([name(), abbr, 'F', { points: half(between(r, 11, 17)), rebounds: half(between(r, 6.5, 10)) }]);
    } else {
      out.push([name(), abbr, 'QB', { pass_yds: Math.round(between(r, 215, 290)), pass_tds: half(between(r, 1.6, 2.8)) }]);
      out.push([name(), abbr, 'RB', { rush_yds: Math.round(between(r, 70, 115)) }]);
      out.push([name(), abbr, 'WR', { rec_yds: Math.round(between(r, 60, 95)), receptions: half(between(r, 4.5, 7)) }]);
    }
  }
  return out;
}

// Game-to-game variability per stat (coefficient of variation) and whether it's a count.
const STAT_CV = { pass_yds: 0.22, pass_tds: 0.55, rush_yds: 0.33, rec_yds: 0.42, receptions: 0.3, points: 0.25, rebounds: 0.3, assists: 0.32, threes: 0.5 };
const PAIR = { '-110': -110, '-115': -105, '-120': 100, '-105': -115, '100': -120, '-125': 105 };
const COUNT = new Set(['pass_tds', 'receptions', 'rebounds', 'assists', 'threes']);
const GAMES_PLAYED = { nfl: 8, ncaaf: 9, nba: 10, ncaab: 10 };

// League average allowed to a position, per game (defense-vs-position baseline).
const DVP_BASE = {
  football: { QB: { pass_yds: 222, pass_tds: 1.45, rush_yds: 24 }, RB: { rush_yds: 105, receptions: 5 }, WR: { rec_yds: 150, receptions: 13 }, TE: { rec_yds: 55, receptions: 5 } },
  nba: { G: { points: 50, rebounds: 15, assists: 12, threes: 6.5 }, F: { points: 45, rebounds: 20, assists: 7 }, C: { points: 24, rebounds: 14, assists: 4, threes: 1.2 } },
  ncaab: { G: { points: 34, rebounds: 12, assists: 9, threes: 5 }, F: { points: 26, rebounds: 18, assists: 4 } },
};
const LEAGUE_SIZE = { nfl: 32, ncaaf: 136, nba: 30, ncaab: 364 };

const FB_SCHEMES = ['Two-high shell (Cover 2/4)', 'Single-high, Cover 3 heavy', 'Man-press, blitz-heavy', 'Light box / Cover 6'];
const BB_SCHEMES = ['Pack line man', 'Switch-everything man', '2-3 zone', 'Full-court press', 'Matchup zone', 'Drop coverage man'];
const LEAGUE_FB = { nfl: { plays: 63, passRate: 58, rz: 57 }, ncaaf: { plays: 70, passRate: 50, rz: 62 } };
const LEAGUE_BB = { nba: { tempo: 99, threeRate: 42, ato: 0.95 }, ncaab: { tempo: 68, threeRate: 39, ato: 0.92 } };

function atsRecord(r, n) {
  const w = Math.round(between(r, 0.25, 0.75) * n);
  const hw = Math.min(w, Math.round(w * between(r, 0.4, 0.65)));
  const hn = Math.ceil(n / 2);
  return { ats: `${w}-${n - w}`, atsHome: `${Math.min(hw, hn)}-${hn - Math.min(hw, hn)}`, atsAway: `${w - Math.min(hw, hn)}-${n - hn - (w - Math.min(hw, hn))}` };
}

function coachingProfile(sport, abbr) {
  const r = rng(hash(`coach:${sport.id}:${abbr}`));
  if (sport.kind === 'football') {
    const L = LEAGUE_FB[sport.id];
    const p = {
      playsPerGame: round(L.plays + between(r, -5.5, 5.5), 1),
      passRate: Math.round(L.passRate + between(r, -9, 9)),
      fourthDownAgg: Math.round(between(r, 8, 96)),
      redZoneTd: Math.round(L.rz + between(r, -12, 12)),
      secondHalfDiff: round(between(r, -4.5, 4.5), 1),
      blitzRate: Math.round(between(r, 18, 42)),
      defScheme: pickOne(r, FB_SCHEMES),
      ...atsRecord(r, GAMES_PLAYED[sport.id]),
    };
    p.style = [
      p.playsPerGame > L.plays + 2 ? 'Up-tempo' : p.playsPerGame < L.plays - 2 ? 'Methodical' : 'Balanced pace',
      p.passRate > L.passRate + 4 ? 'pass-first' : p.passRate < L.passRate - 4 ? 'run-heavy' : 'balanced play-calling',
      p.fourthDownAgg >= 70 ? 'aggressive on 4th down' : p.fourthDownAgg <= 30 ? 'conservative on 4th down' : null,
    ].filter(Boolean).join(', ');
    return p;
  }
  const L = LEAGUE_BB[sport.id];
  const p = {
    tempo: round(L.tempo + between(r, -6, 6), 1),
    threeRate: Math.round(L.threeRate + between(r, -8, 8)),
    defScheme: sport.id === 'nba' ? pickOne(r, ['Switch-everything man', 'Drop coverage man', 'Aggressive blitz/hedge', 'Zone-mix']) : pickOne(r, BB_SCHEMES),
    toRate: round(between(r, 12.5, 21), 1),
    atoPPP: round(L.ato + between(r, -0.12, 0.14), 2),
    closeRecord: `${Math.round(between(r, 1, 6))}-${Math.round(between(r, 0, 4))}`,
    benchMinutes: Math.round(between(r, 22, 42)),
    ...atsRecord(r, GAMES_PLAYED[sport.id]),
  };
  p.style = [
    p.tempo > L.tempo + 2 ? 'Fast-paced' : p.tempo < L.tempo - 2 ? 'Slow, half-court' : 'Moderate pace',
    p.threeRate > L.threeRate + 4 ? '3-point heavy' : p.threeRate < L.threeRate - 4 ? 'paint-focused' : null,
    p.defScheme.toLowerCase() + ' defense',
  ].filter(Boolean).join(', ');
  return p;
}

// ---------------------------------------------------------------------------------------------
const NOW = Date.now();

export function buildDemo(sport, analyzeGame) {
  const r = rng(hash(`demo:${sport.id}`));
  const teams = {};
  for (const [abbr, name, off, def] of TEAMS[sport.id]) {
    teams[abbr] = { abbr, name, ratings: { off, def }, coaching: sport.tier <= 2 ? coachingProfile(sport, abbr) : { style: 'n/a', ats: '—', atsHome: '—', atsAway: '—' } };
  }

  const games = GAMES[sport.id].map(([aw, hm, start], i) => {
    const game = { id: `${sport.id}-${i + 1}`, start, home: { abbr: hm, name: teams[hm].name }, away: { abbr: aw, name: teams[aw].name } };
    const fair = analyzeGame(sport, game, teams);
    const p = SPORT_PARAMS[sport.kind];
    const step = sport.kind === 'hockey' || sport.kind === 'baseball' ? 1.5 : sport.kind === 'soccer' ? 0.25 : 0.5;
    const snap = (x) => Math.round(x / step) * step;
    const line = sport.kind === 'hockey' || sport.kind === 'baseball' ? (fair.modelSpread <= 0 ? -1.5 : 1.5) : snap(fair.modelSpread + gauss(r) * (sport.kind === 'soccer' ? 0.3 : 2.2));
    const total = sport.kind === 'soccer' || sport.kind === 'hockey' ? (fair.modelTotal > (sport.kind === 'soccer' ? 2.9 : 6.2) ? 3.5 : 2.5) + (sport.kind === 'hockey' ? 3.5 : 0) : half(fair.modelTotal + gauss(r) * (sport.kind === 'basketball' ? 4 : 2.5));
    const vig = () => pickOne(r, [-110, -110, -110, -105, -115, -112, -108]);
    const so = vig();
    const pHomeWin = normCdf(-line / p.marginSd[sport.id] * (sport.kind === 'hockey' ? 0.6 : 1));
    game.spread = { line, homeOdds: so, awayOdds: so === -110 ? -110 : -220 - so, open: r() < 0.55 ? line + pickOne(r, [-1, -0.5, 0.5, 1]) * (step === 1.5 ? 0 : 1) : line };
    const to = vig();
    game.total = { line: total, overOdds: to, underOdds: to === -110 ? -110 : -220 - to, open: r() < 0.5 ? total + pickOne(r, [-1.5, -1, -0.5, 0.5, 1]) * (sport.kind === 'soccer' || sport.kind === 'hockey' ? 0 : 1) : total };
    game.moneyline = { home: toAmerican(pHomeWin * 1.025), away: toAmerican((1 - pHomeWin) * 1.025) };

    // Public splits: the public loves favorites and overs; sometimes sharps disagree.
    const favHome = line < 0;
    const ht = Math.round(Math.min(85, Math.max(15, 50 + (favHome ? 12 : -12) + gauss(r) * 9)));
    const hmGap = r() < 0.35 ? Math.round(between(r, 10, 22)) * (r() < 0.5 ? 1 : -1) : Math.round(gauss(r) * 5);
    const ot = Math.round(Math.min(82, Math.max(30, 60 + gauss(r) * 9)));
    const omGap = r() < 0.3 ? Math.round(between(r, 10, 20)) * (r() < 0.6 ? -1 : 1) : Math.round(gauss(r) * 5);
    const mlT = Math.round(Math.min(88, Math.max(12, 50 + (favHome ? 18 : -18) + gauss(r) * 8)));
    game.public = {
      spread: { homeTickets: ht, homeMoney: clampPct(ht + hmGap) },
      total: { overTickets: ot, overMoney: clampPct(ot + omGap) },
      moneyline: { homeTickets: mlT, homeMoney: clampPct(mlT + Math.round(gauss(r) * 8)) },
    };
    return game;
  });

  const { players, props } = buildProps(sport, teams, games);
  const injuries = buildInjuries(sport, players, r, Object.keys(teams));
  return { teams, games, players, props, injuries };
}

const clampPct = (x) => Math.min(95, Math.max(5, x));
function toAmerican(p) {
  p = Math.min(0.97, Math.max(0.03, p));
  return p >= 0.5 ? -Math.round((p / (1 - p)) * 100 / 5) * 5 : Math.round(((1 - p) / p) * 100 / 5) * 5;
}

function buildProps(sport, teams, games) {
  const list = PLAYERS[sport.id] || (sport.id === 'ncaab' || sport.id === 'ncaaf' ? collegeRoster(sport.id) : []);
  const players = [], props = [];
  const dvpBase = sport.kind === 'football' ? DVP_BASE.football : DVP_BASE[sport.id];
  if (!dvpBase) return { players, props };

  // Defense vs position for every defense in the slate.
  const dvp = {};
  for (const t of Object.values(teams)) {
    const r = rng(hash(`dvp:${sport.id}:${t.abbr}`));
    const leagueDef = sport.kind === 'football' ? (sport.id === 'nfl' ? 22 : 21) : (sport.id === 'nba' ? 112 : 97);
    const base = Math.pow(t.ratings.def / leagueDef, 1.2);
    dvp[t.abbr] = {};
    for (const [pos, stats] of Object.entries(dvpBase)) {
      for (const [stat, lg] of Object.entries(stats)) {
        const mult = base * (1 + gauss(r) * 0.07);
        const pct = normCdf((mult - 1) / 0.1); // share of league allowing less
        const N = LEAGUE_SIZE[sport.id];
        dvp[t.abbr][`${pos}:${stat}`] = { allowed: lg * mult, leagueAvg: lg, rank: Math.min(N, Math.max(1, Math.round(pct * N))), teams: N, oppName: t.name };
      }
    }
  }
  for (const [name, team, pos, avgs] of list) {
    const game = games.find((g) => g.home.abbr === team || g.away.abbr === team);
    if (!game) continue;
    const opp = game.home.abbr === team ? game.away.abbr : game.home.abbr;
    const r = rng(hash(`p:${sport.id}:${team}:${name}`));
    const n = GAMES_PLAYED[sport.id];
    const id = `${sport.id}-${hash(team + name).toString(36)}`;
    const player = { id, name, team, pos, opp, gameId: game.id, logs: {} };
    for (const [stat, avg] of Object.entries(avgs)) {
      const trend = between(r, -0.12, 0.12); // recent form drift
      player.logs[stat] = Array.from({ length: n }, (_, i) => {
        const form = 1 + trend * (1 - i / n);
        const v = Math.max(0, avg * form * (1 + gauss(r) * STAT_CV[stat]));
        return Math.round(v);
      });
      // Book line: anchored to recent production with small noise, like a real market.
      // Edges then come mostly from matchup/pace factors the line under-weights.
      const logs = player.logs[stat];
      const recent = (logs.slice(0, 5).reduce((a, b) => a + b, 0) / 5 + logs.reduce((a, b) => a + b, 0) / logs.length) / 2;
      const d = dvp[opp]?.[`${pos}:${stat}`];
      const priced = recent * (d ? Math.min(1.2, Math.max(0.8, d.allowed / d.leagueAvg)) ** 0.4 : 1) * (1 + gauss(r) * 0.05);
      const line = COUNT.has(stat) ? Math.max(0.5, Math.round(priced - 0.5) + 0.5) : Math.floor(priced) + 0.5;
      const ov = pickOne(r, [-110, -110, -115, -120, -105, 100, -125]);
      props.push({ id: `${id}-${stat}`, playerId: id, player: name, team, pos, opp, gameId: game.id, stat, line, overOdds: ov, underOdds: PAIR[ov], book: pickOne(r, ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars']) });
    }
    players.push(player);
  }

  for (const p of props) p.defense = dvp[p.opp]?.[`${p.pos}:${p.stat}`] || null;
  return { players, props };
}

const NOTES = {
  football: ['Hamstring — limited practice Wednesday', 'Ankle — did not practice Thursday', 'Knee — full participant Friday', 'Concussion protocol', 'Shoulder — limited, expected to play', 'Groin — game-time decision', 'Illness — missed walkthrough'],
  basketball: ['Ankle sprain — game-time decision', 'Hamstring tightness', 'Rest (back-to-back)', 'Knee soreness — shootaround status TBD', 'Illness', 'Calf strain — out 1-2 weeks'],
  other: ['Lower-body injury', 'Upper-body injury', 'Illness', 'Muscle strain'],
};

function buildInjuries(sport, players, r, teams) {
  const notes = NOTES[sport.kind] || NOTES.other;
  const statuses = sport.kind === 'basketball' ? ['Questionable', 'Probable', 'Doubtful', 'Out', 'Day-To-Day'] : ['Questionable', 'Questionable', 'Doubtful', 'Out', 'Probable'];
  const out = [];
  // A few prop players carry injury tags (these feed into the prop model's confidence).
  const tagged = players.filter(() => r() < 0.14).slice(0, 5);
  for (const p of tagged) {
    const status = pickOne(r, statuses.filter((s) => s !== 'Out'));
    out.push({ player: p.name, team: p.team, pos: p.pos, status, note: pickOne(r, notes), updated: new Date(NOW - Math.round(between(r, 5, 600)) * 60000).toISOString() });
  }
  // Depth players for color.
  const extra = sport.kind === 'football' ? ['OL', 'CB', 'S', 'LB', 'DE', 'TE'] : sport.kind === 'basketball' ? ['G', 'F', 'C'] : sport.kind === 'soccer' ? ['F', 'M', 'D', 'GK'] : ['F', 'D', 'G'];
  for (let i = 0; i < 6 && teams.length; i++) {
    out.push({ player: `${pickOne(r, FIRST)} ${pickOne(r, LAST)}`, team: pickOne(r, teams), pos: pickOne(r, extra), status: pickOne(r, statuses), note: pickOne(r, notes), updated: new Date(NOW - Math.round(between(r, 5, 1500)) * 60000).toISOString() });
  }
  return out.sort((a, b) => b.updated.localeCompare(a.updated));
}
