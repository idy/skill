// Real-browser interaction tests of the review UI itself.
//
// Screenshots written here show the REVIEW PAGE, not app evidence. The static and
// mock-server suites use FIXTURE data (synthetic SVG); never treat them as app
// acceptance. The optional core suite loads a COPY of a real core store through
// core's real loopback server and submits only clearly-labelled automated test
// feedback into that temporary copy.
//
// Run after `npm ci --ignore-scripts --omit=peer` and `npm run browser:install`.
// Optional overrides: PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core,
// CHROME=/path/to/chrome-headless-shell, VA_CORE_ROOT and VA_CORE_STORE.
// Browser packages are development dependencies; Pi/runtime installs omit them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeBundle, cellIdFor, REVIEW_DIR } from '../support/fixture.mjs';
import { startMockServer } from '../support/mock-review-server.mjs';

const PW = process.env.PLAYWRIGHT_CORE || 'playwright';
const skip = false;
const SHOTS = process.env.VA_SHOTS || join(tmpdir(), 'va-review-ui-shots');
mkdirSync(SHOTS, { recursive: true });
const id = (scenarioId, stateId, deviceId, orientation, variantId = 'default') => cellIdFor({ scenarioId, stateId, deviceId, orientation, variantId });
const C = {
  emptyPhone: id('checkout', 'cart-empty', 'phone-a', 'portrait'),
  emptyLand: id('checkout', 'cart-empty', 'phone-a', 'landscape'),
  emptyTablet: id('checkout', 'cart-empty', 'tablet-b', 'portrait'),
  filledPhone: id('checkout', 'cart-filled', 'phone-a', 'portrait'),
  filledLand: id('checkout', 'cart-filled', 'phone-a', 'landscape'),
  filledTablet: id('checkout', 'cart-filled', 'tablet-b', 'portrait'),
  seqPhone: id('checkout', 'submit-order', 'phone-a', 'portrait'),
  seqTablet: id('checkout', 'submit-order', 'tablet-b', 'portrait'),
  settingsPhone: id('settings', 'settings-main', 'phone-a', 'portrait')
};

let chromium, browser, bundle, round2;
const shot = (page, name) => page.screenshot({ path: join(SHOTS, name + '.png') });
const app = (page, expr) => page.evaluate(expr);
const activeId = page => page.evaluate(() => window.__vaReviewApp.activeId);
const tile = cell => `.tile[data-cell="${cell}"]`;

async function newPage(ctx, url) {
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('#matrix-table .tile');
  return page;
}
async function openCell(page, cell) {
  await page.click(tile(cell));
  await page.waitForFunction(c => window.__vaReviewApp.activeId === c && !document.getElementById('review').hidden, cell);
}
async function waitSaved(page) {
  await page.waitForFunction(() => /已保存/.test(document.getElementById('save-state')?.textContent || ''));
}

test.before(async () => {
  if (skip) return;
  const require = createRequire(import.meta.url);
  chromium = require(PW).chromium;
  browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  bundle = mkdtempSync(join(tmpdir(), 'va-review-bundle-'));
  writeBundle(bundle, { round: 1 });
  round2 = join(mkdtempSync(join(tmpdir(), 'va-review-round2-')), 'review.json');
  const b2 = mkdtempSync(join(tmpdir(), 'va-review-b2-'));
  writeBundle(b2, { round: 2 });
  cpSync(join(b2, 'evidence'), join(bundle, 'evidence'), { recursive: true }); // new evidence files next to the static page
  writeFileSync(round2, readFileSync(join(b2, 'review.json')));
});
test.after(async () => { if (browser) await browser.close(); });

test('static: matrix layout, device columns, placeholders and fixture marking', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await newPage(ctx, pathToFileURL(join(bundle, 'index.html')).href);
  await page.waitForTimeout(300);
  assert.match(await page.textContent('#notices'), /FIXTURE \/ 非真实 App 证据/);
  assert.match(await page.textContent('#notices'), /已移除格子的历史人工意见/);
  await page.click('[data-notice="historical"] button:has-text("查看")');
  assert.match(await page.textContent('#text-dialog'), /优惠券/);
  await page.keyboard.press('Escape');
  assert.match(await page.textContent('#storage-badge'), /仅此浏览器/);
  const head = await page.textContent('#matrix-table thead');
  for (const s of ['Phone A (fixture)', 'Tablet B (fixture)', '1170×2532 px', '1600×2560 px', '竖屏', '横屏', '尺寸未知']) assert.ok(head.includes(s), s);
  assert.equal(await page.locator('.tile').count(), 13);
  assert.match(await page.textContent(tile(C.emptyLand)), /缺证据/);
  assert.match(await page.textContent(tile(C.filledLand)), /采集阻塞/);
  await page.waitForFunction(c => /图片无法加载/.test(document.querySelector(`.tile[data-cell="${c}"]`).textContent), C.filledTablet);
  assert.match(await page.textContent(tile(C.seqTablet)), /过程证据不足/);
  assert.match(await page.textContent(tile(C.seqPhone)), /6 帧/);
  assert.match(await page.textContent(tile(C.filledPhone)), /需复审/);
  // real proportional sizes: tablet thumb wider than phone portrait thumb
  const w = await page.evaluate(([a, b]) => [a, b].map(c => document.querySelector(`.tile[data-cell="${c}"] .thumb`).getBoundingClientRect().width), [C.emptyPhone, C.emptyTablet]);
  assert.ok(w[1] > w[0]);
  // missing landscape cell is not filled with a rotated portrait image
  assert.equal(await page.locator(tile(C.emptyLand) + ' img').count(), 0);
  await shot(page, '01-static-matrix');
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

// Regression for a user report: a device titled with a long simulation note
// ("WebKit 1120×760 (main window normal size) — SIMULATION: …") stretched its
// column to ~1500px around a ~155px preview and pushed the next column off
// screen. Column width must follow the preview box only; long, spaceless or
// localized labels/metadata wrap inside it and stay fully available.
const LONG_DEVICES = {
  'phone-a': { label: 'WebKit 1120×760 (main window normal size) — SIMULATION: real sample-desktop binary (--headless --preview) serving its production embedded UI, rendered by a headless Playwright browser at the sample window content size; not a native WKWebView window', platform: 'macos-webkit-headless' },
  'tablet-b': { label: '平板横屏（主窗口最大化，系统缩放百分之一百二十五，模拟数据）android-emulator-sample-pixel-pro-xl-api-35-arm64-v8a-google-apis-playstore', platform: 'android-emulator-arm64-v8a-google-apis-x86_64-translation-layer' }
};
async function setZoom(page, z) {
  await page.$eval('#matrix-zoom', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, z);
}
function columnGeometry(page) {
  return page.evaluate(() => {
    const ths = [...document.querySelectorAll('#matrix-table thead th:not(.corner)')];
    const rows = [...document.querySelectorAll('#matrix-table tbody tr:not(.group-row)')];
    return ths.map((th, i) => {
      const items = rows.map(r => r.children[i + 1] && r.children[i + 1].firstElementChild).filter(Boolean);
      const label = th.querySelector('.col-text strong');
      const lh = parseFloat(getComputedStyle(label).lineHeight);
      return {
        left: th.getBoundingClientRect().left, width: th.getBoundingClientRect().width,
        content: Math.max(...items.map(el => el.getBoundingClientRect().width)),
        thumbs: [...new Set(items.map(el => el.querySelector('.thumb')).filter(Boolean).map(t => (t.getBoundingClientRect().height / t.getBoundingClientRect().width).toFixed(2)))],
        label: label.textContent, labelLines: label.getBoundingClientRect().height / lh,
        overflowX: th.scrollWidth - th.clientWidth, title: th.getAttribute('title') || ''
      };
    });
  });
}

test('static: long/spaceless/localized device labels do not widen columns beyond the preview (regression)', { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'va-review-long-device-'));
  writeBundle(dir, { round: 1, deviceOverrides: LONG_DEVICES });
  for (const viewport of [{ width: 1920, height: 1000 }, { width: 900, height: 900 }]) {
    const ctx = await browser.newContext({ viewport });
    const page = await newPage(ctx, pathToFileURL(join(dir, 'index.html')).href);
    const byZoom = {};
    for (const z of [0.5, 1, 2.5]) {
      await setZoom(page, z);
      const cols = byZoom[z] = await columnGeometry(page);
      assert.equal(cols.length, 3);
      for (const c of cols) {
        // th/td padding is 8px per side: the column is exactly as wide as its widest preview tile
        assert.ok(c.width <= c.content + 16 + 1, `${viewport.width}px zoom ${z}: column ${c.width}px for ${c.content}px preview (${c.label.slice(0, 24)}…)`);
        assert.ok(c.overflowX <= 1, 'header content stays inside its column');
        assert.ok(c.labelLines <= 3.05, 'label is clamped, not a tall ribbon');
        assert.ok(Object.values(LONG_DEVICES).some(d => d.label === c.label), 'full label kept in the DOM');
        const dev = Object.values(LONG_DEVICES).find(d => d.label === c.label);
        assert.ok(c.title.includes(dev.label) && c.title.includes(dev.platform), 'full label + platform in the header tooltip');
      }
      if (z === 1) assert.ok(cols[1].left < viewport.width, `second column visible at ${viewport.width}px (left ${cols[1].left})`);
      await shot(page, `01b-long-device-labels-${viewport.width}-z${z}`);
    }
    // slider still drives column size, and portrait/landscape keep their own aspect ratios
    assert.ok(byZoom[2.5][2].width > byZoom[1][2].width && byZoom[1][2].width >= byZoom[0.5][2].width);
    assert.notDeepEqual(byZoom[1][0].thumbs, byZoom[1][1].thumbs);
    // filters still work with the long labels; the full label is readable in the review view
    await setZoom(page, 1);
    await page.fill('#filter-text', 'WKWebView');
    await page.waitForFunction(() => document.querySelectorAll('#matrix-table thead th:not(.corner)').length === 2 && document.querySelectorAll('.tile:not(.filtered-out)').length === 8);
    await page.click('#btn-reset-filters');
    await openCell(page, C.emptyPhone);
    assert.equal(await page.textContent('#review .stage-head .dev'), LONG_DEVICES['phone-a'].label);
    const overflow = await page.evaluate(() => ['.stage', '.panel'].map(sel => { const s = document.querySelector(sel); return s.scrollWidth - s.clientWidth; }));
    assert.ok(overflow.every(x => x <= 1), `long label wraps in the review stage and panel (${overflow})`);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  }
});

test('static: filters by preset/facets and variant tabs', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await newPage(ctx, pathToFileURL(join(bundle, 'index.html')).href);
  const visible = () => page.locator('.tile:not(.filtered-out)').count();
  assert.equal(await visible(), 13);
  await page.click('.preset:has-text("AI 疑问/失败")');
  assert.equal(await visible(), 3);
  await page.click('.preset:has-text("缺证据/阻塞")');
  await page.waitForTimeout(200); // broken image detection
  assert.equal(await visible(), 5);
  await page.click('.preset:has-text("全部")');
  await page.check('#f-ai-fail');
  assert.equal(await visible(), 1);
  await page.uncheck('#f-ai-fail');
  await page.click('details[data-facet="kind"] > summary');
  await page.check('#f-kind-transition');
  assert.equal(await visible(), 2);
  await page.click('#btn-reset-filters');
  await page.click('.variant-tab:has-text("深色")');
  assert.equal(await visible(), 1);
  await page.fill('#filter-text', '平板');
  await page.click('#btn-reset-filters');
  assert.equal(await visible(), 13);
  await ctx.close();
});

test('static: frozen queue, required reasons, save-before-advance, back, filter change does not skip', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await newPage(ctx, pathToFileURL(join(bundle, 'index.html')).href);
  await page.click('#btn-start-queue');
  await page.waitForSelector('#review:not([hidden])');
  const ids = await app(page, () => Array.from(window.__vaReviewApp.queue.ids));
  assert.equal(ids.length, 13);
  assert.equal(await activeId(page), ids[0]);
  assert.equal(ids[0], C.emptyTablet, 'AI fail first');
  // needs-change without a reason: blocked, stays
  await page.keyboard.press('2');
  assert.match(await page.textContent('#comment-error'), /需修改/);
  assert.equal(await activeId(page), ids[0]);
  await page.fill('#comment', '平板上主按钮缺失');
  await page.click('.decision[data-decision="needs-change"]');
  await page.waitForFunction(x => window.__vaReviewApp.activeId === x, ids[1]);
  const stored = await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes(':draft:')).map(k => JSON.parse(localStorage.getItem(k))));
  assert.equal(stored.length, 1); assert.equal(stored[0].decision, 'needs-change'); assert.equal(stored[0].comment, '平板上主按钮缺失');
  // n/a requires reason
  await page.click('.decision[data-decision="not-applicable"]');
  assert.match(await page.textContent('#comment-error'), /不适用/);
  await page.fill('#comment', '此版本不做该能力');
  await page.keyboard.press('Escape'); // leave textarea
  await page.keyboard.press('4');
  await page.waitForFunction(x => window.__vaReviewApp.activeId === x, ids[2]);
  await shot(page, '02-static-review-queue');
  // back returns to previous item with its saved decision
  await page.click('#btn-prev');
  await page.waitForFunction(x => window.__vaReviewApp.activeId === x, ids[1]);
  assert.equal(await page.getAttribute('.decision[data-decision="not-applicable"]', 'aria-pressed'), 'true');
  assert.equal(await page.inputValue('#comment'), '此版本不做该能力');
  // go to matrix, change filters (decided items drop out of the view), continue: frozen snapshot resumes at ids[2]
  await page.keyboard.press('Escape');
  await page.waitForSelector('#review', { state: 'hidden' });
  await page.click('.preset:has-text("AI 疑问/失败")');
  assert.match(await page.textContent('#queue-info'), /筛选已改变/);
  await page.click('#btn-start-queue');
  await page.waitForFunction(x => window.__vaReviewApp.activeId === x, ids[2]);
  assert.deepEqual(await app(page, () => Array.from(window.__vaReviewApp.queue.ids)), ids, 'queue snapshot unchanged');
  // next/prev buttons walk the snapshot by ID
  await page.click('#btn-next');
  await page.waitForFunction(x => window.__vaReviewApp.activeId === x, ids[3]);
  // reload keeps the frozen queue (sessionStorage) and the hash route
  await page.reload();
  await page.waitForFunction(x => window.__vaReviewApp && window.__vaReviewApp.activeId === x, ids[3]);
  assert.deepEqual(await app(page, () => Array.from(window.__vaReviewApp.queue.ids)), ids);
  assert.deepEqual(page.errors, []);
  await ctx.close();
});

test('static: comment autosave status and recovery after reload', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await newPage(ctx, pathToFileURL(join(bundle, 'index.html')).href);
  await openCell(page, C.settingsPhone);
  await page.type('#comment', '标题字重偏细', { delay: 10 });
  assert.match(await page.textContent('#save-state'), /未保存|保存中|已保存/);
  await waitSaved(page);
  assert.match(await page.textContent('#save-state'), /仅此浏览器/);
  await page.reload();
  await page.waitForFunction(c => window.__vaReviewApp && window.__vaReviewApp.activeId === c, C.settingsPhone);
  assert.equal(await page.inputValue('#comment'), '标题字重偏细');
  // typing then navigating away immediately still persists (flush before navigation)
  await page.fill('#comment', '标题字重偏细，且间距过大');
  await page.click('#btn-back-matrix');
  await page.waitForSelector('#review', { state: 'hidden' });
  const d = await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes(':draft:')).map(k => JSON.parse(localStorage.getItem(k))));
  assert.equal(d[0].comment, '标题字重偏细，且间距过大');
  await ctx.close();
});

test('static: transition sequence, timeline, lightbox, and end-frame-only gap', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await newPage(ctx, pathToFileURL(join(bundle, 'index.html')).href);
  await openCell(page, C.seqPhone);
  assert.equal(await page.locator('.film').count(), 6);
  const trig = await page.textContent('.seq-trigger');
  assert.match(trig, /有商品/); assert.match(trig, /支付成功/); assert.match(trig, /点击“提交订单”/);
  assert.match(await page.textContent('.seq-timing'), /时长 640ms · 6 帧 · 帧间隔 80–240ms/);
  assert.match(await page.textContent('.filmstrip'), /起 \+0ms[\s\S]*止 \+640ms/);
  assert.equal(await page.locator('.timeline .act.trigger').count(), 1);
  assert.match(await page.textContent('#panel .assertions'), /状态 有商品[\s\S]*状态 支付成功/);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.match(await page.textContent('.seq-controls'), /帧 3\/6 · \+160ms/);
  await shot(page, '03-static-sequence');
  await page.keyboard.press('o');
  await page.waitForSelector('#lightbox[open]');
  await page.click('#lightbox button:has-text("100%")');
  const nat = await page.evaluate(() => { const i = document.querySelector('#lightbox img'); return [i.naturalWidth, i.getBoundingClientRect().width]; });
  assert.equal(nat[0], 1170); assert.ok(Math.abs(nat[1] - 1170) < 2, 'shown at 100%');
  await page.keyboard.press('ArrowRight');
  assert.match(await page.textContent('#lightbox .lb-bar'), /4\/6 · \+240ms/);
  await shot(page, '04-static-lightbox');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('lightbox').open);
  await page.click('#btn-back-matrix');
  await openCell(page, C.seqTablet);
  assert.match(await page.textContent('.seq-gap'), /过程证据不足/);
  assert.match(await page.textContent('.seq-gap'), /单张结束截图/);
  assert.match(await page.textContent('.seq-gap'), /只有 0 帧，需至少 3 帧/);
  assert.match(await page.textContent('.seq-gap'), /起始帧未绑定/);
  await shot(page, '05-static-transition-gap');
  await ctx.close();
});

test('static: missing/broken/blocked/orientation evidence shown honestly in review', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await newPage(ctx, pathToFileURL(join(bundle, 'index.html')).href);
  await openCell(page, C.emptyLand);
  assert.match(await page.textContent('#stage'), /缺证据：此格尚未采集/);
  await page.click('#btn-back-matrix');
  await openCell(page, C.filledLand);
  assert.match(await page.textContent('#stage'), /Device Hub 无法把该模拟器切换到横屏/);
  await page.click('#btn-back-matrix');
  await openCell(page, C.filledTablet);
  await page.waitForFunction(() => /图片无法加载/.test(document.getElementById('stage').textContent));
  await page.click('#btn-back-matrix');
  await openCell(page, id('checkout', 'pay-success', 'tablet-b', 'portrait'));
  assert.match(await page.textContent('#stage'), /方向不符/);
  await ctx.close();
});

test('static: AI and human opinions are separate; old versions labelled; new evidence never rebinds a draft', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await newPage(ctx, pathToFileURL(join(bundle, 'index.html')).href);
  await openCell(page, C.filledPhone);
  const panel = await page.textContent('#panel');
  assert.match(panel, /AI 疑问/); assert.match(panel, /已失效的 AI 意见（1）/);
  assert.match(panel, /其他版本上的人工意见/); assert.match(panel, /金额里的 O 应为数字 0/);
  assert.match(await page.textContent('.binding'), /证据 v2/);
  await page.fill('#comment', '运费是否包含需要产品确认');
  await waitSaved(page);
  const v2 = await app(page, () => window.__vaReviewApp.boundCaptureId);
  // new evidence arrives (round 2 adds v3 + fresh AI) while this comment is open
  await page.setInputFiles('#data-file', round2);
  await page.waitForSelector('.newer-box');
  assert.match(await page.textContent('.newer-box'), /此格有更新的证据 v3/);
  assert.equal(await page.inputValue('#comment'), '运费是否包含需要产品确认');
  assert.equal(await app(page, () => window.__vaReviewApp.boundCaptureId), v2, 'editor stays bound to v2');
  assert.match(await page.textContent('#notices'), /已加载新证据/);
  await shot(page, '06-static-new-evidence');
  await page.click('.newer-box .btn-primary');
  await page.waitForFunction(() => /证据 v3/.test(document.querySelector('.binding').textContent));
  assert.equal(await page.inputValue('#comment'), '', 'new version starts without a decision or comment');
  assert.match(await page.textContent('#panel'), /AI 通过/);
  const drafts = await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes(':draft:')).map(k => JSON.parse(localStorage.getItem(k))));
  assert.equal(drafts.length, 1); assert.equal(drafts[0].captureId, v2); assert.equal(drafts[0].comment, '运费是否包含需要产品确认');
  assert.match(await page.textContent('#panel'), /旧版 v2/);
  await ctx.close();
});

test('static: two tabs editing the same opinion report a version conflict', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const url = pathToFileURL(join(bundle, 'index.html')).href;
  const a = await newPage(ctx, url), b = await newPage(ctx, url);
  await openCell(a, C.emptyPhone); await openCell(b, C.emptyPhone);
  // B is idle: A's saved edit is live-synced into B (no silent overwrite later)
  await a.fill('#comment', 'A 写的');
  await waitSaved(a);
  await b.waitForFunction(() => document.getElementById('comment').value === 'A 写的');
  // B is mid-edit (unsaved) when A saves again → explicit conflict, nothing overwritten
  await b.fill('#comment', 'B 同时写的');
  await a.fill('#comment', 'A 又改了'); await a.keyboard.press('Escape');
  await b.waitForSelector('.conflict-box');
  assert.match(await b.textContent('.conflict-box'), /A 又改了/);
  assert.equal(await b.inputValue('#comment'), 'B 同时写的', 'unsaved text is kept during a conflict');
  await shot(b, '07-static-conflict');
  await b.click('.conflict-box button:has-text("保留我的并覆盖")');
  await waitSaved(b);
  const d = await b.evaluate(() => Object.keys(localStorage).filter(k => k.includes(':draft:')).map(k => JSON.parse(localStorage.getItem(k))));
  assert.equal(d[0].comment, 'B 同时写的');
  await ctx.close();
});

test('static: copy falls back to a selected text box when clipboard is refused', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await newPage(ctx, pathToFileURL(join(bundle, 'index.html')).href);
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); });
  await page.fill('#reviewer', 'UI 测试');
  await openCell(page, C.emptyTablet);
  await page.fill('#comment', '按钮缺失');
  await page.keyboard.press('Escape');
  await page.keyboard.press('2');
  await page.click('#btn-back-matrix');
  await page.click('#btn-copy');
  await page.waitForSelector('#text-dialog[open] textarea');
  const sel = await page.evaluate(() => { const t = document.querySelector('#text-dialog textarea'); return { all: t.selectionStart === 0 && t.selectionEnd === t.value.length, text: t.value, focused: document.activeElement === t }; });
  assert.ok(sel.all && sel.focused);
  for (const s of ['review-ui-fixture', 'cell: ' + C.emptyTablet, 'device: Tablet B (fixture)', 'build build-1', 'spec spec-1', 'image: s3', '[需修改]', '按钮缺失', '审核人: UI 测试']) assert.ok(sel.text.includes(s), s);
  assert.match(await page.textContent('#text-dialog'), /拒绝了剪贴板访问/);
  await shot(page, '08-static-copy-fallback');
  await ctx.close();
});

test('static: export, import into a fresh browser, conflicts and located errors', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const url = pathToFileURL(join(bundle, 'index.html')).href;
  const page = await newPage(ctx, url);
  await page.fill('#reviewer', 'UI 测试');
  await openCell(page, C.emptyTablet);
  await page.fill('#comment', '按钮缺失'); await page.keyboard.press('Escape'); await page.keyboard.press('2');
  await page.waitForFunction(() => window.__vaReviewApp.activeId !== null);
  await page.click('#btn-back-matrix');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
  const file = join(mkdtempSync(join(tmpdir(), 'va-exp-')), 'export.json');
  await dl.saveAs(file);
  const ex = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(ex.schemaVersion, 1); assert.equal(ex.projectId, 'review-ui-fixture'); assert.equal(ex.kind, 'visual-acceptance-human-feedback');
  assert.equal(ex.edits.length, 1); assert.equal(ex.edits[0].verdict, 'fail'); assert.equal(ex.edits[0].reviewer, 'UI 测试');
  assert.match(ex.storageScope, /^browser-local file:/);
  // fresh browser profile imports it
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await newPage(ctx2, url);
  await p2.setInputFiles('#import-file', file);
  await p2.waitForSelector('#import-dialog[open]');
  assert.match(await p2.textContent('#import-dialog'), /新增 1 · 相同 0 · 冲突 0 · 错误 0/);
  await p2.click('#import-dialog button:has-text("导入所选")');
  await p2.waitForFunction(c => /需修改/.test(document.querySelector(`.tile[data-cell="${c}"]`).textContent), C.emptyTablet);
  // conflicting import keeps local by default
  const changed = { ...ex, drafts: ex.drafts.map(d => ({ ...d, comment: '另一个说法' })) };
  const f2 = file.replace('export.json', 'changed.json'); writeFileSync(f2, JSON.stringify(changed));
  await page.setInputFiles('#import-file', f2);
  await page.waitForSelector('#import-dialog[open] li.conflict');
  await shot(page, '09-static-import-conflict');
  await page.click('#import-dialog button:has-text("取消")');
  // version + location errors
  const bad = { ...ex, schemaVersion: 2 }; const f3 = file.replace('export.json', 'bad.json'); writeFileSync(f3, JSON.stringify(bad));
  await page.setInputFiles('#import-file', f3);
  await page.waitForSelector('#import-dialog[open]');
  assert.match(await page.textContent('#import-dialog'), /无法导入[\s\S]*schemaVersion 不匹配/);
  await page.click('#import-dialog footer button');
  const badCell = { ...ex, drafts: [{ ...ex.drafts[0], cellId: 'cell-unknown' }] }; writeFileSync(f3, JSON.stringify(badCell));
  await page.setInputFiles('#import-file', f3);
  await page.waitForSelector('#import-dialog[open] li.err');
  assert.match(await page.textContent('#import-dialog li.err'), /drafts\[0\]\.cellId 未知格子/);
    // Cross-project opinions cannot enter this project's local drafts.
    const otherProject = { ...ex, projectId: 'another-project' }; writeFileSync(f3, JSON.stringify(otherProject));
    await page.click('#import-dialog footer button');
    await page.setInputFiles('#import-file', f3);
    await page.waitForSelector('#import-dialog[open]');
    assert.match(await page.textContent('#import-dialog'), /projectId|项目/);
    await ctx.close(); await ctx2.close();
});

test('static: submit explains no live Pi and offers batch JSON', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await newPage(ctx, pathToFileURL(join(bundle, 'index.html')).href);
  await page.fill('#reviewer', 'UI 测试');
  await openCell(page, C.settingsPhone); await page.keyboard.press('1');
  await page.click('#btn-back-matrix');
  assert.equal(await page.textContent('#submit-count'), '1');
  await page.click('#btn-submit');
  await page.waitForSelector('#submit-dialog[open]');
  assert.match(await page.textContent('#submit-dialog'), /静态包不能直接通知 Pi/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#submit-dialog button:has-text("下载批次 JSON")')]);
  const b = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  assert.equal(b.edits.length, 1); assert.match(b.sourceId, /^static-/);
  await shot(page, '10-static-submit');
  await ctx.close();
});

test('static: keyboard reachability (tab to tiles, arrows, enter, digits, escape, help)', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await newPage(ctx, pathToFileURL(join(bundle, 'index.html')).href);
  let found = false;
  for (let i = 0; i < 120 && !found; i++) { await page.keyboard.press('Tab'); found = await page.evaluate(() => document.activeElement.classList.contains('tile')); }
  assert.ok(found, 'a tile is reachable with Tab');
  const first = await page.evaluate(() => document.activeElement.dataset.cell);
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await page.evaluate(() => document.activeElement.dataset.cell), first);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#review:not([hidden])');
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains('decision')), 'focus moves to decision buttons');
  await page.keyboard.press('c');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'comment');
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await page.waitForSelector('#help-dialog[open]');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#review', { state: 'hidden' });
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains('tile')), 'focus returns to the tile');
  await ctx.close();
});

test('mock server: server saves, failure blocks the queue, poll brings new evidence, batch retry reuses ID', { skip }, async () => {
  const srv = await startMockServer(bundle);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('visual-acceptance:review:poll-ms', '600'));
  try {
    const page = await newPage(ctx, srv.url + '/');
    assert.match(await page.textContent('#storage-badge'), /本地服务保存/);
    await page.click('#btn-start-queue');
    await page.waitForSelector('#review:not([hidden])');
    const ids = await app(page, () => Array.from(window.__vaReviewApp.queue.ids));
    // server down: decision must not advance
    srv.ctl.failDrafts = true;
    await page.fill('#comment', '按钮缺失'); await page.keyboard.press('Escape');
    await page.keyboard.press('2');
    await page.waitForFunction(() => /保存失败/.test(document.getElementById('save-state').textContent));
    assert.equal(await activeId(page), ids[0], 'queue stays when server save fails');
    assert.match(await page.textContent('#global-save'), /保存失败/);
    await shot(page, '11-server-save-failed');
    srv.ctl.failDrafts = false;
    await page.click('button:has-text("重试保存")');
    await waitSaved(page);
    assert.match(await page.textContent('#save-state'), /本地服务/);
    await page.keyboard.press('2');
    await page.waitForFunction(x => window.__vaReviewApp.activeId === x, ids[1]);
    const e0 = srv.ctl.drafts.edits.find(e => e.cellId === ids[0]);
    assert.equal(e0.verdict, 'fail'); assert.equal(e0.decision, 'needs-change'); assert.equal(e0.reviewer, 'reviewer-not-set');
    assert.deepEqual(srv.ctl.rejected, [], 'drafts satisfy core draft validation');
    // undecided comment-only draft is stored server-side as an undecided edit
    await page.goto(srv.url + '/#cell=' + C.filledPhone);
    await page.waitForFunction(c => window.__vaReviewApp && window.__vaReviewApp.activeId === c, C.filledPhone);
    await page.fill('#comment', '运费说明？');
    await waitSaved(page);
    const undec = srv.ctl.drafts.edits.find(e => e.cellId === C.filledPhone);
    assert.equal(undec.undecided, true); assert.equal(undec.verdict, 'question');
    const v2 = undec.captureId;
    // new evidence via polling
    srv.ctl.round = 2;
    await page.waitForSelector('.newer-box', { timeout: 5000 });
    assert.equal(await page.inputValue('#comment'), '运费说明？');
    assert.equal(srv.ctl.drafts.edits.find(e => e.cellId === C.filledPhone).captureId, v2, 'server draft keeps its original capture');
    await shot(page, '12-server-new-evidence');
    // submit: first attempt fails, retry reuses the same batch ID and content
    await page.fill('#reviewer', 'UI 测试');
    await page.keyboard.press('Escape');
    await page.click('#btn-back-matrix');
    srv.ctl.failNextFeedback = 1;
    await page.click('#btn-submit');
    await page.click('#btn-send-batch');
    await page.waitForSelector('#submit-result .notice.error');
    await page.click('#submit-dialog button:has-text("取消")');
    await page.click('#btn-submit');
    await page.click('#btn-retry-batch');
    await page.waitForSelector('#submit-result .notice.info');
    assert.equal(srv.ctl.feedbackAttempts.length, 2);
    assert.equal(srv.ctl.feedbackAttempts[0].batchId, srv.ctl.feedbackAttempts[1].batchId);
    assert.equal(JSON.stringify(srv.ctl.feedbackAttempts[0]), JSON.stringify(srv.ctl.feedbackAttempts[1]));
    assert.equal(srv.ctl.feedbackAttempts[0].edits.length, 1);
    assert.match(await page.textContent('#submit-result'), /已送达 Pi 会话/);
    await shot(page, '13-server-submitted');
    await page.click('#submit-dialog button:has-text("取消")');
    assert.equal(await page.textContent('#submit-count'), '0');

    // accepted but Pi dispatch failed (HTTP 503 pending): opinions saved, retry pending — not "lost", not "delivered"
    await page.goto(srv.url + '/#cell=' + C.settingsPhone);
    await page.waitForFunction(c => window.__vaReviewApp && window.__vaReviewApp.activeId === c, C.settingsPhone);
    await page.keyboard.press('1');
    await page.waitForFunction(() => document.getElementById('submit-count').textContent === '1');
    await page.click('#btn-back-matrix');
    srv.ctl.dispatchFailNext = 1;
    await page.click('#btn-submit'); await page.click('#btn-send-batch');
    await page.waitForSelector('#submit-result .notice.warn');
    assert.match(await page.textContent('#submit-result'), /意见已保存，回 Pi 待重试/);
    await page.click('#submit-dialog button:has-text("取消")');
    assert.equal(await page.textContent('#submit-count'), '0', 'persisted opinions are not re-submitted as new');
    assert.match(await page.textContent('#notices'), /意见已保存，回 Pi 待重试/);
    await shot(page, '14-server-dispatch-pending');
    // server restarts (new token + sourceId): retry refreshes the token and resends the EXACT original body
    const firstBody = JSON.stringify(srv.ctl.feedbackAttempts.at(-1));
    srv.ctl.restart();
    await page.click('[data-notice="dispatch"] button:has-text("重试回传 Pi")');
    await page.click('#btn-retry-batch');
    await page.waitForSelector('#submit-result .notice.info');
    assert.match(await page.textContent('#submit-result'), /服务器已有此批次[\s\S]*已送达 Pi 会话/);
    assert.equal(JSON.stringify(srv.ctl.feedbackAttempts.at(-1)), firstBody, 'original batch body (incl. old sourceId) reused');
    assert.ok(srv.ctl.forbidden >= 1, 'stale token was refreshed via /api/session');
    await page.click('#submit-dialog button:has-text("取消")');
    assert.equal(await page.locator('[data-notice="dispatch"]').count(), 0);
    // drafts keep saving after the restart (new sourceId used for drafts)
    await page.goto(srv.url + '/#cell=' + C.emptyPhone);
    await page.waitForFunction(c => window.__vaReviewApp && window.__vaReviewApp.activeId === c, C.emptyPhone);
    await page.fill('#comment', '重启后仍可保存');
    await waitSaved(page);
    assert.equal(srv.ctl.drafts.sourceId, srv.sourceId);
    assert.deepEqual(page.errors, []);
  } finally { await ctx.close(); await srv.close(); }
});

const CORE = process.env.VA_CORE_ROOT, STORE = process.env.VA_CORE_STORE;
test('core integration: real core server + copy of a real store (automated UI test feedback only)', { skip: skip || (!CORE || !STORE ? 'set VA_CORE_ROOT and VA_CORE_STORE' : false) }, async () => {
  const copy = join(mkdtempSync(join(tmpdir(), 'va-core-store-')), 'store');
  cpSync(STORE, copy, { recursive: true });
  const { EvidenceStore } = await import(pathToFileURL(join(CORE, 'scripts/lib/store.mjs')));
  const { startReviewServer } = await import(pathToFileURL(join(CORE, 'scripts/lib/server.mjs')));
  const store = new EvidenceStore(copy);
  const data = await store.reviewData();
  const srv = await startReviewServer(store, { port: 0, reviewDir: REVIEW_DIR });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await newPage(ctx, srv.url + '/');
    assert.equal(await page.locator('.tile').count(), data.cells.length);
    assert.match(await page.textContent('#storage-badge'), /本地服务保存/);
    // every captured tile image actually decodes from core's /evidence route
    await page.click('.preset:has-text("全部")');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.tile img')).every(i => i.complete));
    const imgs = await page.evaluate(() => Array.from(document.querySelectorAll('.tile img')).map(i => i.naturalWidth));
    assert.ok(imgs.length > 0 && imgs.every(w => w > 0), 'real evidence images load: ' + imgs);
    assert.equal(await page.locator('.tile .chip.fixture').count(), 0, 'real-app evidence is not labelled fixture');
    // AI that core marks stale (e.g. pre-upgrade reviewProtocol) never shows as a current verdict
    const staleCells = data.cells.filter(c => c.aiReviews.length && !c.currentAIReview).length;
    assert.equal(await page.locator('.tile .chip.ai-stale').count() >= staleCells, true);
    assert.equal(await page.locator('.tile .chip.ai-pass').count(), data.cells.filter(c => c.currentAIReview?.verdict === 'pass').length);
    await shot(page, '20-core-real-matrix');
    const withHistory = data.cells.find(c => c.captures.length > 1) || data.cells[0];
    await openCell(page, withHistory.id);
    await shot(page, '21-core-real-review');
    if (withHistory.aiReviews.some(r => r.stale)) assert.match(await page.textContent('#panel'), /已失效的 AI 意见/);
    await page.fill('#reviewer', 'review-ui-browser-test');
    await page.fill('#comment', '自动化 UI 测试写入的评论草稿（非真人验收）');
    await waitSaved(page);
    const drafts = JSON.parse(readFileSync(join(copy, 'drafts.json'), 'utf8'));
    assert.equal(drafts.edits.length, 1); assert.equal(drafts.edits[0].undecided, true);
    await page.keyboard.press('Escape');
    await page.keyboard.press('3');
    // A successful decision advances the frozen queue, so the NEW cell's save
    // label is intentionally empty. Wait on the original draft and busy flag.
    await page.waitForFunction(key => window.__vaReviewApp.saveStates.get(key)?.status === 'saved' && !window.__vaReviewApp.busy, withHistory.id + '@' + withHistory.capture.id);
    await page.click('#btn-back-matrix');
    await page.click('#btn-submit');
    await page.click('#btn-send-batch');
    await page.waitForSelector('#submit-result .notice', { timeout: 10000 });
    const resText = await page.textContent('#submit-result');
    assert.match(resText, /已提交/, resText);
    const after = await store.reviewData();
    const hr = after.cells.find(c => c.id === withHistory.id).humanReviews;
    assert.equal(hr.length, 1); assert.equal(hr[0].decision, 'blocked'); assert.equal(hr[0].verdict, 'question'); assert.equal(hr[0].reviewer, 'review-ui-browser-test');
    await shot(page, '22-core-real-submitted');
    assert.deepEqual(page.errors, []);
  } finally { await ctx.close(); await srv.close(); }
});

test('core integration: HTTP503 accepted/pending survives browser reload and real server restart with exact original batch', { skip: skip || (!CORE || !STORE ? 'set VA_CORE_ROOT and VA_CORE_STORE' : false) }, async () => {
  const copy = join(mkdtempSync(join(tmpdir(), 'va-core-retry-')), 'store');
  cpSync(STORE, copy, { recursive: true });
  const { EvidenceStore } = await import(pathToFileURL(join(CORE, 'scripts/lib/store.mjs')));
  const { startReviewServer } = await import(pathToFileURL(join(CORE, 'scripts/lib/server.mjs')));
  const store = new EvidenceStore(copy), data = await store.reviewData(), cell = data.cells.find(c => c.capture);
  const attempts = [];
  let srv = await startReviewServer(store, { onFeedback: async batch => { attempts.push(JSON.stringify(batch)); throw new Error('Automated dispatch fault injection; feedback is already persisted'); } });
  const ctx = await browser.newContext();
  try {
    const page = await newPage(ctx, srv.url + '/');
    await page.fill('#reviewer', 'review-ui-browser-test');
    await openCell(page, cell.id);
    await page.fill('#comment', 'Automated restart recovery test; origin=review-ui-browser-test; not human acceptance.');
    await page.click('.decision[data-decision="blocked"]');
    await page.waitForFunction(key => window.__vaReviewApp.saveStates.get(key)?.status === 'saved' && !window.__vaReviewApp.busy, cell.id + '@' + cell.capture.id);
    await page.click('#btn-back-matrix'); await page.click('#btn-submit'); await page.click('#btn-send-batch');
    await page.waitForSelector('#submit-result .notice.warn');
    assert.match(await page.textContent('#submit-result'), /意见已保存，回 Pi 待重试/);
    assert.equal(attempts.length, 1);
    const url = srv.url, port = Number(new URL(url).port), oldSource = JSON.parse(attempts[0]).sourceId;
    await srv.close();
    srv = await startReviewServer(store, { port, onFeedback: async batch => { attempts.push(JSON.stringify(batch)); return { state: 'not-connected' }; } });
    assert.notEqual(srv.sourceId, oldSource);
    // Fresh auth comes from the restarted real server. The pending body's old
    // source, ID and edits survive both page and server restarts unchanged.
    await page.reload(); await page.waitForSelector('[data-notice="dispatch"]');
    await page.click('[data-notice="dispatch"] button'); await page.click('#btn-retry-batch');
    await page.waitForFunction(() => /服务器已有此批次/.test(document.getElementById('submit-result').textContent));
    assert.equal(attempts.length, 2); assert.equal(attempts[0], attempts[1]);
    assert.match(await page.textContent('#submit-result'), /没有连接 Pi 会话/);
    assert.equal((await store.reviewData()).cells.find(c => c.id === cell.id).humanReviews.length, 1);
    await shot(page, '23-core-restarted-original-batch');
    assert.deepEqual(page.errors, []);
  } finally { await ctx.close(); await srv.close(); }
});

const REAL = process.env.VA_REAL_BUNDLE;
test('real bundle (static export of real app evidence): matrix, sequence/video, no fixture labels', { skip: skip || (!REAL ? 'set VA_REAL_BUNDLE to an exported review directory' : false) }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'va-real-bundle-'));
  for (const f of ['review.json', 'review-data.js']) cpSync(join(REAL, f), join(dir, f));
  cpSync(join(REAL, 'evidence'), join(dir, 'evidence'), { recursive: true });
  for (const f of JSON.parse(readFileSync(join(REVIEW_DIR, 'ui-files.json'), 'utf8')).files) cpSync(join(REVIEW_DIR, f), join(dir, f));
  const data = JSON.parse(readFileSync(join(dir, 'review.json'), 'utf8'));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await newPage(ctx, pathToFileURL(join(dir, 'index.html')).href);
    assert.equal(await page.locator('.tile').count(), data.cells.length);
    assert.equal(await page.locator('.tile .chip.fixture').count(), 0);
    assert.doesNotMatch(await page.textContent('#notices'), /FIXTURE/);
    await page.click('.preset:has-text("全部")');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.tile img')).every(i => i.complete));
    const imgs = await page.evaluate(() => Array.from(document.querySelectorAll('.tile img')).map(i => i.naturalWidth));
    assert.ok(imgs.length > 0 && imgs.every(w => w > 0), 'all tile images decode: ' + imgs);
    await shot(page, '30-real-bundle-matrix');
    const head = await page.textContent('#matrix-table thead');
    for (const d of data.spec.devices) assert.ok(head.includes(d.label), d.label);
    const seq = data.cells.find(c => c.capture && c.capture.assets.some(a => a.kind === 'frame'));
    if (seq) {
      await openCell(page, seq.id);
      const frames = seq.capture.assets.filter(a => a.kind === 'frame').length;
      assert.equal(await page.locator('.film').count(), frames);
      const vids = seq.capture.assets.filter(a => a.kind === 'video').length;
      assert.equal(await page.locator('video.evidence-video').count(), vids);
      if (vids) await page.waitForFunction(() => { const v = document.querySelector('video.evidence-video'); return v && v.readyState >= 1 && v.duration > 0; }, null, { timeout: 10000 });
      assert.match(await page.textContent('.seq-trigger'), /→/);
      await shot(page, '31-real-bundle-transition');
      await page.click('#btn-back-matrix');
    }
    const hist = data.cells.find(c => c.captures.length > 1);
    if (hist) {
      await openCell(page, hist.id);
      assert.match(await page.textContent('#panel'), /已失效的 AI 意见/);
      await shot(page, '32-real-bundle-history');
    }
    assert.deepEqual(page.errors, []);
  } finally { await ctx.close(); }
});
