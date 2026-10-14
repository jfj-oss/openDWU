# Windows UI audit (2026-10-14)

Every main screen of openDWU was opened on a Windows 11 laptop (Intel UHD 620 class iGPU, stock Steam DW:U install
without the decompiled `Customization/DistantWorldsExpanded-main` tree), driven invisibly over SSH + CDP, and
measured from the DOM with `scripts/ui-audit.mjs`:

- **overflow**: a text element whose content is wider / taller than its box (`scrollWidth > clientWidth`,
  `scrollHeight > clientHeight`), clipped or spilling (scroll lists excluded);
- **overlap**: two sibling text boxes intersecting by more than 3 x 3 px;
- **outside**: a text element sticking out of its window by more than 3 px (scrolled-away rows excluded);
- light backgrounds behind text, the fonts in use (and whether Forgotten Futurist loaded), console errors / 404s.

Runs: `win0129b` = the 0.1.29 release zip (before), `win-b3` = a Windows package of main with these fixes (after),
`linux2` = the same code on Linux (headless Chromium, ANGLE / Vulkan GPU), to separate Windows-only problems.
Screenshots (never committed) are in `~/data/agent-tmp/winui/<run>-<screen>.png`; the wizard and Game Options are
also at 1366 x 768. Re-run: `node scripts/ui-audit.mjs --cdp=http://127.0.0.1:<port> --tag=<run>` against
`dwu.exe --remote-debugging-port=<port>`, or `--url=http://localhost:5173/` for the dev server.

Note on the SSH test session: it has no display adapter, so Chromium runs WebGL in "readback" mode without GPU
compositing (`gpu_compositing=disabled_software`); WebGL2 on the Intel GPU (D3D11) did work there. It is a good test
for the DOM layout and the no-WebGL fallback (`?renderer=canvas`), but not proof of the player's real GPU path.

## Totals

| Run | overflow | overlap | outside | 404 / page errors |
|---|---|---|---|---|
| Windows, 0.1.29 (before) | 538 | 120 | 69 | 109 |
| Windows, with the fixes (after) | 105 | 73 | 26 | 8 |
| Linux, with the fixes | 108 | 75 | 27 | 0 |

New Game wizard only (both sizes): before [42, 12, 0, 78], after [12, 2, 0, 0] (overflow / overlap / outside / errors). The 0.1.29 page errors are the font and resx 404s.

Most of what remains after the fixes is intended truncation (column headers and hot-key descriptions with an
ellipsis and a tooltip, as the original's fixed-width columns cut them too) and box overlaps that are not visible
(right-aligned labels whose box spans under a neighbour; Diplomacy rows whose 1.2-em line boxes overlap by 3 px).

## Summary, by severity

### Broken (all fixed)

1. **The game's font was missing on every stock install** (Windows-only in practice: the developer's Linux / Mac
   installs have the decompiled source tree). Forgotten Futurist was read from
   `Customization/DistantWorldsExpanded-main/.../Resources/Forgotte.ttf`, which players do not have (the original
   embeds it in DistantWorlds.exe), so every window fell back to Arial: about 45 % wider (average advance 0.558 em
   vs 0.383 em), hence the "jumbled" Options, wizard and screens. Fixed: the font (Ray Larabie freeware) is bundled in
   `public/fonts/forgotten-futurist/` and shipped in `dist/fonts/` (the packaged app did not ship `public/fonts/` at
   all, so the Source Serif map labels fell back too). Before / after on Windows, all screens: overflow 538 → 105, overlap 120 → 73.
2. **Pictures missing on stock installs**: the wizard's Playstyle buttons, timeline and page pictures, the system-map
   zoom buttons, the game-menu header and the expansion planner picture came from the decompiled Main.resx /
   Start.resx. Fixed: the 22 pictures the UI uses are bundled unmodified in `public/art/original-resx/` (publisher's
   permission), the install's resx stays a fallback.
3. **New games did not start** (all platforms, regression after 0.1.29): the sim worker / sim process died with
   "Cannot access 'ORBITAL_SUPERIORITY_FLAG' before initialization" (an import cycle through the Orbital superiority
   add-on). Fixed (flag in a leaf module); the laptop's packaged build starts games again.
4. **Blank map after a GPU reset** (player report: map vanished when switching menus until save + load). After a
   GPU-process crash Chromium may block WebGL for the page's origin and never restore the context. Fixed:
   `app.disableDomainBlockingFor3DAPIs()`, a restore nudge 3 s after a loss, and after 8 s still lost the view is
   rebuilt from the current game (the load path: new canvas and renderer, no page reload; multiplayer gets a notice).
   GPU-process deaths and context losses are logged in crash-log.txt with the memory sample. Verified on the laptop:
   `loseContext()` with `restoreContext` disabled → map blank at 6 s, rebuilt by 8-10 s, same lit-pixel count as
   before (10105), game state intact.
5. **Fullscreen** ("I can't go full screen?"): F11 worked only where F11 is not a laptop media key, and Ctrl+F never
   worked (`input.controlKey` does not exist). Fixed: Game Options → Display Settings → Fullscreen (remembered in
   config.json), F11 / Alt+Enter / Ctrl+F. Not testable on the laptop (no display in the SSH session: the window
   cannot change state there).
6. **Local model window** (all platforms): its Test / Apply buttons were 40 px below the window. Fixed (taller window).

### Ugly (fixed)

- Wizard galaxy-shape description clipped (37 px on Jump Start, 18 px on The Galaxy): GDI line spacing (1.04 em)
  and room down to the Star Amount bar.
- Research screen: the 4-line instructions ran into the industry tabs (197 x 13 px overlap): 15 px lines in the
  original's 800 x 60 box.
- Improvements window: three-line descriptions clipped by 6 px: taller rows.
- Diplomacy list: a dark empire colour (e.g. rgb(85, 85, 11)) got the original's white 1 px drop shadow, which reads as
  a white box behind the name (the selection panel had the same fix on Linux earlier): lifted colour, black shadow
  (`readableTextColors`, shared).
- Text selection / form controls: double-clicking panel text (now also used to open the selection's screen) painted
  the browser's selection highlight, and unstyled controls used Chromium's light defaults: `user-select: none` for game
  text (inputs excepted), a dark `::selection`, `color-scheme: dark`.
- Without WebGL (Pixi's Canvas fallback, `?renderer=canvas`): orbit rings were drawn 1.2 x zoom-factor px wide and
  washed the whole system view out (mean brightness 18 vs 2 with WebGL): plain circles on the Canvas path.

### Minor (left as they are)

- Column headers with an ellipsis (Ships and Bases, Construction Yards, Troops, Colonies, Designs): fixed-width
  columns as in the original, full text in the tooltip.
- Hot-key descriptions and Bacon Mod Settings descriptions are clamped (ellipsis / 3 lines) with the full text in the
  tooltip.
- The wizard's help line is capped at two lines, as the original's lblHelpDescription (MaximumSize 32 px; tooltip).
- Track bars: the bold caption ("Expansion") and the first tick label touch, which is the original LabelledTrackBar
  geometry (caption centred in LabelWidth, first label centred on the first tick).
- Credits: the scrolling credits roll moves lines through and out of its window by design (counted as "outside").
- Galactopedia: switching topics aborts the pending Help/*.mht requests (logged as failed requests, harmless).
- `BaconSettings.txt` 404 on stock installs (expected; see below).

### Not reproduced

- **"White backgrounds behind text" on Windows** (selection panel, Diplomacy): in the SSH session no text element had
  a light background, and the only white shadow found was the Diplomacy dark-name case fixed above; double-click
  selection was also blocked already on that screen. If it persists in the next build, a screenshot from the player
  would show which of the two it is.
- **"Planets and ships missing shaders"**: the session got WebGL2 (Intel UHD, D3D11). The player has an RTX 5080 with
  an Intel CPU (likely a hybrid system): the app now asks for the high-performance GPU (`force_high_performance_gpu`),
  ignores Chromium's GPU blocklist on Windows (`ignore-gpu-blocklist`, ANGLE D3D11), writes the adapter, driver and
  WebGL renderer to gpu-log.txt / the log, and Game Options shows one line ("Graphics: NVIDIA GeForce RTX 5080
  (D3D11)" or "Running without WebGL ..."), so the next report can say which path the player got.

## Other checks

- **GPU memory on screen switches**: every toolbar screen opened and closed 20 times (Linux, dev build): Pixi
  managed textures 35 → 35 (38.7 MB), canvases 2 → 2, DOM nodes 686 → 686, JS heap flat. No leak found.
- **Selection panel** with a colony, a ship, a star and a foreign colony selected: no measured issue on Windows or
  Linux (no fleet exists at game start, so the fleet case was not captured).

## BaconSettings.txt: defaults vs the user's file (report only, no change)

Stock installs have no BaconSettings.txt, so the game uses the C# defaults (`defaultBaconSettings()`); the
developer's install (and so every pinned test) uses its own file. 46 of the 87 settings differ, i.e. players without
the file play a noticeably different game (e.g. no asteroid colonies, no infrastructure improvements, 10x lower spy base value, lower trade tax, harsher no-fuel speeds, no custom-difficulty multipliers). For the user to decide whether to
ship the file's values as defaults:

| Setting | C# default | user's file |
|---|---|---|
| hyperJumpThreshhold | 12000 | 4000 |
| baseHyperJumpAccuracy | 3000 | 666 |
| troopGarrisonMinimumPerColony | null | 20 |
| useStarGravityWells | true | false |
| sublightFuelBurnDivisor | 1 | 20 |
| fighterRangeMultiple | 1 | 30 |
| ammoExhaustChanceMissile | 0.20000000298023224 | 0.25 |
| fighterBuildCost | 0 | 6 |
| fighterBuildSpeedDivisor | 2 | 40 |
| shadow | true | false |
| researchPerLab | 0 | 1000 |
| fighterOnBomberDamageMultiplier | 1 | 3 |
| backgroundStarsAtZoomLevel | 300 | 600 |
| allowAsteroidColonies | false | true |
| asteroidColonyCost | 50000 | 35000 |
| scientificDataForRuins | 90 | 240 |
| tradeEverything | false | true |
| shipMaintenanceCostPerSizeUnit | 1 | 2 |
| shipMarkupFactor | 5 | 9 |
| lowIndependentLifeValue | 150 | 20 |
| spyBaseEscapeChance | 0.02 | 0.019999999552965164 |
| spyBaseDefectChance | 0.02 | 0.019999999552965164 |
| spyBaseValue | 25000 | 250000 |
| tradeTax | 0.1 | 0.3 |
| weaponRangeMultiplierForBases | 1 | 2 |
| allowInfrastructureImprovements | false | true |
| infrastructureSpendingPerDevelopmentLevel | 50000 | 25000 |
| marketPriceUpdateChance | 1 | 0.25 |
| maximumResourceLevelToStockAtBaseNotAtColony | 50 | 100 |
| noFuelCruiseSpeedMultiplier | 0.33000001311302185 | 0.8999999761581421 |
| noFuelTopSpeedMultiplier | 0.33000001311302185 | 0.8999999761581421 |
| noFuelHyperSpeedMultiplier | 0.33000001311302185 | 0.5 |
| privateBuildCostToStateMoney | 1 | 0.3 |
| addSalesTax | true | false |
| quartersOfCashAvailable | 4 | 20 |
| pirateBaseTroops | 7 | 5 |
| pirateCriminalNetworkTroops | 18 | 20 |
| pirateMaxPopulationInfluence | 1500000000 | 45000000000 |
| customDifficultyColonyCorruptionFactor | 1 | 1.3 |
| customDifficultyWarWearinessFactor | 1 | 1.25 |
| customDifficultyResearchRate | 1 | 1.25 |
| customDifficultyPopulationGrowthRate | 1 | 1.2 |
| customDifficultyMiningRate | 1 | 1.3 |
| customDifficultyTargettingFactor | 1 | 1.5 |
| customDifficultyCountermeasuresFactor | 1 | 1.5 |
| customDifficultyColonyShipBuildSpeedRate | 1 | 1.5 |

# Per screen

## Main menu

### menu-data-id-changeTheme

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-menu-data-id-changeTheme.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-menu-data-id-changeTheme.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-menu-data-id-changeTheme.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### menu-data-id-loadGame

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-menu-data-id-loadGame.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-menu-data-id-loadGame.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-menu-data-id-loadGame.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| console: http 404 dwu://app/assets/dwu/__dwu_probe | `` | minor | Windows only |
| console: http 404 dwu://app/assets/dwu/BaconSettings.txt | `` | minor | Windows only |

### menu-data-id-multiplayer

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-menu-data-id-multiplayer.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-menu-data-id-multiplayer.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-menu-data-id-multiplayer.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### menu-data-id-options

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-menu-data-id-options.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-menu-data-id-options.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-menu-data-id-options.png` (Linux).  
Overflow / overlap / outside: before **4 / 4 / 0**, after **0 / 3 / 0**, Linux 0 / 3 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| boxes overlap 25x15 px | `select.ow-input.ow-select "(Custom) Defa / div.ow-text.go-label "Colonization"` | ugly | all platforms |
| boxes overlap 62x18 px | `button.ow-glass.go-button "Reset Warning / div.ow-text.go-label "Colonization"` | ugly | all platforms |
| boxes overlap 62x9 px | `button.ow-glass.go-button "Reset Warning / div.ow-text.go-label "Ship Building"` | ugly | all platforms |

### menu-data-id-tutorials

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-menu-data-id-tutorials.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-menu-data-id-tutorials.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-menu-data-id-tutorials.png` (Linux).  
Overflow / overlap / outside: before **11 / 0 / 0**, after **11 / 0 / 0**, Linux 11 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (199x0 px) | `div.ow-text.ow-shadow "Welcome · Introduction · The Galaxy · Mo"` | minor | all platforms |
| text clipped with ellipsis (105x0 px) | `div.ow-text.ow-shadow "Welcome · Introduction · Galaxy Map · Ga"` | minor | all platforms |
| text clipped with ellipsis (119x0 px) | `div.ow-text.ow-shadow "Welcome · Ships and Bases · Ships and Ba"` | minor | all platforms |
| text clipped with ellipsis (181x0 px) | `div.ow-text.ow-shadow "Welcome · Research · Research Stations ·"` | minor | all platforms |
| text clipped with ellipsis (66x0 px) | `div.ow-text.ow-shadow "Welcome · Fleets · Fleets - Assigning Sh"` | minor | all platforms |
| text clipped with ellipsis (118x0 px) | `div.ow-text.ow-shadow "Welcome · Pirates · Pirates - Putting Th"` | minor | all platforms |
| text clipped with ellipsis (37x0 px) | `div.ow-text.ow-shadow "Welcome · Pirates are different · Pirate"` | minor | all platforms |
| text clipped with ellipsis (163x0 px) | `div.ow-text.ow-shadow "Welcome · PreWarp Empire · Exploring You"` | minor | all platforms |
| … 3 more of the same kinds | | | |

### menu-main

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-menu-main.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-menu-main.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-menu-main.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### menu-main-menu-main-menu-corner-nth-0

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-menu-main-menu-main-menu-corner-nth-0.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-menu-main-menu-main-menu-corner-nth-0.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-menu-main-menu-main-menu-corner-nth-0.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| console: http 404 dwu://app/assets/dwu/BaconSettings.txt | `` | minor | Windows only |
| console: http 404 dwu://app/assets/dwu/Help/GameInfo_Default.mht | `` | minor | Windows only |

### menu-main-menu-main-menu-corner-nth-1

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-menu-main-menu-main-menu-corner-nth-1.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-menu-main-menu-main-menu-corner-nth-1.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-menu-main-menu-main-menu-corner-nth-1.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### menu-main-menu-main-menu-corner-nth-2

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-menu-main-menu-main-menu-corner-nth-2.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-menu-main-menu-main-menu-corner-nth-2.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-menu-main-menu-main-menu-corner-nth-2.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 23**, after **0 / 0 / 22**, Linux 0 / 0 / 23.

| What | Where | Severity | Platforms |
|---|---|---|---|
| outside its window by 7 px | `div.credits-line "ELLIOT GIBBS"` | broken | Windows only |
| outside its window by 51 px | `div.credits-line "Art Designer"` | broken | Windows only |
| outside its window by 75 px | `div.credits-line "JASON BARISH"` | broken | Windows only |
| outside its window by 119 px | `div.credits-line "Additional Artwork"` | broken | Windows only |
| outside its window by 144 px | `div.credits-line "RICHARD EVANS"` | broken | Windows only |
| outside its window by 168 px | `div.credits-line "PETR JACH"` | broken | Windows only |
| outside its window by 192 px | `div.credits-line "MARTIN WOOD"` | broken | Windows only |
| outside its window by 216 px | `div.credits-line "MARC VON MARTIAL"` | broken | Windows only |
| … 14 more of the same kinds | | | |


## New Game wizard

### wizard-01-playstyle-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-01-playstyle-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-01-playstyle-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-01-playstyle-1366x768.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-01-playstyle-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-01-playstyle-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-01-playstyle-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-01-playstyle-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-02-jumpstart-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-02-jumpstart-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-02-jumpstart-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-02-jumpstart-1366x768.png` (Linux).  
Overflow / overlap / outside: before **2 / 0 / 0**, after **1 / 0 / 0**, Linux 1 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped (0x33 px) | `div.ow-text.wizard-help-desc "You are a standard empire in the Classic` | ugly | all platforms |

### wizard-02-jumpstart-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-02-jumpstart-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-02-jumpstart-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-02-jumpstart-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **2 / 0 / 0**, after **1 / 0 / 0**, Linux 1 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped (0x33 px) | `div.ow-text.wizard-help-desc "You are a standard empire in the Classic` | ugly | all platforms |

### wizard-03-jumpstart-pirate-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-03-jumpstart-pirate-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-03-jumpstart-pirate-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-03-jumpstart-pirate-1366x768.png` (Linux).  
Overflow / overlap / outside: before **2 / 0 / 0**, after **1 / 0 / 0**, Linux 1 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped (0x65 px) | `div.ow-text.wizard-help-desc "You are a pirate faction in the Age of S` | ugly | all platforms |

### wizard-03-jumpstart-pirate-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-03-jumpstart-pirate-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-03-jumpstart-pirate-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-03-jumpstart-pirate-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **2 / 0 / 0**, after **1 / 0 / 0**, Linux 1 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped (0x65 px) | `div.ow-text.wizard-help-desc "You are a pirate faction in the Age of S` | ugly | all platforms |

### wizard-04-galaxy-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-04-galaxy-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-04-galaxy-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-04-galaxy-1366x768.png` (Linux).  
Overflow / overlap / outside: before **9 / 1 / 0**, after **0 / 1 / 0**, Linux 0 / 1 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| boxes overlap 9x10 px | `div.owc-trackbar-caption "Expansion" / div.owc-trackbar-label "Pre-Warp"` | ugly | all platforms |

### wizard-04-galaxy-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-04-galaxy-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-04-galaxy-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-04-galaxy-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **9 / 2 / 0**, after **0 / 1 / 0**, Linux 0 / 1 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| boxes overlap 13x14 px | `div.owc-trackbar-caption "Expansion" / div.owc-trackbar-label "Pre-Warp"` | ugly | all platforms |

### wizard-06-colonization-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-06-colonization-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-06-colonization-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-06-colonization-1366x768.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-06-colonization-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-06-colonization-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-06-colonization-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-06-colonization-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **0 / 3 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-07-race-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-07-race-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-07-race-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-07-race-1366x768.png` (Linux).  
Overflow / overlap / outside: before **1 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-07-race-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-07-race-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-07-race-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-07-race-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **1 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-08-empire-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-08-empire-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-08-empire-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-08-empire-1366x768.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-08-empire-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-08-empire-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-08-empire-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-08-empire-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-09-empire-pirate-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-09-empire-pirate-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-09-empire-pirate-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-09-empire-pirate-1366x768.png` (Linux).  
Overflow / overlap / outside: before **0 / 1 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-09-empire-pirate-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-09-empire-pirate-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-09-empire-pirate-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-09-empire-pirate-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **0 / 1 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-10-other-empires-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-10-other-empires-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-10-other-empires-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-10-other-empires-1366x768.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-10-other-empires-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-10-other-empires-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-10-other-empires-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-10-other-empires-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-11-victory-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-11-victory-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-11-victory-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-11-victory-1366x768.png` (Linux).  
Overflow / overlap / outside: before **1 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-11-victory-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-11-victory-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-11-victory-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-11-victory-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **1 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-12-scenario-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-12-scenario-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-12-scenario-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-12-scenario-1366x768.png` (Linux).  
Overflow / overlap / outside: before **3 / 1 / 0**, after **2 / 0 / 0**, Linux 2 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (167x0 px) | `div.wizard-addon-desc "The hidden end-game threats (cult, hive,"` | minor | all platforms |
| text clipped with ellipsis (1055x0 px) | `div.wizard-addon-desc "Overwrites the game's own enslavement. T"` | minor | all platforms |

### wizard-12-scenario-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-12-scenario-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-12-scenario-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-12-scenario-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **3 / 1 / 0**, after **2 / 0 / 0**, Linux 2 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (167x0 px) | `div.wizard-addon-desc "The hidden end-game threats (cult, hive,"` | minor | all platforms |
| text clipped with ellipsis (1055x0 px) | `div.wizard-addon-desc "Overwrites the game's own enslavement. T"` | minor | all platforms |

### wizard-13-scenario-addons-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-13-scenario-addons-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-13-scenario-addons-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-13-scenario-addons-1366x768.png` (Linux).  
Overflow / overlap / outside: before **3 / 1 / 0**, after **2 / 0 / 0**, Linux 2 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (167x0 px) | `div.wizard-addon-desc "The hidden end-game threats (cult, hive,"` | minor | all platforms |
| text clipped with ellipsis (1055x0 px) | `div.wizard-addon-desc "Overwrites the game's own enslavement. T"` | minor | all platforms |

### wizard-13-scenario-addons-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-13-scenario-addons-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-13-scenario-addons-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-13-scenario-addons-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **3 / 1 / 0**, after **2 / 0 / 0**, Linux 2 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (167x0 px) | `div.wizard-addon-desc "The hidden end-game threats (cult, hive,"` | minor | all platforms |
| text clipped with ellipsis (1055x0 px) | `div.wizard-addon-desc "Overwrites the game's own enslavement. T"` | minor | all platforms |

### wizard-14-start-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-14-start-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-14-start-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-14-start-1366x768.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### wizard-14-start-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-wizard-14-start-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-wizard-14-start-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-wizard-14-start-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.


## In-game HUD and selection panel

### game-hud

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-game-hud.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-game-hud.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-game-hud.png` (Linux).  
Overflow / overlap / outside: before **1 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| console: http 404 dwu://app/assets/dwu/__dwu_probe | `` | minor | Windows only |
| console: http 404 dwu://app/assets/dwu/BaconSettings.txt | `` | minor | Windows only |

### game-select-colony

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-game-select-colony.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-game-select-colony.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-game-select-colony.png` (Linux).  
Overflow / overlap / outside: before **—**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### game-select-foreign

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-game-select-foreign.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-game-select-foreign.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-game-select-foreign.png` (Linux).  
Overflow / overlap / outside: before **—**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### game-select-ship

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-game-select-ship.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-game-select-ship.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-game-select-ship.png` (Linux).  
Overflow / overlap / outside: before **—**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### game-select-star

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-game-select-star.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-game-select-star.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-game-select-star.png` (Linux).  
Overflow / overlap / outside: before **—**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.


## Toolbar / F-key screens

### screen-btnBuildOrder

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-btnBuildOrder.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-btnBuildOrder.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-btnBuildOrder.png` (Linux).  
Overflow / overlap / outside: before **7 / 2 / 0**, after **0 / 0 / 0**, Linux 0 / 1 / 0.

No measured issues after the fixes.

### screen-btnEmpireGraphs

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-btnEmpireGraphs.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-btnEmpireGraphs.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-btnEmpireGraphs.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### screen-btnEmpirePolicy

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-btnEmpirePolicy.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-btnEmpirePolicy.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-btnEmpirePolicy.png` (Linux).  
Overflow / overlap / outside: before **6 / 0 / 0**, after **1 / 0 / 0**, Linux 0 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped (14x0 px) | `div.ow-grid-cell.ow-align-left "Diplomacy - War and Trade Sanctions"` | ugly | Windows only |

### screen-btnEmpireSummary

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-btnEmpireSummary.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-btnEmpireSummary.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-btnEmpireSummary.png` (Linux).  
Overflow / overlap / outside: before **0 / 8 / 5**, after **0 / 1 / 0**, Linux 0 / 1 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| boxes overlap 112x3 px | `a.ow-link.es-tradeflows "Where does the  / a.ow-link.es-supply "Supply by resource ` | minor | Windows only |

### screen-btnExpansionPlanner

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-btnExpansionPlanner.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-btnExpansionPlanner.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-btnExpansionPlanner.png` (Linux).  
Overflow / overlap / outside: before **28 / 1 / 0**, after **1 / 1 / 0**, Linux 1 / 1 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (5x0 px) | `div.ow-grid-hcell.ow-align-right "Quality"` | minor | all platforms |
| boxes overlap 9x15 px | `input.ow-input.ow-textbox "0" / div.ow-text.ow-shadow "Filter by"` | ugly | all platforms |

### screen-btnGalacticHistory

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-btnGalacticHistory.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-btnGalacticHistory.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-btnGalacticHistory.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### screen-btnGameEditor

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-btnGameEditor.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-btnGameEditor.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-btnGameEditor.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### screen-btnHistoryMessages

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-btnHistoryMessages.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-btnHistoryMessages.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-btnHistoryMessages.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### screen-lstMessages

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-lstMessages.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-lstMessages.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-lstMessages.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### screen-tbtnBuiltObjects

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-tbtnBuiltObjects.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-tbtnBuiltObjects.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-tbtnBuiltObjects.png` (Linux).  
Overflow / overlap / outside: before **55 / 0 / 0**, after **17 / 0 / 0**, Linux 14 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (15x0 px) | `div.ow-grid-hcell.ow-align-center "Empire"` | minor | all platforms |
| text clipped with ellipsis (23x0 px) | `div.ow-grid-hcell.ow-align-right "Firepower"` | minor | all platforms |
| text clipped with ellipsis (6x0 px) | `div.ow-grid-hcell.ow-align-right "Speed"` | minor | all platforms |
| text clipped with ellipsis (46x0 px) | `div.ow-grid-hcell.ow-align-right "Maintenance Cost"` | minor | all platforms |
| text clipped with ellipsis (5x0 px) | `div.ow-grid-hcell.ow-align-center "Automated"` | minor | all platforms |
| text clipped (31x0 px) | `div.ow-grid-cell.ow-align-left "Base, Energy Research Station"` | ugly | all platforms |
| text clipped (15x0 px) | `div.ow-grid-cell.ow-align-left "Exploration, Exploration Ship"` | ugly | all platforms |
| text clipped (7x0 px) | `div.ow-grid-cell.ow-align-left "Resource, Gas Mining Ship"` | ugly | Windows only |
| … 9 more of the same kinds | | | |

### screen-tbtnColonies

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-tbtnColonies.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-tbtnColonies.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-tbtnColonies.png` (Linux).  
Overflow / overlap / outside: before **14 / 0 / 0**, after **3 / 0 / 0**, Linux 3 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (20x0 px) | `div.ow-grid-hcell.ow-align-center "Facilities"` | minor | all platforms |
| text clipped with ellipsis (6x0 px) | `div.ow-grid-hcell.ow-align-right "Quality"` | minor | all platforms |
| text clipped with ellipsis (15x0 px) | `div.ow-grid-hcell.ow-align-right "Culture"` | minor | all platforms |

### screen-tbtnConstructionYards

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-tbtnConstructionYards.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-tbtnConstructionYards.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-tbtnConstructionYards.png` (Linux).  
Overflow / overlap / outside: before **24 / 1 / 0**, after **11 / 0 / 0**, Linux 11 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (7x0 px) | `div.ow-grid-hcell.ow-align-right "Progress"` | minor | all platforms |
| text clipped with ellipsis (4x0 px) | `button.ow-tab "Cargo (23)"` | minor | all platforms |
| text clipped with ellipsis (4x0 px) | `button.ow-tab "Components"` | minor | all platforms |
| text clipped with ellipsis (7x0 px) | `button.ow-tab.ow-tab-on "Construction Yards"` | minor | all platforms |
| text clipped with ellipsis (5x0 px) | `button.ow-tab "Docking Bays"` | minor | all platforms |
| text clipped with ellipsis (8x0 px) | `button.ow-tab "Troops & Characters"` | minor | all platforms |
| text clipped with ellipsis (5x0 px) | `button.ow-tab "Weapons (38)"` | minor | all platforms |
| text clipped with ellipsis (4x0 px) | `button.ow-tab "Fleet Builds"` | minor | all platforms |
| … 3 more of the same kinds | | | |

### screen-tbtnDesigns

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-tbtnDesigns.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-tbtnDesigns.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-tbtnDesigns.png` (Linux).  
Overflow / overlap / outside: before **61 / 1 / 0**, after **2 / 0 / 0**, Linux 2 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (12x0 px) | `div.ow-grid-hcell.ow-align-center "Obsolete"` | minor | all platforms |
| text clipped with ellipsis (22x0 px) | `span.ow-glass-text "Auto Upgrade Selected Designs"` | minor | all platforms |

### screen-tbtnEmpires

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-tbtnEmpires.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-tbtnEmpires.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-tbtnEmpires.png` (Linux).  
Overflow / overlap / outside: before **0 / 27 / 2**, after **0 / 29 / 0**, Linux 0 / 29 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| boxes overlap 32x3 px | `div.ow-text.ow-shadow "Capital" / div.ow-text.ow-shadow "Government"` | minor | Windows only |
| boxes overlap 116x3 px | `div.ow-text.ow-shadow "Aldiraan 2 (Aldir / div.ow-text.ow-shadow "Military Dictator` | minor | Windows only |
| boxes overlap 53x3 px | `div.ow-text.ow-shadow "Government" / div.ow-text.ow-shadow "Reputation"` | minor | Windows only |
| boxes overlap 70x3 px | `div.ow-text.ow-shadow "Military Dictator / div.ow-text.ow-shadow "Satisfactory"` | minor | Windows only |
| boxes overlap 43x3 px | `div.ow-text.ow-shadow "Reputation" / div.ow-text.ow-shadow "Colonies"` | minor | Windows only |
| boxes overlap 4x3 px | `div.ow-text.ow-shadow "Satisfactory" / div.ow-text.ow-shadow "1"` | minor | all platforms |
| boxes overlap 43x3 px | `div.ow-text.ow-shadow "Colonies" / div.ow-text.ow-shadow "Population"` | minor | Windows only |
| boxes overlap 4x3 px | `div.ow-text.ow-shadow "1" / div.ow-text.ow-shadow "10,793M"` | minor | all platforms |
| … 21 more of the same kinds | | | |

### screen-tbtnIntelligenceAgents

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-tbtnIntelligenceAgents.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-tbtnIntelligenceAgents.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-tbtnIntelligenceAgents.png` (Linux).  
Overflow / overlap / outside: before **2 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### screen-tbtnResearch

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-tbtnResearch.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-tbtnResearch.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-tbtnResearch.png` (Linux).  
Overflow / overlap / outside: before **32 / 4 / 0**, after **0 / 0 / 0**, Linux 2 / 0 / 0.

No measured issues after the fixes.

### screen-tbtnShipGroups

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-tbtnShipGroups.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-tbtnShipGroups.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-tbtnShipGroups.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### screen-tbtnTroops

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-screen-tbtnTroops.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-screen-tbtnTroops.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-screen-tbtnTroops.png` (Linux).  
Overflow / overlap / outside: before **19 / 0 / 0**, after **8 / 0 / 0**, Linux 3 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (11x0 px) | `div.ow-grid-hcell.ow-align-right "Readiness"` | minor | all platforms |
| text clipped with ellipsis (35x0 px) | `div.ow-grid-hcell.ow-align-right "Attack Strength"` | minor | all platforms |
| text clipped with ellipsis (40x0 px) | `div.ow-grid-hcell.ow-align-right "Defend Strength"` | minor | all platforms |
| text clipped (7x0 px) | `div.ow-grid-cell.ow-align-left "2nd Strike Trooper Battalion"` | ugly | Windows only |
| text clipped (5x0 px) | `div.ow-grid-cell.ow-align-left "3rd Strike Trooper Battalion"` | ugly | Windows only |
| text clipped (3x0 px) | `div.ow-grid-cell.ow-align-left "4th Strike Trooper Battalion"` | ugly | Windows only |
| text clipped (4x0 px) | `div.ow-grid-cell.ow-align-left "5th Strike Trooper Battalion"` | ugly | Windows only |
| text clipped (4x0 px) | `div.ow-grid-cell.ow-align-left "6th Strike Trooper Battalion"` | ugly | Windows only |
| … 0 more of the same kinds | | | |


## F-keys

### key-F1

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-key-F1.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-key-F1.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-key-F1.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| console: http 404 dwu://app/assets/dwu/BaconSettings.txt | `` | minor | Windows only |

### key-F10

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-key-F10.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-key-F10.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-key-F10.png` (Linux).  
Overflow / overlap / outside: before **24 / 1 / 0**, after **11 / 0 / 0**, Linux 11 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (7x0 px) | `div.ow-grid-hcell.ow-align-right "Progress"` | minor | all platforms |
| text clipped with ellipsis (4x0 px) | `button.ow-tab "Cargo (23)"` | minor | all platforms |
| text clipped with ellipsis (4x0 px) | `button.ow-tab "Components"` | minor | all platforms |
| text clipped with ellipsis (7x0 px) | `button.ow-tab.ow-tab-on "Construction Yards"` | minor | all platforms |
| text clipped with ellipsis (5x0 px) | `button.ow-tab "Docking Bays"` | minor | all platforms |
| text clipped with ellipsis (8x0 px) | `button.ow-tab "Troops & Characters"` | minor | all platforms |
| text clipped with ellipsis (5x0 px) | `button.ow-tab "Weapons (38)"` | minor | all platforms |
| text clipped with ellipsis (4x0 px) | `button.ow-tab "Fleet Builds"` | minor | all platforms |
| … 3 more of the same kinds | | | |

### key-F12

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-key-F12.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-key-F12.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-key-F12.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### key-F2

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-key-F2.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-key-F2.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-key-F2.png` (Linux).  
Overflow / overlap / outside: before **14 / 0 / 0**, after **3 / 0 / 0**, Linux 3 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (20x0 px) | `div.ow-grid-hcell.ow-align-center "Facilities"` | minor | all platforms |
| text clipped with ellipsis (6x0 px) | `div.ow-grid-hcell.ow-align-right "Quality"` | minor | all platforms |
| text clipped with ellipsis (15x0 px) | `div.ow-grid-hcell.ow-align-right "Culture"` | minor | all platforms |

### key-F3

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-key-F3.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-key-F3.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-key-F3.png` (Linux).  
Overflow / overlap / outside: before **28 / 1 / 0**, after **1 / 1 / 0**, Linux 1 / 1 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (5x0 px) | `div.ow-grid-hcell.ow-align-right "Quality"` | minor | all platforms |
| boxes overlap 9x15 px | `input.ow-input.ow-textbox "0" / div.ow-text.ow-shadow "Filter by"` | ugly | all platforms |

### key-F4

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-key-F4.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-key-F4.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-key-F4.png` (Linux).  
Overflow / overlap / outside: before **2 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### key-F5

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-key-F5.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-key-F5.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-key-F5.png` (Linux).  
Overflow / overlap / outside: before **0 / 27 / 2**, after **0 / 29 / 0**, Linux 0 / 29 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| boxes overlap 32x3 px | `div.ow-text.ow-shadow "Capital" / div.ow-text.ow-shadow "Government"` | minor | Windows only |
| boxes overlap 116x3 px | `div.ow-text.ow-shadow "Aldiraan 2 (Aldir / div.ow-text.ow-shadow "Military Dictator` | minor | Windows only |
| boxes overlap 53x3 px | `div.ow-text.ow-shadow "Government" / div.ow-text.ow-shadow "Reputation"` | minor | Windows only |
| boxes overlap 70x3 px | `div.ow-text.ow-shadow "Military Dictator / div.ow-text.ow-shadow "Satisfactory"` | minor | Windows only |
| boxes overlap 43x3 px | `div.ow-text.ow-shadow "Reputation" / div.ow-text.ow-shadow "Colonies"` | minor | Windows only |
| boxes overlap 4x3 px | `div.ow-text.ow-shadow "Satisfactory" / div.ow-text.ow-shadow "1"` | minor | all platforms |
| boxes overlap 43x3 px | `div.ow-text.ow-shadow "Colonies" / div.ow-text.ow-shadow "Population"` | minor | Windows only |
| boxes overlap 4x3 px | `div.ow-text.ow-shadow "1" / div.ow-text.ow-shadow "10,793M"` | minor | all platforms |
| … 21 more of the same kinds | | | |

### key-F6

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-key-F6.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-key-F6.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-key-F6.png` (Linux).  
Overflow / overlap / outside: before **0 / 8 / 5**, after **0 / 1 / 0**, Linux 0 / 1 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| boxes overlap 112x3 px | `a.ow-link.es-tradeflows "Where does the  / a.ow-link.es-supply "Supply by resource ` | minor | Windows only |

### key-F7

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-key-F7.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-key-F7.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-key-F7.png` (Linux).  
Overflow / overlap / outside: before **32 / 4 / 0**, after **0 / 0 / 0**, Linux 2 / 0 / 0.

No measured issues after the fixes.

### key-F8

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-key-F8.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-key-F8.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-key-F8.png` (Linux).  
Overflow / overlap / outside: before **61 / 1 / 0**, after **2 / 0 / 0**, Linux 2 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (12x0 px) | `div.ow-grid-hcell.ow-align-center "Obsolete"` | minor | all platforms |
| text clipped with ellipsis (22x0 px) | `span.ow-glass-text "Auto Upgrade Selected Designs"` | minor | all platforms |

### key-F9

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-key-F9.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-key-F9.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-key-F9.png` (Linux).  
Overflow / overlap / outside: before **7 / 2 / 0**, after **0 / 0 / 0**, Linux 0 / 1 / 0.

No measured issues after the fixes.


## Game Options and sub-windows

### options-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-1366x768.png` (Linux).  
Overflow / overlap / outside: before **4 / 4 / 0**, after **0 / 3 / 0**, Linux 0 / 3 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| boxes overlap 18x10 px | `select.ow-input.ow-select "(Custom) Defa / div.ow-text.go-label "Colonization"` | ugly | all platforms |
| boxes overlap 44x13 px | `button.ow-glass.go-button "Reset Warning / div.ow-text.go-label "Colonization"` | ugly | all platforms |
| boxes overlap 44x6 px | `button.ow-glass.go-button "Reset Warning / div.ow-text.go-label "Ship Building"` | ugly | all platforms |

### options-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **4 / 4 / 0**, after **0 / 3 / 0**, Linux 0 / 3 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| boxes overlap 25x15 px | `select.ow-input.ow-select "(Custom) Defa / div.ow-text.go-label "Colonization"` | ugly | all platforms |
| boxes overlap 62x18 px | `button.ow-glass.go-button "Reset Warning / div.ow-text.go-label "Colonization"` | ugly | all platforms |
| boxes overlap 62x9 px | `button.ow-glass.go-button "Reset Warning / div.ow-text.go-label "Ship Building"` | ugly | all platforms |

### options-sub-advanced-settings--1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-advanced-settings--1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-advanced-settings--1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-advanced-settings--1366x768.png` (Linux).  
Overflow / overlap / outside: before **0 / 1 / 4**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### options-sub-advanced-settings--1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-advanced-settings--1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-advanced-settings--1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-advanced-settings--1920x1080.png` (Linux).  
Overflow / overlap / outside: before **0 / 1 / 4**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### options-sub-bacon-mod-settings--1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-bacon-mod-settings--1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-bacon-mod-settings--1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-bacon-mod-settings--1366x768.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 5 / 0 / 0.

No measured issues after the fixes.

### options-sub-bacon-mod-settings--1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-bacon-mod-settings--1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-bacon-mod-settings--1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-bacon-mod-settings--1920x1080.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 5 / 0 / 0.

No measured issues after the fixes.

### options-sub-empire-settings-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-empire-settings-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-empire-settings-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-empire-settings-1366x768.png` (Linux).  
Overflow / overlap / outside: before **0 / 3 / 3**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### options-sub-empire-settings-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-empire-settings-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-empire-settings-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-empire-settings-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **0 / 3 / 3**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### options-sub-hotkeys-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-hotkeys-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-hotkeys-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-hotkeys-1366x768.png` (Linux).  
Overflow / overlap / outside: before **25 / 0 / 0**, after **11 / 0 / 0**, Linux 10 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (34x0 px) | `div.hk-desc "Cycles the main view display: everything"` | minor | all platforms |
| text clipped with ellipsis (31x0 px) | `div.hk-desc "Ground Report: the ground invasion statu"` | minor | all platforms |
| text clipped with ellipsis (176x0 px) | `div.hk-desc "Fleet Settings: the selected fleet's pos"` | minor | all platforms |
| text clipped with ellipsis (5x0 px) | `div.hk-desc "Shows or hides the Waypoints & Known Loc"` | minor | Windows only |
| text clipped with ellipsis (95x0 px) | `div.hk-desc "Cycles your Colonies in the selection pa"` | minor | all platforms |
| text clipped with ellipsis (63x0 px) | `div.hk-desc "Cycles your Space Ports in the selection"` | minor | all platforms |
| text clipped with ellipsis (186x0 px) | `div.hk-desc "Cycles the engagement stance of the sele"` | minor | all platforms |

### options-sub-hotkeys-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-hotkeys-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-hotkeys-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-hotkeys-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **25 / 0 / 0**, after **11 / 0 / 0**, Linux 10 / 0 / 0.

| What | Where | Severity | Platforms |
|---|---|---|---|
| text clipped with ellipsis (34x0 px) | `div.hk-desc "Cycles the main view display: everything"` | minor | all platforms |
| text clipped with ellipsis (31x0 px) | `div.hk-desc "Ground Report: the ground invasion statu"` | minor | all platforms |
| text clipped with ellipsis (176x0 px) | `div.hk-desc "Fleet Settings: the selected fleet's pos"` | minor | all platforms |
| text clipped with ellipsis (5x0 px) | `div.hk-desc "Shows or hides the Waypoints & Known Loc"` | minor | Windows only |
| text clipped with ellipsis (95x0 px) | `div.hk-desc "Cycles your Colonies in the selection pa"` | minor | all platforms |
| text clipped with ellipsis (63x0 px) | `div.hk-desc "Cycles your Space Ports in the selection"` | minor | all platforms |
| text clipped with ellipsis (186x0 px) | `div.hk-desc "Cycles the engagement stance of the sele"` | minor | all platforms |

### options-sub-improvements--1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-improvements--1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-improvements--1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-improvements--1366x768.png` (Linux).  
Overflow / overlap / outside: before **2 / 0 / 1**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### options-sub-improvements--1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-improvements--1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-improvements--1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-improvements--1920x1080.png` (Linux).  
Overflow / overlap / outside: before **2 / 0 / 1**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### options-sub-local-model--1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-local-model--1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-local-model--1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-local-model--1366x768.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 5**, after **0 / 0 / 2**, Linux 0 / 0 / 2.

| What | Where | Severity | Platforms |
|---|---|---|---|
| outside its window by 4 px | `button.ow-glass.go-button "Test"` | broken | all platforms |
| outside its window by 4 px | `button.ow-glass.go-button "Apply"` | broken | all platforms |

### options-sub-local-model--1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-local-model--1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-local-model--1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-local-model--1920x1080.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 5**, after **0 / 0 / 2**, Linux 0 / 0 / 2.

| What | Where | Severity | Platforms |
|---|---|---|---|
| outside its window by 6 px | `button.ow-glass.go-button "Test"` | broken | all platforms |
| outside its window by 6 px | `button.ow-glass.go-button "Apply"` | broken | all platforms |

### options-sub-music-mood--1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-music-mood--1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-music-mood--1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-music-mood--1366x768.png` (Linux).  
Overflow / overlap / outside: before **1 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### options-sub-music-mood--1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-music-mood--1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-music-mood--1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-music-mood--1920x1080.png` (Linux).  
Overflow / overlap / outside: before **1 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### options-sub-reset-warnings-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-reset-warnings-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-reset-warnings-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-reset-warnings-1366x768.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### options-sub-reset-warnings-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-reset-warnings-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-reset-warnings-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-reset-warnings-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 0**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### options-sub-show-message-settings-1366x768

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-show-message-settings-1366x768.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-show-message-settings-1366x768.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-show-message-settings-1366x768.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 3**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

### options-sub-show-message-settings-1920x1080

Screenshots: `/home/justinf/data/agent-tmp/winui/win0129b-options-sub-show-message-settings-1920x1080.png` (before), `/home/justinf/data/agent-tmp/winui/win-b3-options-sub-show-message-settings-1920x1080.png` (after), `/home/justinf/data/agent-tmp/winui/linux2-options-sub-show-message-settings-1920x1080.png` (Linux).  
Overflow / overlap / outside: before **0 / 0 / 3**, after **0 / 0 / 0**, Linux 0 / 0 / 0.

No measured issues after the fixes.

