import test from 'node:test';
import assert from 'node:assert/strict';
import { loadUI, memoryStorage } from './support/load-ui.mjs';

const { storage: S } = loadUI();
const draft = (comment, extra = {}) => ({ cellId: 'cell-a', captureId: 'cap-1', decision: null, comment, updatedAt: '2026-11-14T00:00:00Z', ...extra });

test('local store namespaces by project and verifies writes by read-back', () => {
  const ls = memoryStorage();
  const a = S.createLocalStore('proj-a', ls), b = S.createLocalStore('proj-b', ls);
  assert.equal(a.available, true);
  const r = a.save('cell-a@cap-1', draft('hi'), 0);
  assert.equal(r.ok, true); assert.equal(r.draft.rev, 1);
  assert.equal(a.loadAll().size, 1); assert.equal(b.loadAll().size, 0);
  assert.ok([...ls._map.keys()].every(k => k.startsWith('visual-acceptance:review:v1:')));
});

test('optimistic concurrency: stale baseRev is a conflict, not an overwrite', () => {
  const ls = memoryStorage();
  const tab1 = S.createLocalStore('p', ls), tab2 = S.createLocalStore('p', ls);
  assert.equal(tab1.save('k', draft('one'), 0).draft.rev, 1);
  assert.equal(tab2.save('k', draft('two'), 1).draft.rev, 2);
  const c = tab1.save('k', draft('stale edit'), 1);
  assert.equal(c.conflict, true); assert.equal(c.theirs.comment, 'two');
  assert.equal(tab1.read('k').comment, 'two');
  const f = tab1.save('k', draft('mine wins'), 1, { force: true });
  assert.equal(f.ok, true); assert.equal(f.draft.rev, 3);
});

test('write failures surface as errors (never reported as saved)', () => {
  const s = S.createLocalStore('p', memoryStorage({ failWrites: true }));
  const r = s.save('k', draft('x'), 0);
  assert.ok(r.error); assert.ok(!r.ok);
});

test('unavailable storage is reported explicitly', () => {
  const broken = { get length() { return 0; }, key() { return null; }, getItem() { return null; }, setItem() { throw new Error('SecurityError'); }, removeItem() {} };
  const s = S.createLocalStore('p', broken);
  assert.equal(s.available, false); assert.match(s.availabilityError, /SecurityError/);
  assert.match(s.save('k', draft('x'), 0).error, /localStorage/);
});

test('pusher serializes and coalesces server writes', async () => {
  let calls = 0, inflight = 0, maxInflight = 0;
  const push = S.createPusher(async () => { calls++; inflight++; maxInflight = Math.max(maxInflight, inflight); await new Promise(r => setTimeout(r, 20)); inflight--; return calls; });
  const all = await Promise.all([push(), push(), push(), push()]);
  assert.equal(maxInflight, 1);
  assert.ok(calls <= 2, 'calls coalesced: ' + calls);
  assert.equal(all.length, 4);
  let fail = true;
  const p2 = S.createPusher(async () => { if (fail) { fail = false; throw new Error('down'); } return 'ok'; });
  await assert.rejects(p2(), /down/);
  assert.equal(await p2(), 'ok');
});

test('server client sends token header only on writes and handles 304', async () => {
  const seen = [];
  const fetchFn = async (url, opts = {}) => {
    seen.push({ url, method: opts.method || 'GET', headers: opts.headers || {} });
    const json = b => ({ ok: true, status: 200, headers: { get: () => 'W/"1"' }, text: async () => JSON.stringify(b) });
    if (url === '/api/session') return json({ schemaVersion: 1, projectId: 'p', sourceId: 'src-1', token: 'tok' });
    if (url === '/api/review' && opts.headers['If-None-Match']) return { ok: false, status: 304, headers: { get: () => null }, text: async () => '' };
    if (url === '/api/drafts' && opts.method === 'PUT') return json({ savedAt: 'now' });
    return json({});
  };
  const c = S.createServerClient(fetchFn, '');
  assert.equal((await c.detect()).sourceId, 'src-1');
  assert.equal((await c.getReview('W/"1"')).notModified, true);
  await c.putDrafts([{ cellId: 'a' }]);
  const put = seen.find(s => s.method === 'PUT');
  assert.equal(put.headers['X-Visual-Acceptance-Token'], 'tok');
  assert.ok(!seen.filter(s => s.method === 'GET').some(s => s.headers['X-Visual-Acceptance-Token']), 'token never on reads');
  assert.ok(!seen.some(s => s.url.includes('tok')), 'token never in URL');
});
