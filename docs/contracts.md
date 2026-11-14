# Visual acceptance v1 contract

Status: shared implementation contract, schemaVersion `1`. Paths below are relative to package root. Core owns this document and `scripts/**`, `schemas/**`, `extensions/**`; review worker owns `skills/visual-acceptance/review/**`; device worker owns `skills/visual-acceptance/adapters/device-hub/**`, `examples/device-hub-app/**`, `docs/device-hub.md` and its tests. No dependency on a Web capture platform.

## IDs and project input

IDs are stable opaque strings matching `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. Keep IDs when labels change. A cell is identified by scenarioId + stateId + deviceId + orientation + variantId; core exports `cellIdFor(cell)` in `scripts/lib/contracts.mjs` (SHA256 of canonical tuple, prefix `cell-`, first 24 hex). State entries have kind `state` or `transition`; transition adds `fromStateId`, `toStateId`. Orientation is `portrait|landscape|unspecified`. Variant is always explicit (e.g. `default`) and may label `language`, `theme`, `fontScale`.

`project.json` input to `init` / `spec`:

```json
{"schemaVersion":1,"project":{"id":"my-app","name":"My app"},"spec":{"revision":"spec-1","scenarios":[{"id":"checkout","label":"Checkout"}],"states":[{"id":"empty","label":"Empty","kind":"state"}],"devices":[{"id":"iphone","label":"iPhone","platform":"ios"}],"variants":[{"id":"default","label":"Default","language":"en","theme":"light","fontScale":1}],"cells":[{"scenarioId":"checkout","stateId":"empty","deviceId":"iphone","orientation":"portrait","variantId":"default","checkpoints":["Empty message is readable"]}]},"policy":{"maxRepairRounds":2,"captureRetries":1,"maxMinutes":30,"maxImages":80,"revision":"policy-1"}}
```

Core derives cell IDs. `spec` is immutable by revision. `target` is mutable pointer `{buildId,runtimeId,specRev}`. Capture/build/spec mismatches are stale. Source changes alone do not invalidate an unchanged artifact/runtime/spec.

## Evidence store and adapter handoff

CLI: `node scripts/visual-acceptance.mjs <command> --store <directory> ...`. Default store is `.visual-acceptance` under cwd. Commands: `init --input project.json`; `spec --input project.json`; `source --repo . [--related path]` (repeat related); `build --input build.json`; `runtime --input runtime.json`; `target --input target.json`; `capture --input capture.json`; `export --out review-directory`; `serve [--port 0]`; `status`; `feedback-import --input batch.json`; `run-start`; `run-step --input step.json`. JSON outputs, errors nonzero. Core library exports `EvidenceStore` from `scripts/lib/store.mjs`, with async equivalents `init`, `setSpec`, `snapshotSource`, `addBuild`, `addRuntime`, `setTarget`, `addCapture`, `reviewData`, `importFeedback`, `startRun`, `stepRun`.

`source` snapshots Git HEAD + tracked dirty binary diff hash and hashes of related untracked files, with repository-relative file names. Private `sourceBlobs/<sha256>` retains the binary Git patch and related file bytes for reconstruction (directory manifests retain names). Snapshot content is private and never served; exported provenance is identity summaries. Include all build-affecting untracked paths with `--related` (ignored paths supported explicitly). Source IDs are content derived.

Build input: `{id, sourceSnapshotId, artifact:{path,sha256?}, platform, command, createdAt, immutable:true}`. Core hashes actual artifact bytes (file or recursively sorted directory tree), validates supplied sha256, saves identity; cannot prove the installed runtime matches it. Runtime input: `{id,buildId,adapter:{name,version},app:{id,version},fixture:{id,version,mode:"none|controlled-io",description},environment:{...},immutable:true,driftDetected:false,limitations:[]}`. Dev/HMR or detected drift blocks acceptance.

Adapter imports build/runtime/source via these CLI calls, then supplies capture input (paths absolute or relative to capture JSON directory when CLI; library uses cwd):

```json
{"id":"capture-unique-1","cellId":"cell-...","sourceSnapshotId":"source-...","buildId":"build-1","runtimeId":"runtime-1","specRev":"spec-1","createdAt":"2026-01-01T00:00:00.000Z","status":"captured","assets":[{"id":"screen-1","kind":"screenshot","path":"/absolute/real.png","capturedAt":"2026-01-01T00:00:00.000Z","width":390,"height":844}],"actions":[{"at":"2026-01-01T00:00:00.000Z","type":"tap","description":"Tap Checkout","source":"device-hub"}],"assertions":[{"description":"Empty state visible","result":"pass","basis":"visual","evidenceAssetIds":["screen-1"]}],"provenance":{"adapter":"device-hub","adapterVersion":"1","deviceId":"actual-device-identifier","deviceKind":"simulator","source":"real-app","fixtureDescription":"Controlled network IO; production UI/state machine"},"limitations":[],"blockers":[]}
```

`status` is `captured|blocked`; blocked captures may have no assets and must have concrete blockers. Core verifies and copies bytes to content-addressed `blobs/<sha256>.<ext>`; input `path` becomes `path` relative to export root (`evidence/<sha256>.<ext>`) in review JSON plus `sha256`, `mimeType`, `width`, `height`. Screenshots/frames are validated by decoding; invalid images are rejected, so adapter should register a blocked capture with the reason. Video assets use kind `video`, `mimeType` mp4/webm, `durationMs`. Transition captures add `transition:{fromStateId,toStateId,startedAt,endedAt}` and require real actions plus 2+ strictly time-ordered `frame` assets with `offsetMs` starting 0, or video plus representative frames. Video is retained for humans; AI must view each representative frame and cannot claim measured smoothness from sparse frames. End screenshot alone is blocked. Reused screenshot hashes across different state cells generate a blocker for investigation, never auto-pass. The adapter must not rotate/resize/prototype images to impersonate a device/state.

## Review UI loading and view model

UI entry: `skills/visual-acceptance/review/index.html`; assets same directory. Server mounts this directory at `/`, `GET /api/review` returns view model, `GET /evidence/<sha256>.<ext>` serves only known blobs. Export copies UI files + `review.json` + `review-data.js` (`globalThis.VISUAL_ACCEPTANCE_DATA = <safe JSON>;`) + `evidence/`. Static HTML must load `./review-data.js` and may fetch `./review.json` when HTTP. Never require `fetch(file://...)`; embed script fallback works. UI must not contain hardcoded data; absent server supports JSON file load and feedback copy/download. Core creates `review-data.js` only at export time, not in UI source.

`GET /api/review` / export view model:

```json
{"schemaVersion":1,"project":{"id":"my-app","name":"My app"},"spec":{"revision":"spec-1","scenarios":[],"states":[],"devices":[],"variants":[],"cells":[]},"target":{"buildId":"build-1","runtimeId":"runtime-1","specRev":"spec-1"},"policy":{},"generatedAt":"...","cells":[{"id":"cell-...","scenarioId":"checkout","stateId":"empty","deviceId":"iphone","orientation":"portrait","variantId":"default","checkpoints":[],"status":"missing|blocked|stale|unreviewed|pass|question|fail","staleReasons":[],"capture":null,"captures":[],"aiReviews":[],"humanReviews":[],"currentAIReview":null,"currentHumanReview":null}],"storage":{"mode":"local-single-reviewer","drafts":"browser-local and server when available","collaboration":false}}
```

`sources` additionally exposes safe identity summaries `{id,head,dirty,dirtyDiffSha256,relatedInputCount,relatedInputsSha256}`; no source bytes, private blob locations, related filenames or untracked names are exported. `builds` exposes artifact hash/size/kind (no input path), and `runtimes` exposes the explicitly supplied review-safe runtime/fixture identity. `summary` includes total, aiPass, finalAIPass and humanPass; finalAIPass requires every cell current on the same target.

`capture` is newest capture or null; `captures` preserves history. All capture fields above remain, except private input paths replaced with evidence-relative paths. `aiReviews` contain `{id,cellId,captureId,buildId,runtimeId,specRev,policyRev,createdAt,verdict:"pass|question|fail",comment,visibleText:["..."],observations:[{assetId,sha256,detail}],receiptIds:[],reviewer:{provider,model},stale:boolean,staleReasons:[]}`. Every image asset must have a receipt/observation. `humanReviews` contain feedback edit fields below plus `id,batchId,createdAt,stale,staleReasons`. Human/AI histories are independent. Current review is latest nonstale review or null; no human inference from AI. Empty visibleText is allowed only with explicit no-text explanation in comment.

## Browser feedback protocol

`GET /api/session` => `{schemaVersion:1,projectId,sourceId,token}`. This endpoint exists only on loopback server. Server requires exact same `Origin` on writes and `X-Visual-Acceptance-Token: <token>`; no CORS. Request bodies JSON, size limited. Never put token in exports or URL. Source ID changes when server session changes.

`PUT /api/drafts` body `{schemaVersion:1,projectId,sourceId,edits:[...]}` saves each edit; does not trigger Pi. Draft comments may be empty while typing, including question/fail; explicit submission requires complete comments. `GET /api/drafts` => same + `savedAt` (edits default []). Draft saves should retain target identity even if a newer capture arrives. UI must await save success before moving its queue. Browser localStorage namespace includes project + source/capture identity; static mode drafts are local to that browser, no collaboration claim.

`POST /api/feedback` body `{schemaVersion:1,batchId,projectId,sourceId,submittedAt,edits:[{cellId,captureId,buildId,runtimeId,specRev,verdict:"pass|question|fail",comment,reviewer:"human-name"}]}`. `captureId` may be null for missing evidence; build/runtime may be null only with null capture. Same shape is copy/JSON import fallback. Human comment required for question/fail; pass may have empty comment. UI creates batchId once and reuses on retries. Reply `{accepted:true,duplicate:false,batchId}`; same batch exact content => duplicate true, different content => conflict. Unknown cells/project/capture/version mismatch rejected; old known versions accepted with stale flag, never rebound. `sourceId` must match server for HTTP. CLI offline import accepts a nonempty sourceId and labels transport `json-import`; does not impersonate a live browser.

Explicit accepted batch only triggers extension `pi.sendMessage({customType:"visual-acceptance-feedback", content:<model-visible origin/project/batch/cells/versions/comments JSON with data warning>, details:<batch>,display:true},{triggerTurn:true,deliverAs:"followUp"})`. No slash expansion, no `sendUserMessage`. Server only exposes review/evidence/drafts/feedback endpoints, never commands, capture, arbitrary paths, private snapshots, receipts, or logs.

## AI image receipt

Extension tools: `visual_acceptance_status`, `visual_acceptance_image` (`store?,cellId,assetId?` => exactly one image block + text receipt), `visual_acceptance_record` (`store?,cellId,captureId,verdict,comment,visibleText,observations,receiptIds`). Receipt binds session + capture + asset sha + target build/runtime/spec/policy; supplied image precedes a later record call. New image/build/runtime/spec/policy/capture invalidates. Blocked images, image-disabled settings, or a model without image input cause explicit blocked error, no receipt/pass. Receipt proves delivery sequencing only, never cognition. Store also validates image bytes and current target at record time. Agent actually inspects each newly captured image before any conclusion; DOM/OCR is supplementary.
