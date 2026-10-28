// Weekly Best Value and Best Lock selection across every sport.
// Value = highest expected value (model edge x payout). Lock = highest 1-1000 confidence score
// with a clean injury report. Every pick carries its confidence score.

import { TIER_WEIGHT } from '../config.js';
import { round, STRONG_SCORE } from './math.js';

const RISKY = new Set(['Out', 'Doubtful', 'Questionable']);

export function buildPicks(boards, { limit = 6 } = {}) {
  const cands = [];
  for (const b of boards) {
    const w = TIER_WEIGHT[b.sport.tier];
    for (const g of b.games) {
      const a = g.analysis;
      // Live games show their pre-game line for reference only; it can't be bet anymore.
      if (!a?.available || a.lowSample || g.live) continue;
      const sharpSides = new Set((g.signals || []).map((s) => `${s.market}:${s.side}`));
      if (a.spreadPick) {
        const sideAbbr = g[a.spreadPick.side].abbr;
        cands.push(gameCand(b.sport, g, 'Spread', a.spreadPick, w, sharpSides.has(`spread:${sideAbbr}`), keyNote(a, 'spread')));
      }
      if (a.totalPick) cands.push(gameCand(b.sport, g, 'Total', a.totalPick, w, sharpSides.has(`total:${a.totalPick.side}`), keyNote(a, 'total')));
    }
    for (const pr of b.props) {
      const m = pr.model;
      if (!m) continue;
      cands.push({
        id: `${b.sport.id}:prop:${pr.id}`, sport: b.sport.id, sportName: b.sport.short, tier: b.sport.tier, type: 'Prop',
        label: `${pr.player} ${m.lean} ${pr.line} ${pr.statLabel}`, matchup: pr.matchup, odds: m.odds,
        prob: m.prob, edge: m.edge, ev: m.ev, grade: m.grade, confidence: m.confidence, score: m.score, sharp: false,
        injury: m.injury, reason: m.summary, weight: w,
      });
    }
  }

  const score = (c) => c.ev * c.weight * (c.sharp ? 1.15 : 1);
  const locks = cands
    .filter((c) => c.prob >= 0.57 && (c.grade === 'A' || c.grade === 'B') && !RISKY.has(c.injury?.status) && c.odds >= -200)
    .sort((x, y) => y.score * y.weight - x.score * x.weight);
  const lockList = diversify(locks, limit);
  const lockIds = new Set(lockList.map((c) => c.id));
  const value = cands
    .filter((c) => c.edge >= 0.03 && c.ev > 0 && !lockIds.has(c.id) && !['Out', 'Doubtful'].includes(c.injury?.status))
    .sort((x, y) => score(y) - score(x));

  // Top plays: highest confidence across every sport. Toss-ups (< STRONG_SCORE) are left out, and so
  // are plays priced so steeply that they lose money over time even when they usually win (edge <= 1%).
  const top = cands
    .filter((c) => c.score >= STRONG_SCORE && c.edge > 0.01 && !RISKY.has(c.injury?.status))
    .sort((x, y) => y.score - x.score || y.prob - x.prob);

  return { top: diversify(top, 10).map(finalize), strongScore: STRONG_SCORE, value: diversify(value, limit).map(finalize), locks: lockList.map(finalize), considered: cands.length };
}

function gameCand(sport, g, type, p, weight, sharp, reason) {
  return {
    id: `${sport.id}:${g.id}:${type}`, sport: sport.id, sportName: sport.short, tier: sport.tier, type,
    label: p.label, matchup: `${g.away.abbr} @ ${g.home.abbr}`, odds: p.odds, prob: p.prob, edge: p.edge, ev: p.ev,
    grade: p.grade, confidence: p.confidence, score: p.score, sharp, reason, weight, injury: null, start: g.start,
  };
}

function keyNote(a, market) {
  const n = a.notes.find((x) => x.impact === market) || a.notes.find((x) => x.impact !== 'info');
  return `${a.summary}${n ? ` ${n.title}: ${n.text}` : ''}`;
}

// No more than 2 picks from the same game, so one matchup can't dominate the card.
function diversify(list, limit) {
  const perGame = new Map();
  const out = [];
  for (const c of list) {
    const k = c.matchup;
    if ((perGame.get(k) || 0) >= 2) continue;
    perGame.set(k, (perGame.get(k) || 0) + 1);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

const finalize = ({ weight, ...c }) => ({ ...c, prob: round(c.prob, 3) });
