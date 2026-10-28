# SharpLine: sports betting research site

Model-driven betting research for **NFL and college basketball first**, then NBA and college football, then MLB, NHL and soccer.

| Feature | Where |
|---|---|
| **Best Value & Best Lock picks** for the week, ranked across all sports (NFL/CBB weighted highest) | Home page |
| **Player-prop prediction model**: recent form vs. book line + opponent defense vs. position + pace + game script | Sport → Player Props (click a row) |
| **Coaching-style analysis** for game lines: tempo, pass rate, 4th-down aggression, halftime adjustments, defensive scheme, late-game execution, ATS | Sport → Game Lines → "Coaching breakdown" |
| **Live injury wire**: ticker + per-sport reports, refreshes every 3 min, flagged on games and props | Ticker, Injuries tab |
| **Public money %**: tickets vs. money, sharp-split and reverse-line-move flags | Sport → Public Money |

## Run it

Requires Node 18+. It has no dependencies, so there's nothing to install.

```bash
npm start            # http://localhost:3000
npm test             # model + adapter tests
```

With no live data connected, the site shows **no games** and a "Not connected" notice in each section. It never shows a made-up schedule. To test the UI with made-up sample games, props and injuries, set `SHOW_DEMO=1` (every screen then carries a "Sample data" badge).

`npm run build:static` writes a static snapshot of the current data to `dist/` for hosting without Node.

## Hosting: GitHub Pages, refreshed hourly

`.github/workflows/refresh-site.yml` (at the repo root) runs every hour, plus on every push to `main` and on demand:

1. runs the tests;
2. builds a static snapshot with fresh games, lines, splits and injuries (`npm run build:static -- --pages`);
3. checks that live lines actually loaded, and stops if they didn't, so a data outage never replaces a good site with an empty one;
4. publishes the snapshot to GitHub Pages.

One-time setup: **Settings → Pages → Source: GitHub Actions**. Optional KenPom: **Settings → Secrets and variables → Actions → New repository secret**, named `KENPOM_CSV`, with your exported CSV pasted in as the value. The workflow writes it to `data/kenpom.csv` during the build, and it never lands in the repo.

To run the live app with a server instead (refreshes every few minutes), see `npm start` above.

## Live data out of the box

With network access and no keys at all, the site pulls from ESPN's public endpoints:

- **Schedule and lines:** every sport's games for the next 7 days, with DraftKings spread, total and moneyline (current and opening). Games without a posted line are counted, not shown.
- **Team ratings:** points scored and allowed per game, from standings.
- **Coaching profiles:** real tendencies from team stats.
  - Football: plays per game, pass rate, 4th-down tries and conversion, 3rd-down rate, red-zone TD rate.
  - Basketball: tempo, 3-point rate, turnover rate, assist/turnover ratio.
  - Metrics ESPN doesn't publish (blitz rate, defensive scheme, halftime adjustments, ATS) show "—".
- **Injuries:** NFL, NBA, NHL and MLB. ESPN has no current report for college sports or soccer.

College basketball uses last season's stats until the new season starts. Games where a team has played fewer than 4 games, or that rely on last season, get a model line but are kept out of the picks. Set `LIVE_ESPN=0` to turn ESPN off.

### Public betting splits

Ticket % and money % come from SportsBettingDime's public-betting-trends pages (NFL, college football, college basketball, NBA, NHL, MLB). The site reads the data feed behind those pages. It isn't a documented API and can change without notice. `LIVE_SBD=0` turns it off.

### KenPom

College basketball uses KenPom when you provide your own export. See `data/README.md`.

## Add more live data

Copy `.env.example` to `.env` and fill in:

| Variable | What it turns on | Cost |
|---|---|---|
| `ODDS_API_KEY` | Player props, plus consensus spreads, totals and moneylines from [The Odds API](https://the-odds-api.com) (consensus of US books) | Free tier = 500 credits/mo. Props cost credits per game, so cap with `PROPS_EVENT_LIMIT` |
| `LIVE_INJURIES=1` (default) | ESPN's public injury feed | Free, no key |
| `PUBLIC_SPLITS_URL` | Ticket/money % from a feed you subscribe to (Action Network, VSIN, Sports Insights…). The URL must return `[{home, away, spread:{homeTickets,homeMoney}, total:{overTickets,overMoney}, moneyline:{homeTickets,homeMoney}}]`; `{sport}` in the URL is replaced with the sport id | Paid. There is no free source for this |

### What's still sample data after you add keys

- **Player game logs and defense-vs-position numbers.** The model needs per-game stats. In live mode, props for players in the sample set get projections. Others show "no stats" until a stats feed is wired into `src/service.js` (`enrichLiveProps`). SportsDataIO, Sportradar and BALLDONTLIE are good options.
- **Coaching profiles** (`src/data/demo.js` → `coachingProfile`). These are generated sample metrics. Replace them with real numbers, for example from nflverse/rbsdm.com for NFL (pace, pass rate over expected, 4th-down decisions) and KenPom/BartTorvik for college hoops (tempo, 3PA rate). The analysis code in `src/model/game.js` uses them unchanged.
- **Line movement "open"** is the first line the server saw, because The Odds API's historical opening lines cost extra.

## How the models work

**Props** (`src/model/props.js`)
1. Baseline = 40% last-5 avg + 30% last-10 + 30% season.
2. × defense factor = (what the opponent allows to that position ÷ league avg), clamped 0.8–1.2 and damped (^0.6).
3. × pace factor from the game total, and × game script (underdogs pass more, favorites run more).
4. P(over) from a normal distribution of the player's own variance (Poisson for TDs, threes, assists, receptions).
5. The probability is **blended 60/40 with the book's no-vig price**. Markets are sharp, and raw models are overconfident.
6. Edge = model prob − implied prob. The grade (A–D) mixes edge, L10 hit rate, sample size and injury status.

**Game lines** (`src/model/game.js`): projected score from offense/defense ratings and home advantage, adjusted for coaching tempo (in college the slower team controls it), 4th-down aggression, red-zone efficiency, second-half adjustments and after-timeout efficiency. Every adjustment comes with a plain-English note.

**Picks** (`src/model/picks.js`)
- **Value** = highest EV × sport weight (tier 1: 1.0, tier 2: 0.9, tier 3: 0.75).
- **Locks** = win prob ≥ 57%, grade A/B, no Questionable/Doubtful/Out tag, odds no worse than −200.
- Picks that agree with sharp money get a boost. At most 2 picks per game.

## Project layout

```
server.js               zero-dependency HTTP server + JSON API
src/config.js           sports, tiers, model constants
src/service.js          builds each sport's board (live or demo per section)
src/model/              props, game/coaching, public-money signals, picks
src/sources/            The Odds API + ESPN adapters
src/data/demo.js        seeded sample dataset
public/                 frontend (index.html, app.js, styles.css)
test/                   node:test suite
screenshots/            reference screenshots
```

API: `/api/sports`, `/api/board/:sport`, `/api/picks`, `/api/injuries`, `/api/health`.

## Responsible use

Projections are estimates. No model wins every bet, and the sportsbooks' margin is real. This is a research tool, not financial advice. 21+, where legal. Problem gambling help: **1-800-GAMBLER**.
