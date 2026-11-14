# Trail Notes: real native Device Hub example

Trail Notes is a small runnable **SwiftUI iOS app**, built for this seeded visual-acceptance demonstration. Its repository fixture controls deterministic IO delays and success/failure only. The same `ItineraryStore` and SwiftUI view handle the actual UI button taps and all states.

The [recorded run](recorded-run/review.json) contains real iPhone and iPad simulator evidence, not screenshots of a review webpage. Its current target is `demo-spec-2` / `demo-after-runtime-v2`, with eight final cells: empty, ready, connection failure and download transition on two actual simulator screen configurations. All current AI reviews use `visual-acceptance-2` and were written after new image receipts and actual image reads. The complete spec-1 bundle and every original media file remain preserved. `humanPass` is **0**; nobody's automated browser interactions are presented as human approval. The recordings have not been watched end-to-end and the AI verdicts do not claim measured animation smoothness.

## What was found and repaired

The initial native source deliberately constrained the offline map coverage sentence to one line and 170 points. Both actual screenshots showed **“Offline maps include...”**, hiding the full-trail and emergency-exit information. This is a **seeded demonstration defect**, not a bug discovered in a preexisting user application.

The fix changes the production `ItineraryView.ready` text to use its available width and grow vertically. It was compiled into a different `.app`, installed and launched on both isolated simulators, and captured again. The phone now shows the full sentence on two lines; the iPad shows it on one line. Distance, duration and departure details remain visible.

| Screen | Before | After |
| --- | --- | --- |
| iPhone 17, 402 × 874 pt | [Original failed screenshot](recorded-run/evidence/45325879ddcd4db052368828ca6490c2f8421962d25ea6dd295a0ba43d4b3b18.png) | [Original repaired screenshot](recorded-run/evidence/a3854ae9105eac838371ab95bb9b321fc2bc64a946e0c66853f5f728fa6e3cc0.png) |
| iPad mini, 744 × 1133 pt | [Original failed screenshot](recorded-run/evidence/4a0f4ec98cb34a7db648bdc0da11d56a12200d15b4e5fd3a8a0918624ed47781.png) | [Original repaired screenshot](recorded-run/evidence/c9b850ff2a038812ea53d782abf2b29d1c83551dab7de174633fa402cb96abc5.png) |

[The evidence index](recorded-run/INDEX.md) lists current screenshots, source/build identities, explicit transition action/endpoint bindings, timing and media hashes. The table above links the retained initial repair run. The current spec-2 cells were genuinely collected again with adapter 1.1; App source/build stayed unchanged. Old failed reviews, earlier transition metadata revisions, four blocked collection attempts and two later transient question reviews remain historical/stale. No old pass was silently inherited after the protocol/spec/runtime change.

## Build and run a new instance

Requirements: Apple Silicon Mac, Xcode with an available iOS simulator runtime, Swift and Python 3. The direct build uses only the installed SDK and ad-hoc signing for a simulator app; it does not require an Apple developer team. It refuses to overwrite an existing output directory.

```sh
python3 examples/device-hub-app/build.py --out /absolute/path/to/new-trail-build
xcrun simctl list runtimes
xcrun simctl create 'My Visual Acceptance Phone' \
  com.apple.CoreSimulator.SimDeviceType.iPhone-17 \
  com.apple.CoreSimulator.SimRuntime.iOS-27-0
```

Use the exact newly returned UUID in the following commands. Create a separate iPad mini with `com.apple.CoreSimulator.SimDeviceType.iPad-mini-A17-Pro` for the second layout. Do not use `booted` when other people's devices may be running.

```sh
xcrun simctl boot YOUR-NEW-UUID
xcrun simctl bootstatus YOUR-NEW-UUID -b
xcrun simctl install YOUR-NEW-UUID /absolute/path/to/new-trail-build/TrailNotes.app
xcrun simctl launch YOUR-NEW-UUID dev.pi.visualacceptance.TrailNotes
```

Alternatively open `TrailNotes.xcodeproj`, select your dedicated simulator and run the app. `xcodebuild -project examples/device-hub-app/TrailNotes.xcodeproj -scheme TrailNotes -sdk iphonesimulator -configuration Debug -derivedDataPath /absolute/path/to/new-derived-data CODE_SIGNING_ALLOWED=NO build` was also verified.

Use Reset, Load itinerary, Test connection failure and Try again to drive the app. Loading is twelve deterministic 200 ms IO ticks with real UI progress animation. Reset cancels the active task and returns to the empty state. The error button changes the repository outcome and still uses the same load state machine.

## Capture a new run

See [the adapter guide](../../docs/device-hub.md) for the general capture plan. `capture-demo.mjs` is a convenience runner that checks the actual installed executable SHA and performs real Device Hub taps. It takes:

```sh
node examples/device-hub-app/capture-demo.mjs \
  --bindings /absolute/path/to/bindings.json \
  --build /absolute/path/to/new-trail-build/build-manifest.json \
  --out /absolute/path/to/a-new-capture-directory
```

The bindings file supplies registered core IDs plus your exact newly created device IDs:

```json
{
  "sourceSnapshotId":"source-from-core",
  "buildId":"build-from-core",
  "runtimeId":"runtime-from-core",
  "specRev":"demo-spec-2",
  "capturePrefix":"my-new-run-1",
  "settleMs":5000,
  "endSettleMs":1000,
  "devices":[
    {"key":"phone","id":"YOUR-PHONE-UUID","model":"iPhone 17","pointWidth":402,"pointHeight":874,"pixelWidth":1206,"pixelHeight":2622,"scale":3},
    {"key":"tablet","id":"YOUR-IPAD-UUID","model":"iPad mini (A17 Pro)","pointWidth":744,"pointHeight":1133,"pixelWidth":1488,"pixelHeight":2266,"scale":2}
  ],
  "cells":{
    "phone-empty":"cell-from-core", "phone-ready":"cell-from-core",
    "phone-error":"cell-from-core", "phone-download":"cell-from-core",
    "tablet-empty":"cell-from-core", "tablet-ready":"cell-from-core",
    "tablet-error":"cell-from-core", "tablet-download":"cell-from-core"
  }
}
```

Use core `cellIdFor` with the tuples in the recorded run's spec; do not invent different cell IDs. The example runner currently targets the demonstrated iOS 27.0 runtime and portrait configuration; adapt its explicit OS metadata when testing another environment. `--states ready` or `--states download` limits collection. `--before` collects only the ready cells from a separately installed before build. Each run requires a fresh output directory and does not overwrite old images. Capture IDs use the explicit prefix or a unique timestamp.

When using the core budget, supply both `--core /path/to/immutable-or-integrated-core --store /path/to/initialized-store`, with a registered target and an already active authorized run. Before each native collection, the runner charges `capture_attempt` without supplying a round; core derives it from persisted successful repair events. Exhaustion stops collection. Do not invent repairs/rounds or repeatedly create runs to bypass limits. Keep the collector alive through cleanup; an external process timeout can otherwise orphan its session. The recorded recovery and stopped-run reason are preserved in `recorded-run/run-events.json`.

Every new raw image must be opened and actually inspected. Record its visible text, concrete observations and SHA. A state may be visibly reached while a layout checkpoint fails: the original ready screenshots demonstrate that distinction. Core capture ingestion needs the explicit visual reachability assertion after that inspection. A hierarchy match alone cannot supply it.

## Core integration and review UI handoff

`migrate-demo.mjs` imports actual raw capture inputs with separately authored SHA-bound inspection notes. It does not manufacture timing, trigger actions, endpoint states or verdicts. The collector itself supplies only live accessibility assertions. `inspection.mjs` adds visual assertions only when every image has a matching SHA, actual inspection time, visible text, comment and explicit `stateVisible: true`. A transition's first/last notes must explicitly identify the observed `stateId` values; those are post-capture visual observations, not invented real-time assertions.

A local manifest has this shape (paths resolve relative to the manifest):

```json
{"captures":[{"path":"raw-cell/capture.json","observations":[{"assetId":"frame-start","sha256":"actual-image-sha256","inspectedAt":"2026-11-14T16:45:00.000Z","stateVisible":true,"stateId":"empty","verdict":"pass","visibleText":["No itinerary yet"],"comment":"Actual image inspection details"}]}]}
```

Provide a note for every image asset. Use the actual observed verdict/comment; this example is a format illustration, not a prewritten review for a new run. The capture IDs/spec/runtime must already match the explicitly selected target, and this demo importer verifies their persisted capture-attempt charge.

```sh
node examples/device-hub-app/migrate-demo.mjs ingest --core CORE --store STORE --input manifest.json
node examples/device-hub-app/migrate-demo.mjs images --core CORE --store STORE --input manifest.json --delivery NEW-DIRECTORY
# Actually open EACH returned image with the image read tool before proceeding.
node examples/device-hub-app/migrate-demo.mjs record --core CORE --store STORE --input manifest.json --delivery NEW-DIRECTORY
node examples/device-hub-app/migrate-demo.mjs export --core CORE --store STORE --input manifest.json --out EXPORT-DIRECTORY
```

The recorded current data was validated against exact core `da13ee7aa531572834b2d848304b6a38d1955f3d`. Its four module hashes were independently compared to an immutable `git archive` snapshot; subsequent checks used that fixed snapshot, not a changing author's tree. The final merged core must revalidate evidence under any further structural fixes. `integrate-demo.mjs` retains the initial before/after registration flow, now with explicit spec selection and inspection validation; it refuses legacy transitions lacking bindings rather than rewriting their times. Local raw artifacts/private source reconstruction remain preserved in the author worktree; the public bundle is read-only and does not depend on them or another checkout's absolute path. Receipts establish sequencing, not cognition: the actual image-tool reads are the basis for the notes.

For HTML worker integration, load `recorded-run/review.json`, or use `recorded-run/review-data.js` as `globalThis.VISUAL_ACCEPTANCE_DATA`. Copy the `recorded-run/evidence/` directory unchanged alongside the UI export. Asset paths already follow the common `evidence/<sha>.<ext>` contract. The package contains no alternate review HTML and no UI fixture disguised as App screenshots. The full local `artifacts/core-store` can be opened with core CLI/server after integration; no Pi feedback or human approval has been submitted by this demonstration.

## Preserved artifacts and cleanup

`recorded-run/builds/` contains both actual ad-hoc-signed arm64 simulator `.app` archives and manifests. `recorded-run/source/before` and `source/after` retain the exact compiled Swift source. The clean before source commit is `100f1b1b4b8376b298dc29780d35a3dd3a928d58`; the fixed source was captured as a dirty binary patch against that commit and is identified in `source-identities.json`. Source/build/image hashes are independently listed in `SHA256SUMS.json`.

Capture sessions were closed with `DeviceInteractionEndSession`, and each recorder was finalized with SIGINT. The two dedicated iOS 27 simulators were shut down after evidence collection; their installed sample app/data and all evidence were retained. The initially created iOS 26.5 devices were also shut down and retained. No existing simulator or app was erased. No capture process or review server is intentionally left running by this worker.
