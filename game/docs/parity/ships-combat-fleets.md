# Parity audit: ships, combat, fleets (DWU 1.9.5 / DW Expanded → TS)

Scope: BuiltObject*.cs, BuiltObjectMission.cs, ShipGroup*.cs, Fighter*.cs, Weapon*.cs, Design*.cs, Component*.cs, Troop*.cs, ConstructionQueue/Yard.cs, related Empire/Galaxy ship methods, Bacon* ship-level files.

Method: every C# method name in those files was searched for in src/, then the key ones were checked statement by statement: DoTasks, Weapon.Fire/FireInternal, EvaluateThreats, ProcessBoardingAssault, AssignFleetRetrofit, TroopLevelRequired, DamageCreature, ReviewRemoveObsoleteDesignsForSubRole, PlaceComponentsOnDesign.

## Headline
- No live TODO stubs in this area (the tick/todo.ts registry is empty).
- BuiltObject.DoTasks (BuiltObject.cs 3609-3852) → tick/builtObjectTick.ts: same calls in the same order.
- All 31 BuiltObjectMissionType values are handled (missions/resolveCommands.ts), and all 34 CommandAction cases are dispatched (missions/executeCommands.ts).
- In-scope C# methods with no TS reference have no callers, or are UI/hotkey only: CanFlee, CheckForPirateBases, DetectBattleStalemate, GetFirepowerGreaterThan, FindNextUnbuiltOrDamagedComponent, CalculateTechLevel_OLD, the Design*Station/Base generators, Galaxy.AssignPirateShipMissions, IdentifyNewFleetDefendLocation, StripInvalidComponents.

## Ranked gaps

| # | Feature | C# source | Status | Our location | Impact | Notes |
|---|---|---|---|---|---|---|
| 1 | Ion weapons do full damage to Silver Mist | Creature.cs:926 DamageCreature(damager, damage, weapon); BuiltObject.2.cs:6133; Habitat.cs:2355 | PARTIAL (bug) | creature.ts:699; combat/damage.ts:1352, ~1405 | High | We always divide by 10; the C# skips that for WeaponIonCannon/IonPulse (incl. the Giant Ion Cannon). Pass the weapon through |
| 2 | Ship fire adds the firer to Creature.Attackers | Weapon.cs:299-305 FireInternal | PARTIAL (bug) | combat/weapons.ts:220 | High/Med | creature.attackers exists (creature.ts:105). Without it there is no retaliation (Creature.cs:1196) and no benign flee (1019) against ships |
| 3 | WarpSpeedWithBonuses in threat checks | BuiltObject.cs:572; BuiltObject.1.cs:208/243 | PARTIAL (bug) | combat/threats.ts:1142 (stub), used 1154, 1745; fleets/militaryAI.ts:1168 | Med | Stub ignores fleet and captain hyperjump bonuses; real version is movement.ts:163 |
| 4 | Auto-design torpedo list order | Empire.10.cs:1689 GenerateOrderedComponentImprovementList(WeaponTorpedo,1); 1978-1992 | PARTIAL (approx.) | designPlacement.ts:266; designGeneration.ts:626/808 | Med | C#: static values, highest damage first; ours: tech level, lowest first. Port exists in componentStatic.ts:502 but is unused. Changes torpedo/missile picks on every AI design |
| 5 | Keep obsolete designs still in use | Empire.10.cs:3266, 3307 CheckDesignInUse | PARTIAL (bug) | designGeneration.ts:518 | Med | Deletes designs used by live ships / RetrofitDesign |
| 6 | Captain weapons-range bonus in attack range | BuiltObject.2.cs:205; BuiltObject.cs:600 | PARTIAL (bug) | combat/attackAI.ts:636 | Low/Med | Reads a missing field (always 1.0); use captainBonuses() as weapons.ts:113 does |
| 7 | Creature kill counters | Creature.cs:933 → EmpireCounters.cs:481 | MISSING (call site) | victory.ts:725 | Low/Med | Needs the damager in damageCreature |
| 8 | Garrison need counts extra capitals and penal colonies | Habitat.cs:318-358 TroopLevelRequired | PARTIAL | troops.ts:199, 210 | Low/Med | Both lists exist now |
| 9 | Small-ship maintenance race event | BaconDesign.cs:163 | PARTIAL | empireConstruction.ts:215 | Low/Med | num2 hard-coded to 0 |
| 10 | Wonder scenic bonus in tourism | Habitat.cs:1122-1150 | PARTIAL | civilianAI.ts:363-370 | Low/Med | Same as empire-ai-economy.md gap 1 |
| 11 | Fleet retrofit mission carries its design | Empire.9.cs:636 | PARTIAL | empireConstruction.ts:939 | Low | Use shipGroupAssignMissionFull (shipGroupTasks.ts:1525) |
| 12 | Escaping from a fighter targets its carrier | BuiltObject.1.cs:305-312 | MISSING | combat/threats.ts:1793 | Low | |
| 13 | Freighter clearance uses the cached refuel point | BuiltObject.1.cs:2490 | PARTIAL | civilianAI.ts:1511 | Low | Pass ship.refuellingLocation |
| 14 | Mod options: small ships jump sooner, stargates | BaconBuiltObject | MISSING (throws) | movement.ts:869, 1100 | Low (off by default) | Throws if enabled |
| 15 | Repair-priority templates | ExpModMain.GetRepairPriorityList | MISSING | construction/repair.ts:95 | Low | |
| 16 | Optimized design files / .dwd loading | Galaxy.4.cs:1087 LoadDesigns | MISSING | designGeneration.ts:16; designTools.ts:16 | Low | |
| 17 | Mod ship actions: asteroid colony, pirate build, scientific missions, ship officers, related hotkeys | BaconMain.cs:275-374 | MISSING | player/executeShipAction.ts:394-426 | Low/Med (player) | |
| 18 | Creature branch of IsObjectVisibleToThisEmpire | Empire.9.cs:3065 | MISSING | player/orderMenu.ts:247 | Low | |
| 19 | Minor ship image index | ShipImageHelper.ResolveMinorShipImageIndex | MISSING (cosmetic) | designGeneration.ts:688 etc. | Low | |
| 20 | ColonyInvasion view | ColonyInvasion.cs | MISSING (UI) | combat/invasion.ts:165 | Low (headless) | Ground combat itself is ported |
| 21 | Component cargo in freight/contracts/orders | Empire.4.cs component branches | PARTIAL (dead in C#) | freight.ts, contracts.ts, orders.ts | Low | Never runs in C# |

## Fully ported (spot-checked)
- **Ship tick and orders:** ship tick; command execution (34 actions); missions and command resolution.
- **Movement:** sublight, hyperjump, gravity wells, hyperdeny/hyperstop, fuel.
- **Combat:**
  - weapons fire, projectiles, hit rolls, point defence, missile intercept, area/tractor/gravity weapons, planet destroyers, bombardment
  - damage, shields, armour, ion, component disabling, explosions, repair
  - threat evaluation, attack, flee, tactics
  - fighters and bombers; assault pods, boarding, raids; invasion, ground combat, ownership
- **Troops:** recruit, heal, load, garrison.
- **Fleets:** postures, ranges, attack/gather points, home bases, refuel.
- **Construction:** retrofit and scrap queues; design generation (except gaps 4-5).
- **Civilian ships:** freighters, mining, passengers, colony ships.
- **Visibility:** stealth and long-range scanners.

## Stale comments (claim gaps that are now filled)
weapon.ts:3-4; missions/cmdAttack.ts:11-12; missions/cmdDocking.ts:10, 529; combat/threats.ts:18, 65; builtObject.ts:1381; logistics/freight.ts:78; construction/repair.ts:48; missions/assign.ts:218; missions/cmdReassign.ts:6; civilianAI.ts:9, 3250; combat/damage.ts:566, 1813; executeCommands.ts:6.
