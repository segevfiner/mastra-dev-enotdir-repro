# MWE: `mastra dev` prints `ENOTDIR ... /dist/node.mjs/package.json`

Minimal reproduction of a **noisy but non-fatal** `ENOTDIR` error printed (twice) by
`mastra dev` / `mastra build` during dependency analysis.

> **Related upstream issue:** [mastra-ai/mastra#18849](https://github.com/mastra-ai/mastra/issues/18849)
> ([tracked as a comment](https://github.com/mastra-ai/mastra/issues/18849#issuecomment-4886931656)).
> This is a second symptom of the **same root cause** described there — `@mastra/deployer`
> resolving a package's `package.json` through the `exports` gate via `local-pkg`
> (`getPackageRootPath` → `getPackageInfo`) instead of reading it from disk. In #18849 the
> symptom is a wrong pinned version; here the same broken resolution instead throws
> `ENOTDIR` because the resolution base is a `.mjs` **file**.

## Summary

When a bundled package's ESM entry is a **file** (e.g. `dist/node.mjs`) and it imports a
**subpath** of a package that exposes *only* subpath exports (no `.` and no
`./package.json` condition, e.g. `@tiptap/pm/state`), Mastra's bundler resolves that
import via `local-pkg` using the **importing `.mjs` file itself** as the resolution base.
`mlly` then synthesizes a `<file>/_index.js` candidate base and tries to read
`<file>/package.json`, which fails with `ENOTDIR` because `<file>` is a regular file, not
a directory. The error is caught internally and the dev server still starts, but a full
error + stack trace is printed to the console (once per resolution attempt).

```
Error: ENOTDIR: not a directory, open '.../packages/shared/dist/node.mjs/package.json'
    at Object.readFileSync (node:fs:440:20)
    at read (.../mlly/dist/index.mjs:572:17)
    at getPackageScopeConfig (.../mlly/dist/index.mjs:663:27)
    at packageResolve (.../mlly/dist/index.mjs:1840:25)
    at moduleResolve (.../mlly/dist/index.mjs:1984:18)
    at _tryModuleResolve (.../mlly/dist/index.mjs:2053:12)
    at _resolve (.../mlly/dist/index.mjs:2108:16)
    at resolveSync (.../mlly/dist/index.mjs:2141:10)
    at resolvePathSync (.../mlly/dist/index.mjs:2151:24)
    at _resolve (.../local-pkg/dist/index.mjs:80:22)
    at resolvePackage (.../local-pkg/dist/index.mjs:133:12)
    at getPackageJsonPath (.../local-pkg/dist/index.mjs:104:17)
  errno: -20, code: 'ENOTDIR', syscall: 'open',
  path: '.../packages/shared/dist/node.mjs/package.json'
```

## Environment (as reproduced)

| Package            | Version |
| ------------------ | ------- |
| node               | 22.22.2 |
| `mastra`           | 1.18.0  |
| `@mastra/core`     | 1.49.0  |
| `@mastra/deployer` | 1.49.0  |
| `mlly`             | 1.8.2   |
| `local-pkg`        | 1.2.1   |
| `@tiptap/pm`       | 2.27.2  |
| pnpm               | 10.33.0 |

The error reproduces with the latest `mlly`/`local-pkg` at the time of writing.

## Project layout

```
mwe-mastra-enotdir/
├── pnpm-workspace.yaml
├── package.json
├── apps/
│   └── mastra-app/            # Mastra app with `bundler: { externals: true }`
│       └── src/mastra/index.ts
└── packages/
    └── shared/                # "@mwe/shared" — a PRE-BUILT workspace package
        ├── package.json       #   exports map WITHOUT a "./package.json" entry
        └── dist/
            ├── node.mjs        #   ESM entry (a FILE) importing "@tiptap/pm/state"
            └── node.js         #   CJS entry
```

The three conditions that together trigger the bug:

1. `@mwe/shared` is a workspace package whose ESM entry is a **file**
   (`dist/node.mjs`) and whose `exports` map has **no `./package.json`** entry.
2. That entry imports a **subpath** of a regular (non-workspace) node_modules package
   that exposes only subpaths — `@tiptap/pm/state`. (`@tiptap/pm` has no `.` export and
   no `./package.json` export.) The subpath form matters: it makes Mastra's
   `nodeModulesExtensionResolver` run for it; a plain 2-segment scoped/1-segment bare
   specifier is skipped, and a *workspace* subpath is resolved by a different plugin.
3. The Mastra app sets `bundler: { externals: true }`, which enables Mastra's
   "externals preset" and swaps in `nodeModulesExtensionResolver`.

## Steps to reproduce

```bash
pnpm install
pnpm --filter mastra-app dev
```

### Actual result

`mastra dev` prints the `ENOTDIR` error + stack trace **twice** during
"Preparing development environment…", then the server continues and reaches
`mastra ... ready`. The build is not actually broken (`nodeResolve` resolves the import
correctly afterwards) — the output is just misleading noise.

### Expected result

No error/stack trace should be printed for a resolution probe that ultimately succeeds.

## Root cause

1. With `bundler.externals: true`, `@mastra/deployer`'s `getInputOptions` uses
   `nodeModulesExtensionResolver` instead of `nodeResolve`
   (`externalsPreset ? nodeModulesExtensionResolver() : nodeResolvePlugin`).
2. While bundling `@mwe/shared/dist/node.mjs`, rollup asks the resolver to resolve
   `@tiptap/pm/state`. `nodeModulesExtensionResolver` calls
   `getPackageRootPath('@tiptap/pm', importer)` where `importer` is the **importing
   file** `.../shared/dist/node.mjs`.
3. `getPackageRootPath` forwards this to `local-pkg`:
   `getPackageInfo('@tiptap/pm', { paths: ['file://.../shared/dist/node.mjs'] })`.
4. `local-pkg`'s `resolvePackage` calls `mlly`'s `resolveSync('@tiptap/pm', { url: [<the .mjs file>] })`.
5. `mlly._resolve` builds candidate base URLs from that base, including a synthetic
   `new URL(joinURL(url.pathname, "_index.js"), url)` → `.../node.mjs/_index.js`
   (it assumes the base could be a directory).
6. Because `@tiptap/pm` exposes no `.`/`./package.json` export, resolution falls through
   the earlier bases (each throws the *ignored* `ERR_PACKAGE_PATH_NOT_EXPORTED`) to that
   synthetic base. `getPackageScopeConfig` then does
   `new URL('package.json', '.../node.mjs/_index.js')` → reads `.../node.mjs/package.json`.
7. `.../node.mjs` is a file, so `fs.readFileSync` throws `ENOTDIR`. `mlly`'s `read()`
   only swallows `ENOENT`, so `ENOTDIR` propagates.
8. `local-pkg`'s `resolvePackage` `console.error`s any error whose code isn't
   `MODULE_NOT_FOUND` / `ERR_MODULE_NOT_FOUND` (ENOTDIR qualifies), then returns `false`.
   The failure is non-fatal, but the error is printed.

## Suggested fixes (any one breaks the chain)

- **Mastra (`@mastra/deployer`)** — most actionable: `getPackageRootPath` /
  `nodeModulesExtensionResolver` should not pass the importing **file** as the resolution
  base. Passing the importer's **directory** (or letting resolution failures be silent)
  avoids the synthetic `<file>/_index.js` base entirely.
- **`local-pkg`** — `resolvePackage` should not `console.error` on a best-effort
  resolution probe; a failed probe should return `false`/`undefined` quietly (it already
  does for `MODULE_NOT_FOUND`).
- **`mlly`** — `read()` / `getPackageScopeConfig` should treat `ENOTDIR` like `ENOENT`
  (a non-directory segment in the path means "no package.json here"), matching Node's own
  ESM resolver behavior.

## When it appeared

`bundler: { externals: true }` and the `@swimm/shared → @tiptap/pm` import already existed
on `main`. The error surfaced after upgrading `mastra` `^1.12.2 → ^1.18.0`
(`@mastra/deployer` → `1.49.0`), i.e. it is a regression in Mastra's bundler dependency
resolution, not in application code.
