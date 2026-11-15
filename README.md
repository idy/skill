# Pi skills

This public repository, [idy/skill](https://github.com/idy/skill), manages Pi skills in one source workspace. **Each skill has its own npm package, marketplace entry and installation.** The repository root is private and cannot be published as a collection package.

| Skill | npm / marketplace package | Install | Invoke |
| --- | --- | --- | --- |
| [Visual Acceptance](packages/visual-acceptance/README.md) | `pi-visual-acceptance` | `pi install npm:pi-visual-acceptance` | `/skill:visual-acceptance` |

Visual Acceptance reviews evidence from the actual running App through the user-selected Device Hub bridge. Humans and agents share a versioned HTML review matrix. Native App evidence, source/build identities and independent human decisions remain separate from the HTML review page.

The independent package is prepared for its first `0.1.0` release. The npm installation command above becomes available after that release; this source change alone does not publish it. The former `idy-pi-skills` collection package was published in error. See the [release and migration plan](docs/package-migration.md) for its safe transition.

Run `/reload` after installation in an existing Pi session, then `/skill:visual-acceptance`. To migrate an existing collection install, install the independent package and remove the old package declaration with `pi remove npm:idy-pi-skills` (use the exact old source shown by `pi list`, including a pinned version). Evidence stores and exported review pages belong to the project; retain them. Avoid leaving both packages enabled, which would register duplicate skill/tool names.

The existing `pi install git:github.com/idy/skill` source remains a compatibility route. Its root Pi manifest forwards **only** to Visual Acceptance's exact skill directory and extension. It checks out this source repository, but adding another workspace never adds that skill to this entry. Prefer the independent npm package for a single skill installation.

For local development with Node.js 20+:

```sh
npm ci --ignore-scripts --omit=peer
npm test
npm run check
npm run check:schema
npm run demo-export -- --out /absolute/path/to/new-review
npm run pack:visual-acceptance -- --pack-destination /absolute/path/to/artifacts
```

Each self-contained package lives under `packages/<skill>/` with its own manifest, runtime dependencies, CLI, skill resources, docs and tests. Package-relative commands in a skill's documentation run from that package directory. Use `npm run <command> --workspace=pi-visual-acceptance` to run a package command from the repository root. [Packaging verification](docs/packaging.md) includes runtime-only tarball installation and a sibling skill isolation check.
