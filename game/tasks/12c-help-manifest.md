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
