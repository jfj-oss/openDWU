# Playtest 2026-09-25, pass 2: playing as a commander

This is a read-only playtest of branch `wip/playtest2`. The branch was fast-forwarded to
`claude/deepseekharnessworkspace-distant-worlds-dekdzh` at `bd93a53`, which includes 18b diplomat voice, fix4ui and
fix4sim. Nothing in `src/` or `scripts/` was changed. The previous agent left only 7 wizard shots
(`shots/p2-01-wizard-*.png`) and no notes. This pass starts again from scratch.

## Setup

- Dev server: `npx vite --port 5241 --strictPort` from `game/`. `vite.config.ts` now has a per-checkout `cacheDir`
  (`game/.vite`), so the shared-optimizer 504 from pass 1 did not happen. The server stayed up for the whole session.
- Driver: a persistent playwright-core session (`/usr/bin/chromium`, swiftshader, 1920×1080 at DPR 2, so every shot is
  3840×2160), controlled over a local HTTP REPL. It logs every console message, `pageerror`, failed request, HTTP ≥ 400,
  dialog and page crash. The browser did not die, and `/tmp` had 15 GB free.
- Speed: the machine had a loadavg of 17–26 from other agents, so Main View rendered at about **0.7 fps** at 4K. Pixi's
  ticker caps `deltaMS` at 100 ms and `SimDriver.maxFrames` is 4, which gave only about 190 game-ms per real second at
  4x. That would be about 50 minutes per game year. To play a full year I raised `__dwu.app.ticker.minFPS = 0.5` and
  `__dwu.sim.maxFrames = 90` at runtime (debug object only; the scheduler and frame size are unchanged). That gave about
  3,900 game-ms/s. These values match the C# clock: `RealSecondsInGalacticYear = 600`, so 1 day ≈ 1,644 game ms.
- Ollama was running with `qwen3:4b`. The advisor (T) and the diplomat voice (18b) both found the endpoint and used it.
- The game: **seed 1**, default wizard settings (10 AI empires, Expansion "Starting"). Wizard → Start Game (boot 20 s)
  → played **2150.01.01 → 2151.03.13**, which is more than one full game year. Saved at 2150.06.05, returned to the main
  menu, loaded, and played on to 2151.
- **Console:** 0 `pageerror`, 0 `console.error`, 0 HTTP ≥ 400 and no `TODO(port)` throws for the whole session. The
  only console noise:
  - `[info] TODO(key): …` and `[log] TODO(screen): …` for the inert keys and buttons (bug N2, and #12 below);
  - 76 `net::ERR_ABORTED` on the Galactopedia's `Help/*.mht` HEAD probes. These are benign, as in pass 1.
- Screenshots are `game/shots/p2b-*.png` (4K, gitignored, local only). The index is at the end of this report.

Severity levels are **crash** / **wrong data** / **visual** / **polish**.

**Counts, new bugs:** 5 in total: 0 crash, 3 wrong data (1 of them suspected), 1 visual, 1 polish.
**Previous 19 bugs:** 17 fixed, 1 partly fixed (#12), 1 improved but not settled (#16, see N4).

---

## 1. The previous 19 bugs, re-verified

| # | Bug (pass 1) | Status | Evidence |
|---|---|---|---|
| 1 | Null `builtObjects` entry freezes the game (also after load) | **Fixed** | 10–14 null holes were present. I ran at System zoom (Insert) after loading: `nowMs` 257,533 → 388,200 with no pageerror. `p2b-90` |
| 2 | Wizard "Your Race" lists only 3 races | **Fixed** | 20 races listed (Ackdarian … Zenox). `p2b-01-wizard-2` |
| 3 | Default empire name " Empire" | **Fixed** | The default name is now generated at start ("Vun-Alae Territory"). The founding line, Empires list and Victory table use it. `p2b-02` |
| 4 | 42 of 83 wizard flag tiles are broken | **Fixed** | 41 flag tiles, 0 broken (`naturalWidth > 0`). `p2b-01-wizard-3` |
| 5 | Space does not pause | **Fixed** | Space toggles `time.paused` in both directions. |
| 6 | Empires list shows unmet empires | **Fixed** | With only Yosul Hive met, the list shows the player plus Yosul Hive. `p2b-79` |
| 7 | HUD Cashflow / Bonus Income always "—" | **Fixed** | Shows "Cashflow +12,783", "Bonus Income +6,547", and they update. |
| 8 | Menu and Help toast "not yet available" | **Fixed** | ≡ opens the Game Menu and ? opens the Galactopedia. No toast. |
| 9 | `?` overlay in serif, near-invisible text | **Fixed** (font) | Computed font is `"Forgotten Futurist"`, colour white. **New:** Escape does not close it (N1). `p2b-58` |
| 10 | Selection panel runs off the bottom | **Fixed** | Planet: 775–1070 of 1080. Ship: 757–1070. At 125% UI scale: 678–1070. The chips end at 1061. `p2b-95/96/100` |
| 11 | Tooltips show internal control names | **Fixed** | Every top-bar tooltip is readable, e.g. "Open Construction Yards screen (F10)". |
| 12 | Inert hotkeys and top-bar buttons | **Partly fixed** | F3 Expansion Planner, O Game Options, Empire Policy and T advisor now open. Still inert (toast plus `TODO(key)` / `TODO(screen)`): F4 / Intelligence Agents, Game Editor, Troops, Galactic History, and the keys Z N B L E R A S `,`. E/R/A/S are a bug of their own (N2). `p2b-77/78/80/81` |
| 13 | Idle-ship cycle (I) never works | **Fixed** | I cycles "Gallant Smuggler" → "1st Fleet". No "No Idle yet" in the ticker. `p2b-97` |
| 14 | F2 / F11 row click does not select | **Fixed** | F2 row → "Vun-Alae 1". F11 row "Challenger 003" → selected. `p2b-98` |
| 15 | Loading loses Message History | **Fixed** | After load, H lists all 8 entries with their original dates (2150.01.21 … 2150.05.16). `p2b-89` |
| 16 | Explorers never leave home; no contact in 100 days | **Improved** | Explorers now travel (313k–2,913k units out by day 156). 26 systems explored in year 1. First contact came on **2150.05.16** (Yosul Hive), then Sul Hive and Ugnari Industries. But see N4: nobody expands. |
| 17 | UI Scale 125%: top-middle controls overlap | **Fixed** | 0 overlapping top-bar button rectangles at 125%. `p2b-100` |
| 18 | Launch-row buttons and chips use the system font | **Fixed** | Every HUD button computes to `"Forgotten Futurist"`. |
| 19 | Plurals "1 moons", "1 colonies" | **Fixed** | V → Comparison shows "1 colony". `src/ui/plural.ts` is in use. `p2b-101` |

---

## 2. New bugs

### N1. Escape does not close the keyboard-shortcuts overlay (`?`); it opens the Game Menu underneath, which then cannot be clicked — **visual** (input trap)
- **Steps:** press `?`, then press Escape.
- **What happened:** the overlay stays open. The Game Menu opens behind it, and the game is force-paused by the menu.
  Clicking **Resume** fails, because playwright reports `#keyboard-shortcuts-overlay … subtree intercepts pointer events`.
  The player has to know to press `?` again, then click Resume.
- **Expected:** Escape closes the topmost overlay first, as it already does for F2–F12, G, H, V, O, T (all checked this pass).
- **Console:** none.
- **Likely file:** `src/ui/keyboard.ts`. The `createShortcutsOverlay` toggle is not part of the "Escape closes the open
  screen before `gameMenu`" chain.
- **Shot:** `shots/p2b-58-screen-qmark.png`.

### N2. Ship-command hotkeys E / R / A / S / `,` do nothing, although the action buttons advertise them — **wrong data** (control broken)
- **Steps:** select a ship (e.g. M → "Challenger 003"). Its action-bar tooltips read "Stop (S)", "Escape from attackers (E)"
  and "Automate Ship (A)". Press S, E, R, A or `,`.
- **What happened:** the order does not change (mission `5 → 5`). A toast appears, for example "Stops the selected ship,
  cancelling the current mission — not yet available". Console: `[info] TODO(key): stopShip` (also `commandEscape`,
  `commandRefuel`, `automateShip`, `cycleEngagementStance`). Z, N, B and L are also still stubs.
- **Expected:** the original's keyboard table (`keyboard.ts:127-131` descriptions) says these keys run the same
  commands as the buttons. The button path already works: clicking Stop / Refuel / Escape / Automate goes through
  `performAction` → `executeShipAction`.
- **Likely file:** `src/ui/keyboard.ts` (the `commandEscape` / `commandRefuel` / `automateShip` / `stopShip` actions are
  still in the TODO set). Wire them to `performAction(createShipAction(...))` in `src/ui/orderMenu.ts`.

### N3. A research-breakthrough message with more than one benefit is garbled — **wrong data** (text)
- **Steps:** play until "Star Fighters" is researched (2150.06.23 on seed 1). Read the popup or H.
- **What happened:**
  `Our engineers have completed research in Star Fighters. This breakthrough provides the new component 'Standard Fighter Bay, ' for our ships and basesaccess to a new fighter type Standard Fighter, access to a new fighter type Standard Bomber`
  The `, ` separator lands inside the quotes, the space before "access" is lost, and the order is scrambled.
  Single-benefit messages ("… the new component 'Concussion Missile' for our ships and bases") render correctly.
- **Expected:** `Empire.3.cs:2600-2640` formats each part eagerly with `string.Format(TextResolver.GetText(...))`,
  appends `", "`, then wraps the result in "This breakthrough provides {0}" and trims the last 2 characters. The result
  is "…provides the new component 'Standard Fighter Bay' for our ships and bases, access to a new fighter type Standard
  Fighter, access to a new fighter type Standard Bomber".
- **Likely files:** `src/sim/researchTick.ts:699-736`. It concatenates **deferred** `gameText()` tokens
  (`colonyTick.ts:90` encodes `key|arg|…`), nests them inside another `gameText('This breakthrough provides BENEFITS',
  text)`, and then cuts `text2.substring(0, len - 2)` from the *encoded* string. The resolver splits the nested `|`
  wrongly. Resolve the inner parts to text first (or give the resolver nesting support).
- **Shot:** the popup appears in `shots/p2b-91-year-end.png` (top right, earlier frame).

### N4. No empire founds a second colony in the whole first year; colony ships sit in a colony's single slow yard while the space port's 6 yards are idle — **wrong data** (suspected, sim)
- **Evidence (seed 1, 2151.01.10):**
  - All 11 empires, the player included, still have exactly **1 colony**.
  - 10 empire colony ships exist. **All** are under construction at the capital *planet* (`builtAt` is a `Habitat`), not
    at a space port. They are 0–181 days old, with 17 of 44 components built after 181 days (United Draithus
    "Glowing Chance").
  - The player's automation queued "Fading Hope" (CLN-1, 45 components) at Vun-Alae 1. That colony's queue has 1 yard at
    speed 630. Meanwhile the Vun-Alae 1 Medium Space Port has **6 idle yards** and an empty wait queue.
  - The colony's manufacturers finished the 45 queued components in about 20 days, so component supply is not the
    bottleneck. The yard then built about 1 component per 10 days. `processSingleConstructionYard` gives
    `(dt/1000)·(630/1000) / ColonyShipBuildFactor 10` ≈ 0.063 comp/s ≈ 0.1 comp/day, so about **430 days** per colony
    ship.
- **Expected:** the per-yard formula matches `ConstructionQueue.cs:313-318` (`num /= Galaxy.ColonyShipBuildFactor` = 10,
  `Galaxy.3.cs:5086`). The suspect is **where** the colony ship is queued. With a 6-yard space port in the same system,
  the original should not build every empire's first colony ship in the planet's single yard, and "Starting" expansion
  should see first colonies well inside year 1. Sim owners should check the builder choice for colony ships
  (Empire construction / `DetermineBuilder`-style selection) against the C#. Also check
  `colonyConstructionSpeedModifier` (1.0 here) and whether the colony yard should get the population-based bonus
  (`ColonyBuildSpeedIdealPopulation`).
- **Player impact:** expansion never happens. The Expansion Planner (F3) lists Tynna 3 and Onsaun with "Fading Hope"
  assigned, but the ship will not exist for more than a year.
- **Likely files:** `src/sim/construction/empireConstruction.ts` (builder selection for colony ships),
  `src/sim/construction/constructionQueue.ts:337-404`.
- **Shots:** `shots/p2b-91-year-end.png`, `shots/p2b-61-screen-F3.png`.

### N5. At Sector and Galaxy zoom the right-click has no default order and the hover hint is empty — **polish**
- **Steps:** select the 1st Fleet (or an explorer), zoom out past about 0.005 (Delete / End), and hover a system.
- **What happened:** `view.pickOrderTarget` returns the **SystemInfo**, not the system star. `resolveHoverOrder` has
  no branch for it, so the hint line is empty and a plain right-click gives no default order. It only opens the menu.
  The same system at zoom 0.01 (the star picked as a Habitat) gives "Right-click to Patrol Adare system (Ctrl-Right-click
  for more missions...)", and a right-click sends the fleet.
- **Measured:** zoom 0.01 → target `Adare` (fleet hint present). Zoom 0.003 and 0.0005 → `SystemInfo Adare` (fleet hint
  `""`, explorer hint `""`).
- **Expected:** default orders work at every zoom, as they do at 0.01 (I did not check the exact C# hover line; the
  port's `resolveHoverOrder` handles only Habitat, BuiltObject, ShipGroup and empty space).
- **Likely file:** `src/render/mainView.ts` `pickOrderTarget` (return `systemInfo.systemStar`), or a SystemInfo case in
  `src/sim/player/orderMenu.ts resolveHoverOrder`.
- **Related:** for an unexplored system the Explore submenu reads "This system (Unknown star)". This is probably correct
  for the fog of war, but worth a C# check. Shots `p2b-05`, `p2b-102`.

---

## 3. The commander run: what was tried and how it went

| Interaction | Result |
|---|---|
| Unpause (Space / ▶), speed to 4x | OK |
| Explorer, order menu: X selects "Eager Expedition". Right-click unexplored Zeust → Explore › "This system" | OK. Mission Explore → Zeust. Explored later ("has completed its mission" 2150.03.22). `p2b-04..06` |
| Second explorer: Explore Xa Fil, then **Shift**-click Explore Zukarb (queue) | OK. `subsequentMissions` = 1. Both systems explored. `p2b-07` |
| Construction ship: Y → "Gallant Smuggler" (busy building BJ276). Right-click moon Eyeucold → "Build at Moon Eyeucold" › "Mining Station: MS-1 (3284 credits)" with **Shift** | OK. Queued after BJ276. Survived save/load. "Eyeucold Mining Station" was under construction (15 of 50 left) by 2151.01. `p2b-11/12` |
| F9: Escort ×2 → "Purchase for 4,067 credits" | OK. Money 23,525 → 19,458. `p2b-14/15` |
| F10: yards | OK. Space port shows "Waiting 2". Challenger 004 and 005 completed on 2150.03.09 (ticker message). `p2b-17/18` |
| Fleet: Challenger 004 → action bar "Join Fleet" (Fleet Formation automation prompt → "Turn off automation") → "1st Fleet". Challenger 005 joins | OK. `p2b-21` |
| Fleet Posture (Attack → Defend), Range (→ Home Base), Home Base → click the space port | OK. Pick mode and status line "Set Home Base" work. The first click hit a docked freighter, silently ignored. `p2b-22/23` |
| Fleet move: right-click the Adare star (zoom 0.01) → default Patrol. Ctrl-right-click → full menu (Move / Patrol / Refuel / Retrofit / Disband / Return to base …) | OK. At galaxy zoom see N5. `p2b-24/27` |
| F8: Edit "Challenger" → "Cannot edit this design: already in use" (faithful). Copy As New → "Challenger Mk2", +2 Maxos Blaster (Firepower 22 → 32, Size 211 → 221, Cruise 40 → 38), Save | OK. Saved design has 35 components. Ship Design automation (left on) later made "Challenger II", which F9 uses, as expected with automation on. `p2b-29..31` |
| First contact | Yosul Hive 2150.05.16 (message popup), then Sul Hive and Ugnari Industries. `p2b-32` |
| F5 Propose FTA, **AI voice on** | Voiced reply (qwen3:4b) in about 2 s: "We don't trade with inferior species. Our ships run on honey…". "original" toggles to the C# line "No, a Free Trade Agreement with an inferior species like you would never work". Refused at attitude −24, which is correct. `p2b-34/35` |
| F5 Propose FTA, **AI voice off** | Original line only. `p2b-36` |
| Trade ("Negotiate a trade proposal...") | Offered Territory Map (100) → "We accept your proposal". The Yosul side offers nothing: an AI keeps max(10,000, 10% of its money), and it had about 9.3k. This is faithful (`tradeNegotiation.ts:389`). `p2b-38/39` |
| Advisor T: "Refuel the 1st Fleet" | "✓ 1st Fleet: Refuel → Vun-Alae 1 — mission Refuel". The fleet's mission became Refuel (19). `p2b-40` |
| Advisor T: "Send my idle explorer Eager Expedition to the nearest unexplored system" | "✓ Eager Expedition: Explore → Tefnyl". `p2b-41` |
| Empire Policy: Exploration Priority → Very High | Applied at once (`policy.explorationPriority = 2`). Survived save/load. `p2b-76` |
| Every screen: F1–F12, G, H, V, O, T, `?`, and every top-bar button | All open. Escape closes all of them except `?` (N1). Inert: #12. `p2b-59..86` |
| Save (game menu) → Main Menu → Load | **Every order survived:** date and `nowMs`, money, Gallant Smuggler's Build BJ276 plus queued Build Eyeucold MS-1, Eager Expedition's Explore, 1st Fleet (2 ships, Defend, range, home base, Refuel mission), Challenger Mk2, the exploration policy, the met list, and 8 history entries. `p2b-87/88/89` |
| Full year | 2150.01.01 → 2151.03.13 with no errors. Money 23.5k → 60k. 26 systems explored. 3 empires met. Still 1 colony (N4). `p2b-91` |

---

## 4. What a player can do now, and what still blocks a first playable release

**A player can now:**
- start a seeded game with the full race list;
- run it for a year or more without a freeze, and save and load it losslessly (orders, fleets, designs, policy, history);
- command individual ships through the right-click order menu (Move, Explore, Build at, Refuel, Retire, Join Fleet,
  Queue Next Mission), with Shift to queue and Ctrl for the full menu;
- form fleets and set their posture, range and home base, and send them to patrol;
- buy ships (F9) and watch them build (F10), then see them appear as ships;
- design ships (Copy As New, add components, live stats, warnings);
- set Empire Policy;
- meet empires, propose treaties and trade, with an optional LLM voice that always keeps the C# verdict;
- give plain-English orders to the advisor.

All main list screens (Colonies, Ships & Bases, Fleets, Designs, Build Order, Yards, Research, Diplomacy, Expansion
Planner, Galaxy Map, Comparison, History, Galactopedia) work and select objects.

**Blockers for a first playable release, in priority order:**
1. **N4: no expansion in year 1.** Every empire is stuck at 1 colony because colony ships take about 430 days in a
   planet yard. For a 4X game this is the main blocker: nothing grows, and diplomacy, war and victory have nothing to
   work on. It needs a sim-owner check of colony-ship builder selection against the C#.
2. **Headless and low-end performance.** 0.7 fps at 4K swiftshader under load, and with the default 4-frames-per-render
   cap and the 100 ms ticker clamp, 4x speed ran at about 0.05× real time. Speed on real GPUs was not measured here. A
   frame budget that decouples sim frames from render fps (a larger `maxFrames` when the renderer is slow) would stop a
   slow machine from slowing the game clock.
3. **Controls:** N2 (E/R/A/S/`,`, Z/N/B/L hotkeys) and N1 (the Escape trap on `?`). Players expect these keys, and
   the UI advertises them.
4. **Missing screens:** Intelligence Agents (F4 — espionage is part of the core loop), Troops (invasions), Galactic
   History, Game Editor (can wait).
5. **N3** garbled research messages (seen often), and **N5** no default right-click order at galaxy zoom (players
   issue most long-range orders at that zoom).

---

## Screenshot index (4K, `game/shots/`, gitignored)

```
p2b-01-wizard-0..6  p2b-02-start  p2b-03-explorer-selected  p2b-04-explorer-rightclick  p2b-05-explore-submenu
p2b-06-explore-ordered  p2b-07-explorer2-queued  p2b-08/09-construction-rightclick-asteroid(2)
p2b-10-construction-rightclick-planet  p2b-11-build-submenu  p2b-12-mining-station-queued  p2b-13-F9-buildorder
p2b-14-F9-escort-x2  p2b-15-F9-after-purchase  p2b-16-F10-yards  p2b-17/18-F10-yard-detail  p2b-19-escort-rightclick
p2b-20-escort-after-rightclick-space  p2b-21-join-fleet  p2b-22-fleet-posture-page  p2b-23-fleet-homebase-set
p2b-24-fleet-rightclick-adare  p2b-25/26/27-fleet-ctrl-rightclick(-2,-3)  p2b-28-F8-designs  p2b-29-design-editor-open
p2b-30-design-editor-added-weapon  p2b-31-designs-after-save  p2b-32-first-contact  p2b-33-F5-diplomacy
p2b-34-F5-propose-FTA-novoice (voice ON)  p2b-35-F5-voiced-original-shown  p2b-36-F5-propose-FTA-voice-off
p2b-37/38-trade-panel  p2b-39-trade-offer-map  p2b-40-advisor-refuel  p2b-41-advisor-explore
p2b-42..58-screen-<key> (first pass; 58 = ? overlay, N1)  p2b-59..74-screen-<key>  p2b-75..86-top-<button>
p2b-87-saved  p2b-88-loaded  p2b-89-history-after-load  p2b-90-system-zoom-running-after-load  p2b-91-year-end
p2b-92..97 selection-planet / selection-ship / idle-cycle  p2b-98-f11-rowclick  p2b-99/100-ui-scale-125
p2b-101-V-comparison  p2b-102-explorer-hover-unexplored
```
