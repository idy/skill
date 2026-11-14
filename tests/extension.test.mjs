import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { fixture } from './helpers.mjs';

// Optional host integration: point at an installed Pi package root, without installing a second host copy.
const hostRoot=process.env.PI_TEST_PACKAGE_ROOT;
test('Pi host loads tools, returns actual single-image content, enforces earlier branch delivery and sends deduplicated custom feedback', {skip:!hostRoot && 'Set PI_TEST_PACKAGE_ROOT to the installed @earendil-works/pi-coding-agent root'},async t=>{
  const {loadExtensions}=await import(pathToFileURL(join(hostRoot,'dist/core/extensions/loader.js')).href);
  const f=await fixture(t),cap=await f.store.addCapture(f.capture());
  const loaded=await loadExtensions([resolve('extensions/visual-acceptance.ts')],resolve('.'));
  assert.deepEqual(loaded.errors,[]);assert.equal(loaded.extensions.length,1);
  const branch=[],messages=[];loaded.runtime.getSettings=()=>({images:{blockImages:false}});loaded.runtime.sendMessage=(message,options)=>messages.push({message,options});loaded.runtime.sendUserMessage=()=>{throw new Error('Must not impersonate user input');};loaded.runtime.appendEntry=(customType,data)=>branch.push({type:'custom',customType,data});
  const ctx={cwd:f.dir,model:{provider:'test',id:'image-test',input:['text','image']},sessionManager:{getSessionId:()=>f.imageOptions.sessionId,getBranch:()=>branch}};
  const tools=loaded.extensions[0].tools;const run=(name,args)=>tools.get(name).definition.execute('test-call',{store:f.store.root,...args},undefined,undefined,ctx);
  const image=await run('visual_acceptance_image',{cellId:cap.cellId});assert.equal(image.content.filter(c=>c.type==='image').length,1);assert.ok(image.content.find(c=>c.type==='image').data.length>0);
  const review=f.review(cap,[image.details.receipt]);await assert.rejects(run('visual_acceptance_record',review),/earlier completed call/);
  branch.push({type:'message',message:{role:'toolResult',toolName:'visual_acceptance_image',...image}});await run('visual_acceptance_record',review);
  const path=join(f.dir,'feedback.json');await writeFile(path,JSON.stringify(f.batch(cap)));await run('visual_acceptance_feedback_import',{path});await run('visual_acceptance_feedback_import',{path});
  assert.equal(messages.length,1);assert.equal(messages[0].message.customType,'visual-acceptance-feedback');assert.deepEqual(messages[0].options,{triggerTurn:true,deliverAs:'followUp'});
  for(const value of ['static-test-export','test-project','batch-1',cap.cellId,cap.id,cap.buildId,cap.runtimeId,cap.specRev,'/skill:must-never-expand']) assert.ok(messages[0].message.content.includes(value),value);
  loaded.runtime.getSettings=()=>({images:{blockImages:true}});await assert.rejects(run('visual_acceptance_image',{cellId:cap.cellId}),/blocked/);
});
