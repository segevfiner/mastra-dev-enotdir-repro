import { Mastra } from '@mastra/core';
import { getMessage } from '@mwe/shared';

// Referencing the workspace package makes Mastra's bundler descend into
// @mwe/shared/dist/node.mjs and resolve its subpath import (@tiptap/pm/state).
// That resolution passes the .mjs FILE as the base to local-pkg, which
// triggers the ENOTDIR error printed to the console during `mastra dev`.
// eslint-disable-next-line no-console
console.log(getMessage());

// `bundler.externals: true` enables Mastra's "externals preset", which swaps in
// `nodeModulesExtensionResolver`. That resolver calls local-pkg's getPackageInfo
// with the *importing file* (@mwe/shared/dist/node.mjs) as the resolution base,
// which is what triggers the ENOTDIR error.
export const mastra = new Mastra({
  bundler: { externals: true },
});
