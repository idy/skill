# Recorded native evidence index

This is a seeded demonstration using an actual SwiftUI app on two independent iOS simulators. All final representative images were delivered by core and actually inspected through the image read tool. No human decision has been recorded. Sparse images and nominal movie FPS do not prove animation smoothness.

## Source and build identities

| Phase | Source snapshot | Actual source SHA256 | Actual executable SHA256 | Core `.app` directory SHA256 |
| --- | --- | --- | --- | --- |
| before | `source-f1b34412a2d7c871ee16437c1bd8b523` | `2bf76b986bf8f3dfcdb28165d3d39989e993827721a53f141b2780a20199007f` | `e809c1befd92d8dd3afae475296b656b1cb10d39683756aa4753db59c247dabb` | `2731255e245d480a885fcefea2cf1c8ac148b5e68fec16bf404c642109c2a8c7` |
| after | `source-0f783d4d85f000ff4ba7713ffe4e4fb4` | `5382fd2efefb0f89469e26b685103ec611cbb3d94f010fc886ecf20875187433` | `0ccb62a0fb6b752ed494e60ac4ee17a896c75bd1514de78393b5fafcc6c05dee` | `5109d9023fc83a1a8061dac6b5cf5b91daeb84dfa04ab47419a5778243ec9aa4` |

The `.app` directory hash uses core’s sorted recursive manifest, while `SHA256SUMS.json` hashes the individual portable archive files. The before source is the clean commit `100f1b1b4b8376b298dc29780d35a3dd3a928d58`. The after source is a dirty snapshot against that same commit, with the exact fixed Swift file retained under `source/after`. `source-identities.json` preserves HEAD/diff identities. Both actual `.app` archives and source versions are included.

## Stable states and visual repair

| Device / state | Original evidence | Current inspection | Historical inspection |
| --- | --- | --- | --- |
| phone / empty | [402 × 874 PNG](evidence/1898d03bf2cf92336339215a032837e7d4533c1a2f8524143532ec83b4e47e13.png) | pass | — |
| phone / ready | [402 × 874 PNG](evidence/a3854ae9105eac838371ab95bb9b321fc2bc64a946e0c66853f5f728fa6e3cc0.png) | pass | [Before: ellipsis hides coverage](evidence/45325879ddcd4db052368828ca6490c2f8421962d25ea6dd295a0ba43d4b3b18.png); fail is now stale |
| phone / error | [402 × 874 PNG](evidence/f8b5137393002174e2f756423cc404c2e138d6171e121b9108428e352e10f060.png) | pass | — |
| tablet / empty | [744 × 1133 PNG](evidence/effa482efc12932139ebe3caabd9bf4cb61c62902fe8c14d7be73b2611cc6d8a.png) | pass | — |
| tablet / ready | [744 × 1133 PNG](evidence/c9b850ff2a038812ea53d782abf2b29d1c83551dab7de174633fa402cb96abc5.png) | pass | [Before: ellipsis hides coverage](evidence/4a0f4ec98cb34a7db648bdc0da11d56a12200d15b4e5fd3a8a0918624ed47781.png); fail is now stale |
| tablet / error | [744 × 1133 PNG](evidence/a2e3dfe3edb902511f9cf214bc62df3441d8ca4272100550d326d02af30e6639.png) | pass | — |

Actual before text: **Offline maps include...**. Actual after text: **Offline maps include the full trail and emergency exit routes**. The phone wraps the complete sentence onto two lines and the tablet uses one line. The fix removes the source’s fixed 170-point width and `lineLimit(1)`; checkpoints were not weakened.

## Real transition recordings and ordered frames

### phone: empty → ready

Device UUID: `2B16C71D-2919-4115-8694-7D3067A8837A`. Trigger: real **Load itinerary** tap at the latest live hierarchy hitPoint. Interval: `2026-11-14T16:04:37.712Z` → `2026-11-14T16:04:41.934Z`. Original [H.264 movie](evidence/dcafb3d200bd9d50554122d0e297143f9091b7b087631baa345a611b8ef905b1.mp4): 4015 ms, 1206 × 2622, nominal 27.68 FPS. The full movie was retained but not watched end-to-end; no smoothness verdict is recorded.

| Frame | Actual offset ms | Original dimensions | Visible state | SHA256 |
| --- | --- | --- | --- | --- |
| [frame-start](evidence/c6d092a9948b86930b347fd6cccd9a08d65a79631ab8e3ffb49f034a62543601.png) | 0 | 402 × 874 | No itinerary yet; Load itinerary | `c6d092a9948b86930b347fd6cccd9a08d65a79631ab8e3ffb49f034a62543601` |
| [frame-1](evidence/53e2b8a603c2e80a98db22db72f5da46ba34d95c4d29758a8ce27632e573f9f4.png) | 1087 | 1206 × 2622 | Preparing your route; progress near zero | `53e2b8a603c2e80a98db22db72f5da46ba34d95c4d29758a8ce27632e573f9f4` |
| [frame-2](evidence/5884424fd72167e5c2dfa04c8782924e134ea4447ee31a16d25ca1b0735150b4.png) | 1998 | 1206 × 2622 | Preparing your route; teal progress advanced | `5884424fd72167e5c2dfa04c8782924e134ea4447ee31a16d25ca1b0735150b4` |
| [frame-3](evidence/66a683f2c8ad866ccb5ce2ca1bff35cf1bef48cc3a378e08f643670edbfc914f.png) | 4020 | 1206 × 2622 | Ready for offline use; full coverage sentence | `66a683f2c8ad866ccb5ce2ca1bff35cf1bef48cc3a378e08f643670edbfc914f` |
| [frame-end](evidence/6df323e10d09bfe2cb5a67014ce033043132709b310a0c014c395d589ea0b8dd.png) | 4187 | 402 × 874 | Ready for offline use; stable ending capture | `6df323e10d09bfe2cb5a67014ce033043132709b310a0c014c395d589ea0b8dd` |

Movie SHA256: `dcafb3d200bd9d50554122d0e297143f9091b7b087631baa345a611b8ef905b1`. Frames were captured during real execution, using original Device Hub PNGs for endpoints and live simctl framebuffer PNGs during the action. `observedBetween` records each command’s timing uncertainty. These are actual independent layouts, never rotated or transformed older images.

### tablet: empty → ready

Device UUID: `EFE89470-27FC-405A-A2E2-142635E8B377`. Trigger: real **Load itinerary** tap at the latest live hierarchy hitPoint. Interval: `2026-11-14T16:04:46.833Z` → `2026-11-14T16:04:52.053Z`. Original [H.264 movie](evidence/3b98907a9c852e3e2e5437776ca2564570edf1c791a249bd47ed4e838d35ec99.mp4): 4998 ms, 1488 × 2266, nominal 21.15 FPS. The full movie was retained but not watched end-to-end; no smoothness verdict is recorded.

| Frame | Actual offset ms | Original dimensions | Visible state | SHA256 |
| --- | --- | --- | --- | --- |
| [frame-start](evidence/42ff56bcaf4e4f8dc89aec3d832bc6f35336dc2580a0945c208844782f390da1.png) | 0 | 744 × 1133 | No itinerary yet; Load itinerary | `42ff56bcaf4e4f8dc89aec3d832bc6f35336dc2580a0945c208844782f390da1` |
| [frame-1](evidence/5cf97c832c2d27430549701d98dc7dccc174136a3ca88d830c0a1aca1270e8ae.png) | 1060 | 1488 × 2266 | Preparing your route; progress near zero | `5cf97c832c2d27430549701d98dc7dccc174136a3ca88d830c0a1aca1270e8ae` |
| [frame-2](evidence/40d02300a6b95ff0e25b92368891e8b65da480e9a853cbb302b514546b1abc55.png) | 2070 | 1488 × 2266 | Preparing your route; teal progress advanced | `40d02300a6b95ff0e25b92368891e8b65da480e9a853cbb302b514546b1abc55` |
| [frame-3](evidence/343a2878046e3327bd8a3a8ae2128504450a78748079a4d27b3cf82c00f5cb90.png) | 4994 | 1488 × 2266 | Ready for offline use; full coverage sentence | `343a2878046e3327bd8a3a8ae2128504450a78748079a4d27b3cf82c00f5cb90` |
| [frame-end](evidence/91501e0c4cd1657693db2ec051cf229da580a4e7fd18d9e792f3844b82ff1551.png) | 5185 | 744 × 1133 | Ready for offline use; stable ending capture | `91501e0c4cd1657693db2ec051cf229da580a4e7fd18d9e792f3844b82ff1551` |

Movie SHA256: `3b98907a9c852e3e2e5437776ca2564570edf1c791a249bd47ed4e838d35ec99`. Frames were captured during real execution, using original Device Hub PNGs for endpoints and live simctl framebuffer PNGs during the action. `observedBetween` records each command’s timing uncertainty. These are actual independent layouts, never rotated or transformed older images.

## Review versions and limits

The core store currently reports `total: 8`, `aiPass: 8`, `finalAIPass: true`, `humanPass: 0`. The pass scope is each cell’s explicit layout/state-sequence checkpoints, excluding measured smoothness. Two original failed layout reviews remain stale after the source/build/capture change. Two transition reviews also remain stale after a movie-metadata correction: the actual AVFoundation duration/FPS replaced an initial host-window duration estimate in a new capture metadata version, preserving the same image/video bytes and the old records. Each metadata revision was delivered again, visually checked and reviewed.

All final evidence belongs to `demo-after` / `demo-after-runtime` / `demo-spec-1`. Full AI comments, visible text, per-image observations, receipt references, actions, accessibility/visual assertions, blockers, limitations, device metadata and histories are in `review.json`. Receipt IDs record delivery sequencing only; they do not prove cognition. The session’s real image-tool reads supply the review basis.

The first transition collection without an explicit ending frame remains in the local author worktree’s `artifacts/captures-after/`. One iPad intermediate image caught normal outgoing/incoming crossfade text overlap; it was retained, not erased or silently called a stable failure. The later final sequences include independently recaptured starting/loading/ready frames and an explicit stable ending image. No production defect was inferred solely from that transient frame.

Simulator-only validation: physical devices, Android, other OS versions and runtime frame metrics remain unverified. No human review, Pi browser feedback round trip or npm release is claimed by this native collection task.

## Import into the shared review UI

Load `review.json` with the UI’s JSON import, or use `review-data.js` with the same UI. Keep the sibling `evidence/` directory unchanged. The bundle uses core schemaVersion 1 and contains no review-page screenshot pretending to be App evidence. The author’s private store is self-contained under `artifacts/core-store`, with source reconstruction blobs and the original immutable evidence.
