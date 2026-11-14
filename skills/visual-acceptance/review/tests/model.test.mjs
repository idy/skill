// Unit tests for review-model.js against the FIXTURE view model (review-UI only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildFixture, cellIdFor, REVIEW_DIR } from './support/fixture.mjs';
import { loadUI, plain } from './support/load-ui.mjs';

const { model: M } = loadUI();
const fx = () => M.prepareView(buildFixture().view);
const find = (v, scenarioId, stateId, deviceId, orientation, variantId = 'default') => v.cellsById.get(cellIdFor({ scenarioId, stateId, deviceId, orientation, variantId }));
const NOW = '2026-11-14T12:00:00.000Z';

function decided(view, drafts, cell, decision, comment = 'x', captureId) {
  const capId = captureId !== undefined ? captureId : (cell.capture ? cell.capture.id : null);
  const d = Object.assign(M.newDraft(cell, capId, NOW), { decision, comment, rev: 1 });
  drafts.set(M.draftKey(cell.id, capId), d);
  return d;
}

test('prepareView builds rows (scenario×state/transition), device/orientation columns and variants', () => {
  const v = fx();
  assert.equal(v.cells.length, 13);
  assert.deepEqual(plain(v.columns.map(c => c.key)), ['phone-a|portrait', 'phone-a|landscape', 'tablet-b|portrait']);
  assert.deepEqual(plain(v.rows.map(r => r.stateId)), ['cart-empty', 'cart-filled', 'pay-success', 'submit-order', 'settings-main']);
  assert.equal(v.rows.find(r => r.stateId === 'submit-order').kind, 'transition');
  assert.deepEqual(plain(v.variantList.map(x => x.id)), ['default', 'dark']);
  // tablet declares its screen; phone size comes from the captured asset; landscape phone is unknown (no image) — never rotated from portrait
  assert.deepEqual(plain(v.columns[2].size), { w: 1600, h: 2560 });
  assert.equal(v.columns[2].sizeSource, 'spec');
  assert.deepEqual(plain(v.columns[0].size), { w: 1170, h: 2532 });
  assert.equal(v.columns[1].size, null);
});

test('rejects unsupported schema versions with explicit errors', () => {
  const raw = buildFixture().view; raw.schemaVersion = 2;
  assert.throws(() => M.prepareView(raw), /schemaVersion/);
  assert.throws(() => M.prepareView(null), /JSON object/);
});

test('evidence facts: missing, blocked, broken path kept, process gap, orientation mismatch', () => {
  const v = fx();
  assert.equal(find(v, 'checkout', 'cart-empty', 'phone-a', 'landscape').evidence, 'missing');
  const blocked = find(v, 'checkout', 'cart-filled', 'phone-a', 'landscape');
  assert.equal(blocked.evidence, 'blocked'); assert.match(JSON.stringify(blocked.blockers), /横屏/);
  const seq = find(v, 'checkout', 'submit-order', 'phone-a', 'portrait');
  assert.equal(seq.kind, 'transition'); assert.equal(seq.assets.frames.length, 6); assert.equal(seq.processGap, false);
  assert.deepEqual(plain(seq.assets.frames.map(f => f.offsetMs)), [0, 80, 160, 240, 400, 640]);
  const endOnly = find(v, 'checkout', 'submit-order', 'tablet-b', 'portrait');
  assert.equal(endOnly.processGap, true, 'single end screenshot must not count as transition evidence');
  assert.equal(find(v, 'checkout', 'pay-success', 'tablet-b', 'portrait').orientationMismatch, true);
  assert.equal(find(v, 'checkout', 'pay-success', 'phone-a', 'portrait').orientationMismatch, false);
});

test('transition eligibility: >=3 ordered frames, bound trigger/start/end, visible change; video alone is not motion proof', () => {
  assert.equal(M.framesOrdered([{ offsetMs: 0 }, { offsetMs: 10 }]), true);
  assert.equal(M.framesOrdered([{ offsetMs: 0 }, { offsetMs: 0 }]), false);
  const fr = (id, o, sha = id) => ({ id, kind: 'frame', offsetMs: o, sha256: sha, pixelSha256: id.repeat(64) });
  const ok = { status: 'captured', actions: [{ at: 'x', type: 'tap', description: 'd' }], assets: [fr('a', 0), fr('b', 50), fr('c', 100)], transition: { fromStateId: 's', toStateId: 't', triggerActionIndex: 0, startEvidenceAssetId: 'a', endEvidenceAssetId: 'c' } };
  const good = M.captureFacts('transition', ok);
  assert.equal(good.processGap, false); assert.equal(good.transition.trigger.type, 'tap'); assert.equal(good.transition.startAssetId, 'a'); assert.equal(good.transition.endAssetId, 'c');
  const gapOf = mut => { const c = JSON.parse(JSON.stringify(ok)); mut(c); return M.captureFacts('transition', c); };
  assert.match(gapOf(c => { c.assets.pop(); c.transition.endEvidenceAssetId = 'b'; }).transition.gaps.join(), /需至少 3 帧/);
  assert.match(gapOf(c => { c.assets[1].offsetMs = 0; }).transition.gaps.join(), /顺序无效/);
  assert.match(gapOf(c => { delete c.transition.triggerActionIndex; }).transition.gaps.join(), /触发动作/);
  assert.match(gapOf(c => { c.transition.startEvidenceAssetId = 'b'; }).transition.gaps.join(), /起始帧未绑定/);
  assert.match(gapOf(c => { c.transition.endEvidenceAssetId = 'nope'; }).transition.gaps.join(), /结束帧未绑定/);
  assert.match(gapOf(c => { c.assets.forEach(a => { a.pixelSha256 = 'a'.repeat(64); }); }).transition.gaps.join(), /完全相同/);
  assert.match(gapOf(c => { c.assets.forEach(a => { delete a.pixelSha256; }); }).transition.gaps.join(), /文件哈希不同不能证明画面变化/);
  assert.equal(gapOf(c => { delete c.transition; }).processGap, true);
  assert.equal(M.captureFacts('transition', { status: 'captured', assets: [{ kind: 'screenshot' }, { kind: 'video', durationMs: 900 }] }).processGap, true, 'video alone is not motion proof');
});

test('reviewProtocol: AI reviews under another protocol are history only, never current', () => {
  const raw = buildFixture().view; raw.reviewProtocol = 'visual-acceptance-2';
  const pass = cellIdFor({ scenarioId: 'checkout', stateId: 'cart-empty', deviceId: 'phone-a', orientation: 'portrait', variantId: 'default' });
  let c = M.prepareView(raw).cellsById.get(pass);
  assert.equal(c.aiVerdict, 'stale', 'old-protocol pass is not current');
  assert.match(c.aiOld[0].staleReasons.join(), /协议不匹配/);
  raw.cells.find(x => x.id === pass).aiReviews[0].reviewProtocol = 'visual-acceptance-2';
  c = M.prepareView(raw).cellsById.get(pass);
  assert.equal(c.aiVerdict, 'pass');
});

test('historical human reviews for removed cells are exposed, stale', () => {
  const v = fx();
  assert.equal(v.historicalHumanReviews.length, 1); assert.equal(v.historicalHumanReviews[0].stale, true);
});

test('AI verdict is only current for the current capture; old AI is stale, never current', () => {
  const v = fx();
  const c = find(v, 'checkout', 'cart-filled', 'phone-a', 'portrait');
  assert.equal(c.version, 2); assert.equal(c.aiVerdict, 'question');
  assert.equal(c.aiOld.length, 1); assert.equal(c.aiOld[0].verdict, 'pass');
  // currentAIReview pointing to a stale/other-capture review is ignored
  const raw = buildFixture().view; const rc = raw.cells.find(x => x.id === c.id);
  rc.currentAIReview = rc.aiReviews[0];
  assert.equal(M.prepareView(raw).cellsById.get(c.id).aiVerdict, 'question');
  rc.currentAIReview = null; rc.aiReviews = [rc.aiReviews[0]];
  assert.equal(M.prepareView(raw).cellsById.get(c.id).aiVerdict, 'stale');
});

test('human state: old-version opinions show as reopen, never inherited; drafts never touch AI', () => {
  const v = fx(); const drafts = new Map();
  const c = find(v, 'checkout', 'cart-filled', 'phone-a', 'portrait');
  assert.equal(M.humanState(c, drafts).state, 'reopen');
  decided(v, drafts, c, 'pass', '', c.captures[0].id); // decision on OLD capture
  const hs = M.humanState(c, drafts);
  assert.equal(hs.state, 'reopen'); assert.equal(M.isResolved(hs), false);
  decided(v, drafts, c, 'needs-change', '运费说明缺失');
  assert.equal(M.humanState(c, drafts).state, 'needs-change');
  assert.equal(c.aiVerdict, 'question', 'human decision does not change AI verdict');
});

test('default filter focuses AI question/fail, evidence problems and unresolved human items', () => {
  const v = fx(); const drafts = new Map(); const f = M.defaultFilter();
  const match = () => v.cells.filter(c => M.matchesFilter(c, M.humanState(c, drafts), f, new Set())).map(c => c.id);
  assert.equal(match().length, 13);
  const pass = find(v, 'checkout', 'cart-empty', 'phone-a', 'portrait');
  decided(v, drafts, pass, 'pass', '');
  assert.ok(!match().includes(pass.id), 'AI pass + human pass leaves the attention view');
  const fail = find(v, 'checkout', 'cart-empty', 'tablet-b', 'portrait');
  decided(v, drafts, fail, 'pass', '');
  assert.ok(match().includes(fail.id), 'AI fail stays in attention even after human decision');
  const aiFail = Object.assign(M.defaultFilter(), { preset: 'all', ai: ['fail'] });
  assert.deepEqual(v.cells.filter(c => M.matchesFilter(c, M.humanState(c, drafts), aiFail, new Set())).map(c => c.id), [fail.id]);
  const ev = Object.assign(M.defaultFilter(), { preset: 'evidence' });
  const broken = new Set([find(v, 'checkout', 'cart-filled', 'tablet-b', 'portrait').id]);
  const evIds = v.cells.filter(c => M.matchesFilter(c, M.humanState(c, drafts), ev, broken)).map(c => c.id);
  assert.equal(evIds.length, 5, 'missing + blocked + process gap + orientation + broken');
});

test('frozen queue: priority order, next skips resolved by ID, filters never reindex, back works', () => {
  const v = fx(); const drafts = new Map();
  const q = M.createQueue(v, drafts, M.defaultFilter(), new Set(), NOW);
  assert.ok(Object.isFrozen(q) && Object.isFrozen(q.ids));
  const first = v.cellsById.get(q.ids[0]);
  assert.equal(first.aiVerdict, 'fail');
  const resolved = id => M.isResolved(M.humanState(v.cellsById.get(id), drafts));
  decided(v, drafts, first, 'needs-change', 'x');
  const n1 = M.queueNext(q, q.ids[0], resolved);
  assert.equal(n1, q.ids[1]);
  // user resolves item #3 from the matrix out of order; queue skips it by ID
  decided(v, drafts, v.cellsById.get(q.ids[2]), 'pass', '');
  decided(v, drafts, v.cellsById.get(q.ids[1]), 'pass', '');
  assert.equal(M.queueNext(q, q.ids[1], resolved), q.ids[3]);
  // the filtered list now has fewer items, but the snapshot is unchanged
  const pendingNow = Object.assign(M.defaultFilter(), { preset: 'pending' });
  const nowFiltered = v.cells.filter(c => M.matchesFilter(c, M.humanState(c, drafts), pendingNow, new Set()));
  assert.ok(nowFiltered.length < q.ids.length);
  assert.equal(q.ids.length, 13);
  assert.equal(M.queuePrev(q, q.ids[3]), q.ids[2]);
  assert.equal(M.queueAdjacent(q, q.ids[0], 1), q.ids[1]);
  assert.equal(M.queueAdjacent(q, q.ids[0], -1), null);
  assert.deepEqual(plain(M.queueStats(q, resolved)), { total: 13, done: 3 });
  assert.equal(M.queueFirstUnresolved(q, resolved), q.ids[3]);
});

test('feedback batch matches the core contract shape; decisions bridge to verdicts', async () => {
  const v = fx(); const drafts = new Map();
  const a = find(v, 'checkout', 'cart-empty', 'tablet-b', 'portrait');
  const b = find(v, 'checkout', 'cart-empty', 'phone-a', 'landscape'); // missing evidence
  const c = find(v, 'checkout', 'submit-order', 'tablet-b', 'portrait');
  const d = find(v, 'settings', 'settings-main', 'phone-a', 'portrait');
  const old = find(v, 'checkout', 'cart-filled', 'phone-a', 'portrait');
  decided(v, drafts, a, 'needs-change', '按钮缺失');
  decided(v, drafts, b, 'not-applicable', '产品不支持横屏');
  decided(v, drafts, c, 'blocked', '没有过程帧');
  decided(v, drafts, d, 'pass', '');
  decided(v, drafts, old, 'pass', '', old.captures[0].id);
  const bad = find(v, 'checkout', 'pay-success', 'phone-a', 'portrait');
  decided(v, drafts, bad, 'needs-change', '   ');
  const col = M.collectSubmittable(v, drafts);
  assert.equal(col.ready.length, 4); assert.equal(col.invalid.length, 1); assert.equal(col.oldOnly.length, 1);
  const batch = M.buildBatch(v, col.ready, { batchId: 'batch-t1', sourceId: 'src-1', submittedAt: NOW, reviewer: 'Rae' });
  assert.equal(batch.schemaVersion, 1); assert.equal(batch.projectId, 'review-ui-fixture');
  const byCell = Object.fromEntries(batch.edits.map(e => [e.cellId, e]));
  assert.equal(byCell[a.id].verdict, 'fail'); assert.equal(byCell[a.id].comment, '[需修改] 按钮缺失'); assert.equal(byCell[a.id].decision, 'needs-change');
  assert.equal(byCell[b.id].verdict, 'question'); assert.equal(byCell[b.id].captureId, null); assert.equal(byCell[b.id].buildId, null); assert.equal(byCell[b.id].runtimeId, null);
  assert.equal(byCell[c.id].verdict, 'question'); assert.match(byCell[c.id].comment, /^\[阻塞\]/);
  assert.equal(byCell[d.id].verdict, 'pass'); assert.equal(byCell[d.id].comment, '');
  assert.equal(byCell[a.id].buildId, a.capture.buildId); assert.equal(byCell[a.id].specRev, a.capture.specRev);
  assert.ok(!byCell[old.id], 'old-capture decision is not rebound to the new capture');
  for (const e of batch.edits) {
    assert.ok(['pass', 'question', 'fail'].includes(e.verdict));
    if (e.verdict !== 'pass') assert.ok(e.comment.trim());
    assert.equal(e.reviewer, 'Rae');
  }
  // When integrated next to core, validate with the real core validator too.
  const core = join(REVIEW_DIR, '..', '..', '..', 'scripts', 'lib', 'contracts.mjs');
  if (existsSync(core)) {
    const { validateFeedback } = await import(pathToFileURL(core));
    const spec = { cells: v.cells.map(x => ({ id: x.id })) };
    const captureById = new Map(); v.captureById.forEach((info, id) => captureById.set(id, { ...info.capture, cellId: info.cellId }));
    assert.doesNotThrow(() => validateFeedback(plain(batch), { projectId: v.project.id, sourceId: 'src-1', specByRev: new Map(batch.edits.map(e => [e.specRev, spec])), captureById }));
  }
});

test('submitted marker: a draft edited after submission becomes submittable again', () => {
  const v = fx(); const drafts = new Map();
  const a = find(v, 'checkout', 'cart-empty', 'tablet-b', 'portrait');
  const d = decided(v, drafts, a, 'needs-change', 'x');
  d.rev = 2; d.submitted = { batchId: 'b1', rev: 2, at: NOW };
  assert.equal(M.collectSubmittable(v, drafts).ready.length, 0);
  assert.equal(M.humanState(a, drafts).submitted, true);
  d.rev = 3;
  assert.equal(M.collectSubmittable(v, drafts).ready.length, 1);
});

test('export/import round trip with version checks and located errors', () => {
  const v = fx(); const drafts = new Map();
  const a = find(v, 'checkout', 'cart-empty', 'tablet-b', 'portrait');
  const old = find(v, 'checkout', 'cart-filled', 'phone-a', 'portrait');
  decided(v, drafts, a, 'needs-change', '按钮缺失');
  decided(v, drafts, old, null, '旧版只写了评论', old.captures[0].id);
  const ex = M.buildExport(v, drafts, { batchId: 'batch-x', sourceId: 'static-1', submittedAt: NOW, reviewer: 'Rae', storageScope: 'browser-local test' });
  assert.equal(ex.kind, 'visual-acceptance-human-feedback'); assert.equal(ex.drafts.length, 2); assert.equal(ex.edits.length, 1);
  const text = JSON.stringify(ex);
  // into empty store: both new, old version flagged
  const r1 = M.analyzeImport(text, v, new Map());
  assert.deepEqual(plain(r1.fatal), []); assert.deepEqual(plain(r1.errors), []);
  assert.deepEqual(plain(r1.items.map(i => i.status)), ['new', 'new']);
  assert.equal(r1.items.find(i => i.draft.cellId === old.id).oldVersion, true);
  assert.equal(r1.items.find(i => i.draft.cellId === old.id).draft.captureId, old.captures[0].id, 'import keeps original capture binding');
  // same content → same; changed → conflict
  assert.deepEqual(plain(M.analyzeImport(text, v, drafts).items.map(i => i.status)), ['same', 'same']);
  const changed = JSON.parse(text); changed.drafts[0].comment = '改过了';
  assert.equal(M.analyzeImport(JSON.stringify(changed), v, drafts).items[0].status, 'conflict');
  // version/project checks
  assert.match(M.analyzeImport(JSON.stringify({ ...ex, schemaVersion: 9 }), v, drafts).fatal[0], /schemaVersion/);
  assert.match(M.analyzeImport(JSON.stringify({ ...ex, projectId: 'other', project: { id: 'other' } }), v, drafts).fatal[0], /项目不匹配/);
  const badCell = JSON.parse(text); badCell.drafts[1].cellId = 'cell-nope';
  assert.deepEqual(plain(M.analyzeImport(JSON.stringify(badCell), v, drafts).errors[0]), { path: 'drafts[1].cellId', message: '未知格子 "cell-nope"' });
  const badCap = JSON.parse(text); badCap.drafts[0].captureId = old.captures[0].id;
  assert.equal(M.analyzeImport(JSON.stringify(badCap), v, drafts).errors[0].path, 'drafts[0].captureId');
  const badBuild = JSON.parse(text); badBuild.drafts[0].buildId = 'build-x';
  assert.equal(M.analyzeImport(JSON.stringify(badBuild), v, drafts).errors[0].path, 'drafts[0].buildId');
  const syntax = M.analyzeImport('{\n  "schemaVersion": 1,\n  oops\n}', v, drafts);
  assert.match(syntax.fatal[0], /JSON 语法错误（第 3 行/);
  // a plain core feedback batch (edits only) is importable too
  const coreBatch = { schemaVersion: 1, batchId: 'b', projectId: v.project.id, sourceId: 's', submittedAt: NOW, edits: [{ cellId: a.id, captureId: a.capture.id, buildId: a.capture.buildId, runtimeId: a.capture.runtimeId, specRev: 'spec-1', verdict: 'fail', comment: '[需修改] y', reviewer: 'r' }] };
  const r2 = M.analyzeImport(JSON.stringify(coreBatch), v, new Map());
  assert.equal(r2.items[0].draft.decision, 'needs-change'); assert.equal(r2.items[0].draft.comment, 'y');
});

test('copy text carries project/cell/device/image/build/spec for every opinion', () => {
  const v = fx(); const drafts = new Map();
  const a = find(v, 'checkout', 'cart-empty', 'tablet-b', 'portrait');
  const d = decided(v, drafts, a, 'needs-change', '按钮缺失');
  const t = M.formatFeedbackText(v, [d], { reviewer: 'Rae', now: NOW, storageScope: 'browser-local' });
  for (const s of ['review-ui-fixture', a.id, 'Tablet B (fixture)', '竖屏', '1600×2560 px', a.capture.id, 'build build-1', 'spec spec-1', a.capture.assets[0].id, 'sha256:' + a.capture.assets[0].sha256.slice(0, 12), a.capture.assets[0].path, '[需修改]', '按钮缺失', 'spec checkpoints:']) {
    assert.ok(t.includes(s), 'missing ' + s);
  }
});

test('provenance labels: real device, simulator with controlled IO, fixture', () => {
  assert.equal(M.provenanceOf({ provenance: { source: 'real-app', deviceKind: 'physical', adapter: 'device-hub' } }).kind, 'device');
  const sim = M.provenanceOf({ provenance: { source: 'real-app', deviceKind: 'simulator', adapter: 'device-hub', fixtureDescription: 'Controlled network IO' } });
  assert.equal(sim.kind, 'local'); assert.equal(sim.real, true); assert.equal(sim.controlledIO, true);
  const fxp = M.provenanceOf({ provenance: { source: 'review-ui-fixture' } });
  assert.equal(fxp.kind, 'fixture'); assert.equal(fxp.real, false);
  assert.equal(M.provenanceOf(null).real, false);
});
