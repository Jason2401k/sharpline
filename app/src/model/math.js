// Small numeric helpers shared by the models.

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

// Standard normal CDF (Abramowitz & Stegun 7.1.26).
export function normCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// American odds -> implied probability (with vig) and decimal payout.
export const impliedProb = (odds) => (odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100));
export const profitPerUnit = (odds) => (odds < 0 ? 100 / -odds : odds / 100);

// Expected value per 1 unit staked.
export const expectedValue = (prob, odds) => prob * profitPerUnit(odds) - (1 - prob);

// Confidence on a 1-1000 scale; 1000 would be the most confident pick ever, so it's capped at 999.
// Driven mostly by the model's win probability (a 50/50 bet scores ~0, a sure thing ~1000), then
// adjusted for data quality: sharp-money agreement, size of the edge, sample size, injury tags.
const INJURY_HIT = { Questionable: 0.12, Doubtful: 0.3, 'Day-To-Day': 0.08, Probable: 0.02 };
export function confidenceScore(prob, { sharp = false, edge = 0, games = null, injury = null } = {}) {
  const base = clamp((prob - 0.5) / 0.5, 0, 1) ** 0.75;
  let quality = 0.9 + (sharp ? 0.06 : 0) + clamp(edge, 0, 0.1) * 0.4;
  if (games != null && games < 6) quality -= 0.05;
  quality -= INJURY_HIT[injury?.status] ?? 0;
  return Math.round(clamp(base * quality * 1000, 1, 999));
}

export function grade(score) {
  if (score >= 0.75) return 'A';
  if (score >= 0.55) return 'B';
  if (score >= 0.35) return 'C';
  return 'D';
}

// Blend a model probability with the market's no-vig probability. Betting markets are
// efficient, so a raw model is overconfident; shrinking toward the market keeps edges honest.
export const MARKET_WEIGHT = 0.6;
export function shrinkToMarket(modelProb, odds, otherOdds) {
  const a = impliedProb(odds), b = otherOdds != null ? impliedProb(otherOdds) : 1 - a;
  const fair = a / (a + b);
  return (1 - MARKET_WEIGHT) * modelProb + MARKET_WEIGHT * fair;
}
