// Static checks on the shipped UI files: local-only, no hardcoded data, contract load path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REVIEW_DIR, UI_FILES } from './support/fixture.mjs';

const read = f => readFileSync(join(REVIEW_DIR, f), 'utf8');

test('ui-files.json lists the flat UI bundle and every file exists', () => {
  assert.deepEqual(UI_FILES, ['index.html', 'review.css', 'review-model.js', 'review-storage.js', 'review-app.js']);
  for (const f of UI_FILES) assert.ok(existsSync(join(REVIEW_DIR, f)), f);
  assert.ok(!existsSync(join(REVIEW_DIR, 'review-data.js')), 'review-data.js is created by core export only');
});

test('no remote resources, CDN, analytics or remote fonts', () => {
  for (const f of UI_FILES) {
    const s = read(f);
    assert.ok(!/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(s), f + ' references a remote URL');
    assert.ok(!/@import\s+url\(\s*["']?https?:/i.test(s) && !/url\(\s*["']?https?:/i.test(s), f + ' loads remote CSS asset');
    assert.ok(!/googleapis|cdnjs|unpkg|jsdelivr|analytics|gtag|segment\.io/i.test(s), f + ' mentions a CDN/analytics host');
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(s), f + ' uses eval');
  }
});

test('index.html loads review-data.js then local scripts in order; contract endpoints are used', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(scripts, ['./review-data.js', './review-model.js', './review-storage.js', './review-app.js']);
  assert.match(html, /href="\.\/review\.css"/);
  const app = read('review-app.js') + read('review-storage.js');
  for (const ep of ['/api/session', '/api/review', '/api/drafts', '/api/feedback', 'X-Visual-Acceptance-Token', 'VISUAL_ACCEPTANCE_DATA', './review.json']) assert.ok(app.includes(ep), ep);
  assert.ok(!/fetch\(\s*['"]file:/.test(app), 'never fetch(file://)');
});

test('UI source has no hardcoded review data', () => {
  for (const f of UI_FILES) assert.ok(!/cell-[0-9a-f]{24}/.test(read(f)), f + ' contains a concrete cell ID');
});
