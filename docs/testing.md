# Core verification

Install runtime dependencies without installing a second Pi host copy, then run the portable core checks:

```sh
npm ci --ignore-scripts --omit=peer
npm test
npm run check
npm pack --dry-run
```

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
