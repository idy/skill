// Real loopback/browser regression on synthetic temporary fixtures only.
// No native evidence, user page, provider request or human participation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { fixture } from '../helpers.mjs';
import { startReviewServer } from '../../scripts/lib/server.mjs';

test('real server persists missing blocked/n-a opinions across refresh/fresh browser and invalidates them only on capture/spec change',async t=>{
 const f=await fixture(t),server=await startReviewServer(f.store),browser=await chromium.launch();
 const evidence=await mkdtemp(join(tmpdir(),'va-missing-feedback-'));
 const saveKey=cell=>cell.id+'@none';
 const saved=async(page,key)=>page.waitForFunction(k=>window.__vaReviewApp.saveStates.get(k)?.status==='saved' && !window.__vaReviewApp.busy,key);
 const open=async(page,cell)=>{await page.click(`.tile[data-cell="${cell.id}"]`);await page.waitForSelector('#review:not([hidden])');};
 const human=async(page,cell)=>page.evaluate(cellId=>{const a=window.__vaReviewApp;return window.VAReview.model.humanState(a.view.cellsById.get(cellId),a.drafts);},cell.id);
 try {
  const a=await browser.newContext(),page=await a.newPage();await page.goto(server.url);await page.waitForSelector('.tile');
  await page.fill('#reviewer','review-ui-browser-test');
  for(const [i,cell] of f.cells.slice(0,2).entries()){
   await open(page,cell);await page.fill('#comment','Automated absence regression; origin=review-ui-browser-test; not human acceptance.');
   await page.click(`.decision[data-decision="${i?'not-applicable':'blocked'}"]`);await saved(page,saveKey(cell));await page.click('#btn-back-matrix');
  }
  await open(page,f.cells[2]);await page.fill('#comment','Automated undecided comment-only draft; not human acceptance.');await saved(page,saveKey(f.cells[2]));await page.click('#btn-back-matrix');
  let draft=JSON.parse(await readFile(join(f.store.root,'drafts.json'),'utf8'));
  assert.equal(draft.edits.find(e=>e.cellId===f.cells[2].id).undecided,true);
  await page.click('#btn-submit');await page.click('#btn-send-batch');await page.waitForFunction(()=>/已提交/.test(document.getElementById('submit-result').textContent));
  let view=await f.store.reviewData();assert.equal(view.cells[0].currentHumanReview.decision,'blocked');assert.equal(view.cells[1].currentHumanReview.decision,'not-applicable');
  assert.equal(view.summary.finalAIPass,false);assert.equal(view.summary.aiPass,0);
  await page.reload();await page.waitForSelector('.tile');assert.equal((await human(page,f.cells[0])).decision,'blocked');
  // Submitted history, rather than a browser or server draft mirror, must be
  // sufficient. Retain the separate comment-only draft while removing mirrors
  // of the two already-submitted opinions in this synthetic temporary store.
  draft=JSON.parse(await readFile(join(f.store.root,'drafts.json'),'utf8'));draft.edits=draft.edits.filter(e=>e.undecided);await writeFile(join(f.store.root,'drafts.json'),JSON.stringify(draft));
  const b=await browser.newContext(),fresh=await b.newPage();await fresh.goto(server.url);await fresh.waitForSelector('.tile');
  const blocked=await human(fresh,f.cells[0]),na=await human(fresh,f.cells[1]);assert.equal(blocked.state,'blocked');assert.equal(blocked.decision,'blocked');assert.equal(na.decision,'not-applicable');
  await open(fresh,f.cells[0]);assert.match(await fresh.textContent('.human-section'),/已提交/);assert.equal(await fresh.locator('.human-section .box.stale').count(),0);
  await fresh.screenshot({path:join(evidence,'fresh-browser-missing-blocked.png')});
  const batch=(await f.store.records(await f.store.state(),'feedback'))[0],history=await readFile(f.store.recordPath('feedback',batch.id));
  await f.store.addCapture(f.capture());await fresh.reload();await fresh.waitForSelector('#review:not([hidden])');
  assert.equal((await human(fresh,f.cells[0])).state,'reopen');assert.match(await fresh.textContent('.old-human'),/已失效/);
  view=await f.store.reviewData();assert.equal(view.cells[0].humanReviews[0].captureId,null);assert.equal(view.cells[0].humanReviews[0].stale,true);assert.equal(view.cells[0].currentHumanReview,null);assert.equal(view.cells[0].currentAIReview,null);
  await fresh.screenshot({path:join(evidence,'new-capture-old-absence.png')});
  await f.store.setSpec({...f.input,spec:{...f.input.spec,revision:'spec-2'}});await fresh.goto(server.url);await fresh.waitForSelector('.tile');
  assert.equal((await human(fresh,f.cells[1])).state,'reopen');assert.equal((await f.store.reviewData()).cells[1].currentHumanReview,null);
  assert.deepEqual(await readFile(f.store.recordPath('feedback',batch.id)),history);
  await writeFile(join(evidence,'result.json'),JSON.stringify({origin:'review-ui-browser-test',humanAcceptance:false,blockedFresh:blocked.decision,notApplicableFresh:na.decision,commentOnlyDraftPreserved:true,newCaptureOldAbsenceStale:true,specChangeOldAbsenceStale:true,originalFeedbackBytesUnchanged:true},null,2));
  console.log('Missing feedback browser evidence: '+evidence);
 } finally {await browser.close();await server.close();}
});
