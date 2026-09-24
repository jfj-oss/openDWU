# M2 plan — Empires & colonies (spec Part 15 M2)

Source: `Start.2.cs` `method_81` (386–2204) orchestrates game creation; `Galaxy.7.cs` `GenerateEmpire` (5078+), `Galaxy.8.cs` `MakeHabitatIntoColony` (639), `Galaxy.6.cs` `SetEmpireForAllIndependentHabitats` (880), `Galaxy.1.cs` `ReviewIndependentColonies` (827); `Empire*.cs` (62k lines) = the empire model.

Slices (each a small locked task, source pasted):
- **M2a** Empire core: constructor (Empire.cs 3748–4146) + only the fields it touches. ← first
- **M2b** Colonies: `MakeHabitatIntoColony` + colony fields on Habitat (population, owner, facilities list stub).
- **M2c** `GenerateEmpire` (player + AI) using M2a/M2b; starting ships as TODO.
- **M2d** Game-start orchestration: the parts of `method_81` that place empires (`method_83`/`method_93` start-location search, independent colonies review).
- **M2e** Map rendering of empires: owner colour rings around colonies, territory blobs.
- **M2f+** Economy tick (tax, population growth) from Empire DoTasks — to be sliced after M2a–M2e land.

## Notes from cloud lane C (merged fe9c5d1)
- Done elsewhere: 08c, 08e1, 08h. 08e2 == M2c (dropped).
- **M2b**: once Habitat has `owner`, add the owner checks to `setColonizableHabitatsInSystem` (Galaxy.8.cs:102/106).
- **M2c**: for the tail of `GenerateEmpire` (Galaxy.7.cs 5348–5375) call `galaxy.setupHomeSystem(capital, race, desc, minRes, minCrit)`; expansion roll via `Galaxy.determineEmpireExpansion(galaxy.rnd, age)`; pass `null` race to `selectResources` there, as the C# does.
- Creature constructor now makes the C#'s Rnd calls — galaxy values pinned after creature generation shifted.
