// ESPN public injuries feed (no key). Shape varies slightly by league, so parse defensively.
import { getJson } from './http.js';

export async function fetchInjuries(sport) {
  const data = await getJson(`https://site.api.espn.com/apis/site/v2/sports/${sport.espn}/injuries`, { ttlMs: 3 * 60 * 1000 });
  const out = [];
  for (const team of data.injuries || []) {
    for (const inj of team.injuries || []) {
      const a = inj.athlete || {};
      out.push({
        player: a.displayName || a.fullName || 'Unknown',
        team: a.team?.abbreviation || team.abbreviation || team.displayName || '',
        teamName: team.displayName || '',
        pos: a.position?.abbreviation || '',
        status: inj.status || inj.type?.description || 'Unknown',
        note: [inj.details?.type, inj.shortComment].filter(Boolean).join(' — ') || inj.longComment || '',
        updated: inj.date || new Date().toISOString(),
      });
    }
  }
  const cutoff = Date.now() - 120 * 86400000;
  return out
    .filter((i) => i.status !== 'Active' && !(Date.parse(i.updated) < cutoff))
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}
