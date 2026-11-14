// Review-UI FIXTURE data. These SVG "screens" are synthetic drawings used only to
// exercise the review page. They are NOT app evidence: every capture carries
// provenance.source = "review-ui-fixture" and every image is stamped FIXTURE.
// Never use this data or its screenshots to claim an app was accepted.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REVIEW_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const UI_FILES = JSON.parse(readFileSync(join(REVIEW_DIR, 'ui-files.json'), 'utf8')).files;

const sha = s => createHash('sha256').update(s).digest('hex');
// Same tuple hashing as core contracts.mjs cellIdFor (canonical array JSON).
export const cellIdFor = c => `cell-${sha(JSON.stringify([c.scenarioId, c.stateId, c.deviceId, c.orientation, c.variantId])).slice(0, 24)}`;

const T0 = Date.parse('2026-11-14T10:00:00.000Z');
const iso = ms => new Date(T0 + ms).toISOString();

function svg({ w, h, title, sub, theme = 'light', sheet = null, tag = '' }) {
  const bg = theme === 'dark' ? '#16181d' : '#f6f7f9', fg = theme === 'dark' ? '#e6e8ec' : '#1c2230', card = theme === 'dark' ? '#23262e' : '#ffffff';
  const u = Math.min(w, h) / 100;
  const sheetEl = sheet === null ? '' : `<rect x="0" y="${Math.round(h * sheet)}" width="${w}" height="${h}" rx="${u * 4}" fill="#2d5be3" opacity="0.92"/><text x="${w / 2}" y="${Math.round(h * sheet) + u * 10}" font-size="${u * 5}" text-anchor="middle" fill="#fff" font-family="sans-serif">Sheet ${Math.round((1 - sheet) * 100)}%</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="${bg}"/>
<rect x="${u * 4}" y="${u * 4}" width="${w - u * 8}" height="${u * 10}" rx="${u * 2}" fill="${card}"/>
<text x="${u * 8}" y="${u * 11}" font-size="${u * 4.5}" fill="${fg}" font-family="sans-serif">${title}</text>
<rect x="${u * 4}" y="${u * 18}" width="${w - u * 8}" height="${h * 0.3}" rx="${u * 3}" fill="${card}"/>
<text x="${u * 8}" y="${u * 28}" font-size="${u * 4}" fill="${fg}" font-family="sans-serif">${sub}</text>
<rect x="${u * 4}" y="${h - u * 18}" width="${w - u * 8}" height="${u * 12}" rx="${u * 6}" fill="#1d8049"/>
${sheetEl}
<g transform="translate(${w / 2} ${h / 2}) rotate(-28)"><text font-size="${u * 7}" text-anchor="middle" fill="#b5179e" opacity="0.55" font-family="sans-serif" font-weight="700">FIXTURE · NOT APP EVIDENCE</text>
<text y="${u * 9}" font-size="${u * 4}" text-anchor="middle" fill="#b5179e" opacity="0.55" font-family="sans-serif">review-UI test ${tag}</text></g>
</svg>`;
}

/** Build fixture view model (contract GET /api/review shape) + evidence files. */
export function buildFixture({ round = 1 } = {}) {
  const files = new Map();
  function asset(id, kind, opts, extra = {}) {
    const body = svg(opts);
    const hash = sha(body);
    const path = `evidence/${hash}.svg`;
    files.set(path, body);
    return { id, kind, path, sha256: hash, mimeType: 'image/svg+xml', width: opts.w, height: opts.h, capturedAt: iso(extra.at || 0), ...extra.fields };
  }
  const project = { id: 'review-ui-fixture', name: 'Review UI fixture (NOT app evidence)' };
  const spec = {
    revision: 'spec-1',
    scenarios: [{ id: 'checkout', label: '结账' }, { id: 'settings', label: '设置' }],
    states: [
      { id: 'cart-empty', label: '空购物车', kind: 'state', entry: 'app://cart (冷启动，清空购物车)' },
      { id: 'cart-filled', label: '有商品', kind: 'state', entry: 'app://cart?fixture=two-items' },
      { id: 'pay-success', label: '支付成功', kind: 'state' },
      { id: 'submit-order', label: '提交订单', kind: 'transition', fromStateId: 'cart-filled', toStateId: 'pay-success' },
      { id: 'settings-main', label: '设置首页', kind: 'state', entry: 'Tab: 我的 → 设置' }
    ],
    devices: [
      { id: 'phone-a', label: 'Phone A (fixture)', platform: 'ios' },
      { id: 'tablet-b', label: 'Tablet B (fixture)', platform: 'android', screen: { width: 1600, height: 2560 } }
    ],
    variants: [
      { id: 'default', label: '默认', language: 'zh-Hans', theme: 'light', fontScale: 1 },
      { id: 'dark', label: '深色', language: 'zh-Hans', theme: 'dark', fontScale: 1 }
    ],
    cells: []
  };
  const target = { buildId: 'build-1', runtimeId: 'runtime-1', specRev: 'spec-1' };
  const PH = { w: 1170, h: 2532 }, PL = { w: 2532, h: 1170 }, TB = { w: 1600, h: 2560 };
  const prov = { adapter: 'review-ui-fixture', adapterVersion: '1', deviceId: 'fixture-device', deviceKind: 'simulator', source: 'review-ui-fixture', fixtureDescription: 'Synthetic SVG for review-UI tests only; not produced by any app' };
  const cells = [];
  let capN = 0;
  function capture(cellId, { status = 'captured', assets = [], actions = [], assertions = [], blockers = [], limitations = [], transition, at = 0, build = target } = {}) {
    capN++;
    const tag = assets[0] ? assets[0].id : status + '-' + cellId.slice(5, 13);
    return { id: `capture-fx-${tag}-${build.buildId}`, cellId, sourceSnapshotId: 'source-fixture', buildId: build.buildId, runtimeId: build.runtimeId, specRev: 'spec-1', createdAt: iso(at), status, assets, actions, assertions, provenance: prov, limitations, blockers, ...(transition ? { transition } : {}) };
  }
  function ai(cap, verdict, comment, visibleText, stale = false, reasons = []) {
    return { id: `ai-${cap.id}-${verdict}`, cellId: cap.cellId, captureId: cap.id, buildId: cap.buildId, runtimeId: cap.runtimeId, specRev: cap.specRev, policyRev: 'policy-1', createdAt: iso(60000), verdict, comment, visibleText, observations: cap.assets.filter(a => a.kind !== 'video').map(a => ({ assetId: a.id, sha256: a.sha256, detail: 'fixture observation of ' + a.id })), receiptIds: [], reviewer: { provider: 'fixture', model: 'none' }, stale, staleReasons: reasons };
  }
  function cell(scenarioId, stateId, deviceId, orientation, variantId, checkpoints, build) {
    const c = { scenarioId, stateId, deviceId, orientation, variantId, checkpoints };
    c.id = cellIdFor(c); spec.cells.push({ ...c });
    const full = { ...c, status: 'unreviewed', staleReasons: [], capture: null, captures: [], aiReviews: [], humanReviews: [], currentAIReview: null, currentHumanReview: null };
    build(full);
    if (full.capture && !full.captures.includes(full.capture)) full.captures.push(full.capture);
    full.blockers = full.capture ? [...full.capture.blockers] : [];
    full.status = !full.capture ? 'missing' : full.capture.status === 'blocked' ? 'blocked' : full.currentAIReview ? full.currentAIReview.verdict : 'unreviewed';
    cells.push(full);
    return full;
  }
  const scr = (tag, size, title, sub, theme) => asset(tag, 'screenshot', { ...size, title, sub, theme, tag });

  // 1 cart-empty × phone portrait: AI pass
  cell('checkout', 'cart-empty', 'phone-a', 'portrait', 'default', ['显示“购物车是空的”', '主按钮“去逛逛”可见'], c => {
    c.capture = capture(c.id, { assets: [scr('s1', PH, '购物车', '购物车是空的')], assertions: [{ description: '空状态文字可见', result: 'pass', basis: 'accessibility', evidenceAssetIds: ['s1'] }] });
    c.aiReviews = [ai(c.capture, 'pass', '空状态文案与按钮均可见，布局无截断。', ['购物车', '购物车是空的'])]; c.currentAIReview = c.aiReviews[0];
  });
  // 2 cart-empty × phone landscape: missing
  cell('checkout', 'cart-empty', 'phone-a', 'landscape', 'default', ['横屏下空状态居中'], () => {});
  // 3 cart-empty × tablet: AI fail
  cell('checkout', 'cart-empty', 'tablet-b', 'portrait', 'default', ['显示“购物车是空的”', '主按钮“去逛逛”可见'], c => {
    c.capture = capture(c.id, { assets: [scr('s3', TB, '购物车', '（按钮缺失）')] });
    c.aiReviews = [ai(c.capture, 'fail', '主按钮“去逛逛”在平板上不可见；画面底部只有绿色色块，没有文字。', ['购物车', '（按钮缺失）'])]; c.currentAIReview = c.aiReviews[0];
  });
  // 4 cart-filled × phone portrait: v1 (old AI pass, old human) → v2 current AI question (round 2 adds v3)
  cell('checkout', 'cart-filled', 'phone-a', 'portrait', 'default', ['两件商品与合计金额', '“提交订单”按钮可点'], c => {
    const v1 = capture(c.id, { assets: [scr('s4a', PH, '购物车 (2)', '合计 ¥ 1O0')], at: -86400000, build: { buildId: 'build-0', runtimeId: 'runtime-0' } });
    const v2 = capture(c.id, { assets: [scr('s4b', PH, '购物车 (2)', '合计 ¥ 100.00')], at: 0 });
    c.captures = [v1, v2]; c.capture = v2;
    const old = ai(v1, 'pass', '合计金额可见。', ['购物车 (2)', '合计 ¥ 1O0'], true, ['capture changed or missing', 'buildId changed']);
    const cur = ai(v2, 'question', '合计金额显示 ¥ 100.00，但 checkpoint 未说明是否应含运费，请人工确认。', ['购物车 (2)', '合计 ¥ 100.00']);
    c.aiReviews = [old, cur]; c.currentAIReview = cur;
    c.humanReviews = [{ id: 'human-fx-1', batchId: 'batch-old-1', cellId: c.id, captureId: v1.id, buildId: v1.buildId, runtimeId: v1.runtimeId, specRev: 'spec-1', verdict: 'fail', decision: 'needs-change', comment: '[需修改] 金额里的 O 应为数字 0', humanComment: '金额里的 O 应为数字 0', reviewer: 'fixture-reviewer', createdAt: iso(-80000000), stale: true, staleReasons: ['capture changed or missing'] }];
    if (round >= 2) {
      const v3 = capture(c.id, { assets: [scr('s4c', PH, '购物车 (2)', '合计 ¥ 100.00 含运费')], at: 3600000 });
      c.captures.push(v3); c.capture = v3; c.currentAIReview = null;
      c.aiReviews.forEach(r => { r.stale = true; r.staleReasons = ['capture changed or missing']; });
      c.aiReviews.push(ai(v3, 'pass', '合计金额旁已显示“含运费”。', ['合计 ¥ 100.00 含运费'])); c.currentAIReview = c.aiReviews[c.aiReviews.length - 1];
    }
  });
  // 5 cart-filled × phone landscape: blocked capture
  cell('checkout', 'cart-filled', 'phone-a', 'landscape', 'default', ['横屏两列布局'], c => {
    c.capture = capture(c.id, { status: 'blocked', blockers: ['Device Hub 无法把该模拟器切换到横屏（fixture 描述）'], limitations: ['横屏未采集'] });
  });
  // 6 cart-filled × tablet: broken image path
  cell('checkout', 'cart-filled', 'tablet-b', 'portrait', 'default', ['两件商品与合计金额'], c => {
    const a = scr('s6', TB, '购物车 (2)', '平板'); a.path = 'evidence/does-not-exist.svg';
    c.capture = capture(c.id, { assets: [a] });
  });
  // 7 pay-success × phone portrait: AI pass
  cell('checkout', 'pay-success', 'phone-a', 'portrait', 'default', ['“支付成功”与订单号'], c => {
    c.capture = capture(c.id, { assets: [scr('s7', PH, '支付成功', '订单号 A-1024')] });
    c.aiReviews = [ai(c.capture, 'pass', '成功标题和订单号可见。', ['支付成功', '订单号 A-1024'])]; c.currentAIReview = c.aiReviews[0];
  });
  // 8 pay-success × tablet portrait: landscape-shaped image in portrait column → orientation mismatch
  cell('checkout', 'pay-success', 'tablet-b', 'portrait', 'default', ['“支付成功”与订单号'], c => {
    c.capture = capture(c.id, { assets: [scr('s8', { w: 2560, h: 1600 }, '支付成功', '横向图片')] });
  });
  // 9 submit-order transition × phone portrait: 6 ordered frames + actions, AI question
  cell('checkout', 'submit-order', 'phone-a', 'portrait', 'default', ['点击“提交订单”后出现底部面板并过渡到支付成功', '过渡过程中无闪白'], c => {
    const offs = [0, 80, 160, 240, 400, 640];
    const frames = offs.map((o, i) => asset('f' + i, 'frame', { ...PH, title: i < 5 ? '购物车 (2)' : '支付成功', sub: '+' + o + 'ms', sheet: i < 5 ? 1 - i * 0.2 : null, tag: '+' + o + 'ms' }, { at: o, fields: { offsetMs: o } }));
    c.capture = capture(c.id, { assets: frames, actions: [{ at: iso(0), type: 'tap', description: '点击“提交订单”', source: 'fixture' }],
      assertions: [{ description: '起始帧为“有商品”', result: 'pass', basis: 'visual', evidenceAssetIds: ['f0'], stateId: 'cart-filled' }, { description: '结束帧为“支付成功”', result: 'pass', basis: 'visual', evidenceAssetIds: ['f5'], stateId: 'pay-success' }],
      transition: { fromStateId: 'cart-filled', toStateId: 'pay-success', startedAt: iso(0), endedAt: iso(640), triggerActionIndex: 0, startEvidenceAssetId: 'f0', endEvidenceAssetId: 'f5' } });
    c.aiReviews = [ai(c.capture, 'question', '6 帧中面板逐步上滑，终帧为支付成功；稀疏帧无法判断是否闪白，需人工看录屏或确认。', ['购物车 (2)', '支付成功'])]; c.currentAIReview = c.aiReviews[0];
  });
  // 10 submit-order × tablet: only end screenshot → process gap
  cell('checkout', 'submit-order', 'tablet-b', 'portrait', 'default', ['点击“提交订单”后过渡到支付成功'], c => {
    c.capture = capture(c.id, { assets: [scr('s10', TB, '支付成功', '只有结束画面')], actions: [{ at: iso(0), type: 'tap', description: '点击“提交订单”', source: 'fixture' }], transition: { fromStateId: 'cart-filled', toStateId: 'pay-success', startedAt: iso(0), endedAt: iso(500), triggerActionIndex: 0 } });
    c.aiReviews = [ai(c.capture, 'pass', '结束画面正确。', ['支付成功'])]; c.currentAIReview = c.aiReviews[0];
  });
  // 11/12 settings-main default + dark variant
  cell('settings', 'settings-main', 'phone-a', 'portrait', 'default', ['列表项“通知”“隐私”可见'], c => {
    c.capture = capture(c.id, { assets: [scr('s11', PH, '设置', '通知 · 隐私')] });
    c.aiReviews = [ai(c.capture, 'pass', '两个列表项可见。', ['设置', '通知', '隐私'])]; c.currentAIReview = c.aiReviews[0];
  });
  cell('settings', 'settings-main', 'phone-a', 'portrait', 'dark', ['深色主题下文字对比度足够'], c => {
    c.capture = capture(c.id, { assets: [scr('s12', PH, '设置', '通知 · 隐私', 'dark')] });
  });
  cell('settings', 'settings-main', 'tablet-b', 'portrait', 'default', ['列表项“通知”“隐私”可见'], c => {
    c.capture = capture(c.id, { assets: [scr('s13', TB, '设置', '通知 · 隐私')] });
    c.aiReviews = [ai(c.capture, 'pass', '两个列表项可见。', ['设置', '通知', '隐私'])]; c.currentAIReview = c.aiReviews[0];
  });

  const historicalHumanReviews = [{ id: 'batch-old-2:0', batchId: 'batch-old-2', cellId: 'cell-000000000000000000removed', captureId: null, buildId: null, runtimeId: null, specRev: 'spec-0', verdict: 'fail', comment: '[需修改] 旧 spec 里的“优惠券”页标题被截断', reviewer: 'fixture-reviewer', createdAt: iso(-90000000), stale: true, staleReasons: ['cell removed from current spec'] }];
  const view = { schemaVersion: 1, project, spec, target, historicalHumanReviews, policy: { revision: 'policy-1' }, generatedAt: iso(round * 3600000), cells, storage: { mode: 'local-single-reviewer', drafts: 'browser-local and server when available', collaboration: false } };
  return { view, files };
}

/** Write a static bundle like core `export`: UI files + review.json + review-data.js + evidence/. */
export function writeBundle(outDir, { round = 1, withDataJs = true } = {}) {
  const { view, files } = buildFixture({ round });
  mkdirSync(join(outDir, 'evidence'), { recursive: true });
  for (const f of UI_FILES) copyFileSync(join(REVIEW_DIR, f), join(outDir, f));
  for (const [p, body] of files) writeFileSync(join(outDir, p), body);
  writeFileSync(join(outDir, 'review.json'), JSON.stringify(view, null, 2));
  if (withDataJs) writeFileSync(join(outDir, 'review-data.js'), 'globalThis.VISUAL_ACCEPTANCE_DATA = ' + JSON.stringify(view).replace(/</g, '\\u003c') + ';\n');
  return view;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node fixture.mjs <out-dir> [round]'); process.exit(2); }
  const v = writeBundle(out, { round: Number(process.argv[3] || 1) });
  console.log(JSON.stringify({ out, cells: v.cells.length, note: 'FIXTURE bundle for review-UI tests only; not app evidence' }));
}
