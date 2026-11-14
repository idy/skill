# Pi skills collection

This public repository distributes multiple Pi skills as one installable package. Its first skill, **visual-acceptance**, reviews evidence from an actual running App through a user-selected Device Hub bridge. Humans and agents share a versioned HTML review matrix. It supports native apps and does not select a Web capture platform on your behalf.

Install the integration branch while its PR is under review (or replace the ref with an exact reviewed commit):

```sh
pi install git:github.com/idy/skill@feat/visual-acceptance-integration
# Project-local alternative:
pi install --local git:github.com/idy/skill@feat/visual-acceptance-integration
```

Run `/reload` in an existing Pi session, then `/skill:visual-acceptance`. The package declares its skills and a thin extension in the Pi manifest. Installing a Git package executes extension code with Pi's permissions; inspect the source first. A Git install is independent of npm publication or package-catalog discovery. This package has not been published to npm.

Node.js 20+ runs the CLI independently of Pi:

```sh
npm ci --ignore-scripts --omit=dev --omit=peer
node scripts/visual-acceptance.mjs help
npm test
npm pack --dry-run
```

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
