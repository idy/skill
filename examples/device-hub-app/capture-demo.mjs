#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { capture } from '../../skills/visual-acceptance/adapters/device-hub/adapter.mjs';

const args=process.argv.slice(2);
const option = name => args[args.indexOf(name)+1];
for (const name of ['--bindings','--build','--out']) if (!args.includes(name)) throw new Error(`Required: ${name}`);
const bindings=JSON.parse(await readFile(resolve(option('--bindings')),'utf8'));
const build=JSON.parse(await readFile(resolve(option('--build')),'utf8'));
const root=dirname(fileURLToPath(import.meta.url));
const output=resolve(option('--out'));
await mkdir(output,{recursive:false});
const phase=args.includes('--before')?'before':'after';
const states=args.includes('--states')?option('--states').split(','):(phase==='before'?['ready']:['empty','ready','error','download']);
if (states.some(s=>!['empty','ready','error','download'].includes(s))) throw new Error('Unknown demo state');
const exec=promisify(execFile);
for (const device of bindings.devices) {
 const {stdout:container}=await exec('xcrun',['simctl','get_app_container',device.id,build.appId,'app']);
 const installedExecutableSha256=createHash('sha256').update(await readFile(join(container.trim(),'TrailNotes'))).digest('hex');
 if (installedExecutableSha256!==build.executableSha256) throw new Error(`Installed app differs from build on ${device.key}`);
 for (const state of states) {
  const plan={
   id:`${phase}-${device.key}-${state}`,cellId:bindings.cells[`${device.key}-${state}`],
   sourceSnapshotId:bindings.sourceSnapshotId,buildId:bindings.buildId,runtimeId:bindings.runtimeId,specRev:bindings.specRev,
   workspacePath:join(root,'TrailNotes.xcodeproj'),
   device:{...device,kind:'simulator',orientation:'portrait',os:'iOS 27.0 (24A434)'},
   app:{id:build.appId,version:'1.0',executableSha256:build.executableSha256,installedExecutableSha256,sourceSha256:build.sourceSha256},
   prepare:[{type:'launch',description:'Launch only the bundled demo app, terminating its previous process to reset in-memory state',argv:['xcrun','simctl','launch','--terminate-running-process',device.id,build.appId]}],
   fixtureDescription:'seeded demonstration: bundled deterministic repository, 12 x 200ms IO ticks; production SwiftUI view + ItineraryStore state machine; failure selected by real UI button',
   entryActions:[{tap:'Reset'}],expectedTexts:[],
  };
  if (state==='empty') plan.expectedTexts=['No itinerary yet'];
  if (state==='ready') {plan.entryActions.push({tap:'Load itinerary'});plan.settleMs=3000;plan.expectedTexts=['Ready for offline use','Summit overnight itinerary'];}
  if (state==='error') {plan.entryActions.push({tap:'Test connection failure'});plan.settleMs=3000;plan.expectedTexts=['Connection unavailable','Try again'];}
  if (state==='download') {plan.expectedTexts=['Ready for offline use'];plan.transition={fromStateId:'empty',toStateId:'ready',fromExpectedTexts:['No itinerary yet'],trigger:{tap:'Load itinerary'},simctlVideo:true,sampleOffsetsMs:[600,1600,3600]};}
  const destination=join(output,`${device.key}-${state}`);
  await writeFile(join(output,`${device.key}-${state}-plan.json`),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  const result=await capture(plan,{outputDir:destination});
  console.log(JSON.stringify({id:plan.id,status:result.status,assets:result.assets.map(a=>({id:a.id,width:a.width,height:a.height})),blockers:result.blockers}));
  if (result.status==='blocked') process.exitCode=2;
 }
}
