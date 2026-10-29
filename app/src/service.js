// Assembles a "board" per sport: games + model analysis + public-money signals + props + injuries.
// Lines: The Odds API when ODDS_API_KEY is set, otherwise DraftKings lines via ESPN's scoreboard.
// Team ratings and coaching tendencies: ESPN standings + team stats. Injuries: ESPN.
// Made-up sample data appears only with SHOW_DEMO=1. The board reports every section's source
// (`sources`) so the UI can label it honestly.

import { SPORTS, SPORT_PARAMS, STAT_LABELS } from './config.js';
import { buildDemo } from './data/demo.js';
import { analyzeGame } from './model/game.js';
import { projectProp } from './model/props.js';
import { publicSignals } from './model/public.js';
import { buildPicks } from './model/picks.js';
import { confidenceScore, impliedProb, expectedValue, round, STRONG_SCORE } from './model/math.js';
import { loadLedger, ledgerPath } from './tracker/ledger.js';
import { buildCalibration, summarize } from './tracker/calibrate.js';
import fs from 'node:fs';
import { fetchGames, fetchProps } from './sources/odds-api.js';
import { fetchInjuries } from './sources/espn.js';
import { fetchSchedule, fetchStandings, buildLiveTeams } from './sources/espn-live.js';
import { abbrFor } from './sources/odds-api.js';
import { fetchSplits, mergeSbdSplits, sbdSupports } from './sources/sbd.js';
import { loadKenpom, findKenpom } from './sources/kenpom.js';
import { getJson } from './sources/http.js';
import { fetchPropLines, fetchRosters, fetchAllTeamIds, fetchGamelog, fetchDefenseVsPosition, ASSUMED_ODDS } from './sources/espn-props.js';

const env = process.env;
const demoCache = new Map();
const boardCache = new Map();
const BOARD_TTL = 2 * 60 * 1000;

export const sportById = (id) => SPORTS.find((s) => s.id === id);

function demo(sport) {
  if (!demoCache.has(sport.id)) demoCache.set(sport.id, buildDemo(sport, analyzeGame));
  return demoCache.get(sport.id);
}

export async function getBoard(sportId) {
  const sport = sportById(sportId);
  if (!sport) throw Object.assign(new Error(`Unknown sport ${sportId}`), { status: 404 });
  const cached = boardCache.get(sportId);
  if (cached && cached.expires > Date.now()) return cached.board;

  // Sample games/props/injuries are only shown when SHOW_DEMO=1. Otherwise a section with no
  // live source stays empty, so made-up matchups never pass for the real schedule.
  const d = demo(sport);
  const showDemo = env.SHOW_DEMO === '1';
  const fallback = showDemo ? 'demo' : 'none';
  const sources = { lines: fallback, linesProvider: null, props: fallback, injuries: fallback, public: fallback, profiles: showDemo ? 'demo' : 'none', errors: [] };
  let games = showDemo ? d.games : [], rawProps = showDemo ? d.props : [], injuries = showDemo ? d.injuries : [];
  let teams = showDemo ? d.teams : {}, unpriced = 0;
  const liveEspn = env.LIVE_ESPN !== '0';

  if (env.ODDS_API_KEY) {
    try {
      const known = liveEspn ? Object.values(await fetchStandings(sport).catch(() => ({}))) : [];
      games = await fetchGames(sport, env.ODDS_API_KEY, known.length ? known : Object.values(d.teams));
      for (const g of games) for (const side of ['home', 'away']) {
        const st = known.find((t) => t.abbr === g[side].abbr);
        if (st) g[side] = { ...g[side], id: st.id, name: st.name };
      }
      sources.lines = 'live'; sources.linesProvider = 'The Odds API (consensus of US books)';
      sources.public = 'none'; sources.props = 'none'; rawProps = [];
      if (sport.tier <= 2) {
        // Book prop lines are real; projections need a player-stats feed, so none are attached yet.
        rawProps = await fetchProps(sport, env.ODDS_API_KEY, games, Number(env.PROPS_EVENT_LIMIT || 6));
        sources.props = 'live';
      }
    } catch (e) {
      sources.errors.push(`The live odds feed couldn't be reached (${e.message}).`);
    }
  }
  if (sources.lines !== 'live' && liveEspn) {
    try {
      ({ games, unpriced } = await fetchSchedule(sport));
      sources.lines = 'live'; sources.linesProvider = games[0]?.book ? `${games[0].book} via ESPN` : 'ESPN';
      sources.public = 'none'; sources.props = 'none'; rawProps = [];
    } catch (e) {
      sources.errors.push(`ESPN's schedule couldn't be reached (${e.message}).`);
    }
  }
  if (sources.lines === 'live') {
    teams = {};
    try {
      teams = await buildLiveTeams(sport, games);
      sources.profiles = 'live';
      if (sport.id === 'ncaab') attachKenpom(teams, sources);
    } catch (e) {
      sources.profiles = 'none';
      sources.errors.push(`ESPN team stats couldn't be reached, so the model is off (${e.message}).`);
    }
  }
  // NFL player props from ESPN (DraftKings lines, player game logs, defense vs position).
  let propPlayers = new Map();
  if (sport.id === 'nfl' && sources.lines === 'live' && !env.ODDS_API_KEY && env.LIVE_ESPN !== '0') {
    try {
      const r = await buildNflProps(games);
      rawProps = r.props; propPlayers = r.players;
      sources.props = 'live';
      sources.propsProvider = 'DraftKings via ESPN';
      sources.propsNote = `ESPN publishes prop lines but not prices, so ${ASSUMED_ODDS} is assumed on both sides. Defense ranks use ${r.gamesCounted} completed games this season.`;
    } catch (e) {
      sources.errors.push(`NFL player props couldn't be loaded (${e.message}).`);
    }
  }

  if (env.LIVE_INJURIES !== '0') {
    try {
      const live = await fetchInjuries(sport);
      if (live.length) { injuries = live; sources.injuries = 'live'; }
      else if (!showDemo) sources.injuries = 'unavailable';
    } catch (e) {
      sources.errors.push("ESPN's injury feed couldn't be reached, so no injuries are shown.");
    }
  }
  if (sources.lines === 'live' && env.PUBLIC_SPLITS_URL) {
    try { await mergeSplits(sport, games); sources.public = 'live'; } catch (e) { sources.errors.push(`Splits feed: ${e.message}`); }
  } else if (sources.lines === 'live' && env.LIVE_SBD !== '0' && sbdSupports(sport)) {
    try {
      const matched = mergeSbdSplits(games, await fetchSplits(sport));
      sources.public = matched ? 'live' : 'none';
      sources.publicProvider = 'SportsBettingDime';
    } catch (e) {
      sources.errors.push(`SportsBettingDime's betting splits couldn't be reached (${e.message}).`);
    }
  }

  const injuryByPlayer = new Map(injuries.map((i) => [i.player, i]));
  const params = SPORT_PARAMS[sport.kind];

  const outGames = games.map((g) => {
    const analysis = analyzeGame(sport, g, teams);
    const gameInjuries = injuries.filter((i) => [g.home.abbr, g.away.abbr].includes(i.team) || [g.home.name, g.away.name].includes(i.teamName));
    const signals = publicSignals(g) || [];
    // 1-1000 confidence on each side the model leans to.
    const sharpOn = (market, side) => signals.some((s) => s.market === market && s.side === side);
    // Apply what the tracker has learned from graded picks, then score.
    const cal = calibration();
    for (const [market, pick] of [['spread', analysis.spreadPick], ['total', analysis.totalPick]]) {
      if (!pick) continue;
      pick.rawProb = pick.prob;
      pick.calShift = round(cal.shift(sport.id, market), 3);
      if (!pick.calShift) continue;
      pick.prob = round(cal.adjust(sport.id, market, pick.prob), 3);
      pick.edge = round(pick.prob - impliedProb(pick.odds), 3);
      pick.ev = round(expectedValue(pick.prob, pick.odds), 3);
    }
    if (analysis.spreadPick) analysis.spreadPick.score = confidenceScore(analysis.spreadPick.prob, { edge: analysis.spreadPick.edge, games: analysis.minGames, sharp: sharpOn('spread', g[analysis.spreadPick.side].abbr) });
    if (analysis.totalPick) analysis.totalPick.score = confidenceScore(analysis.totalPick.prob, { edge: analysis.totalPick.edge, games: analysis.minGames, sharp: sharpOn('total', analysis.totalPick.side) });
    return { ...g, analysis, signals, injuries: gameInjuries };
  });

  const props = rawProps
    .filter((p) => injuryByPlayer.get(p.player)?.status !== 'Out')
    .map((p) => {
      const player = showDemo ? d.players.find((x) => x.id === p.playerId || x.name === p.player) : propPlayers.get(p.playerId);
      const game = outGames.find((g) => g.id === p.gameId);
      const model = player && !game?.live ? projectProp({ prop: p, player, defense: p.defense, game, leagueTotal: params.leagueTotal[sport.id], injury: injuryByPlayer.get(p.player) }) : null;
      if (model) {
        // Apply what the tracker has learned about props, then score.
        model.preCal = model.prob;
        const shift = calibration().shift(sport.id, 'prop');
        if (shift) {
          model.prob = round(calibration().adjust(sport.id, 'prop', model.prob), 3);
          model.edge = round(model.prob - impliedProb(model.odds), 3);
          model.ev = round(expectedValue(model.prob, model.odds), 3);
        }
        model.score = confidenceScore(model.prob, { edge: model.edge, games: model.games, injury: model.injury });
        // Role changes, tiny lines and thin samples can't be rated strong (kept below STRONG_SCORE).
        if (model.cautions?.length) model.score = Math.min(model.score, STRONG_SCORE - 1);
        if (player.games) model.recent = player.games.slice(0, model.last10.length);
      }
      return {
        id: p.id, player: p.player, team: p.team || player?.team, pos: p.pos || player?.pos, opp: p.opp || player?.opp,
        stat: p.stat, statLabel: STAT_LABELS[p.stat] || p.stat, line: p.line, open: p.open, overOdds: p.overOdds, underOdds: p.underOdds, book: p.book,
        playerId: p.playerId, gameId: p.gameId, start: game?.start, live: Boolean(game?.live),
        matchup: game ? `${game.away.abbr} @ ${game.home.abbr}` : '', model,
      };
    })
    .sort((a, b) => (b.model?.edge ?? -1) - (a.model?.edge ?? -1));

  const board = { sport, sources, updated: new Date().toISOString(), games: outGames, unpriced, props, injuries };
  boardCache.set(sportId, { board, expires: Date.now() + BOARD_TTL });
  return board;
}

// PUBLIC_SPLITS_URL: JSON array of { home, away, spread:{homeTickets,homeMoney}, total:{overTickets,overMoney}, moneyline:{...} }.
async function mergeSplits(sport, games) {
  const rows = await getJson(env.PUBLIC_SPLITS_URL.replace('{sport}', sport.id), { ttlMs: 5 * 60 * 1000 });
  for (const g of games) {
    const row = rows.find((r) => [g.home.name, g.home.abbr].includes(r.home) && [g.away.name, g.away.abbr].includes(r.away));
    if (row) g.public = { spread: row.spread, total: row.total, moneyline: row.moneyline };
  }
}

// KenPom (from your exported CSV) for college basketball. Missing file = model runs on ESPN stats.
function attachKenpom(teams, sources) {
  sources.kenpom = { status: 'none', matched: 0, total: Object.keys(teams).length };
  let kp;
  try { kp = loadKenpom(); } catch (e) { sources.errors.push(`KenPom file couldn't be read: ${e.message}`); return; }
  if (!kp) return;
  for (const t of Object.values(teams)) {
    const r = findKenpom(kp, t);
    if (!r) continue;
    t.kenpom = { ...r, avgEff: kp.avgEff, avgTempo: kp.avgTempo };
    Object.assign(t.coaching, { kenpomRank: r.rank, kenpomEM: r.adjEM, kenpomO: r.adjO, kenpomD: r.adjD, kenpomT: r.adjT });
    sources.kenpom.matched++;
  }
  sources.kenpom.status = 'live';
  sources.kenpom.updated = kp.updated;
}

export async function getAllBoards() {
  return Promise.all(SPORTS.map((s) => getBoard(s.id)));
}

// Prop lines for upcoming NFL games + each player's game log + defense vs position.
async function buildNflProps(games) {
  const upcoming = games.filter((g) => !g.live && String(g.id).startsWith('espn-'));
  const lines = await fetchPropLines(upcoming.map((g) => g.id.slice(5)));
  const rosters = await fetchRosters(await fetchAllTeamIds());
  const { dvp, gamesCounted } = await fetchDefenseVsPosition(rosters);
  const ids = [...new Set(lines.map((l) => l.athleteId))];
  const logs = new Map();
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < ids.length) { const id = ids[i++]; logs.set(id, await fetchGamelog(id).catch(() => null)); }
  }));
  const players = new Map();
  const props = [];
  for (const l of lines) {
    const who = rosters.get(l.athleteId);
    const g = upcoming.find((x) => x.id === `espn-${l.eventId}`);
    if (!who || !g) continue;
    const opp = who.team === g.home.abbr ? g.away.abbr : who.team === g.away.abbr ? g.home.abbr : null;
    if (!opp) continue;
    const log = logs.get(l.athleteId);
    if (log && !players.has(l.athleteId)) players.set(l.athleteId, { name: who.name, team: who.team, pos: who.pos, logs: log.logs, games: log.games });
    props.push({
      id: `${g.id}:${l.athleteId}:${l.stat}`, playerId: l.athleteId, player: who.name, team: who.team, pos: who.pos, opp,
      stat: l.stat, line: l.line, open: l.open, overOdds: ASSUMED_ODDS, underOdds: ASSUMED_ODDS, book: 'DraftKings', gameId: g.id,
      defense: dvp[opp]?.[`${who.pos}:${l.stat}`] || null,
    });
  }
  return { props, players, gamesCounted };
}

// Calibration learned from the pick ledger (re-read when the file changes).
let calCache = { mtime: -1, cal: buildCalibration(null) };
function calibration() {
  const file = ledgerPath();
  const mtime = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
  if (mtime !== calCache.mtime) calCache = { mtime, cal: buildCalibration(mtime ? loadLedger(file) : null) };
  return calCache.cal;
}

export function resetBoards() { boardCache.clear(); }

export function getRecord() {
  return summarize(loadLedger(), Object.fromEntries(SPORTS.map((s) => [s.id, s.short])));
}

export async function getPicks() {
  const boards = await getAllBoards();
  return {
    ...buildPicks(boards), updated: new Date().toISOString(),
    demo: boards.some((b) => b.sources.lines === 'demo'),
    live: boards.some((b) => b.sources.lines === 'live'),
    errors: [...new Set(boards.flatMap((b) => b.sources.errors))],
  };
}

export async function getInjuries() {
  const boards = await getAllBoards();
  return boards.filter((b) => b.sport.tier <= 3).map((b) => ({ sport: b.sport, source: b.sources.injuries, injuries: b.injuries }));
}
