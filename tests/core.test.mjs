import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { fixture, timestamp } from './helpers.mjs';
import { cellIdFor } from '../scripts/lib/contracts.mjs';

test('stable cell IDs ignore labels and checkpoints; immutable spec cannot be edited in place',async t=>{
  const f=await fixture(t);const c=f.cells[0];assert.equal(cellIdFor(c),cellIdFor({...c,label:'Renamed',checkpoints:['Different']}));
  const input=structuredClone(f.input);input.spec.cells[0].checkpoints=['Weakened'];await assert.rejects(f.store.setSpec(input),/Immutable/);
});

test('source snapshot includes dirty tracked bytes and related untracked bytes; artifact hash is actual content',async t=>{
  const f=await fixture(t);await writeFile(join(f.repo,'app.txt'),'changed tracked source');await writeFile(join(f.repo,'fixture.json'),'one');
  const first=await f.store.snapshotSource(f.repo,['fixture.json']);assert.equal(first.dirty,true);assert.equal(first.related.length,1);assert.deepEqual(first.untracked,['fixture.json']);
  assert.equal(await readFile(join(f.store.root,'sourceBlobs',first.related[0].sha256),'utf8'),'one');
  assert.match(await readFile(join(f.store.root,'sourceBlobs',first.dirtyDiffSha256),'utf8'),/changed tracked source/);
  await writeFile(join(f.repo,'fixture.json'),'two');const second=await f.store.snapshotSource(f.repo,['fixture.json']);assert.notEqual(first.id,second.id);
  await assert.rejects(f.store.addBuild({...f.build,id:'bad-build',artifact:{path:f.artifact,sha256:'0'.repeat(64)}}),/Artifact hash mismatch/);
  await assert.rejects(f.store.snapshotSource(f.repo,['../test-artifact.bin']),/inside repo/);
});

test('media is decoded and immutable bytes detect corruption; missing or wrong metadata cannot pass',async t=>{
  const f=await fixture(t);const bad=f.capture();bad.assets[0].width=20;await assert.rejects(f.store.addCapture(bad),/dimensions/);
  const corrupt=join(f.dir,'corrupt.png');await writeFile(corrupt,'not an image');bad.assets[0].path=corrupt;await assert.rejects(f.store.addCapture(bad),/corrupt image/);
  const cap=await f.store.addCapture(f.capture());await assert.rejects(f.store.addCapture(f.capture()),/already used/);
  await writeFile(join(f.store.root,'blobs',cap.assets[0].path.split('/').at(-1)),'corrupted');
  const cell=(await f.store.reviewData()).cells[0];assert.equal(cell.status,'blocked');assert.match(cell.blockers.join(),/integrity/);
  await assert.rejects(f.store.provideImage({cellId:cap.cellId,...f.imageOptions}),/not reviewable/);
});

test('AI review requires every image receipt, session/model match and detailed observations',async t=>{
  const f=await fixture(t),cap=await f.store.addCapture(f.capture());const input=f.review(cap,[]);
  await assert.rejects(f.store.recordAI(input,f.imageOptions),/not supplied/);
  await assert.rejects(f.store.provideImage({cellId:cap.cellId,...f.imageOptions,imagesBlocked:true}),/blocked/);
  await assert.rejects(f.store.provideImage({cellId:cap.cellId,...f.imageOptions,imageCapable:false}),/no image/);
  const {receipt,bytes}=await f.store.provideImage({cellId:cap.cellId,...f.imageOptions});assert.ok(bytes.length>0);
  await assert.rejects(f.store.recordAI(f.review(cap,[receipt]),{...f.imageOptions,sessionId:'other'}),/not supplied/);
  const review=f.review(cap,[receipt]);review.observations[0].detail='';await assert.rejects(f.store.recordAI(review,f.imageOptions),/Detailed observation/);
  await f.store.recordAI(f.review(cap,[receipt]),f.imageOptions);assert.equal((await f.store.reviewData()).cells[0].status,'pass');
});

test('new capture invalidates old AI/human reviews independently without deleting history',async t=>{
  const f=await fixture(t),cap=await f.store.addCapture(f.capture());const {receipt}=await f.store.provideImage({cellId:cap.cellId,...f.imageOptions});await f.store.recordAI(f.review(cap,[receipt]),f.imageOptions);await f.store.importFeedback(f.batch(cap));
  let cell=(await f.store.reviewData()).cells[0];assert.equal(cell.currentAIReview.verdict,'pass');assert.equal(cell.currentHumanReview.verdict,'question');
  const newer=await f.store.addCapture(f.capture('capture-2'));cell=(await f.store.reviewData()).cells[0];assert.equal(cell.status,'unreviewed');assert.equal(cell.aiReviews[0].stale,true);assert.equal(cell.humanReviews[0].stale,true);assert.equal(cell.currentHumanReview,null);assert.equal(cell.currentAIReview,null);
  await assert.rejects(f.store.recordAI(f.review(newer,[receipt]),f.imageOptions),/not supplied/);
  assert.equal(cell.humanReviews[0].comment,'Synthetic test comment /skill:must-never-expand');
});

test('new target makes other cells stale; final pass requires whole same-build matrix',async t=>{
  const f=await fixture(t),cap=await f.store.addCapture(f.capture());const {receipt}=await f.store.provideImage({cellId:cap.cellId,...f.imageOptions});await f.store.recordAI(f.review(cap,[receipt]),f.imageOptions);
  await writeFile(f.artifact,'new immutable build bytes');await f.store.addBuild({...f.build,id:'build-2'});await f.store.addRuntime({...f.runtime,id:'runtime-2',buildId:'build-2'});await f.store.setTarget({buildId:'build-2',runtimeId:'runtime-2',specRev:'spec-1'});
  const data=await f.store.reviewData();assert.equal(data.cells[0].status,'stale');assert.equal(data.summary.finalAIPass,false);assert.match(data.cells[0].aiReviews[0].staleReasons.join(),/buildId changed/);
  await assert.rejects(f.store.addBuild({...f.build,id:'dev',immutable:false}),/Dev\/HMR/);
  await f.store.addRuntime({...f.runtime,id:'drift',driftDetected:true});await assert.rejects(f.store.setTarget({buildId:'build-1',runtimeId:'drift',specRev:'spec-1'}),/drift/);
});

test('API/mount assertions and repeated home screenshots across distinct states are blocked',async t=>{
  const f=await fixture(t);await f.store.addCapture(f.capture());const duplicate=await f.store.addCapture(f.capture('capture-filled',1));assert.equal(duplicate.status,'blocked');assert.match(duplicate.blockers.join(),/reused/);
  const api=f.capture('capture-api');api.assertions[0].basis='api';const blocked=await f.store.addCapture(api);assert.match(blocked.blockers.join(),/No visual assertion/);
});

test('transitions need real actions, start/end identities, ordered frames and per-frame review',async t=>{
  const f=await fixture(t),input=f.capture('transition-static',2);input.transition={fromStateId:'empty',toStateId:'filled',startedAt:timestamp,endedAt:'2026-01-01T00:00:01.000Z'};
  const blocked=await f.store.addCapture(input);assert.equal(blocked.status,'blocked');assert.match(blocked.blockers.join(),/time-ordered/);
  const image2=join(f.dir,'frame2.png'),png=new PNG({width:2,height:2});png.data.fill(0);await writeFile(image2,PNG.sync.write(png));
  input.id='transition-sequence';input.assets=[{...input.assets[0],kind:'frame',offsetMs:0},{...input.assets[0],id:'image-2',kind:'frame',path:image2,offsetMs:500,capturedAt:'2026-01-01T00:00:00.500Z'}];
  const cap=await f.store.addCapture(input);assert.equal(cap.status,'captured');assert.match(cap.limitations.join(),/smoothness is not measured/);
  const first=await f.store.provideImage({cellId:cap.cellId,assetId:'image-1',...f.imageOptions});await assert.rejects(f.store.recordAI(f.review(cap,[first.receipt]),f.imageOptions),/image-2.*not supplied/);
  const second=await f.store.provideImage({cellId:cap.cellId,assetId:'image-2',...f.imageOptions});await f.store.recordAI(f.review(cap,[first.receipt,second.receipt]),f.imageOptions);
});

test('feedback exact batch retries deduplicate; project/source/cell/version conflicts reject',async t=>{
  const f=await fixture(t),cap=await f.store.addCapture(f.capture()),batch=f.batch(cap);
  assert.equal((await f.store.importFeedback(batch)).duplicate,false);assert.equal((await f.store.importFeedback(batch)).duplicate,true);
  await assert.rejects(f.store.importFeedback({...batch,sourceId:'bad'},{sourceId:'expected'}),/source mismatch/);
  await assert.rejects(f.store.importFeedback({...batch,projectId:'other'}),/project mismatch/);
  const changed=structuredClone(batch);changed.edits[0].comment='changed';await assert.rejects(f.store.importFeedback(changed),/conflict/);
  changed.batchId='batch-2';changed.edits[0].buildId='wrong';await assert.rejects(f.store.importFeedback(changed),/buildId mismatch/);
  assert.equal((await f.store.reviewData()).cells[0].humanReviews.length,1);
});

test('budgets stop with specific reasons and retain unresolved history',async t=>{
  const f=await fixture(t,p=>{p.policy={maxImages:1,maxRepairRounds:1,captureRetries:1};}),cap=await f.store.addCapture(f.capture());
  await f.store.provideImage({cellId:cap.cellId,...f.imageOptions});await assert.rejects(f.store.provideImage({cellId:cap.cellId,...f.imageOptions}),/Image budget reached/);
  const run=await f.store.currentRun(await f.store.state());assert.equal(run.status,'stopped');assert.match(run.unresolved.join(),/Image budget/);
  await f.store.startRun();const repair={type:'repair',reason:'Synthetic root cause',affectedCellIds:[cap.cellId],regressionCellIds:[cap.cellId]};await f.store.stepRun(repair);assert.equal((await f.store.stepRun(repair)).exhausted,true);
  await f.store.startRun();for(let n=0;n<2;n++) assert.equal((await f.store.stepRun({type:'capture_attempt',cellId:cap.cellId,round:0})).exhausted,false);assert.equal((await f.store.stepRun({type:'capture_attempt',cellId:cap.cellId,round:0})).exhausted,true);
});

test('export keeps private paths/receipts/source snapshots out and safely escapes script data',async t=>{
  const f=await fixture(t,p=>{p.project.name='Test </script><script>alert(1)</script>';});await f.store.addCapture(f.capture());
  const ui=join(f.dir,'ui');const {mkdir}=await import('node:fs/promises');await mkdir(ui);await writeFile(join(ui,'index.html'),'<script src="review-data.js"></script>');
  const out=join(f.dir,'export');await f.store.export(out,ui);const js=await readFile(join(out,'review-data.js'),'utf8');assert.ok(!js.includes('</script>'));assert.ok(!js.includes(f.dir));assert.ok(!js.includes('dirtyDiffSha256'));assert.ok(js.includes('VISUAL_ACCEPTANCE_DATA'));
});
