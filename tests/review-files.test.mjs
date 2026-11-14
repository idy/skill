import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './helpers.mjs';
import { startReviewServer } from '../scripts/lib/server.mjs';
import { reviewFiles } from '../scripts/lib/review-files.mjs';

test('export and loopback expose only identical manifest UI resources and generated evidence/data', async t => {
  const f = await fixture(t); await f.store.addCapture(f.capture());
  const ui = join(f.dir, 'ui'); await mkdir(join(ui, 'tests'), { recursive: true });
  const resources = { 'index.html': '<script src="review-data.js"></script>', 'review.js': '/* test UI */' };
  for (const [name, content] of Object.entries(resources)) await writeFile(join(ui, name), content);
  await writeFile(join(ui, 'ui-files.json'), JSON.stringify({ files: Object.keys(resources) }));
  await writeFile(join(ui, 'README.md'), 'private development notes');
  await writeFile(join(ui, 'tests', 'fixture.json'), '{"private":true}');
  const out = join(f.dir, 'export'); await f.store.export(out, ui);
  assert.deepEqual((await readdir(out)).sort(), ['evidence', 'index.html', 'review-data.js', 'review.js', 'review.json']);
  const server = await startReviewServer(f.store, { reviewDir: ui }); t.after(() => server.close());
  for (const [name, content] of Object.entries(resources)) {
    assert.equal(await readFile(join(out, name), 'utf8'), content);
    assert.equal(await fetch(server.url + '/' + name).then(r => r.text()), content);
  }
  for (const path of ['/tests/fixture.json', '/ui-files.json', '/README.md']) assert.equal((await fetch(server.url + path)).status, 404, path);
});

test('manifest rejects traversal, escaped/absolute paths, duplicates, generated data and symlinks before export', async t => {
  const f = await fixture(t), ui = join(f.dir, 'ui'); await mkdir(ui);
  await writeFile(join(ui, 'index.html'), 'test');
  await symlink(join(ui, 'index.html'), join(ui, 'linked.js'));
  for (const files of [[], ['index.html', '../secret.js'], ['index.html', '/secret.js'], ['index.html', 'a\\b.js'], ['index.html', '%2e%2e.js'], ['index.html', 'index.html'], ['index.html', 'review-data.js'], ['index.html', 'linked.js']]) {
    await writeFile(join(ui, 'ui-files.json'), JSON.stringify({ files }));
    await assert.rejects(reviewFiles(ui), /UI/);
    await assert.rejects(f.store.export(join(f.dir, 'out'), ui), /UI/);
    await assert.rejects(startReviewServer(f.store, { reviewDir: ui }), /UI/);
  }
});
