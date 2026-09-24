# Task 12c — List help .mht files in the asset manifest (galactopedia TODO)

thinking: off
scope: locked

Edit only `scripts/gen-asset-manifest.mjs`, `src/render/assets.ts` (add a getter only), `src/ui/screens/galactopedia.ts` (`probeHelpListing` only) and tests. Start editing right away.

C# (Galaxy.9.cs) lists these folders with Directory.GetFiles:
- AddGameInfoTopics: `Customization/<set>/help/` GetFiles("GameInfo_*.mht"), then `help/` GetFiles("GameInfo_*.mht").
- AddThemeTopics: `Customization/<set>/help/` GetFiles("<set>_*.mht"); `<set>.mht` if File.Exists, else the first of those files.

1. `gen-asset-manifest.mjs`: add manifest keys that hold sorted file-name lists (windowsOrdinal, like listTxtFiles), top level only:
   - key `"Help"`: every `*.mht` directly in `$DWU/Help/`. The folder name is `Help` on disk; look it up case-insensitively like the other folders.
   - key `"Customization/<set>/help"`: every `*.mht` in `Customization/<set>/help/`, for each subfolder `<set>` of `$DWU/Customization/` that has a `help` folder (any case).
   Add a `listFiles(dir, ext)` helper next to listTxtFiles rather than duplicating it.
2. `assets.ts`: add `export function manifestFiles(key: string): string[] | undefined` that returns the manifest list for the key (undefined if loadManifest has not run or the key is absent). Read how `pickFromFolder` reads the manifest and reuse that.
3. `galactopedia.ts` `probeHelpListing`, when manifest lists exist:
   - `gameInfoFiles` = (set help files starting with `GameInfo_`, case-insensitive) followed by (Help files starting with `GameInfo_`);
   - `themeFiles` = set help files matching `<set>_*.mht` (case-insensitive prefix `<set>_`);
   - `themeRootExists` = the set list contains `<set>.mht`;
   - `gameInfoDefaultExists` = `GameInfo_Default.mht` is in either list.
   When the manifest has no "Help" key (manifest not loaded), keep the current urlExists probing unchanged. Update the doc comment and remove the TODO(port) about listing Help/.
4. Tests: pure-function tests. Extract the manifest → listing logic into an exported function `helpListingFromManifest(set, helpFiles, setHelpFiles): HelpFolderListing` in galactopedia.ts and test it:
   - no set;
   - a set with `<set>.mht`;
   - a set without `<set>.mht` but with `<set>_A.mht`;
   - GameInfo files ordered set-first.

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

Files changed:
- `scripts/gen-asset-manifest.mjs` — new manifest keys `"Help"` (every `*.mht` directly in `$DWU/Help/`, folder looked up case-insensitively) and `"Customization/<set>/help"` for every `<set>` subfolder of `$DWU/Customization/` that has a `help` folder (any case). Added generic `listFiles(dir, ext)` helper; `listTxtFiles` now delegates to it. Added `findSubentry(dir, name)` for the case-insensitive folder lookup. Header comment documents the new keys.
- `src/render/assets.ts` — added `export function manifestFiles(key: string): string[] | undefined` reading the same `MANIFEST` map `pickFromFolder` uses (undefined until `loadManifest()` runs or when the key is absent).
- `src/ui/screens/galactopedia.ts` — extracted the manifest→listing logic into exported pure `helpListingFromManifest(set, helpFiles, setHelpFiles): HelpFolderListing` (case-insensitive matching, set-folder GameInfo files first, `<set>_` prefix for themeFiles, `<set>.mht` → themeRootExists, `GameInfo_Default.mht` in either list → gameInfoDefaultExists). `probeHelpListing` now uses the manifest's `Help` + `Customization/<set>/help` lists via `manifestFiles` when the "Help" key exists; the previous urlExists probing is kept unchanged as the no-manifest fallback. Doc comment updated; the TODO(port) about listing Help/ removed.
- `test/gameText.test.ts` — tests for `helpListingFromManifest`: no set; a set with `<set>.mht` (root exists, `<set>.mht` itself is not a theme file since `GetFiles("<set>_*.mht")` requires the underscore); a set without `<set>.mht` but with `<set>_A.mht`; GameInfo files ordered set-first with case-insensitive matching.
- `test/data-manifest.test.ts` — install-linked tests asserting the `Help` key matches the on-disk `*.mht` listing (top level only, sorted windowsOrdinal) and each `Customization/<set>/help` key matches its on-disk listing (or is absent when the set has no help folder / no .mht files); backward-compat imageKeys filter excludes the new keys.

Done: all four task items implemented; `npm run typecheck` passes and `npm test` passes (587/587). The stock install has no `Help/*.mht` or `Customization/*/help/*.mht` files, so on this machine the new manifest keys are simply absent and the galactopedia keeps its existing 404-probe behavior.

Left undone: none within scope. Note: the pre-existing separate `TODO(port)` in galactopedia.ts about wiring `CUSTOMIZATION_SET` to the active customization set remains — it predates this task and is out of its scope. No dev-server screenshot was taken: the change is data-path only and covered by the unit tests above.
