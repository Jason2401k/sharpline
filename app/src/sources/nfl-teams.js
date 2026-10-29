// League-wide NFL offense/defense profiles for the Concentrated Breakdown: every team's per-game
// production and what its defense allows, each ranked 1-32 across the whole league.

import { fetchStandings, fetchTeamStats } from './espn-live.js';

const NFL = { id: 'nfl', espn: 'football/nfl', kind: 'football' };

// metric -> [label, higher is better for the team?]
export const OFFENSE_METRICS = {
  points: ['Points / game', true], totalYds: ['Total yards / game', true], passYds: ['Passing yards / game', true],
  rushYds: ['Rushing yards / game', true], plays: ['Plays / game', null], passRate: ['Pass rate', null],
  thirdDown: ['3rd-down conversion', true], redZone: ['Red-zone TD rate', true],
  sacksTaken: ['Sacks taken / game', false], giveaways: ['Giveaways / game', false],
};
export const DEFENSE_METRICS = {
  pointsAllowed: ['Points allowed / game', false], sacks: ['Sacks / game', true], takeaways: ['Takeaways / game', true],
  'QB:pass_yds': ['Passing yards allowed to QBs', false], 'QB:pass_tds': ['Passing TDs allowed', false],
  'RB:rush_yds': ['Rushing yards allowed to RBs', false], 'RB:receptions': ['Catches allowed to RBs', false],
  'WR:rec_yds': ['Receiving yards allowed to WRs', false], 'WR:receptions': ['Catches allowed to WRs', false],
  'TE:rec_yds': ['Receiving yards allowed to TEs', false], 'TE:receptions': ['Catches allowed to TEs', false],
};

const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);

export async function fetchNflTeamProfiles(dvp = {}) {
  const standings = await fetchStandings(NFL);
  const teams = Object.values(standings);
  const stats = await Promise.all(teams.map((t) => fetchTeamStats(NFL, t.id).catch(() => null)));
  const raw = {};
  teams.forEach((t, i) => {
    const s = stats[i]?.stats || {};
    const gp = s['passing.teamGamesPlayed'] || t.gp || 1;
    const passAtt = (s['passing.passingAttempts'] ?? 0) + (s['passing.sacks'] ?? 0);
    const rushAtt = s['rushing.rushingAttempts'] ?? 0;
    const give = (s['passing.interceptions'] ?? 0) + (s['general.fumblesLost'] ?? s['rushing.rushingFumblesLost'] ?? 0);
    raw[t.abbr] = {
      name: t.name, games: gp,
      offense: {
        points: t.pf, totalYds: s['passing.yardsPerGame'], passYds: s['passing.netPassingYardsPerGame'], rushYds: s['rushing.rushingYardsPerGame'],
        plays: passAtt + rushAtt ? (passAtt + rushAtt) / gp : null, passRate: passAtt + rushAtt ? (passAtt / (passAtt + rushAtt)) * 100 : null,
        thirdDown: s['miscellaneous.thirdDownConvPct'], redZone: s['miscellaneous.redzoneTouchdownPct'],
        sacksTaken: s['passing.sacks'] != null ? s['passing.sacks'] / gp : null, giveaways: give / gp,
      },
      defense: {
        pointsAllowed: t.pa,
        sacks: s['defensive.sacks'] != null ? s['defensive.sacks'] / gp : null,
        takeaways: s['miscellaneous.totalTakeaways'] != null ? s['miscellaneous.totalTakeaways'] / gp : null,
        ...Object.fromEntries(Object.keys(DEFENSE_METRICS).filter((k) => k.includes(':')).map((k) => [k, dvp[t.abbr]?.[k]?.allowed ?? null])),
      },
    };
  });

  // Rank 1 = best for that team (most points scored, fewest allowed, most sacks...). Metrics with
  // no better/worse direction (plays, pass rate) rank 1 = highest.
  const out = {};
  for (const [abbr, t] of Object.entries(raw)) out[abbr] = { name: t.name, games: t.games, offense: {}, defense: {} };
  for (const [side, defs] of [['offense', OFFENSE_METRICS], ['defense', DEFENSE_METRICS]]) {
    for (const [k, [label, higherBetter]] of Object.entries(defs)) {
      const vals = Object.entries(raw).map(([a, t]) => [a, t[side][k]]).filter(([, v]) => v != null && Number.isFinite(v));
      const sorted = [...vals].sort((x, y) => (higherBetter === false ? x[1] - y[1] : y[1] - x[1]));
      sorted.forEach(([a, v], i) => { out[a][side][k] = { value: r1(v), rank: i + 1, of: sorted.length, label, higherBetter }; });
    }
  }
  // Position-vs-defense ranks come straight from the same numbers the Player Props tab uses, so
  // the two pages always agree.
  for (const [abbr, t] of Object.entries(out)) {
    for (const k of Object.keys(DEFENSE_METRICS).filter((x) => x.includes(':'))) {
      const d = dvp[abbr]?.[k];
      if (d) t.defense[k] = { value: r1(d.allowed), rank: d.rank, of: d.teams, label: DEFENSE_METRICS[k][0], higherBetter: false };
    }
  }
  return out;
}
