import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import { EvidenceStore } from '../scripts/lib/store.mjs';
const exec=promisify(execFile);
export const timestamp='2026-01-01T00:00:00.000Z';
export const projectInput=()=>({schemaVersion:1,project:{id:'test-project',name:'Synthetic test project (not app evidence)'},spec:{revision:'spec-1',scenarios:[{id:'main',label:'Main'}],states:[{id:'empty',label:'Empty',kind:'state'},{id:'filled',label:'Filled',kind:'state'},{id:'loading',label:'Load',kind:'transition',fromStateId:'empty',toStateId:'filled'}],devices:[{id:'test-device',label:'Synthetic test device'}],variants:[{id:'default',label:'Default'}],cells:['empty','filled','loading'].map(stateId=>({scenarioId:'main',stateId,deviceId:'test-device',orientation:'portrait',variantId:'default',checkpoints:['Inspect synthetic test pixel']}))}});
export async function fixture(t,modify=()=>{}) {
  const dir=await mkdtemp(join(tmpdir(),'visual-acceptance-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const repo=join(dir,'repo'); const {mkdir}=await import('node:fs/promises');await mkdir(repo);
  await exec('git',['init','-q',repo]);await writeFile(join(repo,'app.txt'),'synthetic app source\n');await exec('git',['-C',repo,'add','.']);await exec('git',['-C',repo,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','test source']);
  const input=projectInput();modify(input);const store=new EvidenceStore(join(dir,'store'));const initialized=await store.init(input);
  const source=await store.snapshotSource(repo);const artifact=join(dir,'test-artifact.bin');await writeFile(artifact,'synthetic test build; never real evidence');
  const build={id:'build-1',sourceSnapshotId:source.id,artifact:{path:artifact},platform:'test',command:'test fixture',createdAt:timestamp,immutable:true};await store.addBuild(build);
  const runtime={id:'runtime-1',buildId:'build-1',adapter:{name:'synthetic-test-only',version:'1'},app:{id:'test-app',version:'1'},fixture:{id:'unit-test',version:'1',mode:'controlled-io',description:'Synthetic core test only, never App acceptance evidence'},environment:{test:true},immutable:true,driftDetected:false,limitations:['Synthetic test evidence']};await store.addRuntime(runtime);
  await store.setTarget({buildId:'build-1',runtimeId:'runtime-1',specRev:'spec-1'});await store.startRun();
  const png=new PNG({width:2,height:2});png.data.fill(255);const image=join(dir,'synthetic-test.png');await writeFile(image,PNG.sync.write(png));
  const capture=(captureId='capture-1',index=0)=>({id:captureId,cellId:initialized.spec.cells[index].id,sourceSnapshotId:source.id,buildId:'build-1',runtimeId:'runtime-1',specRev:'spec-1',createdAt:timestamp,status:'captured',assets:[{id:'image-1',kind:'screenshot',path:image,capturedAt:timestamp,width:2,height:2}],actions:[{at:timestamp,type:'test',description:'Synthetic test action',source:'unit-test'}],assertions:[{description:'Synthetic pixel only',result:'pass',basis:'visual',evidenceAssetIds:['image-1']}],provenance:{adapter:'synthetic-test-only',adapterVersion:'1',deviceId:'test-device',deviceKind:'synthetic-test',source:'real-app',fixtureDescription:'Synthetic unit test; do not present as real app evidence'},limitations:['Synthetic core test only'],blockers:[]});
  const batch=(cap,batchId='batch-1')=>({schemaVersion:1,batchId,projectId:input.project.id,sourceId:'static-test-export',submittedAt:timestamp,edits:[{cellId:cap.cellId,captureId:cap.id,buildId:cap.buildId,runtimeId:cap.runtimeId,specRev:cap.specRev,verdict:'question',comment:'Synthetic test comment /skill:must-never-expand',reviewer:'Test harness, not a human'}]});
  const imageOptions={sessionId:'test-session',reviewer:{provider:'test',model:'image-test'},imageCapable:true,imagesBlocked:false};
  const review=(cap,receipts)=>({cellId:cap.cellId,captureId:cap.id,verdict:'pass',comment:'Synthetic pixel is uniformly white; no visible text in this synthetic test fixture.',visibleText:[],observations:cap.assets.filter(a=>a.kind!=='video').map(a=>({assetId:a.id,sha256:a.sha256,detail:'White 2×2 synthetic fixture; unit test only.'})),receiptIds:receipts.map(r=>r.id)});
  return {dir,repo,store,source,artifact,build,runtime,input,image,capture,batch,imageOptions,review,cells:initialized.spec.cells};
}
