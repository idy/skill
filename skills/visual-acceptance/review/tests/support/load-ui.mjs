// Load the classic browser scripts into a vm sandbox (same code the page runs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { REVIEW_DIR } from './fixture.mjs';

export function loadUI() {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['review-model.js', 'review-storage.js']) {
    vm.runInContext(readFileSync(join(REVIEW_DIR, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.VAReview;
}

/** Minimal Storage implementation for tests (optionally failing writes). */
export function memoryStorage({ failWrites = false } = {}) {
  const m = new Map();
  return {
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i] ?? null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (failWrites && !k.endsWith('__probe')) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    _map: m
  };
}

/** Plain-object clone across vm realms (assert.deepStrictEqual checks prototypes). */
export const plain = v => JSON.parse(JSON.stringify(v));
