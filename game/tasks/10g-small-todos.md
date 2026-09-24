# Task 10g — Small UI TODO cleanups

thinking: off
scope: locked

Edit `src/ui/keyboard.ts`, `src/ui/settings.ts`, `src/ui/screens/gameMenu.ts`, `src/main.ts` (selection hook only), tests. Start editing right away.

1. `keyboard.ts` ~248 `TODO(port): zoom to the selected item — needs the selection hook`: the HUD/Main View now has a selection (task 08g/10b). Expose `getSelection()` from wherever the selection lives (main.ts wiring) and implement: centre the camera on the selected habitat at System zoom (same as the HUD "Zoom to selection" row — reuse its function).
2. `settings.ts` ~171 and `gameMenu.ts` ~243 TODOs about "consume these flags in the Main View renderer": task 10f wired them — verify by reading `mainView.ts` for the settings subscription, then delete the stale TODO comments (only if wired; otherwise wire them the same way 10f did).
3. `gameMenu.ts` 132/136 save/load TODOs: leave as-is (another task owns save/load).
Tests: keyboard zoom-to-selection calls the shared zoom function with the selected habitat.
`npm run typecheck` && `npm test`. Append `## Worker report`.
