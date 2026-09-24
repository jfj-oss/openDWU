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

## Worker report

Files changed:
- `src/ui/settings.ts` — added the change-notification API: `onSettingsChange(cb)` (returns an unsubscribe fn), `clearSettingsListeners()` (test hook), and a private `notifySettingsListeners` called at the end of `updateSettings` after persist + sound apply. A throwing listener is caught so it can never break a settings change.
- `src/render/mainView.ts` — `update()` now reads the settings per frame: system name labels are gated by `z > labelZoom && showSystemNames()`, and the 08f1 region-label layer (`this.regionLabels`) has its container `visible` set from `showRegionLabels()` with the per-label update loop skipped while hidden. Both boot paths call `MainView.update()` every tick, so toggles in the Escape menu apply immediately and the persisted values apply on startup.
- `src/ui/hud.ts` — new UI-scale section: `hudTransformOrigin(name, rect)` maps each element to its anchored corner (`pnlMoney` → `100% 0`, `pnlOptionsList` → `100% 100%`, `pnlSelection` → `0 100%`, `lstMessages` + all top-bar buttons → `50% 0`, everything else → `0 0`; pure, no window access) and `applyHudScale(refs)` sets `transform: scale(s)` / `transform-origin` per element (factor 1 clears the transform). `createHud` applies the persisted scale on startup and subscribes `onSettingsChange(() => applyHudScale(refs))` for immediate application; `layoutHud` re-applies it after a resize re-layout.
- `test/gameMenu.test.ts` — new tests: `onSettingsChange` fires with the new state after `updateSettings`, stops after unsubscribe, and survives a throwing listener; listener cleanup added to before/afterEach.
- `test/hud.test.ts` — new `hudTransformOrigin` describe block covering the full anchor mapping (right-anchored panels, bottom-left selection panel, top-middle message panel + every top-bar button, default top-left).

Notes:
- Music volume/mute was already wired in task 10c (`src/ui/screens/gameMenu.ts` drives `musicPlayer.setVolume/mute/unmute` directly from the slider/mute controls); nothing to rewire here.
- No `hud.css` changes were needed: scale/origin are applied inline in JS per element.

Verification: `npm run typecheck` passes; `npm test` — 469/469 tests pass (40 files). Dev server boots clean (no console errors); headless screenshot saved to `shots/task10f-settings.png` for visual review.

Left undone: none within scope. The two Escape-menu label toggles' old `TODO` comment in `gameMenu.ts` (not editable in this task) is now stale — the flags take effect via the mainView wiring above.
