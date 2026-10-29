// "Learning from mistakes": compare the win probability the model gave each graded pick with
// how often those picks actually won, and correct future probabilities.
//
// Corrections are shifts on the log-odds scale, shrunk toward "no change" by a prior worth
// PRIOR_PICKS picks, so a handful of results barely moves anything. Each sport+market blends its
// own evidence with the all-picks correction, weighted by how many picks it has. Shifts are capped.

const PRIOR_PICKS = 50;
const MAX_SHIFT = 0.5; // log-odds; roughly +/- 12 percentage points around 60%

const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clampP = (p) => Math.min(0.99, Math.max(0.01, p));
const clamp = (x, m) => Math.max(-m, Math.min(m, x));

const decided = (p) => p.status === 'win' || p.status === 'loss';

function shiftFor(picks) {
  const n = picks.length;
  if (!n) return { shift: 0, n: 0 };
  const wins = picks.filter((p) => p.status === 'win').length;
  // Win chance the model gave these picks before any learning was applied.
  const expected = picks.reduce((a, p) => a + clampP(p.rawProb ?? p.prob), 0) / n;
  const smoothed = (wins + PRIOR_PICKS * expected) / (n + PRIOR_PICKS);
  return { shift: clamp(logit(clampP(smoothed)) - logit(clampP(expected)), MAX_SHIFT), n, wins, expected };
}

export function buildCalibration(ledger) {
  const graded = (ledger?.picks || []).filter(decided);
  const global = shiftFor(graded);
  const groups = {};
  for (const p of graded) (groups[`${p.sport}:${p.market}`] ||= []).push(p);
  const adjustments = {};
  for (const [k, list] of Object.entries(groups)) {
    const own = shiftFor(list);
    const w = own.n / (own.n + PRIOR_PICKS);
    adjustments[k] = { ...own, shift: clamp(w * own.shift + (1 - w) * global.shift, MAX_SHIFT) };
  }
  return {
    global, adjustments,
    shift(sport, market) { return adjustments[`${sport}:${market}`]?.shift ?? global.shift; },
    adjust(sport, market, prob) { return sigmoid(logit(clampP(prob)) + this.shift(sport, market)); },
  };
}

// Record-page summary: overall record, breakdowns, calibration buckets and what was learned.
export function summarize(ledger, sportNames = {}) {
  const picks = ledger?.picks || [];
  const graded = picks.filter((p) => ['win', 'loss', 'push'].includes(p.status));
  const tally = (list) => {
    const w = list.filter((p) => p.status === 'win').length;
    const l = list.filter((p) => p.status === 'loss').length;
    const pu = list.filter((p) => p.status === 'push').length;
    const units = round2(list.reduce((a, p) => a + (p.units || 0), 0));
    const risked = w + l;
    return { picks: list.length, wins: w, losses: l, pushes: pu, winPct: risked ? w / risked : null, units, roi: risked ? units / risked : null };
  };
  const by = (keyFn, labelFn) => {
    const m = new Map();
    for (const p of graded) { const k = keyFn(p); if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
    return [...m.entries()].map(([k, list]) => ({ key: k, label: labelFn(k), ...tally(list) })).sort((a, b) => b.picks - a.picks);
  };
  const band = (s) => (s >= 800 ? '800+' : s >= 650 ? '650–799' : '500–649');

  // Calibration buckets by the probability the model gave at the time (before any later learning).
  const buckets = [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 1.01]].map(([lo, hi]) => {
    const list = graded.filter((p) => decided(p) && p.prob >= lo && p.prob < hi);
    const wins = list.filter((p) => p.status === 'win').length;
    return { range: [lo, Math.min(hi, 1)], n: list.length, predicted: list.length ? list.reduce((a, p) => a + p.prob, 0) / list.length : (lo + Math.min(hi, 1)) / 2, actual: list.length ? wins / list.length : null };
  });

  const cal = buildCalibration(ledger);
  const learned = Object.entries(cal.adjustments).map(([k, a]) => {
    const [sport, market] = k.split(':');
    const at60 = sigmoid(logit(0.6) + a.shift);
    return { sport, sportName: sportNames[sport] || sport, market, n: a.n, wins: a.wins, expected: a.expected, shift: round3(a.shift), at60: round3(at60) };
  }).sort((a, b) => b.n - a.n);

  const factor = (name, test) => {
    const yes = graded.filter(test), no = graded.filter((p) => !test(p));
    return { name, with: tally(yes), without: tally(no) };
  };

  return {
    minScore: ledger?.minScore ?? 500, started: ledger?.started, updated: new Date().toISOString(),
    overall: tally(graded),
    pending: picks.filter((p) => p.status === 'pending').length,
    bySport: by((p) => p.sport, (k) => sportNames[k] || k),
    byMarket: by((p) => p.market, (k) => ({ spread: 'Spreads', total: 'Totals', prop: 'Player props' }[k] || k)),
    byBand: by((p) => band(p.score), (k) => k).sort((a, b) => a.key.localeCompare(b.key)),
    buckets,
    learning: { global: { n: cal.global.n, shift: round3(cal.global.shift), at60: round3(sigmoid(logit(0.6) + cal.global.shift)) }, groups: learned, priorPicks: PRIOR_PICKS },
    factors: [factor('Sharp money agreed', (p) => p.factors?.sharp), factor('Coaching note on this market', (p) => (p.factors?.notes || []).length > 0)],
    picks: [...picks].sort((a, b) => b.start.localeCompare(a.start)),
  };
}

const round2 = (x) => Math.round(x * 100) / 100;
const round3 = (x) => Math.round(x * 1000) / 1000;
