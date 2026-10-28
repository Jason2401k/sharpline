// Sport catalog. `tier` drives nav prominence and pick weighting:
// 1 = featured (NFL, CBB), 2 = full features (NBA, CFB), 3 = lines + public money.
export const SPORTS = [
  { id: 'nfl',   name: 'NFL',                short: 'NFL',    tier: 1, kind: 'football',   oddsKey: 'americanfootball_nfl',  espn: 'football/nfl' },
  { id: 'ncaab', name: 'College Basketball', short: 'CBB',    tier: 1, kind: 'basketball', oddsKey: 'basketball_ncaab',      espn: 'basketball/mens-college-basketball' },
  { id: 'nba',   name: 'NBA',                short: 'NBA',    tier: 2, kind: 'basketball', oddsKey: 'basketball_nba',        espn: 'basketball/nba' },
  { id: 'ncaaf', name: 'College Football',   short: 'CFB',    tier: 2, kind: 'football',   oddsKey: 'americanfootball_ncaaf', espn: 'football/college-football' },
  { id: 'nhl',   name: 'NHL',                short: 'NHL',    tier: 3, kind: 'hockey',     oddsKey: 'icehockey_nhl',         espn: 'hockey/nhl' },
  { id: 'epl',   name: 'Soccer (EPL)',       short: 'Soccer', tier: 3, kind: 'soccer',     oddsKey: 'soccer_epl',            espn: 'soccer/eng.1' },
];

export const TIER_WEIGHT = { 1: 1.0, 2: 0.9, 3: 0.75 };

// Model constants per sport kind.
export const SPORT_PARAMS = {
  football:   { marginSd: { nfl: 13.5, ncaaf: 16 }, totalSd: { nfl: 10, ncaaf: 13 }, homeAdv: { nfl: 1.5, ncaaf: 2.5 }, leagueTotal: { nfl: 44.5, ncaaf: 54 } },
  basketball: { marginSd: { nba: 12, ncaab: 11 },  totalSd: { nba: 17, ncaab: 15 },  homeAdv: { nba: 2.0, ncaab: 3.0 }, leagueTotal: { nba: 228, ncaab: 145 } },
  baseball:   { marginSd: { mlb: 4.2 }, totalSd: { mlb: 3.3 }, homeAdv: { mlb: 0.15 }, leagueTotal: { mlb: 8.5 } },
  hockey:     { marginSd: { nhl: 2.4 }, totalSd: { nhl: 2.2 }, homeAdv: { nhl: 0.15 }, leagueTotal: { nhl: 6.0 } },
  soccer:     { marginSd: { epl: 1.6 }, totalSd: { epl: 1.6 }, homeAdv: { epl: 0.3 }, leagueTotal: { epl: 2.75 } },
};

// Prop markets requested from The Odds API, and how they map to our stat keys.
export const PROP_MARKETS = {
  football:   { player_pass_yds: 'pass_yds', player_pass_tds: 'pass_tds', player_rush_yds: 'rush_yds', player_reception_yds: 'rec_yds', player_receptions: 'receptions' },
  basketball: { player_points: 'points', player_rebounds: 'rebounds', player_assists: 'assists', player_threes: 'threes' },
};

export const STAT_LABELS = {
  pass_yds: 'Passing Yds', pass_tds: 'Passing TDs', rush_yds: 'Rushing Yds', rec_yds: 'Receiving Yds', receptions: 'Receptions',
  points: 'Points', rebounds: 'Rebounds', assists: 'Assists', threes: '3-Pointers Made',
};
