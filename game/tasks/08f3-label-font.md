# Task 08f3 — Map labels render in the fallback serif font

thinking: off
scope: locked

Edit `src/render/mainView.ts` (and `src/main.ts` only if needed). Start editing right away.

Pixi `Text` objects for region labels, system names and planet names are created before the 'Forgotten Futurist' web font (declared via CSS `@font-face` in the HUD css) has loaded, so they rasterize in a serif fallback and never update.
Fix: before building the Main View text layers, `await document.fonts.load('16px "Forgotten Futurist"')` and `document.fonts.load('bold 16px "Forgotten Futurist"')` (catch and continue on failure); also, if any label was created earlier, re-apply its style (`text.style.fontFamily = 'Forgotten Futurist'` forces a re-render) once `document.fonts.ready` resolves. Every map `Text` uses `fontFamily: 'Forgotten Futurist, sans-serif'` so the fallback is at least sans-serif.
Test: a pure helper `MAP_FONT_FAMILY` constant equals `'Forgotten Futurist, sans-serif'` and every Text style in mainView uses it (grep-style test on the module source is fine).

`npm run typecheck` && `npm test`; save (don't open) `shots/08f3-labels.png` at `/?skipMenu=1`. Append `## Worker report`.
