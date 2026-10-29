// Player prop model.
//
// projection = recency-weighted baseline (L5 / L10 / season)
//            x defense-vs-position factor (what this defense allows to the position vs league avg)
//            x pace/game-total factor
//            x game-script factor (trailing teams throw more, leading teams run more)
// The projection and the player's own game-to-game variance give P(over), which is compared
// with the sportsbook's implied probability to produce an edge.

import { mean, stdev, clamp, round, normCdf, impliedProb, expectedValue, grade, shrinkToMarket } from './math.js';

const PASS_STATS = new Set(['pass_yds', 'pass_tds', 'completions', 'rec_yds', 'receptions']);
const RUSH_STATS = new Set(['rush_yds', 'carries']);
const LOW_COUNT = new Set(['pass_tds', 'threes', 'assists', 'receptions']);
const INJURY_PENALTY = { Questionable: 0.15, Doubtful: 0.5, 'Day-To-Day': 0.1, Probable: 0.03 };
// Lines this small are decided by a single play; don't rate them as strong.
const MIN_LINE = { pass_yds: 120, completions: 10, pass_tds: 0.5, rush_yds: 15, carries: 4, rec_yds: 15, receptions: 1.5 };
const MIN_GAMES = 4;
// A line this far from the player's own history usually means his role just changed (injury,
// depth chart) — something game logs can't see — so the model's "edge" there isn't trusted.
const ROLE_BAND = [0.65, 1.55];

export function projectProp({ prop, player, defense, game, leagueTotal, injury }) {
  const logs = player.logs[prop.stat] || [];
  if (logs.length < 3) return null;

  const l5 = mean(logs.slice(0, 5));
  const l10 = mean(logs.slice(0, 10));
  const season = mean(logs);
  const baseline = 0.4 * l5 + 0.3 * l10 + 0.3 * season;

  // Defense vs position: ratio of what this defense allows to the league average, damped
  // because a single season of defensive data is noisy.
  let defFactor = 1, dvpRank = null, dvpAllowed = null, dvpLeague = null;
  if (defense) {
    dvpAllowed = defense.allowed;
    dvpLeague = defense.leagueAvg;
    dvpRank = defense.rank;
    defFactor = clamp(defense.allowed / defense.leagueAvg, 0.8, 1.2) ** 0.6;
  }

  // Pace: higher totals mean more possessions/plays for everyone.
  const total = game?.total?.line ?? leagueTotal;
  const paceFactor = clamp(1 + 0.35 * (total / leagueTotal - 1), 0.93, 1.07);

  // Game script, from the player's team's spread (negative = favored).
  const teamSpread = game ? (player.team === game.home.abbr ? game.spread.line : -game.spread.line) : 0;
  let scriptFactor = 1;
  if (PASS_STATS.has(prop.stat)) scriptFactor = 1 + clamp(teamSpread, -10, 10) * 0.004;
  if (RUSH_STATS.has(prop.stat)) scriptFactor = 1 - clamp(teamSpread, -10, 10) * 0.006;

  const projection = baseline * defFactor * paceFactor * scriptFactor;

  // Spread of outcomes: player's own variance, floored so tiny samples don't look certain.
  const sd = Math.max(stdev(logs.slice(0, 10)), projection * 0.18, 0.6);
  // Low-count stats (TDs, threes, assists) are lumpy, so use a Poisson model for them.
  const pOver = LOW_COUNT.has(prop.stat) && projection < 4
    ? 1 - poissonCdf(Math.floor(prop.line), projection)
    : 1 - normCdf((prop.line - projection) / sd);
  const lean = pOver >= 0.5 ? 'Over' : 'Under';
  const odds = lean === 'Over' ? prop.overOdds : prop.underOdds;
  const rawProb = lean === 'Over' ? pOver : 1 - pOver;
  const prob = shrinkToMarket(rawProb, odds, lean === 'Over' ? prop.underOdds : prop.overOdds);
  const edge = prob - impliedProb(odds);

  const last10 = logs.slice(0, 10);
  const hits = last10.filter((v) => (lean === 'Over' ? v > prop.line : v < prop.line)).length;
  const hitRate = hits / last10.length;

  // Confidence: model probability, agreement with recent hit rate, and sample size,
  // minus an injury penalty.
  const penalty = INJURY_PENALTY[injury?.status] ?? 0;
  const confidence = clamp(
    ((prob - 0.5) / 0.15) * 0.55 + (hitRate - 0.5) * 0.6 + Math.min(logs.length / 10, 1) * 0.15 - penalty,
    0, 1,
  );

  // Reasons this prop can't be rated strong, however big the edge looks.
  const cautions = [];
  if (logs.length < MIN_GAMES) cautions.push(`only ${logs.length} games this season`);
  if (MIN_LINE[prop.stat] != null && prop.line < MIN_LINE[prop.stat]) cautions.push('line too small to trust (one play decides it)');
  const ratio = baseline > 0 ? prop.line / baseline : Infinity;
  if (ratio > ROLE_BAND[1] || ratio < ROLE_BAND[0]) cautions.push(`line is ${ratio > 1 ? 'well above' : 'well below'} his average (${round(baseline, 1)}), which usually means his role just changed`);

  return {
    cautions,
    projection: round(projection, 1),
    baseline: round(baseline, 1),
    l5: round(l5, 1), l10: round(l10, 1), season: round(season, 1),
    factors: { defense: round(defFactor, 3), pace: round(paceFactor, 3), script: round(scriptFactor, 3) },
    dvp: defense ? { rank: dvpRank, allowed: round(dvpAllowed, 1), leagueAvg: round(dvpLeague, 1), teams: defense.teams } : null,
    lean, odds,
    prob: round(prob, 3), rawProb: round(rawProb, 3),
    edge: round(edge, 3),
    ev: round(expectedValue(prob, odds), 3),
    hitRate: round(hitRate, 2), hits, games: last10.length,
    last10,
    confidence: round(confidence, 2),
    grade: grade(confidence),
    injury: injury || null,
    summary: explainProp({ prop, player, lean, projection, l5, season, defense, hits, n: last10.length, injury }),
  };
}

function explainProp({ prop, player, lean, projection, l5, season, defense, hits, n, injury }) {
  const parts = [];
  parts.push(`Model projects ${round(projection, 1)} vs a line of ${prop.line} (L5 avg ${round(l5, 1)}, season ${round(season, 1)}).`);
  if (defense) {
    const diff = (defense.allowed / defense.leagueAvg - 1) * 100;
    const tough = defense.rank <= Math.ceil(defense.teams / 3);
    const soft = defense.rank > Math.floor((defense.teams * 2) / 3);
    const desc = tough ? 'a top-third defense' : soft ? 'a bottom-third defense' : 'a middle-of-the-pack defense';
    parts.push(`${defense.oppName} is ${desc} vs ${player.pos}s, allowing ${round(Math.abs(diff), 0)}% ${diff >= 0 ? 'more' : 'less'} than league average (rank ${defense.rank}/${defense.teams}).`);
  }
  parts.push(`${lean} has hit in ${hits} of the last ${n}.`);
  if (injury) parts.push(`Injury: listed ${injury.status}${injury.note ? ` (${injury.note})` : ''}.`);
  return parts.join(' ');
}

function poissonCdf(k, lambda) {
  let term = Math.exp(-lambda), sum = term;
  for (let i = 1; i <= k; i++) { term *= lambda / i; sum += term; }
  return Math.min(1, sum);
}
