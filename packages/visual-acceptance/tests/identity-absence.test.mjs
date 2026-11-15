import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fixture } from './helpers.mjs';
import { RECORD_KINDS, listRecords } from '../scripts/lib/records.mjs';
import { sha256 } from '../scripts/lib/contracts.mjs';

const legacyPath=(store,kind,recordId)=>join(store.root,kind,recordId.replaceAll(':','_')+'.json');

test('every immutable record kind distinguishes colon, underscore, case, reserved and maximum-length IDs',async t=>{
 const f=await fixture(t),ids=['record:phone','record_phone','Record-phone','record-phone','CON','x'.repeat(128)];
 for(const kind of RECORD_KINDS){
  const paths=new Set();
  for(const recordId of ids){
   const value={id:recordId,kind};await f.store.immutable(kind,value);
   assert.deepEqual(await f.store.record(kind,recordId),value);
   const path=f.store.recordPath(kind,recordId);paths.add(path.toLowerCase());
   assert.equal(basename(path),sha256(recordId)+'.json');assert.equal(basename(path).length,69);
  }
  assert.equal(paths.size,ids.length,kind);
 }
});

test('all record kinds read legacy IDs exactly, preserve bytes, and deduplicate equal old/new copies',async t=>{
 const f=await fixture(t);
 for(const kind of RECORD_KINDS){
  const old={id:'legacy:Phone',kind},alias='legacy_Phone',path=legacyPath(f.store,kind,old.id),bytes=JSON.stringify(old)+'\n';
  await mkdir(join(f.store.root,kind),{recursive:true});await writeFile(path,bytes);
  assert.deepEqual(await f.store.record(kind,old.id),old);
  await assert.rejects(f.store.record(kind,alias),/Record ID mismatch/);
  await assert.rejects(f.store.record(kind,'legacy:phone'),/Record ID mismatch|Unknown record/);
  await f.store.immutable(kind,old);assert.equal(await readFile(path,'utf8'),bytes);
  await assert.rejects(readFile(f.store.recordPath(kind,old.id)),{code:'ENOENT'});
  const other={id:alias,kind};await f.store.immutable(kind,other);
  assert.deepEqual(await f.store.record(kind,alias),other);assert.deepEqual(await f.store.record(kind,old.id),old);
  const modern=f.store.recordPath(kind,old.id);await writeFile(modern,bytes);
  assert.equal((await listRecords(f.store.root,kind)).filter(r=>[old.id,alias].includes(r.id)).length,2,kind);
  assert.equal((await f.store.records({[kind]:[old.id,alias,old.id]},kind)).length,2,kind);
  await writeFile(modern,JSON.stringify({...old,changed:true}));
  await assert.rejects(f.store.record(kind,old.id),/Conflicting record copies/);
  await assert.rejects(listRecords(f.store.root,kind),/Conflicting record copies/);
  await assert.rejects(f.store.immutable(kind,old),/Conflicting record copies/);
  await writeFile(modern,JSON.stringify({id:'wrong-record'}));
  await assert.rejects(f.store.record(kind,old.id),/Record ID mismatch/);
  assert.equal(await readFile(path,'utf8'),bytes);
 }
});

test('public runtimes remain distinct and never-created legacy spec aliases cannot validate feedback',async t=>{
 const f=await fixture(t);
 for(const recordId of ['runtime:phone','runtime_phone','Runtime-phone','runtime-phone'])await f.store.addRuntime({...f.runtime,id:recordId});
 for(const recordId of ['runtime:phone','runtime_phone','Runtime-phone','runtime-phone'])assert.equal((await f.store.record('runtimes',recordId)).id,recordId);
 await f.store.setSpec({...f.input,spec:{...f.input.spec,revision:'spec:2'}});
 const modern=f.store.recordPath('specs','spec:2'),old=legacyPath(f.store,'specs','spec:2');await rename(modern,old);
 const batch={schemaVersion:1,batchId:'alias-feedback',projectId:f.input.project.id,sourceId:'review-ui-browser-test',submittedAt:new Date().toISOString(),edits:[{cellId:f.cells[0].id,captureId:null,buildId:null,runtimeId:null,specRev:'spec_2',verdict:'question',decision:'blocked',comment:'Automated missing screenshot review; not human acceptance.',reviewer:'review-ui-browser-test'}]};
 await assert.rejects(f.store.record('specs','spec_2'),/Record ID mismatch/);
 await assert.rejects(f.store.importFeedback(batch),/Record ID mismatch/);
 assert.equal((await f.store.state()).feedback.length,0);
 await f.store.setSpec({...f.input,spec:{...f.input.spec,revision:'spec_2'}});
 assert.equal((await f.store.importFeedback(batch)).accepted,true);
 assert.equal((await f.store.record('specs','spec:2')).id,'spec:2');assert.equal((await f.store.record('specs','spec_2')).id,'spec_2');
});

test('duplicate legacy/modern run events charge a persisted budget exactly once',async t=>{
 const f=await fixture(t);
 const first=await f.store.stepRun({type:'capture_attempt',cellId:f.cells[0].id});
 const event=await f.store.record('runEvents',first.event.id);await writeFile(legacyPath(f.store,'runEvents',event.id),JSON.stringify(event));
 const run=await f.store.currentRun(await f.store.state());assert.equal(run.events.length,1);
 assert.equal((await f.store.stepRun({type:'capture_attempt',cellId:f.cells[0].id})).exhausted,false);
 assert.equal((await f.store.stepRun({type:'capture_attempt',cellId:f.cells[0].id})).exhausted,true);
});

test('missing-evidence human decisions stay current until capture/spec changes without changing AI eligibility',async t=>{
 const f=await fixture(t),edits=f.cells.slice(0,2).map((cell,i)=>({cellId:cell.id,captureId:null,buildId:null,runtimeId:null,specRev:'spec-1',verdict:'question',decision:i?'not-applicable':'blocked',comment:'Automated absence review; not human acceptance.',reviewer:'review-ui-browser-test'}));
 const batch={schemaVersion:1,batchId:'absence-review',projectId:f.input.project.id,sourceId:'review-ui-browser-test',submittedAt:new Date().toISOString(),edits};
 await f.store.importFeedback(batch);const path=f.store.recordPath('feedback',batch.batchId),original=await readFile(path);
 let data=await f.store.reviewData();
 for(const [i,cell] of data.cells.slice(0,2).entries()){
  assert.equal(cell.currentHumanReview.decision,edits[i].decision);assert.equal(cell.humanReviews[0].stale,false);assert.equal(cell.status,'missing');assert.equal(cell.currentAIReview,null);
 }
 assert.equal(data.summary.finalAIPass,false);assert.equal(data.summary.humanPass,0);
 await f.store.addRuntime({...f.runtime,id:'runtime-2'});await f.store.setTarget({buildId:'build-1',runtimeId:'runtime-2',specRev:'spec-1'});
 assert.equal((await f.store.reviewData()).cells[0].humanReviews[0].stale,false,'absence is not bound to an intentionally null runtime');
 await f.store.addCapture({...f.capture(),runtimeId:'runtime-2'});data=await f.store.reviewData();
 assert.equal(data.cells[0].currentHumanReview,null);assert.equal(data.cells[0].humanReviews[0].stale,true);assert.equal(data.cells[0].humanReviews[0].captureId,null);
 assert.equal(data.cells[1].currentHumanReview.decision,'not-applicable');assert.equal(data.summary.finalAIPass,false);
 await f.store.setSpec({...f.input,spec:{...f.input.spec,revision:'spec-2'}});data=await f.store.reviewData();
 assert.equal(data.cells[1].currentHumanReview,null);assert.equal(data.cells[1].humanReviews[0].stale,true);
 assert.deepEqual(await readFile(path),original,'accepted payload/history bytes never rebound');
 const pass={...batch,batchId:'explicit-absence-pass',edits:[{...edits[1],cellId:f.cells[2].id,specRev:'spec-2',verdict:'pass',decision:'pass',comment:''}]};
 await f.store.importFeedback(pass);data=await f.store.reviewData();
 assert.equal(data.summary.humanPass,1);assert.equal(data.cells[2].status,'missing');assert.equal(data.summary.aiPass,0);assert.equal(data.summary.finalAIPass,false,'a human pass cannot substitute for missing AI evidence');
});
