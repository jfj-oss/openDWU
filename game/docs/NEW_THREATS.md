# New threats: Generation Ships, Archive Cores, the Dead Probe Swarm

Three add-ons of the Galactic Threats expansion (`addons.ts` EXPANSIONS `galactic-threats`), each its own scenario
folder with every value a manifest param:

| add-on | folder | flag | code |
|---|---|---|---|
| Generation Ships | `scenarios/generation-ships` | `threatGenerationShips` | `src/sim/scenario/threats/generationShips.ts` |
| Archive Cores | `scenarios/archive-cores` | `threatArchiveCores` | `src/sim/scenario/threats/archiveCores.ts` |
| Dead Probe Swarm | `scenarios/probe-swarm` | `threatProbeSwarm` | `src/sim/scenario/threats/probeSwarm.ts` |

All three include `threat-framework`. Generation Ships and the Probe Swarm register with its existence lottery but
override it to "always" (`generationShipsExistChancePct` / `probeSwarmExistChancePct` 100, `...MinYear` 0): they are
early-game threats and turning them on means they come. Archive Cores is a mechanic, not a hidden threat (no lottery).
With every flag off nothing runs, nothing is created and nothing draws: `npm run repin -- --check` stays 0.

## 1. Generation Ships

### Design

An early-game crisis, once per game.

- **Trigger** (periodic, every 10 days): `genShipsEmpiresAtTech` (2) normal empires at researched tech level
  `genShipsTechLevel` (3; `robotMutiny.ts empireTechLevel`, the highest researched regular tech level), no earlier than
  `genShipsEarliestYear` (5) years in; at `genShipsLatestYear` (15) it fires whatever the tech.
- **Flavour** (`genShipsFlavour` -1 = random): Pilgrims, Heirs, Ark Faith, Quiet Ship, drawn with the module's own
  seeded `Random` (never `galaxy.rnd`).
- **Target**: a populated colony of a normal empire (not the Ancient Guardians or the Shakturi), best population ×
  (0.5 + quality) first, one of the top five; capitals only when nothing else exists.
- **Arrival** beyond the outermost system star in the target's direction from the galaxy centre: a new faction
  (`createThreatFaction`, adoptOnly: no colony yet; a free race) with the target's tech level
  (`raiseFactionTech` + `generateDesignFromSpec`, as the Robot Mutiny's beacon ships), and
  - an escort of warships (Cruiser, Destroyer, Frigate, Cruiser, Capital ship, Destroyer, Escort, repeating) until its
    firepower reaches `genShipsFleetFactorPct` (130) % of the target empire's military firepower measured at that
    moment (`militaryPotency`, the sum of `calculateOverallStrengthFactorWithoutShields`), never below
    `genShipsMinFirepower` (700), at most `genShipsMaxEscorts` (60) ships;
  - troop transports with `genShipsRegiments` (30) regiments per `genShipsRegimentFirepower` (1,000) escort firepower (clamped 12..90), strength
    `genShipsTroopStrength` (100) each, of the faction's race;
  - the world ship (the faction's colony ship design, named per flavour) with `genShipsSleepersM` (1,500) million
    sleepers; a scout flies to the target.
  Everything but the scout holds at the edge. The faction's state AI is dormant until it settles (`stateAIDormant`).
- **First contact** `genShipsContactDays` (60) after arrival (or when the scout is near): a popup to the owner with the
  fleet's size and the countdown (`genShipsUltimatumDays` 540 = 18 months). The Quiet Ship's contact is the scouts'
  report: no life signs, a ship mind following its colonisation orders, the date it moves.
- **Build-up**: from first contact until the arc resolves, the owner's AI plans a larger navy:
  `forceStructureThreat` ≥ 4, `forceStructureWarships` × `genShipsAiBuildupPct` (220) %, and the new
  `stateConstructionBudget` query lets the state construction budget cover the whole planned force. The AI also
  gathers its navy over the world (fleets and loose warships Patrol it, and attack an escort that comes within 24,000)
  and recruits infantry there while its garrison is below `genShipsAiGarrisonPct` (120) % of the invaders' troop
  strength (at most 3 in training). A human owner only gets the warning and the countdown.
- **Ultimatum** (a scenario decision, `decisions.ts`; the player answers in the message popup through the journaled
  `answerScenarioDecision` command, `genShipsAnswerDays` 60 to answer, then "refuse"; the AI answers at once):
  - Pilgrims: cede / offer a substitute (the nearest empty habitable planet, else the owner's smallest other
    colony) / refuse;
  - Heirs, Ark Faith: cede / refuse;
  - Quiet Ship: no ultimatum; it simply attacks.
  AI rule (`aiUltimatumChoice`): fight when its military firepower is at least `genShipsAiFightRatioPct` (100) % of
  the escort's living firepower; otherwise Pilgrims are offered a substitute, Heirs are fought from 75 % of that
  ratio, everything else is ceded.
- **War** (locked while it lasts): the escort attacks the colony; the transports wait at a staging point 24,000 short
  of it and close in (Move orders only, so the stock Attack command cannot land them past the defenders) once half
  the escort is on station and no defending warship is within 8,000, then land (`invadeFromInside`, as Dark Farms);
  the stock ground war decides it.
- **Outcomes**:
  - ceded / substitute / conquered: the war ends, the world ship flies to the world and lands (its sleepers join the
    colony; an empty substitute is colonised with `makeHabitatIntoColonyRuntime`, the stock Colonize path), and the
    faction is an ordinary small AI empire. Pilgrims (not after a conquest): +`genShipsGratitude` (50) lasting
    reputation and a Protectorate with the owner. Heirs: −`genShipsGrudge` (60) lasting reputation against the owner.
  - the world ship destroyed: a wreck field (`generateDebrisField`; with Wreckage & Salvage on, its own wreck record
    takes the hull instead), and `genShipsCoreOnKillPct` (60) % chance (own seeded roll) of an Archive Core for the
    killer; the fleet scatters.
  - the world ship captured (the stock boarding / capture rules, `builtObjectOwnerChanged`): its sleepers join the
    captor's nearest colony; the captor recovers an Archive Core; the fleet scatters.
  - repelled (no warships and no troops left, or `genShipsWarYears` 2 without winning): the survivors scatter (torn
    down). The Ark Faith leaves no cult.
- **UI**: popups only for arrival (NewsNet), first contact and the ultimatum; the rest is ticker / NewsNet lines.
  Known-site row on the map for the world ship.

## 2. Archive Cores

- Found by capturing a world ship, destroying one (60 %), destroying the Probe Swarm's mothercore, or investigating
  ruins (`archiveRuinsChancePerMille` 40, one roll per ruin with an own seeded `Random`; the new
  `ruinsInvestigated` event at the top of `exploration.ts investigateRuins`).
- The finder chooses (a scenario decision; the player in the popup, journaled): **study** — `archiveStudySteps` (4)
  yearly boosts of `archiveStudyPct` (16) % of a year of its research each; **seal** — one boost of `archiveSealPct`
  (90) % after `archiveSealYears` (5). A boost is at least `archiveMinPoints` (15,000) and goes into the current
  research projects (the progress / breakthrough path of `performResearchProjects`, without research events). Seal
  is worth more than the sum of the study boosts, and later.
- AI: studies at war, seals at peace.

## 3. Dead Probe Swarm

- Wakes `probeSwarmYear` (6) years in at the free asteroid field with the most free mining sites within one expansion
  step, in an uncolonised system at least `probeSwarmMinCapitalDistancePct` (15 % of the galaxy width) from every
  capital.
- A pirate-kind faction (`createThreatFaction` kind `pirate`: the stock pirate base is the **mothercore**) at tech
  `probeSwarmTechLevel` (3), but not a pirate: the new `pirateFactionPassive` query (`tick/pirateTick.ts`,
  `pirateGalaxyTick.ts checkMergePirateFactions`) skips the pirate AI's mission bids, fleet tasks and raids, ship
  missions, colony control, offers, relations / extortion, force projection, construction, attack offers, trade and
  random events, and the faction never merges; `pirateProtectionDesired` keeps empires from buying protection.
- Budget `probeSwarmBudget` (60,000) + `probeSwarmBudgetPerStation` (15,000) per station a year, at most
  `probeSwarmBudgetCap` (250,000), spent only on warships (`probeSwarmStartShips` 4 + 0.5 per station) and mining /
  gas mining stations (one every `probeSwarmStationDays` 75, no limit by default: `probeSwarmMaxStations` 0) at a free
  asteroid field, gas giant, planet or moon with minable resources (never a colonised world; nearest system to the mothercore first and every eligible site of a system finished before the next one out, richer
  sites first only within a system: a dense blob that grows ring by ring) within `probeSwarmExpandRangePct` (6 % of the galaxy width) of a swarm station. It may build in
  systems that hold colonies (`probeSwarmAvoidColonies` 1 restores the old ban). The mothercore still sits in an uncolonised system.
- Colony systems: its warships attack ships there as anywhere, but never raid, bombard or invade the colony, and do not
  open fire on colony bases (defences, space ports): the `builtObjectSparesStaticTarget` query makes `shouldAttack`
  skip a stationary base in a colony system unless it attacked the swarm first (then fire is returned).
- Map: systems with a swarm base the viewer has explored and seen draw a dark-brown presence disc (galaxyMarkers.ts station-presence
  layer, own colour, shown regardless of the presence toggle, galaxy/sector zoom, redrawn only when the refreshed station set or view changes).
- Defence: every 10 days any ship of any owner inside a system with a swarm station is attacked by the two nearest
  free swarm warships; idle warships patrol the stations.
- Mothercore destroyed: the expansion stops; as for any pirate faction without a base, the stock
  `checkForTerminatedPirateEmpires` dissolves it (stations to the independents). The killer salvages
  `probeSwarmSalvageResearch` (60,000) research points of drone technology and an Archive Core.

## Stock-code touch points (all behind `galaxy.scenario !== null`)

- `scenario/hooks.ts`: event `ruinsInvestigated`, queries `pirateFactionPassive` and `stateConstructionBudget`.
- `construction/empireConstruction.ts` state construction: the `stateConstructionBudget` query.
- `exploration.ts investigateRuins`: emits `ruinsInvestigated`.
- `tick/pirateTick.ts empirePirateDoTasks`, `pirates/pirateGalaxyTick.ts checkMergePirateFactions`: the passive gate.
- `threats/robotMutiny.ts`: `raiseFactionTech` exported for reuse.

## As built

### Decisions taken during the build

- Firepower is measured as `militaryPotency` (the stock `calculateOverallStrengthFactorWithoutShields` sum). In that
  unit an AI empire has only about 90–900 at year 5, so the user's "about 7,000" escort became "1.3× the target,
  never below 700" (the floor, about 8 warships, applies when 1.3× would be trivial), and the 30 regiments scale per
  1,000 escort firepower.
- The world ship is the faction's colony ship design at the target's tech level (no new art, no new hull). Lost tech
  rides on it as an Archive Core; the escorts carry none.
- Pilgrims' gratitude is a Protectorate plus lasting reputation; the Heirs' grudge is lasting reputation (the
  reputation ledger when Reputation is on, the stock evaluation bias otherwise).
- Repelled fleets scatter (are torn down) instead of lingering; the world ship leaves no wreck then.
- The swarm's construction is abstracted (stations and warships appear at once for their purchase price) rather than
  run through the pirate construction AI, which the passive gate switches off.
- Destroying the mothercore dissolves the swarm through the stock pirate-termination rule (stations go independent).
- Archive Core boosts are "% of a year of the empire's research" (`annualResearchPotential`), so they scale with the
  empire.

### Soak results (2026-10-12)

700 stars (starCountIndex 3, dimensionIndex 3), 7 AI empires, default research, `scripts/soak.mjs --set new-threats`
configs: `gt-on-sN` = all three add-ons on, `gt-off-s1` = the same galaxy with them off. 30 game years, save → load →
continue check at year 15. Three rounds: round 1 (old defaults), a tuning round (escort floor, funded build-up,
smaller cores and swarm), and the final round below after the AI defence fixes (fleet gathering, garrison levy,
staged landings, 2-year war limit).

| run | arrival / contact | flavour | target (owner) | fleet / owner at spawn → at ultimatum | answer | war result | Archive Cores | swarm stations y10 / y15 / y20 / y30 | swarm fights (engagements, kills, losses) | mothercore | save | s / game year |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| gt-on-s1 | y5.1 / y5.3 | Pilgrims | EB738 (Ugnari Industries, AI) | 724 / 88 → 169 | substitute (AI) | none: settled an empty world y7, now a 4-colony protectorate | 1 (ruins, sealed: 281k) | 13 / 30 / 30 / 30 | 168, 34, 39 | alive | ok | 70.1 |
| gt-on-s2 | y5.1 / y5.3 | Ark Faith | S1061 2 (Wekkarus Confederacy, AI) | 1,320 / 911 → 2,117 | refuse (AI) | conquered after 2.2 years (7 landings; 15 of the escort left); the faction later lost the world | 3 (ruins, all sealed: 263k, 267k, 293k) | 7 / 23 / 30 / 30 | 214, 81, 41 | alive | ok | 72.6 |
| gt-on-s3 | y5.1 / y5.3 | Ark Faith | Arra (Dhayut Empire, the automated player) | 758 / 113 → 337 | refused (answer expired) | repelled within 0.8 years: the fleet was destroyed | 2 (ruins 285k; the mothercore, sealed: 353k) | 13 / 28 / 30 / 30 | 369, 93, 34 | destroyed (S2166 Supremacy) | ok | 74.1 |
| gt-off-s1 | — | — | — | — | — | — | — | — | — | — | ok | 68.0 |

No exceptions, hard invariant failures, non-finite or negative values in any run; every save round trip was
identical (digest, save text, re-serialised text).

**Step time:** gt-on-s1 70.1 s per game year against 68.0 s for the same galaxy without the add-ons (+3 %, the two
runs side by side on the same 8 cores; the s2/s3 runs ran alongside them and are not a baseline). The swarm's home
search was made O(systems²) after the first smoke run showed a 1.6 s frame at its wake.

**Round 1 → tuning:** the escort was at the 3,000 floor everywhere (34× the target), so every AI ceded; a sealed
core paid 750k (1.2 years of research); the swarm reached 40 stations by year 20 with 36 warships. Round 2 showed the
AI fighting (Ark, 2,028 against 1,320) but losing in six months: its fleet was 3.9 million units away and the
transports' Attack order let the stock command land troops past the defenders.

**Verdict.** Met: the arrival is early (year 5 in all three seeds; the tech gate and the year-5 floor coincide at
default research); the build-up works (owner firepower ×1.9–3 by the ultimatum); a prepared defender beat the Ark
(s3) and a committed AI held 2.2 years; the swarm grows noticeably when ignored (to its 30-station cap by year
15–20) and an empire that went for the mothercore ended it (s3); the AI used every Archive Core choice (always
"seal", none of the finders were at war). Not met yet: in s2 the committed AI still lost, just past the 2-year mark
(`genShipsWarYears`): its navy was outnumbered at the world despite 1.6× more firepower overall. Levers, if more
tuning is wanted: `genShipsWarYears`, `genShipsFleetFactorPct`, `genShipsAiGarrisonPct`, `genShipsAiFightRatioPct`.
Two rounds were run, as asked; the final round's defence changes are mechanics fixes.

## 4. The Purifier (mid-game hunt)

`src/sim/scenario/threats/purifier.ts`, scenario `scenarios/purifier`, flag `threatPurifier` (off by default). A Hunt for the
Bismarck from stock parts: the stock planet destroyer (generatePlanetDestroyerDesign, the Attack mission on a colony,
firePlanetDestroyerAtHabitat, destroyHabitat) with a close escort (the stock Escort mission on the destroyer), a pirate-kind
faction driven by the module (pirateFactionPassive), infinite fuel and a fuel refill for the escorts near it.

- **Wake:** an ancient repair station (the faction's pirate base) in a remote stock gas cloud, built when an empire's ship comes
  there (or purifierWakeYears later the nearest empire's / the player's with "guarantee this threat"). 50/50: preprogrammed
  (a random builders' family, hunts all others) or the waker chooses a family (player pop-up; AI: its strongest rival's family,
  an empire at war first). With no hunted colony for purifierRetargetYears it retargets the nearest populous family.
- **Raider:** strike one colony (nearest hunted one it out-guns), jump to an empty system far from every colony and hide;
  one strike per purifierStrikeDays; retreats when enemy firepower near it is purifierOutgunnedRatio x its own.
- **Lost contact:** per-empire last known position from the stock fog (isObjectVisibleToThisEmpire) and long-range scanners
  covering either end of a hyperjump; shadowing shares sightings among hunting empires; AI hunters Patrol / Attack with a
  a coalition (below). One glyph on the galaxy map (live, or the last spotted place, and the station once
  known); no radius overlays.
- **Wounds:** each newly damaged component may hit the hyperdrive (jump spool x1.5 each hit, hyperjumpSpoolFactor); no field
  repair (repairRateFactor). Past purifierPortDamagePct it sails to the station; docked it is helpless (shields 0, weapons without
  power, spool x1000) for purifierRepairDays, then repaired. The station is a hidden site (knowledge framework), has guards,
  AI hunters that know it attack it while the Purifier is docked, and destroying it removes the haven.
- **Reputation:** the stock -20 per planet lands on the faction itself. The waker loses purifierWakerRep once, when exposed
  (first sighted by another empire, or purifierExposeYears after the wake); victims' regard for it then drops purifierVictimRep.
- **End:** destroyer killed -> news, killing blow: purifierBounty money and reputation (no research). Stock touch point:
  `pirateTerminationBlocked` query in checkForTerminatedPirateEmpires (the faction outlives its station).

### Balance pass (2026-10-15)

**Changes.** Group: destroyer at purifierDestroyerPct 60 % of the stock overpower (its shields were ~3900, effectively unhittable
by AI fleets), escorts purifierEscortPct 50 % of the top-3 mean military (min 3), tech +1 kept. Strikes: purifierStrikeDays 180,
purifierBoldRatio 1.5 (it strikes colonies whose defenders are up to 1.5x its firepower, so concentrated fleets get a real fight),
purifierOutgunnedRatio 2 (break-off). Wounds: purifierPortDamagePct 10 (35 % of ~360 components was unreachable in real fights).
**Coalition hunting** (`dispatch`, every 2 days): all AI hunters (hunted families, victims, empires that know the station) act as one.
Chasing a raider that jumps is hopeless, so they rally where it must come: the colony it will most likely strike next (nearest hunted
colony to the freshest sighting any hunter holds), or an ambush at the station once known (AI hunters pool station knowledge; the
exposure news reveals it). Forces of ALL hunters within reach (3.5M of the rally point, 12M for the station) are summed against its
strength x purifierHunterRatio (1.2; x0.6 while it limps for port); short of that nobody commits. Units (already-rallying first, then
nearest) Patrol the rally system and all go in with Attack together once purifierGatherPct (80 %) of the needed strength is there and it
is in view (never piecemeal); at the docked Purifier they go in at once. A crippled Purifier (hyperdrive gone, limping to port) is tracked
by every hunter. Also: the station-dock wake reveal, rudderTotal / gatherSys / gatherGo / launches saved in state (older saves default),
and a null guard in invasion.ts invasionSucceeded (a soak crash when the invaders were already gone).

**Soak** (600-1000 stars, 8-12 AIs, empires started at Age 6 / tech 5 so they are roughly mid-game: military potency 5k-25k each, group
~9-11k; wake ~year 1.4-2; 9 years after wake). Year-2 empires at default age (military 385-2810) are NOT representative: there the
destroyer was killed in only 1-2 of 8 runs whatever the parameters, so tuning was done against the mid-game state.

| seed (600 stars, 8 AIs) | mode | worlds | escorts lost | hunter ships lost | port trips | result |
|---|---|---|---|---|---|---|
| 1 (wake 2.0y) | pre | 7 | 35 | 88 | 1 (+repair) | killed +6.5y (S207 Supremacy) |
| 1 (wake 2.0y) | waker | 6 | 26 | 63 | 1 (+repair) | killed +4.7y (S207 Supremacy) |
| 2 (wake 1.4y) | pre | 4 | 22 | 89 | 0 | killed +4.4y (S325 Commonwealth) |
| 2 (wake 1.4y) | waker | 2 | 16 | 21 | 1 | killed +2.2y (S486 Enclave) |
| 3 (wake 0.6y) | pre | 10 | 26 | 184 | 0 | alive at +8.5y (escorts 7/33) |
| 3 (wake 0.6y) | waker | 1 | 4 | 23 | 1 | killed +2.0y (Ugnari Syndicate) |
| 4 (wake 1.0y) | pre | 6 | 24 | 49 | 1 | killed +5.6y (S532 Syndicate) |
| 4 (wake 1.0y) | waker | 1 | 12 | 32 | 1 | killed +1.1y (S68 Enclave) |

Empires started at Age 6 / tech 5 (military potency 5k-25k each, Purifier group ~9-11k). 7 of 8 killed (1.1-6.5 years after waking);
preprogrammed games ~5.5 years, waker games sooner. Rudder hits and port trips (with a completed repair in two runs) happen in real fights.
Before the urgency / shared-report changes (earlier setup: seeds 1-2 plus 1000-star / 12-AI seeds 3-4): 5 of 8 killed, 3 of 4 big-galaxy runs
alive at year 9 with their escorts nearly gone.

**Urgency and shared reports.** Each world it destroys lowers the force the hunters demand and the share that must have gathered by
purifierUrgencyStep % (8, floor purifierUrgencyFloor 35 %) and widens the empires' reach (reach / urgency). A sighting by any empire is
passed to every hunting empire and to the sighting empire's mutual-defence allies (no exposure for the receivers). A kill whose last shot
falls to a non-empire (pirate, monster, collision) now credits the empire that sank the most of its ships (earlier runs ended with "killer none").
