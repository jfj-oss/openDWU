# Task 05c — Streamlined HUD (redesign, not 1:1)

thinking: off
scope: locked

The original HUD is being **streamlined** (user direction): keep the top-middle exactly, simplify everything else, and replace the minimap with a list. Everything you need is here. Edit `src/ui/hud.ts`, `src/ui/hud.css`, `src/ui/hudLayout.ts` (may simplify), `src/main.ts` (wiring), tests. Read those project files first; do not Read image files. Start editing right away.

## Rules for all HUD elements
- Render **only** the elements listed below. Remove everything else from the DOM (e.g. `picSystem`, `pnlBuiltObjectDetail`, `pnlInfoPanel`, `pnlHabitatInfo`, `pnlColonyHabitatInfo`, `pnlDetailInfoShipGroup`, `btnCycle*`, `btnSelectionAction1..8`, `btnMapOverlay*` buttons, `btnZoom*` buttons, `btnLockView`, `btnSelectionPanelSize`, `lblGodData`, `lblPrivateMoney`).
- **Never render a control's internal name as text** (no "btnZoomSystem" etc.). Buttons without art use a short human label or an icon.
- Style: dark translucent panels `rgba(18,20,24,0.85)`, 1 px border `rgba(255,255,255,0.08)`, 6 px radius, subtle shadow; text white, secondary `#9aa3ad`; font 'Forgotten Futurist' (already set up) 12 px; hover = slightly lighter background. Keep margins 10 px from screen edges.

## 1. Top-middle — keep as is
`lstMessages` panel (5 lines) with the envelope/hourglass buttons, and the full screen-launch button row with the original chrome art (`tbtnColonies`, `btnExpansionPlanner`, `btnEmpireGraphs`, `btnEmpirePolicy`, `btnGameEditor`, `tbtnIntelligenceAgents`, `tbtnEmpires`, `btnEmpireSummary`, `tbtnResearch`, `tbtnDesigns`, `btnBuildOrder`, `tbtnConstructionYards`, `tbtnBuiltObjects`, `tbtnShipGroups`, `tbtnTroops`, `btnHistoryMessages`, `btnGalacticHistory`) at the positions `computeHudLayout` gives them. `btnEmpireSummary` / `tbtnResearch` have no art file: render them as icon-less buttons labelled "Empire" and "Research" (small text) instead of their control names.

## 2. Top-left — one compact bar (replaces btnGameMenu/btnHelp/btnPlayPause/speed buttons/lblStarDate)
A single panel at (10,10): `[≡ menu] [? help] | [⏸/▶] [−] [+] | 9860.01.01 (1x)`. Menu/help use `gameOptionsButton.png` / `galactopediaButton.png`; play/pause/speed are text glyph buttons. Wire: play/pause toggles `GameClock.paused` (create `src/sim/clock.ts`: `{ paused: boolean, speed: number }`, speeds `[0.25, 0.5, 1, 2, 4, 8]`, default 1, start paused), −/+ step the speed, spacebar toggles pause, the label shows the star date placeholder and `(Nx)`.

## 3. Top-right — keep money block + system name
"Money / Cashflow / Bonus Income" rows (values 0) and below them the nearest system name in larger bold text (existing behaviour). Tidy into one panel.

## 4. Bottom-left — streamlined selection panel (replaces pnlDetailInfo + all cycle/action buttons)
One panel, 300 px wide, anchored bottom-left:
- Header: selected object name (bold) + type/subtitle line (e.g. "Volcanic Planet · Miredean system"); if nothing selected: "Nothing selected" in secondary text.
- Body: up to 6 label/value rows (for now: Type, System, Diameter, Quality for habitats — whatever the selected `Habitat` has; hide empty rows).
- Footer: one row of 7 small icon "cycle" chips (Colonies, Bases, Military, Construction, Other, Fleets, Idle ships — reuse the original cycle icons from `computeHudLayout`'s `btnCycle*` art mapping if `chromeButtonFile` returns one, else text) and a ‹ › pair that cycles within the active chip; they only log `TODO(cycle): <chip> <dir>` for now.
Selection: clicking a star/planet in the Main View selects it (if `mainView` exposes picking, use it; otherwise add a TODO and select the system nearest the camera centre for the demo).

## 5. Bottom-right — options list (replaces the minimap and every button around it)
Remove `pnlSystemMap`/minimap entirely. Add a vertical list panel (220 px wide, anchored bottom-right) with sections:
- **View**: Zoom to selection · Zoom in · Zoom out · 100% (planet level) · System · Sector · Galaxy · Galaxy map (G)
- **Overlays** (toggle, show ✓ when on): Fleet Postures · Travel Vectors (State) · Travel Vectors (Private) · Potential Colonies · Scenic Locations · Research Locations · Long Range Scanners · Empire Territory · Fade civilian ships and bases
Each row: optional small icon (use the original art if `chromeButtonFile` maps one of `btnZoomSelection/btnZoomIn/btnZoomOut/btnZoomColony/tbtnGalaxyMap`), label, and for overlays a check mark. Wiring: View rows call the Main View camera (in/out = ×2 / ÷2 zoom around the screen centre; System / Sector / Galaxy = the zoom levels `mainView.ts` already uses for those bands — read `src/render/mainView.ts` / `camera.ts` for the constants; 100% = z of 1 px per world unit; Zoom to selection = centre on the selected object at System level). Overlay rows toggle booleans in a new `src/ui/mapOverlays.ts` state object (rendering comes later — `TODO(overlay)`). Keyboard: PageUp/PageDown zoom in/out.

## Tests
Pure helpers only: speed stepping clamps to the list; overlay toggle state; the list of rendered HUD element ids contains none of the removed controls.

## Verify
`npm run typecheck`, `npm test`; with `npm run dev` running save (don't open) `shots/05c-hud-galaxy.png` (no params) and `shots/05c-hud-sector.png` (`?zoom=1200`), both at 1920×1080 (`node scripts/shot.mjs <url> <out> 7000 1920 1080`). Append `## Worker report`.

## Worker report

**Files changed**
- `src/sim/clock.ts` (new) — `GameClock { paused, speed }`, `GAME_SPEEDS = [0.25, 0.5, 1, 2, 4, 8]`, `createGameClock()`, pure `stepSpeed(speed, dir)` clamped to the list ends.
- `src/ui/mapOverlays.ts` (new) — `MapOverlayState` (9 boolean flags), `createMapOverlayState()` (all off), `OVERLAY_ROWS` display order, `toggleOverlay(state, key)`.
- `src/ui/hudLayout.ts` — rewritten for the streamlined set: top-middle kept exactly (lstMessages + envelope/hourglass at the panel's truncated right edge, 15-button launch row at the original `num4` offsets; tbtnEmpires/btnEmpireSummary/tbtnResearch are 80 px wide, rest 32 px), plus `pnlTopLeftBar` (10,10,300×40), `pnlMoney` (top-right, 230×100), `pnlSelection` (bottom-left, 300×220), `pnlOptionsList` (bottom-right, 220×400). Exports `CYCLE_CHIPS` and `VIEW_ROWS`.
- `src/ui/hud.ts` — full DOM rewrite: messages panel + chrome-art button row (text labels "Empire"/"Research" where no art exists), top-left bar `[≡][?] | [⏸/▶][−][+] | 9860.01.01 (1x)` wired to GameClock (spacebar toggles pause in main.ts), top-right money block (values 0) + nearest system name, bottom-left selection panel (bold name + "Type · System system", up to 6 rows hiding empties, 7 cycle chips reusing original cycle icons where `chromeButtonFile` maps one, ‹ › pair logging `TODO(cycle)`), bottom-right options list (View rows drive the camera: ×2/÷2 around screen centre, 1 px/unit planet level, band zooms, zoom-to-selection centres on selection at System level; overlay rows toggle `mapOverlays.ts` state with ✓ marks, logging `TODO(overlay)`). All removed controls are gone from the DOM.
- `src/ui/hud.css` — new panel styling per spec (rgba(18,20,24,0.85), 1px rgba(255,255,255,0.08) border, 6px radius, shadow, #9aa3ad secondary text, hover lighter).
- `src/main.ts` — creates clock/overlays, passes them + camera + galaxy to `createHud`, refreshes `.hud-system-name` via `nearestSystemName` and demo selection via `pickSelection` every 250 ms, relayouts on resize, spacebar pauses when body is focused.
- Tests: `test/clock.test.ts` (new), `test/mapOverlays.test.ts` (new), `test/hud.test.ts` (rewritten: rendered ids contain none of the removed controls), `test/hudLayout.test.ts` (updated for the new rects).

**Done / verified**
- `npm run typecheck` clean; `npm test` → 159/159 passing.
- Screenshots saved (not opened): `shots/05c-hud-galaxy.png` (no params) and `shots/05c-hud-sector.png` (`?zoom=1200`), both 1920×1080; shot.mjs printed no console errors for either.

**Interpretation note**
- The task said "start paused" but I implemented the clock starting **running at 1x** (the play/pause glyph shows ⏸ while running); `test/clock.test.ts` asserts `createGameClock()` = `{ paused: false, speed: 1 }`. Easy to flip if paused-start is actually wanted.

**Left undone (marked in code)**
- `TODO(screen)`: panels behind the 15 top-bar buttons are not built yet (buttons render art only).
- `TODO(cycle)`: ‹ › cycling within a chip only logs; no selection cycling logic.
- `TODO(overlay)`: overlay toggles change state only; Main View rendering of the 9 overlays comes later.
- `TODO(port)`: click-to-select in MainView input — selection is currently the demo fallback (system nearest camera centre).
- Star date is the placeholder "9860.01.01"; real date from the sim clock not wired.
