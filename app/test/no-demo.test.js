// Without live sources, no made-up games, props, picks or injuries may be shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LIVE_INJURIES = '0';
process.env.LIVE_ESPN = '0';
delete process.env.SHOW_DEMO;
delete process.env.ODDS_API_KEY;

test('default mode shows no sample data', async () => {
  const { getBoard, getPicks, getInjuries } = await import('../src/service.js');
  const b = await getBoard('nfl');
  assert.equal(b.games.length, 0);
  assert.equal(b.props.length, 0);
  assert.equal(b.injuries.length, 0);
  assert.equal(b.sources.lines, 'none');
  const p = await getPicks();
  assert.equal(p.value.length + p.locks.length, 0);
  assert.equal(p.live, false);
  assert.equal(p.demo, false);
  for (const d of await getInjuries()) assert.equal(d.injuries.length, 0);
});
