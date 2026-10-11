# Multiplayer

Status: **Phase 1 of 5 done (2026-10-10)**; its last leftovers are done too (§6, 2026-10-11). Milestone 1 (the audit, the core API, the
clear "a human controls this empire" sim rules), Milestone 2 (the local viewer in the UI, an inbox for every human, the
(a) leftovers, the plumbing) and Milestone 3 (the nine decisions of §4, `createGame` for N humans). **Phase 3 (LAN play,
§10) is built** on top of the lockstep core (§8): host / join by IP in the desktop app, the lobby, the version and data
check, and the session flow. **Phase 4's LAN half is built (§11–§14):** lockstep with the sim in the worker, rejoining
a dropped player, AI takeover of an absent player's empire, and an adaptive input delay. **Internet play is built
(§15):** WebRTC data channels set up with copy-paste invite / reply codes, peer-to-peer, with no server of ours in
between. **Phase 5 (§16–§21, 2026-10-11):** host migration (the game goes on when the host leaves; the old host can
rejoin), the lobby's add-on / theme matching, diplomacy between human players as offers, and chat; the leftovers
(§21–§24: joining a running game as a new player, multiplayer saves and Resume, dev-only debug hooks). Nothing changes for
the player: the seed pins (`npm run repin -- --check`) are
unchanged at every commit, one-human saves are byte-identical to before, and every multiplayer-only rule runs only when
the game has more than one human (`isMultiHuman`).

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
| 4 | Internet: WebRTC, a lobby and invite codes, reconnects, AI takeover on disconnect. | Done: worker mode, rejoin, AI takeover, adaptive delay (§11–§14); Internet play by codes, no server (§15); host migration (§16). |
| 5 | Polish: chat, human-to-human diplomacy, multiplayer saves, version/add-on/data checks, joining mid-game. | Done: host migration (§16), settings matching (§17), human-to-human diplomacy (§18), chat (§19), the leftovers (§21), joining mid-game (§22), saves and Resume (§23), dev-only hooks (§24). Left: §26. |

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

Phase 1 is done. The last leftovers (2026-10-11):

- ~~**Battle reports**~~: the observer watches every human seat's battles (AI-run seats too, so a returning player finds
  the fights in between). The report's own `camp` / `result` stay the primary human's; every other human seat with a
  side in the battle gets its own camps and result in `BattleReport.views` (keyed by empireId, written only in a
  multiplayer game, so a one-human save is unchanged). `battleReportForViewer` turns a report into the viewer's (its
  side is "Your forces", its camps, its result), and the Battle Reports list, the notices and the window show each
  human only its own battles (`battleReports(galaxy, skirmishes, viewer)`).
- ~~**Hint subjects in worker mode**~~: the worker sends every other human's live table too (side root
  `hintSubjectsOthers`, by empireId; replica only, never saved), and the replica reads the viewer's.
- ~~**Main-thread odds and ends**~~: the AI advisor driver and the LLM layer (the chronicle, the strategic job) read the
  local viewer at each use (a getter in `main.ts`); neither ever advises a human's empire (`selectAdvisedEmpires` and
  `nearestAiEmpires` skip every human). The founding line and the starting camera were already the viewer's (a LAN
  game sets the viewer before the view boots); in hot seat a switch now rebuilds the ticker for the new viewer (its
  founding line in a new game, then its own message history), and the camera centres on its capital.
- ~~**Hot-seat event pop-ups**~~: an event pop-up for a human whose turn it is not is held (`installEventMessages`
  `holdFor`: a holding recipient on each other human) and shown when their turn comes, after their curtain lifts
  (`held`: nothing shows behind the curtain). The sim still records it in that human's history.
- The SystemInfo "potential colonies" flag (written for the primary, never read) is left as it is.
- **`scripts/player-empire-allowlist.json`** holds the remaining sim `playerEmpire` reads (174 lines in 49 files): the
  story (single-protagonist by decision), the C# start code, the save, and the primary-human aliases.

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
    `serializeGameSave`, and in worker mode through `SimWorkerClient.save(timeout, extras)` → `SaveRequest.extras` →
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

## 8. Lockstep core (built ahead for Phase 3)

A standalone networking core in `src/net/`. Nothing in the game uses it yet. Single-player only changes in one place: the sim
loop asks `lockstepStepper(galaxy)`, which is null unless a session is attached. The seed pins are unchanged.

**Files**

| File | What |
|---|---|
| `src/net/protocol.ts` | The wire messages (JSON). A command on the wire is a `NetCommand`: the command-log fields (`empire` as its stable `empireId`, `op`, args in the command-log codec), plus the peer id and a sequence number. |
| `src/net/transport.ts` | The `Link` interface (an ordered, reliable text channel) and the in-memory transport (`memoryLinkPair`, `MemoryListener`). |
| `src/net/wsTransport.ts` | The WebSocket `Link` on the standard WebSocket API (browser, Electron renderer, Node 22's global). `connectWebSocket(url)` is for clients; `wrapSocket(socket)` wraps an accepted server socket. |
| `desktop/wsServer.cjs` | A small WebSocket server with no dependencies (`node:http` upgrade, RFC 6455), for the host: the desktop main process runs it (§10); `scripts/lib/wsServer.mjs` re-exports it for the scripts. |
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
- **Save transfer.** A join or resync save is gzip-compressed (`saveCompression.ts`) and sent as base64 `saveChunk`
  messages (1 MB of gzip each) just before the `welcome` / `resync` that names it (`WireSave`). The host writes the
  text at the boundary, then compresses it while it runs on; messages to that link wait behind the save. The client
  inflates it asynchronously and holds its frames and other messages until it is loaded. A 17 MB save travels as
  ~1.5 MB.
- **Leave.** When a client's link drops, the host ends it at the first frame it has no input for, and tells the
  others. The session goes on. `hooks.onPeerLeft` is where the host decides about the empire (§12). If the host's link
  drops, a client's session ends (`onHostLost`) — or, with `migratable` (every app session since Phase 5), waits for a
  new host (§16).

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

**What Phase 3 still needs** (most of it is done now: §10)

- ~~**App wiring.**~~ Done (§10): the Multiplayer screen and lobby; `MultiplayerGame` sets the stepper, and a resync or
  join that replaces the game rebuilds the view as loading a save does.
- ~~**Worker mode.**~~ Done (§11): `SimHost.tick` asks the same seam; lockstep commands are answered by their own
  callbacks when they apply, not by `settleCommands`.
- **No camera LOD pass in multiplayer.** Each screen's camera differs, so the camera cannot be a shared input. The
  adapter runs without a view, as the headless harness does.
- ~~**Humans per peer at the lobby.**~~ Done (§10): the lobby rows become `StartGameOptions.humanPlayers`, the peer →
  slot → human map is the `authorize` check. Still open: the UI-record sender (`obtainUiRecords`) must use the local
  viewer's empire (Phase 1, §6 item 5).
- ~~**Stable references.**~~ Done (2026-10-10). Commands are encoded when issued and resolved D frames later, so the
  codec no longer names anything by a list position. Codec version 2 (`COMMAND_CODEC_VERSION`, journaled as
  `PlayerLogEntry.codec`) names an empire by `empireId`; fleets, designs, characters, troops and habitats by a stable
  `refId` (`src/sim/entityRefs.ts`: one galaxy counter, assigned by a deterministic sweep at the end of each frame,
  after each applied command, at the end of `createGame` and in AddHabitat / AddAsteroidField); a creature by
  `creatureId`; a tech node and an advisor suggestion by owner `empireId`; a planet destroyer project location by its
  ship's `builtObjectID` (`'glbo'`). `NetCommand.empire` is the `empireId` too
  (`authorize` still gets the flat index, taken at the command's frame). Log entries without `codec` (version 1) still
  decode and replay with the old index keys. A save from before the ids gets them at load in sweep order, plus a
  `'refids'` log entry so a replay from the seed renumbers at the same boundary. The ids are saved and reach the
  worker replica as ordinary fields; they are not in `stateDigest`. Still positional, by op signature (not the codec):
  `scrapColonyFacility`'s facility index (checked against the facility type), `moveResearch`'s target slot and
  `setControlGroup`'s slot (positions by meaning). `exposeUncoveredPlanetDestroyer` now passes the location itself
  (`'glbo'` above); its older log entries carry a `galaxyLocations` index, which still decodes and applies.
- ~~**Smaller saves.**~~ Done: gzip + chunks (`saveChunk`); a 100-star save travels as 0.76 MB.
- **A finer desync check.** `stateDigest` hashes key fields only. Add a deeper periodic hash, and log the first
  divergent frame to help debugging.
- **Messages per human** (Phase 1, §6 item 2), before two people can really play.
- **Cross-machine determinism.** Linux ↔ macOS is checked (§9, and a LAN session in §10.6); Windows is not yet.
- ~~**Electron host.**~~ Done (§10): `desktop/netHost.cjs` runs `desktop/wsServer.cjs` (moved from
  `scripts/lib/wsServer.mjs`, which now re-exports it) and bridges each connection to the page as a MessagePort.
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
equal `script`). The remote folder is deleted afterwards. A Windows host (Windows OpenSSH runs `cmd.exe`) takes
`--remote-shell cmd` with Windows paths, e.g. `--remote-dir C:\\...\\run --remote-data C:\\...\\data
--remote-runtime C:\\...\\dwu.exe`; `--remote-jobs N` runs at most N cases at once there. Without the game, the
runtime is the release zip's `dwu.exe` (+ its dlls, `.dat`, `.bin` and `.pak` files, no art) and the data is only the
1,337 files the runner reads (`--files` lists them; plus every `.txt` of `races/`, `designTemplates/DEFAULT/`,
`Policy/` and `Policy/pirate/`, which the loader lists): about 260 KB.

**Lockstep across machines:** `node scripts/determinism-check.mjs --bundle-peer <dir>` bundles
`scripts/determinism-check/lockstepPeer.ts` (one file, like the runner). One machine runs `--role host --peers N`,
the others `--role client --peers N --url ws://<host>:47811`, each under its app binary with
`ELECTRON_RUN_AS_NODE=1`. Every peer builds seed 1 itself, commands its own human empire (renames, waypoints,
retirements and move orders) and runs at up to 60 fps; the host compares every client's digest every 60 frames.

**Result (2026-10-10, Linux x64 vs macOS arm64, both Electron 44.4.5 / V8 15.2):** **they match.** All five cases ran 5 game years each,
compared every 10 game seconds (5 × 301 checkpoints: state digest and Rnd draw count; plus a whole-save hash every
60 s): every checkpoint is identical, both before and after the `detPow` fix below, and the command-log replay equals
the live scripted run. Seed 7 (700 stars, 10 empires) ends with 2,601 built objects and 3.9M Rnd draws.

**Windows (2026-10-10, Windows 11 x64, i7-10510U, the v0.1.15 release `dwu.exe` = Electron 44.4.5 / V8 15.2, at
`d11580a7`):** **it matches too.** The same five 5-year cases, 5 × 301 checkpoints, are identical to Linux, and a
fresh Mac run at the same commit is identical to both: all three platforms give the same streams. Windows' native
`Math.pow` differs from both Linux's and the Mac's (a third set of results), and `detPow` is identical everywhere,
so the `detPow` fix was needed for Windows as well. The laptop ran about 6× slower than this PC (3 cases at once),
which still allowed the full 5-year runs.

**3-peer lockstep (Linux host + macOS + Windows, over Tailscale, WebSocket):** 14,400 frames (4.4 minutes of real
time, 951 game seconds at 4×), 794 player commands from the three peers, a pause asked by a client and resumed by
the host. All 480 digest checks (240 per client) matched, with no resyncs, and all three end on the same digest.

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

## 10. Phase 3: LAN play

Built on branch `wip/mp-lan`, on top of the lockstep core (§8). Single-player is unchanged: nothing runs unless a LAN game
is started, `npm run repin -- --check --workers 1` = 0, and the lockstep demo still passes. The per-human screens
(each player's own HUD, messages and orders) come with the rest of Phase 1; see §10.7.

### 10.1 What is built

| File | What |
|---|---|
| `desktop/netHost.cjs` | Main process. `host(port)`: a WebSocket server on every interface (`wsServer.cjs`); each accepted connection is bridged to a `MessageChannelMain`, one end sent to the page (`dwu:net-link`). `connect(url)`: a client WebSocket (Node's global one) bridged the same way. `addresses()`: this machine's LAN addresses. The page cannot open `ws://` to a LAN address itself: its `dwu://` origin is a secure context, and Chromium blocks that as mixed content. |
| `desktop/wsServer.cjs` | The dependency-free WebSocket server (moved from `scripts/lib/wsServer.mjs`, which re-exports it for the demo). New: an incoming message over 64 MB closes the connection. |
| `desktop/gamePreload.cjs`, `desktop/main.cjs` | `dwuDesktop.net` (host / stopHost / connect / addresses); `DWU_USER_DATA_DIR` gives a second copy its own profile and single-instance lock (two copies on one PC). |
| `src/net/portTransport.ts` | A lockstep `Link` over a MessagePort. |
| `src/ui/multiplayer/netBridge.ts` | The page's endpoint: the desktop bridge, or in a browser a plain WebSocket (join only: a page cannot listen). Address parsing (`ip`, `ip:port`, `[v6]:port`; default port 47610). |
| `src/net/fingerprint.ts` | `AppFingerprint` (version, build, JS engine, protocol, theme, add-on hash, data hash) and `fingerprintMismatch`, which words the refusal for the joiner. The app records every data / theme / add-on file it fetches (`noteDataRead` in `main.ts` fetchTextBrowser and loadSystemNames): the data hash is sha-256 over `path\0text\0`, paths lower-cased, a UTF-8 BOM dropped, the install listings (asset manifest) left out. `fingerprintFiles()` lists each file's hash, to find the file behind a mismatch. |
| `src/appVersion.ts`, `vite.config.ts` | `APP_BUILD` (`__DWU_BUILD__`): `$DWU_BUILD`, else the git commit, plus a hash of the uncommitted changes to `src/`, `scenarios/` and the pages when the tree is dirty. |
| `src/net/lobby.ts` | The lobby protocol (`lobbyHello` with the fingerprint, `lobbyRefused`, `lobbyWelcome`, `lobbyState`, `lobbyPick`, `lobbyStart`, `lobbyBye`), `LobbyHost` / `LobbyClient`, and `HandoffLink`: after Start the link belongs to the lockstep session, and what arrives before the session listens is held. The host's handoff rewrites the joiner's lockstep hello name to its slot (`peerName` = `"<slot>\|<name>"`), so a client cannot pose as another slot. |
| `src/net/multiplayerGame.ts` | `MultiplayerGame`: the lockstep session over the real game. `authorize`: a peer may only command its slot's human empire (`humanEmpires[humanIndex]` at the command's frame). The host holds at frame 0 until every lobby player joined (a client that built the game itself joins with its frame-0 digest: no save travels). Status for the screen: waiting, resyncing, a player left (the host pauses), the host is gone. The humans are createGame's own (`StartGameOptions.humanPlayers` = the clients' lobby rows in slot order), so human index = player order. |
| `src/net/lockstep.ts` | One new hook, `onResyncStart` (client: a resync arrived, its save is loading). |
| `src/ui/multiplayer/multiplayerApp.ts` (+ `.css`) | The Multiplayer screen, the lobby, the in-game banner and status chip, the LAN save extras, and `window.__dwuMp` (scripts). |
| `src/main.ts` | `multiplayerDeps`: build the game from the start (`toCreateGameOptions` + the host's `createExtras`; in-thread or, §11, in the sim worker), load a save for the host, show a game (tearing down the one up), the wizard and the save picker. |
| `src/ui/screens/mainMenu.ts` | A "Multiplayer" item after Load Game (text: there is no original art for it). |
| `src/ui/screens/newGameWizard.ts` | `initialOptions` (open on the lobby's settings) and `multiplayer` (no hot-seat list: the humans are the lobby's players). |
| `src/ui/hotSeat.ts` | `networked`: no Switch Player button, hotkey or curtain in a LAN game. |
| `src/sim/save/gameSave.ts` | `GameSaveJSON.multiplayer = { players }` (the lobby name of each human, by human index), written only for a LAN game, just before `galaxyBackdrop`; `savedMultiplayerPlayers` reads it from the tail. |

### 10.2 How to host and join

1. **Host** (desktop app): main menu → **Multiplayer** → your name, a port (default 47610) → **Host Game**. The lobby
   lists this machine's addresses ("Players join with: 192.168.1.8:47610 …"); tell the others one of them. The port must
   be open in the host's firewall (macOS asks the first time; on Linux / Windows allow it for the app).
2. **Join** (desktop app): Multiplayer → your name, the host's `IP:port` → **Join Game**. The browser / dev build can
   join too (it opens the WebSocket itself), but it runs a different JS engine than the desktop app, so the version
   check refuses it against a desktop host; it cannot host.
3. **Lobby.** Each player sets their own row: empire name, race, government (the list follows the race, as in the
   hot-seat rows), the two flag colours, and **Ready**. The host's row is player 1 of the wizard.
   - **Game Settings…** (host) opens the new-game wizard on the lobby's settings; its Start returns to the lobby.
   - **Load Saved Game…** (host) picks a save. The lobby then lists the save's human empires; each player picks one (a
     player whose lobby name played it before gets it automatically). **New Game Instead** goes back.
   - **Start Game** (host) is enabled once every player is ready (and, for a save, has picked an empire).
4. **The game** starts paused. Any player can pause or resume (the HUD's pause button or keys); only the host sets the
   speed; the game runs at the pace of the slowest machine. The chip at the lower left shows the role, the players,
   your empire, the ping to the host and the resyncs.

Two copies on one PC (testing): start the second with its own profile, e.g.
`DWU_USER_DATA_DIR=/tmp/p2 electron desktop/main.cjs`, and join `127.0.0.1:<port>`.

### 10.3 The version and data check

The joiner's hello carries its `AppFingerprint`; the host compares it with its own and refuses the first difference, in
this order, with a message for the joiner: the protocol, the version ("The host runs openDWU 0.1.16, you run 0.1.15"),
the build, the JS engine (Node, Chrome and Electron compute the game differently, §9), the theme, the add-ons (every
file under `assets/scenarios/` the app loaded), and the game data (every data / theme file read). The add-ons a game
uses are part of the host's start options; the hash makes sure everyone has the same definitions.

### 10.4 The session

- **Start.** A new game: the host sends `MultiplayerStart` — the start options (the clients' rows as `humanPlayers`, in
  slot order), the `createExtras` from the host's settings that `createGame` takes beside them (game options, message
  options, flag shape), the players (slot → human index), the lockstep parameters and the clock — all through one JSON
  round trip on the host too. Every peer builds the galaxy itself, then joins the session with its frame-0 digest; the
  host checks it and sends no save when it matches. A loaded game: the clients get the host's save in the session's
  welcome (gzip, chunked: §8).
- **Commands.** Each screen's local viewer is its player's empire (`setLocalViewerEmpire`). Commands go through the
  journaled path (`issuePlayerCommand` → the session → applied at frame + 4 on every peer). A command for another
  empire is refused on every peer (`authorize`).
- **Clock.** The host's inputs carry the speed and pause; a client's pause button asks the host. Event pop-ups and
  screen windows do **not** pause a multiplayer game (§27; before, they paused everyone).
- **Desync.** Every 60 frames the clients send their digest (with a deep digest: §27); on a mismatch the host sends that client a save. The client
  shows "Resyncing with the host…", reloads, and its view is rebuilt on the new galaxy; the host shows "Resyncing
  <player>…" until that player's next digest matches.
- **Disconnect.** A client leaving pauses the game on the host; the host chooses AI takeover or idle, and the player can
  rejoin (§12). The host leaving ends the game on the clients ("Lost the connection to the host"; Rejoin / Main Menu).
  A connection after the start that is not a dropped player coming back may take over a free empire (§22).
- **Saving.** Any player can save (each has the whole game); the host's save is the one to keep. A LAN save carries the
  players by human index (`multiplayer` key). Loading it as host: Multiplayer → Host Game → Load Saved Game…; the same
  players get their empires back by name.

### 10.5 Scripting (`window.__dwuMp`, `window.__dwuMpLobby`)

Dev flag only since §24 (`DWU_DEV_HOOKS=1`). Since §21: `__dwuMp.wantedDelay()`, `joinChoices()`; `__dwuChat.muted()`,
`mutedLines()`; `__dwuOffers.openOwn()`; `__dwuMpLobby.loadSave(multiplayerOnly)`.


`__dwuMp` (while a LAN game runs): `role`, `status`, `frame`, `clock`, `stats`, `gameMs`, `peers()`, `digest()`,
`myEmpire()`, `issue(op, args)` (for this player's empire), `renameOther(humanIndex, label)` (a refused command),
`scriptStep(tag)` (rename the first ship and drop a waypoint), `shipNames()`, `pause(bool)`, `setSpeed(n)`. Phase 4:
`worker`, `inputDelay`, `seats()` (each lobby slot: present, AI-run, empire), `decideAbsent(slot, ai)` (the host's
banner buttons), `setInputDelay(n)` (host), `dropLinks(reason)` (close this peer's links as a failing network would). In
worker mode `digest()`, `issue`, `renameOther`, `scriptStep`, `shipNames` return promises (await them in either mode).
`__dwuMpLobby` (host lobby): `patchSettings(partial)` (as the wizard would), `state()`, `setAdaptiveDelay(bool)`,
`fingerprint()`, `files()`.

### 10.6 Test results (2026-10-10)

| Test | Result |
|---|---|
| Headless (lobby → start → two `MultiplayerGame`s over the in-memory transport, seed 7) | the 0.1.14 joiner refused with "The host runs openDWU 0.1.15, you run 0.1.14…"; the host held at frame 0; the client joined without a save (263 bytes); 15 digest checks, digests equal at frame 900; a command for the host's empire refused on both; the client's drop paused the host |
| **Two desktop apps on one PC** (host + client on 127.0.0.1, through the real UI: menu → Multiplayer → lobby → wizard round trip → Start), seed 4242, 100 stars, a scripted minute at 2× | **final digests match: `f48d9d71cae4edb0` at game ms 72,266 on both**; 64 digest checks; the one mismatch was the injected one (the client's money changed outside the sim), resynced in under a second, view rebuilt; the client's pause paused both; the client's command for the host's empire refused on both; each side saw the other's renames; the host's save carries `{"players":["Hosty","Clienty"]}`; the client quitting paused the host with the banner |
| **Load as host** (that save, a new host and client app) | the client got its old empire back by name ("Maru Pasdo Nation (was Clienty)"), received the save (0.76 MB compressed, 4.2 M characters), digests equal at load (`1b8d313e032f6352`) and after 16 s more play (`8740b0e8eec22feb`, game ms 72,166), 19 checks, 0 mismatches |
| **Linux desktop host ↔ Mac client over Tailscale** (the client: the same code bundled and run under the Mac app's Electron 44.4.5 as Node, `ELECTRON_RUN_AS_NODE`; it builds the game from the host's start with the desktop shell's asset manifest), a minute at 2× with commands from both | the data fingerprints are equal across the machines (`caff21a1a0bc`, 1,338 files; macOS opens other spellings of some files, the lower-cased keys agree); **62 digest checks, 0 mismatches, final digest `1cd5229dd39191a0` at game ms 117,066 on both**; 4 stalls (66 ms) on the host |
| Same, client under this PC's Electron as Node | 32 checks, 0 mismatches (the Electron renderer and Electron-as-Node run the same game) |
| **After Phase 1 landed** (main 1a9c919a + the fixes above): two desktop apps, a scripted minute at 2× | the client plays its lobby pick "Clienty Dominion"; **final digests match: `783e49c8e9e3dd12` at game ms 81,300**; 64 checks, the one injected mismatch resynced; only the deliberate hijack refused (no more HUD orders for the wrong empire); load as host: the client got "Clienty Dominion" back by name, digests `9589510b27976f39` at game ms 112,933 on both, 18 checks, 0 mismatches |
| `npm run repin -- --check --workers 1` | 0 pins would change (before and after the Phase 1 integration) |
| `scripts/lockstep-demo.mjs` (WebSocket) | OK: digests match at frame 3780 |
| vitest: the sim-worker, save, save panel, main menu and wizard tests (26 files) | 182 passed |

### 10.7 What is left

Done with Phase 1 on main (2026-10-10):

- The humans come from createGame (`humanPlayers`), so each client plays the empire it picked in the lobby; the
  "make AI empires human" stand-in is gone. **Fix in `createGameSteps`:** the extra human starts were found by position
  (`num15 >= aiCount`), but `updateEmpireStarts` sorts the start list by projected colony amount, so other empires were
  made human (hot seat too). They are now found by their start object and kept in player order. One-human starts never
  reach that code (pins unchanged).
- Each screen shows and commands its own `localViewerEmpire`; the improvement switches (`setDesignLineUpgrade`,
  `setStatePriorityShipyards`) go out only for the local player in a LAN game, not for every human.

Phase 4:

- ~~**Rejoin** and **AI takeover**~~: done (§12).
- ~~**The sim worker**~~: done (§11).
- ~~**An adaptive input delay**~~: done (§13).
- ~~**Host migration**~~: done (§16).
- ~~**Internet play**~~: done (§15): WebRTC with copy-paste codes, no server.

Phase 5: ~~chat~~ (§19), ~~human-to-human diplomacy~~ (§18), ~~add-on / settings matching~~ (§17), joining a running
game (refused today), a per-human handicap, and a deeper desync hash with the first divergent frame logged.

## 11. Phase 4: lockstep with the sim in the worker

Built on branch `wip/mp-phase4`. A LAN game now runs where the app runs its sim: in the sim worker (the desktop app's
sim process, docs/sim-worker.md §4.7) when Settings → "simulation in a worker thread" is on (the default on machines
with enough memory; `?simWorker=1|0` overrides), else in-thread as in Phase 3. Big galaxies need the worker. Peers of
both kinds can share one session: the frames are the same code.

**Where the session runs.** `LockstepSim.applyFrame` / `digest` / `save` / `load` are synchronous calls on the game, so
the session lives next to it, in the worker (`src/simworker/workerLockstep.ts`). The network links stay on the main
thread (the desktop shell hands the page a MessagePort per connection, `desktop/netHost.cjs`; a browser page holds its
WebSocket) and their traffic is relayed: `netIn` / `netClose` to the worker, `netOut` / `netCloseOut` back
(`src/ui/multiplayer/mpHandle.ts` `WorkerMp`, the worker's `RelayLink`). The main thread sees the session through
`mpState` (on change and every 250 ms: status, frame, clock, stats, peers, seats, input delay) and calls into it with
`mpCall` / `mpReply` (pause, speed, the host's decisions, the debug hook).

| File | What |
|---|---|
| `src/simworker/simHost.ts` | `tick`: when `lockstepStepper(galaxy)` is set (the seam of §8), the session steps the galaxy exactly as the in-thread loop does — no command drain of its own, no camera pass, the HUD's pause / speed become session requests in the stepper. `admitCommands`: with the session's command sink on the galaxy a command goes to the session and is answered by its own callbacks when it applies on every peer (or an error reply when it is refused or dropped), not settled against the local queue at the next boundary (`settleCommands`). `stepSerial` counts the frames the stepper ran unpaused. |
| `src/simworker/workerLockstep.ts` | `WorkerLockstep`: `MultiplayerGame.host` / `join` over the worker's game with relayed links; the stepper set on the galaxy; `mpState`; `mpCall` (pause, speed, ping, digest, decideAbsent, inputDelay, the script calls). |
| `src/simworker/worker.ts` | The multiplayer messages work before the game exists; a `lockstep` boot (a client of a loaded game or a rejoin) loads only the data and waits for the welcome's save; `replaceGame`: a resync or join save replaced the game → a new `SimHost` over it, `gameReplaced`, then the new snapshot (streamed as at boot). |
| `src/simworker/workerClient.ts` | `MpSideChannel` (the session's messages, at any time, also before the first snapshot); on `gameReplaced` the client detaches (it takes no more messages and disposing it leaves the worker running) and the next client is built from the snapshot that follows (`onReplaced`). |
| `src/simworker/clientCore.ts` | `setLockstep(true)`: the reply backstop is off (a command waits for its frame, which a loading peer can hold up; the worker still answers every command and says it is alive), and the Adaptive off-screen rate picks nothing (each peer would pick its own). |
| `src/ui/multiplayer/mpHandle.ts` | `MpHandle`, one shape for the screen: `InThreadMp` (the Phase 3 path) and `WorkerMp`. |
| `src/ui/multiplayer/multiplayerApp.ts`, `src/main.ts` | Host / client start in either mode (`deps.useWorker`, `buildGameInWorker`, `bootWorker`); a replaced game is shown as a loaded one is. |

Nothing changes in single-player: without a session no stepper is set, `SimHost.tick` and `admitCommands` take their old
branch, and no multiplayer message is sent.

## 12. Phase 4: rejoin and AI takeover

**The sim: AI-run seats** (`src/sim/humanEmpires.ts`). A human seat whose player left can be handed to the AI until they
return: `setAiSeat(galaxy, empire, ai)`, only through the journaled command `setSeatAi` (so every peer changes it at the
same frame, and a replay from the command log does too). While a seat is AI-run, `isHumanEmpire` is false and
`humanEmpires` leaves it out, so every AI branch of Milestones 1–3 decides for it and a player command for it is
rejected (`applyLive`); `humanSeats` keeps the stable list the session maps players to, and `isMultiHuman` counts seats,
so the game stays a multiplayer one. The primary human (the host) is never an AI seat. The set is the save side table
`aiSeats` and reaches the replica; it is written only while non-empty, so every other game saves the same text (repin 0).

**The session** (`src/net/multiplayerGame.ts`):

- **A drop.** The host pauses (`absent` status) and decides: **AI Takes Over** (`decideAbsent(slot, true)`: the host
  issues `setSeatAi` for that seat — the only command a peer may issue for another empire, and only the host:
  `slotAuthorizer`) or **Continue Without Them** (the empire stands idle). Either resumes the game if the drop paused it.
  The host may also resume by hand; the banner keeps offering the choice.
- **Rejoin.** The host's app answers a connection to the running game (`installRejoinGate`): the lobby hello's
  fingerprint must still match, and the player gets their slot back by their **rejoin token** (each player's own,
  sent with `lobbyStart` and kept in `localStorage` `dwu.mp.rejoin`) or by their **lobby name** among the absent players.
  The host answers `lobbyRejoin { slot, start, token }` and hands the link to the session (`lobby.ts` `slotHandoff`:
  the lockstep hello gets the slot's peer name), which admits it as a new peer with the current save, as any mid-game
  join (§8). If the AI ran the seat, the host's `setSeatAi(false)` rides on its next input — the frame the rejoined
  peer's input starts from — so **the AI never runs a frame of a seat whose player is in the session**. The drop's
  pause lifts once no absent player is undecided.
- **The client.** After a drop its banner says "Lost the connection to the host" with **Rejoin** (same address, its
  token). After a restart of the app, Multiplayer → Join Game with the same address does the same (the address and token
  are remembered). The welcome's save brings the game (in-thread: `MultiplayerGame.join(null, …)`; worker: the
  `lockstep` boot of §11).

`LobbyHello.rejoin`, `LobbyStart.token` and `lobbyRejoin` are new lobby messages; a Phase 3 client ignores the token.

## 13. Phase 4: an adaptive input delay

`LockstepOptions.adaptiveDelay` (host; the lobby's "Adaptive input delay" box, `__dwuMpLobby.setAdaptiveDelay`): the host
pings every client each second, keeps the worst of its last 5 round trips, and wants the delay to cover the slowest
path a command takes — a client's input to the host and on to the slowest other client, half of each round trip — plus
2 frames, between 3 and 30 frames. A raise goes out at once; a cut after the lower value was wanted 5 times in a row. A
peer still loading its welcome save is not measured (it answers late). The new delay rides on the host's input of a
frame (`FrameInput.delay`) and every peer switches at that frame; `resync` carries the parameters. A change can never
apply a command twice or skip one: each frame keeps the one input a peer sent for it (a raise sends empty acks for the
gap, a cut waits until the frame catches up). The delay is not sim state: the digests do not depend on it.
`setInputDelay(frames)` sets it by hand (host).

## 14. Phase 4: tests (2026-10-10)

`scripts/lockstep-demo.mjs --phase4` (scratch flags, not a test): host + client in one process over the in-memory
transport, through `MultiplayerGame` itself. They play 360 frames, the client's link drops, the host decides (AI, or
`--idle`), the AI runs the seat (`--away` frames), the client rejoins by name with no game of its own (the save comes in
the welcome), and they play on; the host's command for the AI-run seat must be refused, the rejoined client's rename
must apply on both, control must be back by the rejoined peer's first input frame, and the final digests must match.
`--worker`: the client (before and after the rejoin) steps through `SimHost.tick` and sends its orders as the main
thread's `CommandMessage`s (`SimHost.command`); `--latency N` (one-way ms on every link, real-time pacing) and
`--adaptive`. `--phase4 --ws` runs the same story across two processes over WebSocket (roles `p4host` / `p4client`, which
can also be started by hand on two machines: `--role p4host --listen 0.0.0.0 --port N`, `--role p4client --url
ws://host:N`); both stop at `--end` (default frame 3000) and print their digests.

| Run (seed 1, 150 stars, 4 empires, 4x) | Result |
|---|---|
| `--phase4` (in-thread client, AI takeover) | OK: final digests `789d7c93f5c02e46` at frame 2195 on both; 16 checks, 0 mismatches (10 after the rejoin); the AI ran the seat from frame 394 (ships 21 → 23, money 35,867 → 27,427); control back at frame 1595 = the rejoined peer's first input frame; the host's hijack refused |
| `--phase4 --worker` | OK: the same final digest `789d7c93f5c02e46` (the worker peer runs the frames the in-thread one does) |
| `--phase4 --worker --idle` | OK: `53a898142690d93f` on both (the idle seat: a different game, as it should be) |
| `--phase4 --latency 100` (200 ms round trips), fixed delay 4 | OK; the host stalled 928 times (19.0 s) |
| same with `--adaptive` | OK; delay 4 → 9 frames at frame 16, then steady; 28 stalls (1.0 s, mostly the rejoin's save load) |
| `--phase4 --ws --worker` (two processes, WebSocket on localhost) | OK: `0f94f0e2daf617c7` at frame 3000 on both; 16 checks, 0 mismatches; the AI ran the seat from frame 398, back at 2404 = the rejoined peer's first input frame |
| **Linux x64 host ↔ macOS arm64 client over Tailscale** (`p4host` under this PC's Electron 44.4.5 as Node, in-thread; `p4client` under the Mac app's Electron 44.4.5 as Node, worker mode; a temp folder on the Mac, removed after) | OK: **`e3bf9b50290083db` at frame 3000 on both** (Electron's V8, so not Node's digest: §9); 16 checks, 0 mismatches; the drop, the AI takeover, the rejoin with a 0.67 MB save and the return at frame 2404 as above |
| `scripts/lockstep-demo.mjs` (WebSocket, Phase 3 scenario) | OK: digests match at frame 3780, 73 checks, the injected desync repaired, the joiner 10/10 |

**Two desktop apps on this PC** through the real UI (each on its own virtual Wayland compositor, real GPU through
ANGLE / Vulkan, profiles via `DWU_USER_DATA_DIR`; menu → Multiplayer → lobby → Start; seed 4242, 120 stars, 2x; orders
from both sides every 2 s; digests compared while paused at the same game time):

| Scenario | Host worker, client in-thread (rejoins in the worker) | Host in-thread, client worker (rejoins in-thread) | Both in the worker, adaptive delay on |
|---|---|---|---|
| S1 a worker-mode session, 36 s with renames, waypoints and a refused hijack | `b59b344e4c4f3ec9` at 54,016 game ms on both; 37 checks, 0 mismatches | `79dc2ef04097c962` at 71,266 ms; 37 checks, 0 mismatches | `3d376c7adcbb41e0` at 53,566 ms; 37 checks, 0 mismatches; delay 4 → 3 |
| S2 the client's app is killed; the host clicks Continue Without Them; 10 s idle; the client restarts and rejoins with Join Game (by token) | `9517d7de8a66483a` at 97,666 ms; 56 checks, 0 mismatches | `c2f64f21a4c377ee` at 125,633 ms; 53 checks, 0 mismatches | `fc2c4deadc165c44` at 97,216 ms; 56 checks, 0 mismatches |
| S3 the client's network drops; the host clicks AI Takes Over; 25 s of AI; the client clicks Rejoin | `78cb16375975a7cd` at 164,000 ms; 74 checks, 0 mismatches; the AI seat back to the human on both | `48feb26544404ce4` at 170,200 ms; 70 checks, 0 mismatches | `1f1d287d206e4262` at 162,966 ms; 74 checks, 0 mismatches |

(An in-thread app needs its window on screen: a hidden or occluded window gets no animation frames, its sim stops,
and the session waits for it. The worker keeps stepping.)

Also: `npm run repin -- --check --workers 1` = 0; `npm run typecheck`; the sim-worker, replica and desktop-shell vitest
files (25 files, 172 tests) pass.

## 15. Internet play without a server

**Decision (2026-10-10, the user):** no central relay or server of ours. Each game's traffic flows only between that
game's own players: the earlier "relay first" plan is dropped. The host's PC stays the hub of the star (§8), as on a
LAN. Each client has one WebRTC data channel to the host; the channel carries the same text messages as the WebSocket
link, so the lobby, the version check and the lockstep session do not change.

### 15.1 What is built

| File | What |
|---|---|
| `src/net/rtcTransport.ts` | **The WebRTC `Link`**: one reliable, ordered, pre-negotiated `RTCDataChannel` (id 0; a channel the other side opens in-band is closed at once). Messages are cut into frames of at most 16 K characters, because Chromium limits a data channel message to 256 KB. The first character of a frame says whether more frames follow. Sending waits on `bufferedAmount` (4 MB high, 512 KB low mark), so a save cannot overflow Chromium's 16 MB send buffer. A message over 64 MB, a bad frame or binary data closes the link with a reason, which the other side receives too. A connection that stays "disconnected" for 15 s, or "failed", closes the link, and rejoin (§12) takes over. **The codes**: `compactSdp` / `expandSdp` keep only what the other side needs (ICE ufrag and pwd, the sha-256 DTLS fingerprint, the DTLS role, the UDP candidates) and rebuild a full SDP from it. `encodeCode` packs these into binary (the ufrag / pwd base64-decoded, IPv4 in 4 bytes), deflates them when that is shorter, and writes base64url after a prefix: `DWI` = invite, `DWR` = reply, then `1` = raw or `Z` = deflated. **`RtcInvite`** (host): one peer connection per invite, with a random 32-bit tag that the reply must carry. An invite accepts one reply only. `close()` makes the code worthless. **`answerInvite`** (joiner). `rtcLinkPath(link)`: the selected ICE pair. |
| `src/ui/multiplayer/internetUi.ts` | `InternetHost`: the invites from the lobby into the game. The lobby's **invite board** has one row per invite: the code with **Copy**, a box for the reply code with **Connect**, and the state. A new row opens when one connects. A link that opens goes to whatever answers the host's connections at that moment (`netEndpoint().onIncoming`): the lobby, and in the game the rejoin gate. **Rejoin widgets** in the host's banner: a fresh invite for each absent player. `openCodeJoin`: the joiner's dialog. `fallbackHelp`: the text shown on failure. `window.__dwuRtc` (scripts): `paths()` gives the ICE path of each open link. |
| `src/ui/multiplayer/multiplayerApp.ts` | The Multiplayer screen: **Host on the Internet**, **Join by code…**, and the box "Open the port on my router automatically (UPnP / NAT-PMP)" (off by default). The lobby shows the board, the direct-IP addresses and the port-mapping result. The rejoin gate and the client's Rejoin also work by code (`INTERNET_ADDRESS`). The chip says "Internet host / client". **Adaptive input delay** (§13) is on by default when hosting on the Internet (its own setting, `dwu.mp.adaptiveDelayInternet`). |
| `src/net/lobby.ts` | `decodeHello`: before the version check, the first message must be a `lobbyHello` of at most 64 KB with a sane shape. Anything else is refused and the link is closed. The running game's rejoin gate uses the same check. |
| `desktop/portMapper.cjs`, `desktop/netHost.cjs`, `gamePreload.cjs` | Fallback (b): `dwuDesktop.net.mapPort()` asks the router to forward the host's TCP port to this PC. It is a minimal implementation with no dependency: UPnP IGD (SSDP M-SEARCH, then SOAP `AddPortMapping` / `GetExternalIPAddress` / `DeletePortMapping` on the WANIPConnection / WANPPPConnection service) and NAT-PMP (RFC 6886, UDP 5351 on the default gateway). It asks for a 1-hour lease, renewed every 20 min, so a router drops the mapping by itself if the app dies. The mapping is removed in `stopHost`, when the page goes away, and before the app quits (`before-quit` waits up to 3 s). A carrier-grade-NAT or private router address is reported as such. |
| `desktop/main.cjs` | `--disable-features=WebRtcHideLocalIpsWithMdns`: ICE uses this PC's real LAN / VPN addresses instead of random mDNS names, which resolve only on one LAN segment and not over Tailscale. The addresses reach only the players a code is given to. |

**Signalling is the players themselves.** The host's invite code is its SDP offer, with ICE candidates gathered in
advance (no trickle). The joiner pastes it and gets a reply code (its answer), which goes back the same way, e.g.
over Discord. The joiner adds the host's candidates only after its own gathering finished: Chromium stops gathering
early, before the STUN answer, once a candidate pair to the remote works (on a LAN at once), and the reply would then
lack the public address. Gathering ends when it is complete, or 0.6 s after a public (srflx) candidate arrived with
nothing new since, or after 5 s. A code carries at most 2 public addresses (one per IP) and 4 LAN / VPN addresses:
home LAN ranges first, then CGNAT / Tailscale (100.64/10), then IPv6. The 172.16/12 addresses (Docker / VM bridges)
are left out when the PC also has a 192.168 or 10.x address.

**NAT traversal.** Public STUN servers (`stun.l.google.com:19302`, `stun.cloudflare.com:3478`, `stun1.l.google.com:19302`)
tell each side its public address. They see no game traffic. **No TURN**: TURN would relay the game.

**Code lengths** (measured): **95–114 characters** for a typical home PC (one public address, a LAN address, a
Tailscale address), 148 with an IPv6 address, 86 with no public address. Deflate does not help such short random data,
so these codes are raw.

### 15.2 How to play

1. **Host:** Multiplayer → your name → **Host on the Internet**. The lobby shows "Invite 1" with a code
   (`DWI1…`). Click **Copy** and send it to one player.
2. **Joiner:** Multiplayer → **Join by code…** → paste the invite → **Create Reply Code** → **Copy**, and send the reply
   (`DWR1…`) back. The dialog says "Waiting for the host to enter it…".
3. **Host:** paste the reply in the invite's row → **Connect**. The row goes "Connecting…" → "Connected", the player
   is in the lobby, and the next invite row opens. Each further player gets their own invite.
4. From here on it is the LAN game of §10: the version / data check, the lobby, Game Settings / Load Saved Game, Start,
   pause, speed, the adaptive delay, saves, desync resync, AI takeover.
5. **A drop:** the host's banner offers AI Takes Over / Continue Without Them, as on a LAN, and shows **a new invite
   code for each absent player**. The player clicks **Rejoin** (or, after restarting the app, Multiplayer → Join by
   code), pastes that code and sends back the reply. The host pastes it in the banner, and the player gets their slot
   back (by token or name), with the current save.

The states the screens show: host row "Preparing the code…" → "Waiting for the reply code" → "Connecting…" →
"Connected", or "Failed: …" with the fallbacks and a **New Invite Code** button. Joiner: "Send this reply code to the
host. Waiting for the host to enter it…" → "Connected". After 45 s without a connection, the joiner sees what to do if
the host has already entered the code; the joiner gives up after 5 minutes.

### 15.3 When no direct connection is possible

Without a relay, some pairs of networks cannot connect: both routers do symmetric NAT, some carrier-grade NAT, or a
firewall drops UDP. This is the TURN trade-off: TURN would connect these pairs, but it would route the game through a
server, which this design does not use. The host sees "Failed: no direct connection within 30 seconds…" (or at once,
when ICE reports failure), and both screens list the fallbacks:

- **(a) Direct IP:** the host forwards TCP port 47610 (or the port they set) on their router, and the player uses
  "Join a game" with the host's public address. "Host on the Internet" also opens the LAN WebSocket port for this.
- **(b) Automatic port mapping:** the host ticks "Open the port on my router automatically" before hosting. The lobby
  then shows "Router port opened (NAT-PMP): players anywhere can join by IP with 173.178.142.9:47611", or why not. The
  PC's own firewall must also let the port in.
- **(c) Tailscale** (or another VPN): LAN play with the host's Tailscale address. The invite codes also carry the
  Tailscale address, so a code join between two Tailscale PCs connects over it.

### 15.4 Security

- Message sizes are bounded: frames of at most 16 K characters, messages of at most 64 MB (as on the WebSocket server),
  and a first message (the lobby hello) of at most 64 KB.
- Before the version check, only a well-formed `lobbyHello` is read. Any other first message is refused and the link is
  closed, in the lobby and in the running game's rejoin gate.
- Codes are single-use: each invite has its own peer connection and tag. A second reply, or a reply for another or an
  older invite, is refused. When hosting stops, every open invite is closed, and its code no longer connects. At Start,
  the lobby's unused invites are withdrawn.
- Nothing but the game protocol: one data channel, no in-band channels (closed at once), no media. The page only
  makes outgoing STUN requests. DTLS encrypts the channel, and the fingerprints in the codes authenticate both ends.
  The host still checks fingerprints and authorizes every command (§10).

### 15.5 Tests (2026-10-10)

Two Electron apps (`DWU_USER_DATA_DIR` profiles, each on its own `kwin_wayland --virtual`, real GPU through ANGLE /
Vulkan, nice 19), driven over CDP through the real UI. The host clicks Host on the Internet, the joiner clicks Join by
code; the invite and the reply are copied from one UI's text field into the other. Seed 4242, 120 stars, 2×, renames
and waypoints from both sides every 2 s, and one refused hijack. The digests are compared while paused at the same
game time.

| Run | Result |
|---|---|
| This PC ↔ this PC, a minute (adaptive delay on) | connected 258 ms after the reply was entered (ICE path host ↔ host 192.168.1.8). **`f9026e2ea2c1469b` on both**, 65 checks, 0 mismatches, 124 commands applied on each |
| Same, the host enters the reply only 75 s after it was made | connected 11 ms after it was entered (the joiner's early ICE checks do not spoil the connection) |
| Rejoin by code: the client's links drop, the host clicks AI Takes Over, then the client clicks Rejoin and the codes are exchanged through the host's banner | back 2.2 s after the reply (1.1 MB save over the channel); the seat goes back to the human; **`cada3a7bd01f9cfd` on both**, 45 checks, 0 mismatches |
| **Linux host ↔ Mac client** (the Mac: a copy of its dwu.app with this build, Electron 44.4.5, in-thread sim), with the Tailscale address in the codes | ICE chose host 100.106.232.94 ↔ host 100.114.187.94 (Tailscale). **`c89ed31b7f9cfdef` on both**, 62 checks, 0 mismatches |
| **Linux ↔ Mac across the Internet** (the codes carry only the public STUN addresses: test hook `dwu.mp.publicOnly`), fixed delay 4 | ICE: srflx 173.178.142.9 ↔ srflx 146.70.168.83 (two different networks). **`6808f0035809b71b` on both**, 59 checks, 0 mismatches; ping 124–175 ms, so delay 4 stalled a lot (27 s of 60) |
| Same with the adaptive delay | **`523b03728f58ce4d` on both**, 63 checks, 0 mismatches; the delay moved between 4 and 7; 4.8 s of stalls |
| The link alone (two connections in one page) | round trip 0.10 ms median; a 5.2 M-character message with emoji and accented characters at frame edges arrives intact, in order, in 247 ms; a 65 MB message closes both ends with "a message over 64 MB"; a second reply to a used invite is refused |
| Failure path (the joiner gathers no candidates: test hook `dwu.mp.blockIce`) | the host's row: "Failed: no direct connection within 30 seconds…", the three fallbacks and New Invite Code; the joiner shows the fallbacks after 45 s |
| Port mapping (this PC's router) | UPnP: no SSDP answer (most likely this PC's firewall, ufw, drops the replies). **NAT-PMP: mapped TCP 47611 → 192.168.1.8:47611**, public 173.178.142.9, and **removed when the lobby closed** (router result 0). From the Mac's network the port did not answer: this PC's firewall (ufw) does not let it in |
| `npm run repin -- --check --workers 1` | 0 pins would change |
| `scripts/lockstep-demo.mjs` (WebSocket) and `--phase4` | OK, both |
| vitest: the sim-worker and desktop-shell files (19 files) | 126 passed |

There is no WebRTC in Node, so the lockstep demo does not test this transport; WebRTC is tested in Electron only.

### 15.6 Around it (next)

~~Host migration~~ (§16), ~~chat~~ (§19); a deeper desync hash with the first divergent frame logged.

## 16. Phase 5: host migration

**Before:** the host leaving ended the game for everyone ("Lost the connection to the host"). **Now** the remaining
players agree on a new host, which becomes the hub of the star with the state every peer already has, the others
reconnect to it at once, and the game goes on with matching digests. The old host can rejoin as a player.

### 16.1 The protocol (`src/net/lockstep.ts`, `multiplayerGame.ts`)

- **Who.** The host names the **successor**: the lowest lobby slot among the connected players (deterministic). It
  tells everyone on the side channel (§19.1: `succ` with the successor and the other connected players, the
  *members*), on every change and every 5 s.
- **Backup links, opened ahead.** The successor opens one WebRTC data channel to each member *while the host is still
  there*: its invite code goes to the member through the host (side message `mOffer`), the member's reply comes back
  the same way (`mReply`). No copy-paste and no server: the host relays the codes. A LAN game's backup links use no
  STUN server (only the PCs' own LAN / VPN addresses: host candidates, so Tailscale works too); an Internet game's use
  the public STUN servers as its invites do (§15). A desktop successor also opens a LAN port and says where
  (`succAddr`: its IPv4 addresses and the port): the address players without a backup link, and the old host, rejoin
  at.
- **The host goes** (it quits: `bye`; or its links break: a crash, a network failure). A client's session no longer
  ends (`LockstepOptions.migratable`): it keeps everything and waits (`orphaned`; no frame runs past what it holds).
  - Each **member** reports to the successor over its backup link (`MigrateMsg`: its peer id, resync epoch, frame and
    every input it holds — any peer's — from 240 frames back) and waits for the answer, sending nothing meanwhile.
  - The **successor** waits for the first report (none needed without members), then becomes the hub
    (`promoteToHost`): its clock and input-delay changes count from the first frame it has not sent (`hosts`: who was
    the hub from which frame — the clock of frame F is read from the input of `hostPeerAt(F)` only, so a late input
    of the old host cannot move the clock). It merges every report (inputs are immutable: the first copy is kept) and,
    once every member with an open backup link reported (or after 10 s), **cuts the stream of every peer that did not
    report — the old host first — at the first frame nobody holds an input of theirs for** (`leftFrom = knownThrough
    + 1` over the merged inputs). No survivor can have run a frame past that cut (it would have needed that input), so
    every survivor ends up with exactly the same inputs. It answers each with `MigratedMsg` (the hub and its first frame,
    the peer list with the cuts, the inputs a survivor may lack, its epoch) and the session goes on: digests are
    compared by the new hub from the next boundary.
  - The old host's seat is then an absent player on the new host (§12): the game pauses, and the new host chooses **AI
    Takes Over** (the primary human's seat can now be AI-run too: `setAiSeat`) or **Continue Without Them**.
- **Safety.** A successor that hears no report within 20 s assumes it was the one cut off and shows the host as lost
  instead (a player whose own network failed must not fork the game of the others); a member whose report gets no
  answer within 30 s gives up the same way. A report that reaches a successor whose host is still there is refused
  after 20 s (only that member lost its link: it rejoins the host as in §12). With two players there is no third
  party: if the host's network (not the host) failed, both go on alone (the usual split; either can rejoin the other).
- **The old host rejoins** as a player, as any dropped player (§12): its slot is free on the new host (by lobby name),
  it gets the current save in the welcome, and the AI hands its empire back at the frame its input starts. After a
  deliberate quit its Join Game box already holds the successor's address (it heard `succAddr`); after a crash the new
  host's chip says where ("LAN host · rejoin at 192.168.1.8:43877"). In an Internet game the new host's banner shows a
  fresh invite code for each absent player (§15), the old host's too.
- **Several migrations.** The new host names its own successor at once, so the game survives the next host leaving too.

**Trade-off (Internet, no server).** The alternative to backup links — the new host shows fresh invite codes and every
player pastes one — costs a code exchange per player at the worst moment, and a WebRTC code needs both sides online
and pasting. Backup links cost one idle data channel per member to the successor (no traffic but ICE keep-alives) and
a few small side messages per minute, and they make the migration take well under a second with nothing to paste. The
fresh codes remain as the fallback: for a player whose backup link failed, for the old host, and for anyone who joins
later. What cannot be covered without a relay: two players whose networks cannot connect directly at all (§15.3) — the
same pair would also have failed to connect through codes.

### 16.2 In the app

| File | What |
|---|---|
| `src/ui/multiplayer/sideChannel.ts` | **The side channel**: `SideHub` taps every session link (`HandoffLink`'s new `filter`): `{"t":"side",…}` messages never reach the lockstep session (so they cannot change a digest). The hub stamps the sender's slot and relays to one player or all; each message ≤ 4 KB; a token bucket per link (30, +4/s). |
| `src/ui/multiplayer/migration.ts` | `Migration`: the host's succession announcements; the successor's invites and LAN port; the members' answers; on `hostLost`, the take-over (successor: `promote` + `acceptMigrant` for each open backup link) or the report (member: `migrateTo`), and the fallbacks. |
| `src/ui/multiplayer/multiplayerApp.ts` | Wires both into the running game; the new host's rejoin gate, LAN port and (Internet) invite board; the banners ("The host left the game. Alice takes over as the host: reconnecting…"; the old host, cut off: "Rejoin Alice's Game"); the chip's "rejoin at …"; `rejoinGame` tries each of the new host's addresses. |
| `src/ui/multiplayer/mpHandle.ts`, `src/simworker/workerLockstep.ts`, `protocol.ts` | `promote` / `acceptMigrant` / `migrateTo` / `hostSlot` in both modes (worker: `mpCall 'promote'`, `netLink` with `mode: 'migrant' | 'newHost'`); `mpStart.role` (the lobby's host, slot 0, can now be a client); `__dwuMp.log()` (the worker session's last log lines). |
| `src/net/multiplayerGame.ts` | `promote`, `acceptMigrant`, `migrateTo`, status `migrating`; the role follows the session; the hub's slot is not always 0 (`hostSlot`, `rejoinSlotFor`, `slotAuthorizer(…, hostPeer)`: only the hub of the command's frame may hand seats to the AI). |

Two fixes found on the way (worker mode, any LAN game): the main thread adopted the worker's clock in two writes to a
bound clock, so the first posted a half-updated clock (the new pause with the old speed) — which a host's session took
for a speed request, and the speed could flip between two values (`clientCore.ts`); and `SimHost.clock` in a lockstep
game now passes on only the field the HUD changed (`simHost.ts`). Another peer's commands applied in a paused frame now
reach the replica at once (they did only at the next unpaused step).

## 17. Phase 5: the lobby's settings matching

- **What is shown.** The lobby lists the host's theme (the DW:U customization set — its own data and mods) and the
  add-on set of the host's game settings: every scenario package that runs (by name, the ones it pulls in included)
  and the choice's switches and values (`LobbyState.host`, `LobbyAddonSet`).
- **The version check stays strict.** A different protocol, version, build or JS engine is still refused (they compute
  another game: §9).
- **A soft difference is not a refusal** (`fingerprintDifference`: the theme, the add-on files, the game data). The
  host answers `lobbyMismatch` and keeps the link open; the joiner sees a panel with what differs and **Match Host
  Settings**, which switches the joiner's theme to the host's *for this session* (the stored choice stays; it comes
  back on leaving: `deps.matchTheme` / `restoreTheme`), reloads the data and says hello again (at most 5 tries).
- **What is missing, exactly.** When the data or add-on files differ with the same theme, the host sends its per-file
  hashes and the joiner's panel lists the files missing here, different from the host's, and only here. When the host's
  settings use an add-on package this app does not have, the joiner's lobby names it ("This app does not have the
  add-on package the host's game uses: Themed names for AI empires (themed-names)…"), the joiner's row carries it
  (`lobbyPick.missing`) and the host's Start is blocked with the reason ("Clienty does not have the add-on package
  themed-names."). A theme that is not installed is named ("You do not have the host's theme …: it is a folder in
  Customization\ …").
- Test hook: `localStorage['dwu.mp.hideAddon'] = '<id>'` makes this app act as if it lacked that package.

## 18. Phase 5: diplomacy between human players

Decision §4.9 holds: the AI never decides for a human. Until now the Diplomacy screen's proposals to another human were
answered by that empire's AI evaluation (`evaluateProposal`'s desired-relation tests). Now (`src/sim/player/humanDiplomacy.ts`):

- **Offers.** A proposal that needs the other human's consent becomes an offer: treaties (free trade, mutual defense,
  protectorate), peace (`WAR_END`), subjugation demanded or offered, a request for release, gifts, demands (the three
  warnings: the answer is a reply only — a human moves their own ships), and trades from the trade panel (any items,
  peace or lifting sanctions for a price). The sender sees "Offer sent — awaiting their reply." (talk panel / trade
  panel); the receiver gets a popup (`src/ui/screens/humanOffers.ts`): who offers what — a trade's two lists —, the game
  time left, **Accept / Reject / Counter…** (counter: decline and the Diplomacy screen opens on the sender, to propose
  something else). The sender is told the outcome (accepted, rejected, countered, expired, no longer possible).
- **What acts at once** (no consent needed, as before): declare war, cancel a treaty, impose or lift sanctions, release
  a dominion, mining / refuelling rights. The AI's quick swaps ("Swap maps or tech"), add-on proposal kinds and pirate
  deals are greyed out between humans ("use Negotiate a trade proposal…").
- **Deterministic.** Everything is a journaled player command: the offer is made when the sender's `submitProposal` /
  `submitTradeOffer` applies (every peer adds the same offer at the same frame); the answer is the receiver's new
  `answerHumanOffer` (and the sender's `withdrawHumanOffer`); an accepted offer's effect is applied by that command, at
  its frame, on every peer, through the same code an AI's acceptance runs (`evaluateProposal(…, humanAccepted)` skips
  only the AI's tests and their random draws; a trade's items change hands with `giveTradeableItem` both ways). The
  option is resolved again when accepted (a treaty no longer possible fails, a gift at the amount offered).
- **Timeout:** 6 game minutes (`HUMAN_OFFER_TIMEOUT_MS`), read from galaxy time when a command touches the list (there
  is no tick of its own); the popup shows the time left. A newer offer of the same kind replaces a pending one.
- **Hot seat:** the offer waits in the galaxy until its receiver's turn: the popup shows only for the local viewer, and
  comes up after the curtain.
- **State.** The offers are the save side table `humanOffers` (`humanOfferTable.ts`), written only once an offer was ever
  made (its id counter must travel in a resync or join save), so every other game saves the same text. The replica gets
  it at once (the sim worker freshens it on every change; the replica applies it on the next delta), not with the slower
  side-table cycle.

## 19. Phase 5: chat

- **Lobby chat** (`lobbyChat` lobby messages) and **in-game chat** (side channel kind `chat`, §19.1): to everyone or
  privately to one player (the "To" list). `src/ui/multiplayer/chatPanel.ts`: in the lobby a box in the window; in the
  game a small dark glass box at the lower left, above the chip, hidden until wanted — **Enter** opens it with the
  cursor in the line (Enter sends; an empty line or Escape closes it); the "Chat" button shows the unread count, and a
  line that arrives while it is closed shows for 6 s as a notice (click it to open the chat).
- **Not sim state:** chat never enters the lockstep session (the tapped links take it off), so it cannot change a digest.
  It follows a host migration (the new hub relays it).
- **Bounded:** 400 characters a line, no control characters; a burst of 5 lines then one a second per sender (checked on
  the sender and again by the hub, which drops the excess); a side message of more than 4 KB is dropped.
- Scripts: `window.__dwuChat` (`lines()`, `open(bool)`, `dropped()`), `__dwuMpLobby.chatLines()`.

### 19.1 The side channel

`SideHub` (`sideChannel.ts`) carries what is not simulation over the session's own links: chat and the host-migration
signalling (`succ`, `succAddr`, `mOffer`, `mReply`). A tapped link (`HandoffLink` with a `filter`) hands every
`{"t":"side",…}` message to the hub before the lockstep session reads it, in both modes (in worker mode the main thread
taps before relaying). The hub stamps `from`, relays to `to` (a slot) or everyone (-1), and checks a per-kind `allow`
(chat's own rate limit).

## 20. Phase 5: tests (2026-10-10)

`scripts/lockstep-demo.mjs --phase5` (scratch flags, not a test): three players over the in-memory transport through
`MultiplayerGame`; the host quits (`bye`; `--drop`: its links break) with commands in flight; Alice (the successor)
promotes itself, Bob reports over a backup link; the AI takes the old host's seat (`--idle`: it stands idle); they play
on; the old host rejoins as a client by name with no game of its own; all three final digests must match.

| Run (seed 1, 150 stars, 4 empires, 4x) | Result |
|---|---|
| `--phase5` | OK: migrated in 2 ms; the old host's stream cut at frame 336 (it had sent through 336); **`4e971b46cb75e6b7` on all three at frame 1858**; 35 checks on the new host, 0 mismatches; the old host's ship renamed after its rejoin on every peer |
| `--phase5 --drop` / `--drop --latency 40` | OK: the same final digest `4e971b46cb75e6b7` (a crash and a quit cut at the same frame here) |
| `--phase5 --idle` | OK: `bed1b4b98a646744` on all three |

**Real UI** (Electron apps on this PC, each on its own `kwin_wayland --virtual`, real GPU through ANGLE / Vulkan,
`DWU_USER_DATA_DIR` profiles, nice 19, each in `systemd-run --user --scope -p MemoryMax=5G -p MemorySwapMax=1G`; driven
over CDP through the menus, the lobby, the game menu, the Diplomacy screen, the trade panel, the popups and the chat;
seed 4242, 120 stars, 2x; renames and waypoints from every player every 2 s; digests compared while paused at the same
game time; all three apps in worker mode):

| Scenario | Result |
|---|---|
| **Host migration, LAN, the host quits** (three apps on 127.0.0.1; 15 s of play; the host: Escape → Exit to Main Menu → Yes) | before: `3e9e11a236f50725` on all three at 28,133 game ms. **Migrated in 0.58 s** (Alice the hub from frame 1230, the old host cut at frame 1229, Bob reported 729 inputs); the banner "Hosty disconnected (the host left)…", Alice clicks AI Takes Over; 20 s more: **`5f1955d6348ca4d5` on Alice and Bob** at 70,900 ms (speed 2 kept). The old host: Multiplayer → Join Game (its box already held `192.168.1.8:38069`, the successor's) → back as a client in 2 s, its empire handed back; **`b67a78930db583e3` on all three** at 86,366 ms |
| **Host migration, LAN, the host's app is killed** (SIGKILL) | migrated in 0.61 s; **`00bdf16ae4b6de3c` on Alice and Bob** at 56,366 ms; the old host restarted (the crash lost its unsaved storage), typed the address from Alice's chip ("LAN host · rejoin at 192.168.1.8:43877"), rejoined; **`968b2bdcce20b8b2` on all three** at 69,233 ms |
| **Host migration, Internet codes** (the three joined by invite / reply codes; adaptive delay on; the host quits) | migrated in 0.60 s over the pre-opened WebRTC backup link; **`805ed28de4ed27c4` on Alice and Bob** at 80,333 ms; the old host rejoined with a fresh code from Alice's banner (Join by code); **`d64217ce5e7a86a1` on all three** at 104,100 ms |
| **Chat** (in those runs) | Alice → Bob privately (Enter, To Bob, Enter): Bob sees "Alice→2: psst bob, only you", the host does not; Bob → everyone: all three; after the migration Bob's line reaches Alice through the new hub. Two apps: lobby chat ("hello from the lobby" at the host); in-game the host's line shows on the client with the notice "Hosty: gl hf from the host"; 12 lines at once from the client: 5 reach the host (the burst) |
| **Settings mismatch** (two apps; the joiner's stored theme "Lower Speed and Range", the host's the stock game) | the joiner's panel: "Theme: the host plays "Default", you have "Lower Speed and Range" active. Match Host Settings switches…"; **Match Host Settings → in the lobby in 1 s** (its stored theme unchanged). The host's settings with the add-on package themed-names while the joiner hides it (`dwu.mp.hideAddon`): the joiner's lobby "This app does not have the add-on package the host's game uses: Themed names for AI empires (themed-names)…", the host's Start blocked: "Clienty does not have the add-on package themed-names."; cleared when it has it |
| **Diplomacy between the two humans** (the Diplomacy screen, F5 → Speak with → Change relationship → Propose Free Trade Agreement) | the host's talk panel "Offer sent — awaiting their reply."; the client's popup "Leanna Confederacy proposes: Free Trade Agreement. Expires in 6:00 (game time)" → **Reject**: state rejected, relation None on both; again → **Accept**: **Free Trade on both** |
| **A trade offer** (the client: Negotiate a trade proposal… → its territory map for the host's → Would you accept this trade?) | the client's trade panel "Offer sent — awaiting their reply."; the host's popup "Wekkarus Alliance proposes a trade. You receive: Territory Map. You give: Territory Map." → **Reject** (rejected), again → **Accept** (accepted); the four offers in the same states on both; **`c8f52eecac433c76` on both** at the end |

Also: `npm run repin -- --check --workers 1` = 0; `scripts/lockstep-demo.mjs` (WebSocket), `--phase4` and `--phase5`
OK; `npm run typecheck`; vitest: the sim-worker, diplomacy, trade, save-runtime and UI-write files (30 files, 251 tests) pass.

## 21. Phase 5 leftovers (2026-10-11)

- **The new host takes over the adaptive input delay** (§13). The hub's welcome now carries its adaptive settings
  (`WelcomeMsg.adaptive`); a client keeps them, and `promoteToHost` switches the adaptive delay on with them, measured
  afresh from the new hub (its round trips start empty; the running delay stays until the new measurements move it).
- **Two players and the host's link breaks.** A client's session now learns whether the host said goodbye
  (`bye`: it quit) before its link closed (`onHostLost(reason, deliberate)`, `MultiplayerStatus.hostLost.deliberate`).
  With no other player to ask (§16: no members, no backup link), a quit hands the game over at once as before; a broken
  link does **not**: the client waits (its session is orphaned, so no frame runs) and its banner offers **Reconnect**
  (rejoin the host, §12) or **Take Over** (`Migration.takeOverAlone`: promote, the old host's seat becomes absent),
  with the warning that taking over while the host plays on splits the game. The host's banner says the other player
  waits and chooses. The 20 s give-up of a lone successor does not apply while it waits for the choice.
- **Your own pending offers** (`humanOffers.ts`): while this player has pending offers, a "Your offers (N)" button sits
  under the offer popups; it opens the list — to whom, what (a trade's two lists), the game time left — with
  **Withdraw** on each (the journaled `withdrawHumanOffer`).
- **Chat history and mute** (`chatPanel.ts`). A multiplayer save keeps the last 100 lines this player saw, by lobby
  names (`GameSaveJSON.multiplayerChat`, just before `multiplayer`; `savedMultiplayerChat`); loading it as host shows
  them greyed in the lobby chat and then in the game chat ("— earlier in this game —"). **Mute…** in the chat head lists
  the other players: a muted player's lines are not shown here (nothing is sent; by lobby name, kept in localStorage
  `dwu.mp.muted`).
- **Hot-seat offers in the real UI** (driven: §25). The flow works as designed; the only thing that "broke" was the test
  driver of §20 (it waited for `__dwu.game` and tested the fixed curtain's `offsetParent`, which is always null).

## 22. Joining a running game as a new player

Before, a connection to a running game that was not a dropped player coming back was refused. Now (the reverse of AI
takeover, §12):

1. The new player clicks **Join Game** (or Join by code) as usual. The host's rejoin gate runs the same checks as a
   rejoin (a well-formed hello, then the strict version / build / engine / theme / data check, §10.3); a name that is
   already playing is refused, and so is a full game (8 players).
2. The host answers `lobbyJoinOffer`: the empires nobody plays (`joinChoicesFor`): every active AI empire with a
   colony (not the independents, no pirate faction) and every human seat without a player. The joiner's screen lists
   them (name, race, colonies, AI or free seat); it picks one: `lobbyJoinPick`.
3. The host gives it a new lobby slot and a rejoin token, hands the link to the session (`acceptNewPlayer`: the
   current save comes in the welcome, §8) and sends `lobbyRejoin` with the start and `joining: { slot, empireId }`
   (the joiner's screen shows that empire until the seat is mapped; `myEmpireOf`; never read by the command check).
4. **The agreed frame.** When the new peer is admitted, the hub issues the journaled `addHumanSeat(slot, name)` for the
   empire; it rides on the hub's next input, the frame the new peer's input starts from. At that frame, on every peer,
   the empire becomes a human seat (`humanEmpires.ts addHumanSeat`: appended to the seats, or a seat handed back from
   the AI; the player's difficulty factors apply) and the session maps the slot to it (`MultiplayerStart.players`,
   `seatJoined`), so the AI runs the empire up to that frame and the player from then on. Only the hub may issue it
   (`slotAuthorizer`), for an empire no slot plays.

Worker mode: `netLink { mode: 'join', join }`; the main thread's copy of the start follows the worker's seats. The
saves carry the new player like any other (by seat). Single-player: the op exists but does nothing outside a
multiplayer game (repin 0).

## 23. Multiplayer saves and Resume

- **The Load list** marks a multiplayer game's saves (and autosaves): the index entry gets the players' names
  (`SaveEntry.players`, from `setSaveEntryTagger` while a session runs) and the row says "— Multiplayer: Hosty,
  Clienty, Newbie". A **Multiplayer saves only** box filters the list. (Saves made before this have no tag.)
- **Resume Multiplayer Game** (main menu, under Multiplayer): the Multiplayer screen with a note; Host Game (LAN) or
  Host on the Internet opens the lobby straight on the save picker, filtered to multiplayer saves. The lobby lists the
  save's human empires with who played them; each player rejoins **by token** — the save keeps every player's rejoin
  token by human index (`multiplayer.tokens`), and a player whose app kept its token for that host address
  (`dwu.mp.rejoin`) says hello with it — or **by name**. The token a player came back with stays theirs.

## 24. Debug hooks are dev-only

`window.__dwuMp`, `__dwuMpLobby`, `__dwuRtc`, `__dwuChat`, `__dwuOffers` and the localStorage test switches
(`dwu.mp.blockIce`, `dwu.mp.publicOnly`, `dwu.mp.hideAddon`) exist only behind the dev flag
(`src/ui/multiplayer/devHooks.ts`): a dev build (`npm run dev`), the desktop app started with **`DWU_DEV_HOOKS=1`**
(the shell passes `--dwu-dev-hooks` to the game window; `dwuDesktop.devHooks`), or `?devHooks=1` in the page URL.
Test scripts start their apps with `DWU_DEV_HOOKS=1`. A release build without it has none of them (checked: §25).

## 25. Tests (2026-10-11)

`scripts/lockstep-demo.mjs --phase5` now also lets a fourth player (Carol) join the running game after the migration,
taking over an AI empire with no game of her own, and checks her seat on every peer, its frame (= her first input
frame), her rename and the four final digests; `--adaptive` checks that the new hub took over the adaptive delay.

| Run (seed 1, 150 stars, 4 empires, 4x) | Result |
|---|---|
| `--phase5` | OK: Carol takes over Ugnari Corporation at frame 1864 = her first input frame, on all four peers; **`699f47c61436eb7e` on all four at frame 2284**; 59 checks on the new host, 0 mismatches |
| `--phase5 --adaptive` / `--drop` / `--idle` | OK (the new hub's adaptive delay on, with the old host's on) |
| `lockstep-demo.mjs` (WebSocket), `--memory`, `--phase4`, `--phase4 --worker`, `--phase4 --worker --idle`, `--phase4 --ws --worker` | OK, all (`--phase4 --ws --worker`: `36584c83d1761558` at frame 3000 on both) |

**Real UI** (Electron apps on this PC, each on its own `kwin_wayland --virtual`, real GPU through ANGLE / Vulkan,
`DWU_USER_DATA_DIR` profiles, `DWU_DEV_HOOKS=1`, nice 19, each in `systemd-run --user --scope -p MemoryMax=5G -p
MemorySwapMax=1G`; driven over CDP through the menus, the lobby, the banners, the chat, the game menu and the save
picker):

| Scenario | Result |
|---|---|
| **Hot seat** (one app, in-thread; a new game with one extra human) | Player 1's curtain and founding line ("Human Empire founded at Nobea 5"); an event for player 2 during player 1's turn is held (not shown to player 1, not behind player 2's curtain), shown after player 2's curtain; player 2's ticker shows its own founding line ("Second Seat founded at Isisenie"). Player 1 proposes Free Trade on the Diplomacy screen ("Offer sent — awaiting their reply."), **Your offers (1)** lists it, **Withdraw** → withdrawn; proposes again; no popup on player 1's turn; Switch Player → curtain → player 2's popup "Human Empire proposes: Free Trade Agreement." → **Accept** → Free Trade |
| **LAN, three apps, worker mode** (seed 4242, 120 stars, 4 AI empires, 2x, adaptive delay on, orders from every player every 2 s) | Two players: `567bc292f9ba8c10` on both. **Mute**: the client mutes Hosty, the host's next line is dropped there (1 muted line). **Split**: the host's links break; the client stays a client, waits (paused, `hostLost` 5 s later), banner Reconnect / Take Over; **Reconnect** → back; `829c337d5ffef7d2` on both. **New player**: Newbie joins the running game, is offered the 4 AI empires, takes over Atuuk Alliance (a seat on every peer); `32af81cbaab02e67` on all three. **Save** (Save Game As): index entry `players: [Hosty, Clienty, Newbie]`. **Migration** (the host quits): the client is the hub, the adaptive delay goes on there (delay 15, wanted 6); `06568550f2fd86b9` on both survivors. **Resume**: everyone at the main menu; the host's Resume Multiplayer Game → the picker shows only "mp-resume — Multiplayer: Hosty, Clienty, Newbie"; the lobby shows the saved chat; Clienty and Newbie join and get their empires back (claims 1, 2); the game chat shows the history; `16a79e5752726fd1` on all three |
| **No dev flag** (one app without `DWU_DEV_HOOKS`, localStorage `blockIce` / `publicOnly` set) | `dwuDesktop.devHooks` false; no `__dwuMp`, `__dwuMpLobby`, `__dwuChat`, `__dwuOffers`, `__dwuRtc`; the invite code is a normal one (114 characters, LAN addresses in it: the switches are ignored) |

**Four players, a big galaxy** (four apps on this PC in worker mode, LAN 127.0.0.1, adaptive delay on; seed 9001,
requested 1,400 stars and 16 AI empires on the largest preset size; 2x; renames and waypoints from every player every
2 s; the Mac was asleep, so four local apps): built on all four in 8.5 s; **digests equal at the start
(`34da50a25a8e7ee6`) and after 6 minutes (`6f263bc9a7137ae6`, game ms 667,366, frame ~21,000)**; 1,026 digest checks
on the host, 0 mismatches, 0 resyncs, 1,192 commands applied on every peer.

| | |
|---|---|
| Frame pace | 59.0 frames/s average (minimum 52 over a 7 s window), game speed 1.90x of the wanted 2x |
| Input delay (adaptive) | 15–19 frames (each app's main thread and sim worker share a niced, busy PC: round trips of 200–300 ms) |
| Stalls | the host 5.7%, the clients 4.7%, 3.6% and 1.7% of the time while all four run freely |
| The slowest peer | p4 squeezed onto one CPU core for 72 s: the frame pace held (57 frames/s, minimum 46), but the **other three** stalled 3–4× as much (the host's stall count +480 in that minute vs. +180 before: they wait for p4's inputs), while p4 itself barely stalled; back to normal within a minute of the release |
| Memory | about 1.15–1.29 GB per renderer (plus each app's sim process) |
| Event pop-ups | an event pop-up on any peer paused everyone then: 8 such pauses in 6 minutes (the test dismissed them and resumed); no longer (§27) |

A first 6-minute run on a smaller galaxy (the default size caps the star count) also ended equal on all four
(`2a7fdc6ebd6bdd61`), with the game paused by an event pop-up for its second half (frames ran on at 60/s).

Also: `npm run repin -- --check --workers 1` = 0; `npm run typecheck`; `npm run check:player-empire`; vitest (the
battle-report, hint-subject, galactic-history, AI advisor, LLM strategic, replica, save, save panel, main menu,
message-feed, desktop-shell and sim-worker files: 30 files, 260 tests) pass.

## 26. What is left

- A peer that cannot reach the successor at all gets no backup link: it rejoins by address or code (the fallback).
- Battle reports per human were checked by the existing tests (one human: unchanged) and by reading, not in a real
  multi-human battle.
- Human-to-human diplomacy: the AI's "Swap maps or tech" quick deals and the add-ons' proposal kinds are not offered
  between humans.
- A per-human handicap.
- The Windows laptop has not run the phase 5 flows (migration, joining in progress); Linux ↔ Mac has (§27).
- The deep digest (§27) hashes each object's own primitive fields only: nested objects (cargo, components, designs,
  diplomatic relations) are seen through array lengths, not their contents.

## 27. Non-pausing pop-ups, the deep digest, Linux ↔ Mac (2026-10-11)

- **Event pop-ups no longer pause a multiplayer game.** Before, an event pop-up (or any screen window with
  AutoPauseWhenInPopupWindow) on any peer paused everyone (8 pauses in 6 minutes in §25's four-player run). Now, while
  a LAN / Internet game runs, `autoPause.ts` leaves the shared clock alone (`setAutoPauseSuppressed(multiplayerActive)`):
  the player sees the pop-up while the game runs on. The pause button and the Escape menu still pause (they ask the
  host). Single player and hot seat: unchanged.
- **The deep digest** (`sim/tick/digest.ts deepDigest`). The pinned `stateDigest` stays as it is (the seed pins). With
  every digest (every 60 frames) each peer also sends a per-subsystem deep digest — `core` (the galaxy's own fields, the
  scheduler, the Rnd state), `empires`, `pirates` (+ the independents), `habitats`, `ships`, `creatures` — hashing every
  own primitive field of each object (null / undefined absent, -0 as 0, NaN alike, array fields by length),
  order-independently per object (a save loaded in another process builds its objects with their fields in another
  order: an order-dependent hash differed after every join). The costly lists (habitats, ships) go in 5 rotating
  slices (`deepParts`, index ≡ part mod 5), so all of them are covered every 300 frames. The host compares the
  sections and logs which differ and since when: `desync: peer 1 at frame 960, after frame 900 (…); deep: empires
  differ`. A deep-only difference (the pinned digest agrees) resyncs that client once (`desync (deep)`); one that a
  fresh save does not cure is reported, not resynced again, until a full round of deep checks passes.
  `LockstepStats.deepChecks / deepMismatches / deepTaken / deepMsTotal / deepMsMax`; `DigestDetail` on `onDigest`.
- **Cost** (seed 1, 300 stars, 12,060 habitats, 565 ships, this PC): the whole deep digest 16 ms, one slice of 5:
  4 ms, per 60 frames (the pinned digest itself: 9.5 ms); 0.07 ms per frame on average. In the real apps (120 stars):
  1.4–1.7 ms average per digest on Linux, about 3 ms on the Mac (in-thread).
- **The multiplayer dock.** The status chip and the Chat button were stacked over the selection panel (bottom left).
  Now they sit in one 20 px row at the bottom of the screen just right of the selection panel (`placeDock`, from the
  scaled `.sel-frame`), in the HUD's grey glass look; the chip shows a short line (`LAN host · 3P · 62 ms`) and the
  full line on hover or click; the chat window and its notice open above the row.

`scripts/lockstep-demo.mjs` now prints the deep stats; its default run checks that the injected money desync is put
down to `empires` and that no deep-only mismatch occurred.

| Run (seed 1, 4 empires, 4x) | Result |
|---|---|
| default (WebSocket, 1 minute, injected desync) | OK: detected at frame 960 "after frame 900; deep: empires differ"; 18 deep checks, 0 deep-only mismatches; 8.8 ms per deep digest on average there (two sims in one niced, busy process) |
| `--phase4 --worker` (rejoin with a save, worker client) | OK: 16 deep checks, 0 deep-only mismatches |
| `--phase5` (migration + Carol joins with a save) | OK: 59 deep checks, 0 deep-only mismatches |

**Linux x64 ↔ macOS arm64, real UI** (LAN mode over Tailscale: Linux 100.106.232.94, the Mac 100.114.187.94; two
Electron apps on this PC on `kwin_wayland --virtual`, real GPU through ANGLE / Vulkan, worker mode; the Mac: a copy
of its dwu.app with this build in a temp folder, in-thread sim, removed afterwards; `DWU_DEV_HOOKS=1`; seed 4242, 120
stars, 4 empires, 2x, adaptive delay; renames and waypoints from every player every 2 s; digests compared while paused
at the same game time):

| Step | Result |
|---|---|
| A. Hosty (Linux host) + Clienty (Linux) | `b778148b75c43ef3` on both at 33,933 game ms; 20 deep checks, 0 deep-only mismatches |
| B. **Macy (the Mac) joins the running game as a new player** (Join Game at 100.106.232.94; offered the AI empires; takes Atuuk Alliance from frame 1342) | **`1ff2272f0e80d030` on all three** at 70,066 ms; 58 checks, 0 mismatches, 0 deep-only, 0 resyncs |
| C. **Migration: the Linux host quits** (Clienty the successor; the Mac follows over its backup link) | migrated 1.8 s after the click (menu included); **`14752b1ffb245a27` on Clienty and the Mac** at 109,366 ms |
| D. **Migration: Clienty quits** → **the Mac takes over** (alone; its chip "rejoin at 192.168.1.231:64134") | 1.1 s |
| E. **The old host rejoins the Mac-hosted game** (Join Game at the Mac's Tailscale address and that port; macOS's firewall let it in) | **`ad8bc28a88e4df05` on the Mac and Hosty** at 155,466 ms |
| F. **A new player joins the Mac-hosted game** (the second Linux app as "Newbie", takes Sollost Supremacy from frame 5424) | **`f9900efcff5b75e3` on all three** at 189,466 ms; on the Mac host 56 checks, 0 mismatches, 0 deep-only |
| Deep digest cost | 1.4–1.8 ms per digest on Linux (worker), 2.9–3.0 ms on the Mac (in-thread); at most 5.5 ms |
| The dock | screenshots on both: [Chat] [LAN host · 3P · 118 ms] in one row right of the selection panel; hover / click: the full line |

A first run (before the deep digest was made order-independent) showed the reason for it: after the Mac's join by
save every deep check of `core` and `ships` differed (fields in another order on the joiner), with equal pinned
digests; one deep resync each time, as designed, and no loop.

Also: `npm run repin -- --check --workers 1` = 0; `npm run typecheck`; `npm run check:player-empire`; vitest
`autoPause.test.ts` (a forced event pop-up leaves the clock running while suppressed; single player unchanged).
