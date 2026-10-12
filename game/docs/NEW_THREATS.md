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
    `genShipsMinFirepower` (3,000), at most `genShipsMaxEscorts` (60) ships;
  - troop transports with `genShipsRegiments` (30) regiments per 7,000 escort firepower (clamped 12..90), strength
    `genShipsTroopStrength` (100) each, of the faction's race;
  - the world ship (the faction's colony ship design, named per flavour) with `genShipsSleepersM` (1,500) million
    sleepers; a scout flies to the target.
  Everything but the scout holds at the edge. The faction's state AI is dormant until it settles (`stateAIDormant`).
- **First contact** `genShipsContactDays` (60) after arrival (or when the scout is near): a popup to the owner with the
  fleet's size and the countdown (`genShipsUltimatumDays` 540 = 18 months). The Quiet Ship's contact is the scouts'
  report: no life signs, a ship mind following its colonisation orders, the date it moves.
- **Build-up**: from first contact until the arc resolves, the owner's AI plans a larger navy:
  `forceStructureThreat` ≥ 4 and `forceStructureWarships` × `genShipsAiBuildupPct` (220) %.
- **Ultimatum** (a scenario decision, `decisions.ts`; the player answers in the message popup through the journaled
  `answerScenarioDecision` command, `genShipsAnswerDays` 60 to answer, then "refuse"; the AI answers at once):
  - Pilgrims: cede / offer a substitute (the nearest empty habitable planet, else the owner's smallest other
    colony) / refuse;
  - Heirs, Ark Faith: cede / refuse;
  - Quiet Ship: no ultimatum; it simply attacks.
  AI rule (`aiUltimatumChoice`): fight when its military firepower is at least `genShipsAiFightRatioPct` (100) % of
  the escort's living firepower; otherwise Pilgrims are offered a substitute, Heirs are fought from 75 % of that
  ratio, everything else is ceded.
- **War** (locked while it lasts): the escort attacks the colony; the transports sail once half the escort is on
  station and land (the stock troop-ship landing, `invadeFromInside`, as Dark Farms) when no defending warship is
  within 8,000; the stock ground war decides it.
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
  - repelled (no warships and no troops left, or `genShipsWarYears` 4 without winning): the survivors scatter (torn
    down). The Ark Faith leaves no cult.
- **UI**: popups only for arrival (NewsNet), first contact and the ultimatum; the rest is ticker / NewsNet lines.
  Known-site row on the map for the world ship.

## 2. Archive Cores

- Found by capturing a world ship, destroying one (60 %), destroying the Probe Swarm's mothercore, or investigating
  ruins (`archiveRuinsChancePerMille` 40, one roll per ruin with an own seeded `Random`; the new
  `ruinsInvestigated` event at the top of `exploration.ts investigateRuins`).
- The finder chooses (a scenario decision; the player in the popup, journaled): **study** — `archiveStudySteps` (4)
  yearly boosts of `archiveStudyPct` (20) % of a year of its research each; **seal** — one boost of `archiveSealPct`
  (120) % after `archiveSealYears` (5). A boost is at least `archiveMinPoints` (15,000) and goes into the current
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
  `probeSwarmBudgetCap` (250,000), spent only on warships (`probeSwarmStartShips` 4 + 0.8 per station) and mining /
  gas mining stations (one every `probeSwarmStationDays` 75, up to `probeSwarmMaxStations` 40) at the free asteroid
  field or gas giant nearest the mothercore within `probeSwarmExpandRangePct` (6 % of the galaxy width) of a swarm
  station, never in a system with a colony.
- Defence: every 10 days any ship of any owner inside a system with a swarm station is attacked by the two nearest
  free swarm warships; idle warships patrol the stations.
- Mothercore destroyed: the expansion stops; as for any pirate faction without a base, the stock
  `checkForTerminatedPirateEmpires` dissolves it (stations to the independents). The killer salvages
  `probeSwarmSalvageResearch` (60,000) research points of drone technology and an Archive Core.

## Stock-code touch points (all behind `galaxy.scenario !== null`)

- `scenario/hooks.ts`: event `ruinsInvestigated`, query `pirateFactionPassive`.
- `exploration.ts investigateRuins`: emits `ruinsInvestigated`.
- `tick/pirateTick.ts empirePirateDoTasks`, `pirates/pirateGalaxyTick.ts checkMergePirateFactions`: the passive gate.
- `threats/robotMutiny.ts`: `raiseFactionTech` exported for reuse.

## As built

(Soak results and tuning below.)
