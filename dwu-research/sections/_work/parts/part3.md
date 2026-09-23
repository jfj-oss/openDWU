---

## 4. MOUSE ACTIONS (UI_MouseActions, verbatim + code-verified)

From the in-game help (UI_MouseActions.mht), verbatim:

> You can use the mouse to move around, select items and give commands. Most commonly you will use the following actions:
> - Moving the mouse pointer to the edge of the main screen will cause the view to move in that direction.
> - You can also move the main view by holding down the right mouse button while dragging.
> - Hovering over an item in the main view displays summary information about the item at the bottom-middle of the screen.
> - Left-clicking selects the item under the mouse pointer, displaying detailed information in the Selection Panel at the bottom left of the screen.
> - Right-clicking displays a pop-up menu with actions appropriate to the selected item, or if no item is selected it centers the view on the mouse pointer position.
> - The mouse scroll wheel zooms the main view in and out from 100% (individual planets and ships) to full galaxy view, and any zoom level in between.

Additional behaviors (from tutorials + decompiled code):
- **Ctrl + left-click** a location: "You can zoom in to any location by holding down the 'Ctrl' key while clicking."
- **Shift + left-click** a ship/base: multi-select (shift-click adds to selection; drag-select box also works).
- **Shift + right-click** on a target with a military ship selected → **Bombard** (colony/planet) or **Capture** (ship/base) instead of the default attack ("you can use the Shift key to change the right-click menu… Shift-right click to bombard or capture").
- **Alt + right-click** (pirates only) → **Raid**.
- **Ctrl + right-click** → force the full mission popup menu even when one default mission would be chosen; in-game hint: "Ctrl-Right-click for more missions".
- Right-clicking a target while a ship is selected assigns the **default mission** determined by the hovered object (enemy → Attack; your own colony/base → Patrol/Build/etc.; empty space → Move), often indicated by a cursor change.
- If multiple ships share the clicked location, a **popup list** lets you pick one.
- Mini-map click → move view; map item double-click → select + move; ENT item double-click → "click to select item, double-click to move view"; shift-click an ENT item → multi-select; right-click an ENT entry → cancel its mission/assignment.
- Tutorial window is draggable; the selection panel can be shrunk/enlarged via `btnSelectionPanelSize`.

## 5. KEYBOARD COMMANDS (UI_KeyboardCommands, verbatim table)

| Key | Action (verbatim) |
|---|---|
| F1 | Galactopedia Help screen |
| F2 | Colonies screen |
| F3 | Expansion Planner screen |
| F4 | Intelligence Agents screen |
| F5 | Diplomacy screen |
| F6 | Your Empire Summary screen |
| F7 | Research screen |
| F8 | Ship Designs screen |
| F9 | Build Order screen |
| F10 | Construction Yards screen |
| F11 | Ships and Bases screen |
| F12 | Fleets screen |
| G | Galaxy Map screen |
| H | Message History screen |
| V | Empire Comparison and Victory Conditions screen |
| O | Game Options screen |
| Pause or Spacebar | Pauses or resumes the game |
| Escape | Displays the Game menu |
| Arrow keys | Scrolls the main view up/down/left/right |
| Backspace | Zooms to the selected item |
| Insert | Zooms the main view to System level |
| Delete | Zooms the main view to Sector level |
| End | Zooms the main view to Galaxy level |
| Home | Zooms the main view to 100% |
| Page Up | Zooms the main view Out |
| Page Down | Zooms the main view In |
| + | Increases game speed by one level |
| – | Decreases game speed by one level |
| N | Move forward in selection history |
| B | Move backward in selection history |
| L | Locks/unlocks the main view on the currently selected item |
| Z | Selects the nearest available military ship to the current location |
| C | Cycles your Colonies in the selection panel (Shift cycles backwards, Ctrl cycles and moves view) |
| P | Cycles your Space Ports in the selection panel (Shift backwards, Ctrl cycles + moves view) |
| M | Cycles your Military ships (same modifiers) |
| Y | Cycles your Construction ships (same modifiers) |
| X | Cycles your Exploration and Colony ships (same modifiers) |
| F | Cycles your Fleets (same modifiers) |
| I | Cycles your Idle ships (same modifiers) |
| E | Commands the selected ship to Escape from attackers |
| R | Commands the selected ship to Refuel at the nearest refueling point |
| A | Automates the selected ship |
| S | Stops the selected ship, cancelling the current mission |
| comma (,) | Cycles the engagement stance of the selected ship ("Cycles the engagement stance of the selected ship or fleet") |
| Shift + right-click | Bombard/Capture (see §4) |
| Alt + right-click | Raid (pirates) |
| Ctrl + right-click | Full mission popup |
| Ctrl + left-click | Zoom to location at 100% |
| Ctrl (with zoom keys/buttons) | cycles-and-moves variants of C/P/M/Y/X/F/I |

Tutorials confirm the same mappings ("Use the Cycle Construction Ships button… or use the 'Y' key", "press the 'F2' key", "F12", "F11", "F4", "F6", "F5", "F8", "F9", "F10", "F3", "press the 'A' key", "F1").

## 6. SHIP MISSION UI (UI_ShipMissions + UI_ShipMissionTypes + code enums)

### 6.1 How mission assignment works

- Missions can be assigned to **any state-owned ship or base** — "this does NOT include privately-owned ships like freighters, mining ships or mining stations. You have no control over these privately-owned ships and bases. They go about their business automatically, selecting missions for themselves."
- Method 1: select the ship (left-click), then **right-click the target** → default mission (Move / Attack / Patrol / Build …) based on the hovered object; "Note that you may need to unpause the game to see the ship move."
- Method 2: **right-click the ship or base** → popup menu "listing a number of missions… specific to the particular type of ship or base. They may include: Exploration, Colonization, Building, Refueling, or many others."
- Method 3: **automate** — "Ships can also be completely automated. This means that they assign missions for themselves… select it and then press the 'A' key. To turn off automation just assign a mission to the ship. When a ship is automated a circular blue arrow appears in the bottom-right corner of the Selection Panel. Note that ALL ships start the game automated."
- Bases: "Although bases are stationary, they can also have missions. Base missions can include: building new ships, retrofitting to a new design or scrapping the base when it is no longer needed."
- Queuing: "Queue Next Mission" / "Clear All Queued Missions" — missions execute in order; the action menu groups related missions (e.g. "Return to base ({0})" with the gather point).
- Mercenary (player empires acting as hired muscle): "Assign Mercenary Attack Mission" / "Assign Mercenary Defense Mission" / "Assign Mercenary Smuggling Mission" + "Cancel Mercenary … Mission" items.

### 6.2 All mission types

The code enum `BuiltObjectMissionType` (31 values): Undefined, **Explore, Build, BuildRepair, Transport, Patrol, Escort, Rescue, Blockade, Attack, Escape, Retire, Retrofit, Colonize, Waypoint, Hold, WaitAndAttack, WaitAndBombard, MoveAndWait, Refuel, ExtractResources, LoadTroops, UnloadTroops, Deploy, Undeploy, Repair, Move, Bombard, Capture, Reinforce, Raid**.

The 17 player-facing missions (UI_ShipMissionTypes.mht, verbatim summaries) and how each dialog works:

1. **Move** — "moves the ship to the target location" — right-click anywhere.
2. **Explore** — "explores the target location, revealing… systems" — submenu "Nearest unexplored system" / target system.
3. **Patrol** — "patrols the target area" watching for attackers — hover your colony/base/fleet; engagement stance applies.
4. **Escort** — "escorts the target ship" — target selection = pick a ship (auto-generated escort ships for convoy); sub-options on destination ("Move to mouse cursor location", "Move to selected item").
5. **Attack** — "attacks and destroys the target" — submenu "Prepare and Attack" (WaitAndAttack: fleet assembles before engaging) and "Prepare and Bombard"; target must be an enemy.
6. **Bombard** — "bombards the target colony from orbit, destroying surface facilities and population" — requires bombard weapons.
7. **Capture** — "boards and captures the target ship or base" — requires boarding-assault strength; captured assets can be "Enlist captured Military ships / Civilian ships / Bases" or "Scrapped" ("Captured Ship Scrapped" / "Captured Base Scrapped").
8. **Raid** (pirates) — "raids the target, stealing resources and troops".
9. **Blockade** — "blockades the target system/colony" (only vs. empires under your trade sanctions).
10. **Escort/Patrol stances**: per-ship **engagement stance** (`BuiltObjectStance`: DoNotAttack / AttackIfAttacked / AttackEnemies / AttackUnallied) cycled with comma; defaults per mission type from Empire Settings.
11. **Refuel** — "refuels at the target refuelling point" — submenus "At nearest refuelling point", "Refuel all ships" (fleet), "at X".
12. **Repair** (BuildRepair) — "repairs damaged components" — "At X", "At nearest ship yard", "At your nearest Space Port".
13. **Build** — construction ships: "Build here", "Build at X", "Queue nearest Construction Ship to build Mining Station here", "Queue construction ship to build a DESIGN here" (mining stations, space ports at colonies, pirate bases).
14. **ExtractResources / mining** (private mining ships automate this; player ships can "Mine X").
15. **Transport / LoadTroops / UnloadTroops** — "Load troops at X" / "Unload troops at X" (sub: "At nearest colony with available troops"); troop transports shuttle garrison troops.
16. **Colonize** — colony ships: "Colonize X", "Build new Colony Ship and Colonize X" (auto-queue a colony ship at a colony), status lines "SHIPNAME colonizing PLANETNAME" / "…building at COLONY to colonize PLANETNAME"; the ship is consumed (or partially — resources kickstart the colony).
17. **Deploy / Undeploy** (troop transport deploy mode), **Hold/Waypoint/MoveAndWait**, **Escape** (E key), **Retire** ("Retiring ships permanently removes them from the game" — confirmation), **Retrofit** ("Retrofit to latest designs" / "Retrofit Selected Items to New Design" via the Retrofit screen), **Reinforce** (fleet), **Rescue** (distress signals: "Under Attack", "Need Refuelling", "Need Repair", "Galactic Disaster", "Colony Bombarded" — `DistressSignalType`).

### 6.3 Fleet missions & tactics

Fleet action items: "New Fleet" (from selected ships, via Action button or right-click → "Join Fleet"), "Join Fleet" (submenu of all fleets + "(New Fleet)" + "Nth Fleet"), "Leave Fleet" ("Leave FLEETNAME"), "Make lead ship for FLEETNAME", "Disband Fleet", "Retrofit fleet to latest designs", "Refuel and Repair Fleet". Fleet properties: **posture** (Attack/Defend), **range**, **home base** ("Set Home Base" — "valid home base is friendly refueling point"), **target** ("Set Attack Target" — "valid target is colony or base of another empire"), **tactics** (`BattleTactics`: Evade / Standoff / All Weapons / Point Blank). "Fleet Attack Settings": assemble threshold ("First assemble when this percentage of fleet dispersed"), refuel threshold ("First assemble when this percentage of fleet need fuel"), "Attack OverMatchFactor" (firepower overmatch, e.g. 2:1). Automated fleets intercept: "Your automated fleets will respond to intercept enemy attacks when there are insufficient forces to defend the target. The nearest available automated fleet will travel to the attack location and defend the target."

### 6.4 Mission UI dialogs

- Mission **queue view** (`BuiltObjectMissionView`) lists current + queued missions with target, priority, ETA; hover shows details.
- **Mercenary smuggling setup** (`pnlPirateSmugglingMissionResourceSelection`): resource dropdown, amount, bid ("Bid PRICE credits"), "for X credits per 100 units", "Smuggling Mission for RESOURCE for PRICE"; "Delivery Report" messages on completion ("Smuggling Mission Delivery Report", "…Report For Requester").
- **Escort target selection**: from the Escort submenu or "Set Attack Target"/home-base dialogs; the dialog lists candidate ships/targets (e.g. "Assigned to: EMPIRE", "Current bid: EMPIRE").

## 7. TUTORIALS (all 11, from the in-game tutorial scripts)

The tutorial system shows a draggable **tutorial window** (`pnlTutorial`) with step text and a **'Continue'** button ("To progress through each step of this tutorial click the 'Continue' button. You can move this tutorial window by dragging it with the mouse."). Launched from the main menu's Tutorials list; each corresponds to a `TutorialItemList` (Tutorial.cs). Systems covered:

1. **basic.txt** ("Distant Worlds Tutorial" / the core intro): the four key areas ("Explore the galaxy, Colonize new planets, Extract valuable resources, Defend your empire"); moving around (edge-scroll, arrow keys, right-drag); zooming (mouse wheel, PageUp/PageDown, ZoomIn/ZoomOut buttons); **system view** (identify colonies/ships by empire main color; Ctrl-click to zoom in); **sector view** (systems as icons; "The icon color indicates which empire the ship or base belongs to"); explored systems show names, unexplored don't; colonized systems "circled with their empire's color… The size of the circle indicates the system's relative importance"; **Empire Territory** ("Systems that are part of an empire's territory have a colored background… Colonies project their empire's influence into nearby systems"); independent systems "circled with a solid grey line… the aliens provide a critical boost to the population"; potential colonies "indicated by a dashed grey circle… Build a new colony ship and send it to these uninhabited planets"; **zoom presets** (100%, system, sector, galaxy); **Galactopedia** (F1/Help button, context-sensitive help); main screen elements; cycle buttons and hotkeys (C, P, M, Y, X, I — "Use the Cycle Construction Ships button… or use the 'Y' key"); military ship missions (Attack, Patrol, Escort); finding idle ships (I key); ending: try the Advanced Tutorial.
2. **FindingYourWayAround.txt**: same movement/zoom/navigation material as basic (the "find your way around" variant), plus main-screen elements.
3. **EmpireAndColonies.txt**: Empire Summary (F6); **State vs Private** ("Your empire is divided into two sections: State: the portion you control, Private: your private citizens who go about their own business without your help"); private citizens "trade goods, transport cargo and mine resources - all without any intervention from you"; state's four tasks; **government style** ("You can change your government style by having a revolution. But there are negative side effects from revolution, including a temporary setback of development at your colonies"); **state income** (colony taxes, space port transaction fees, purchases of new ships by private citizens, bonuses from trade with other empires); **colonies** ("Colonies are the heart of your empire. When you lose all of your colonies, you lose the game."); taxes (auto by default, per-colony override); growth (population to planet max; development level from luxury resources → more wealth → more tax); **population indicator** ("The population size and development level of a colony is indicated by the graph displayed in the colony's name badge. The horizontal axis indicates the population size. The vertical axis relates to the development level."); **empire & capital** ("the color of the surrounding circle and name badge… If the colony is the empire capital a gold star also appears to the left of the name"); **dominant race** and **resources** at the bottom of the name badge (auto-mined, used or sold); **colony list** (Colonies screen, F2) and cycling (C key).
4. **ShipsAndMissions.txt**: ships travel "performing a wide range of tasks, from transporting cargo to defending your empire"; bases "are fixed platforms in space, usually located at a planet"; Ships and Bases screen (F11); Designs screen (F8); mission assignment: state ships only, not private; "To assign a mission to a ship first select it… Then right-click the mouse over the mission target"; popup menu on right-click of the ship ("Exploration, Colonization, Building, Refueling, or many others"); **automating** ("press the 'A' key… a circular blue arrow appears in the bottom-right corner of the Selection Panel… ALL ships start the game automated"); base missions (building, retrofitting, scrapping); ship classes: Exploration ships (chart unknown areas; X key), Colony ships (consumed on colonization, "The resources from the ship are used to give the colony a kickstart… Colony ships can only be built at colonies"; start with native planet type; can always colonize planets with independent alien populations "the preexisting population may resist your colonization attempt, with the loss of your colony ship"), Construction ships (build bases/mining stations), Space ports (at colonies: "build new ships, repair and retrofit ships, refuel ships, and conduct research"), Mining ships/stations, Freighter/passenger, military classes (Frige/Destroyer/Cruiser/Capital etc.), fleets ("Fleets: group military ships… assign a mission to the whole fleet"), troop transports.
5. **FleetsTroops.txt** ("Fleets, Troops and Intelligence missions"): fleet management (F12) — "Fleets are groups of military ships… select at least one military ship… 'New Fleet'"; fleet posture/range/target; strike forces vs large fleets; automated fleet response to attacks; **troops**: "Troops are the soldiers you use to invade enemy colonies and to defend your own"; recruiting/garrisons/disbanding (Colony screen → Troops tab; right-click colony); troop types (Infantry, Artillery, Armored, Special Forces); troop transports ("Load troops" / "Unload troops"); invasion flow (load → move → unload at enemy colony → ground combat); **intelligence**: "Intelligence agents are specially trained specialists that you use to accomplish these missions. Your agents can be managed from the Characters screen (F4 key)"; assigning missions: "The Mission summary panel at the bottom-right of the screen allows you to assign missions to agents. Select a target empire for the mission and a mission type. The more time you allow for the mission, the greater the chance of success."; **counter intelligence**: "You can assign agents to prevent enemy intelligence missions… Beware of the negative fallout from botched intelligence missions - if another empire discovers your actions against them it will dramatically lower their estimation of your empire, and could even lead to war."
6. **ExpansionDiplomacy.txt**: using the **Expansion Planner** (F3: resource supply vs demand, "Potential Colonies" / "Potential Mining Locations" lists, send colony/construction ships); diplomacy basics (F5: relations, "Speak" to empires, treaties — alliance/defense pact/free trade/trade sanctions, gifts, warnings); expanding territory; pre-diplomacy context (meet empires, choose peace or war).
7. **ResearchDesign.txt**: **research** — three tech areas (Weapons, Energy, HighTech) each with a tech tree (F7); queueing projects; prerequisites (red lines); crash research (3× for credits, lightning icon); research stations near bonus locations (neutron stars, supernovae, black holes); natural limit; **ship design** (F8): create new designs, add/remove components (categories), sizes (small/medium/large), costs vs performance; warnings (red = rules, yellow = recommendations); **construction** — three ways: right-click Build, Construction Yards screen (F10, "Purchase" button, "If you cannot afford to build the selected ship your Available Funds will flash red"), **Build Order screen** (F9: "you can see your current levels for each ship type, as well as the number of new ships suggested by your advisors. You can modify the amount of ships for each type, and select a specific design to build. When you are satisfied with the order, click the 'Purchase' button").
8. **DealingWithPirates.txt**: pirates don't colonize (they use spaceports anywhere); pirate income (controlled colonies, protection agreements, pirate missions, mining, raids); **protection agreements** (monthly fee; "You can offer protection agreements from the Diplomacy screen (F5)… can pave the way to a mutually-beneficial long-term relationship… Defense Missions"); truces between pirate factions; **pirate missions** (attack/defend/smuggling offered by standard empires & independents — "Pirate Missions panel in the Empire Navigation Tool", "Bid", "Accept"); defending against pirates; playing as pirate.
9. **PlayAsPirate.txt**: "Pirates differ from standard empires in a number of important ways. A major difference is that pirates usually do not have colonies. Instead they start with a spaceport at a gas giant planet. Pirates cannot colonize planets. But they can build spaceports anywhere."; starting spaceport (build/repair/retrofit/refuel; Pirate Leader based there); construction ships (pirates start with one; "pirates cannot build additional Construction Ships. So protect your starting Construction Ship well… however pirates can board and capture Construction Ships"); income sources; controlled colonies ("The more military strength they have near a colony, the faster their level of control will increase, topping out at 100%… multiple pirate factions can control a colony at the same time… very large colonies have a lower maximum control level"); Pirate Base (control ≥50%) / Pirate Fortress (control =100%); protection agreements & truces; pirate missions (accept from the list; smuggling bid process); raids; pirate victory ("Pirate factions compete against other pirate factions to achieve victory, NOT against standard empires").
10. **PreWarpEmpire.txt**: playing the Age of Shadows pre-warp scenario: "You are a young empire without faster-than-light travel. Your goal is to expand your territory within your home star system and prepare for the rediscovery of warp drive"; research **Hyperdrive** ("research the technology to jump between stars… once achieved you can then begin expanding to other star systems"); then **Colonization** tech; "Once these two key breakthroughs are reached you are well on your way to becoming a mighty stellar empire!"; then "spread your territory across the galaxy… encounter other empires and pirate factions, leading to peaceful cooperation and sharp conflict"; reminder: Galactopedia F1.
11. **advanced.txt** ("Advanced Tutorial"): the full advanced loop — starting with the pre-warp setup context, exploring, colonizing, building mining infrastructure, researching, ship design & construction, fleets, diplomacy/intelligence, pirates, and the path to galactic victory; combines and extends all of the above.

## 8. MESSAGES & ALERTS (message system, alerts, pings)

### 8.1 Architecture

Three independent channels (UI_Messages.mht):
1. **Scrolling message panel** — "at the top of the main view… displays the five most recent messages in the galaxy affecting you or your empire… Click on a message to move to the location of the message event or to open an appropriate screen" (`lstMessages`, `ScrollingLinkList`; each row is a clickable link).
2. **Popup messages** — "appears in a popup panel that slides in at the right of the screen" (`pnlMessagePopup`, `MessagePopup`); clicking a popup jumps to the event location; includes "Under attack!" style alerts; each category individually enable-able (Message Settings).
3. **Message History** (H) — full log; "you can review individual messages by selecting them in the list at the left. The body of the message then appears in the area in the middle of the screen. If a message has a related location in the galaxy, this location is displayed on the galaxy map at the right. You can also jump directly to this location in the main view by clicking the button below the galaxy map." Filter: "You can exclude battle messages, or you can choose to view messages relating to Galactic History."

Plus, outside these three channels: the **advisor suggestion popup** (`pnlAdvisorSuggestion` — Approve/Decline/Show), **event decision popups** (`pnlEventMessage` — Investigate/Avoid/Go to/Close; e.g. "When encounter Ruins", "When encounter Abandoned Ship or Base"), **story event overlays** (`pnlStoryEvent`), the **diplomatic message queue** (top-right stack — "Outstanding requests in your empire" / "in the galaxy"), and **pings**: message locations show **dashed blue expanding circles** ("When a message with a location is displayed… a dashed blue circle expands at that location"); ENT hover shows **yellow circular pings**. "Suppress all pop-up screens" (game option) silences popups (code enforces discovery-action defaults when enabled); "Auto Pause in Game Screens" / `AutoPauseWhenInPopupWindow` pauses the game while popups are open; "Loaded games are paused".

### 8.2 Message categories (Message Settings screen; `GameOptions` boolean pairs DisplayMessage/DisplayPopup)

**Scrolling & popup toggle categories** (each appears as a checkbox in both lists):
- "BuiltObjectBuilt" → New Ship Built
- Diplomacy: "DiplomacyGift" (Diplomatic Gifts), "DiplomacyTreaty" (Treaties), "DiplomacyWarTradeSanctions" (War and Trade Sanctions), "DiplomacyEmpireMetDestroyed" ("New Empire" / empire defeated), "DiplomacyRequestWarning" (Requests, Warnings and Gifts)
- "NewColony" (New Colony / "Newly Colonized")
- "ColonyInvaded" (Colony Invaded)
- "ResearchNewComponent" (Research Breakthrough / "Research")
- "IntelligenceMissions" (Intelligence Missions)
- "Exploration" (Exploration discoveries / "Empire Discovery")
- "ShipMissionComplete" (Ship Mission Complete)
- "ShipNeedsRefuelling" (Ship Needs Refuelling or Repair)
- "ConstructionResourceShortage" (Construction Resource Shortage)
- **Under Attack categories** (popup list): "Under Attack - Civilian Ships", "Under Attack - Civilian Bases", "Under Attack - Exploration Ships", "Under Attack - Military Ships", "Under Attack - Research, Monitoring, Resorts" (code: `UnderAttackCivilianShips`, `UnderAttackCivilianBases`, `UnderAttackExplorationShips`, `UnderAttackColonyConstructionShips`, `UnderAttackMilitaryShips`, `UnderAttackOtherStateBases`, `UnderAttackColoniesSpaceportsDefensiveBases`).

### 8.3 All message types (EmpireMessageType — 95 values, grouped)

- **Diplomacy**: DiplomaticRelationChange, ProposeDiplomaticRelation, AcceptDiplomaticRelation, RefuseDiplomaticRelation, RemoveColoniesFromSystem, StopMissionsAgainstUs, StopAttacks, LeaveSystem, RequestJointWar, RequestJointTradeSanctions, RequestStopWar, RequestLiftTradeSanctions, GiveGift, Informational, RequestHonorMutualDefense, BlockadeInitiated, BlockadeCancelled, OfferTrade, RemoveForcesFromSystem, MilitaryRefuelingAllowed/Blocked, MiningRightsAllowed/Blocked, PirateOfferProtection, CancelPirateProtection.
- **Construction/empire**: ShipBaseCompleted, ShipBasePurchased, NewColony, NewColonyFailed, ShipBaseScrapped, ColonyFacilityCompleted, ColonyFacilityCancelled, ColonyWonderBegun, ColonyShipMissionCancelled, PlanetaryFacilityDestroyed, PlanetaryFacilityDamaged, ConstructionResourceShortage.
- **Combat**: ResearchBreakthrough, BattleUnderAttack, BattleAttacking, IncomingEnemyFleet, ColonyGained, ColonyLost, ColonyDefended, ColonyRebelling, Revolution, ColonyDestroyed, ShipBaseBoardedCaptured, ShipBaseBoardedLost, RaidBonuses, RaidVictim.
- **Characters/agents**: CharacterAppearance, CharacterDeath, CharacterMissionAccomplished, CharacterMissionFailure, CharacterSkillTraitChange.
- **Exploration/intel**: EmpireDiscovered, ExplorationRuins, ExplorationBuiltObject, ExplorationHabitat, ExplorationLocation, RestrictedResourceDiscovered, RestrictedResourceTradingAllowed/Blocked, SellInfoUnmetEmpire / SellInfoIndependentColony / SellInfoSystemMap / SellInfoRuins / SellInfoDebrisField / SellInfoRestrictedArea / SellInfoPlanetDestroyer.
- **History/story**: GalacticHistory, GalacticNewsNet, StoryMessage, HistoryOfferLocationHint, HistoryOfferStoryClue.
- **Ship state**: ShipMissionComplete, ShipNeedsRefuelling, ShipNeedsRepair.
- **General**: GeneralWarning, GeneralBadEvent, GeneralNeutralEvent, GeneralGoodEvent, GeneralDecision.
- **Advisor**: AdvisorSuggestion (→ advisor popup).
- **Pirate**: PirateAttackMissionAvailable/Completed/Failed, PirateDefendMissionFailed/Available/Completed, PirateSmugglingMissionAvailable/Completed, PirateSmugglerDetected.
- **Empire-level**: EmpireDefeated (e.g. "Empire Defeated!").

`EventMessageType` additionally classifies scripted game-event messages; `DistressSignalType` (Under Attack, Need Refuelling, Need Repair, Galactic Disaster, Colony Bombarded) drives distress-signal pings; `AdvisorMessageType` (32 values: BuildOrder, BuildOneOff, Colonization, IntelligenceMission, EnemyAttack, EnemyBombard, EnemyBlockade, EnemyAttackPlanetDestroyer, InvadeIndependent, PrepareRaid, DiplomaticGift, TreatyOffer, WarTradeSanctions, ColonyFacility, Offer/Cancel MilitaryRefueling, Offer/Cancel MiningRights, Allow/Disallow TradeRestrictedResources, ComplyTradeSanctionsOther, ComplyWarOther, DefendTerritory, Retrofit, RequestLiftTradeSanctionsOther, RequestEndWarOther, OfferPirateAttack/Defend/SmuggleMission, PirateRaid, PirateFacilityEradicate, AcceptPirateSmugglingMission, DefendTarget) drives advisor suggestions.

### 8.4 How popups are triggered (code flow)

`Game.ReceiveMessage` → `Main.ReceiveMessage`/`PromptForAuthorization` (Main.Part9) decides per category: if the category's popup option is on and the game isn't suppressing popups → show `MessagePopup` (right-side slide-in) and optionally pause (`AutoPauseWhenInPopupWindow`); the message is always appended to the scrolling list (if the scrolling option is on) and to the message-history log; messages with a `location` also spawn a location ping; diplomatic messages additionally feed the top-right `DiplomaticMessageQueue`; advisor messages open the advisor suggestion panel; discovery encounters ("When encounter Ruins / Abandoned Ship or Base") respect the player's DiscoveryAction settings ("Ask what to do" opens the `pnlEventMessage` dialog with Investigate/Leave-alone/Avoid options).

---

### Appendix A — Source locations for the facts above

- Wizard: `DistantWorlds/Start.cs` (labels, sliders, SetLabels at lines ~2848–3472; victory ~3640–3740; start-location lists in `Start.1.cs:3995–4035`; engagement stances `Start.1.cs:5001–5019`; discoveries `Start.1.cs:4783–4802`; threshold items `Start.InitializeComponent.cs:2883`; automation modes `Main.InitializeComponent.cs:10999`).
- Main form: `Main.InitializeComponent.cs` (all 989 control fields), `Main.Part2–13.cs` (screens, menus, messages, game flow; game end `Main.Part12.cs DoGameEnd`, story overlay `Main.Part4.cs method_572`), `MainView.cs/1/2` (rendering), `HoverPanel.cs`, `ItemListPanel.cs`, `ItemListCollectionPanel.cs` (ENT; geometry `Main.Part12.cs:2268`, sizing `Main.Part2.cs method_666`), `DiplomaticMessageQueue.cs`.
- Enums/types: `DistantWorlds.Types/` (EmpireMessageType, AutomationLevel, AdvisorMessageType, BuiltObjectMissionType, BuiltObjectStance, BattleTactics, ColonyPopulationPolicy, CharacterRole/SkillType/TraitType, DistressSignalType, GameOptions, Hotspot, StartGameOptions, VictoryConditions).
- Controls: `DistantWorlds.Controls/Controls/` (193 classes), `CustomDataGridViewElements/`, `CustomMessageBox/`.
- Help: `dwu-research/help_all.txt` (all Galactopedia articles; UI_*, Screen_* extracted in `dwu-research/sections/_work/help_ui.md`).
- Tutorials: the 11 .txt scripts in the game's Tutorial folder (quoted above).