# Task 10c — In-game Escape menu

thinking: off
scope: locked

Everything you need is here. Create `src/ui/screens/gameMenu.ts` (+css); wire Esc / the HUD's menu (≡) button to toggle it (edit `src/ui/keyboard.ts` Esc action and `src/ui/hud.ts` menu button handler only). Do not edit `src/sim/`. Start editing right away.

Centred modal (modern panel style, dims the map behind at 55%), opening pauses the game (GalaxyTime) and closing restores the previous paused state. Buttons: **Resume**, **Save Game** (TODO toast), **Load Game** (TODO toast), **Options**, **Main Menu** (confirm dialog → return to the main menu screen), **Exit** (confirm → `window.close()` / browser toast).
**Options** sub-panel: Music volume slider + mute (calls `src/audio/musicPlayer.ts` `setVolume/mute/unmute` if exported), UI scale (90/100/110/125% → CSS `--ui-scale` on the HUD root), Show system names / region labels toggles (store in a `src/ui/settings.ts` object persisted to `localStorage`, expose getters the renderer can read later — TODO wiring).
Tests: settings persist/restore; pause state restored on close.
`npm run typecheck` && `npm test`. Append `## Worker report`.
