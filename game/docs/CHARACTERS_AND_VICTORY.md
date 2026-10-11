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
**Part 2** (built): the Interstellar Diet, the galactic council extended on Part 1's hooks (§10) and the existing
`galactic-council` add-on (§3, §7). **Later**: other victory ideas (§8).

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
| "Recognising a claim: TO VERIFY how the original penalises conquest" | **Resolved.** The original has no claims and does not penalise taking a colony in a war. The penalties are: **(a)** declaring war: −1 reputation (`CivilityRating -= Galaxy.DeclareWarReputationImpact` = 1.0, Empire.8.cs:2712 ChangeDiplomaticRelation) and −40 IncidentEvaluation with the target (`IncidentImpactWhenDeclareWar` = 40, 2704). **(b)** Invading an **independent** colony: −4 reputation per attack notification unless it is a bombardment (`IndependentColonyInvadeReputationImpact` = 4.0, Galaxy.7.cs:3171 NotifyOfAttack). The owner of the territory it lies in also loses 50 IncidentEvaluation towards the attacker (3174-3180). **(c)** Killing population by bombardment: reputation scaled by the attacker's civility (BuiltObject.2.cs:5982). Exterminate or enslave policies: Empire.2.cs:3357. **(d)** The victim's war-damage ledger (Galaxy.3.cs:529/541 InflictWarDamage), which drives war weariness and peace. | Part 2's "recognise a claim" waives (a) for the claimant against the named colony's owner and drops the condemnation motion against it (§7.4). **(b) is not ported** (attackAI.ts notifyOfAttackHabitat ports only the non-independent branch), so there is nothing to waive yet. |

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
| **galactic-council** (`src/sim/scenario/emergent/council.ts`, flag `galacticCouncil`) | A council founded once 3+ empires have met. One yearly motion (sanction, embargo, condemn, lift, recognise a new state, declare a threat), deterministic AI votes from attitude, blocs, council splits, a player vote decision, and sanctions through the real StartTradeSanctions. | **Part 2 extends it rather than writing a second council** (§7): host world, physically attending delegates (Part 1's travel hook), sessions every 2–3 years with 1–3 motions, the enforcer blockade on sanctions, truce/free-trade/weapon-ban/pirate/independents/claim/expulsion/Regent motions, and personality-based votes. Its existing motion kinds stay as they are. | **C1.** The plan's sessions run every 2–3 years with 1–3 motions; the existing council votes one motion **every year**. **C2.** The plan's founding is implicit (all members, with the strongest as host); the existing founding needs 3 met empires and an AI join threshold (friendliness + caution − aggression). **C3.** The plan's vote weights come from size, strength, relations, gifts and spies; the existing ones are attitude-based, with bloc coordination. **Decided (user, 2026-10-10): the plan's rules (§7).** That is Part 2's work, built on the hooks in §10. | Host colony and its Wonder-type bonuses, delegates, enforcers, Regent, Emperor countdown. |
| **internal-security** (`security/security.ts`, flag `internalSecurity`) | A per-colony stability ledger. It is the fold of `registerStabilityTerm` terms (`scenario/stability.ts`), which the revolt reads through `colonyRevoltApproval`, with governor loyalty, purges and martial law. Leads come from one counter-intelligence roll. | **The vacancy decline is a stability term** (`cause: 'vacancy'`) registered through `registerStabilityTerm`. It shows in internal-security's ledger, colony tooltip and Empire Summary, and the stock (or ledger) revolt reads it. There is no parallel unrest system. Its loyalty term already reads "the governor at the colony". During a trip that is nobody, so a disloyal governor in transit costs nothing. That is consistent. | None found. Note: `security.ts:641` moves a character with `transferToNewLocation`, so under this add-on that becomes a shuttle trip (intended). | — |
| **corporatecoup** (`threats/corporateCoup.ts`, flag `threatCorporateCoup`) | A subject company bribes the holder's ColonyGovernors (a per-mille yearly chance per governor) and breaks away once it has bought `coupGovernors` (3). The AI replaces confirmed bought governors with `generateNewCharacter` at the colony. | Compatible: our governors are ordinary ColonyGovernor characters. Under this add-on the coup's AI replacement goes through `spawnGovernorFor` (§3.1): it appears at the capital and travels. A bought governor that the automation moves stays bought (the coup's list holds the character). | **C4.** With a governor on every colony the coup has far more bribe targets: the yearly per-governor roll over 3–10× as many governors reaches 3 bought governors much sooner. **Decided and built:** with this add-on on, the per-governor chance is multiplied by `min(1, stockCount / governorsAtColonies)`, where stockCount = 0.27 × colonies is the governor coverage measured in the faithful game (73–75 % of colonies without one in the cv-off soaks) (scenario/governors.ts `governorBribeScale`, registered by this add-on). The expected bribes per year therefore stay those of the stock governor count; off, the factor is 1. Measured in §12. | — |
| **frontier-autonomy** (`frontier/frontier.ts`, flag `frontierAutonomy`) | Autonomy drift (travel time to the capital, no warships, a foreign race, low approval; lower with a ruling-house governor), frontier sectors under a sector governor (the ColonyGovernor of the most autonomous colony; generated there if none), and breakaways. | Compatible. Its `colonyGovernorOf` reads characters located at the colony, so a sector governor away on a trip is "not governing", and its yearly review picks another sector colony's governor. That is the plan's absence rule. Its spawn of a sector governor goes through `spawnGovernorFor` under this add-on (§3.1). | **C5.** The plan's "vacancy → breakaway after years" and frontier-autonomy's breakaway are two separate routes to secession. They don't double-count approval (ours is one stability term; frontier adds its own 'frontier' term), but a vacant frontier colony gets both. **Decided and built: one feeds the other.** A colony's neglect is frontier-autonomy's drift cause "No governor" (`frontierNoGovernorDrift` × neglect, default 4 a year at full neglect; scenario/governors.ts `colonyNeglectOf`). While frontier-autonomy runs, this add-on's own vacancy approval term is off, so the unrest and the breakaway go only through frontier's autonomy → 'frontier' term → warnings → breakaway path. Without frontier-autonomy, the decline effects stay and the vacancy term lowers approval, which the stock revolt (or internal-security's ledger revolt) reads; this add-on has no breakaway of its own. | — |
| **espionage-consequences** (`emergent/espionage.ts`) | Exposed agents open crises; tech leaks; false flags. | Part 2's decoy reveal (§4.3) uses the real StealOperationsMap intelligence mission. An exposure there still opens this add-on's crisis as for any mission. Its existing hooks are enough. | None. | The decoy reveal. |
| **reputation** (`reputation/ledger.ts`, flag `reputationLedger`) | Scenario attitude changes become ledger entries with causes and fades. | **Every attitude change this add-on makes goes through `recordReputation`** when the ledger is on: in Part 1, attacking a VIP shuttle (a "VIP attacked" cause, §4.5); in Part 2, attacking delegates or enforcers, and Council penalties. When the ledger is off they write IncidentEvaluation the way the existing packages do. | None. | — |

### 3.1 Shared pieces, extension points and instant moves

- **One governor helper (new).** The "the governor of this colony" test is written four times: security.ts:99 `colonyGovernor`, frontier.ts:300 `colonyGovernorOf`, corporateCoup.ts:121 `holderGovernors` and politics.ts:201 `governedColony`. Part 1 adds one shared module, `src/sim/scenario/governors.ts` (`colonyGovernor(h)` = the first active ColonyGovernor located at `h` whose empire owns `h`, and `governedColony(c)`, its inverse). The callers with exactly these semantics (security, frontier, politics) are migrated to it, which is behaviour-neutral. corporateCoup's `holderGovernors` does **not** check that the governor's empire owns the colony, so it is left as it is (noted in the code).
- **Spawning governors from other add-ons.**
  - frontier-autonomy (`reviewGovernor`, frontier.ts:583-622) and corporatecoup (`coupAiReplace`) create governors directly at a colony with `generateNewCharacter`.
  - Under this add-on (flag on) both call `spawnGovernorFor(galaxy, empire, colony)` instead (new; in `governors.ts`): the governor appears at the capital and travels there by VIP shuttle. Until it arrives the colony is vacant, and frontier treats the sector as governed by a governor in transit (its seat stays the target colony).
  - With this add-on off, `spawnGovernorFor` is exactly the old `generateNewCharacter` call, so their tests and flag-off checks are unchanged.
- **Instant moves that stay instant (new; documented exemptions).** `Character.DefectToEmpire` (Character.cs:4451) is a change of allegiance, not a trip. It stays instant for every caller: Empire events (empireEvents.ts:1835), internal politics' defections and secessions (politics.ts:485/518), internal security's exile (security.ts:633/783) and frontier breakaways (frontier.ts:923, where the governor becomes the new state's Leader). The same goes for Activate at game start, the stock CompleteLocationTransfer calls on invasion (InvadingCharacters) and Kill. Every **TransferToNewLocation** is a trip, including internal security's arrests (security.ts:641, a move to the capital).
- **Council extension point.** Part 2 extends galactic-council through its `registerCouncilExtension` (council.ts:206-228: extra motion candidates, exclusions, vote bias), as the Exchange does (exchange.ts:1549). What it lacks (host world, delegates, enforcers, Regent, victory) is new state kept beside the Council record. **Name clash (reported):** `COUNCIL_NAMES` includes "Galactic Concord" (council.ts:354), which collides with rimTrade's Oranthi "Concord". Part 2 should rename it or skip it when rimTrade runs.
- **Attitude writes** use `applyReputation` (reputation/ledger.ts:225). With the ledger off it writes the stock IncidentEvaluation as before; with it on it records a caused entry.
- **Blockade target sampling** (Part 2 enforcers): as built, neither lively-galaxy warGoals nor rimTrade passive assigns a Blockade or samples targets (warGoals only reads blockades), so the enforcers draw their own weighted station (§7.4) and use the stock ImplementBlockade.
- **Hook order:** packages.ts imports `security/security` twice (40 and 43; the second import is a no-op in ES modules). This add-on is imported after frontier, and its stability term has its own `order`, so the existing terms keep their fold order.

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
- **new (built on real code).** The auto-design is the PassengerShip design template run through the real Empire.GenerateDesignFromSpec (`designGeneration.ts`), stripped to the allowed families, then padded with shields, armour and engines to the fixed size. It is regenerated once a game year and replaced when its components changed (research improved one), unless the player's own edited design is locked (as built: a yearly check instead of one per research breakthrough, to keep the design generator off the hot path).
- **new.** Free: the spawn costs nothing, upkeep is zero (`supportCostFactor` 0) and fuel never runs out (the `builtObjectSelfFuelling` query).
- **new.** Minimal sensors and no exploration credit: the design has no sensor components, and a shuttle never marks systems explored or visible for its empire.
- **new.** It cannot be ordered, kept, scrapped or used to block. `assignMissionAllowed` refuses every mission except the add-on's own Move/Hold. The player's ship UI shows no orders for it (selection shows "VIP shuttle — en route to X"). It never joins fleets, is never auto-controlled, never retires and is never counted as military (no blockade, no hyperdeny, no territory claim).
- **new.** No stealth: the shuttle carries no cloak, so it is visible in range like any ship.

### 4.3 Visibility and decoys

- **new.** Any ship carrying a VIP (a shuttle or a decoy) draws a **gold ring** for the viewing empire when it is inside that empire's sensor range and not fogged. "In range" is the real IsObjectVisibleToThisEmpire (Empire.9.cs:3198), the same test that decides whether the ship is drawn at all. Hovering shows the shuttle's name and, for one's own shuttles, the passenger's name and role. Foreign shuttles show "VIP shuttle" only.
- **new.** A "VIP traffic" map-overlay toggle draws each visible VIP shuttle's route line to its destination (own shuttles; foreign ones only while visible). The gold rings are always drawn.
- **new.** Decoys are for the **ruler only** (CharacterRole.Leader). A ruler's trip spawns `cvRulerDecoyCount` (2) identical shuttles (same design, same marker, same kind of name) on the same destination, with staggered departure points within the origin system. The real one is chosen deterministically (`galaxy.rnd` under the flag).
- **new (built on real code).** A completed **StealOperationsMap** intelligence mission (real, IntelligenceMissionType) against an empire whose ruler is in transit reveals the real shuttle to the spying empire. Its marker then shows "Ruler aboard" for that empire.

### 4.4 Escorts

- **real (BuiltObjectMissionType.Escort; Empire.5.cs:1370 AssignMissionToBuiltObject).** The escort is the stock Escort mission on the shuttle, with the same `CurrentEscortForceAssigned += FirepowerRaw` accounting and the same `CheckMilitaryShipWelcomeAtTerritoryLocation` (Galaxy.cs:3699) and `WithinFuelRangeAndRefuel` gates.
- **new.** The required escort firepower is `importance × routeDanger × cvEscortFirepowerPerPoint`.
  - **Importance** (0–10): Leader 10; Governor 2 + 6 × (colony value / the empire's top colony value); Admiral 3 + skills/40; Scientist 2 + skills/40; General 2 + skills/40; Ambassador 2; Captain 1; Agent 1.
  - **Route danger** (0–3): sample points along the straight route every half sector. Each sample adds the known enemy military firepower nearby (empires at war, plus known pirate bases and their ships), normalised by the shuttle's own defence. It gets +0.5 outside one's own territory.
- **new.** Escorts are idle military ships, automated, armed and with a hyperdrive (never TroopTransport or ResupplyShip), nearest first, taken until the firepower is met:
  - loose ships with no mission, or on the stock Patrol of a place that is not threatened (route danger < 0.5 there);
  - then members of a fleet with no mission (never its lead ship), which leave the fleet and rejoin it on release. (As built: the stock AI keeps almost no ship without a mission, since idle ships go on Patrol at once, so taking only mission-less ships found no escort in 46 dangerous trips of the war soak.)

  They are released on arrival: the Escort mission is cleared, the ship rejoins its fleet, and the stock AI re-tasks it.
- **new.** Defence floor: escorting never takes the last `max(1, 10%)` of the empire's idle military ships, and never takes the patrol of a threatened place.
- **new.** Route danger also counts +0.25 for any part of the straight route outside the empire's own territory.
- **new.** Cap: all escorts together are at most `cvEscortCapPct` (20%) of the empire's idle military ships.
- **new.** A trip of importance ≥ 6 with danger > 0 whose escort is short **waits** at the origin, for up to `cvEscortWaitDays` (60), for escorts to join. Then it departs with what it has. Rerouting is not in Part 1 (see the TODO in the code).
- **new.** Settings: "Automate VIP escorts" (per empire; default on; the AI always on), and an escort level of None / Light (×0.5) / Normal (×1) / Heavy (×2) in the Characters screen's post block (as built: next to the travellers they concern, instead of the policy screen). With automation off the player escorts by hand: the Escort order on a shuttle is the one order a shuttle accepts as a target.

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
- **new.** frontier-autonomy's and corporatecoup's governor spawns follow the same rule through `spawnGovernorFor` (§3.1). This add-on's own local rise (§5.4) is the one exception: a local governor rises at the colony itself.
- **new.** Governor **training**: each training site (the capital, plus every colony with a completed RegionalCapital) trains one governor per `cvTrainDays` (180) while governors + in training < the governor cap. Each costs `cvTrainCost` (2000) state credits, paid at the start, and training starts only while the treasury holds at least ten times that. (As built: without the buffer, early training drained the young treasuries just when the colony ships were being bought. See §12.) A trained governor appears at its site through the stock generator (GenerateNewCharacter, Empire.6.cs:4413), with stock random skills. It becomes a **reserve** until it is assigned.

### 5.3 Vacancy (the user's rule)

A colony is **vacant** when no active ColonyGovernor of its empire is located at it. A governor away on a trip or on
duty (Part 2) does not count.

- **new.** Grace: for `cvGraceDays` (180, six months) after the vacancy starts, nothing happens.
- **new.** Decline: after the grace, the colony's **neglect** `N` rises linearly from 0 to 1 over `cvDeclineYears` (4). Its effects grow with `N`, in the plan's order:

  | Effect | Mechanism | Size |
  |---|---|---|
  | No construction | Facility construction at the colony pauses (the `facilityConstructionPaused` query at the stock facility-progress step) | while `N > 0` |
  | Falling output | Colony tax revenue (the `colonyTaxRevenue` query) | × (1 − 0.5·N) |
  | Falling happiness | A stability term (`cause: 'vacancy'`); with frontier-autonomy on, its "No governor" drift instead (§3, C5) | −20·N approval / +4·N autonomy a year |
  | Disrepair | The colony's development level loses `cvDisrepairPerYear` per year | while `N ≥ 0.25` |
  | Emigration | Population loss per year | `N ≥ 0.5`: 1.5%·N |
  | Unrest, rebellion, breakaway | Nothing of this add-on's own: the falling approval drives the **stock** revolt (Habitat.cs:5992 CheckSatisfaction → LeaveEmpire) or internal-security's ledger revolt; with frontier-autonomy on, only its breakaway path | emergent, after years |

- **new.** Recovery: once a governor is in post, `N` falls by 1/`cvRecoveryYears` (5) per year. A colony at full neglect therefore takes 5 years to recover, and a partly neglected one proportionally less.
- **new.** When the add-on starts in a running game (added to a save), the posts vacant at its first review are filled by local rises within the grace (60–180 days), not after 1–3 years. Otherwise every colony of a mid-game empire would decline at once.
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

## 7. The Interstellar Diet (Part 2; extends `galactic-council`)

As built. Code: `src/sim/scenario/charactersVictory/diet/` (`dietState.ts` state and params, `diet.ts` sessions,
effects, crimes, the Regent and the Emperor, `dietAi.ts` weights / votes / proposals, `dietEnforcers.ts` the
blockades, `dietView.ts` the window model and map marks); flag `cvCouncil` (plus `cvDietVictory`), under the master
switch. `scenarios/characters-victory` now **includes** `galactic-council` (so the council runs with the add-on), and
the galactic-council manifest is marked `addableToSave` (its state starts lazily), so the add-on can still be added to
a save.

**Decisions on C1–C3 (the user's: "use OUR plan, extend the existing council").** The Diet is the existing council
record (founding, membership, chair, blocs, standing sanctions, `c.results`), extended through
`registerCouncilExtension` with three small new extension fields (`councilName`, `foundingText`, `ownsSessions`):
with the Diet on, the council's yearly review keeps everything except the yearly motion, and the Diet holds the
sessions. The existing founding rule stays (3 met empires, AI join threshold): in the soaks every normal empire but
one had joined within 5–6 years, so it was not changed. With the add-on off nothing registers a value: the galactic
council is byte-identical (its tests and pins unchanged).

**Name (reported).** With the Diet on the council is founded as "Interstellar Diet" (texts read "the Interstellar
Diet"; the window is "The Interstellar Diet"). "Galactic Concord" is **not** removed from `COUNCIL_NAMES`: removing it
shifts the name every council-only game draws (`seed % length`), i.e. changes the galactic-council add-on with
Characters & Victory off. So the new name applies only when the add-on is on, as the user allowed. In a CV game
the clash with rimTrade's Concord cannot happen (the council is always the Diet).

### 7.1 Host and seat

- **new (real inputs).** At every session call the host is the member with the highest Galaxy.1.cs:2863
  CalculateEmpireScore (`achievements.ts calculateEmpireScore`); the Diet's world is that empire's populated colony
  nearest the galaxy centre (`sizeX / 2, sizeY / 2`). When the strongest member changed, the seat moves then (a news
  line).
- **new (real paths).** The host world gets a **virtual wonder** of the real WonderType kinds, merged into the stock
  wonder paths through one new query, `colonyWonderBonus` (guarded lines at taxes.ts
  recalculateCriticalResourceSupplyFactors = Habitat.cs 5124 for ColonyIncome / ColonyPopulationGrowth, the two
  ColonyHappiness reads = Habitat.cs 638 / 5822, and constructionQueue.ts baconReviewConstructionSpeed =
  BaconConstructionQueue.cs 45 for ColonyConstructionSpeed): +15 % income, +15 % happiness, +15 % growth, +25 %
  construction (params `dietHost*`). Tourism: a scenic factor of at least 1.5 (`colonyScenicFactor` at
  civilianAI.ts calculateScenicFactorIncludingRuinsWonders, Habitat.cs 1116 — the real tourism and resort paths
  read it). Visitor trade: during a session the host world's tax revenue (`colonyTaxRevenue`) grows 3 % per visiting
  delegate present.
- **new.** Visiting delegates are characters at the host world, so the stock colony-skill rule (Habitat.Characters,
  highest skill) applies to them too: during a session the best visitor's skills count at the host world. Stock
  behaviour, kept.

### 7.2 Delegates

- **new.** At the call, each member's delegate is the player's choice (a governor of theirs) or Part 1's
  `mostImportantGovernor`. `setGovernorDuty` keeps the post (the colony is vacant: the 6-month grace, then decline);
  `sendVip(…, 'diet')` flies them to the host world (Part 1's `destinationValid` accepts a foreign host world for a
  `'diet'` trip — a one-line change in vip.ts). A delegate trip counts as importance ≥ 5 for the escort rules.
- **new.** The floor opens when the farthest delegate's shuttle can be there (ETA + 15 days, at least
  `dietGatherDays` 150, at most 330 days); the vote stays open `dietVoteDays` (60). Only a delegate **at the host
  world** at the close votes. After the tally `endGovernorDuty` sends every delegate home.
- **new.** A lesser delegate (not the most important governor) votes at `dietLesserDelegatePct` (50 %) weight. No
  governor, no delegate, no vote.
- **new.** Attacking a delegate's shuttle (`builtObjectAttacked` / `builtObjectKilledBy` on a `'diet'` trip) or the
  host world during a session (`habitatAttacked`) is a **crime**: −30 attitude from every member through
  `applyReputation` (cause `dietCrime`), −3 reputation (CivilityRating), and a grievance that makes a sanction (and,
  above 80, an expulsion) the members' first motion.

### 7.3 Sessions

- **new.** Regular sessions every 2–3 years (`galaxy.rnd` draws the interval; the first one 120 days after the
  founding). The agenda: every human member's motion (one each), then the heaviest AI candidates — 1 to
  `dietMaxMotions` (3), as many as carry weight ≥ 30; one motion per kind (sanctions / embargoes / condemnations /
  expulsions: one per target), one per AI proposer.
- **new (real inputs).** Vote weight = 10 × √(CalculateEmpireScore / the members' mean) × (1 + standing + gifts +
  spies) × the lesser-delegate factor. Standing: the other members' mean attitude to it / 200 (±25 %). Gifts: the share
  of members it gave a gift to in the last two years (the real `DiplomaticRelation.lastGiftDate`, set by the GiveGift
  message path) × 25 %. Spies: its successful intelligence missions against members (the real
  `intelMissionCompleted`, decaying by half a year) × 5 %, at most 25 %. A motion passes when the weighted yes
  exceeds the weighted no.

### 7.4 Motions

| Motion | Effect (as built) | Real code |
|---|---|---|
| Sanctions | The council's sanction (every member) **plus an enforcer fleet** (below) | council.ts applyMotion → StartTradeSanctions (Empire.8.cs 1586) |
| Embargo / condemn / lift / recognise / threat | The council's own effects; lifting also recalls the enforcers | council.ts applyMotion |
| Enforced truce (two warring empires) | ChangeDiplomaticRelation → Truce for `dietTruceYears` (3); a war declaration between them (`warDeclared`) brings **automatic sanctions** with enforcers; an AI party keeps it unless its race aggression − caution ≥ 30 (`declareWarBlocked`) | Empire.8.cs 2550 |
| Galactic free trade | FreeTradeAgreement between every pair of met members whose relation is plain None, re-applied yearly | Empire.8.cs 2550 |
| Ban planet destroyers | AI members' planet destroyers may not take an Attack mission on a colony (`assignMissionAllowed`); a member's planet destroyer attacking a colony is a violation | BuiltObject.2.cs 7620 |
| Ban bombardment | AI members may not take Bombard / WaitAndBombard; a member's bombardment (`habitatBombarded`) is a violation | BuiltObject.2.cs 7620 |
| Outlaw a pirate faction | Members' warships are welcome in each other's territory (new `militaryShipWelcome` query at Galaxy.cs 3699 CheckMilitaryShipWelcomeAtTerritoryLocation); **new:** a bounty (`dietBountyPerShip`, 1 500) from the Diet fund per outlawed warship a member destroys | Galaxy.cs 3699 |
| Protect the independents | AI members may not send an Attack mission at an independent colony; a member taking one (`colonyOwnerChanged`) is a violation | — |
| Open the independents | Ends the protection | — |
| Recognise a claim (claimant, colony) | The claimant's war declaration on the colony's owner costs neither DeclareWarReputationImpact nor IncidentImpactWhenDeclareWar (new `declareWarPenaltyWaived` query at diplomacyTick.ts changeDiplomaticRelation = Empire.8.cs 2704/2712), and condemnations of that war are not moved. The claim ends when the claimant holds the colony, or after 10 years | Empire.8.cs 2704/2712 |
| Expulsion | Out of the council and its blocs; no rejoining for `dietExpelYears` (10) | — |
| Regent | `dietRegentYears` (6); one veto per session; an emergency session every `dietEmergencyYears` (4); may declare themselves Emperor | — |
| Repeal | Ends a measure in force | — |

- **Resolved to-verify (§1).** The original's independent-colony branch of NotifyOfAttack (Galaxy.7.cs 3138-3195:
  −4 reputation per attack, the −50 incident with the territory owner) is **not ported** (attackAI.ts
  notifyOfAttackHabitat ports only the other branch). So there is nothing to waive for (b) today; the claim waives
  (a), which is ported. Reported, not ported here (a faithful-game change).
- **Enforcers (new, on real code).** A neutral "Diet Enforcers" faction (createThreatFaction with no enemies and
  relation bias 0; the Exchange's switched-off stock AI; `stateAIDormant`; hidden from the diplomacy list; excluded
  from the council; nobody may declare war on it except open defiance) spawns one fleet per sanctioned empire at the
  host world: the base unit 6 Cruiser + 2 Carrier + 2 CapitalShip + 2 ResupplyShip × 1–3 by the target's real
  CalculateRelativeEmpireMilitaryStrength (Empire.7.cs 4120), each ship a copy of a member's current design
  (`findNewestCanBuild`, strongest members first; a missing sub-role falls back to Cruiser / Destroyer / Frigate) with
  stance AttackIfAttacked. Its station is a weighted-random (`galaxy.rnd`, weight = strategic value) pick among the
  target's five most valuable colonies and their space ports that **every ship can reach on its fuel**
  (WithinFuelRangeAndRefuel, margin 0.1; none reachable: it waits at the host world, refuelled, and retries — the
  Dark Farms bug). It flies there with the real Blockade mission (ImplementBlockade, Empire.8.cs 3748); the blockade
  record has every stock effect (no trade, docking or construction there), but the new `blockadeEngagesDocking` query
  stops it attacking docking ships: it only returns fire. Members pay for it (`dietEnforcerCostPct` 50 % of the ships'
  price, then `dietEnforcerUpkeepPct` 10 % a year) in shares of their score, into the Diet fund. It goes home
  (despawns) when the sanction is lifted, or ends when destroyed. Attacking it is **open defiance** (−25 attitude
  from every member, a grievance); a sanctioned AI defies (declares war on the enforcers) when its aggression −
  caution ≥ 0.25 and its firepower is at least twice the fleet's.

### 7.5 AI

- **Votes (real inputs, new rule).** The stock kinds start from the council's own `voteScore` (attitude to proposer
  and target, trade volume, borders, war, blocs, extension biases) plus personality: (aggression − friendliness),
  ImportanceOfOthersReputations, Paranoid / Diplomat / Trusting, and for sanctions Protectionist / FreeTrader / race
  TradeBonus, plus the Diet's grievance record. The new kinds score the motion's effect on the voter: truce by its
  war odds (militaryPotency), WarWeariness, WarWearinessAttenuation, aggression, Pacifist / PeaceThroughStrength;
  free trade by FreeTradeIncomeFactor, TradeBonus, FreeTrader / Protectionist / Isolationist / Xenophobic / Tolerant;
  bans by caution, aggression, its own planet destroyers / bombardment policy, ImportanceOfOthersReputations;
  outlawing by the pirates' raids on it and a protection deal; independents by aggression, friendliness, its
  independent colonisation targets, Expansionist / Tolerant; claims and expulsions by attitudes and blocs; the Regent
  by attitude, trade and fear of a strong one (caution, Paranoid / Trusting). Race levels are (level − 100) / 50;
  government factors − 1; the gift budget (DiplomacySendGiftsUpToAmount) and IntelligenceAllowMission* feed the
  personality record.
- **Proposals.** Every AI member moves its strongest case: the council's grievance candidates (spy crises, wars,
  attitude), crimes and defiance (sanctions / expulsion), truces when losing, measures it likes (score ≥ 25), outlaws
  after 3+ raids, a claim on a disliked or warring neighbour's colony inside its territory, itself as Regent (the two
  strongest), repeals of what hurts it.
- **Regent.** Vetoes its worst passing motion when its score is ≤ −40; calls an emergency session for a case of
  weight ≥ 60 (a crime, a spy crisis, a war on it) when the next session is more than 300 days away; bids for
  Emperor when it holds the host world and its capital, has ≥ 35 % of the members' score and 1.5× the next member's
  military, and is not a pacifist.
- **Delegates.** Defended by the escort rules (importance ≥ 5). Attacked by an AI member at war with the delegate's
  empire when its aggression − caution > 0.15 and its ConcernForOwnReputation is low: its nearest loose warship in fuel
  range takes an Attack mission on the shuttle (once per session).
- **The Emperor.** The countdown is `dietEmperorYears` (5). Everyone may declare war on the Emperor (the Diet's
  `declareWarBlocked` handler runs last and unblocks it); AI empires that dislike them or are aggressive and not
  hopelessly outmatched (≥ 0.25 of their military) do. The bid fails when the Emperor loses its capital, or the host
  world after holding it; at the end it wins if it holds both. A win ends the game through victory.ts: single
  player `onGameEnd` (Victory for the player as Emperor, Defeat otherwise; codes 2101 / 2102); multiplayer
  `humansGameEnd` with the Emperor as the only winner when human (the first human to win ends the game), Defeat for
  every human when an AI wins. Flag `cvDietVictory` off: no game end.

### 7.6 UI and commands

- **One window, "The Interstellar Diet"** (`src/ui/screens/dietScreen.ts`), from a new top-bar button under the
  overflow button (`btnTopDiet`, our own domed-hall glyph; shown only while the Diet runs). Tabs: **Session** (seat
  and bonuses, Regent, our delegate picker with the lesser-delegate warning and presence, every motion with its
  effect, our advisers' reading, the projected weighted result, Yes / No / Abstain, Veto for the Regent, "Move a
  motion", and for the Regent "Emergency session" / "Declare ourselves Emperor"), **In force** (measures, sanctions,
  enforcer fleets and the fund, past votes) and **Members** (weight with its breakdown on hover, delegate, presence,
  host / Regent / bloc / sanctioned notes).
- With the Diet on, the diplomacy screen's council block is a two-line summary with an "Open the Interstellar Diet"
  button (the old block unchanged otherwise).
- **Map:** the seat icon above the host world (a domed hall in a violet ring that pulses while in session) and a
  gold-rimmed shield emblem beside each visible enforcer fleet, both our own procedural art (`src/render/dietArt.ts`,
  `dietMarkers.ts`), with hover labels.
- **Messages:** popups only for the big moments (a session called, the results, a Regent, an Emperor, a crime, an
  expulsion, enforcers sent against us, a lost delegate); the rest are ticker lines (`scenarioMessage` gained a
  `popup: false` option = EmpireMessage.SupressPopup), all of them in the stock message categories, so the existing
  message settings filter them. Human members get their own message instead of the NewsNet line.
- **Commands (journaled, multiplayer-safe):** `dietVote`, `dietVeto`, `dietSetDelegate`, `dietPropose`,
  `dietEmergency`, `dietDeclareEmperor` (player/playerOps.ts).

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

The council (C1–C3) follows this plan (§7). Part 2 builds on these hooks and never re-implements travel or governors.

**From `src/sim/scenario/charactersVictory/index.ts`:**

- **`sendVip(galaxy, character, destination: BuiltObject | Habitat, reason: string): boolean`.** Sends a character in person, whatever the reason (`reason` is a tag such as `'council'`).
  - It calls the stock `transferToNewLocation`, so the trip is an ordinary transfer in every stock view, and tags the trip with `reason`.
  - It returns false when the VIP shuttles are off: the stock timer then runs and no event fires.
  - Foreign destinations: an ambassador's trip may end at a foreign capital, and a `'diet'` trip (a Diet delegate, Part 2) at any owned habitat (the host world). Any other trip to another empire's habitat reroutes home (vip.ts `destinationValid`).
- **Events** (scenario/hooks.ts `ScenarioEvents`; subscribe with `registerScenarioEvent`; no closures in state, so they are save-safe):
  - `vipTripArrived { character, destination, reason }`: emitted after the stock `CompleteLocationTransfer`, so the character is already there.
  - `vipTripFailed { character, destination, reason, cause }`, where `cause` is `'destroyed'`, `'captured'` or `'removed'`. The stock death message has already gone out.
- **`mostImportantGovernor(galaxy, empire)`.** The governor at the highest strategic-value colony; ties go to the higher skill total, then the name. Null when no colony has a governor.
- **`setGovernorDuty(galaxy, governor, reason)` / `endGovernorDuty(galaxy, governor)`.**
  - `setGovernorDuty` marks the governor as away while the post is kept: the colony counts as vacant (the grace applies, then the decline), no local governor rises there, and the placement automation never fills it.
  - `endGovernorDuty` sends the governor home by VIP trip.
  - Call `setGovernorDuty` before `sendVip`.
- **Read-only queries:**
  - `colonyVacancy(galaxy, colony)` → `{ vacant, since, neglect, graceLeftDays, enRoute }`
  - `governorOf(colony)`, the shared helper, = `colonyGovernor`
  - `empireGovernors(empire)`
  - `governorCap(galaxy, empire)`
  - `fitAt(galaxy, governor, colony)`
- **Escorts and trip state, for delegates:**
  - `characterImportance(galaxy, character)` and `routeDanger(galaxy, empire, fromX, fromY, toX, toY)`
  - `tripOfCharacter` / `tripOfShuttle` / `isVipShuttle` (the trip record: shuttle, escorts, ETA through `vipTripView`)
- **Switches:** `cvOn(galaxy, CV_VIP_FLAG | CV_GOV_FLAG | …)` and `peekCvState`.

**From `src/sim/scenario/governors.ts`** (shared by every package; inert without the add-on):

- `colonyGovernor(h)` / `governedColony(c)`
- `spawnGovernorFor(galaxy, empire, colony)`: under the add-on, the governor appears at the capital and travels.
- `colonyNeglectOf(galaxy, colony)`: 0..1, the add-on's neglect.
- `governorBribeScale(galaxy, empire, n)`

**Council-specific rules the hooks already support:**
- A delegate's colony loses the governor's bonuses for the whole trip (the governor is aboard the shuttle).
- Attacking a delegate's shuttle already costs attitude (`vipAttacked`, through `applyReputation`). Part 2 adds the "major crime" with every member.

---

## 11. Tests and the flag-off check

- An existing test file gains the "flags off is byte-identical" check (scenario with every flag off = the plain seed-1 run: same `stateDigest`, same `rnd.drawCount`, no state key), following the `courtDynasties.test.ts` pattern. No new test files.
- `npm run repin -- --check --workers 1` = 0.

## 12. Measurements and tuning

The headless runs use the existing soak harness: `scripts/soak.mjs` configs `cv-on-s1` and `cv-off-s1` (the same setup with the master switch off, i.e. the faithful game), `--seed 2` for a second pair, and `cv-war-s17` (aggressive AIs, many pirates). The metrics come from a scratch hook. "Galaxy-wide" means every normal empire, the unattended human seat included.

| | seed 1, 10 y, on | seed 1, 10 y, off | seed 2, 8 y, on | seed 2, 8 y, off | war, seed 17, 4 y, on |
|---|---|---|---|---|---|
| Governor moves (total) | 32 (≈3 a year galaxy-wide, ≈0.3 per empire a year) | – | 18 | – | 14 |
| VIP trips / lost | 100 / 2 | – | 57 / 4 | – | 50 / 3 |
| Trips on a dangerous route / escorted / escort ships | 88 / 45 / 63 (1.4 a trip) | – | 52 / 12 / 15 | – | 46 / 18 / 19 |
| Colonies without a governor (yearly snapshots) | 9–15 % | 73 % (stock: no penalty) | 7 % (AI 3.7 %) | 75 % | 4–17 % |
| Mean vacancy length | 159 days (below the 180-day grace) | – | 163 days | – | 140 days |
| Colonies in decline at a time | 2–4 | – | 1 | – | 0–1 |
| AI state money at the end | 4.24 M | 3.82 M | 3.20 M | 2.11 M | – |
| AI colonies | 36 | 44 | 27 | 30 | – |
| AI population | 149.0 bn | 153.0 bn | 140.3 bn | 144.6 bn | – |
| AI annual tax revenue | 2.97 M | 2.89 M | 2.52 M | 2.20 M | – |
| AI ships and bases | 792 | 751 | 599 | 557 | – |

**Step time on the big save.** `~/wt/eng-perf/scratch/late.save` (27 empires, 47.7 k built objects, 235 colonies), with the add-on added to the save, 30 s warm-up, then 120 game seconds (7200 steps), two runs each:

| | wall ms / step | CPU ms / step |
|---|---|---|
| Off | 6.61, 6.08 | 8.73, 8.25 |
| On | 6.57, 6.09 | 8.56, 8.07 |

A CPU profile of an "on" run puts every function of the add-on together at under 0.3 % of the sim's time (the whole scenario hook machinery, every add-on, at 0.6 %). The whole-soak wall times differ more (seed 1: 338 s on vs 366 s off; seed 2: 470 s vs 304 s), but those runs follow different game histories on a shared machine.

**Tuning applied.**
- Escorts first drew only ships with no mission. The stock AI puts idle ships on Patrol at once, so none were found (0 of 34 dangerous trips escorted). Escorts now also come from unthreatened patrols and idle fleets (§4.4).
- Zero-distance governor "moves" (an extra already at the colony) are skipped.
- A game the add-on is added to fills its vacant posts within the grace (§5.3).
- No stampede: a war declaration re-ranks needs, but moves stay within the per-review limit (2) and the transit cap (1 per 15 colonies). The war run's 14 moves in 4 years show no burst.
- No thrashing: every optimising move needs 2 years of tenure and a 25 % gain.

**C4, coup bribes.**
- Setup: soak configs `cv-coup-on` / `cv-coup-off` (threat-framework + corporatecoup + this add-on; a hook registers a subject company for each AI holder, since 19c is a stub), seed 1, 6 years. `coupBribePct` was raised to 200 per mille so that the counts are measurable.
- Result: the governors bought were 3 with the add-on on (scaled) and 3 off, i.e. 0.5 a year either way, with 20–29 vs 2–8 AI governors at colonies.
- Before the scaling (the first version used the stock role limit, at least 1 per holder), the add-on-on run bought 5. Unscaled, about 25 governors × 0.2 ≈ 5 a year would be expected.

**Open points (reported, not tuned away).**
- **Fewer AI colonies: found and fixed.**
  - Five-year pairs on seeds 1, 3 and 5 gave 24 / 24 / 25 AI colonies off against 19 / 20 / 24 on. No colonies were lost in any run, but fewer colony ships were built (24 / 24 / 22 off, 16 / 21 / 24 on).
  - In the first two years the AI treasuries were 10–20 % lower with the add-on on. Reserve-governor training (2000 each, two or three per young empire, at once) was eating the money the stock DirectConstruction checks before it buys a colony ship (`stateMoney`).
  - Ablating the shuttles, escorts or governors one at a time each moved the count only within seed noise.
  - The fix: training waits for a treasury of ten times its cost. Afterwards, seed 3 matched the faithful game exactly (24 colony ships, 24 colonies) and seed 1 came within 2 colonies (21 vs 23, 18 vs 24 ships), inside the seed-to-seed spread.
- **The unattended human seat.** It never accepts suggestions, so its colonies are the ones that stay vacant into full neglect. Local rises are capped by the governor cap, which the idle reserves fill.
- **Crash guard.** In the original, PerformIntelligenceMissions' counter-intelligence pass dereferences a foreign agent's empire. An earlier catch in the same pass may already have killed that agent, so the dereference throws. The add-on's different Rnd stream hit this on the big save, so the port now guards it (espionage.ts; no effect on any run that did not crash).
