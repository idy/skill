import { readFile, mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_REVIEW_PROTOCOL, check, sha256, canonical } from './contracts.mjs';
import { reviewFiles } from './review-files.mjs';
import { decodeImage } from './media.mjs';
import { transitionFindings } from './transitions.mjs';

const recordedDir = fileURLToPath(new URL('../../examples/device-hub-app/recorded-run/', import.meta.url));

// Open the shipped real native demonstration without a Device Hub, private
// author store, browser dependency or build step. Output is a static package.
export async function exportDemo(out) {
  const root = await realpath(recordedDir), entries = JSON.parse(await readFile(join(root, 'SHA256SUMS.json'), 'utf8'));
  check(Array.isArray(entries) && entries.length > 0, 'Missing demo file manifest');
  const files = new Map();
  for (const item of [...entries, {path:'SHA256SUMS.json'}, {path:'INDEX.md'}]) {
    check(typeof item.path === 'string' && item.path.split('/').every(p => /^[A-Za-z0-9._-]+$/.test(p) && p !== '.' && p !== '..'), 'Unsafe demo manifest path');
    const path = join(root,item.path), resolved = await realpath(path), rel = relative(root,resolved);
    check(rel && !rel.startsWith('..') && !isAbsolute(rel) && (await lstat(path)).isFile(), 'Demo file must stay inside its bundle without symlinks');
    const bytes = await readFile(path);
    if (item.sha256) check(bytes.length === item.bytes && sha256(bytes) === item.sha256, `Demo integrity failure: ${item.path}`);
    files.set(item.path,bytes);
  }
  const data = JSON.parse(files.get('review.json').toString('utf8'));
  check(data.schemaVersion === 1 && data.reviewProtocol === AI_REVIEW_PROTOCOL, 'Demo review protocol is outdated');
  const script = files.get('review-data.js').toString('utf8'), prefix = 'globalThis.VISUAL_ACCEPTANCE_DATA = ';
  check(script.startsWith(prefix) && canonical(JSON.parse(script.slice(prefix.length).trim().replace(/;$/, ''))) === canonical(data), 'Demo JSON/JS mismatch');
  for (const cell of data.cells) for (const capture of cell.captures) for (const asset of capture.assets) {
    const bytes = files.get(asset.path); check(bytes && sha256(bytes) === asset.sha256, `Missing/corrupt demo evidence: ${asset.path}`);
    if (asset.kind !== 'video') { const image = decodeImage(bytes); check(image.width === asset.width && image.height === asset.height, 'Demo dimensions mismatch'); asset.pixelSha256 = image.pixelSha256; }
  }
  // Revalidate recorded captures with the installed core. Derived fingerprints
  // do not change original image bytes, encoded hashes, captures or AI identities.
  for (const cell of data.cells) {
    if (!cell.capture) continue;
    cell.capture = cell.captures.find(c => c.id === cell.capture.id);
    const findings = transitionFindings(cell.capture,data.spec.states.find(s=>s.id===cell.stateId));
    cell.blockers = [...new Set([...cell.blockers,...findings.blockers])];
    if (cell.blockers.length) {
      cell.status = 'blocked'; cell.currentAIReview = null;
      for (const review of cell.aiReviews) { review.stale = true; review.staleReasons = [...new Set([...review.staleReasons,'Evidence blocked or corrupt'])]; }
    }
  }
  data.summary.aiPass = data.cells.filter(c=>c.status==='pass').length;
  data.summary.finalAIPass = data.cells.length > 0 && data.summary.aiPass === data.cells.length;
  files.set('review.json',Buffer.from(JSON.stringify(data,null,2)+'\n'));
  files.set('review-data.js',Buffer.from(prefix+JSON.stringify(data).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029')+';\n'));
  files.set('EXPORT.md',Buffer.from('Generated from the shipped native recording. Current core recomputed decoded dimensions/RGBA pixel fingerprints and transition blockers from the original verified media. Image bytes, encoded hashes and review/capture identities are unchanged. INDEX.md records the original collection and review provenance. Human acceptance remains pending.\n'));
  for (const [name,path] of await reviewFiles()) files.set(name.slice(1),await readFile(path));
  files.set('SHA256SUMS.json',Buffer.from(JSON.stringify([...files].filter(([name])=>name!=='SHA256SUMS.json').map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha256(bytes)})),null,2)+'\n'));
  const destination = resolve(out);
  // A fresh directory prevents pre-existing links or unrelated files from being
  // incorporated into a supposedly self-contained static export.
  await mkdir(destination);
  for (const [name,bytes] of files) { const path = join(destination,name); await mkdir(dirname(path),{recursive:true}); await writeFile(path,bytes); }
  return {path:destination,open:join(destination,'index.html'),projectId:data.project.id,reviewProtocol:data.reviewProtocol,cells:data.cells.length,summary:data.summary,note:'Recorded real native evidence; human acceptance remains pending. Use Copy or JSON export/import to return feedback to Pi.'};
}
