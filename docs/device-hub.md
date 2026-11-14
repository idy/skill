# Device Hub capture adapter

This adapter operates a real native app through **Apple Xcode Device Hub**. The verified backend is Xcode 27.1's `xcrun mcpbridge`, using the MCP tools `DeviceInteractionStartSession`, `DeviceInteractionSynthesize`, and `DeviceInteractionEndSession`. It is not a connection to an unrelated IoT service named DeviceHub.

The adapter exports core schemaVersion 1 capture inputs. It does not define a competing evidence or review schema. See [the shared contract](contracts.md) for source/build/runtime registration, immutable blobs and review receipts.

## Verified environment and boundaries

The implementation was run on macOS with Xcode 27.1 (27A9275), Swift 6.4 and the iOS 27.0 (24A434) simulator runtime. This machine has `DeviceHub.app` under Xcode's `Contents/Applications`. No Device Hub npm package, MCP entry or standalone `devicehub` executable was preconfigured in Pi; discovery of Apple's actual bridge was required.

The bridge's MCP initialize and tools/list calls succeeded. Its first interaction request required opening the authorized sample `.xcodeproj` with `XcodeOpenWorkspace`. That succeeded, and subsequent sessions, taps, orientation commands, screenshots and cleanup were actually run. If Xcode requests local approval on another machine, the adapter saves that error as a blocker. It cannot approve an OS/Xcode permission prompt itself.

Two new, isolated simulators were created for the sample. Existing booted user simulators and their apps were left alone. iOS 26.5 simulators could build/run with simctl but were absent from the bridge's eligible-device list, so the demonstrated Device Hub captures use iOS 27.0. Exact identifiers and dimensions are in the [recorded native run](../examples/device-hub-app/recorded-run/review.json).

| Actual configuration | UI points | Framebuffer pixels | Original Device Hub PNG |
| --- | --- | --- | --- |
| iPhone 17, portrait | 402 × 874 | 1206 × 2622, scale 3 | 402 × 874 |
| iPad mini (A17 Pro), portrait | 744 × 1133 | 1488 × 2266, scale 2 | 744 × 1133 |

Device Hub's purported full-size screenshot path returned a 1× PNG in this environment. Those bytes are retained unchanged and their actual dimensions are declared. During transition recording, simctl framebuffer samples retain their original 3×/2× dimensions. The matrix must respect each asset's dimensions, rather than assuming all frames have one scale.

Physical devices, Android, other Xcode versions, app installation on physical devices and their recording capabilities have not been tested. A physical-device transition is blocked by this implementation because the supplied recorder is simulator-specific. This adapter does not claim universal Device Hub compatibility.

## Capture plan and commands

Run from the package root with Node 20+:

```sh
node skills/visual-acceptance/adapters/device-hub/cli.mjs \
  --input plan.json --out /absolute/path/to/a-new-capture-directory
```

The output directory must not exist. The CLI returns JSON, uses exit code 2 for a recorded blocker, and leaves `capture.json` plus original assets on disk. It never replaces a previous capture.

A stable-state plan uses core identities already registered in an EvidenceStore:

```json
{
  "id": "capture-my-app-empty-1",
  "cellId": "cell-from-core-cellIdFor",
  "sourceSnapshotId": "source-from-core",
  "buildId": "build-1",
  "runtimeId": "runtime-1",
  "specRev": "spec-1",
  "workspacePath": "/absolute/path/to/MyApp.xcodeproj",
  "device": {
    "id": "EXACT-DEVICE-UUID",
    "kind": "simulator",
    "os": "iOS 27.0 (24A434)",
    "orientation": "portrait",
    "pointWidth": 402,
    "pointHeight": 874,
    "pixelWidth": 1206,
    "pixelHeight": 2622,
    "scale": 3
  },
  "app": {"id": "com.example.app", "version": "1.0"},
  "fixtureDescription": "Controlled repository IO; production UI and state machine",
  "prepare": [
    {
      "type": "launch",
      "description": "Launch the authorized app",
      "argv": ["xcrun", "simctl", "launch", "EXACT-DEVICE-UUID", "com.example.app"]
    }
  ],
  "entryActions": [{"tap": "Reset"}],
  "expectedTexts": ["No itinerary yet"]
}
```

`prepare` commands are explicit trusted local argv arrays, executed without a shell. They can reset/install/launch only resources authorized by the caller. Review HTML and the review server do not expose this command runner. The bundled runner checks that the installed demo executable SHA matches the retained build before capture; a general app integration must provide equivalent build/runtime verification. Uninstalling or erasing an existing app/device is not a default reset strategy.

Every tap resolves an exact button label to a unique `hitPoint` in the latest live hierarchy. Missing or ambiguous buttons block capture. The adapter sets the real orientation and checks the app's reported UI orientation. It requires the expected bundle and a live app PID in the hierarchy. Xcode can report `NotRun` for a simctl-launched process without a debugger; this is retained as a limitation, and a live PID/bundle is still required. A failed state assertion does not produce a convenient screenshot of the wrong current state.

All actions and supplementary accessibility assertions are timestamped. Accessibility labels establish reachability only; they are never a visual pass. After capture, an agent or human must actually open every new image. Only then may explicit visual state assertions be added for core ingestion. Core intentionally blocks captures that contain only accessibility/API assertions. The sample integration consumes separately authored, SHA-bound inspection notes; it does not infer a verdict from the hierarchy or automatically author those notes.

To override a bridge executable or compatible tool names, add:

```json
{"bridge":{"command":["/path/to/compatible-mcp-sidecar","--stdio"],"tools":{"start":"DeviceInteractionStartSession","observe":"DeviceInteractionSynthesize","end":"DeviceInteractionEndSession"}}}
```

The sidecar must implement Apple's documented/discovered input/output shapes. Mapping arbitrary other APIs into those shapes is an integration responsibility. No remote endpoint, credentials or invented tool name is assumed. Tool availability is checked at runtime. Session keys stay in process memory and are excluded from capture metadata and error details.

## Transition evidence

Replace the plan's stable-state actions with a real starting state and add:

```json
{
  "entryActions": [{"tap":"Reset"}],
  "expectedTexts": ["Ready for offline use"],
  "transition": {
    "fromStateId":"empty",
    "toStateId":"ready",
    "fromExpectedTexts":["No itinerary yet"],
    "trigger":{"tap":"Load itinerary"},
    "simctlVideo":true,
    "sampleOffsetsMs":[600,1600,3600]
  }
}
```

The adapter saves the original starting image, starts `simctl io UUID recordVideo --codec=h264`, waits for the recorder's **Recording started** message, triggers the real Device Hub tap, and takes actual framebuffer screenshots while that request is in flight. It then checks the ending state and saves a final original Device Hub screenshot. It does not derive frames by rotating, resizing or otherwise transforming a static screenshot.

Sample offsets are requests, not guaranteed timing. Each actual frame records its measured host monotonic offset plus an `observedBetween` wall-clock bracket around the screenshot command. Frame capture and action dispatch have latency; the timeline does not claim simulator presentation timestamps. The beginning of the transition interval includes the captured starting frame. Device sessions and recorder processes are finalized in `finally`, including failures.

The original H.264 recording is preserved. `video-info.swift` reads its real track duration, dimensions and nominal frame rate using AVFoundation. In the recorded final sample, movie durations were 4015 ms / 4998 ms and nominal rates approximately 27.68 / 21.15 FPS. These are movie metadata, not measured UI frame pacing or evidence of smooth animation. No target FPS was enforced. Sparse frames establish only the states visible at their recorded times; assessing smoothness requires watching the recording or measuring runtime frame metrics. The sample's full videos were retained but not watched end-to-end, and its AI verdicts explicitly exclude a smoothness claim.

## Native example and validation

[Trail Notes](../examples/device-hub-app/README.md) includes runnable SwiftUI source, an Xcode project, a direct simulator build script, real collection commands and the preserved before/after evidence. It is a **seeded demonstration**: a one-line fixed-width coverage label is deliberately present in the initial source commit. Actual screenshots exposed its ellipsis on both devices. The production SwiftUI source was repaired, rebuilt, reinstalled and recaptured. Core retained the earlier failed reviews as stale and accepted new reviews after the actual images were delivered and inspected.

```sh
node --test skills/visual-acceptance/adapters/device-hub/adapter.test.mjs
python3 examples/device-hub-app/build.py --out /absolute/path/to/a-new-build
xcodebuild -project examples/device-hub-app/TrailNotes.xcodeproj \
  -scheme TrailNotes -sdk iphonesimulator -configuration Debug \
  -derivedDataPath /absolute/path/to/a-new-derived-data \
  CODE_SIGNING_ALLOWED=NO build
```

Protocol tests use an explicitly artificial 1-pixel fixture and fake MCP responses to test failure handling, byte preservation, unique hit points, wrong devices, wrong orientation, secret redaction and cleanup. Those tests are not presented as native capture validation. The separate recorded sample is the real App validation.

Official references:

- [Apple: Device Hub](https://developer.apple.com/documentation/xcode/device-hub)
- [Apple: Interacting with devices using the command line](https://developer.apple.com/documentation/xcode/interacting-with-devices-using-the-command-line)
- [Apple: Capturing screenshots and videos from devices](https://developer.apple.com/documentation/xcode/capturing-screenshots-and-videos-from-devices)
- [Apple: Interacting with your app in Device Hub](https://developer.apple.com/documentation/xcode/interacting-with-your-app-in-device-hub)
- Installed Xcode's `xcrun mcpbridge --help`, actual MCP `tools/list` schemas, and exported `device-interaction` skill supplied the interaction syntax. No third-party source was copied or licensed into this adapter.
