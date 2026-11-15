import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import { fixture, timestamp } from './helpers.mjs';
import { decodeImage } from '../scripts/lib/media.mjs';
import { sha256 } from '../scripts/lib/contracts.mjs';

function whitePNG(width=2,height=2) { const image=new PNG({width,height});image.data.fill(255);return image; }
function pngWithText(bytes,text) {
  const type=Buffer.from('tEXt'),data=Buffer.from(`test-note\0${text}`),chunk=Buffer.alloc(data.length+12);
  chunk.writeUInt32BE(data.length,0);type.copy(chunk,4);data.copy(chunk,8);
  let crc=0xffffffff;for(const byte of Buffer.concat([type,data])){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  chunk.writeUInt32BE((crc^0xffffffff)>>>0,8+data.length);
  assert.equal(bytes.subarray(-8,-4).toString(),'IEND');
  return Buffer.concat([bytes.subarray(0,-12),chunk,bytes.subarray(-12)]);
}
async function staticTransition(f,captureId) {
  const png=whitePNG(),base=PNG.sync.write(png,{deflateLevel:3});
  const bytes=[PNG.sync.write(png,{deflateLevel:0}),base,pngWithText(base,'different encoding metadata; same pixels')];
  const paths=[];for(const [i,data]of bytes.entries()){const path=join(f.dir,`${captureId}-${i}.png`);await writeFile(path,data);paths.push(path);}
  const input=f.capture(captureId),original=input.assets[0];
  input.assets=[0,500,1000].map((offsetMs,i)=>({...original,id:`frame-${i}`,kind:'frame',path:paths[i],offsetMs,capturedAt:new Date(Date.parse(timestamp)+offsetMs).toISOString(),pixelSha256:String(i).repeat(64)}));
  input.transition={fromStateId:'empty',toStateId:'filled',startedAt:timestamp,endedAt:'2026-01-01T00:00:01.000Z',triggerActionIndex:0,startEvidenceAssetId:'frame-0',endEvidenceAssetId:'frame-2'};
  input.assertions=[{description:'Synthetic declared start',result:'pass',basis:'visual',stateId:'empty',evidenceAssetIds:['frame-0']},{description:'Synthetic declared end',result:'pass',basis:'visual',stateId:'filled',evidenceAssetIds:['frame-2']}];
  return {input,bytes};
}

test('canonical decoded fingerprints ignore PNG compression/metadata, include dimensions and detect changed pixels',()=>{
  const png=whitePNG(),compressed=[0,3,9].map(deflateLevel=>PNG.sync.write(png,{deflateLevel})),variants=[...compressed,pngWithText(compressed[1],'metadata only')];
  assert.ok(new Set(variants.map(sha256)).size>=3);assert.equal(new Set(variants.map(b=>decodeImage(b).pixelSha256)).size,1);
  const reshaped=PNG.sync.write(whitePNG(1,4));assert.deepEqual(PNG.sync.read(reshaped).data,PNG.sync.read(compressed[0]).data);assert.notEqual(decodeImage(reshaped).pixelSha256,decodeImage(compressed[0]).pixelSha256);
  png.data[0]=0;assert.notEqual(decodeImage(PNG.sync.write(png)).pixelSha256,decodeImage(compressed[0]).pixelSha256);
});

test('JPEG and PNG fingerprints use the same decoded RGBA raster; unsupported/corrupt decodes reject',()=>{
  const png=whitePNG(),pngBytes=PNG.sync.write(png),jpegBytes=jpeg.encode({width:2,height:2,data:png.data},100).data;
  assert.equal(decodeImage(pngBytes).pixelSha256,decodeImage(jpegBytes).pixelSha256);assert.equal(decodeImage(jpegBytes).mimeType,'image/jpeg');
  const corruptPNG=Buffer.from(pngBytes);corruptPNG[corruptPNG.length-1]^=1;
  assert.throws(()=>decodeImage(corruptPNG));assert.throws(()=>decodeImage(Buffer.from([255,216,255,217])));assert.throws(()=>decodeImage(Buffer.from('unsupported raster')));
});

test('capture, read and record block static decoded frames despite different encodings or forged cached fingerprints',async t=>{
  const f=await fixture(t,p=>{p.spec.cells=p.spec.cells.slice(2);}),{input,bytes}=await staticTransition(f,'same-decoded-pixels');
  const cap=await f.store.addCapture(input);assert.equal(new Set(cap.assets.map(a=>a.sha256)).size,3);assert.deepEqual(cap.assets.map(a=>a.sha256),bytes.map(sha256));assert.equal(new Set(cap.assets.map(a=>a.pixelSha256)).size,1);assert.equal(cap.status,'blocked');assert.match(cap.blockers.join(),/identical pixels/);
  // Synthetic legacy record: pre-fix versions could persist captured/pass eligibility with
  // only encoded SHAs. Opening it must derive actual pixels, never trust those historical flags.
  const legacy=structuredClone(cap);legacy.status='captured';legacy.blockers=[];for(const a of legacy.assets)delete a.pixelSha256;
  const path=f.store.recordPath('captures',cap.id);await writeFile(path,JSON.stringify(legacy));
  let data=await f.store.reviewData();assert.equal(data.cells[0].status,'blocked');assert.match(data.cells[0].blockers.join(),/identical pixels/);assert.equal(new Set(data.cells[0].capture.assets.map(a=>a.pixelSha256)).size,1);assert.equal(data.summary.finalAIPass,false);
  assert.ok(!(await f.store.record('captures',cap.id)).assets.some(a=>'pixelSha256'in a),'read does not rewrite immutable legacy records');
  await assert.rejects(f.store.recordAI(f.review(legacy,[]),f.imageOptions),/Transition evidence is incomplete/);
  for(const [i,a]of legacy.assets.entries())a.pixelSha256=String(i+1).repeat(64);await writeFile(path,JSON.stringify(legacy));
  data=await f.store.reviewData();assert.equal(data.cells[0].status,'blocked');assert.equal(new Set(data.cells[0].capture.assets.map(a=>a.pixelSha256)).size,1);await assert.rejects(f.store.recordAI(f.review(legacy,[]),f.imageOptions),/Transition evidence is incomplete/);
});

test('read/record cannot skip failed PNG or JPEG decode behind valid file hashes and cached pixel claims',async t=>{
  const f=await fixture(t,p=>{p.spec.cells=p.spec.cells.slice(2);}),{input,bytes}=await staticTransition(f,'decode-failure'),cap=await f.store.addCapture(input);
  const legacy=structuredClone(cap);legacy.status='captured';legacy.blockers=[];
  const badPNG=Buffer.from(bytes[0]);badPNG[badPNG.length-1]^=1;
  for(const [ext,bad]of [['png',badPNG],['jpg',Buffer.from([255,216,255,217])]]){
    const a=legacy.assets[0],hash=sha256(bad);Object.assign(a,{sha256:hash,path:`evidence/${hash}.${ext}`,mimeType:ext==='png'?'image/png':'image/jpeg',pixelSha256:'f'.repeat(64)});await writeFile(join(f.store.root,'blobs',`${hash}.${ext}`),bad);
    await writeFile(f.store.recordPath('captures',cap.id),JSON.stringify(legacy));const data=await f.store.reviewData();assert.equal(data.cells[0].status,'blocked');assert.ok(data.cells[0].blockers.some(b=>b.startsWith('frame-0:')));assert.match(data.cells[0].blockers.join(),/verified decoded pixel fingerprints/);assert.equal(data.cells[0].capture.assets[0].pixelSha256,undefined);await assert.rejects(f.store.recordAI(f.review(legacy,[]),f.imageOptions),/Evidence blocked or corrupt/);
  }
  // The capture path also rejects each corrupt supported format before it can be approved.
  for(const [i,ext]of ['png','jpg'].entries()){
    const bad=ext==='png'?badPNG:Buffer.from([255,216,255,217]),path=join(f.dir,`bad-${i}.${ext}`);await writeFile(path,bad);const failed=structuredClone(input);failed.id=`bad-capture-${i}`;failed.assets[0].path=path;await assert.rejects(f.store.addCapture(failed));
  }
});
