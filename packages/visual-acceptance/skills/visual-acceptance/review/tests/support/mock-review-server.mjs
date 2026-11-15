// Test double of core's loopback review server (scripts/lib/server.mjs) for
// review-UI browser tests with FIXTURE data. Mirrors the contract checks the UI
// depends on: no query strings, same Origin + token on writes, draft edits need a
// contract verdict + reviewer + one edit per cell, batch dedupe/conflict.
// It also exposes fault injection (draft/feedback failures, evidence rounds).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildFixture } from './fixture.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

export async function startMockServer(bundleDir) {
  let token = randomBytes(16).toString('hex'), sourceId = 'browser-' + randomBytes(6).toString('hex');
  const ctl = { round: 1, failDrafts: false, failNextFeedback: 0, dispatchFailNext: 0, dispatch: 'persisted', forbidden: 0,
    // simulate a server restart: new token + new sourceId (old exact batches remain retryable)
    restart() { token = randomBytes(16).toString('hex'); sourceId = 'browser-' + randomBytes(6).toString('hex'); },
    get sourceId() { return sourceId; }, drafts: { schemaVersion: 1, projectId: 'review-ui-fixture', edits: [] }, batches: new Map(), feedbackAttempts: [], draftPuts: 0, rejected: [] };
  let views = new Map();
  const viewFor = r => { if (!views.has(r)) views.set(r, buildFixture({ round: r })); return views.get(r); };
  let origin;
  const server = createServer(async (req, res) => {
    const json = (s, v, h = {}) => { res.writeHead(s, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(v)); };
    try {
      const url = new URL(req.url, origin);
      if (url.search) return json(400, { error: 'Invalid request URL' });
      if (req.method !== 'GET') {
        if (req.headers.origin !== origin) return json(403, { error: 'Origin mismatch' });
        if (req.headers['x-visual-acceptance-token'] !== token) { ctl.forbidden++; return json(403, { error: 'Missing/invalid batch token' }); }
      }
      const body = async () => { let s = ''; for await (const c of req) s += c; return JSON.parse(s); };
      const { view, files } = viewFor(ctl.round);
      if (req.method === 'GET' && url.pathname === '/api/session') return json(200, { schemaVersion: 1, projectId: view.project.id, sourceId, token });
      if (req.method === 'GET' && url.pathname === '/api/review') {
        const etag = `"round-${ctl.round}"`;
        if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
        return json(200, view, { ETag: etag });
      }
      if (req.method === 'GET' && url.pathname === '/api/drafts') return json(200, { ...ctl.drafts, sourceId });
      if (req.method === 'PUT' && url.pathname === '/api/drafts') {
        const input = await body(); ctl.draftPuts++;
        if (ctl.failDrafts) return json(500, { error: 'injected draft failure' });
        const cells = new Set();
        for (const e of input.edits) {
          const bad = !['pass', 'question', 'fail'].includes(e.verdict) ? 'Invalid draft verdict' : !e.reviewer ? 'reviewer: expected nonempty string' : cells.has(e.cellId) ? 'Duplicate cell in feedback batch' : !e.specRev ? 'specRev: invalid stable ID' : null;
          if (bad) { ctl.rejected.push(bad); return json(400, { error: bad }); }
          cells.add(e.cellId);
        }
        if (input.sourceId !== sourceId || input.projectId !== view.project.id) return json(403, { error: 'Draft source/project mismatch' });
        ctl.drafts = { ...input, savedAt: new Date().toISOString() };
        return json(200, ctl.drafts);
      }
      if (req.method === 'POST' && url.pathname === '/api/feedback') {
        const input = await body(); ctl.feedbackAttempts.push(input);
        if (ctl.failNextFeedback > 0) { ctl.failNextFeedback--; return json(503, { error: 'injected feedback failure' }); }
        for (const e of input.edits) if (e.verdict !== 'pass' && !String(e.comment || '').trim()) return json(400, { error: 'comment: expected nonempty string' });
        const prev = ctl.batches.get(input.batchId);
        if (prev && JSON.stringify(prev) !== JSON.stringify(input)) return json(409, { error: 'Batch ID conflict: content changed' });
        if (!prev && input.sourceId !== sourceId) return json(403, { error: 'Feedback source mismatch' });
        if (!prev) ctl.batches.set(input.batchId, input);
        const result = { accepted: true, duplicate: !!prev, batchId: input.batchId };
        if (ctl.dispatchFailNext > 0) { ctl.dispatchFailNext--; return json(503, { ...result, dispatch: 'pending', error: 'Pi callback failed (injected)' }); }
        return json(200, { ...result, dispatch: ctl.dispatch });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/evidence/')) {
        const f = files.get(url.pathname.slice(1)) || viewFor(1).files.get(url.pathname.slice(1));
        if (!f) return json(404, { error: 'Unknown evidence' });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(f);
      }
      const p = url.pathname === '/' ? '/index.html' : url.pathname;
      if (req.method === 'GET' && /^\/[\w.-]+$/.test(p) && p !== '/review-data.js' && p !== '/review.json') {
        try { const b = await readFile(join(bundleDir, p)); res.writeHead(200, { 'Content-Type': mime[extname(p)] || 'application/octet-stream' }); return res.end(b); } catch { /* 404 */ }
      }
      return json(404, { error: 'Not found' });
    } catch (e) { return json(400, { error: e.message }); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: origin, ctl, get sourceId() { return sourceId; }, close: () => new Promise(ok => { server.closeAllConnections(); server.close(ok); }) };
}
