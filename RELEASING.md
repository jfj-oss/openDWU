# Releasing the desktop apps

Publishing a GitHub Release builds the apps on GitHub's runners and attaches
them to that release (`.github/workflows/desktop.yml`). Nothing builds on
ordinary pushes.

| File | Platform |
|---|---|
| `openDWU-<v>-macos-arm64.dmg` | macOS, Apple silicon (ad-hoc signed) |
| `openDWU-<v>-linux-x64.AppImage` | Linux x86_64 |
| `openDWU-<v>-linux-x64.tar.gz` | Linux x86_64 (plain folder) |
| `openDWU-<v>-windows-x64-setup.exe` | Windows 10/11 x64 installer (per user, no admin) |
| `openDWU-<v>-windows-x64.zip` | Windows x64, portable |

Each comes with a `.sha256` file. The installed apps check this repository's
latest release once a day and offer the new download.

## Making a release

1. **Bump the version** in `game/package.json` (the apps take their version
   from it), commit and push:

   ```sh
   cd game
   npm version 0.2.0 --no-git-tag-version   # updates package.json + package-lock.json
   git commit -am "Release 0.2.0"
   git push
   ```

2. **Create the release on GitHub:** Releases → **Draft a new release** →
   **Choose a tag** → type `v0.2.0` (exactly `v` + the version) → **Create
   new tag: v0.2.0 on publish**, with the branch that has the bump commit as
   target → add a title and notes → **Publish release**. Or from a terminal:

   ```sh
   gh release create v0.2.0 --target main --title "openDWU 0.2.0" --notes "What changed…"
   ```

3. **Wait for the builds:** the Actions tab shows a "desktop" run for the
   release (usually done within half an hour). Each platform's files appear on the
   release as its job finishes.

That's all; installed apps see the new version within a day.

## Details

- **The tag must be `v<version>`** of `game/package.json` at the tagged
  commit, otherwise the run stops at the first step with an error before
  building anything. Fix it by deleting the release and its tag and redoing
  step 2 (or bump the version to match and release again).
- **Pre-releases** ("Set as a pre-release") are built and attached too, but
  the apps' update check never offers them: it follows GitHub's "latest"
  release, which skips pre-releases and drafts. Saving a **draft** builds
  nothing; publishing it does.
- **Tag pushes alone do nothing.** Publishing the release creates the tag and
  triggers the build, so there is exactly one build per release. A tag pushed
  first is fine: then pick it in step 2.
- **Retry / rebuild** a release's files (e.g. after a runner hiccup): Actions →
  **desktop** → **Run workflow** → enter the tag (`v0.2.0`). Files with the
  same names are replaced. Without a tag, the manual run only keeps the files
  as workflow artifacts (14 days), handy for testing a branch.
- **No signing.** There are no Apple or Microsoft certificates: the macOS app
  is signed ad hoc, so users do the one-time Control-click → Open (or System
  Settings → Privacy & Security → Open Anyway); Windows SmartScreen says
  "Windows protected your PC" until they click More info → Run anyway. The
  README's install sections explain both. Updates are offered, not installed
  silently (Electron's macOS auto-updater refuses unsigned apps).
- **No original game files** are ever in the repo, the workflow artifacts or
  the apps: the runners have no Distant Worlds: Universe install, the app
  builds the install's file listings from the player's folder at runtime, and
  `scripts/package-desktop.mjs` fails the build if anything outside its
  allow-list ends up in the package.

## Building locally

From `game/`: `npm run dist:linux` and `npm run dist:win` (both also work on
Linux; the Windows zip needs `7z`) and `npm run dist:mac` (on a Mac) write the
same files to `release/upload/`. `node scripts/desktop-check.mjs` tests the
Linux package against your install headlessly (see
[`game/desktop/README.md`](game/desktop/README.md)).
