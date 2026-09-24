# Task 14a — Player EmpireMessages feed the top-middle message ticker

thinking: off
scope: locked

Edit only these files:
- a new `src/ui/empireMessageFeed.ts`
- `src/main.ts`: one import line and the `refreshHud` function in `startGameView` (~line 335), plus one `const` right above it. Nothing else.
- a new `test/empire-message-feed.test.ts`

Do NOT edit anything under `src/sim/` (six other agents are editing it). Do NOT edit `src/ui/hud.ts` (task 14b owns it) or `src/render/` (task 14c owns overlayLayer.ts). Do NOT mutate any `EmpireMessage` or `Empire` object: the feed only reads them. Start editing right away.

After this task, every message the sim queues for the player empire shows up once in the top-middle ticker (and so in the Message History panel), using the original's ticker text.

## Existing code you use (read-only; verified at HEAD)

- `src/sim/messages.ts`:
  - `export enum EmpireMessageType { Undefined, DiplomaticRelationChange, ProposeDiplomaticRelation, AcceptDiplomaticRelation, RefuseDiplomaticRelation, …, Informational, …, GalacticNewsNet, …, Revolution, …, AdvisorSuggestion, … }` (C# order).
  - `export class EmpireMessage` with `description: string`, `messageType: EmpireMessageType`, `sender: Empire | null`, `hint: string`, `title: string`, `starDate: number`, and a getter `subject: unknown`. It has **no id field**: dedupe by object identity. A `DiplomaticRelationType` subject is stored as a plain number, so `typeof message.subject === 'number'` is the C# `message.Subject is DiplomaticRelationType` test. Constructor: `new EmpireMessage(sender, messageType, subject)`.
  - `export function empireMessages(empire: Empire): EmpireMessage[]` returns the empire's queue (`Empire.messages`, declared `unknown[]` in empire.ts).
  - `sendEmpireMessage` pushes onto `recipientEmpire.messages`. The sim's `processMessages` (diplomacyTick.ts, called from the empire tick every 30 s of game time) handles the queue and then empties it with `length = 0`. So poll often, and remember what was already shown.
- `Empire.name: string` (src/sim/empire.ts).
- `src/ui/hud.ts`: `pushHudMessage(text: string, at?: string)` adds a line to the 5-line ticker and to the history. main.ts already imports it.
- `src/main.ts` `startGameView`: `game.playerEmpire` (the player `Empire`), `time` (a `GalaxyTime` with `currentStarDate`), and `resolveStarDateDescription` (already imported from `./sim/galaxyTime`). `refreshHud` is run once, then by `setInterval(refreshHud, 250)`.

Why polling and not `IMessageRecipient`: the C# `Main` sets itself as the player's recipient. Here `Empire.messageRecipient` is not in the save codec's skip list (src/sim/save/galaxySave.ts), so an object with a function on it would make saving throw ("Cannot serialize a function"). We may not edit src/sim/, so we poll the queue instead.

## C# source (verbatim, trimmed)

Main.Part9.cs:1036 `method_250`, the ticker text:
```cs
private string method_250(EmpireMessage empireMessage_1) {
    string text = string.Empty;
    if (empireMessage_1.Sender != _Game.PlayerEmpire && empireMessage_1.MessageType != EmpireMessageType.GalacticNewsNet)
        text = string.Format(TextResolver.GetText("X says"), empireMessage_1.Sender.Name) + ": ";   // GameText: "X says" = "{0} says"
    return text + empireMessage_1.Description;
}
```
Main.Part9.cs:1572 `ReceiveMessageInternal(EmpireMessage message)`. `empty` is the line text; `bool_2` means "add it to the ticker":
```cs
empty = method_250(message);
switch (message.MessageType) {
    default:                                   // only EmpireMessageType.Undefined reaches this (every other type has a case)
        empty = message.Description; bool_2 = true; break;
    case EmpireMessageType.DiplomaticRelationChange:     // also Propose/Accept/RefuseDiplomaticRelation
        empty = method_250(message);
        if (message.Subject is DiplomaticRelationType) { /* … sets a ConversationOption → bool_2 = true below */ }
        // else: nothing, bool_2 stays false (not shown)
        break;
    case EmpireMessageType.Revolution:                                       // Main.Part9.cs:2098
        empty = method_252(message, …DisplayPopupColonyInvaded, …DisplayMessageColonyInvaded, ref bool_, ref bool_2);
        empty = message.Description; break;
    case EmpireMessageType.AdvisorSuggestion:                                // Main.Part9.cs:2226
        diplomaticMessageQueue_0.AddMessage(message, …); bool_ = false; bool_2 = false; break;
    // Every other case: empty = method_250(message) (or method_252, which returns method_250(message)),
    // and bool_2 = true, or bool_2 = _Game.DisplayMessage<Category> (a per-category game option, on by default).
}
…
if (bool_2) {                                                                // Main.Part9.cs:2403
    lstMessages.AddItem(empty, message);
    message.StarDate = _Game.Galaxy.CurrentStarDate;
    …
}
```
Controls/ScrollingLinkList.cs:380 `AddItem(text, relatedObject)`: `linkLabel.Text = text.Replace("\n", " "); linkLabel.LinkColor = Color.FromArgb(170, 170, 170);`. Every ticker line gets the **same** colour, so there is no per-type importance styling to port.

## Steps

1. Create `src/ui/empireMessageFeed.ts`:
   - Header comment: task 14a, the player's `EmpireMessage` queue → HUD ticker (Main.Part9.cs ReceiveMessageInternal / method_250). Say that it polls because `Empire.messageRecipient` cannot be saved, and that it never mutates messages.
   - Imports: `import { EmpireMessageType, empireMessages, type EmpireMessage } from '../sim/messages';` and `import type { Empire } from '../sim/empire';`.
   - `export function formatEmpireMessage(message: EmpireMessage, player: Empire | null): string | null`. Comment it `// Port of Main.Part9.cs ReceiveMessageInternal (ticker text + bool_2) and method_250`. Returns the ticker line, or `null` when the original does not add it to the ticker:
     1. `const t = message.messageType;`
     2. If `t === EmpireMessageType.AdvisorSuggestion`, return `null`.
     3. If `t` is `DiplomaticRelationChange`, `ProposeDiplomaticRelation`, `AcceptDiplomaticRelation` or `RefuseDiplomaticRelation` and `typeof message.subject !== 'number'`, return `null`.
     4. `let text: string;` If `t === EmpireMessageType.Undefined || t === EmpireMessageType.Revolution`, `text = message.description`. Otherwise (method_250): `text = message.description`, and when `message.sender !== null && message.sender !== player && t !== EmpireMessageType.GalacticNewsNet`, `text = `${message.sender.name} says: ${message.description}``. (The C# would crash on a null sender; we just skip the prefix.)
     5. `text = text.replace(/\r?\n/g, ' ').trim();` (ScrollingLinkList.AddItem). Return `text === '' ? null : text`.
     - Above the function add `// TODO(port): _Game.DisplayMessage<Category> options (all on by default), popups (bool_), and the diplomatic conversation queue — Main.Part9.cs ReceiveMessageInternal`.
   - `export interface EmpireMessageFeed { poll(empire: Empire | null): string[]; }`
   - `export function createEmpireMessageFeed(): EmpireMessageFeed`. It keeps `const seen = new WeakSet<EmpireMessage>();`. `poll(empire)`:
     - If `empire === null`, return `[]`.
     - `const out: string[] = [];`
     - `for (const m of empireMessages(empire))`: skip when `m == null` or `seen.has(m)`. Otherwise `seen.add(m)`, then `const text = formatEmpireMessage(m, empire)`, and push `text` when it is not null.
     - Return `out`, in queue order (oldest first).
2. `src/main.ts`:
   - Add `import { createEmpireMessageFeed } from './ui/empireMessageFeed';` after the `closeMessageHistory` import (line 28).
   - Right above `const refreshHud = (): void => {` in `startGameView` (~line 335), add:
     ```ts
     // Task 14a: the player's EmpireMessage queue feeds the ticker. The sim empties the
     // queue in processMessages, so poll on every HUD refresh (4x a second).
     const messageFeed = createEmpireMessageFeed();
     ```
   - At the end of the `refreshHud` body (after the `systemNameEl` block), add:
     ```ts
     for (const text of messageFeed.poll(game.playerEmpire)) {
         pushHudMessage(text, resolveStarDateDescription(time.currentStarDate));
     }
     ```
   - Do not touch the generateGalaxy-only boot path (~line 934, its own `refreshHud`) or anything else.

## Tests (`test/empire-message-feed.test.ts`, no jsdom)

Build real messages with `new EmpireMessage(sender, type, subject)` and set `description` on them. Fake empires: `const player = { name: 'Us', messages: [] } as unknown as Empire;` and `const zorg = { name: 'Zorg', messages: [] } as unknown as Empire;`. Import `DiplomaticRelationType` from `../src/sim/diplomacy`.

- `formatEmpireMessage`:
  - `ShipBaseCompleted`, sender `player`, description 'Frigate built' → 'Frigate built'.
  - `Informational`, sender `zorg`, description 'Hello' → 'Zorg says: Hello'.
  - `GalacticNewsNet`, sender `zorg`, description 'News' → 'News'.
  - `Undefined`, sender `zorg`, description 'Raw' → 'Raw'.
  - `Revolution`, sender `zorg`, description 'Uprising' → 'Uprising'.
  - `Informational`, sender `null`, description 'Anon' → 'Anon'.
  - `AdvisorSuggestion`, sender `player`, description 'Advice' → null.
  - `DiplomaticRelationChange`, sender `zorg`, subject `DiplomaticRelationType.War`, description 'War!' → 'Zorg says: War!'.
  - `DiplomaticRelationChange`, sender `zorg`, subject `null`, description 'x' → null.
  - `DiplomaticRelationChange`, sender `zorg`, subject `DiplomaticRelationType.NotMet` (0), description 'y' → 'Zorg says: y'.
  - `Informational`, sender `player`, description 'Line one\nLine two' → 'Line one Line two'.
  - `Informational`, sender `player`, description '' → null.
- `createEmpireMessageFeed().poll`:
  - `poll(null)` → `[]`.
  - Put `m1` ('A', sender player) and `m2` ('B', sender zorg, Informational) in `player.messages`. First poll → `['A', 'Zorg says: B']`. Second poll → `[]`.
  - Push `m3` ('C') → the next poll gives `['C']`.
  - `player.messages.length = 0`, then push `m1` again → `[]`, since it was already shown.
  - An `AdvisorSuggestion` message → `[]`, and it stays `[]` on the next poll.
  - Two separate feeds do not share their seen set: a new feed polling the same queue returns its messages again.

Run `npm run typecheck && npm test`. With `npm run dev` running, save `node scripts/shot.mjs 'http://localhost:5173/?autostart=1' shots/14a-messages.png`. Do not open it. Then append `## Worker report`: files changed, the shot.mjs console output, and anything left undone.
