import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const packagePath = 'packages/visual-acceptance';
const hostRoot = process.env.PI_TEST_PACKAGE_ROOT;
const expectedTools = ['visual_acceptance_status', 'visual_acceptance_image', 'visual_acceptance_record', 'visual_acceptance_review', 'visual_acceptance_feedback_import', 'visual_acceptance_run'].sort();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env, npm_config_logs_max: '0' } });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
async function files(root, dir = root, result = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    assert.ok(!entry.isSymbolicLink(), `No package symlink: ${path}`);
    if (entry.isDirectory()) await files(root, path, result);
    else result.push(relative(root, path));
  }
  return result.sort();
}
async function load(packageRoot, sandbox) {
  const { DefaultResourceLoader } = await import(pathToFileURL(join(hostRoot, 'dist/core/resource-loader.js')));
  const { SettingsManager } = await import(pathToFileURL(join(hostRoot, 'dist/core/settings-manager.js')));
  const cwd = join(sandbox, 'project'), agentDir = join(sandbox, 'agent');
  await mkdir(cwd, { recursive: true }); await mkdir(agentDir, { recursive: true });
  const settingsManager = SettingsManager.inMemory({ packages: [packageRoot] }, { projectTrusted: true });
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noContextFiles: true });
  await loader.reload();
  const skills = loader.getSkills(), extensions = loader.getExtensions();
  assert.deepEqual(skills.diagnostics, []); assert.deepEqual(extensions.errors, []);
  assert.deepEqual(skills.skills.map(s => s.name), ['visual-acceptance']);
  assert.equal(extensions.extensions.length, 1);
  const tools = extensions.extensions.flatMap(e => [...e.tools.keys()]).sort();
  assert.deepEqual(tools, expectedTools);
  assert.deepEqual(loader.getPrompts().prompts, []); assert.deepEqual(loader.getThemes().themes, []);
  return { skills: skills.skills.map(s => ({ name: s.name, filePath: s.filePath })), tools, extensionErrors: extensions.errors, skillDiagnostics: skills.diagnostics };
}

test('independent tarball runs outside the workspace and excludes sibling skill resources', { timeout: 180000 }, async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'va-package-isolation-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const fixture = join(scratch, 'workspace'), source = join(fixture, packagePath), packed = join(scratch, 'packed');
  await mkdir(source, { recursive: true }); await mkdir(packed);
  await cp(join(repo, packagePath), source, { recursive: true, filter: path => !['node_modules', '.visual-acceptance'].includes(basename(path)) });
  await cp(join(repo, 'package.json'), join(fixture, 'package.json'));
  // Real sibling package and an extra nested skill/extension are present while
  // packing/loading. A broad skills/ or extensions/ declaration would load them.
  const fake = { name: 'isolation-sibling', version: '0.0.0', type: 'module', pi: { skills: ['./skills/sibling'], extensions: ['./extensions/sibling.mjs'] } };
  const skill = '---\nname: isolation-sibling\ndescription: Packaging regression fixture, never actual App evidence.\n---\nSibling sentinel.\n';
  const extension = 'export default function(pi) { pi.registerTool({name:"sibling_sentinel",label:"Sentinel",description:"Fixture",parameters:{type:"object",properties:{}},async execute(){return {content:[]};}}); }\n';
  for (const root of [join(fixture, 'packages/sibling'), source]) {
    await mkdir(join(root, 'skills/sibling'), { recursive: true });
    await mkdir(join(root, 'extensions'), { recursive: true });
    await writeFile(join(root, 'skills/sibling/SKILL.md'), skill);
    await writeFile(join(root, 'extensions/sibling.mjs'), extension);
  }
  await writeFile(join(fixture, 'packages/sibling/package.json'), JSON.stringify(fake));
  await writeFile(join(fixture, 'repository-only-sentinel.txt'), 'Must never enter an independent skill package.');
  const rootManifest = await json(join(fixture, 'package.json'));
  assert.equal(rootManifest.private, true);
  assert.ok(!rootManifest.keywords?.includes('pi-package'));
  assert.equal(rootManifest.dependencies, undefined);
  const [pack] = JSON.parse(run('npm', ['pack', '--workspace=pi-visual-acceptance', '--ignore-scripts', '--json', '--pack-destination', packed], fixture));
  const tgz = join(packed, pack.filename);
  const listing = run('tar', ['-tzf', tgz], scratch).trim().split('\n');
  assert.ok(listing.every(p => p.startsWith('package/') && !p.split('/').includes('..') && !p.startsWith('/')));
  assert.ok(!listing.some(p => /sibling|repository-only|node_modules|\.npmrc|package-lock|tests\//.test(p)));
  const unpack = join(scratch, 'unpack'); await mkdir(unpack);
  run('tar', ['-xzf', tgz, '-C', unpack], scratch);
  const unpacked = join(unpack, 'package'), hashes = {};
  for (const path of await files(unpacked)) {
    const bytes = await readFile(join(unpacked, path));
    assert.deepEqual(bytes, await readFile(join(source, path)), `Packed file source: ${path}`);
    hashes[path] = hash(bytes);
    assert.ok((await lstat(join(unpacked, path))).isFile());
  }
  const manifest = await json(join(unpacked, 'package.json'));
  assert.equal(manifest.name, 'pi-visual-acceptance'); assert.equal(manifest.version, '0.1.0');
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['jpeg-js', 'pngjs']);
  // Load the root before removing the fixture: this checks the legacy Git
  // forwarding entry against both sibling locations using Pi's real loader.
  let rootResources;
  if (hostRoot) {
    run('npm', ['install', '--ignore-scripts', '--omit=dev', '--omit=peer', '--no-audit', '--no-fund'], fixture);
    rootResources = await load(fixture, join(scratch, 'root-loader'));
  }
  else t.diagnostic('Set PI_TEST_PACKAGE_ROOT to include real Pi resource loading.');
  // Remove the entire author workspace before runtime installation. Neither
  // CLI assets nor extension imports can fall back to its files or node_modules.
  await rm(fixture, { recursive: true, force: true });
  run('npm', ['install', '--ignore-scripts', '--omit=dev', '--omit=peer', '--no-audit', '--no-fund'], unpacked);
  assert.deepEqual((await readdir(join(unpacked, 'node_modules'))).filter(p => !p.startsWith('.')).sort(), ['jpeg-js', 'pngjs']);
  const commands = JSON.parse(run(process.execPath, [join(unpacked, 'scripts/visual-acceptance.mjs'), 'help'], scratch));
  assert.ok(commands);
  const out = join(scratch, 'demo');
  const exported = JSON.parse(run(process.execPath, [join(unpacked, 'scripts/visual-acceptance.mjs'), 'demo-export', '--out', out], scratch));
  const review = await json(join(out, 'review.json'));
  assert.equal(review.reviewProtocol, 'visual-acceptance-2');
  assert.deepEqual(review.summary, { total: 8, aiPass: 8, finalAIPass: true, humanPass: 0 });
  run('python3', [join(unpacked, 'examples/device-hub-app/verify-recorded.py')], scratch);
  const { startReviewServer } = await import(pathToFileURL(join(unpacked, 'scripts/lib/server.mjs')));
  // The installed runtime must resolve and serve every bundled review asset.
  const { EvidenceStore } = await import(pathToFileURL(join(unpacked, 'scripts/lib/store.mjs')));
  const store = new EvidenceStore(join(scratch, 'empty-store'));
  await store.init({ schemaVersion: 1, project: { id: 'packaging-server-fixture', name: 'Packaging fixture, not App evidence' }, spec: review.spec });
  const server = await startReviewServer(store);
  try {
    const index = await fetch(server.url); assert.equal(index.status, 200);
    assert.equal(await index.text(), await readFile(join(unpacked, 'skills/visual-acceptance/review/index.html'), 'utf8'));
    for (const asset of ['review-app.js', 'review-model.js', 'review-storage.js', 'review.css']) {
      const response = await fetch(new URL(asset, server.url)); assert.equal(response.status, 200, asset);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), hashes[`skills/visual-acceptance/review/${asset}`]);
    }
  } finally { await server.close(); }
  let installedResources;
  if (hostRoot) installedResources = await load(unpacked, join(scratch, 'installed-loader'));
  const report = { package: manifest.name, version: manifest.version, tgzSha256: hash(await readFile(tgz)), fileCount: Object.keys(hashes).length, fileHashes: hashes, siblingExcluded: true, sourceRemovedBeforeRuntimeInstall: true, runtimeDependencies: ['jpeg-js', 'pngjs'], rootResources, installedResources, demoSummary: review.summary, exported };
  if (process.env.VA_PACKAGING_REPORT_DIR) {
    const evidence = resolve(process.env.VA_PACKAGING_REPORT_DIR); await mkdir(evidence, { recursive: true });
    await cp(tgz, join(evidence, pack.filename));
    await writeFile(join(evidence, 'packaging-report.json'), JSON.stringify(report, null, 2) + '\n');
  }
  t.diagnostic(JSON.stringify({ ...report, fileHashes: undefined }));
});
