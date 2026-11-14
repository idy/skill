# Pi skills collection

This public repository distributes multiple Pi skills as one installable package. Its first skill, **visual-acceptance**, reviews evidence from an actual running App through a user-selected Device Hub bridge. Humans and agents share a versioned HTML review matrix. It supports native apps and does not select a Web capture platform on your behalf.

Install a reviewed commit or branch with Pi:

```sh
pi install git:github.com/idy/skill
# Project-local alternative:
pi install --local git:github.com/idy/skill
```

Run `/reload` in an existing Pi session, then `/skill:visual-acceptance`. The package declares its skills and a thin extension in the Pi manifest. Installing a Git package executes extension code with Pi's permissions; inspect the source first. A Git install is independent of npm publication or package-catalog discovery. This package has not been published to npm.

Node.js 20+ runs the CLI independently of Pi:

```sh
npm install --ignore-scripts --omit=peer
node scripts/visual-acceptance.mjs help
npm test
npm pack --dry-run
```

The core provides immutable captures, actual source/artifact/runtime identities, image decoding and integrity checks, stale review detection, bounded review runs, single-image Pi tools, a loopback review server and deduplicated explicit feedback batches. The matrix and Device Hub adapter are separate package resources. See [shared contracts](docs/contracts.md), [workflow and command guide](docs/workflow.md), [Device Hub guide](docs/device-hub.md) and [schema](schemas/visual-acceptance-v1.schema.json).

App evidence must come from the real installed app on a truthfully labeled device/simulator. Fixtures may control IO while retaining production UI/state machines. Transition evidence includes real actions and ordered frames/video; a static end screenshot cannot establish smoothness. Each new image must be inspected by an image-capable agent. Image receipts record delivery sequencing, not cognition. A new capture/build/runtime/spec/image invalidates prior AI conclusions; human review history stays separate and receives stale warnings.

A final AI pass requires current coverage of the whole matrix on the same target build/runtime/spec. Human acceptance is a separate result. Automated UI and feedback tests are not a demonstration of a real person's review. This README does not claim that a full live Device Hub collection or a complete human acceptance session has been performed; validation and limitations must be reported per run.

Evidence stores default to `.visual-acceptance/` and are ignored by Git. Source snapshots, receipts and local draft files stay private. Only explicitly exported review data, safe provenance and evidence are intended for sharing. The browser stores drafts locally and the server persists edits on that machine; neither is a multiuser collaboration service.
