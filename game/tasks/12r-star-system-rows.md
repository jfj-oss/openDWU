# Task 12r — Selection panel: system rows for a selected star

thinking: off
scope: locked

Edit only `src/ui/hud.ts` (`buildSelectionRows` ~line 1058 and one new exported function next to `ownerRows` ~line 1043) and `test/hud.test.ts` (add a new describe block at the end). Do NOT edit keyboard.ts, hud.css, main.ts or anything under src/sim/. Start editing right away.

When a star is selected, the selection panel shows only `Planets N`, and it counts that number itself. The sim already caches per-system data on `SystemInfo`. Read `src/sim/types.ts` ~line 342:
```ts
planetCount?: number;
moonCount?: number;
independentColonyCount?: number;
dominantEmpire?: { empire: Empire; colonyCount: number; totalStrategicValue: number } | null;
otherEmpires?: { empire: Empire; colonyCount: number; totalStrategicValue: number }[] | null;
```
Galaxy.determineSystemInfo sets these fields (src/sim/galaxy.ts ~line 284, a port of Galaxy.1.cs DetermineSystemInfo). Do not change it. Show them in the panel.

1. `hud.ts`: add, right after `ownerRows`:
```ts
/** Rows for a selected star's system (task 12r), from the SystemInfo fields
 * cached by Galaxy.determineSystemInfo (Galaxy.1.cs DetermineSystemInfo). */
export function systemRows(sys: SystemInfo): { label: string; value: string; color?: number }[];
```
   Add rows in this order:
   - **Planets**, always shown: `${sys.planetCount ?? n}`. The fallback `n` is the number of `sys.habitats` with `category === HabitatCategoryType.Planet`.
   - **Moons**, only when the count is > 0: `sys.moonCount ?? (the Moon count of sys.habitats)`.
   - **Dominant**, when `sys.dominantEmpire` is set: the value is `colonyText(d.empire.name, d.colonyCount)`, with `color: d.empire.mainColor`.
   - **Also present**: one row for each entry of `sys.otherEmpires ?? []`, formatted the same way and with the same color field.
   - **Independent**, only when the count is > 0: the value is `${n} colony` or `${n} colonies`. Here n is the number of `sys.habitats` where `h.empire !== null && h.empire.empireId === 0`. The independent empire has empireId 0; see Empire.ts `empireId = isIndependentEmpire ? 0 : ...`. Do not use `sys.independentColonyCount`: it compares `h.empire === galaxy.independentEmpire`, so on a galaxy without an independent empire (null === null) it counts every unowned body.

   `colonyText(name, n)` is a small private helper. It returns `${name} (${n} colony)` when n === 1 and `${name} (${n} colonies)` otherwise.
2. `buildSelectionRows`:
   - The loop that renders `ownerRows(h)` builds a row with an optional 10px colour swatch. Move that loop body into a local function `addColorRow(row)`, and use it for the owner rows exactly as before.
   - Replace the existing star block (the `// Stars: how many planets orbit them.` block, which counts planets itself) with `if (h.category === HabitatCategoryType.Star) for (const r of systemRows(sel.system)) addColorRow(r);`
   - Keep it at the same position (after Diameter, before Resources).
3. Tests in `test/hud.test.ts` (no jsdom). Add `systemRows` to the existing hud import. Build a fake system like this: `{ systemStar: star, habitats: [...], sector: { x: 0, y: 0 }, ...fields } as SystemInfo`. Build fake empires like this: `{ name: 'A', mainColor: 0x112233, empireId: 3 } as unknown as Empire`. Use `new Habitat(HabitatCategoryType.Planet, HabitatType.Ocean, 'P1', 0, 0)` for habitats, as the ownerRows tests do. Test:
   - no cached fields, 2 planets + 0 moons → exactly `[{ label: 'Planets', value: '2' }]`;
   - `planetCount: 5, moonCount: 1` → Planets '5', Moons '1';
   - a dominant empire with 1 colony → `{ label: 'Dominant', value: 'A (1 colony)', color: 0x112233 }`;
   - `otherEmpires` with 2 entries → two 'Also present' rows, in order, with 'colonies' plural when the count is 2;
   - one habitat whose empire has `empireId: 0` → `{ label: 'Independent', value: '1 colony' }`, and no Independent row when none has empireId 0.

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

Files changed:
- `src/ui/hud.ts` — added exported `systemRows(sys)` (Planets always, Moons when > 0, Dominant with empire colour, one 'Also present' row per otherEmpires entry in order, Independent counted by `empire.empireId === 0` rather than `sys.independentColonyCount`) plus private `colonyText(name, n)` helper, right after `ownerRows`; in `buildSelectionRows` moved the owner-row loop body into a local `addColorRow(row)` and replaced the star block's self-counted planet count with `for (const r of systemRows(sel.system)) addColorRow(r)`, kept at the same position (after Diameter, before Resources).
- `test/hud.test.ts` — added `systemRows` to the hud import and a new `describe('systemRows (task 12r)')` block covering: habitat fallback counts (2 planets → `[{label:'Planets', value:'2'}]`), cached `planetCount`/`moonCount` preference, Dominant row with singular colony text and colour, two ordered 'Also present' rows with pluralisation at 2, Independent row from an `empireId: 0` owner (ignoring a bogus `independentColonyCount`), and no Independent row when none qualifies.

Done: everything in the task spec. `npm run typecheck` passes; `npm test` passes (55 files, 634 tests).

Left undone: nothing.
