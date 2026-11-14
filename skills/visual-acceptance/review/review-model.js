/*
 * Visual acceptance review UI — pure model (no DOM).
 *
 * Consumes the core view model (docs/contracts.md, "Review UI loading and view
 * model", schemaVersion 1) and derives what the matrix needs. It never invents
 * evidence: missing/blocked/stale facts come from the view model; the only
 * derived facts are presentation (rows/columns, priority, filters, queue) and
 * the thin human-decision bridge described in README.md.
 *
 * Classic script (works from file:// and http). Exposes globalThis.VAReview.model.
 */
(function (root) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var EXPORT_KIND = 'visual-acceptance-human-feedback';

  // Human decisions shown as buttons. Core feedback `verdict` is pass|question|fail;
  // the bridge keeps the precise human decision in `decision` (extra field) and
  // maps it to the contract verdict. Non-pass decisions require a comment.
  var DECISIONS = {
    'pass': { verdict: 'pass', label: '通过', tag: '', key: '1', needsComment: false },
    'needs-change': { verdict: 'fail', label: '需修改', tag: '[需修改]', key: '2', needsComment: true },
    'blocked': { verdict: 'question', label: '阻塞', tag: '[阻塞]', key: '3', needsComment: true },
    'not-applicable': { verdict: 'question', label: '不适用', tag: '[不适用]', key: '4', needsComment: true }
  };
  var DECISION_ORDER = ['pass', 'needs-change', 'blocked', 'not-applicable'];
  // Display-only decision for submitted core reviews that carry no `decision`.
  var LEGACY_VERDICT_DECISION = { pass: 'pass', fail: 'needs-change', question: 'question' };

  var AI_VERDICTS = ['pass', 'question', 'fail'];

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function str(v) { return typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v)); }
  function timeOf(v) { var t = Date.parse(v); return isFinite(t) ? t : 0; }

  function draftKey(cellId, captureId) { return cellId + '@' + (captureId || 'none'); }

  function validateView(raw) {
    var errors = [];
    if (!isObj(raw)) { return ['review data: expected a JSON object']; }
    if (raw.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion: expected ' + SCHEMA_VERSION + ', got ' + JSON.stringify(raw.schemaVersion));
    if (!isObj(raw.project) || !raw.project.id) errors.push('project.id: missing');
    if (!isObj(raw.spec)) errors.push('spec: missing');
    if (!Array.isArray(raw.cells)) errors.push('cells: expected array');
    return errors;
  }

  function byId(list) {
    var m = new Map();
    arr(list).forEach(function (item, i) { if (isObj(item) && item.id) m.set(item.id, Object.assign({ _order: i }, item)); });
    return m;
  }

  function classifyAssets(capture) {
    var out = { screens: [], frames: [], videos: [], all: [] };
    if (!capture) return out;
    arr(capture.assets).forEach(function (a) {
      if (!isObj(a)) return;
      out.all.push(a);
      if (a.kind === 'video') out.videos.push(a);
      else if (a.kind === 'frame') out.frames.push(a);
      else out.screens.push(a);
    });
    out.frames.sort(function (a, b) { return (Number(a.offsetMs) || 0) - (Number(b.offsetMs) || 0); });
    return out;
  }

  // Frames must be strictly time ordered (contract) — verify instead of trusting.
  function framesOrdered(frames) {
    for (var i = 1; i < frames.length; i++) {
      if (!(Number(frames[i].offsetMs) > Number(frames[i - 1].offsetMs))) return false;
    }
    return true;
  }

  /** Evidence facts for any capture version of a cell (current or historical). */
  function captureFacts(kind, capture, extraBlockers) {
    var assets = classifyAssets(capture);
    var blockers = capture ? arr(capture.blockers).slice() : [];
    arr(extraBlockers).forEach(function (b) { if (blockers.indexOf(b) < 0) blockers.push(b); });
    // Blocked captures may still carry real images (e.g. a transition without enough frames):
    // they stay viewable, but evidence is "blocked" and the blockers are shown.
    var evidence = !capture ? 'missing' : (capture.status === 'blocked' || blockers.length) ? 'blocked' : (assets.all.length ? 'captured' : 'missing');
    var ordered = framesOrdered(assets.frames);
    var tx = kind === 'transition' && capture ? transitionFacts(capture, assets, ordered) : null;
    var processOk = kind !== 'transition' || !!(tx && tx.gaps.length === 0);
    return {
      assets: assets, evidence: evidence, framesOrdered: ordered, processOk: processOk, transition: tx,
      processGap: kind === 'transition' && evidence !== 'missing' && !!capture && assets.all.length > 0 && !processOk,
      blockers: blockers, limitations: capture ? arr(capture.limitations) : [],
      provenance: provenanceOf(capture)
    };
  }

  /**
   * Transition eligibility as the UI can see it (contract 690e7e2): trigger action
   * bound by triggerActionIndex, >=3 strictly ordered frames (start/intermediate/end),
   * start/end frames bound by asset ID, and not a wholly identical frame set.
   * Video alone is not motion proof. Core remains the authority (blockers); these
   * gaps only explain to the reviewer why the process is not verified.
   */
  function transitionFacts(capture, assets, ordered) {
    var tr = isObj(capture.transition) ? capture.transition : null;
    var frames = assets.frames, gaps = [];
    var idx = tr && Number.isInteger(tr.triggerActionIndex) ? tr.triggerActionIndex : null;
    var trigger = idx !== null ? arr(capture.actions)[idx] || null : null;
    var start = tr && tr.startEvidenceAssetId ? frames.find(function (f) { return f.id === tr.startEvidenceAssetId; }) || null : null;
    var end = tr && tr.endEvidenceAssetId ? frames.find(function (f) { return f.id === tr.endEvidenceAssetId; }) || null : null;
    var pixelsKnown = frames.length >= 2 && frames.every(function (f) { return /^[a-f0-9]{64}$/.test(f.pixelSha256 || ''); });
    var identical = pixelsKnown && frames.every(function (f) { return f.pixelSha256 === frames[0].pixelSha256; });
    if (!tr) gaps.push('缺少 transition 元数据（起止状态/时间）');
    if (frames.length < 3) gaps.push('只有 ' + frames.length + ' 帧，需至少 3 帧覆盖起、中、止');
    if (frames.length && !ordered) gaps.push('帧时间顺序无效');
    if (tr && !trigger) gaps.push('没有绑定实际触发动作（triggerActionIndex）');
    if (tr && (!start || start !== frames[0])) gaps.push('起始帧未绑定（startEvidenceAssetId）');
    if (tr && (!end || end !== frames[frames.length - 1])) gaps.push('结束帧未绑定（endEvidenceAssetId）');
    if (identical) gaps.push('所有代表帧完全相同，看不到可见过渡');
    if (frames.length >= 3 && !pixelsKnown) gaps.push('尚无解码像素校验结果；文件哈希不同不能证明画面变化，请用当前 core 重新导出');
    return { meta: tr, trigger: trigger, triggerIndex: idx, startAssetId: start ? start.id : null, endAssetId: end ? end.id : null, identical: identical, gaps: gaps };
  }

  function provenanceOf(capture) {
    var p = capture && isObj(capture.provenance) ? capture.provenance : null;
    if (!p) return { kind: 'unknown', label: '来源未知', real: false };
    var real = p.source === 'real-app';
    if (!real) {
      return { kind: 'fixture', label: 'FIXTURE · 非真实 App 证据', real: false, detail: str(p.source) };
    }
    var dk = str(p.deviceKind);
    var label = dk === 'physical' ? '真机' : dk === 'simulator' ? '模拟器' : dk === 'emulator' ? '模拟器 (emulator)' : '真实 App';
    if (p.adapter) label += ' · ' + p.adapter;
    return {
      kind: dk === 'physical' ? 'device' : 'local',
      label: label,
      real: true,
      controlledIO: !!p.fixtureDescription,
      detail: str(p.fixtureDescription)
    };
  }

  function sizeOfAsset(a) {
    var w = Number(a && a.width), h = Number(a && a.height);
    return w > 0 && h > 0 ? { w: w, h: h } : null;
  }

  function orientationOfSize(s) {
    if (!s) return null;
    return s.w > s.h ? 'landscape' : s.w < s.h ? 'portrait' : 'square';
  }

  function stateLabel(states, id) { var s = states.get(id); return s ? str(s.label) || id : id; }

  /**
   * Normalize the core view model into lookup tables + derived cells.
   * Throws an Error listing problems when the data cannot be shown at all.
   */
  function prepareView(raw) {
    var errors = validateView(raw);
    if (errors.length) { var e = new Error('无法加载 review 数据：' + errors.join('; ')); e.details = errors; throw e; }
    var spec = raw.spec;
    var scenarios = byId(spec.scenarios), states = byId(spec.states), devices = byId(spec.devices), variants = byId(spec.variants);
    var specCells = byId(spec.cells);
    var captureById = new Map();
    var columnsByKey = new Map(), rowsByKey = new Map();

    var cells = raw.cells.filter(isObj).map(function (c, index) {
      var sc = specCells.get(c.id) || {};
      var scenarioId = c.scenarioId || sc.scenarioId, stateId = c.stateId || sc.stateId, deviceId = c.deviceId || sc.deviceId;
      var orientation = c.orientation || sc.orientation || 'unspecified', variantId = c.variantId || sc.variantId || 'default';
      var state = states.get(stateId) || { id: stateId, label: stateId, kind: 'state' };
      var captures = arr(c.captures).filter(isObj).slice();
      if (c.capture && !captures.some(function (x) { return x.id === c.capture.id; })) captures.push(c.capture);
      captures.sort(function (a, b) { return timeOf(a.createdAt) - timeOf(b.createdAt); });
      captures.forEach(function (cap, i) { captureById.set(cap.id, { capture: cap, cellId: c.id, version: i + 1 }); });
      var capture = c.capture || null;
      var version = capture ? captures.findIndex(function (x) { return x.id === capture.id; }) + 1 : 0;
      var kind = state.kind === 'transition' ? 'transition' : 'state';
      var facts = captureFacts(kind, capture, c.blockers);
      var assets = facts.assets, evidence = facts.evidence, processOk = facts.processOk, processGap = facts.processGap;

      // representative image = first screenshot, else last frame (end state), else none
      var primary = assets.screens[0] || assets.frames[assets.frames.length - 1] || null;
      var size = sizeOfAsset(primary);
      var imgOrientation = orientationOfSize(size);
      var orientationMismatch = !!(size && (orientation === 'portrait' || orientation === 'landscape') && imgOrientation !== 'square' && imgOrientation !== orientation);

      // reviewProtocol (contract da13ee7): when the view declares one, an AI review made under
      // another protocol is history only, even if an older export did not mark it stale.
      var aiReviews = arr(c.aiReviews).filter(isObj).map(function (r) {
        if (!raw.reviewProtocol || r.reviewProtocol === raw.reviewProtocol) return r;
        var reasons = arr(r.staleReasons).slice(); var why = 'AI 评审协议不匹配（' + (r.reviewProtocol || '未标注') + ' ≠ ' + raw.reviewProtocol + '），需重新看图';
        if (reasons.indexOf(why) < 0) reasons.push(why);
        return Object.assign({}, r, { stale: true, staleReasons: reasons });
      }).sort(function (a, b) { return timeOf(b.createdAt) - timeOf(a.createdAt); });
      var aiCurrent = resolveCurrent(c.currentAIReview, aiReviews);
      if (aiCurrent && raw.reviewProtocol && aiCurrent.reviewProtocol !== raw.reviewProtocol) aiCurrent = null;
      if (aiCurrent && (aiCurrent.stale || !capture || aiCurrent.captureId !== capture.id)) aiCurrent = null;
      // fall back to the latest non-stale review of the current capture (never an older capture's)
      if (!aiCurrent && capture) aiCurrent = aiReviews.find(function (r) { return !r.stale && r.captureId === capture.id; }) || null;
      var aiOld = aiReviews.filter(function (r) { return r !== aiCurrent; });
      var aiVerdict = aiCurrent ? (AI_VERDICTS.indexOf(aiCurrent.verdict) >= 0 ? aiCurrent.verdict : 'none') : (aiOld.length ? 'stale' : 'none');

      var humanReviews = arr(c.humanReviews).filter(isObj).slice().sort(function (a, b) { return timeOf(b.createdAt) - timeOf(a.createdAt); });
      var humanCurrent = resolveCurrent(c.currentHumanReview, humanReviews);
      if (humanCurrent && (humanCurrent.stale || (humanCurrent.captureId || null) !== (capture ? capture.id : null))) humanCurrent = null;

      var colKey = deviceId + '|' + orientation;
      if (!columnsByKey.has(colKey)) {
        var dev = devices.get(deviceId) || { id: deviceId, label: deviceId };
        columnsByKey.set(colKey, { key: colKey, deviceId: deviceId, orientation: orientation, device: dev, order: (dev._order || 0) * 3 + ['portrait', 'landscape', 'unspecified'].indexOf(orientation), size: null, sizeSource: null });
      }
      var col = columnsByKey.get(colKey);
      var declared = deviceScreen(col.device, orientation);
      if (declared && !col.size) { col.size = declared; col.sizeSource = 'spec'; }
      if (size && (!col.size || col.sizeSource === 'capture-guess')) { col.size = size; col.sizeSource = 'capture'; }

      var rowKey = scenarioId + '|' + stateId;
      if (!rowsByKey.has(rowKey)) {
        var scn = scenarios.get(scenarioId) || { id: scenarioId, label: scenarioId };
        rowsByKey.set(rowKey, {
          key: rowKey, scenarioId: scenarioId, stateId: stateId, scenario: scn, state: state, kind: kind,
          label: kind === 'transition' ? stateLabel(states, state.fromStateId) + ' → ' + stateLabel(states, state.toStateId) : str(state.label) || stateId,
          order: (scn._order || 0) * 10000 + (state._order || 0)
        });
      }

      var entry = c.entry || sc.entry || state.entry || c.route || sc.route || state.route || null;

      var cell = {
        id: c.id, raw: c, index: index,
        scenarioId: scenarioId, stateId: stateId, deviceId: deviceId, orientation: orientation, variantId: variantId,
        rowKey: rowKey, colKey: colKey, kind: kind,
        scenario: scenarios.get(scenarioId) || { id: scenarioId, label: scenarioId },
        state: state, device: devices.get(deviceId) || { id: deviceId, label: deviceId }, variant: variants.get(variantId) || { id: variantId, label: variantId },
        fromState: kind === 'transition' ? states.get(state.fromStateId) || null : null,
        toState: kind === 'transition' ? states.get(state.toStateId) || null : null,
        checkpoints: arr(c.checkpoints && c.checkpoints.length ? c.checkpoints : sc.checkpoints).map(str),
        entry: entry,
        coreStatus: str(c.status), staleReasons: arr(c.staleReasons).map(str),
        capture: capture, captures: captures, version: version,
        assets: assets, primary: primary, size: size,
        evidence: evidence, processGap: processGap, processOk: processOk,
        orientationMismatch: orientationMismatch,
        provenance: provenanceOf(capture),
        blockers: facts.blockers, limitations: facts.limitations, specRev: spec.revision,
        aiCurrent: aiCurrent, aiOld: aiOld, aiVerdict: aiVerdict,
        humanSubmitted: humanReviews, humanCurrent: humanCurrent
      };
      cell.basePriority = basePriority(cell);
      return cell;
    });

    var columns = Array.from(columnsByKey.values()).sort(function (a, b) { return a.order - b.order; });
    var rows = Array.from(rowsByKey.values()).sort(function (a, b) { return a.order - b.order; });
    var rowIndex = new Map(rows.map(function (r, i) { return [r.key, i]; }));
    var colIndex = new Map(columns.map(function (c, i) { return [c.key, i]; }));
    var variantList = Array.from(new Set(cells.map(function (c) { return c.variantId; }))).map(function (id) { return variants.get(id) || { id: id, label: id }; })
      .sort(function (a, b) { return (a._order || 0) - (b._order || 0); });
    // stable matrix order: variant, row, column
    var vIndex = new Map(variantList.map(function (v, i) { return [v.id, i]; }));
    cells.forEach(function (c) { c.matrixOrder = (vIndex.get(c.variantId) * 1e6) + rowIndex.get(c.rowKey) * 1000 + colIndex.get(c.colKey); });
    var cellsById = new Map(cells.map(function (c) { return [c.id, c]; }));

    return {
      raw: raw, schemaVersion: raw.schemaVersion, project: raw.project, spec: spec, target: raw.target || {}, policy: raw.policy || {},
      reviewProtocol: raw.reviewProtocol || null, generatedAt: raw.generatedAt || null, storage: raw.storage || {}, summary: isObj(raw.summary) ? raw.summary : null,
      builds: byId(raw.builds), runtimes: byId(raw.runtimes), sources: byId(raw.sources),
      historicalHumanReviews: arr(raw.historicalHumanReviews).filter(isObj),
      scenarios: scenarios, states: states, devices: devices, variants: variants, variantList: variantList,
      columns: columns, rows: rows, cells: cells, cellsById: cellsById, captureById: captureById
    };
  }

  function resolveCurrent(ref, list) {
    if (!ref) return null;
    if (typeof ref === 'string') return list.find(function (r) { return r.id === ref; }) || null;
    if (isObj(ref)) return list.find(function (r) { return r.id === ref.id; }) || ref;
    return null;
  }

  // Optional declared screen size: device.screen {width,height} in px (portrait basis).
  function deviceScreen(device, orientation) {
    var s = device && isObj(device.screen) ? device.screen : null;
    if (!s) return null;
    var w = Number(s.width || s.widthPx), h = Number(s.height || s.heightPx);
    if (!(w > 0 && h > 0)) return null;
    if (orientation === 'landscape' && w < h) { var t = w; w = h; h = t; }
    if (orientation === 'portrait' && w > h) { var t2 = w; w = h; h = t2; }
    return { w: w, h: h };
  }

  function basePriority(cell) {
    if (cell.aiVerdict === 'fail') return 0;
    if (cell.aiVerdict === 'question') return 1;
    if (cell.evidence !== 'captured' || cell.processGap) return 2;
    if (cell.aiVerdict === 'stale' || cell.aiVerdict === 'none') return 4;
    return 5;
  }

  // ---- human state -------------------------------------------------------

  function decisionOfRecord(rec) {
    if (!rec) return null;
    if (rec.decision && (DECISIONS[rec.decision])) return rec.decision;
    return LEGACY_VERDICT_DECISION[rec.verdict] || null;
  }

  /**
   * Human state of a cell for its CURRENT capture.
   * drafts: Map draftKey -> draft entry.
   * Returns {state, decision, draft, submitted, oldDrafts, oldSubmitted}
   *  state: pending | reopen | pass | needs-change | blocked | not-applicable | question
   */
  function humanState(cell, drafts) {
    var capId = cell.capture ? cell.capture.id : null;
    var draft = drafts.get(draftKey(cell.id, capId)) || null;
    var oldDrafts = [];
    drafts.forEach(function (d) { if (d.cellId === cell.id && (d.captureId || null) !== capId) oldDrafts.push(d); });
    oldDrafts.sort(function (a, b) { return timeOf(b.updatedAt) - timeOf(a.updatedAt); });
    var oldSubmitted = cell.humanSubmitted.filter(function (r) { return r !== cell.humanCurrent; });
    var decision = null, source = null;
    if (draft && draft.decision) { decision = draft.decision; source = 'draft'; }
    else if (cell.humanCurrent) { decision = decisionOfRecord(cell.humanCurrent); source = 'submitted'; }
    var state = decision || ((oldDrafts.some(function (d) { return d.decision || d.comment; }) || oldSubmitted.length) ? 'reopen' : 'pending');
    var submitted = !!(draft && draft.submitted && draft.submitted.rev === draft.rev) || (source === 'submitted');
    return { state: state, decision: decision, source: source, draft: draft, submitted: submitted, oldDrafts: oldDrafts, oldSubmitted: oldSubmitted };
  }

  function isResolved(hs) { return !!hs.decision; }

  // ---- filters -----------------------------------------------------------

  var PRESETS = {
    attention: { label: '需关注', hint: 'AI 疑问/失败、缺证据/阻塞、人工未决' },
    all: { label: '全部', hint: '所有格子' },
    'ai-issues': { label: 'AI 疑问/失败', hint: '当前证据上 AI 给出 question 或 fail' },
    evidence: { label: '缺证据/阻塞', hint: '缺图、采集阻塞、过程证据不足、图片损坏' },
    pending: { label: '人工未决', hint: '当前证据尚无人工决定' },
    reopen: { label: '旧版需复审', hint: '旧证据上有人工意见，新证据尚未复审' },
    decided: { label: '已决定', hint: '当前证据已有人工决定' }
  };

  function evidenceFacets(cell, broken) {
    var f = [cell.evidence];
    if (cell.processGap) f.push('process-gap');
    if (broken && broken.has(cell.id)) f.push('broken');
    if (cell.orientationMismatch) f.push('orientation');
    return f;
  }
  function hasEvidenceIssue(cell, broken) {
    return cell.evidence !== 'captured' || cell.processGap || cell.orientationMismatch || !!(broken && broken.has(cell.id));
  }

  function defaultFilter() {
    return { preset: 'attention', scenario: [], device: [], state: [], kind: [], ai: [], human: [], evidence: [], variant: [], text: '' };
  }

  function matchesPreset(preset, cell, hs, broken) {
    switch (preset) {
      case 'all': return true;
      case 'ai-issues': return cell.aiVerdict === 'question' || cell.aiVerdict === 'fail';
      case 'evidence': return hasEvidenceIssue(cell, broken);
      case 'pending': return !isResolved(hs);
      case 'reopen': return hs.state === 'reopen';
      case 'decided': return isResolved(hs);
      default: // attention
        return cell.aiVerdict === 'question' || cell.aiVerdict === 'fail' || hasEvidenceIssue(cell, broken) || !isResolved(hs);
    }
  }

  function inSet(list, value) { return !list || !list.length || list.indexOf(value) >= 0; }
  function anyIn(list, values) { return !list || !list.length || values.some(function (v) { return list.indexOf(v) >= 0; }); }

  function matchesFilter(cell, hs, filter, broken) {
    if (!matchesPreset(filter.preset, cell, hs, broken)) return false;
    if (!inSet(filter.scenario, cell.scenarioId)) return false;
    if (!inSet(filter.device, cell.colKey)) return false;
    if (!inSet(filter.state, cell.stateId)) return false;
    if (!inSet(filter.kind, cell.kind)) return false;
    if (!inSet(filter.ai, cell.aiVerdict)) return false;
    if (!inSet(filter.human, hs.state)) return false;
    if (!anyIn(filter.evidence, evidenceFacets(cell, broken))) return false;
    if (!inSet(filter.variant, cell.variantId)) return false;
    if (filter.text) {
      var q = filter.text.toLowerCase();
      var hay = [cell.id, cell.scenario.label, cell.state.label, cell.device.label, cell.variant.label, cell.checkpoints.join(' ')].join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }

  function priorityOf(cell, hs, broken) {
    var p = cell.basePriority;
    if (p > 2 && broken && broken.has(cell.id)) p = 2;
    if (hs.state === 'reopen' && p > 3) p = 3;
    if (isResolved(hs)) p += 10;
    return p;
  }

  // ---- frozen queue ------------------------------------------------------

  /** Freeze an ordered list of cell IDs. Later filter changes never mutate it. */
  function createQueue(view, drafts, filter, broken, now) {
    var items = view.cells.map(function (c) { return { c: c, hs: humanState(c, drafts) }; })
      .filter(function (x) { return matchesFilter(x.c, x.hs, filter, broken); })
      .sort(function (a, b) { return (priorityOf(a.c, a.hs, broken) - priorityOf(b.c, b.hs, broken)) || (a.c.matrixOrder - b.c.matrixOrder); });
    return Object.freeze({ ids: Object.freeze(items.map(function (x) { return x.c.id; })), createdAt: now || new Date().toISOString(), preset: filter.preset, filter: JSON.parse(JSON.stringify(filter)) });
  }

  /** Next ID after `currentId` in the snapshot whose human state is unresolved. */
  function queueNext(queue, currentId, resolvedFn) {
    if (!queue) return null;
    var ids = queue.ids, start = ids.indexOf(currentId);
    for (var i = start + 1; i < ids.length; i++) if (!resolvedFn(ids[i])) return ids[i];
    return null;
  }
  function queuePrev(queue, currentId) {
    if (!queue) return null;
    var i = queue.ids.indexOf(currentId);
    if (i > 0) return queue.ids[i - 1];
    return null;
  }
  /** Adjacent snapshot item (dir = +1 / -1), regardless of resolution. */
  function queueAdjacent(queue, currentId, dir) {
    if (!queue) return null;
    var i = queue.ids.indexOf(currentId);
    if (i < 0) return dir > 0 ? (queue.ids[0] || null) : null;
    return queue.ids[i + dir] || null;
  }
  function queueFirstUnresolved(queue, resolvedFn) {
    if (!queue) return null;
    for (var i = 0; i < queue.ids.length; i++) if (!resolvedFn(queue.ids[i])) return queue.ids[i];
    return null;
  }
  function queueStats(queue, resolvedFn) {
    var done = 0; queue.ids.forEach(function (id) { if (resolvedFn(id)) done++; });
    return { total: queue.ids.length, done: done };
  }

  // ---- drafts → feedback / export ---------------------------------------

  function newDraft(cell, captureId, now) {
    var cap = captureId ? (cell.captures.find(function (c) { return c.id === captureId; }) || null) : null;
    return {
      cellId: cell.id,
      captureId: cap ? cap.id : null,
      buildId: cap ? (cap.buildId || null) : null,
      runtimeId: cap ? (cap.runtimeId || null) : null,
      specRev: cap ? (cap.specRev || null) : (cell.specRev || null),
      decision: null, comment: '',
      rev: 0, createdAt: now, updatedAt: now, submitted: null
    };
  }

  function validateDraftForSubmit(d) {
    if (!d.decision || !DECISIONS[d.decision]) return '未选择决定';
    if (DECISIONS[d.decision].needsComment && !str(d.comment).trim()) return DECISIONS[d.decision].label + '需要填写理由';
    return null;
  }

  function contractComment(d) {
    var def = DECISIONS[d.decision];
    var c = str(d.comment).trim();
    return def && def.tag ? (def.tag + ' ' + c).trim() : c;
  }

  function draftToEdit(d, reviewer) {
    return {
      cellId: d.cellId, captureId: d.captureId || null,
      buildId: d.captureId ? d.buildId : null, runtimeId: d.captureId ? d.runtimeId : null,
      specRev: d.specRev,
      verdict: DECISIONS[d.decision].verdict,
      comment: contractComment(d),
      reviewer: reviewer,
      // bridge extras (README "Human decision bridge"):
      decision: d.decision, humanComment: str(d.comment), draftRev: d.rev, draftUpdatedAt: d.updatedAt
    };
  }

  /**
   * Collect current-capture decided drafts that are not yet submitted at their
   * current revision. Old-capture drafts are never rebound to new captures.
   */
  function collectSubmittable(view, drafts, opts) {
    opts = opts || {};
    var ready = [], invalid = [], oldOnly = [];
    view.cells.forEach(function (cell) {
      var capId = cell.capture ? cell.capture.id : null;
      var d = drafts.get(draftKey(cell.id, capId));
      if (d && d.decision) {
        var err = validateDraftForSubmit(d);
        if (err) invalid.push({ cellId: cell.id, error: err });
        else if (opts.includeSubmitted || !(d.submitted && d.submitted.rev === d.rev)) ready.push(d);
      }
      drafts.forEach(function (o) { if (o.cellId === cell.id && (o.captureId || null) !== capId && o.decision) oldOnly.push(o); });
    });
    return { ready: ready, invalid: invalid, oldOnly: oldOnly };
  }

  function buildBatch(view, draftsList, meta) {
    return {
      schemaVersion: SCHEMA_VERSION,
      batchId: meta.batchId, projectId: view.project.id, sourceId: meta.sourceId,
      submittedAt: meta.submittedAt,
      edits: draftsList.map(function (d) { return draftToEdit(d, meta.reviewer); })
    };
  }

  /** Full JSON export: feedback batch shape (core `feedback-import`) + all drafts for restore. */
  function buildExport(view, drafts, meta) {
    var col = collectSubmittable(view, drafts, { includeSubmitted: true });
    var out = buildBatch(view, col.ready, meta);
    out.kind = EXPORT_KIND;
    out.transport = 'json-export';
    out.exportedAt = meta.submittedAt;
    out.project = { id: view.project.id, name: view.project.name || '' };
    out.target = view.target || {};
    out.specRevision = view.spec && view.spec.revision || null;
    out.storageScope = meta.storageScope || null;
    out.drafts = Array.from(drafts.values()).map(function (d) { return JSON.parse(JSON.stringify(d)); });
    return out;
  }

  /** Parse JSON with a line/column location on syntax error. */
  function parseJSONLocated(text) {
    try { return { value: JSON.parse(text) }; }
    catch (e) {
      var msg = String(e && e.message || e), pos = null, m = /position (\d+)/.exec(msg);
      if (m) pos = Number(m[1]);
      var lc = /line (\d+) column (\d+)/.exec(msg);
      var loc = lc ? { line: Number(lc[1]), column: Number(lc[2]) } : (pos !== null ? lineCol(text, pos) : null);
      return { error: 'JSON 语法错误' + (loc ? '（第 ' + loc.line + ' 行，第 ' + loc.column + ' 列）' : '') + '：' + msg, location: loc };
    }
  }
  function lineCol(text, pos) {
    var line = 1, col = 1;
    for (var i = 0; i < pos && i < text.length; i++) { if (text[i] === '\n') { line++; col = 1; } else col++; }
    return { line: line, column: col };
  }

  /**
   * Validate an import file against the loaded view. Returns
   * {fatal: [msg], errors: [{path, message}], items: [{draft, status, existing}]}
   * status: new | same | conflict | old-version
   */
  function analyzeImport(text, view, drafts) {
    var res = { fatal: [], errors: [], items: [] };
    var parsed = parseJSONLocated(text);
    if (parsed.error) { res.fatal.push(parsed.error); return res; }
    var data = parsed.value;
    if (!isObj(data)) { res.fatal.push('顶层应为 JSON 对象'); return res; }
    if (data.schemaVersion !== SCHEMA_VERSION) res.fatal.push('schemaVersion 不匹配：文件为 ' + JSON.stringify(data.schemaVersion) + '，本页面支持 ' + SCHEMA_VERSION);
    var pid = data.projectId || (isObj(data.project) && data.project.id);
    if (pid !== view.project.id) res.fatal.push('项目不匹配：文件为 ' + JSON.stringify(pid) + '，当前为 ' + JSON.stringify(view.project.id));
    var listName = Array.isArray(data.drafts) ? 'drafts' : Array.isArray(data.edits) ? 'edits' : null;
    if (!listName) res.fatal.push('缺少 drafts 或 edits 数组');
    if (res.fatal.length) return res;
    data[listName].forEach(function (item, i) {
      var path = listName + '[' + i + ']';
      if (!isObj(item)) { res.errors.push({ path: path, message: '应为对象' }); return; }
      var cell = view.cellsById.get(item.cellId);
      if (!cell) { res.errors.push({ path: path + '.cellId', message: '未知格子 ' + JSON.stringify(item.cellId) }); return; }
      var capId = item.captureId === undefined ? null : item.captureId;
      var capInfo = capId ? view.captureById.get(capId) : null;
      if (capId && (!capInfo || capInfo.cellId !== cell.id)) { res.errors.push({ path: path + '.captureId', message: '该格子没有此证据版本 ' + JSON.stringify(capId) }); return; }
      if (capInfo) {
        var bad = ['buildId', 'runtimeId', 'specRev'].filter(function (k) { return item[k] !== undefined && item[k] !== null && item[k] !== capInfo.capture[k]; });
        if (bad.length) { res.errors.push({ path: path + '.' + bad[0], message: '与证据版本不一致：' + bad.join(', ') }); return; }
      }
      var decision = item.decision !== undefined ? item.decision : (item.verdict ? LEGACY_VERDICT_DECISION[item.verdict] : null);
      if (decision === 'question') decision = 'blocked';
      if (decision !== null && decision !== undefined && !DECISIONS[decision]) { res.errors.push({ path: path + '.decision', message: '未知决定 ' + JSON.stringify(decision) }); return; }
      var comment = item.humanComment !== undefined ? item.humanComment : item.comment;
      if (comment !== undefined && typeof comment !== 'string') { res.errors.push({ path: path + '.comment', message: '应为字符串' }); return; }
      if (item.humanComment === undefined && typeof comment === 'string' && decision && DECISIONS[decision].tag && comment.indexOf(DECISIONS[decision].tag) === 0) comment = comment.slice(DECISIONS[decision].tag.length).trim();
      var base = newDraft(cell, capId, item.updatedAt || item.draftUpdatedAt || data.submittedAt || new Date().toISOString());
      var draft = Object.assign(base, {
        decision: decision || null, comment: str(comment),
        rev: Number(item.rev || item.draftRev) || 1,
        createdAt: item.createdAt || base.createdAt,
        updatedAt: item.updatedAt || item.draftUpdatedAt || base.updatedAt,
        submitted: null, importedFrom: { batchId: data.batchId || null, path: path }
      });
      var key = draftKey(cell.id, capId);
      var existing = drafts.get(key) || null;
      var status;
      if (!existing) status = 'new';
      else if (existing.decision === draft.decision && str(existing.comment) === draft.comment) status = 'same';
      else status = 'conflict';
      var current = cell.capture ? cell.capture.id : null;
      res.items.push({ key: key, draft: draft, existing: existing, status: status, oldVersion: (capId || null) !== current, path: path });
    });
    return res;
  }

  // ---- copy text ---------------------------------------------------------

  function shortSha(s) { return s ? String(s).slice(0, 12) : '—'; }
  function columnLabel(cell) {
    return cell.device.label + ' · ' + orientationLabel(cell.orientation);
  }
  function orientationLabel(o) { return o === 'portrait' ? '竖屏' : o === 'landscape' ? '横屏' : '方向未指定'; }

  function formatFeedbackText(view, list, meta) {
    var lines = [];
    lines.push('# Visual acceptance 人工审核意见');
    lines.push('项目: ' + (view.project.name || '') + ' (' + view.project.id + ')');
    lines.push('Spec: ' + (view.spec.revision || '—') + ' · Target build: ' + (view.target.buildId || '—') + ' · runtime: ' + (view.target.runtimeId || '—'));
    lines.push('审核人: ' + (meta.reviewer || '（未填写）') + ' · 生成: ' + meta.now + ' · 草稿来源: ' + (meta.storageScope || '—'));
    lines.push('共 ' + list.length + ' 项');
    list.forEach(function (d, i) {
      var cell = view.cellsById.get(d.cellId);
      if (!cell) return;
      var capInfo = d.captureId ? view.captureById.get(d.captureId) : null;
      var cap = capInfo ? capInfo.capture : null;
      var isOld = (d.captureId || null) !== (cell.capture ? cell.capture.id : null);
      var label = d.decision ? DECISIONS[d.decision].label : '未决定（仅评论）';
      lines.push('');
      lines.push('## ' + (i + 1) + '. [' + label + '] ' + cell.scenario.label + ' › ' + rowLabel(view, cell) + ' — ' + columnLabel(cell) + ' · 变体 ' + cell.variant.label + (isOld ? ' （旧版证据）' : ''));
      lines.push('cell: ' + cell.id);
      lines.push('device: ' + cell.device.label + (cell.device.platform ? ' (' + cell.device.platform + ')' : '') + ' · ' + orientationLabel(cell.orientation) + (cell.size ? ' · ' + cell.size.w + '×' + cell.size.h + ' px' : ''));
      if (cap) {
        lines.push('capture: ' + cap.id + ' (v' + capInfo.version + ', ' + (cap.createdAt || '') + ') · build ' + (cap.buildId || '—') + ' · runtime ' + (cap.runtimeId || '—') + ' · spec ' + (cap.specRev || '—'));
        arr(cap.assets).forEach(function (a) {
          lines.push('image: ' + a.id + ' ' + (a.kind || '') + (a.offsetMs !== undefined ? ' +' + a.offsetMs + 'ms' : '') + ' sha256:' + shortSha(a.sha256) + ' ' + (a.width ? a.width + '×' + a.height + ' ' : '') + (a.path || ''));
        });
      } else {
        lines.push('capture: 无（缺证据）· spec ' + (d.specRev || view.spec.revision || '—'));
      }
      if (cell.checkpoints.length) lines.push('spec checkpoints: ' + cell.checkpoints.join(' | '));
      lines.push('意见: ' + (str(d.comment).trim() || '（无文字）'));
    });
    return lines.join('\n');
  }

  function rowLabel(view, cell) {
    if (cell.kind === 'transition') {
      return (cell.fromState ? cell.fromState.label : '?') + ' → ' + (cell.toState ? cell.toState.label : '?') + ' (' + cell.state.label + ')';
    }
    return cell.state.label;
  }

  /**
   * Core PUT /api/drafts validates drafts like feedback edits: every edit needs a
   * contract verdict and reviewer, and at most one edit per cell. The bridge sends
   * one draft per cell (current-capture draft first, else the latest one, never
   * rebinding its captureId); undecided drafts carry verdict "question" with
   * `decision: null, undecided: true` so the server can store them. Drafts whose
   * cell/capture is not in the loaded view stay browser-only.
   */
  function draftsForServer(view, drafts, reviewer) {
    var byCell = new Map();
    drafts.forEach(function (d) {
      var cell = view.cellsById.get(d.cellId);
      if (!cell) return;
      if (d.captureId && !(view.captureById.get(d.captureId) && view.captureById.get(d.captureId).cellId === d.cellId)) return;
      var current = (cell.capture ? cell.capture.id : null) === (d.captureId || null);
      var prev = byCell.get(d.cellId);
      if (!prev || (current && !prev.current) || (current === prev.current && timeOf(d.updatedAt) > timeOf(prev.d.updatedAt))) byCell.set(d.cellId, { d: d, current: current });
    });
    var out = [];
    byCell.forEach(function (x) {
      var d = x.d, cell = view.cellsById.get(d.cellId);
      out.push(Object.assign({}, d, {
        captureId: d.captureId || null,
        buildId: d.captureId ? d.buildId : null, runtimeId: d.captureId ? d.runtimeId : null,
        specRev: d.specRev || cell.specRev,
        verdict: d.decision && DECISIONS[d.decision] ? DECISIONS[d.decision].verdict : 'question',
        comment: d.decision ? contractComment(d) : str(d.comment),
        humanComment: str(d.comment), undecided: !d.decision,
        reviewer: reviewer || 'reviewer-not-set'
      }));
    });
    return out;
  }

  /** Server draft edit → local draft (undo the bridge mapping). */
  function draftFromServer(e) {
    var d = Object.assign({}, e);
    if (e.humanComment !== undefined) d.comment = e.humanComment;
    if (e.undecided) d.decision = null;
    else if (!d.decision) d.decision = LEGACY_VERDICT_DECISION[e.verdict] === 'question' ? 'blocked' : (LEGACY_VERDICT_DECISION[e.verdict] || null);
    d.rev = Number(e.rev) || 1;
    d.updatedAt = e.updatedAt || e.savedAt || new Date().toISOString();
    delete d.verdict; delete d.reviewer; delete d.humanComment; delete d.undecided;
    return d;
  }

  function newBatchId(rand) {
    var r = rand || Math.random;
    var s = ''; for (var i = 0; i < 16; i++) s += Math.floor(r() * 16).toString(16);
    return 'batch-' + Date.now().toString(36) + '-' + s;
  }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION, EXPORT_KIND: EXPORT_KIND,
    DECISIONS: DECISIONS, DECISION_ORDER: DECISION_ORDER, PRESETS: PRESETS,
    draftKey: draftKey, validateView: validateView, prepareView: prepareView,
    framesOrdered: framesOrdered, provenanceOf: provenanceOf, captureFacts: captureFacts, transitionFacts: transitionFacts, classifyAssets: classifyAssets,
    humanState: humanState, isResolved: isResolved, decisionOfRecord: decisionOfRecord,
    defaultFilter: defaultFilter, matchesFilter: matchesFilter, evidenceFacets: evidenceFacets, hasEvidenceIssue: hasEvidenceIssue, priorityOf: priorityOf,
    createQueue: createQueue, queueNext: queueNext, queuePrev: queuePrev, queueAdjacent: queueAdjacent, queueFirstUnresolved: queueFirstUnresolved, queueStats: queueStats,
    newDraft: newDraft, validateDraftForSubmit: validateDraftForSubmit, draftToEdit: draftToEdit,
    collectSubmittable: collectSubmittable, buildBatch: buildBatch, buildExport: buildExport,
    parseJSONLocated: parseJSONLocated, analyzeImport: analyzeImport,
    formatFeedbackText: formatFeedbackText, rowLabel: rowLabel, columnLabel: columnLabel, orientationLabel: orientationLabel,
    shortSha: shortSha, newBatchId: newBatchId, draftsForServer: draftsForServer, draftFromServer: draftFromServer
  };
  root.VAReview = root.VAReview || {};
  root.VAReview.model = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
