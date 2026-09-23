# 06 — User Interface & Game Flow (Distant Worlds: Universe)

> Research compiled from: decompiled C# source (`DistantWorldsExpanded` — `DistantWorlds/Start*.cs`, `Main*.cs`, `DistantWorlds/Controls/`, `DistantWorlds.Controls/`, `DistantWorlds.Types/`), the in-game Galactopedia help articles (UI_*, Screen_*), and the 11 official tutorial scripts. Exact UI strings are quoted where available.

---

## 1. GAME FLOW

### 1.1 Launch

1. Executable starts, shows a **Splash screen** (`Splash.cs`) with animated progress text while the galaxy is generated and UI resources are loaded. Progress lines seen in code: `"Creating new Galaxy..."`, `"Igniting stellar cores..."`, `"Initiating orbital motion..."`, `"Forming nebulae clouds..."`, `"Recharging reactors..."`, `"Recalibrating hyperdrives..."`, `"Emptying Black Holes..."`, `"Feeding the Giant Kaltors..."`, `"Tidying up asteroid fields..."`, `"Building mining stations..."`, `"Fueling pirate ships..."`, `"Hiding low-quality colonies..."`, then `"Loading the Galaxy..."` / `"Saving the Galaxy..."`.
2. After the splash, the **Main Menu** (the `Start` form) is shown.

### 1.2 Main Menu

The main menu is a full-screen image (`picTitle`) with a hover menu (`HoverMenuGroup menuGroup` + `HoverMenuItem`s) and hint/version labels. Items (exact strings):

- **Start New Game** (`lnkNewGame` / `menuStartNewGame`) — opens the new-game wizard (or playstyle picker).
- **Tutorials** (`lnkTutorial` / `menuTutorials`) — sub-list of 9 links:
  - "Launch Finding Your Way Around Tutorial"
  - "Launch Empire and Colonies Tutorial"
  - "Launch Ships and Bases Tutorial"
  - "Launch Fleets, Troops and Intelligence missions Tutorial"
  - "Launch Expansion and Diplomacy Tutorial"
  - "Launch Research, Ship Design and Construction Tutorial"
  - "Launch Dealing with Pirates Tutorial"
  - "Launch Play As Pirate Tutorial"
  - "Launch PreWarp Empire Tutorial"
- **Quick Start** (`lnkPlayScenario` / `menuLoadGame`-adjacent `btnQuickStart`) — preconfigured scenarios (see 1.4).
- **Load Game** (`lnkLoadGame` / `menuLoadGame`) — file dialog: "Load Distant Worlds game" / "Distant Worlds saved game files".
- **Galactopedia** (`lnkGalactopedia` / `menuGalactopedia`) — the in-game encyclopedia; hint "Browse the built-in galactic encyclopedia"; checkbox "Show this screen at startup".
- **Options** (`lnkOptions` / `menuOptions`) — the Game Options screen (Display Settings, Sound, Auto Saves, Mouse Scroll-Wheel Behaviour, Automation, Empire Settings, Messages, Change Theme).
- **Check For Updates** (`lnkCheckForUpdates`) — "Visit CODEFORCE to check for updates to Distant Worlds".
- **Credits** (`lnkAbout` / `menuCredits`) — "About Distant Worlds" / scrolling credits panel.
- **Change Theme** (`lnkThemes` / `menuChangeTheme`) — themes screen.
- **Exit** (`lnkExit` / `menuExit`) — exit to desktop.
- Bottom labels: **Version**, **Copyright**, **Active Theme**, **Menu Hints**.

### 1.3 New Game Wizard (complete option inventory)

The wizard (`pnlNewGame`, a `ScreenPanel` with `HeaderTitle` "Start a New Game: …") is a 7-step flow with Previous/Next buttons whose labels are, exactly:

| Step | Panel | Prev button text | Next button text |
|---|---|---|---|
| 1 | Playstyle | — | (scenario buttons) |
| 2 | The Galaxy | "<<" Previous: Playstyle | "Next: Colonization && Territory >>" |
| 3 | Colonization & Territory | "<< Previous: The Galaxy" | "Next: Your Race >>" |
| 4 | Your Race | "<< Previous: Colonization && Territory" | "Next: Your Empire >>" |
| 5 | Your Empire | "<< Previous: Your Race" | "Next: Other Empires >>" |
| 6 | Other Empires | "<< Previous: Your Empire" | "Next: Victory Conditions >>" |
| 7 | Victory Conditions | "<< Previous: Other Empires" | "Start the Game!" |

Context-sensitive help messages are shown "in yellow at the top of the screen" as the user hovers each control (each slider/checkbox has a `LabelText` + `LinkText` help link, e.g. "About Research...", "About Space Creatures...", "About Pirates...", "About Alien Life...").

#### Step 1 — Playstyle

Top of screen: big **"Introductory Game >>"** button (`btnStartNewGameIntroductory`, in a rounded border panel). Then six prebuilt-era buttons (exact text):

- "The Ancient Galaxy >>" — "a game using a custom theme and a predefined galaxy map… takes you back to the distant past"
- "Pirate Faction in the Age of Shadows >>" — "marauding pirate faction during the Age of Shadows when civilization has crumbled and pirates rule the galaxy"
- "Standard Empire in the Age of Shadows >>" — "primitive standard empire in the Age of Shadows without hyperdrive technology… slowly spread throughout your home star system prior to rediscovering faster-than-light travel"
- "Classic Era >>" — "standard empire with a single colony… original Distant Worlds storyline, but without any story elements from Return of the Shakturi or Legends"
- "Return of the Shakturi >>" — "storyline elements from both the original Distant Worlds and Return of the Shakturi, but does not contain the Legends storyline"
- "Legends >>" — "all of the Distant Worlds storyline: original, Return of the Shakturi and Legends"

Two custom-game buttons (340×100): **"Play a Custom Game as a Standard Empire >>"** and **"Play a Custom Game as a Pirate Faction >>"** — these launch the full 7-step wizard below. Also: **"Quick Starts >>"** and **"Play selected Galaxy and Faction >>"** (Galaxy Maps screen: pick a prebuilt galaxy from "Playable Galaxies" + a faction from "Playable Factions", with an "Explanation" panel; button "No thanks, I want to set up a Custom Game >>"). A timeline image (`picStartNewGameYourEmpireTypeTimeline`) shows the era order.

#### Step 2 — The Galaxy

Left panel "Galaxy Shape" radio buttons (each sets the shape title "SHAPE Galaxy", a 190×190 preview picture, description text, and the valid starting-location list):

- **Elliptical** — "Elliptical galaxies have a classic spiral shape"
- **Spiral** — "Spiral galaxies have a distinctive shape"
- **Ring** — "Ring galaxies contain most of their stars"
- **Irregular** — "Irregular galaxies have no fixed shape or structure"
- **Even Clusters** / **Varied Clusters** — "Cluster galaxies have groups of stars clustered together"

Sliders (`LabelledTrackBar`s; each label + value shown under the bar):

| Slider | Label | Values (left→right) |
|---|---|---|
| `tbarStartNewGameTheGalaxyStarDensity` | "Star\nAmount" | Dwarf (100 stars), Tiny (250), Small (400), Standard (700), Large (1000), Huge (1400) |
| `tbarStartNewGameTheGalaxyDimensions` | "Physical\nSize" | Tiny (4x4 sectors), Small (6x6), Medium (8x8), Large (10x10), Huge (15x15) |
| `tbarStartNewGameTheGalaxyExpansion` | "Expansion" | PreWarp, Starting, Young, Expanding, Mature, Old — "Determines how old and developed the entire galaxy is" (sets auto-generated empire sizes) |
| `tbarStartNewGameTheGalaxyAggression` | "Aggression" | Peaceful, Normal, Restless, Unstable, Chaos — "Determines how aggressive computer players are in the game" |
| `tbarStartNewGameTheGalaxyDifficulty` | "Difficulty" | Easy, Normal, Hard, Very Hard, Extreme — "Determines difficulty and aggression of gameplay" |
| `tbarStartNewGameTheGalaxyResearchSpeed` | "Research \nCosts" | Very Expensive, Expensive, Normal, Cheap, Very Cheap — "Determines how fast research occurs in the galaxy" |
| `tbarStartNewGameTheGalaxySpaceCreatures` | "Space Creatures" | None, Few, Normal, Many — "Determines how many space creatures are present in the galaxy" |
| `tbarStartNewGameTheGalaxyPirates` | "Pirates" | None, Very Few, Few, Normal, Many, Very Many — "Determines how many pirates are present in the galaxy" |
| `tbarStartNewGameTheGalaxyPirateStrength` | "Pirate Strength" | Very Weak, Weak, Normal, Strong — "Determines how strong pirates are and how fast they grow" |

Other options:

- `numStartNewGameTheGalaxyResearchBaseTech` — custom research base cost, numeric, 1–999, suffix "K" ("K" label).
- `cmbStartNewGameTheGalaxyPirateProximity` — "Pirate Proximity" to empires: **Nearby / Average / Distant**.
- `chkStartNewGameTheGalaxyDifficultyScaling` — "Difficulty scales as player nears victory".
- `chkStartNewGameTheGalaxyPiratesRespawn` — "Destroyed Pirates do not respawn".
- `chkStartNewGameEnableGiantKaltors` — "Allow Giant Kaltors at game start".
- `chkStartNewGameEnableTechTrading` — "Allow Tech Trading".

Right panel: **"OR Load an existing Galaxy as a map"** — filepath box ("(No Galaxy Map specified)"), buttons "Browse for Maps..." / "Clear Map", and regenerate checkboxes: "Regenerate Resources", "Regenerate Scenery and Research bonuses", "Regenerate Space Creatures", "Regenerate Ruins", "Regenerate Special Locations".

#### Step 3 — Colonization and Territory

- `tbarStartNewGameTheGalaxyColonyPrevalence` — "Colony Prevalence": **Scarce, Occasional, Normal, Plentiful, Abundant** — "influences the number of colonizable planets and moons in the galaxy".
- `tbarStartNewGameTheGalaxyAlienLife` — "Independent Alien Life": **Rare, Scattered, Normal, Plentiful, Teeming** — "determines how many independent populations of aliens exist in the galaxy and how large they are".
- `sldStartNewGameColonizationTerritoryColonyInfluenceRange` (ColorSlider) — "Colony Influence Range", default **100%**, with a "Suggestion" text box — "controls how far your empire's territorial influence projects out from your colonies".
- `chkStartNewGameColonizationTerritoryEnforceColonizationRange` — group "Enforce Colonization Range Limits" + `sldStartNewGameColonizationTerritoryColonizationRange` slider, default **4000K** — "you cannot establish new colonies further than the indicated range from any of your existing colonies… however you may still take over other empire's colonies outside this range".
- `chkOptionsAllowSameSystemAsOtherEmpires` — "Allow colonization and mining stations in other empires systems".

#### Step 4 — Your Race

- `cmbStartNewGameYourEmpireRace` (`RaceDropDown`) — dropdown of all alien races, with "(Random)" / "Race randomly selected" null item.
- `picStartNewGameYourEmpireRace` — large race portrait; `pnlStartNewGameYourEmpireRaceAttributes` (`RaceSummaryPanel`) — race characteristics (racial characteristic INTENSITY/QUALITY, e.g. "Reckless"/"Cautious", "Unreliable"/"Dependable", plus racial bonuses); `lnkStartNewGameYourEmpireRace` — "Read more about this race...".

#### Step 5 — Your Empire

- `txtYourEmpireName` — "Empire Name" (hint: "Type the name of your empire here").
- `cmbPrimaryColor` / `cmbSecondaryColor` (`ColorDropDown`) — "Main Color" / "Secondary Color"; `cmbFlagShape` (`FlagShapeDropDown`) — flag shape.
- `cmbYourEmpireStartLocation` — "Galaxy Starting Location" (list depends on galaxy shape):
  - Elliptical: (Random), Deep Core, Outer Core, Inner Rim, Outer Rim
  - Spiral: (Random), Deep Core, Outer Core, Far Regions
  - Ring: (Random), Core, Void, Rim
  - Irregular: (Random), Center, Edge
  - (preview picture `picStartNewGameYourEmpireGalaxyLocation`)
- `tbarStartNewGameYourEmpireHomeSystem` — "Home System": **Harsh, Trying, Normal, Agreeable, Excellent** — "The favorability of your home system. In more favorable systems your starting colony will have higher quality and size… additional colonizable planets beyond your starting colony".
- `tbarStartNewGameYourEmpireSize` — "Size": **Random, Starting, Young, Expanding, Mature, Old**.
- `tbarStartNewGameYourEmpireTechLevel` — "Tech Level": **PreWarp, Normal, Level 1 … Level 7** (9 stops) — "Determines how advanced your research is".
- `tbarStartNewGameYourEmpireCorruption` — "Corruption": **Low, Normal, High, Very High** — "the level of corruption and income loss across your empire… only affects your empire" (others are always Normal).
- `cmbStartNewGameYourEmpireGovernment` (`GovernmentStyleDropDown`) — "Your Government", with "(Random)" null item; `lblStartNewGameYourEmpireGovernmentAttributes` — "Government Attributes" (bonuses/handicaps of the selected government: Approval, Population Growth, War Weariness, Research Speed, Corruption, Maintenance Costs, Troop Recruitment, Trade Bonus); `lnkStartNewGameYourEmpireGovernment` — "Read more about this Government type...".
- **Pirate factions only:** `cmbVictoryPiratePlayStyle` — "Pirate Playstyle": **Balanced, Pirate (Raider), Mercenary, Smuggler** (code enum `PiratePlayStyle: Balanced, Pirate, Mercenary, Smuggler`), with description panel + image:
  - Balanced: "no significant advantages or disadvantages… play as any of the other playstyles, but not quite as well"
  - Mercenary: "Focused on attack and defense missions. Good at capturing enemy ships and conducting raids. Can maintain a larger military fleet. Improved Weapons and Energy research, slow High Tech research."
  - Raider (Pirate): "The most 'nomadic' of the pirate playstyles. Focused on raids and ship and base capture… poor smugglers."
  - Smuggler: "The most peaceful of the pirate playstyles. Focused on smuggling and trade… bonuses to Energy and High Tech research. Fastest playstyle for taking over planets completely."
  - Pirate playstyles also set the pirate victory conditions ("Pirate factions compete against other pirate factions to achieve victory, NOT against standard empires").

#### Step 6 — Other Empires

- `chkOtherEmpiresAutogenerate` — "Auto-Generate Starting Empires" + `numAutogenerateEmpiresAmount` with labels "Generate **N** starting empires" (N = number of AI empires).
- OR ("OR specify the starting empires below") `ctlStartingEmpiresList` (`StartingEmpiresListView`) grid with columns **Name, Race, Government, Size, TechLevel, HomeSystem, Proximity, Remove**, plus **"Add New Empire"** button (`btnAddNewEmpire`) to hand-pick each competitor's race/government/size/tech/start-proximity.
- `chkGalaxyNewEmpiresDuringGame` — "Allow independent alien colonies to start new empires during the game" (help text: "New Empires appear during game").

#### Step 7 — Victory Conditions

Group panel "Victory Conditions Explanation" (left box: **"Leave all Victory Conditions unchecked to play in Sandbox mode (open play)"**):

- `chkVictoryTerritory` — "TERRITORY control XX%" of colonies in the galaxy (`numVictoryTerritoryPercent`).
- `chkVictoryPopulation` — "POPULATION control XX%" of galaxy population (`numVictoryPopulationPercent`).
- `chkVictoryEconomy` — "ECONOMY: private economy generates XX% of galaxy total" (`numVictoryEconomyPercent`).
- `chkVictoryEnableRaceSpecificConditions` — "Enable Race-specific Victory Conditions" (each race's unique victory).
- `cmbVictoryThresholdPercentage` + `lblVictoryThresholdPercentage` ("Victory Threshold Percent"): **75% / 80% / 85% / 90% / 95% / 100%** — "the proportion of the above victory conditions that must be met for victory".
- `chkVictoryTimeStart` + `numVictoryTimeStartYears` — "Victory Conditions apply after X years" (prevents early game-end).
- `chkVictoryTimeLimit` + `numVictoryTimeLimitYears` — "Time Limit: game finishes after X years" — "the winner is determined by the empire with the highest total strategic value of all its colonies".
- Story checkboxes: `chkStoryDistantWorlds` "Enable original Distant Worlds story events"; `chkStoryReturnOfTheShakturi` "Enable Return Of The Shakturi story events and victory conditions"; `chkStoryShadows` "Enable Shadows story events"; `chkVictoryEnableDisasterEvents` "Enable Disasters and other events" (Legends-era events); `chkVictoryEnableRaceSpecificEvents` "Enable race-specific events".
- **"Start the Game!"** (`btnStartNewGameStart`) → galaxy generation → first in-game screen.

#### Quick Start screen (`pnlQuickStart`)

Left: radio list of 12 preconfigured setups (exact names): **Fast, Conflict!, Epic, Expanding from the Core, Expanding Settlements, Fully Developed - Small, Fully Developed - Standard, Fully Developed - Large, Galactic Republic - Supreme Ruler, Galactic Republic - Wild Frontiers, Ring Race, Sovereign Territories - Minor Faction, Sovereign Territories - Regional Ruler** (each has a "Title" + "Detail" description, e.g. "QuickStart Title Conflict"). Bottom: `cmbQuickStartRace` ("Race" — pick a race or leave random, "About this Race..."), `chkQuickStartDistantWorldsStoryEvents` ("Distant Worlds original storyline"), `chkQuickStartReturnOfTheShakturiStoryEvents` ("Return Of The Shakturi storyline"). **"Start Game"** button generates the galaxy directly.

#### Jump Start (scenario shortcut)

Used by the six era buttons: pick Your Race (`cmbJumpStartYourEmpireRace`), Your Government (`cmbJumpStartYourEmpireGovernment`, with attributes + "Read more…"), galaxy shape (6 radios: Elliptical/Spiral/Ring/Irregular/Even Clusters/Varied Clusters), sliders: `tbarJumpStartTheGalaxyStarDensity` (Dwarf…Huge), `tbarJumpStartTheGalaxyDimensions` (Tiny…Huge), `tbarJumpStartTheGalaxyDifficulty` (Easy…Extreme), `chkJumpStartTheGalaxyDifficultyScaling`, and (pirates) `cmbJumpStartVictoryPiratePlayStyle`. Button: **"Start the Game!"**.

### 1.4 First in-game screen

- After loading, the game optionally shows the **Introduction screen** (`pnlIntroduction` BorderPanel with `btnIntroductionStart`) — sections "Introduction", "What You Should Do" ("Game WhatToDo Normal Classic"/"Pirate Classic"/"Normal Shadows"/"Pirate Shadows"), "Starting the Game" (`btnIntroductionStart` "Start Playing").
- Then the **Main screen** (see §2): Main View map, top status bar, scrolling message list, Empire Navigation Tool, selection panel, mini-map, diplomatic message stack.
- All ships start **fully automated** ("Note that after being built, all ships start off fully automated"; "Newly built ships are automated" is a game option), so the early game runs hands-off until the player takes control (tutorial: "When you first start Distant Worlds many tasks are automated for you. The automation of these tasks can be progressively turned off").

### 1.5 In-game flow (loop)

1. Player explores (exploration ships, automated or manual "Explore" missions) → discoveries create message pings (dashed blue expanding circles) for newly revealed locations.
2. Colonize (colony ships; "Colonize X", "Build and Send Colony Ship"), build mining stations (construction ships: "Queue nearest Construction Ship to build Mining Station here"), build space ports at colonies.
3. Grow economy: colony taxes (auto or manual per-colony tax rates), space port transaction fees, private ship purchases, trade bonuses.
4. Research (three tech trees: Weapons/Energy/HighTech; crash research 3× faster for credits) → new components/designs/facilities/capabilities.
5. Build ships/bases three ways: right-click "Build" submenu on a colony/space port; **Construction Yards** screen (F10, "Purchase" button, "Available Funds" flashes red if unaffordable); **Build Order** screen (F9, per-ship-type levels + advisor suggestions, "Purchase" button).
6. Design ships/bases in **Designs** (F8) / **Design Detail** (components, role, battle/invasion/flee tactics, warnings: red = rules, yellow = recommendations).
7. Expand with **Expansion Planner** (F3: resource supply/demand table + target lists + send colony/construction ships).
8. Diplomacy (F5: relations, treaties, gifts, warnings, trade proposals: map/tech swaps), or war (attack/bombard/capture/blockade missions; fleets with Attack/Defend postures).
9. Intelligence agents (F4: espionage missions with target empire, mission type, optional specific target, time allowed, success-probability estimate), counter-intelligence.
10. Troops: recruit/garrison/disband at colonies (F2 Troops tab; right-click colony → "Recruit Troops"), load onto troop transports, invade enemy colonies (ground combat).
11. Pirates: protection agreements, mercenary smuggling/attack/defend missions (action buttons "Assign Mercenary Smuggling/Attack/Defense Mission"), raids (Alt+right-click), colony control, pirate bases/fortresses, Criminal Network.
12. Save/Load/Options/Editor via the **Game Menu** (top-left button or Escape): "Resume Playing", "Save Game", "Save Game As", "Load Game", "Options", "Enter Game Editor" (password-protected: "Enter Editor Password"), "Exit to Main Menu", "Exit Distant Worlds". Confirmation prompts: "Are you sure that you wish to exit to the main menu?" / "…exit this game?" ("current game will be lost unless you first save it").
13. Victory: any enabled victory condition (Territory/Population/Economy %/race-specific) reached at or above the **Victory Threshold Percent**, or time limit expiry (winner = highest total strategic value), or story endings (e.g. "You have Defeated the Shakturi!"). Defeat = losing all colonies ("When you lose all of your colonies, you lose the game"; "Your empire has been completely wiped out!").

### 1.6 Game end

- `Galaxy.GameEnd` → `Main.DoGameEnd()`: sets `IsFinished`, stores `VictorEmpire`, plays the victory/defeat theme, then shows the **game-end panel** (`pnlGameEnd`, a full `BorderPanel` over the main view) with a title + flavor text and two buttons:
  - `btnGameEndContinue` — "Continue Playing..." (sandbox mode: keep playing after the end).
  - `btnGameEndExit` — "Exit to Main Menu".
- Flavor strings in code: "WINNER!", "Victory", "Defeat", "You won!", "You have failed!", "Your failure is complete!", "Your enemies tremble before your mighty fleets!", "You're the big chief now", "Perhaps galactic conquest just isn't your thing...", "Winner is the empire with the greatest strategic value at this time" (time-limit/sandbox), "SANDBOX MODE", "To win - Start Date", "You are ruler of …", "Congratulations to our new galactic ruler!", "Welcome to our new Galactic Emperor!", plus per-victory-type intro labels ("Game Intro Victory" / "...Territory" / "...Population" / "...Economy" / "...Race" / "...Time Limit" / "...Pirate") and enemy taunts ("You lost - ha ha!", "How could you lose when you had such a big headstart?", "You move slower than a blind space slug!", …).
- Storyline endings: "You have Defeated the Shakturi!" / "The Shakturi have defeated the Freedom Alliance!" / "The Shakturi have Returned for Revenge!", with extra story-event dialogs (e.g. "Yes, we will unite to fight the Shakturi!", "Yes, our dire situation calls for the use of this superweapon!").

---

## 2. MAIN MAP INTERFACE

### 2.1 The Main View (`mainView`, a `MainView` custom-drawn `Panel`)

The entire map is one custom control rendered with GDI+ and an XNA/SlimDX sprite path (`DrawMainViewXna`, `DrawMainView`), not child controls. It holds the current `Galaxy`, `SystemInfo`, `Habitat`, `BuiltObject`, `ShipGroup`, `Creature`, `LightningGenerator`, `NebulaCloudGenerator`, `SectorCloudGenerator`, `StarFieldItemList` (4 layers) and all preprocessed image caches (planets with rings/shadows, built-object sprites, fighter sprites, nebula clouds, backdrop).

**Zoom model:** a continuous zoom factor from 100% (planet/ship level) up to full galaxy. Zoom presets (buttons `btnZoomIn`, `btnZoomOut` and keys):
- **Home** → "Zoom to 100%"
- **Insert** → "Zoom to System"
- **Delete** → "Zoom to Sector"
- **End** → "Zoom to Galaxy"
- **Backspace** → "Zoom to the selected item"
- `btnZoomSelection` ("Zoom to selected item"), `btnZoomSystem` ("Zoom to System"), `btnZoomRegion` ("Zoom to Sector"), plus `btnZoomColony` (zoom to a colony — used with the Expansion Planner / colony selection) and `btnLockView` ("Lock/unlock view on selected item", tooltip "View locked on SELECTED").

**What is drawn at each level:**

1. **System view (100% and zoomed in)** — top-down 2D: the central star (with animated effects: lightning for certain stars), planets/moons/asteroids/gas clouds on visible orbital rings (planetary rings via `PlanetaryRingsGenerator`), nebula clouds (`NebulaCloudGenerator`, toggleable "Display nebulae clouds in systems" + "System Nebulae Detail" Low/Medium/High), space creatures, fighters, explosions, weapons fire (beams/torpedoes/area weapons/tractor beams via `StellarObject`+`Weapon` draw paths), and ships/bases as sprite images.
   - Colonies show a **colored name badge**: name at top; **gold star** to the left of the name if it is the **empire capital**; empire flag at top-right of the badge; bottom-left: **dominant race** + a **5×5 population/development graph** (columns = population: 0–20M, 20M–100M, 100M–500M, 500M–2.5B, >2.5B; rows = development: 0–20%, 20–40%, 40–60%, 60–80%, 80–100%); bottom-right: **resource pictures** for the world's resources; the owning empire is shown by the **color of the surrounding circle and badge**.
   - Ships/bases: sprite + **empire flag at top-left corner** (no flag if independent); **shields shown as a solid blue line above the ship** (damage portion in red). Empire flags are hidden at system zoom to reduce clutter — "hold down either of the shift keys" to show them all, or they appear when the mouse is close.
   - A **dashed gray range circle** shows the selected ship's movement range; **blue circular icons** next to system names mark refuelling points at galaxy zoom.
2. **Sector view** — the galaxy is a grid of sectors (the Galaxy Map article says "The galaxy is divided into a 10×10 grid of sectors"; sector boundary lines appear light blue). Each **system** is drawn as a node:
   - **Systems you control**: colored background (your empire color); within controlled territory only **space ports and fleets** are drawn as icons (other friendly ships hidden to cut clutter).
   - **Colonized systems** of any empire: circled in the **empire's color**; "The size of the circle indicates the system's relative importance - larger systems are more valuable".
   - **Independent systems** (alien colonies of no empire): circled with a **solid grey line** — "good targets… the aliens provide a critical boost to the population".
   - **Systems with potential colonies**: **dashed grey circle**.
   - **Empire territory** (uncolonized systems within colony influence): **colored background** of the owning empire.
   - **Unexplored systems**: no name displayed; **explored systems**: name displayed next to them.
   - Ships/bases are **circular icons**; icon **color**: **blue = your empire**, **yellow = neutral empires**, **red = enemy empires or pirates**.
   - **Fleets**: **inverted triangle icon with the ship count inside**; selecting a fleet at sector level = click the icon; double-clicking any member ship at system level selects the whole fleet.
3. **Galaxy view** — whole galaxy: stars as colored points (yellow main sequence, red giant/supergiant, white dwarf/neutron white, light-blue supernovae, light-pink gas clouds), territory-tinted system regions, sector grid, and the same blue/yellow/red icons for ships/bases (which icon classes appear is controlled by Advanced Display Settings, see §3.13).

**Map overlays** (toggled by the 8 top buttons `btnMapOverlay1..8` + `btnMapCivilianFade`, backed by `GameOptions` booleans; when on they add layer info in the main view at sector/galaxy zoom):
- "Fade Civilian ships and bases" (`MapOverlayFadeCivilianShip`)
- "Show Fleet Postures" (`MapOverlayFleetPostures` — defend area = blue circle, attack route = dotted red line)
- "Show Travel Vectors State" / "Show Travel Vectors Private"
- "Show Potential Colonies"
- "Show Potential Resort Locations" (Scenic Locations)
- "Show Research Locations"
- "Show Long Range Scanners"
- "Show Empire Territory" (Empire Influence)

**Mini-map** (bottom-right, `pnlSystemMap` BorderPanel containing `picSystem`, a `SystemView` control): shows the surrounding area — the current system (planets/moons) when zoomed in, or sector/galaxy when zoomed out; the currently visible main-view area is a **light blue rectangle** in the middle; **click anywhere on the map to move the main view** ("Map: click to move view to a new location"); it auto-zooms with the main view. Alongside/above it: the zoom preset buttons and the "Map Key" button (`btnGalaxyMapKey` → `pnlGalaxyMapKey` with a `MapKey` legend: the full color legend, title from `lblGalaxyMapKeyTitle`, close button).

**Colors/legend (mini-map + map key):**
- System zoom: Green = Continental; Yellow = Marshy Swamp; Light Brown = Sandy Desert; Dark Blue = Ocean; Light Blue = Ice Glacial; Orange = Volcanic; Grey = Barren Rock/asteroids; Red = Gas Giant (+ Red Giant & Super Giant stars); Pink = Frozen Gas Giant.
- Sector/galaxy zoom: Yellow = Main Sequence stars; Red = Red/Super Giants; White = White Dwarfs & Neutrons; Light Blue = Supernovae; Light pink = Gas Clouds.

### 2.2 Navigation (how you move the camera)

- Move the mouse pointer to the **edge of the screen** → view pans that direction (scroll speed set in Display Settings).
- **Right-button drag** → pan.
- **Arrow keys** → pan.
- **Mouse wheel** → zoom in/out (behavior selectable: "No movement" / "Move to selected item" / "Move to mouse cursor location").
- **Ctrl + left-click** → center on that location and zoom in to 100% ("You can zoom in to any location by holding down the 'Ctrl' key while clicking").
- Page Up/Page Down → zoom out/in; +/− → game speed.
- Clicking the **mini-map** or double-clicking items in Empire Navigation lists moves the view.

### 2.3 Selection & hover

- **Left-click** selects the item under the cursor → the **Selection Panel** (bottom-left, `pnlInfoPanel` `InfoPanel` + `pnlDetailInfo` `HoverDetail` expandable detail) shows its full readout (see §3.10). If several ships/bases overlap at the clicked point, a **popup list** appears to pick one ("If more than one ship or base is at the same location where you clicked then a popup menu will appear listing all the ships and bases at the location").
- **Hover** over any item → a **hover summary** appears at the **bottom-middle of the screen** (rendered by `HoverPanel`, `mainView.HoverMessageLocation`) and a `Hotspot` (rectangle + related object + hover message) drives the hover detection for the mini-map, galaxy map and detail panels.
- **Right-click**:
  - If a ship/base is selected → the **ship action menu** (`actionMenu`, a `ContextMenuStrip`) pops up with mission options (see §5.2).
  - If no item is selected → **centers the view on the mouse pointer position** (help text: "or if no item is selected it centers the view on the mouse pointer position").
  - **Ctrl + right-click** forces the full mission popup even when a single default mission would apply ("You can also force a pop-up menu to appear with all available missions for the selected ship by holding down the Ctrl key and right-clicking"; in-game hint "Ctrl-Right-click for more missions").
  - Right-click on a **target while a ship is selected** assigns the **default mission** for what the mouse hovers over: e.g. military ship hovering an enemy target → "Attack"; hovering nothing → "Move". The default mission is often signalled by a **cursor change**.

### 2.4 Right-click context menus (exact items from source strings)

**Ship / fleet action menu** (`actionMenu`), context-dependent — items and submenus actually emitted by the code:

- **Move to X / "Move here"** — with subitems: "At X", "At nearest colony", "At your nearest Space Port", "Move to mouse cursor location", "Move to selected item".
- **Attack X** / **Prepare and Attack X** (WaitAndAttack).
- **Bombard X** / **Prepare and Bombard X** (only if the group has bombard power) — Shift-click on a colony gives Bombard directly.
- **Capture X** / **Raid X** (only if boarding-assault strength > 0; Raid = pirates only, Alt-click) — Shift-click on a ship/base gives Capture.
- **Blockade X** (only vs. empires under trade sanctions).
- **Escort X**, **Patrol X** (hover your own colony/base), **Explore** ("Explore nearest system", "Nearest unexplored system").
- **Colonize X** ("Build new Colony Ship and Colonize X", "Build and Send Colony Ship" — "SHIPNAME colonizing PLANETNAME" status line), "Recruit Troops at X", "Load Troops at X" / "Unload Troops at X" (subitems "At nearest colony with available troops", "At X"), "Deploy at X" / "Undeploy".
- **Refuel** ("At nearest refuelling point", "Refuel at X", "Refuel all ships"), **Repair** ("Repair and Refuel damaged ships" with subitems "At X", "At nearest ship yard", "At your nearest Space Port"; "Repair damaged ships").
- **Build** ("Build here", "Build at X", "Queue nearest Construction Ship to build Mining Station here", "Queue construction ship to build a DESIGN here", "Build new ship or base", "Build new civilian ship", "Build new bomber", "Build new fighter").
- **Retrofit** ("Retrofit to latest design(s)", "Retrofit Selected Items to New Design", "At X"/"At nearest ship yard").
- **Retire** ("Retire selected ships?" confirm, "Retiring ships permanently removes them from the game"), **Scrap** ("Scrap Ship immediately" / "Scrap Base immediately" — "Scrapping ships and bases permanently and immediately removes them from the game"; "The purchase cost will not be refunded if you scrap this ship"), **Escape** ("Escape from attackers").
- Fleet items: **Join Fleet** (submenu of all fleets + "(New Fleet)" / "New Fleet" / "Nth Fleet"), **Leave Fleet** ("Leave FLEETNAME"), **Make lead ship for FLEETNAME**, **Join nearest Fleet**, **Disband Fleet**, **Set Home Base** ("Set Home Base X", "valid home base is friendly refueling point"), **Set Attack Target** ("Set Fleet Target X", "valid target is colony or base of another empire"), **Set Posture**, **Set Range**, **Refuel and Repair Fleet**, "Retrofit fleet to latest designs".
- "Return to base ({0})", **"Clear All Queued Missions"**, **"Queue Next Mission"**, **"Automate"** / **"Turn off automation"** / "Automate all ships" ("Would you like to turn off automation" prompt), "Retire all ships".
- Mercenary (player empires): **"Assign Mercenary Attack Mission"** / **"Assign Mercenary Defense Mission"** / **"Assign Mercenary Smuggling Mission"** and their "Cancel Mercenary … Mission" counterparts.
- "Stop" (S key: "Stops the selected ship, cancelling the current mission").

**Selection/other-object menu** (`selectionMenu`) — right-click on a **colony/planet/base/system/creature/ruin** (with or without a ship selected) offers type-appropriate actions, including:
- Colony: "Recruit Troops", "Change Colony Tax" / "Change Colony Tax Rates", "Build new planetary facility", "Build planetary facilities", "Build Wonders", "Build new Wonder", "Deploy PLAGUE at this colony" (event action), "Set as Home Colony", "Select new home colony", "Go to Colony", "Show On Galaxy Map", "Show Expansion Planner", "Show Ruin Details", "Recruit Agent"/"Disband Agent", "Transfer Character to Location", "Build new colony ship…", pirate-control related ("Control"), "Have Revolution and switch to GOVERNMENT".
- Base/yard: "Build at X", "Build new ship or base", "View Docking Bays", "View Fleet", "Investigate Base", "Go to Base", "Set as Home Base", "Queue construction ship to build…/Repair X", "Recruit Troops" (at bases), "Build new civilian ship", "Build new planetary facility".
- Target objects: "Investigate Ship" / "Investigate Base" / **"Investigate Ruins"** (discovery behavior per Your Empire Settings: "Ask what to do" / "Investigate - show all results" / "Investigate - report discoveries" / "Investigate - report major discoveries" / "Investigate - do not show results"; abandoned ships/bases: "Leave the Ship alone" / "Leave the Base alone" / "Leave the Ruins alone" + investigate variants), "Destroy X".
- "Go to Location", "Go to Event Location", "Go to Event Target", "Go to Facility", "Go to Fleet", "Go to Research Station", "Go to Resource Location", "Go to Resource Target", "Go to Troop", "Go to selected item", "Go to X system".
- "Transfer" (troops to a listed transport), "Garrison selected troops" / "Ungarrison selected troops", "Disband Selected Troops", "Load Character image", "Disband Selected Character".
- "Buy information" / "Swap maps or tech" / "Swap Galaxy maps (all exploration)" / "Swap Territory maps (empire systems)" (intelligence/selling info).

**Other-empire right-clicks** (hovering their assets) yield the military missions against them (Attack/Bombard/Capture/Raid/Blockade/Escort/Investigate) per the default-mission logic; right-clicking an **enemy fleet target in the ENT** assigns/ cancels attacks (§3.5). Right-click on **empty map space** with a ship selected = Move; with nothing selected = recenter view.

### 2.5 Top status bar & toolbars (exact controls)

Top labels: `lblSystemName` (system being viewed), `lblStarDate` (game date), `lblStateMoney` (state credits + cashflow + "This Year's Bonus Income"), `lblPrivateMoney` (private economy), `lblGodData` (hidden debug label), plus `DrawUPS` (updates-per-second, dev build).

Top-left column of `GlassButton`s: `btnGameMenu` ("Game Menu" — "Show Game Menu: load & save, options, exit"), `btnHelp` ("Open Galactopedia Help screen"), `btnPlayPause` ("Pause the game"/"Resume the game", Spacebar), `btnGameSpeedIncrease` ("Increase game speed", +), `btnGameSpeedDecrease` ("Decrease game speed", −).

Top toolbar (below the scrolling message list) — screen openers (`tbtn*`): **tbtnEmpires** (Empire Summary, F6), **tbtnColonies** (F2), **tbtnBuiltObjects** (Ships and Bases, F11), **tbtnShipGroups** (Fleets, F12), **tbtnConstructionYards** (F10), **tbtnDesigns** (F8), **tbtnResearch** (`ResearchButton`, F7), **tbtnTroops** (Troops), **tbtnIntelligenceAgents** (F4), **tbtnGalaxyMap** (G), plus `btnEmpireSummary` (F6 "Open Your Empire Summary screen"), `btnEmpirePolicy` (Empire Policy), `btnEmpireGraphs` (Empire Comparison/Victory, V), `btnExpansionPlanner` (F3), `btnBuildOrder` (F9), `btnHistoryMessages` (Message History, H), `btnGalacticHistory`, `btnGameEditor` ("Enter Game Editor" / "Switch to Game Editor", password-gated), `btnHelp`, `btnHistoryMessages`, `btnLockView`, `btnMainViewDisplayToggle` ("Toggle display detail level" — D key), `btnMapCivilianFade` ("Fade civilian ships and bases"), `btnMapOverlay1..8` (the 8 overlay toggles), zoom buttons (`btnZoomIn/Out/Region/Selection/System/Colony`), `btnSelectNearestMilitary` ("Select nearest available military ship", Z).

Cycle buttons (left column, above the selection panel; each has a paired "previous" button; hotkeys with Shift = backwards, Ctrl = cycle and move view):
- `btnCycleColonies` / Back — "Next Colony" (C)
- `btnCycleBases` / Back — "Next Space Port" (P)
- `btnCycleMilitary` / Back — "Next Military ship" (M)
- `btnCycleConstruction` / Back — "Next Construction ship" (Y)
- `btnCycleOther` / Back — (other bases: research/monitoring/resort/defensive)
- `btnCycleShipGroups` / Back — "Next Fleet" (F)
- `btnCycleIdleShips` / Back — "Next Idle ship" (I)
- `btnCycleColonies`+`btnCycleOther` share the "Next Exploration or Colony ship" (X) group,
- `btnCycleShipStance` — "Change engagement stance" (comma key),
- `btnSelectionBack` / `btnSelectionForward` — "Previous selected item" / "Next selected item" (B / N),
- `btnSelectionPanelSize` — "Shrink Selection Panel"/"Enlarge Selection Panel",
- `btnLockView` — "Lock/unlock view on selected item" (L).

**Selection Action buttons** (`btnSelectionAction1..8`) — a dynamic row under the Selection Panel that changes per selection type (ships: Repair and Refuel, Retrofit, Load troops, Toggle Automation, Construction, Fighters, Refuel, Esc, etc.; see §3.10).

**Scrolling message list** (`lstMessages`, `ScrollingLinkList`) — top of screen, "displays the five most recent messages… Click on a message to move to the location of the message event or to open an appropriate screen" ("Messages: click a message for more information").

**Diplomatic message stack** (`diplomaticMessageQueue_0`, `DiplomaticMessageQueue`) — top-right, 300px-wide stacked cards (up to 7 rows at ≥768px tall): treaty offers, gifts, warnings, pirate protection offers, trade proposals, etc. Click a message to open the conversation screen.

**Story event bar** (`pnlStoryEvent` + `btnStoryEventAction`, `lblStoryEventTitle`, `btnStoryEventClose`) — full-screen story overlays (Shakturi events, planet-destroyer warnings, "You must decide...").

**Advisor suggestion popup** (`pnlAdvisorSuggestion` with `btnAdvisorSuggestionApprove` "Approve", `btnAdvisorSuggestionDecline` "Decline", `btnAdvisorSuggestionShow` "Show") — advisor suggestions (build orders, colonies, facilities, treaties, gifts, targets…) when automation is set to "advisor suggests" mode.

**Message popup** (`pnlMessagePopup`, `MessagePopup` control) — "appears in a popup panel that slides in at the right of the screen"; click to jump to the event location; "Under attack!" etc.

**Game Event panel** (`ynbOfkDbGY` hosting `ctlGameEvent`, `GameEventPanel`) and **pnlEventMessage** (`BorderPanel` with `btnEventMessageInvestigate` / `btnEventMessageAvoid` / `btnEventMessageGoto` / `btnEventMessageClose`) — event decisions (e.g. "When encounter Ruins": Investigate / Leave alone / Ask what to do).