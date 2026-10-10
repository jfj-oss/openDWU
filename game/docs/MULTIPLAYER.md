# Multiplayer

Status: **Phase 1 of 5 started (2026-10-10).** Milestone 1 is done: the audit below, the core API, and the migration
of the clear "a human controls this empire" sim rules. Nothing changes for the player: the seed pins
(`npm run repin -- --check`) are unchanged at every commit, and one-human saves are byte-identical to before.

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

Risks: cross-platform determinism (checked, see §9: it holds once Math.pow is replaced), hidden single-player
assumptions, and the slowest PC sets the game speed.

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

## 4. Decisions needed

Each item: what the code does today, the options, and the recommendation. The code for these items is **not**
migrated yet; it waits for the answers.

1. **Victory and the end of the game** (39 lines: `src/sim/victory.ts`, the `playerEmpire` argument of
   `galaxyDoTasks` in `tick/galaxyTick.ts` / `tick/scheduler.ts`, and the threat add-ons' "contained" victories in
   `scenario/threats/*`). Today the victory conditions are checked for one player, and `onGameEnd` ends the game with
   that player's Victory or Defeat.
   **Recommended:** check each human's victory conditions. The first human to meet them wins, and the game ends for
   everyone (Victory for the winner, Defeat for the other humans). A human whose empire is destroyed is defeated and
   watches as a spectator while the others play on. A global threat that is contained (Hive, Grey Tide, Cult,
   Doppelgangers, Time Bomb, Robot Mutiny, Dark Farms) is a shared Victory for every surviving human. The Silence keeps
   its rule: the empire that shut it down wins.
2. **Difficulty** (30 lines: `tradeItems.ts`, `diplomacyTick.ts`, `troops.ts`, `forceStructure.ts`,
   `pirates/pirateRelationsAI.ts`, and `setEmpireDifficultyFactors` in `pirates.ts`). Today `galaxy.difficultyLevel` is
   one wizard setting. The player's own `empire.difficultyLevel` (galaxy level + modifier, raised as the player nears
   victory) scales trade, diplomacy and research values in the AI's dealings with the player. AI empires get troop and
   force bonuses when the level is above 1.
   **Recommended:** one shared difficulty per game (a lobby setting). Apply the player rules to every human through
   that human's own `empire.difficultyLevel`. The code then reads naturally: `if (isHumanEmpire(galaxy, x)) value *=
   x.difficultyLevel ** 2`. The "scales as the player approaches victory" rule runs per human. A per-human handicap can
   come later (Phase 5).
3. **AI bias against the player** (2 lines: `fleets/militaryAI.ts` 424 doubles the attack priority of the player's empire;
   `combat/threats.ts` 1090 makes a defensive base weigh the player's troop ships ×100).
   **Recommended:** apply both to every human. The AI treats all humans as "the player".
4. **The story** (33 lines: `story/storyEvents.ts`, `story/freedomAlliance.ts`, `empireAbsorb.ts` (Guardians depart),
   `combat/damage.ts` (fearful pirate faction joins the player), the story clues in `exploration.ts`, `civilianAI.ts`,
   `movement.ts` and `combat/ownership.ts`). The Distant Worlds, Return of the Shakturi and Shadows storylines are
   written for exactly one protagonist: clues, rewards, the Freedom Alliance and the Mechanoid absorption all go to "the
   player".
   **Recommended:** turn the storylines off in multiplayer (the wizard greys them out when there is more than one
   human) and revisit in Phase 5. The alternatives are the primary human as the only protagonist, which is unfair to the
   others, or a clue track per human, which is a large redesign.
5. **Galaxy events that target "the player"** (8 lines): super pirates appear near the player's colonies (`pirates.ts`
   1066), rim distress calls (`scenario/rimDistressCalls.ts`), and the Bacon scheduled events (stats saving, science
   ships) that use the player as their trigger empire (`baconSettings.ts`, `baconScienceShips.ts`, `story/eventActions.ts`).
   **Recommended:** a targeted event picks one human with `galaxy.rnd` (deterministic, so the same on every client). In
   a one-human game there is no draw, so the random sequence does not change. The Bacon scheduled events keep the
   primary human as their trigger.
6. **"Not visible to the player"** (5 lines: `pirates.ts` 1034 spawns out of the player's sight;
   `independentTraders.ts` retires and spawns traders the player cannot see).
   **Recommended:** "not visible to any human".
7. **Per-player state that is stored once** (17 lines): `Ruin.playerEmpireEncountered`,
   `BuiltObject.playerEmpireEncounterAction` (the abandoned-ship prompt), `SystemInfo.playerPotentialColonies`
   (`Galaxy.updateSystemInfo(playerEmpire)`, written every galaxy tick and never read), the smuggling report counters
   `EmpireActivity.playerAmountDelivered` / `playerIncomeEarned`, and `galaxy.messageOptions`.
   **Recommended:** keep a per-human copy of each, for example a map keyed by empire id, written only when there is more
   than one human, so one-human saves stay byte-identical. Drop `playerPotentialColonies`, or compute it for the local
   viewer on the main thread.
8. **Naming and cosmetics** (8 lines, plus the `Empire.playerEmpire` flag). The wizard's colony-name list
   (`galaxy.colonyNames`, used by `colony.ts` and `missions/cmdTroops.ts`) and design-name set (`galaxy.ts` 1321) apply to
   the player only. AI designs and independent freighters avoid the player's race pictures (`designGeneration.ts`,
   `independentTraders.ts`). A destroyed ship's saved cargo is owned by the player (a C# quirk in `combat/damage.ts` 820).
   **Recommended:** each human gets their own name lists from the lobby; until then only the primary human uses them.
   "Avoid the player's race" stays with the primary human, which keeps the C# random sequence. Leave the cargo quirk as
   ported. Replace the `Empire.playerEmpire` flag with `isHumanEmpire`.
9. **Human-to-human diplomacy** (not a line count; it follows from the (a) migration). The AI never answers for a human
   now, so a proposal from one human to another waits in the recipient's inbox.
   **Recommended:** Phase 1 only guarantees that the AI never decides for a human. The human-to-human treaty and trade
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

## 6. The rest of Phase 1 (estimate)

| # | Work | Estimate |
|---|---|---|
| 1 | **(b) UI, render, audio** (~150 lines in ~60 files): `localViewerEmpire(galaxy)`, or a viewer passed down, in place of `galaxy.playerEmpire` / `game.playerEmpire`. Includes the HUD sources and `Game.playerEmpire` in `main.ts`. Mechanical. | 1.5 days |
| 2 | **(c) Messages per human** (65 lines): an inbox on every human (`ensurePlayerInbox` / `processPlayerMessages` over `humanEmpires`, in a fixed order); `galaxy.messageOptions` per human; the "tell the player" sends, location hints and hint subjects, voices and battle reports to every human; the UI streams filtered by the local viewer, in-thread and in the worker. | 2 days |
| 3 | **The 13 (a) leftovers** (§5). | 0.5–1 day |
| 4 | **The (f) items, once decided** (142 lines): victory per human (the largest), difficulty, story off in multiplayer, targeted events and "visible to any human", per-human state, names. | 3–4 days |
| 5 | **Plumbing**: the UI-record sender on the local viewer; reject commands for an empire that is not human; drop the `Empire.playerEmpire` flag; a check script that fails on a new `galaxy.playerEmpire` in `src/sim` outside an allow-list. | 0.5 day |
| 6 | **(d) setup for N humans** (`createGame` taking a list of human starts; the wizard UI itself is Phase 2). | 0.5–1 day |

**Total: about 8–10 working days** after Milestone 1 (which took about 1 day). This matches the plan's 1–2 weeks for
Phase 1. Items 1–3 and 5 do not depend on the §4 answers and can start now; item 4 waits for them.

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

## 8. Lockstep core (built ahead for Phase 3)

A standalone networking core in `src/net/`. Nothing in the game uses it yet. Single-player only changes in one place: the sim
loop asks `lockstepStepper(galaxy)`, which is null unless a session is attached. The seed pins are unchanged.

**Files**

| File | What |
|---|---|
| `src/net/protocol.ts` | The wire messages (JSON). A command on the wire is a `NetCommand`: the command-log fields (`empire` index into `flatEmpireList`, `op`, args in the command-log codec), plus the peer id and a sequence number. |
| `src/net/transport.ts` | The `Link` interface (an ordered, reliable text channel) and the in-memory transport (`memoryLinkPair`, `MemoryListener`). |
| `src/net/wsTransport.ts` | The WebSocket `Link` on the standard WebSocket API (browser, Electron renderer, Node 22's global). `connectWebSocket(url)` is for clients; `wrapSocket(socket)` wraps an accepted server socket. |
| `scripts/lib/wsServer.mjs` | A small WebSocket server with no dependencies (`node:http` upgrade, RFC 6455), for the host. The desktop main process can reuse it. |
| `src/net/lockstep.ts` | `LockstepSession`, which works with any transport and any sim (see below). |
| `src/net/lockstepSim.ts` | The integration seam. `GalaxyLockstepSim` steps to frame F with these commands on a real game. `SessionStepper` lets the in-thread sim loop be driven by a session. |
| `src/net/lockstepSeam.ts` | The registry `src/simLoop.ts` reads (`setLockstepStepper` / `lockstepStepper`). When a stepper is set, the loop calls it instead of its own frame budget. |

**How it works**

- **Frames.** A lockstep frame is one sim frame: 1/60 s of real time, and `nextFrameMs(speed)` game ms. A command issued
  at frame F is applied at frame F + `inputDelay` (default 4, about 67 ms). Frame F runs on a peer only when that peer
  has every in-session peer's input for F. An input is either commands or an empty "no input" ack. Each peer acks
  through F + delay before it runs F. Within a frame, commands apply in peer-id order, then in issue order.
- **Topology.** A star. Clients send to the host, and the host relays to the others. So the host always knows every
  input first, and its join and leave decisions are consistent for everyone.
- **Local commands.** While a session is attached, `issuePlayerCommand` on that galaxy goes to the session through the
  existing `setRemoteCommandSink` hook (the one the sim worker's replica uses). The command is encoded at issue time
  with the command-log codec. At its frame, the adapter re-issues it on the real queue and drains it, so it is applied
  and journaled exactly as in single-player. It then runs one `runSimFrame`, or none while paused. A command that an
  `onApplied` callback issues goes back through the session. Commands with arguments that cannot be encoded are
  refused locally, not sent. The optional `authorize(peer, empire, op)` check runs on every peer on the same data, so
  a refused command is dropped everywhere.
- **Clock.** The host's inputs carry speed and pause changes, and these apply at their frame like commands. A client
  calls `requestPause`, and the host decides (`allowPauseRequest`). A paused frame still runs: it applies commands but
  adds no game time. No peer can run past what the slowest peer has acked, so the game runs at the slowest peer's
  pace. In the app, `SessionStepper` turns the HUD's speed and pause buttons into host clock changes, or into pause
  requests on a client.
- **Desync.** Every `digestInterval` frames (default 60), each peer takes `stateDigest` at that boundary. Clients send
  theirs to the host. On a mismatch, the host sends that client `serializeGame` of its current boundary, plus every
  input it holds from there on. The client reloads and continues; it may rewind a few frames or jump ahead. Each digest
  carries a resync count, so digests computed before the reload are ignored.
- **Join.** A client says `hello`. If it built the same game itself, the hello carries its frame and digest, and the
  host skips the save when they still match. Otherwise it gets the host's save at the current boundary, plus the input
  buffer. It sends input from the first frame the host has not sent yet. Every other peer hears of the join before
  that frame's host input, so nobody runs that frame without the newcomer.
- **Leave.** When a client's link drops, the host ends it at the first frame it has no input for, and tells the
  others. The session goes on. `hooks.onPeerLeft` is where Phase 4 hands the empire to the AI. If the host's link
  drops, a client's session ends (`onHostLost`).

**The demo** (`scripts/lockstep-demo.mjs`, not a test):

```bash
nice -n 19 taskset -c 4-7 node scripts/lockstep-demo.mjs            # host + client processes over WebSocket on localhost
nice -n 19 taskset -c 4-7 node scripts/lockstep-demo.mjs --memory   # the in-memory transport, two sessions in one process
#   options: --seed 1 --stars 300 --empires 4 --minutes 4 --speed 4 --delay 4 --digest 60 --burst 1000 --no-join --keep
```

Both processes build the game from the same seed and make two empires human (`setHumanEmpires`). Peer 0 commands the
primary human and peer 1 the second; a command for anyone else's empire is refused. The demo then:

1. runs 300 frames in real time, with renames, waypoints and retirements from each side;
2. runs the rest as fast as the inputs allow, with a burst of 1000 commands per side, then 20 commands per frame per
   side;
3. has the client corrupt its own state (it adds money to an empire outside the sim), which is detected and repaired;
4. has the client ask for a pause, which the host grants and then lifts;
5. has a third process join mid-game (it gets the save), try a command for the host's empire (refused on every peer)
   and then drop;
6. checks that the final digests match.

Results on 2026-10-10 (seed 1, 300 stars, 4 empires, 4x, input delay 4, CPU cores 4–7):

| | |
|---|---|
| Final digests, host and client (frame 3780, 4.06 game minutes) | match; 14,010 player commands journaled on each side |
| Digest checks | 73: the 1 mismatch (the injected one) was found at the next check (frame 960), with a 16.5 MB save. The client reloaded in 0.24 s, and every check after that matched. |
| Joiner | welcomed at frame 1717 with a 16.7 MB save (loaded in 0.28 s); 10/10 digest checks matched; left at frame 2317; the session went on |
| Pause | requested by the client at frame 1110; 125 paused frames on both peers |
| Command latency, real-time (60 fps) | about 64–65 ms median, own or the other peer's; the 4-frame input delay is 67 ms |
| Command latency, unthrottled | median 2–4 ms, p95 under 20 ms |
| WebSocket ping (localhost) | 0.1 ms; issue to arrival at the host: median 1.0 ms |
| Frame rate, unthrottled | idle lockstep 731 frames/s (the same sim alone: about 2,000 frames/s, so round trips dominate); with 20 commands per frame per side, 807 frames/s and 31,900 commands/s applied |
| Burst | 2,000 commands applied on both peers within 20–24 ms |
| Traffic (host) | sent 5,615 messages / 37.6 MB (mostly the two saves), received 4,475 / 1.1 MB |
| In-memory transport | 600 frames, two sims in one process: the digests match |

**What Phase 3 still needs**

- **App wiring.** A host/join screen. Create the session, then call `setLockstepStepper(galaxy, new SessionStepper(…))`.
  When a resync or join replaces the game (`onGameReplaced`), switch the views over, as loading a save does.
- **Worker mode.** `SimHost.tick` needs the same seam. Its command replies (`settleCommands`) expect commands to be
  applied at the next boundary, not D frames later. Its `stepSerial` must count the lockstep frames.
- **No camera LOD pass in multiplayer.** Each screen's camera differs, so the camera cannot be a shared input. The
  adapter runs without a view, as the headless harness does.
- **Humans per peer at the lobby.** `setHumanEmpires` must run as a deterministic start step, plus a peer → empire map for
  `authorize`. The UI-record sender (`obtainUiRecords`) must use the local viewer's empire (Phase 1, §6 item 5).
- **Stable references.** Commands are encoded when issued and resolved D frames later. Codec keys that are list
  indices (a fleet, a design, a character: "owner + index") can point at a different object by then. This is
  deterministic, so there is no desync, but it may hit the wrong target. Those kinds need stable ids.
- **Smaller saves.** A 300-star save is 16.5 MB of JSON. Compress it (`CompressionStream`) and chunk it for joins and
  resyncs.
- **A finer desync check.** `stateDigest` hashes key fields only. Add a deeper periodic hash, and log the first
  divergent frame to help debugging.
- **Messages per human** (Phase 1, §6 item 2), before two people can really play.
- **Cross-machine determinism.** Both demo processes run on one machine; test Linux/macOS/Windows peers early.
- **Electron host.** Run `wsServer.mjs` in the main process and bridge it to the renderer or worker over IPC.
- **Later (Phase 4).** Adaptive input delay for the Internet, a relay or WebRTC, reconnects, host migration, AI
  takeover in `onPeerLeft`.

## 9. Cross-platform determinism check

`scripts/determinism-check.mjs` bundles `scripts/determinism-check/runner.ts` (rolldown, one self-contained ESM file,
the `scenarios/` overlays inlined) and runs it under the repo's Electron (`ELECTRON_RUN_AS_NODE=1`, the release app's
V8) and/or plain Node on this machine, and with `--remote` on another machine over ssh, using that machine's
installed app binary as Node. Each run prints `case gameMs stateDigest rndDraws` every `--every` game seconds and a
sha1 of the whole save text every `--save-every` checkpoints; the streams are compared line by line.

```bash
node scripts/determinism-check.mjs --years 5 --remote user@mac --ssh-key ~/.ssh/key \
    --remote-data '~/dwu-assets' --remote-runtime /Applications/dwu.app/Contents/MacOS/dwu
```

Cases: `s1` (seed 1, 300 stars, 4 empires), `s7` (seed 7, 700 stars, 10 empires), `smart` (seed 3, Smarter AI as a
composite add-on with every sub-switch on), `script` (seed 1 with the scripted player orders of
`test/helpers/commandScript.ts`, recording the command log) and `replay` (seed 1 replaying that log; it must also
equal `script`). The remote folder is deleted afterwards.

**Result (2026-10-10, Linux x64 vs macOS arm64, both Electron 44.4.5 / V8 15.2):** **they match.** All five cases ran 5 game years each,
compared every 10 game seconds (5 × 301 checkpoints: state digest and Rnd draw count; plus a whole-save hash every
60 s): every checkpoint is identical, both before and after the `detPow` fix below, and the command-log replay equals
the live scripted run. Seed 7 (700 stars, 10 empires) ends with 2,601 built objects and 3.9M Rnd draws.

Findings:

- **Math.pow is not portable.** V8 15 takes `pow` from LLVM libc, and its results are 1 ulp apart between x64 and
  arm64 for about 0.1–3% of ordinary inputs (`pow(d, 1.8)`, `pow(x, 0.75)`, `pow(x, 4)`, `pow(1.25, k)`). Fix:
  `src/sim/detMath.ts` `detPow`, a plain-JS port of V8 12's fdlibm pow, which every `Math.pow` in `src/sim` now
  calls. It equals Node 22's `Math.pow` bit for bit (checked on 7.5M inputs), so the pins do not move. Keep
  `Math.pow` out of `src/sim`; `x ** 2` is exact and fine.
- `Math.tanh` and `Math.atan` also differ between x64 and arm64; the sim uses neither. `sin`, `cos`, `tan`, `asin`,
  `acos`, `atan2`, `log`, `log10`, `exp`, `hypot`, `sqrt` matched on 4M inputs each.
- **Node 22 and Electron 44 run different games from the same seed.** Their `sin` / `cos` / `atan2` / `log` / `pow`
  differ in the last bit (V8 12 fdlibm vs V8 15 LLVM libc), so the start digest already differs (seed 1: Node
  `4948f3713d8cdf2d`, Electron `b2cb4fe491ec07fb`). The pins and tests are Node 22 values. For multiplayer this only
  means that all players must run the same app build (planned anyway: Phase 5 version check); a mixed Electron
  upgrade would desync.
- macOS is case-insensitive: the data loader opens `characters/Ackdarian.txt` there and `characters/ackdarian.txt`
  on Linux (the same file content). Harmless; the runner's data fingerprint lower-cases paths.
- Not a sim problem: `defaultRaceName` (`startGameOptions.ts`, the wizard default) sorts with the OS locale, and the
  sim's other collators and `toLocaleString` calls name `'en-US'`.
