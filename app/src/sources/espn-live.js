// ESPN public endpoints (no key): real schedule + DraftKings lines from the scoreboard, team
// ratings from standings, and coaching-style tendencies from team statistics.

import { getJson } from './http.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const V2 = 'https://site.api.espn.com/apis/v2/sports';
const TTL = { board: 5 * 60 * 1000, stats: 6 * 60 * 60 * 1000 };
// Division I hoops and FBS football need a group filter, or ESPN returns only featured games.
const GROUPS = { ncaab: '&groups=50&limit=400', ncaaf: '&groups=80&limit=300' };
const LEAGUE = { nfl: { plays: 63, passRate: 58 }, ncaaf: { plays: 70, passRate: 50 } };

const num = (v) => {
  if (v == null || v === '') return null;
  if (String(v).toUpperCase() === 'EVEN') return 100;
  const n = Number(String(v).replace(/^[ou]/i, ''));
  return Number.isFinite(n) ? n : null;
};
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); }
  }));
  return out;
}

// Upcoming games over the next `days` days. Games without a posted line are counted, not shown.
export async function fetchSchedule(sport, { days = 7, now = new Date() } = {}) {
  const dates = Array.from({ length: days }, (_, i) => ymd(new Date(now.getTime() + i * 86400000)));
  const boards = await pool(dates, 4, (d) => getJson(`${SITE}/${sport.espn}/scoreboard?dates=${d}${GROUPS[sport.id] || ''}`, { ttlMs: TTL.board }));
  const seen = new Set();
  const games = [];
  let unpriced = 0;
  for (const b of boards) {
    for (const ev of b?.events || []) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      const c = ev.competitions?.[0];
      if (!c || c.status?.type?.state !== 'pre') continue;
      const side = (h) => c.competitors.find((x) => x.homeAway === h);
      const H = side('home'), A = side('away');
      if (!H || !A) continue;
      const team = (x) => ({
        id: x.team.id, abbr: x.team.abbreviation, name: x.team.displayName, location: x.team.location, shortName: x.team.shortDisplayName,
        record: x.records?.find((r) => r.type === 'total' || r.name === 'overall')?.summary || null,
        homeRecord: x.records?.find((r) => r.type === 'home')?.summary || null,
        awayRecord: x.records?.find((r) => r.type === 'road')?.summary || null,
      });
      const game = { id: `espn-${ev.id}`, start: ev.date, home: team(H), away: team(A), neutral: Boolean(c.neutralSite) };
      const o = c.odds?.[0];
      const ps = o?.pointSpread, tot = o?.total, ml = o?.moneyline;
      const spreadLine = num(ps?.home?.close?.line) ?? spreadFromDetails(o, game);
      if (spreadLine != null) game.spread = { line: spreadLine, homeOdds: num(ps?.home?.close?.odds) ?? -110, awayOdds: num(ps?.away?.close?.odds) ?? -110, open: num(ps?.home?.open?.line) ?? spreadLine };
      const totalLine = num(tot?.over?.close?.line) ?? num(o?.overUnder);
      if (totalLine != null) game.total = { line: totalLine, overOdds: num(tot?.over?.close?.odds) ?? -110, underOdds: num(tot?.under?.close?.odds) ?? -110, open: num(tot?.over?.open?.line) ?? totalLine };
      if (ml?.home?.close?.odds) game.moneyline = { home: num(ml.home.close.odds), away: num(ml.away?.close?.odds), homeOpen: num(ml.home.open?.odds), awayOpen: num(ml.away?.open?.odds), draw: num(ml.draw?.close?.odds) };
      if (!game.spread && !game.total && !game.moneyline) { unpriced++; continue; }
      game.book = o?.provider?.name || 'Sportsbook';
      games.push(game);
    }
  }
  games.sort((a, b) => a.start.localeCompare(b.start));
  return { games, unpriced };
}

function spreadFromDetails(o, game) {
  const m = String(o?.details || '').match(/^(\S+)\s+([-+]?\d+(\.\d+)?)$/);
  if (!m) return null;
  const v = Math.abs(Number(m[2]));
  if (m[1] === game.home.abbr) return -v;
  if (m[1] === game.away.abbr) return v;
  return null;
}

// Standings -> points scored/allowed per game for every team in the league.
export async function fetchStandings(sport) {
  const data = await getJson(`${V2}/${sport.espn}/standings`, { ttlMs: TTL.stats });
  const entries = [];
  const walk = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n.entries)) entries.push(...n.entries); for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v); };
  walk(data);
  const out = {};
  for (const e of entries) {
    const abbr = e.team?.abbreviation;
    if (!abbr) continue;
    // Split records (home/away/conference) repeat the same stat names, so keep the first (overall).
    const s = {};
    for (const st of e.stats || []) if (!(st.name in s) && st.value != null) s[st.name] = st.value;
    // Some leagues (college football) omit losses; the overall "W-L" summary is authoritative.
    const overall = (e.stats || []).find((st) => st.type === 'total' || st.name === 'overall')?.displayValue;
    const wl = overall?.match(/^(\d+)-(\d+)(?:-(\d+))?$/);
    const gp = wl ? wl.slice(1).reduce((a, x) => a + Number(x || 0), 0) : s.gamesPlayed ?? (s.wins ?? 0) + (s.losses ?? 0) + (s.ties ?? 0) + (s.otLosses ?? 0);
    if (!gp) continue;
    const row = { id: e.team.id, abbr, name: e.team.displayName, gp, pf: s.avgPointsFor ?? s.pointsFor / gp, pa: s.avgPointsAgainst ?? s.pointsAgainst / gp };
    if (!out[abbr] || out[abbr].gp < gp) out[abbr] = row;
  }
  return out;
}

export async function fetchTeamStats(sport, teamId) {
  const d = await getJson(`${SITE}/${sport.espn}/teams/${teamId}/statistics`, { ttlMs: TTL.stats });
  const flat = {};
  for (const c of d.results?.stats?.categories || []) for (const s of c.stats || []) if (!(`${c.name}.${s.name}` in flat)) flat[`${c.name}.${s.name}`] = s.value;
  return { stats: flat, seasonType: d.season?.name || '', seasonLabel: d.season?.displayName || '' };
}

// Real team ratings + coaching tendencies for every team in `games`.
export async function buildLiveTeams(sport, games) {
  const standings = await fetchStandings(sport);
  const inPlay = new Map();
  for (const g of games) for (const t of [g.home, g.away]) inPlay.set(t.abbr, t);
  const teams = {};
  const needStats = sport.kind === 'football' || sport.kind === 'basketball';
  const statRows = needStats ? await pool([...inPlay.values()], 8, (t) => fetchTeamStats(sport, t.id)) : [];
  const list = [...inPlay.values()];

  for (const [i, t] of list.entries()) {
    const st = standings[t.abbr];
    if (!st) continue;
    const ts = statRows[i];
    const prior = /preseason/i.test(ts?.seasonType || '');
    const base = { abbr: t.abbr, name: t.name, location: t.location, shortName: t.shortName, sample: { games: st.gp, priorSeason: prior, label: prior ? 'last season' : 'this season' } };
    const recordFields = { ats: null, record: t.record, homeRecord: t.homeRecord, awayRecord: t.awayRecord };
    if (sport.kind === 'football') {
      const s = ts?.stats || {};
      const gp = s['passing.teamGamesPlayed'] || st.gp;
      const passAtt = (s['passing.passingAttempts'] ?? 0) + (s['passing.sacks'] ?? 0);
      const rushAtt = s['rushing.rushingAttempts'] ?? 0;
      teams[t.abbr] = {
        ...base,
        ratings: { off: st.pf, def: st.pa },
        coaching: {
          ...recordFields,
          playsPerGame: passAtt + rushAtt ? round1((passAtt + rushAtt) / gp) : null,
          passRate: passAtt + rushAtt ? Math.round((passAtt / (passAtt + rushAtt)) * 100) : null,
          fourthDownAttPerGame: s['miscellaneous.fourthDownAttempts'] != null ? round1(s['miscellaneous.fourthDownAttempts'] / gp) : null,
          fourthDownConvPct: s['miscellaneous.fourthDownConvPct'] != null ? Math.round(s['miscellaneous.fourthDownConvPct']) : null,
          redZoneTd: s['miscellaneous.redzoneTouchdownPct'] != null ? Math.round(s['miscellaneous.redzoneTouchdownPct']) : null,
          thirdDownPct: s['miscellaneous.thirdDownConvPct'] != null ? Math.round(s['miscellaneous.thirdDownConvPct']) : null,
          fourthDownAgg: null, secondHalfDiff: null, blitzRate: null, defScheme: null,
        },
      };
    } else if (sport.kind === 'basketball') {
      const s = ts?.stats || {};
      const fga = s['offensive.avgFieldGoalsAttempted'], orb = s['offensive.avgOffensiveRebounds'], to = s['offensive.avgTurnovers'], fta = s['offensive.avgFreeThrowsAttempted'];
      const poss = [fga, orb, to, fta].every((x) => x != null) ? fga - orb + to + 0.44 * fta : null;
      const tempo = poss ?? (sport.id === 'nba' ? 99 : 68);
      teams[t.abbr] = {
        ...base,
        ratings: { off: (st.pf / tempo) * 100, def: (st.pa / tempo) * 100 },
        coaching: {
          ...recordFields,
          tempo: poss != null ? round1(poss) : null,
          threeRate: fga ? Math.round((s['offensive.avgThreePointFieldGoalsAttempted'] / fga) * 100) : null,
          toRate: poss ? round1((to / poss) * 100) : null,
          astTo: s['general.assistTurnoverRatio'] != null ? round1(s['general.assistTurnoverRatio']) : null,
          defScheme: null, atoPPP: null, closeRecord: null, benchMinutes: null,
        },
      };
    } else {
      teams[t.abbr] = { ...base, ratings: { off: st.pf, def: st.pa }, coaching: { ...recordFields } };
    }
  }

  // 4th-down aggressiveness as a percentile among the teams on this slate.
  if (sport.kind === 'football') {
    const vals = Object.values(teams).map((t) => t.coaching.fourthDownAttPerGame).filter((v) => v != null).sort((a, b) => a - b);
    for (const t of Object.values(teams)) {
      const v = t.coaching.fourthDownAttPerGame;
      if (v != null && vals.length > 1) t.coaching.fourthDownAgg = Math.round((vals.filter((x) => x < v).length / (vals.length - 1)) * 100);
    }
  }
  for (const t of Object.values(teams)) t.coaching.style = styleOf(sport, t.coaching);
  return teams;
}

function styleOf(sport, c) {
  if (sport.kind === 'football') {
    const L = LEAGUE[sport.id];
    return [
      c.playsPerGame == null ? null : c.playsPerGame > L.plays + 2 ? 'Up-tempo' : c.playsPerGame < L.plays - 2 ? 'Methodical' : 'Balanced pace',
      c.passRate == null ? null : c.passRate > L.passRate + 4 ? 'pass-first' : c.passRate < L.passRate - 4 ? 'run-heavy' : 'balanced play-calling',
      c.fourthDownAgg == null ? null : c.fourthDownAgg >= 70 ? 'aggressive on 4th down' : c.fourthDownAgg <= 30 ? 'conservative on 4th down' : null,
    ].filter(Boolean).join(', ') || 'Not enough data yet';
  }
  if (sport.kind === 'basketball') {
    const L = sport.id === 'nba' ? { tempo: 99, three: 42 } : { tempo: 68, three: 39 };
    return [
      c.tempo == null ? null : c.tempo > L.tempo + 2 ? 'Fast-paced' : c.tempo < L.tempo - 2 ? 'Slow, half-court' : 'Moderate pace',
      c.threeRate == null ? null : c.threeRate > L.three + 4 ? '3-point heavy' : c.threeRate < L.three - 4 ? 'paint-focused' : 'balanced shot profile',
      c.toRate == null ? null : c.toRate < 12 ? 'protects the ball' : c.toRate > 17 ? 'turnover-prone' : null,
    ].filter(Boolean).join(', ') || 'Not enough data yet';
  }
  return '';
}

const round1 = (x) => Math.round(x * 10) / 10;
