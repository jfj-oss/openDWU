# Review: player command layer vs decompiled C# (read-only)

Checkout: `/home/justinf/projects/Dwureup/game` on main at 6046cff (Merge wip/ordermenu). The working tree was clean; `src/sim/player/orderMenu.ts` and `src/ui/orderMenu.ts` were reviewed as merged.
`$C` = `…/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded`.

Severity key: **crash**, **wrong** (wrong behaviour), **cosmetic** (text, UI, or an edge case with no gameplay effect).

## Method and coverage

I compared these statement by statement:
- **executeShipAction.ts** against Main.Part7.cs 45-1860 (method_347 is at 45, not 234), BaconMain.cs 160 HandleToolstripClick, and Main.Part4.cs 2826/2871 (method_539/540).
- **shipAction.ts** against ShipAction.cs and Main.Part8.cs 1496-1536.
- **purchaseNewBuiltObject\*** against Empire.6.cs 1991-2180, and **buildNewShips** against Empire.6.cs 3017-3164 plus Main.Part2.cs 929/1135.
- **diplomacyProposals.ts** against Main.Part9.cs 200-560 (method_238) and Main.Part10.cs 3957-5190 (method_237, all cases the port offers).
- **tradeNegotiation.ts** against Main.Part10.cs 4227-4400 and IL_10b3 at 5168.
- **designEditor.ts** save/delete/prepare against Main.Part6.cs 45-230 and 1114-1240.
- **empirePolicyModel.ts** apply against Main.Part3.cs 3971-4201, plus method_604/605 and method_419.
- **game.ts** automation defaults against Start.2.cs 2122-2146 and Main.Part9.cs 2711-2809.

orderMenu.ts (4350 lines) was sampled, not read in full. These parts were checked against the C#:
- method_311/312/315/316-335 (Main.Part8.cs 1395-2340)
- method_341/342 (2577-3034)
- method_323 "Build here" (1748-1930)
- the Rnd sites of method_593 (Main.Part3.cs 2293-2310 and 2941-2960)
- the right-click execution (Main.Part10.cs 3310-3559)
- method_209 (1375-1437)
- method_78 (Main.Part12.cs 2467) and ResolveAssignedFleet (ItemListCollectionPanel.cs 822)
- method_133-140 (Main.Part11.cs 1138-1300)
- CanDeployXaraktorVirus (Empire.10.cs 4518)

**Not verified line by line:**
- the body of method_344 beyond the shared builders
- the method_593 button pages apart from the Rnd sites and the colony build page
- selectionButton/method_588 hint texts
- designWarnings (GetDesignWarningMessages)

A helper agent swept cross-package duplicates, tick-path importers and the CLASSES list. I verified its WithinDistancePotential claim against Galaxy.7.cs 747.

Overall, most of the port is faithful. Branch order, mission types, priorities, money counters (StateMoney plus PirateEconomy.PerformExpense/Income, and PerformPrivateTransaction for private purchases) and Rnd order match wherever I checked. The problems are concentrated in a few TODO stops and in helpers shared with other packages.

---

## 1. shipAction.ts

### (1) Deviations
None. The four constructors, `Clone()` (Target2 not copied, ShipAction.cs 109) and method_313/314/315 match. method_315's SystemInfo → SystemStar swap and its `(int)` casts are correct.

### (2) TODO stubs
None.

### (4) Persistence
`ShipAction` is a class (shipAction.ts:70) and is not in CLASSES. That is fine today, because nothing stores it on Galaxy/Empire/BuiltObject/ShipGroup; the C# never stores it either. If it ever becomes reachable from the galaxy graph, the codec throws "class not registered" (graphCodec.ts:132). Keep it off persisted objects (for example, don't park a "pending order" on a ShipGroup).

---

## 2. executeShipAction.ts (method_347)

### (1) Deviations

**D1 [wrong] The HandleToolstripClick TODO branches abort method_347.**
- In the C#, `BaconMain.HandleToolstripClick` is a `void` call (Main.Part7.cs:47) and method_347 always continues.
- `handleToolstripClick` returns a `todoPort` result, and `executeShipAction` then returns early (executeShipAction.ts:283-284, 311-318).
- The concrete breakage: when the giving ship's empire name contains "Romulan" or "Mining Company" (BaconMain.cs:175), `GiveBuiltObject` never reaches `TakeOwnershipOfBuiltObject` (C# Main.Part7.cs:188-206 / 399-415). The ship is not given at all, not just unpriced.
- The other TODO hints (asteroidColony, constructShip, missionExplore*, recruitShipOfficer) are only produced by the unported Bacon Alt-menu, so they are unreachable today.
- Fix: stub only the Bacon side effect and fall through (return null).

**D2 [wrong] Xaraktor virus has no cooldown.** Main.Part7.cs:1042 sets `PlayerEmpire.LastXaraktorVirusDeploy = CurrentDateTime`. The port skips it (executeShipAction.ts:983-984). Its comment says the field is "read only by the AI's Xaraktor use, Empire.10.cs:4532", but Empire.10.cs:4532 is inside **CanDeployXaraktorVirus**, the player's own gate ("too soon", 150 s). See O1: the order menu also drops the check, so the player can re-deploy on every click. Each deploy is one `Rnd.Next(15,20)` plus 15-19 Kaltor spawns plus a plague infection.

**D3 [wrong, rare] Fighter targets are dropped.**
- `missionTarget()` (executeShipAction.ts:222-225) and `isStellarObject` (210) exclude `Fighter`, because `MissionTarget = BuiltObject|Habitat|Creature|ShipGroup|Sector` (missions/mission.ts:120-122).
- In the C#, `Fighter : StellarObject` (Fighter.cs:19).
- The Escape branches assign `Target = Attackers[0]` (Main.Part7.cs:722-725 / 1326 / 1742). When the first attacker is a fighter, the TS passes a null target to AssignMission/QueueMission (executeShipAction.ts:722-735, 1323-1333, 1741-1756).
- The same null-out applies to any generic mission whose target is a fighter.
- This is project-wide (the MissionTarget type), not local.

**D4 [cosmetic] A null result from Purchase returns ok:false.** When PurchaseNewBuiltObject returns null (executeShipAction.ts:576-578, 1019-1021, 1804-1807), the port returns `ok:false` with a diagnostic. The C# has an empty body and shows no message. There is no sim difference, but the UI shows the diagnostic as a toast (ui/orderMenu.ts:405).

**D5 [cosmetic] "no military ship selected".** For CreateNewFleet with no military ship (executeShipAction.ts:1318), the port returns `ok:false` plus that message. The C# returns silently (Main.Part7.cs:1565).

**Checked and correct:**
- all ActionType / MissionType branches
- the Retire looting chain (ColonyIncomeFactor × LootingFactor → ApplyCorruptionToIncome → StateMoney plus PirateEconomy.PerformIncome(Looting))
- the facility / wonder cost (StateMoney plus PerformExpense(FacilityConstruction))
- the pirate control levels (0.5f / 1f)
- the EmpireActivity argument mapping, and expiry = 1 year or 3 years
- the smuggling toggle and order expiry
- the fleet range ladder
- the fleet priority rules (Refuel → Unavailable; Attack / Bombard / Wait* → High)
- the base / colony build `flag` (isStateOwned) sets
- the Rnd order `2000 + NextDouble()*3000` before SelectRelativeParkingPoint
- `(float)` on TaxRate
- method_539/540

### (2) TODO(port) stubs a normal game hits
- D2 (LastXaraktorVirusDeploy): hit by anyone who researches the Xaraktor virus and builds the RaceAchievement wonder.
- The Bacon form hints (`openForm`) are only produced by the unported Bacon menu, so they are not hit.
- ui/orderMenu.ts:411 method_345 (smuggling resource picker) **is hit** by a pirate player who clicks the selection-bar smuggling button with Target2 == null. It only shows a toast.

### (4) Persistence
- BuiltObject `baconValues` (a Map, builtObject.ts:1493) is handled natively by the codec.
- `EmpireActivity`, `Order`, `ShipGroup.attackPoint/gatherPoint/posture/postureRangeSquared` and `playerEmpireEncounterAction` are all existing fields on registered classes.
- There are no new fields. The one field the C# needs and the TS lacks is `Empire.LastXaraktorVirusDeploy` (D2). Adding it to Empire is persisted automatically (Empire is registered), but it needs a numeric stand-in for `Galaxy.CurrentDateTime`.

---

## 3. orderMenu.ts (sim) and ui/orderMenu.ts

### (1) Deviations

**O1 [wrong] `canDeployXaraktorVirus` never returns "too soon".**
- `canDeployXaraktorVirus` (orderMenu.ts:401-423) always returns true once the wonder exists, with the comment "with the field's DateTime.MinValue default that holds".
- That is only true before the first deploy, because the port never writes the field (D2).
- C#: Empire.10.cs:4532-4536.
- The fix belongs with D2.

**O2 [cosmetic, edge] `withinDistancePotential` uses the wrong test.**
- `withinDistancePotential` (orderMenu.ts:559-561) is `|dx|<=r && |dy|<=r`.
- The C# `CheckWithinDistancePotential` (Galaxy.7.cs:747) doubles the distance and ORs: `|dx|<2r || |dy|<2r`.
- In method_133/134/135 an exact `(int)dist <= r` test follows, so the menus only lose objects with r < |dx| < r+1. That makes the menu difference cosmetic.
- But the same wrong copy exists **on the tick path** in `combat/damage.ts:94` and `combat/weapons.ts:1456` (`checkWithinDistancePotentialLocal`); see section 10. The correct port is `movement.ts:755`.

**O3 [cosmetic] Automation prompts are asked after the order.**
- ui/orderMenu.ts:431-437 asks the prompts after the order has executed. The C# asks the modal box before the statement that follows it.
- `Ctx.askTurnOff` (executeShipAction.ts:183-186) records every prompt and returns false, so the order always runs with automation still on. The flag is then switched off afterwards (applyAutomationOff, orderMenu.ts:3746).
- No current branch reads the flag between the prompt and the end of method_347, so the end state is equal. Treat it as an ordering hazard if later branches read it.

**O4 [cosmetic] `selectNextFromHistory` clears the selection.** It becomes `select(null)` (ui/orderMenu.ts:419). The C# picks the next entry of the selection history (Main.Part7.cs:1722-1735).

**O5 [determinism note] The 500 ms selection-bar refresh skips Rnd pages.**
- The refresh skips pages whose method_593 draws `galaxy.rnd` (ui/orderMenu.ts:572-577, 641).
- The C# redraws every 500 ms (Main.Part11.cs 661), drawing 2-3 Rnd per refresh while an unowned habitat or an own colony's build page is selected.
- This deliberately deviates from brief rule 2. It is the right call, because the C# stream there is wall-clock dependent anyway. Document it in the determinism contract.

**O6 [cosmetic] Unported Bacon menus.** `openActionMenu` omits the Bacon Alt-menu (BaconMain.cs:1288) and the Main.Part2.cs:4888 debug item. Both are TODO'd.

**O7 [cosmetic] `visibleTo(Creature)` is always true** (orderMenu.ts:246-251, TODO), so unseen creatures can appear as targets.

**Checked and correct:**
- the method_311 label rules (including the `X != 0 && Y != 0` Point test)
- method_316's empire list and sort
- the method_317-322 pirate-mission and character-transfer menus
- method_323 (both branches, Rnd per design item)
- method_324-335
- method_341 marking
- the method_342 galaxy-zoom and system-zoom branches
- the "Build at X" sub-role order (GenericBase before ResortBase in 342)
- the right-click ship and fleet execution (Blockade check, LoadTroops enforceMinimumTroopLimits true, Alt → Wait*, High priority set, attack-click sound)
- `orderSubject` (method_209)
- `targetListClick` / `resolveAssignedFleet`
- `fleetPointClick`
- the method_593 own-colony Rnd order (SurfacePoint → DetermineOrbitalBaseLocation → SurfacePoint)
- the unowned-habitat Rnd order (SurfacePoint, then ParkingPoint for stars, with Diameter/2 integer division)

### (2) TODO(port) stubs a normal game hits
- O1 (every Xaraktor player).
- orderMenu.ts:3616 CheckDesignResourcesAtConstructionYard: every Build button lacks the "(RESOURCE SHORTAGE: …)" hint. Cosmetic.
- O7.
- ui/orderMenu.ts:411 (see section 2).

---

## 4. diplomacyProposals.ts

### (1) Deviations

**P1 [wrong, TODO] A pirate player gets no diplomacy.** `canSpeak` returns false whenever either side is a pirate (diplomacyProposals.ts:153-160). A pirate-player game therefore has no conversation at all. The C# PIRATE_* options are at Main.Part9.cs:175-206 and Main.Part10.cs:5088-5160. **Every pirate game hits this.**

**P2 [cosmetic] `related` is null where the C# sets it.** In SUBJUGATION_RELEASE / REQUESTRELEASE / TRADESANCTIONS_LIFT, `related` is null (diplomacyProposals.ts:249-253, 263). The C# passes `relatedInfo` (Main.Part9.cs:393/413/445). method_237 never reads it for these cases, so there is no effect.

**P3 [note] `aggressionLevel` ignores the periodic value.** In SUBJUGATION_REQUESTRELEASE, `aggressionLevel(empire)` is `dominantRace.aggression` (diplomacyTick.ts:186). The C# `Race.AggressionLevel` returns `PeriodicAggressionLevel` while `_ChangePeriodActive` (Race.cs:350-358). This is project-wide.

**Checked and correct:**
- the greeting gates (≥1000 credits for gifts; no warning while at war; the war / sanctions / trade DEAL_BEGIN order)
- all TREATY_PROPOSAL switch arms and their order
- the gift thirds
- every method_237 case offered: automation prompt set, reply per attitude, ChangeDiplomaticRelation/DeclareWar, method_235 both ways, Expire, CancelBlockades both ways, Victor/Subjugation logic, the ResetAttitudeLevels specified-winner argument, the EmpiresViewable forever entry
- the GIFT_GIVE money and PirateEconomy counters (Undefined type), with the CivilityRating clamp via setCivilityRating (matching the Empire.cs:1430 setter)
- the Rnd order: `Next(0,80)` only after the method_232 == None short circuit, and WAR_END's two NextDouble only when they win

### (2) TODO stubs a normal game hits
- P1.
- The "Treaty Negotiation" automation box is a caller responsibility (flagged in `ProposalResult.automationPrompt`).

---

## 5. tradeNegotiation.ts

### (1) Deviations
- **T1 [cosmetic] `staleItem`** (tradeNegotiation.ts:530-549) refuses a deal whose items changed since the trees were built. This is TS-only; the C# relies on the game being paused. It is harmless and defensive, but it is invented behaviour: document it in the code.
- **T2 [TODO, not hit]** A DEAL_OFFER that repeats an incoming offer and is auto-accepted (Main.Part10.cs:4338). Incoming trade offers are not ported, so this is unreachable.

**Checked and correct:**
- OFFER_DEAL_TERRITORYMAP / GALAXYMAP / COMPONENT: acceptance checks, the visibility loops, the Rnd.NextDouble placement inside the `Value <= StateMoney` guard, the breakthrough arguments, and the money plus PirateEconomy(SellInfo) counters
- DEAL_OFFER: Evaluate → threats carried out only on refusal, and only between non-pirates
- the GiveTradeableItem order (ours then theirs)
- the IL_10b3 replies
- the four Review* calls in order

The helper found no duplicate of `tradeableItemIndexOf`.

---

## 6. empireConstruction.ts: buildNewShips / purchaseNewBuiltObject*

### (1) Deviations
None found. I checked:
- the affordability pre-check (Main.Part2.cs:1137, method_632 including the freighter sums)
- the Count guard
- the per-ship price vs the accumulated `num`
- BuildCount ++ and -- on every refusal path
- the name draws (first GenerateBuiltObjectName, then the colony / parent-habitat name)
- ConstructionShip/ResupplyShip → colonies (allowLongWaitQueues), everything else → SpacePorts (no very small yards)
- `AddBuiltObjectToGalaxy(…, isStateOwned: true)` and IsAutoControlled after it
- StateMoney -= num with PerformExpense(Construction) once
- the grouped shortage orders (bases, then colonies, first-seen distinct order, CargoList.Add merge, isState false)

For purchaseNewBuiltObject*, I checked:
- the State vs private funds test
- the space-port name
- the base sub-role list
- the `<3` "no point chosen" test
- `Diameter/6` and `/2` and `/8` as short integer division
- the local correct CalculateAngleFromCoords
- `(int)x2,(int)y2` into AddBuiltObjectToGalaxy
- the pirate → StateMoney branch
- `PerformPrivateTransaction(-num)`
- the BuiltObject-yard overload (space-port designs refused; the mining-station parent / placement Rnd)
- orders placed even when unaffordable (empty list)

### (2) TODO stubs, via callers
- **E1 [crash on tick path, currently unreachable]** `missions/cmdTroops.ts:219-224` still does `todo(T_purchaseNewBuiltObject); throw new Error('TODO(port) M4h: …')` for `policy.ColonyActionForNewBuildDesign`, although `purchaseNewBuiltObject` now exists (empireConstruction.ts:2369). Today it is unreachable only because nothing sets `colonyActionForNewBuildDesign` (the policy panel control is read-only, empirePolicyModel.ts:497-508). The first loaded policy or game option that sets it will crash a Colonize completion.
- The BuiltObject.2.cs 1110 caller is also noted as TODO in the header comment (empireConstruction.ts ~2308).

### (5) Tick path
purchaseNewBuiltObject* and buildNewShips are called only from executeShipAction (UI), advisorCommands (UI) and ui/screens/buildOrder.ts. No tick-path caller.

---

## 7. designEditor.ts

### (1) Deviations
- **DE1 [cosmetic, documented] Cancel semantics differ.** The C# edits `design_0` in place and Cancel restores only components, tactics and stance; name, sub-role, picture and obsolete edits survive a C# Cancel. The TS drops the whole working copy (designEditor.ts:1180-1188).
- **DE2 [note] `writeBack` copies a fixed field list** (designEditor.ts:1119-1135). Any Design field the editor gains later must be added here, or edits are silently lost on save. `dateCreated`, `buildCount` and the derived fields are correctly not copied (reDefine recomputes them).
- **DE3 [cosmetic] Delete confirmation order differs.** `deleteDesignQuestion` is asked by the caller before `deleteDesign` filters the in-use designs. The C# asks only when at least one design is deletable (Main.Part6.cs:1147-1150, 1205-1206).

**Checked and correct:**
- PrepareDesignForEditor's stance table and its double ReDefine
- IsManuallyCreated when not in View mode
- the red-warning refusal
- `design_2` obsolete
- addnew/copyasnew DateCreated
- the edit/view IndexOf → replace → ReDefine
- the delete in-use rule (BuiltObjects plus PrivateBuiltObjects, Design or RetrofitDesign)
- the nextMarkName int.TryParse behaviour

### (2) TODO stubs
- BaconDesign.SetPictureRef remap, image only (designEditor.ts:555).
- "Show latest components only" toolbox (designEditor.ts:651): the checkbox does nothing.

### (3) Duplicate
`determineResourcesEmpireSupplies` (designEditor.ts:762) is the third copy; the other two are diplomacyTick.ts:761 and logistics/orders.ts:680.

---

## 8. empirePolicyModel.ts (method_597)

### (1) Deviations
None in `applyPolicyPanel`:
- The pirate-gated automation rows match.
- `method_419` equals `(AutomationLevel)index`.
- method_604 is `(float)`, and `Math.fround` is applied in readNumeric.
- `(int)` truncation is used where the C# casts.
- The loadout `/100f` matches.
- The field list is complete. All dynamically built field names (`ColonyFacilityPopulationThreshold*`, `ColonyAllowFacility*`, `ResearchDesignTechFocus[Type]1-6`, `DesignUpgrade*`) exist on EmpirePolicy (checked against data/policies.ts).

### (2) TODO stubs
- empirePolicyModel.ts:501: ColonyActionForNewBuildDesign is read-only (tied to E1).
- empirePolicyModel.ts:864: the gameOptions default write-back (Main.Part3.cs 4179-4198) is not done, so policy changes don't become new-game defaults. UI-only.

### (3) Duplicate
`checkEmpireHasOwnedColonies` (395) duplicates ui/screens/buildOrder.ts:134. Both are identical and UI-only.

---

## 9. game.ts: human-player automation defaults

`DEFAULT_GAME_OPTIONS_AUTOMATION` (game.ts:738-763) matches method_260 value for value, including Manual = Undefined(0) and SemiAutomated = PartiallyAutomated(1). `applyStartAutomationSettings` (766-795) matches Start.2.cs 2122-2146 in order.

- **G1 [TODO, benign]** `DiscoveryActionRuin` is not copied (game.ts:791). The Empire field is not ported. The default is 0 in both, so it only matters once game options can change it.

---

## 10. Cross-package duplicates (item 3)

Two ports of the same C# helper:

| C# method | Copies | Equivalent? |
|---|---|---|
| Galaxy.7.cs 747 CheckWithinDistancePotential | movement.ts:755 (correct); **combat/damage.ts:94, combat/weapons.ts:1456, player/orderMenu.ts:559 (all wrong: `<=` AND, no doubling)** | **No.** The damage.ts and weapons.ts copies are on the tick path and prune more than the C#. Out of scope for this review, but the highest-value fix here. |
| Galaxy.6.cs 2737 CalculateAngleFromCoords | empireConstruction.ts:2318 (correct); **galaxy.ts:2461-2474 (negates the x≥cx, y<cy branch at :2471)** | **No.** The galaxy.ts copy feeds `generateAsteroidFieldAt` (galaxy.ts:3251, Galaxy.9.cs 3485), so asteroid-field arcs in that quadrant are mirrored at galaxy generation. empireConstruction.ts's comment already flags this; it was never fixed. It will move seed pins. |
| CharacterList.cs 314 GetNonTransferringCharacters | characters.ts:4971; executeShipAction.ts:1945 | Yes. Delete the private copy. |
| BuiltObject.2.cs 7506-7548 QueueMission | empireConstruction.ts:869 `queueMission`; executeShipAction.ts:1849 `queueMissionFull`; fleets/shipGroupTasks.ts:1790 `builtObjectQueueMission` | Yes (overload subsets). Merge into one. |
| CheckTargetOfRepairMission | civilianAI.ts:2114; orderMenu.ts:345 | Yes. |
| DesignList.GetDesignsBySubRoles | independentTraders.ts:98; orderMenu.ts:307 | Yes. |
| DesignList.GetBuildableDesignsBySubRoles | orderMenu.ts:291; ui/screens/buildOrder.ts:69; inline in advisorBrief.ts:333 | Yes. |
| Empire DetermineResourcesEmpireSupplies | diplomacyTick.ts:761; logistics/orders.ts:680; designEditor.ts:762 | Yes. The designEditor copy lacks a `colonies != null` guard, which doesn't matter in practice. |
| SystemInfoList `Systems[star]` | executeShipAction.ts:1999 `systemForStar`; orderMenu.ts:229 `systemOfStar` | Same result. |
| FastFindNearestColony | combat/threats.ts:1177; diplomacyTick.ts:214; exploration.ts:158 | Yes. |
| CheckEmpireHasOwnedColonies | empirePolicyModel.ts:395; buildOrder.ts:134 | Yes. |
| DesignList.FindNewestCanBuild (private copies) | stationPlacement.ts:105, forceStructure.ts:178, pirateEmpireAI.ts:63, pirateShipMissions.ts:88, empireConstruction.ts:126 | Not diffed. |
| Empire.9.cs 4139 PirateReviewSystemThreats | pirates/pirateAI.ts:75; pirates/pirateEmpireAI.ts:155 | Not diffed (outside this review's scope). |

---

## 11. Persistence (item 4)

- Codec rule: every own enumerable field of a registered class is written (graphCodec.ts:120-140). Plain objects, Map, Set and arrays are handled natively. An unregistered class instance throws.
- The player layer adds **no new fields** to Empire, BuiltObject or ShipGroup. Everything it sets is an existing field on a registered class: StateMoney, Control*, PirateMissions/EmpireActivity, Orders, Blockades, gatherPoint/attackPoint/posture/postureRangeSquared, isAutoControlled, subsequentMissions/BuiltObjectMission, designs/Design, policy (a plain object), empiresViewable/Expiry, DiplomaticRelation fields, and `baconValues` (a Map).
- Classes in src/sim/player: `ShipAction` (unregistered; must stay off the graph) and `Ctx` (per call). TradeNegotiation, TradeTree and DesignDraft are interfaces (plain objects) and are not stored.
- The only missing persisted state is the C#'s own `Empire.LastXaraktorVirusDeploy` (D2/O1) and `Empire.DiscoveryActionRuin` (G1).

---

## 12. Determinism (item 5)

- **Tick path: none.** No module under src/sim outside src/sim/player imports any of these seven modules; the only hits are comments. The importers are ui/*, main.ts, and advisorBrief/advisorCommands, which are themselves imported only by ui/advisor*.
- **Rnd from player input.** All draws below match the C# sites and order, as far as checked. They advance `galaxy.rnd` between ticks, exactly as the C# does. Any replay or lockstep must therefore journal player inputs, **including advisor-issued commands** (advisorCommands → executeShipAction / submitProposal / buildNewShips).
  - method_347: AssignShipSystemPatrol `Next`, DeployVirus `Next(15,20)` plus creature placement, mission constructors, `2000+NextDouble()*3000` → SelectRelativeParkingPoint, SelectRelativeHabitatSurfacePoint.
  - Menus: method_323 `SelectRelativePoint` per design item on menu open; method_593 build pages.
  - Diplomacy: `Next(0,80)`, 2×NextDouble.
  - Trade: EvaluateTradeOffer `Next(0,3)`, OFFER_DEAL_COMPONENT NextDouble.
  - Purchases: name generation and base placement.
- **UI refresh:** O5, fewer draws than the C#'s timer-driven redraws (intentional).
- `listProposals` → `obtainDiplomaticRelation` can create missing relations when the Diplomacy screen or the advisor brief renders. This matches the C# method_238, but it is a state mutation on a read path (advisorBrief.ts:651 already guards it).

---

## Ranked top 10

1. **D2+O1 [wrong]** The Xaraktor virus has no 150 s cooldown. `LastXaraktorVirusDeploy` is never written (executeShipAction.ts:983) and never checked (orderMenu.ts:411). The TS comment misattributes the reader to the AI; it is CanDeployXaraktorVirus itself (Empire.10.cs:4532). The player can spam 15-19 Kaltor spawns plus infection per click. Needs an Empire field (auto-persisted) and a CurrentDateTime equivalent.
2. **CheckWithinDistancePotential [wrong, tick path]** is ported incorrectly in combat/damage.ts:94 and combat/weapons.ts:1456 (and orderMenu.ts:559, cosmetic there). Galaxy.7.cs:747 doubles the range and ORs the axes. Replace all three copies with the movement.ts:755 port.
3. **galaxy.ts:2471 CalculateAngleFromCoords [wrong, galaxy-gen]** has an extra `* -1.0` that the C# (Galaxy.6.cs:2750-2753) lacks. It mirrors asteroid-field placement in one quadrant. It was already flagged in empireConstruction.ts:2311-2317 and never fixed. Fixing it moves seed pins.
4. **P1 [TODO hit]** A pirate player has no diplomacy at all (diplomacyProposals.ts:153-160, 25-26).
5. **E1 [latent crash on tick path]** cmdTroops.ts:219-224 still throws for ColonyActionForNewBuildDesign although purchaseNewBuiltObject is now ported (empireConstruction.ts:2369). Wire it (isStateOwned true, isAutoControlled true, per the comment) and unlock the read-only policy control (empirePolicyModel.ts:497-508).
6. **D1 [wrong]** The HandleToolstripClick TODO branches abort method_347 (executeShipAction.ts:283, 311-318). A "Romulan" or "Mining Company" empire can never give ships. Stub only the Bacon price transfer and fall through.
7. **D3 [wrong, rare]** Fighter is excluded from MissionTarget / isStellarObject. Escape from a fighter attacker, or any order targeting a fighter, gets a null target (executeShipAction.ts:210-225, 722, 1325, 1743; missions/mission.ts:120).
8. **Duplicates to merge:** QueueMission ×3, GetNonTransferringCharacters ×2, DetermineResourcesEmpireSupplies ×3, CheckTargetOfRepairMission ×2, GetDesignsBySubRoles ×2, GetBuildableDesignsBySubRoles ×3, systemForStar/systemOfStar, FastFindNearestColony ×3 (section 10).
9. **O3 [ordering hazard]** Automation prompts are answered after the order executes (ui/orderMenu.ts:431-437; executeShipAction.ts:183-186). The end state is equal today, but any future branch that reads a Control* flag after its prompt will diverge.
10. **O5 plus section 12 [determinism contract]**:
    - Player-input Rnd draws (menus on open, purchases, diplomacy, virus, patrol) and advisor-issued commands must be journaled for replay.
    - The selection bar deliberately skips the C#'s 500 ms Rnd-drawing redraws (ui/orderMenu.ts:572). Record both in M4-plan §0.

**Cosmetic (not ranked):**
- D4/D5: TS-only failure toasts.
- O4: select(null) instead of the selection history.
- O7: creatures always visible.
- DE1/DE3: editor Cancel and delete-prompt order.
- orderMenu.ts:3616: missing resource-shortage hint.
- T1: the TS-only stale-deal refusal.
