# Visual Acceptance

**Visual Acceptance** reviews evidence from an actual running App through a user-selected Device Hub bridge. Humans and agents share a versioned HTML review matrix. It supports native apps and does not select a Web capture platform on your behalf.

The independent npm / marketplace package is `pi-visual-acceptance`; the skill command is `/skill:visual-acceptance`. Its source lives in `packages/visual-acceptance/` in [idy/skill](https://github.com/idy/skill), alongside independently distributed skills. This package includes only Visual Acceptance and its required extension and resources.

Install after the independent package's first release:

```sh
pi install npm:pi-visual-acceptance
# Project-local alternative:
pi install --local npm:pi-visual-acceptance
```

Run `/reload` in an existing Pi session, then `/skill:visual-acceptance`. The manifest declares exactly this skill and its six-tool extension. This source revision prepares the first independent `0.1.0` release; publication and marketplace visibility are separate release checks.

Node.js 20+ runs the installed CLI independently of Pi:

```sh
visual-acceptance help
visual-acceptance demo-export --out ./trail-notes-review
```

For development, run the following commands from this package directory after `npm ci --ignore-scripts --omit=peer` at the repository root:

```sh
node scripts/visual-acceptance.mjs help
npm test
npm pack --dry-run
```

An unpacked tarball can also run alone: `npm install --ignore-scripts --omit=dev --omit=peer`, then `node scripts/visual-acceptance.mjs help`. It does not need the source workspace or a browser dependency.

Open the shipped native demonstration without Xcode, a private store or a browser dependency:

```sh
node scripts/visual-acceptance.mjs demo-export --out ./trail-notes-review
open ./trail-notes-review/index.html   # macOS; otherwise open this file in your browser
```

Use a new output directory. The page includes two iOS simulator configurations, empty/ready/error states and real loading transitions. It retains the seeded clipping defect, fixed source/builds, stale opinions, original images and video. Export verifies the original file hashes, recomputes decoded pixel fingerprints and applies the installed core's transition validation. Human acceptance is pending (`humanPass:0`). Enter your own reviewer name, review the matrix, then use **复制人审意见** to paste located feedback into Pi, or export JSON for the project's `visual_acceptance_feedback_import` tool when its evidence store is available. Static browser drafts stay in that browser profile; they do not automatically notify Pi.

For a live project store, ask Pi to call `visual_acceptance_review` with its store path and open the returned loopback URL. Edits save to disk; **提交给 Pi** sends one explicit batch into that Pi session. CLI `serve` saves opinions without a connected Pi session. See [native reproduction](examples/device-hub-app/README.md), [recorded evidence](examples/device-hub-app/recorded-run/INDEX.md) and [reproducible development checks](docs/testing.md).

The core provides immutable captures, actual source/artifact/runtime identities, image decoding and integrity checks, stale review detection, bounded review runs, single-image Pi tools, a loopback review server and deduplicated explicit feedback batches. The matrix and Device Hub adapter are separate package resources. See [shared contracts](docs/contracts.md), [workflow and command guide](docs/workflow.md), [core verification](docs/testing.md), [Device Hub guide](docs/device-hub.md) and [schema](schemas/visual-acceptance-v1.schema.json).

App evidence must come from the real installed app on a truthfully labeled device/simulator. Fixtures may control IO while retaining production UI/state machines. Transition evidence includes real actions and ordered frames/video; a static end screenshot cannot establish smoothness. Each new image must be inspected by an image-capable agent. Image receipts record delivery sequencing, not cognition. A new capture/build/runtime/spec/image invalidates prior AI conclusions; human review history stays separate and receives stale warnings.

A final AI pass requires current coverage of the whole matrix on the same target build/runtime/spec. Human acceptance is a separate result. Automated UI and feedback tests are not a demonstration of a real person's review. The recorded demonstration uses actual Device Hub collection and per-image agent inspection. Its scope, identities and limitations are in the evidence index; a real person's acceptance remains a separate pending step.

Evidence stores default to `.visual-acceptance/` and are ignored by Git. Source snapshots, receipts and local draft files stay private. Only explicitly exported review data, safe provenance and evidence are intended for sharing. The browser stores drafts locally and the server persists edits on that machine; neither is a multiuser collaboration service.
