// Opt-in compatibility check on a COPY of a legacy native store. No provider,
// capture, source change or user-page writes. See VA_CORE_STORE / VA_FEEDBACK.
import assert from 'node:assert/strict';
import { readFile,writeFile,readdir,mkdtemp,cp } from 'node:fs/promises';
import { join,resolve,relative } from 'node:path';
import { tmpdir } from 'node:os';
import { EvidenceStore } from '../../scripts/lib/store.mjs';
import { RECORD_KINDS,listRecords } from '../../scripts/lib/records.mjs';
import { sha256,canonical } from '../../scripts/lib/contracts.mjs';
assert.ok(process.env.VA_CORE_STORE,'Set VA_CORE_STORE to a legacy native store');
const out=await mkdtemp(join(tmpdir(),'va-legacy-compat-')),root=join(out,'store');await cp(resolve(process.env.VA_CORE_STORE),root,{recursive:true});
const store=new EvidenceStore(root);
async function fileHashes(dir,result={}){
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory())await fileHashes(path,result);else result[relative(root,path)]=sha256(await readFile(path));
 }
 return result;
}
const before=await fileHashes(root),initial=await store.reviewData(),state=await store.state(),counts={};
for(const kind of RECORD_KINDS){
 const records=await listRecords(root,kind);counts[kind]=records.length;
 for(const record of records){assert.equal((await store.record(kind,record.id)).id,record.id);await store.immutable(kind,record);}
}
const run=await store.currentRun(state);
assert.deepEqual(await fileHashes(root),before,'legacy read/dedup does not migrate or rewrite a file');
const immutableView=data=>({project:data.project,spec:data.spec,target:data.target,sources:data.sources,builds:data.builds,runtimes:data.runtimes,cells:data.cells.map(c=>({id:c.id,capture:c.capture,captures:c.captures,aiReviews:c.aiReviews,currentAIReview:c.currentAIReview}))});
const chosen=initial.cells.find(c=>c.capture),capture=chosen.capture;
const batch=process.env.VA_FEEDBACK?JSON.parse(await readFile(resolve(process.env.VA_FEEDBACK),'utf8')):{schemaVersion:1,batchId:'legacy-compat-feedback',projectId:initial.project.id,sourceId:'review-ui-browser-test',submittedAt:new Date().toISOString(),edits:[{cellId:chosen.id,captureId:capture.id,buildId:capture.buildId,runtimeId:capture.runtimeId,specRev:capture.specRev,verdict:'question',decision:'blocked',comment:'Automated legacy compatibility feedback; origin=review-ui-browser-test; not human acceptance.',reviewer:'review-ui-browser-test'}]};
assert.equal((await store.importFeedback(batch)).accepted,true);assert.equal((await store.importFeedback(batch)).duplicate,true);
assert.equal((await store.record('feedback',batch.batchId)).batchId,batch.batchId);
const after=await store.reviewData();assert.equal(canonical(immutableView(initial)),canonical(immutableView(after)),'source/build/capture/SHA/receipt-based AI identities remain unchanged');
const afterFiles=await fileHashes(root);
for(const [path,hash] of Object.entries(before))if(path!=='state.json')assert.equal(afterFiles[path],hash,path);
const exported=await store.export(join(out,'review'));
const report={origin:'review-ui-browser-test',humanAcceptance:false,storeCopy:root,legacyFiles:Object.keys(before).length,recordCounts:counts,currentRunEvents:run.events.length,legacyReadWrites:0,legacySourceCaptureBlobReceiptBytesUnchanged:true,sourceBuildCaptureAndAIIdentityUnchanged:true,originalSummary:initial.summary,summaryAfterFeedback:after.summary,feedbackBatch:batch.batchId,feedbackDuplicateSuppressed:true,export:exported};
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({evidence:out,...report},null,2));
