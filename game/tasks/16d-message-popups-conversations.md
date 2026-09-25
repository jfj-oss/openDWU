# Task 16d — Message popups, diplomatic conversation queue, and Game Options (O): Automation + message options

thinking: off
scope: locked

Edit only these files:
- a new `src/ui/messageRouting.ts` (pure: categories, options, routing)
- a new `src/ui/messagePopups.ts` and a new `src/ui/messagePopups.css` (popup card, conversation queue, conversation dialog)
- a new `src/ui/screens/gameOptionsPanel.ts` and a new `src/ui/screens/gameOptionsPanel.css`
- `src/ui/empireMessageFeed.ts`: only the TODO line, one import line and one `[16d]` block (step 4)
- `src/ui/keyboard.ts`: only the three `[16d]` hook blocks below (one import line, one `dispatchKey` case, one `IMPLEMENTED_KEY_ACTIONS` line)
- `src/main.ts`: only the three `[16d]` blocks below (one import line, one install block, one cleanup block)
- new `test/messageRouting.test.ts`, `test/messagePopups.test.ts` and `test/gameOptionsPanel.test.ts`

Do NOT edit anything under `src/sim/`. Only import from it (read-only). This task makes three kinds of write, all of which the original UI makes itself:
- Accept / Decline of a treaty offer, through 15a's `acceptProposal` / `declineProposal` (the same sim path as the Diplomacy screen);
- the player empire's `control*` automation fields, which are plain fields set by the C# options panel (Main.Part6.cs:2524-2539);
- UI-only option state.

Do not edit `src/ui/hud.ts` (16a, 16b and 16c do). Do not edit `test/empire-message-feed.test.ts`: it must pass unchanged. Three other agents edit `keyboard.ts` and `main.ts` at the same time. Put each hook exactly at the anchor given, wrapped in `[16d]` / `[/16d]` marker comments. Do not reformat, reorder or "tidy" neighbouring lines. Start editing right away.

After this task:
- Every message the sim queues for the player is routed like the original's `ReceiveMessageInternal` (Main.Part9.cs:1572):
  - **Important messages pop up.** One popup card at a time, top-right under the money panel. A new popup replaces the old one; ✕ closes it.
  - **Diplomatic messages that start a conversation go into a queue.** It is a column of sender chips, top-left under the top-left bar. Clicking a chip opens the conversation dialog. A treaty proposal the player can still answer shows **Accept Offer** / **Decline**; anything else shows **OK**, which dismisses it.
  - A declaration of war, an end-of-war proposal, a call for mutual-defense help, a trade threat or demand, and a pirate extortion open the dialog **immediately**, as in the original (unless "Suppress all pop-up screens" is on).
  - The ticker (14a) honours each category's "Scrolling Messages" option.
- **O** opens a streamlined **Game Options** panel with two groups:
  - **Automation**: the player empire's 16 `control*` settings. A 3-level select (Control manually / Suggest … / Fully automate) or a checkbox, applied immediately.
  - **Messages**: the per-category **Popup** and **Scrolling** checkboxes, plus "Suppress all pop-up screens".

Why this matters: at HEAD the player's diplomacy is fully automated (`controlDiplomacyTreaties = FullyAutomated`, empire.ts:647), so `considerTreatyProposals` answers offers before the player can. Switching **Treaties** to "Control manually" here makes offers stay until the player answers them in the queue (or they expire after 0.2 years, 15a `isProposalValid`).

House style: the panels copy `src/ui/screens/coloniesList.ts` (module-level `open` state, `toggle…` / `close…`, a document `keydown` Escape handler with `stopImmediatePropagation`). Put pure helpers in `messageRouting.ts` so tests need no DOM (vitest has no jsdom).

## Existing code you use (read-only; verified at HEAD fe566ad)

- `src/sim/messages.ts`:
  - `enum EmpireMessageType` (C# order);
  - `class EmpireMessage` with `description`, `messageType`, `sender: Empire | null`, `hint`, `title`, `money`, `supressPopup` (sic), and getter `subject`;
  - `empireMessages(empire)`.
  - A `DiplomaticRelationType` subject is a plain number (`typeof subject === 'number'` is the C# `Subject is DiplomaticRelationType`).
  - A BuiltObject / Habitat subject is the real instance (`instanceof BuiltObject` from `src/sim/builtObject.ts`, `instanceof Habitat` from `src/sim/types.ts`).
  - The `OfferTrade` subject is either `[offered: TradeableItem[], requested: TradeableItem[]]` or a single `TradeableItem` (src/sim/tradeItems.ts: `class TradeableItem { type: TradeableItemType; item; value }`, `enum TradeableItemType { …, TerritoryMap, GalaxyMap, …, ThreatenWar, …, ThreatenTradeSanctions, …, ResearchProject, … }`).
  - The sim empties the queue in `processMessages` (every ~30 s of game time), so poll often and dedupe by identity (`WeakSet`), like `createEmpireMessageFeed` in `src/ui/empireMessageFeed.ts`.
  - `processMessages` (diplomacyTick.ts:3006) already applies a `GiveGift` to the recipient (money, evaluation, civility), so the UI must **not** repeat the C# UI's gift side effects.
- `src/sim/diplomacy.ts`: `DiplomaticRelationType`, `DiplomaticRelation` (`type`, `initiator`), `DiplomaticRelationList.byEmpire(e)`, and `DiplomaticRelationList` / `DiplomaticRelation` constructors (for tests).
- `src/sim/empire.ts`:
  - `enum AutomationLevel { Undefined, PartiallyAutomated, FullyAutomated }`, the TS names of C# `{ Manual, SemiAutomated, FullyAutomated }` (same values 0/1/2);
  - `Empire` fields: `controlMilitaryAttacks`, `controlColonization`, `controlColonyTaxRates`, `controlStateConstruction`, `controlDesigns`, `controlDiplomacyGifts`, `controlDiplomacyOffense`, `controlDiplomacyTreaties`, `controlMilitaryFleets`, `controlTroopGeneration`, `controlAgentAssignment`, `controlResearch`, `controlColonyFacilities`, `controlPopulationPolicy`, `controlCharacterLocations`, `controlOfferPirateMissions`.
    - The `boolean` ones: TaxRates, Designs, MilitaryFleets, TroopGeneration, Research, PopulationPolicy, CharacterLocations.
    - The others are `AutomationLevel`.
  - The sim reads these through `checkTaskAuthorized` (diplomacyTick.ts:389 / logistics/orders.ts:734). For the player, SemiAutomated returns false (the AdvisorSuggestion prompt is a TODO in the sim), so "Suggest …" behaves like manual for now. No path throws.
- `src/ui/screens/diplomacyScreen.ts` (15a, exported):
  - `isProposalValid(proposal, other, player, starDate)`, `proposalLabel(type, current, player)`, `relationTypeLabel(type)`;
  - `acceptProposal(player, other): boolean`, the port of EmpireDetailView.cs:803;
  - `declineProposal(player, other): boolean`, the port of Main.Part10.cs:3930 method_235.
- `src/sim/tick/simTime.ts`: `galaxyStarDate(galaxy)`. `src/sim/galaxyTime.ts`: `resolveStarDateDescription(starDate)`.
- `src/ui/toast.ts`: `showToast(text)`. `src/ui/hud.ts`: `rgbCss(rgb)` (import it; hud.ts itself is not edited).
- `src/ui/empireMessageFeed.ts`: `formatEmpireMessage(message, player)`, which `test/empire-message-feed.test.ts` covers. Its fake empires are `{ name, messages }` only, so any relation lookup must use optional chaining (`player?.diplomaticRelations?.byEmpire(...)`).
- `src/ui/screens/empireSummary.ts`: `getEmpireSummarySource(): { empire } | null` (keyboard.ts already imports it).
- HUD layout (src/ui/hudLayout.ts): `pnlTopLeftBar` is at (10, 10, 300×40) and `pnlMoney` at (width − 240, 10, 230×100). So the popup sits at `top: 120px; right: 10px` and the queue column at `top: 60px; left: 10px`.

## C# source (verbatim, trimmed)

Main.Part9.cs:1521 `method_252(message, popupOption, messageOption, ref bool_, ref bool_2)` sets `bool_ = true` when `popupOption` is true, and `bool_2 = true` when `messageOption` is true. `bool_` means "show the popup", `bool_2` means "add to the ticker". Both start false. The `default:` case sets only `bool_2 = true`.

The switch Main.Part9.cs:1580-2346, condensed into a table. `Cat` means `method_252(message, DisplayPopup<Cat>, DisplayMessage<Cat>)`. `conv X` means `conversationOption = new ConversationOption(DialogPartType.X, …)`. `rel` means `PlayerEmpire.DiplomaticRelations[message.Sender]`.

Diplomatic messages. When the subject is not a `DiplomaticRelationType`, nothing is set (so there is no popup and no ticker). A subject type with no case (NotMet) also sets nothing.

| Message (line) | Subject → result |
|---|---|
| DiplomaticRelationChange (1586) | **None**: `rel == null` → Treaty. Otherwise by `rel.Type`: TradeSanctions → conv TRADESANCTIONS_LIFT, WarTrade; War → conv WAR_END, WarTrade; Truce → WarTrade; *default* → by `message.Hint.ToLower()` contains, first match: "trade sanctions" → TRADESANCTIONS_LIFT; "war" → WAR_END; "free trade" / "mutual defense" / "protectorate" → CANCELTREATY; "subjugated" → SUBJUGATION_RELEASE (all WarTrade); else CANCELTREATY, Treaty. **FreeTradeAgreement** → FREETRADE_ACCEPT, Treaty. **MutualDefensePact** → MUTUALDEFENSE_ACCEPT, Treaty. **SubjugatedDominion** → SUBJUGATIONDEMAND_ACCEPT, WarTrade. **Protectorate** → PROTECTORATE_ACCEPT, Treaty. **TradeSanctions** → TRADESANCTIONS_IMPOSE, WarTrade. **War** → WAR_DECLARE, WarTrade. **Truce** → WarTrade. |
| ProposeDiplomaticRelation (1694) | **None**: `rel == null` → Treaty. Otherwise: SubjugatedDominion → `rel.Initiator != PlayerEmpire` ? SUBJUGATION_RELEASE : SUBJUGATION_REQUESTRELEASE, WarTrade; TradeSanctions → TRADESANCTIONS_LIFT, WarTrade; War → WAR_END, WarTrade; Truce → WarTrade; *default* → CANCELTREATY, Treaty. **FreeTradeAgreement** → OFFER_FREETRADE, Treaty. **MutualDefensePact** → OFFER_MUTUALDEFENSE, Treaty. **SubjugatedDominion** → WAR_END_SUBJUGATIONDEMAND, WarTrade. **Protectorate** → OFFER_PROTECTORATE, Treaty. **TradeSanctions** → TRADESANCTIONS_IMPOSE, WarTrade. **War** → WAR_DECLARE, WarTrade. **Truce** → WarTrade. |
| AcceptDiplomaticRelation (1773) | **None**: `message.Description.ToLower()` contains "subjugation" → SUBJUGATION_RELEASE, else WAR_END_ACCEPT (both WarTrade). **FreeTradeAgreement** → FREETRADE_ACCEPT, Treaty. **MutualDefensePact** → MUTUALDEFENSE_ACCEPT, Treaty. **SubjugatedDominion** → SUBJUGATIONDEMAND_ACCEPT, WarTrade. **Protectorate** → PROTECTORATE_ACCEPT, Treaty. **TradeSanctions** → TRADESANCTIONS_IMPOSE, WarTrade. **War** → WAR_DECLARE, WarTrade. **Truce** → WarTrade. |
| RefuseDiplomaticRelation (1839) | **None**: `rel == null` → Treaty. Otherwise: SubjugatedDominion → SUBJUGATION_REFUSERELEASE, WarTrade; TradeSanctions → TRADESANCTIONS_LIFT, WarTrade; War → WAR_END_REJECT, WarTrade; Truce → WarTrade; *default* → CANCELTREATY, Treaty. **FreeTradeAgreement** → FREETRADE_REJECT, Treaty. **MutualDefensePact** → MUTUALDEFENSE_REJECT, Treaty. **SubjugatedDominion** → SUBJUGATIONDEMAND_REJECT, WarTrade. **Protectorate** → PROTECTORATE_REJECT, Treaty. **TradeSanctions** → TRADESANCTIONS_IMPOSE, WarTrade. **War** → WAR_DECLARE, WarTrade. **Truce** → WarTrade. |

(Treaty = DiplomacyTreaty, WarTrade = DiplomacyWarTradeSanctions.)

The other messages:

| Message (line) | Result |
|---|---|
| StopMissionsAgainstUs (1918) | conv WARNING_INTELLIGENCEMISSIONS, RequestWarning |
| StopAttacks (1922) | conv WARNING_ATTACKS, RequestWarning |
| RemoveColoniesFromSystem, LeaveSystem (1926) | RequestWarning |
| RequestJointWar / RequestJointTradeSanctions / RequestStopWar / RequestLiftTradeSanctions (1930-1957) | `if (PlayerEmpire.ControlDiplomacyOffense != FullyAutomated)` conv WAR_DECLARE_REQUESTJOINT / TRADESANCTIONS_REQUESTIMPOSEJOINT / WAR_END_REQUESTOTHER / TRADESANCTIONS_REQUESTLIFTOTHER; always RequestWarning |
| GiveGift (1958) | conv GIFT_GIVE, DiplomacyGift (the C# UI then applies the gift. The TS sim's processMessages already does: do **not** port that) |
| Informational (1974) | `bool_ = false; bool_2 = true` |
| ShipBasePurchased (1979) | `return;` (nothing at all) |
| NewColony, NewColonyFailed (1981) | NewColony |
| BattleAttacking (1985) | RequestWarning |
| IncomingEnemyFleet (1988) | UnderAttackColoniesSpaceportsDefensiveBases |
| EmpireDiscovered (1991), EmpireDefeated (1994) | DiplomacyEmpireMetDestroyed (EmpireDefeated of the player also ends the game: TODO) |
| RequestHonorMutualDefense (2021) | conv MUTUALDEFENSE_REQUESTHELP, WarTrade |
| BlockadeInitiated, BlockadeCancelled (2029) | WarTrade |
| ExplorationRuins/BuiltObject/Habitat/Location, GalacticHistory (2033) | Exploration |
| SellInfoUnmetEmpire / IndependentColony / SystemMap / Ruins / DebrisField / RestrictedArea / PlanetDestroyer (2040-2074) | conv INFO_OFFER_UNMETEMPIRE / INFO_OFFER_INDEPENDENTCOLONY / INFO_OFFER_SYSTEMMAPS / INFO_OFFER_RUINS / INFO_OFFER_DEBRISFIELD / INFO_OFFER_RESTRICTEDAREA / INFO_OFFER_PLANETDESTROYER; `bool_ = false; bool_2 = true` |
| PirateOfferProtection (2075) | `Hint.ToLower() == "extort"` → DiplomacyTreaty, conv PIRATE_EXTORTPROTECTION, `bool_ = true`; else conv (price > 0 ? PIRATE_PROTECTIONPROPOSEINITIATE : PIRATE_TRUCEPROPOSEINITIATE), `bool_ = false`; always `bool_2 = true` |
| CancelPirateProtection (2093) | conv `Sender == null \|\| Sender.PirateEmpireBaseHabitat == null` ? CANCELPIRATEPROTECTION : CANCELPIRATEPROTECTIONPIRATE; `bool_ = false; bool_2 = true` |
| Revolution (2098) | ColonyInvaded |
| RestrictedResourceDiscovered (2102), RestrictedResourceTradingAllowed/Blocked (2105; the C# rewrites the description: TODO) | Exploration |
| OfferTrade (2138) | subject `object[]` → `requested` contains ThreatenWar or ThreatenTradeSanctions ? DEAL_THREAT : (`offered.Count != 0` ? DEAL_OFFER : DEAL_DEMAND); subject TradeableItem → by `Type`: ResearchProject → OFFER_DEAL_COMPONENT, TerritoryMap → OFFER_DEAL_TERRITORYMAP, GalaxyMap → OFFER_DEAL_GALAXYMAP, other → OFFER_DEAL_TERRITORYMAP; both set `bool_ = false; bool_2 = true`. Any other subject: nothing |
| ShipMissionComplete (2171) | ShipMissionComplete |
| ShipNeedsRefuelling, ShipNeedsRepair (2174) | ShipNeedsRefuelling |
| RemoveForcesFromSystem (2178) | RequestWarning, conv WARNING_REMOVEFORCESSYSTEM, `bool_ = false; bool_2 = true` |
| GeneralWarning (2187) | RequestWarning, conv WARNING_GENERAL, `bool_ = false; bool_2 = true` |
| GeneralBadEvent/NeutralEvent/GoodEvent/Decision (2193) | Exploration |
| HistoryOfferLocationHint / HistoryOfferStoryClue / StoryMessage (2199/2205/2220) | conv HISTORY_OFFER_LOCATIONHINT / HISTORY_OFFER_STORYCLUE / HISTORY_OFFER_STORYMESSAGE; `bool_ = false; bool_2 = true` |
| ColonyFacilityCompleted/Cancelled, ColonyWonderBegun, ColonyShipMissionCancelled (2211/2217) | NewColony |
| AdvisorSuggestion (2226) | added to the queue as DialogPartType.Undefined; `bool_ = false; bool_2 = false` (advisor queue: TODO) |
| MilitaryRefuelingAllowed/Blocked, MiningRightsAllowed/Blocked (2232) | DiplomacyTreaty |
| CharacterAppearance/Death/MissionAccomplished/MissionFailure/SkillTraitChange (2238) | IntelligenceMissions |
| ResearchBreakthrough, ResearchCriticalBreakthrough, ResearchCriticalFailure (2245) | ResearchNewComponent |
| GalacticNewsNet (2250) | DiplomacyTreaty |
| BattleUnderAttack, ShipBaseBoardedCaptured, ShipBaseBoardedLost (2253) | subject BuiltObject, by SubRole: Escort/Frigate/Destroyer/Cruiser/CapitalShip/TroopTransport/Carrier/ResupplyShip → UnderAttackMilitaryShips; ExplorationShip → UnderAttackExplorationShips; ColonyShip/ConstructionShip → UnderAttackColonyConstructionShips; Small/Medium/LargeFreighter, PassengerShip, GasMiningShip, MiningShip → UnderAttackCivilianShips; GasMiningStation/MiningStation → UnderAttackCivilianBases; ResortBase/GenericBase/Energy/Weapons/HighTechResearchStation/MonitoringStation → UnderAttackOtherStateBases; Small/Medium/LargeSpacePort, DefensiveBase → UnderAttackColoniesSpaceportsDefensiveBases (any other sub-role: nothing). Subject Habitat → UnderAttackColoniesSpaceportsDefensiveBases. Else nothing |
| PirateAttack/Defend/Smuggling Mission Available/Completed/Failed (2311-2318) | RequestWarning |
| PirateSmugglerDetected (2322) | UnderAttackColoniesSpaceportsDefensiveBases |
| ShipBaseCompleted, ShipBaseScrapped (2325) | BuiltObjectBuilt |
| ConstructionResourceShortage (2330) | ConstructionResourceShortage |
| RaidBonuses, RaidVictim (2334) | ColonyInvaded |
| ColonyGained/Lost/Defended/Rebelling/Destroyed, PlanetaryFacilityDestroyed/Damaged (2339) | ColonyInvaded |
| anything else (`default:`, incl. Undefined) | `bool_2 = true` |

Main.Part9.cs:2349-2415, the tail:
```cs
bool flag = true;
if (gameOptions_0 != null && gameOptions_0.SuppressAllPopups) flag = false;
if (flag && ((bool_ && !message.SupressPopup) || bool_2)) method_0(effectsPlayer_0.ResolveMessage(message.MessageType));   // sound
if (conversationOption != null) {
    method_0(effectsPlayer_0.ResolveImportantMessage());
    message.StarDate = _Game.Galaxy.CurrentStarDate;
    switch (conversationOption.Type) {
        default: diplomaticMessageQueue_0.AddMessage(message, conversationOption); diplomaticMessageQueue_0.ExpireInvalidMessages(message); break;
        case DialogPartType.DEAL_DEMAND: case DialogPartType.DEAL_THREAT: case DialogPartType.MUTUALDEFENSE_REQUESTHELP:
        case DialogPartType.WAR_DECLARE: case DialogPartType.WAR_END: case DialogPartType.PIRATE_EXTORTPROTECTION:
            if (flag) method_254(conversationOption);    // opens the conversation dialog now; NOT queued
            break;
    }
    bool_ = false; bool_2 = true;
}
if (bool_ && !message.SupressPopup) { /* pnlMessagePopup.Ignite(…, message); slides in from the right; replaces the previous popup */ }
if (bool_2) { lstMessages.AddItem(empty, message); … }
```
Note: SuppressAllPopups does not block `pnlMessagePopup`. It blocks only the sound and the immediate dialogs, and an immediate dialog suppressed this way is **dropped** (it is not queued).

Main.Part9.cs:2711 `method_260`, the option defaults. Every `DisplayMessage*` is `true`. Every `DisplayPopup*` is `true` except:
```cs
gameOptions_0.DisplayPopupBuiltObjectBuilt = false;
gameOptions_0.DisplayPopupShipMissionComplete = false;
gameOptions_0.DisplayPopupShipNeedsRefuelling = false;
```
`SuppressAllPopups` defaults to false. There are 21 categories (Game.cs:71-127): BuiltObjectBuilt, DiplomacyGift, DiplomacyTreaty, DiplomacyWarTradeSanctions, DiplomacyEmpireMetDestroyed, DiplomacyRequestWarning, NewColony, ColonyInvaded, ResearchNewComponent, IntelligenceMissions, Exploration, ShipMissionComplete, ShipNeedsRefuelling, ConstructionResourceShortage, UnderAttackCivilianShips, UnderAttackCivilianBases, UnderAttackExplorationShips, UnderAttackColonyConstructionShips, UnderAttackMilitaryShips, UnderAttackOtherStateBases, UnderAttackColoniesSpaceportsDefensiveBases.

The options panel's checkbox rows are Main.Part3.cs:934-972 (labels) and Main.Part6.cs:2406-2489 (bindings). Groups are "Popup Messages" and "Scrolling Messages" (Main.Part3.cs:1095-1096). Two rows drive two categories each: "Colony Gain or Loss" sets both ColonyInvaded and NewColony, and "Requests, Warnings and Gifts" sets both DiplomacyRequestWarning and DiplomacyGift. Each checkbox reads its first category. Row labels, in this order:
- 'New Ship Built' [BuiltObjectBuilt]
- 'Colony Gain or Loss' [ColonyInvaded, NewColony]
- 'Empire Discovery' [DiplomacyEmpireMetDestroyed]
- 'Requests, Warnings and Gifts' [DiplomacyRequestWarning, DiplomacyGift]
- 'Treaty offers' [DiplomacyTreaty]
- 'War and Trade Sanctions' [DiplomacyWarTradeSanctions]
- 'Research Breakthrough' [ResearchNewComponent]
- 'Intelligence Missions' [IntelligenceMissions]
- 'Exploration discoveries' [Exploration]
- 'Ship Mission Complete' [ShipMissionComplete]
- 'Ship Needs Refuelling or Repair' [ShipNeedsRefuelling]
- 'Construction Resource Shortage' [ConstructionResourceShortage]
- 'Under Attack - Civilian Ships'
- 'Under Attack - Civilian Bases'
- 'Under Attack - Exploration Ships'
- 'Under Attack - Colony & Construction Ships' (WinForms `&&` is a literal `&`)
- 'Under Attack - Military Ships'
- 'Under Attack - Research, Monitoring, Resorts' [UnderAttackOtherStateBases]
- 'Under Attack - Colonies & Spaceports' [UnderAttackColoniesSpaceportsDefensiveBases]

'Suppress all pop-up screens' is Main.Part3.cs:659.

Main.Part6.cs:2524-2539 applies the Automation group, and Main.Part6.cs:2544 `method_419` maps index 0/1/2 to Manual/SemiAutomated/FullyAutomated:
```cs
_Game.PlayerEmpire.ControlMilitaryAttacks = method_419(fYpVlWkAfp.SelectedIndex);
_Game.PlayerEmpire.ControlColonization = method_419(cmbOptionsControlColonization.SelectedIndex);
_Game.PlayerEmpire.ControlColonyTaxRates = chkOptionsControlColonyTaxRates.Checked;
_Game.PlayerEmpire.ControlStateConstruction = method_419(cmbOptionsControlConstruction.SelectedIndex);
_Game.PlayerEmpire.ControlDesigns = chkOptionsControlDesigns.Checked;
_Game.PlayerEmpire.ControlDiplomacyGifts = method_419(cmbOptionsControlDiplomacyGifts.SelectedIndex);
_Game.PlayerEmpire.ControlDiplomacyOffense = method_419(cmbOptionsControlDiplomacyOffense.SelectedIndex);
_Game.PlayerEmpire.ControlDiplomacyTreaties = method_419(cmbOptionsControlDiplomacyTreaties.SelectedIndex);
_Game.PlayerEmpire.ControlMilitaryFleets = chkOptionsControlFleets.Checked;
_Game.PlayerEmpire.ControlTroopGeneration = chkOptionsControlTroops.Checked;
_Game.PlayerEmpire.ControlAgentAssignment = method_419(cmbOptionsControlAgentMissions.SelectedIndex);
_Game.PlayerEmpire.ControlResearch = chkOptionsControlResearch.Checked;
_Game.PlayerEmpire.ControlColonyFacilities = method_419(cmbOptionsControlColonyFacilities.SelectedIndex);
_Game.PlayerEmpire.ControlPopulationPolicy = chkOptionsControlPopulationPolicy.Checked;
_Game.PlayerEmpire.ControlCharacterLocations = chkOptionsControlCharacterLocations.Checked;
_Game.PlayerEmpire.ControlOfferPirateMissions = method_419(cmbOptionsControlOfferPirateMissions.SelectedIndex);
```
The labels (Main.Part3.cs:613-633, 781-787, 928-933) and the select items (Main.InitializeComponent.cs:10915-11165, Main.Part3.cs:624-637):

| Field | Label | Middle option ("Control manually" / … / "Fully automate") |
|---|---|---|
| controlMilitaryAttacks | Attacks Against Enemies | Suggest attack targets |
| controlColonization | Colonization | Suggest new colonies |
| controlStateConstruction | Ship Building | Suggest new ships and bases |
| controlDiplomacyGifts | Sending Diplomatic Gifts | Suggest gifts to empires |
| controlDiplomacyOffense | War and Trade Sanctions | Suggest war and trade sanctions |
| controlDiplomacyTreaties | Treaties | Suggest new treaties |
| controlAgentAssignment | Intelligence Missions | Suggest offensive missions |
| controlColonyFacilities | Colony Facility Building | Suggest new colony facilities |
| controlOfferPirateMissions | Offer Pirate Missions | Suggest pirate missions |
| controlColonyTaxRates (checkbox) | Colony Tax Rates | |
| controlDesigns (checkbox) | Ship Design | |
| controlMilitaryFleets (checkbox) | Fleet Formation | |
| controlTroopGeneration (checkbox) | Troop Recruitment | |
| controlResearch (checkbox) | Research | |
| controlPopulationPolicy (checkbox) | Colony Population Policies | |
| controlCharacterLocations (checkbox) | Character Locations | |

DistantWorlds/DiplomaticMessageQueue.cs:321 `AddMessage(message, option)` appends. :300 `RemoveMessage(message)` drops one. :404 `ExpireInvalidMessages(newMessage)` removes older entries that the new message makes stale.

## Steps

1. `src/ui/messageRouting.ts` (pure; no DOM, no CSS, no import of diplomacyScreen)
   - Header comment: task 16d. Port of the Main.Part9.cs:1572 ReceiveMessageInternal routing, the Game.DisplayPopup*/DisplayMessage* options (Game.cs:71-127) and their defaults (Main.Part9.cs:2711 method_260). Add:
     - `// TODO(port): message sounds (EffectsPlayer.ResolveMessage / ResolveImportantMessage)`
     - `// TODO(port): advisor-suggestion queue entries (DialogPartType.Undefined, Main.Part9.cs:2226)`
     - `// TODO(port): EmpireDefeated of the player → Galaxy_GameEnd defeat (Main.Part9.cs:1994-2020)`
     - `// TODO(port): RestrictedResourceTrading* / PirateOfferProtection description rewrites (Main.Part9.cs:2075-2137)`
     - `// TODO(port): save the Display* options with the game (Game.cs) — session-only here`
   - Imports: `EmpireMessage`, `EmpireMessageType` from `../sim/messages`; `BuiltObject` (value) from `../sim/builtObject`; `Habitat` (value) from `../sim/types`; `BuiltObjectSubRole` from `../sim/builtObjectTypes`; `DiplomaticRelationType` from `../sim/diplomacy`; `AutomationLevel` and `type Empire` from `../sim/empire`; `TradeableItemType` and `type TradeableItem` from `../sim/tradeItems`.
   - `export enum MessageCategory { … }`: the 21 categories, in the order above.
   - `export type DialogPartType = 'CANCELTREATY' | 'TRADESANCTIONS_LIFT' | …`: a string union of every DialogPartType name in the two tables.
   - `export const IMMEDIATE_CONVERSATIONS: ReadonlySet<DialogPartType>`: DEAL_DEMAND, DEAL_THREAT, MUTUALDEFENSE_REQUESTHELP, WAR_DECLARE, WAR_END, PIRATE_EXTORTPROTECTION.
   - `export interface MessageOptions { popup: Record<MessageCategory, boolean>; ticker: Record<MessageCategory, boolean>; suppressAllPopups: boolean }`
   - `export function defaultMessageOptions(): MessageOptions` (method_260 defaults, a fresh object each call). Module state: `getMessageOptions()`, `setMessageOption(kind: 'popup' | 'ticker', category, value)`, `setSuppressAllPopups(v)`, `resetMessageOptions()`.
   - `export interface MessageClassification { category: MessageCategory | null; popup: boolean | null; ticker: boolean | null; conversation: DialogPartType | null; drop: boolean }`. `popup` / `ticker` are the explicit `bool_` / `bool_2` overrides from the table (null when the case does not set them).
   - `export function classifyEmpireMessage(message: EmpireMessage, player: Empire | null): MessageClassification`: the two tables, case by case.
     - `rel` is `player?.diplomaticRelations?.byEmpire(message.sender) ?? null` (null sender → null).
     - Hint and description tests use `.toLowerCase().includes(...)` (`=== 'extort'` for the pirate hint).
     - The PirateOfferProtection "price" is `message.money`. Add a comment: the C# calls `CalculatePirateProtectionPricePerMonth`, whose TS port calls `obtainPirateRelation` (a render-time write), so the message's money stands in.
     - `ShipBasePurchased` and `AdvisorSuggestion` → `drop: true`.
     - A diplomatic message without a numeric subject, a NotMet subject, or an unmatched BattleUnderAttack / OfferTrade subject → category null, `popup: false`, `ticker: false`.
     - The `default:` case → category null, `popup: null`, `ticker: true`.
   - `export interface MessageRoute { category: MessageCategory | null; popup: boolean; ticker: boolean; conversation: DialogPartType | null; immediate: boolean }`
   - `export function routeEmpireMessage(message: EmpireMessage, player: Empire | null, options: MessageOptions): MessageRoute`: method_252 + the tail.
     - `drop` → everything false/null.
     - Otherwise start from `popup = category !== null && options.popup[category]` and `ticker = category !== null && options.ticker[category]`, then apply the classification's explicit `popup` / `ticker` when not null. The table order matters: the explicit sets come after method_252 in the C#.
     - With a conversation: `popup = false`, `ticker = true`, and `immediate = IMMEDIATE_CONVERSATIONS.has(conversation)`.
     - Finally `popup = popup && !message.supressPopup`.
   - `export function shouldQueueConversation(route: MessageRoute, options: MessageOptions): 'queue' | 'open' | 'none'`: `'none'` without a conversation. For an immediate one: `'open'`, or `'none'` when `options.suppressAllPopups` (dropped, as in the C#). Otherwise `'queue'`.
2. `src/ui/messagePopups.ts` + `src/ui/messagePopups.css`
   - Header comment: task 16d. Popup card (Main.Part9.cs:2381 pnlMessagePopup), conversation queue (DiplomaticMessageQueue.cs) and conversation dialog (method_254). Add:
     - `// TODO(port): the original DialogPart conversation texts and reply options (Main.Part10.cs); here the dialog shows the message text with Accept/Decline for treaty offers and OK otherwise`
     - `// TODO(port): popup "go to subject" click (Main.Part9.cs:784 method_244)`
   - Imports: `./messagePopups.css`; `messageRouting` exports; `EmpireMessageType`, `empireMessages`, `type EmpireMessage` from `../sim/messages`; `type Empire`, `type Galaxy`; `galaxyStarDate` from `../sim/tick/simTime`; `resolveStarDateDescription` from `../sim/galaxyTime`; `isProposalValid`, `proposalLabel`, `relationTypeLabel`, `acceptProposal`, `declineProposal` from `./screens/diplomacyScreen`; `showToast` from `./toast`; `rgbCss` from `./hud`.
   - Pure helpers (exported, tested):
     - `export interface ConversationEntry { message: EmpireMessage; conversation: DialogPartType; sender: Empire | null }`
     - `export function isAnswerableProposal(entry, player: Empire, starDate: number): boolean`. True only when all of these hold:
       - `entry.message.messageType === EmpireMessageType.ProposeDiplomaticRelation`;
       - `entry.sender !== null`;
       - `p = player.proposedDiplomaticRelations.byEmpire(entry.sender)` exists;
       - `isProposalValid(p, entry.sender, player, starDate)`.
     - `export function pruneConversationQueue(queue: ConversationEntry[], player: Empire, starDate: number): number`: the ExpireInvalidMessages stand-in. It removes, in place, every ProposeDiplomaticRelation entry that is no longer answerable (the sim answered it, it expired, or the player answered it in F5), and returns how many it removed. Other entries stay until dismissed. Comment: `// Stand-in for DiplomaticMessageQueue.cs:404 ExpireInvalidMessages — TODO(port): the full per-type expiry rules`.
     - `export function conversationHeading(entry, player: Empire): string`. For an answerable proposal: `Treaty on Offer: ${proposalLabel(p.type, player.diplomaticRelations.byEmpire(sender), player)}`. For another numeric-subject message: `relationTypeLabel(subject)`. Otherwise `entry.message.title`.
     - `export function popupTitle(message: EmpireMessage): string`: `message.title || message.sender?.name || 'Message'`.
   - `export interface MessagePopupsOptions { player: Empire; galaxy: Galaxy }`
   - `export function installMessagePopups(opts)`. Idempotent: it first calls `removeMessagePopups()`. It creates, on `document.body`:
     - `.message-popup` (hidden) at `position: fixed; top: 120px; right: 10px; width: 335px`: a header with `popupTitle` + ✕, the body text (`white-space: pre-line`), and a footer star date;
     - `.message-queue` at `position: fixed; top: 60px; left: 10px`: a column of chips. Each chip has a 10px swatch in `rgbCss(sender.mainColor)` and the sender name (`'Message'` when null). At most 8 chips; then a `+N more` line.
     - A 250 ms interval. Each tick:
       1. For every message in `empireMessages(opts.player)` not yet seen (`WeakSet`, like createEmpireMessageFeed), compute `route = routeEmpireMessage(m, player, getMessageOptions())`. If `route.popup`, show it in the popup card (replacing the current one). Then `shouldQueueConversation(route, options)` decides: `'queue'` → push `{ message: m, conversation: route.conversation!, sender: m.sender }`; `'open'` → push it too, and open the dialog on it now.
       2. Then `pruneConversationQueue(queue, player, galaxyStarDate(galaxy))`. If the open dialog's entry was pruned, close the dialog.
       3. Re-render the chips.
     - The conversation dialog is a centred window like the other screens (`.message-conversation-window`) with:
       - the sender name with swatch as title, and `conversationHeading` below it;
       - `message.description` (`pre-line`);
       - buttons. For an answerable proposal: `Accept Offer` (→ `acceptProposal(player, sender)`, `showToast('Treaty accepted')`, remove the entry, close) and `Decline` (→ `declineProposal`, remove, close). Otherwise `OK` (remove, close).
       - Escape closes the dialog but keeps the entry (keydown handler with `stopImmediatePropagation`, only while the dialog is open).
   - `export function removeMessagePopups(): void`: clear the interval, remove the three DOM roots, empty the queue, drop the seen set. No-op when not installed.
   - CSS: dark-panel tokens like `coloniesList.css`, prefix `message-`. Chips are small pill buttons (pointer cursor, 1px border `rgba(255,255,255,0.2)`, 4px radius). The popup is `pointer-events: auto`. Keep `z-index` below the screens' windows (read coloniesList.css and use one less).
3. `src/ui/screens/gameOptionsPanel.ts` + `.css`
   - Header comment: task 16d, streamlined Game Options (O): the Automation group (Main.Part6.cs:2524-2560) and the Popup / Scrolling Messages groups (Main.Part3.cs:934-972, Main.Part6.cs:2406-2489). Add `// TODO(port): the rest of pnlGameOptions (display, sound, auto-save, encounters) — the Esc menu Options modal covers display/sound; semi-automated "Suggest …" needs the sim's AdvisorSuggestion prompt (diplomacyTick.ts checkTaskAuthorized TODO)`.
   - `export type AutomationField = 'controlMilitaryAttacks' | …` (the 16 fields).
   - `export interface AutomationRow { field: AutomationField; label: string; kind: 'level' | 'bool'; options?: readonly [string, string, string] }`
   - `export const AUTOMATION_ROWS: readonly AutomationRow[]`: the 16 rows, in Main.Part6.cs:2524-2539 order, with the labels and options from the table (`['Control manually', <middle>, 'Fully automate']`).
   - `export function automationValue(empire: Empire, row): number | boolean`: the field value (`AutomationLevel` as 0/1/2 for level rows).
   - `export function setAutomationValue(empire: Empire, row, value: number | boolean): void`: method_419. For level rows, `0 → AutomationLevel.Undefined` (Manual), `1 → PartiallyAutomated`, `2 → FullyAutomated`, any other value → Manual. Assign through a typed switch or a `Record` of setters; no `as any`.
   - `export interface MessageOptionRow { label: string; categories: readonly MessageCategory[] }` and `export const MESSAGE_OPTION_ROWS`: the 19 rows above, in that order.
   - `export function messageRowValue(options: MessageOptions, row, kind: 'popup' | 'ticker'): boolean`: `options[kind][row.categories[0]]`.
   - `export function setMessageRowValue(row, kind, value): void`: `setMessageOption` for every category of the row.
   - DOM:
     - `export interface GameOptionsPanelOptions { empire: Empire }`, `toggleGameOptionsPanel(opts)`, `closeGameOptionsPanel()`.
     - The window is titled `Game Options`, with two sections:
       - `Automation`: one line per row, the label plus a `<select>` (three options) or a checkbox. It shows the current value and applies it on `change`.
       - `Messages`: a small table with header cells (blank) | Popup | Scrolling, and one line per `MESSAGE_OPTION_ROWS` entry with two checkboxes. Below it, a `Suppress all pop-up screens` checkbox bound to `suppressAllPopups`.
     - No timer. The width is `720px`, with the two sections side by side (`grid-template-columns: 1fr 1fr`).
   - CSS: copy `coloniesList.css`, with the prefix `game-options-`.
4. `src/ui/empireMessageFeed.ts` (14a's feed; only these changes):
   - Replace the line `// TODO(port): _Game.DisplayMessage<Category> options (all on by default), popups (bool_), and the diplomatic conversation queue — Main.Part9.cs ReceiveMessageInternal` with `// Task 16d: the DisplayMessage<Category> options filter the ticker (messageRouting.ts); popups and the conversation queue are messagePopups.ts.`
   - Add `import { getMessageOptions, routeEmpireMessage } from './messageRouting';` after the existing imports.
   - In `formatEmpireMessage`, right after the `if (t === EmpireMessageType.AdvisorSuggestion) return null;` line:
     ```ts
         // [16d] Game.DisplayMessage<Category> (Main.Part9.cs:1572 bool_2): a category switched off in Game
         // Options hides the line. Uncategorised messages and conversations keep the 14a behaviour.
         const route = routeEmpireMessage(message, player, getMessageOptions());
         if (route.category !== null && route.conversation === null && !route.ticker) return null;
         // [/16d]
     ```
   - With the default options this changes nothing, so `test/empire-message-feed.test.ts` passes unchanged.
5. `src/ui/keyboard.ts`: three blocks, nothing else.
   - Import, right after `import { toggleMessageHistory } from './screens/messageHistory';`:
     ```ts
     import { toggleGameOptionsPanel } from './screens/gameOptionsPanel'; // [16d]
     ```
   - `dispatchKey` switch: insert immediately **before** `case 'galactopediaHelp':`, i.e. after the `gameMenu` case's `break;`:
     ```ts
         // [16d] O: Game Options — Automation + message options (task 16d).
         case 'gameOptionsScreen': {
             const src = getEmpireSummarySource();
             if (src) toggleGameOptionsPanel({ empire: src.empire });
             break;
         }
         // [/16d]
     ```
   - `IMPLEMENTED_KEY_ACTIONS`: a new line right after `'empireComparisonScreen', // [15d]`:
     ```ts
         'gameOptionsScreen', // [16d]
     ```
6. `src/main.ts`: three blocks.
   - After `import { closeEmpireComparison, closeGameEndBanner, installGameEndHandler, removeGameEndHandler } from './ui/screens/empireComparison'; // [15d]`, add:
     ```ts
     import { installMessagePopups, removeMessagePopups } from './ui/messagePopups'; import { closeGameOptionsPanel } from './ui/screens/gameOptionsPanel'; // [16d]
     ```
   - In `startGameView`, right after the `    // [/15d]` line that follows `installGameEndHandler(galaxy, time);`:
     ```ts
         // [16d] Player messages → popups + the diplomatic conversation queue (Main.Part9.cs ReceiveMessageInternal).
         installMessagePopups({ player: game.playerEmpire, galaxy });
         // [/16d]
     ```
   - In `activeGameViewCleanup`, right after the `        // [/15d]` line that follows `closeGameEndBanner();`:
     ```ts
             // [16d]
             removeMessagePopups();
             closeGameOptionsPanel();
             // [/16d]
     ```

## Tests (no jsdom)

Build messages with `new EmpireMessage(sender, type, subject)` and set `description` / `hint` / `money` / `supressPopup` directly. Build a subject instance without a constructor: `Object.assign(Object.create(BuiltObject.prototype), { subRole })` and `Object.create(Habitat.prototype)`. Empires are fakes on the real list classes, like diplomacyScreen.test.ts: `diplomaticRelations: new DiplomaticRelationList()`, a proposed list with `invertEmpireIndexing = true`, `empireId >= 1`, `galaxy = { aggressionLevel: 1, independentEmpire: null }`. Call `resetMessageOptions()` in `beforeEach`.

`test/messageRouting.test.ts`:
- Defaults:
  - `popup[BuiltObjectBuilt]`, `popup[ShipMissionComplete]` and `popup[ShipNeedsRefuelling]` are false;
  - `popup[ColonyInvaded]` is true;
  - every `ticker` is true, and `suppressAllPopups` is false.
- `routeEmpireMessage`:
  - ShipBaseCompleted → `{ category: BuiltObjectBuilt, popup: false, ticker: true, conversation: null }`.
  - ColonyLost → popup true, ticker true. With `supressPopup = true` → popup false.
  - Informational → category null, popup false, ticker true. Undefined → ticker true.
  - ShipBasePurchased and AdvisorSuggestion → popup false, ticker false.
  - DiplomaticRelationChange with a null subject → popup false, ticker false, conversation null.
  - ProposeDiplomaticRelation:
    - FreeTradeAgreement (number subject) → conversation 'OFFER_FREETRADE', popup false, ticker true, immediate false;
    - None with the player's relation to the sender at War → 'WAR_END', immediate true;
    - None with SubjugatedDominion and `initiator = player` → 'SUBJUGATION_REQUESTRELEASE'; with `initiator = sender` → 'SUBJUGATION_RELEASE';
    - None with no relation → category DiplomacyTreaty, conversation null.
  - DiplomaticRelationChange None with a FreeTradeAgreement relation: hint 'war' → 'WAR_END'; hint '' → 'CANCELTREATY'.
  - AcceptDiplomaticRelation None: description 'We accept your release from Subjugation' → 'SUBJUGATION_RELEASE'; 'Peace at last' → 'WAR_END_ACCEPT'.
  - RefuseDiplomaticRelation FreeTradeAgreement → 'FREETRADE_REJECT'.
  - RequestJointWar with `player.controlDiplomacyOffense = AutomationLevel.FullyAutomated` → conversation null, category DiplomacyRequestWarning. With `AutomationLevel.Undefined` → 'WAR_DECLARE_REQUESTJOINT'.
  - BattleUnderAttack:
    - subject BuiltObject Escort → UnderAttackMilitaryShips;
    - SmallSpacePort → UnderAttackColoniesSpaceportsDefensiveBases;
    - MiningStation → UnderAttackCivilianBases;
    - subject Habitat → UnderAttackColoniesSpaceportsDefensiveBases;
    - subject null → popup false, ticker false.
  - OfferTrade:
    - `[[item(Money)], [item(ThreatenWar)]]` → 'DEAL_THREAT', immediate true;
    - `[[], [item(Money)]]` → 'DEAL_DEMAND';
    - `[[item(Money)], [item(Money)]]` → 'DEAL_OFFER';
    - a single `new TradeableItem(TradeableItemType.GalaxyMap, null, 0)` → 'OFFER_DEAL_GALAXYMAP'.
  - PirateOfferProtection: hint 'extort' → 'PIRATE_EXTORTPROTECTION'; `money = 0` → 'PIRATE_TRUCEPROPOSEINITIATE'.
  - After `setMessageOption('ticker', BuiltObjectBuilt, false)`: ShipBaseCompleted → ticker false. After `setMessageOption('popup', ColonyInvaded, false)`: ColonyLost → popup false.
- `shouldQueueConversation`:
  - OFFER_FREETRADE → 'queue';
  - WAR_DECLARE → 'open', and with `setSuppressAllPopups(true)` → 'none';
  - no conversation → 'none'.
- `formatEmpireMessage` (imported from `../src/ui/empireMessageFeed`): with `setMessageOption('ticker', BuiltObjectBuilt, false)`, a ShipBaseCompleted message → null. After `resetMessageOptions()` → its text.

`test/messagePopups.test.ts`:
- `isAnswerableProposal` / `pruneConversationQueue`. Set up player P and empire B. B's relation to P is None with `strategy = Placate`. Add `new DiplomaticRelation(None, B, B, P, false)` with `lastDiplomacyTradeOfferDate = 1000` to `P.proposedDiplomaticRelations`, and a Propose message from B (subject `DiplomaticRelationType.None`).
  - At starDate 1000: answerable is true, and pruning a queue of `[proposeEntry, infoEntry]` removes 0.
  - After `declineProposal(P, B)`: answerable is false, pruning removes 1, and `[infoEntry]` remains.
  - A non-Propose entry is never answerable.
- `conversationHeading`: for the answerable entry, when P's relation to B is War → 'Treaty on Offer: Ending War'. For a DiplomaticRelationChange War entry → 'War'.
- `popupTitle`:
  - `title: 'Colony Lost'` → 'Colony Lost';
  - no title, sender B named 'Zorg' → 'Zorg';
  - neither → 'Message'.

`test/gameOptionsPanel.test.ts`:
- `AUTOMATION_ROWS`:
  - 16 rows;
  - the first is `{ field: 'controlMilitaryAttacks', label: 'Attacks Against Enemies', kind: 'level' }` with `options[1]` 'Suggest attack targets';
  - 'Treaties' has `options[1]` 'Suggest new treaties';
  - there are 7 `bool` rows.
- `setAutomationValue` on a fake `{ controlDiplomacyTreaties: AutomationLevel.FullyAutomated, controlResearch: true }`:
  - `0` → `AutomationLevel.Undefined`, and `automationValue` → 0;
  - `1` → `PartiallyAutomated`;
  - `false` on Research → false.
- `MESSAGE_OPTION_ROWS`:
  - 19 rows;
  - 'Colony Gain or Loss' has categories `[ColonyInvaded, NewColony]`;
  - `setMessageRowValue(that row, 'popup', false)` sets both categories false, and `messageRowValue` reads false;
  - the 16th label is 'Under Attack - Colony & Construction Ships'.
- `isKeyActionAvailable('gameOptionsScreen')` → true.

Run `npm run typecheck && npm test`. `test/empire-message-feed.test.ts`, keyboard.test.ts, hud.test.ts and diplomacyScreen.test.ts must pass unchanged. With `npm run dev` on a private port (other agents share 5173), open `?autostart=1`. Press O and save `shots/16d-game-options.png`. Then set Treaties to "Control manually", run the game at speed until an empire has been met, and save `shots/16d-popups.png` (popup card and/or queue chips visible). Seeding a proposal in-page through `window.__dwu` is fine, as the 15a worker did; do not commit that. Do not open the images. Then append `## Worker report` with: the files changed, the shot.mjs console output, and anything left undone.
