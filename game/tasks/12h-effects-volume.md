# Task 12h — Sound effects volume in Options

thinking: off
scope: locked

Edit only `src/ui/screens/gameMenu.ts`, `src/ui/screens/gameMenu.css` (if needed), and `src/audio/effectsPlayer.ts` (`startEffects` only). Start editing right away.

`UiSettings` (src/ui/settings.ts) already has `soundVolume` (default 0.7) and `soundMuted`, but nothing reads them.

1. `gameMenu.ts` Options panel (~line 96, "Music Volume" row): add a second row, "Sound Effects Volume", directly below it, built exactly like the music row (range 0..1, step 0.05, Mute/Unmute button).
   - It writes `soundVolume` / `soundMuted` through `updateSettings`.
   - Apply it with `startEffects().setVolume(v)` / `.mute()` / `.unmute()` (import `startEffects` from `../../audio/effectsPlayer`).
   - The panel must stay import-safe in node tests. Call startEffects only inside the event handlers, never at module load or panel build.
2. `effectsPlayer.ts` `startEffects()`: when it creates the instance, apply the saved settings. Use `getSettings()` from `../ui/settings`, then `instance.setVolume(s.soundVolume)`, and call `instance.mute()` if `s.soundMuted`.
3. Keep the existing tests green. No new DOM tests (jsdom is not configured).

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

**Files changed:**
- `src/ui/screens/gameMenu.ts` — added an `EffectsAdapter` interface + `defaultEffects()` lazy fetch (mirrors the music adapter); `buildOptionsPanel` now takes an optional `effects` param and builds a "Sound Effects Volume" row directly below the music row (range 0..1, step 0.05, Mute/Unmute button). The row writes `soundVolume`/`soundMuted` via `updateSettings` and drives the player with `setVolume`/`mute`/`unmute`; `startEffects` is only invoked inside event handlers / the lazy default, never at module load or panel build. `createGameMenu` resolves the effects adapter and passes it through.
- `src/audio/effectsPlayer.ts` — `startEffects()` now applies the persisted settings when it creates the instance: `getSettings()` from `../ui/settings`, then `instance.setVolume(s.soundVolume)` and `instance.mute()` if `s.soundMuted`. (Import-safe: `getSettings` is storage-backed and touches no audio.)
- `src/ui/screens/gameMenu.css` — not modified; the existing `.game-menu-option-row` / slider / mute styles already cover the new row.

**Done:** both task items implemented; `npm run typecheck` clean and `npm test` green (51 files, 599 tests). No new DOM tests added (jsdom not configured), per instructions.

**Left undone:** nothing. Note that `settings.ts`'s `applySoundSettings` already pushes sound settings into the live player on every `updateSettings`, so the explicit `startEffects().setVolume(...)` calls in the new row are belt-and-braces for contexts where the player exists but the settings listener path is bypassed; behaviour is consistent either way.
