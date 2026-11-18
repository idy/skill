/*
 * Visual acceptance review UI — DOM application.
 * Plain browser script, no framework, no remote resources.
 * Depends on review-model.js and review-storage.js (globalThis.VAReview).
 */
(function () {
  'use strict';
  var M = window.VAReview.model, S = window.VAReview.storage;
  var D = M.DECISIONS;

  // ---------------------------------------------------------------- helpers
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (p) { el.style.setProperty(p, v[p]); });
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso); if (isNaN(d)) return String(iso);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function fmtClock(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; d = d || new Date(); return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }
  function nowIso() { return new Date().toISOString(); }
  function isTyping(t) { return t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !/^(checkbox|radio|range|button)$/.test(t.type)) || t.isContentEditable || t.tagName === 'SELECT'); }

  var AI_LABEL = { pass: 'AI 通过', question: 'AI 疑问', fail: 'AI 失败', stale: 'AI 已失效', none: 'AI 未评' };
  var AI_SHORT = { pass: 'AI ✓', question: 'AI ?', fail: 'AI ✕', stale: 'AI 旧', none: 'AI —' };
  var HUMAN_LABEL = { pending: '待审', reopen: '需复审', pass: '通过', 'needs-change': '需修改', blocked: '阻塞', 'not-applicable': '不适用', question: '有疑问' };
  var EVIDENCE_LABEL = { captured: '有证据', missing: '缺证据', blocked: '采集阻塞', 'process-gap': '过程证据不足', broken: '图片无法加载', orientation: '方向与列不符' };
  var KIND_LABEL = { state: '稳定状态', transition: '过渡' };

  // ---------------------------------------------------------------- state
  var app = {
    mode: null, view: null, server: null, local: null, session: null, etag: null,
    drafts: new Map(), filter: M.defaultFilter(), queue: null,
    activeId: null, boundCaptureId: null, editor: null,
    broken: new Set(), brokenAssets: new Set(),
    saveStates: new Map(), conflicts: new Map(), serverError: null,
    zoom: 1, frameIndex: 0, playTimer: null, pusher: null, pollTimer: null,
    newEvidenceCells: new Set(), lb: null, lastSaveAt: null, busy: false, reviewer: ''
  };
  window.__vaReviewApp = app; // for diagnostics/tests only

  function resolvedFn(id) { var c = app.view.cellsById.get(id); return !!c && M.isResolved(M.humanState(c, app.drafts)); }
  function hsOf(cell) { return M.humanState(cell, app.drafts); }

  // ---------------------------------------------------------------- boot
  function boot() {
    wireStatic();
    var http = /^https?:$/.test(location.protocol);
    var p = Promise.resolve(null);
    if (http && window.fetch) {
      app.server = S.createServerClient(window.fetch.bind(window), '');
      p = app.server.detect().then(function (sess) {
        if (!sess) { app.server = null; return null; }
        app.session = sess;
        return app.server.getReview().then(function (r) { app.etag = r.etag; return { raw: r.data, mode: 'server' }; });
      });
    }
    p.then(function (res) {
      if (res) return res;
      if (window.VISUAL_ACCEPTANCE_DATA) return { raw: window.VISUAL_ACCEPTANCE_DATA, mode: 'static' };
      if (http && window.fetch) {
        return fetch('./review.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (raw) { return raw ? { raw: raw, mode: 'static' } : null; }).catch(function () { return null; });
      }
      return null;
    }).then(function (res) {
      if (!res) { showNoData(); return; }
      start(res.raw, res.mode);
    }).catch(function (e) { showLoadError(e); });
  }

  function start(raw, mode) {
    var view;
    try { view = M.prepareView(raw); } catch (e) { showLoadError(e); return; }
    if (mode === 'server' && app.session && app.session.projectId !== view.project.id) {
      showLoadError(new Error('服务器会话项目 ' + app.session.projectId + ' 与 review 数据项目 ' + view.project.id + ' 不一致')); return;
    }
    app.mode = mode; app.view = view;
    app.local = S.createLocalStore(view.project.id, window.localStorage);
    app.sessionSlot = S.createSessionSlot(view.project.id, window.sessionStorage);
    app.drafts = app.local.loadAll();
    var meta = app.local.getMeta();
    app.reviewer = meta.reviewer || '';
    $('reviewer').value = app.reviewer;
    if (meta.filter) app.filter = Object.assign(M.defaultFilter(), meta.filter);
    if (meta.zoom) { app.zoom = meta.zoom; $('matrix-zoom').value = String(meta.zoom); }
    var q = app.sessionSlot.get();
    if (q && Array.isArray(q.ids)) app.queue = Object.freeze({ ids: Object.freeze(q.ids.filter(function (id) { return view.cellsById.has(id); })), createdAt: q.createdAt, preset: q.preset, filter: q.filter });
    app.local.onExternalChange(window, onExternalDraftChange);

    var after = Promise.resolve();
    if (mode === 'server') {
      app.pusher = S.createPusher(function () { return app.server.putDrafts(M.draftsForServer(app.view, app.drafts, app.reviewer)); });
      after = syncServerDrafts();
      // Core's server rejects page URLs with a query string, so the poll override lives in localStorage.
      var pm = Number(window.localStorage.getItem('visual-acceptance:review:poll-ms'));
      app.pollTimer = setInterval(pollReview, pm >= 500 ? pm : 15000);
    }
    after.then(function () {
      renderAll();
      routeFromHash();
    });
  }

  function syncServerDrafts() {
    return app.server.getDrafts().then(function (b) {
      var needPush = false;
      var seen = new Set();
      (b.edits || []).forEach(function (raw) {
        if (!raw || !raw.cellId) return;
        var e = M.draftFromServer(raw);
        var key = M.draftKey(e.cellId, e.captureId || null); seen.add(key);
        var loc = app.drafts.get(key);
        if (!loc || (Number(e.rev) || 0) > (Number(loc.rev) || 0) || ((Number(e.rev) || 0) === (Number(loc.rev) || 0) && Date.parse(e.updatedAt) > Date.parse(loc.updatedAt))) {
          var r = app.local.save(key, e, loc ? loc.rev : 0, { force: true });
          if (r.ok) app.drafts.set(key, Object.assign({}, e, { rev: r.draft.rev })); else app.drafts.set(key, e);
        } else if (JSON.stringify(loc) !== JSON.stringify(e)) needPush = true;
      });
      app.drafts.forEach(function (d, key) { if (!seen.has(key) && app.view.cellsById.has(d.cellId)) needPush = true; });
      if (needPush && app.drafts.size) return app.pusher().catch(function (e) { app.serverError = e.message; });
    }).catch(function (e) { app.serverError = '读取服务器草稿失败：' + e.message; });
  }

  function pollReview() {
    if (!app.server || document.hidden) return;
    app.server.getReview(app.etag).then(function (r) {
      if (r.notModified || !r.data) return;
      app.etag = r.etag;
      applyNewView(r.data, '本地服务');
    }).catch(function () { /* keep current data */ });
  }

  /** New review data while open: never rebind drafts; flag changed cells. */
  function applyNewView(raw, origin) {
    var next;
    try { next = M.prepareView(raw); } catch (e) { addNotice('error', '新数据无法加载', e.message); return; }
    if (next.project.id !== app.view.project.id) { addNotice('error', '新数据属于其他项目', next.project.id + ' ≠ ' + app.view.project.id + '，未加载。'); return; }
    var changed = [];
    next.cells.forEach(function (c) {
      var old = app.view.cellsById.get(c.id);
      var a = old && old.capture ? old.capture.id : null, b = c.capture ? c.capture.id : null;
      if (!old || a !== b) changed.push(c.id);
      else if (old && JSON.stringify(old.raw.aiReviews || []) !== JSON.stringify(c.raw.aiReviews || [])) changed.push(c.id);
    });
    app.view = next;
    changed.forEach(function (id) { app.newEvidenceCells.add(id); });
    if (app.queue) app.queue = Object.freeze({ ids: Object.freeze(app.queue.ids.filter(function (id) { return next.cellsById.has(id); })), createdAt: app.queue.createdAt, preset: app.queue.preset, filter: app.queue.filter });
    if (changed.length) addNotice('info', '已加载新证据', changed.length + ' 个格子的证据或 AI 意见有更新（来源：' + origin + '）。正在编辑的意见保持绑定原证据版本。', 'new-evidence');
    renderAll({ keepReview: true });
  }

  function onExternalDraftChange(key, value) {
    var mine = app.drafts.get(key);
    if (value) app.drafts.set(key, value); else app.drafts.delete(key);
    if (app.editor && app.editor.key === key) {
      var ta = $('comment');
      if (app.editor.dirty || app.conflicts.has(key)) {
        // keep the unsaved text; never replace it with the other tab's version
        app.editor.mine = ta ? ta.value : app.editor.mine;
        clearTimeout(app.editor.timer); app.editor.dirty = false;
        app.conflicts.set(key, value);
        setSaveState(key, 'conflict', '另一个标签页改了这条意见');
      } else if (value) {
        app.editor.baseRev = value.rev;
      }
      var hadFocus = document.activeElement && document.activeElement.id === 'comment';
      renderPanel();
      if (hadFocus && $('comment')) $('comment').focus();
    }
    refreshCounts();
    updateTile(key.split('@')[0]);
  }
  function stripRev(d) { var c = Object.assign({}, d); delete c.rev; return c; }

  // ---------------------------------------------------------------- static wiring
  function wireStatic() {
    $('reviewer').addEventListener('input', function (e) {
      app.reviewer = e.target.value.trim(); e.target.classList.remove('needs-value');
      if (app.local) app.local.setMeta({ reviewer: app.reviewer });
    });
    $('btn-copy').addEventListener('click', copyAll);
    $('btn-export').addEventListener('click', exportJson);
    $('btn-import').addEventListener('click', function () { $('import-file').value = ''; $('import-file').click(); });
    $('import-file').addEventListener('change', function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) readFile(f).then(openImport); });
    $('btn-submit').addEventListener('click', openSubmit);
    $('btn-help').addEventListener('click', openHelp);
    $('btn-start-queue').addEventListener('click', startOrContinueQueue);
    $('btn-reset-filters').addEventListener('click', function () { setFilter(M.defaultFilter()); });
    $('filter-text').addEventListener('input', debounce(function (e) { app.filter.text = e.target.value.trim(); filterChanged(); }, 150));
    $('matrix-zoom').addEventListener('input', function (e) { app.zoom = Number(e.target.value) || 1; app.local && app.local.setMeta({ zoom: app.zoom }); renderMatrix(); });
    $('btn-back-matrix').addEventListener('click', function () { closeReview(); });
    $('btn-prev').addEventListener('click', function () { step(-1); });
    $('btn-next').addEventListener('click', function () { step(1); });
    $('data-file').addEventListener('change', function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) readFile(f).then(function (t) { var p = M.parseJSONLocated(t); if (p.error) showLoadError(new Error(p.error)); else { clearLoadError(); if (app.view) applyNewView(p.value, '文件 ' + f.name); else start(p.value, 'static'); } }); });
    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', routeFromHash);
    window.addEventListener('beforeunload', function (e) {
      if (app.editor && app.editor.dirty) { flushSync(); }
      var pending = Array.from(app.saveStates.values()).some(function (s) { return s.status === 'saving' || s.status === 'error' || s.status === 'conflict'; });
      if (pending) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden && app.editor && app.editor.dirty) flushComment(); });
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; }
  function readFile(f) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result)); }; r.onerror = function () { rej(r.error); }; r.readAsText(f); }); }

  // ---------------------------------------------------------------- notices
  function addNotice(kind, title, body, id, actions) {
    var box = $('notices');
    if (id) { var old = box.querySelector('[data-notice="' + id + '"]'); if (old) old.remove(); }
    var n = h('div', { class: 'notice ' + kind, 'data-notice': id || null, role: kind === 'error' ? 'alert' : null },
      h('strong', { text: title }), h('span', { text: body }),
      h('span', { class: 'notice-actions' }, actions || null,
        h('button', { type: 'button', class: 'btn btn-ghost btn-small', 'aria-label': '关闭提示', onclick: function () { n.remove(); } }, '×')));
    box.appendChild(n);
    return n;
  }

  function showNoData() {
    clear($('notices'));
    var box = h('div', { class: 'load-error', role: 'alert' },
      h('h2', { text: '没有找到 review 数据' }),
      h('p', null, '这个页面是验收矩阵的界面本身。证据数据由 core 导出（', h('code', { text: 'review-data.js' }), ' / ', h('code', { text: 'review.json' }), '）或由本地 review 服务提供（', h('code', { text: 'GET /api/review' }), '）。'),
      h('p', null, '若你手上有导出的 review.json，可直接打开：'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { $('data-file').click(); } }, '打开 review.json'));
    var m = $('matrix-scroll'); clear(m); m.appendChild(box);
    $('storage-badge').textContent = '未加载'; $('storage-badge').className = 'storage-badge none';
  }
  function showLoadError(e) {
    var box = h('div', { class: 'load-error', role: 'alert', id: 'load-error' },
      h('h2', { text: '无法加载 review 数据' }), h('pre', { text: String(e && e.message || e) }),
      (e && e.details) ? h('ul', null, e.details.map(function (d) { return h('li', { text: d }); })) : null,
      h('button', { type: 'button', class: 'btn', onclick: function () { $('data-file').click(); } }, '打开其他 review.json'));
    var m = $('matrix-scroll'); clear(m); m.appendChild(box);
  }
  function clearLoadError() { var e = $('load-error'); if (e) e.remove(); }

  // ---------------------------------------------------------------- render all
  function renderAll(opts) {
    var v = app.view;
    $('project-name').textContent = (v.project.name || v.project.id) + ' · 验收矩阵';
    $('target-summary').textContent = 'spec ' + (v.spec.revision || '—') + ' · build ' + (v.target.buildId || '—') + ' · runtime ' + (v.target.runtimeId || '—') + (v.generatedAt ? ' · 生成 ' + fmtTime(v.generatedAt) : '') +
      (v.summary ? ' · AI 通过 ' + v.summary.aiPass + '/' + v.summary.total + (v.summary.finalAIPass ? '（全部当前）' : '') + ' · 人工通过 ' + v.summary.humanPass : '');
    document.title = (v.project.name || v.project.id) + ' · 验收矩阵';
    renderStorageBadge();
    renderStartupNotices();
    renderSidebar();
    renderMatrix();
    refreshCounts();
    if (opts && opts.keepReview && app.activeId && !$('review').hidden) renderReview();
  }

  function renderStorageBadge() {
    var b = $('storage-badge');
    if (app.mode === 'server') {
      b.className = 'storage-badge server';
      b.textContent = '本地服务保存 · ' + location.host;
      b.title = '草稿写入本地 review 服务（' + location.host + '，项目 ' + app.view.project.id + '），浏览器 localStorage 仅作崩溃恢复镜像。单人本地审核，不是多人协作。点击“提交给 Pi”才会通知 Pi。';
    } else if (app.local && app.local.available) {
      b.className = 'storage-badge local';
      b.textContent = '仅此浏览器 · 草稿未共享';
      b.title = '静态包：草稿只保存在当前浏览器的 localStorage（' + location.origin + location.pathname + '，项目 ' + app.view.project.id + '）。其他浏览器/他人看不到；不会自动发给 Pi。用“导出 JSON”或“复制人审意见”交付。';
    } else {
      b.className = 'storage-badge none';
      b.textContent = '无法保存草稿';
      b.title = '浏览器禁止 localStorage：' + (app.local && app.local.availabilityError);
    }
  }

  function renderStartupNotices() {
    var v = app.view;
    var nonReal = v.cells.filter(function (c) { return c.capture && !c.provenance.real; });
    if (nonReal.length) addNotice('fixture', 'FIXTURE / 非真实 App 证据', '本数据中有 ' + nonReal.length + ' 个格子的证据不是来自真实运行的 App（' + (nonReal[0].provenance.detail || 'fixture') + '）。它们只能用来检查审核界面，不能作为 App 验收结果。', 'fixture');
    if (app.mode === 'static' && app.local.available) {
      var meta = app.local.getMeta();
      if (!meta.staticNoticeDismissed) {
        var n = addNotice('warn', '静态包', '你的意见只保存在这个浏览器里，不会自动发给 Pi，也不会被他人看到。完成后用“提交给 Pi”导出批次 JSON，或“复制人审意见”。', 'static',
          h('button', { type: 'button', class: 'btn btn-small', onclick: function () { app.local.setMeta({ staticNoticeDismissed: true }); n.remove(); } }, '知道了'));
      }
    }
    if (app.local && !app.local.available) addNotice('error', '无法保存草稿', '浏览器禁止了 localStorage（' + app.local.availabilityError + '）。请勿在此页面长时间写评论；改用本地 review 服务。', 'nostore');
    if (app.serverError) addNotice('error', '本地服务', app.serverError, 'server-error');
    addPendingNotice();
    if (v.historicalHumanReviews.length) addNotice('info', '已移除格子的历史人工意见', v.historicalHumanReviews.length + ' 条意见属于当前 spec 已移除的格子，已标为旧版保留，不会转绑。', 'historical',
      h('button', { type: 'button', class: 'btn btn-small', onclick: showHistorical }, '查看'));
    var orphans = 0;
    app.drafts.forEach(function (d) { var c = v.cellsById.get(d.cellId); if (!c || (d.captureId && !v.captureById.has(d.captureId))) orphans++; });
    if (orphans) addNotice('warn', '有草稿不在当前数据中', orphans + ' 条草稿所属的格子或证据版本不在当前数据里。它们仍被保留，会出现在导出 JSON 中，但不会被转绑到其他证据。', 'orphans');
  }

  // ---------------------------------------------------------------- sidebar / filters
  function setFilter(f) { app.filter = f; $('filter-text').value = f.text || ''; filterChanged(); }
  function filterChanged() {
    app.local && app.local.setMeta({ filter: app.filter });
    renderSidebar(); renderMatrix();
  }

  var FACETS = [
    { key: 'ai', title: 'AI 结论', values: function () { return ['fail', 'question', 'pass', 'stale', 'none']; }, label: function (v) { return AI_LABEL[v]; }, of: function (c) { return [c.aiVerdict]; } },
    { key: 'human', title: '人工', values: function () { return ['pending', 'reopen', 'needs-change', 'blocked', 'not-applicable', 'question', 'pass']; }, label: function (v) { return HUMAN_LABEL[v]; }, of: function (c, hs) { return [hs.state]; } },
    { key: 'evidence', title: '证据', values: function () { return ['missing', 'blocked', 'process-gap', 'broken', 'orientation', 'captured']; }, label: function (v) { return EVIDENCE_LABEL[v]; }, of: function (c) { return M.evidenceFacets(c, app.broken); } },
    { key: 'scenario', title: '场景', values: function () { return Array.from(app.view.scenarios.keys()); }, label: function (v) { var s = app.view.scenarios.get(v); return s ? s.label : v; }, of: function (c) { return [c.scenarioId]; } },
    { key: 'device', title: '设备 / 方向', values: function () { return app.view.columns.map(function (c) { return c.key; }); }, label: function (v) { var c = app.view.columns.find(function (x) { return x.key === v; }); return c ? c.device.label + ' · ' + M.orientationLabel(c.orientation) : v; }, of: function (c) { return [c.colKey]; } },
    { key: 'kind', title: '类型', values: function () { return ['state', 'transition']; }, label: function (v) { return KIND_LABEL[v]; }, of: function (c) { return [c.kind]; } },
    { key: 'state', title: '状态 / 过渡', values: function () { return Array.from(app.view.states.keys()); }, label: function (v) { var s = app.view.states.get(v); return s ? s.label : v; }, of: function (c) { return [c.stateId]; } }
  ];

  function renderSidebar() {
    var v = app.view, f = app.filter;
    var hsCache = new Map(v.cells.map(function (c) { return [c.id, hsOf(c)]; }));
    // presets
    var pres = clear($('presets'));
    Object.keys(M.PRESETS).forEach(function (k) {
      var probe = Object.assign({}, M.defaultFilter(), { preset: k, variant: f.variant });
      var n = v.cells.filter(function (c) { return M.matchesFilter(c, hsCache.get(c.id), probe, app.broken); }).length;
      pres.appendChild(h('button', { type: 'button', class: 'preset', 'aria-pressed': String(f.preset === k), title: M.PRESETS[k].hint, onclick: function () { app.filter.preset = k; filterChanged(); } },
        h('span', { text: M.PRESETS[k].label }), h('span', { class: 'n', text: String(n) })));
    });
    // facets
    var box = $('facets');
    var openState = {}; box.querySelectorAll('details[data-facet]').forEach(function (d) { openState[d.dataset.facet] = d.open; });
    clear(box);
    FACETS.forEach(function (fd) {
      var values = fd.values();
      if (values.length < 2 && fd.key !== 'ai' && fd.key !== 'human' && fd.key !== 'evidence') return;
      var without = Object.assign({}, f); without[fd.key] = [];
      var counts = {}; values.forEach(function (x) { counts[x] = 0; });
      v.cells.forEach(function (c) {
        var hs = hsCache.get(c.id);
        if (!M.matchesFilter(c, hs, without, app.broken)) return;
        fd.of(c, hs).forEach(function (x) { if (x in counts) counts[x]++; });
      });
      var active = f[fd.key] || [];
      var det = h('details', { class: 'facet', 'data-facet': fd.key, open: openState[fd.key] !== undefined ? openState[fd.key] : (active.length > 0 || ['ai', 'human', 'evidence'].indexOf(fd.key) >= 0) },
        h('summary', null, h('span', null, fd.title, active.length ? h('span', { class: 'active-n', text: '(' + active.length + ')' }) : null)));
      values.forEach(function (x) {
        var id = 'f-' + fd.key + '-' + x.replace(/[^A-Za-z0-9_-]/g, '_');
        var cb = h('input', { type: 'checkbox', id: id, checked: active.indexOf(x) >= 0, onchange: function (e) {
          var list = (app.filter[fd.key] || []).slice();
          if (e.target.checked) list.push(x); else list = list.filter(function (y) { return y !== x; });
          app.filter[fd.key] = list; filterChanged();
          var again = document.getElementById(id); if (again) again.focus();
        } });
        det.appendChild(h('label', { class: 'facet-option' + (counts[x] ? '' : ' zero'), for: id }, cb, h('span', { text: fd.label(x) }), h('span', { class: 'n', text: String(counts[x]) })));
      });
      box.appendChild(det);
    });
    renderQueueInfo(hsCache);
    renderVariantTabs();
  }

  function filteredCells() {
    return app.view.cells.filter(function (c) { return M.matchesFilter(c, hsOf(c), app.filter, app.broken); });
  }

  function renderQueueInfo() {
    var info = clear($('queue-info'));
    var n = filteredCells().length;
    var btn = $('btn-start-queue');
    if (!app.queue || !app.queue.ids.length) {
      btn.textContent = '逐项审核当前筛选（' + n + ' 项）';
      btn.disabled = n === 0;
      info.appendChild(h('span', { text: '队列会冻结当前筛选结果的格子 ID；之后改筛选不会让队列跳项。' }));
      return;
    }
    var st = M.queueStats(app.queue, resolvedFn);
    btn.disabled = false;
    btn.textContent = st.done < st.total ? '继续审核队列（剩 ' + (st.total - st.done) + ' 项）' : '队列已完成 · 查看';
    info.appendChild(h('div', null, '冻结队列：' + st.done + '/' + st.total + ' 已决定 · ' + (M.PRESETS[app.queue.preset] ? M.PRESETS[app.queue.preset].label : '') + ' · ' + fmtClock(new Date(app.queue.createdAt))));
    if (JSON.stringify(app.queue.filter) !== JSON.stringify(app.filter)) {
      info.appendChild(h('div', { class: 'stale-queue' }, '筛选已改变，队列仍按冻结时的 ' + app.queue.ids.length + ' 项进行。'));
      info.appendChild(h('button', { type: 'button', class: 'btn btn-small', onclick: function () { freezeQueue(); renderSidebar(); renderMatrix(); } }, '按当前筛选重建队列（' + n + ' 项）'));
    }
    info.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: function () { app.queue = null; app.sessionSlot.set(null); renderSidebar(); renderMatrix(); } }, '结束队列'));
  }

  function freezeQueue(prependId) {
    var q = M.createQueue(app.view, app.drafts, app.filter, app.broken);
    if (prependId && q.ids.indexOf(prependId) < 0) q = Object.freeze({ ids: Object.freeze([prependId].concat(q.ids)), createdAt: q.createdAt, preset: q.preset, filter: q.filter });
    app.queue = q; app.sessionSlot.set({ ids: q.ids, createdAt: q.createdAt, preset: q.preset, filter: q.filter });
    return q;
  }

  function startOrContinueQueue() {
    if (!app.queue || !app.queue.ids.length) freezeQueue();
    if (!app.queue.ids.length) return;
    var id = M.queueFirstUnresolved(app.queue, resolvedFn) || app.queue.ids[0];
    openCell(id, { push: true });
  }

  function renderVariantTabs() {
    var box = clear($('variant-tabs'));
    var vs = app.view.variantList;
    if (vs.length < 2) { box.hidden = true; return; }
    box.hidden = false;
    var sel = app.filter.variant && app.filter.variant.length === 1 ? app.filter.variant[0] : null;
    function tab(id, label, title) {
      return h('button', { type: 'button', role: 'tab', class: 'variant-tab', 'aria-selected': String(sel === id), title: title || null, onclick: function () { app.filter.variant = id ? [id] : []; filterChanged(); } }, label);
    }
    box.appendChild(tab(null, '全部变体'));
    vs.forEach(function (v) { box.appendChild(tab(v.id, v.label, variantDesc(v))); });
  }
  function variantDesc(v) {
    var parts = [];
    if (v.language) parts.push('语言 ' + v.language);
    if (v.theme) parts.push('主题 ' + v.theme);
    if (v.fontScale !== undefined && v.fontScale !== null) parts.push('字体 ×' + v.fontScale);
    return parts.join(' · ');
  }

  // ---------------------------------------------------------------- matrix
  function columnBox(col, scale) {
    var s = col.size || (col.orientation === 'landscape' ? { w: 2340, h: 1080 } : { w: 1080, h: 2340 });
    return { w: Math.max(28, Math.round(s.w * scale)), h: Math.max(28, Math.round(s.h * scale)), known: !!col.size };
  }
  // One width per column, derived only from the preview box (slider × pixel
  // ratio). Header, tiles and placeholders all use it, so device labels and
  // metadata wrap inside the column instead of widening it.
  function columnWidth(b) { return Math.max(b.w + 10, 96); }
  function columnTitle(col) {
    return [col.device.label, M.orientationLabel(col.orientation), col.device.platform, columnSizeText(col)].filter(Boolean).join('\n');
  }
  function columnSizeParts(col) {
    return col.size ? [col.size.w + '×' + col.size.h + ' px', col.sizeSource === 'spec' ? '' : '（截图）'].filter(Boolean) : ['尺寸未知'];
  }
  function columnSizeText(col) { return columnSizeParts(col).join(''); }
  function matrixScale() {
    var maxDim = 1;
    app.view.columns.forEach(function (c) { if (c.size) maxDim = Math.max(maxDim, c.size.w, c.size.h); });
    if (maxDim === 1) maxDim = 2340;
    return 170 / maxDim * app.zoom;
  }

  function renderMatrix() {
    var v = app.view, table = clear($('matrix-table')), empty = $('matrix-empty');
    var hsCache = new Map(v.cells.map(function (c) { return [c.id, hsOf(c)]; }));
    var match = new Set(v.cells.filter(function (c) { return M.matchesFilter(c, hsCache.get(c.id), app.filter, app.broken); }).map(function (c) { return c.id; }));
    var variantSel = app.filter.variant && app.filter.variant.length ? app.filter.variant : null;
    var pool = v.cells.filter(function (c) { return !variantSel || variantSel.indexOf(c.variantId) >= 0; });
    var cols = v.columns.filter(function (col) { return pool.some(function (c) { return c.colKey === col.key && match.has(c.id); }); });
    var variants = v.variantList.filter(function (x) { return pool.some(function (c) { return c.variantId === x.id && match.has(c.id); }); });
    var total = v.cells.length;
    $('matrix-summary').textContent = '显示 ' + match.size + ' / ' + total + ' 格 · ' + v.rows.length + ' 行 × ' + v.columns.length + ' 列' + (v.variantList.length > 1 ? ' × ' + v.variantList.length + ' 变体' : '') + ' · 灰显格不在当前筛选内';
    renderLegend();
    if (!match.size) {
      table.hidden = true; empty.hidden = false; clear(empty);
      var allDone = app.filter.preset === 'attention' && total > 0;
      empty.appendChild(h('h2', { text: allDone ? '需关注的格子都已处理' : '当前筛选下没有格子' }));
      empty.appendChild(h('p', { text: allDone ? '没有 AI 疑问/失败、缺证据或人工未决的格子。可切换到“全部”或“已决定”复查。' : '调整左侧筛选，或重置为默认。' }));
      empty.appendChild(h('button', { type: 'button', class: 'btn', onclick: function () { app.filter.preset = 'all'; filterChanged(); } }, '显示全部'));
      return;
    }
    table.hidden = false; empty.hidden = true;
    var scale = matrixScale();
    var index = new Map(pool.map(function (c) { return [c.variantId + '|' + c.rowKey + '|' + c.colKey, c]; }));
    // header
    var trh = h('tr', null, h('th', { class: 'corner', scope: 'col' }, '场景 / 状态 ＼ 设备'));
    cols.forEach(function (col) {
      var b = columnBox(col, scale);
      var sil = Math.min(1, 30 / Math.max(b.w, b.h));
      // The clamped header is also the disclosure. Keep details in the existing
      // dialog shell so keyboard/touch access never needs a tile or wider column.
      trh.appendChild(h('th', { scope: 'col', title: columnTitle(col) },
        h('button', { type: 'button', class: 'col-head', 'data-col': col.key, 'aria-haspopup': 'dialog', 'aria-controls': 'device-dialog', title: '查看完整设备说明',
          style: { width: (columnWidth(b) + 8) + 'px' }, onclick: function () { openDeviceInfo(col); } },
          h('span', { class: 'col-silhouette' + (b.known ? '' : ' unknown'), style: { width: Math.round(b.w * sil) + 'px', height: Math.round(b.h * sil) + 'px' }, 'aria-hidden': 'true' }),
          h('span', { class: 'col-text' },
            h('strong', { class: 'col-label', text: col.device.label }),
            h('span', { class: 'col-platform' }, h('span', { class: 'orient', text: M.orientationLabel(col.orientation) }), ' ', col.device.platform || ''),
            h('span', { class: 'col-size' }, columnSizeParts(col).map(function (t) { return h('span', { text: t }); }))))));
    });
    table.appendChild(h('thead', null, trh));
    var tbody = h('tbody');
    var showVariantGroups = variants.length > 1 || (v.variantList.length > 1);
    var rIdx = 0;
    variants.forEach(function (variant) {
      if (showVariantGroups) tbody.appendChild(h('tr', { class: 'group-row variant-row' }, h('th', { colspan: String(cols.length + 1), scope: 'colgroup' }, '变体：' + variant.label + ' ', h('span', { class: 'muted', text: variantDesc(variant) }))));
      var lastScenario = null;
      v.rows.forEach(function (row) {
        var rowCells = cols.map(function (col) { return index.get(variant.id + '|' + row.key + '|' + col.key) || null; });
        if (!rowCells.some(function (c) { return c && match.has(c.id); })) return;
        if (row.scenarioId !== lastScenario) {
          lastScenario = row.scenarioId;
          tbody.appendChild(h('tr', { class: 'group-row' }, h('th', { colspan: String(cols.length + 1), scope: 'rowgroup' }, row.scenario.label + ' ', h('span', { class: 'muted', text: row.scenarioId }))));
        }
        var tr = h('tr', null, h('th', { class: 'row-head', scope: 'row' },
          h('span', { class: 'kind-badge ' + row.kind, text: row.kind === 'transition' ? '过渡' : '状态' }),
          h('span', { class: 'row-label', text: row.kind === 'transition' ? row.state.label : row.label }),
          row.kind === 'transition' ? h('span', { class: 'row-sub', text: row.label }) : null));
        rowCells.forEach(function (cell, ci) {
          var b = columnBox(cols[ci], scale);
          var td = h('td');
          if (!cell) td.appendChild(h('div', { class: 'not-in-spec', style: { width: columnWidth(b) + 'px', height: (b.h + 30) + 'px' }, text: '未列入 spec' }));
          else td.appendChild(tileFor(cell, hsCache.get(cell.id), b, match.has(cell.id), rIdx, ci));
          tr.appendChild(td);
        });
        tbody.appendChild(tr); rIdx++;
      });
    });
    table.appendChild(tbody);
  }

  function renderLegend() {
    var l = clear($('matrix-legend'));
    [['ai-fail', AI_SHORT.fail, '失败'], ['ai-question', AI_SHORT.question, '疑问'], ['ai-pass', AI_SHORT.pass, '通过'], ['ai-stale', AI_SHORT.stale, '针对旧证据，已失效'],
      ['h-pending', '待审', '当前证据无人工决定'], ['h-reopen', '需复审', '旧版证据上有人工意见'], ['ev-gap', '过程不足', '过渡只有终态，未验证过程']].forEach(function (x) {
      l.appendChild(h('span', null, h('span', { class: 'chip ' + x[0], text: x[1] }), x[2]));
    });
    l.appendChild(h('span', { text: '列宽按截图像素比例绘制；不同设备/方向不复用、不旋转图片。点列头查看完整设备说明。' }));
  }

  function tileFor(cell, hs, box, matched, r, c) {
    var inQueue = app.queue && app.queue.ids.indexOf(cell.id) >= 0;
    var cls = 'tile' + (matched ? '' : ' filtered-out') + (inQueue ? ' in-queue' : '') + (M.isResolved(hs) ? ' resolved' : '') + (app.activeId === cell.id ? ' active' : '');
    var tile = h('button', { type: 'button', class: cls, 'data-cell': cell.id, 'data-r': String(r), 'data-c': String(c), style: { width: columnWidth(box) + 'px' },
      'aria-label': tileLabel(cell, hs), onclick: function () { openFromMatrix(cell.id); } });
    tile.appendChild(thumbFor(cell, box));
    tile.appendChild(metaChips(cell, hs));
    return tile;
  }

  function tileLabel(cell, hs) {
    return [cell.scenario.label, M.rowLabel(app.view, cell), M.columnLabel(cell), cell.variant.label, AI_LABEL[cell.aiVerdict], '人工 ' + HUMAN_LABEL[hs.state], EVIDENCE_LABEL[cell.evidence], cell.processGap ? '过程证据不足' : ''].filter(Boolean).join('，');
  }

  function evidenceUrl(a) { return a && a.path ? a.path : null; }

  function thumbFor(cell, box) {
    var t = h('div', { class: 'thumb', style: { width: box.w + 'px', height: box.h + 'px' } });
    var fixture = cell.capture && !cell.provenance.real;
    if (cell.evidence === 'missing') {
      t.className += ' missing';
      append(t, [h('span', { class: 'ph-title', text: '缺证据' }), h('span', { class: 'ph-reason', text: cell.capture ? '证据无图片' : '尚未采集' })]);
      return t;
    }
    if (cell.evidence === 'blocked' && !cell.primary) {
      t.className += ' blocked';
      append(t, [h('span', { class: 'ph-title', text: '采集阻塞' }), h('span', { class: 'ph-reason', text: blockerText(cell.blockers) || '未给出原因' })]);
      return t;
    }
    var a = cell.primary, url = evidenceUrl(a);
    if (!url || app.brokenAssets.has(url)) { t.className += ' broken'; append(t, [h('span', { class: 'ph-title', text: '图片无法加载' }), h('span', { class: 'ph-reason', text: url || '无路径' })]); return t; }
    var img = h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', function () { markBroken(cell.id, url); });
    t.appendChild(img);
    if (fixture) t.appendChild(h('span', { class: 'fixture-ribbon', text: 'FIXTURE' }));
    if (cell.evidence === 'blocked') t.appendChild(h('span', { class: 'overlay gap', text: '受阻 · ' + (blockerText(cell.blockers) || '见详情') }));
    if (cell.kind === 'transition') {
      var fr = cell.assets.frames;
      if (fr.length > 1) {
        var strip = h('span', { class: 'frames-strip', 'aria-hidden': 'true' });
        fr.slice(0, 12).forEach(function () { strip.appendChild(h('i')); });
        t.appendChild(strip);
      }
      if (cell.processGap) t.appendChild(h('span', { class: 'overlay gap', text: '过程证据不足 · 未验证' }));
      else t.appendChild(h('span', { class: 'overlay', text: (fr.length ? fr.length + ' 帧 · ' + (fr[fr.length - 1].offsetMs || 0) + 'ms' : '') + (cell.assets.videos.length ? ' · 视频' : '') }));
    }
    return t;
  }

  function blockerText(list) {
    return (list || []).map(function (b) { return typeof b === 'string' ? b : (b && (b.reason || b.description || b.message || b.code)) || JSON.stringify(b); }).join('；');
  }

  function metaChips(cell, hs) {
    var box = h('div', { class: 'tile-meta' });
    box.appendChild(h('span', { class: 'chip ai-' + cell.aiVerdict, text: AI_SHORT[cell.aiVerdict], title: AI_LABEL[cell.aiVerdict] }));
    var hc = h('span', { class: 'chip h-' + hs.state + (hs.source === 'draft' && !hs.submitted ? ' draft-dot' : ''), text: HUMAN_LABEL[hs.state], title: hs.source === 'draft' ? (hs.submitted ? '已提交' : '草稿，尚未提交给 Pi') : '' });
    box.appendChild(hc);
    if (cell.evidence === 'blocked' && cell.primary) box.appendChild(h('span', { class: 'chip ev-blocked', text: '受阻' }));
    if (cell.processGap) box.appendChild(h('span', { class: 'chip ev-gap', text: '过程不足' }));
    if (cell.coreStatus === 'stale') box.appendChild(h('span', { class: 'chip ai-stale', text: '证据过期', title: cell.staleReasons.join('；') }));
    if (cell.orientationMismatch) box.appendChild(h('span', { class: 'chip ev-orient', text: '方向不符' }));
    if (cell.version > 1) box.appendChild(h('span', { class: 'chip version', text: 'v' + cell.version, title: '第 ' + cell.version + ' 版证据' }));
    if (cell.capture && !cell.provenance.real) box.appendChild(h('span', { class: 'chip fixture', text: 'FIXTURE' }));
    if (app.newEvidenceCells.has(cell.id)) box.appendChild(h('span', { class: 'chip local', text: '新' }));
    return box;
  }

  function updateTile(cellId) {
    var el = document.querySelector('.tile[data-cell="' + cssEsc(cellId) + '"]');
    var cell = app.view && app.view.cellsById.get(cellId);
    if (!el || !cell) return;
    var hs = hsOf(cell);
    var meta = el.querySelector('.tile-meta'); if (meta) meta.replaceWith(metaChips(cell, hs));
    el.classList.toggle('resolved', M.isResolved(hs));
    el.classList.toggle('active', app.activeId === cellId);
    el.setAttribute('aria-label', tileLabel(cell, hs));
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'); }

  function markBroken(cellId, url) {
    if (app.brokenAssets.has(url)) return;
    app.brokenAssets.add(url); app.broken.add(cellId);
    var el = document.querySelector('.tile[data-cell="' + cssEsc(cellId) + '"] .thumb');
    if (el) { el.className = 'thumb broken'; clear(el); append(el, [h('span', { class: 'ph-title', text: '图片无法加载' }), h('span', { class: 'ph-reason', text: url })]); }
    scheduleSidebar();
  }
  var scheduleSidebar = debounce(function () { renderSidebar(); }, 200);

  // ---------------------------------------------------------------- routing
  function openFromMatrix(id) {
    if (!app.queue || app.queue.ids.indexOf(id) < 0) freezeQueue(id);
    openCell(id, { push: true });
  }
  function routeFromHash() {
    if (!app.view) return;
    var m = /#cell=([^&]+)/.exec(location.hash);
    if (m) {
      var id = decodeURIComponent(m[1]);
      if (app.view.cellsById.has(id)) { if (app.activeId !== id || $('review').hidden) openCell(id, { fromHistory: true }); return; }
    }
    if (!$('review').hidden) closeReview({ fromHistory: true });
  }

  function openCell(id, opts) {
    opts = opts || {};
    return flushComment().then(function (r) {
      if (r && r.error && !r.draft && !confirm('当前评论未能保存（' + r.error + '）。仍要离开吗？')) return;
      stopPlay();
      var cell = app.view.cellsById.get(id);
      if (!cell) return;
      app.activeId = id;
      app.boundCaptureId = opts.captureId !== undefined ? opts.captureId : (cell.capture ? cell.capture.id : null);
      app.frameIndex = 0;
      app.newEvidenceCells.delete(id);
      setupEditor(cell);
      var hash = '#cell=' + encodeURIComponent(id);
      if (!opts.fromHistory) {
        if ($('review').hidden || opts.push) history.pushState({ cell: id }, '', hash); else history.replaceState({ cell: id }, '', hash);
      }
      $('review').hidden = false; $('layout').setAttribute('aria-hidden', 'true');
      document.body.style.overflow = 'hidden';
      renderReview();
      var first = $('panel').querySelector('.decision[aria-pressed="true"]') || $('panel').querySelector('.decision');
      if (first && !opts.keepFocus) first.focus({ preventScroll: true });
    });
  }

  function closeReview(opts) {
    opts = opts || {};
    return flushComment().then(function () {
      stopPlay();
      var id = app.activeId;
      $('review').hidden = true; $('layout').removeAttribute('aria-hidden'); document.body.style.overflow = '';
      app.editor = null; app.activeId = null;
      if (!opts.fromHistory && /#cell=/.test(location.hash)) history.pushState({}, '', location.pathname + location.search);
      renderSidebar(); renderMatrix();
      var t = id && document.querySelector('.tile[data-cell="' + cssEsc(id) + '"]');
      if (t) { t.focus(); t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    });
  }

  function step(dir) {
    if (!app.activeId) return;
    var id = M.queueAdjacent(app.queue, app.activeId, dir);
    if (id) openCell(id); else announce(dir > 0 ? '已是队列最后一项' : '已是队列第一项');
  }

  function announce(msg) { var g = $('global-save'); g.textContent = msg; g.className = 'save-status'; setTimeout(refreshGlobalSave, 2500); }

  // ---------------------------------------------------------------- editor / saving
  function setupEditor(cell) {
    var key = M.draftKey(cell.id, app.boundCaptureId);
    var d = app.drafts.get(key);
    app.editor = { key: key, cellId: cell.id, captureId: app.boundCaptureId, baseRev: d ? d.rev : 0, dirty: false, timer: null, chain: Promise.resolve({ ok: true }) };
  }

  function currentDraft() {
    var ed = app.editor, cell = app.view.cellsById.get(ed.cellId);
    return app.drafts.get(ed.key) || M.newDraft(cell, ed.captureId, nowIso());
  }

  function setSaveState(key, status, msg) {
    app.saveStates.set(key, { status: status, msg: msg || '', at: new Date() });
    if (status === 'saved') app.lastSaveAt = new Date();
    if (app.editor && app.editor.key === key) {
      var el = document.getElementById('save-state');
      if (el) { el.className = 'state ' + status; el.textContent = saveStateText(app.saveStates.get(key)); }
    }
    refreshGlobalSave();
  }
  function saveStateText(s) {
    if (!s) return '';
    switch (s.status) {
      case 'dirty': return '有未保存的修改…';
      case 'saving': return '保存中…';
      case 'saved': return '已保存 ' + fmtClock(s.at) + (app.mode === 'server' ? '（本地服务）' : '（仅此浏览器）');
      case 'error': return '保存失败：' + s.msg;
      case 'conflict': return '版本冲突：' + s.msg;
      default: return s.msg;
    }
  }
  function refreshGlobalSave() {
    var g = $('global-save'); if (!g) return;
    var errs = 0, saving = 0, conflicts = 0;
    app.saveStates.forEach(function (s) { if (s.status === 'error') errs++; else if (s.status === 'saving' || s.status === 'dirty') saving++; else if (s.status === 'conflict') conflicts++; });
    if (errs || conflicts) { g.className = 'save-status error'; g.textContent = (errs ? errs + ' 条保存失败 ' : '') + (conflicts ? conflicts + ' 条冲突' : ''); }
    else if (saving) { g.className = 'save-status saving'; g.textContent = '保存中…'; }
    else if (app.lastSaveAt) { g.className = 'save-status saved'; g.textContent = '全部已保存 ' + fmtClock(app.lastSaveAt); }
    else { g.className = 'save-status'; g.textContent = ''; }
  }

  /** Persist one draft (local first, then server). Resolves {ok}|{conflict}|{error}. */
  function persistDraft(key, draft, baseRev, opts) {
    var r = app.local.save(key, draft, baseRev, opts);
    if (r.conflict) { app.conflicts.set(key, r.theirs); setSaveState(key, 'conflict', '这条意见已在别处被修改'); return Promise.resolve(r); }
    if (r.error) { setSaveState(key, 'error', r.error); return Promise.resolve(r); }
    app.drafts.set(key, r.draft);
    if (app.mode !== 'server') { setSaveState(key, 'saved'); return Promise.resolve({ ok: true, draft: r.draft }); }
    setSaveState(key, 'saving');
    return app.pusher().then(function () { setSaveState(key, 'saved'); app.serverError = null; return { ok: true, draft: r.draft }; },
      function (e) { setSaveState(key, 'error', '本地服务未保存（' + e.message + '）；已存浏览器镜像'); return { error: e.message, draft: r.draft }; });
  }

  function saveEditor(patch) {
    var ed = app.editor; if (!ed) return Promise.resolve({ ok: true });
    var key = ed.key;
    var next = Object.assign({}, currentDraft(), patch, { updatedAt: nowIso() });
    return persistDraft(key, next, ed.baseRev).then(function (r) {
      if (r.draft && app.editor && app.editor.key === key) app.editor.baseRev = r.draft.rev;
      updateTile(ed.cellId); refreshCounts();
      if (r.conflict && app.editor && app.editor.key === key) { app.editor.mine = next.comment; renderHumanSection(); }
      return r;
    });
  }

  function onCommentInput() {
    var ed = app.editor; if (!ed) return;
    if (app.conflicts.has(ed.key)) { ed.mine = $('comment').value; var pre = $('panel').querySelectorAll('.conflict-box pre')[1]; if (pre) pre.textContent = ed.mine; return; }
    ed.dirty = true; setSaveState(ed.key, 'dirty');
    var ta = $('comment'); ta.classList.remove('required-missing'); var fe = $('comment-error'); if (fe) fe.textContent = '';
    clearTimeout(ed.timer); ed.timer = setTimeout(flushComment, 600);
  }
  function flushComment() {
    var ed = app.editor; if (!ed) return Promise.resolve(null);
    clearTimeout(ed.timer);
    if (!ed.dirty) return ed.chain;
    ed.dirty = false;
    var ta = $('comment'); var value = ta ? ta.value : currentDraft().comment;
    ed.chain = ed.chain.then(function () { return saveEditor({ comment: value }); });
    return ed.chain;
  }
  function flushSync() {
    var ed = app.editor; if (!ed || !ed.dirty) return;
    var ta = $('comment'); if (!ta) return;
    var next = Object.assign({}, currentDraft(), { comment: ta.value, updatedAt: nowIso() });
    var r = app.local.save(ed.key, next, ed.baseRev);
    if (r.ok) { app.drafts.set(ed.key, r.draft); ed.baseRev = r.draft.rev; ed.dirty = false; }
  }

  function decide(decision) {
    var ed = app.editor; if (!ed || app.busy) return Promise.resolve();
    if (app.conflicts.has(ed.key)) { $('panel').querySelector('.conflict-box') && $('panel').querySelector('.conflict-box').scrollIntoView(); return Promise.resolve(); }
    clearTimeout(ed.timer);
    var ta = $('comment'), comment = ta ? ta.value : '';
    var def = D[decision];
    if (def.needsComment && !comment.trim()) {
      ta.classList.add('required-missing'); $('comment-error').textContent = '“' + def.label + '”需要写明理由（会随意见提交给 Pi）。';
      ta.focus(); return Promise.resolve();
    }
    setBusy(true);
    ed.dirty = false;
    var cellId = ed.cellId;
    ed.chain = ed.chain.then(function () { return saveEditor({ decision: decision, comment: comment }); });
    return ed.chain.then(function (r) {
      setBusy(false);
      renderHumanSection();
      if (!r || !r.ok) return; // stay: error/conflict shown, queue does not move
      advanceAfterDecision(cellId);
    });
  }
  function clearDecision() {
    if (!app.editor) return;
    var ta = $('comment');
    app.editor.chain = app.editor.chain.then(function () { return saveEditor({ decision: null, comment: ta ? ta.value : '' }); });
    app.editor.chain.then(function () { renderHumanSection(); });
  }
  function setBusy(b) { app.busy = b; document.querySelectorAll('.decision').forEach(function (x) { x.disabled = b; }); }

  function advanceAfterDecision(cellId) {
    if (!app.queue || app.queue.ids.indexOf(cellId) < 0) { renderPanel(); return; }
    var next = M.queueNext(app.queue, cellId, resolvedFn);
    if (next) { openCell(next); return; }
    renderPanel();
    renderQueueDone();
  }

  function renderQueueDone() {
    var left = app.queue.ids.filter(function (id) { return !resolvedFn(id); });
    var box = h('div', { class: 'newer-box', role: 'status', id: 'queue-done' },
      h('strong', { text: left.length ? '已到队列末尾' : '队列已全部决定' }),
      h('span', { text: left.length ? '队列前面还有 ' + left.length + ' 项未决定。' : '冻结队列中的 ' + app.queue.ids.length + ' 项都已有当前证据上的人工决定。记得“提交给 Pi”。' }),
      h('span', null,
        left.length ? h('button', { type: 'button', class: 'btn btn-small', onclick: function () { openCell(left[0]); } }, '去第一项未决') : null, ' ',
        h('button', { type: 'button', class: 'btn btn-small', onclick: function () { closeReview(); } }, '返回矩阵'), ' ',
        h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: openSubmit }, '提交给 Pi')));
    var p = $('panel'); var old = $('queue-done'); if (old) old.remove();
    p.insertBefore(box, p.firstChild);
    box.querySelector('button').focus();
  }

  // ---------------------------------------------------------------- review render
  // Compare captures by ID: review data is JSON, so history/current are distinct objects.
  function isCurrentCap(cell, cap) { return !!(cap && cell.capture && cap.id === cell.capture.id); }
  function factsFor(cell, cap) { return M.captureFacts(cell.kind, cap, cap && cell.capture && cap.id === cell.capture.id ? cell.raw.blockers : null); }

  function boundCapture(cell) {
    if (!app.boundCaptureId) return null;
    var info = app.view.captureById.get(app.boundCaptureId);
    return info && info.cellId === cell.id ? info : null;
  }

  function renderReview() {
    var cell = app.view.cellsById.get(app.activeId);
    if (!cell) { closeReview(); return; }
    var pos = app.queue ? app.queue.ids.indexOf(cell.id) : -1;
    var qp = clear($('queue-position'));
    if (pos >= 0) {
      var st = M.queueStats(app.queue, resolvedFn);
      qp.appendChild(document.createTextNode((pos + 1) + ' / ' + app.queue.ids.length + ' · 已决定 ' + st.done));
      qp.appendChild(h('span', { class: 'qbar', 'aria-hidden': 'true' }, h('i', { style: { width: (st.done / Math.max(1, st.total) * 100) + '%' } })));
    } else qp.textContent = '不在队列中';
    $('btn-prev').disabled = !(pos > 0);
    $('btn-next').disabled = !(pos >= 0 && pos < app.queue.ids.length - 1);
    $('review-title').textContent = cell.scenario.label + ' › ' + M.rowLabel(app.view, cell) + ' — ' + M.columnLabel(cell);
    renderStage();
    renderPanel();
    document.querySelectorAll('.tile.active').forEach(function (t) { t.classList.remove('active'); });
  }

  function renderStage() {
    var cell = app.view.cellsById.get(app.activeId), stage = clear($('stage'));
    var info = boundCapture(cell), cap = info ? info.capture : null;
    var facts = factsFor(cell, cap);
    var head = h('div', { class: 'stage-head' },
      h('span', { class: 'dev', text: cell.device.label }),
      h('span', { class: 'orient', text: M.orientationLabel(cell.orientation) }),
      cell.device.platform ? h('span', { class: 'muted', text: cell.device.platform }) : null,
      cell.primary && cell.size ? h('span', { class: 'muted', text: cell.size.w + '×' + cell.size.h + ' px' }) : null,
      cap ? provChip(facts.provenance) : null,
      cap ? h('span', { class: 'chip version', text: '证据 v' + info.version + ' / ' + cell.captures.length }) : null,
      cell.variant ? h('span', { class: 'muted', text: '变体 ' + cell.variant.label }) : null);
    stage.appendChild(head);
    if (cap && cap.id !== (cell.capture && cell.capture.id)) stage.appendChild(h('div', { class: 'notice warn' }, h('strong', { text: '你正在看旧版证据' }), h('span', { text: '当前最新证据是 v' + cell.version + '。此处意见只绑定 v' + info.version + '。' })));
    if (facts.evidence === 'missing') { stage.appendChild(missingBox('missing', cap ? '证据中没有图片' : '缺证据：此格尚未采集', cap ? ['采集记录存在但没有任何图片/视频。'] : ['Spec 要求此格，但还没有对应设备/方向的真实 App 截图。不会用其他方向或旋转后的图填充。'])); return; }
    if (facts.evidence === 'blocked') {
      stage.appendChild(missingBox('blocked', facts.assets.all.length ? '证据受阻：以下图片不能作为通过依据' : '采集阻塞', facts.blockers.map(function (b) { return blockerText([b]); }).concat(facts.limitations.length ? ['限制：' + blockerText(facts.limitations)] : [])));
      if (!facts.assets.all.length) return;
    }
    if (cell.orientationMismatch && isCurrentCap(cell, cap)) stage.appendChild(h('div', { class: 'notice error' }, h('strong', { text: '方向不符' }), h('span', { text: '图片尺寸 ' + cell.size.w + '×' + cell.size.h + ' 与此列方向（' + M.orientationLabel(cell.orientation) + '）不一致，请检查采集是否用错设备状态。' })));
    if (cell.kind === 'transition') stage.appendChild(sequenceView(cell, cap, facts));
    else stage.appendChild(screensView(cell, cap, facts));
  }

  function provChip(p) {
    var cls = p.kind === 'fixture' ? 'fixture' : p.real ? (p.kind === 'device' ? 'real' : 'local') : 'ai-question';
    return h('span', { class: 'chip ' + cls, text: p.label + (p.controlledIO ? ' · 受控 IO' : ''), title: p.detail || '' });
  }

  function missingBox(kind, title, lines) {
    return h('div', { class: 'evidence-missing ' + kind, role: 'note' }, h('h3', { text: title }), lines && lines.length ? h('ul', null, lines.map(function (l) { return h('li', { text: l }); })) : null);
  }

  function shotFigure(cell, cap, asset, list, idx, provenance, maxH) {
    var url = evidenceUrl(asset);
    var fixture = provenance && !provenance.real;
    if (!url || app.brokenAssets.has(url)) return missingBox('broken', '图片无法加载', [asset.id + ' · ' + (url || '无路径'), 'sha256 ' + (asset.sha256 || '—')]);
    var img = h('img', { src: url, alt: cell.scenario.label + ' ' + M.rowLabel(app.view, cell) + ' ' + M.columnLabel(cell) + ' ' + (asset.kind || ''), style: maxH ? { 'max-height': maxH } : null });
    img.addEventListener('error', function () { markBroken(cell.id, url); renderStage(); });
    return h('figure', { class: 'figure' },
      h('div', { class: 'shot-frame' + (fixture ? ' fixture' : '') },
        h('button', { type: 'button', class: 'shot', title: '查看原图 (O)', 'aria-label': '查看原图', onclick: function () { openLightbox(cell, cap, list, idx); } }, img),
        fixture ? h('span', { class: 'fixture-stamp', text: 'FIXTURE · 非 App 证据' }) : null),
      h('figcaption', { class: 'figcaption', text: (asset.width ? asset.width + '×' + asset.height + ' px · ' : '') + (asset.capturedAt ? fmtTime(asset.capturedAt) : '') + ' · 点击看原图' }));
  }

  function screensView(cell, cap, facts) {
    var list = facts.assets.screens.length ? facts.assets.screens : facts.assets.frames;
    var wrap = h('div', { class: 'shot-list' });
    list.forEach(function (a, i) { wrap.appendChild(shotFigure(cell, cap, a, list, i, facts.provenance, list.length > 1 ? 'calc(100vh - 300px)' : null)); });
    facts.assets.videos.forEach(function (v) { wrap.appendChild(videoEl(v)); });
    return wrap;
  }

  function videoEl(v) {
    return h('figure', { class: 'figure' }, h('video', { class: 'evidence-video', src: evidenceUrl(v), controls: true, preload: 'metadata' }),
      h('figcaption', { class: 'figcaption', text: '录屏 ' + (v.durationMs ? (v.durationMs / 1000).toFixed(2) + 's' : '') + ' · 供人查看过程；AI 只审阅代表帧，不能据此声称测过流畅度' }));
  }

  function origin(cap, frames) {
    var t = cap && cap.transition && Date.parse(cap.transition.startedAt);
    if (isFinite(t)) return t;
    var f = frames[0] && Date.parse(frames[0].capturedAt);
    return isFinite(f) ? f - (Number(frames[0].offsetMs) || 0) : null;
  }

  function sequenceView(cell, cap, facts) {
    var frames = facts.assets.frames, videos = facts.assets.videos;
    var wrap = h('div', { class: 'seq' });
    var tr = cap.transition || {};
    var t0 = origin(cap, frames);
    var actions = (cap.actions || []).slice();
    var tx = facts.transition || { gaps: [], trigger: null };
    var from = app.view.states.get(tr.fromStateId || cell.state.fromStateId), to = app.view.states.get(tr.toStateId || cell.state.toStateId);
    wrap.appendChild(h('div', { class: 'seq-trigger' },
      h('span', { class: 'muted', text: '起' }), h('span', { class: 'seq-state', text: from ? from.label : '?' }), stateLink(cell, from),
      h('span', { class: 'arrow', text: '→' }),
      h('span', { class: 'muted', text: '止' }), h('span', { class: 'seq-state', text: to ? to.label : '?' }), stateLink(cell, to),
      h('span', { class: 'muted', text: ' · 触发：' }),
      tx.trigger ? h('span', { class: 'seq-action' }, h('strong', { text: tx.trigger.type || 'action' }), ' ', tx.trigger.description || '', t0 !== null && tx.trigger.at ? h('span', { class: 'muted', text: ' @' + rel(tx.trigger.at, t0) }) : null, tx.trigger.source ? h('span', { class: 'muted', text: '（' + tx.trigger.source + '）' }) : null)
        : h('strong', { class: 'trigger-missing', text: actions.length ? '未绑定触发动作' : '没有记录触发动作' }),
      actions.length > 1 ? h('span', { class: 'muted', text: ' · 另有 ' + (actions.length - (tx.trigger ? 1 : 0)) + ' 个动作' }) : null));
    if (facts.processGap) {
      wrap.appendChild(h('div', { class: 'seq-gap', role: 'note' }, h('strong', { text: '过程证据不足，不能据此验收过渡：' }),
        h('ul', null, tx.gaps.map(function (g) { return h('li', { text: g }); })),
        h('span', { text: '单张结束截图或仅有视频不能证明过渡过程。' + (videos.length ? '录屏仍可供人查看。' : '') })));
    }
    var dur = tr.startedAt && tr.endedAt ? Date.parse(tr.endedAt) - Date.parse(tr.startedAt) : (frames.length ? Number(frames[frames.length - 1].offsetMs) : null);
    var intervals = []; for (var i = 1; i < frames.length; i++) intervals.push(frames[i].offsetMs - frames[i - 1].offsetMs);
    wrap.appendChild(h('div', { class: 'seq-timing' },
      '开始 ' + fmtTime(tr.startedAt) + ' · 结束 ' + fmtTime(tr.endedAt) + (isFinite(dur) && dur !== null ? ' · 时长 ' + dur + 'ms' : ' · 时长未知') + ' · ' + frames.length + ' 帧' +
      (intervals.length ? ' · 帧间隔 ' + Math.min.apply(null, intervals) + '–' + Math.max.apply(null, intervals) + 'ms' : '') + ' · 稀疏帧不代表流畅度测量'));
    if (frames.length) {
      if (app.frameIndex >= frames.length) app.frameIndex = frames.length - 1;
      var cur = frames[app.frameIndex];
      wrap.appendChild(h('div', { class: 'seq-main' }, shotFigure(cell, cap, cur, frames, app.frameIndex, facts.provenance, facts.processGap ? 'max(240px, calc(100vh - 560px))' : 'max(260px, calc(100vh - 470px))')));
      var maxT = Math.max(1, Number(frames[frames.length - 1].offsetMs) || 1, dur || 0);
      var tl = h('div', { class: 'timeline', role: 'group', 'aria-label': '时间轴' }, h('div', { class: 'track' }));
      frames.forEach(function (f, i) {
        tl.appendChild(h('button', { type: 'button', class: 'tick' + (i === app.frameIndex ? ' current' : ''), style: { left: (f.offsetMs / maxT * 100) + '%' }, title: '帧 ' + (i + 1) + ' +' + f.offsetMs + 'ms', 'aria-label': '帧 ' + (i + 1) + ' +' + f.offsetMs + 'ms', onclick: function () { setFrame(i); } }));
      });
      if (t0 !== null) actions.forEach(function (a) { var o = Date.parse(a.at) - t0; if (isFinite(o) && o >= 0 && o <= maxT) tl.appendChild(h('span', { class: 'act' + (a === tx.trigger ? ' trigger' : ''), style: { left: (o / maxT * 100) + '%' }, title: (a === tx.trigger ? '触发 ' : '') + (a.type || '') + ' ' + (a.description || '') + ' +' + o + 'ms' })); });
      tl.appendChild(h('span', { class: 'scale', style: { left: '0' }, text: '0ms' }));
      tl.appendChild(h('span', { class: 'scale', style: { right: '0' }, text: maxT + 'ms' }));
      wrap.appendChild(tl);
      wrap.appendChild(h('div', { class: 'seq-controls' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: function () { setFrame(app.frameIndex - 1); }, disabled: app.frameIndex === 0 }, '‹ 上一帧'),
        h('button', { type: 'button', class: 'btn btn-small', id: 'btn-play', onclick: togglePlay }, app.playTimer ? '暂停' : '按时间回放'),
        h('button', { type: 'button', class: 'btn btn-small', onclick: function () { setFrame(app.frameIndex + 1); }, disabled: app.frameIndex === frames.length - 1 }, '下一帧 ›'),
        h('span', { class: 'muted', text: '帧 ' + (app.frameIndex + 1) + '/' + frames.length + ' · +' + cur.offsetMs + 'ms' + (cur.id === tx.startAssetId ? ' · 起始帧' : cur.id === tx.endAssetId ? ' · 结束帧' : '') + ' · ← → 切换' })));
      var strip = h('div', { class: 'filmstrip', role: 'list', 'aria-label': '按时间排列的帧' });
      frames.forEach(function (f, i) {
        var u = evidenceUrl(f);
        var inner = (!u || app.brokenAssets.has(u)) ? h('span', { class: 'ph', text: '无法加载' }) : h('img', { src: u, alt: '帧 ' + (i + 1), loading: 'lazy' });
        if (inner.tagName === 'IMG') inner.addEventListener('error', function () { markBroken(cell.id, u); });
        var role = f.id === tx.startAssetId ? '起 ' : f.id === tx.endAssetId ? '止 ' : '';
        strip.appendChild(h('button', { type: 'button', role: 'listitem', class: 'film' + (role ? ' endpoint' : ''), 'aria-current': String(i === app.frameIndex), 'aria-label': (role ? (role === '起 ' ? '起始帧 ' : '结束帧 ') : '') + '帧 ' + (i + 1) + ' +' + f.offsetMs + 'ms', onclick: function () { setFrame(i); } }, inner, h('span', { text: role + '+' + f.offsetMs + 'ms' })));
      });
      wrap.appendChild(strip);
    } else if (facts.assets.screens.length) {
      wrap.appendChild(screensView(cell, cap, facts));
    }
    videos.forEach(function (v) { wrap.appendChild(videoEl(v)); });
    return wrap;
  }
  function rel(at, t0) { var o = Date.parse(at) - t0; return isFinite(o) ? (o >= 0 ? '+' : '') + o + 'ms' : at; }

  function stateLink(cell, st) {
    if (!st) return null;
    var target = app.view.cells.find(function (c) { return c.stateId === st.id && c.colKey === cell.colKey && c.variantId === cell.variantId && c.scenarioId === cell.scenarioId; })
      || app.view.cells.find(function (c) { return c.stateId === st.id && c.colKey === cell.colKey && c.variantId === cell.variantId; });
    if (!target) return null;
    return h('button', { type: 'button', class: 'btn btn-ghost btn-small', title: '查看该状态的格子', onclick: function () { openCell(target.id, { push: true }); } }, '看格子');
  }

  function setFrame(i) {
    var cell = app.view.cellsById.get(app.activeId); if (!cell) return;
    var info = boundCapture(cell); var frames = factsFor(cell, info && info.capture).assets.frames;
    if (!frames.length) return;
    app.frameIndex = Math.max(0, Math.min(frames.length - 1, i));
    renderStage();
  }
  function togglePlay() {
    if (app.playTimer) { stopPlay(); renderStage(); return; }
    var cell = app.view.cellsById.get(app.activeId); var info = boundCapture(cell);
    var frames = factsFor(cell, info && info.capture).assets.frames; if (frames.length < 2) return;
    if (app.frameIndex >= frames.length - 1) app.frameIndex = 0;
    function tick() {
      if (app.frameIndex >= frames.length - 1) { stopPlay(); renderStage(); return; }
      var d = Math.max(16, frames[app.frameIndex + 1].offsetMs - frames[app.frameIndex].offsetMs);
      app.playTimer = setTimeout(function () { app.frameIndex++; renderStage(); tick(); }, d);
    }
    app.playTimer = -1; renderStage(); tick();
  }
  function stopPlay() { if (app.playTimer) clearTimeout(app.playTimer); app.playTimer = null; }

  // ---------------------------------------------------------------- panel
  function renderPanel() {
    var cell = app.view.cellsById.get(app.activeId), p = clear($('panel'));
    if (!cell) return;
    var info = boundCapture(cell), cap = info ? info.capture : null;
    var facts = factsFor(cell, cap);
    // title
    p.appendChild(h('section', null,
      h('h2', null, cell.scenario.label, h('span', { class: 'muted', text: ' › ' }), cell.kind === 'transition' ? M.rowLabel(app.view, cell) : cell.state.label),
      h('div', { class: 'title-chips' },
        h('span', { class: 'kind-badge ' + cell.kind, text: KIND_LABEL[cell.kind] }),
        h('span', { class: 'chip version', text: M.columnLabel(cell) }),
        h('span', { class: 'chip version', text: '变体 ' + cell.variant.label + (variantDesc(cell.variant) ? ' · ' + variantDesc(cell.variant) : '') }),
        cell.coreStatus ? h('span', { class: 'chip version', title: 'core 状态 ' + cell.staleReasons.join('; '), text: '状态 ' + cell.coreStatus }) : null),
      h('div', { class: 'cell-id' }, '格子 ID ', h('code', { text: cell.id }))));
    // provenance banner
    if (cap) {
      var pv = facts.provenance;
      var rn = runtimeNote(cap), pvDetail = (rn ? rn.replace(/^ · /, '') : '') + (pv.controlledIO ? (rn ? '\n' : '') + '受控 IO：' + pv.detail : '');
      p.appendChild(pv.kind === 'fixture' || !pvDetail ? h('div', { class: 'prov-banner ' + (pv.kind === 'fixture' ? 'fixture' : pv.real ? 'real' : 'unknown') },
        h('strong', { text: pv.kind === 'fixture' ? 'FIXTURE：' : pv.real ? '来源：' : '来源未确认：' }),
        pv.kind === 'fixture' ? '此证据不是来自真实运行的 App，只能用来测试审核界面，不得作为 App 验收通过。' : pv.label)
        : h('details', { class: 'prov-banner ' + (pv.real ? 'real' : 'unknown') },
          h('summary', null, h('strong', { text: pv.real ? '来源：' : '来源未确认：' }), pv.label + (pv.controlledIO ? ' · 受控 IO' : '')),
          h('div', { class: 'prov-detail', text: pvDetail })));
    }
    // newer evidence binding notice
    if (cell.capture && app.boundCaptureId !== cell.capture.id) {
      var draft = app.drafts.get(app.editor.key);
      p.appendChild(h('div', { class: 'newer-box', role: 'status' },
        h('strong', { text: '此格有更新的证据 v' + cell.version }),
        h('span', { text: '你正在编辑的意见绑定在 ' + (info ? 'v' + info.version : '无证据') + '，不会自动转到新版。' }),
        h('span', null,
          h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: function () { openCell(cell.id, { captureId: cell.capture.id }); } }, '切换到新证据 v' + cell.version),
          ' ', draft && draft.comment ? h('button', { type: 'button', class: 'btn btn-small', onclick: function () { carryText(cell, draft.comment); } }, '带着评论文字去新版（需重新决定）') : null)));
    }
    if (cap && cell.staleReasons.length && isCurrentCap(cell, cap)) p.appendChild(h('div', { class: 'notice warn' }, h('strong', { text: '失效原因' }), h('span', { text: cell.staleReasons.join('；') })));
    // spec
    var spec = h('section', null, h('h3', { text: '预期 · Checkpoints' }));
    spec.appendChild(h('dl', { class: 'kv' },
      h('dt', { text: '入口 / route' }), h('dd', null, cell.entry ? (typeof cell.entry === 'string' ? cell.entry : JSON.stringify(cell.entry)) : h('span', { class: 'muted', text: 'spec 未声明入口' })),
      cell.kind === 'transition' ? [h('dt', { text: '过渡' }), h('dd', { text: (cell.fromState ? cell.fromState.label : '?') + ' → ' + (cell.toState ? cell.toState.label : '?') })] : null));
    spec.appendChild(cell.checkpoints.length ? h('ol', { class: 'checkpoints' }, cell.checkpoints.map(function (c) { return h('li', { text: c }); })) : h('p', { class: 'muted', text: '没有 checkpoints' }));
    var capSec = h('section', { 'aria-label': '采集断言与限制' });
    if (cap && (cap.assertions || []).length) {
      capSec.appendChild(h('h3', { text: '采集断言（adapter 记录）' }));
      capSec.appendChild(h('ul', { class: 'assertions' }, cap.assertions.map(function (a) {
        var r = a.result === 'pass' ? 'pass' : a.result === 'fail' ? 'fail' : 'unknown';
        var st = a.stateId ? app.view.states.get(a.stateId) : null;
        return h('li', null, h('span', { class: 'res ' + r, text: r === 'pass' ? '✓' : r === 'fail' ? '✕' : '?' }), h('span', null, a.description || '', a.basis ? h('span', { class: 'muted', text: ' · ' + a.basis }) : null, a.stateId ? h('span', { class: 'muted', text: ' · 状态 ' + (st ? st.label : a.stateId) }) : null, (a.evidenceAssetIds || []).length ? h('span', { class: 'muted', text: ' · ' + a.evidenceAssetIds.join(', ') }) : null));
      })));
    }
    if (cap && (facts.limitations.length || facts.blockers.length)) {
      capSec.appendChild(h('h3', { text: '已知限制 / 阻塞' }));
      capSec.appendChild(h('ul', { class: 'limitations' }, facts.blockers.map(function (b) { return h('li', null, h('strong', { text: '阻塞：' }), blockerText([b])); }).concat(facts.limitations.map(function (l) { return h('li', { text: blockerText([l]) }); }))));
    }
    p.appendChild(spec);
    p.appendChild(aiSection(cell, cap));
    p.appendChild(h('section', { id: 'human-slot' }));
    renderHumanSection();
    if (capSec.childNodes.length) p.appendChild(capSec);
    p.appendChild(detailsSection(cell, cap, info, facts));
  }

  function runtimeNote(cap) {
    var rt = cap && app.view.runtimes.get(cap.runtimeId);
    if (!rt) return '';
    var parts = [];
    if (rt.app) parts.push((rt.app.id || '') + (rt.app.version ? ' ' + rt.app.version : ''));
    if (rt.fixture && rt.fixture.mode) parts.push(rt.fixture.mode === 'none' ? '无 fixture' : 'fixture ' + rt.fixture.mode + (rt.fixture.description ? '：' + rt.fixture.description : ''));
    return parts.length ? ' · ' + parts.join(' · ') : '';
  }

  function showHistorical() {
    var list = app.view.historicalHumanReviews;
    var body = h('ul', { class: 'import-list' }, list.map(function (r) {
      var dec = M.decisionOfRecord(r);
      return h('li', null, h('div', null, h('span', { class: 'chip h-' + (dec || 'pending'), text: HUMAN_LABEL[dec] || r.verdict }), ' ', h('code', { text: r.cellId }), h('span', { class: 'muted', text: ' · spec ' + (r.specRev || '—') + ' · ' + (r.reviewer || '') + ' · ' + fmtTime(r.createdAt) + ' · 已失效' })),
        h('div', { class: 'ai-comment', text: r.humanComment || r.comment || '' }), (r.staleReasons || []).length ? h('div', { class: 'muted', text: '失效：' + r.staleReasons.join('；') }) : null);
    }));
    dialogShell('text-dialog', '已移除格子的历史人工意见（只读）', [h('p', { class: 'muted', text: '这些格子不在当前 spec 中。意见保留其原 spec/证据版本，仅供参考。' }), body], [h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { $('text-dialog').close(); } }, '关闭')]);
  }

  function carryText(cell, text) {
    openCell(cell.id, { captureId: cell.capture.id }).then(function () {
      var ta = $('comment'); if (!ta || ta.value.trim()) return;
      ta.value = text; onCommentInput(); ta.focus();
    });
  }

  function aiSection(cell, cap) {
    var s = h('section', { 'aria-label': 'AI 意见' }, h('h3', { text: 'AI 意见（只读，独立于人工）' }));
    var current = cell.aiCurrent && cap && cell.aiCurrent.captureId === cap.id ? cell.aiCurrent : null;
    var forBound = cap ? (cell.raw.aiReviews || []).filter(function (r) { return r.captureId === cap.id && r !== current; }) : [];
    if (current) s.appendChild(aiBox(current, false));
    else s.appendChild(h('div', { class: 'box' }, h('span', { class: 'muted', text: cap ? 'AI 尚未对这版证据给出有效意见。' : '没有证据，AI 无从评审。' })));
    var old = cell.aiOld.filter(function (r) { return r !== current; });
    if (forBound.length || old.length) {
      var seen = new Set(); var list = forBound.concat(old).filter(function (r) { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
      var det = h('details', null, h('summary', { class: 'muted', text: '已失效的 AI 意见（' + list.length + '）' }));
      list.forEach(function (r) { det.appendChild(aiBox(r, true)); });
      s.appendChild(det);
    }
    return s;
  }
  function aiBox(r, stale) {
    var capInfo = r.captureId && app.view.captureById.get(r.captureId);
    return h('div', { class: 'box ai verdict-' + r.verdict + (stale ? ' stale' : '') },
      h('div', { class: 'box-head' },
        h('span', { class: 'chip lg ai-' + (stale ? 'stale' : r.verdict), text: (stale ? '已失效 · ' : '') + (AI_LABEL[r.verdict] || r.verdict) }),
        h('span', { text: (r.reviewer ? [r.reviewer.provider, r.reviewer.model].filter(Boolean).join('/') : '') + ' · ' + fmtTime(r.createdAt) }),
        capInfo ? h('span', { text: '针对证据 v' + capInfo.version }) : null,
        r.reviewProtocol ? h('span', { class: 'mono', text: r.reviewProtocol }) : null),
      stale && (r.staleReasons || []).length ? h('div', { class: 'muted', text: '失效：' + r.staleReasons.join('；') }) : null,
      longText(r.comment || '', 260),
      (r.visibleText || []).length ? h('div', null, h('span', { class: 'muted', text: '画面可见文字：' }), h('ul', { class: 'visible-text' }, r.visibleText.map(function (t) { return h('li', { text: t }); }))) : h('div', { class: 'muted', text: '未记录可见文字' }),
      (r.observations || []).length ? h('ul', { class: 'observations' }, r.observations.map(function (o) { return h('li', null, h('code', { text: o.assetId || '' }), ' ', o.detail || ''); })) : null);
  }

  function longText(text, limit) {
    if (text.length <= limit) return h('div', { class: 'ai-comment', text: text });
    var body = h('div', { class: 'ai-comment clamped', text: text });
    var btn = h('button', { type: 'button', class: 'btn btn-ghost btn-small', 'aria-expanded': 'false', onclick: function () {
      var open = body.classList.toggle('clamped'); btn.textContent = open ? '展开全文' : '收起'; btn.setAttribute('aria-expanded', String(!open));
    } }, '展开全文');
    return h('div', null, body, btn);
  }

  function renderHumanSection() {
    var slot = $('human-slot'); if (!slot || !app.editor) return;
    var cell = app.view.cellsById.get(app.activeId); var ed = app.editor;
    var info = boundCapture(cell);
    var draft = app.drafts.get(ed.key) || null;
    var hs = hsOf(cell);
    var isOld = (cell.capture ? cell.capture.id : null) !== ed.captureId;
    var sec = h('section', { id: 'human-slot', class: 'human-section' + (isOld ? ' bound-old' : ''), 'aria-label': '人工意见' });
    sec.appendChild(h('h3', { text: '人工意见' }));
    sec.appendChild(h('div', { class: 'binding' }, '绑定：', h('strong', { text: info ? '证据 v' + info.version + ' · ' + fmtTime(info.capture.createdAt) + ' · build ' + (info.capture.buildId || '—') : '无证据（缺图/未采集）' }), isOld ? '（旧版）' : ''));
    var conflict = app.conflicts.get(ed.key);
    if (conflict !== undefined) {
      sec.appendChild(h('div', { class: 'conflict-box', role: 'alert' },
        h('strong', { text: '版本冲突：这条意见已在别处（另一标签页或导入）被修改' }),
        h('div', null, '对方版本 rev ' + (conflict ? conflict.rev : '—') + '：'), h('pre', { text: conflict ? ((conflict.decision ? '[' + D[conflict.decision].label + '] ' : '') + (conflict.comment || '')) : '（已删除）' }),
        h('div', null, '你的版本（未保存）：'), h('pre', { text: ed.mine !== undefined ? ed.mine : ($('comment') ? $('comment').value : (draft && draft.comment) || '') }),
        h('span', null,
          h('button', { type: 'button', class: 'btn btn-small', onclick: function () { resolveConflict('theirs'); } }, '采用对方版本'), ' ',
          h('button', { type: 'button', class: 'btn btn-small', onclick: function () { resolveConflict('mine'); } }, '保留我的并覆盖'))));
    }
    var row = h('div', { class: 'decision-row', role: 'group', 'aria-label': '人工决定' });
    M.DECISION_ORDER.forEach(function (k) {
      var pressed = !!(draft && draft.decision === k);
      row.appendChild(h('button', { type: 'button', class: 'decision d-' + k, 'aria-pressed': String(pressed), 'data-decision': k, disabled: app.busy,
        title: D[k].label + '（' + D[k].key + '）' + (D[k].needsComment ? ' · 需填写理由' : '') + ' · 保存成功后进入队列下一项',
        onclick: function () { decide(k); } }, h('span', { text: D[k].label }), h('kbd', { text: D[k].key })));
    });
    sec.appendChild(row);
    var needs = draft && draft.decision && D[draft.decision].needsComment;
    var ta = h('textarea', { id: 'comment', rows: '5', placeholder: '写下你看到的问题、期望或理由。自动保存。\n“需修改 / 阻塞 / 不适用”必须写理由。', 'aria-describedby': 'save-state comment-error' });
    ta.value = conflict !== undefined && ed.mine !== undefined ? ed.mine : (draft ? draft.comment || '' : '');
    ta.addEventListener('input', onCommentInput);
    ta.addEventListener('blur', function () { flushComment(); });
    sec.appendChild(h('div', { class: 'comment-field' }, h('label', { for: 'comment', text: needs ? '理由（必填）' : '评论（选填；非“通过”时必填）' }), ta, h('div', { id: 'comment-error', class: 'field-error', role: 'alert' })));
    var st = app.saveStates.get(ed.key);
    var sub = draft && draft.submitted ? (draft.submitted.rev === draft.rev ? dispatchLabel(draft.submitted.dispatch) + '（' + draft.submitted.batchId + '）' : '提交后又修改，需再次提交') : (draft && draft.decision ? '草稿，未提交给 Pi' : '');
    sec.appendChild(h('div', { class: 'save-line' }, h('span', { id: 'save-state', class: 'state ' + (st ? st.status : ''), role: 'status', 'aria-live': 'polite', text: saveStateText(st) || (draft ? '已保存 ' + fmtTime(draft.updatedAt) : '尚未填写') }),
      h('span', null, sub ? h('span', { text: sub + ' ' }) : null, draft && draft.decision ? h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: clearDecision }, '清除决定') : null)));
    if (st && st.status === 'error') sec.appendChild(h('button', { type: 'button', class: 'btn btn-small', onclick: function () { app.editor.dirty = true; flushComment().then(renderHumanSection); } }, '重试保存'));
    if (!draft && cell.humanCurrent && !isOld) sec.appendChild(submittedBox(cell.humanCurrent, false));
    // old versions
    var olds = hs.oldDrafts.filter(function (d) { return M.draftKey(d.cellId, d.captureId) !== ed.key; });
    if (isOld && cell.capture) { var cd = app.drafts.get(M.draftKey(cell.id, cell.capture.id)); if (cd) olds = [cd].concat(olds); }
    var oldSub = cell.humanSubmitted.filter(function (r) { return r !== cell.humanCurrent || isOld; });
    if (olds.length || oldSub.length) {
      var oh = h('div', { class: 'old-human' }, h('h3', { text: '其他版本上的人工意见（只读参考，不会自动应用）' }));
      olds.forEach(function (d) {
        var ci = d.captureId ? app.view.captureById.get(d.captureId) : null;
        var isCurrent = (cell.capture ? cell.capture.id : null) === (d.captureId || null);
        oh.appendChild(h('div', { class: 'box' + (isCurrent ? '' : ' stale') },
          h('div', { class: 'box-head' }, h('span', { class: 'chip ' + (d.decision ? 'h-' + d.decision : 'h-pending'), text: d.decision ? D[d.decision].label : '仅评论' }),
            h('span', { text: (isCurrent ? '当前证据' : '旧版') + ' ' + (ci ? 'v' + ci.version + ' · build ' + (ci.capture.buildId || '—') : d.captureId ? '（版本不在当前数据中）' : '无证据时') + ' · ' + fmtTime(d.updatedAt) })),
          h('div', { class: 'ai-comment', text: d.comment || '（无文字）' }),
          h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: function () { openCell(cell.id, { captureId: d.captureId || null }); } }, '打开该版本')));
      });
      oldSub.forEach(function (r) { oh.appendChild(submittedBox(r, true)); });
      sec.appendChild(oh);
    }
    slot.replaceWith(sec);
  }
  function submittedBox(r, stale) {
    var ci = r.captureId && app.view.captureById.get(r.captureId);
    var dec = M.decisionOfRecord(r);
    return h('div', { class: 'box' + (stale || r.stale ? ' stale' : '') },
      h('div', { class: 'box-head' }, h('span', { class: 'chip h-' + (dec || 'pending'), text: HUMAN_LABEL[dec] || r.verdict }),
        h('span', { text: '已提交 · ' + (r.reviewer || '') + ' · ' + fmtTime(r.createdAt) + (ci ? ' · 证据 v' + ci.version : '') + (r.stale ? ' · 已失效' : '') })),
      (r.staleReasons || []).length ? h('div', { class: 'muted', text: '失效：' + r.staleReasons.join('；') }) : null,
      h('div', { class: 'ai-comment', text: r.humanComment || r.comment || '' }));
  }

  function resolveConflict(which) {
    var ed = app.editor; var theirs = app.conflicts.get(ed.key);
    app.conflicts.delete(ed.key);
    var mineText = ed.mine; ed.mine = undefined;
    if (which === 'theirs') {
      if (theirs) app.drafts.set(ed.key, theirs); else app.drafts.delete(ed.key);
      ed.baseRev = theirs ? theirs.rev : 0; ed.dirty = false;
      setSaveState(ed.key, 'saved');
      renderHumanSection(); updateTile(ed.cellId); refreshCounts();
      return;
    }
    var ta = $('comment');
    var mine = Object.assign({}, currentDraft(), { comment: mineText !== undefined ? mineText : (ta ? ta.value : ''), updatedAt: nowIso() });
    ed.baseRev = theirs ? theirs.rev : 0;
    persistDraft(ed.key, mine, ed.baseRev).then(function (r) { if (r.draft) ed.baseRev = r.draft.rev; renderHumanSection(); updateTile(ed.cellId); });
  }

  function detailsSection(cell, cap, info, facts) {
    var det = h('details', { class: 'evidence-details' }, h('summary', { text: '全部证据详情（来源、构建、哈希、动作、历史）' }));
    if (!cap) { det.appendChild(h('p', { class: 'muted', text: '无证据记录。' })); }
    else {
      var pv = cap.provenance || {};
      det.appendChild(h('dl', { class: 'kv' },
        kv('capture', cap.id), kv('版本', 'v' + info.version + ' / ' + cell.captures.length), kv('状态', cap.status), kv('采集时间', fmtTime(cap.createdAt)),
        kv('source snapshot', cap.sourceSnapshotId), kv('build', cap.buildId), kv('runtime', cap.runtimeId), kv('spec rev', cap.specRev),
        kv('adapter', [pv.adapter, pv.adapterVersion].filter(Boolean).join(' ')), kv('设备标识', pv.deviceId), kv('设备类型', pv.deviceKind), kv('来源', pv.source), kv('fixture 说明', pv.fixtureDescription)));
      var bd = app.view.builds.get(cap.buildId), rt = app.view.runtimes.get(cap.runtimeId), src = app.view.sources.get(cap.sourceSnapshotId);
      if (bd || rt || src) det.appendChild(h('dl', { class: 'kv' },
        src ? [kv('source HEAD', src.head), kv('source dirty', src.dirty ? '是 · diff ' + (src.dirtyDiffSha256 || '') : '否'), kv('related inputs', src.relatedInputCount)] : null,
        bd ? [kv('build platform', bd.platform), kv('build artifact', (bd.artifact && bd.artifact.kind || '') + ' sha256 ' + (bd.artifact && bd.artifact.sha256 || '—')), kv('build command', bd.command), kv('build time', fmtTime(bd.createdAt))] : null,
        rt ? [kv('runtime adapter', rt.adapter ? rt.adapter.name + ' ' + (rt.adapter.version || '') : ''), kv('app', rt.app ? (rt.app.id || '') + ' ' + (rt.app.version || '') : ''), kv('fixture', rt.fixture ? rt.fixture.mode + (rt.fixture.description ? ' · ' + rt.fixture.description : '') : ''), kv('runtime drift', rt.driftDetected ? '检测到漂移' : null), kv('runtime 限制', (rt.limitations || []).join('；'))] : null));
      det.appendChild(h('h3', { text: '图片 / 视频' }));
      var tb = h('table', { class: 'asset-table' }, h('thead', null, h('tr', null, h('th', { text: 'id' }), h('th', { text: '类型' }), h('th', { text: '时间' }), h('th', { text: '尺寸' }), h('th', { text: 'sha256 / 路径' }))));
      var body = h('tbody');
      facts.assets.all.forEach(function (a, i) {
        body.appendChild(h('tr', null, h('td', { class: 'mono', text: a.id }), h('td', { text: a.kind || '' }), h('td', { text: (a.offsetMs !== undefined ? '+' + a.offsetMs + 'ms ' : '') + fmtTime(a.capturedAt) }),
          h('td', { text: a.width ? a.width + '×' + a.height : (a.durationMs ? a.durationMs + 'ms' : '') }),
          h('td', { class: 'mono' }, a.sha256 || '—', h('br'), a.path ? h('a', { href: a.path, target: '_blank', rel: 'noopener', text: a.path }) : '无路径', a.mimeType ? ' · ' + a.mimeType : '')));
      });
      tb.appendChild(body); det.appendChild(tb);
      if ((cap.actions || []).length) {
        det.appendChild(h('h3', { text: '动作' }));
        det.appendChild(h('ol', { class: 'hist' }, cap.actions.map(function (a) { return h('li', { text: fmtTime(a.at) + ' · ' + (a.type || '') + ' · ' + (a.description || '') + (a.source ? ' (' + a.source + ')' : '') }); })));
      }
      if (cap.transition) det.appendChild(h('dl', { class: 'kv' }, kv('transition', (cap.transition.fromStateId || '?') + ' → ' + (cap.transition.toStateId || '?')), kv('startedAt', fmtTime(cap.transition.startedAt)), kv('endedAt', fmtTime(cap.transition.endedAt))));
    }
    det.appendChild(h('h3', { text: '证据历史' }));
    det.appendChild(cell.captures.length ? h('ol', { class: 'hist' }, cell.captures.map(function (c, i) {
      return h('li', null, 'v' + (i + 1) + ' · ' + fmtTime(c.createdAt) + ' · ' + c.status + ' · build ' + (c.buildId || '—') + ' ', c.id === (cap && cap.id) ? h('strong', { text: '（正在查看）' }) : h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: function () { openCell(cell.id, { captureId: c.id }); } }, '查看'));
    })) : h('p', { class: 'muted', text: '没有任何采集记录' }));
    return det;
  }
  function kv(k, v) { return v === undefined || v === null || v === '' ? null : [h('dt', { text: k }), h('dd', { class: 'mono', text: String(v) })]; }

  // ---------------------------------------------------------------- lightbox
  function openLightbox(cell, cap, list, idx) {
    app.lb = { cell: cell, cap: cap, list: list, idx: idx, zoom: 'fit' };
    renderLightbox();
    var d = $('lightbox'); if (!d.open) d.showModal();
  }
  function renderLightbox() {
    var lb = app.lb, d = clear($('lightbox')); var a = lb.list[lb.idx]; var url = evidenceUrl(a);
    var fixture = lb.cap && !M.provenanceOf(lb.cap).real;
    var view = h('div', { class: 'lb-view ' + (lb.zoom === 'fit' ? 'fit' : 'zoomed'), tabindex: '0' });
    var img = h('img', { src: url, alt: '原图 ' + a.id });
    if (lb.zoom !== 'fit' && a.width) { img.style.width = (a.width * Number(lb.zoom)) + 'px'; img.style.maxWidth = 'none'; }
    view.appendChild(img);
    enableDragPan(view);
    function z(k, label) { return h('button', { type: 'button', class: 'btn btn-small', 'aria-pressed': String(lb.zoom === k), onclick: function () { lb.zoom = k; renderLightbox(); } }, label); }
    d.appendChild(h('div', { class: 'lb' },
      h('div', { class: 'lb-bar' },
        h('strong', { text: lb.cell.device.label + ' · ' + M.orientationLabel(lb.cell.orientation) }),
        fixture ? h('span', { class: 'chip fixture', text: 'FIXTURE · 非 App 证据' }) : null,
        lb.list.length > 1 ? [h('button', { type: 'button', class: 'btn btn-small', onclick: function () { lbStep(-1); }, disabled: lb.idx === 0 }, '‹'), h('span', { text: (lb.idx + 1) + '/' + lb.list.length + (a.offsetMs !== undefined ? ' · +' + a.offsetMs + 'ms' : '') }), h('button', { type: 'button', class: 'btn btn-small', onclick: function () { lbStep(1); }, disabled: lb.idx === lb.list.length - 1 }, '›')] : null,
        z('fit', '适应'), z('1', '100%'), z('2', '200%'), z('4', '400%'),
        h('a', { href: url, target: '_blank', rel: 'noopener', text: '新标签打开原文件' }),
        h('span', { style: { 'margin-left': 'auto' } }), h('button', { type: 'button', class: 'btn btn-small', onclick: function () { $('lightbox').close(); } }, '关闭 Esc')),
      view,
      h('div', { class: 'lb-meta', text: a.id + ' · ' + (a.kind || '') + ' · ' + (a.width ? a.width + '×' + a.height + ' px' : '') + ' · sha256 ' + (a.sha256 || '—') + ' · ' + (a.path || '') + ' · 拖拽平移' })));
    view.focus();
  }
  function lbStep(dir) { var lb = app.lb; lb.idx = Math.max(0, Math.min(lb.list.length - 1, lb.idx + dir)); renderLightbox(); }
  function enableDragPan(el) {
    var sx, sy, sl, st, down = false;
    el.addEventListener('pointerdown', function (e) { down = true; sx = e.clientX; sy = e.clientY; sl = el.scrollLeft; st = el.scrollTop; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', function (e) { if (!down) return; el.scrollLeft = sl - (e.clientX - sx); el.scrollTop = st - (e.clientY - sy); });
    el.addEventListener('pointerup', function () { down = false; });
  }

  // ---------------------------------------------------------------- dialogs
  function dialogShell(id, title, body, footer) {
    var d = clear($(id));
    d.appendChild(h('div', { class: 'dlg' },
      h('header', null, h('h2', { id: id + '-title', text: title }), h('button', { type: 'button', class: 'btn btn-ghost btn-small', 'aria-label': '关闭', onclick: function () { d.close(); } }, '×')),
      h('div', { class: 'dlg-body' }, body), footer ? h('footer', null, footer) : null));
    if (!d.open) d.showModal();
    return d;
  }

  function openDeviceInfo(col) {
    var key = col.key;
    var sizeNote = !col.size ? '' : col.sizeSource === 'spec' ? 'spec 声明' : '按截图像素推断';
    var d = dialogShell('device-dialog', '设备说明', [
      h('p', { class: 'device-full-label', text: col.device.label }),
      h('dl', { class: 'kv' },
        h('dt', { text: '方向' }), h('dd', { text: M.orientationLabel(col.orientation) }),
        h('dt', { text: '平台' }), h('dd', { text: col.device.platform || '未声明' }),
        h('dt', { text: '尺寸' }), h('dd', { text: col.size ? col.size.w + '×' + col.size.h + ' px' + (sizeNote ? '（' + sizeNote + '）' : '') : '尺寸未知' }),
        h('dt', { text: '设备 ID' }), h('dd', null, h('code', { text: col.deviceId })))
    ], [h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { d.close(); } }, '关闭')]);
    // The browser restores the original button on close. If a server refresh
    // rebuilt the matrix while open, recover that same column without scrolling.
    // A queued close event must not steal focus from a subsequent action/dialog.
    d.addEventListener('close', function () {
      var a = document.activeElement;
      if (document.querySelector('dialog[open]') || (a && a !== document.body && !d.contains(a))) return;
      var btn = Array.prototype.find.call(document.querySelectorAll('#matrix-table .col-head'), function (x) { return x.dataset.col === key; });
      if (btn) btn.focus({ preventScroll: true });
    }, { once: true });
    var primary = d.querySelector('footer .btn-primary'); if (primary) primary.focus({ preventScroll: true });
  }

  function showTextFallback(title, text, why) {
    var ta = h('textarea', { class: 'copy-area', readonly: true, 'aria-label': title });
    ta.value = text;
    var d = dialogShell('text-dialog', title, [h('p', { text: why }), ta], [h('button', { type: 'button', class: 'btn', onclick: function () { ta.focus(); ta.select(); } }, '全选'), h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { d.close(); } }, '完成')]);
    ta.focus(); ta.select();
  }

  function copyText(title, text) {
    function fallback(reason) { showTextFallback(title, text, '浏览器' + reason + '。文本已全选，请按 Ctrl+C / ⌘C 手动复制。'); }
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { announce('已复制到剪贴板'); }, function (e) { fallback('拒绝了剪贴板访问（' + (e && e.name || e) + '）'); });
    }
    fallback('在此环境不提供剪贴板 API');
    return Promise.resolve();
  }

  function allHumanDrafts() {
    var v = app.view;
    return Array.from(app.drafts.values()).filter(function (d) { return d.decision || (d.comment && d.comment.trim()); })
      .sort(function (a, b) { var ca = v.cellsById.get(a.cellId), cb = v.cellsById.get(b.cellId); return ((ca ? ca.matrixOrder : 1e12) - (cb ? cb.matrixOrder : 1e12)) || (Date.parse(b.updatedAt) - Date.parse(a.updatedAt)); });
  }

  function copyAll() {
    if (!app.view) return;
    flushComment().then(function () {
      var list = allHumanDrafts();
      if (!list.length) { announce('还没有人工意见可复制'); return; }
      copyText('复制人审意见', M.formatFeedbackText(app.view, list, { reviewer: app.reviewer, now: fmtTime(nowIso()), storageScope: storageScope() }));
    });
  }
  function storageScope() { return app.mode === 'server' ? 'local-server ' + location.host : 'browser-local ' + location.origin + location.pathname; }
  function staticSourceId() {
    var m = app.local.getMeta();
    if (!m.staticSourceId) { m.staticSourceId = 'static-' + M.newBatchId().slice(6); app.local.setMeta({ staticSourceId: m.staticSourceId }); }
    return m.staticSourceId;
  }
  function requireReviewer() {
    if (app.reviewer) return true;
    var r = $('reviewer'); r.classList.add('needs-value'); r.focus(); announce('请先填写审核人');
    return false;
  }

  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return true;
    } catch (e) { return false; }
  }

  function exportJson() {
    if (!app.view || !requireReviewer()) return;
    flushComment().then(function () {
      var data = M.buildExport(app.view, app.drafts, { batchId: M.newBatchId(), sourceId: app.mode === 'server' ? app.session.sourceId : staticSourceId(), submittedAt: nowIso(), reviewer: app.reviewer, storageScope: storageScope() });
      var text = JSON.stringify(data, null, 2);
      var name = 'visual-acceptance-feedback-' + app.view.project.id + '-' + nowIso().slice(0, 19).replace(/[:T]/g, '') + '.json';
      if (!download(name, text)) showTextFallback('导出 JSON', text, '无法触发下载，请手动复制保存为 .json 文件。');
      else announce('已导出 ' + data.drafts.length + ' 条草稿（' + data.edits.length + ' 条可提交）');
    });
  }

  function openImport(text) {
    var res = M.analyzeImport(text, app.view, app.drafts);
    var body = [];
    if (res.fatal.length) {
      body.push(h('div', { class: 'notice error', role: 'alert' }, h('strong', { text: '无法导入' }), h('ul', null, res.fatal.map(function (m) { return h('li', { text: m }); }))));
      dialogShell('import-dialog', '导入 JSON', body, [h('button', { type: 'button', class: 'btn', onclick: function () { $('import-dialog').close(); } }, '关闭')]);
      return;
    }
    var counts = { new: 0, same: 0, conflict: 0 }; res.items.forEach(function (i) { counts[i.status]++; });
    body.push(h('p', { text: '新增 ' + counts.new + ' · 相同 ' + counts.same + ' · 冲突 ' + counts.conflict + ' · 错误 ' + res.errors.length + '。导入的意见保持其原证据版本，不会转绑到新证据。' }));
    var list = h('ul', { class: 'import-list' });
    res.errors.forEach(function (e) { list.appendChild(h('li', { class: 'err' }, h('code', { text: e.path }), ' ', e.message)); });
    var choices = {};
    res.items.forEach(function (it, i) {
      if (it.status === 'same') return;
      var cell = app.view.cellsById.get(it.draft.cellId);
      var li = h('li', { class: it.status }, h('div', null, h('strong', { text: (it.status === 'new' ? '新增 ' : '冲突 ') }), cell.scenario.label + ' › ' + M.rowLabel(app.view, cell) + ' — ' + M.columnLabel(cell), it.oldVersion ? h('span', { class: 'chip version', text: '旧版证据' }) : null, ' ', h('code', { class: 'muted', text: it.path })),
        h('div', { class: 'muted', text: '导入：' + (it.draft.decision ? D[it.draft.decision].label : '仅评论') + ' · ' + (it.draft.comment || '（无文字）') }));
      if (it.status === 'conflict') {
        li.appendChild(h('div', { class: 'muted', text: '本地：' + (it.existing.decision ? D[it.existing.decision].label : '仅评论') + ' · ' + (it.existing.comment || '（无文字）') }));
        choices[i] = 'keep';
        var name = 'imp-' + i;
        li.appendChild(h('div', { class: 'choices' },
          h('label', null, h('input', { type: 'radio', name: name, checked: true, onchange: function () { choices[i] = 'keep'; } }), ' 保留本地'),
          h('label', null, h('input', { type: 'radio', name: name, onchange: function () { choices[i] = 'take'; } }), ' 用导入覆盖')));
      } else choices[i] = 'take';
      list.appendChild(li);
    });
    body.push(list);
    var go = h('button', { type: 'button', class: 'btn btn-primary', disabled: !res.items.some(function (x) { return x.status !== 'same'; }), onclick: function () {
      var jobs = res.items.map(function (it, i) {
        if (choices[i] !== 'take') return Promise.resolve(null);
        var ex = app.drafts.get(it.key);
        var d = Object.assign({}, it.draft, { createdAt: ex ? ex.createdAt : it.draft.createdAt });
        return persistDraft(it.key, d, ex ? ex.rev : 0, { force: true });
      });
      Promise.all(jobs).then(function (rs) {
        var ok = rs.filter(function (r) { return r && r.ok; }).length, bad = rs.filter(function (r) { return r && !r.ok; }).length;
        $('import-dialog').close();
        if (app.editor) { var dd = app.drafts.get(app.editor.key); app.editor.baseRev = dd ? dd.rev : 0; }
        renderAll({ keepReview: true });
        announce('导入 ' + ok + ' 条' + (bad ? '，' + bad + ' 条失败' : ''));
      });
    } }, '导入所选');
    dialogShell('import-dialog', '导入 JSON', body, [h('button', { type: 'button', class: 'btn', onclick: function () { $('import-dialog').close(); } }, '取消'), go]);
  }

  // ---------------------------------------------------------------- submit
  function refreshCounts() {
    if (!app.view) return;
    var c = M.collectSubmittable(app.view, app.drafts);
    $('submit-count').textContent = String(c.ready.length);
    if (!$('review').hidden && app.activeId) {
      var qp = $('queue-position').querySelector('.qbar i');
      if (qp && app.queue) { var st = M.queueStats(app.queue, resolvedFn); qp.style.width = (st.done / Math.max(1, st.total) * 100) + '%'; }
    }
  }

  function openSubmit() {
    if (!app.view) return;
    if ($('text-dialog').open) $('text-dialog').close();
    flushComment().then(function () {
      var col = M.collectSubmittable(app.view, app.drafts);
      var meta = app.local.getMeta();
      var pending = meta.pendingBatch && meta.pendingBatch.projectId === app.view.project.id ? meta.pendingBatch : null;
      var body = [];
      body.push(h('p', { text: '只把“当前证据”上已做决定、且自上次提交后有改动的意见打包为一个批次。不会每次输入都唤醒 Pi。' }));
      body.push(h('p', null, h('strong', { text: col.ready.length + ' 项可提交' }), col.invalid.length ? ' · ' + col.invalid.length + ' 项缺理由' : '', col.oldOnly.length ? ' · ' + col.oldOnly.length + ' 条旧版意见不会提交（不转绑到新证据）' : ''));
      if (col.invalid.length) body.push(h('ul', { class: 'import-list' }, col.invalid.map(function (x) { var c = app.view.cellsById.get(x.cellId); return h('li', { class: 'err' }, c.scenario.label + ' › ' + M.rowLabel(app.view, c) + ' — ' + M.columnLabel(c) + '：' + x.error + ' ', h('button', { type: 'button', class: 'btn btn-small', onclick: function () { $('submit-dialog').close(); openCell(x.cellId, { push: true }); } }, '去填写')); })));
      if (!app.reviewer) body.push(h('div', { class: 'notice warn' }, h('strong', { text: '需要审核人' }), h('span', { text: '请在顶栏填写你的名字，会写入每条意见。' })));
      var footer = [h('button', { type: 'button', class: 'btn', onclick: function () { $('submit-dialog').close(); } }, '取消')];
      if (app.mode === 'server') {
        if (pending) {
          var dp = pending.state === 'dispatch-pending';
          body.push(h('div', { class: 'notice warn' }, h('strong', { text: dp ? '意见已保存，回 Pi 待重试' : '上次提交未确认' }), h('span', { text: '批次 ' + pending.batch.batchId + '（' + pending.batch.edits.length + ' 项，' + fmtTime(pending.batch.submittedAt) + '）。' + (dp ? '本地服务已保存这些意见，但通知 Pi 失败。' : '') + '重试会原样重发同一批次（相同 ID 与来源），不会被当作新意见。' })));
          footer.push(h('button', { type: 'button', class: 'btn btn-primary', id: 'btn-retry-batch', onclick: function () { sendBatch(pending.batch); } }, dp ? '重试回传 Pi' : '重试上次批次'));
        } else {
          footer.push(h('button', { type: 'button', class: 'btn btn-primary', id: 'btn-send-batch', disabled: !col.ready.length || !app.reviewer, onclick: function () {
            var batch = M.buildBatch(app.view, col.ready, { batchId: M.newBatchId(), sourceId: app.session.sourceId, submittedAt: nowIso(), reviewer: app.reviewer });
            app.local.setMeta({ pendingBatch: { projectId: app.view.project.id, batch: batch, state: 'sending', at: nowIso() } });
            sendBatch(batch);
          } }, '提交 ' + col.ready.length + ' 项给 Pi'));
        }
        body.push(h('div', { id: 'submit-result', role: 'status' }));
      } else {
        body.push(h('div', { class: 'notice warn' }, h('strong', { text: '静态包不能直接通知 Pi' }), h('span', { text: '没有本地 review 服务。请复制或下载批次 JSON，在 Pi 会话中粘贴，或运行 core 的 feedback-import 导入。' })));
        body.push(h('pre', { class: 'mono', text: 'node scripts/visual-acceptance.mjs feedback-import --input <下载的文件>.json' }));
        var mk = function () { return M.buildBatch(app.view, col.ready, { batchId: M.newBatchId(), sourceId: staticSourceId(), submittedAt: nowIso(), reviewer: app.reviewer }); };
        footer.push(h('button', { type: 'button', class: 'btn', disabled: !col.ready.length || !app.reviewer, onclick: function () { copyText('批次 JSON', JSON.stringify(mk(), null, 2)); } }, '复制批次 JSON'));
        footer.push(h('button', { type: 'button', class: 'btn btn-primary', disabled: !col.ready.length || !app.reviewer, onclick: function () { var b = mk(); var t = JSON.stringify(b, null, 2); if (!download('visual-acceptance-batch-' + b.batchId + '.json', t)) showTextFallback('批次 JSON', t, '无法下载，请手动复制。'); } }, '下载批次 JSON'));
      }
      dialogShell('submit-dialog', '提交给 Pi', body, footer);
    });
  }

  var DISPATCH_LABEL = {
    persisted: '已送达 Pi 会话', queued: '已排队交给 Pi（尚未确认送达）', requested: '已请求 Pi 处理（尚未确认送达）',
    'not-connected': '意见已保存；当前服务没有连接 Pi 会话', pending: '意见已保存；回传 Pi 失败，待重试'
  };
  function dispatchLabel(d) { return DISPATCH_LABEL[d] || '已提交'; }

  /**
   * Send (or resend) a batch. The exact body is kept in local meta until the
   * server accepts it AND dispatch is no longer pending; retries reuse it as-is.
   */
  function sendBatch(batch) {
    var out = $('submit-result'); if (out) { clear(out); out.appendChild(h('span', { text: '提交中…（批次 ' + batch.batchId + '）' })); }
    document.querySelectorAll('#submit-dialog footer .btn-primary').forEach(function (b) { b.disabled = true; });
    var pending = app.local.getMeta().pendingBatch;
    return app.server.postFeedback(batch).then(function (res) {
      if (!res || res.accepted !== true) throw new Error('服务器未接受批次');
      var dispatch = res.dispatch || (res.httpStatus === 503 ? 'pending' : null);
      return markSubmitted(batch, dispatch).then(function () {
        if (dispatch === 'pending') app.local.setMeta({ pendingBatch: { projectId: app.view.project.id, batch: batch, state: 'dispatch-pending', error: res.error || null, at: nowIso() } });
        else app.local.setMeta({ pendingBatch: null });
        var kind = dispatch === 'pending' || dispatch === 'not-connected' ? 'warn' : 'info';
        if (out) { clear(out); out.appendChild(h('div', { class: 'notice ' + kind, role: 'status' }, h('strong', { text: dispatch === 'pending' ? '意见已保存，回 Pi 待重试' : (res.duplicate ? '服务器已有此批次' : '已提交') }),
          h('span', { text: '批次 ' + batch.batchId + '，' + batch.edits.length + ' 项。' + dispatchLabel(dispatch) + (res.error ? '（' + res.error + '）' : '') + (dispatch === 'pending' ? '。可稍后“重试回传 Pi”，会用同一批次原样重发。' : '') }))); }
        renderAll({ keepReview: true });
        if (dispatch === 'pending') addPendingNotice();
        else { var n = document.querySelector('[data-notice="dispatch"]'); if (n) n.remove(); }
      });
    }).catch(function (e) {
      var conflict = e.status === 409;
      var neverAccepted = !pending || pending.state !== 'dispatch-pending';
      var sourceGone = neverAccepted && (e.status === 400 || e.status === 403) && /source/i.test(e.message);
      if (conflict || sourceGone) app.local.setMeta({ pendingBatch: null });
      if (out) { clear(out); out.appendChild(h('div', { class: 'notice error', role: 'alert' }, h('strong', { text: conflict ? '批次冲突' : sourceGone ? '服务会话已更换' : '提交失败' }),
        h('span', { text: e.message + (conflict ? '。请重新打开提交对话框生成新批次。' : sourceGone ? '。此批次未被接受，意见仍是草稿；请重新提交（会生成新批次）。' : '。批次已原样保留，可用同一批次 ID 重试。') }))); }
      document.querySelectorAll('#submit-dialog footer .btn-primary').forEach(function (b) { b.disabled = false; });
    });
  }

  /** Mark drafts of an accepted batch as submitted (with dispatch state); edits made since stay unsubmitted. */
  function markSubmitted(batch, dispatch) {
    var at = nowIso();
    return Promise.all(batch.edits.map(function (e) {
      var key = M.draftKey(e.cellId, e.captureId); var d = app.drafts.get(key);
      if (!d) return null;
      var same = d.rev === e.draftRev || (d.submitted && d.submitted.batchId === batch.batchId && d.submitted.rev === d.rev);
      if (!same) return null;
      var next = Object.assign({}, d, { submitted: { batchId: batch.batchId, rev: d.rev + 1, at: (d.submitted && d.submitted.batchId === batch.batchId && d.submitted.at) || at, dispatch: dispatch || null } });
      return persistDraft(key, next, d.rev);
    }));
  }

  function addPendingNotice() {
    var p = app.local && app.local.getMeta().pendingBatch;
    if (!p || p.state !== 'dispatch-pending' || app.mode !== 'server') return;
    addNotice('warn', '意见已保存，回 Pi 待重试', '批次 ' + p.batch.batchId + '（' + p.batch.edits.length + ' 项）已被本地服务保存，但通知 Pi 失败' + (p.error ? '：' + p.error : '') + '。', 'dispatch',
      h('button', { type: 'button', class: 'btn btn-small', onclick: openSubmit }, '重试回传 Pi'));
  }

  // submitted marker: rev + 1 because saving the marker bumps rev; treat as submitted if rev matches marker.
  // (local.save assigns rev = base + 1, which equals submitted.rev)

  function openHelp() {
    var rows = [['1 / 2 / 3 / 4', '通过 / 需修改 / 阻塞 / 不适用（保存成功后进入队列下一项）'], [']  或  J', '队列下一项'], ['[  或  K', '队列上一项'], ['← / →', '过渡序列切换帧；原图中切换图片'], ['O', '打开原图'], ['C', '聚焦评论框'], ['Esc', '离开评论框 / 关闭对话框 / 返回矩阵'], ['/', '搜索'], ['方向键（矩阵中）', '在格子之间移动'], ['Enter / Space（列头）', '查看完整设备说明'], ['?', '本帮助']];
    dialogShell('help-dialog', '键盘快捷键', [h('table', { class: 'help-table' }, h('tbody', null, rows.map(function (r) { return h('tr', null, h('td', null, h('kbd', { text: r[0] })), h('td', { text: r[1] })); }))),
      h('p', { class: 'muted', text: '在评论框中输入时，单键快捷键不生效。审核 UI 的截图只代表界面本身，不是 App 证据。' })], [h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { $('help-dialog').close(); } }, '关闭')]);
  }

  // ---------------------------------------------------------------- keyboard
  function onKey(e) {
    if (e.defaultPrevented) return;
    var lbOpen = $('lightbox').open;
    if (lbOpen) {
      if (e.key === 'ArrowLeft') { lbStep(-1); e.preventDefault(); } else if (e.key === 'ArrowRight') { lbStep(1); e.preventDefault(); }
      else if (e.key === 'Escape') { $('lightbox').close(); e.preventDefault(); var sb = $('stage').querySelector('button.shot'); if (sb) sb.focus(); }
      return;
    }
    if (document.querySelector('dialog[open]')) return;
    var typing = isTyping(e.target);
    if (typing) {
      if (e.key === 'Escape' && e.target.id === 'comment') { e.target.blur(); flushComment(); e.preventDefault(); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var inReview = !$('review').hidden;
    if (e.key === '?') { openHelp(); e.preventDefault(); return; }
    if (!inReview) {
      if (e.key === '/') { $('filter-text').focus(); e.preventDefault(); return; }
      if (/^Arrow/.test(e.key) && e.target.classList && e.target.classList.contains('tile')) { moveTileFocus(e.target, e.key); e.preventDefault(); }
      return;
    }
    var dkey = M.DECISION_ORDER.find(function (k) { return D[k].key === e.key; });
    if (dkey) { decide(dkey); e.preventDefault(); return; }
    switch (e.key) {
      case ']': case 'j': case 'J': step(1); e.preventDefault(); break;
      case '[': case 'k': case 'K': step(-1); e.preventDefault(); break;
      case 'Escape': closeReview(); e.preventDefault(); break;
      case 'c': case 'C': var ta = $('comment'); if (ta) { ta.focus(); e.preventDefault(); } break;
      case 'o': case 'O': var shot = $('stage').querySelector('button.shot'); if (shot) { shot.click(); e.preventDefault(); } break;
      case 'ArrowLeft': setFrame(app.frameIndex - 1); e.preventDefault(); break;
      case 'ArrowRight': setFrame(app.frameIndex + 1); e.preventDefault(); break;
    }
  }
  function moveTileFocus(el, key) {
    var r = Number(el.dataset.r), c = Number(el.dataset.c);
    var dr = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0, dc = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
    for (var i = 1; i < 200; i++) {
      var t = document.querySelector('.tile[data-r="' + (r + dr * i) + '"][data-c="' + (c + dc * i) + '"]');
      if (t) { t.focus(); t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
      if (r + dr * i < 0 || c + dc * i < 0) return;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
