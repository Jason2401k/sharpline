# Data files

## kenpom.csv (college basketball)

KenPom doesn't allow automated access, so the site reads ratings you export yourself:

1. Sign in at kenpom.com and open the main ratings table.
2. Export or copy the table to CSV. Columns are matched by header name and must include
   `Team`, `AdjEM`, `AdjO`, `AdjD` and `AdjT`. `Rk` is optional.
3. Running locally: save it here as `data/kenpom.csv` (or point `KENPOM_CSV` at it). The app picks up changes automatically.
   On the hosted site: paste the CSV into a GitHub repository secret named `KENPOM_CSV`
   (Settings → Secrets and variables → Actions). The hourly build uses it. Update the secret every week or two.

When both teams in a game have KenPom ratings, KenPom makes up 70% of the college basketball model.
The file is git-ignored because it's subscription data.
