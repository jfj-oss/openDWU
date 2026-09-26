# 19e-9 — Freight-flow overlay (make the private economy visible)

Status: spec, agent-ready. Depends on: nothing in the mod layer (it is a map overlay that works in every game); its
sim hook (§4.1–4.2) is shared with 19a and 19c, so **whichever of 19a / 19c / 19e-9 lands first adds that hook exactly
as written here** and the others import it. Read first: `CLAUDE.md`, `tasks/UI-agent-brief.md` (UI rules, hook
markers, verification), `tasks/M4-agent-brief.md` §"Porting rules" 1–3 and "Seed pins" (determinism),
`tasks/MODLAYER-DESIGN.md` (for how 19a/19c use it), `tasks/14c-travel-vectors-overlay.md` (the pattern this copies).

## 1. Goal and player experience

The game already simulates a full private economy — colonies and bases place orders, freighters of every empire and
of the independents are contracted to haul goods between trading posts, money moves to sellers, state taxes and
space-port income — but the player sees none of it except a cash-flow number. This overlay shows it:

- **Freight flows** (map toggle): curved arcs from the selling system to the buying system, one per (seller system,
  buyer system) pair, width by value per year, colour by what moves (mineral / gas / luxury / restricted luxury, or
  a scenario category like "rim goods"), brighter when recent. Hover an arc: tooltip "Voidstone, Hydrogen, … —
  12,400 cr/yr, 38 contracts, sellers: Oranthi, Independent". At system zoom the arcs split into per-trading-post
  lines (space port → colony / base) and in-flight freighters carrying contract cargo get a short dashed leader to
  their destination.
- **Trade hubs** (map toggle): a disc on every space port / mining-station port sized by its income this year
  (`BuiltObject.currentYearsIncome`, the value the C# ages in ThisYearsSpacePortIncome), in the owner's colour; where
  money piles up is visible at a glance.
- **Trade Flows panel** (screen, opened from the overlay toggle row's "…" button and from the Empire Summary money
  row): filters (resource group / single resource, empire: all / mine / selected, window: 30 days / 1 year), a top-15
  flows table and a top-10 hubs table, empire-pair totals (from the existing per-relation yearly trade values), click
  a row → centre the map on it.

Scenario packages (19a rim trader, 19c chartered companies) register extra categories and annotations (rim goods,
rare goods, tariff payments) so their mechanics are legible on the same map.

## 2. Data overlay

None (not a scenario). No `scenarios/` files. Texts are UI strings in the TS (English, like the other screens).

## 3. Flags

None. The overlay is a UI observation that never changes sim state, so it is available in every game, scenario or
not. Its sim hook is a no-op with no listener registered (§4.2), and the recorder it registers mutates only a
`WeakMap` beside the galaxy, never the galaxy graph (so state digests, saves and pins are unaffected).

## 4. Sim changes (numbered; file paths are `game/src/sim/...`)

There is no C# analogue for the overlay itself (DW:U never showed flows); every value it records is read at the one
place the C# moves trade money. Cite these in comments:
`$C=/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded`
- `$C/DistantWorlds.Types/Empire.4.cs:1135` InitiateContract (the sale: seller state + private income, buyer pays,
  space-port PerformFinancialTransaction, per-relation PerformTradeTransaction) — TS `logistics/contracts.ts
  initiateContract`.
- `$C/DistantWorlds.Types/Empire.4.cs:720` CheckMarketOrders / `:461` GenerateValidTradingPosts — who can sell to whom.
- `$C/DistantWorlds.Types/DiplomaticRelation.cs:101` PerformTradeTransaction + YearlyTradeValueList (the empire-pair
  yearly totals; TS `DiplomaticRelation._tradeValues`, read through the cast `contracts.ts performTradeTransaction`
  uses).
- `$C/DistantWorlds.Types/BuiltObject.cs:3415` PerformFinancialTransaction (`currentYearsIncome`, per port).
- `$C/DistantWorlds/Controls/MainView.2.cs:5069` method_250 (overlay pass) and `BaconDistantWorlds/BaconMainView.cs:19`
  method_253 (dashed line drawing) — drawing style, as in 14c.

1. **New `logistics/contractEvents.ts`** (not a port; header comment says so):
   ```ts
   export interface ContractEvent {
       starDate: number;                 // galaxyStarDate at initiation
       seller: Empire;                   // InitiateContract's `empire`
       sellingPoint: StellarObject;      // trading post (Habitat or BuiltObject)
       buyer: Empire;                    // requestingEmpire (never null here: initiateContract returns early)
       destination: StellarObject;       // order.requestingColony / requestingBuiltObject
       resourceId: number;               // -1 for component contracts
       componentId: number;              // -1 for resource contracts
       amount: number;                   // contract.amountToFulfill (units)
       value: number;                    // transactionAmount (credits the buyer pays)
       isState: boolean;
       freighter: BuiltObject | null;    // contract.freighter
   }
   export interface ContractListener { id: string; run(galaxy: Galaxy, ev: ContractEvent): void }
   export function registerContractListener(l: ContractListener): () => void;   // replace by id; returns unregister
   export function contractListenersActive(): boolean;                         // list non-empty
   export function emitContractInitiated(galaxy: Galaxy, ev: ContractEvent): void; // runs listeners in id order
   ```
   Contract for listeners: **no `galaxy.rnd` / `cryptoRnd` draws, ever**; a listener that changes sim state (19a
   ledger, 19c tariff) must itself be gated by `scenarioFlag` and keep its state in `scenarioState`. The overlay's own
   listener changes nothing in the galaxy graph.
2. **Extend `logistics/contracts.ts initiateContract`** (Empire.4.cs:1135): as the last statement, after the two
   `performTradeTransaction` calls,
   `if (contractListenersActive()) emitContractInitiated(galaxy, { … })` built from the locals already there
   (`empire` = seller, `requestingEmpire`, `sellingPoint`, `destination!`, `resource?.resourceId ?? -1`,
   `component?.componentId ?? -1`, `contract.amountToFulfill`, `transactionAmount`, `isState`, `contract.freighter`).
   One comment line: `// Mod layer / 19e-9: observation hook (no Rnd, no state change unless a scenario flag is on).`
   Nothing else in the function moves. `initiateContractForOrder` needs no change (it calls this).
3. **New `logistics/tradeFlows.ts`** (not a port) — the recorder, kept beside the galaxy like `player/commandLog.ts`:
   - `const ledgers = new WeakMap<Galaxy, TradeFlowLedger>()`; `enableTradeFlowRecording(galaxy)` registers the
     listener `tradeFlows.record` once and creates the ledger; `tradeFlowLedger(galaxy)` returns it (or null).
   - Buckets: month index `m = Math.floor(starDate / (YEAR_LENGTH / 12))` (`galaxyTime.ts YEAR_LENGTH`); keep the last
     13 months. Key `${sellerSystemIndex}:${buyerSystemIndex}:${resourceId}` (system index of the selling point and
     destination via `galaxy.determineHabitatSystemStar` for habitats, `builtObject.nearestSystemStar` for built
     objects; -1 when deep space → key by the object id instead). Per key per month: `value`, `amount`, `count`,
     and a small set of seller / buyer empire ids.
   - Per-port rows need no recording: the panel reads `BuiltObject.currentYearsIncome` / `dateOfLastIncome` live.
   - Queries (pure, unit-tested): `flowsInWindow(ledger, nowStarDate, months, filter) → FlowRow[]` (summed, sorted by
     value desc, `netSort`-stable), `hubsInWindow(galaxy, filter) → HubRow[]` (ports with `currentYearsIncome > 0`,
     current year only — the C# resets it on the first income of a new year), `empirePairTotals(galaxy, year)` from
     each empire's relations' `_tradeValues.getByYear(...)` (read-only, same cast as contracts.ts).
   - `flowCategory(galaxy, resourceId) → { key, label, color }`: default groups Mineral / Gas / Luxury / Restricted
     (`isRestrictedResource`) / Component; `registerFlowCategory(fn)` lets a scenario package map a resource id to its
     own category first (19a: "Rim goods", "Oranthi rare goods"). Colours live in the render module, not here.
   - Not saved (UI-only, WeakMap). After a load the flows view starts empty and refills; the empire-pair totals are
     available immediately because they come from saved relation data. Document this in the panel ("collecting since
     load" note when the ledger is younger than the chosen window).
4. **Performance guard**: the listener is O(1) per contract (one Map lookup + array push). Add a micro-benchmark-style
   assertion in the test (2 game years with recording on must not be more than ~10 % slower than off; log the ratio,
   assert < 1.5 to keep CI stable).

## 5. Rnd policy

The overlay never draws. `emitContractInitiated` is called after every draw of the C# path (FindFreighterForContract's
draws happen before InitiateContract), so enabling it cannot reorder anything. Test: digest after 1 game year with
recording on == digest with recording off.

## 6. Save state

Nothing new in CLASSES. The ledger is deliberately outside the graph. (19a/19c keep their listeners' effects in
`scenarioState`, see their briefs.)

## 7. AI behaviour

None.

## 8. UI changes

Follow `tasks/UI-agent-brief.md` (hook markers `// [freightOverlay] begin/end`, Escape closes, refresh in place, no
DOM rebuild each tick, pure row builders unit-tested without jsdom).

1. `src/ui/mapOverlays.ts`: add `freightFlows` and `tradeHubs` to `MapOverlayState` (default false) and two rows after
   the original nine, labelled `Freight Flows` and `Trade Hubs`, with a `mod: true` marker the options list renders
   as a small "+" badge (these are not in the original). `toggleOverlay` turning either on calls
   `enableTradeFlowRecording(galaxy)` (via the existing change listener in hud.ts).
2. `src/render/overlayLayer.ts`: two new `Graphics` (flows, hubs) + pure exported helpers, like `travelVectorsFor`:
   - `flowArcsFor(ledger, galaxy, now, windowMonths, filter, zoom) → Arc[]` — at galaxy zoom (z below the
     mid-zoom crossfade window `mainView.ts` uses for the system layers, task 02b2 — reuse its constant) aggregate by system pair; above it, per
     trading post → destination. Arc = quadratic curve with control point offset 15 % of the length to the left of
     travel direction (so A→B and B→A do not overlap), width `clamp(1, 8, sqrt(valuePerYear / 2000)) / z`, alpha
     `0.35 + 0.65 * recency` (recency = share of the value in the last 2 months), small arrow head at the buyer end.
     Cull by camera rect like `updateGroup`. Cap 400 arcs (largest first).
   - In-flight leaders (system zoom only): freighters (`subRole` Small/Medium/LargeFreighter) with non-empty
     `contractsToFulfill` → dashed line to the contract destination (the travel-vectors dash style, 14c).
   - `hubDiscsFor(galaxy, filter) → Disc[]` — radius `clamp(6, 60, sqrt(currentYearsIncome) / 4)` screen px, empire
     `mainColor` fill at alpha 0.25 + 1px ring.
   Colours: Mineral `#b0b8c0`, Gas `#6fd3ff`, Luxury `#f2c14e`, Restricted `#ff7ad9`, Component `#9aa0ff`, scenario
   categories take the colour they register.
3. `src/ui/mapTooltip.ts`: hover on an arc / disc shows the row (hit test: distance to the curve sampled at 16
   points < 6 px; hubs by radius).
4. New `src/ui/screens/tradeFlows.ts` + `.css` (house style of `empiresList.ts`): filters, top flows, top hubs,
   empire-pair totals (the player's pairs first). Row click → the screen's `jumpTo(x, y)` option, wired in main.ts to
   `camera.centerOn(x, y)` as for `galaxyMap.ts` (main.ts:285). Opened from the overlay row "…" and from `empireSummary.ts` money section ("Where does the money go?" link).
   No keyboard binding by default (the original has none; leave a `// [freightOverlay]` placeholder case commented).

## 9. Tests (`test/freightOverlay.test.ts`, `test/tradeFlowsPanel.test.ts`)

Use `cachedTickGameRun(gameData, { seconds })` for the plain game and, for scenario categories,
`createScenarioGame(base, { scenario: 'rimTrade', flags: { rimTrader: true } })` from `test/helpers/scenarioGame.ts`
once 19a exists (skip that case with `it.skipIf(!existsSync(scenarios/rimTrade))`).
1. Hook contract: a test listener registered for 60 game days receives events whose `value` sum equals the sum of
   the per-relation trade values added in the same window for foreign sales (independents excluded), and every event
   has `buyer !== null`, `amount > 0`.
2. No side effects: stateDigest after 1 game year with `enableTradeFlowRecording` == without (same seed, fresh games).
   `npm run repin -- --check` stays clean.
3. Ledger math: synthetic events → `flowsInWindow` sums, month roll-over (13 buckets), window filters, deep-space keys.
4. `hubsInWindow` resets with the C# year semantics (a port whose `dateOfLastIncome` is last year shows 0).
5. Render helpers: arc control-point side, width clamp, culling, 400 cap, category colour lookup with a registered
   scenario category.
6. Panel row builders: sort order, filters, empire-pair totals for a known relation.
7. Perf ratio log (see §4.4).
Verify in the app per the UI brief (both toggles on at galaxy and system zoom, panel open); list screenshots.

## 10. Acceptance criteria

- Both toggles work in a normal game; with them off, no listener is registered and nothing is recorded.
- Seed pins unchanged (`repin --check` clean); digest identical with recording on/off.
- The top flow in the panel matches the largest arc; clicking centres the map.
- In a `rimTrade` game the rim-goods flows into the Oranthi port and the rare-goods flows out of it show in their
  scenario colours.
- typecheck 0 errors; full suite green.

## 11. Risks

- Contract count per year in big galaxies (thousands): keep the listener allocation-free apart from the first bucket
  per key; aggregate before drawing; cap arcs.
- `initiateContract` is also used for component contracts (TS cargo is resource-only; `resourceId` -1) — categorise
  as Component, do not crash.
- Contracts are paid at initiation, not delivery (C# semantics); the tooltip says "contracted", not "delivered".
- Overlay rows beyond the original nine: keep them visibly marked as additions.

## 12. Size

~1.5–2 days: sim hook + recorder 0.5 d, render + tooltip 0.5–0.75 d, panel 0.5 d, tests/verification 0.25 d.
