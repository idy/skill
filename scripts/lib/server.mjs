import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, readdir, lstat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, validateFeedback } from './contracts.mjs';
const defaultReviewDir = fileURLToPath(new URL('../../skills/visual-acceptance/review/', import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.mp4':'video/mp4', '.webm':'video/webm', '.json':'application/json; charset=utf-8' };

export async function startReviewServer(store, { port = 0, reviewDir = defaultReviewDir, onFeedback } = {}) {
  check(Number.isInteger(port) && port >= 0 && port <= 65535, 'Invalid port');
  const state = await store.state(), projectId = state.project.id;
  const sourceId = `browser-${randomBytes(12).toString('hex')}`, token = randomBytes(32).toString('hex');
  const files = new Map();
  async function scan(dir, prefix = '') {
    for (const name of await readdir(dir)) {
      const path = join(dir,name), stat = await lstat(path); check(!stat.isSymbolicLink(), 'Review asset symlinks forbidden');
      if (stat.isDirectory()) await scan(path, `${prefix}${name}/`);
      else if (stat.isFile() && mime[extname(name)]) files.set(`/${prefix}${name}`, path);
    }
  }
  await scan(resolve(reviewDir));
  let origin;
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': mime['.json'] }); res.end(JSON.stringify(value)); };
  async function body(req) {
    check((req.headers['content-type'] ?? '').split(';')[0] === 'application/json', 'Expected application/json');
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; check(size <= 1024 * 1024, 'Request exceeds 1 MiB'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const server = createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Cache-Control','no-store'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      check(req.headers.host === origin.slice('http://'.length), 'Invalid Host header');
      const url = new URL(req.url, origin), path = url.pathname;
      check(url.origin === origin && !url.search, 'Invalid request URL');
      if (!['GET','PUT','POST'].includes(req.method)) return json(res,405,{error:'Method not allowed'});
      if (req.method !== 'GET') {
        check(req.headers.origin === origin, 'Origin mismatch');
        check(req.headers['x-visual-acceptance-token'] === token, 'Missing/invalid batch token');
      } else if (req.headers.origin) check(req.headers.origin === origin, 'Origin mismatch');
      if (req.method === 'GET' && path === '/api/session') return json(res,200,{ schemaVersion:1,projectId,sourceId,token });
      if (req.method === 'GET' && path === '/api/review') return json(res,200,await store.reviewData());
      if (req.method === 'GET' && path === '/api/drafts') {
        const draft = await readFile(join(store.root,'drafts.json'),'utf8').then(JSON.parse).catch(e => { if (e.code === 'ENOENT') return { schemaVersion:1,projectId,edits:[] }; throw e; });
        return json(res,200,{ ...draft, sourceId });
      }
      if (req.method === 'PUT' && path === '/api/drafts') {
        const input = await body(req);
        await store.transaction(async current => {
          const spec = await store.record('specs', current.specRev), captures = await store.records(current,'captures');
          // Empty drafts are valid; use the same identity checks as submitted edits otherwise.
          check(input.schemaVersion === 1 && input.projectId === projectId && input.sourceId === sourceId && Array.isArray(input.edits), 'Draft source/project mismatch');
          if (input.edits.length) {
            // Drafts can be incomplete while a person types; final submission enforces comments.
            for (const edit of input.edits) check(['pass','question','fail'].includes(edit.verdict), 'Invalid draft verdict');
            validateFeedback({ ...input,batchId:'draft',submittedAt:new Date().toISOString(),edits:input.edits.map(e=>({...e,verdict:'pass'})) }, { projectId,sourceId,spec,captureById:new Map(captures.map(c=>[c.id,c])) });
          }
          const saved = { ...input,savedAt:new Date().toISOString() }, temp = join(store.root,`.draft-${randomBytes(6).toString('hex')}.tmp`);
          await writeFile(temp,JSON.stringify(saved),{mode:0o600}); await rename(temp,join(store.root,'drafts.json'));
          return { value:saved };
        }).then(saved => json(res,200,saved)); return;
      }
      if (req.method === 'POST' && path === '/api/feedback') {
        const input = await body(req), result = await store.importFeedback(input,{ sourceId,transport:'loopback-browser' });
        // Callback is retried for exact duplicate batches; extension owns model-message dedup.
        if (onFeedback) await onFeedback(input,result);
        return json(res,200,result);
      }
      if (req.method === 'GET' && /^\/evidence\/[a-f0-9]{64}\.(png|jpg|mp4|webm)$/.test(path)) {
        const current = await store.state(), captures = await store.records(current,'captures');
        const asset = captures.flatMap(c=>c.assets).find(a=>`/${a.path}` === path);
        if (!asset) return json(res,404,{error:'Unknown evidence'});
        const bytes = await store.verifyAsset(asset); res.writeHead(200,{ 'Content-Type':asset.mimeType,'Content-Length':bytes.length }); res.end(bytes); return;
      }
      if (req.method === 'GET' && files.has(path === '/' ? '/index.html' : path)) {
        const file = files.get(path === '/' ? '/index.html' : path); const bytes = await readFile(file); res.writeHead(200,{ 'Content-Type':mime[extname(file)] }); res.end(bytes); return;
      }
      return json(res,404,{error:'Not found'});
    } catch (error) { json(res,/Origin|Host|token|source.*mismatch/i.test(error.message) ? 403 : /conflict/i.test(error.message) ? 409 : 400,{error:error.message}); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((ok,fail)=> { server.once('error',fail); server.listen(port,'127.0.0.1',()=>{ server.off('error',fail); ok(); }); });
  origin = `http://127.0.0.1:${server.address().port}`;
  let closePromise;
  return { url:origin,sourceId,close:()=> {
    if (!closePromise) { server.closeAllConnections(); closePromise = new Promise((ok,fail)=>server.close(e=>e?fail(e):ok())); }
    return closePromise;
  } };
}
