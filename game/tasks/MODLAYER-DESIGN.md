# Mod layer (scenarios) — design

Foundation for task 19 (19a rim trader, 19b Dark Farms, 19c chartered companies, 19d emergent items). Goal: scenario
content and behaviour live **beside** the faithful port; with no scenario chosen the game is byte-identical (0 pin
changes, same Rnd stream, same save text apart from one `scenario: null` field).

## 1. Data overlay

```
game/scenarios/                      repo-owned, text only (no art, nothing copyrighted)
  <id>/scenario.json                 manifest (below)
  <id>/races/<file>.txt              race records
  <id>/raceBiases.txt                rows merged by race name (new races need a row)
  <id>/resources.txt components.txt facilities.txt fighters.txt plagues.txt research.txt
  <id>/Policy/<Race>.txt, Policy/pirate/<Race>.txt
  <id>/designTemplates/<race|DEFAULT>/[pirate/]<subRole>.txt
  <id>/characters/<Race>.txt
  <id>/GameText.txt                  additions / overrides (same line format as the stock file)
```

Served at `/assets/scenarios/<id>/<file>`: the Vite dev middleware (`vite.config.ts` scenarioAssets) serves
`game/scenarios/`, the build copies it to `dist/assets/scenarios/` (the Electron shell serves dist/ as-is), and
`/assets/scenarios/index.json` is generated (dev: on request; build: at closeBundle; `scripts/scenarioIndex.mjs`) from
every `<id>/scenario.json` plus the list of files under `<id>/` (the browser cannot list folders). Race and policy
overlays are **patches** (only the changed key lines), so no stock data file is ever copied into the repo. A user scenario folder (e.g. `<userData>/scenarios/`) is a later addition: the
desktop shell maps a second root under the same URL prefix and merges its index.

Manifest (`scenario.json`):
```json
{ "id": "example", "name": "Example", "description": "…",
  "flags":  [{ "name": "exampleFlag", "label": "…", "description": "…", "default": false }],
  "params": [{ "name": "knob", "label": "…", "default": 3, "min": 0, "max": 10 }],
  "homePlacement": [{ "race": "Human", "minRadius": 0.82, "maxRadius": 1.0 }],
  "resourcePlacement": [{ "resource": "Loros Fruit", "minRadius": 0.8, "maxRadius": 1.0 }] }
```

Merge rules (`applyScenarioOverlay(base, overlay) → GameData`, `src/sim/scenario/overlay.ts`; pure except GameText,
which — like `loadGameData` — goes into the global text table):
- **Record files** (resources, components, facilities, fighters, plagues, research): the overlay file holds only
  changed/new records; a record whose name matches a base record replaces it in place, others are appended. Id
  collisions of appended records are reported in `overlay.warnings`.
- **races/**: an overlay file with the same path as a base race file is a key-line patch over the base text (the
  base loader keeps the raw texts in `GameData.sourceTexts`); if the patch changes Name it is a **rename** — the renamed
  race keeps its list position and inherits the old name's Policy, pirate Policy, design templates, character file and
  raceBiases row/column unless the overlay supplies them. Any other race file is a complete new race, appended.
- **raceBiases.txt**: rows merged by name; every row padded with 0 to the new race count (the C# only populates
  Race.Biases when rows == races).
- **BasedOn**: a race file (new file name) whose first key line is `BasedOn ;<stock race file>` is a new race: its key
  lines apply over that race's text, and it starts with copies of the parent's policies, design templates and
  raceBiases row/column (so biases stay populated). It needs its own Name.
- **include**: `"include": ["<id>", …]` in scenario.json applies those scenarios' overlays first (recursively; cycles
  rejected); flags / params / placement rules merge (the outer manifest wins on a name). Loaders resolve includes
  (`resolveScenarioIncludes`) from the same scenario folder.
- **Policy/[pirate/]<Race>.txt**: key-line patch over the race's base policy text (or a new policy).
- **designTemplates / characters**: whole-file replace or add, keyed like the base maps.
- **GameText.txt**: tags added or overridden (no clear).
- The returned GameData carries `scenario: { manifest, files }`; the base GameData object is never mutated.
- Empty overlay ⇒ every GameData field deep-equal to the base and the same seed-1 game (test).

Not overlaid in v1 (documented TODO): governments / governmentBiases, raceFamilies, name lists, BaconSettings.

## 2. Flags and saved state

- `galaxy.scenario: GalaxyScenario | null` (galaxy.ts "modlayer fields" block, registered in the save CLASSES).
  Holds id, name, the manifest (plain JSON), resolved `flags` / `params`, the resolved placement rules, the yearly
  tick bookkeeping and `state` (a per-scenario bag packages use via `scenarioState(galaxy, key, init)`; values must be
  saveable: plain data, graph objects, or classes the package registers).
- Readers: `scenarioActive(galaxy)`, `scenarioFlag(galaxy, name)` (false when no scenario / unknown flag),
  `scenarioParam(galaxy, name, fallback)`. Every scenario branch in the sim is `if (scenarioFlag(galaxy, 'x'))` so
  the faithful path is untouched.
- Chosen in the wizard → `StartGameOptions.scenario = { id, flags, params }` (optional; absent = None) →
  `CreateGameOptions.scenarioFlags/scenarioParams`, with `gameData.scenario` (the overlay) supplying the manifest.
  createGame builds `galaxy.scenario` only when `gameData.scenario` is set.
- Saves: the galaxy graph carries `scenario`; `startOptions.scenario` names the overlay. Loading re-applies that
  overlay to the base data (sync, from the cached overlay texts) before `deserializeGame`; `deserializeGame` refuses a
  save whose scenario id differs from `gameData.scenario`.

## 3. Wizard

A "Scenario" page between Victory Conditions and Start: "None" (default) plus every entry of
`/assets/scenarios/index.json`, the description of the selected one, a checkbox per flag and a number box per param
(manifest defaults). The Start page summary shows the choice. main.ts loads the overlay and applies it before
`createGame`.

## 4. Hook points (all no-ops unless a scenario asks)

| Hook | Where | Off-path cost |
|---|---|---|
| Yearly scenario tick: handlers registered with `registerScenarioYearly({ id, order, flag?, run })`, run in (order, id) order when the game year advances | end of `galaxyDoTasks`' long block (after CheckVictoryConditions) | `galaxy.scenario === null` check |
| `createEmpireMidGame(galaxy, spec)` (normal empire at a habitat, or a pirate faction at a base): race by name, name, age/tech, government, relation defaults (evaluation bias both ways, optional war / pirate relation), AI on, touch times, standard empire set-up | `src/sim/scenario/empireMidGame.ts`, generalising `generateShakturi` / `generatePirateEmpire` | none (only called by scenarios) |
| Home-system placement: `homePlacement` rule for a race ⇒ capital searched in a radius ring | `createGame`, before `findAiCapital` / the player capital search | `galaxy.scenario !== null` check |
| Resource placement: `resourcePlacement` rule ⇒ the resource only rolls on habitats whose distance-from-centre fraction is inside the ring (the selectResources prevalence rolls; super-luxury / race-critical placements are not filtered) | `Galaxy.selectResources` resource loop | one null check per resource |
| Messages / news: `scenarioMessage(galaxy, empire, title, text, …)`, `scenarioNews(galaxy, source, text, filter?)` | `src/sim/scenario/messages.ts` | none |

Packages register their hooks at module load; each package module is imported from `src/sim/scenario/packages.ts`
(which game.ts imports), so app and tests see the same registrations.

Further hooks (requested by the 19a–19f specs):

| Hook | Where | Notes |
|---|---|---|
| `registerScenarioPeriodic({ id, flag/scenarioId, periodDays, run })` | same long-block call as the yearly tick | game day = YEAR_LENGTH / 360; per-handler bookkeeping `GalaxyScenario.periodicLast` (saved); first open call anchors |
| `registerScenarioGameStart({ …, run(galaxy, { randomPointInRing, inNebula }) })` | last step of createGame | may draw |
| `registerScenarioEvent({ …, event, run })` / `scenarioEmit` | one guarded line per site: `colonyOwnerChanged` (takeOwnershipOfColonyFull end), `colonyFounded` (colonize command), `builtObjectOwnerChanged`, `builtObjectBuilt` (yard completion), `builtObjectRemoved` (teardown top), `habitatBombarded`, `intelMissionCompleted`, `empireEliminated`, `researchCompleted`, `characterCreated`, `abandonedShipClaimed`, `diplomaticRelationChanged` (war / treaties), `disaster` (every disaster NewsNet broadcast), `contractInitiated` (initiateContract end; handlers never draw) | typed payloads in hooks.ts `ScenarioEvents`; 19e-9's always-on freight listener would sit beside the contract site |
| `registerScenarioQuery({ …, query, run })` / `scenarioQuery` | `empireApprovalRating` (taxes.ts) | pure value transforms, never draw; add further queries (e.g. 19f hyperDenyExempt) the same way |
| decisions: `registerScenarioDecision({ kind, resolve, aiChoose })`, `raiseScenarioDecision`, `answerScenarioDecision`, expiry in the long block | `scenario/decisions.ts`; the player's question arrives as a GeneralDecision message whose popup (ui/messagePopups.ts) shows option buttons | state in `scenarioState('decisions')`, saved |
| `createEmpireMidGame` options `adoptOnly` + `adopt: { colonies, builtObjects }` (no GenerateEmpire, capital null until a colony is owned), `preserveHome`, `homeSystemFactor` | empireMidGame.ts | |

`scenarioState` values may be Maps keyed by stable ids (empireId, habitat index, character objects…) holding graph
objects; they round-trip through the save codec (test).

**Rnd policy.** Scenario code draws from `galaxy.rnd` only inside its own hooks: its yearly tick handler, the
generation hooks when its manifest defines a rule, and functions it calls from there (e.g. createEmpireMidGame). It
never draws from the base-game call sites, so with no scenario (or no rule / no handler) the base draw order is
unchanged. A scenario that needs randomness elsewhere (e.g. inside an empire tick branch) must gate it with
`scenarioFlag` so the draw exists only when the flag is on. Radius fractions: distance from the galaxy centre divided
by `sizeX / 2` (the scale `randomPointInRing` uses).

## 5. Example + test harness

- `scenarios/example/`: renames the Human race (file `races/human.txt`, Name "Terran") and adds one GameText line.
- `test/helpers/scenarioGame.ts`: `loadScenarioOverlayFs(id)`, `scenarioGameData(base, overlay)`,
  `createScenarioGame(base, { id | overlay, flags, params, options })` (the standard seed-1 tick game with the
  scenario applied).

## API for scenario packages (`src/sim/scenario/index.ts`)
`scenarioActive`, `scenarioFlag`, `scenarioParam`, `scenarioState`, `registerScenarioYearly`,
`createEmpireMidGame`, `scenarioMessage`, `scenarioNews`, `scenarioText`, `radiusFraction`, plus the data-side
`applyScenarioOverlay` / `parseScenarioManifest` and (UI) `scenario/fetchScenario.ts` loadScenarioIndex /
loadScenarioOverlay. Tests: `test/modlayer.test.ts`.
