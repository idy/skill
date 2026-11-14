#!/usr/bin/env node
// Explicit import/review of actual capture inputs plus separately authored image
// notes. No timestamps, trigger actions, endpoint states or verdicts are inferred.
import { readFile,writeFile,mkdir,copyFile } from 'node:fs/promises';
import { resolve,dirname,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachInspection } from './inspection.mjs';
const args=process.argv.slice(2),step=args[0],get=n=>args[args.indexOf(n)+1];
for(const n of ['--core','--store','--input'])if(!args.includes(n))throw new Error(`Required ${n}`);
const inputPath=resolve(get('--input')),manifest=JSON.parse(await readFile(inputPath,'utf8'));
const {EvidenceStore}=await import(pathToFileURL(resolve(get('--core'),'scripts/lib/store.mjs')));
const store=new EvidenceStore(resolve(get('--store')));
const context={sessionId:'visual-device-native-demo-protocol2-20261114',reviewer:{provider:'magpie',model:'codex/gpt-6.1-sol'},imageCapable:true,imagesBlocked:false};
const entries=[];
for(const entry of manifest.captures){
 const path=resolve(dirname(inputPath),entry.path),capture=JSON.parse(await readFile(path,'utf8'));
 for(const a of capture.assets)a.path=resolve(dirname(path),a.path);
 entries.push({capture,observations:entry.observations});
}
if(step==='ingest'){
 for(const {capture,observations} of entries){
  const state=await store.state();if(state.captures.includes(capture.id))throw new Error(`Capture already stored: ${capture.id}`);
  if(capture.specRev!==state.target.specRev||capture.runtimeId!==state.target.runtimeId)throw new Error('Capture is not explicitly bound to the current target');
  const charge=await store.record('runEvents',capture.provenance.captureAttemptEventId);
  if(charge.type!=='capture_attempt'||charge.cellId!==capture.cellId)throw new Error('Missing matching persisted capture attempt');
  const value=capture.status==='captured'?await attachInspection(capture,observations):capture;
  const saved=await store.addCapture(value);console.log(saved.id,saved.status,saved.blockers);
  if(saved.status==='blocked')process.exitCode=2;
 }
}else if(step==='images'){
 if(!args.includes('--delivery'))throw new Error('--delivery NEW-directory required');
 const out=resolve(get('--delivery'));await mkdir(out,{recursive:false});const receipts=[];
 for(const {capture} of entries){
  const cell=(await store.reviewData()).cells.find(c=>c.id===capture.cellId);
  if(cell?.capture?.id!==capture.id)throw new Error('Manifest capture is no longer current');
  for(const a of cell.capture.assets.filter(a=>a.kind!=='video')){
   const image=await store.provideImage({cellId:cell.id,assetId:a.id,...context});
   const path=join(out,`${cell.deviceId}-${cell.stateId}-${a.id}.png`);await writeFile(path,image.bytes,{flag:'wx'});
   receipts.push({cellId:cell.id,captureId:capture.id,assetId:a.id,sha256:a.sha256,receiptId:image.receipt.id,path});
  }
 }
 await writeFile(join(out,'receipts.json'),JSON.stringify(receipts,null,2)+'\n');
 console.log('Open each exact image with the image read tool before record:',receipts.map(r=>r.path));
}else if(step==='record'){
 if(!args.includes('--delivery'))throw new Error('--delivery required');
 const receipts=JSON.parse(await readFile(resolve(get('--delivery'),'receipts.json'),'utf8'));
 for(const {capture,observations:notes} of entries){
  const cell=(await store.reviewData()).cells.find(c=>c.id===capture.cellId);
  if(cell?.capture?.id!==capture.id)throw new Error('Manifest capture is no longer current');
  const observations=cell.capture.assets.filter(a=>a.kind!=='video').map(a=>{
   const n=notes.find(n=>n.assetId===a.id&&n.sha256===a.sha256);if(!n)throw new Error('Image notes missing or stale');
   if(!['pass','question','fail'].includes(n.verdict))throw new Error('Each actually inspected image needs an explicit valid verdict');
   return{assetId:a.id,sha256:a.sha256,detail:n.comment};
  });
  const verdict=notes.some(n=>n.verdict==='fail')?'fail':notes.some(n=>n.verdict==='question')?'question':'pass';
  const comment=notes.map(n=>n.comment).join(' ')+(capture.transition?' Scope: observed states and explicit action/endpoint timing only. Full video has not been watched end-to-end; no animation smoothness or frame-pacing verdict.':'');
  await store.recordAI({cellId:capture.cellId,captureId:capture.id,verdict,comment,visibleText:[...new Set(notes.flatMap(n=>n.visibleText))],observations,receiptIds:receipts.filter(r=>r.captureId===capture.id).map(r=>r.receiptId)},context);
 }
 console.log((await store.reviewData()).summary);
}else if(step==='export'){
 if(!args.includes('--out'))throw new Error('--out existing recorded-run root required');
 const out=resolve(get('--out')),data=await store.reviewData();await mkdir(join(out,'evidence'),{recursive:true});
 const unique=new Map(data.cells.flatMap(c=>c.captures.flatMap(c=>c.assets)).map(a=>[a.sha256,a]));
 for(const a of unique.values()){
  await store.verifyAsset(a);
  // Existing blobs are immutable; copyFile EXCL prevents replacement.
  try{await copyFile(join(store.root,'blobs',a.path.slice('evidence/'.length)),join(out,a.path),1);}catch(e){if(e.code!=='EEXIST')throw e;}
 }
 await writeFile(join(out,'review.json'),JSON.stringify(data,null,2)+'\n');
 await writeFile(join(out,'review-data.js'),'globalThis.VISUAL_ACCEPTANCE_DATA = '+JSON.stringify(data).replaceAll('<','\\u003c')+';\n');
 console.log('Exported current view, with immutable capture/review history:',data.summary);
}else throw new Error('Steps: ingest | images --delivery NEW-dir | record --delivery dir | export --out recorded-run');
