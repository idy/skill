# Independent release and collection migration

`idy/skill` is the public source repository. `pi-visual-acceptance` is the independent npm package and marketplace identity. `/skill:visual-acceptance` is its unchanged invocation. The private root workspace must never be published. Later skills get sibling packages, their own npm names, precise Pi resources and their own release decisions.

This revision prepares `pi-visual-acceptance@0.1.0`; it does not publish anything or modify the previously published `idy-pi-skills@0.1.0` registry entry. Check the selected name again at release time: a registry 404 is availability evidence, not a reserved name. npm account `idy` owns the existing package and can perform its later migration through the normal authenticated npm session.

After independent review and merge, release the exact reviewed tarball, then verify its version/latest metadata, remote tarball bytes, isolated npm installation and marketplace discovery before migrating the old entry. The release command is:

```sh
npm publish /absolute/path/to/reviewed/pi-visual-acceptance-0.1.0.tgz --access=public --tag=latest --ignore-scripts --registry=https://registry.npmjs.org
```

The release operator should use the existing npm login. Any official publish verification challenge belongs in npm's normal web flow; do not collect credentials or change a user's global Pi configuration.

## Deprecation and search

[npm's deprecation guide](https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions/) explicitly says that deprecating an **entire package** removes it from search results on the npm website and displays a message on the package page. [The CLI reference](https://docs.npmjs.com/cli/v11/commands/npm-deprecate/) promises an install warning and supports deprecating all versions. This keeps old versions installable.

The documented website promise does not specify the behavior or propagation time of the registry `/-/v1/search` API used by yesman. Do not assert that a deprecated package is hidden from that marketplace without querying its actual endpoint. Read-only probes of known deprecated packages can support the expectation, but they do not establish the result for this package. After migration, check the exact old name in `objects[].package.name`, not only `total`, using both normal function-name searches and these filtered queries:

```text
https://registry.npmjs.org/-/v1/search?text=keywords%3Api-package%20maintainer%3Aidy&size=30&from=0
https://registry.npmjs.org/-/v1/search?text=keywords%3Api-package%20keywords%3Avisual-acceptance&size=30&from=0
```

After the new package is available, deprecate the whole old package with a useful direction:

```sh
npm deprecate 'idy-pi-skills@*' 'Install npm:pi-visual-acceptance instead. Each skill is now an independent package; /skill:visual-acceptance is unchanged. Existing project evidence and exports remain usable.' --registry=https://registry.npmjs.org
```

This is a future release action, not a command run by this PR. Do not unpublish the old package or move its latest tag to an empty replacement.

## Optional one-time compatibility release

If the old collection still appears in the marketplace after deprecation/search propagation, use the prepared one-time `idy-pi-skills@0.1.1` compatibility tarball. Build it from the **published 0.1.0 tarball**, whose SHA-256 is `1b7746e92ee2f5904e9abe291a208ba51b6d366dd5247e7cde04927dad83c2dc`, rather than republishing the new workspace root.

Keep every existing runtime, CLI, skill, demo, media and archive file. Change only `package.json` and the README: increment to `0.1.1`, remove the `pi-package` keyword, describe the migration, and narrow `pi.skills` from `./skills` to `./skills/visual-acceptance`. Keep the original runtime dependencies, CLI and extension. This preserves the installed functionality and removes the latest version's marketplace eligibility keyword; it is neither an empty placeholder nor a dependency that automatically installs a collection. It needs no permanent compatibility workspace in source.

Pack this snapshot in temporary storage, audit each payload file against 0.1.0, and verify runtime installation and Pi discovery before releasing the exact reviewed tarball. If this fallback is needed, publish it under the old name with `--tag=latest --ignore-scripts`, then apply the same whole-package deprecation again so the newly published version also carries the warning. Recheck latest keywords, deprecation, old version installability and the actual marketplace searches. Cached search entries can lag metadata updates; no fixed delay is promised.

For existing users, installing the independent package and removing the old Pi package declaration avoids duplicate skill and tool registrations. `pi list` gives the exact configured source for `pi remove`. Do not remove project `.visual-acceptance` stores, exported review pages, browser comments or the user's global configuration. The migration changes distribution identity; stable project/cell/capture/build/image identities, protocol-2 receipts and AI/human history remain valid.
