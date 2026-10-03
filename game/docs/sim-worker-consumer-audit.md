# Sim-worker consumer audit: what the main thread reads from the sim

Scope: every file under `src/render`, `src/ui` (including `src/ui/screens` and `src/ui/scenario`), `src/main.ts` and `src/llm` that imports from `src/sim` or touches sim objects. `src/simLoop.ts` and `src/audio` are included where they matter: audio writes sim flags every frame.

Starting point: the worktree already has `src/simworker/replicaGalaxy.ts` and `replicaSync.ts`.
- They define a same-class, same-identity replica.
- Hot classes, compared every step: Galaxy, BuiltObject, Creature, Fighter, ShipGroup, Empire, Explosion.
- Weapon and FighterWeapon are hot only through their gated owner.
- Habitat is cold. Its orbit is extrapolated from `(orbitAngle, lastTouch)`.
- BuiltObject and Creature are "fixed hot": only their `alwaysHotFields` are compared every step.

This audit is written against that design. It also applies to a typed-array snapshot, but almost every consumer relies on `instanceof` checks and stable object identity, so snapshots would mean rewriting nearly all of them.

---

## 0. Headline findings

1. **There is exactly one per-frame driver.** `main.ts` adds one `app.ticker` callback that runs, in order:
   - `simLoop.tick`
   - `shipKeys.frame()`
   - `view.update(renderTime)`
   - `gameAudio.frame()`

   Everything else is a timer (50 ms to 5 s) or a user action.
2. **There are 27 direct sim mutations or sim-side registrations that bypass `issuePlayerCommand`** (full list in §4). The serious ones:
   - **Message pipeline, 4 Hz:** stamps `EmpireMessage.starDate`, pushes into `Empire.messageHistory` and `Empire.advisorSuggestions`, calls `sendEmpireMessage`, and fires `onGameEnd`.
   - **Audio, every frame:** writes `*SoundPlayed` flags on Weapon, Explosion and BuiltObject.
   - **Order menus:** draw `galaxy.rnd` when building menus, on user input.
   - **Synchronous execution:** `runPlayerCommand` and `applyStrategicDecisions` run directly from the advisor and LLM paths.
   - **Rim wiring:** writes `galaxy.scenario.state`.
   - **Trade flows:** recording registers a sim contract listener.
   - **Callbacks the sim calls into the UI:** `eventMessageRecipient`, the game-end handler, the location-pinged hook.
3. **About 95 `issuePlayerCommand` call sites pass an `onApplied` callback** and expect it to run synchronously at the next boundary. In a worker these become async round trips whose results must map back to replica identities, for example:
   - `RightClickResult`
   - `ProposalResult.expireMessagesFor` (an Empire)
   - `counter.message` (an EmpireMessage)
4. **Some commands carry objects built on the main thread** (by value, referencing replica objects). The command codec must handle them:
   - `IntelligenceMission`
   - `DesignDraft` (a cloned Design)
   - `TradeNegotiation`
   - `PeaceTerms`
   - `ShipAction`
   - `AdvisorBrief` / `DiplomatBrief`
   - `EmpireMessage`
5. **Identity is load-bearing everywhere.** It shows up as:
   - `WeakMap`/`Map`/`Set` keyed by BuiltObject, Creature, Fighter, Weapon, Habitat, SystemInfo, Empire and EmpireMessage;
   - module-level selection references;
   - `===` comparisons such as `bo.empire === player`;
   - `instanceof` on Habitat, BuiltObject, ShipGroup, Creature and Fighter.
6. **Several state tables live outside the object graph** (module `WeakMap`s keyed by Galaxy) and are not in `collectSideTables`. On a replica Galaxy they are empty:
   - `tradeFlowLedger`
   - `commandLog`
   - the `playerCommands` queue
   - `voiceCues`
   - `gameEndHandlers`
   - `starRangeCaches`

   Main-thread readers: the freight overlay, the Trade Flows panel, freight tooltips, `__dwu.commands.log`, `voiceJob`, and `empireComparison`'s game-end hook.
7. **Saving runs on the main thread and reads the whole graph.** `serializeGame` is called by autosave (every N minutes) and by the save panel. It must move to the worker, because the replica lacks the queue, log and ledger tables above.
8. **Some per-frame fields are missing from `alwaysHotFields`.** BuiltObject and Creature are fixed-hot, so anything not in their list arrives only with the cold cycle (about 0.5 s). Affected fields:
   - `BuiltObject.nearestSystemStar` (fog visibility, every frame)
   - `BuiltObject.attackers` (combat bars, battle icons)
   - `BuiltObject.doingMining`, `doingGasMining`, `doingConstruction` (ambient animations)
   - `BuiltObject.mission` and `threats` (overlays)
   - `BuiltObject.sensorLongRange` and `stealth` (fog)
   - `Creature.distanceToTarget` (attack animation frames)

   See §3.

---

## 1. Entry points and boot (main.ts, simLoop.ts)

### src/main.ts
- **Frequency:**
  - Per frame: the ticker runs `simLoop.tick`, `shipKeys.frame`, `view.update` and `gameAudio.frame`.
  - 4 Hz: `refreshHud` and `refreshClockLabel`.
  - On boot, load and teardown: everything else.
- **Reads:**
  - `game.playerEmpire.capital.{xpos,ypos,name,systemIndex}`
  - `galaxy.systems[i].systemStar.name`, `galaxy.systems[].habitats` (to resolve a habitat's system)
  - `galaxy.sizeX`/`sizeY`
  - `galaxy.habitats` (`?select=` name lookup)
  - `bo.xpos`/`ypos` (`nearestSystem` on click)
  - `ShipGroup.leadShip.{xpos,ypos}` and the target object's `xpos`/`ypos` (advisor "show me")
  - every 4 Hz through `refreshHud`:
    - `fogOf(galaxy).selectionUnseen(selection)`
    - `topSystemNameText` (`galaxy.fastFindNearestSystem`, `determineGalaxyLocationsAtPoint`, player visibility)
    - `empireMessages(player)`
- **Calls:**
  - `createGame`/`createGameSteps`, `generateGalaxy`, `installGameStatics`, `registerGameHooks` (boot)
  - `serializeGame` (save, autosave), `deserializeGameSteps` (load)
  - `createSimLoop`
  - `issuePlayerCommand` (exposed on `__dwu.commands.issue`) and `commandLog(galaxy)` (debug)
  - `expireConversationsForEmpire`
  - **MUTATIONS:**
    - `game.playerEmpire.flagShape = startOptions.flagShapeIndex` (wizard boot, before the view starts)
    - `registerLocationPingedHook(cb)`: the sim calls it during a tick
    - `installGameEndHandler`
    - `installEventMessages`, which puts `eventMessageRecipient` on the player Empire
    - `recordTickerMessage` at 4 Hz: `message.starDate = …` and `addHistoryMessage`
    - `time.paused`/`speed` writes (sim inputs)
- **Identity:** wires `view.selectedBuiltObject`/`selectedCreature`/`selectedHabitat`/`selectedBuiltObjects` from the HUD selection. `instanceof` checks on ShipGroup, Habitat, Creature and Fighter. `__dwu.galaxy`/`game` expose the live sim to the console.

### src/simLoop.ts (not strictly in scope, but it is the sim host to move)
- **Frequency:** per frame.
- **Calls:** `drainCommandBoundary`, `noteSimSpeed`, `noteSimView`, `SimDriver.advance` and `schedulerState(galaxy).queue.length = 0` (on error).
- **Reads:** `galaxy.nowMs`, plus the camera for the optional `?simView=1` level-of-detail pass.
- **Note:** it builds `renderTime` (alpha, `renderNowMs`, `stepSerial`, `simNowMs`). Each worker step message must carry these.

---

## 2. Per-file audit

**Key:**
- **Freq:** F = per frame; T(ms) = timer; U = user action or screen open.
- **Mut:** direct sim mutation.
- **Id:** holds sim object identity across frames.

### 2a. src/render (Main View; everything in `MainView.update` runs every frame)

| File | Freq | Reads (sim classes / fields) | Calls into sim | Id |
|---|---|---|---|---|
| **mainView.ts** | F (`update`); U (picking, input, tooltip after a 120 ms debounce) | Galaxy: `nowMs`, `scheduler?.frames` (fallback), `habitats.length`, `builtObjects.length`, `creatures.length`, `systems[]` (`systemStar.xpos/ypos`, `habitats`, bodies), `galaxyLocations`, `independentEmpire`, `playerEmpire`, `sizeX/Y`, `sectorSize`, `randomSeed`. Habitat (orbit draw): `parent`, `orbitAngle`, `anglePerSecond`, `orbitDirection`, `orbitDistance`, `lastTouch`, `xpos/ypos`, `category`, `diameter`, `type`, `population` (labels), `owner/empire`, `name`. Selected objects: `hasBeenDestroyed`, position. Init only: `GalaxyLocation` fields. | `describeSubRole`, `isObjectVisibleToThisEmpire`; `installRimAtmosphereData` (MUT, once) and `registerBuiltObjectIndex` at init. | `selectedBuiltObject`/`selectedBuiltObjects`/`selectedHabitat`/`selectedCreature`; SystemView/PlanetView per Habitat built once at init. |
| **renderInterp.ts** | F | BuiltObject: `xpos`, `ypos`, `heading`, `targetHeading`, `currentSpeed`, `topSpeed`, `warpSpeed`, `lastTouch`, `parentHabitat`, `parentOffsetX/Y`, `parentBuiltObject`, `dockedAt`, `hasBeenDestroyed`. Creature: `xpos/ypos`, `currentHeading`, `targetHeading`, `currentSpeed`, `targetSpeed`, `movementSpeed`, `hyperSpeed`, `lungeSpeed`, `accelerationRate`, `lungeAccelerationRate`, `turnRate`, `parentHabitat`, `parentX/Y`, `lastTouch`. Fighter: `xpos/ypos`, `heading`, `targetHeading`, `currentSpeed`, `targetSpeed`, `topSpeed`, `lastTouch`, `specification.{turnRate,accelerationRate}`. Weapon: `x`, `y`, `heading`, `speed`, `lastFired`. Habitat orbit chain: `parent`, `orbitAngle`, `anglePerSecond`, `orbitDirection`, `orbitDistance`, `lastTouch`. Galaxy: `nowMs`. | none (constants only) | **WeakMap<object, MotionState>** keyed by every moving object, including Weapons (shots). Identity loss means interpolation pops. |
| **builtObjectIndex.ts** | F (rebuilt when a step lands, the array identity or length changes, or every 8 frames) | `galaxy.builtObjects` (array identity and length), `bo.hasBeenDestroyed`, `bo.xpos/ypos`, and the drawn-offset bound inputs (see renderInterp) | none | `live[]` array of BuiltObject; module **WeakMap<Galaxy, index>**. |
| **builtObjectLayer.ts** | F | BuiltObject: `xpos/ypos` (through motion), `heading`, `empire/owner`, `role`, `subRole`, `pictureRef`, `size`, `isPlanetDestroyer`, `builtObjectID`, `design.{imageScalingType,imageScalingFactor}`, `damagedComponentCount`, `nearestSystemStar`, `shipGroup`, `hasBeenDestroyed`; Empire `diplomaticRelations` (civilian fade / colours); `galaxy.pirateEmpires`, `systems` | `fogOf` | **Map<BuiltObject, Sprite>**, `Map<BuiltObject, number>`, `Set<BuiltObject>` (liveness; sweeps every 30th rebuild). |
| **fog.ts** | F (memo cleared each frame) | Galaxy: `playerEmpire`, `builtObjects` (player sensor sources), `systems[i].systemStar`, `calculateDistance(Squared)`, **`builtObjectIndexGrid`** (through `findShipOutsideSystemWithScanRange`), `scenario` (`scenarioQuery`). Empire: `visibility.checkSystemVisibilityStatus`/`checkSystemVisible`, `visibility.empiresSharedVisibility`, `longRangeScanners[]`, `empiresViewable`, `knownPirateBases`, `pirateEmpireBaseHabitat`, `empireId`. BuiltObject: `empire`, `xpos/ypos`, `nearestSystemStar`, `stealth`, `pirateEmpireId`, `sensorLongRange`, `sensorProximityArrayRange`, `currentSpeed`, `warpSpeed`, `topSpeed`. Fighter: `onboardCarrier`, `parentBuiltObject`. | `isObjectVisibleToThisEmpire`, `isObjectVisibleToThisEmpireImprecise`, `builtObjectVisibility`, `creatureVisibleToEmpire` (all pure queries) | Per-frame `Map<object, boolean>` (no cross-frame identity); module `WeakMap<Galaxy, FogOfWar>`. |
| **effectsLayer.ts** | F (candidate lists refreshed when a step lands or every 8 frames) | BuiltObject: `weapons[]`, `explosions[]`, `lastShieldStrike(+Direction)`, `currentShields`, `hyperjumpCountdown`, `hyperjumpJustExited`, `hyperEnterStartAnimation`, `hyperExitStartAnimation`, `canHyperJump`, `design.hyperDriveIndex`, `size`, `targetHeading`, `xpos/ypos`, `lastTouch`. Weapon: `x`, `y`, `heading`, `speed`, `lastFired`, `distanceTravelled`, `target`, `power`, `range`, `rawDamage`, `bombardDamage`, `damageLoss`, `component`, `type`, `category`, `willHitTarget`, `resetNext`. Explosion: `explosionStart`, `explosionSize`, `explosionOffsetX/Y`, `explosionImageIndex`, `explosionCurrentImage`. Habitat (through habitatIndex): `explosions`, `giantIonCannon(Present)`, `category`, `lastTouch`. Fighter: `weapons`, `explosions`, `lastShieldStrike`, `onboardCarrier`, `specification`. `galaxy.nowMs` | `fightersOf`, `galaxyStarDate`, `fogOf` | **WeakMap<BuiltObject, StrikeRecord>** ×2, **WeakMap<Weapon, number>**, **WeakMap<BuiltObject, HyperState>**, `Set<BuiltObject>` ×3. |
| **ambientLayer.ts** | F | BuiltObject: `engineType`, `cruiseSpeed`, `topSpeed`, `targetSpeed`, `heading`, `design.{imageScalingType,imageScalingFactor}`, `doingMining`, `doingGasMining`, `doingConstruction`, `builtAt`, `constructionQueue`, `parentHabitat`, `size`, `builtObjectID`, `empire`, position. Habitat: `planetaryShieldPresent`, `constructionQueue`, `category`, `empire`, position. Empire: `mainColor`, `pirateEmpireBaseHabitat`, `constructionYards`. `galaxy.independentEmpire` | `fogOf`, `galaxyStarDate`; own `RenderRandom` (not `galaxy.rnd`) | **Map<BuiltObject\|Habitat, SpawnTimes>**. |
| **fighterLayer.ts** | F | Fighter: `xpos/ypos`, `heading`, `onboardCarrier`, `pictureRef`, `size`, `specification`, `targetSpeed`, `topSpeed`, `empire`, `hasBeenDestroyed`, `health`, `fighterID`; carriers come from the builtObject index (`bo.fighters`) | `fightersOf`, `fogOf` | **WeakMap<Fighter, number>**, `Set<Fighter>` ×2. |
| **creatureLayer.ts** | F | Galaxy: `fastFindNearestSystem(cam)`, `systems[i].creatures`, `determineGalaxyLocationsAtPoint` (restricted areas' related creatures), `findNearestSystemGasCloudAsteroid` (pick), `scenario`, `playerEmpire`. Creature: `xpos/ypos`, `currentHeading`, `currentSpeed`, `currentTarget`, **`distanceToTarget`**, `damage`, `damageKillThreshold`, `attackStrength`, `size`, `type`, `pictureRef`, `creatureId`, `isVisible`, `parentHabitat`, `hasBeenDestroyed`, `nearestSystemStar`. Empire: `longRangeScanners`, `visibility`. | `findShipOutsideSystemWithScanRange`, `resolveCreatureDescription`, `faunaVariant*`, `creatureTamedByHerders` (cache keyed by Galaxy plus a revision) | **Map<Creature, number>**, **Map<Creature, FaunaView>**, **Map<Creature, CreatureDamage>**. |
| **empireLayer.ts** | F (rings redrawn when keys change) | `galaxy.empires[]`, `independentEmpire`, `habitats`, `systems`, `sectorSize`; Empire: `mainColor`, `colonies` (and their systems), `visibility.checkSystemVisibilityStatus`/explored | `displayColorForEmpire` | Per-empire Graphics objects (indexOf-aligned with `galaxy.empires`). |
| **overlayLayer.ts** | F (travel vectors, markers) | BuiltObject: `mission` (`builtObjectMission`), `currentSpeed`, `topSpeed`, `warpSpeed`, `hyperjumpPrepare`, `parentHabitat`, `parentBuiltObject`, `shipGroup`, `role`, `actualEmpire/owner`, `threats`; ShipGroup: `leadShip`, `mission`; Habitat: `scenicFactor`, `researchBonus`, `type`, `category`; Empire: `colonizableHabitatTypesForEmpire()`, `researchBonus`, `visibility.checkSystemExplored`; `galaxy.playerEmpire`, `scenario` | `builtObjectMission`, `threatKnownSites`, `scenarioMapFeatures`, wreckage hit test | Through `getSelection()` (the HUD selection BuiltObject / ShipGroup). |
| **galaxyMarkers.ts** | F (positions); 1 s refresh (`REFRESH_MS`) for rings and labels | SystemInfo: `dominantEmpire`, `isDisputed`, `totalStrategicValue`, `hasRuins`, `independentColonyCount`, `systemStar`, `habitats`; Empire: `capital`, `capitalSystemStars`, `shipGroups`, `visibility.systemVisibility[i].isRefuellingPoint`, `checkSystemVisibilityStatus`, `diplomaticRelations`, `empireId`, `mainColor`; BuiltObject: `role`, `subRole`, `shipGroup`, `nearestSystemStar`, `parentHabitat`, `empire`, position; ShipGroup: `leadShip`, `ships`, `role`; `galaxy.maxSolarSystemSize`, `nowMs` | `isObjectVisibleToThisEmpireImprecise`, `isObjectVisibleToThisEmpire`, `displayColorForEmpire`, `fogOf` | **Map<SystemInfo, {empire,…}>**, `Set<BuiltObject>` ×2, `getSelection()` reference. |
| **battleIcons.ts** | F (inside galaxyMarkers) | Habitat: `owner`, `attackers`, `systemIndex`; BuiltObject: `attackers`, `weapons`, `lastShieldStrike`, `empire`, `nearestSystemStar` | none | none |
| **combatBars.ts** | F | BuiltObject: `currentShields`, `shieldsCapacity`, `components`, `damagedComponentCount`, `weapons[].lastFired`, `lastShieldStrike`, `attackers` | none | none |
| **freightOverlay.ts** | F (geometry rebuilt only when the ledger changed and a game day passed; leaders every 250 ms) | `tradeFlowLedger(galaxy)` (a **side table outside the graph**), `galaxyStarDate`, BuiltObject: `subRole`, `contractsToFulfill`, `hasBeenDestroyed`; Empire: `mainColor`; `galaxy.playerEmpire`, `independentEmpire`, `scenario` | `flowsInWindow`, `hubsInWindow`, `flowCategory`, `scenarioMapFeatures`; **MUT/registration: `enableTradeFlowRecording`/`disableTradeFlowRecording`** (creates the ledger and registers a sim contract listener) | none beyond the ledger. |
| **artBundleLayer.ts** | F | `galaxy.scenario.state['wreckage'/'independents']`, `builtObjects`, `empires`, `pirateEmpires`; BuiltObject: `role`, `parentHabitat`, `empire`, position; Habitat: `category`, position | `herderColonies`, `isHerderEmpire`, `scenarioParam`, `galaxyStarDate` | `Set<Habitat>`. |
| **liveryLayer.ts** | F (flag `liveries`) | BuiltObject: `dateBuilt`, `dateRetrofit`, `damagedComponentCount`, `components`, `locationEffects`, `lastLocationEffectTouch`, `subRole`, `builtObjectID`, `empire`, heading, position; Empire: `mainColor`, `secondaryColor`, `flagShape`, `empireId`, `pirateEmpireBaseHabitat`; `galaxy.pirateEmpires`, `independentEmpire`, `scenario` | `rimTraderEmpire`, `galaxyStarDate`; registers a render-side livery hook | **WeakMap<BuiltObject, ShipHistory>**, `WeakMap<BuiltObject, …>` (render-observed history). |
| **shipOverlays.ts** | F (through the ship / fighter / creature layers) | BuiltObject: `builtObjectID`, `components`, `damagedComponentCount`, `unbuiltComponentCount`, `size`; Fighter: `health`, `fighterID` | none | `Map<K, DamageEntry>`, `Map<K, ConstructionEntry>`, `Map<K, Sprite>`, `Set<K>` (K is a sim object). |
| **rangeRings.ts** | F (selected ship or fleet) | BuiltObject: `currentFuel`, `fuelCapacity`, `warpSpeed`, `warpSpeedFuelBurn`, `cruiseSpeedFuelBurn`, `staticEnergyConsumption`, `cruiseSpeed` (through `currentRange`) | `currentRange` (pure) | selection |
| **followCamera.ts** | F | target `xpos/ypos`, `hasBeenDestroyed`, ShipGroup `leadShip`/`ships` | none | **FollowState.target** (BuiltObject / ShipGroup / Creature). |
| **boxSelect.ts** | U (drag) | BuiltObject: `empire/owner`, `role`, `hasBeenDestroyed`, `unbuiltComponentCount` | none | none |
| **pickStack.ts** | U | generic picks | none | none |
| **habitatIndex.ts** | built once per galaxy | `galaxy.habitats`, `systems`, `researchStatic`; Habitat: `systemIndex`, `facilities`, position | none | **WeakMap<Galaxy, …>** (assumes static habitat lists). |
| **rimAtmosphereLayer.ts** | F (flag `rimAtmosphere`) | `galaxy.sizeX/Y`, `systems[].systemStar/habitats`, `playerEmpire.visibility`, `habitats` | `scenarioFlag`/`scenarioParam` (own PRNG) | none |
| **rimAtmosphereWiring.ts** | once (`MainView.init`) | `galaxy.systems[].systemStar` positions, `sizeX/Y` | **MUT: `installRimWeights`, `installRimNameOverrides`**, which write `galaxy.scenario.state[…]`; sim code (rimMessages) reads them | none |
| **rimDust.ts** | F | none (own PRNG) | none | none |
| **concordArt.ts** | F (ship art) and U (UI portraits) | `galaxy.scenario.state['rimTreasure']`, BuiltObject `subRole`/`size`/`empire`, Empire `dominantRace` | `scenarioFlag`/`scenarioParam`, `rimTraderEmpire`; registers a UI emblem override | none |
| **concordFleet.ts / concordHull.ts** | F (art) | none directly | none | none |
| **empireLineage.ts** | U (emblem build) | `galaxy.empires`, `pirateEmpires`, `scenario.state['charteredCompanies.charters' \| 'politics' \| 'demographics' \| 'ghostArmada']` | `scenarioText` | none |
| **threatMarkers.ts / wreckDebris.ts / leagueArt.ts** | F (through artBundleLayer) | scenario state records; `Empire.designs`/`dominantRace` (wreckDebris) | none | none |
| **damageOverlay.ts / constructionOverlay.ts / nebulaClouds.ts** | F / init | local `Random` only; nebulaClouds uses `galaxy.randomSeed` | none (local `Random` instances) | none |
| **artBundleGallery.ts / faunaGallery.ts / whalePilotLayer.ts** | F, dev flags only | Empire colours and race, `playerEmpire.capital`, `systems` | `galaxyStarDate`, `flagShapeUrl` | none |
| **assets.ts / troopImages.ts / artBundleFlags.ts / liveries.ts / deepStarfield.ts / systemNebula.ts** | init / F | `pictureRef`, `dateBuilt`/`dateRetrofit` (pure helpers); enum imports | none | none |
| **(src/audio) mainViewSounds.ts, gameAudio.ts** | **F** | weapons, explosions, hyper flags, `doingMining`, `galaxy.nowMs`, `playerEmpire`, `researchStatic` | **MUT every frame: `weapon.soundEffectPlayed = true`, `explosion.explosionSoundPlayed = true`, `bo.ionStrikeSoundPlayed = true`, `bo.hyperjumpAboutToEnterSoundPlayed = true`** | `WeakMap`s of render-only times. |

### 2b. src/ui (HUD, selection, orders, messages)

| File | Freq | Reads | Calls into sim | Id |
|---|---|---|---|---|
| **hud.ts** | T: 500 ms selection panel (`liveTimer`); 250 ms money (`refreshMoney`); 500 ms research readout; U: cycle buttons, screen toggles | Empire: `stateMoney`, `name`, `mainColor`, `flagShape`, `research` (queue), `builtObjects`, `privateBuiltObjects`, `shipGroups`, `colonies` (cycle lists), `capital`, `troops`, `constructionYards`, `visibility`; BuiltObject status rows (about 40 fields: fuel, shields, energy, armor, components, cargo, troops, mission, `subsequentMissions`, hyperjump state, `retrofitDesign`, `isAutoControlled`, …); Habitat: `population`, `troops`, `invadingTroops`, `troopsToRecruit`, `resources`, `cargo`; ShipGroup: `leadShip`, `ships`; Creature: `hasBeenDestroyed`, `currentSpeed` | `moneyPanelIncome`, `calculateForceStrengths`, `calculatePopulationStrength`, `resolveInvasionEmpires`, `calculateAvailableAssaultPodAttackStrength`, `habitatDispatchOptions`, `builtObjectMission`, `stellarObjectCharacters` (side table), `threatKnownSites`, `rimSystemDisplayName`; `issuePlayerCommand` ×3 (with `onApplied`) | **Module `currentSelection`** (Habitat / BuiltObject / BuiltObject[] / ShipGroup / Creature); **Map<CycleKind, BuiltObject>** cycle cursors. |
| **selectionInfo.ts** | T 500 ms (through hud) | The deepest per-object reads. Habitat: `population` (races, amounts), `maxPopulation`, `resources`, `facilities`, `troops`, `invadingTroops`, `cargo`, `dockingBays`, `dockingBayWaitQueue`, `constructionQueue`, `taxRate`, `annualTaxRevenue`, `plagueId`, `isBlockaded`, `ruin`, `raidCountdown`, radiation, `scenicFeature`, `researchBonus*`, `wonderForDevelopment`, `basesAtHabitat`, `pirateColonyControl`, `rebelling`. BuiltObject: about 50 fields (components, weapons range, energy, fuel, troops, `population`, cargo, fighters, docking bays, assault values, slowed / disabled / reduced locations, `retrofitDesign`, `nativeRace`, …). ShipGroup: `ships`, `leadShip`, `gatherPoint`. Creature description fields. Empire: `empiresViewable`, `visibility`, `capital(s)`, `targetHabitat`, `researchBonus` | `strategicValue`, `habitatDevelopmentLevel`, `empireApprovalRating`, `taxComplianceRate`, `habitatAnnualRevenue`, `habitatCorruption`, `privateAnnualRevenue`, `calculateAccurateAnnualIncome`, `canEmpireColonizeHabitatExplained`, `checkColonizationLikeliness`, `checkBasesToBeBuiltAtHabitat`, `checkColonizingHabitat`, `checkSystemOwnership`, `blockadeFor`, `galaxyPlagues`, `shipGroupTotalTroopCapacity`/`SpaceUsed`, `resolveCreatureDescription` (queries; no writes found) | the selection |
| **selectionInfoView.ts** | T 500 ms | Empire colours, `flagShape`, `empireId`, `visibility`; `galaxy.races`, `randomSeed`, `scenario` | none | none |
| **leftSidebar.ts / leftSidebarView.ts** | T 500 ms while a panel is open (`bind(false)` skips the slow panels); U | Empire: `colonies`, `builtObjects`, `privateBuiltObjects`, `shipGroups`, `constructionShips`, `constructionYards`, `spacePorts`, `characters`, `troops`, `capital(s)`; Habitat: `population`, `resources`, `constructionQueue`, `manufacturingQueue`, `troops`, `rebelling`, `scenic*`, `researchBonus*`; BuiltObject: fuel, damage, troops, `fighters`, `characters`, `constructionQueue`, `shipGroup`; ShipGroup: `posture`, `postureRangeSquared`, `ships`, `leadShip` | `identifyColonizationTargetsFull` (with `filterOutDangerousTargets=false`, so no write), `identifyResourceCentres`, `determineResearchStationLocation`, `determineResortBaseBuildLocations`, `checkColonizingHabitat`, `checkBasesToBeBuiltAtHabitat` (slow panels on open), `habitatDevelopmentLevel`, `empireApprovalRating`, `habitatAnnualRevenue`, `resolveNewShipImageIndex`, `resolveSectorDescription` | Item lists and the selected row hold Habitat / BuiltObject / ShipGroup / Character. |
| **orderMenu.ts** | T 500 ms (action bar refresh); U (right-click, hover after the rest debounce, action menu) | the selection; target under the cursor; Habitat `owner`; ShipGroup `posture` | `openActionMenu`, `selectionButtons`, `resolveHoverOrder`, `rightClickOrder` (direct only for the non-order outcomes), `orderSubject`, `selectionAfterClick`, `selectionRefreshPage`; **MUT: menu building draws `galaxy.rnd`** (`selectRelativePoint`, `selectRelativeHabitatSurfacePoint`, `selectRelativeParkingPoint`, in `sim/player/orderMenu.ts`); `issuePlayerCommand` ×5 (`shipAction`, `rightClickOrder`, `fleetPoint`, `salvageWreckField`, `automationOff`) with `onApplied`; clock pause while the action menu is open | `lastSel` reference; `selectedObject`. |
| **shipCommandKeys.ts** | **F** (`frame()`: view lock recentres while locked); U (keys) | BuiltObject / ShipGroup / Habitat / Creature position and `hasBeenDestroyed`; `ShipGroup.ships`/`leadShip` | `isObjectVisibleToThisEmpire`; `issuePlayerCommand('shipOrderKey')` with `onApplied` | **SelectionHistory** of sim objects. |
| **shipHotkeys.ts / keyboard.ts** | U | the selection's `xpos/ypos`; `src.empire.galaxy`; camera | GalaxyTime (`togglePause`, speed) | none |
| **topBar.ts** | T 250 ms (through main `refreshHud`) | `galaxy.fastFindNearestSystem`, `determineGalaxyLocationsAtPoint`, `player.visibility` status, Habitat `category`/`systemIndex`/name | none | none |
| **mapTooltip.ts** | U (hover) | Habitat `category`, name | none | none |
| **empireMessageFeed.ts** | T 250 ms (main `refreshHud`) | `empireMessages(player)` (`Empire.messages`), `messageHistory` | **MUT: `recordTickerMessage`: `message.starDate = …`, `addHistoryMessage` → `Empire.messageHistory.push`** | **WeakSet<EmpireMessage>** seen. |
| **messagePopups.ts** | T 250 ms (`tick`); U (dialogs) | `empireMessages(player)`, `empireMessageHistory`, `player.proposedDiplomaticRelations`/`diplomaticRelations.byEmpire`, `galaxy.empires`, `independentEmpire`, sender `mainColor` and race | **MUT: `m.starDate = galaxyStarDate(...)` (two sites); `receiveAdvisorSuggestionMessage` → `Empire.advisorSuggestions` push; `onGameEnd(galaxy, defeat)` (the handler mutates, see empireComparison); `expireAdvisorSuggestionsForEmpire` (splices `advisorSuggestions`) through the `setDiplomacyMessageExpiry` callback**; `issuePlayerCommand` ×6 (`answerConversation`, accept/decline, …) | **WeakSet<EmpireMessage>** seen and heardBefore; the conversation queue holds EmpireMessage and Empire. |
| **messageStubList.ts / messageStubs.ts** | **T 50 ms** (animation); sync every 250 ms | `advisorSuggestions(player)` (lazy init: writes `empire.advisorSuggestions = []` if missing), the conversation queue, EmpireMessage `starDate`/`description`/`sender`, `player.diplomaticRelations.byEmpire` | `issuePlayerCommand('declineSuggestion')` | **WeakMap<EmpireMessage, number>**, **WeakSet<EmpireMessage>**; stub keys are EmpireMessages. |
| **messageRouting.ts / messagePicture.ts / messageGoto.ts / conversationActions.ts / pirateProtectionPrice.ts** | U / T 250 ms (called from popups and the ticker) | EmpireMessage fields; `player.diplomaticRelations`/`proposedDiplomaticRelations`/`controlDiplomacyOffense`/`pirateEmpireBaseHabitat`/`research`; Habitat `facilities`/`ruin`/`landscapePictureRef`; BuiltObject `subRole`/`components`; `galaxy.fastFindNearestSystem`, `determineHabitatSystemStar`, `pirateRelations` | `totalColonyStrategicValue`, `calculatePirateProtectionPricePerMonth`, `galaxyLocationKey` (queries) | goto targets (sim objects). |
| **eventMessages.ts** | T 250 ms (drains a UI queue) | the event payload Habitat (`ruin.pictureRef`), PlanetaryFacility, the location object | **MUT: defines `player.eventMessageRecipient` (a callback the sim calls during a tick); `sendEmpireMessage(new EmpireMessage(...), player)` → `Empire.messages.push` plus the event-log tap**; `issuePlayerCommand('investigateRuins')` | holds `player`. |
| **advisorSuggestions.ts** | T 250 ms (`tick`); U | `advisorSuggestions(player)` (lazy init), EmpireMessage `starDate`/`advisorMessageType`, `player.stateMoney`, `visibility` | `issuePlayerCommand('expireAdvisorSuggestions' / 'approveSuggestion' / 'declineSuggestion')` | `current` EmpireMessage. |
| **advisorPanel.ts / advisorClient.ts** | U (chat turn) | through `buildAdvisorBrief` (broad Empire / fleet / colony read); `galaxy.builtObjects` | **`runPlayerCommand('advisorCommands')` executes synchronously** (bypasses the queue; journals); `issuePlayerCommand` ×1 | the selection is passed to the brief. |
| **diplomatVoice.ts** | U (conversation turn) | `buildDiplomatBrief` (Empire `counters`, `score`, race, relations) | **`runPlayerCommand('diplomatCounter')` synchronously** | **WeakMap<EmpireMessage, string>**. |
| **aiAdvisorDriver.ts / aiAdvisorLog.ts** | T 500 ms poll (off unless enabled) | `galaxy.empires`, `independentEmpire`, `player.diplomaticRelations.byEmpire`, `ai.active`, `pirateEmpireBaseHabitat`; `buildStrategicBrief` (broad) | **`applyStrategicDecisions(galaxy, ai, …)`: direct `applyStrategicCommand` plus `appendCommandLog`** (bypasses the queue) | Empire refs per turn. |
| **autosave.ts** | T 5 s check; saves every N minutes | the whole graph (through the `serializeGame` callback from main) | `serializeGame` (must run in the worker) | none |
| **autoPause.ts** | U | none | GalaxyTime `paused` (a sim input) | none |
| **eventLogDev.ts** | T 30 s (dev `?eventLog=dump`) | `eventLogEntries`, `chronicleExport` (scenario state) | queries | none |
| **empireEmblem.ts / raceDisplayArt.ts / characterPortrait.ts / leagueRows.ts** | U / T (wherever emblems show) | Empire `dominantRace`, `flagShape`, `mainColor`/`secondaryColor`, `empireId`, `pirateEmpireBaseHabitat`, `pirateEmpireSuperPirates`; `galaxy.randomSeed`, `scenario`; Character race / role | `flagShapeUrl`; registers render-side emblem overrides | Override caches keyed by Empire (in emblemArt). |
| **freightText.ts** | U (tooltip) / T 1 s (Trade Flows) | `galaxy.systems`, `independentEmpire`, `resourceSystem`; BuiltObject | none (data comes from the ledger side table) | none |
| **courtView.ts / emergentPolitics.ts / internalSecurityView.ts** | U / T 1 s (inside screens) | `peek*State` scenario state, `getEmpireCharacters`, Empire `leader`, `colonies` | read-only "peek" accessors | none |
| **scenario/rimTraderRows.ts** | U / T 1 s (diplomacy screen, empires list, selection panel) | rim trader Empire, `resourceSystem`, Habitat `pictureRef` | **MUT: `obtainDiplomaticRelation(rimTrader, viewer)` adds a NotMet `DiplomaticRelation` to `rimTrader.diplomaticRelations` when none exists** | none |
| **scenario/wreckageUi.ts** | F (overlay markers) / U | `wreckFields` scenario state, BuiltObject `builtObjectID`/position, `ShipGroup.ships`, `galaxy.calculateDistance` | queries | none |
| **llmOverlay.ts** | T 1 s (dev) | `strategicLog(galaxy)` (scenario state) | none | none |
| **listSelection.ts / originalWindow.ts / pickMenu.ts / settings.ts / toast.ts / plural.ts / hudLayout.ts / loadingOverlay.ts / messageWindowLayout.ts / resourceAbundance.ts / resxImage.ts / mapOverlays.ts** | generic | none directly | none (loadingOverlay runs `createGameSteps`/`deserializeGameSteps` step functions) | Generic `Set<T>` / `Map<T>` used with sim-object row keys. |

### 2c. src/ui/screens (all opened by the user; most re-render on a timer while open)

**Behaviour shared by all screens:** each reads replica state on open and on its timer, and all mutations go through `issuePlayerCommand` with `onApplied` re-renders unless noted. "Id" in this table means rows or selection keyed by sim objects.

| File | Refresh | Reads (main) | Notable calls / MUT | Id |
|---|---|---|---|---|
| coloniesScreen.ts (+ coloniesList.ts) | T 1000 | Empire `colonies`/`capital(s)`/`characters`/`troops`/`stateMoney`/`economyEfficiency`/`leader`/`control*`; Habitat population and policy, `taxRate`, `facilities`, `troops`, `cargo`, `dockingBays`, `resources`, `ruin`, happiness factors | ~11 tax / approval queries, `resolveBuildableFacilities`, `calculatePlanetaryFacilityCost`; commands ×16 | `Set<Troop>`; selected colony. |
| constructionYards.ts | T 1000 | Empire `constructionYards`/`designs`/`research`/`stateMoney`/max sizes; BuiltObject and Habitat `constructionQueue`, `isShipYard`, waiting queues, `retrofitDesign`, `purchasePrice` | `canBuildBuiltObject`, `yardsCountUnderConstruction`, `componentListDiff`, `constructionJobRows`, `fleetBuildProgress`; commands ×11 | **Map<BuiltObject, string>** ×2, `WeakMap<object, …>` ×2, `Map<Empire, …>`. |
| buildOrder.ts (+ buildOrderModel.ts) | T 2000 | Empire `designs`/`stateMoney`/force structure projections/`colonies`/`constructionYards` | `refactorForceStructureProjectionsToCosts` (`randomizedOrder=false`, so no rnd), `getBuildableDesignsBySubRoles`, `findNewestCanBuild`, `moneyPanelIncome`; command ×1 | `Map<SubRole, Design>`. |
| buildQueue.ts (+ buildQueueModel.ts) | T 1000 | Empire yards, construction ships, `targetHabitat`; queues; BuiltObject `components`/`retrofitDesign`/`purchasePrice` | `constructionJobRows`, `fleetDesignBook`, `fleetBuildProgress`; command ×1 | **Map<BuiltObject, string>** ×2, `Set<BuiltObject>`. |
| shipsAndBasesList.ts | T 1000 | `Empire.builtObjects`/`privateBuiltObjects`/`designs`/`troops`/`characters`; about 28 BuiltObject fields (cargo, damage, `retrofitDesign`, `suppressAutoRetrofit`, `scrap`, `weapons`, docking) | `planRetrofit`, `newDesignDraft`, `getBuildableDesignsBySubRoles`, `constructionJobRows`; commands ×10 | Selected rows (BuiltObject). |
| shipDesigns.ts / designEditor.ts / designPanelsModel.ts | T 2000 (list); U (editor) | Empire `designs`/`controlDesigns`/`research`/race; design stats; editor draft | **Writes only to the UI-owned `DesignDraft` clone** (`design.name`, `isObsolete`, tactics, `pictureRef`, scaling; `prepareDesignForEditor(draft)`); `saveDesign` / `deleteDesign` / … are commands ×8 | `Map<Empire, string>`; the draft references replica components / designs. |
| fleetsList.ts / fleetDesignsTab.ts | T 1000 | `empireShipGroups`; ShipGroup `posture`/`attackPoint`/`gatherPoint`/troop loadouts/`ships`/`leadShip`; Empire `colonies`/`characters`/`troops`/`designs` | `getFleetAdmiralsAndGenerals`, `shipGroupTotalTroopCapacity`, `fleetTemplateTotals`, `pickFleetShips`; commands ×10 | Selected fleet (ShipGroup). |
| troops.ts | T 1000 | Empire `troops`/`colonies`/`troopMaintenanceFactor`; Habitat `troops`/`invadingTroops`/`troopsToRecruit`; `empireShipGroups` | `resolveRecruitableTroopsForColony`, `compareShipGroups`, maintenance queries; commands ×6 | `Map<Empire, string>`; Troop rows. |
| researchScreen.ts (+ researchTreeModel.ts, researchBenefits.ts) | **T 250** | `Empire.research` (`ResearchSystem` tree / queue / progress), `researchBonus*` and special bonuses (~30 fields), `builtObjects` research stations, characters | `annualResearchPotential`, `calculateResearchTotal`, `calculateCrashResearchProgramCost`, `checkNodeValidForRace`; commands ×4 (`playerOrders` functions are only re-exported) | `Map<Empire, string>`; selected TechNode. |
| empirePolicy.ts (+ empirePolicyModel.ts) / gameOptionsPanel.ts | U | `Empire.policy`, `control*` automation fields | command `setPolicy` / `setEmpireControl` | none |
| empireSummary.ts (+ empireSummaryModel.ts) | T 1000 | about 40 Empire bonus fields, `characters`, `leader`, `colonies`, `spacePorts`, `miningStations`, `privateBuiltObjects`, pirate economy | `computeEconomyBreakdown`, `annualTaxRevenue`, `annualStateMaintenance`, `crisesSummaryRows`; commands ×2 | none |
| expansionPlanner.ts | T 1000 (buttons only); U (list rebuild) | Galaxy sectors / systems / habitats / resources / `empires` / `pirateEmpires`; Empire `colonizableHabitatTypesForEmpire`, `designs`, `spacePorts`, `miningStations`, `visibility` | heavy AI queries: `identifyColonizationTargetsFull` (`filterOutDangerous=false`), `identifyResourceCentres`, `checkWhetherHabitatIsDangerous`, `canEmpireColonizeHabitat*`, `determineResourceValue`, `galaxyResourceCurrentPrices` (side table), `fastFindNearestSpacePort`; commands ×4 | selected Habitat. |
| charters.ts | T 2000 | charter state (scenario), Empire `capital`/`colonies`/`designs`/`stateMoney`, `galaxy.habitats` | `charterEligibility`, `charterFee`, …; commands ×2 | none |
| diplomacyScreen.ts (+ diplomacyRelationsView.ts, empireIntel.ts, warTermsPanel.ts, tradePanel.ts) | T 1000 (diplomacy); T 1000 (trade panel) | Empire `diplomaticRelations`/`proposedDiplomaticRelations`/`pirateRelations`/`counters`/`knownPirateBases`/`colonies`/`capital`/`governmentId`/`visibility`; empire evaluations; `empireMessages` | `listProposals`, `relationshipFactors`, `determineDesiredDiplomaticRelationTypical`, `militaryPotency`, `incidentRows`, `councilView`, `reputationRows`; the trade panel edits the **UI-owned TradeNegotiation** (`add`/`remove`/`clearTradeItems`, safe); commands ×5 + ×5 (war terms) + ×1 (trade); calls `expireDiplomacyMessages`, which reaches the **advisorSuggestions MUT** in messagePopups | `Set<Empire>`, `Map<Empire, string>`, `Set<Habitat>`, `Map<Empire, ProposalResult>`, **Map<Empire, Draft>** (war terms). |
| empiresList.ts | U | `galaxy.empires`, `independentEmpire`; Empire `capital`/`colonies`/`diplomaticRelations`/`pirateRelations` | `displayColorForEmpire`, rimTraderRows (see the obtainDiplomaticRelation MUT) | `Set<Empire>`. |
| intelligence.ts (+ characterEventText.ts) | T 1000 | `getEmpireCharacters`, Character `skills`/`traits`/`mission`/`eventHistory`/`transferExpectedArrivalDate`; known colonies / bases / yards (`resolveKnown*`); Empire relations, `research`, `shipGroups` | builds a new `IntelligenceMission` on the main thread and passes it to `setAgentMission`; commands ×12. **Dead but exported mutators:** `dismissCharacter` (`c.mission = null; c.kill(galaxy)`), `assignMission` (`agent.mission = …`), `cancelMission` (`cancelIntelligenceMission`, `agent.mission = null`); not called anywhere in src | selected Character. |
| empireComparison.ts | T 5000; game-end handler | Galaxy victory fields (`gameIsFinished`, `gameVictor`, `globalVictoryConditions`, …), Empire `score`/`achievements`/`research`/`totalPopulation`/`colonies` | `generateVictoryConditionProgresses`, `calculateEmpireScore`; **MUT: `setGameEndHandler(galaxy, h)`; `h` runs `doGameEnd` (`galaxy.gameIsFinished`/`gameVictor`) and `reviewAchievements` (every `empire.achievements`/`score`), then `time.paused = true`** | none |
| galacticHistory.ts / messageHistory.ts | T 1000 (chronicle only); U (rebind on open / filter) | `empireMessageHistory`, event log entries, chronicle, archive | **MUT: `removeOldHistoryMessages(empire)`** on rebind (sorts and splices `Empire.messageHistory`); `eventLogEntries` may lazily create scenario state | selected row = EmpireMessage. |
| galaxyMap.ts | U (open on G; layers built in `setTimeout` slices) | Galaxy systems / habitats / locations / sectors; Empire `colonies`, `colonizationTargets`, `knownPirateBases`, `diplomaticRelations`, `visibility`, `researchBonus` | none mutating | **WeakMap<Galaxy, MapLayers>** (static layers cached per galaxy); `Set<Habitat>`. |
| tradeFlows.ts | T 1000 | **`tradeFlowLedger(galaxy)` (a side table)**, `galaxyStarDate`, `playerEmpire` | `flowsInWindow`, `empirePairTotals`; sets overlay `keepRecording` (which keeps the ledger enabled) | none |
| galactopedia.ts / tutorials.ts / credits.ts / mainMenu.ts / mht.ts / saveLoad.ts / newGameWizard.ts / gameMenu.ts | U | static GameData, race files (fetched); saveLoad calls `serialize` / `loadSave` (main → worker); gameMenu and tutorials write `clock.paused` | `loadGameData`, `parseRace`, `applyEmpireDefaults` (writes the options object only) | none |

### 2d. src/llm

| File | Freq | Reads | Calls / MUT | Id |
|---|---|---|---|---|
| llmLayer.ts | T 2000 poll (only with `llmFoundations`) | scenario flags | `llmOn`, `strategicOn`, `voicesOn` | none |
| queue.ts | async | `galaxyStarDate`, `scenarioParam`, `Empire.messages`, `policy` | none | `Set<AbortController>` |
| chronicleJob.ts | T 2000 poll | `digestFor` (event log), Empire race / name / id, `dueChronicleYear` | **MUT: `storeChronicleYear(galaxy, entry)`** pushes into event-log state (`scenario.state`) | none |
| strategicJob.ts | T 2000 poll | `galaxy.empires`, `strategicLog`, `digestFor`, `legalMoves`, `nearestAiEmpires` | `issuePlayerCommand('llmStrategic')` | in-flight Map keyed by `empireId` (number) |
| voiceJob.ts | T 2000 poll | Empire `leader`, `messages`, race; `councilSpeakers` | **MUT: `drainVoiceCues(galaxy)` takes the sim-side `pendingCues` queue (filled during the sim tick; a module WeakMap, not on the replica)** | **WeakMap<EmpireMessage, VoicedMessage>**, `WeakMap<object, SpeechEntry>` |
| orders.ts | async | `buildOrderMenu` | `issuePlayerCommand` ×3 | none |
| archivist.ts | U | archive / event-log state | `retrieveArchive` (query) | none |

---

## 3. Hot per-frame field set (the minimum the Main View needs every frame)

**Galaxy**
- Scalars: `nowMs`, `sizeX`, `sizeY`, `sectorSize`, `randomSeed`.
- Collections (identity and length checked): `builtObjects[]`, `creatures[]`, `empires[]`, `pirateEmpires[]`.
- References: `independentEmpire`, `playerEmpire`.
- `systems[]`: `systemStar`, `habitats`, `creatures`. `galaxyMarkers` also reads `dominantEmpire`, `isDisputed`, `totalStrategicValue`, `hasRuins` and `independentColonyCount`, but only at 1 Hz.
- `habitats[]` (orbit positions).
- `scenario` (flags / state).
- **`builtObjectIndexGrid`**: fog's "ship outside system" scan. It is a deep container reached from the hot Galaxy, so it is hot (and costly) under the current rules. Consider replacing that scan with the render-side `BuiltObjectIndex`.

**BuiltObject**
- Motion: `xpos`, `ypos`, `_heading`/`heading`, `targetHeading`, `currentSpeed`, `targetSpeed`, `topSpeed`, `warpSpeed`, `cruiseSpeed`, `lastTouch`, `parentHabitat`, `parentOffsetX/Y`, `parentBuiltObject`, `dockedAt`, `hasBeenDestroyed`.
- Identity / art: `empire`, `actualEmpire`/`owner`, `role`, `subRole`, `design` (`imageScalingType`, `imageScalingFactor`, `hyperDriveIndex`), `pictureRef`, `size`, `isPlanetDestroyer`, `builtObjectID`, `shipGroup`.
- Visibility: **`nearestSystemStar`**, **`stealth`**, `pirateEmpireId`, **`sensorLongRange`**, **`sensorProximityArrayRange`**.
- Combat: `weapons[]`, `explosions[]`, `lastShieldStrike`, `lastShieldStrikeDirection`, `currentShields`, `shieldsCapacity`, **`attackers`**, `damagedComponentCount`, `unbuiltComponentCount`, `components` (livery, damage).
- Hyper: `canHyperJump`, `hyperjumpCountdown`, `hyperjumpPrepare`, `hyperjumpAboutToEnter`, `hyperjumpJustExited`, `hyperEnterStartAnimation`, `hyperExitStartAnimation`, `hyperjumpX/Y`.
- Ambient: **`engineType`**, **`doingMining`**, **`doingGasMining`**, **`doingConstruction`**, **`builtAt`**, `constructionQueue`.
- Overlays: **`mission`**, `currentTarget`, **`threats`**.
- Livery: `dateBuilt`, `dateRetrofit`, **`locationEffects`**, **`lastLocationEffectTouch`**.
- Freight: **`contractsToFulfill`**.
- Fighters: `fighters`.
- Audio flags: `ionStrikeSoundPlayed`, `hyperjumpAboutToEnterSoundPlayed`.

**Fields in bold are NOT in `alwaysHotFields`.** BuiltObject is fixed-hot, so these arrive only with the cold cycle (about 0.5 s). Most are fine at that latency. Two are not:
- `nearestSystemStar` decides whether a ship is visible, so a stale value makes ships pop in and out.
- `attackers` drives combat bars and battle icons.

`mission` (travel vectors), `doing*` (animations) and `fighters` changes are tolerable.

**Since chunk 2** (docs/sim-worker.md §3.2-3.3): all of the bold fields are in `alwaysHotFields` (with `lastIonStrike`, `canHyperJump`, `lastLocationEffectTouch`), `attackers` is compared as a gate list, `mission` / `design` / `shipGroup` are compared every step but travel cold, Fighter / Weapon / FighterWeapon / Explosion have fixed hot lists, a habitat's explosions and a parked-at habitat's orbit fields arrive hot, the player's `SystemVisibility.status` is compared every step, and `Galaxy.systems[].creatures` is a hot container. `builtObjectIndexGrid` stays cold: its cells are 400 000 units wide, so a ship changes cell rarely and the only reader (fog's `findShipOutsideSystemWithScanRange` for the cell of the point tested) is off only for a ship that crossed a cell boundary in the last cold cycle; comparing every cell every step would send each splice's element shifts hot.

**Creature**
- `xpos`, `ypos`, `currentHeading`, `targetHeading`, `currentSpeed`, `targetSpeed`, `movementSpeed`, `hyperSpeed`, `lungeSpeed`, `accelerationRate`, `lungeAccelerationRate`, `turnRate`, `parentHabitat`, `parentX/Y`, `lastTouch`, `hasBeenDestroyed`, `damage`, `damageKillThreshold`, `isVisible`, `currentTarget`, **`distanceToTarget`** (missing from the fixed list), `size`, `type`, `pictureRef`, `creatureId`, `nearestSystemStar`, `explosions`.

**Fighter**
- `xpos`, `ypos`, `heading`, `targetHeading`, `currentSpeed`, `targetSpeed`, `topSpeed`, `onboardCarrier`, `parentBuiltObject`, `lastTouch`, `hasBeenDestroyed`, `empire`, `specification` (static), `pictureRef`, `size`, `health`, `fighterID`, `weapons[]`, `explosions[]`, `lastShieldStrike(+Direction)`, `currentShields`, `lastLocationEffectTouch`.

**Weapon (shots in flight)**
- `x`, `y`, `heading`, `speed`, `lastFired`, `distanceTravelled`, `target`, `power`, `range`, `rawDamage`, `bombardDamage`, `damageLoss`, `component`, `type`, `category`, `willHitTarget`, `resetNext`, `ts`, `soundEffectPlayed`.

**Explosion**
- `explosionStart`, `explosionSize`, `explosionOffsetX/Y`, `explosionImageIndex`, `explosionCurrentImage`, `explosionSoundPlayed`.

**Habitat (cold class, needed every frame)**
- Orbit: `parent`, `orbitAngle`, `anglePerSecond`, `orbitDirection`, `orbitDistance`, `lastTouch`, `xpos`, `ypos` (the angle and touch pair must be consistent within one step).
- Draw: `hasBeenDestroyed`, `category`, `type`, `diameter`, `systemIndex`, `empire`/`owner`, `population` (labels), `explosions` (hot container), `planetaryShieldPresent`, `giantIonCannon(Present)`, `attackers` (battle icons, 1 Hz), `constructionQueue` (ambient), `scenicFactor`/`researchBonus` (overlays).

**Empire**
- `mainColor`, `secondaryColor`, `flagShape`, `empireId`, `dominantRace`, `pirateEmpireBaseHabitat`, `capital`, `capitalSystemStars`, `colonies`, `shipGroups`, `builtObjects`, `longRangeScanners[]`, `empiresViewable`, `knownPirateBases`, `diplomaticRelations` (colours / fade), `researchBonus`, `colonizableHabitatTypesForEmpire()`.
- **`visibility`** (EmpireVisibility: `systemVisibility[i]` status / `explored` / `threats` / `isRefuellingPoint`, `empiresSharedVisibility`). This is a separate, cold class, read every frame by fog.

**ShipGroup**
- `leadShip`, `ships[]`, `posture`, `mission`, `role`, `lastTouch`.

## 4. Direct sim mutations and registrations outside the command queue

**Every frame, or on a timer**
1. `src/audio/mainViewSounds.ts` (every frame): `weapon.soundEffectPlayed`, `explosion.explosionSoundPlayed`, `bo.ionStrikeSoundPlayed`, `bo.hyperjumpAboutToEnterSoundPlayed`. On a replica these writes are overwritten by the sync, so sounds may replay. Move this to a render-side `WeakSet`, or let the worker emit sound events.
   **Done (chunk 2):** on a replica the sound pass keeps render-side marks (`mainViewSounds.ts ReplicaSoundMarks`, keyed by a shot's LastFired, the explosion object, LastIonStrike and the jump's countdown) and writes nothing; in-thread it still uses the sim's flags (`simFlagSoundMarks`).
2. `src/main.ts` `refreshHud` at 4 Hz → `ui/empireMessageFeed.ts recordTickerMessage`: `message.starDate = …`; `addHistoryMessage` (`Empire.messageHistory.push`).
3. `ui/messagePopups.ts tick` at 4 Hz:
   - `m.starDate = galaxyStarDate(galaxy)` (two sites);
   - `receiveAdvisorSuggestionMessage` → `Empire.advisorSuggestions` push;
   - `onGameEnd(galaxy, defeat)`, which runs the handler in item 9.
4. `ui/messagePopups.ts` `setDiplomacyMessageExpiry` callback → `expireAdvisorSuggestionsForEmpire` (splices `advisorSuggestions`). It is reached from `diplomacyScreen.ts` (submitProposal `onApplied`, `expireMessagesFor`) and from conversation actions.
5. `sim/advisorQueue.ts advisorSuggestions(empire)` lazily sets `empire.advisorSuggestions = []`. It is called at 4 Hz by `messageStubList` and `advisorSuggestions` (benign, but a write).
6. `ui/eventMessages.ts`:
   - defines a non-enumerable `player.eventMessageRecipient`, which the sim calls synchronously in a tick;
   - its 4 Hz handler builds an `EmpireMessage` and calls `sendEmpireMessage(m, player)` → `Empire.messages.push`, plus `empireMessageTap` (event-log append).

**On user action, screen open or boot**
7. `ui/screens/galacticHistory.ts rebind` → `removeOldHistoryMessages(empire)` (sorts, reverses and splices `Empire.messageHistory`).
8. `render/freightOverlay.ts` → `enableTradeFlowRecording` / `disableTradeFlowRecording`: creates the ledger in a sim-module `WeakMap` and registers or unregisters a sim contract listener. `ui/screens/tradeFlows.ts` keeps it on through `keepRecording`.
9. `ui/screens/empireComparison.ts installGameEndHandler` → `setGameEndHandler(galaxy, h)`. The sim calls `h` during a tick. `h` runs `doGameEnd` (`galaxy.gameIsFinished`, `gameVictor`) and `reviewAchievements` (every empire's `achievements`/`score`), then sets `time.paused`.
10. `main.ts registerLocationPingedHook` (story events call it during a tick to centre the camera).
11. `render/rimAtmosphereWiring.ts` (once at `MainView.init`): `installRimWeights` / `installRimNameOverrides` write `galaxy.scenario.state[…]`, which sim message code reads.
12. `ui/orderMenu.ts` → `sim/player/orderMenu.ts openActionMenu` / `selectionButtons` draw **`galaxy.rnd`** (`selectRelativePoint`, `selectRelativeHabitatSurfacePoint`, `selectRelativeParkingPoint`). This happens on user input and is not journaled. On a replica it diverges the RNG; it needs a worker query, or the positions must be chosen inside the command.
    **Done (§4.1 below):** the journaled `actionMenu` / `selectionButtons` (drawing pages) / `habitatDispatch` commands.
13. `ui/advisorClient.ts`: `runPlayerCommand(galaxy, player, 'advisorCommands', …)` executes synchronously (bypasses the queue).
14. `ui/diplomatVoice.ts`: `runPlayerCommand(…, 'diplomatCounter', …)` executes synchronously.
15. `ui/aiAdvisorDriver.ts`: `applyStrategicDecisions` → `applyStrategicCommand` plus `appendCommandLog`, run directly.
16. `llm/chronicleJob.ts`: `storeChronicleYear` (event-log `chronicle` list in `scenario.state`).
17. `llm/voiceJob.ts`: `drainVoiceCues` consumes the sim-side cue queue (module `WeakMap`, filled in the tick).
18. `ui/scenario/rimTraderRows.ts`: `obtainDiplomaticRelation(rimTrader, viewer)` may `add` a NotMet `DiplomaticRelation`.
19. `main.ts bootGameFromWizard`: `game.playerEmpire.flagShape = …` (before the view starts; move it into the worker's createGame options).
20. `ui/screens/intelligence.ts` exports `dismissCharacter`, `assignMission` and `cancelMission`, which write `Character.mission`, call `c.kill(galaxy)` and call `cancelIntelligenceMission`. Nothing in src calls them; delete them or route them through commands.
21. `main.ts`, `ui/autosave.ts`, `ui/screens/saveLoad.ts`: `serializeGame` / `deserializeGameSteps` on the main thread (whole-graph read; the replica lacks the queue, log and ledger tables).
22. The clock (GalaxyTime `paused`/`speed`), a sim input. Writers:
    - `keyboard.ts`
    - `hud.ts`
    - `gameMenu.ts`
    - `autoPause.ts`
    - `orderMenu.ts` (action menu)
    - `empireComparison.ts`
    - `messagePopups` (immediate conversation)
    - tutorials / main.

    Each change must become a message to the worker.
23. Debug: `__dwu.galaxy`/`game`/`sim`/`commands.issue`/`commands.log` expose the live sim graph.
24. Found at run time by the replica write detector (sim-worker.md §9 chunk 0), not by this audit: `ui/hud.ts`
    `refreshMoney` / `buildMoneyPanel` → `sim/treasury.ts moneyPanelIncome` → `checkAgeVariableIncome` writes
    `Empire.useAveragedVariableIncome`, `variableIncome`, `lastVariableIncomeUpdate`, `thisYearsResortIncomeValue` and,
    at a new galactic year, every base's `BuiltObject.currentYearsIncome` (a UI-driven sim write in C# too, Main.Part11.cs
    841). `audio/gameAudio.ts` also redefines `player.eventMessageRecipient` (item 6).
    **Done (§4.1 below):** the journaled `moneyPanel` command when a write is due; otherwise a read-only read.

### 4.1 UI writes outside the journal: decisions (2026-10-03)

The paths that wrote the game, or drew `galaxy.rnd`, from the UI outside the journaled command queue (in-thread: not in
the command log, so seed + log replays drifted; in worker mode: written on the replica, or run in the worker as an
unjournaled query). Found by the in-thread save-text probe of `scripts/simworker-smoke.mjs --inthread --detect-writes`
(every step of a UI tour: select, hover, right-click, every left-sidebar panel and top-bar screen, on a fresh game and
on `late2500.dwusave`), the worker-mode write detector (`--detect-writes`, same tour), a grep of `galaxy.rnd` /
`rnd.next` / `isReadOnlyGalaxy` sites reachable from `src/ui` / `src/llm`, and this list. The rule: where the C# UI
makes the write, it becomes a journaled player command issued at the same point; where only our port writes, the read
becomes side-effect-free.

| Path | C# | Decision |
|---|---|---|
| Right-click action menu (`openActionMenu`: "Build here" `SelectRelativePoint`, `ReviewLatestDesigns`) | Main.Part8.cs 1332 actionMenu_Opening → 3202 method_344 (1839 / 1912 SelectRelativePoint, 4860 ReviewLatestDesigns) | journaled `actionMenu` command; the reply is the menu |
| Selection buttons, an unowned / independent habitat's top page and a habitat's Build Options (`SelectRelativeHabitatSurfacePoint`, `SelectRelativeParkingPoint`, `DetermineOrbitalBaseLocation`) | Main.Part3.cs method_593 2293-2307, 2945, 2958 | journaled `selectionButtons` command (`selectionButtonsDrawRandom`), on input only as before; every other page is a read |
| Habitat dispatch buttons (an action menu per candidate ship) | none (our buttons), but built from the method_344 menus, which draw / review | journaled `habitatDispatch` command (its draws affect results, so not a read) |
| Left-sidebar row click / any selection of such a habitat | as the two above | through them |
| Money panel `CheckAgeVariableIncome` (+ ThisYears*Income resets) | Main.Part11.cs 832 method_126 / 841 (the only caller; timer 756, pause 2214) | journaled `moneyPanel` command when `moneyPanelWriteDue` (first refresh, a new galactic year); otherwise a read-only read |
| Build Order cashflow | Main.Part2.cs 785 shows the panel's last figure (no ageing) | read-only read |
| Obtain* lookups from UI reads (hover hint `resolveHoverOrder`, talk panel `listProposals`, pirate protection price, screens) | Main.Part10.cs 365 / 434 / 567 (mouse move), Main.Part9.cs 46 method_238, Empire.2.cs 2649 … | the read returns the detached record and asks for it; one journaled `obtainUiRecords` command per UI task adds it (both modes; fixes chunk 6's open item) |
| `ThisYearsSpacePortIncome` ageing, the NaN tax recalculation, `ThisYearsResortIncome` reset, `_WondersBuilt` / scenario-bag creation on a UI read | getters the C# UI also reads, but the ageing count depends on how often a screen redraws | read-only (the value without the write): port side effect, a cache, or no information |
| Local-model briefs / digests / archive (`llm/replicaReads.ts readReplica`; `askArchivist` now too; the AI advisor's validation listing) | none (port-only) | `withPureSimReads`: read-only and no record requests. In-thread a strategic brief used to add 1 to every unearning AI base's `consecutiveUnprofitableYears` per read |
| Empire Policy panel's automation combos written into `Empire.control*` in-thread | method_597 (UI writes) | `setEmpireControl` commands in both modes (was worker-only) |
| `applyStrategicDecisions` (AI advisor, in-thread direct) | none | already journaled ('ai-advisor'); now applied in `withSimWrites` like its replay |

**Still outside the journal (documented, not changed):** the player message pipeline's writes (items 2–4, 6: ticker
star dates, `messageHistory`, the advisor queue, event messages, the defeat game end — `ui/messagePipeline.ts`, run as
sim writes in both threads; in worker mode after every tick, in-thread from the 4 Hz timers) and its `uiOp`s (Galactic
History's trim, the advisor expiry); the chronicle store (item 16; host op in worker mode); the wizard's `flagShape`
(item 19, before the first frame). None of them feeds the AI or the economy, but a command that names an advisor
suggestion (`approveSuggestion`) resolves it by its index in the queue the pipeline fills, which a headless replay does
not fill: making the pipeline sim-side (run at the frame boundary in both modes and in replays) is the follow-up.

**Checked and safe (no sim write)**
- `identifyColonizationTargetsFull` with `filterOutDangerousTargets=false` (it would push `empire.dangerousHabitats` if true).
- `refactorForceStructureProjectionsToCosts` with `randomizedOrder=false`.
- DesignDraft clone edits; TradeNegotiation tree edits.
- `playerOrders` functions in the research, troops and construction-yard screens are only re-exported.
- The render layers (ambient, effects, fighter, creature) document and keep render-local state and RNG instead of writing sim fields.

## 5. Low-rate UI reads (cold sync is enough)

- **4 Hz:**
  - player Empire: `messages`, `messageHistory`, `advisorSuggestions`, `stateMoney`, `research`;
  - `moneyPanelIncome` (treasury inputs);
  - `topSystemNameText`;
  - fog `selectionUnseen`;
  - `researchScreen` (`ResearchSystem`).
- **2 Hz:** the selected object in full (`selectionInfo`, `hud.builtObjectStatusRows`, the order action bar); left sidebar lists (Empire colonies, ships, fleets, characters, troops, yards).
- **1 Hz** (while a screen is open): colonies, construction yards, build queue, ships & bases, fleets, troops, empire summary, diplomacy (relations, proposals, evaluations, pirate relations), intelligence (characters, missions, known targets), expansion planner (buttons), trade flows / trade panel, galactic history chronicle, galaxy-marker rings.
- **0.5 Hz:** ship designs, build order, charters.
- **0.2 Hz:** empire comparison (victory, scores).
- **On open:** galaxy map static layers, galactopedia, expansion planner lists (heavy AI queries), left-sidebar slow panels.
- **Side tables the UI needs that the replica does not carry:**
  - `tradeFlowLedger`
  - `commandLog`
  - `strategicLog`: lives in scenario state, so it is synced
  - the `voiceCues` queue
  - `galaxyResourceCurrentPrices` / `ComponentCurrentPrices`: in `collectSideTables`, so synced
  - `habitatCharacters` / `captainBonuses`: synced

## 6. Proposed porting chunks (8, independent)

1. **Sim host, clock, boot and persistence:** `src/main.ts`, `src/simLoop.ts`, `ui/autosave.ts`, `ui/screens/saveLoad.ts`, `ui/screens/gameMenu.ts`, `ui/autoPause.ts`, `ui/keyboard.ts` (clock handlers), `ui/loadingOverlay.ts`, `ui/screens/newGameWizard.ts`, `ui/screens/mainMenu.ts`, `ui/screens/tutorials.ts`.
   - Worker owns createGame / load / serialize.
   - Clock and speed become messages; `renderTime` travels per step.
   - `flagShape` moves into the createGame options.
   - The `__dwu` debug hooks need a decision.
2. **Main View hot path:** `render/mainView.ts`, `renderInterp.ts`, `builtObjectIndex.ts`, `builtObjectLayer.ts`, `fighterLayer.ts`, `creatureLayer.ts`, `effectsLayer.ts`, `ambientLayer.ts`, `shipOverlays.ts`, `liveryLayer.ts`, `combatBars.ts`, `rangeRings.ts`, `followCamera.ts`, `boxSelect.ts`, `pickStack.ts`, `habitatIndex.ts`, `fog.ts`, plus `src/audio/mainViewSounds.ts` and `gameAudio.ts`.
   - Validate the §3 hot set against `alwaysHotFields` (`nearestSystemStar`, `attackers`, `distanceToTarget`, `doing*`, `sensor*`/`stealth`).
   - Decide the cost of `builtObjectIndexGrid`.
   - Replace the audio flag writes with render-local tracking.
3. **Map overlays and scenario map art:** `render/empireLayer.ts`, `overlayLayer.ts`, `galaxyMarkers.ts`, `battleIcons.ts`, `freightOverlay.ts`, `artBundleLayer.ts`, `threatMarkers.ts`, `wreckDebris.ts`, `leagueArt.ts`, `concordArt.ts`/`concordFleet.ts`/`concordHull.ts`, `empireLineage.ts`, `rimAtmosphereLayer.ts`, `rimAtmosphereWiring.ts`, `rimDust.ts`, `ui/screens/galaxyMap.ts`, `ui/screens/tradeFlows.ts`, `ui/freightText.ts`, `ui/mapOverlays.ts`, `ui/scenario/wreckageUi.ts`.
   - Move the rim install and trade-flow recording into the worker.
   - Sync the trade-flow ledger as a side table.
4. **Messages, events and game end** (the largest mutation cluster): `ui/empireMessageFeed.ts`, `messagePopups.ts`, `messageStubList.ts`, `messageStubs.ts`, `messageRouting.ts`, `messagePicture.ts`, `messageGoto.ts`, `conversationActions.ts`, `eventMessages.ts`, `advisorSuggestions.ts`, `pirateProtectionPrice.ts`, `ui/screens/galacticHistory.ts`, `messageHistory.ts`, `empireComparison.ts`.
   - Move starDate stamping, history and advisor-queue writes, `eventMessageRecipient`, `sendEmpireMessage`, `removeOldHistoryMessages`, `onGameEnd` / `reviewAchievements` and the location-pinged hook into the worker, as a "player message received" event stream plus commands.
5. **HUD, selection and orders:** `ui/hud.ts`, `selectionInfo.ts`, `selectionInfoView.ts`, `leftSidebar.ts`, `leftSidebarView.ts`, `orderMenu.ts`, `shipCommandKeys.ts`, `shipHotkeys.ts`, `topBar.ts`, `mapTooltip.ts`, `pickMenu.ts`, `listSelection.ts`, `screens/coloniesList.ts`.
   - Order-menu `galaxy.rnd` draws become a worker request or are folded into the command.
   - The async `onApplied` contract.
   - Selection identity across replica deletes.
6. **Empire management screens** (command-only, about 1 Hz): `ui/screens/coloniesScreen.ts`, `constructionYards.ts`, `buildOrder.ts`/`buildOrderModel.ts`, `buildQueue.ts`/`buildQueueModel.ts`, `shipsAndBasesList.ts`, `shipDesigns.ts`, `designEditor.ts`, `designPanelsModel.ts`, `fleetsList.ts`, `fleetDesignsTab.ts`, `troops.ts`, `researchScreen.ts`, `researchTreeModel.ts`, `researchBenefits.ts`, `empirePolicy.ts`/`empirePolicyModel.ts`, `gameOptionsPanel.ts`, `expansionPlanner.ts`, `empireSummary.ts`/`empireSummaryModel.ts`, `charters.ts`, `galactopedia.ts`, `credits.ts`, `mht.ts`.
   - Mostly async `onApplied`.
   - Command-codec support for DesignDraft and ShipAction.
   - Confirm the heavy AI queries stay write-free on the replica.
7. **Diplomacy, intelligence and politics:** `ui/screens/diplomacyScreen.ts`, `diplomacyRelationsView.ts`, `empireIntel.ts`, `empiresList.ts`, `tradePanel.ts`, `warTermsPanel.ts`, `intelligence.ts`, `characterEventText.ts`, `ui/courtView.ts`, `emergentPolitics.ts`, `internalSecurityView.ts`, `scenario/rimTraderRows.ts`, `leagueRows.ts`, `empireEmblem.ts`, `raceDisplayArt.ts`, `characterPortrait.ts`.
   - Replace `obtainDiplomaticRelation` with a non-creating lookup.
   - Delete the dead intelligence mutators.
   - Codec support for IntelligenceMission, TradeNegotiation and PeaceTerms.
8. **LLM and AI advisor:** `src/llm/*` (`llmLayer`, `queue`, `chronicleJob`, `strategicJob`, `voiceJob`, `orders`, `archivist`), `ui/advisorClient.ts`, `advisorPanel.ts`, `diplomatVoice.ts`, `aiAdvisorDriver.ts`, `aiAdvisorLog.ts`, `llmOverlay.ts`, `eventLogDev.ts`.
   - `runPlayerCommand` and `applyStrategicDecisions` become queued commands with async results.
   - `storeChronicleYear` becomes a command.
   - `drainVoiceCues` becomes a worker → main event.
   - Brief builders (`buildAdvisorBrief`, `buildStrategicBrief`, `buildDiplomatBrief`, `digestFor`) can run on the replica or the worker.

**Suggested safety net for every chunk:** in dev builds, have the replica decoder detect writes to replica objects outside its own apply. For example, on the cold cycle compare replica fields with the last values it applied, and log the first offender per class and field. That catches the indirect lazy-init writes a static audit can miss.
