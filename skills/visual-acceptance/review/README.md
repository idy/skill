# Visual acceptance review UI

The review page is the acceptance matrix that people and agents share. It shows
evidence captured from a **real running app** (Device Hub, simulator/emulator
or physical device) and records human opinions next to the AI's. It is not the app
under review, and screenshots of this page are never app evidence.

Plain HTML/CSS/JS, no framework, no build step, no CDN, analytics, remote fonts
or external scripts. The same files work as a static export (`file://` or any
static HTTP) and behind core's loopback server.

## Files (`ui-files.json`)

| File | Role |
| --- | --- |
| `index.html` | Shell. Loads `./review-data.js` (written by core export), then the scripts below. |
| `review.css` | Styles; light/dark follow the system. |
| `review-model.js` | Pure model: view-model normalisation, evidence facts, filters, frozen queue, feedback/export/import, human-decision bridge. |
| `review-storage.js` | Draft storage (localStorage, rev-checked) and the loopback API client. |
| `review-app.js` | DOM app: matrix, focused review, sequence viewer, lightbox, dialogs, keyboard. |

`ui-files.json` lists exactly what core copies and serves. A shared loader validates
flat relative resource names, uniqueness, reserved generated-data names and regular
files without symlinks. `tests/` and this README are not part of the exported UI or
localhost routes.

## Data loading (docs/contracts.md, schemaVersion 1)

1. On `http(s)`, `GET /api/session` → if it answers, **server mode**: `GET /api/review`
   (polled every 15 s with `If-None-Match`), drafts through `/api/drafts`, explicit
   batches through `/api/feedback`. The token is held in memory only and sent as
   `X-Visual-Acceptance-Token` on writes. Never in URLs or exports.
2. Otherwise `globalThis.VISUAL_ACCEPTANCE_DATA` from `review-data.js` → **static mode**.
3. Otherwise, on HTTP, `./review.json`; otherwise an "打开 review.json" file picker.
   The UI never calls `fetch(file://…)`.

Page URLs carry no query string (core's server rejects them). Deep links use
`#cell=<cellId>`. Test-only polling override: `localStorage['visual-acceptance:review:poll-ms']`.

## What the UI shows

- **Matrix**: rows are scenario × state or transition; columns are device ×
  orientation. Columns are sized from `device.screen` when declared, otherwise from
  the captured image's pixels. Unknown sizes are drawn dashed. Variants
  (language/theme/font) are separate groups or tabs. Every spec cell has a tile, including
  missing, blocked and broken ones. Combinations outside the spec read "未列入 spec".
  Images are never rotated or reused across columns. If an image's shape does not
  match its column orientation, the tile is flagged.
- **Default focus "需关注"**: AI question/fail, evidence problems (missing, blocked,
  process gap, broken image, orientation mismatch) or no human decision on the
  current capture. You can also filter by scenario, device/orientation, state,
  kind, AI verdict, human state, evidence and variant, or search.
- **Focused review**: the original image (click for the lightbox: fit/100/200/400 %,
  pan, original file), plus entry/route, checkpoints, AI opinion, human opinion,
  adapter assertions (with `stateId`), limitations/blockers and full evidence
  details. The details cover provenance; source/build/runtime identity; and per-asset
  sha256, size, time and path. They also list capture history.
- **Transitions**: the trigger action (`triggerActionIndex`), from → to states,
  and frames ordered by `offsetMs`. Start and end frames (`startEvidenceAssetId` /
  `endEvidenceAssetId`) are marked. The view has a timeline with action markers,
  playback at the recorded intervals, and a video when one exists. The UI explains
  a **process gap** when there are fewer than 3 ordered frames, the trigger, start
  or end frame is not bound, or decoded `pixelSha256` fingerprints show every
  frame is identical. Different encoded file hashes cannot establish visual change.
  Older exports without decoded fingerprints say that pixel change is unverified;
  re-export using current core. Video alone is not
  treated as motion proof. A single end screenshot never passes as a verified transition.
- **Provenance**: real device, simulator or emulator, and controlled IO (runtime
  `fixture.mode`). Anything whose `provenance.source` is not `real-app` is
  stamped **FIXTURE · 非真实 App 证据** on tiles, in the review panel and in the
  lightbox.

## AI vs human

AI reviews are read-only and current only for the current capture. Reviews of
older captures, or reviews the view model marks stale, appear under
"已失效的 AI 意见". If the view declares `reviewProtocol` (currently
`visual-acceptance-2`), AI reviews under any other protocol are history only, even
when an older export did not mark them stale. Human drafts are stored separately and keyed by
`cellId@captureId`. New evidence never rebinds a draft:

- While you edit, newer evidence for the same cell shows a banner. Your editor
  stays bound to its version until you switch. You can then carry the text over,
  but you must decide again.
- Opinions on older versions stay visible as **旧版**. If a cell has old opinions
  but no decision on the current capture, its state is **需复审**.
- `historicalHumanReviews` (removed cells) are listed read-only.

## Human decisions and the contract bridge

The buttons are **通过 / 需修改 / 阻塞 / 不适用** (1–4). Every option except 通过
requires a reason. The core feedback edit `verdict` is `pass|question|fail`, so
the bridge (`review-model.js`) maps each decision to a verdict and keeps the
exact decision in extra fields that core preserves:

| decision | verdict | comment sent |
| --- | --- | --- |
| `pass` | `pass` | comment as typed (may be empty) |
| `needs-change` | `fail` | `[需修改] …` |
| `blocked` | `question` | `[阻塞] …` |
| `not-applicable` | `question` | `[不适用] …` |

Extra fields on each edit are `decision`, `humanComment`, `draftRev` and
`draftUpdatedAt`. Core's `PUT /api/drafts` requires a contract verdict, a
reviewer and at most one edit per cell. The bridge (`draftsForServer`) therefore
sends one draft per cell: the current-capture draft first, otherwise the newest.
It never changes a draft's `captureId`. Undecided comment-only drafts go as
`verdict:"question", undecided:true`. Before the reviewer has entered a name,
drafts carry `reviewer:"reviewer-not-set"`; a batch cannot be submitted without a
name.

## Saving, queue, submission

- **Autosave**: comments save 600 ms after typing stops, on blur, before
  navigation and on page hide. The status line shows 未保存 / 保存中 / 已保存
  (with where) / 保存失败 (with 重试) / 版本冲突.
- **Static mode**: localStorage `visual-acceptance:review:v1:<projectId>:draft:<cellId>@<captureId>`.
  These drafts exist only in this browser profile for this page origin. They are
  not shared, there is no collaboration claim, and they are never sent to Pi
  automatically. Each save is read back to verify it.
- **Server mode**: drafts are written to core (`drafts.json` in the store), and
  localStorage only mirrors them. A save counts as done only after the server
  accepts it.
- **Conflicts**: every draft has a `rev`. If another tab or an import changes the
  draft you are editing, the UI shows both versions. Your unsaved text is kept
  until you choose to keep yours or take theirs.
- **Decision → next**: a decision is saved first. Only after the save succeeds
  does the queue move to the next unresolved item. A failed save leaves you on the
  same item.
- **Frozen queue**: "逐项审核" freezes the current filter result as a list of
  cell IDs, kept in sessionStorage. Filter changes never reindex it. 上一项 /
  下一项 walk the snapshot. "按当前筛选重建队列" is explicit.
- **提交给 Pi**: this is an explicit batch of current-capture decisions changed
  since their last submission. The same `batchId` and body are reused for every
  retry.
  - The response's `dispatch` is shown as is. `persisted` means delivered.
    `queued`/`requested` mean not yet confirmed. `not-connected` means the server
    has no Pi session.
  - **HTTP 503 `{accepted:true, dispatch:"pending"}`** reads "意见已保存，回 Pi
    待重试". The opinions count as saved, and the batch stays pending for an exact
    retry.
  - After a server restart, the client refreshes the token through `/api/session`
    and resends the original body unchanged, with its original `sourceId`.
  - A batch that was never accepted, rejected because the source changed, goes
    back to draft so it can be submitted again as a new batch.
  - In static mode the dialog offers to copy or download the batch JSON for core
    `feedback-import` or for pasting into Pi.
- **复制人审意见**: copies every human opinion with project, cell, device,
  orientation, size, capture/version, build/runtime/spec, image IDs with sha256 and
  path, checkpoints and comment. If the clipboard is refused, a selected read-only
  text box appears for manual copy.
- **Export/import JSON**: the export is a feedback batch (`kind:
  visual-acceptance-human-feedback`, `edits` importable by core) plus all `drafts`.
  Import checks `schemaVersion` and the project, and reports per-item errors with
  their path (e.g. `drafts[3].captureId`). An imported opinion keeps its original
  capture binding. Conflicts default to keeping the local version.

## Keyboard

`1–4` decide · `]`/`J` next · `[`/`K` previous · `←/→` frames (and images in
the lightbox) · `O` original · `C` comment · `Esc` leave comment / close dialog /
back to matrix · `/` search · arrows move between tiles · `?` help.

## Tests

```bash
# Install the locked development dependencies and Chromium once.
npm ci --ignore-scripts --omit=peer
npm run browser:install

# core + UI model/storage + adapter checks (host tests are opt-in)
npm test

# Real browser. The first 13 tests require no private store. To include the two
# real-core server cases and native bundle case, supply these optional inputs:
VA_CORE_ROOT=/path/to/this/checkout VA_CORE_STORE=/path/to/store-to-copy \
VA_REAL_BUNDLE=/path/to/exported/review-dir \
VA_SHOTS=/tmp/va-review-ui-shots npm run test:browser

# Optional existing-browser override (no absolute temporary path is required):
# CHROME=/path/to/chrome-headless-shell npm run test:browser
```

The static and mock-server suites use **FIXTURE** data from
`tests/support/fixture.mjs`: synthetic SVGs stamped "FIXTURE · NOT APP EVIDENCE",
with `provenance.source:"review-ui-fixture"`. They test the page only.
`tests/support/mock-review-server.mjs` is a test double of core's loopback server
with fault injection.

The optional core suite starts core's real `startReviewServer` on a temporary
**copy** of a real store and writes only labelled automated-test feedback
(`reviewer: review-ui-browser-test`) into that copy. The real-bundle suite opens
a static export of real app evidence. None of these runs is human acceptance.
