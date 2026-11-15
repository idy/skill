import { readFile, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './contracts.mjs';

export const defaultReviewDir = fileURLToPath(new URL('../../skills/visual-acceptance/review/', import.meta.url));

// One manifest drives both static export and localhost. Review directories also
// contain development tests/docs, which must never become public routes.
export async function reviewFiles(reviewDir = defaultReviewDir) {
  const root = await realpath(reviewDir);
  const manifestPath = join(root, 'ui-files.json');
  check((await lstat(manifestPath)).isFile(), 'UI manifest must be a regular file');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  check(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 100, 'UI manifest needs files');
  check(new Set(manifest.files).size === manifest.files.length && manifest.files.includes('index.html'), 'UI manifest needs unique files and index.html');
  const files = new Map();
  for (const name of manifest.files) {
    // UI resources are flat siblings of index.html. Reject traversal, URL
    // escaping, reserved generated data, absolute paths and separators.
    check(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*\.(html|js|css|svg|png|jpg)$/.test(name) && !['review-data.js', 'review.json'].includes(name), 'Unsafe UI manifest path');
    const path = join(root, name);
    check((await lstat(path)).isFile(), 'UI resource must be a regular file (no symlinks)');
    files.set('/' + name, path);
  }
  return files;
}
