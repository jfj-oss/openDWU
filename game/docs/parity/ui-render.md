# UI & Presentation Parity Audit (DW:U 1.9.5 → TS port)

C# root: `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/` (DistantWorlds/ and BaconDistantWorlds/). Ours: `game/src/{ui,render,audio,main.ts}`. Read-only audit (C# source vs our code; the game was not run).

Some C# panels have obfuscated names: CaLkaMyrMQ = Galaxy Map, kYdDyYeMls = Characters, vHfFsoqMev = Empire Comparison.

## 1. Ranked gaps (High first)

| # | Feature | C# source | Status | Our location | Impact | Notes |
|---|---|---|---|---|---|---|
| 1 | Control groups: Ctrl+0-9 sets, 0-9 selects, a variant selects and moves the view | Main.Part7.cs Main_KeyUp SetControlGroupN / SelectControlGroupN(WithFocus), `_Game.PlayerHotkey0..9`, method_208/157 | DONE (parC1) | ui/controlGroups.ts, sim/player/controlGroups.ts | High | Galaxy.playerHotkeys (saved), journaled op `setControlGroup`; Shift+digit = WithFocus (Expanded default mapping). Browsers keep Ctrl+1-9 for tabs; works in Electron |
| 2 | Wizard empire-type page: Normal Classic/Shadows, **Pirate** Classic/Shadows, Legends, Return of the Shakturi, Ancient Galaxy, Quick Starts | Start.cs pnlStartNewGameYourEmpireType | MISSING | ui/screens/newGameWizard.ts | High | No pirate-player start, so every pirate-player screen is unreachable; the sim has PiratePlayStyle |
| 3 | Game Editor family (pnlGameEditor, pnlEdit*, passwords, character skills/traits editor) | Main pnlGameEditor, pnlEdit* | MISSING | top-bar button shows a toast | High (modding) / Low | |
| 4 | Ground invasion status panel ("[" key, Ground/Battle Report link) | Main.Part11.cs pnlColonyInvasion, method_164/165; ColonyInvasion.cs; InfoPanel.cs 4419/4497 | DONE (parC1, read-only) | ui/screens/groundReport.ts, groundReportModel.ts | High | Static layout ported; explosion / landing animation not. The C# hands the battle to the panel's paint loop while open (Habitat.ColonyInvasion); the port keeps it in the tick |
| 5 | Game Options: engagement-stance defaults, fleet attack gather/refuel/overmatch, discoveries, new ships automated, same-system start, loaded games paused, wheel behaviour, zoom/scroll speed, starfield size, advanced display, Other Empire Settings, reset automation messages | Main pnlGameOptions + grpGameOptions*, Main.Part6.cs:1760-2560, Main.Part4.cs:4159-4747, Main.Part9.cs:2510-2600 | DONE | ui/screens/gameOptionsPanel.ts, gameOptionsModel.ts | — | Every group and sub-window ported; game-state values go through setEmpireControl / setEmpireSetting (journaled, worker-safe). Closing the window saves the player's settings as the next new game's defaults (YxwyUefOyQ + method_257 → settings.newGameOptions → createGame `gameOptions`, Start.2.cs 1352-1363 / 2122-2146). Left: the main menu's Options editing those defaults before a game (Start.1.cs:1928-1960); "Allow … other empires systems" is shown read-only (hidden in game in the original) |
| 6 | Fleet Postures map overlay | MainView.2.cs MapOverlayFleetPostures | MISSING | ui/mapOverlays.ts toggle only | Med-High | The toggle does nothing |
| 7 | Long Range Scanners overlay | MainView.2.cs MapOverlay LRS | MISSING | same as #6 | Med-High | fog.ts already reads longRangeScanners |
| 8 | Battle bars at f<=3: shield line, boarding/assault bar, flashing boarding icon, fleet-leader badge | MainView.1.cs:1251-1295, MainView.cs:4521-4535 | PARTIAL/DIVERGENT | render/combatBars.ts (our own design; its header wrongly says the original has none); fighterLayer.ts:22 | Med | |
| 9 | Display-type cycle (D / btnMainViewDisplayToggle, int_34) | Main.Part6.cs:3069; MainView.cs 4069/4352/4523/4696 | DONE (parC1) | render/mainViewDisplay.ts | Med | Gates colony rings, per-ship symbols, combat bars, habitat labels |
| 10 | Panel-visibility cycle (T, CyclePanelVisibility) | Main.Part7.cs:3085, Main.Part5.cs method_472/473 | DONE (parC1) | ui/panelVisibility.ts, hud.css | Med | Advisor chat moved to K |
| 11 | Game-start Introduction panel (story, victory conditions, Start) | Main.Part12.cs:2921-3118 method_81/82, Main.Part5.cs:449, Main.Part12.cs:4248-4258 | DONE | ui/screens/introductionPanel.ts | — | Shown paused for wizard games (dev autostart: ?intro=1); Start Playing resumes. Empire.Description (Game Editor) not modelled |
| 12 | Tutorial in-game behaviours (highlight controls, zoom/scroll to object, open screen/tab) | Main.Part5.cs method_455 | PARTIAL | ui/screens/tutorials.ts:142, sim/data/tutorials.ts:12 | Med | Steps show text only |
| 13 | Event/story popups: remaining pictures, full-screen pnlStoryEvent, Shakturi ending, music cues | Main.Part4.cs:1300-1460, 4839-4994; Main.Part12.cs:3428 | PARTIAL | ui/eventMessages.ts:8,171; empireComparison.ts:17 | Med | |
| 14 | Empire Comparison / Victory: graphs + history, Top Colonies, race victory detail, scenario lists, pirate comparison, Game Summary | Main.Part6.cs:1685-1745 method_400; EmpireComparison.cs, TopColonies.cs, RaceVictoryConditionsPanel.cs, GameVictoryConditions.cs, GameSummaryPanel.cs | DONE (batch D1) | ui/screens/empireComparison.ts, gameSummary.ts | Med | The original has no history charts. Left: Shakturi story message (Code 1) |
| 15 | Game End panel (outcome + Continue + Exit) | Main.Part12.cs DoGameEnd, Main.Part6.cs:3998-4067 method_436/437, btnGameEndContinue/Exit_Click | DONE | ui/screens/gameEndPanel.ts, empireComparison.ts presentGameEnd | — | method_436: the comparison window opens on Achievements with the outcome overlay (OverlayTextLines); pnlGameEnd (never made visible in 1.9.5, no layout code) is shown beside it with Continue Playing... / Exit to main menu — its layout is ours. The method_429-431 taunts are dead code, not ported |
| 16 | Galaxy Map extras: system view (picSystemMap), landscape, Back/Forward, territory shading, nebula on mini maps | Main.Part11.cs:1078, 2074-2130; Main.Part10.cs method_213-215; SystemView.cs; GalaxyMap.cs bitmap_0 | DONE (batch D1) | ui/screens/galaxyMap.ts, ui/systemView.ts, ui/screens/galaxyMapLayers.ts | Med | Nebula image is a per-location cloud composite (GenerateNebulae image path not ported); pnlHabitatInfo (InfoPanel) and the resource list not ported |
| 17 | HUD system mini-map (pnlSystemMap/picSystem) | Main.Part11.cs:451, 1879; Main.Part12.cs 2099-2134; SystemView.cs method_5/9 | DONE (batch D1) | ui/hudSystemMap.ts (the View popup sits above it) | Med | |
| 18 | Territory shading algorithm (CalculateEmpireTerritoryGrid / SystemTerritory) | GalaxyMap.cs, EmpireTerritory.cs, MainView.2.cs:262-365 | PARTIAL | render/empireLayer.ts | Med | Being ported (territory agent) |
| 19 | Pirate-player UI: Pirate Missions panel, pirate colonies rows, smuggling resource picker, pirate construction at bases | ItemListPanel.cs method_7 / 729-848; Main.Part8.cs:5067; Main.Part11.cs method_169 | MISSING | TODOs in leftSidebar.ts, orderMenu.ts:470, constructionYards.ts:15 | Med (blocked by #2) | |
| 20 | Left sidebar "Enemy Targets" panel | Main.method_205, ItemListPanel.cs method_8/9 | MISSING | leftSidebar.ts:12 | Med | |
| 21 | Colony construction-yard purchaser, Scrap/Remove Ship | Main.Part6.cs:3460-3560 | PARTIAL | coloniesScreen.ts:21, 1261 | Med | |
| 22 | Construction Yards detail tabs (Cargo/Components/Docking/Troops/Weapons), Scrap | Main.Part11.cs method_170-176 | PARTIAL | constructionYards.ts:12, 578 | Med | |
| 23 | Resource Components panel | Main.Part4.cs method_552 | MISSING | expansionPlanner.ts:20 links to Galactopedia | Low-Med | |
| 24 | H should open the full pnlMessageHistory | Main.Part4.cs:2016 method_528("either") | DONE (parC1) | screens/galacticHistory.ts | Low-Med | H and the envelope button; the combo's filter persists |
| 25 | Ion-strike lightning overlay | MainView.1.cs:1162-1201, LightningGenerator.cs | MISSING | effectsLayer.ts:28 | Low-Med | |
| 26 | Fighter selection brackets and picking | MainView.1.cs:1520 method_212 | MISSING | fighterLayer.ts:23 | Low | |
| 27 | Other empires' fleets on overlays, selected-fleet yellow, special-highlight red, arrow head | MainView.2.cs method_258 | PARTIAL | overlayLayer.ts:219 | Low-Med | |
| 28 | Alliance naming panel | Main.Part2.cs pnlRelationAllianceName | MISSING | — | Low | |
| 29 | Empire Policy Load/Save | Main.Part3.cs btnEmpirePolicyLoad/Save | MISSING | empirePolicy.ts:7 | Low | |
| 30 | Ruin Detail window | Main method_550 | PARTIAL | coloniesScreen.ts:22 | Low | |
| 31 | Diplomacy: restricted-resource toggle, ability bonus lines, ambassador portrait, pirate relation factors | Main.Part5.cs; Empire.7.cs:4270 | PARTIAL | diplomacyScreen.ts | Low-Med | |
| 32 | Key remapping screen | BaconDistantWorlds/HotKeys/* | MISSING | — | Low | |
| 33 | Bacon mod forms (cargo/passenger/mining mission targets, customize ship, custom bomber, invasion command, prison) | BaconDistantWorlds/*.cs | MISSING | orderMenu.ts:475 | Low-Med | Mod-only |
| 34 | Weapon-range circles and gravity-well ring for the selected ship | BaconMain.cs:404-470 | MISSING | rangeRings.ts (fuel rings only) | Low-Med | |
| 35 | Explosion screen shake (ExplosionSize > 150) | Main.method_217 | MISSING | audio/mainViewSounds.ts:334 | Low | |
| 36 | Main menu Change Theme | Start.cs pnlThemes | MISSING | mainMenu.ts:206 | Low | |
| 37 | Save/Load progress panel | pnlSaveLoadProgress | PARTIAL | loadingOverlay.ts | Low | |
| 38 | Character portraits in lists | CharacterImageCache | PARTIAL | fleetsList.ts:23, leftSidebar.ts:15, coloniesScreen.ts:23 | Low | characterPortrait.ts now exists; wire it in |
| 39 | Character rename + tooltip | CharacterSummary.cs | MISSING | intelligence.ts:808 | Low | |
| 40 | Composite pictures in popups and advisor | MessagePopup.cs 764-971 | PARTIAL | messagePicture.ts, advisorSuggestions.ts | Low | |
| 41 | Colony attitude bonus lines | HabitatAttitudeSummary.cs | PARTIAL | coloniesScreen.ts:24 | Low | |
| 42 | Reply text panel after a diplomatic choice | Main.Part10.cs:3590 | PARTIAL (toast) | messagePopups.ts:11 | Low | |
| 43 | HoverDetail list hover popups | Controls HoverDetail | MISSING | mapTooltip.ts | Low | |
| 44 | Screensaver mode, splash | Main ToggleScreenSaverActive, Splash.cs | MISSING | — | Low | |

## 2. Missing whole screens/panels
- Game Editor and all pnlEdit* panels; pnlGameEditorPassword/EnterPassword; pnlCharacterEditSkillsTraits.
- pnlColonyInvasion.
- Wizard: pnlStartNewGameYourEmpireType (incl. Pirate), JumpStart/QuickStart, saved galaxy maps, Introductory.
- pnlResourceComponents, pnlRelationAllianceName, pnlPirateSmugglingMissionResourceSelection, pnlSaveLoadProgress, pnlThemes.
- pnlStoryEvent (full-screen).
- Bacon forms and the HotKeys screen.

## 3. Present (full or near-full)
- **Keyboard:** complete for the 1.9.5 table plus the Expanded control groups, D, T and "[" (parC1).
- **Screens:** Galaxy Map, Characters, Diplomacy, Empire Summary, Research, Designs + Editor, Build Order + queue, Construction Yards, Ships & Bases, Fleets, Troops, Colonies, Expansion Planner, Empire Policy, Galactic History, Galactopedia, Tutorials, Main Menu, Credits, Game Menu, Save/Load, Advisor Suggestions, message popups, event messages, selection panel, left sidebar, top bar.
- **Main view rendering:** broadly complete (crossfade zoom, fog, faction rings, markers, overlays, effects, damage, fighters, creatures, box select, pick menu, follow camera).
- **Sound/music:** full; only the per-type popup sting gate and screen shake are missing.
- **Stale TODOs:** builtObjectLayer.ts:710-711 and messageRouting.ts:4.
