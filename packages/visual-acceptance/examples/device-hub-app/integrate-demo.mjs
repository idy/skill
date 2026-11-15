#!/usr/bin/env node
// Explicit integration steps for the recorded native demo. This never invents a
// verdict: `record` consumes human/agent inspection notes written after viewing.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { attachInspection } from './inspection.mjs';
const argv=process.argv.slice(2), step=argv[0];
const opt=name=>argv[argv.indexOf(name)+1];
for(const name of ['--core','--store'])if(!argv.includes(name))throw new Error(`Missing ${name}`);
const core=resolve(opt('--core'));
const {EvidenceStore}=await import(pathToFileURL(join(core,'scripts/lib/store.mjs')));
const {cellIdFor}=await import(pathToFileURL(join(core,'scripts/lib/contracts.mjs')));
const root=dirname(fileURLToPath(import.meta.url)), artifacts=join(root,'artifacts');
const store=new EvidenceStore(resolve(opt('--store')));
const sessionId='visual-device-native-demo-20261114';
const reviewer={provider:'magpie',model:'codex/gpt-6.1-sol'};
const context={sessionId,reviewer,imageCapable:true,imagesBlocked:false};
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const phase=opt('--phase');
const specRevision=argv.includes('--spec-revision')?opt('--spec-revision'):'demo-spec-2';
const tuple=(device,state)=>({scenarioId:'itinerary',stateId:state,deviceId:device,orientation:'portrait',variantId:'default'});
const cell=(device,state)=>cellIdFor(tuple(device,state));
const states=['empty','ready','error','download'];
const checkpoints={empty:['Empty message and load/recovery entry actions are visible.'],ready:['Full offline map coverage including emergency exit routes is readable without truncation.','Trail distance, duration and departure details remain visible.'],error:['Connection failure explanation and Try again action are readable.'],download:['Real Load itinerary tap moves empty → loading progress → ready, with ordered raw frames and a retained recording.','No animation smoothness claim is made from the representative frames.']};
const project={schemaVersion:1,project:{id:'trail-notes-native-demo',name:'Trail Notes · seeded native demonstration'},spec:{revision:specRevision,scenarios:[{id:'itinerary',label:'Download an itinerary'}],states:[...states.filter(s=>s!=='download').map(id=>({id,label:{empty:'No itinerary',ready:'Ready offline',error:'Connection unavailable'}[id],kind:'state'})),{id:'download',label:'Download transition',kind:'transition',fromStateId:'empty',toStateId:'ready'}],devices:[{id:'phone',label:'iPhone 17 · 402 × 874 pt',platform:'ios'},{id:'tablet',label:'iPad mini · 744 × 1133 pt',platform:'ios'}],variants:[{id:'default',label:'English · light · default text',language:'en',theme:'light',fontScale:1}],cells:['phone','tablet'].flatMap(d=>states.map(s=>({...tuple(d,s),entry:'App launch → Reset → real UI tap when applicable',checkpoints:checkpoints[s]})))}};
async function addPhase(which,repo){
 const build=await json(join(artifacts,which,'build-manifest.json'));
 const sourcePath=join(repo,'examples/device-hub-app/Sources/TrailNotes.swift');
 const sourceSha=createHash('sha256').update(await readFile(sourcePath)).digest('hex');
 if(sourceSha!==build.sourceSha256)throw new Error('Source snapshot differs from retained build input');
 const source=await store.snapshotSource(repo);
 await store.addBuild({id:`demo-${which}`,sourceSnapshotId:source.id,artifact:{path:join(artifacts,which,'TrailNotes.app')},platform:'ios-simulator-arm64',command:'python3 examples/device-hub-app/build.py --out <new build directory>; xcrun swiftc arm64-apple-ios18.0-simulator; codesign --sign -',createdAt:build.createdAt,immutable:true});
 await store.addRuntime({id:`demo-${which}-runtime`,buildId:`demo-${which}`,adapter:{name:'device-hub',version:'1.0'},app:{id:build.appId,version:'1.0'},fixture:{id:'bundled-travel-repository',version:'1',mode:'controlled-io',description:'Deterministic load ticks and success/failure IO outcome; same SwiftUI views and ItineraryStore state machine.'},environment:{platform:'iOS Simulator',os:'iOS 27.0 (24A434)',devices:(await json(join(artifacts,`bindings-${which}.json`))).devices,executableSha256:build.executableSha256,sourceSha256:sourceSha},immutable:true,driftDetected:false,limitations:['Simulator-only validation; no physical device or Android run.','Installed executable hash is checked by the final capture runner; no HMR.']});
 await store.setTarget({buildId:`demo-${which}`,runtimeId:`demo-${which}-runtime`,specRev:specRevision});
 const selected=which==='before'?['ready']:states;
 for(const d of ['phone','tablet'])for(const s of selected){
  const directory=argv.includes('--capture-root')?join(resolve(opt('--capture-root')),`${d}-${s}`):join(artifacts,s==='download'?'transitions-with-end':`captures-${which}`,`${d}-${s}`);
  const c=await json(join(directory,'capture.json'));
  if(c.specRev!==specRevision)throw new Error('Legacy capture/spec mismatch: preserve the old target and explicitly collect for the new spec');
  c.cellId=cell(d,s);c.sourceSnapshotId=source.id;
  // Historical raw inputs used pending-core IDs. Bind the same unchanged assets
  // to the now-created canonical source/build/runtime/spec records.
  c.buildId=`demo-${which}`;c.runtimeId=`demo-${which}-runtime`;
  if(c.transition&&(!Number.isSafeInteger(c.transition.triggerActionIndex)||!c.transition.startEvidenceAssetId||!c.transition.endEvidenceAssetId))throw new Error('Legacy transition bindings missing: preserve the original and collect a new transition; do not invent timestamps or endpoint assertions');
  const inspection=await json(argv.includes('--inspection')?resolve(opt('--inspection')):join(artifacts,s==='download'?'transitions-with-end':`captures-${which}`,'inspection-notes.json'));
  const notes=inspection.observations.filter(n=>n.path.startsWith(`${d}-${s}/`)).map(n=>({...n,assetId:n.assetId||n.path.split('/').at(-1).replace(/\.png$/,'')}));
  const inspected=await attachInspection(c,notes);
  const saved=await store.addCapture(inspected);
  if(saved.status==='blocked')throw new Error(`${c.id}: ${saved.blockers.join('; ')}`);
 }
}
if(step==='before'){
 if(!argv.includes('--before-source-repo'))throw new Error('--before-source-repo is required; use the retained exact before commit checkout');
 await store.init(project);await store.startRun();await addPhase('before',resolve(opt('--before-source-repo')));
 await writeFile(join(artifacts,'core-project.json'),JSON.stringify(project,null,2)+'\n');
}else if(step==='after'){
 await addPhase('after',resolve(root,'../..'));
 const data=await store.reviewData();
 const old=data.cells.flatMap(c=>c.aiReviews).filter(r=>r.buildId==='demo-before');
 if(old.length!==2||old.some(r=>!r.stale))throw new Error('The two before reviews must be retained and stale');
 console.log('Verified: both before reviews are stale after real source/build/capture changes.');
}else if(step==='images'){
 if(!['before','after'].includes(phase))throw new Error('--phase before|after required');
 const delivered=join(artifacts,`delivered-${phase}`);await mkdir(delivered,{recursive:false});
 const data=await store.reviewData(), receipts=[];
 for(const c of data.cells){
  if(c.capture?.buildId!==`demo-${phase}`)continue;
  for(const asset of c.capture.assets.filter(a=>a.kind!=='video')){
   const response=await store.provideImage({cellId:c.id,assetId:asset.id,...context});
   const path=join(delivered,`${c.deviceId}-${c.stateId}-${asset.id}.png`);
   await writeFile(path,response.bytes,{flag:'wx'});
   receipts.push({cellId:c.id,captureId:c.capture.id,assetId:asset.id,sha256:asset.sha256,receiptId:response.receipt.id,path});
  }
 }
 await writeFile(join(delivered,'receipts.json'),JSON.stringify(receipts,null,2)+'\n');
 console.log('Open EACH of these actual image files with the image read tool before record:',receipts.map(r=>r.path));
}else if(step==='record'){
 if(!['before','after'].includes(phase))throw new Error('--phase before|after required');
 const receipts=await json(join(artifacts,`delivered-${phase}`,'receipts.json'));
 const notes=(await json(join(artifacts,`captures-${phase}`,'inspection-notes.json'))).observations;
 if(phase==='after')notes.push(...(await json(join(artifacts,'transitions-with-end','inspection-notes.json'))).observations);
 const data=await store.reviewData();
 for(const c of data.cells){
  if(c.capture?.buildId!==`demo-${phase}`)continue;
  const selected=notes.filter(n=>n.path.startsWith(`${c.deviceId}-${c.stateId}/`));
  const observations=c.capture.assets.filter(a=>a.kind!=='video').map(a=>{
   const n=selected.find(n=>n.path.endsWith(`/${a.id}.png`));
   if(!n)throw new Error(`Actual inspection note missing for ${c.capture.id}/${a.id}`);
   if(n.sha256!==a.sha256)throw new Error('Inspection note is missing a hash or is for a different image');
   if(!['pass','question','fail'].includes(n.verdict))throw new Error('Every inspected image needs an explicit verdict');
   return{assetId:a.id,sha256:a.sha256,detail:n.comment};
  });
  const verdict=selected.some(n=>n.verdict==='fail')?'fail':selected.some(n=>n.verdict==='question')?'question':'pass';
  const comment=selected.map(n=>n.comment).join(' ')+(c.stateId==='download'?' This verdict covers the observed state sequence only; video has not been watched end-to-end and no measured smoothness verdict is made.':'');
  await store.recordAI({cellId:c.id,captureId:c.capture.id,verdict,comment,visibleText:[...new Set(selected.flatMap(n=>n.visibleText))],observations,receiptIds:receipts.filter(r=>r.cellId===c.id).map(r=>r.receiptId)},context);
 }
 console.log((await store.reviewData()).summary);
}else if(step==='status'){
 const data=await store.reviewData();console.log(JSON.stringify({summary:data.summary,cells:data.cells.map(c=>({id:c.id,state:c.stateId,device:c.deviceId,status:c.status,oldReviews:c.aiReviews.filter(r=>r.stale).length,blockers:c.blockers}))},null,2));
}else throw new Error('Steps: before | after | images --phase before|after | record --phase before|after | status');
