# Characters & Victory (opt-in add-on): design

Scenario id `characters-victory`, master flag `charactersVictory`. With the add-on off (or no scenario) the game is the
faithful port, byte-identical (`npm run repin -- --check` = 0, and the flag-off check in `test/charactersVictory…` —
see §11). The user's decisions (2026-10-10) are the source; this document turns them into rules.

C# paths are relative to `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types/`.
Every rule is labelled:

- **real (File.cs:Method)**: the original game does this; we call or mirror the ported code.
- **new**: this add-on's own rule (not in the original).
- **to verify**: not yet checked against the C#.

Build phases: **Part 1** (this branch): VIP transport + governors on every colony + their UI and AI.
**Part 2** (a later agent): the Galactic Council, built on Part 1's hooks (§10) and on the existing `galactic-council`
add-on (§3). **Later**: other victory ideas (§8).

---

## 1. Corrections to the plan (checked against the C#)

| Plan claim | What the C# says | Correction |
|---|---|---|
| "The original caps non-agent characters at 20 (Empire.6.cs MaximumCharactersAllowedNonIntelligenceAgent)" | `Math.Min(20, (int)(Math.Sqrt(TotalColonyStrategicValue) / 150.0))`; pirates `Math.Min(20, (int)(Math.Sqrt(BuiltObjects.Count) + 2))` (Empire.6.cs:3966). | 20 is only the ceiling: a young empire's cap is much lower (it grows with the square root of total colony strategic value). |
| (implied) raising that cap is enough for "a governor on every colony" | CheckForCharacterAppearance (Empire.6.cs:3990) also limits each role: governors to `Max(1, (int)(Colonies.Count * 0.34))` and any role to 40% of the non-agent characters; its governor weight is 0 below 2 colonies. | The add-on lifts **both** limits for governors only (§5.1). It does not touch the random role pick for the other roles. |
| "Governors work only at their colony when not transferring (Empire.4.cs 2711/3078)" | Only **population growth** uses `FindCharactersAtLocationNotTransferring` (Empire.4.cs:2711 EvaluateColonyVariablesPirate, :3078 EvaluateColonyVariables). Income, happiness, corruption, facility construction and mining read `Habitat.Characters` (Habitat.cs:870, 619, 813, 2058, 2845 via GetHighestSkillLevelExcludeLeaders), and a character stays in its old location's list until the timer ends (Character.cs:4305 CompleteLocationTransfer runs only on arrival). | In the original, a governor who has been ordered away keeps giving every bonus except growth until the stock timer ends. Under the add-on the character boards the shuttle at departure, so the colony loses **all** its governor bonuses for the whole trip. That is the plan's intent ("loses the governor's bonus while away"). |
| "Spawn is random (ChanceNewColonyGovernor)" | There are two random sources. Galaxy.2.cs:4798 ChanceNewColonyGovernor runs after a colony ship settles (BuiltObject.2.cs:1085, in ExecuteCommands): a 1-in-`Max(2, 15 / race factor)` roll that ignores the role limit. The other is CheckForCharacterAppearance's governor pick, which places the governor through ReviewCharacterLocation(transferToLocation: false). | Both are spawn sites, so the spawn-at-capital rule (§5.2) covers both. |
| "AI's wartime colony-ship escorting (Empire.5.cs ~1727)" | Empire.5.cs:1370 AssignMissionToBuiltObject, for **idle** military ships: `num52 = Rnd.Next(0, 8)`; values 0–2 escort (cruisers, capital ships and carriers are forced to 4); `atWar` adds 2. So escorting is **less** likely at war (1 in 8 instead of 3 in 8). It escorts colony ships while `CurrentEscortForceAssigned < Size / 50`, construction ships while it is `< Size / 10`, and resource extractors, each gated by `WithinFuelRangeAndRefuel` and `CheckMilitaryShipWelcomeAtTerritoryLocation` (Galaxy.cs:3699). `CurrentEscortForceAssigned += ship.FirepowerRaw`. | It is peacetime idle-ship tasking, not wartime logic. The VIP escort reuses the same mission, the same firepower accounting and the same welcome check, but it is deliberate and sized (§4.4), and it applies in war and peace. |
| "TransferToNewLocation (Character.cs:4418, an invisible timer)" | The timer is `30 + distance / SectorSize × 90` game seconds (a year is 600 s, so 18 days + 54 days per sector). Admirals, generals, captains and pirate leaders moving between ships of the **same ShipGroup** arrive at once (4436-4449). | Confirmed. The same-fleet instant move is exactly the plan's "moving with your own unit is not a trip". |
| "the real empire-strength evaluation" (Council host) | There is no single function by that name. The candidates are Galaxy.1.cs:2863 CalculateEmpireScore (population, economy, colonies, military, research, wonders; the Empire Comparison score), Empire.7.cs:4120 CalculateRelativeEmpireMilitaryStrength (military only) and Empire.cs RelativeEmpireSize. | Part 2 uses CalculateEmpireScore ("strongest" = highest score) (§7.1). |
| Race "TradeBonus" (AI votes) | Race.cs:558 `TradeBonus` (int). | Confirmed. Every other listed race, government, policy and trait field exists under the stated name: Race.cs AggressionLevel/CautionLevel/FriendlinessLevel/LoyaltyLevel/IntelligenceLevel/TourismIncomeFactor/FreeTradeIncomeFactor/MigrationFactor/WarWearinessAttenuation; GovernmentAttributes.cs WarWeariness/ConcernForOwnReputation/ImportanceOfOthersReputations/Stability/Corruption; EmpirePolicy.cs DiplomacySendGiftsUpToAmount and IntelligenceAllowMission*; CharacterTraitType.cs Pacifist…Trusting, GoodAdministrator, Corrupt, Lawful, Industrialist, InspiringPresence. |
| Wonder bonus types "ColonyIncome, ColonyHappiness, ColonyPopulationGrowth, ColonyConstructionSpeed (WonderType.cs)" | WonderType.cs has exactly these (plus ColonyDefense and the empire-wide ones). | Confirmed. |
| Skills (CharacterSkillType) | CharacterSkillType.cs has ColonyIncome, TradeIncome, TourismIncome, ColonyCorruption, ColonyHappiness, PopulationGrowth, MiningRate, TroopRecruitment, Military/Civilian/ColonyShipConstructionSpeed and FacilityConstructionSpeed. | Confirmed. |
| Academies and RegionalCapital "are real PlanetaryFacilityTypes" | PlanetaryFacilityType.cs has RegionalCapital, MilitaryAcademy, SpyAcademy, NavalAcademy and ScienceAcademy. In CheckForCharacterAppearance they only scale the appearance chance (×(1 + value/100), at most ×2). They never set where a character appears. | Spawning at the academy is a **new** rule (§5.2). |
| Relations and missions (TradeSanctions, Truce, FreeTradeAgreement; Escort, Blockade, Bombard) | DiplomaticRelationType.cs and BuiltObjectMissionType.cs have them all (plus WaitAndBombard). | Confirmed. |
| "Recognising a claim: TO VERIFY how the original penalises conquest" | **Resolved.** The original has no claims and does not penalise taking a colony in a war. The penalties are: **(a)** declaring war: −1 reputation (`CivilityRating -= Galaxy.DeclareWarReputationImpact` = 1.0, Empire.8.cs:2712 ChangeDiplomaticRelation) and −40 IncidentEvaluation with the target (`IncidentImpactWhenDeclareWar` = 40, 2704). **(b)** Invading an **independent** colony: −4 reputation per attack notification unless it is a bombardment (`IndependentColonyInvadeReputationImpact` = 4.0, Galaxy.7.cs:3171 NotifyOfAttack). The owner of the territory it lies in also loses 50 IncidentEvaluation towards the attacker (3174-3180). **(c)** Killing population by bombardment: reputation scaled by the attacker's civility (BuiltObject.2.cs:5982). Exterminate or enslave policies: Empire.2.cs:3357. **(d)** The victim's war-damage ledger (Galaxy.3.cs:529/541 InflictWarDamage), which drives war weariness and peace. | Part 2's "recognise a claim" waives (a) and (b) for the claimant against the named colony, and drops the condemnation motion against it (§7.4). |

---

## 2. Scope, determinism and the flag-off guarantee

- **new.** One scenario package, `scenarios/characters-victory/scenario.json`, with its code under `src/sim/scenario/charactersVictory/`. Its flags are the master `charactersVictory`, `cvVipShuttles`, `cvGovernors` and `cvEscorts`. Part 2 adds `cvCouncil`.
- **new.** Every base-sim hook it needs is one guarded line, `if (galaxy.scenario !== null) …`, after the stock code (MODLAYER-DESIGN §4). With no scenario, or with the flags off, no handler runs, nothing is stored and `galaxy.rnd` is untouched.
- **new.** It is deterministic for lockstep multiplayer: every list is iterated in id order and ties break by id. Draws use `galaxy.rnd` only inside its own gated handlers.
- **new.** Its state lives in `galaxy.scenario.state.charactersVictory` (plain objects with graph references, saved as-is, like the council and treasure-fleet states).
- **new.** It applies only to normal empires: active, with a dominant race, not the independents. **Pirate factions keep the stock timer** in Part 1. They have no capital or academies, and the plan's escort and governor rules assume colonies. This is a scoping choice to confirm with the user.

---

## 3. How this maps onto the existing add-ons

Per the user (2026-10-10), `court-dynasties` is out of scope. We do not build on it, integrate with it or design around
it. We only keep its tests and its flag-off check green.

| Existing add-on | What already exists | What this add-on extends / how it integrates | Conflicts (reported, not silently resolved) | Genuinely new here |
|---|---|---|---|---|
| **galactic-council** (`src/sim/scenario/emergent/council.ts`, flag `galacticCouncil`) | A council founded once 3+ empires have met. One yearly motion (sanction, embargo, condemn, lift, recognise a new state, declare a threat), deterministic AI votes from attitude, blocs, council splits, a player vote decision, and sanctions through the real StartTradeSanctions. | **Part 2 extends it rather than writing a second council** (§7): host world, physically attending delegates (Part 1's travel hook), sessions every 2–3 years with 1–3 motions, the enforcer blockade on sanctions, truce/free-trade/weapon-ban/pirate/independents/claim/expulsion/Regent motions, and personality-based votes. Its existing motion kinds stay as they are. | **C1.** The plan's sessions run every 2–3 years with 1–3 motions; the existing council votes one motion **every year**. **C2.** The plan's founding is implicit (all members, with the strongest as host); the existing founding needs 3 met empires and an AI join threshold (friendliness + caution − aggression). **C3.** The plan's vote weights come from size, strength, relations, gifts and spies; the existing ones are attitude-based, with bloc coordination. Part 2 should make the plan's rules an **option of the existing council** (a "Characters & Victory sessions" flag) rather than replacing the defaults. The user should choose. | Host colony and its Wonder-type bonuses, delegates, enforcers, Regent, Emperor countdown. |
| **internal-security** (`security/security.ts`, flag `internalSecurity`) | A per-colony stability ledger. It is the fold of `registerStabilityTerm` terms (`scenario/stability.ts`), which the revolt reads through `colonyRevoltApproval`, with governor loyalty, purges and martial law. Leads come from one counter-intelligence roll. | **The vacancy decline is a stability term** (`cause: 'vacancy'`) registered through `registerStabilityTerm`. It shows in internal-security's ledger, colony tooltip and Empire Summary, and the stock (or ledger) revolt reads it. There is no parallel unrest system. Its loyalty term already reads "the governor at the colony". During a trip that is nobody, so a disloyal governor in transit costs nothing. That is consistent. | None found. Note: `security.ts:641` moves a character with `transferToNewLocation`, so under this add-on that becomes a shuttle trip (intended). | — |
| **corporatecoup** (`threats/corporateCoup.ts`, flag `threatCorporateCoup`) | A subject company bribes the holder's ColonyGovernors (a per-mille yearly chance per governor) and breaks away once it has bought `coupGovernors` (3). The AI replaces confirmed bought governors with `generateNewCharacter` at the colony. | Compatible: our governors are ordinary ColonyGovernor characters. The coup's direct replacement spawns at the colony; we do **not** route third-party add-ons' direct spawns through the birthplace rule (§5.2), so its replacement arrives at once, as it designed. A bought governor that the automation moves stays bought (the coup's list holds the character). | **C4.** With a governor on every colony the coup has far more bribe targets: the yearly per-governor roll over 3–10× as many governors reaches 3 bought governors much sooner. Options: scale `coupBribePct` down when this add-on is on, or count only governors in the company's reach. Reported; not changed. | — |
| **frontier-autonomy** (`frontier/frontier.ts`, flag `frontierAutonomy`) | Autonomy drift (travel time to the capital, no warships, a foreign race, low approval; lower with a ruling-house governor), frontier sectors under a sector governor (the ColonyGovernor of the most autonomous colony; generated there if none), and breakaways. | Compatible. Its `colonyGovernorOf` reads characters located at the colony, so a sector governor away on a trip is "not governing", and its yearly review picks another sector colony's governor. That is the plan's absence rule. Its direct spawn of a sector governor stays direct (as for corporatecoup). | **C5.** The plan's "vacancy → breakaway after years" and frontier-autonomy's breakaway are two separate routes to secession. They don't double-count approval (ours is one stability term; frontier adds its own 'frontier' term), but a vacant frontier colony gets both. Possibly intended. Reported. | — |
| **espionage-consequences** (`emergent/espionage.ts`) | Exposed agents open crises; tech leaks; false flags. | Part 2's decoy reveal (§4.3) uses the real StealOperationsMap intelligence mission. An exposure there still opens this add-on's crisis as for any mission. Its existing hooks are enough. | None. | The decoy reveal. |
| **reputation** (`reputation/ledger.ts`, flag `reputationLedger`) | Scenario attitude changes become ledger entries with causes and fades. | **Every attitude change this add-on makes goes through `recordReputation`** when the ledger is on: in Part 1, attacking a VIP shuttle (a "VIP attacked" cause, §4.5); in Part 2, attacking delegates or enforcers, and Council penalties. When the ledger is off they write IncidentEvaluation the way the existing packages do. | None. | — |

**Rule (new):** this add-on never re-implements another add-on's mechanism. Where one exists we register a term, record a
ledger entry or emit an event they already read.

---

## 4. VIP transport (Part 1)

### 4.1 What is a trip

- **real (Character.cs:4418 TransferToNewLocation).** A transfer sets `_TransferDestination` and the timer. An admiral, general, captain or pirate leader moving between ships of the same ShipGroup arrives at once.
- **new.** Under the add-on every transfer that leaves `_TransferDestination` set is a **trip**. That covers every stock caller (ReviewCharacterLocation for every role, the player's Characters screen and ship-action orders, internal security's moves, internal politics' defections) and every new reason (§5).
- **new.** The same-fleet instant move is **not** a trip: moving with one's own unit (an admiral with their fleet, a general with their troops' ship group, a captain aboard their ship) stays instant. A zero-distance transfer is not a trip either.
- **new.** At the start of the trip a **free VIP shuttle** spawns next to the character, the character boards it, and the stock timer is held. If the character is on a ship, the shuttle spawns beside that ship (it does not detach the ship). When the shuttle reaches the destination, the character completes the transfer through the real CompleteLocationTransfer (Character.cs:4305), so the stock arrival event (CharacterTransferLocation, or AmbassadorAssignedToEmpire) fires once, as in the original. The shuttle then despawns.
- **new.** Boarding is silent: no character event. The original fires CharacterTransferLocation only on arrival, so we keep one per trip.
- **new.** A new transfer ordered while the character is aboard retargets the same shuttle.
- **new.** If the destination becomes invalid (destroyed, or captured by another empire, except for ambassadors, who travel abroad), the shuttle reroutes to the capital, or the nearest own colony if there is no capital.
- **new.** A trip still unfinished after `cvTripTimeoutFactor` (3) × the stock timer, and at least 120 days, completes at once. This guards against stranded shuttles (a gate gone, no route).

### 4.2 The shuttle

- **new.** One design per empire with the VIP Shuttle role, held in the add-on's state, **not** in `empire.designs`, so no stock build, retrofit or force-structure path ever sees it. A new BuiltObjectSubRole value would shift every `Enum.GetValues(BuiltObjectSubRole)` loop (`latestDesigns`, force-structure projection, the subrole names), which would break flag-off byte identity. The hull subRole is therefore **PassengerShip** (real), and VIP-ness is the add-on's design id plus a ship registry.
- **new.** Allowed component families: shields, armour, engines, hyperdrive, reactor, fuel, life support and quarters (habitation, life support, crew; the command centre and bridge needed for a valid design). Not allowed: weapons, cargo, troop compartments, construction yards, fighter bays, and also sensors (scanners, long-range scanners), colony modules, passenger compartments for migrants, extractors and labs.
- **new.** Fixed hull size: `cvShuttleSize` (default 180, within PassengerShip limits).
- **new (built on real code).** The auto-design is the PassengerShip design template run through the real Empire.GenerateDesignFromSpec (`designGeneration.ts`), stripped to the allowed families, then padded with shields, armour and engines to the fixed size. It regenerates when research improves any allowed component (on `researchCompleted`), unless the player's own edited design is locked.
- **new.** Free: the spawn costs nothing, upkeep is zero (`supportCostFactor` 0) and fuel never runs out (the `builtObjectSelfFuelling` query).
- **new.** Minimal sensors and no exploration credit: the design has no sensor components, and a shuttle never marks systems explored or visible for its empire.
- **new.** It cannot be ordered, kept, scrapped or used to block. `assignMissionAllowed` refuses every mission except the add-on's own Move/Hold. The player's ship UI shows no orders for it (selection shows "VIP shuttle — en route to X"). It never joins fleets, is never auto-controlled, never retires and is never counted as military (no blockade, no hyperdeny, no territory claim).
- **new.** No stealth: the shuttle carries no cloak, so it is visible in range like any ship.

### 4.3 Visibility and decoys

- **new.** Any ship carrying a VIP (a shuttle or a decoy) draws a **gold ring** for the viewing empire when it is inside that empire's sensor range and not fogged. "In range" is the real IsObjectVisibleToThisEmpire (Empire.9.cs:3198), the same test that decides whether the ship is drawn at all. Hovering shows the shuttle's name and, for one's own shuttles, the passenger's name and role. Foreign shuttles show "VIP shuttle" only.
- **new.** A "VIP traffic" map-overlay toggle draws each visible VIP shuttle's route line to its destination (own shuttles; foreign ones only while visible). The gold rings are always drawn.
- **new.** Decoys are for the **ruler only** (CharacterRole.Leader). A ruler's trip spawns `cvRulerDecoys` (2) identical shuttles (same design, same marker, same kind of name) on the same destination, with staggered departure points within the origin system. The real one is chosen deterministically (`galaxy.rnd` under the flag).
- **new (built on real code).** A completed **StealOperationsMap** intelligence mission (real, IntelligenceMissionType) against an empire whose ruler is in transit reveals the real shuttle to the spying empire. Its marker then shows "Ruler aboard" for that empire.

### 4.4 Escorts

- **real (BuiltObjectMissionType.Escort; Empire.5.cs:1370 AssignMissionToBuiltObject).** The escort is the stock Escort mission on the shuttle, with the same `CurrentEscortForceAssigned += FirepowerRaw` accounting and the same `CheckMilitaryShipWelcomeAtTerritoryLocation` (Galaxy.cs:3699) and `WithinFuelRangeAndRefuel` gates.
- **new.** The required escort firepower is `importance × routeDanger × cvEscortFirepowerPerPoint`.
  - **Importance** (0–10): Leader 10; Governor 2 + 6 × (colony value / the empire's top colony value); Admiral 3 + skills/40; Scientist 2 + skills/40; General 2 + skills/40; Ambassador 2; Captain 1; Agent 1.
  - **Route danger** (0–3): sample points along the straight route every half sector. Each sample adds the known enemy military firepower nearby (empires at war, plus known pirate bases and their ships), normalised by the shuttle's own defence. It gets +0.5 outside one's own territory.
- **new.** Escorts are idle military ships (no mission, or Undefined/Patrol at the origin; not in a fleet with orders; not TroopTransport or ResupplyShip), nearest first, taken until the firepower is met. They are released on arrival (their mission is cleared, and the stock AI re-tasks them).
- **new.** Defence floor: escorting never takes the last `max(1, 10%)` of the empire's idle military ships, and never takes a colony's guard while that colony is threatened.
- **new.** Cap: all escorts together are at most `cvEscortCapPct` (20%) of the empire's idle military ships.
- **new.** A trip of importance ≥ 6 with danger > 0 whose escort is short **waits** at the origin, for up to `cvEscortWaitDays` (60), for escorts to join. Then it departs with what it has. Rerouting is not in Part 1 (see the TODO in the code).
- **new.** Settings: "Automate VIP escorts" (per empire; default on; the AI always on), and an escort level of None / Light (×0.5) / Normal (×1) / Heavy (×2) on the empire's policy panel. With automation off the player escorts by hand: the Escort order on a shuttle is the one order a shuttle accepts as a target.

### 4.5 Death, capture and attacks

- **real (BuiltObject.2.cs:5171 CompleteTeardown, 5228; BuiltObject.1.cs:2954 ProcessBoardingAssault, 3048; ported in combat/teardown.ts and combat/boarding.ts).** The characters aboard a destroyed ship die with CharacterDeathType.ShipDestroyed. Those aboard a ship captured by boarding die with ShipCaptured (stock messages, stock Kill). Because the VIP is *aboard* the shuttle, these real paths apply unchanged.
- **new.** Any other change of a shuttle's owner (`builtObjectOwnerChanged`) kills the passengers with ShipCaptured, as boarding does.
- **new.** Capture, ransom and interrogation are **not** built. They are new, and wait for the user's approval.
- **new.** Destroying another empire's VIP shuttle costs the attacker attitude with the victim: −15 IncidentEvaluation for a shuttle, −40 for a ruler's, recorded through the reputation ledger when that add-on is on (§3). This is on top of the stock war-damage accounting.

---

## 5. Governors on every colony (Part 1)

### 5.1 Caps

- **real (Empire.6.cs:3966/3984).** Non-agent characters are capped at `min(20, √TotalColonyStrategicValue / 150)`.
- **new.** Under the add-on, ColonyGovernors are excluded from that count (the `characterCapCount` query in `charactersCanGenerateAmountNonIntelligenceAgent`), so the other roles keep their stock room.
- **real (Empire.6.cs:3990 CheckForCharacterAppearance).** The governor role limit is `Max(1, 0.34 × colonies)`.
- **new.** That limit is raised to the **governor cap** = colonies + reserve target, where the reserve target is `max(1, ceil(colonies × cvReservePct / 100))` and `cvReservePct` is 10. The 40% share rule still applies to the other roles but not to governors.
- **real (Galaxy.2.cs:4798 ChanceNewColonyGovernor).** It also checks the governor cap.

### 5.2 Where new characters appear (then travel)

- **new.** At the two stock spawn sites (CheckForCharacterAppearance and ChanceNewColonyGovernor) the character activates at its **birthplace** and then travels by shuttle (§4) to the place the stock code chose:
  - Leader, Ambassador, ColonyGovernor: the **capital** (real: CheckForCharacterAppearance already puts leaders and ambassadors there).
  - Scientist: a colony with a completed **ScienceAcademy**.
  - TroopGeneral: a **MilitaryAcademy**.
  - FleetAdmiral and ShipCaptain: a **NavalAcademy** (captains are not in the plan; the naval academy is the natural fit; **new**, to confirm).
  - IntelligenceAgent: a **SpyAcademy**. Agents never travel in the original (missions are abstract), so an agent simply starts there.
- **new.** With several academies of the kind, the one nearest the destination is used. With none, the capital.
- **new.** Direct spawns by other add-ons (corporatecoup, frontier-autonomy, internal politics) and by this add-on's own local rise (§5.4) appear where they are spawned. That is their designers' intent (see §3).
- **new.** Governor **training**: each training site (the capital, plus every colony with a completed RegionalCapital) trains one governor per `cvTrainDays` (180) while governors + in training < the governor cap. Each costs `cvTrainCost` (2000) state credits, paid at the start. If the empire can't pay, training waits. A trained governor appears at its site through the stock generator (GenerateNewCharacter, Empire.6.cs:4413), with stock random skills. It becomes a **reserve** until it is assigned.

### 5.3 Vacancy (the user's rule)

A colony is **vacant** when no active ColonyGovernor of its empire is located at it. A governor away on a trip or on
duty (Part 2) does not count.

- **new.** Grace: for `cvGraceDays` (180, six months) after the vacancy starts, nothing happens.
- **new.** Decline: after the grace, the colony's **neglect** `N` rises linearly from 0 to 1 over `cvDeclineYears` (4). Its effects grow with `N`, in the plan's order:

  | Effect | Mechanism | Size |
  |---|---|---|
  | No construction | Facility construction at the colony pauses (the `facilityConstructionPaused` query at the stock facility-progress step) | while `N > 0` |
  | Falling output | Colony tax revenue (the `colonyTaxRevenue` query) | × (1 − 0.5·N) |
  | Falling happiness | A stability term (`cause: 'vacancy'`) | −20·N approval |
  | Disrepair | The colony's development level loses `cvDisrepairPerYear` per year | while `N ≥ 0.25` |
  | Emigration | Population loss per year | `N ≥ 0.5`: 1.5%·N |
  | Unrest, rebellion, breakaway | Nothing extra: the falling approval drives the **stock** revolt (Habitat.cs:5992 CheckSatisfaction → LeaveEmpire) or internal-security's ledger revolt | emergent, after years |

- **new.** Recovery: once a governor is in post, `N` falls by 1/`cvRecoveryYears` (5) per year. A colony at full neglect therefore takes 5 years to recover, and a partly neglected one proportionally less.
- **new.** Colonies of fewer than `cvMinPopulation` (50M) are exempt from the decline. They are still counted vacant (and still get a governor when one is free). Outposts are not run by governors.

### 5.4 Replacement paths

1. **new. Local rise:** when the vacancy starts, a rise time of 1–3 years is drawn (`galaxy.rnd`, 360 + Next(0, 721) days). If the colony is still vacant then, with no governor en route, a governor rises locally (GenerateNewCharacter at the colony, real). It counts toward the governor cap. If the cap is full, the rise waits.
2. **new. Reserve:** a trained reserve at a training site is shipped to the colony (a VIP trip).
3. **new. Promotion:** a governor is moved from another colony when the optimiser's rules allow it (§5.6).

### 5.5 Reasons to move (fit score)

- **new.** `fit(governor, colony)` = Σ skill level × need weight, over the real CharacterSkillType governor skills:

  | Skill | Need weight |
  |---|---|
  | ColonyIncome, ColonyCorruption | colony revenue share |
  | TradeIncome | space-port trade |
  | TourismIncome | ScenicFactor (real CalculateScenicFactorIncludingRuinsWonders) |
  | PopulationGrowth | the **growth phase**: pop < 50% of max |
  | ColonyHappiness | unrest: approval < 20, or an InciteRevolution mission against it |
  | MiningRate | the colony's mining stations |
  | TroopRecruitment | **war**: the colony is within 2 sectors of an enemy at war |
  | MilitaryShipConstructionSpeed, CivilianShipConstructionSpeed, ColonyShipConstructionSpeed | space port present / building |
  | FacilityConstructionSpeed | **big projects**: a wonder or facility under construction |

- **new.** Traits: GoodAdministrator +10; Lawful +5 and Corrupt −10 (scaled by the colony's corruption); Industrialist +5 where construction is weighted; InspiringPresence +5; Demoralizing −10.
- **new.** The total is multiplied by the colony's value, its strategic value (real Habitat.StrategicValue). A **RegionalCapital** colony counts ×1.5, and the capital ×2.
- **Economy-plan hook (new, inert until that plan is built):** a colony designation (when it exists) re-weights the needs.

### 5.6 Automation (anti-thrash)

The automation runs on the existing staggered empire update: once per empire per intermediate block (Empire.1.cs
DoTasks 3562, 60 s), on the `charactersReviewed` event right after the stock ReviewCharacterLocations. It considers a
short candidate list: vacant colonies, plus the 8 worst-fit governed colonies.

- **new.** Rules, in order:
  1. **Priority:** vacancies and crises (approval < 0, an incited revolution) > war (a TroopRecruitment need) > optimisation.
  2. **Minimum tenure:** `cvTenureYears` (2) since the governor's arrival before they move for optimisation. Vacancy and crisis moves use reserves first and promote only governors past tenure.
  3. **Gain threshold:** a move needs `newFit − oldFit − costs ≥ cvGainPct` (25%) of `oldFit`. The costs are the fit lost at the old post during the trip and any vacancy it creates, plus route danger × importance.
  4. **Transit cap:** at most `max(1, colonies / cvTransitPerColonies)` (15) governors are in transit per empire.
  5. **No stranding:** never vacate a colony worth more than the destination unless a reserve can reach it within the grace period.
  6. **Deterministic:** candidates are sorted by (priority, gain, colony id, character id). At most `cvMovesPerReview` (2) moves per empire per review.
- **new.** AI empires (and humans with "Automate governors" on) act on it. A human with automation off (the default) gets **suggestions**: one message per new suggestion (filterable, §9), and a "Suggested: X → Y (+N%)" line in the Characters screen with an Accept button.
- **real.** The stock ReviewCharacterLocation governor case (Empire.7.cs ColonyGovernor branch, characters.ts) is skipped under the add-on (the `characterLocationReviewSkip` query), so the stock and new movers never fight. The other roles keep the stock logic.
- **new. Stampede guard:** a war declaration changes the needs of many colonies at once, so its moves go through the same transit cap and per-review limit, and the war priority only re-ranks.

---

## 6. AI use (Part 1)

- **new.** The AI keeps reserves (the training in §5.2 is automatic for every empire), always automates governors (§5.6) and escorts (§4.4), and sends its rulers with decoys. Without that, the add-on would be a tax on the player only. The measured effects are in §12.

---

## 7. Galactic Council (Part 2; extends `galactic-council`)

Not built in Part 1. The rules are recorded here for the Part 2 agent. Conflicts C1–C3 (§3) are open.

### 7.1 Host and seat

- **new (real inputs).** The host is the strongest member by the real Galaxy.1.cs:2863 CalculateEmpireScore.
- **new.** The council world is the host's colony closest to the galaxy centre. The seat moves when the strongest changes, at the next session.
- **new.** The host colony gets bonuses of the real Wonder types (WonderType.cs: ColonyIncome, ColonyHappiness, ColonyPopulationGrowth, ColonyConstructionSpeed), applied through the same ported wonder paths, plus visitor trade and tourism (the real ScenicFactor tourism path).

### 7.2 Delegates

- **new.** Each member's delegate is its **most important governor** (Part 1's `mostImportantGovernor`: the highest-value colony by strategic value, else the highest skills), who must travel to the council world by VIP shuttle (Part 1's `sendVip`).
- **new.** Their colony has no governor while they are away. The 6-month grace applies, and they return after the session (Part 1's duty posts, §10).
- **new.** The player may send a lesser governor, at a vote-weight penalty.
- **new.** Attacking a delegate, or the host during a session, is a major crime: reputation-ledger entries with every member.

### 7.3 Sessions

- **new.** A session every 2–3 years, with 1–3 motions proposed by members. The AI proposes from self-interest.
- **new (real inputs).** Weights come from size and strength, relations, gifts (EmpirePolicy.DiplomacySendGiftsUpToAmount) and spies (the real intelligence missions).

### 7.4 Motions

- **Sanctions:** the real TradeSanctions for all members (already in galactic-council), **plus an enforcer blockade** (new):
  - A neutral "Council Enforcers" faction, modelled on the independent empire, spawns one fleet at the council world for each sanctioned empire.
  - The base fleet is 6 cruisers, 2 carriers, 2 CapitalShip and 2 ResupplyShip, built from members' real current designs and scaled 1×–3× by the target's military strength (real CalculateRelativeEmpireMilitaryStrength).
  - It flies to a weighted-random top-value colony or space port of the target and blockades it (the real Blockade mission). It only returns fire.
  - Attacking it is open defiance, with penalties with all members.
  - Members' dues fund it. It ends with the sanction or when it is destroyed.
- **Enforced truce:** the real Truce relation; breaking it means automatic sanctions.
- **Galactic free trade:** the real FreeTradeAgreement.
- **Weapon bans:** planet destroyers (real), or colony bombardment (the real Bombard/WaitAndBombard missions refused through `assignMissionAllowed`).
- **Outlawing a pirate faction:** military ships become welcome in members' territory (the CheckMilitaryShipWelcomeAtTerritoryLocation hook). Bounties are new.
- **Protecting or opening independents:** the real independent empire. Protect forbids invading them, a query at the invasion target choice. Open waives (b) of §1.
- **Recognising a claim:** waives the real conquest penalties for the named colony, (a) and (b) of §1, and blocks `condemn` motions about it. This is distinct from the existing `recognise` motion, which recognises a new state.
- **Expulsion (new)** and **electing the Regent (new):** the Regent has one veto per session and can call an emergency session once every `regentEmergencyYears`. The Regent may declare themselves **Emperor**, which starts a countdown victory during which everyone may go to war with them (a `declareWarBlocked` override and an AI bias).

### 7.5 AI votes (real inputs, new rule)

- **new.** A vote = the motion's effect on the voter's empire + its personality. Personality comes from:
  - race AggressionLevel, CautionLevel, FriendlinessLevel, LoyaltyLevel, IntelligenceLevel, TradeBonus, FreeTradeIncomeFactor, TourismIncomeFactor, MigrationFactor, WarWearinessAttenuation;
  - government WarWeariness, ConcernForOwnReputation, ImportanceOfOthersReputations, Stability, Corruption;
  - policy DiplomacySendGiftsUpToAmount and IntelligenceAllowMission*;
  - the leader's traits Pacifist, PeaceThroughStrength, Expansionist, Isolationist, Diplomat, FreeTrader, Protectionist, Xenophobic, Tolerant, Paranoid, Trusting;
  - relations.
- **new.** It extends the existing council's attitude score (conflict C3).

---

## 8. Other victory ideas (later; proposed only)

- **new. Seats of Power:** a few thrones (special colonies or wonders). Holding a majority for N years wins.
- **new. Key figures:** victory points from specific characters (a ruler surviving N years, a famous admiral). Attacking characters therefore matters; VIP transport makes them targets.

---

## 9. UI (Part 1 extends existing screens; matches DW:U)

- **Characters screen** (existing `src/ui/screens/` character list):
  - new columns: Location ("en route: A → B" with the shuttle name), Status (In post / Reserve / Travelling / On duty), ETA (game date), and for governors a Fit score;
  - a "Travel to…" button that opens the existing location picker and issues the real transfer, so the trip is a shuttle;
  - for suggestions, "Accept".
- **Colony screen** (existing colony panel):
  - a Governor slot (name and portrait, or "Vacant");
  - the vacancy countdown ("Grace: 4 months" / "Neglect 35%");
  - a "Request governor" button (the best reserve, else training at the capital).
- **Ship designer:** a "VIP Shuttle" entry in the design list (one per empire) that opens the existing editor with only the allowed component families in the toolbox and the role selector locked.
- **Map:** the gold ring (our own procedural art, drawn by the renderer; no original art copied), the hover name, and the "VIP traffic" overlay toggle in the existing overlay options panel.
- **Messages:** through the existing scenario message system (`scenarioMessage`) with its filter category. Only the big moments pop up: a VIP killed or captured, a colony entering decline, a ruler's trip. Arrivals and suggestions are log-only and filterable in the existing message settings.
- **Look:** UI frames come from the install at runtime (`/assets/dwu/…`). Any new icon is our own art under `public/art/`.

---

## 10. Hooks for Part 2 (the Council agent)

Exported from `src/sim/scenario/charactersVictory/index.ts`:

- `sendVip(galaxy, character, destination, reason, opts?)`: starts a VIP trip for any reason (`reason` is a string tag such as `'council'`). Arrival emits the scenario event `vipTripArrived { character, destination, reason }`. A death or capture on the way emits `vipTripFailed { character, reason, cause }`. Event handlers registered with `registerScenarioEvent` are save-safe (no closures in state).
- `mostImportantGovernor(galaxy, empire)`: the governor of the highest strategic-value colony, ties by skills then id. `null` if there is none.
- `setGovernorDuty(galaxy, character, reason)` / `endGovernorDuty(galaxy, character)`: marks a governor away on duty. Their post is kept and the colony is vacant (grace and decline apply as usual); `endGovernorDuty` sends them home by VIP trip.
- `colonyVacancy(galaxy, colony)` → `{ vacant, since, neglect, graceLeftDays }`, and `governorOf(galaxy, colony)`.
- `characterImportance(galaxy, character)` and `routeDanger(galaxy, empire, from, to)`, for delegate escorts.

---

## 11. Tests and the flag-off check

- An existing test file gains the "flags off is byte-identical" check (scenario with every flag off = the plain seed-1 run: same `stateDigest`, same `rnd.drawCount`, no state key), following the `courtDynasties.test.ts` pattern. No new test files.
- `npm run repin -- --check --workers 1` = 0.

## 12. Measurements and tuning

Filled in after the headless runs (governor moves per year, the share of colonies vacant and for how long, VIP trips
and escort sizes, AI economy on vs off, sim step time on vs off on the big save).
