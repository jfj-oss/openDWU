# Task 16b — Ship Designs screen (F8 / top-bar Designs button)

thinking: off
scope: locked

Edit only these files:
- a new `src/ui/screens/shipDesigns.ts` and a new `src/ui/screens/shipDesigns.css`
- `src/ui/hud.ts`: only the two `[16b]` blocks below (one import line, one block in `buildTopBarButton`'s click listener)
- `src/ui/keyboard.ts`: only the three `[16b]` hook blocks below (one import line, one `dispatchKey` case, one `IMPLEMENTED_KEY_ACTIONS` line)
- `src/main.ts`: only the two `[16b]` lines below (one import, one close call)
- `test/keyboard.test.ts`: only the two assertions named in step 6
- a new `test/shipDesigns.test.ts`

Do NOT edit anything under `src/sim/`. Only import from it (read-only). The only writes this screen makes are the two plain-field toggles the original UI makes itself (`Design.isObsolete`, `Design.allowAutoRetrofit` + `BuiltObject.suppressAutoRetrofit`, step 1). Three other agents (16a, 16c, 16d) edit `keyboard.ts`, `hud.ts` and `main.ts` at the same time. Put each hook exactly at the anchor given, wrapped in its `[16b]` / `[/16b]` marker comments. Do not reformat, reorder or "tidy" any neighbouring line, or the four branches will not merge. Start editing right away.

After this task, F8 and the top-bar `tbtnDesigns` button (`designsButton.png`) open a streamlined **Designs** panel:
- two selects: the original's design filter (default **Show Latest Buildable Designs**) and its type filter (default **Show All Design Types**);
- a list of the player's designs with the original's columns: Name, Role, Sub-role, Cost, Maint, Date Created, Size, Amount, Upgrade, Retrofit, Optimized, Obsolete. Manually created designs are orange;
- a detail pane for the selected design: its stats (defense, movement, energy, industry) and its component list;
- two toggles the original has in its grid: **Obsolete** (flip `isObsolete`) and **Retrofit** Automatic/Manual (flip `allowAutoRetrofit`).

There is **no design editor**. The original validates a new design in the UI (Main.Part6.cs:226 `GetDesignWarningMessages`), and neither design.ts nor designGeneration.ts exposes that check for the player. So the editor stays a TODO (step 1).

House style: copy the structure of `src/ui/screens/shipsAndBasesList.ts` / `coloniesList.ts`:
- module-level `open` state;
- `toggle…` / `close…` exports;
- a document `keydown` Escape handler that calls `stopImmediatePropagation`;
- pure helpers, so tests need no DOM (vitest has no jsdom).

## Existing code you use (read-only; verified at HEAD fe566ad)

- `src/sim/design.ts`: `class Design`, with these fields:
  - `name`, `role: BuiltObjectRole`, `subRole: BuiltObjectSubRole`, `components: ComponentDefinition[]` (each has `name`, `componentId`), `dateCreated`, `empire`, `pictureRef`, `size`
  - `isObsolete`, `isManuallyCreated`, `optimizedDesign`, `allowAutoRetrofit`
  - derived by ReDefine: `topSpeed`, `cruiseSpeed`, `warpSpeed`, `firepower`, `shieldsCapacity`, `shieldRechargeRate`, `armor`, `armorReactive`, `reactorPowerOutput`, `staticEnergyConsumption`, `reactorStorageCapacity`, `fuelCapacity`, `cargoCapacity`, `troopCapacity`, `fighterCapacity`, `constructionYardCount`, `maintenanceSavings`
  - getter `isPlanetDestroyer`; methods `calculateCurrentPurchasePrice(galaxy)` and `maximumRange()`.
- `src/sim/designGeneration.ts` (all exported, no Rnd, no writes):
  - `canBuildDesign(empire, design, includeSizeCheck = true, colony = null): boolean` (Empire.10.cs 430)
  - `findNewestCanBuildFullEvaluate(designs, subRole, colony, includePlanetDestroyers = true): Design | null` (DesignList.cs 240)
  - `findNewestPlanetDestroyer(designs): Design | null` (DesignList.cs 98)
  - `checkDesignSubRoleShouldBeUpgraded(empire, subRole): boolean` (Empire.10.cs 3082; reads `empire.policy`)
  - `resolveSubRoleDescription(subRole): string` (Galaxy.2.cs 2133 GameText, e.g. 'Capital Ship', 'Star Base')
  - The module imports `Empire` as a value; importing it standalone in vitest works (checked).
- `src/sim/construction/empireConstruction.ts`: `designCalculateMaintenanceCosts(galaxy, design, empire): number`. This is the port of BaconDesign.cs 163 `CalculateMaintenanceCosts`, the value the original's Maint column shows. It reads `empire.pirateEmpireBaseHabitat`, `empire.leader`, `empire.governmentId` and `design.maintenanceSavings` / `size` / `calculateCurrentPurchasePrice`.
- `src/sim/data/designSpecifications.ts`: `enum BuiltObjectRole { Undefined, Military, Exploration, Freight, Passenger, Colony, Build, Resource, Base }`.
- `src/sim/builtObjectTypes.ts`: `enum BuiltObjectSubRole`.
- `Empire` (src/sim/empire.ts): `designs: Design[]`, `capital: Habitat | null`, `pirateEmpireBaseHabitat`, `builtObjects`, `privateBuiltObjects`, `galaxy`.
- `BuiltObject` (src/sim/builtObject.ts): `design: Design` and `suppressAutoRetrofit: boolean`.
- `src/ui/hud.ts`: `formatMoney(n)`, `rgbCss(rgb)`.
- `src/ui/screens/empireSummary.ts`: `getEmpireSummarySource(): { empire } | null` (already imported by hud.ts and keyboard.ts).

## C# source (verbatim, trimmed)

DistantWorlds/Main.Part8.cs:1006-1028, the two selects (default indices 1 and 0):
```cs
cmbDesignsFilter.Items.AddRange(new object[5] { GetText("Show Latest Designs"), GetText("Show Latest Buildable Designs"), GetText("Show Non-Obsolete Designs"), GetText("Show Buildable Non-Obsolete Designs"), GetText("Show All Designs") });
cmbDesignsFilter.SelectedIndex = 1;
cmbDesignsFilterTypes.Items.AddRange(new object[5] { GetText("Show All Design Types"), GetText("Show State Ships"), GetText("Show State Bases"), GetText("Show Private Ships"), GetText("Show Private Bases") });
cmbDesignsFilterTypes.SelectedIndex = 0;
```
Main.Part8.cs:835 `method_306`, the filters:
```cs
switch (cmbDesignsFilter.SelectedIndex) {
    case -1: case 0: designList = method_304(); break;                         // latest
    case 1: designList = method_303(); break;                                  // latest buildable
    case 2: designList = PlayerEmpire.Designs.GetCurrentDesigns(); break;      // !IsObsolete
    case 3: designList = PlayerEmpire.Designs.GetCurrentDesignsBuildable(PlayerEmpire.Capital); break;
    case 4: designList = PlayerEmpire.Designs; break;
}
switch (cmbDesignsFilterTypes.SelectedIndex) {
    case 1: designList = designList.GetDesignsByRolesNoObsoleteFilter({ Military, Exploration, Colony, Build }); break;
    case 2: designList = designList.GetDesignsBySubRolesNoObsoleteFilter({ DefensiveBase, EnergyResearchStation, GenericBase, HighTechResearchStation, LargeSpacePort, MediumSpacePort, MonitoringStation, ResortBase, SmallSpacePort, WeaponsResearchStation }); break;
    case 3: designList = designList.GetDesignsBySubRolesNoObsoleteFilter({ GasMiningShip, LargeFreighter, MediumFreighter, MiningShip, PassengerShip, SmallFreighter }); break;
    case 4: designList = designList.GetDesignsBySubRolesNoObsoleteFilter({ GasMiningStation, MiningStation }); break;
}
```
Main.Part8.cs:697 `method_303` (latest buildable) and :753 `method_304` (latest). Both walk the same sub-role list, in this order: Escort, Frigate, Destroyer, Cruiser, CapitalShip, TroopTransport, Carrier, ResupplyShip, ExplorationShip, SmallFreighter, MediumFreighter, LargeFreighter, ColonyShip, PassengerShip, ConstructionShip, GasMiningShip, MiningShip, GasMiningStation, MiningStation, SmallSpacePort, MediumSpacePort, LargeSpacePort, ResortBase, EnergyResearchStation, WeaponsResearchStation, HighTechResearchStation, MonitoringStation, DefensiveBase.
```cs
// method_303
foreach (item in list) {
    design = PlayerEmpire.PirateEmpireBaseHabitat == null ? Designs.FindNewestCanBuildFullEvaluate(item, PlayerEmpire.Capital, includePlanetDestroyers: false)
                                                          : Designs.FindNewestCanBuildFullEvaluate(item, null, includePlanetDestroyers: false);
    if (design != null) designList.Add(design);
}
Design design2 = Designs.FindNewestPlanetDestroyer();
if (design2 != null && PlayerEmpire.CanBuildDesign(design2)) designList.Add(design2);
foreach (Design design3 in Designs) if (design3.SubRole == GenericBase && !design3.IsObsolete && PlayerEmpire.CanBuildDesign(design3)) designList.Add(design3);
// method_304: the same, with Designs.FindNewestNonPlanetDestroyer(item), and without the two CanBuildDesign checks.
```
DesignList.cs:113 `FindNewestNonPlanetDestroyer`, :261 `GetCurrentDesigns` and :272 `GetCurrentDesignsBuildable`:
```cs
public Design FindNewestNonPlanetDestroyer(BuiltObjectSubRole subRole) {
    long num = 0; Design result = null;
    foreach (Design design in this) if (design.SubRole == subRole && design.DateCreated > num && !design.IsObsolete && !design.IsPlanetDestroyer) { num = design.DateCreated; result = design; }
    return result;
}
public DesignList GetCurrentDesignsBuildable(Habitat colony) { foreach (design) if (!design.IsObsolete && design.Empire != null && design.Empire.CanBuildDesign(design, true, colony)) add; }
```
DistantWorlds.Controls/Controls/DesignListView.cs:301 `BindData`, the row. The headers are "Name", "Role", "SubRole", "Cost", "Maint" (GameText "Maintenance Abbreviation"), "Date Created", "Size", "Amount", "Upgrade", "Retrofit", "Optimized" and "Obsolete":
```cs
if (design.IsManuallyCreated) { color = Color.FromArgb(255, 102, 0); str1 = GetText("This design is manually created"); }
row.Cells[3].Value = Galaxy.ResolveDescription(design.Role);        // "Ship Role Military" = "Military" … Undefined = "None"
row.Cells[4].Value = Galaxy.ResolveDescription(design.SubRole);
row.Cells[5].Value = design.CalculateCurrentPurchasePrice(galaxy);
row.Cells[6].Value = design.CalculateMaintenanceCosts(galaxy, design.Empire);
long dateCreated = design.DateCreated;
int num3 = (int)(dateCreated / (long)(1000 * Galaxy.RealSecondsInGalacticYear));
long num4 = (long)(num3 * (1000 * Galaxy.RealSecondsInGalacticYear));
int num5 = (int)((dateCreated - num4) / (long)(100 * Galaxy.RealSecondsInGalacticYear));
long num6 = (long)(num5 * (100 * Galaxy.RealSecondsInGalacticYear));
int num7 = (int)((dateCreated - (num4 + num6)) / 2000L);
string str2 = num3.ToString("0000") + "." + (num5 + 1).ToString("00") + "." + (num7 + 1).ToString("00");
row.Cells[8].Value = design.Size;
int num10 = 0; // count Empire.BuiltObjects and Empire.PrivateBuiltObjects whose .Design == design
row.Cells[10].Value = PlayerEmpire.CheckDesignSubRoleShouldBeUpgraded(design.SubRole) ? GetText("Automatic") : GetText("Manual");
bool flag = true; switch (design.SubRole) { case SmallFreighter: case MediumFreighter: case LargeFreighter: case PassengerShip: case GasMiningShip: case MiningShip: flag = false; break; }
row.Cells[11].Value = design.AllowAutoRetrofit ? GetText("Automatic") : GetText("Manual");
if (!flag) { tooltip = GetText("Private design - cannot manually retrofit"); ForeColor = (96,96,96); }
row.Cells[12].Value = design.OptimizedDesign > 0 ? GetText("Yes") : GetText("No");
row.Cells[13].Value = design.IsObsolete ? GetText("Obsolete") : GetText("Not obsolete");
```
`Galaxy.RealSecondsInGalacticYear` is 600. The role texts are GameText.txt:1733-1740 ("Ship Role Base" = "Base", Build, Colony, Exploration, Freight, Military, Passenger, Resource).

Main.Part8.cs:1082 `ctlDesignsList_CellClick`, the two toggles:
```cs
if (Columns[e.ColumnIndex].Name == "Obsolete") { design.IsObsolete = !design.IsObsolete; … }
…
else if (Columns[e.ColumnIndex].Name == "AutoRetrofit") {
    bool flag2 = true; switch (design4.SubRole) { case SmallFreighter … MiningShip: flag2 = false; break; }   // same six private sub-roles
    if (!flag2) return;
    design4.AllowAutoRetrofit = !design4.AllowAutoRetrofit;
    foreach (BuiltObject bo in design4.Empire.BuiltObjects)        if (bo.Design == design4) bo.SuppressAutoRetrofit = !design4.AllowAutoRetrofit;
    foreach (BuiltObject bo in design4.Empire.PrivateBuiltObjects) if (bo.Design == design4) bo.SuppressAutoRetrofit = !design4.AllowAutoRetrofit;
}
```
The "Upgrade" column's click (`SetDesignSubRoleShouldBeUpgraded`, Main.Part8.cs:1105) writes the empire policy's `designUpgrade*` fields. The sim has no setter for it, so the column stays read-only (step 1 TODO).

The detail labels come from DistantWorlds.Controls/Controls/DesignDefense.cs:95-168 (Shields, Shield Recharge Rate, Armor, Reactive Armor Strength), DesignMovement.cs:117-203 ("(No movement)" when `TopSpeed <= 0`; else Cruise, Sprint, Hyper speeds), DesignEnergy.cs:88-138 (Reactor Power Output, Static Energy Usage, Fuel Capacity, Energy Storage) and DesignIndustry.cs:90-167 (Cargo Capacity, Construction). Sprint is `TopSpeed`, Cruise is `CruiseSpeed`, Hyper is `WarpSpeed`.

## Steps

1. `src/ui/screens/shipDesigns.ts`
   - Header comment: task 16b, streamlined Designs panel (F8). Cite Main.Part8.cs method_303/304/306 and ctlDesignsList_CellClick, DesignListView.cs BindData, and DesignDefense/DesignMovement/DesignEnergy/DesignIndustry. Add:
     - `// TODO(port): design editor — design validation is UI-side in the original (Main.Part6.cs:226 GetDesignWarningMessages, :164 btnDesignsSaveDesign_Click) and no sim API exposes it for the player`
     - `// TODO(port): Upgrade column toggle — Empire.SetDesignSubRoleShouldBeUpgraded (Main.Part8.cs:1105) has no sim setter`
     - `// TODO(port): copy / delete / auto-upgrade / manual-upgrade buttons, load/save design files, design images — not in 16b`
   - Imports: `import './shipDesigns.css';`, `import type` for `Empire`, `Galaxy`, `Design`, `BuiltObject`; `BuiltObjectRole` from `../../sim/data/designSpecifications`; `BuiltObjectSubRole` from `../../sim/builtObjectTypes`; the designGeneration functions above; `designCalculateMaintenanceCosts` from `../../sim/construction/empireConstruction`; `formatMoney`, `rgbCss` from `../hud`.
   - `export enum DesignFilter { Latest, LatestBuildable, NonObsolete, BuildableNonObsolete, All }` and `export const DESIGN_FILTER_LABELS: readonly string[]` (the five texts above, in order).
   - `export enum DesignTypeFilter { All, StateShips, StateBases, PrivateShips, PrivateBases }` and `DESIGN_TYPE_FILTER_LABELS` (the five texts, in order).
   - `export const LATEST_DESIGN_SUBROLES: readonly BuiltObjectSubRole[]`: the 28 sub-roles above, in that order.
   - `export function findNewestNonPlanetDestroyer(designs: readonly Design[], subRole): Design | null`: DesignList.cs:113.
   - `export function filterDesigns(player: Empire, filter: DesignFilter, typeFilter: DesignTypeFilter): Design[]`: method_306 + method_303 + method_304.
     - The colony for `LatestBuildable` is `player.pirateEmpireBaseHabitat === null ? player.capital : null`.
     - `BuildableNonObsolete` is `!d.isObsolete && d.empire !== null && canBuildDesign(d.empire as Empire, d, true, player.capital)`.
     - "CanBuildDesign(design)" is `canBuildDesign(player, d)`.
     - Each type filter keeps the list order.
   - `export function roleDescription(role: BuiltObjectRole): string`: GameText 1733-1740; Undefined → 'None'.
   - `export function designDateCreatedText(dateCreated: number): string`: the DesignListView.cs formula verbatim, with `Math.trunc` for every C# integer cast/division.
   - `export function isPrivateDesignSubRole(subRole): boolean`: true for the six private sub-roles (SmallFreighter, MediumFreighter, LargeFreighter, PassengerShip, GasMiningShip, MiningShip).
   - `export function designAmount(design: Design, empire: Empire): number`: count `builtObjects` + `privateBuiltObjects` whose `design === design` (skip null entries).
   - `export interface DesignRow { design: Design; name: string; role: string; subRole: string; cost: number; maintenance: number; dateCreated: string; size: number; amount: number; upgrade: string; retrofit: string; retrofitLocked: boolean; optimized: string; obsolete: string; manual: boolean }`
   - `export function designRow(design: Design, player: Empire, galaxy: Galaxy): DesignRow`: DesignListView.BindData, one row.
     - `cost = design.calculateCurrentPurchasePrice(galaxy)`;
     - `maintenance = designCalculateMaintenanceCosts(galaxy, design, (design.empire as Empire | null) ?? player)`;
     - `upgrade = checkDesignSubRoleShouldBeUpgraded(player, design.subRole) ? 'Automatic' : 'Manual'`;
     - `amount = designAmount(design, (design.empire as Empire | null) ?? player)`;
     - `retrofitLocked = isPrivateDesignSubRole(design.subRole)`;
     - `manual = design.isManuallyCreated`.
   - `export function designStatRows(design: Design): { label: string; value: string }[]`, in this order:
     - `Size`;
     - `Firepower` (`firepower`);
     - `Shields` (`shieldsCapacity`), `Shield Recharge Rate`, `Armor`, `Reactive Armor Strength`;
     - movement: when `topSpeed <= 0` a single row `Movement` = '(No movement)'; otherwise `Cruise` (`cruiseSpeed`), `Sprint` (`topSpeed`), `Hyper` (`warpSpeed`), and `Range` = `formatMoney(maximumRange())`. Omit Range when `maximumRange()` is not finite;
     - `Reactor Power Output`, `Static Energy Usage`, `Fuel Capacity`, `Energy Storage`;
     - `Cargo Capacity`: the value, or '(None)' when 0;
     - `Troop Capacity`, `Fighter Capacity` and `Construction` (`constructionYardCount`), each only when > 0.
     - Numbers use `String(Math.round(v))`.
   - `export function componentSummary(design: Design): { name: string; count: number }[]`: group `design.components` by `name`, first-seen order.
   - `export function toggleDesignObsolete(design: Design): void`: `design.isObsolete = !design.isObsolete` (Main.Part8.cs:1091).
   - `export function toggleDesignAutoRetrofit(design: Design, empire: Empire): boolean`: the AutoRetrofit branch. Return false and change nothing for a private sub-role. Otherwise flip `allowAutoRetrofit`, set `suppressAutoRetrofit = !design.allowAutoRetrofit` on every `builtObjects` / `privateBuiltObjects` entry with `design === design`, and return true.
   - DOM, like shipsAndBasesList:
     - `export interface ShipDesignsOptions { empire: Empire }`, `toggleShipDesigns(opts)`, `closeShipDesigns()`.
     - The window is titled `Designs (N)`.
     - A toolbar with the two selects. Keep both indices in module-level variables (defaults `LatestBuildable` and `All`), so reopening keeps them.
     - Left pane: the design table, with header cells Name | Role | Sub-role | Cost | Maint | Date Created | Size | Amount | Upgrade | Retrofit | Optimized | Obsolete.
       - Cost and Maint are `formatMoney`; numbers are right-aligned.
       - Manual rows get `color: rgb(255,102,0)` and the tooltip 'This design is manually created'.
       - A locked Retrofit cell gets `color: rgb(96,96,96)` and the tooltip 'Private design - cannot manually retrofit'.
     - A row click selects the design, with a highlight. The default selection is the first row; keep the selection across re-renders while that design is still listed.
     - Right pane (the selected design):
       - `name` (bold) and `subRole · role`;
       - `designStatRows` as a two-column list;
       - `Components` with `${count} × ${name}` lines;
       - two buttons: `Mark Obsolete` / `Mark Not Obsolete` (→ `toggleDesignObsolete`), and `Retrofit: Automatic` / `Retrofit: Manual` (→ `toggleDesignAutoRetrofit`; disabled with the private tooltip when locked).
       - Re-render after each click: the Obsolete toggle can drop the design from a non-obsolete filter.
     - The empty state is `<div class="ship-designs-empty">No designs</div>`.
     - No timer: rows are rebuilt on open, on filter change and after a toggle.
     - `galaxy` is `opts.empire.galaxy`.
2. `src/ui/screens/shipDesigns.css`: copy `shipsAndBasesList.css`, with the prefix `ship-designs-` in place of `ships-list-`.
   - `.ship-designs-window` is `width: 1040px`.
   - The body is a grid `grid-template-columns: minmax(0, 1fr) 280px`, and each pane has `overflow-y: auto; max-height: 70vh`.
   - Add `.ship-designs-row-selected`, `.ship-designs-number { text-align: right; }`, and a button style like diplomacyScreen.css (1px border `rgba(255,255,255,0.2)`, 4px radius, padding `3px 10px`).
3. `src/ui/hud.ts`: two blocks, all inside `[16b]` / `[/16b]` comments.
   - a. Import, right after `import { toggleColoniesList } from './screens/coloniesList';`:
     ```ts
     import { toggleShipDesigns } from './screens/shipDesigns'; // [16b]
     ```
   - b. Top bar. In `buildTopBarButton`'s click listener, inside the **final `else {`**, right after its `            // [/15c]` line and before ``            console.log(`TODO(screen): ${label ?? name}`);``:
     ```ts
                 // [16b] tbtnDesigns → Designs panel (Main.Part9.cs:4339 tbtnDesigns_Click).
                 if (name === 'tbtnDesigns') {
                     const src = getEmpireSummarySource();
                     if (src) toggleShipDesigns({ empire: src.empire });
                     return;
                 }
                 // [/16b]
     ```
     16c inserts its own block at the top of the same `else {`, above the `[15c]` block. Do not touch that area or `TopBarScreen` / `topBarScreen`.
4. `src/ui/keyboard.ts`: three blocks, nothing else.
   - Import, right after `import { helpTopicKeyForHabitat, toggleGalactopedia } from './screens/galactopedia';`:
     ```ts
     import { toggleShipDesigns } from './screens/shipDesigns'; // [16b]
     ```
   - `dispatchKey` switch: insert immediately **before** `case 'coloniesScreen':`, i.e. after the `        // [/15b]` line:
     ```ts
         // [16b] F8: Ship Designs (task 16b).
         case 'shipDesignsScreen': {
             const src = getEmpireSummarySource();
             if (src) toggleShipDesigns({ empire: src.empire });
             break;
         }
         // [/16b]
     ```
   - `IMPLEMENTED_KEY_ACTIONS`: a new line right after `'researchScreen', // [15b]`:
     ```ts
         'shipDesignsScreen', // [16b]
     ```
5. `src/main.ts`: two lines.
   - After `import { closeResearchScreen } from './ui/screens/researchScreen'; // [15b]`, add `import { closeShipDesigns } from './ui/screens/shipDesigns'; // [16b]`.
   - In `activeGameViewCleanup`, right after `closeResearchScreen(); // [15b]`, add `closeShipDesigns(); // [16b]`.
6. `test/keyboard.test.ts`: F8 is now implemented, so change only these two places. F4 (Intelligence Agents) stays unimplemented after all four 16x tasks.
   - In `'marks unimplemented actions as unavailable'`, replace `expect(isKeyActionAvailable('shipDesignsScreen')).toBe(false);` with `expect(isKeyActionAvailable('intelligenceAgentsScreen')).toBe(false);`.
   - In `'unavailable actions fall through to dispatchKey default branch'`, change `key: 'F8'` to `key: 'F4'`, and `toBe('shipDesignsScreen')` to `toBe('intelligenceAgentsScreen')`.

## Tests (`test/shipDesigns.test.ts`, no jsdom)

Designs are plain objects cast `as unknown as Design` (use `dateCreated >= 1`: both "newest" searches start from `> 0`; give base sub-roles `role: BuiltObjectRole.Base`): `{ name, role, subRole, dateCreated, isObsolete: false, isPlanetDestroyer: false, isManuallyCreated: false, optimizedDesign: 0, allowAutoRetrofit: true, size: 100, components: [], empire: player, … }`. The fake player:
```ts
const player = { designs: [] as unknown[], capital: null, pirateEmpireBaseHabitat: null, galaxy: null, leader: null, governmentId: -1, policy: null,
                 builtObjects: [] as unknown[], privateBuiltObjects: [] as unknown[], canBuildCarriers: true, canBuildResupplyShips: true,
                 research: { checkComponentResearched: () => true }, maximumConstructionSize: () => 1e9, maximumConstructionSizeBase: () => 1e9 } as unknown as Empire;
```
- `designDateCreatedText(0)` → '0000.01.01'. `600000 * 3 + 60000 * 2 + 2000 * 5 + 1` → '0003.03.06'.
- `roleDescription`: Military → 'Military', Base → 'Base', Undefined → 'None'.
- `findNewestNonPlanetDestroyer`: of two Escorts (dateCreated 10 and 20), it returns the 20. An obsolete 30 is ignored, and so is a planet destroyer 40.
- `filterDesigns`:
  - `All` returns every design in order. `NonObsolete` drops obsolete designs.
  - `Latest` returns one design per sub-role in LATEST_DESIGN_SUBROLES order (Escort before Frigate, whatever order they sit in `player.designs`), then the non-obsolete Star Bases (`GenericBase`).
  - `LatestBuildable` with the fake player gives the same list as `Latest`. With `research.checkComponentResearched = () => false` and a design that has one component, that design is gone.
  - Type filter `StateShips` keeps Military/Exploration/Colony/Build roles only, and `PrivateBases` keeps GasMiningStation/MiningStation only.
- `designRow` with `calculateCurrentPurchasePrice: () => 1000`, `size: 100`, `maintenanceSavings: 0` → `cost` 1000, `maintenance` 301 (`trunc(1000 / 5) + 1 + 1.0 × 100`). `upgrade` is 'Automatic' (a null policy upgrades). A SmallFreighter row has `retrofitLocked` true.
- `designStatRows`: `topSpeed: 0` → it contains `{ label: 'Movement', value: '(No movement)' }` and no 'Sprint' row. `cargoCapacity: 0` → 'Cargo Capacity' is '(None)'.
- `componentSummary` of `[A, B, A]` → `[{ name: 'A', count: 2 }, { name: 'B', count: 1 }]`.
- `toggleDesignObsolete` flips `isObsolete`.
- `toggleDesignAutoRetrofit`:
  - a SmallFreighter design → returns false and `allowAutoRetrofit` stays true;
  - an Escort design with one built object of that design in `builtObjects` and one of another design → returns true, `allowAutoRetrofit` is false, and only the first object has `suppressAutoRetrofit === true`.
- `isKeyActionAvailable('shipDesignsScreen')` → true.

Run `npm run typecheck && npm test`. keyboard.test.ts (with the step 6 edits), hud.test.ts and hudTopBar.test.ts must pass. With `npm run dev` on a private port (other agents share 5173), save `node scripts/shot.mjs 'http://localhost:<port>/?autostart=1' shots/16b-ship-designs.png` after pressing F8. Do not open the image. Then append `## Worker report` with: the files changed, the shot.mjs console output, and anything left undone.
