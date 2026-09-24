# Task 10c — In-game Escape menu

thinking: off
scope: locked

Everything you need is here. Create `src/ui/screens/gameMenu.ts` (+css); wire Esc / the HUD's menu (≡) button to toggle it (edit `src/ui/keyboard.ts` Esc action and `src/ui/hud.ts` menu button handler only). Do not edit `src/sim/`. Start editing right away.

Centred modal (modern panel style, dims the map behind at 55%), opening pauses the game (GalaxyTime) and closing restores the previous paused state. Buttons: **Resume**, **Save Game** (TODO toast), **Load Game** (TODO toast), **Options**, **Main Menu** (confirm dialog → return to the main menu screen), **Exit** (confirm → `window.close()` / browser toast).
**Options** sub-panel: Music volume slider + mute (calls `src/audio/musicPlayer.ts` `setVolume/mute/unmute` if exported), UI scale (90/100/110/125% → CSS `--ui-scale` on the HUD root), Show system names / region labels toggles (store in a `src/ui/settings.ts` object persisted to `localStorage`, expose getters the renderer can read later — TODO wiring).
Tests: settings persist/restore; pause state restored on close.
`npm run typecheck` && `npm test`. Append `## Worker report`.

## Worker report

**Files changed**
- `src/ui/settings.ts` (new) — persisted UI settings (`musicVolume`, `musicMuted`, `uiScale`, `showSystemNames`, `showRegionLabels`) as one JSON blob in localStorage under `dwu-ui-settings`; injectable storage backend for node tests; renderer getters (`showSystemNames()`, `showRegionLabels()`, `uiScaleFactor()`).
- `src/ui/screens/gameMenu.ts` (new) — centred modal (55% dim layer) with Resume / Save Game (TODO toast) / Load Game (TODO toast) / Options / Main Menu (confirm → `onMainMenu` callback) / Exit (confirm → `window.close()` in the Electron shell, else a "close this tab" toast). Opening snapshots + forces `GalaxyTime.paused = true`; closing restores the snapshot (pure helpers `pauseForMenu`/`restorePauseState`). Options sub-panel: music volume slider + mute/unmute (drives the `MusicPlayer` via an injectable adapter), UI scale 90/100/110/125% applied as `--ui-scale` on `#hud`, and the two label toggles.
- `src/ui/screens/gameMenu.css` (new) — panel styling matching the HUD's dark modern look.
- `src/ui/keyboard.ts` — added `setGameMenuHandler()` registration slot; `buildDefaultHandlers`'s `gameMenu` action now calls it (falls back to the old TODO log when unregistered). This is the single Escape path.
- `src/ui/hud.ts` — `createHud` creates the game menu with its clock, registers `gameMenu.toggle` as the Esc handler, exposes it on `HudRefs.gameMenu`, and gives the ≡ button a real click handler that toggles the menu (replacing the generic TODO log for that button only).
- `test/gameMenu.test.ts` (new) — settings persist/restore/clamp/corrupt-blob/getters against a fake storage; pause-state restore on close against a real `GalaxyTime` (both unpaused→paused→restored and paused→stays-paused).

**Verification**
- `npm run typecheck` — passes.
- `npm test` — 37 files / 378 tests pass (including the 7 new ones).

**Left undone**
- Save/Load are TODO toasts (original save/load not ported yet).
- `showSystemNames` / `showRegionLabels` are stored but not consumed by the Main View renderer yet (`// TODO(port)` notes in `settings.ts` and `gameMenu.ts`).
- No visual screenshot taken (task is locked-scope; wiring verified by typecheck + tests).
