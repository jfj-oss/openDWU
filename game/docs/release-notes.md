# Release notes

Notes for the next release, to copy into the GitHub release (RELEASING.md step 2).

## Unreleased

- **Saves are compressed.** In-game saves, autosaves and exported `.dwusave` files are now gzip-compressed: a late-game
  save of 450 MB takes about 45 MB. The save itself is unchanged inside; it loads as before.
- **Compatibility:** saves made with this version (including exported `.dwusave` files) **cannot be opened by older
  versions of the app**. This version still opens every older save and `.dwusave` file (uncompressed ones are recognised
  automatically).
- Multiplayer (lockstep): the save a joining or resynced player receives is sent compressed, in chunks.
