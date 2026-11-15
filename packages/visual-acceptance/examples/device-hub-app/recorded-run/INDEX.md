# Recorded native evidence index

This is an actual SwiftUI seeded demonstration on two independent iOS 27 simulator configurations. The current view uses `demo-spec-2`, `demo-after-runtime-v2` and `visual-acceptance-2` against core `da13ee7aa531572834b2d848304b6a38d1955f3d`. It reports 8 current AI passes and humanPass 0. Pass scope covers the explicit layout/state-sequence checkpoints, excluding measured smoothness.

## Preserved original and newly collected evidence

The complete original spec-1 bundle from PR #2 HEAD `2e99c038468c7702dff18c7b671421a164b18632` is preserved byte-for-byte in [history/demo-spec-1-at-2e99c038.zip](history/demo-spec-1-at-2e99c038.zip), SHA256 `50dd25649f59306c05d4d61c2c735e863a7167057b81b9a160e3416bd0ba8f9c`. All original 18 PNG / 2 MP4 files also remain unchanged in `evidence/`. The archive is a historical export, not the current target; its old pass fields do not bypass the new protocol.

Spec-2 contains genuinely new Device Hub captures of every final cell. Production SwiftUI source, the fixed .app and its controlled IO fixture are unchanged from the already verified repair build. The new immutable runtime records adapter 1.1. All earlier captures/reviews remain in review.json histories; old-protocol AI conclusions are stale. No old image, action timestamp or visual assertion was silently rewritten into a new target.

## Source and actual build identities

| Phase | Source snapshot | Compiled Swift SHA256 | Executable SHA256 | Core .app directory SHA256 |
| --- | --- | --- | --- | --- |
| before | `source-f1b34412a2d7c871ee16437c1bd8b523` | `2bf76b986bf8f3dfcdb28165d3d39989e993827721a53f141b2780a20199007f` | `e809c1befd92d8dd3afae475296b656b1cb10d39683756aa4753db59c247dabb` | `2731255e245d480a885fcefea2cf1c8ac148b5e68fec16bf404c642109c2a8c7` |
| after | `source-0f783d4d85f000ff4ba7713ffe4e4fb4` | `5382fd2efefb0f89469e26b685103ec611cbb3d94f010fc886ecf20875187433` | `0ccb62a0fb6b752ed494e60ac4ee17a896c75bd1514de78393b5fafcc6c05dee` | `5109d9023fc83a1a8061dac6b5cf5b91daeb84dfa04ab47419a5778243ec9aa4` |

The before source is clean commit `100f1b1b4b8376b298dc29780d35a3dd3a928d58`; the after source is the retained exact Swift file plus its dirty snapshot against that commit. The initial defect was deliberately seeded: a fixed-width one-line coverage sentence visibly showed **Offline maps include...** on both devices. The production source removed the fixed width/line limit. The complete sentence is readable on two phone lines and one tablet line. Both actual .app archives and compiled source versions are retained.

## Current stable-state screenshots

| Device / state | Original current PNG | Before defect, if applicable |
| --- | --- | --- |
| phone / empty | [402 × 874](evidence/f2477a75cea4dd3a7b7c00ed4d93ad5adcec43b2097bf4c81547377d1b81edd3.png) | — |
| phone / ready | [402 × 874](evidence/33844bb893b4a7e2a1b2e740d06e8b7dc29a3f84516f9ad5cf14b8a045e66199.png) | [Before: truncation](evidence/45325879ddcd4db052368828ca6490c2f8421962d25ea6dd295a0ba43d4b3b18.png) |
| phone / error | [402 × 874](evidence/5552f5f077c45b19aa50be6d54288921314f1f649a7de2ecc4abf65eaafabe0a.png) | — |
| tablet / empty | [744 × 1133](evidence/60709c664d6826e5d3ba3782f66f1e56de86a4b42261932d8496bc90150ea767.png) | — |
| tablet / ready | [744 × 1133](evidence/4735c0a4821f9fd21e8f27d1575881956a53f3638eae2b95059971455532844d.png) | [Before: truncation](evidence/4a0f4ec98cb34a7db648bdc0da11d56a12200d15b4e5fd3a8a0918624ed47781.png) |
| tablet / error | [744 × 1133](evidence/0f157d55a613f47ed6f0421b636dff89f3b72ba040bc3a1f52f5c5ca0bd95141.png) | — |

## Current real transition timelines

### phone: empty → ready

Actual UUID `2B16C71D-2919-4115-8694-7D3067A8837A`. Trigger actions[5] = **Trigger Load itinerary at latest hierarchy hitPoint**, timestamp `2026-11-14T16:38:33.843Z`. Interval `2026-11-14T16:38:33.506Z` → `2026-11-14T16:38:37.705Z` is anchored to `frame-start` / `frame-end`. The recorder stop time is separate, not falsely used as the ending-frame timestamp.

[Original H.264 movie](evidence/ce8b243e372e65c164a37c10f86f4177ba900c96a9d1ce5d75f51ec344a6f55a.mp4): 3865 ms, 1206 × 2622, nominal 28.18 FPS. Movie SHA256 `ce8b243e372e65c164a37c10f86f4177ba900c96a9d1ce5d75f51ec344a6f55a`. The movie was retained but not watched end-to-end. Nominal FPS and sparse images do not prove UI frame pacing or smoothness.

| Actual frame | Offset ms | Original pixels | Visible observation | SHA256 |
| --- | --- | --- | --- | --- |
| [frame-start](evidence/6fe006b3a7beb63b9b916c1bb84cbe0f2885843744c14dc78987a55d2ee990f2.png) | 0 | 402 × 874 | The actual image shows No itinerary yet, the download explanation and both actions clearly separated. The empty state is visible without clipping. | `6fe006b3a7beb63b9b916c1bb84cbe0f2885843744c14dc78987a55d2ee990f2` |
| [frame-1](evidence/fff063b00f6205acd09c7811b0db8729eb74adacfa66d143fd7cf6ceec788313.png) | 1024 | 1206 × 2622 | The actual image shows No itinerary yet, the download explanation and both actions clearly separated. This first post-dispatch phone sample still shows empty, so action dispatch must not be confused with instant UI execution. | `fff063b00f6205acd09c7811b0db8729eb74adacfa66d143fd7cf6ceec788313` |
| [frame-2](evidence/2246ddc3fe863b6d43903f53510a115746c3d8babcae700ee6f7369c03d57a4f.png) | 1992 | 1206 × 2622 | The loading text is visible and the teal progress fill is around one-third of the track. | `2246ddc3fe863b6d43903f53510a115746c3d8babcae700ee6f7369c03d57a4f` |
| [frame-3](evidence/1766b96df074ecb08356950908a03182b588c033befe33dc6830f8b7d3ffc928.png) | 4049 | 1206 × 2622 | Full coverage text wraps into two readable phone lines. Ready heading, distance, duration and departure details are visible with no outgoing loading text or progress track remaining. | `1766b96df074ecb08356950908a03182b588c033befe33dc6830f8b7d3ffc928` |
| [frame-end](evidence/33844bb893b4a7e2a1b2e740d06e8b7dc29a3f84516f9ad5cf14b8a045e66199.png) | 4199 | 402 × 874 | Full coverage text wraps into two readable phone lines. Ready heading, distance, duration and departure details are visible with no outgoing loading text or progress track remaining. | `33844bb893b4a7e2a1b2e740d06e8b7dc29a3f84516f9ad5cf14b8a045e66199` |

Start/end visual assertions carry stateId empty/ready and the exact endpoint asset IDs. They were authored after the actual image reads (`inspectedAt`), not claimed as live assertions during the old frame times. Every offset equals its recorded host UTC observation-completion timestamp minus startedAt; original capture-latency brackets and separate monotonic scheduling measurements remain explicit. These are host observations, not simulator presentation timestamps.

### tablet: empty → ready

Actual UUID `EFE89470-27FC-405A-A2E2-142635E8B377`. Trigger actions[5] = **Trigger Load itinerary at latest hierarchy hitPoint**, timestamp `2026-11-14T16:41:03.169Z`. Interval `2026-11-14T16:41:02.994Z` → `2026-11-14T16:41:09.221Z` is anchored to `frame-start` / `frame-end`. The recorder stop time is separate, not falsely used as the ending-frame timestamp.

[Original H.264 movie](evidence/d83b3ca39ccb83e0aa15d5e8122ef94f455da698603b3e76fda8893d80a27c8b.mp4): 6053 ms, 1488 × 2266, nominal 17.77 FPS. Movie SHA256 `d83b3ca39ccb83e0aa15d5e8122ef94f455da698603b3e76fda8893d80a27c8b`. The movie was retained but not watched end-to-end. Nominal FPS and sparse images do not prove UI frame pacing or smoothness.

| Actual frame | Offset ms | Original pixels | Visible observation | SHA256 |
| --- | --- | --- | --- | --- |
| [frame-start](evidence/0ba4b0e8dd0d5f6954ccc734ba766e9269c93e6e94e6d36c15cd19a4dc54395a.png) | 0 | 744 × 1133 | The actual image shows No itinerary yet, the download explanation and both actions clearly separated. The empty state is visible without clipping. | `0ba4b0e8dd0d5f6954ccc734ba766e9269c93e6e94e6d36c15cd19a4dc54395a` |
| [frame-1](evidence/bf636e76005a492d217d708fb7ea2dae0d01e203397f93409dd0a4870db6ae32.png) | 1236 | 1488 × 2266 | The route preparation text is visible and the progress fill is near zero. | `bf636e76005a492d217d708fb7ea2dae0d01e203397f93409dd0a4870db6ae32` |
| [frame-2](evidence/435b00ec50be4c82d9073504f5c126d1692855b29c408a603bdb662105da879f.png) | 2051 | 1488 × 2266 | The route preparation text remains visible while the teal progress fill has advanced across most of the track. | `435b00ec50be4c82d9073504f5c126d1692855b29c408a603bdb662105da879f` |
| [frame-3](evidence/b273f7b641c27095e47b5973fb10db87af696f3d373fcb72dc05b8426828775a.png) | 5031 | 1488 × 2266 | Full coverage text is readable on one iPad line. Ready heading, distance, duration and departure details are visible with no outgoing loading text or progress track remaining. | `b273f7b641c27095e47b5973fb10db87af696f3d373fcb72dc05b8426828775a` |
| [frame-end](evidence/766dcc2e4ba10a6e930f1891ad7059f5fd96568fa32cbed400d44b82c936b4e0.png) | 6227 | 744 × 1133 | Full coverage text is readable on one iPad line. Ready heading, distance, duration and departure details are visible with no outgoing loading text or progress track remaining. | `766dcc2e4ba10a6e930f1891ad7059f5fd96568fa32cbed400d44b82c936b4e0` |

Start/end visual assertions carry stateId empty/ready and the exact endpoint asset IDs. They were authored after the actual image reads (`inspectedAt`), not claimed as live assertions during the old frame times. Every offset equals its recorded host UTC observation-completion timestamp minus startedAt; original capture-latency brackets and separate monotonic scheduling measurements remain explicit. These are host observations, not simulator presentation timestamps.

## Questions, blocked attempts and budget history

Two spec-2 iPad attempts visibly caught an outgoing progress/text crossfade, including an insufficiently settled ending frame. Their six images were actually viewed, delivered again under new receipts and recorded as **question**, not passed as stable. New captures with bounded settling waits resolved the questions; both earlier question reviews are now stale and all their raw media remain in the history. See `v2-questions-inspection.json` and `v2-final-inspection.json`.

An external 60s command timeout interrupted the first native batch and left this worker’s own Device Hub session occupied. That exact owned session was ended via DeviceInteractionEndSession (Session stopped); unrelated devices were not touched. Four blocked attempts and all persisted budget charges remain in the store/export, with session handles redacted in public diagnostic text. The interrupted run was stopped with a concrete reason. One recovery run continued after resource cleanup, and is now finished. Both runs have zero repair events and all capture rounds are core-derived 0; no invented repair/round reset was used. `run-events.json` retains the actual event order. A later user restart interrupted three image deliveries; those unused receipts were preserved, not counted as successful model image reads.

## Review protocol and portable UI import

All sixteen current representative images were actually read after new core receipts and before recordAI. The two historical question cells likewise used six delivered images. `integration.json` identifies the exact core module hashes and receipt counts, including the unused interrupted receipts. Receipts establish sequencing only, not cognition. Human review arrays remain empty and humanPass is 0. Physical devices, Android, full-speed video review and performance metrics remain unverified.

Load `review.json` or `review-data.js` into the shared review UI and keep sibling `evidence/` unchanged. This is core schemaVersion 1 / reviewProtocol visual-acceptance-2, not a second UI schema. `SHA256SUMS.json` and `verify-recorded.py` verify the current bundle, the old archive, original media, source/build hashes, explicit endpoint/action/time relationships and stale histories. The author’s self-contained private store/raw inputs remain at `artifacts/core-store`; the public export is read-only and has no dependency on another checkout’s absolute path.
