// SYNTHETIC core store for review-UI browser tests using core's real export and
// loopback server. These generated PNGs are UI fixtures, never app evidence.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { REVIEW_DIR } from './fixture.mjs';

export const PACKAGE_ROOT = join(REVIEW_DIR, '..', '..', '..');
const T = '2026-11-18T00:00:00.000Z';
const NOTE = 'SYNTHETIC review-UI browser test; not produced by any app; never acceptance evidence';

/** omit: [[stateId, deviceId]] cells left out of spec (未列入 spec). */
export async function buildCoreStore({ devices, states = ['home', 'list'], omit = [] }) {
  const { EvidenceStore } = await import(pathToFileURL(join(PACKAGE_ROOT, 'scripts/lib/store.mjs')).href);
  const { startReviewServer } = await import(pathToFileURL(join(PACKAGE_ROOT, 'scripts/lib/server.mjs')).href);
  const { PNG } = createRequire(join(PACKAGE_ROOT, 'package.json'))('pngjs');
  const dir = await mkdtemp(join(tmpdir(), 'va-review-core-store-'));
  const orientation = d => d.screen.width >= d.screen.height ? 'landscape' : 'portrait';
  const cells = [];
  for (const s of states) for (const d of devices) if (!omit.some(([a, b]) => a === s && b === d.id)) cells.push({ scenarioId: 'main', stateId: s, deviceId: d.id, orientation: orientation(d), variantId: 'default', checkpoints: ['Synthetic UI test only'] });
  const repo = join(dir, 'repo'); await mkdir(repo);
  execFileSync('git', ['init', '-q', repo]); await writeFile(join(repo, 'README.txt'), 'synthetic\n');
  execFileSync('git', ['-C', repo, 'add', '.']); execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'synthetic']);
  const store = new EvidenceStore(join(dir, 'store'));
  const init = await store.init({ schemaVersion: 1, project: { id: 'review-ui-core-synthetic', name: 'SYNTHETIC review-UI test (not app evidence)' }, spec: { revision: 'spec-1', scenarios: [{ id: 'main', label: 'Synthetic' }], states: states.map(id => ({ id, label: id, kind: 'state' })), devices, variants: [{ id: 'default', label: 'Default' }], cells } });
  const source = await store.snapshotSource(repo);
  const artifact = join(dir, 'artifact.bin'); await writeFile(artifact, 'synthetic');
  await store.addBuild({ id: 'build-1', sourceSnapshotId: source.id, artifact: { path: artifact }, platform: 'synthetic', command: 'synthetic', createdAt: T, immutable: true });
  await store.addRuntime({ id: 'runtime-1', buildId: 'build-1', adapter: { name: 'synthetic-ui-test', version: '1' }, app: { id: 'synthetic', version: '1' }, fixture: { id: 'ui-test', version: '1', mode: 'controlled-io', description: NOTE }, environment: { synthetic: true }, immutable: true, driftDetected: false, limitations: [NOTE] });
  await store.setTarget({ buildId: 'build-1', runtimeId: 'runtime-1', specRev: 'spec-1' });
  let n = 0;
  for (const cell of init.spec.cells) {
    n++;
    const d = devices.find(x => x.id === cell.deviceId), w = Math.round(d.screen.width / 8), h = Math.round(d.screen.height / 8);
    const png = new PNG({ width: w, height: h });
    for (let i = 0; i < png.data.length; i += 4) { png.data[i] = (n * 50) % 255; png.data[i + 1] = 180; png.data[i + 2] = (n * 90) % 255; png.data[i + 3] = 255; }
    const file = join(dir, `shot-${n}.png`); await writeFile(file, PNG.sync.write(png));
    await store.addCapture({ id: `capture-${n}`, cellId: cell.id, sourceSnapshotId: source.id, buildId: 'build-1', runtimeId: 'runtime-1', specRev: 'spec-1', createdAt: T, status: 'captured',
      assets: [{ id: 'shot', kind: 'screenshot', path: file, capturedAt: T, width: w, height: h }],
      actions: [{ at: T, type: 'synthetic', description: 'Synthetic UI test', source: 'review-ui-test' }],
      assertions: [{ description: 'Synthetic image only', result: 'pass', basis: 'visual', evidenceAssetIds: ['shot'] }],
      // The store schema requires this literal; fixture + limitations explicitly
      // disclose that these generated test images are not real app evidence.
      provenance: { adapter: 'synthetic-ui-test', adapterVersion: '1', deviceId: cell.deviceId, deviceKind: 'synthetic', source: 'real-app', fixtureDescription: NOTE },
      limitations: [NOTE], blockers: [] });
  }
  return { dir, store, serve: () => startReviewServer(store, { port: 0, reviewDir: REVIEW_DIR }) };
}
