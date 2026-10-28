# SharpLine

Sports betting research site: game lines with coaching-style analysis, public money splits, injuries,
and weekly Best Value / Best Lock picks scored 1–1000. NFL and college basketball first.

**Site:** https://jason2401k.github.io/sharpline/ (rebuilt hourly with fresh data)

- `app/` — the app: data connectors, models, frontend and tests. See `app/README.md`.
- `.github/workflows/refresh-site.yml` — hourly job that tests, builds and publishes the site.
- Root `index.html`, `app.js`, `styles.css`, `api/` — the last hand-published snapshot. Once Pages is set to
  "GitHub Actions", the hourly job serves the site instead, and these can be deleted.

Data: real schedules and DraftKings lines via ESPN, SportsBettingDime public splits, ESPN injuries and team stats,
optional KenPom (your own export, stored as a repo secret).

For research and entertainment only. 21+. Gambling problem? Call 1-800-GAMBLER.
