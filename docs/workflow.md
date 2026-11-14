# Workflow and command guide

Read [contracts.md](contracts.md) for exact JSON shapes. All commands emit JSON, and errors exit nonzero. Node 20+ is required. Paths are portable; Device Hub tool names belong only in the configurable adapter bridge. Source code, build artifacts, evidence and review HTML live independently.

```sh
node scripts/visual-acceptance.mjs init --store .visual-acceptance --input project.json
node scripts/visual-acceptance.mjs source --store .visual-acceptance --repo . --related app-fixture.json
node scripts/visual-acceptance.mjs build --store .visual-acceptance --input build.json
node scripts/visual-acceptance.mjs runtime --store .visual-acceptance --input runtime.json
node scripts/visual-acceptance.mjs target --store .visual-acceptance --input target.json
node scripts/visual-acceptance.mjs run-start --store .visual-acceptance
node scripts/visual-acceptance.mjs run-step --store .visual-acceptance --input capture-attempt.json
node scripts/visual-acceptance.mjs capture --store .visual-acceptance --input capture.json
node scripts/visual-acceptance.mjs status --store .visual-acceptance
node scripts/visual-acceptance.mjs export --store .visual-acceptance --out review-export
node scripts/visual-acceptance.mjs serve --store .visual-acceptance --port 0
```

An input JSON file's artifact/image paths resolve relative to that JSON file. CLI `source --repo` and `--related` resolve against the specified Git repository root. Library callers resolve paths against their process cwd. The artifact may be a file (APK/IPA/archive) or a recursively hashed directory (App bundle). Directory symlinks are rejected: submit an archive or materialized artifact when your build contains symlinks. The build command is a provenance description; core never executes it. Build IDs and capture IDs cannot be reused. Snapshot IDs derive from source content; source diffs and repository paths are never exposed by the review server.

`source` hashes Git HEAD, tracked dirty binary diff and every explicitly related untracked/ignored file or directory. Private `sourceBlobs` retains the binary patch and related bytes, so HEAD plus that snapshot can reconstruct dirty/related inputs. It lists other untracked names for audit but cannot decide which files affect your build. Include **all** build-affecting untracked/ignored inputs via repeated `--related`. Build registration hashes actual artifact bytes; the adapter/operator is responsible for confirming that these bytes were built from that snapshot and installed on the stated device. If installation identity cannot be verified, record the limitation or block acceptance. Runtime fixtures must identify versions, controlled IO and production UI/state-machine use. Never capture whole process environments or secrets in runtime metadata.

`spec --input project.json` adds an immutable revision and selects it for the matrix. Reusing a spec revision with different checkpoints is rejected. Review-policy changes need a new policy revision. Target selection is explicit and requires a current spec, compatible build/runtime and immutable runtime without detected drift. If state drifts during capture, register a new blocked capture with the observed reason; never silently edit earlier metadata.

A failed capture should be retained with `status:"blocked"`, a concrete `blockers` entry and whatever genuine evidence is usable. If image decode fails, register a separate blocked capture with no corrupt assets and explain the rejection. Supported screenshot/frame media are decoded PNG and JPEG (up to 40 MP/32 MiB); videos are MP4/WebM with signature checks, supplied duration and representative images. Core does not decode a video's full timeline or measure frame rate. Temporal metadata and actions are checked, but supplied provenance cannot prove itself. Sparse frame sequences carry explicit smoothness limitations.

Run events are immutable. A repair event includes `type:"repair"`, a root-cause `reason`, `affectedCellIds` and `regressionCellIds`. Capture attempts include `type:"capture_attempt"`, `cellId` and `round` (initial 0). Record the event **before** attempting collection and honor exhaustion. Images are automatically charged when delivered by the Pi tool. Once a budget is reached a stop event records its exact reason. Do not restart a spent run without a new explicit user instruction. CLI/adapter orchestration must call these budget events; the store intentionally does not execute collection or fix code.

The store uses a short cross-process lock and atomically replaces its index. Individual capture/review/feedback/run/source/build/runtime records and content-addressed blobs use exclusive creation. Historical data is append-only under normal API use; this is not a tamper-proof forensic database. Every image read is rehashed and decoded, so accidental file modification turns a cell blocked and invalidates its current reviews. If a process crashes while holding `.lock`, verify no process uses the store before manually removing that lock; no automatic stale-lock deletion occurs.

The Pi extension supplies:

- `visual_acceptance_status`: matrix, targets, asset identities, budget and stale/blocker reasons.
- `visual_acceptance_run`: explicit start and bounded repair/capture/stop events.
- `visual_acceptance_image`: one actual image block and versioned delivery receipt.
- `visual_acceptance_record`: detailed review bound to all prior image receipts in this session/model and active branch.
- `visual_acceptance_review`: review server attached to this Pi session.
- `visual_acceptance_feedback_import`: static batch import plus deduplicated model-visible custom message.

Receipt validation requires the completed image tool result in the active branch before the record call. A record called in parallel with first image delivery is rejected. Pi/provider image settings can resize or remove blocks: the extension checks model image support and `images.blockImages`, but cannot certify pixels were perceived. The agent must say when image content is unavailable. Standalone CLI has no artificial AI pass command; actual review occurs through an image-capable agent. No model API keys are handled by this package.

`visual_acceptance_review` binds only to `127.0.0.1` with an ephemeral port by default. HTTP writes require exact Host, same Origin, a per-session token header and matching source/project IDs. There is no CORS and no command/capture endpoint. Only packaged review resources and registered evidence blobs are served; private store indexes, source snapshots, receipts, logs and arbitrary filesystem paths have no routes. Browser edits are saved drafts; an explicit batch submit persists independent human records and sends an external-data follow-up to Pi. Duplicate identical batches do not create duplicate records/messages on the active Pi branch; changed content under a reused batch ID conflicts. Branch navigation closes its server; reopen for the selected branch.

CLI `serve` persists feedback but has no Pi session to notify. `feedback-import --input feedback.json` likewise only persists. Use the extension import tool to deliver the batch to Pi. Static exports contain `review-data.js` for file URL loading plus review JSON, UI assets and evidence. Draft persistence is local to the browser and/or local server store. Reviewer names are supplied labels, not authenticated identities. Only explicitly submitted batches become human review history. Static fallback source IDs label an export origin and are preserved by import; they are not live-server authentication tokens.

Core exports `EvidenceStore` in `scripts/lib/store.mjs` and validators/ID helpers in `scripts/lib/contracts.mjs`; the CLI is a thin wrapper. Schema files describe portable exchange data, and runtime checks additionally validate cross-record references, media bytes, receipt ordering and budget rules. See tests for corruption, stale versions, feedback identity/dedup, transition gaps and server request boundaries. Tests use synthetic images expressly as test fixtures; these must never be presented as real App acceptance evidence.
