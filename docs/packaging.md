# Independent package verification

The repository root is an unpublished npm workspace. Visual Acceptance's package root is `packages/visual-acceptance/`; all runtime-relative imports, skill links, review assets and native demo resources stay within it. The root Git compatibility manifest names this one skill directory and extension explicitly. Neither manifest scans a collection directory.

From the repository root:

```sh
npm ci --ignore-scripts --omit=peer
PI_TEST_PACKAGE_ROOT=/path/to/installed/pi-coding-agent npm test
npm run check
npm run check:schema
npm run pack:visual-acceptance -- --pack-destination /absolute/path/to/artifacts
```

`PI_TEST_PACKAGE_ROOT` points to an existing Pi host, not a bundled dependency. With it set, the existing host tests and the packaging test use Pi's actual `DefaultResourceLoader` and extension loader without making provider requests. Without it, ordinary package tests still run; host-specific cases are skipped and the packaging test reports that its loader portion was omitted.

`tests/packaging.test.mjs` creates a complete fixture in system temporary storage, including a sibling workspace with a real skill and extension, plus extra sibling skill/extension files inside Visual Acceptance's package. It packs Visual Acceptance while these files exist and checks the extracted file contents against their source bytes. It loads the root compatibility entry with Pi and asserts that only `visual-acceptance` and its six tools are discovered, with no prompts/themes or diagnostics. It then deletes the entire fixture workspace before installing runtime dependencies in the unpacked package. This prevents a missing import or asset from accidentally resolving through the author checkout.

The standalone package must load those same six tools, run CLI help, export the original native demo with AI 8 / human 0, pass the original 62-file native verifier and serve the unchanged review page plus its scripts/styles over the real loopback server. Only `jpeg-js` and `pngjs` are installed; no browser, second Pi host or sibling package is needed. Set `VA_PACKAGING_REPORT_DIR` to an external directory to keep the tested tarball, its SHA-256 and every packaged file's SHA-256.

For compatibility with an existing private evidence store, run from the package directory:

```sh
VA_CORE_STORE=/path/to/old/store node tests/integration/legacy-store.mjs
```

That probe copies the store before reading or writing. It verifies that existing source/build/capture/blob/receipt records are unchanged, exercises exact legacy IDs and deduplication, and labels its new feedback as automated. It does not edit an existing exported page, recapture an App or call a model.

The packaging change does not change the HTML, CSS, JavaScript, protocol, evidence or App code. File identity checks are appropriate for those preserved resources; a full browser interaction, native rebuild or new model review is only needed when its relevant behavior changes.
