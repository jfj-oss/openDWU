# Task 10f — Wire Escape-menu settings into renderer and HUD

thinking: off
scope: locked

Edit `src/render/mainView.ts`, `src/ui/hud.ts`/`hud.css`, `src/ui/settings.ts` (subscribe API only), tests. Do not edit `src/sim/` or the wizard. Start editing right away.

`src/ui/settings.ts` (task 10c) stores settings in localStorage but nothing reads them yet. Add `onSettingsChange(cb)` (fires after any setter) and wire:
- **Show system names** → Main View system name labels visible/hidden.
- **Show region labels** → region/nebula labels (08f1 layer) visible/hidden.
- **UI scale** (90/100/110/125%) → the HUD root `transform: scale(s)` with `transform-origin` per anchored panel so edges stay anchored (top-left panels scale from top-left, top-right from top-right, bottom-left from bottom-left, bottom-right from bottom-right, top-middle from top-centre).
- **Music volume / mute** → already wired in 10c? if not, call `musicPlayer.setVolume/mute`.
Settings apply immediately and on startup.
Tests: `onSettingsChange` fires; scale → transform-origin mapping helper.
`npm run typecheck` && `npm test`. Append `## Worker report`.
