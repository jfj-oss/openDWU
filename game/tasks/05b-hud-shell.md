# Task 05b — HUD shell: DOM overlay with original chrome art + font

thinking: off
scope: locked

Depends on 05a (`src/ui/hudLayout.ts`). Everything you need is below. Create `src/ui/hud.ts`, `src/ui/hud.css`; minimal wiring in `src/main.ts`. Start editing right away. Do not Read image files.

## Build
- A DOM overlay above the Pixi canvas (`position:absolute; inset:0; pointer-events:none`; controls get `pointer-events:auto`), one element per rect from `computeHudLayout(innerWidth, innerHeight)`, re-laid-out on `resize`.
- Button images: `/assets/dwu/images/ui/chrome/<file>` — mapping from the C# below (`LoadUiChromeButtons`: e.g. `tbtnColonies` → `coloniesButton.png`). Only use file names that exist in the list below.
- Font: `@font-face { font-family: 'Forgotten Futurist'; src: url('/assets/dwu/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds/Resources/Forgotte.ttf'); }` and bold `Forgottb.ttf`; all HUD text uses it.
- Panels (`pnlDetailInfo`, `lstMessages`, `pnlSystemMap`): background `rgba(24,24,24,0.82)`, 1 px border `#3a3a3a`, 4 px radius. Text white, labels grey `#9a9a9a`, small (11–12 px).
- Content: `lblStarDate` shows a placeholder star date `"9860.01.01"`; `lblStateMoney` block shows "Money / Cashflow / Bonus Income" labels with `0` values; `lblSystemName` shows the name of the system nearest the camera centre (use `window.__dwu.galaxy`/camera if available, else empty); `lstMessages` shows 5 empty lines; buttons log `TODO(screen): <name>` on click.
- Test (`test/hud.test.ts`, jsdom if configured, else test only a pure helper `chromeButtonFile(name)` that maps control name → png).

`npm run typecheck` && `npm test`; with `npm run dev` running save (don't open) `shots/05b-hud.png` at `?zoom=1200`. Append `## Worker report`.

## C# — LoadUiChromeButtons etc. (Main.Part12.cs 381–520)
```csharp
                () => bitmap_217[30] = method_10(string_33, string_32, "CaptureEnemyShips_2" + text, bool_28: true),
                () => bitmap_217[31] = method_10(string_33, string_32, "CaptureEnemyShips_3" + text, bool_28: true),
                () => bitmap_217[32] = method_10(string_33, string_32, "EliminatePirateFactions_1" + text, bool_28: true),
                () => bitmap_217[33] = method_10(string_33, string_32, "EliminatePirateFactions_2" + text, bool_28: true),
                () => bitmap_217[34] = method_10(string_33, string_32, "EliminatePirateFactions_3" + text, bool_28: true),
                () => bitmap_217[35] = method_10(string_33, string_32, "TimeAtWar" + text, bool_28: true),
                () => bitmap_217[36] = method_10(string_33, string_32, "TimeAtPeace" + text, bool_28: true),
                () => bitmap_217[37] = method_10(string_33, string_32, "SuccessfulRaids_1" + text, bool_28: true),
                () => bitmap_217[38] = method_10(string_33, string_32, "SuccessfulRaids_2" + text, bool_28: true),
                () => bitmap_217[39] = method_10(string_33, string_32, "SuccessfulRaids_3" + text, bool_28: true),
                () => bitmap_217[40] = method_10(string_33, string_32, "GovernmentWayOfDarkness" + text, bool_28: true),
                () => bitmap_217[41] = method_10(string_33, string_32, "GovernmentWayOfAncients" + text, bool_28: true),
                () => bitmap_217[42] = method_10(string_33, string_32, "EmpireSplits" + text, bool_28: true),
                () => bitmap_217[43] = method_10(string_33, string_32, "BuildWonders_1" + text, bool_28: true),
                () => bitmap_217[44] = method_10(string_33, string_32, "BuildWonders_2" + text, bool_28: true),
                () => bitmap_217[45] = method_10(string_33, string_32, "BuildWonders_3" + text, bool_28: true),
                () => bitmap_217[46] = method_10(string_33, string_32, "OwnAnOperationalPlanetDestroyer" + text, bool_28: true),
                () => bitmap_217[47] = method_10(string_33, string_32, "JoinTheFreedomAlliance" + text, bool_28: true),
                () => bitmap_217[48] = method_10(string_33, string_32, "JoinTheShakturi" + text, bool_28: true),
                () => bitmap_217[49] = method_10(string_33, string_32, "DefeatAncients" + text, bool_28: true),
                () => bitmap_217[50] = method_10(string_33, string_32, "DefeatShakturi" + text, bool_28: true),
                () => bitmap_217[51] = method_10(string_33, string_32, "DefeatLegendaryPirates" + text, bool_28: true),
                () => bitmap_217[52] = method_10(string_33, string_32, "SuccessfulIntelligenceMissions_1" + text, bool_28: true),
                () => bitmap_217[53] = method_10(string_33, string_32, "SuccessfulIntelligenceMissions_2" + text, bool_28: true),
                () => bitmap_217[54] = method_10(string_33, string_32, "SuccessfulIntelligenceMissions_3" + text, bool_28: true)
            );
            bitmap_218 = new Bitmap[bitmap_217.Length];
            bitmap_219 = new Bitmap[bitmap_217.Length];
            List<Task> taskList = new List<Task>();
            for (int i = 0; i < bitmap_217.Length; i++)
            {
                int localI = i;
                taskList.Add(Task.Run(() =>
                {
                    bitmap_218[localI] = GraphicsHelper.ScaleImage(bitmap_217[localI], GameSummaryPanel.MedalSmallSize.Width, GameSummaryPanel.MedalSmallSize.Height, 1f);
                    bitmap_219[localI] = GraphicsHelper.ScaleImage(bitmap_217[localI], GameSummaryPanel.MedalVerySmallSize.Width, GameSummaryPanel.MedalVerySmallSize.Height, 1f);
                    Bitmap bitmap = bitmap_217[localI];
                    bitmap_217[localI] = GraphicsHelper.ScaleImage(bitmap_217[localI], GameSummaryPanel.MedalLargeSize.Width, GameSummaryPanel.MedalLargeSize.Height, 1f);
                    bitmap.Dispose();
                }));
            }
            Task.WaitAll(taskList.ToArray());
            Parallel.Invoke(
                () => bitmap_220 = method_10(string_33, string_32, "left.png", bool_28: true),
                () => bitmap_221 = method_10(string_33, string_32, "right.png", bool_28: true),
                () => bitmap_222 = method_10(string_33, string_32, "up.png", bool_28: true),
                () => bitmap_223 = method_10(string_33, string_32, "down.png", bool_28: true)
            );
        }

        internal void LoadUiChromeButtons(string string_30, string string_31)
        {
            string string_32 = Application.StartupPath + "\\images\\ui\\chrome\\";
            string text = Application.StartupPath + "\\Customization\\" + string_30 + "\\images\\ui\\chrome\\";
            string string_33 = string.Empty;
            if (!string.IsNullOrEmpty(string_31))
            {
                string_33 = text + string_31 + "\\";
            }
            picGameEditor.Image = method_55(string_32, text, string_33, "gameEditorButton.png");
            picGameEditorEnterPassword.Image = bitmap_145;
            tbtnColonies.Image = method_55(string_32, text, string_33, "coloniesButton.png");
            tbtnBuiltObjects.Image = method_55(string_32, text, string_33, "shipsAndBasesButton.png");
            tbtnEmpires.Image = method_55(string_32, text, string_33, "diplomacyButton.png");
            tbtnTroops.Image = method_55(string_32, text, string_33, "troopsButton.png");
            tbtnGalaxyMap.Image = method_55(string_32, text, string_33, "galaxyMapButton.png");
            tbtnShipGroups.Image = method_55(string_32, text, string_33, "fleetsButton.png");
            tbtnConstructionYards.Image = method_55(string_32, text, string_33, "constructionYardsButton.png");
            tbtnIntelligenceAgents.Image = method_55(string_32, text, string_33, "charactersButton.png");
            tbtnDesigns.Image = method_55(string_32, text, string_33, "designsButton.png");
            btnExpansionPlanner.Image = method_55(string_32, text, string_33, "expansionPlannerButton.png");
            btnEmpirePolicy.Image = method_55(string_32, text, string_33, "empirePolicyButton.png");
            btnEmpireGraphs.Image = method_55(string_32, text, string_33, "empireGraphsButton.png");
            btnGameEditor.Image = method_55(string_32, text, string_33, "gameEditorButton.png");
            btnBuildOrder.Image = method_55(string_32, text, string_33, "buildButton.png");
            btnGalacticHistory.Image = method_55(string_32, text, string_33, "galacticHistoryButton.png");
            btnHistoryMessages.Image = method_55(string_32, text, string_33, "messagesButton.png");
            btnGameMenu.Image = method_55(string_32, text, string_33, "gameOptionsButton.png");
            if (_Game != null && _Game.Galaxy != null && _Game.Galaxy.TimeState == GalaxyTimeState.Paused)
            {
                btnPlayPause.Image = bitmap_46;
            }
            else
            {
                btnPlayPause.Image = bitmap_45;
            }
            btnHelp.Image = method_55(string_32, text, string_33, "galactopediaButton.png");
            btnEncyclopediaHome.Image = method_55(string_32, text, string_33, "galactopediaHome.png");
            btnEncyclopediaForward.Image = bitmap_156;
            btnEncyclopediaBack.Image = bitmap_157;
            pnlColonyInfo.HeaderIcon = bitmap_37;
            pnlBuiltObjectInfo.HeaderIcon = bitmap_146;
            pnlEmpireInfo.HeaderIcon = bitmap_148;
            pnlTroopInfo.HeaderIcon = bitmap_149;
            CaLkaMyrMQ.HeaderIcon = bitmap_150;
            pnlShipGroupInfo.HeaderIcon = bitmap_147;
            kYdDyYeMls.HeaderIcon = bitmap_51;
            pnlDesigns.HeaderIcon = bitmap_151;
            pnlExpansionPlanner.HeaderIcon = bitmap_143;
            pnlEmpirePolicy.HeaderIcon = bitmap_152;
            vHfFsoqMev.HeaderIcon = bitmap_153;
            pnlMessageHistory.HeaderIcon = bitmap_154;
            pnlEncyclopedia.HeaderIcon = eqliPoFqeq;
            pnlBuildOrder.HeaderIcon = bitmap_72;
            pnlColonyInfo.DoLayout();
            pnlBuiltObjectInfo.DoLayout();
            pnlEmpireInfo.DoLayout();
            pnlTroopInfo.DoLayout();
            CaLkaMyrMQ.DoLayout();
            pnlShipGroupInfo.DoLayout();
            kYdDyYeMls.DoLayout();
            pnlDesigns.DoLayout();
            pnlExpansionPlanner.DoLayout();
            pnlEmpirePolicy.DoLayout();
            vHfFsoqMev.DoLayout();
            pnlMessageHistory.DoLayout();
            pnlEncyclopedia.DoLayout();
            pnlBuildOrder.DoLayout();
            btnCycleBases.Image = method_55(string_32, text, string_33, "cycleBases.png");
            btnCycleBasesBack.Image = method_55(string_32, text, string_33, "cycleBasesBack.png");
            btnCycleColonies.Image = method_55(string_32, text, string_33, "cycleColonies.png");
            btnCycleColoniesBack.Image = method_55(string_32, text, string_33, "cycleColoniesBack.png");
            btnCycleConstruction.Image = method_55(string_32, text, string_33, "cycleConstruction.png");
            btnCycleConstructionBack.Image = method_55(string_32, text, string_33, "cycleConstructionBack.png");
            btnCycleIdleShips.Image = method_55(string_32, text, string_33, "cycleIdleShips.png");
            btnCycleIdleShipsBack.Image = method_55(string_32, text, string_33, "cycleIdleShipsBack.png");
            btnCycleMilitary.Image = method_55(string_32, text, string_33, "cycleMilitary.png");
            btnCycleMilitaryBack.Image = method_55(string_32, text, string_33, "cycleMilitaryBack.png");
            btnCycleOther.Image = method_55(string_32, text, string_33, "cycleOther.png");
            btnCycleOtherBack.Image = method_55(string_32, text, string_33, "cycleOtherBack.png");
            btnCycleShipGroups.Image = method_55(string_32, text, string_33, "cycleFleets.png");
            btnCycleShipGroupsBack.Image = method_55(string_32, text, string_33, "cycleFleetsBack.png");
            btnCycleShipStance.Image = method_55(string_32, text, string_33, "shipStance.png");
            btnLockView.Image = method_55(string_32, text, string_33, "lockView.png");
            btnSelectNearestMilitary.Image = method_55(string_32, text, string_33, "nearestMilitary.png");
            btnSelectionBack.Image = bitmap_157;
            btnSelectionForward.Image = bitmap_156;
            btnSelectionPanelSize.Image = method_55(string_32, text, string_33, "selectionPanelSize.png");
            btnZoomColony.Image = method_55(string_32, text, string_33, "zoomColony.png");
            btnZoomIn.Image = method_55(string_32, text, string_33, "zoomIn.png");
```

## Files in images/ui/chrome/
advisorsuggestion.png, agent.png, angry.png, arrowhead.png, assault.png, assaultpod_landing.png, asteroid.png, asteroidField.png, attack.png, automate.png, back.png, blank.png, bombard.png, build.png, buildbomber.png, buildButton.png, buildfighter.png, capital.png, characterRole_Ambassador.png, characterRole_ColonyGovernor.png, characterRole_FleetAdmiral.png, characterRole_IntelligenceAgent.png, characterRole_Leader.png, characterRole_PirateLeader.png, characterRole_Scientist.png, characterRole_ShipCaptain.png, characterRole_TroopGeneral.png, characters.png, charactersButton.png, civilianfade.png, codeforce.png, coloniesButton.png, colonization_large.png, colonize.png, colony.png, construction.png, constructionYardsButton.png, crashprogram.png, crashprogramdisabled.png, cycleBases.png, cycleBasesBack.png, cycleColonies.png, cycleColoniesBack.png, cycleConstruction.png, cycleConstructionBack.png, cycleFleets.png, cycleFleetsBack.png, cycleIdleShips.png, cycleIdleShipsBack.png, cycleMilitary.png, cycleMilitaryBack.png, cycleOther.png, cycleOtherBack.png, debrisField.png, defeat.png, designs.png, designsButton.png, desktop.ini, developmentLevel.png, diplomacy.png, diplomacyButton.png, emergency.png, empireGraphs.png, empireGraphsButton.png, empirePolicy.png, empirePolicyButton.png, eraseasteroidfield.png, erasecolony.png, eraseitem.png, erasepopulation.png, eraseruins.png, exclamation.png, expansionPlanner.png, expansionPlannerButton.png, fighters.png, firepower.png, flags.png, fleetAttackPoint.png, fleetAttackPosture.png, fleetDefendPosture.png, fleetHomeBase.png, fleetLeader.png, fleetposture.png, fleetRangeAny.png, fleetRangeArea.png, fleetRangeSector.png, fleetRangeSystem.png, fleetRangeTarget.png, fleets.png, fleetsButton.png, forward.png, galacticHistory.png, galacticHistoryButton.png, galactopedia.png, galactopediaButton.png, galactopediaHome.png, galaxy.png, galaxy_Icon.png, galaxyMap.png, galaxyMapButton.png, galaxyshape_clusterseven.png, galaxyshape_clustersvaried.png, galaxyshape_elliptical.png, galaxyshape_irregular.png, galaxyshape_ring.png, galaxyshape_spiral.png, gameEditor.png, gameEditorButton.png, GameEnd.jpg, gameOptions.png, gameOptionsButton.png, guardians.jpg, happy.png, joinfleet.png, key.png, launchbombers.png, launchfighters.png, leavefleet.png, leftarrow.png, loadtroops.png, lockView.png, longrangescanner.png, MainBackground.jpg, matrix.png, Menu_ChangeTheme_Active.png, Menu_ChangeTheme_Inactive.png, Menu_CheckForUpdates_Active.png, Menu_CheckForUpdates_Inactive.png, Menu_Credits_Active.png, Menu_Credits_Inactive.png, Menu_Exit_Active.png, Menu_Exit_Inactive.png, Menu_Galactopedia_Active.png, Menu_Galactopedia_Inactive.png, Menu_LoadGame_Active.png, Menu_LoadGame_Inactive.png, Menu_Options_Active.png, Menu_Options_Inactive.png, Menu_StartNewGame_Active.png, Menu_StartNewGame_Inactive.png, Menu_Tutorials_Active.png, Menu_Tutorials_Inactive.png, message.png, messages.png, messagesButton.png, mine.png, money.png, nearestMilitary.png, neutral.png, newfleet.png, panelframe.png, pauseresume_Pause.png, pauseresume_Play.png, pirateflag.png, pirateflag_Small.png, pirateMissionAttack.png, pirateMissionDefend.png, pirateMissionSmuggle.png, playstyle_normalclassic.png, playstyle_normalshadows.png, playstyle_pirateclassic.png, playstyle_pirateshadows.png, raid.png, refuel.png, remove.png, research.png, research_small.png, retrievebombers.png, retrievefighters.png, retrofitbase.png, retrofitship.png, returntotop.png, rightarrow.png, sad.png, scenery.png, scrapbase.png, scrapfighter.png, scrolldownarrow.png, scrolluparrow.png, selectionPanelSize.png, shakturi.jpg, shipsAndBases.png, ShipsAndBasesButton.png, shipStance.png, smallTitle.png, Space.png, Splash.png, stop.png, storyEvent.jpg, storyMessage.jpg, territory.png, Title.png, toggleDisplayDetail.png, travelvector.png, travelVectorCivilian.png, travelVectorMilitary.png, treaty.png, troops.png, troopsButton.png, unautomate.png, UpArrow.png, upgradefighters.png, victory.png, warpjump_large.png, zoom.png, zoomcolony.png, zoomin.png, zoomout.png, zoomregion.png, zoomsector.png, zoomSelection.png, zoomsystem.png

## Worker report

**Files changed**
- `src/ui/hud.ts` (new) — `CHROME_BUTTONS` mapping + pure `chromeButtonFile(name)` helper (port of `LoadUiChromeButtons`, Main.Part12.cs 381–520); DOM overlay builder: `createHud()` builds one absolutely-positioned element per rect from `computeHudLayout(innerWidth, innerHeight)` into a `#hud` div (`position:absolute; inset:0; pointer-events:none`), `layoutHud()` re-runs the layout on resize, `nearestSystemName()` picks the system whose star is closest to the camera centre.
- `src/ui/hud.css` (new) — `@font-face` for Forgotten Futurist (`Forgotte.ttf`) + bold (`Forgottb.ttf`) from `/assets/dwu/Customization/.../Resources/`; panel style `rgba(24,24,24,0.82)` / 1px `#3a3a3a` border / 4px radius; white text, grey `#9a9a9a` labels at 11–12px; buttons get `pointer-events:auto`.
- `src/main.ts` — imports `./ui/hud.css` and the HUD module; after boot creates the overlay, refreshes `lblSystemName` (every 250 ms, since panning moves the camera centre), re-lays-out on window resize and Pixi renderer resize.
- `test/hud.test.ts` (new) — jsdom is not configured, so tests the pure `chromeButtonFile` mapping (positive mappings incl. the `cycleFleets`/lowercase-zoom quirks, and null cases: runtime-bitmap controls, missing files).

**Done**
- Overlay with one element per layout rect; panels `pnlDetailInfo`/`lstMessages`/`pnlSystemMap` styled per spec; `lstMessages` shows 5 empty lines; `lblStarDate` = "9860.01.01"; `lblStateMoney` block has Money/Cashflow/Bonus Income rows with `0` values; `lblSystemName` shows the nearest system name via `window.__dwu`-equivalent refs (galaxy/camera passed in directly); buttons use original chrome art from `/assets/dwu/images/ui/chrome/` and log `TODO(screen): <name>` on click.
- `npm run typecheck` passes; `npm test` passes (11 files, 143 tests).
- Screenshot saved: `shots/05b-hud.png` (dev server, `?zoom=1200`); no console errors printed by `scripts/shot.mjs`.

**Left undone / notes**
- Controls whose images are runtime bitmaps in the original (`btnPlayPause`, `btnSelectionBack/Forward`) or that have no file in the chrome folder (`btnZoomSystem`, `btnZoomRegion`, `jQaYpdpkDs`) render as bare dark placeholder buttons — noted in `hud.ts`.
- `pnlDetailInfo` body content (selection details) and `pnlSystemMap`'s map drawing are later tasks; both are empty containers now.
- `lblPrivateMoney`/`lblGodData` exist as empty labels (task only specified content for star date, money block, system name).
- Font falls back to sans-serif if the DW:U install (and thus the TTFs) is absent.
