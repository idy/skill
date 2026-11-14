# Trail Notes: real native Device Hub example

Trail Notes is a small runnable **SwiftUI iOS app**, built for this seeded visual-acceptance demonstration. Its repository fixture controls deterministic IO delays and success/failure only. The same `ItineraryStore` and SwiftUI view handle the actual UI button taps and all states.

The [recorded run](recorded-run/review.json) contains real iPhone and iPad simulator evidence, not screenshots of a review webpage. It has eight final cells: empty, ready, connection failure and download transition on two actual simulator screen configurations. The AI inspection covered all representative images. `humanPass` is **0**; nobody's automated browser interactions are presented as human approval. The recordings have not been watched end-to-end and the AI verdicts do not claim measured animation smoothness.

## What was found and repaired

The initial native source deliberately constrained the offline map coverage sentence to one line and 170 points. Both actual screenshots showed **“Offline maps include...”**, hiding the full-trail and emergency-exit information. This is a **seeded demonstration defect**, not a bug discovered in a preexisting user application.

The fix changes the production `ItineraryView.ready` text to use its available width and grow vertically. It was compiled into a different `.app`, installed and launched on both isolated simulators, and captured again. The phone now shows the full sentence on two lines; the iPad shows it on one line. Distance, duration and departure details remain visible.

| Screen | Before | After |
| --- | --- | --- |
| iPhone 17, 402 × 874 pt | [Original failed screenshot](recorded-run/evidence/45325879ddcd4db052368828ca6490c2f8421962d25ea6dd295a0ba43d4b3b18.png) | [Original repaired screenshot](recorded-run/evidence/a3854ae9105eac838371ab95bb9b321fc2bc64a946e0c66853f5f728fa6e3cc0.png) |
| iPad mini, 744 × 1133 pt | [Original failed screenshot](recorded-run/evidence/4a0f4ec98cb34a7db648bdc0da11d56a12200d15b4e5fd3a8a0918624ed47781.png) | [Original repaired screenshot](recorded-run/evidence/c9b850ff2a038812ea53d782abf2b29d1c83551dab7de174633fa402cb96abc5.png) |

[The evidence index](recorded-run/INDEX.md) lists the source/build identities, all states, actual transition timing, image/video hashes and review histories. The earlier two failed reviews remain stale after the new build/captures. Two intermediate transition reviews were also superseded by an explicitly identified movie-metadata correction; their image/video bytes did not change.

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
  "specRev":"demo-spec-1",
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

Use core `cellIdFor` with the tuples in the recorded run's spec; do not invent different cell IDs. The example runner currently targets the demonstrated iOS 27.0 runtime and portrait configuration; adapt its explicit OS metadata when testing another environment. `--states ready` or `--states download` limits collection. `--before` collects only the ready cells from a separately installed before build. Each run requires a fresh output directory and does not overwrite old images.

Every new raw image must be opened and actually inspected. Record its visible text, concrete observations and SHA. A state may be visibly reached while a layout checkpoint fails: the original ready screenshots demonstrate that distinction. Core capture ingestion needs the explicit visual reachability assertion after that inspection. A hierarchy match alone cannot supply it.

## Core integration and review UI handoff

`integrate-demo.mjs` is the explicit integration harness used for this recorded run. It imports `EvidenceStore` and `cellIdFor` from a selected core checkout, while writing only to the selected local store. It expects the locally retained `artifacts/before`, `artifacts/after`, `artifacts/captures-before`, `artifacts/captures-after`, `artifacts/transitions-with-end`, bindings files and separately authored SHA-bound inspection notes. These local artifacts are preserved in the author worktree; the portable `recorded-run` is the public, read-only handoff.

The integration sequence was:

1. Register a source snapshot from the exact clean before commit, retained `.app` and immutable fixture runtime; ingest the two raw before captures with explicit image-inspected reachability assertions.
2. `images --phase before` issues core receipts and writes the exact returned image bytes. Open each with the image tool, then `record --phase before` saves the actual failure notes.
3. Register the fixed source snapshot, different `.app` and runtime; ingest all eight final cells. The before AI reviews must be stale.
4. `images --phase after` issues receipts for all sixteen final representative images. Open each, then `record --phase after` consumes the actual, image-bound inspection notes. The full videos remain available to human reviewers.

Commands use `--core /absolute/path/to/the-integrated-repository --store /absolute/path/to/a-new-local-store`; `before` also needs `--before-source-repo /absolute/path/to/the-exact-before-commit-checkout`. No store record retains an absolute dependency on that checkout. It retains source hashes/private reconstruction blobs and copied evidence bytes. The integration harness does not assert that a receipt proves cognition: actual image reads in the agent session are the basis for the notes.

For HTML worker integration, load `recorded-run/review.json`, or use `recorded-run/review-data.js` as `globalThis.VISUAL_ACCEPTANCE_DATA`. Copy the `recorded-run/evidence/` directory unchanged alongside the UI export. Asset paths already follow the common `evidence/<sha>.<ext>` contract. The package contains no alternate review HTML and no UI fixture disguised as App screenshots. The full local `artifacts/core-store` can be opened with core CLI/server after integration; no Pi feedback or human approval has been submitted by this demonstration.

## Preserved artifacts and cleanup

`recorded-run/builds/` contains both actual ad-hoc-signed arm64 simulator `.app` archives and manifests. `recorded-run/source/before` and `source/after` retain the exact compiled Swift source. The clean before source commit is `100f1b1b4b8376b298dc29780d35a3dd3a928d58`; the fixed source was captured as a dirty binary patch against that commit and is identified in `source-identities.json`. Source/build/image hashes are independently listed in `SHA256SUMS.json`.

Capture sessions were closed with `DeviceInteractionEndSession`, and each recorder was finalized with SIGINT. The two dedicated iOS 27 simulators were shut down after evidence collection; their installed sample app/data and all evidence were retained. The initially created iOS 26.5 devices were also shut down and retained. No existing simulator or app was erased. No capture process or review server is intentionally left running by this worker.
