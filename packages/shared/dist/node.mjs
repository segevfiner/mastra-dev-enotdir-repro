// Pre-built ESM entry for @mwe/shared.
//
// The key detail for the reproduction is that this file imports a *subpath*
// (`@tiptap/pm/state`) of a regular node_modules package whose `exports` map
// exposes ONLY subpaths (no `.` and no `./package.json`). When Mastra's
// bundler (with `bundler.externals: true`) descends into this file, it
// resolves that import via local-pkg using THIS file (a .mjs FILE) as the
// resolution base, which is what triggers the mlly ENOTDIR error.
import { EditorState } from '@tiptap/pm/state';

export function getMessage() {
  return `Hello from @mwe/shared (EditorState is ${typeof EditorState})`;
}
