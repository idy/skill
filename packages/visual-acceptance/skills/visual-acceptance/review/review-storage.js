/*
 * Visual acceptance review UI — draft storage + loopback server client.
 *
 * Draft scope is explicit:
 *  - static (file:// or plain HTTP export): drafts live only in THIS browser
 *    profile's localStorage for this page origin. No collaboration, no Pi.
 *  - server (loopback `serve`): drafts are written to the local server via
 *    PUT /api/drafts; localStorage is only a crash mirror.
 *
 * Exposes globalThis.VAReview.storage.
 */
(function (root) {
  'use strict';

  var NS_VERSION = 'v1';

  function safeParse(text) { try { return JSON.parse(text); } catch (e) { return null; } }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /**
   * localStorage store. Each draft key is its own storage entry, so one tab
   * only overwrites what it edits; `rev` detects concurrent edits (other tab,
   * import) and reports a conflict instead of silently overwriting.
   */
  function createLocalStore(projectId, ls) {
    var prefix = 'visual-acceptance:review:' + NS_VERSION + ':' + projectId + ':';
    var draftPrefix = prefix + 'draft:';
    var available = true, availabilityError = null;
    try {
      var probe = prefix + '__probe';
      ls.setItem(probe, '1'); ls.removeItem(probe);
    } catch (e) { available = false; availabilityError = String(e && e.message || e); }

    function read(key) { return available ? safeParse(ls.getItem(draftPrefix + key)) : null; }

    return {
      kind: 'local',
      prefix: prefix,
      available: available,
      availabilityError: availabilityError,
      loadAll: function () {
        var out = new Map();
        if (!available) return out;
        for (var i = 0; i < ls.length; i++) {
          var k = ls.key(i);
          if (k && k.indexOf(draftPrefix) === 0) {
            var d = safeParse(ls.getItem(k));
            if (d && d.cellId) out.set(k.slice(draftPrefix.length), d);
          }
        }
        return out;
      },
      read: read,
      /**
       * Save with optimistic concurrency. baseRev is the rev the editor started
       * from. Returns {ok, draft} | {conflict, theirs} | {error}.
       * Success is reported only after a read-back matches what was written.
       */
      save: function (key, draft, baseRev, opts) {
        if (!available) return { error: '此浏览器禁止 localStorage：' + availabilityError };
        var existing = read(key);
        var existingRev = existing ? Number(existing.rev) || 0 : 0;
        if (!(opts && opts.force) && existingRev !== (Number(baseRev) || 0)) return { conflict: true, theirs: existing };
        var next = Object.assign({}, draft, { rev: Math.max(existingRev, Number(baseRev) || 0) + 1 });
        try { ls.setItem(draftPrefix + key, JSON.stringify(next)); }
        catch (e) { return { error: '写入浏览器存储失败：' + String(e && e.message || e) }; }
        var back = read(key);
        if (!back || !same(back, next)) return { error: '写入后读回校验失败' };
        return { ok: true, draft: next };
      },
      getMeta: function () { return available ? (safeParse(ls.getItem(prefix + 'meta')) || {}) : {}; },
      setMeta: function (patch) {
        if (!available) return false;
        var m = Object.assign(this.getMeta(), patch);
        try { ls.setItem(prefix + 'meta', JSON.stringify(m)); return true; } catch (e) { return false; }
      },
      /** Subscribe to writes from other tabs of this browser. */
      onExternalChange: function (win, cb) {
        if (!win || !win.addEventListener) return;
        win.addEventListener('storage', function (ev) {
          if (!ev.key || ev.key.indexOf(draftPrefix) !== 0) return;
          cb(ev.key.slice(draftPrefix.length), safeParse(ev.newValue));
        });
      }
    };
  }

  /** Session-scoped queue snapshot (survives reload, not shared across tabs). */
  function createSessionSlot(projectId, ss) {
    var key = 'visual-acceptance:review:' + NS_VERSION + ':' + projectId + ':queue';
    return {
      get: function () { try { return safeParse(ss.getItem(key)); } catch (e) { return null; } },
      set: function (v) { try { if (v) ss.setItem(key, JSON.stringify(v)); else ss.removeItem(key); } catch (e) { /* ignore */ } }
    };
  }

  /**
   * Loopback server client (docs/contracts.md "Browser feedback protocol").
   * Token is obtained from GET /api/session and only kept in memory.
   */
  function createServerClient(fetchFn, base) {
    base = base || '';
    var session = null;
    function headers(write) {
      var h = { 'Accept': 'application/json' };
      if (write) { h['Content-Type'] = 'application/json'; h['X-Visual-Acceptance-Token'] = session.token; }
      return h;
    }
    function fail(res, body) {
      var msg = (body && (body.error || body.message)) || ('HTTP ' + res.status);
      var e = new Error(msg); e.status = res.status; e.body = body; return e;
    }
    function json(res) { return res.text().then(function (t) { return t ? safeParse(t) : null; }); }
    return {
      kind: 'server',
      get session() { return session; },
      /** Resolves null when no loopback review server answers. */
      detect: function () {
        return fetchFn(base + '/api/session', { headers: headers(false), cache: 'no-store' }).then(function (res) {
          if (!res.ok) return null;
          return json(res).then(function (b) {
            if (!b || b.schemaVersion !== 1 || !b.token || !b.sourceId) return null;
            session = b; return b;
          });
        }).catch(function () { return null; });
      },
      getReview: function (etag) {
        var h = headers(false); if (etag) h['If-None-Match'] = etag;
        return fetchFn(base + '/api/review', { headers: h, cache: 'no-store' }).then(function (res) {
          if (res.status === 304) return { notModified: true };
          return json(res).then(function (b) { if (!res.ok) throw fail(res, b); return { data: b, etag: res.headers.get('ETag') }; });
        });
      },
      getDrafts: function () {
        return fetchFn(base + '/api/drafts', { headers: headers(false), cache: 'no-store' }).then(function (res) {
          return json(res).then(function (b) { if (!res.ok) throw fail(res, b); return b || { edits: [] }; });
        });
      },
      /** Drafts always use the CURRENT session source (rebuilt after a token refresh). */
      putDrafts: function (edits) {
        var self = this;
        function send() {
          return fetchFn(base + '/api/drafts', {
            method: 'PUT', headers: headers(true),
            body: JSON.stringify({ schemaVersion: 1, projectId: session.projectId, sourceId: session.sourceId, edits: edits })
          }).then(function (res) { return json(res).then(function (b) { if (!res.ok) throw fail(res, b); return b; }); });
        }
        return send().catch(function (e) { if (e.status !== 403) throw e; return self.detect().then(function (s) { if (!s) throw e; return send(); }); });
      },
      /**
       * Send a feedback batch body UNCHANGED (original batchId/sourceId) — retries
       * after a server restart only refresh the token. HTTP 503 with
       * {accepted:true, dispatch:"pending"} means the opinions are persisted but
       * the Pi callback failed: resolved (not thrown) with httpStatus 503.
       */
      postFeedback: function (batch) {
        var self = this, body = JSON.stringify(batch);
        function send() {
          return fetchFn(base + '/api/feedback', { method: 'POST', headers: headers(true), body: body })
            .then(function (res) {
              return json(res).then(function (b) {
                if (res.ok) return Object.assign({ httpStatus: res.status }, b);
                if (res.status === 503 && b && b.accepted === true) return Object.assign({ httpStatus: 503, dispatch: 'pending' }, b);
                throw fail(res, b);
              });
            });
        }
        return send().catch(function (e) { if (e.status !== 403) throw e; return self.detect().then(function (s) { if (!s) throw e; return send(); }); });
      }
    };
  }

  /**
   * Coalescing serial pusher: at most one PUT in flight; callers await the
   * push that includes their change.
   */
  function createPusher(pushFn) {
    var inflight = null, queued = null;
    function run() {
      var waiters = queued; queued = null;
      inflight = Promise.resolve().then(pushFn).then(function (r) { waiters.forEach(function (w) { w.resolve(r); }); },
        function (e) { waiters.forEach(function (w) { w.reject(e); }); })
        .then(function () { inflight = null; if (queued) run(); });
    }
    return function schedule() {
      return new Promise(function (resolve, reject) {
        if (!queued) queued = [];
        queued.push({ resolve: resolve, reject: reject });
        if (!inflight) run();
      });
    };
  }

  root.VAReview = root.VAReview || {};
  root.VAReview.storage = { createLocalStore: createLocalStore, createSessionSlot: createSessionSlot, createServerClient: createServerClient, createPusher: createPusher };
})(typeof globalThis !== 'undefined' ? globalThis : this);
