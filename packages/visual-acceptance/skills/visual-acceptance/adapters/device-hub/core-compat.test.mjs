import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
const core=resolve(process.env.VISUAL_ACCEPTANCE_CORE||repo);
let available=true;try{await access(resolve(core,'scripts/lib/transitions.mjs'));}catch{available=false;}
const run=available?test:test.skip;
const data=JSON.parse(await readFile(resolve(repo,'examples/device-hub-app/recorded-run/review.json'),'utf8'));
const api=available?await import(pathToFileURL(resolve(core,'scripts/lib/transitions.mjs'))):{};
const contracts=available?await import(pathToFileURL(resolve(core,'scripts/lib/contracts.mjs'))):{};
const transitions=data.cells.filter(c=>c.stateId==='download');
// The structural validator consumes fingerprints verified by the store. This
// portable bundle predates that optional field, so obtain it from ORIGINAL
// encoded-SHA-verified media via the current decoder, as verifiedCapture does.
if (available) {
 const media=await import(pathToFileURL(resolve(core,'scripts/lib/media.mjs')));
 for(const cell of transitions)for(const capture of [cell.capture,...cell.captures])for(const asset of capture.assets.filter(a=>a.kind==='frame')){
  const bytes=await readFile(resolve(repo,'examples/device-hub-app/recorded-run',asset.path));
  assert.equal(contracts.sha256(bytes),asset.sha256);
  asset.pixelSha256=media.decodeImage(bytes).pixelSha256;
 }
}
run('actual recorded spec-2 transitions satisfy the fixed core; old histories do not silently pass',()=>{
 assert.equal(data.reviewProtocol,'visual-acceptance-2');assert.equal(data.target.specRev,'demo-spec-2');
 for(const c of transitions){
  const row=data.spec.states.find(s=>s.id===c.stateId);
  assert.deepEqual(api.transitionFindings(c.capture,row).blockers,[]);
  for(const old of c.captures.filter(old=>old.specRev==='demo-spec-1'))assert.ok(api.transitionFindings(old,row).blockers.length);
  assert.ok(c.aiReviews.filter(r=>r.specRev==='demo-spec-1').every(r=>r.stale));
 }
});
run('actual timeline rejects missing bindings, outside action, missing state assertion and incomplete end',()=>{
 const cell=transitions[0],row=data.spec.states.find(s=>s.id===cell.stateId);
 for(const mutate of [c=>delete c.transition.triggerActionIndex,c=>c.actions[c.transition.triggerActionIndex].at='2025-01-01T00:00:00.000Z',c=>c.assertions=c.assertions.filter(a=>a.stateId!==c.transition.toStateId),c=>c.transition.endedAt=new Date(Date.parse(c.transition.endedAt)+1000).toISOString()]){
  const invalid=structuredClone(cell.capture);mutate(invalid);assert.ok(api.transitionFindings(invalid,row).blockers.length);
 }
});
run('canonical core allows repeated waiting/1ms rounding, rejects identical decoded pixels and larger mismatch',()=>{
 const cell=transitions[0],row=data.spec.states.find(s=>s.id===cell.stateId);
 const waiting=structuredClone(cell.capture),frames=waiting.assets.filter(a=>a.kind==='frame');frames[1].pixelSha256=frames[0].pixelSha256;
 assert.deepEqual(api.transitionFindings(waiting,row).blockers,[]);
 frames[2].offsetMs+=1;assert.deepEqual(api.transitionFindings(waiting,row).blockers,[]);
 frames[2].offsetMs+=1;assert.ok(api.transitionFindings(waiting,row).blockers.some(b=>b.includes('1ms')));
 const replay=structuredClone(cell.capture);for(const a of replay.assets.filter(a=>a.kind==='frame'))a.pixelSha256='a'.repeat(64);
 assert.ok(api.transitionFindings(replay,row).blockers.some(b=>b.includes('identical pixels')));
});
run('old review protocol is stale even when its original image/build/runtime/spec pointers match',()=>{
 const cell=data.cells.find(c=>c.stateId==='ready'),old=cell.aiReviews.find(r=>r.buildId==='demo-before');
 const capture=cell.captures.find(c=>c.id===old.captureId),target={buildId:old.buildId,runtimeId:old.runtimeId,specRev:old.specRev};
 assert.ok(contracts.staleReasons(old,capture,target,old.policyRev,true).some(r=>r.includes('protocol changed')));
 assert.equal(cell.currentAIReview.reviewProtocol,'visual-acceptance-2');
});
