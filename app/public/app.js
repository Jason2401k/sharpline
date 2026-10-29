// SharpLine frontend: hash-routed single page, no build step.

const app = document.getElementById('app');
const state = { sports: [], boards: new Map(), picks: null, injuries: null, propSort: { key: 'grade', dir: -1 }, propFilter: { stat: '', lean: '', min: '0', q: '', tossups: false }, openProp: null };

// ---------------------------------------------------------------- utils
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtOdds = (o) => (o == null ? '—' : o > 0 ? `+${o}` : `${o}`);
const fmtLine = (x) => (x == null ? '—' : x > 0 ? `+${x}` : x === 0 ? 'PK' : `${x}`);
const pct = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
const signedPct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const fmtTime = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}
const STATIC = Boolean(window.SHARPLINE_STATIC);
const STRONG = 500; // matches STRONG_SCORE in src/model/math.js: below this a play is a toss-up
async function api(path) {
  const bust = state.bust ? `?v=${state.bust}` : '';
  const r = await fetch(STATIC ? `${path}.json${bust}` : `/${path}`, state.bust ? { cache: 'no-store' } : undefined);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}
async function board(id, fresh = false) {
  if (fresh || !state.boards.has(id)) state.boards.set(id, await api(`api/board/${id}`));
  return state.boards.get(id);
}
const srcBadge = (s0, label) => { const s = s0 === 'unavailable' ? 'none' : s0; return  `<span class="badge ${s === 'live' ? 'live' : s === 'none' ? 'none' : 'demo'}" title="${label}: ${s === 'live' ? 'live feed' : s === 'none' ? 'not connected' : 'sample data'}">${label} ${s === 'live' ? 'live' : s0 === 'unavailable' ? 'n/a' : s === 'none' ? 'off' : 'demo'}</span>`; };

// ---------------------------------------------------------------- shell
const CONNECT_STEPS = `<ol class="connect-steps">
  <li>Get a free API key at <a href="https://the-odds-api.com" target="_blank" rel="noopener">the-odds-api.com</a>.</li>
  <li>Put it in <code>.env</code> as <code>ODDS_API_KEY=...</code> and restart the app.</li>
  <li>Real games, lines, props and picks load automatically. Injuries come from ESPN with no key.</li>
</ol>`;
function notConnected(title, body) {
  return `<div class="card pad notice"><span class="badge none">Not connected</span><h3>${title}</h3><p class="muted">${body}</p>${CONNECT_STEPS}</div>`;
}

function renderNav(active) {
  const by = (t) => state.sports.filter((s) => s.tier === t);
  const link = (s) => `<a class="nav-link tier${s.tier} ${active === s.id ? 'active' : ''}" href="#${s.id}">${s.short}</a>`;
  document.getElementById('sportsNav').innerHTML = `
    <a class="nav-link ${active === 'home' ? 'active' : ''}" href="#picks">Top Picks</a>
    <span class="nav-sep"></span>${by(1).map(link).join('')}
    <span class="nav-sep"></span>${by(2).map(link).join('')}
    <span class="nav-sep"></span>${by(3).map(link).join('')}
    <span class="nav-sep"></span><a class="nav-link ${active === 'injuries' ? 'active' : ''}" href="#injuries">Injuries</a>
    <a class="nav-link ${active === 'record' ? 'active' : ''}" href="#record">Record</a>`;
}

function renderBanner(sources) {
  const el = document.getElementById('banner');
  const mode = sources?.lines || 'none';
  const errs = (sources?.errors || []).map((e) => `<div class="small">⚠ ${esc(e)}</div>`).join('');
  if (mode === 'live' && !errs) { el.innerHTML = ''; return; }
  const msg = {
    demo: ['demo', 'Sample data', 'Games, lines, props, splits and stats on this page are <b>made-up sample data</b> for testing the site. They are not the real schedule.'],
    none: ['none', 'Not connected', "Live odds aren't connected yet, so no games are shown. The real schedule, lines and props load automatically once an Odds API key is added."],
    live: ['live', 'Live', ''],
  }[mode];
  el.innerHTML = `<div class="banner"><div class="banner-inner"><span class="badge ${msg[0]}">${msg[1]}</span><div>${msg[2]}${errs}</div></div></div>`;
}

// ---------------------------------------------------------------- router
async function route() {
  let [a = '', b = ''] = location.hash.replace(/^#/, '').split('-');
  if (a === 'picks') a = '';
  state.openProp = null;
  app.innerHTML = `<div class="loading">Loading…</div>`;
  try {
    if (!a) { renderNav('home'); await homeView(); }
    else if (a === 'injuries') { renderNav('injuries'); await allInjuriesView(); }
    else if (a === 'record') { renderNav('record'); await recordView(); }
    else if (state.sports.find((s) => s.id === a)) { renderNav(a); await sportView(a, b || 'lines'); }
    else { location.hash = '#picks'; }
  } catch (e) {
    app.innerHTML = `<div class="empty">Couldn't load data: ${esc(e.message)}</div>`;
  }
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- home
async function homeView() {
  state.picks = await api('api/picks');
  const p = state.picks;
  renderBanner({ lines: p.live ? 'live' : p.demo ? 'demo' : 'none', errors: p.errors });
  if (!p.live && !p.demo) {
    app.innerHTML = `<div class="hero"><h1>This week's best bets</h1></div>
      <div class="section">${notConnected('Picks need live sportsbook lines', 'Best Value and Best Locks are ranked from the real lines and props for this week. Once live odds are connected they appear here, with NFL and college basketball weighted first.')}</div>`;
    return;
  }
  const top = p.top || [];
  const strong = p.strongScore || 500;
  app.innerHTML = `
    <div class="hero">
      <h1>Top 10 plays</h1>
      <p>The highest-confidence plays on the board right now, across every sport. Only plays scoring <b>${strong}+</b> with a real edge over the sportsbook's price make the list; toss-ups are left out.</p>
    </div>
    <section class="card picks-col section top-list">
      ${top.length ? top.map((c, i) => pickRow(c, i + 1)).join('') : `<div class="empty">No plays clear ${strong} right now. More lines go up closer to game time, so check back after a refresh.</div>`}
    </section>
    ${top.length && top.length < 10 ? `<p class="muted small">Only ${top.length} play${top.length === 1 ? ' clears' : 's clear'} ${strong} right now. The list fills in as books post more lines.</p>` : ''}
    <p class="muted small">Each play shows its confidence (1–1000) and the model's win chance. Even top plays lose sometimes; the Record tab tracks how they actually do.</p>`;
}

// Confidence on a 1-1000 scale (1000 = most confident ever).
function scoreBadge(score, small = false) {
  if (score == null) return '';
  const band = score >= 800 ? 'high' : score >= STRONG ? 'mid' : 'low';
  return `<span class="score score-${band}${small ? ' score-sm' : ''}" data-tip="Confidence ${score} out of 1000 (1000 = most confident ever)">${score}<small>/1000</small></span>`;
}

function pickRow(c, n) {
  return `<div class="pick">
    <div class="pick-rank">${n}</div>
    <div>
      <div class="pick-title">${esc(c.label)}</div>
      <div class="pick-meta">
        <span class="badge tier">${esc(c.sportName)}</span><span class="chip">${esc(c.type)}</span>
        <span class="muted small">${esc(c.matchup)}</span>
        ${c.sharp ? '<span class="chip sharp" data-tip="Money % is well ahead of ticket % on this side">Sharp $ agrees</span>' : ''}
        ${c.injury ? `<span class="status status-${esc(c.injury.status).replace(/\s/g, '-')}">${esc(c.injury.status)}</span>` : ''}
      </div>
      <details class="why"><summary>Why the model likes it</summary><div class="pick-reason">${esc(c.reason)}</div></details>
    </div>
    <div class="pick-side">
      <span class="odds">${fmtOdds(c.odds)}</span>
      ${scoreBadge(c.score)}
      <span class="small" data-tip="Model win probability · edge vs. book implied probability"><b>${pct(c.prob)}</b> <span class="${c.edge > 0 ? 'pos' : 'neg'}">${signedPct(c.edge)}</span></span>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- sport page
const TABS = [['lines', 'Game Lines'], ['props', 'Player Props'], ['public', 'Public Money'], ['injuries', 'Injuries']];

async function sportView(id, tab) {
  const b = await board(id);
  renderBanner(b.sources);
  const tabs = TABS.filter(([t]) => t !== 'props' || b.sport.tier <= 2);
  if (!tabs.find(([t]) => t === tab)) tab = 'lines';
  const counts = { lines: b.games.length, props: b.props.length, public: b.games.filter((g) => g.public).length, injuries: b.injuries.length };
  const s = b.sources;
  app.innerHTML = `
    <div class="page-head">
      <div><h1>${esc(b.sport.name)}</h1><div class="muted small">Updated ${ago(b.updated)} · ${b.sport.tier === 1 ? 'Featured sport' : b.sport.tier === 2 ? 'Full coverage' : 'Lines & public money'}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${srcBadge(s.lines, 'Lines')}${b.sport.tier <= 2 ? srcBadge(s.props, 'Props') : ''}${srcBadge(s.injuries, 'Injuries')}${srcBadge(s.public, 'Splits')}</div>
    </div>
    <nav class="tabs">${tabs.map(([t, l]) => `<a class="tab ${t === tab ? 'active' : ''}" href="#${id}-${t}">${l}<span class="count">${counts[t]}</span></a>`).join('')}</nav>
    <div id="tabBody"></div>`;
  const body = document.getElementById('tabBody');
  if (tab === 'lines') body.innerHTML = linesView(b);
  if (tab === 'props') propsView(b, body);
  if (tab === 'public') body.innerHTML = publicView(b);
  if (tab === 'injuries') body.innerHTML = injuryCard(b.injuries, b.sources.injuries);
}

function linesView(b) {
  if (!b.games.length && b.sources.lines === 'none') return notConnected(`No live ${esc(b.sport.name)} games loaded`, 'Games and lines come from the live odds feed. Nothing is shown until it is connected, so you never see a made-up schedule.');
  if (!b.games.length) return `<div class="card empty">No ${esc(b.sport.name)} games on the board right now${b.sources.lines === 'demo' ? ' (the demo set has none for this sport; connect live odds to fill it).' : '.'}</div>`;
  const more = b.unpriced ? `<p class="muted small">${b.unpriced} more ${esc(b.sport.short)} game${b.unpriced === 1 ? ' is' : 's are'} scheduled in the next 7 days without a posted line yet. They appear here once the book posts one.</p>` : '';
  const kp = b.sources.kenpom;
  const kpLine = !kp ? '' : kp.status === 'live'
    ? ` KenPom: your upload from ${new Date(kp.updated).toLocaleDateString()}, matched ${kp.matched} of ${kp.total} teams (70% of the model where both teams match).`
    : ' KenPom: not loaded yet. Export your ratings table to <code>data/kenpom.csv</code> to add it.';
  const src = b.sources.linesProvider ? `<p class="muted small" style="margin-top:0">Lines: ${esc(b.sources.linesProvider)}. Team ratings and coaching stats: ESPN.${b.sources.publicProvider && b.sources.public === 'live' ? ` Public splits: ${esc(b.sources.publicProvider)}.` : ''}${kpLine}</p>` : '';
  if (!b.games.length) return `${src}<div class="card empty">No ${esc(b.sport.name)} lines posted for the next 7 days yet.</div>${more}`;
  return `${src}<div class="grid grid-2">${b.games.map((g) => gameCard(g, b.sport)).join('')}</div>${more}`;
}

function gameCard(g, sport, { compact = false } = {}) {
  const a = g.analysis || {};
  const sp = g.spread, to = g.total, ml = g.moneyline;
  const pickChip = (p) => (p && (p.score ?? 0) >= STRONG ? `<span class="chip ${p.edge > 0.02 ? 'edge-pos' : ''}" data-tip="Model ${pct(p.prob)} vs book ${pct(p.prob - p.edge)} · confidence ${p.score ?? '—'}/1000">${esc(p.label)} ${signedPct(p.edge)}${p.score != null ? ` · ${p.score}` : ''}</span>` : '');
  const sig = (g.signals || []).map((s) => `<span class="chip ${s.type}" data-tip="${esc(s.text)}">${s.type === 'rlm' ? '↺ RLM' : '$ Sharp'} ${esc(s.side)}</span>`).join('');
  const inj = (g.injuries || []).filter((i) => i.status !== 'Probable');
  const row = (side) => {
    const t = g[side];
    const spLine = sp ? (side === 'home' ? sp.line : -sp.line) : null;
    return `<tr>
      <td><div class="team-cell"><span class="team-dot ${side}"></span><div><div class="team-name">${esc(t.abbr)}</div><div class="team-sub">${esc(t.name)}${t.record ? ` · ${esc(t.record)}` : ''}</div></div></div></td>
      <td><span class="line-box">${fmtLine(spLine)}<small>${fmtOdds(sp?.[side + 'Odds'])}</small></span></td>
      <td><span class="line-box">${to ? `${side === 'away' ? 'O' : 'U'} ${to.line}` : '—'}<small>${fmtOdds(side === 'away' ? to?.overOdds : to?.underOdds)}</small></span></td>
      <td class="hide-sm"><span class="line-box">${fmtOdds(ml?.[side])}<small>ML</small></span></td>
    </tr>`;
  };
  return `<article class="card game" data-game="${esc(g.id)}">
    <div class="game-head"><span>${g.live ? `<span class="live-tag" data-tip="Game in progress. Lines and model numbers below are from before the game started.">LIVE</span> ${esc(g.status || '')} · pre-game numbers` : fmtTime(g.start)}</span><span>${g.books ? `${g.books} books · ` : g.book ? `${esc(g.book)} · ` : ''}${sp?.open != null && sp.open !== sp.line ? `Open ${esc(g.home.abbr)} ${fmtLine(sp.open)} → ${fmtLine(sp.line)}` : 'Line unchanged'}</span></div>
    <div class="game-body">
      <table class="lines"><thead><tr><th>Team</th><th>Spread</th><th>Total</th><th class="hide-sm">Money</th></tr></thead><tbody>${row('away')}${row('home')}</tbody></table>
      ${a.available ? `<div class="model-row">
        <div class="model-cell"><div class="k">Model score</div><div class="v num">${g.away.abbr} ${a.projScore.away} – ${g.home.abbr} ${a.projScore.home}</div></div>
        <div class="model-cell"><div class="k">Model line</div><div class="v num">${g.home.abbr} ${fmtLine(a.modelSpread)} · ${a.modelTotal}</div></div>
        <div class="model-cell"><div class="k">Win prob</div><div class="v num">${g.away.abbr} ${pct(a.winProb.away)} · ${g.home.abbr} ${pct(a.winProb.home)}</div></div>
      </div>${a.sampleNote ? `<div class="muted small" style="margin-top:6px">ⓘ ${esc(a.sampleNote)} Not used for picks.</div>` : ''}` : `<div class="muted small" style="margin-top:8px">${esc(a.reason || 'No model for this matchup.')}</div>`}
      <div class="game-foot">${pickChip(a.spreadPick) || pickChip(a.totalPick) ? `${pickChip(a.spreadPick)}${pickChip(a.totalPick)}` : a.available ? '<span class="chip" data-tip="No side scores 500+ in this game">No strong lean</span>' : ''}${sig}
        ${inj.length ? `<span class="chip" data-tip="${esc(inj.map((i) => `${i.player} (${i.team}) ${i.status}`).join(' · '))}">🩹 ${inj.length} injur${inj.length === 1 ? 'y' : 'ies'}</span>` : ''}
      </div>
      ${g.public?.spread && !compact ? `<div style="margin-top:12px">${splitBar('Spread · tickets', g.away.abbr, g.home.abbr, 100 - g.public.spread.homeTickets, g.public.spread.homeTickets)}${splitBar('Spread · money', g.away.abbr, g.home.abbr, 100 - g.public.spread.homeMoney, g.public.spread.homeMoney)}</div>` : ''}
      ${a.notes?.length ? `<div class="game-foot"><button class="toggle-btn" data-toggle-coach>Coaching breakdown (${a.notes.length}) ▾</button></div>` : ''}
    </div>
    ${a.notes?.length ? `<div class="coaching" hidden>${coachingPanel(g, sport)}</div>` : ''}
  </article>`;
}

function coachingPanel(g, sport) {
  const a = g.analysis, c = a.coaching;
  let rows = [];
  if (c && sport.kind === 'football') rows = [['Plays / game', 'playsPerGame'], ['Pass rate (incl. sacks)', 'passRate', '%'], ['4th-down tries / game', 'fourthDownAttPerGame'], ['4th-down aggression', 'fourthDownAgg', ' pctl'], ['4th-down conversion', 'fourthDownConvPct', '%'], ['3rd-down conversion', 'thirdDownPct', '%'], ['Red-zone TD rate', 'redZoneTd', '%'], ['2nd-half point diff', 'secondHalfDiff'], ['Blitz rate', 'blitzRate', '%'], ['Defensive scheme', 'defScheme'], ['ATS record', 'ats'], ['Record', 'record']];
  if (c && sport.kind === 'basketball') rows = [['KenPom rank', 'kenpomRank'], ['KenPom AdjEM', 'kenpomEM'], ['KenPom AdjO', 'kenpomO'], ['KenPom AdjD', 'kenpomD'], ['KenPom AdjT', 'kenpomT'], ['Tempo (poss/game)', 'tempo'], ['3PA rate', 'threeRate', '%'], ['Turnover rate', 'toRate', '%'], ['Assist / turnover', 'astTo'], ['Defensive scheme', 'defScheme'], ['After-timeout pts/poss', 'atoPPP'], ['Close-game record', 'closeRecord'], ['Bench minutes', 'benchMinutes', '%'], ['ATS record', 'ats'], ['Record', 'record']];
  rows = rows.filter(([, k]) => c && (c.away[k] != null || c.home[k] != null));
  const cell = (v, u) => (v == null ? '<span class="muted">—</span>' : `${esc(v)}${u}`);
  const table = c ? `<p class="style-line"><span class="team-dot away" style="display:inline-block"></span> <b>${esc(g.away.abbr)}:</b> ${esc(c.away.style)}</p>
    <p class="style-line"><span class="team-dot home" style="display:inline-block"></span> <b>${esc(g.home.abbr)}:</b> ${esc(c.home.style)}</p>
    <table class="coach-table"><thead><tr><th>Coaching profile</th><th>${esc(g.away.abbr)}</th><th>${esc(g.home.abbr)}</th></tr></thead>
    <tbody>${rows.map(([l, k, u = '']) => `<tr><td>${l}</td><td class="num">${cell(c.away[k], u)}</td><td class="num">${cell(c.home[k], u)}</td></tr>`).join('')}</tbody></table>` : '';
  const impactLabel = { total: 'Total', spread: 'Side', variance: 'Variance', info: 'Trend' };
  return `${table}<h3 style="margin:4px 0 8px">How the coaching matchup shapes this game</h3>
    <ul class="notes">${a.notes.map((n) => `<li class="note"><b>${esc(n.title)}</b><span class="impact">${impactLabel[n.impact] || n.impact}${n.lean ? ` · ${esc(String(n.lean).toUpperCase())}` : ''}</span><div>${esc(n.text)}</div></li>`).join('')}</ul>
    <p class="muted small" style="margin:10px 0 0">${esc(a.summary)}</p>`;
}

function splitBar(label, awayAbbr, homeAbbr, awayPct, homePct, labels) {
  const [la, lh] = labels || [awayAbbr, homeAbbr];
  return `<div class="split-row"><span>${esc(label.split(' · ')[1] || label)}</span>
    <div class="bar" role="img" aria-label="${esc(label)}: ${esc(la)} ${awayPct}%, ${esc(lh)} ${homePct}%">
      <span class="a" style="width:${awayPct}%" data-tip="${esc(la)} ${awayPct}% of ${esc(label)}">${awayPct >= 18 ? `${esc(la)} ${awayPct}%` : ''}</span>
      <span class="h" style="width:${homePct}%" data-tip="${esc(lh)} ${homePct}% of ${esc(label)}">${homePct >= 18 ? `${esc(lh)} ${homePct}%` : ''}</span>
    </div></div>`;
}

// ---------------------------------------------------------------- public money
function publicView(b) {
  const games = b.games.filter((g) => g.public);
  if (!games.length && b.sources.publicProvider) {
    return `<div class="card pad"><h3>No public betting splits yet</h3><p class="muted">${esc(b.sources.publicProvider)} hasn't posted splits for this week's ${esc(b.sport.short)} games yet. They show up here once bets start coming in.</p></div>`;
  }
  if (!games.length) {
    return `<div class="card pad"><h3>Public betting splits aren't available for ${esc(b.sport.name)}</h3><p class="muted">Splits come from SportsBettingDime, which covers NFL, college football and basketball, NBA, NHL and MLB. Set <code>PUBLIC_SPLITS_URL</code> in <code>.env</code> to use another JSON feed.</p></div>`;
  }
  const upd = games.map((g) => g.public.updated).filter(Boolean).sort().pop();
  return `<p class="muted small" style="margin-top:0">Splits: ${esc(games[0].public.source || b.sources.publicProvider || 'public feed')}${upd ? `, updated ${ago(upd)}` : ''} · ${games.length} of ${b.games.length} games.</p>
  <p class="muted" style="margin-top:0"><b>Tickets</b> = share of bets placed. <b>Money</b> = share of dollars wagered. When money runs well ahead of tickets, fewer but bigger (often sharper) bettors are on that side. A <b>reverse line move</b> means the line moved against the side most tickets are on.</p>
  <div class="grid grid-2">${games.map((g) => {
    const p = g.public;
    return `<article class="card pad">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><h3><span class="team-dot away" style="display:inline-block"></span> ${esc(g.away.abbr)} @ <span class="team-dot home" style="display:inline-block"></span> ${esc(g.home.abbr)}</h3><span class="muted small">${fmtTime(g.start)}</span></div>
      ${p.spread ? `<div class="split"><div class="split-label"><span class="mk">Spread</span><span class="num">${g.spread ? `${esc(g.away.abbr)} ${fmtLine(-g.spread.line)} / ${esc(g.home.abbr)} ${fmtLine(g.spread.line)}` : ''}</span></div>
        ${splitBar('Spread · Tickets', g.away.abbr, g.home.abbr, 100 - p.spread.homeTickets, p.spread.homeTickets)}${splitBar('Spread · Money', g.away.abbr, g.home.abbr, 100 - p.spread.homeMoney, p.spread.homeMoney)}</div>` : ''}
      ${p.total ? `<div class="split"><div class="split-label"><span class="mk">Total</span><span class="num">${g.total ? `O/U ${g.total.line}` : ''}</span></div>
        ${splitBar('Total · Tickets', '', '', p.total.overTickets, 100 - p.total.overTickets, ['Over', 'Under'])}${splitBar('Total · Money', '', '', p.total.overMoney, 100 - p.total.overMoney, ['Over', 'Under'])}</div>` : ''}
      ${p.moneyline ? `<div class="split"><div class="split-label"><span class="mk">Moneyline</span><span class="num">${fmtOdds(g.moneyline?.away)} / ${fmtOdds(g.moneyline?.home)}</span></div>
        ${splitBar('Moneyline · Tickets', g.away.abbr, g.home.abbr, 100 - p.moneyline.homeTickets, p.moneyline.homeTickets)}${splitBar('Moneyline · Money', g.away.abbr, g.home.abbr, 100 - p.moneyline.homeMoney, p.moneyline.homeMoney)}</div>` : ''}
      <div class="game-foot">${g.signals.length ? g.signals.map((s) => `<span class="chip wrap ${s.type}">${s.type === 'rlm' ? '↺' : '$'} ${esc(s.text)}</span>`).join('') : '<span class="muted small">No sharp/public divergence.</span>'}</div>
    </article>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- props
function propsView(b, el) {
  if (!b.props.length) {
    el.innerHTML = b.sources.props === 'none'
      ? notConnected('Player props not loaded', 'Prop lines come from the live odds feed. Once connected, each prop gets a model projection from the player\'s recent games and the opposing defense.')
      : '<div class="card empty">No player props posted for this sport yet.</div>';
    return;
  }
  const stats = [...new Set(b.props.map((p) => p.statLabel))];
  const f = state.propFilter;
  el.innerHTML = `
    <p class="muted" style="margin-top:0">The projection blends the player's last 5 games, last 10 and season average. It then adjusts for <b>how the opponent's defense handles the position</b> (yards and catches it allows per game, ranked 1–${b.props.find((p) => p.model?.dvp)?.model.dvp.teams || 32}), plus game pace and expected game script. Click any row for the game log and breakdown.</p>
    ${b.sources.propsProvider ? `<p class="muted small" style="margin-top:-6px">Lines: ${esc(b.sources.propsProvider)}. ${esc(b.sources.propsNote || '')}</p>` : ''}
    <div class="filters">
      <input type="search" id="pf-q" placeholder="Search player or team" value="${esc(f.q)}">
      <select id="pf-stat"><option value="">All markets</option>${stats.map((s) => `<option ${f.stat === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="pf-lean"><option value="">Over &amp; Under</option><option ${f.lean === 'Over' ? 'selected' : ''}>Over</option><option ${f.lean === 'Under' ? 'selected' : ''}>Under</option></select>
      <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pf-toss" ${f.tossups ? 'checked' : ''}> Show toss-ups</label>
      <select id="pf-min"><option value="0">Any edge</option>${[0.03, 0.05, 0.08, 0.12].map((v) => `<option value="${v}" ${f.min === String(v) ? 'selected' : ''}>Edge ≥ ${v * 100}%</option>`).join('')}</select>
    </div>
    <div class="card table-wrap"><table class="props"><thead><tr>
      <th data-sort="player">Player</th><th data-sort="stat">Prop</th><th class="r" data-sort="line">Line</th><th class="r" data-sort="proj">Model</th>
      <th class="c" data-sort="lean">Lean</th><th class="r" data-sort="edge">Edge</th><th class="c" data-sort="hit">L10 hit</th><th data-sort="dvp">Opp. defense vs pos</th><th class="c" data-sort="grade">Confidence</th>
    </tr></thead><tbody id="propBody"></tbody></table></div>`;
  const rerender = () => { el.querySelector('#propBody').innerHTML = propRows(b); };
  el.querySelector('#pf-q').addEventListener('input', (e) => { f.q = e.target.value; rerender(); });
  el.querySelector('#pf-stat').addEventListener('change', (e) => { f.stat = e.target.value; rerender(); });
  el.querySelector('#pf-lean').addEventListener('change', (e) => { f.lean = e.target.value; rerender(); });
  el.querySelector('#pf-min').addEventListener('change', (e) => { f.min = e.target.value; rerender(); });
  el.querySelector('#pf-toss').addEventListener('change', (e) => { f.tossups = e.target.checked; rerender(); });
  el.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    state.propSort = { key: k, dir: state.propSort.key === k ? -state.propSort.dir : -1 };
    rerender();
  }));
  el.querySelector('#propBody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr.row');
    if (!tr) return;
    state.openProp = state.openProp === tr.dataset.id ? null : tr.dataset.id;
    rerender();
  });
  rerender();
}

function propRows(b) {
  const f = state.propFilter, q = f.q.toLowerCase();
  const key = {
    player: (p) => p.player, stat: (p) => p.statLabel, line: (p) => p.line, proj: (p) => p.model?.projection ?? -1, lean: (p) => p.model?.lean ?? '',
    edge: (p) => p.model?.edge ?? -1, hit: (p) => p.model?.hitRate ?? -1, dvp: (p) => p.model?.dvp ? p.model.dvp.rank / p.model.dvp.teams : -1, grade: (p) => p.model?.score ?? -1,
  }[state.propSort.key];
  const list = b.props
    .filter((p) => (f.tossups || (p.model?.score ?? 0) >= STRONG) && (!q || `${p.player} ${p.team} ${p.opp}`.toLowerCase().includes(q)) && (!f.stat || p.statLabel === f.stat) && (!f.lean || p.model?.lean === f.lean) && (p.model?.edge ?? -1) >= Number(f.min))
    .sort((x, y) => { const a = key(x), c = key(y); return (a > c ? 1 : a < c ? -1 : 0) * state.propSort.dir; });
  if (!list.length) return `<tr><td colspan="9" class="empty">${f.tossups ? 'No props match these filters.' : `No props score ${STRONG}+ with these filters. Tick “Show toss-ups” to see the rest.`}</td></tr>`;
  return list.map((p) => {
    const m = p.model;
    const row = `<tr class="row" data-id="${esc(p.id)}">
      <td><div class="player-name">${esc(p.player)} ${m?.injury ? `<span class="status status-${esc(m.injury.status).replace(/\s/g, '-')}">${esc(m.injury.status)}</span>` : ''}</div><div class="muted small">${esc(p.team)} ${esc(p.pos)} · vs ${esc(p.opp)}</div></td>
      <td>${esc(p.statLabel)}<div class="muted small">${esc(p.book)}</div></td>
      <td class="r num">${p.line}<div class="muted small">o${fmtOdds(p.overOdds)} u${fmtOdds(p.underOdds)}</div></td>
      <td class="r num"><b>${m ? m.projection : '—'}</b></td>
      <td class="c">${m ? `<span class="lean ${m.lean}">${m.lean}</span>` : '—'}</td>
      <td class="r num ${m && m.edge > 0 ? 'pos' : 'muted'}">${m ? signedPct(m.edge) : '—'}</td>
      <td class="c num">${m ? `${m.hits}/${m.games}` : '—'}</td>
      <td class="dvp">${m?.dvp ? dvpCell(m.dvp, p.pos) : '<span class="muted">—</span>'}</td>
      <td class="c">${m ? scoreBadge(m.score, true) : '<span class="muted small">no stats</span>'}</td>
    </tr>`;
    return row + (state.openProp === p.id ? `<tr class="detail"><td colspan="9">${propDetail(p)}</td></tr>` : '');
  }).join('');
}

function dvpCell(d, pos) {
  // rank 1 = stingiest; bar length shows how soft the matchup is
  const soft = d.rank / d.teams;
  const label = soft > 0.67 ? 'Soft' : soft < 0.34 ? 'Tough' : 'Neutral';
  return `<span class="dvp-bar" aria-hidden="true"><i style="width:${Math.round(soft * 100)}%"></i></span><b>${label}</b> <span class="muted">#${d.rank}/${d.teams} vs ${esc(pos)}</span>`;
}

function propDetail(p) {
  const m = p.model;
  if (!m) return `<div class="muted">No stat history for ${esc(p.player)} yet, so the model can't project this line. Connect a stats feed (see README).</div>`;
  const f = m.factors;
  const fx = (x) => `<span class="${x > 1.005 ? 'pos' : x < 0.995 ? 'neg' : 'muted'}">${x > 1 ? '+' : ''}${((x - 1) * 100).toFixed(1)}%</span>`;
  return `<div class="prop-detail">
    <div>
      <h3>Last ${m.last10.length} games vs. the line (${p.line})</h3>
      ${gameLogChart(m.last10, p.line, m.lean, m.recent)}
      <div class="chart-legend"><span><i style="background:var(--hit)"></i>${m.lean} hit</span><span><i style="background:var(--miss)"></i>Miss</span><span><i style="background:none;border-top:2px dashed var(--text-2);height:0;border-radius:0"></i>Book line</span></div>
    </div>
    <div>
      <h3>Projection breakdown</h3>
      <div class="factor-list">
        <span>Last 5 avg</span><span class="num">${m.l5}</span>
        <span>Last 10 avg</span><span class="num">${m.l10}</span>
        <span>Season avg</span><span class="num">${m.season}</span>
        <span>Weighted baseline</span><span class="num"><b>${m.baseline}</b></span>
        <span>Opp. defense vs ${esc(p.pos)}${m.dvp ? ` (allows ${m.dvp.allowed} vs ${m.dvp.leagueAvg} avg)` : ''}</span><span class="num">${fx(f.defense)}</span>
        <span>Pace / game total</span><span class="num">${fx(f.pace)}</span>
        <span>Game script (spread)</span><span class="num">${fx(f.script)}</span>
        <span><b>Model projection</b></span><span class="num"><b>${m.projection}</b></span>
        <span>Model P(${m.lean}), blended with market</span><span class="num">${pct(m.prob, 1)}</span>
        <span>Book implied (${fmtOdds(m.odds)})</span><span class="num">${pct(m.prob - m.edge, 1)}</span>
        <span>Expected value / unit</span><span class="num ${m.ev > 0 ? 'pos' : 'neg'}">${m.ev > 0 ? '+' : ''}${m.ev.toFixed(3)}</span>
      </div>
      <p class="small" style="color:var(--text-2);margin:0">${esc(m.summary)}</p>
      ${m.cautions?.length ? `<p class="small" style="margin:8px 0 0"><span class="status status-Questionable">Not rated strong</span> ${esc(m.cautions.join('; '))}.</p>` : ''}
    </div>
  </div>`;
}

// Bar chart, most recent game on the right. Bars anchored to baseline, 4px rounded tops.
function gameLogChart(values, line, lean, recent) {
  const vals = [...values].reverse();
  const games = recent ? [...recent].reverse() : null; // { date, opp } per game, oldest first
  const W = 520, H = 170, padL = 34, padB = 22, padT = 10;
  const max = Math.max(line, ...vals) * 1.15 || 1;
  const bw = (W - padL - 8) / vals.length;
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, max / 2, max].map((t) => Math.round(t));
  const bars = vals.map((v, i) => {
    const hit = lean === 'Over' ? v > line : v < line;
    const x = padL + i * bw + bw * 0.18, w = bw * 0.64, top = y(v), h = Math.max(1, H - padB - top);
    const g = games?.[i];
    const label = g?.opp ? `vs ${g.opp}, ${new Date(g.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : i === vals.length - 1 ? 'Last game' : `${vals.length - i} games ago`;
    return `<g class="bar-g" data-tip="${label}: ${v} (${hit ? lean + ' hit' : 'miss'})">
      <rect x="${x - bw * 0.18}" y="${padT}" width="${bw}" height="${H - padT - padB}" fill="transparent"/>
      <path d="M${x},${H - padB} V${top + 4} q0,-4 4,-4 h${w - 8} q4,0 4,4 V${H - padB} Z" fill="var(${hit ? '--hit' : '--miss'})"/>
      <text x="${x + w / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${g?.opp ? esc(g.opp) : i === vals.length - 1 ? 'L1' : ''}</text>
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Game log: ${vals.join(', ')}; line ${line}">
    ${ticks.map((t) => `<line x1="${padL}" x2="${W - 4}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)" stroke-width="1"/><text x="${padL - 6}" y="${y(t) + 3}" text-anchor="end" font-size="10" fill="var(--muted)">${t}</text>`).join('')}
    ${bars}
    <line x1="${padL}" x2="${W - 4}" y1="${y(line)}" y2="${y(line)}" stroke="var(--text-2)" stroke-width="2" stroke-dasharray="5 4"/>
    <text x="${W - 6}" y="${y(line) - 5}" text-anchor="end" font-size="11" font-weight="700" fill="var(--text)">Line ${line}</text>
  </svg>`;
}

// ---------------------------------------------------------------- injuries
function injuryCard(list, source, sportLabel) {
  if (!list.length && source === 'unavailable') return `<div class="card pad notice"><h3>No injury report${sportLabel ? ` for ${esc(sportLabel)}` : ''}</h3><p class="muted">ESPN doesn't publish a current injury report for this sport, so there's nothing to show here.</p></div>`;
  if (!list.length && source === 'none') return `<div class="card pad notice"><span class="badge none">Not connected</span><h3>Injury feed offline${sportLabel ? ` for ${esc(sportLabel)}` : ''}</h3><p class="muted">Injuries come from ESPN's public feed, which couldn't be reached. They show up here automatically when it can.</p></div>`;
  if (!list.length) return `<div class="card empty">No injuries reported.</div>`;
  return `<div class="section-head" style="margin-bottom:8px"><h2>${sportLabel ? esc(sportLabel) : 'Injury report'}</h2><span>${srcBadge(source, 'Feed')} <span class="muted small">updated on each refresh</span></span></div>
    <div class="card inj-list">${list.map((i) => `<div class="inj">
      <span><span class="status status-${esc(i.status).replace(/\s/g, '-')}">${esc(i.status)}</span></span>
      <span class="who"><b>${esc(i.player)}</b> <span class="muted">${esc(i.team)} · ${esc(i.pos)}</span><div class="small" style="color:var(--text-2)">${esc(i.note)}</div></span>
      <span class="when muted small">${ago(i.updated)}</span></div>`).join('')}</div>`;
}

async function allInjuriesView() {
  const data = state.injuries || (await api('api/injuries'));
  const live = data.some((d) => d.source === 'live');
  renderBanner({ lines: data.some((d) => d.source === 'demo') ? 'demo' : live ? 'live' : 'none' });
  app.innerHTML = `<div class="page-head"><div><h1>Injury wire</h1><div class="muted small">Every sport, newest first, flagged on the matching games and props</div></div></div>
    ${!data.some((d) => d.injuries.length) ? injuryCard([], live ? 'live' : 'none') : ''}
    ${data.filter((d) => d.injuries.length).sort((a, b) => a.sport.tier - b.sport.tier).map((d) => `<section class="section">${injuryCard(d.injuries, d.source, d.sport.name)}</section>`).join('')}`;
}

// ---------------------------------------------------------------- interactions
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-toggle-coach]');
  if (!btn) return;
  const panel = btn.closest('.game').querySelector('.coaching');
  panel.hidden = !panel.hidden;
  btn.textContent = btn.textContent.replace(/[▾▴]/, panel.hidden ? '▾' : '▴');
});

const tip = document.getElementById('tooltip');
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tip.hidden = true; return; }
  tip.textContent = t.dataset.tip;
  tip.hidden = false;
});
document.addEventListener('mousemove', (e) => {
  if (tip.hidden) return;
  const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
  tip.style.left = `${x}px`;
  tip.style.top = `${e.clientY + 16}px`;
});

function initTheme() {
  const root = document.documentElement;
  try { const t = localStorage.getItem('theme'); if (t) root.dataset.theme = t; } catch {}
  document.getElementById('themeToggle').addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch {}
  });
}

// ---------------------------------------------------------------- boot
(async function boot() {
  initTheme();
  state.sports = await api('api/sports');
  window.addEventListener('hashchange', route);
  await route();
  initRefresh(); // data only changes when the Refresh button is clicked
})();

// ---------------------------------------------------------------- pick record
const money = (u) => `${u > 0 ? '+' : ''}${u.toFixed(2)}u`;
const pctOrDash = (x, d = 1) => (x == null ? '—' : pct(x, d));
const resultPill = (s) => `<span class="result result-${s}">${{ win: 'Win', loss: 'Loss', push: 'Push', void: 'Void', pending: 'Pending' }[s] || esc(s)}</span>`;

async function recordView() {
  const r = await api('api/record');
  document.getElementById('banner').innerHTML = '';
  const o = r.overall;
  const since = r.started ? new Date(r.started).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const tile = (k, v, sub = '') => `<div class="tile"><div class="k">${k}</div><div class="v num">${v}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>`;
  const graded = o.wins + o.losses + o.pushes;
  app.innerHTML = `
    <div class="page-head"><div><h1>Pick Record</h1><div class="muted small">Every play that qualifies for Top Picks (confidence ${r.minScore}+ with a real edge) since ${since}, logged before kickoff and graded from final scores.</div></div></div>
    <div class="tiles">
      ${tile('Record', `${o.wins}-${o.losses}${o.pushes ? `-${o.pushes}` : ''}`, `${graded} graded · ${r.pending} pending`)}
      ${tile('Win rate', pctOrDash(o.winPct), 'pushes excluded')}
      ${tile('Units', graded ? money(o.units) : '—', '1 unit risked per pick')}
      ${tile('ROI', o.roi == null ? '—' : signedPct(o.roi), 'units ÷ units risked')}
    </div>
    ${graded ? '' : `<div class="card pad notice" style="margin-top:14px"><h3>No graded picks yet</h3><p class="muted">${r.pending ? `${r.pending} pick${r.pending === 1 ? ' is' : 's are'} logged and waiting on results. Each one is graded on the first refresh after its game ends.` : 'Picks scoring 250 or more are logged on each refresh before their games start.'} The model starts learning from the results once they come in.</p></div>`}
    ${graded ? `<div class="grid grid-3 section">${breakdown('By sport', r.bySport)}${breakdown('By market', r.byMarket)}${breakdown('By confidence score', r.byBand)}</div>` : ''}
    <div class="grid grid-2 section">
      <section class="card pad">${calibrationChart(r.buckets)}</section>
      <section class="card pad">${learnedPanel(r)}</section>
    </div>
    ${graded ? `<section class="section card pad"><h2>Does it help when…</h2><div class="factor-rows">${r.factors.map((f) => `<div class="factor-row"><b>${esc(f.name)}</b><span>Yes: ${f.with.wins}-${f.with.losses} (${pctOrDash(f.with.winPct)}, ${money(f.with.units)})</span><span class="muted">No: ${f.without.wins}-${f.without.losses} (${pctOrDash(f.without.winPct)}, ${money(f.without.units)})</span></div>`).join('')}</div></section>` : ''}
    <section class="section">
      <div class="section-head"><h2>All picks</h2>
        <div class="filters" style="margin:0"><select id="rec-filter"><option value="">All</option><option value="pending">Pending</option><option value="graded">Graded</option></select></div></div>
      <div class="card table-wrap"><table class="props rec"><thead><tr><th>Game time</th><th>Pick</th><th>Matchup</th><th class="r">Odds</th><th class="c">Score</th><th class="r">Model</th><th class="c">Result</th><th class="r">Final</th><th class="r">Units</th></tr></thead><tbody id="rec-body"></tbody></table></div>
    </section>`;
  const body = document.getElementById('rec-body');
  const draw = (f) => {
    const list = r.picks.filter((p) => !f || (f === 'pending' ? p.status === 'pending' : p.status !== 'pending'));
    body.innerHTML = list.length ? list.map((p) => `<tr>
      <td class="muted">${fmtTime(p.start)}</td>
      <td><b>${esc(p.label)}</b><div class="muted small">${esc(p.sportName)} · ${{ spread: 'Spread', total: 'Total', prop: 'Player prop' }[p.market] || p.market}${p.factors?.sharp ? ' · sharp $ agreed' : ''}</div></td>
      <td>${esc(p.matchup)}</td>
      <td class="r num">${fmtOdds(p.odds)}</td>
      <td class="c">${scoreBadge(p.score, true)}</td>
      <td class="r num">${pct(p.prob)}</td>
      <td class="c">${resultPill(p.status)}</td>
      <td class="r num">${p.market === 'prop' && p.actual != null ? `${p.actual} ${esc(p.statLabel || '')}` : p.final ? `${esc(p.away)} ${p.final.away}–${p.final.home} ${esc(p.home)}` : '—'}</td>
      <td class="r num ${p.units > 0 ? 'pos' : p.units < 0 ? 'neg' : 'muted'}">${p.units == null ? '—' : money(p.units)}</td>
    </tr>`).join('') : '<tr><td colspan="9" class="empty">No picks here yet.</td></tr>';
  };
  document.getElementById('rec-filter').addEventListener('change', (e) => draw(e.target.value));
  draw('');
}

function breakdown(title, rows) {
  return `<section class="card pad"><h3 style="margin-bottom:8px">${title}</h3>
    <table class="mini"><thead><tr><th></th><th class="r">W-L-P</th><th class="r">Win %</th><th class="r">Units</th></tr></thead>
    <tbody>${rows.map((x) => `<tr><td>${esc(x.label)}</td><td class="r num">${x.wins}-${x.losses}-${x.pushes}</td><td class="r num">${pctOrDash(x.winPct, 0)}</td><td class="r num ${x.units > 0 ? 'pos' : x.units < 0 ? 'neg' : ''}">${money(x.units)}</td></tr>`).join('')}</tbody></table></section>`;
}

// Predicted vs actual win rate. Points on the dashed line = well calibrated.
function calibrationChart(buckets) {
  const W = 420, H = 260, L = 44, B = 34, T = 12, R = 12;
  const x = (p) => L + ((p - 0.45) / 0.35) * (W - L - R);
  const y = (p) => T + (1 - p) * (H - T - B);
  const has = buckets.filter((b) => b.n > 0);
  const maxN = Math.max(1, ...has.map((b) => b.n));
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="var(--muted)">${v * 100}%</text>`).join('');
  const xt = [0.5, 0.6, 0.7, 0.8].map((v) => `<text x="${x(v)}" y="${H - B + 16}" text-anchor="middle" font-size="10" fill="var(--muted)">${v * 100}%</text>`).join('');
  const dots = has.map((b) => {
    const r = 5 + 9 * Math.sqrt(b.n / maxN);
    return `<g data-tip="Model said ${pct(b.predicted)} · actually won ${pct(b.actual)} · ${b.n} pick${b.n === 1 ? '' : 's'}"><circle cx="${x(b.predicted)}" cy="${y(b.actual)}" r="${r + 6}" fill="transparent"/><circle cx="${x(b.predicted)}" cy="${y(b.actual)}" r="${r}" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/><text x="${x(b.predicted)}" y="${y(b.actual) - r - 5}" text-anchor="middle" font-size="10" fill="var(--text-2)">${b.n}</text></g>`;
  }).join('');
  return `<h2>Is the confidence honest?</h2>
    <p class="muted small" style="margin:4px 0 8px">Each dot groups picks by the win chance the model gave them. Dots on the dashed line mean the model's percentages are accurate; below the line means it was overconfident. The number is how many picks.</p>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Calibration: predicted versus actual win rate">
      ${grid}${xt}
      <line x1="${x(0.45)}" y1="${y(0.45)}" x2="${x(0.8)}" y2="${y(0.8)}" stroke="var(--text-2)" stroke-width="1.5" stroke-dasharray="5 4"/>
      ${dots}
      <text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="var(--text-2)">Model's win chance</text>
      <text x="12" y="${(T + H - B) / 2}" text-anchor="middle" font-size="11" fill="var(--text-2)" transform="rotate(-90 12 ${(T + H - B) / 2})">Actually won</text>
    </svg>
    ${has.length ? '' : '<p class="muted small">Dots appear once picks are graded.</p>'}`;
}

function learnedPanel(r) {
  const L = r.learning;
  const line = (g) => {
    const dir = g.shift < -0.005 ? 'lowered' : g.shift > 0.005 ? 'raised' : 'unchanged';
    const exp = g.expected != null ? ` (won ${g.wins} vs ${g.expected * g.n >= 0 ? (g.expected * g.n).toFixed(1) : '—'} expected)` : '';
    return `<li class="note"><b>${esc(g.sportName)} ${{ spread: 'spreads', total: 'totals', prop: 'player props' }[g.market] || g.market}</b><span class="impact">${g.n} graded</span><div>Win chances ${dir}${dir === 'unchanged' ? '' : `: a 60% call now reads <b>${pct(g.at60)}</b>`}${exp}.</div></li>`;
  };
  return `<h2>What the model has learned</h2>
    <p class="muted small" style="margin:4px 0 10px">After each refresh the model compares its win chances with real results, per sport and market, and corrects future picks. Corrections stay small until a group has about ${L.priorPicks} graded picks, so one bad week can't swing it.</p>
    ${L.groups.length ? `<ul class="notes">${L.groups.map(line).join('')}</ul>
      <p class="muted small" style="margin-top:10px">Across all picks: a 60% call now reads ${pct(L.global.at60)} (${L.global.n} graded).</p>` : '<div class="muted">Nothing yet. Learning starts with the first graded picks.</div>'}`;
}

// ---------------------------------------------------------------- refresh button
// On the hosted site the button starts the GitHub "Refresh site data" workflow with a key you
// paste once; the key is kept only in this browser. Running locally, it just reloads the data.
const TOKEN_KEY = 'sharpline.githubKey';
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };
let siteInfo = null;

async function initRefresh() {
  const btn = document.getElementById('refreshBtn');
  try { siteInfo = await api('api/site'); } catch { siteInfo = {}; }
  const repo = siteInfo?.repo || repoFromLocation();
  updatedLabel();
  btn.addEventListener('click', async () => {
    if (!STATIC) { await reloadData('Refreshed'); return; }
    if (!repo) { showRefreshPanel(null, 'This copy of the site isn\'t linked to a GitHub repo.'); return; }
    if (!getToken()) { showRefreshPanel(repo); return; }
    await runRefresh(repo);
  });
}

function repoFromLocation() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const name = location.pathname.split('/').filter(Boolean)[0];
  return m && name ? `${m[1]}/${name}` : null;
}

function updatedLabel(text) {
  const el = document.getElementById('refreshStatus');
  if (text) { el.textContent = text; return; }
  el.textContent = siteInfo?.builtAt ? `Updated ${ago(siteInfo.builtAt)}` : '';
}

function showRefreshPanel(repo, error) {
  const panel = document.getElementById('refreshPanel');
  const actionsUrl = repo ? `https://github.com/${repo}/actions/workflows/${siteInfo?.workflow || 'refresh-site.yml'}` : null;
  panel.innerHTML = `<div class="refresh-panel card pad">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:start"><h3>Connect the Refresh button</h3><button class="toggle-btn" id="rp-close" aria-label="Close">✕</button></div>
    ${error ? `<p class="neg small">${esc(error)}</p>` : ''}
    <p class="muted small">The site is rebuilt by a GitHub job. To start it from this button, paste a GitHub key once. It's saved only in this browser and can only run this repo's refresh, not change anything else.</p>
    <ol class="connect-steps small">
      <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → new fine-grained token</a>.</li>
      <li>Name it "SharpLine refresh". Repository access: <b>Only select repositories</b> → <b>${esc(repo || 'your repo')}</b>.</li>
      <li>Permissions → Repository → <b>Actions: Read and write</b>. Click <b>Generate token</b> and copy it.</li>
    </ol>
    <div class="filters" style="margin-top:10px"><input type="password" id="rp-token" placeholder="Paste token (starts with github_pat_)" autocomplete="off" style="flex:1"><button class="toggle-btn" id="rp-save">Save &amp; refresh</button></div>
    ${actionsUrl ? `<p class="muted small" style="margin:8px 0 0">Or run it on GitHub instead: <a href="${actionsUrl}" target="_blank" rel="noopener">Actions → Refresh site data → Run workflow</a>.</p>` : ''}
    ${getToken() ? '<p class="small" style="margin:8px 0 0"><a href="#" id="rp-forget">Forget the saved key on this device</a></p>' : ''}
  </div>`;
  panel.hidden = false;
  document.getElementById('rp-close').onclick = () => { panel.hidden = true; };
  const forget = document.getElementById('rp-forget');
  if (forget) forget.onclick = (e) => { e.preventDefault(); setToken(''); panel.hidden = true; updatedLabel('Key removed'); };
  document.getElementById('rp-save').onclick = async () => {
    const t = document.getElementById('rp-token').value.trim();
    if (!t) return;
    setToken(t);
    panel.hidden = true;
    await runRefresh(repo);
  };
}

async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${path}`, { ...opts, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${getToken()}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) } });
  if (!r.ok && r.status !== 204) { const e = new Error(`GitHub said ${r.status}`); e.status = r.status; throw e; }
  return r.status === 204 ? null : r.json();
}

let refreshing = false;
async function runRefresh(repo) {
  if (refreshing) return;
  refreshing = true;
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true; btn.classList.add('spinning');
  const wf = siteInfo?.workflow || 'refresh-site.yml';
  const startedAt = Date.now();
  const tick = (msg) => updatedLabel(`${msg} ${Math.round((Date.now() - startedAt) / 1000)}s`);
  try {
    tick('Starting…');
    await gh(`${repo}/actions/workflows/${wf}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
    let run = null;
    for (let i = 0; i < 60 && !run; i++) {
      await sleep(3000); tick('Starting…');
      const runs = await gh(`${repo}/actions/workflows/${wf}/runs?event=workflow_dispatch&per_page=3`);
      run = runs.workflow_runs.find((x) => Date.parse(x.created_at) >= startedAt - 15000);
    }
    if (!run) throw new Error('The refresh job didn\'t start. Try again in a minute.');
    while (run.status !== 'completed') {
      await sleep(5000); tick('Refreshing…');
      run = await gh(`${repo}/actions/runs/${run.id}`);
    }
    if (run.conclusion !== 'success') throw Object.assign(new Error(`Refresh ${run.conclusion}. The site wasn't changed.`), { url: run.html_url });
    // GitHub Pages takes a few seconds to serve the new build.
    for (let i = 0; i < 24; i++) {
      tick('Publishing…');
      const info = await fetch(`api/site.json?v=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      if (info?.builtAt && Date.parse(info.builtAt) > startedAt) { siteInfo = info; break; }
      await sleep(5000);
    }
    await reloadData();
  } catch (e) {
    if (e.status === 401 || e.status === 403 || e.status === 404) { setToken(''); showRefreshPanel(repo, 'GitHub didn\'t accept that key. Check it has Actions: Read and write on this repo, then paste it again.'); updatedLabel(); }
    else { updatedLabel('Refresh failed'); if (e.url) window.open(e.url, '_blank', 'noopener'); console.error(e); }
  } finally {
    refreshing = false; btn.disabled = false; btn.classList.remove('spinning');
  }
}

async function reloadData(msg) {
  state.bust = Date.now();
  state.boards.clear(); state.injuries = null; state.picks = null;
  try { siteInfo = await api('api/site'); } catch {}
  await route();
  updatedLabel(msg);
  if (msg) setTimeout(() => updatedLabel(), 4000);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
