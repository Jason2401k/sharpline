# SharpLine

Sports betting research site: game lines with coaching-style analysis, public money splits, injuries,
and weekly Best Value / Best Lock picks scored 1–1000. NFL and college basketball first.

**Site:** https://jason2401k.github.io/sharpline/

**Refresh the data:** Actions tab → **Refresh site data** → **Run workflow** (about a minute).

- `app/` — the app: data connectors, models, frontend and tests. See `app/README.md`.
- `.github/workflows/refresh-site.yml` — on-demand job that tests, builds and publishes the site.

Data: real schedules and DraftKings lines via ESPN, SportsBettingDime public splits, ESPN injuries and team stats,
optional KenPom (your own export, stored as a repo secret).

For research and entertainment only. 21+. Gambling problem? Call 1-800-GAMBLER.
