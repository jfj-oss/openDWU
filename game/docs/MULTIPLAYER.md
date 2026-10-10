# Multiplayer

Status: **Phase 1 of 5 done (2026-10-10)**, a few small leftovers in §6. Milestone 1 (the audit, the core API, the
clear "a human controls this empire" sim rules), Milestone 2 (the local viewer in the UI, an inbox for every human, the
(a) leftovers, the plumbing) and Milestone 3 (the nine decisions of §4, `createGame` for N humans). Nothing changes for the player: the seed
pins (`npm run repin -- --check`) are unchanged at every commit, one-human saves are byte-identical to before, and every
multiplayer-only rule runs only when the game has more than one human (`isMultiHuman`).

## 1. The plan

**Deterministic lockstep.** Every client runs the full simulation. The clients exchange only the journaled player
commands: `issuePlayerCommand` → the command queue → the command log (`src/sim/player/playerCommands.ts`,
`commandLog.ts`). A command is applied N frames after it is issued, at the same frame boundary on every client.
`stateDigest` (`src/sim/tick/digest.ts`) checksums, compared every few seconds, detect a desync. The host then resyncs
the other clients by sending a save. Host-streamed state (the sim-worker replica protocol, `src/simworker/`) is only a
fallback, for spectators: late-game churn (about 10k objects/s) is too much to stream to players.

The command log already names the empire of each command (`PlayerLogEntry.empire`, an index into
`flatEmpireList`), so the transport needs no new command format.

| Phase | What | Size |
|---|---|---|
| **1** | Refactor "the player" into a *set of human empires* plus *the local viewer*, still with one human. Nothing changes for the player; repin stays at 0. | 1–2 weeks (the biggest) |
| 2 | Hot-seat: two players on one PC (switch the local viewer between turns or with pause). | |
| 3 | LAN lockstep: host/join by IP, a shared clock and pause, desync checks. | |
| 4 | Internet: relay/WebRTC, a lobby and invite codes, reconnects, AI takeover on disconnect. | |
| 5 | Polish: chat, human-to-human diplomacy, multiplayer saves, version/add-on/data checks, joining mid-game. | |

Risks: cross-platform determinism (the same Electron/V8 should hold; test early), hidden single-player assumptions,
and the slowest PC sets the game speed.

## 2. The API (Phase 1)

- **`galaxy.humanEmpires`** / `humanEmpires(galaxy)` (`src/sim/humanEmpires.ts`): the human-controlled empires, the
  primary human first. Until a list is set (every game today) it is `[galaxy.playerEmpire]`, or empty without a player.
  It is a getter over a side table, not a Galaxy field.
- **`isHumanEmpire(galaxy, empire)`**: true when a human controls `empire` (false for null). With one human it is
  exactly `empire === galaxy.playerEmpire` for a non-null empire.
- `setHumanEmpires(galaxy, list)`: for multiplayer setup and for loading a multi-human save. `galaxy.playerEmpire` stays
  the primary human (moved to the front, or added when missing). A list of just the primary human clears the setting.
- **`galaxy.playerEmpire`** stays as the single-human alias, "the primary human" (the host in a network game). The
  ported C# code and the save keep reading as the C# does.
- **`localViewerEmpire(galaxy)`** (`src/localViewer.ts`, main thread only: UI, render, fog, audio): the empire this screen
  shows the game for. Until `setLocalViewerEmpire` is called it is `galaxy.playerEmpire`. Sim code never reads it.
  The fog (`src/render/fog.ts`) already reads it.

**Save format.** A set list is saved as the side table `humanEmpires` (`src/sim/save/galaxySave.ts`), and only when
there is more than the primary human. So a one-human game saves exactly the same text as before (the save-hash pins
hold). Old saves have no table and load as `[playerEmpire]`. A multi-human save loads in the current release: the
release ignores the unknown side-table key, and the game runs with its primary human as the only human. The
sim-worker replica gets the live list (or null) with the other side tables.

## 3. Audit

Counted at `2b2e9ecc` (origin/main before this work): every line of `src/` that matches `\b[pP]layerEmpire\b`, that is
**647 lines** (632 of them name `playerEmpire`; the rest are C# `PlayerEmpire` citations in comments). Names such as
`playerEmpireEncountered` are not in the count; they are covered in §4 and §5.

Categories:

- **a. "Is this empire human-controlled?"** A sim rule that must apply to every human: an AI-only branch ("if not the
  player, the AI decides"), a human-only feature (construction board, fleet auto-refill, custom bombers), or a "the
  human decides" branch (raise a decision or an advisor prompt instead of acting). → `isHumanEmpire`.
- **b. The local viewer.** UI, render, fog and audio, plus a few sim helpers that only build text for the screen.
  → `localViewerEmpire`.
- **c. The message/popup recipient.** "Tell the player": messages, event pop-ups, location hints, voices, battle
  reports, the player's inbox and advisor queue. These must reach *every* human, each in their own inbox.
- **d. Game setup / start only** (createGame, generateEmpire, the game-start tail, the story start).
- **e. Save / serialization / worker plumbing** (and the field itself).
- **f. Needs a design decision** (§4): victory, difficulty, AI bias, the story, targeted galaxy events, "not visible to
  the player", per-player state stored once, and naming/cosmetics.
- **n. Comment only** (C# citations such as `_Game.PlayerEmpire`), no code.

### 3.1 Totals

| Area | a | b | c | d | e | f | n | total |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| sim (core) | 90 | 11 | 43 | 12 | 9 | 115 | 56 | 336 |
| sim/scenario (add-ons) | 60 | 4 | 19 | 1 | 0 | 10 | 0 | 94 |
| sim/story | 6 | 0 | 3 | 5 | 0 | 17 | 2 | 33 |
| simworker | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 3 |
| ui + main.ts | 0 | 91 | 0 | 0 | 0 | 0 | 40 | 131 |
| render | 0 | 43 | 0 | 0 | 0 | 0 | 4 | 47 |
| audio | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 3 |
| **total** | **156** | **152** | **65** | **18** | **12** | **142** | **102** | **647** |

The (f) lines by topic: victory 39, story 33, difficulty 30, per-human state 17, galaxy events 8, naming/cosmetic 8,
hidden-from-the-player 5, AI bias 2.

Related single-player state that is not named `playerEmpire`:

- **The player's inbox and advisor queue** (`src/sim/playerMessages.ts`): the inbox is attached to `galaxy.playerEmpire`
  only (`ensurePlayerInbox`), and `processPlayerMessages` drains only that one. Messages sent to any other empire stay in
  `Empire.messages` for the AI. `Empire.advisorSuggestions` is already per empire. → (c).
- **`galaxy.messageOptions`** (the Game Options pop-up/message settings) is one per galaxy. → per human (c).
- **`Empire.control*` automation settings** and the `discoveryAction*` options are already fields of every empire, so
  they are per human by construction. They are read through the (a) branches above.
- **`Empire.playerEmpire`** is a TS-only flag set at generation (not in the C#). It is read only by Smarter AI and
  Themed Names, next to a `galaxy.playerEmpire` check. → set it for every human, or replace it with `isHumanEmpire` (§4.8).
- **Per-player flags stored once**: `Ruin.playerEmpireEncountered` (18 lines), `BuiltObject.playerEmpireEncounterAction`
  (15), `SystemInfo.playerPotentialColonies` (written, never read), and `EmpireActivity.playerAmountDelivered` /
  `playerIncomeEarned`. → (f) per-human state.
- **`getEmpireSummarySource`** and the other HUD sources (`src/ui/screens/empireSummary.ts`, `hud.ts`) read
  `game.playerEmpire`. → (b).
- **`Game.playerEmpire`** (`src/sim/game.ts`): the C#'s `Game.PlayerEmpire`, used by `main.ts` and the HUD. It becomes the
  local viewer in the UI migration. → (b)/(e).
- **Player commands** already carry their empire (`issuePlayerCommand(galaxy, empire, op, args)`). Only the UI-record
  sender (`setUiRecordSender`, `playerCommands.ts`) picks `galaxy.playerEmpire`. → the local viewer (b). Phase 3 must
  also reject a command whose empire is not the sending client's human empire.

### 3.2 Per file (sim)

**sim (core)**

| File | a | b | c | d | e | f | n |
|---|--:|--:|--:|--:|--:|--:|--:|
| `sim/achievements.ts` |  | 9 | 1 |  |  |  |  |
| `sim/baconScienceShips.ts` |  |  |  |  |  | 2 (events) |  |
| `sim/baconSettings.ts` |  |  |  |  |  | 2 (events) |  |
| `sim/battleReports/battleReports.ts` |  |  | 5 |  |  |  |  |
| `sim/civilianAI.ts` |  |  |  |  |  | 2 (story) |  |
| `sim/colony.ts` |  |  |  |  |  | 1 (cosmetic) |  |
| `sim/colonyTick.ts` | 1 |  | 13 |  |  |  |  |
| `sim/combat/attackAI.ts` | 1 |  |  |  |  |  |  |
| `sim/combat/boarding.ts` | 1 |  |  |  |  |  |  |
| `sim/combat/damage.ts` | 6 |  | 2 |  |  | 11 (cosmetic, story) |  |
| `sim/combat/fighters.ts` | 7 |  | 2 |  |  |  | 2 |
| `sim/combat/ownership.ts` |  |  | 7 |  |  | 5 (perhuman, story) | 1 |
| `sim/combat/teardown.ts` | 1 |  |  |  |  |  |  |
| `sim/combat/threats.ts` |  |  |  |  |  | 1 (aibias) | 1 |
| `sim/construction/empireConstruction.ts` | 2 |  |  |  |  |  |  |
| `sim/construction/statePriority.ts` | 2 |  |  |  |  |  |  |
| `sim/data/policies.ts` |  |  |  |  |  |  | 1 |
| `sim/designGeneration.ts` |  |  |  |  |  | 1 (cosmetic) |  |
| `sim/diplomacyTick.ts` | 11 |  |  |  |  | 6 (difficulty) |  |
| `sim/empire.ts` |  |  |  | 1 |  |  |  |
| `sim/empireAbsorb.ts` |  |  |  |  |  | 1 (story) | 2 |
| `sim/empireEvents.ts` | 3 |  |  |  |  |  |  |
| `sim/empireGeneration.ts` |  |  |  | 1 |  |  |  |
| `sim/espionagePrisoners.ts` | 5 |  | 4 |  |  |  |  |
| `sim/exploration.ts` | 3 | 1 | 2 |  |  | 5 (perhuman, story) | 2 |
| `sim/fleets/militaryAI.ts` | 3 |  |  |  |  | 1 (aibias) |  |
| `sim/fleets/moveTogether.ts` | 1 |  |  |  |  |  |  |
| `sim/forceStructure.ts` |  |  |  |  |  | 2 (difficulty) |  |
| `sim/galaxy.ts` |  |  |  |  | 1 | 10 (cosmetic, perhuman) | 2 |
| `sim/galaxyReports.ts` |  |  | 1 |  |  |  |  |
| `sim/game.ts` |  |  |  | 5 | 1 |  | 2 |
| `sim/gameStartTail.ts` |  |  |  | 4 |  |  | 3 |
| `sim/independentTraders.ts` |  |  |  |  |  | 7 (cosmetic, hidden) | 2 |
| `sim/messageRouting.ts` |  |  |  |  |  |  | 1 |
| `sim/messages.ts` |  |  |  |  |  |  | 1 |
| `sim/missions/cmdAttack.ts` |  |  | 1 |  |  |  |  |
| `sim/missions/cmdDocking.ts` |  |  |  |  |  | 1 (perhuman) |  |
| `sim/missions/cmdExtract.ts` | 4 |  |  |  |  |  |  |
| `sim/missions/cmdTroops.ts` |  |  |  |  |  | 1 (cosmetic) |  |
| `sim/movement.ts` |  |  |  |  |  | 1 (story) |  |
| `sim/pirates.ts` |  |  |  |  |  | 3 (difficulty, events, hidden) | 1 |
| `sim/pirates/missionsMarket.ts` | 1 |  |  |  |  |  |  |
| `sim/pirates/pirateEmpireAI.ts` | 4 |  |  |  |  |  |  |
| `sim/pirates/pirateFleets.ts` | 1 |  |  |  |  |  |  |
| `sim/pirates/pirateGalaxyTick.ts` | 1 |  |  |  |  |  | 2 |
| `sim/pirates/pirateRelationsAI.ts` | 3 |  |  |  |  | 2 (difficulty) |  |
| `sim/pirates/pirateShipMissions.ts` | 1 |  |  |  |  |  |  |
| `sim/player/colonyOrders.ts` |  |  |  |  |  |  | 2 |
| `sim/player/constructionBoard.ts` | 2 |  |  |  |  |  |  |
| `sim/player/conversationReplies.ts` |  |  |  |  |  |  | 1 |
| `sim/player/designLineUpgrade.ts` | 3 |  |  |  |  |  |  |
| `sim/player/designTools.ts` |  |  |  |  |  |  | 1 |
| `sim/player/diplomacyProposals.ts` |  |  |  |  |  |  | 2 |
| `sim/player/empireSettings.ts` |  |  |  |  |  |  | 1 |
| `sim/player/eventPanelActions.ts` |  |  |  |  |  |  | 2 |
| `sim/player/executeShipAction.ts` | 2 |  |  |  |  |  | 3 |
| `sim/player/fleetRefill.ts` | 2 |  |  |  |  |  | 1 |
| `sim/player/hintSubjects.ts` |  |  |  |  | 4 |  |  |
| `sim/player/orderMenu.ts` |  |  |  |  |  |  | 5 |
| `sim/player/playerCommands.ts` |  | 1 |  |  |  |  |  |
| `sim/player/playerOps.ts` | 1 |  |  |  |  |  | 2 |
| `sim/player/playerOrders.ts` |  |  |  |  |  |  | 3 |
| `sim/player/shipHotkeys.ts` |  |  |  |  |  |  | 1 |
| `sim/player/strategicBrief.ts` |  |  | 1 |  |  |  |  |
| `sim/player/tradeNegotiation.ts` | 4 |  | 1 |  |  |  |  |
| `sim/playerMessages.ts` |  |  | 2 |  |  |  | 1 |
| `sim/researchTick.ts` | 2 |  | 1 |  |  |  |  |
| `sim/resourceTargets.ts` | 1 |  |  |  |  |  | 1 |
| `sim/ruins.ts` |  |  |  | 1 |  |  |  |
| `sim/save/gameSave.ts` |  |  |  |  | 3 |  |  |
| `sim/tick/empireTick.ts` | 1 |  |  |  |  |  |  |
| `sim/tick/galaxyTick.ts` |  |  |  |  |  | 5 (perhuman, victory) | 2 |
| `sim/tick/pirateTick.ts` | 2 |  |  |  |  |  |  |
| `sim/tick/scheduler.ts` | 2 |  |  |  |  | 1 (victory) | 1 |
| `sim/tradeItems.ts` | 5 |  |  |  |  | 16 (difficulty) |  |
| `sim/treasury.ts` | 1 |  |  |  |  |  |  |
| `sim/troops.ts` |  |  |  |  |  | 3 (difficulty) |  |
| `sim/victory.ts` |  |  |  |  |  | 25 (victory) | 4 |

**sim/scenario (add-ons)**

| File | a | b | c | d | e | f | n |
|---|--:|--:|--:|--:|--:|--:|--:|
| `sim/scenario/charteredCompanies/charters.ts` | 3 |  |  |  |  |  |  |
| `sim/scenario/court/court.ts` | 1 |  | 1 |  |  |  |  |
| `sim/scenario/court/intrigue.ts` | 3 |  | 1 |  |  |  |  |
| `sim/scenario/decisions.ts` | 1 |  |  |  |  |  |  |
| `sim/scenario/emergent/council.ts` | 13 |  |  |  |  |  |  |
| `sim/scenario/emergent/crises.ts` | 3 |  |  |  |  |  |  |
| `sim/scenario/emergent/demographics.ts` | 3 |  |  |  |  |  |  |
| `sim/scenario/emergent/espionage.ts` | 8 |  | 1 |  |  |  |  |
| `sim/scenario/emergent/politics.ts` |  |  | 2 |  |  |  |  |
| `sim/scenario/emergent/politicsActions.ts` |  |  | 4 |  |  |  |  |
| `sim/scenario/empireMidGame.ts` |  |  |  | 1 |  |  |  |
| `sim/scenario/frontier/frontier.ts` | 2 |  | 1 |  |  |  |  |
| `sim/scenario/lively/livelyGalaxy.ts` | 1 |  |  |  |  |  |  |
| `sim/scenario/lively/livingCalendar.ts` | 1 |  |  |  |  |  |  |
| `sim/scenario/lively/peaceTerms.ts` | 3 |  |  |  |  |  |  |
| `sim/scenario/lively/warGoals.ts` | 1 |  |  |  |  |  |  |
| `sim/scenario/llm/parity.ts` |  | 4 |  |  |  |  |  |
| `sim/scenario/llm/strategic.ts` | 1 |  |  |  |  |  |  |
| `sim/scenario/llm/voiceCues.ts` |  |  | 4 |  |  |  |  |
| `sim/scenario/rimDistressCalls.ts` |  |  |  |  |  | 1 (events) |  |
| `sim/scenario/rimHerders/rimHerders.ts` | 1 |  | 1 |  |  |  |  |
| `sim/scenario/rimTrade/common.ts` | 1 |  |  |  |  |  |  |
| `sim/scenario/rimTrade/rimTrader.ts` | 2 |  | 1 |  |  |  |  |
| `sim/scenario/rimTrade/treasureFleet.ts` |  |  | 1 |  |  |  |  |
| `sim/scenario/security/security.ts` | 1 |  | 1 |  |  |  |  |
| `sim/scenario/smarterAI/common.ts` | 2 |  |  |  |  |  |  |
| `sim/scenario/smarterAI/diplomacy.ts` | 1 |  |  |  |  |  |  |
| `sim/scenario/themedNames/themedNames.ts` | 2 |  |  |  |  |  |  |
| `sim/scenario/threats/corporateCoup.ts` | 1 |  |  |  |  |  |  |
| `sim/scenario/threats/cult.ts` |  |  |  |  |  | 1 (victory) |  |
| `sim/scenario/threats/darkFarms.ts` | 1 |  |  |  |  | 1 (victory) |  |
| `sim/scenario/threats/doppelgangers.ts` |  |  |  |  |  | 1 (victory) |  |
| `sim/scenario/threats/exchange.ts` | 2 |  |  |  |  |  |  |
| `sim/scenario/threats/greyTide.ts` |  |  |  |  |  | 1 (victory) |  |
| `sim/scenario/threats/hive.ts` |  |  |  |  |  | 1 (victory) |  |
| `sim/scenario/threats/robotMutiny.ts` |  |  |  |  |  | 2 (victory) |  |
| `sim/scenario/threats/silence.ts` |  |  |  |  |  | 1 (victory) |  |
| `sim/scenario/threats/timeBomb.ts` | 2 |  |  |  |  | 1 (victory) |  |
| `sim/scenario/wreckage/wreckage.ts` |  |  | 1 |  |  |  |  |

**sim/story**

| File | a | b | c | d | e | f | n |
|---|--:|--:|--:|--:|--:|--:|--:|
| `sim/story/eventActions.ts` | 2 |  | 3 |  |  | 2 (events) | 2 |
| `sim/story/freedomAlliance.ts` |  |  |  |  |  | 1 (story) |  |
| `sim/story/storyEvents.ts` | 4 |  |  |  |  | 14 (story) |  |
| `sim/story/storyStart.ts` |  |  |  | 5 |  |  |  |


The (f) cell names the §4 topics: victory, difficulty, aibias, story, events, hidden, perhuman, cosmetic.

### 3.3 UI, render, audio

Every code line here is (b), the local viewer (the (n) lines are comments): `main.ts` 27, `ui/hud.ts` 26,
`render/overlayLayer.ts` 14, `render/mainView.ts` 11, `ui/screens/empiresList.ts` 5, `ui/screens/tradeFlows.ts` 5,
`ui/systemView.ts` 4, 3 each in `ui/screens/empireComparison.ts`, `ui/screens/galaxyMap.ts`, `ui/screens/resourceSupply.ts`,
`render/galaxyMarkers.ts` and `render/locationMarkers.ts`, 2 each in `ui/leftSidebarView.ts`, `ui/screens/constructionYards.ts`,
`ui/screens/gameSummary.ts` and `ui/supplyChainCache.ts`, and 1 each in 20 more files (`render/fog.ts` is already migrated).
`main.ts` also wires the player's message streams, pop-ups, event messages and battle-report notifier to
`game.playerEmpire`; these become the local viewer's, fed by that human's inbox (§6, item 2).

## 4. Decisions

**Decided 2026-10-10:** the user accepted all nine recommendations as written ("your decisions, continue"). Each item
gives what the code does today and the decision. Every multiplayer rule below runs only when the game has more than one
human, so a one-human game stays exactly as it is.

1. **Victory and the end of the game** (39 lines: `src/sim/victory.ts`, the `playerEmpire` argument of
   `galaxyDoTasks` in `tick/galaxyTick.ts` / `tick/scheduler.ts`, and the threat add-ons' "contained" victories in
   `scenario/threats/*`). Today the victory conditions are checked for one player, and `onGameEnd` ends the game with
   that player's Victory or Defeat.
   **Decided:** check each human's victory conditions. The first human to meet them wins, and the game ends for
   everyone (Victory for the winner, Defeat for the other humans). A human whose empire is destroyed is defeated and
   watches as a spectator while the others play on. A global threat that is contained (Hive, Grey Tide, Cult,
   Doppelgangers, Time Bomb, Robot Mutiny, Dark Farms) is a shared Victory for every surviving human. The Silence keeps
   its rule: the empire that shut it down wins.
2. **Difficulty** (30 lines: `tradeItems.ts`, `diplomacyTick.ts`, `troops.ts`, `forceStructure.ts`,
   `pirates/pirateRelationsAI.ts`, and `setEmpireDifficultyFactors` in `pirates.ts`). Today `galaxy.difficultyLevel` is
   one wizard setting. The player's own `empire.difficultyLevel` (galaxy level + modifier, raised as the player nears
   victory) scales trade, diplomacy and research values in the AI's dealings with the player. AI empires get troop and
   force bonuses when the level is above 1.
   **Decided:** one shared difficulty per game (a lobby setting). Apply the player rules to every human through
   that human's own `empire.difficultyLevel`. The code then reads naturally: `if (isHumanEmpire(galaxy, x)) value *=
   x.difficultyLevel ** 2`. The "scales as the player approaches victory" rule runs per human. A per-human handicap can
   come later (Phase 5).
3. **AI bias against the player** (2 lines: `fleets/militaryAI.ts` 424 doubles the attack priority of the player's empire;
   `combat/threats.ts` 1090 makes a defensive base weigh the player's troop ships ×100).
   **Decided:** apply both to every human. The AI treats all humans as "the player".
4. **The story** (33 lines: `story/storyEvents.ts`, `story/freedomAlliance.ts`, `empireAbsorb.ts` (Guardians depart),
   `combat/damage.ts` (fearful pirate faction joins the player), the story clues in `exploration.ts`, `civilianAI.ts`,
   `movement.ts` and `combat/ownership.ts`). The Distant Worlds, Return of the Shakturi and Shadows storylines are
   written for exactly one protagonist: clues, rewards, the Freedom Alliance and the Mechanoid absorption all go to "the
   player".
   **Decided:** turn the storylines off in multiplayer (the wizard greys them out when there is more than one
   human) and revisit in Phase 5. The alternatives are the primary human as the only protagonist, which is unfair to the
   others, or a clue track per human, which is a large redesign.
5. **Galaxy events that target "the player"** (8 lines): super pirates appear near the player's colonies (`pirates.ts`
   1066), rim distress calls (`scenario/rimDistressCalls.ts`), and the Bacon scheduled events (stats saving, science
   ships) that use the player as their trigger empire (`baconSettings.ts`, `baconScienceShips.ts`, `story/eventActions.ts`).
   **Decided:** a targeted event picks one human with `galaxy.rnd` (deterministic, so the same on every client). In
   a one-human game there is no draw, so the random sequence does not change. The Bacon scheduled events keep the
   primary human as their trigger.
6. **"Not visible to the player"** (5 lines: `pirates.ts` 1034 spawns out of the player's sight;
   `independentTraders.ts` retires and spawns traders the player cannot see).
   **Decided:** "not visible to any human".
7. **Per-player state that is stored once** (17 lines): `Ruin.playerEmpireEncountered`,
   `BuiltObject.playerEmpireEncounterAction` (the abandoned-ship prompt), `SystemInfo.playerPotentialColonies`
   (`Galaxy.updateSystemInfo(playerEmpire)`, written every galaxy tick and never read), the smuggling report counters
   `EmpireActivity.playerAmountDelivered` / `playerIncomeEarned`, and `galaxy.messageOptions`.
   **Decided:** keep a per-human copy of each, for example a map keyed by empire id, written only when there is more
   than one human, so one-human saves stay byte-identical. Drop `playerPotentialColonies`, or compute it for the local
   viewer on the main thread.
8. **Naming and cosmetics** (8 lines, plus the `Empire.playerEmpire` flag). The wizard's colony-name list
   (`galaxy.colonyNames`, used by `colony.ts` and `missions/cmdTroops.ts`) and design-name set (`galaxy.ts` 1321) apply to
   the player only. AI designs and independent freighters avoid the player's race pictures (`designGeneration.ts`,
   `independentTraders.ts`). A destroyed ship's saved cargo is owned by the player (a C# quirk in `combat/damage.ts` 820).
   **Decided:** each human gets their own name lists from the lobby; until then only the primary human uses them.
   "Avoid the player's race" stays with the primary human, which keeps the C# random sequence. Leave the cargo quirk as
   ported. Replace the `Empire.playerEmpire` flag with `isHumanEmpire`.
9. **Human-to-human diplomacy** (not a line count; it follows from the (a) migration). The AI never answers for a human
   now, so a proposal from one human to another waits in the recipient's inbox.
   **Decided:** Phase 1 only guarantees that the AI never decides for a human. The human-to-human treaty and trade
   screens come in Phase 5, as planned.

## 5. Milestone 1: what is done

Commits on `wip/mp-phase1`, each with a clean typecheck and `npm run repin -- --check` = 0:

1. **The API** (`src/sim/humanEmpires.ts`, the `Galaxy.humanEmpires` getter, the `humanEmpires` save side table,
   `src/localViewer.ts`, the fog on the local viewer).
2. **Core sim (a) rules**: diplomacy responses, trade, research, treasury, construction and retrofit, military AI,
   empire events, the empire and pirate ticks, teardown, boarding, prisoners and extraction. The fleet warnings
   (`tick/scheduler.ts`) and the asteroid resource-known reset (`missions/cmdExtract.ts`) loop over the human empires.
3. **Pirate, combat and player-feature rules**: pirate AI and raids, pirate-base bonuses, carrier fighter mixes and
   custom bombers, and the human-only features (the construction board, fleet auto-refill, design-line upgrade,
   state-priority shipyards, move-together fleets, trade negotiation). The board and auto-refill processors run for
   every human.
4. **Add-on (a) rules**: council, espionage, crises, charters, court and intrigue, demographics, frontier, security,
   the lively galaxy, rim trade and herders, threats, and Smarter AI. The leave-the-council decision is raised for, and
   resolved by, the empire it names.
5. **Story (a) rules**: the Shadows story's answering empires, the "only the player can trigger" game events, and
   government adoption.

**143 of the 156 (a) lines are migrated.** These 13 are left (line numbers as of `2b2e9ecc`), because each needs a
small rewrite rather than a one-line swap:

- `scenario/emergent/council.ts` 638, 677: a motion holds one vote decision (`Motion.decisionId`); several humans
  need one decision each, and the tally must wait for all of them.
- `scenario/threats/exchange.ts` 791: the intel offer goes to one player; it should loop over the humans.
- `espionagePrisoners.ts` 285, 290, 332 (Bacon prisoners): this code assumes every spy in an AI prison belongs to the
  player. It should use the spy's own empire.
- `exploration.ts` 1177 and `pirates/pirateEmpireAI.ts` 69: `findNearestPirateFaction(…, exclude)` takes one empire to
  exclude. It should exclude every human.
- `combat/damage.ts` 1814–1823 (`determineScrapDamagedShip`): compares `pirateEmpireId` with the player's id. It should
  check every human.
- `scenario/smarterAI/common.ts` 68 and `scenario/themedNames/themedNames.ts` 56: the `Empire.playerEmpire` flag (§4.8).

## 5b. Milestone 2: what is done

1. **The local viewer in the UI.** Every main-thread read of `galaxy.playerEmpire` / `game.playerEmpire` (HUD, left
   sidebar, screens, main view and overlays, markers, audio, `main.ts`) asks `localViewerEmpire`.
2. **An inbox for every human** (`src/sim/playerMessages.ts`). `ensurePlayerInbox` attaches one to each human empire;
   the drains handle them in `humanEmpires` order, again until all are empty (with one human: that inbox, drained once,
   as before); the advisor-queue expiry runs per human. Each handled note names its empire: the in-thread stream
   (`ui/messagePipeline.ts`) and the worker (`simworker/simHost.ts`) pass on only the local viewer's.
3. **"Tell the player" reaches every human involved**: location hints, race periodic changes, prisoner escapes and
   ransoms (Bacon prisoners now follow the spy's owner), stolen-tech warnings, the add-ons' messages and voices.
4. **The (a) leftovers**: council motions raise a vote for every human member and are tallied once all voted; the
   Exchange offers intelligence to each human; `findNearestPirateFaction(…, excludeHumans)` skips every human faction;
   the scrap check covers every human; the `Empire.playerEmpire` flag is no longer read (the field stays, saves carry it).
5. **Plumbing**: in a multi-human game a command for a non-human empire is rejected before the journal (the LLM layer's
   `llmStrategic` / `storeChronicleYear` excepted). `npm run check:player-empire` (`scripts/check-player-empire.mjs`)
   fails when a `src/sim` file gains `playerEmpire` code lines beyond `scripts/player-empire-allowlist.json`; after a
   migration, `-- --update` shrinks the list.

Left from the Milestone 2 list, on purpose:

- **Battle reports** (`sim/battleReports/battleReports.ts`) watch one player's battles and split the sides into that
  player's camp and its enemies. Per-human reports need the camps per viewer; this goes with the per-human state of
  Milestone 3.
- **The UI-record sender** (`playerCommands.ts`, the lookups' journaled `obtainUiRecords`) still names the primary human:
  the sim cannot read the local viewer. Phase 3 passes the sending client's human with the command.

## 5c. Milestone 3: what is done

The nine decisions of §4 and `createGame` for N humans. Every rule here runs only with more than one human
(`isMultiHuman`) or is the one-human rule written for every human (identical with one): repin stays at 0.

1. **`createGame` takes N humans.** `CreateGameOptions.humanPlayers` (from `StartGameOptions.humanPlayers` through
   `humanPlayerEmpireStarts`, in `toCreateGameOptions`): the extra humans are founded after the AI empires, then
   `setHumanEmpires(galaxy, [player, ...them])`, with the player's difficulty factors, the wizard row's flag colours, and
   the Game Options automation and design-upgrade start settings.
2. **Victory per human** (`victory.ts` `checkVictoryConditionsHumans`, `humansGameEnd`, `humanDefeated`,
   `threatsContainedGameEnd`): the time limit, the global conditions and each human's own conditions — the first human
   to win ends the game for everyone; a wiped-out human is defeated and watches, and the game ends when no human is
   left; a contained global threat (`threatGameEnd(…, shared)`) is a shared Victory for the humans still playing; the
   Silence goes to the empire that shut it down. Each human's outcome is per-human state; the game-end panel shows the
   local viewer's (`presentGameEnd`).
3. **One difficulty for every human**: `setEmpireDifficultyFactors` and every "the player" difficulty scaling (trade,
   diplomacy, troops, force structure, pirate relations) apply to each human through its own `difficultyLevel`.
4. **AI bias for every human**: the ×2 attack priority and the defensive bases' troop-ship weight.
5. **Storylines off**: `createGame` turns the three storylines (and the victory conditions' story flags) off with extra
   humans; the wizard greys the boxes out and lists none in the summary. The story code keeps reading the primary human.
6. **Targeted events** (`targetHuman`): the super-pirate event and the rim distress calls pick a human with
   `galaxy.rnd` — only with more than one human, so a one-human game draws nothing new.
7. **"Not visible to any human"** (`systemVisibleToAnyHuman`, `isObjectVisibleToAnyHuman`): the pirate spawn search and
   the independent traders' spawn / retire checks.
8. **Per-human state** (`src/sim/perHumanState.ts`): ruin encounters, the abandoned-ship encounter actions, the Game
   Options message settings (`setMessageOptions` stores the issuing human's), unlocked achievements, the smuggling-report
   counters, the location-hint subjects, the colony-name lists and the game outcomes. The primary keeps the C# fields;
   the other humans' copies are the save side table `perHuman`, written only when something is in it.
9. **Name lists**: an extra human's start options may carry its own colony-name list (the wizard has no field for it
   yet: Phase 2's hot-seat rows).
10. **The AI never decides for a human**: the (a) migration of Milestones 1 and 2 (every AI-only branch asks
    `isHumanEmpire`), and the command check of §5b.

A scratch two-human run (not committed: the user does not want tests written) built the same game twice with
`humanPlayers`, ran 200 game seconds on each with equal `stateDigest`s, had the AI empire's command rejected and the
second human's applied, saved (with the `humanEmpires` and `perHuman` side tables), loaded twice and ran on with equal
digests; a one-human save carried neither key.

## 6. The rest of Phase 1

Phase 1 is functionally done. Left, small:

- **Battle reports** watch one player's battles (the camps are that player's); per-human camps for the other humans.
- **Hint subjects in worker mode**: the replica gets the primary human's live table only; a non-primary viewer sees no
  subject text for its hints until the worker sends every human's.
- **Main-thread odds and ends on the first human**: the AI advisor driver, the LLM layer, the founding line and the
  starting camera; an event pop-up for a human whose turn it is not is not shown (it is still in that human's history);
  the SystemInfo "potential colonies" flag (written for the primary, never read).
- **`scripts/player-empire-allowlist.json`** holds the remaining sim `playerEmpire` reads (176 lines in 49 files): the
  story (single-protagonist by decision), the C# start code, the save, and the primary-human aliases above.

Phases 2–5 as planned (§1); the hot-seat UI of Phase 2 is §7.

## 7. Phase 2 (hot seat): the UI-side pieces

Built on branch `wip/mp-hotseat`, alongside the rest of Phase 1. Single-player is unchanged: no key is written
for one human, and `npm run repin -- --check` = 0.

### 7.1 What is built

- **The wizard.** The Other Empires page has a "Human Players..." button. It opens a panel over the manual empire
  list (`src/ui/screens/hotSeatPlayersPanel.ts`) with one row per *extra* human. Each row has an empire name, the race
  and government combos of the manual AI rows (the government list follows the race the same way:
  `startGovernmentsForRace`), and the main and secondary flag colours. A line on the page and a Start-page summary row
  show the count. The rows are stored as `StartGameOptions.humanPlayers`. The key is deleted when the last row is
  removed, so a single-player start saves exactly the same text as before.
- **The switch** (`src/ui/hotSeat.ts`, installed in `main.ts` `startGameView`):
  - a "Switch Player" button in the top-left strip, right of Play/Pause. It shows only while
    `humanEmpires(galaxy).length > 1`;
  - the hotkey **Ctrl+Shift+H**. It is a capture-phase listener, not a row in the key-binding table;
  - a full-screen curtain, "Player N — click to continue", with the empire name and colour. The curtain goes up
    before the viewer changes. The game is paused while it is up, and goes back to its own pause state when the curtain
    is clicked (or Enter/Space). Every key is swallowed while the curtain is up.
  - The viewer moves with the new `switchLocalViewerEmpire(galaxy, empire)` (`src/localViewer.ts`), which calls
    `setLocalViewerEmpire` and then the new `onLocalViewerChange` listeners. A screen that caches anything for the
    viewer should subscribe to those listeners. `main.ts` clears the selection and centres the camera on the new
    viewer's capital.
  - A new hot-seat game opens on player 1's curtain.
  - The dev hook `?hotSeatDev=1` (in-thread sim only) makes the first AI empire a second human, for trying the switch
    before createGame takes N humans.
- **Saves.** `GameSaveJSON.localViewer` is whose turn it is: an index into `galaxy.humanEmpires`. It is written only
  when the game has more than one human. It sits just before `customizationSet`, so `savedLocalViewer(tail)` reads it
  from the save's tail.
  - The value is main-thread state. It travels as `GameSaveExtras` through `serializeGame` / `serializeGameParts` /
    `serializeGameBlob`, and in worker mode through `SimWorkerClient.save(timeout, extras)` → `SaveRequest.extras` →
    `SimHost.saveBlob(extras)`.
  - On load, `loadSaveWithProgress` hands the tail to `rememberSavedLocalViewer`. `installHotSeat` then switches to that
    human and shows their curtain.
  - The fatal-error rescue save (`rescueSaveBlob`) and the replica fallback save carry no viewer. They load on player 1.

### 7.2 Hand-off to Phase 1: `createGame` with N humans

Not wired: `toCreateGameOptions` does not read `humanPlayers` yet. The field shape it should consume
(`src/sim/humanPlayerStarts.ts`):

```ts
// StartGameOptions.humanPlayers?: HumanPlayerStart[]  — the EXTRA humans (players 2..N), in player order.
// Player 1 is the start's own race / empire (raceName, empireName, governmentId, colours), as today.
// Absent (never []) = one human.
interface HumanPlayerStart {
    name: string;          // empire name; '' = the "<Race> Empire" default (as ManualEmpireStart.name)
    race: string;          // race name; '' = (Random)
    governmentId: number;  // governments.txt id; -1 = (Random)
    primaryColor: string;  // '#rrggbb'
    secondaryColor: string;
}
// At most HOT_SEAT_EXTRA_HUMANS_MAX (7) rows.
```

`humanPlayerEmpireStarts(humans, gameData, player)` already turns the rows into `EmpireStartOptions[]`. Each extra
human starts like player 1: the same age, tech level, home-system quality, corruption and flag shape, a `(Random)`
start location, and its own race, government, name and colours. So in `toCreateGameOptions` (custom path; the Jump
Start / Introductory paths have no rows):

```ts
const humans = humanPlayerEmpireStarts(o.humanPlayers ?? [], gameData, player);
// → CreateGameOptions (e.g. `humanPlayers: humans`). createGame places them like the player, then
//   setHumanEmpires(galaxy, [playerEmpire, ...their empires]) in the same order (the hot-seat index is into that list).
```

The wizard does not grey out the storylines for more than one human yet (decision §4.4). Do that together with the
createGame change, so the rule lives in one place.

### 7.3 Screens that still read `playerEmpire` (do not follow the switch yet)

**Status (Phase 1 Milestone 2, §5b): done.** Every screen, layer and sound below reads `localViewerEmpire` when it
draws. In `main.ts`, the order UI, the ship and control-group keys, the waypoints, Trade Flows, the ticker and the UI
lookups' records (`setUiRecordEmpire`) read the viewer at call time; the per-viewer message UI (popups, advisor
suggestions, stubs, battle-report notices, the event recipient) is installed again for the new viewer on
`onLocalViewerChange`; every human has a message stream (in-thread and worker); the design-line / state-priority
switches apply to every human. Still on player 1: the AI advisor driver and the LLM layer (`startAiAdvisorDriver` /
`startLlmLayer`), the founding line and the starting camera; an event pop-up for a human whose turn it is not is not
shown (the sim still records it in that human's history). The list below is the state before that work.

Phase 1 item 1 (§6) migrates these. Today the switch changes the fog (`render/fog.ts`, the only `localViewerEmpire`
reader), the camera and the selection. Everything below still shows player 1:

- **`main.ts`: values captured once at boot from `game.playerEmpire`.** These need a viewer accessor or a re-install on
  `onLocalViewerChange`:
  - the message stream (`installLocalMessageStream`, `installWorkerMessageUi`), `installMessagePopups`,
    `installMessageStubList`, `installAdvisorSuggestions` (+ its build-order opener), the ticker poll
    (`messageFeed.pollMessages(game.playerEmpire)`) and `savedHistoryLines`;
  - `tradeFlowsOpts.playerEmpire`, the supply snapshot (`galaxy.playerEmpire`), `startAiAdvisorDriver` /
    `startLlmLayer` (`player:`), and `setThemeChromeRace` (the chrome race);
  - the founding message and the camera start.
- **HUD:** `ui/hud.ts` (27 lines: money panel, top-bar buttons, selection panel, sources via `game.playerEmpire`),
  `ui/leftSidebarView.ts`, `ui/systemView.ts`, `ui/supplyChainCache.ts`, `ui/overlayOptionPanels.ts`,
  `ui/waypoints.ts`.
- **Screens:** `ui/screens/empiresList.ts`, `tradeFlows.ts`, `resourceSupply.ts`, `galaxyMap.ts`,
  `empireComparison.ts`, `gameSummary.ts`, `empirePolicy.ts`, `constructionYards.ts`, `tradePanel.ts`,
  `ruinDetail.ts`, `groundReport.ts`, `gameEndPanel.ts`.
- **Render:** `render/overlayLayer.ts` (14), `render/mainView.ts` (11), `locationMarkers.ts`, `galaxyMarkers.ts`,
  `systemLinks.ts`, `supplyOverlay.ts`, `resourceOverlay.ts`, `fuelOverlay.ts`, `freightOverlay.ts`,
  `colonyScoreOverlay.ts`, `creatureLayer.ts`, `faunaGallery.ts`, `whalePilotLayer.ts`, `rimAtmosphereLayer.ts`,
  `artBundleLayer.ts`.
- **Audio:** `audio/gameAudio.ts`, `mainViewSounds.ts`, `rimCreatureAudio.ts`.
- **Commands:** the UI-record sender (`setUiRecordSender`) still issues every order as `galaxy.playerEmpire` (§6
  item 5). Until it reads the local viewer, player 2's orders act on player 1's empire.
