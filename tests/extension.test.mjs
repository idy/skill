import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile, readFile } from 'node:fs/promises';
import { fixture } from './helpers.mjs';

const hostRoot=process.env.PI_TEST_PACKAGE_ROOT;
const options={skip:!hostRoot && 'Set PI_TEST_PACKAGE_ROOT to the installed @earendil-works/pi-coding-agent root'};
async function host() {
  const {loadExtensions}=await import(pathToFileURL(join(hostRoot,'dist/core/extensions/loader.js')).href);
  const {SessionManager}=await import(pathToFileURL(join(hostRoot,'dist/core/session-manager.js')).href);
  const {AgentSession}=await import(pathToFileURL(join(hostRoot,'dist/core/agent-session.js')).href);
  const loaded=await loadExtensions([resolve('extensions/visual-acceptance.ts')],resolve('.'));assert.deepEqual(loaded.errors,[]);
  return {loaded,SessionManager,AgentSession};
}
function wire(loaded,sm,f,send) {
  const messages=[];loaded.runtime.getSettings=()=>({images:{blockImages:false}});
  loaded.runtime.sendMessage=send??((message,settings)=>{messages.push({message,options:settings});sm.appendCustomMessageEntry(message.customType,message.content,message.display,message.details);});
  loaded.runtime.sendUserMessage=()=>{throw new Error('Must not impersonate human input');};loaded.runtime.appendEntry=(kind,data)=>sm.appendCustomEntry(kind,data);
  const ctx={cwd:f.dir,model:{provider:'test',id:'image-test',input:['text','image']},sessionManager:sm};
  const run=(name,args)=>loaded.extensions[0].tools.get(name).definition.execute('test-call',{store:f.store.root,...args},undefined,undefined,ctx);
  const emit=async(name,event={})=>{let result;for(const handler of loaded.extensions[0].handlers.get(name)??[])result=await handler(event,ctx);return result;};
  const appendImage=image=>sm.appendMessage({role:'toolResult',toolCallId:'image-call',toolName:'visual_acceptance_image',...image,isError:false,timestamp:Date.now()});
  return {ctx,run,emit,appendImage,messages};
}

test('Pi host tools return one image, require effective context and persist one custom feedback message',options,async t=>{
  const f=await fixture(t),cap=await f.store.addCapture(f.capture()),{loaded,SessionManager}=await host(),sm=SessionManager.inMemory(f.dir),w=wire(loaded,sm,f);
  const image=await w.run('visual_acceptance_image',{cellId:cap.cellId});assert.equal(image.content.filter(c=>c.type==='image').length,1);
  const review=f.review(cap,[image.details.receipt]);await assert.rejects(w.run('visual_acceptance_record',review),/effective model context/);
  w.appendImage(image);await w.run('visual_acceptance_record',review);
  const path=join(f.dir,'feedback.json');await writeFile(path,JSON.stringify(f.batch(cap)));const first=await w.run('visual_acceptance_feedback_import',{path});await w.run('visual_acceptance_feedback_import',{path});
  assert.equal(first.details.delivered,true);assert.equal(first.details.delivery,'persisted');assert.equal(w.messages.length,1);assert.deepEqual(w.messages[0].options,{triggerTurn:true,deliverAs:'followUp'});
  for(const value of ['static-test-export','test-project','batch-1',cap.cellId,cap.id,cap.buildId,cap.runtimeId,cap.specRev,'/skill:must-never-expand'])assert.ok(w.messages[0].message.content.includes(value),value);
  assert.ok(sm.getBranch().some(e=>e.type==='custom' && e.customType==='visual-acceptance-delivered' && e.data.messageEntryId));
  loaded.runtime.getSettings=()=>({images:{blockImages:true}});await assert.rejects(w.run('visual_acceptance_image',{cellId:cap.cellId}),/blocked/);
});

test('P1: real Pi compaction and null/text/different-image context edits invalidate old receipts',options,async t=>{
  const f=await fixture(t,p=>{p.spec.cells=p.spec.cells.slice(0,1);}),cap=await f.store.addCapture(f.capture()),{loaded,SessionManager}=await host(),sm=SessionManager.inMemory(f.dir),w=wire(loaded,sm,f);
  const first=await w.run('visual_acceptance_image',{cellId:cap.cellId});w.appendImage(first);const kept=sm.appendMessage({role:'user',content:'Continue with compacted context.',timestamp:Date.now()});sm.appendCompaction('Pixels omitted.',kept,1000);
  assert.ok(sm.getBranch().some(e=>e.type==='message' && e.message.toolName==='visual_acceptance_image'));assert.equal(sm.buildSessionProjection().messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(c=>c.type==='image').length,0);
  await assert.rejects(w.run('visual_acceptance_record',f.review(cap,[first.details.receipt])),/effective model context/);
  for(const replacement of [null,{content:'Image removed by an edit'},{content:[{type:'image',data:Buffer.from('different pixels').toString('base64'),mimeType:'image/png'}]}]){
    const image=await w.run('visual_acceptance_image',{cellId:cap.cellId}),entryId=w.appendImage(image);sm.appendContextEdit(entryId,replacement);
    await assert.rejects(w.run('visual_acceptance_record',f.review(cap,[image.details.receipt])),/effective model context/);
  }
  assert.equal((await f.store.reviewData()).summary.finalAIPass,false);
  const fresh=await w.run('visual_acceptance_image',{cellId:cap.cellId});w.appendImage(fresh);await w.run('visual_acceptance_record',f.review(cap,[fresh.details.receipt]));assert.equal((await f.store.reviewData()).summary.finalAIPass,true);
});

test('P2: actual host followUp queue loss recovers from durable pending without optimistic acknowledgments',options,async t=>{
  const f=await fixture(t),cap=await f.store.addCapture(f.capture()),{loaded,SessionManager,AgentSession}=await host(),sm=SessionManager.create(f.dir,join(f.dir,'sessions'));
  sm.appendMessage({role:'user',content:'Explicit test acceptance session',timestamp:Date.now()});
  const queue=[],w=wire(loaded,sm,f,(message,settings)=>{void AgentSession.prototype.sendCustomMessage.call({isStreaming:true,agent:{followUp:m=>queue.push(m)}},message,settings);});
  const path=join(f.dir,'feedback.json');await writeFile(path,JSON.stringify(f.batch(cap)));const initial=await w.run('visual_acceptance_feedback_import',{path});assert.equal(initial.details.delivered,false);assert.equal(initial.details.delivery,'queued');assert.equal(queue.length,1);
  await w.run('visual_acceptance_feedback_import',{path});assert.equal(queue.length,1);
  assert.equal(sm.getBranch().filter(e=>e.type==='custom' && e.customType==='visual-acceptance-pending').length,1);assert.equal(sm.getBranch().filter(e=>e.type==='custom' && e.customType==='visual-acceptance-delivered').length,0);assert.equal(sm.getBranch().filter(e=>e.type==='custom_message').length,0);
  const sessionFile=sm.getSessionFile();assert.match(await readFile(sessionFile,'utf8'),/visual-acceptance-pending/);queue.length=0;
  // Fresh extension runtime plus an actual disk-reopened SessionManager, with the host queue lost.
  const restarted=await host(),restored=SessionManager.open(sessionFile,join(f.dir,'sessions')),recovered=[];
  const r=wire(restarted.loaded,restored,f,(message,settings)=>{void AgentSession.prototype.sendCustomMessage.call({isStreaming:true,agent:{followUp:m=>recovered.push(m)}},message,settings);});
  assert.equal(restored.getSessionId(),sm.getSessionId());await r.emit('session_start',{reason:'resume'});assert.equal(recovered.length,1);await r.run('visual_acceptance_feedback_import',{path});assert.equal(recovered.length,1);
  const delivered=recovered[0];restored.appendCustomMessageEntry(delivered.customType,delivered.content,delivered.display,delivered.details);await r.emit('turn_start');
  assert.ok(restored.getBranch().some(e=>e.type==='custom' && e.customType==='visual-acceptance-delivered' && e.data.messageEntryId));
  const duplicate=await r.run('visual_acceptance_feedback_import',{path});assert.equal(duplicate.details.delivered,true);assert.equal(recovered.length,1);
  // A retained old queue and a replay can race during reload: only the first carries feedback data.
  const raced=await r.emit('message_end',{message:{...delivered,details:{...delivered.details,attemptId:'another-attempt'}}});assert.equal(raced.message.customType,'visual-acceptance-feedback-duplicate');assert.deepEqual(raced.message.content,[]);
  restored.appendCustomMessageEntry(raced.message.customType,raced.message.content,raced.message.display,raced.message.details);
  const context=await r.emit('context',{messages:restored.buildSessionProjection().messages});assert.equal(context.messages.filter(m=>m.role==='custom' && m.customType==='visual-acceptance-feedback').length,1);assert.equal(context.messages.filter(m=>m.role==='custom' && m.customType==='visual-acceptance-feedback-duplicate').length,0);
  const finalHost=await host(),finalSm=SessionManager.open(sessionFile,join(f.dir,'sessions')),finalQueue=[],final=wire(finalHost.loaded,finalSm,f,m=>finalQueue.push(m));await final.emit('session_start',{reason:'resume'});assert.equal(finalQueue.length,0);
});

test('P2: swallowed asynchronous host send failures remain explicitly retriable at idle',options,async t=>{
  const f=await fixture(t),cap=await f.store.addCapture(f.capture()),{loaded,SessionManager,AgentSession}=await host(),sm=SessionManager.inMemory(f.dir);
  let failures=0;const w=wire(loaded,sm,f,(message,settings)=>{void AgentSession.prototype.sendCustomMessage.call({isStreaming:false,_startRun:async()=>{failures++;throw new Error('Simulated host start failure');}},message,settings).catch(()=>{});});
  w.ctx.isIdle=()=>true;w.ctx.hasPendingMessages=()=>false;
  const path=join(f.dir,'failed-send.json');await writeFile(path,JSON.stringify(f.batch(cap)));assert.equal((await w.run('visual_acceptance_feedback_import',{path})).details.delivered,false);assert.equal(failures,1);
  loaded.runtime.sendMessage=(message)=>{sm.appendCustomMessageEntry(message.customType,message.content,message.display,message.details);};
  const retry=await w.run('visual_acceptance_feedback_import',{path});assert.equal(retry.details.delivered,true);assert.equal(sm.getBranch().filter(e=>e.type==='custom_message' && e.customType==='visual-acceptance-feedback').length,1);
});

test('P2: old optimistic markers cannot suppress explicit retry, and pending sends stay session-bound',options,async t=>{
  const f=await fixture(t),cap=await f.store.addCapture(f.capture()),batch=f.batch(cap);await f.store.importFeedback(batch);
  const {loaded,SessionManager}=await host(),sm=SessionManager.inMemory(f.dir);sm.appendCustomEntry('visual-acceptance-delivered',{key:`${f.store.root}:${batch.projectId}:${batch.batchId}`,projectId:batch.projectId,batchId:batch.batchId});
  const queue=[],w=wire(loaded,sm,f,m=>queue.push(m));await w.emit('session_start',{reason:'reload'});assert.equal(queue.length,0);
  const path=join(f.dir,'legacy-feedback.json');await writeFile(path,JSON.stringify(batch));await w.run('visual_acceptance_feedback_import',{path});assert.equal(queue.length,1);assert.ok(sm.getBranch().some(e=>e.type==='custom' && e.customType==='visual-acceptance-pending'));
  const other=await host(),otherSm=SessionManager.inMemory(f.dir);for(const e of sm.getBranch())if(e.type==='custom' && e.customType==='visual-acceptance-pending')otherSm.appendCustomEntry(e.customType,e.data);
  const otherQueue=[],o=wire(other.loaded,otherSm,f,m=>otherQueue.push(m));await o.emit('session_start',{reason:'fork'});assert.equal(otherQueue.length,0);
});
