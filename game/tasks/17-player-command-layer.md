# 17 — Player command layer (after M4 + 16a-d)

The sim runs the whole game, but the player can only watch: the human empire is fully automated and no
screen issues orders. This phase ports the original's player-side command code. It is UI-side code in
the C# (Main.Part*.cs) but it is *game logic*, so it lives in `src/sim/player/` (no DOM, no Pixi) and is
unit-tested like the rest of the sim; screens only call it. Same rules as `tasks/M4-agent-brief.md`
(statement-for-statement, cite `File.cs:line`, exact `galaxy.rnd` draw order, `TODO(port)` notes) and
`tasks/UI-agent-brief.md` for the screen parts. One Opus agent per package, worktree `~/wt/<id>`,
branch `wip/<id>`, merge main before finishing, do not push.

`$C = $DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded`.

| id | package | C# scope | size | depends on |
|---|---|---|---|---|
| **17a buildorder** | `Empire.BuildNewShips` | `$C/DistantWorlds.Types/Empire.6.cs:3017-3164` BuildNewShips(designs, amounts) and every helper it calls that is not yet in `src/sim` (GenerateBuiltObjectName, FindShortestConstructionWaitQueue variants, AddBuiltObjectToGalaxy, procure components, resource orders, StateMoney + pirate-economy expense — most exist; grep before porting) | ~150 + helpers | — |
| **17b shipactions** | ShipAction model + executor | `$C/DistantWorlds.Types/ShipAction.cs` (class), `ShipActionType.cs` (enum), `$C/DistantWorlds/Main.Part8.cs:1496-1536` method_313/314/315 (ShipAction factories: validity of a mission type for the selected object + target), `$C/DistantWorlds/Main.Part7.cs:234-1854` method_347(ShipAction, bool) — the dispatcher that executes every player order: the `BuiltObjectMissionType` cases (Build / Retire / Retrofit and the generic AssignMission path with priority) and the `ShipActionType` cases (AutomateShip / UnautomateShip, ClearQueuedMissions, CreateNewFleet / JoinShipGroup / LeaveShipGroup / SetAsLeadShipInGroup / DisbandShipGroup / AssignShipGroupHomeColony, SetFleetPosture / SetFleetRange / SetFleetAttackPoint / SetFleetHomeBase, ColonyTaxUp / ColonyTaxDown (1 and 5), RecruitTroops, BuildColonize, BuildPlanetaryFacility, InvestigateRuins / InvestigateBuiltObject, Fighter* (build/launch/retrieve/upgrade), TransferCharacter, GiveBuiltObject, DeployVirus, GeneratePirateMission*) | ~1,700 | — |
| **17c ordermenu** | right-click order menu + selection action buttons | `$C/DistantWorlds/Main.Part8.cs:1537-3260` method_316-344: build the list of ShipActions offered for (selected object, thing under the cursor) — per-target builders for BuiltObject / Habitat / ShipGroup / StellarObject / empty space, the fleet menu (method_343), the selection-panel action buttons (method_344); `Main.Part10.cs:3310-3400` mainView right-click → execute; `Main.Part12.cs:2504` fleet right-click | ~1,800 | 17b |
| **17d policy** | Empire Policy & automation panel | `$C/DistantWorlds.Types/EmpirePolicy.cs` (model; TS: `EmpirePolicy` interface in `src/sim/data/policy.ts`, `Empire.policy`), `$C/DistantWorlds/Main.Part3.cs:3725-4120` method_594 (fill panel from empire), method_595/596 (show/hide), method_597-605 (apply: Control* automation levels, ControlColonyTaxRates, ControlDesigns, ControlMilitaryFleets, ControlResearch, ControlTroopGeneration, the EmpirePolicy numeric/boolean settings, tax); `$C/DistantWorlds/Start*.cs` wizard automation defaults for the *human* player (which Control* fields a new human game starts with; today the player is fully automated because `Empire` ctor sets every Control* to FullyAutomated) | ~600 | — |
| **17e proposals** | outgoing diplomacy | `$C/DistantWorlds/Main.Part2.cs:1935-2400` the conversation path where the player proposes a treaty / declares war / trade sanctions / gift / demands, and the `Empire`/`DiplomaticRelation` methods it calls (`$C/DistantWorlds.Types/Empire.7.cs` EvaluateTreatyProposal etc. — find them); the diplomacy screen (F5, `src/ui/screens/diplomacyScreen.ts`) gets the proposal controls | ~900 | — |
| **17f designeditor** | design editor | `$C/DistantWorlds/Main.Part6.cs:1-700` (new design from template, add/remove component, 226 GetDesignWarningMessages, 164 btnDesignsSaveDesign_Click, size/tech checks, obsolete/auto-upgrade flags), hooked into the Ship Designs screen (F8, 16b) | ~1,200 | 16b merged |

## Common rules for 17a/17b (sim packages)
- New code under `src/sim/player/` (17b) or the existing owner module (17a: `src/sim/construction/empireConstruction.ts`).
- The C# shows message boxes and refreshes panels. Return a result object instead: `{ ok: boolean; message?: string; ... }`
  where `message` is the *same* GameText key/text the original shows (`TextResolver.GetText("…")` → `getText('…')`
  from `src/sim/data/gameText.ts`). No DOM.
- The original mutates `_Game.SelectedObject`, `_Game.PlayerEmpire`, `_Game.Galaxy`. Pass them in: `(galaxy, empire, selected, action)`.
- Every branch that needs a sim function that does not exist yet: implement it if it is small and in the C# nearby,
  otherwise return `{ ok: false }` with a `// TODO(port): <C# method> — <file:line>` and list it in the report.
- Determinism: these functions are only called from player input, so the 600 s digest and every createGame pin must
  stay identical (no new draws on the tick path). Tests call them from a harness game (`test/helpers/tickGame.ts`)
  and assert the visible outcome (mission assigned with the right type/target/priority, fleet created with the ship as
  lead, tax changed and clamped, money charged, ship queued at the shortest-wait yard, `galaxy.rnd` draws consumed
  exactly as the C# does — BuildNewShips draws for the name and AddBuiltObjectToGalaxy).
- New model classes (ShipAction is *not* saved; check `[NonSerialized]`/whether it lives on Galaxy) — if anything is
  persisted, register it in `CLASSES` (`src/sim/save/galaxySave.ts`) and add a round-trip test.
- Gates: `npm run typecheck` 0 errors, full suite exit 0 (`npx vitest run --testTimeout=300000 --maxWorkers=2`).
- Commit: `git -c user.name=dev -c user.email=dev@local commit`, subject `sim: 17x <summary>`, trailers
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01JMNY5RcbJwx2upDy6tuKLr`. Report under 300 words: C# → TS
  functions, TODO(port) list, tests, pins (must be unchanged).

## 17c/17d/17e/17f (screen packages)
Follow `tasks/UI-agent-brief.md`, with one exception: they may *assign* public fields of the player's `Empire` /
`Habitat` (automation levels, policy settings, tax rate) exactly where the C# does, and call `src/sim/player/*`. They
still must not edit `src/sim/**` except to add a missing setter that the C# has, cited.
