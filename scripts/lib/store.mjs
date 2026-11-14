import { mkdir, readFile, writeFile, rename, readdir, copyFile, lstat, realpath, rm } from 'node:fs/promises';
import { resolve, join, relative, dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { defaultReviewDir, reviewFiles } from './review-files.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { AI_REVIEW_PROTOCOL, check, object, text, id, list, choice, time, canonical, sha256, identity, validateProject, validateFeedback, staleReasons, imageSetHash } from './contracts.mjs';
import { decodeImage, hashArtifact } from './media.mjs';
import { transitionFindings } from './transitions.mjs';
const exec = promisify(execFile);
const now = () => new Date().toISOString();
const readJSON = async p => JSON.parse(await readFile(p, 'utf8'));
const imageAssets = c => c.assets.filter(a => a.kind !== 'video');
const safeName = s => id(s).replaceAll(':', '_');

export class EvidenceStore {
  constructor(path = '.visual-acceptance') { this.root = resolve(path); }
  async state() { return readJSON(join(this.root, 'state.json')); }
  async record(kind, recordId) { id(recordId); return readJSON(join(this.root, kind, `${safeName(recordId)}.json`)); }
  async records(state, kind) { return Promise.all((state[kind] ?? []).map(v => this.record(kind, v))); }
  async immutable(kind, value) {
    id(value.id); const dir = join(this.root, kind); await mkdir(dir, { recursive: true, mode: 0o700 });
    // Name collision is checked against full ID, including ':' vs '_'.
    const path = join(dir, `${safeName(value.id)}.json`);
    try { await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; check(canonical(await readJSON(path)) === canonical(value), `Immutable ${kind}/${value.id} already exists with different content`); }
    return value;
  }
  async transaction(fn, initializing = false) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const lock = join(this.root, '.lock'); let held = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      try { await mkdir(lock); held = true; break; } catch (e) { if (e.code !== 'EEXIST') throw e; await delay(25); }
    }
    check(held, 'Store busy; if a process crashed, verify it stopped before removing .lock');
    try {
      let state; try { state = await this.state(); } catch (e) { if (!(initializing && e.code === 'ENOENT')) throw e; }
      const result = await fn(state);
      if (result.state) { const tmp = join(this.root, `.state-${randomUUID()}.tmp`); await writeFile(tmp, JSON.stringify(result.state, null, 2) + '\n', { mode: 0o600 }); await rename(tmp, join(this.root, 'state.json')); }
      return result.value;
    } finally { await rm(lock, { recursive: true }); }
  }
  async init(input) {
    const data = validateProject(input);
    return this.transaction(async existing => {
      check(!existing, 'Store already initialized; use spec for revisions');
      await this.immutable('specs', { ...data.spec, id: data.spec.revision });
      const state = { schemaVersion: 1, project: data.project, specRev: data.spec.revision, policy: data.policy, target: null, sources: [], builds: [], runtimes: [], captures: [], aiReviews: [], receipts: [], feedback: [], runs: [], activeRunId: null };
      return { state, value: { project: state.project, spec: data.spec } };
    }, true);
  }
  async setSpec(input) {
    const data = validateProject(input);
    return this.transaction(async state => {
      check(state.project.id === data.project.id, 'Project ID cannot change');
      await this.immutable('specs', { ...data.spec, id: data.spec.revision });
      if (state.policy.revision === data.policy.revision) check(canonical(state.policy) === canonical(data.policy), 'Policy changed without a new revision');
      state.project = data.project; state.specRev = data.spec.revision; state.policy = data.policy;
      // Existing target intentionally stays stale until explicitly selected for the new spec.
      return { state, value: { specRev: state.specRev, policy: state.policy } };
    });
  }
  async snapshotSource(repo, relatedPaths = []) {
    const root = await realpath(resolve(repo));
    const git = async args => (await exec('git', ['-C', root, ...args], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })).stdout;
    check((await git(['rev-parse', '--show-toplevel'])).toString().trim() === root, 'Source repo must be its Git root');
    const head = (await git(['rev-parse','HEAD'])).toString().trim();
    const diff = await git(['diff','--binary','HEAD','--','.']);
    const status = (await git(['status','--porcelain=v1','-z'])).toString();
    const untracked = (await git(['ls-files','--others','--exclude-standard','-z'])).toString().split('\0').filter(Boolean);
    const related = [];
    for (const name of [...new Set(relatedPaths)].sort()) {
      const absolute = await realpath(resolve(root, name)); const rel = relative(root, absolute);
      check(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Related source path must stay inside repo');
      const digest = await hashArtifact(absolute); related.push({ path: rel.split('\\').join('/'), ...digest });
    }
    // Preserve reconstructable private bytes, not only source hashes. Never mounted by review server.
    await mkdir(join(this.root, 'sourceBlobs'), { recursive: true, mode: 0o700 });
    const saveSourceBlob = async (bytes, hash) => {
      check(sha256(bytes) === hash, 'Source changed while snapshotting related files');
      const path = join(this.root, 'sourceBlobs', hash);
      try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
      catch (e) { if (e.code !== 'EEXIST') throw e; check(sha256(await readFile(path)) === hash, 'Private source blob integrity failure'); }
    };
    await saveSourceBlob(diff, sha256(diff));
    for (const item of related) {
      if (item.kind === 'file') await saveSourceBlob(await readFile(join(root, item.path)), item.sha256);
      else for (const file of item.files) await saveSourceBlob(await readFile(join(root, item.path, file.path)), file.sha256);
    }
    const content = { head, dirtyDiffSha256: sha256(diff), dirty: diff.length > 0, related, untracked, statusSha256: sha256(status) };
    // Verify no source drift while hashing.
    check((await git(['rev-parse','HEAD'])).toString().trim() === head && sha256(await git(['diff','--binary','HEAD','--','.'])) === content.dirtyDiffSha256, 'Source changed while snapshotting; retry with stable source');
    const snapshot = { id: identity('source', content), ...content, reconstruction: { tracked: 'Git HEAD plus binary patch in sourceBlobs/<dirtyDiffSha256>', related: 'Related files in sourceBlobs/<sha256>; directory manifest retains relative names', patchFormat: 'git-diff-binary' } };
    return this.transaction(async state => {
      await this.immutable('sources', snapshot); if (!state.sources.includes(snapshot.id)) state.sources.push(snapshot.id);
      return { state, value: snapshot };
    });
  }
  async addBuild(input) {
    const value = structuredClone(object(input, 'build')); id(value.id); id(value.sourceSnapshotId, 'sourceSnapshotId');
    text(value.platform, 'platform'); text(value.command, 'command'); time(value.createdAt, 'createdAt');
    check(value.immutable === true, 'Dev/HMR builds cannot be acceptance targets; supply an immutable artifact');
    text(value.artifact?.path, 'artifact.path');
    const digest = await hashArtifact(resolve(value.artifact.path));
    if (value.artifact.sha256) check(value.artifact.sha256 === digest.sha256, 'Artifact hash mismatch');
    value.artifact = digest; // private source paths never become review-facing fields
    return this.transaction(async state => {
      check(state.sources.includes(value.sourceSnapshotId), 'Unknown source snapshot');
      check(!state.builds.includes(value.id), 'Build ID already registered; use a new ID');
      await this.immutable('builds', value); state.builds.push(value.id); return { state, value };
    });
  }
  async addRuntime(input) {
    const value = structuredClone(object(input, 'runtime')); id(value.id); id(value.buildId, 'buildId');
    text(value.adapter?.name, 'adapter.name'); text(value.adapter.version, 'adapter.version');
    text(value.app?.id, 'app.id'); text(value.app.version, 'app.version');
    text(value.fixture?.id, 'fixture.id'); text(value.fixture.version, 'fixture.version'); choice(value.fixture.mode, ['none','controlled-io'], 'fixture.mode'); text(value.fixture.description, 'fixture.description');
    object(value.environment, 'environment'); list(value.limitations, 'limitations').forEach(s => text(s, 'limitation'));
    check(typeof value.immutable === 'boolean' && typeof value.driftDetected === 'boolean', 'Runtime needs immutable and driftDetected booleans');
    return this.transaction(async state => {
      check(state.builds.includes(value.buildId), 'Unknown runtime build'); check(!state.runtimes.includes(value.id), 'Runtime ID already registered');
      await this.immutable('runtimes', value); state.runtimes.push(value.id); return { state, value };
    });
  }
  async setTarget(input) {
    for (const key of ['buildId','runtimeId','specRev']) id(input[key], key);
    return this.transaction(async state => {
      check(input.specRev === state.specRev, 'Target spec must be current');
      check(state.builds.includes(input.buildId) && state.runtimes.includes(input.runtimeId), 'Unknown target build/runtime');
      const runtime = await this.record('runtimes', input.runtimeId);
      check(runtime.buildId === input.buildId, 'Runtime build mismatch');
      check(runtime.immutable && !runtime.driftDetected, 'Runtime dev/HMR or drift blocks acceptance');
      state.target = { buildId: input.buildId, runtimeId: input.runtimeId, specRev: input.specRev };
      return { state, value: state.target };
    });
  }
  async saveAsset(input) {
    id(input.id, 'asset.id'); choice(input.kind, ['screenshot','frame','video'], 'asset.kind'); time(input.capturedAt, 'asset.capturedAt'); text(input.path, 'asset.path');
    const bytes = await readFile(resolve(input.path)); check(bytes.length > 0 && bytes.length <= 256 * 1024 * 1024, 'Asset empty or exceeds 256 MiB');
    let media;
    if (input.kind !== 'video') {
      media = decodeImage(bytes);
      check(input.width === media.width && input.height === media.height, 'Image dimensions differ from declared evidence');
    } else {
      check(Number.isFinite(input.durationMs) && input.durationMs > 0, 'Video needs durationMs');
      if (bytes.subarray(4,8).toString() === 'ftyp') media = { ext: 'mp4', mimeType: 'video/mp4' };
      else if (bytes.subarray(0,4).equals(Buffer.from([26,69,223,163]))) media = { ext: 'webm', mimeType: 'video/webm' };
      else throw new Error('Invalid video signature');
    }
    const hash = sha256(bytes); if (input.sha256) check(input.sha256 === hash, 'Asset SHA mismatch');
    const file = `${hash}.${media.ext}`; await mkdir(join(this.root, 'blobs'), { recursive: true, mode: 0o700 });
    try { await writeFile(join(this.root,'blobs',file), bytes, { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; check(sha256(await readFile(join(this.root,'blobs',file))) === hash, 'Existing evidence blob corrupt'); }
    const { path: _path, ...fields } = input;
    return { ...fields, ...media, sha256: hash, bytes: bytes.length, path: `evidence/${file}` };
  }
  async addCapture(input) {
    const value = structuredClone(object(input, 'capture')); id(value.id); id(value.cellId, 'cellId');
    for (const key of ['sourceSnapshotId','buildId','runtimeId','specRev']) id(value[key], key);
    time(value.createdAt, 'createdAt'); choice(value.status, ['captured','blocked'], 'status');
    for (const key of ['assets','actions','assertions','limitations','blockers']) list(value[key], key);
    for (const key of ['limitations','blockers']) value[key].forEach(s => text(s, key));
    for (const key of ['adapter','adapterVersion','deviceId','deviceKind','source','fixtureDescription']) text(value.provenance?.[key], `provenance.${key}`);
    check(value.provenance.source === 'real-app', 'Only real-app evidence is accepted');
    for (const action of value.actions) { time(action.at, 'action.at'); text(action.type, 'action.type'); text(action.description, 'action.description'); text(action.source, 'action.source'); }
    check(value.actions.every((a,i) => i === 0 || Date.parse(a.at) >= Date.parse(value.actions[i-1].at)), 'Actions must be time ordered');
    for (const assertion of value.assertions) {
      text(assertion.description, 'assertion.description'); choice(assertion.result, ['pass','fail','unknown'], 'assertion.result');
      choice(assertion.basis, ['visual','accessibility','runtime','api'], 'assertion.basis'); list(assertion.evidenceAssetIds, 'evidenceAssetIds');
    }
    check(value.status !== 'blocked' || value.blockers.length > 0, 'Blocked capture needs concrete blockers');
    value.assets = await Promise.all(value.assets.map(a => this.saveAsset(a)));
    check(new Set(value.assets.map(a => a.id)).size === value.assets.length, 'Duplicate asset ID');
    for (const assertion of value.assertions) for (const assetId of assertion.evidenceAssetIds) check(value.assets.some(a => a.id === assetId), 'Assertion references unknown asset');
    return this.transaction(async state => {
      check(!state.captures.includes(value.id), 'Capture ID already used; captures are immutable');
      check(state.builds.includes(value.buildId) && state.runtimes.includes(value.runtimeId), 'Unknown capture build/runtime');
      const build = await this.record('builds', value.buildId), runtime = await this.record('runtimes', value.runtimeId), spec = await this.record('specs', value.specRev);
      check(build.sourceSnapshotId === value.sourceSnapshotId && runtime.buildId === value.buildId, 'Capture provenance build/source/runtime mismatch');
      const cell = spec.cells.find(c => c.id === value.cellId); check(cell, 'Unknown capture cell for spec');
      if (!runtime.immutable || runtime.driftDetected) value.blockers.push('Runtime dev/HMR or drift detected');
      if (!imageAssets(value).length) value.blockers.push('No usable screenshot or representative frame evidence');
      if (value.assertions.some(a => a.result !== 'pass')) value.blockers.push('Capture assertions failed or unknown');
      if (!value.assertions.some(a => a.result === 'pass' && a.basis === 'visual' && a.evidenceAssetIds.length)) value.blockers.push('No visual assertion; API/mount success cannot establish a visible state');
      const row = spec.states.find(s => s.id === cell.stateId);
      const temporal = transitionFindings(value, row);
      value.blockers.push(...temporal.blockers); value.limitations.push(...temporal.limitations);
      const captures = await this.records(state, 'captures');
      for (const other of captures) {
        const otherCell = spec.cells.find(c => c.id === other.cellId);
        if (otherCell && otherCell.stateId !== cell.stateId && value.assets.some(a => a.kind === 'screenshot' && other.assets.some(b => b.kind === 'screenshot' && b.sha256 === a.sha256))) value.blockers.push(`Screenshot reused across different states (${other.id}); investigate actual state reachability`);
      }
      value.blockers = [...new Set(value.blockers)]; value.limitations = [...new Set(value.limitations)];
      if (value.blockers.length) value.status = 'blocked';
      value.storedAt = now();
      await this.immutable('captures', value); state.captures.push(value.id); return { state, value };
    });
  }
  async inspectAsset(asset) {
    check(/^evidence\/[a-f0-9]{64}\.(png|jpg|mp4|webm)$/.test(asset.path), 'Invalid stored evidence path');
    const path = join(this.root, 'blobs', asset.path.slice('evidence/'.length));
    const bytes = await readFile(path); check(sha256(bytes) === asset.sha256, 'Evidence image/hash integrity failure');
    const image = asset.kind !== 'video' ? decodeImage(bytes) : null;
    if (image) check(image.width === asset.width && image.height === asset.height, 'Stored image dimensions changed');
    return { bytes, image };
  }
  async verifyAsset(asset) { return (await this.inspectAsset(asset)).bytes; }
  async verifiedCapture(capture) {
    const assets = [], blockers = [];
    for (const asset of capture.assets) {
      // Persisted/supplied fingerprints are only hints. Recompute from the verified blob at
      // every read/record boundary, including legacy records that never stored this field.
      const { pixelSha256: _untrusted, ...fields } = asset;
      try {
        const { image } = await this.inspectAsset(fields);
        assets.push(image ? { ...fields, pixelSha256: image.pixelSha256 } : fields);
      } catch (error) { assets.push(fields); blockers.push(`${asset.id}: ${error.message}`); }
    }
    return { capture: { ...capture, assets }, blockers };
  }
  async reviewData() {
    const state = await this.state(), spec = await this.record('specs', state.specRev);
    const [captures, reviews, batches] = await Promise.all(['captures','aiReviews','feedback'].map(k => this.records(state, k)));
    const cells = [];
    for (const cell of spec.cells) {
      const history = captures.filter(c => c.cellId === cell.id);
      const verified = history.length ? await this.verifiedCapture(history.at(-1)) : { capture: null, blockers: [] };
      const capture = verified.capture;
      if (capture) history[history.length - 1] = capture;
      const reasons = capture ? staleReasons({ ...capture, captureId: capture.id }, capture, state.target, state.policy.revision) : [];
      if (capture?.specRev !== state.specRev && capture) reasons.push('spec revision changed');
      const blockers = [...(capture?.blockers ?? []), ...verified.blockers];
      if (capture) blockers.push(...transitionFindings(capture, spec.states.find(s => s.id === cell.stateId)).blockers);
      const aiReviews = reviews.filter(r => r.cellId === cell.id).map(r => {
        const stale = staleReasons(r, capture, state.target, state.policy.revision, true);
        if (blockers.length) stale.push('Evidence blocked or corrupt'); if (capture?.specRev !== state.specRev) stale.push('spec revision changed');
        return { ...r, stale: stale.length > 0, staleReasons: [...new Set(stale)] };
      });
      const humanReviews = batches.flatMap(b => b.edits.map((e, i) => ({ ...e, id: `${b.batchId}:${i}`, batchId: b.batchId, sourceId: b.sourceId, transport: b.transport, createdAt: b.submittedAt }))).filter(e => e.cellId === cell.id).map(r => {
        const stale = staleReasons(r, capture, state.target, state.policy.revision);
        if (blockers.length) stale.push('Evidence blocked or corrupt'); if (r.specRev !== state.specRev) stale.push('spec revision changed');
        return { ...r, stale: stale.length > 0, staleReasons: [...new Set(stale)] };
      });
      const currentAIReview = aiReviews.filter(r => !r.stale).at(-1) ?? null, currentHumanReview = humanReviews.filter(r => !r.stale).at(-1) ?? null;
      const status = !capture ? 'missing' : blockers.length ? 'blocked' : reasons.length ? 'stale' : currentAIReview?.verdict ?? 'unreviewed';
      cells.push({ ...cell, status, staleReasons: [...new Set(reasons)], blockers, capture, captures: history, aiReviews, humanReviews, currentAIReview, currentHumanReview });
    }
    const builds = await this.records(state, 'builds'), runtimes = await this.records(state, 'runtimes'), sources = await this.records(state, 'sources');
    return { schemaVersion: 1, reviewProtocol: AI_REVIEW_PROTOCOL, project: state.project, spec, target: state.target, policy: state.policy, generatedAt: now(), cells,
      sources: sources.map(s => ({ id: s.id, head: s.head, dirty: s.dirty, dirtyDiffSha256: s.dirtyDiffSha256, relatedInputCount: s.related.length, relatedInputsSha256: sha256(canonical(s.related)) })),
      builds: builds.map(b => ({ ...b, artifact: { sha256: b.artifact.sha256, bytes: b.artifact.bytes, kind: b.artifact.kind } })), runtimes,
      historicalHumanReviews: batches.flatMap(b => b.edits.map((e, i) => ({ ...e, id: `${b.batchId}:${i}`, batchId: b.batchId, sourceId: b.sourceId, transport: b.transport, createdAt: b.submittedAt, stale: true, staleReasons: ['Cell removed from current spec'] }))).filter(e => !spec.cells.some(c => c.id === e.cellId)),
      summary: { total: cells.length, aiPass: cells.filter(c => c.status === 'pass').length, finalAIPass: cells.length > 0 && cells.every(c => c.status === 'pass'), humanPass: cells.filter(c => c.currentHumanReview?.verdict === 'pass').length },
      storage: { mode: 'local-single-reviewer', drafts: 'browser-local and server when available', collaboration: false } };
  }
  async feedbackContext(state, edits) {
    check(list(edits, 'edits').length <= 1000, 'Feedback supports at most 1000 edits');
    const specByRev = new Map();
    for (const edit of edits) {
      id(edit.specRev, 'specRev');
      if (!specByRev.has(edit.specRev)) {
        try { specByRev.set(edit.specRev, await this.record('specs', edit.specRev)); }
        catch (error) { if (error.code === 'ENOENT') throw new Error(`Unknown feedback spec revision: ${edit.specRev}`); throw error; }
      }
    }
    return { projectId: state.project.id, specByRev, captureById: new Map((await this.records(state, 'captures')).map(c => [c.id, c])) };
  }
  async importFeedback(input, { sourceId, transport = 'json-import', allowPersistedRetry = false } = {}) {
    return this.transaction(async state => {
      object(input, 'feedback');
      const context = await this.feedbackContext(state, input.edits);
      // Validate original identities first. A fresh connection can retry an EXACT previously
      // accepted batch with its old source; it cannot use that exception for a new/changed batch.
      const batch = validateFeedback(input, context);
      const existing = (await this.records(state, 'feedback')).find(b => b.batchId === batch.batchId);
      if (existing) {
        const { id: _, transport: __, receivedAt: ___, ...original } = existing;
        check(canonical(original) === canonical(batch), 'Batch ID conflict: content changed');
        if (sourceId && !allowPersistedRetry) check(batch.sourceId === sourceId, 'Feedback source mismatch');
        return { value: { accepted: true, duplicate: true, batchId: batch.batchId } };
      }
      if (sourceId) check(batch.sourceId === sourceId, 'Feedback source mismatch');
      const record = { ...batch, id: batch.batchId, transport, receivedAt: now() };
      await this.immutable('feedback', record); state.feedback.push(record.id);
      return { state, value: { accepted: true, duplicate: false, batchId: batch.batchId } };
    });
  }
  async startRun() {
    return this.transaction(async state => {
      const run = { id: `run-${randomUUID()}`, startedAt: now(), policy: state.policy, events: [], status: 'active', unresolved: [] };
      await this.immutable('runs', run); state.runs.push(run.id); state.activeRunId = run.id;
      return { state, value: run };
    });
  }
  async currentRun(state) {
    check(state.activeRunId, 'No active run; run-start first');
    const start = await this.record('runs', state.activeRunId);
    const names = await readdir(join(this.root, 'runEvents')).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    const events = (await Promise.all(names.map(n => readJSON(join(this.root,'runEvents',n))))).filter(e => e.runId === start.id).sort((a,b) => a.sequence - b.sequence);
    let round = 0;
    for (const event of events) { if (event.type === 'repair') round++; event.effectiveRound = round; }
    return { ...start, events, round, status: events.some(e => ['stop','finish'].includes(e.type)) ? 'stopped' : 'active', unresolved: events.filter(e => e.reason).map(e => e.reason) };
  }
  async budgetEvent(state, input) {
    const run = await this.currentRun(state); check(run.status === 'active', `Run stopped: ${run.unresolved.join('; ') || 'completed'}`);
    choice(input.type, ['repair','image','capture_attempt','stop','finish'], 'run event type');
    const elapsed = (Date.now() - Date.parse(run.startedAt)) / 60000;
    let reason;
    if (elapsed >= run.policy.maxMinutes) reason = `Time budget reached (${run.policy.maxMinutes} minutes)`;
    if (input.type === 'image' && run.events.filter(e => e.type === 'image').length >= run.policy.maxImages) reason = `Image budget reached (${run.policy.maxImages})`;
    if (input.type === 'repair' && run.events.filter(e => e.type === 'repair').length >= run.policy.maxRepairRounds) reason = `Repair round limit reached (${run.policy.maxRepairRounds})`;
    const spec = await this.record('specs', state.specRev), known = new Set(spec.cells.map(c => c.id));
    if (input.type === 'capture_attempt') {
      id(input.cellId, 'cellId'); check(known.has(input.cellId), 'Unknown budget cell');
      check(input.round === undefined || input.round === run.round, `Capture round is derived from persisted repairs: expected ${run.round}`);
      if (run.events.filter(e => e.type === 'capture_attempt' && e.cellId === input.cellId && e.effectiveRound === run.round).length > run.policy.captureRetries) reason = `Capture retry limit reached for ${input.cellId}, round ${run.round}`;
    }
    if (input.type === 'repair') {
      text(input.reason, 'repair root cause'); check(list(input.affectedCellIds, 'affectedCellIds').length > 0 && list(input.regressionCellIds, 'regressionCellIds').length > 0, 'Repair requires affected + regression coverage');
      for (const cellId of [...input.affectedCellIds, ...input.regressionCellIds]) check(known.has(cellId), 'Unknown affected/regression cell');
    }
    if (['stop','finish'].includes(input.type)) text(input.reason, 'concrete unresolved/completion reason');
    const event = { ...input, round: input.type === 'repair' && !reason ? run.round + 1 : run.round, id: `event-${randomUUID()}`, runId: run.id, sequence: run.events.length, createdAt: now(), ...(reason ? { type: 'stop', reason } : {}) };
    await this.immutable('runEvents', event);
    return { event, exhausted: !!reason };
  }
  async stepRun(input) { return this.transaction(async state => ({ value: await this.budgetEvent(state, input) })); }
  async provideImage({ cellId, assetId, sessionId, reviewer, imagesBlocked = false, imageCapable = false }) {
    check(!imagesBlocked, 'Images are blocked in Pi settings; review is blocked, no receipt issued');
    check(imageCapable, 'Current model has no image input capability; review is blocked, no receipt issued');
    id(cellId, 'cellId'); text(sessionId, 'sessionId'); text(reviewer?.provider, 'reviewer.provider'); text(reviewer?.model, 'reviewer.model');
    const data = await this.reviewData(), cell = data.cells.find(c => c.id === cellId);
    check(cell?.capture && !['blocked','stale'].includes(cell.status), `Cell evidence not reviewable: ${cell?.status ?? 'unknown cell'}`);
    const capture = cell.capture, asset = assetId ? imageAssets(capture).find(a => a.id === assetId) : imageAssets(capture)[0]; check(asset, 'Unknown image asset');
    const bytes = await this.verifyAsset(asset);
    const receipt = await this.transaction(async state => {
      // Recheck pointers under lock against changes since reviewData.
      const latest = (await this.records(state, 'captures')).filter(c => c.cellId === cellId).at(-1);
      check(latest?.id === capture.id && canonical(state.target) === canonical(data.target) && state.policy.revision === data.policy.revision && state.specRev === capture.specRev, 'Target changed during image delivery');
      const budget = await this.budgetEvent(state, { type: 'image', cellId, captureId: capture.id, assetId: asset.id });
      check(!budget.exhausted, budget.event.reason);
      const record = { id: `receipt-${randomUUID()}`, sessionId, reviewer, cellId, captureId: capture.id, assetId: asset.id, sha256: asset.sha256, buildId: capture.buildId, runtimeId: capture.runtimeId, specRev: capture.specRev, policyRev: state.policy.revision, reviewProtocol: AI_REVIEW_PROTOCOL, imageSetHash: imageSetHash(capture), createdAt: now() };
      await this.immutable('receipts', record); state.receipts.push(record.id); return { state, value: record };
    });
    return { receipt, asset, bytes, checkpoints: cell.checkpoints };
  }
  async recordAI(input, { sessionId, reviewer, imagesBlocked = false, imageCapable = false } = {}) {
    check(!imagesBlocked && imageCapable, 'Image delivery unavailable; cannot record an AI verdict');
    id(input.cellId, 'cellId'); id(input.captureId, 'captureId'); choice(input.verdict, ['pass','question','fail'], 'verdict');
    text(input.comment, 'Detailed review comment'); list(input.visibleText, 'visibleText').forEach(s => text(s, 'visibleText entry'));
    check(input.visibleText.length || /no (visible )?text|无.*(文字|文本)/i.test(input.comment), 'Record visible text or explicitly explain no visible text');
    list(input.observations, 'observations'); list(input.receiptIds, 'receiptIds');
    return this.transaction(async state => {
      const captures = await this.records(state, 'captures'), current = captures.filter(c => c.cellId === input.cellId).at(-1);
      check(current?.id === input.captureId, 'Review capture is no longer current');
      check(current.status !== 'blocked' && current.blockers.length === 0, 'Evidence blocked');
      const verified = await this.verifiedCapture(current), capture = verified.capture;
      check(verified.blockers.length === 0, `Evidence blocked or corrupt: ${verified.blockers.join('; ')}`);
      check(staleReasons({ ...capture, captureId: capture.id }, capture, state.target, state.policy.revision).length === 0 && state.specRev === capture.specRev, 'Review target is stale');
      const spec = await this.record('specs', capture.specRev), cell = spec.cells.find(c => c.id === capture.cellId);
      check(transitionFindings(capture, spec.states.find(s => s.id === cell?.stateId)).blockers.length === 0, 'Transition evidence is incomplete under current validation; collect and inspect a new capture');
      const run = await this.currentRun(state); check(run.status === 'active', `Run stopped: ${run.unresolved.join('; ') || 'completed'}`);
      if (Date.now() - Date.parse(run.startedAt) >= run.policy.maxMinutes * 60000) {
        const stopped = await this.budgetEvent(state, { type: 'stop', cellId: input.cellId, captureId: input.captureId, reason: 'Time budget reached before recording review' });
        throw new Error(stopped.event.reason);
      }
      const receipts = await Promise.all(input.receiptIds.map(v => { check(state.receipts.includes(v), 'Unknown receipt'); return this.record('receipts', v); }));
      for (const asset of imageAssets(capture)) {
        const receipt = receipts.find(r => r.assetId === asset.id && r.sha256 === asset.sha256);
        check(receipt && receipt.sessionId === sessionId && receipt.captureId === capture.id && receipt.imageSetHash === imageSetHash(capture) && canonical(receipt.reviewer) === canonical(reviewer) && receipt.policyRev === state.policy.revision && receipt.reviewProtocol === AI_REVIEW_PROTOCOL, `Image ${asset.id} was not supplied in this session/model/target; call image tool first`);
        const observation = input.observations.find(o => o.assetId === asset.id && o.sha256 === asset.sha256); text(observation?.detail, `Detailed observation for ${asset.id}`);
      }
      check(input.observations.length === imageAssets(capture).length && new Set(input.observations.map(o => o.assetId)).size === input.observations.length, 'Observations must cover exactly every image');
      const record = { ...structuredClone(input), id: `ai-${randomUUID()}`, buildId: capture.buildId, runtimeId: capture.runtimeId, specRev: capture.specRev, policyRev: state.policy.revision, reviewProtocol: AI_REVIEW_PROTOCOL, imageSetHash: imageSetHash(capture), reviewer, createdAt: now() };
      await this.immutable('aiReviews', record); state.aiReviews.push(record.id); return { state, value: record };
    });
  }
  async export(out, reviewDir = defaultReviewDir) {
    const destination = resolve(out); check(destination !== this.root && !destination.startsWith(this.root + '/'), 'Export outside the private store');
    // Validate all manifest entries before creating or writing any output.
    const files = await reviewFiles(reviewDir);
    const data = await this.reviewData(); await mkdir(destination, { recursive: true });
    for (const [name, source] of files) {
      const target = join(destination, name.slice(1));
      try { check((await lstat(target)).isFile(), 'Export UI target must be a regular file (no symlinks)'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await copyFile(source, target);
    }
    for (const capture of data.cells.flatMap(c => c.captures)) for (const asset of capture.assets) {
      try { const bytes = await this.verifyAsset(asset); const path = join(destination, asset.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); } catch { /* explicit blockers already included in view model */ }
    }
    await writeFile(join(destination, 'review.json'), JSON.stringify(data, null, 2) + '\n');
    const json = JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
    await writeFile(join(destination,'review-data.js'), `globalThis.VISUAL_ACCEPTANCE_DATA = ${json};\n`);
    return { path: destination, cells: data.cells.length, finalAIPass: data.summary.finalAIPass };
  }
}
