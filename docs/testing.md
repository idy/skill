# Core verification

Install locked dependencies without installing a second Pi host copy, then run the core, UI model/storage and Device Hub checks:

```sh
npm ci --ignore-scripts --omit=peer
npm test
npm run check
npm pack --dry-run
```

For runtime-only use, add `--omit=dev`; this omits Playwright and never downloads a browser. The published/Git Pi package needs only its runtime image decoders. `npm run check` checks all shipped JavaScript entry points, UI scripts, adapter modules and demo scripts.

## Real browser checks

```sh
npm run browser:install
npm run test:browser
```

The baseline covers 13 real Chromium interaction cases using clearly marked UI fixtures. Three optional cases exercise core's real loopback server and the recorded native bundle:

```sh
node scripts/visual-acceptance.mjs demo-export --out ./browser-native-review
VA_CORE_ROOT="$PWD" VA_CORE_STORE=/path/to/project/.visual-acceptance \
VA_REAL_BUNDLE="$PWD/browser-native-review" npm run test:browser
```

The tests copy `VA_CORE_STORE` before writing automated opinions. The real server retry test intentionally fails dispatch after saving, restarts on the same loopback port with a new source/token, reloads the browser and verifies that the original batch body is accepted exactly once. It reports no Pi connection. The live host check below verifies actual delivery separately. `CHROME` and `PLAYWRIGHT_CORE` remain optional overrides for an existing installation; no temporary absolute install is required.

## Opt-in actual Pi feedback check

The probe uses the installed Pi SDK and its actual extension runtime, disk-backed session, browser autosave/explicit batch submission, exact duplicate JSON import and a fresh browser-exported JSON import. It never replaces `sendMessage`. The two feedback messages trigger at most two configured provider requests, with a 120-second overall abort timer, retries disabled and tools disabled for model responses. Credentials stay with Pi's normal model runtime and are not printed or copied. Every opinion is labelled `review-ui-browser-test`, and the expected next action is pending human review.

```sh
PI_TEST_PACKAGE_ROOT=/path/to/installed/pi-coding-agent \
VA_CORE_STORE=/path/to/project/.visual-acceptance \
VA_PI_PROVIDER=magpie VA_PI_MODEL=codex-remote/codex/gpt-6.1-sol \
node tests/integration/pi-feedback.mjs
```

Select an already configured provider/model. The command prints a private evidence directory containing the copied store, `report.json`, batch files and the persistent Pi JSONL session. It asserts model-visible project/cell/capture/image/build identities, two durable `custom_message` records after reopening the session, and duplicate suppression. The server and browser close on exit. It tests feedback processing; it does not claim provider visual inspection or human acceptance.

The Pi host tests require an existing Pi installation. Set `PI_TEST_PACKAGE_ROOT` to the root directory of its installed `@earendil-works/pi-coding-agent` package, then run `npm test`. For example, on a POSIX shell:

```sh
PI_TEST_PACKAGE_ROOT=/path/to/installed/pi-coding-agent npm test
```

Without this variable the host-specific tests are explicitly skipped. The host checks load the real extension loader, real compaction/context-edit projection, real SessionManager JSONL persistence/reopen and the real AgentSession followUp queueing method. Tests control the streaming flag and the queue consumer; they make no live model request and do not establish that a provider/model perceived image pixels.

The regression coverage includes:

- Replayed static frame sets, unrelated action times, missing state/endpoint anchors and inconsistent offsets stay blocked. Repeated waiting frames with observed change and complete endpoint/action coverage remain eligible. Old capture/pass flags are revalidated.
- Pixel-change eligibility uses a canonical decoded dimensions/RGBA digest while encoded SHA remains the immutable file identity. PNG compression/metadata variations with identical pixels stay blocked; PNG/JPEG decode failures and forged cached fingerprints cannot bypass read/record checks. Genuine repeated waiting A,A,B,B still has two decoded rasters and remains eligible.
- Compaction and null/text/different-image context edits remove receipt eligibility; a new image delivery restores it. Pre-upgrade receipts/AI records lack `reviewProtocol:visual-acceptance-2` and stay stale until fresh image delivery and review; valid unchanged captures need not be fabricated or recollected.
- Process-memory queueing does not acknowledge feedback. Durable pending survives an actual disk reopen; acknowledgments reference actual custom_message entries. Retries, old optimistic markers, forked sessions and retained/replayed queue races cannot duplicate feedback data.
- A failed feedback callback followed by server restart accepts the exact original batch under a fresh same-Origin/token connection, preserving its old source. Changed bodies conflict and fresh writes with an old source are rejected.
- Capture attempts charge the round derived from persisted repair events. Caller-invented rounds cannot reset retry budgets.
- Delayed human edits validate their referenced immutable spec/capture; removed cells retain stale historical reviews.

Other tests cover source reconstruction bytes, actual artifact identities, PNG/JPEG integrity and corruption, stale captures/builds/specs/policies, AI/human history separation, image capability/settings, visible-text/observation requirements, budgets, exports and private route boundaries.

Every synthetic image/build used by these tests is labeled as a test fixture. These tests do not replace actual Device Hub collection, real image-by-image agent review, HTML integration, animation/video playback analysis or a real person's explicit acceptance submission.
