import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { get } from 'node:http';
import { fixture } from './helpers.mjs';
import { startReviewServer } from '../scripts/lib/server.mjs';

test('loopback review saves drafts without dispatch; only explicit token/source-checked batches dispatch',async t=>{
  const f=await fixture(t),cap=await f.store.addCapture(f.capture()),ui=join(f.dir,'ui');await mkdir(ui);await writeFile(join(ui,'index.html'),'<html>Test review resources only</html>');await writeFile(join(ui,'ui-files.json'),JSON.stringify({files:['index.html']}));
  const deliveries=[];const server=await startReviewServer(f.store,{reviewDir:ui,onFeedback:async b=>deliveries.push(b)});t.after(()=>server.close());
  assert.match(server.url,/^http:\/\/127\.0\.0\.1:/);const session=await fetch(server.url+'/api/session').then(r=>r.json());
  const headers={'Content-Type':'application/json',Origin:server.url,'X-Visual-Acceptance-Token':session.token};const batch={...f.batch(cap),sourceId:session.sourceId};
  const request=(path,method,input,extra={})=>fetch(server.url+path,{method,headers:{...headers,...extra},body:JSON.stringify(input)});
  const draft={schemaVersion:1,projectId:batch.projectId,sourceId:session.sourceId,edits:batch.edits.map(e=>({...e,comment:''}))};
  assert.equal((await request('/api/drafts','PUT',draft)).status,200);assert.equal(deliveries.length,0);
  const saved=await fetch(server.url+'/api/drafts').then(r=>r.json());assert.equal(saved.edits[0].comment,'');assert.ok(saved.savedAt);
  assert.equal((await request('/api/feedback','POST',batch,{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await request('/api/feedback','POST',batch,{'X-Visual-Acceptance-Token':'bad'})).status,403);
  assert.equal((await request('/api/feedback','POST',{...batch,sourceId:'wrong-source'})).status,403);
  const accepted=await request('/api/feedback','POST',batch);assert.equal(accepted.status,200);assert.equal((await accepted.json()).duplicate,false);assert.equal(deliveries.length,1);
  const duplicate=await request('/api/feedback','POST',batch);assert.equal((await duplicate.json()).duplicate,true);assert.equal((await f.store.reviewData()).cells[0].humanReviews.length,1);
  // Callback retries are intentional; the extension deduplicates model delivery on active branch.
  assert.equal(deliveries.length,2);assert.match(deliveries[0].edits[0].comment,/\/skill:/);
  assert.equal((await fetch(server.url+'/'+cap.assets[0].path)).status,200);
  for (const path of ['/state.json','/sources/'+f.source.id+'.json','/api/capture','/api/command','/api/exec','/../package.json','/evidence/'+ '0'.repeat(64)+'.png']) assert.equal((await fetch(server.url+path)).status,404,path);
  assert.equal((await request('/api/capture','POST',{})).status,404);
  const hostStatus=await new Promise((ok,fail)=>{const req=get(server.url+'/api/session',{headers:{Host:'evil.invalid'}},res=>{res.resume();ok(res.statusCode);});req.on('error',fail);});
  assert.equal(hostStatus,403);
});
