# Task 15a — Diplomacy screen (F5)

thinking: off
scope: locked

Edit only these files:
- a new `src/ui/screens/diplomacyScreen.ts` and a new `src/ui/screens/diplomacyScreen.css`
- `src/ui/keyboard.ts`: only the three `[15a]` hook blocks below (one import line, one `dispatchKey` case, one `IMPLEMENTED_KEY_ACTIONS` line)
- `src/main.ts`: only the two `[15a]` lines below (one import, one close call)
- a new `test/diplomacyScreen.test.ts`

Do NOT edit anything under `src/sim/`. Only import from it. Three other agents (15b, 15c, 15d) edit `keyboard.ts`, `hud.ts` and `main.ts` at the same time. Put each hook exactly at the anchor given, wrapped in its `[15a]` marker comments. Do not reformat, reorder or "tidy" any neighbouring line, or the four branches will not merge. This task does not touch `src/ui/hud.ts`. Start editing right away.

After this task, F5 opens a streamlined Diplomacy panel that lists every empire the player has met. Each row shows:
- the current relation, coloured as in the original;
- how that empire feels about the player (FEELING with us, overall attitude, and its factor breakdown);
- the player's automated strategy towards them;
- side treaties (refuelling, mining rights, restricted resources);
- any treaty that empire has on offer to the player, with **Accept Offer** / **Decline** buttons;
- the player's own outgoing offer to them, read-only.

House style: copy the structure of `src/ui/screens/empiresList.ts` / `coloniesList.ts`:
- module-level `open` state;
- `toggle…` / `close…` exports;
- a document `keydown` Escape handler that calls `stopImmediatePropagation`;
- pure row functions, so tests need no DOM.

This is a streamlined panel, not the original 1:1 EmpireDetailView. It has no race portrait, no ambassador card, no conversation dialogs and no trade screen.

## Existing code you use (read-only; verified at HEAD a399da7)

- `src/sim/diplomacy.ts`:
  - `enum DiplomaticRelationType { NotMet, None, FreeTradeAgreement, MutualDefensePact, SubjugatedDominion, Protectorate, TradeSanctions, War, Truce }`
  - `enum DiplomaticStrategy { Undefined, Conquer, Befriend, Placate, Defend, Ally, Undermine, DefendPlacate, DefendUndermine, Punish }`
  - `class DiplomaticRelation`:
    - fields: `type`, `thisEmpire`, `otherEmpire`, `initiator` (all `Empire | null` except `type`), `lastDiplomacyTradeOfferDate: number`, `strategy: DiplomaticStrategy`, `supplyRestrictedResources: boolean`, `militaryRefuelingToOther: boolean`, `miningRightsToOther: boolean`.
    - constructor: `new DiplomaticRelation(type, initiator, thisEmpire, otherEmpire, tradeRestrictedResources: boolean)`.
  - `class DiplomaticRelationList`, which is iterable:
    - `byEmpire(e): DiplomaticRelation | null`, `add(r)`, `remove(r)`, `count`, `invertEmpireIndexing`.
    - **Indexing:** `Empire.diplomaticRelations` is keyed by `otherEmpire`. `Empire.proposedDiplomaticRelations` has `invertEmpireIndexing = true`, so there `byEmpire(x)` finds the proposal whose **`thisEmpire` (the proposer) is x**.
    - So `player.proposedDiplomaticRelations.byEmpire(other)` is `other`'s offer to the player, and `other.proposedDiplomaticRelations.byEmpire(player)` is the player's offer to `other`.
  - `class EmpireEvaluation`:
    - getters: `empire`, `overallAttitude` (int; reads `empire.galaxy.aggressionLevel`, `empire.relativeEmpireSize`, `empire.civilityRating`), `reputationWeighted`, `incidentEvaluationRaw`, `biasRaw`, `slaveryOffense`.
    - fields: `systemCompetitionCumulative`, `tradeVolume`, `relationshipWithFriendsPositiveCumulative`, `relationshipWithFriendsNegativeCumulative`, `covetousnessCumulative`, `blockades`, `governmentStyleAffinityCumulative`, `militaryForcesInSystems`, `restrictedResourceTrading`, `envy`, `militaryRefueling`, `miningRights`, `racialOffense`, `firstContactPenalty`, `diplomacyFactor`.
    - constructor: `new EmpireEvaluation(empire, galaxy)`. It sets `firstContactPenalty = -15 * galaxy.aggressionLevel`.
  - `empireEvaluationsOf(empire): EmpireEvaluation[]` and `empireEvaluationByEmpire(list, empire): EmpireEvaluation | null`. These do not mutate.
  - **Do not call** `obtainDiplomaticRelation` or `obtainEmpireEvaluation`: they *add* entries (a render-time mutation). Use `byEmpire` / `empireEvaluationByEmpire`.
- `src/sim/diplomacyTick.ts` (all exported):
  - `determineDesiredDiplomaticRelationTypical(strategy, currentType): DiplomaticRelationType`
  - `changeDiplomaticRelation(galaxy, self, currentRelation, newType): boolean`
  - `cancelBlockades(galaxy, self, target)`
  - `resetAttitudeLevelsAtEndOfWar(galaxy, relation)`
  - `processEndOfWarWithEmpire(galaxy, self, empire)`
- `src/sim/tick/simTime.ts`: `galaxyStarDate(galaxy): number` (C# `Galaxy.CurrentStarDate`).
- `src/sim/galaxyTime.ts`: `REAL_SECONDS_IN_GALACTIC_YEAR = 600`.
- `src/sim/messages.ts`: `EmpireMessageType` (has `ProposeDiplomaticRelation`), `empireMessages(empire): EmpireMessage[]`. `EmpireMessage` has `sender`, `messageType`, `description`, and getter `subject`; a `DiplomaticRelationType` subject is a plain number. Read the queue only (14a's feed also reads it). Never splice it.
- `src/sim/empire.ts`:
  - `Empire` fields: `name`, `empireId`, `active`, `mainColor`, `galaxy`, `pirateEmpireBaseHabitat`, `civilityRating`, `governmentId`, `diplomaticRelations`, `proposedDiplomaticRelations`, `empireEvaluations`, `messages`.
  - `getGovernmentsStatic(): readonly (Government | null)[]`. A `Government` has `name`.
- `Galaxy` (src/sim/galaxy.ts): `aggressionLevel`, `independentEmpire`.
- `src/ui/screens/empireSummary.ts`: `getEmpireSummarySource(): { empire: Empire; governmentName: string | null } | null`. keyboard.ts already imports it.
- `src/ui/toast.ts`: `showToast(text)`.
- The player's diplomacy is **fully automated** at HEAD (`controlDiplomacyTreaties = FullyAutomated`, empire.ts:647). `considerTreatyProposals` (diplomacyTick.ts:3405) runs for the player in the periodic empire tick and answers proposals itself. So offers may disappear within ~30 s of game time. That is expected, and the panel refreshes every second.
- There is **no sim API for the player to create a new proposal**. The original does it in the conversation UI (Main.Part2.cs:1935-1968). Outgoing offers are therefore read-only here; see the TODO in step 1.

## C# source (verbatim, trimmed)

DistantWorlds.Controls/Controls/EmpireDetailView.cs:573-608. `diplomaticRelation1` is the player's relation with the viewed empire, and its colour:
```cs
string text11 = Galaxy.ResolveDescription(diplomaticRelation1.Type);
switch (diplomaticRelation1.Type) {
    case NotMet: color1 = this._NotMetColor; break;           // Color.Tan (210,180,140)
    case None: color1 = this._NoneColor; break;               // (128,128,128)
    case FreeTradeAgreement: color1 = this._FreeTradeColor; break;   // (0,255,0)
    case MutualDefensePact: color1 = this._MutualDefenseColor; break; // (64,64,232)
    case SubjugatedDominion: color1 = this._SubjugatedColor;  // Color.Yellow
        text11 = diplomaticRelation1.Initiator != PlayerEmpire ? text11 + " (" + GetText("They subjugate us") + ")" : text11 + " (" + GetText("We subjugate them") + ")"; break;
    case Protectorate: color1 = this._ProtectorateColor;      // (112,112,255)
        text11 = diplomaticRelation1.Initiator != PlayerEmpire ? text11 + " (" + GetText("They protect us") + ")" : text11 + " (" + GetText("We protect them") + ")"; break;
    case TradeSanctions: color1 = this._TradeSanctionsColor; break;  // Color.Orange (255,165,0)
    case War: color1 = this._WarColor; break;                 // (255,0,0)
    case Truce: color1 = this._TruceColor; break;             // Color.Yellow
}
```
Galaxy.2.cs:2488 `ResolveDescription(DiplomaticRelationType)` uses GameText.txt:1860-1868. NotMet → `Not Met`, None → `No relationship`, FreeTradeAgreement → `Free Trade Agreement`, MutualDefensePact → `Mutual Defense Pact`, SubjugatedDominion → `Subjugated Dominion`, Protectorate → `Protectorate`, TradeSanctions → `Trade Sanctions`, War → `War`, Truce → `Truce`.

The four suffixes (GameText 2338-2341) are the key text itself: `We protect them`, `They protect us`, `We subjugate them`, `They subjugate us`.

EmpireDetailView.cs:639-706, the treaty on offer. `num30` = `TreatyOfferValidYears` (Galaxy.3.cs:5059 `= 0.2`) × `RealSecondsInGalacticYear` × 1000:
```cs
diplomaticRelation2 = this._PlayerEmpire.ProposedDiplomaticRelations[this._Empire];
if (diplomaticRelation2 != null) {
    bool flag3 = true;
    long num30 = (long)(Galaxy.TreatyOfferValidYears * (double)Galaxy.RealSecondsInGalacticYear * 1000.0);
    if (this._Game.Galaxy.CurrentStarDate > diplomaticRelation2.LastDiplomacyTradeOfferDate + num30) flag3 = false;
    DiplomaticRelation diplomaticRelation3 = this._Empire.ObtainDiplomaticRelation(this._PlayerEmpire);
    if (this._Empire.DetermineDesiredDiplomaticRelationTypical(diplomaticRelation3.Strategy, diplomaticRelation3.Type) != diplomaticRelation2.Type) flag3 = false;
    if (!flag3) this._PlayerEmpire.ProposedDiplomaticRelations.Remove(diplomaticRelation2);
    if (flag3) {
        switch (diplomaticRelation2.Type) {
            case DiplomaticRelationType.None:
                switch (diplomaticRelation1.Type) {
                    case FreeTradeAgreement: case MutualDefensePact: case Protectorate: text14 = GetText("Cancelling Treaty"); break;
                    case SubjugatedDominion:
                        if (diplomaticRelation1.Initiator == this._PlayerEmpire) { text14 = GetText("Request release from Subjugation"); break; }
                        text14 = GetText("Offering release from Subjugation"); break;
                    case TradeSanctions: text14 = GetText("Lifting Trade Sanctions"); break;
                    case War: text14 = GetText("Ending War"); break;
                    case Truce: text14 = GetText("Peace Treaty"); break;
                }
                break;
            default: text14 = Galaxy.ResolveDescription(diplomaticRelation2.Type); break;   // FreeTrade/MutualDefense/Subjugated/Protectorate/TradeSanctions/War/Truce
        }
        DrawString(GetText("Treaty on Offer")); DrawString(text14);
        this.btnEmpireDetailAcceptTreaty.Visible = true;
```
The GameText values are the key text: `Cancelling Treaty`, `Request release from Subjugation`, `Offering release from Subjugation`, `Lifting Trade Sanctions`, `Ending War`, `Peace Treaty`, `Treaty on Offer`, and `Accept Offer` (GameText 2350, the button).

EmpireDetailView.cs:733-757, the attitude block. `empire` is the viewed empire; the evaluation is how **they** see the player:
```cs
EmpireEvaluation empireEvaluation = empire.ObtainEmpireEvaluation(this._Game.PlayerEmpire);
string text15 = string.Format(GetText("FEELING with us"), PlayerEmpire.ResolveFeelingDescription(empireEvaluation)) + " (" + empireEvaluation.OverallAttitude.ToString("+0;-0;0") + ")";   // "FEELING with us" = "{0} with us"
EmpireRelationshipFactorList relationshipFactors = this._Game.PlayerEmpire.DetermineEmpireRelationshipFactors(this._Empire);
for (...) { string text16 = relationshipFactors[index].Description + " (" + num31.ToString("+0;-0;0") + ")";
            // num31 < 0 → Color.Red, else Color.LightGreen }
```
DistantWorlds.Types/Empire.4.cs:55 `ResolveFeelingDescription(EmpireEvaluation evaluation)` (`overallAttitude = evaluation.OverallAttitude`; later ifs overwrite earlier ones):
```cs
if (overallAttitude <= -45) result = "Furious";
if (overallAttitude >= -44 && overallAttitude <= -20) result = "Angry";
if (overallAttitude >= -19 && overallAttitude <= -5) result = "Annoyed";
if (overallAttitude >= -4 && overallAttitude <= 7) result = "Cautious";
if (overallAttitude >= 8 && overallAttitude <= 20) result = "Pleased";
if (overallAttitude >= 21 && overallAttitude <= 44) result = "Friendly";
if (overallAttitude >= 45) result = "Delighted";
```
DistantWorlds.Types/Empire.7.cs:4164 `DetermineEmpireRelationshipFactors(Empire otherEmpire)`. `this` is the player, `otherEmpire` the viewed empire. Only the non-pirate branch is ported. The GameText values are shown in brackets.
```cs
if (otherEmpire.PirateEmpireBaseHabitat == null && PirateEmpireBaseHabitat == null) {
    EmpireEvaluation empireEvaluation = otherEmpire.EmpireEvaluations[this];
    if (empireEvaluation != null) {
        if (FirstContactPenalty < 0.0)            Add(FirstContactPenalty, "First Contact Penalty Description");   // [Our ignorance of your strange alien ways causes us to distrust you]
        if (MilitaryForcesInSystems < 0)          Add(MilitaryForcesInSystems, "Your military forces in our systems violate our territory");
        if (RelationshipWithFriendsPositiveCumulative > 0.0) Add(.., "You have formed beneficial treaties with our friends");
        if (RelationshipWithFriendsNegativeCumulative < 0.0) Add(.., "You have trade sanctions or are at war with our friends");
        if (SystemCompetitionCumulative < 0.0)    Add(.., "Your colonies and bases trespass in our systems!");
        if (ReputationWeighted > 0.0)             Add(ReputationWeighted, string.Format("We respect your good reputation", empireEvaluation.Empire.CivilityDescription()));  // [We respect your good reputation ({0})]
        else if (ReputationWeighted < 0.0)        Add(ReputationWeighted, string.Format("We are troubled by your poor reputation", ...CivilityDescription()));   // [We are troubled by your poor reputation ({0})]
        if (TradeVolume > 0) Add(TradeVolume, TradeVolume > 20 ? "Our empires generate a colossal amount of trade" : TradeVolume > 13 ? "Our empires produce a large amount of trade" : TradeVolume <= 6 ? "Our empires share a small volume of trade" : "Our empires share a fair amount of trade");
        if (GovernmentStyleAffinityCumulative < 0.0) Add(.., string.Format("We are unhappy with your style of government", GovernmentAttributes.Name));   // [... ({0})]; `GovernmentAttributes` = the player's
        if (GovernmentStyleAffinityCumulative > 0.0) Add(.., string.Format("We like your style of government", GovernmentAttributes.Name));             // [We like your style of government ({0})]
        if (CovetousnessCumulative < 0.0)         Add(.., "We covet your colonies and resources...");
        if (Blockades < 0)                        Add(Blockades, "You have blockaded our colonies and space ports!");
        if (BiasRaw > 0.0)                        Add(BiasRaw, "We naturally like you");
        else if (BiasRaw < 0.0)                   Add(BiasRaw, "We instinctively dislike you");
        if (Envy < 0)                             Add(Envy, "We are envious of your huge strength and power");
        if (RestrictedResourceTrading < 0.0)      Add(.., "We are upset that you refuse to trade valuable resources with us");
        if (RestrictedResourceTrading > 0.0)      Add(.., "We are happy that you trade valuable resources with us");
        if (MilitaryRefueling > 0)                Add(.., "We appreciate military refueling");   // [We appreciate your help with military refueling]
        if (MiningRights > 0)                     Add(.., "We appreciate mining rights");        // [We appreciate mining rights within your territory]
        if (IncidentEvaluationRaw < 0.0)          Add(.., "Our past dealings with you have been terrible");
        if (IncidentEvaluationRaw > 0.0)          Add(.., "Our past dealings with you have been good");
        if (SlaveryOffense < 0.0)                 Add(.., "We are angry at your enslavement of our race at your colonies");
        if (RacialOffense < 0.0)                  Add(.., "We are outraged at your extermination of our race at your colonies");
    }
    for (int i = 0; i < list.Count; i++) {
        if (list[i].Value > 0.0) { list[i].Value /= _Galaxy.AggressionLevel; list[i].Value *= empireEvaluation.DiplomacyFactor; }
        else                     { list[i].Value *= _Galaxy.AggressionLevel; list[i].Value /= empireEvaluation.DiplomacyFactor; }
    }
    list.Sort(); list.Reverse();          // EmpireRelationshipFactor.CompareTo = Value.CompareTo → descending by value
} else { /* pirate relation factors — not ported */ }
```
DistantWorlds.Types/Empire.10.cs:681 `CivilityDescription()`, with `CivilityRating` being the **player's** rating (`empireEvaluation.Empire`):
```cs
if (CivilityRating < -50.0) "Diabolical"; else if (>= -50 && <= -30) "Evil"; else if (>= -30 && <= -20) "Notorious";
else if (>= -20 && <= -10) "Nasty"; else if (>= -10 && <= -1) "Dubious"; else if (>= -1 && <= 4) "Satisfactory";
else if (>= 4 && <= 10) "Respectable"; else if (>= 10 && <= 16) "Admired"; else if (>= 16 && <= 22) "Noble"; else if (> 22) "Heroic";
```
EmpireDetailView.cs:803 `btnEmpireDetailAcceptTreaty_Click`, the player accepts:
```cs
DiplomaticRelation diplomaticRelation1 = this._PlayerEmpire.ProposedDiplomaticRelations[this._Empire];
if (diplomaticRelation1 == null) return;
DiplomaticRelation diplomaticRelation2 = this._PlayerEmpire.DiplomaticRelations[this._Empire] ?? new DiplomaticRelation(DiplomaticRelationType.NotMet, this._PlayerEmpire, this._PlayerEmpire, this._Empire, false);
switch (diplomaticRelation1.Type) {
    case DiplomaticRelationType.None: case DiplomaticRelationType.SubjugatedDominion: case DiplomaticRelationType.Truce:
        switch (diplomaticRelation2.Type) {
            case DiplomaticRelationType.TradeSanctions:
                this._PlayerEmpire.ChangeDiplomaticRelation(diplomaticRelation2, diplomaticRelation1.Type);
                this._PlayerEmpire.CancelBlockades(this._Empire);
                this._Empire.CancelBlockades(this._PlayerEmpire);
                break;
            case DiplomaticRelationType.War:
                this._PlayerEmpire.ResetAttitudeLevelsAtEndOfWar(diplomaticRelation2);
                diplomaticRelation2.Type = diplomaticRelation1.Type;
                diplomaticRelation2.LastDiplomacyTradeOfferDate = this._Game.Galaxy.CurrentStarDate;
                DiplomaticRelation diplomaticRelation3 = this._Empire.DiplomaticRelations[this._PlayerEmpire];
                if (diplomaticRelation3 == null) {
                    diplomaticRelation3 = new DiplomaticRelation(DiplomaticRelationType.NotMet, this._Empire, this._Empire, this._PlayerEmpire, false);
                    this._Empire.DiplomaticRelations.Add(diplomaticRelation3);
                }
                diplomaticRelation3.Type = diplomaticRelation1.Type;
                diplomaticRelation3.LastDiplomacyTradeOfferDate = this._Game.Galaxy.CurrentStarDate;
                this._PlayerEmpire.ProcessEndOfWarWithEmpire(this._Empire);
                this._Empire.ProcessEndOfWarWithEmpire(this._PlayerEmpire);
                break;
        }
        break;
    default:
        this._PlayerEmpire.ChangeDiplomaticRelation(diplomaticRelation2, diplomaticRelation1.Type);
        break;
}
this._PlayerEmpire.ProposedDiplomaticRelations.Remove(diplomaticRelation1);
```
DistantWorlds/Main.Part10.cs:3930 `method_235`, which removes a proposal. It is what the conversation's "decline" options end with:
```cs
private void method_235(Empire empire_5, Empire empire_6) {
    DiplomaticRelation diplomaticRelation = empire_5.ProposedDiplomaticRelations[empire_6];
    if (diplomaticRelation != null) empire_5.ProposedDiplomaticRelations.Remove(diplomaticRelation);
}
```

## Steps

1. `src/ui/screens/diplomacyScreen.ts`
   - Header comment: task 15a, streamlined Diplomacy panel (F5). Cite EmpireDetailView.cs (relation / treaty on offer / attitude), Empire.4.cs ResolveFeelingDescription, Empire.7.cs DetermineEmpireRelationshipFactors, and Main.Part10.cs method_235. Add `// TODO(port): proposing treaties from the player (Main.Part2.cs:1935 conversation path), pirate relations (Empire.7.cs:4270 pirate branch), ambassador card (EmpireDetailView.cs:613) — not in 15a`.
   - `import './diplomacyScreen.css';` plus type/value imports from the modules listed above. Use `import type` for `Empire`, `Galaxy`, `EmpireMessage`.
   - `export const RELATION_COLORS: Record<DiplomaticRelationType, number>`: NotMet `0xd2b48c`, None `0x808080`, FreeTradeAgreement `0x00ff00`, MutualDefensePact `0x4040e8`, SubjugatedDominion `0xffff00`, Protectorate `0x7070ff`, TradeSanctions `0xffa500`, War `0xff0000`, Truce `0xffff00`.
   - `export function relationTypeLabel(type: DiplomaticRelationType): string`: the GameText table above.
   - `export function relationDescription(rel: DiplomaticRelation, player: Empire): string`: `relationTypeLabel(rel.type)`, plus the SubjugatedDominion / Protectorate suffix. The test `rel.initiator !== player` picks "They …".
   - `export function feelingDescription(overallAttitude: number): string`: Empire.4.cs:55. The ifs are sequential, and `''` is returned when none matches (impossible for ints, but keep the structure).
   - `export function civilityDescription(rating: number): string`: Empire.10.cs:681, the `if / else if` chain verbatim. Return `''` if nothing matches (e.g. NaN).
   - `export function formatSigned(v: number): string`: C# `ToString("+0;-0;0")`, i.e. round half away from zero, then `'+N'`, `'-N'` or `'0'`. Use `Math.sign(v) * Math.round(Math.abs(v))`.
   - `export interface RelationshipFactor { value: number; description: string }`.
   - `export function relationshipFactors(player: Empire, other: Empire, playerGovernmentName: string): RelationshipFactor[]`: Empire.7.cs:4164, non-pirate branch.
     - Return `[]` if either empire has `pirateEmpireBaseHabitat !== null`, or if `empireEvaluationByEmpire(empireEvaluationsOf(other), player)` is null.
     - `{0}` in the reputation texts is `civilityDescription(player.civilityRating)`; in the government texts it is `playerGovernmentName`.
     - Scale every value with `player.galaxy.aggressionLevel` and `ev.diplomacyFactor` exactly as in the loop.
     - Then sort **descending by value** with a stable sort (`Array.prototype.sort`). .NET's `List.Sort` is unstable for ties; say so in a comment.
   - `export function isProposalValid(proposal: DiplomaticRelation, other: Empire, player: Empire, starDate: number): boolean`: the `flag3` logic, without the removal.
     - `const validMs = Math.trunc(0.2 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000)` with the comment `// Galaxy.TreatyOfferValidYears (Galaxy.3.cs:5059)`.
     - Invalid when `starDate > proposal.lastDiplomacyTradeOfferDate + validMs`.
     - Their relation is `other.diplomaticRelations.byEmpire(player)`. When it is null, use `strategy = DiplomaticStrategy.Undefined`, `type = DiplomaticRelationType.NotMet`. This matches the fresh NotMet relation that `ObtainDiplomaticRelation` would add.
     - Invalid when `determineDesiredDiplomaticRelationTypical(strategy, type) !== proposal.type`.
     - Add a comment: the C# also removes invalid proposals while drawing; the panel does not (no mutation on render). The sim's `considerTreatyProposals` clears them.
   - `export function proposalLabel(proposalType: DiplomaticRelationType, current: DiplomaticRelation | null, player: Empire): string`: the `text14` switch.
     - `current === null` counts as type NotMet.
     - `None` combined with an unlisted current type gives `''`.
   - `export interface DiplomacyRow`:
     - `empire: Empire; name: string; color: number;` where `color` is `empire.mainColor`
     - `relationType: DiplomaticRelationType; relationText: string; relationColor: number;`
     - `attitude: number | null; feeling: string;` (`feeling` is formatted as `'Pleased with us (+12)'`, or `''` when there is no evaluation)
     - `ourStrategy: string;` (`DiplomaticStrategy[rel.strategy]` split into words, `'(None)'` for Undefined)
     - `treaties: string[];`
     - `incoming: DiplomaticRelation | null; incomingText: string; incomingMessage: string;`
     - `outgoing: DiplomaticRelation | null; outgoingText: string;`
     - `factors: RelationshipFactor[]`
   - `export function diplomacyRows(player: Empire, starDate: number, playerGovernmentName: string): DiplomacyRow[]`:
     - Iterate `player.diplomaticRelations`. Skip a relation when any of these hold:
       - `rel.type === NotMet`;
       - `rel.otherEmpire` is null, or not `active`;
       - it is `player.galaxy.independentEmpire`;
       - it is a pirate (`pirateEmpireBaseHabitat !== null`).
     - Sort by `name.localeCompare`.
     - Per row:
       - `ev = empireEvaluationByEmpire(empireEvaluationsOf(other), player)`, then `attitude = ev?.overallAttitude ?? null`.
       - `feeling = ev ? \`${feelingDescription(a)} with us (${formatSigned(a)})\` : ''`.
       - `theirs = other.diplomaticRelations.byEmpire(player)`.
       - `treaties`, in this order:
         - `'We allow them military refueling'` if `rel.militaryRefuelingToOther`;
         - `'They allow us military refueling'` if `theirs?.militaryRefuelingToOther`;
         - `'We grant them mining rights'` if `rel.miningRightsToOther`;
         - `'They grant us mining rights'` if `theirs?.miningRightsToOther`;
         - `'Restricted resources traded'` if `rel.supplyRestrictedResources`.
       - `incoming`: `p = player.proposedDiplomaticRelations.byEmpire(other)`, kept only when `isProposalValid(p, other, player, starDate)`. Then `incomingText = proposalLabel(p.type, rel, player)`.
       - `incomingMessage`: the `description` of the **last** message in `empireMessages(player)` that has `sender === other`, `messageType === EmpireMessageType.ProposeDiplomaticRelation` and `subject === p.type`. Use `''` when there is no incoming offer or no such message.
       - `outgoing = other.proposedDiplomaticRelations.byEmpire(player)`, with `outgoingText = proposalLabel(outgoing.type, rel, player)`.
       - `factors = relationshipFactors(player, other, playerGovernmentName)`.
   - `export function acceptProposal(player: Empire, other: Empire): boolean`: port `btnEmpireDetailAcceptTreaty_Click` line by line.
     - Use `galaxy = player.galaxy` and `galaxyStarDate(galaxy)` for CurrentStarDate.
     - `this._PlayerEmpire.DiplomaticRelations[x]` is `player.diplomaticRelations.byEmpire(x)`. The `?? new DiplomaticRelation(NotMet, player, player, other, false)` fallback is **not** added to the list, as in the C#.
     - Return false when there is no proposal, true after `player.proposedDiplomaticRelations.remove(proposal)`.
     - Comment: `// Port of EmpireDetailView.cs:803 btnEmpireDetailAcceptTreaty_Click (the player's accept path; the sim has no separate entry point)`.
   - `export function declineProposal(player: Empire, other: Empire): boolean`: Main.Part10.cs:3930 `method_235` on `player.proposedDiplomaticRelations`. Return whether a proposal was removed.
     - Add the comment `// TODO(port): the conversation's refusal reply message (Main.Part10.cs conversation options) is not sent`.
   - `export function playerGovernmentName(player: Empire): string`: `getGovernmentsStatic()[player.governmentId]?.name ?? ''`, guarding `governmentId < 0`.
   - DOM, like empiresList:
     - `export interface DiplomacyScreenOptions { player: Empire }`, `toggleDiplomacyScreen(opts)`, `closeDiplomacyScreen()`.
     - The window is titled `Diplomacy`, with a two-pane body:
       - Left is the list: swatch, name, relation text in `rgb(relationColor)`, and the attitude signed number coloured red if < 0, else `#90ee90` (LightGreen).
       - Right is the details of the selected row (default: the first row):
         - heading `Current Relationship With Us`, then the relation text;
         - `Treaty on Offer` + incomingText, then incomingMessage (small, italic), then two buttons: `Accept Offer` and `Decline`;
         - `Our offer to them` + outgoingText (read-only);
         - `Our strategy: …`;
         - the treaties list;
         - the feeling line;
         - the factor lines as `${description} (${formatSigned(value)})`, red when value < 0, else LightGreen.
     - Accept → `acceptProposal(player, row.empire)`, then `showToast('Treaty accepted')` (GameText 638), then re-render. Decline → `declineProposal`, then re-render.
     - With no rows, the body shows `<div class="diplomacy-empty">No empires met yet</div>`.
     - While open, re-render every 1000 ms (keep the selected empire). Clear the interval in `close()`.
     - Rows are rebuilt from `diplomacyRows(opts.player, galaxyStarDate(opts.player.galaxy), playerGovernmentName(opts.player))`.
2. `src/ui/screens/diplomacyScreen.css`: copy `coloniesList.css` with the prefix `diplomacy-` instead of `colonies-list-`.
   - `.diplomacy-window` is `width: 760px`.
   - The body is a grid `grid-template-columns: 300px minmax(0, 1fr)`. Each pane has its own `overflow-y: auto`.
   - The list rows use `grid-template-columns: 10px minmax(0,1fr) 8.5em 3em`.
   - Add a `.diplomacy-row-selected` highlight.
   - Buttons reuse the dark-panel look: 1px border `rgba(255,255,255,0.2)`, 4px radius, padding `3px 10px`.
3. `src/ui/keyboard.ts`: three blocks, nothing else.
   - Import, right after the line `import { GalaxyTime } from '../sim/clock';`:
     ```ts
     import { toggleDiplomacyScreen } from './screens/diplomacyScreen'; // [15a]
     ```
   - `dispatchKey` switch: insert immediately **before** `case 'empireSummaryScreen':`, i.e. after the `messageHistoryScreen` case's `break;`:
     ```ts
         // [15a] F5: Diplomacy screen (task 15a).
         case 'diplomacyScreen': {
             const src = getEmpireSummarySource();
             if (src) toggleDiplomacyScreen({ player: src.empire });
             break;
         }
         // [/15a]
     ```
   - `IMPLEMENTED_KEY_ACTIONS`: a new line right after `'togglePause', 'speedUp', 'speedDown',`:
     ```ts
         'diplomacyScreen', // [15a]
     ```
   - There is no top-bar hook: `tbtnDiplomacy` does not exist, and `tbtnEmpires` already opens the Empires list (task 12b). Leave `hud.ts` alone.
4. `src/main.ts`: two lines.
   - After `import { closeEmpiresList } from './ui/screens/empiresList';`, add `import { closeDiplomacyScreen } from './ui/screens/diplomacyScreen'; // [15a]`.
   - In `activeGameViewCleanup`, right after `closeEmpiresList();`, add `closeDiplomacyScreen(); // [15a]`.

## Tests (`test/diplomacyScreen.test.ts`, no jsdom)

Importing the module pulls in its `.css`; vitest handles that, as in coloniesList.test.ts.

Fake empires built on the real list classes:
```ts
const galaxy = { aggressionLevel: 1, independentEmpire: null } as unknown as Galaxy;
function fake(id: number, name: string, extra: Record<string, unknown> = {}): Empire {
    const proposed = new DiplomaticRelationList(); proposed.invertEmpireIndexing = true;
    return { empireId: id, name, active: true, galaxy, mainColor: 0x112233, pirateEmpireBaseHabitat: null,
             civilityRating: 0, relativeEmpireSize: 1, governmentId: -1, diplomaticRelations: new DiplomaticRelationList(),
             proposedDiplomaticRelations: proposed, empireEvaluations: [], messages: [], ...extra } as unknown as Empire;
}
```
Build an evaluation with `new EmpireEvaluation(player, galaxy)`, pushed onto `other.empireEvaluations`.

- `relationTypeLabel`: None → 'No relationship', NotMet → 'Not Met', War → 'War'.
- `relationDescription`:
  - Protectorate with `initiator = player` → 'Protectorate (We protect them)'; with `initiator = other` → 'Protectorate (They protect us)'.
  - SubjugatedDominion with `initiator = other` → 'Subjugated Dominion (They subjugate us)'.
- `feelingDescription`: -45 'Furious', -44 'Angry', -5 'Annoyed', -4 'Cautious', 7 'Cautious', 8 'Pleased', 21 'Friendly', 45 'Delighted'.
- `civilityDescription`: -51 'Diabolical', -30 'Evil', 0 'Satisfactory', 4 'Satisfactory' (the first matching branch wins), 23 'Heroic'.
- `formatSigned`: 12 '+12', -3 '-3', 0 '0', 2.5 '+3', -2.5 '-3'.
- `relationshipFactors`:
  - With a fresh evaluation at aggression 1, `firstContactPenalty` is -15 → `[{ value: -15, description: 'Our ignorance of your strange alien ways causes us to distrust you' }]`.
  - Add `tradeVolume = 10` → trade comes first: `{ 10, 'Our empires share a fair amount of trade' }`, then the penalty.
  - `tradeVolume = 21` → 'Our empires generate a colossal amount of trade'. `tradeVolume = 6` → 'Our empires share a small volume of trade'.
  - `governmentStyleAffinityCumulative = 4` with government name 'Democracy' → 'We like your style of government (Democracy)'.
  - Aggression 2: build a second fake galaxy `{ aggressionLevel: 2, independentEmpire: null }` and use it for both the player and the evaluation. `firstContactPenalty` is then -30, so the factor is -60. `tradeVolume = 10` gives the factor 5.
  - A pirate `other` (`pirateEmpireBaseHabitat: {}`) → `[]`. No evaluation → `[]`.
- `isProposalValid`: proposal = `new DiplomaticRelation(FreeTradeAgreement, other, other, player, false)` with `lastDiplomacyTradeOfferDate = 1000`.
  - Their relation is `new DiplomaticRelation(None, other, other, player, false)` with `strategy = Befriend`, added to `other.diplomaticRelations` → valid at starDate 1000 + 120000, invalid at 1000 + 120001.
  - Strategy `Conquer` → invalid.
  - No relation at all → a FreeTrade proposal is invalid, a None proposal is valid.
- `proposalLabel`: None vs War → 'Ending War'; None vs TradeSanctions → 'Lifting Trade Sanctions'; None vs SubjugatedDominion with `initiator = player` → 'Request release from Subjugation'; MutualDefensePact vs anything → 'Mutual Defense Pact'; None vs None → ''.
- `diplomacyRows` (call it with `starDate = 0`): the player has relations with A ('Zeta', FreeTrade), B ('Alpha', War) and C (NotMet). Check:
  - names `['Alpha', 'Zeta']` (C skipped, sorted);
  - A's `relationColor` is `0x00ff00`;
  - an A→player evaluation with tradeVolume 10 → A's attitude is `trunc(-15 + 10) = -5` and feeling 'Annoyed with us (-5)';
  - B without an evaluation → attitude null, feeling ''.
  - Incoming: add to `player.proposedDiplomaticRelations` a valid None proposal from B (thisEmpire B, with B's relation to the player at strategy `Placate`). Push an `EmpireMessage(B, ProposeDiplomaticRelation, DiplomaticRelationType.None)` with description 'Let us end this war' onto `player.messages`. Then B's `incomingText` is 'Ending War' and `incomingMessage` is 'Let us end this war'.
  - Outgoing: add `new DiplomaticRelation(MutualDefensePact, player, player, A, 0, false)` to `A.proposedDiplomaticRelations` → A's `outgoingText` is 'Mutual Defense Pact'.
  - Treaties: `rel.militaryRefuelingToOther = true` on the player→A relation → A's treaties include 'We allow them military refueling'.
- `declineProposal`: after adding B's proposal, it returns true, and `player.proposedDiplomaticRelations.byEmpire(B)` is then null. A second call returns false.
- `isKeyActionAvailable('diplomacyScreen')` → true.

Do not unit-test `acceptProposal`: it needs a real galaxy. It is exercised by hand.

Run `npm run typecheck && npm test`; keyboard.test.ts must still pass unchanged. With `npm run dev` on a private port (other agents share 5173), save `node scripts/shot.mjs 'http://localhost:<port>/?autostart=1' shots/15a-diplomacy.png`. Do not open it. Then append `## Worker report` with: the files changed, the shot.mjs console output, and anything left undone.

## Worker report

Files changed: `src/ui/screens/diplomacyScreen.ts` (new), `src/ui/screens/diplomacyScreen.css` (new), `test/diplomacyScreen.test.ts` (new, 17 tests), `src/ui/keyboard.ts` (three `[15a]` blocks), `src/main.ts` (two `[15a]` lines).

Checks: full suite `npx vitest run --testTimeout=300000 --maxWorkers=2` → 128 files / 1398 tests passed, exit 0. `npm run typecheck` reports only two errors, both already at HEAD 0bf6879 and outside this task: `src/sim/galaxy.ts(4501/4541)` duplicate `shakturiDefeated` (merge artifact from wip/m4z3). Nothing from 15a's files.

Screenshot console output (dev server on port 5617, `?autostart=1`, F5): no errors or page errors. At game start no empire has been met yet, so the panel shows "No empires met yet" (`shots/15a-diplomacy.png`). A second playwright run seeded three relations in the page through `window.__dwu.galaxy` (Free Trade, War with an incoming None offer and message, Protectorate) and captured list + details, Accept Offer (War → No relationship, toast "Treaty accepted") and the Free Trade row with outgoing offer and treaties (`shots/15a-diplomacy-seeded*.png`). Escape closes the panel.

Test note: the fakes use empire ids ≥ 1, because `DiplomaticRelationList.byEmpire` indexes by `empireId - 1` (id 0 is never found).

Not done: nothing from the spec. `acceptProposal` is exercised only by hand (as specified).
