import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture, hitPoint, pngDimensions, APPLE_TOOLS, transitionForFrames } from './adapter.mjs';
import { StdioMCP } from './mcp.mjs';

// Protocol unit fixture only. This 1x1 image is never App acceptance evidence.
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0WQAAAAASUVORK5CYII=', 'base64');
const hierarchy = `Device orientation: Portrait\nApplication bundle identifier: test.demo\nApplication UI orientation: Portrait\nApplication, pid: 42, label: 'Unit fixture'\n Button, label: 'Reset', hitPoint: {20.5, 30.0}\n StaticText, label: 'Expected state'`;
const plan = () => ({ id:'unit-1', cellId:'cell-test', sourceSnapshotId:'source-test', buildId:'build-test', runtimeId:'runtime-test', specRev:'spec-1', device:{ id:'device-uuid', os:'test-os', orientation:'portrait' }, app:{id:'test.demo'}, entryActions:[{tap:'Reset'}], expectedTexts:['Expected state'] });
async function harness(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(),'device-hub-unit-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const image=join(root,'unit.png'), tree=join(root,'unit.txt');
  await writeFile(image,pixel); await writeFile(tree,hierarchy);
  const calls=[];
  const client={ async initialize(){return Object.values(APPLE_TOOLS).map(name=>({name}));}, async call(name,args){calls.push({name,args});if(name===APPLE_TOOLS.start)return {interactionSessionKey:'test-session-secret',deviceUUID:'device-uuid',deviceIsSimulator:true};if(name===APPLE_TOOLS.observe)return {screenshotPath:image,hierarchyPath:tree,applicationState:'Running'};return {};},close(){calls.push({name:'close'});},...overrides};
  return {root,image,tree,calls,client};
}
test('live hitPoint must uniquely identify the current button',()=>{
 assert.deepEqual(hitPoint(hierarchy,'Reset'),{x:20.5,y:30});
 assert.throws(()=>hitPoint(hierarchy,'Missing'),/found 0/);
 assert.throws(()=>hitPoint(hierarchy+'\n'+hierarchy,'Reset'),/found 2/);
 assert.throws(()=>pngDimensions(Buffer.from('bad')),/not a PNG/);
});
test('copies original bytes, records actual dimensions, uses latest hitPoint and cleans up',async t=>{
 const h=await harness(t);const result=await capture(plan(),{outputDir:join(h.root,'capture'),client:h.client});
 assert.equal(result.status,'captured');assert.equal(result.assets[0].width,1);
 assert.deepEqual(await readFile(result.assets[0].path),pixel);
 assert.ok(h.calls.some(c=>c.args?.interactionCommand==='t 20.5 30'));
 assert.equal(h.calls.at(-2).name,APPLE_TOOLS.end);assert.equal(h.calls.at(-1).name,'close');
 assert.ok(result.assertions.every(a=>a.basis==='accessibility'));
 assert.ok(!(await readFile(join(h.root,'capture','capture.json'),'utf8')).includes('test-session-secret'));
 await assert.rejects(capture(plan(),{outputDir:join(h.root,'capture'),client:h.client}),/EEXIST/);
});
test('state not reached is blocked with no current-screen substitute',async t=>{
 const h=await harness(t);const p=plan();p.expectedTexts=['Unreachable'];
 const result=await capture(p,{outputDir:join(h.root,'blocked'),client:h.client});
 assert.equal(result.status,'blocked');assert.deepEqual(result.assets,[]);
 assert.match(result.blockers[0],/state not reached/);assert.equal(h.calls.at(-2).name,APPLE_TOOLS.end);
});
test('wrong device is rejected before any observation and still closes session',async t=>{
 const h=await harness(t);const original=h.client.call;
 h.client.call=async(name,args)=>name===APPLE_TOOLS.start?{interactionSessionKey:'test-session-secret',deviceUUID:'wrong'}:original(name,args);
 const result=await capture(plan(),{outputDir:join(h.root,'mismatch'),client:h.client});
 assert.equal(result.status,'blocked');assert.match(result.blockers[0],/different device/);
 assert.ok(!h.calls.some(c=>c.name===APPLE_TOOLS.observe));assert.ok(h.calls.some(c=>c.name===APPLE_TOOLS.end));
});
test('bridge missing tool is saved as a concrete blocker',async t=>{
 const h=await harness(t,{async initialize(){return [];}});
 const result=await capture(plan(),{outputDir:join(h.root,'capability'),client:h.client});
 assert.equal(result.status,'blocked');assert.match(result.blockers[0],/does not expose/);
});
test('cleanup failure blocks acceptance instead of claiming session closed',async t=>{
 const h=await harness(t);const original=h.client.call;
 h.client.call=async(name,args)=>{if(name===APPLE_TOOLS.end)throw new Error('remote end failed');return original(name,args);};
 const result=await capture(plan(),{outputDir:join(h.root,'cleanup'),client:h.client});
 assert.equal(result.status,'blocked');assert.match(result.blockers[0],/cleanup failed/);
});
test('live hierarchy orientation mismatch blocks capture',async t=>{
 const h=await harness(t);await writeFile(h.tree,hierarchy.replace('Application UI orientation: Portrait','Application UI orientation: Landscape Left'));
 const result=await capture(plan(),{outputDir:join(h.root,'orientation'),client:h.client});
 assert.equal(result.status,'blocked');assert.match(result.blockers[0],/Requested portrait/);
});
test('omitted kind derives both physical and simulator provenance from the actual session',async t=>{
 for (const actual of [false,true]) {
  const h=await harness(t);const original=h.client.call;
  h.client.call=async(name,args)=>name===APPLE_TOOLS.start?{interactionSessionKey:'test-session-secret',deviceUUID:'device-uuid',deviceIsSimulator:actual}:original(name,args);
  const p=plan();assert.equal(p.device.kind,undefined);
  const result=await capture(p,{outputDir:join(h.root,`derived-${actual}`),client:h.client});
  assert.equal(result.status,'captured');assert.deepEqual(result.blockers,[]);
  assert.equal(result.provenance.deviceKind,actual?'simulator':'device');
  assert.equal(result.provenance.device.kind,result.provenance.deviceKind);
  assert.equal(result.provenance.requestedDeviceKind,'unspecified');
  assert.equal(p.device.kind,undefined,'Do not mutate the requested plan');
 }
});
test('missing or malformed actual kind stays unknown and blocks before observation',async t=>{
 for(const actual of [undefined,null,'false']) {
  const h=await harness(t);const original=h.client.call;
  h.client.call=async(name,args)=>name===APPLE_TOOLS.start?{interactionSessionKey:'test-session-secret',deviceUUID:'device-uuid',deviceIsSimulator:actual}:original(name,args);
  const result=await capture(plan(),{outputDir:join(h.root,'unknown-kind'),client:h.client});
  assert.equal(result.status,'blocked');assert.equal(result.provenance.deviceKind,'unknown');
  assert.match(result.blockers[0],/did not report its actual device kind/);
  assert.ok(!h.calls.some(c=>c.name===APPLE_TOOLS.observe));assert.ok(h.calls.some(c=>c.name===APPLE_TOOLS.end));
 }
});
test('explicit kind mismatch blocks and still records actual session kind',async t=>{
 const h=await harness(t);const p=plan();p.device.kind='device';
 const result=await capture(p,{outputDir:join(h.root,'kind-mismatch'),client:h.client});
 assert.equal(result.status,'blocked');assert.equal(result.provenance.deviceKind,'simulator');
 assert.equal(result.provenance.requestedDeviceKind,'device');assert.match(result.blockers[0],/kind differs/);
 assert.ok(!h.calls.some(c=>c.name===APPLE_TOOLS.observe));assert.equal(h.calls.at(-2).name,APPLE_TOOLS.end);
});
test('transition references real action and endpoint observation timestamps without inventing times',()=>{
 const spec={fromStateId:'empty',toStateId:'ready'};
 const frames=[{id:'start',capturedAt:'2026-11-14T16:00:00.000Z',offsetMs:0},{id:'middle',capturedAt:'2026-11-14T16:00:00.750Z',offsetMs:750},{id:'end',capturedAt:'2026-11-14T16:00:02.000Z',offsetMs:2000}];
 const actions=[{at:'2026-11-14T15:59:59.000Z'},{at:'2026-11-14T16:00:00.200Z'}];
 assert.deepEqual(transitionForFrames(spec,frames,actions,1),{...spec,startedAt:frames[0].capturedAt,endedAt:frames[2].capturedAt,triggerActionIndex:1,startEvidenceAssetId:'start',endEvidenceAssetId:'end'});
 assert.throws(()=>transitionForFrames(spec,frames,actions,0),/actual in-interval action/);
 assert.throws(()=>transitionForFrames(spec,[frames[0],frames[2]],actions,1),/intermediate/);
 assert.throws(()=>transitionForFrames(spec,[frames[0],{...frames[1],offsetMs:749},frames[2]],actions,1),/exactly match/);
});
test('MCP error details redact session keys',async()=>{
 const fake=Object.create(StdioMCP.prototype);fake.request=async()=>({isError:true,content:[{type:'text',text:'Denied private-session-key'}]});
 await assert.rejects(fake.call('test',{interactSessionKey:'private-session-key'}),e=>e.message.includes('[redacted]')&&!e.message.includes('private-session-key'));
});
