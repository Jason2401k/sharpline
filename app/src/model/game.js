// Game-line model + coaching-style analysis.
//
// Builds a projected score from team offense/defense ratings, then adjusts for coaching
// tendencies (tempo, 4th-down aggressiveness, halftime adjustments, red-zone efficiency,
// late-game execution). The resulting model spread/total are compared with the book.

import { SPORT_PARAMS } from '../config.js';
import { clamp, round, normCdf, impliedProb, expectedValue, grade, shrinkToMarket } from './math.js';

const LEAGUE = {
  nfl:   { plays: 63, passRate: 58, rz: 57 },
  ncaaf: { plays: 70, passRate: 50, rz: 62 },
  nba:   { tempo: 99, threeRate: 42, ato: 0.95 },
  ncaab: { tempo: 68, threeRate: 39, ato: 0.92 },
};

export function analyzeGame(sport, game, teams) {
  const p = SPORT_PARAMS[sport.kind];
  const home = teams[game.home.abbr];
  const away = teams[game.away.abbr];
  if (!home || !away) return { available: false, reason: 'No team profile for this matchup yet.' };

  const homeAdv = game.neutral ? 0 : p.homeAdv[sport.id];
  let proj, notes = [];
  if (sport.kind === 'football') ({ proj, notes } = footballModel(sport.id, home, away, homeAdv));
  else if (sport.kind === 'basketball') ({ proj, notes } = basketballModel(sport.id, home, away, homeAdv));
  else proj = simpleModel(home, away, homeAdv);

  const margin = proj.home - proj.away; // positive = home wins by
  const total = proj.home + proj.away;
  const marginSd = p.marginSd[sport.id];
  const totalSd = p.totalSd[sport.id];

  // Few games played (or only last season's numbers) -> show the model, but keep it out of picks.
  const minGames = Math.min(home.sample?.games ?? 99, away.sample?.games ?? 99);
  // KenPom ratings are current (preseason-adjusted), so they stand in for last season's ESPN stats.
  const prior = Boolean((home.sample?.priorSeason && !home.kenpom) || (away.sample?.priorSeason && !away.kenpom));
  const lowSample = minGames < 4 || prior;
  const out = {
    available: true,
    lowSample,
    minGames: Number.isFinite(minGames) && minGames !== 99 ? minGames : null,
    sampleNote: prior ? "Ratings use last season's stats because this season hasn't started." : minGames < 4 ? `Small sample: only ${minGames} game${minGames === 1 ? '' : 's'} played, so treat the model loosely.` : null,
    projScore: { home: round(proj.home, 1), away: round(proj.away, 1) },
    modelSpread: round(-margin, 1), // in home-line terms, e.g. -4.5 = home favored by 4.5
    modelTotal: round(total, 1),
    winProb: { home: round(normCdf(margin / marginSd), 3), away: round(1 - normCdf(margin / marginSd), 3) },
    notes: notes.filter(Boolean),
    coaching: sport.kind === 'football' || sport.kind === 'basketball'
      ? { home: { team: home.name, ...home.coaching }, away: { team: away.name, ...away.coaching } }
      : null,
  };

  if (game.spread) {
    const pHome = normCdf((margin + game.spread.line) / marginSd);
    const side = pHome >= 0.5 ? 'home' : 'away';
    const prob = side === 'home' ? pHome : 1 - pHome;
    const odds = side === 'home' ? game.spread.homeOdds : game.spread.awayOdds;
    const line = side === 'home' ? game.spread.line : -game.spread.line;
    const other = side === 'home' ? game.spread.awayOdds : game.spread.homeOdds;
    out.spreadPick = pick(`${game[side].abbr} ${fmtLine(line)}`, side, shrinkToMarket(prob, odds, other), odds, Math.abs(-margin - game.spread.line));
  }
  if (game.total) {
    const pOver = 1 - normCdf((game.total.line - total) / totalSd);
    const side = pOver >= 0.5 ? 'over' : 'under';
    const prob = side === 'over' ? pOver : 1 - pOver;
    const odds = side === 'over' ? game.total.overOdds : game.total.underOdds;
    const other = side === 'over' ? game.total.underOdds : game.total.overOdds;
    out.totalPick = pick(`${side === 'over' ? 'Over' : 'Under'} ${game.total.line}`, side, shrinkToMarket(prob, odds, other), odds, Math.abs(total - game.total.line));
  }
  out.summary = summarize(game, out);
  return out;
}

function pick(label, side, prob, odds, pointsOff) {
  const edge = prob - impliedProb(odds);
  const confidence = clamp(((prob - 0.5) / 0.12) * 0.8 + Math.min(pointsOff / 6, 1) * 0.2, 0, 1);
  return { label, side, odds, prob: round(prob, 3), edge: round(edge, 3), ev: round(expectedValue(prob, odds), 3), pointsOff: round(pointsOff, 1), confidence: round(confidence, 2), grade: grade(confidence) };
}

export const fmtLine = (x) => (x > 0 ? `+${x}` : x === 0 ? 'PK' : `${x}`);

function summarize(game, a) {
  const fav = a.modelSpread <= 0 ? game.home.abbr : game.away.abbr;
  const parts = [`Model: ${fav} by ${Math.abs(a.modelSpread)}, total ${a.modelTotal}.`];
  if (game.spread) parts.push(`Book: ${game.home.abbr} ${fmtLine(game.spread.line)}, total ${game.total?.line ?? '—'}.`);
  return parts.join(' ');
}

// ---------- Football ----------
function footballModel(id, home, away, homeAdv) {
  const L = LEAGUE[id];
  const h = home.coaching, a = away.coaching;
  const pace = ((h.playsPerGame ?? L.plays) + (a.playsPerGame ?? L.plays)) / 2 / L.plays;
  const paceAdj = 1 + 0.6 * (pace - 1);

  let hp = ((home.ratings.off + away.ratings.def) / 2) * paceAdj + homeAdv / 2;
  let ap = ((away.ratings.off + home.ratings.def) / 2) * paceAdj - homeAdv / 2;

  // Coaching adjustments, each worth fractions of a point.
  // Missing metrics count as league average.
  const adj4thH = ((h.fourthDownAgg ?? 50) - 50) / 100; // -0.5..0.5
  const adj4thA = ((a.fourthDownAgg ?? 50) - 50) / 100;
  hp += adj4thH * 1.2; ap += adj4thA * 1.2;
  hp += (h.secondHalfDiff ?? 0) * 0.2; ap += (a.secondHalfDiff ?? 0) * 0.2;
  hp += ((h.redZoneTd ?? L.rz) - L.rz) * 0.04; ap += ((a.redZoneTd ?? L.rz) - L.rz) * 0.04;

  const notes = [];
  const fastH = (h.playsPerGame ?? L.plays) - L.plays, fastA = (a.playsPerGame ?? L.plays) - L.plays;
  if (h.playsPerGame == null || a.playsPerGame == null) { /* no tempo data */ }
  else if (fastH > 2 && fastA > 2) notes.push(note('Tempo', `Both staffs play fast (${h.playsPerGame} and ${a.playsPerGame} plays/game vs ${L.plays} avg). More snaps means more scoring chances, which pushes toward the over.`, 'total', 'over'));
  else if (fastH < -2 && fastA < -2) notes.push(note('Tempo', `Two slow, ball-control offenses (${h.playsPerGame} and ${a.playsPerGame} plays/game). Fewer possessions shrink the scoring window, which pushes toward the under.`, 'total', 'under'));
  else if (Math.abs(fastH - fastA) > 4) {
    const [f, s] = fastH > fastA ? [home, away] : [away, home];
    notes.push(note('Tempo clash', `${f.name} wants to play fast (${f.coaching.playsPerGame} plays/game) while ${s.name} grinds (${s.coaching.playsPerGame}). Whoever grabs an early lead controls the clock.`, 'total', null));
  }

  const passy = (t) => (t.coaching.passRate == null ? 0 : t.coaching.passRate - L.passRate);
  for (const [off, def] of [[home, away], [away, home]]) {
    if (passy(off) > 4 && (def.coaching.blitzRate ?? 0) >= 32) notes.push(note('Scheme matchup', `${off.name}'s pass-first plan (${off.coaching.passRate}% pass rate) runs into ${def.name}'s blitz-heavy defense (${def.coaching.blitzRate}% blitz rate). Expect sacks and explosive plays, so a wider range of outcomes.`, 'variance', null));
    if (passy(off) < -4 && def.coaching.defScheme?.includes('Light box')) notes.push(note('Scheme matchup', `${off.name} leans on the run (${off.coaching.passRate}% pass rate) and ${def.name} plays light boxes. That helps ${off.name}'s rushing props and lets them shorten the game.`, 'spread', off === home ? 'home' : 'away'));
  }

  for (const t of [home, away]) {
    const c = t.coaching;
    const att = c.fourthDownAttPerGame != null ? `, ${c.fourthDownAttPerGame} attempts per game${c.fourthDownConvPct != null ? ` at ${c.fourthDownConvPct}% success` : ''}` : '';
    if (c.fourthDownAgg != null && c.fourthDownAgg >= 75) notes.push(note('4th-down aggression', `${t.name}'s coach goes for it often (${c.fourthDownAgg}th percentile${att}). That turns field goals into touchdowns over the long run and keeps them alive as underdogs.`, 'spread', t === home ? 'home' : 'away'));
    if (c.fourthDownAgg != null && c.fourthDownAgg <= 25) notes.push(note('Conservative play-calling', `${t.name}'s coach rarely goes for it on 4th down (${c.fourthDownAgg}th percentile${att}). Expect punts and field goals, which caps their scoring.`, 'total', 'under'));
    if (c.secondHalfDiff != null && Math.abs(c.secondHalfDiff) >= 3) notes.push(note('Halftime adjustments', `${t.name} is ${c.secondHalfDiff > 0 ? '+' : ''}${c.secondHalfDiff} points/game in second halves. That staff ${c.secondHalfDiff > 0 ? 'adjusts well, which is useful for live bets if they trail at half' : 'tends to get out-adjusted, so fade them in second-half lines'}.`, 'spread', c.secondHalfDiff > 0 ? (t === home ? 'home' : 'away') : (t === home ? 'away' : 'home')));
  }
  notes.push(atsNote(home, away));

  return { proj: { home: hp, away: ap }, notes };
}

// ---------- Basketball ----------
function basketballModel(id, home, away, homeAdv) {
  const L = LEAGUE[id];
  const h = home.coaching, a = away.coaching;
  // In college the slower team tends to dictate tempo; weight it more heavily.
  const slowW = id === 'ncaab' ? 0.6 : 0.5;
  const ht = h.tempo ?? L.tempo, at = a.tempo ?? L.tempo;
  const poss = Math.min(ht, at) * slowW + Math.max(ht, at) * (1 - slowW);

  let hp = (poss * (home.ratings.off + away.ratings.def) / 2) / 100 + homeAdv / 2;
  let ap = (poss * (away.ratings.off + home.ratings.def) / 2) / 100 - homeAdv / 2;

  // Late-game execution (after-timeout efficiency) and bench depth.
  hp += ((h.atoPPP ?? L.ato) - L.ato) * 8; ap += ((a.atoPPP ?? L.ato) - L.ato) * 8;

  const notes = [];
  // KenPom: tempo-free adjusted efficiency. Blend 70% KenPom projection with 30% ESPN-stat model.
  if (id === 'ncaab' && home.kenpom && away.kenpom) {
    const H = home.kenpom, A = away.kenpom;
    const kpPoss = (H.adjT * A.adjT) / H.avgTempo;
    const kpH = (kpPoss * (H.adjO * A.adjD) / H.avgEff) / 100 + homeAdv / 2;
    const kpA = (kpPoss * (A.adjO * H.adjD) / H.avgEff) / 100 - homeAdv / 2;
    hp = 0.7 * kpH + 0.3 * hp;
    ap = 0.7 * kpA + 0.3 * ap;
    const em = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
    const better = H.adjEM >= A.adjEM ? home : away;
    notes.push(note('KenPom', `${away.name} #${A.rank} (AdjEM ${em(A.adjEM)}, AdjO ${A.adjO.toFixed(1)}, AdjD ${A.adjD.toFixed(1)}) vs ${home.name} #${H.rank} (AdjEM ${em(H.adjEM)}, AdjO ${H.adjO.toFixed(1)}, AdjD ${H.adjD.toFixed(1)}). KenPom projects ${round(kpPoss, 1)} possessions and ${better.name} by ${Math.abs(kpH - kpA).toFixed(1)}; it counts for 70% of the model here.`, 'spread', better === home ? 'home' : 'away'));
  }
  const [slow, fast] = ht <= at ? [home, away] : [away, home];
  if (h.tempo == null || a.tempo == null) { /* no tempo data */ }
  else if (fast.coaching.tempo - slow.coaching.tempo >= 4) notes.push(note('Tempo battle', `${fast.name} wants to run (${fast.coaching.tempo} poss/game) but ${slow.name} slows it down (${slow.coaching.tempo}). ${id === 'ncaab' ? 'In college the slower team usually wins this battle, ' : ''}so the model projects ${round(poss, 1)} possessions.`, 'total', slow.coaching.tempo < L.tempo ? 'under' : null));
  else if (h.tempo > L.tempo + 2 && a.tempo > L.tempo + 2) notes.push(note('Tempo', `Two up-tempo coaches (${h.tempo} and ${a.tempo} poss/game). Extra possessions push toward the over.`, 'total', 'over'));

  for (const [off, def] of [[home, away], [away, home]]) {
    const dc = def.coaching, oc = off.coaching;
    if (dc.defScheme?.includes('zone') && oc.threeRate >= L.threeRate + 3) notes.push(note('Zone vs. shooters', `${def.name}'s ${dc.defScheme} gives up open threes, and ${off.name} lives behind the arc (${oc.threeRate}% of shots are 3s). Big variance: if the threes fall, ${off.name} covers easily.`, 'variance', null));
    if (dc.defScheme?.includes('press') && oc.toRate >= 18) notes.push(note('Press vs. ball security', `${def.name}'s full-court press meets a turnover-prone ${off.name} (${oc.toRate}% TO rate). Expect extra fast-break points for ${def.name}.`, 'spread', def === home ? 'home' : 'away'));
    if (dc.defScheme?.includes('Pack line') && oc.threeRate != null && oc.threeRate < L.threeRate - 2) notes.push(note('Pack-line vs. paint offense', `${def.name}'s pack-line clogs the paint, and ${off.name} doesn't shoot many threes (${oc.threeRate}%). A tough fit for ${off.name}'s offense.`, 'spread', def === home ? 'home' : 'away'));
  }
  for (const [off, def] of [[home, away], [away, home]]) {
    const oc = off.coaching, dc = def.coaching;
    if (oc.threeRate != null && oc.threeRate >= L.threeRate + 5) notes.push(note('3-point volume', `${off.name} takes ${oc.threeRate}% of its shots from three (league avg ${L.threeRate}%). High-variance offense: big swings either way against ${def.name}.`, 'variance', null));
    if (oc.toRate != null && oc.toRate >= 17) notes.push(note('Ball security', `${off.name} turns it over on ${oc.toRate}% of possessions, which hands ${def.name} extra transition chances.`, 'spread', def === home ? 'home' : 'away'));
  }
  for (const t of [home, away]) {
    const c = t.coaching;
    if (c.atoPPP != null && c.atoPPP >= L.ato + 0.08) notes.push(note('Late-game coaching', `${t.name}'s staff is elite out of timeouts (${c.atoPPP} pts/possession vs ${L.ato} avg) and ${c.closeRecord} in games within 5 points. Trust them in a close game.`, 'spread', t === home ? 'home' : 'away'));
    if (c.benchMinutes != null && c.benchMinutes >= 38) notes.push(note('Depth', `${t.name} plays a deep rotation (${c.benchMinutes}% bench minutes), so fatigue matters less late and the ${c.defScheme.toLowerCase()} can stay aggressive.`, 'spread', t === home ? 'home' : 'away'));
  }
  notes.push(atsNote(home, away));
  return { proj: { home: hp, away: ap }, notes };
}

// ---------- Hockey / baseball / soccer: ratings only ----------
function simpleModel(home, away, homeAdv) {
  return {
    home: (home.ratings.off + away.ratings.def) / 2 + homeAdv / 2,
    away: (away.ratings.off + home.ratings.def) / 2 - homeAdv / 2,
  };
}

function atsNote(home, away) {
  const h = home.coaching, a = away.coaching;
  if (h.ats == null) {
    if (!h.record && !a.record) return null;
    return note('Records', `${home.name}: ${h.record ?? '—'}${h.homeRecord ? ` (${h.homeRecord} at home)` : ''}. ${away.name}: ${a.record ?? '—'}${a.awayRecord ? ` (${a.awayRecord} on the road)` : ''}.`, 'info', null);
  }
  return note('ATS history', `${home.name}: ${home.coaching.ats} ATS this season (${home.coaching.atsHome} at home). ${away.name}: ${away.coaching.ats} ATS (${away.coaching.atsAway} on the road).`, 'info', null);
}

const note = (title, text, impact, lean) => ({ title, text, impact, lean });
