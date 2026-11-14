import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { fixture, timestamp } from './helpers.mjs';
import { startReviewServer } from '../scripts/lib/server.mjs';

async function transition(f, captureId) {
  const different=join(f.dir,'different.png'),png=new PNG({width:2,height:2});png.data.fill(0);await writeFile(different,PNG.sync.write(png));
  const input=f.capture(captureId),asset=input.assets[0];
  input.transition={fromStateId:'empty',toStateId:'filled',startedAt:timestamp,endedAt:'2026-01-01T00:00:01.000Z',triggerActionIndex:0,startEvidenceAssetId:'frame-0',endEvidenceAssetId:'frame-3'};
  // Real waiting can repeat samples at both ends; do not reject individual repeated frames.
  input.assets=[0,250,750,1000].map((offsetMs,i)=>({...asset,id:`frame-${i}`,kind:'frame',path:i<2?f.image:different,offsetMs,capturedAt:new Date(Date.parse(timestamp)+offsetMs).toISOString()}));
  input.assertions=[{description:'Synthetic start',result:'pass',basis:'visual',stateId:'empty',evidenceAssetIds:['frame-0']},{description:'Synthetic end',result:'pass',basis:'visual',stateId:'filled',evidenceAssetIds:['frame-3']}];
  return input;
}

test('P1: replayed static frames, unrelated actions and missing endpoint coverage cannot approve transitions',async t=>{
  const f=await fixture(t,p=>{p.spec.cells=p.spec.cells.slice(2);});
  const exploit=f.capture('replayed-static');exploit.transition={fromStateId:'empty',toStateId:'filled',startedAt:timestamp,endedAt:'2026-01-01T00:00:10.000Z'};exploit.assets=[{...exploit.assets[0],kind:'frame',offsetMs:0},{...exploit.assets[0],id:'image-2',kind:'frame',offsetMs:1,capturedAt:'2026-01-01T00:00:00.001Z'}];exploit.actions[0].at='2025-01-01T00:00:00.000Z';
  const blocked=await f.store.addCapture(exploit);assert.equal(blocked.status,'blocked');assert.match(blocked.blockers.join(),/identical pixels/);assert.equal((await f.store.reviewData()).summary.finalAIPass,false);await assert.rejects(f.store.provideImage({cellId:blocked.cellId,...f.imageOptions}),/not reviewable/);
  const cases=[
    ['old-action',c=>{c.actions[0].at='2025-01-01T00:00:00.000Z';},/real action inside/],
    ['wrong-offset',c=>{c.assets[1].offsetMs=200;},/offsets\/timestamps/],
    ['missing-end',c=>{c.transition.endEvidenceAssetId='nonexistent';},/last-frame end/],
    ['wrong-state-proof',c=>{delete c.assertions[1].stateId;},/end state needs a visual assertion/],
    ['no-end-coverage',c=>{c.assets[3].offsetMs=999;c.assets[3].capturedAt='2026-01-01T00:00:00.999Z';c.transition.endedAt='2026-01-01T00:00:10.000Z';},/end evidence covering/],
    ['all-unchanged',c=>{for(const a of c.assets)a.path=f.image;},/identical pixels/]
  ];
  for(const [name,mutate,reason] of cases){const c=await transition(f,name);mutate(c);const result=await f.store.addCapture(c);assert.equal(result.status,'blocked',name);assert.match(result.blockers.join(),reason,name);}
  const valid=await f.store.addCapture(await transition(f,'real-wait-samples'));assert.equal(valid.status,'captured');assert.equal(new Set(valid.assets.map(a=>a.sha256)).size,2);
  const receipts=[];for(const a of valid.assets)receipts.push((await f.store.provideImage({cellId:valid.cellId,assetId:a.id,...f.imageOptions})).receipt);await f.store.recordAI(f.review(valid,receipts),f.imageOptions);assert.equal((await f.store.reviewData()).summary.finalAIPass,true);
  // Simulate a persisted pre-upgrade record; read/review cannot trust its old captured/pass flags.
  delete valid.transition.triggerActionIndex;await writeFile(f.store.recordPath('captures',valid.id),JSON.stringify(valid));
  const upgraded=await f.store.reviewData();assert.equal(upgraded.summary.finalAIPass,false);assert.equal(upgraded.cells[0].currentAIReview,null);assert.equal(upgraded.cells[0].aiReviews[0].stale,true);await assert.rejects(f.store.recordAI(f.review(valid,receipts),f.imageOptions),/Transition evidence is incomplete/);
});

test('legacy review protocol cannot preserve old approvals or reuse old receipts after upgrade',async t=>{
  const f=await fixture(t,p=>{p.spec.cells=p.spec.cells.slice(0,1);}),cap=await f.store.addCapture(f.capture()),image=await f.store.provideImage({cellId:cap.cellId,...f.imageOptions});
  const review=await f.store.recordAI(f.review(cap,[image.receipt]),f.imageOptions);assert.equal((await f.store.reviewData()).summary.finalAIPass,true);
  // Persisted v1 records had no protocol field. Preserve them as stale history, not approvals.
  delete review.reviewProtocol;delete image.receipt.reviewProtocol;await writeFile(f.store.recordPath('aiReviews',review.id),JSON.stringify(review));await writeFile(f.store.recordPath('receipts',image.receipt.id),JSON.stringify(image.receipt));
  const legacy=await f.store.reviewData();assert.equal(legacy.summary.finalAIPass,false);assert.match(legacy.cells[0].aiReviews[0].staleReasons.join(),/protocol changed/);await assert.rejects(f.store.recordAI(f.review(cap,[image.receipt]),f.imageOptions),/not supplied/);
  const fresh=await f.store.provideImage({cellId:cap.cellId,...f.imageOptions});await f.store.recordAI(f.review(cap,[fresh.receipt]),f.imageOptions);assert.equal((await f.store.reviewData()).summary.finalAIPass,true);
});

test('P2: capture rounds derive from persisted repair events and cannot reset retry charges',async t=>{
  const f=await fixture(t,p=>{p.policy={captureRetries:0,maxRepairRounds:0};});const cellId=f.cells[0].id;
  assert.equal((await f.store.stepRun({type:'capture_attempt',cellId,round:0})).exhausted,false);
  for(let round=1;round<5;round++)await assert.rejects(f.store.stepRun({type:'capture_attempt',cellId,round}),/expected 0/);
  assert.equal((await f.store.currentRun(await f.store.state())).events.length,1);assert.equal((await f.store.stepRun({type:'capture_attempt',cellId})).exhausted,true);
  const g=await fixture(t,p=>{p.policy={captureRetries:0,maxRepairRounds:1};}),id=g.cells[0].id;
  await g.store.stepRun({type:'capture_attempt',cellId:id});await g.store.stepRun({type:'repair',reason:'Synthetic source cause',affectedCellIds:[id],regressionCellIds:[id]});
  assert.equal((await g.store.currentRun(await g.store.state())).round,1);
  for(const round of [0,2])await assert.rejects(g.store.stepRun({type:'capture_attempt',cellId:id,round}),/expected 1/);
  const attempt=await g.store.stepRun({type:'capture_attempt',cellId:id});assert.equal(attempt.event.round,1);assert.equal(attempt.exhausted,false);assert.equal((await g.store.stepRun({type:'capture_attempt',cellId:id})).exhausted,true);
});

test('P2: delayed human feedback validates against its referenced spec after cell removal',async t=>{
  const f=await fixture(t),cap=await f.store.addCapture(f.capture()),batch=f.batch(cap);const revised=structuredClone(f.input);revised.spec.revision='spec-2';revised.spec.cells=revised.spec.cells.slice(1);await f.store.setSpec(revised);
  assert.equal((await f.store.importFeedback(batch)).accepted,true);assert.equal((await f.store.importFeedback(batch)).duplicate,true);
  const data=await f.store.reviewData();assert.ok(!data.cells.some(c=>c.id===cap.cellId));assert.equal(data.historicalHumanReviews.length,1);assert.equal(data.historicalHumanReviews[0].stale,true);assert.equal(data.historicalHumanReviews[0].specRev,'spec-1');assert.equal(data.historicalHumanReviews[0].captureId,cap.id);
  const rebound=structuredClone(batch);rebound.batchId='rebound';rebound.edits[0].specRev='spec-2';await assert.rejects(f.store.importFeedback(rebound),/cell in referenced spec/);
  const unknown=structuredClone(batch);unknown.batchId='unknown';unknown.edits[0].specRev='unknown-spec';await assert.rejects(f.store.importFeedback(unknown),/Unknown feedback spec revision/);
});

test('P2: persisted feedback retries under a fresh authenticated server without rebinding source or history',async t=>{
  const f=await fixture(t),cap=await f.store.addCapture(f.capture()),ui=join(f.dir,'ui');await mkdir(ui);await writeFile(join(ui,'index.html'),'<html>test resources</html>');await writeFile(join(ui,'ui-files.json'),JSON.stringify({files:['index.html']}));
  const first=await startReviewServer(f.store,{reviewDir:ui,onFeedback:async()=>{throw new Error('transient callback failure');}});t.after(()=>first.close());const originalSession=await fetch(first.url+'/api/session').then(r=>r.json());const batch={...f.batch(cap),sourceId:originalSession.sourceId};
  const post=(server,session,value,headers={})=>fetch(server.url+'/api/feedback',{method:'POST',headers:{Origin:server.url,'Content-Type':'application/json','X-Visual-Acceptance-Token':session.token,...headers},body:JSON.stringify(value)});
  const failed=await post(first,originalSession,batch);assert.equal(failed.status,503);assert.equal((await failed.json()).accepted,true);await first.close();
  const delivered=[],second=await startReviewServer(f.store,{reviewDir:ui,onFeedback:async b=>delivered.push(b)});t.after(()=>second.close());const fresh=await fetch(second.url+'/api/session').then(r=>r.json());assert.notEqual(fresh.sourceId,batch.sourceId);
  assert.equal((await post(second,fresh,batch,{'X-Visual-Acceptance-Token':originalSession.token})).status,403);assert.equal((await post(second,fresh,batch,{Origin:'https://wrong.invalid'})).status,403);
  const retry=await post(second,fresh,batch);assert.equal(retry.status,200);assert.equal((await retry.json()).duplicate,true);assert.equal(delivered[0].sourceId,batch.sourceId);
  assert.equal((await post(second,fresh,{...batch,sourceId:fresh.sourceId})).status,409);assert.equal((await post(second,fresh,{...batch,batchId:'new-with-old-source'})).status,403);
  const history=(await f.store.reviewData()).cells[0].humanReviews;assert.equal(history.length,1);assert.equal(history[0].sourceId,batch.sourceId);
});
