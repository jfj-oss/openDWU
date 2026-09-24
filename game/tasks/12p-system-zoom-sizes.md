# Task 12p — System-zoom body sizes, star rendering bands, habitat labels

thinking: off
scope: locked

Edit only `src/render/mainView.ts`, `test/main-view-fades.test.ts`, and a new `test/main-view-system-sizes.test.ts`. Start editing right away.

Notation: `z` is our camera zoom (px per world unit, max 1). `f = 1 / z` is the original's zoom factor (`main_0.double_0`). `D` is `habitat.diameter`.

## C# source (verbatim, trimmed)

Main.Part11.cs:487-505. Planets and moons use a compressed zoom factor:
```cs
public double CalculatePlanetZoomFactor(double actualZoomFactor)
{ double result = actualZoomFactor;
  if (actualZoomFactor > 10.0) { result = Math.Max(10.0, actualZoomFactor / 1.25); } return result; }
public double CalculateMoonZoomFactor(double actualZoomFactor)
{ double result = actualZoomFactor;
  if (actualZoomFactor > 10.0) { result = Math.Max(10.0, actualZoomFactor / 1.1); } return result; }
```
MainView.1.cs:437-470, 626-642. Habitats are drawn while `f < 500`. The per-category factor is `double_`, the minimum size is 4 px (1 for asteroids), and the size is `Diameter / factor`:
```cs
if (main_0.double_0 < 500.0) { double num32 = main_0.CalculatePlanetZoomFactor(main_0.double_0);
  double num33 = main_0.CalculateMoonZoomFactor(main_0.double_0); ...
  double double_ = main_0.double_0;
  switch (habitat4.Category) { case Planet: double_ = num32; break; case Moon: double_ = num33; break; }
  int num35 = 4; if (habitat4.Category == HabitatCategoryType.Asteroid) { num35 = 1; }
  ...
  if (habitat4.Category == HabitatCategoryType.Star) { int_ = habitat4.Diameter; int_2 = habitat4.Diameter; }
  else { /* image aspect */ int_ = (int)(Diameter * aspect); int_2 = Diameter; }
  rectangle6 = method_35((int)habitat4.Xpos, (int)habitat4.Ypos, int_, int_2, double_, num35);
```
MainView.cs:2186-2191 (method_35):
```cs
int val = (int)((double)int_13 / double_15);  int val2 = (int)((double)int_14 / double_15);
val = Math.Max(int_15, val);  val2 = Math.Max(int_15, val2);   // rect centred on the habitat
```
MainView.1.cs:735-785. The star is drawn as discs plus a corona only while `f < method_60(type)`. Otherwise it is drawn as its plain texture:
```cs
else if (main_0.double_0 < method_60(habitat4.Type)) {
  int num59 = (int)((double)int_ * 0.98); ...            // rotating discs at 0.98 x size
  double num63 = 1.65; ... if (habitat4.Type == HabitatType.Neutron) { num63 = 2.3; ... }
  int num64 = (int)((double)int_ * num63); ...           // corona = size x 1.65 (neutron 2.3)
```
MainView.cs:3027-3058 (method_60 returns `result`; the `out` value is used by the glow, see below):
```cs
double result = 100.0; double_15 = 20.0;
MainSequence: result = 60.0; double_15 = 25.0;   RedGiant/SuperGiant: 75.0 / 30.0
WhiteDwarf: 40.0 / 9.0;   Neutron: 30.0 / 6.0;   BlackHole: 150.0 / 30.0;   SuperNova: 150.0 / 30.0
```
MainView.2.cs:5465-5473, 5491-5499. In the galaxy-level star pass, when `method_60(type) < f < 150` the map-star texture is drawn at:
```cs
int val7 = (int)((double)systemInfo.SystemStar.Diameter / double_15);  val7 = Math.Max(10, val7);
rectangle2 = new Rectangle(num38 - val7 / 2, num39 - val7 / 2, val7 + 2, val7 + 2);
if (double_15 > method_60(type) && double_15 < 5100.0) { DrawTexture(texture2D /*map star*/, rectangle2); }
```
Glow (MainView.2.cs:5507-5520, 3538-3540). This is **not in scope**, because the glow frames (`texture2D_19`) are not wired into our assets. Write it down in the worker report only. When `f > outV` (the out value above): `s = f < result ? 1 + (f-outV)/(result-outV) : 2`, `alpha = f < result ? (f-outV)/(result-outV) : 1`. The glow rect is `rectangle2` inflated by `w*s/2` on each side, so its width is `w*(1+s)`.

MainView.1.cs:1814-1919 (label rules). `flag11` means "draw the name". `flag12` means "populated colony" and draws a colony panel (method_89, out of scope: draw the plain name instead):
```cs
populated = habitat5.Owner != null && habitat5.Population != null && habitat5.Population.Count > 0
if (double_0 < 2.0)       { if (populated) flag12 = true; if (bases) flag11 = true; if (Planet) flag11 = true; }
else if (double_0 < 10.0) { if (populated) flag11 = true; if (bases) flag11 = true; if (Planet) flag11 = true; if (Ruin != null) flag13 = true; }
else if (double_0 < 40.0) { if (populated) flag11 = true; if (bases) flag11 = true; if (Ruin != null) flag13 = true; }
else                      { if (populated) flag11 = true; if (Ruin != null) flag13 = true; }
```
MainView.1.cs:2314-2338 (method_84). `int_11..int_14` is the habitat's drawn rect (x, y, w, h):
```cs
SpriteFont spriteFont = spriteFont_0 /*TinyFont*/; if (double_15 < 3.0) { spriteFont = spriteFont_3 /*NormalFont*/; }
int num3 = int_11 + int_13 - num / 2;          // text centred on the rect's RIGHT edge
int num4 = int_12 + int_14 / 2 - num2 / 2;     // vertically centred on the habitat
Color mainColor = color_1;                     // color_1 = FromArgb(255,160,160,160) (MainView.cs:1410)
if (habitat_1.Empire != null && habitat_1.Empire != galaxy_0.IndependentEmpire) mainColor = habitat_1.Empire.MainColor;
XnaDrawingHelper.DrawStringDropShadow(spriteBatch_2, habitat_1.Name, spriteFont, mainColor, point);
```
The XNA font pixel sizes are not in the C#. The GDI twin (method_85) uses font_3 = 10.67 at f ≥ 3 and font_0 = 16.67 at f < 3 (MainView.cs:624-627), so we use 11 / 17 px. The drop-shadow offset cannot be determined here, so use a 1 px black shadow. The star/system name is drawn only when `f > 150` (MainView.2.cs:5153 `num16 = 150.0`, 5627-5630). Nothing names stars at system zoom.

## Changes (src/render/mainView.ts)

1. Replace the three size functions (~line 110-125) and their comment. Add these exports:
   - `planetZoomFactor(f)` and `moonZoomFactor(f)`: exact ports of the two C# functions.
   - `planetSpritePx(d, z)`: `const f = 1 / z; return Math.max(4, Math.trunc(d / planetZoomFactor(f) + 1e-6));`
   - `moonDotPx(d, z)`: the same, using `moonZoomFactor`.
   - `starSpritePx(d, z)`: `Math.max(4, Math.trunc(d / (1 / z) + 1e-6))`. There is no cap (the C# has none, and z ≤ 1).
   - `starGalaxySpritePx(d, z)`: `Math.max(10, Math.trunc(d / (1 / z) + 1e-6)) + 2`.
   - `starDiscMaxFactor(type: HabitatType)`: the `result` column of method_60 above (default 100).
   - `habitatLabelVisible(isPlanet: boolean, populated: boolean, f: number)`: `f < 500 && (populated || (isPlanet && f < 10))`. Bases are not modelled, so ignore that flag. Skip the ruin marker (flag13).
   - `habitatLabelFontSize(f)`: `f < 3 ? 17 : 11`.
   - `habitatLabelColor(h: Habitat, independent: Empire | null)` (add `import type { Empire } from '../sim/empire'`): `h.empire && h.empire !== independent ? h.empire.mainColor : 0xa0a0a0`.
2. `SystemView.update` star block (~386-397). Delete the `crossT` fade. With `f = 1/z`, `S = starSpritePx(star.diameter, z)`:
   - If the star is not a BlackHole or SuperNova and `f < starDiscMaxFactor(star.type)`, call `updateStarDiscs(1, S, z, dt)` (the corona already uses `coronaScale` 1.65/2.3). Also set the disc sprites' scale to `S*0.98`. Hide `mapIcon` and `starSprite`.
   - Else, if the star is a BlackHole and `f < 150`: `starSprite` visible, alpha 1, size S. Discs and mapIcon hidden.
   - Else, if `f < 150`: `mapIcon` visible, alpha 1, size `starGalaxySpritePx`. Call `updateStarDiscs(0, …)` and hide `starSprite`.
   - Else (`f ≥ 150`): keep today's `mapIcon` with `iconPx`. Everything else hidden.
   - Use `Math.max(iconPx, <drawn star px>)` for the nameLabel offset. Then set `this.nameLabel.visible = labelAllowed && f > 150`.
3. Planets (~414-437). Remove `dotT`. `planet.dot.visible = false`. `planet.sprite.visible = f < 500`, alpha 1, size `sprPx = planetSpritePx(p.diameter, z)`.
   - Label: set `anchor.set(0.5, 0.5)` in the PlanetView constructor. Position it at `(px + (sprPx / 2) / z, py)` with scale `1/z`.
   - Set `visible = habitatLabelVisible(true, populated, f)`, where `populated = p.owner !== null && p.population.items.length > 0`.
   - Only when the value changes, set `style.fontSize = habitatLabelFontSize(f)` and `style.fill = habitatLabelColor(p, this.view.galaxy.independentEmpire)`.
   - Add `dropShadow: { color: 0x000000, distance: 1, blur: 0, alpha: 1, angle: Math.PI / 4 }` to the Text style.
4. Moons. Construct the MoonView sprite with `makePlanetTexture(PLANET_COLORS[moon.type] ?? '#888888')` instead of the dot texture. In `MainView.init`, add a lazy load next to the planet one (~920): `store.loadFirst(planetUrls(moon.habitat), …)` for every `planet.moons`. Size it with `moonDotPx`, visible when `f < 500`. Add a `label: Text` to MoonView built like the planet label, with the same rules and `isPlanet = false`.
5. Do not touch `drawnSize`/`pick`/overlayLayer/empireLayer. They already call these functions.

## Tests

In `test/main-view-fades.test.ts`, replace the `system-zoom minimum body sizes` describe (lines ~62-94) with an import-only stub or remove it. Its old constants are gone. `test/main-view-pick.test.ts` must still pass unchanged; only its comments go stale.

Create `test/main-view-system-sizes.test.ts`. Use `z = 1 / f`:
- `planetZoomFactor`: f 1→1, 10→10, 12→10, 50→40, 70→56. `moonZoomFactor`: 50→45.4545 (toBeCloseTo), 70→63.636.
- `planetSpritePx(300, z)`: f 1→300, 10→30, 12→30, 50→7, 70→5. `planetSpritePx(100, z)`: f 50→4, f 70→4 (min).
- `moonDotPx(400, z)`: f 1→400, 10→40, 50→8, 70→6. `moonDotPx(100, z)`: f 50→4.
- `starSpritePx(1000, z)`: f 1→1000, 10→100, 50→20, 70→14. `starSpritePx(150, 1/50)`→4.
- `starGalaxySpritePx(1000, 1/70)`→16. `starGalaxySpritePx(400, 1/70)`→12.
- `starDiscMaxFactor`: MainSequence 60, RedGiant 75, WhiteDwarf 40, Neutron 30, BlackHole 150.
- `habitatLabelVisible`:
  - (true, false, 5) → true
  - (true, false, 10) → false
  - (false, false, 5) → false
  - (false, true, 50) → true
  - (true, true, 600) → false
- `habitatLabelFontSize`: 2→17, 3→11.

Run `npm run typecheck && npm test`. If possible, take a screenshot at `?zoom=0.02` (f 50) with the headless shot script. Then append `## Worker report`, and include the glow formula from above as a follow-up note.

## Worker report

Files changed:
- `src/render/mainView.ts` — replaced the three ad-hoc size functions with exact ports (`planetZoomFactor`, `moonZoomFactor`, `planetSpritePx`, `moonDotPx`, `starSpritePx`) plus new exports `starGalaxySpritePx`, `starDiscMaxFactor`, `habitatLabelVisible`, `habitatLabelFontSize`, `habitatLabelColor` (added `import type { Empire }`). `SystemView.update`: star block now uses hard bands on f = 1/z (discs+corona while f < `starDiscMaxFactor(type)` for non-BH/SN; plain `starSprite` for BlackHole while f < 150; map icon via `starGalaxySpritePx` while f < 150; small `iconPx` map icon above) — the crossT fade is gone. Planets: no dotT/dot crossfade; sprite visible while f < 500 at `planetSpritePx`; label anchor (0.5, 0.5) centred on the drawn rect's right edge, visibility per `habitatLabelVisible(true, populated, f)`, font size/fill updated only on change, 1 px black drop shadow added. Moons: built as planet-textured sprites (`makePlanetTexture(PLANET_COLORS[moon.type] ?? '#888888')`), lazy `store.loadFirst(planetUrls(moon.habitat), …)` added in `MainView.init`, sized by `moonDotPx`, visible while f < 500, with a MoonView label using the same rules with `isPlanet = false`. System name label now requires `labelAllowed && f > 150`, offset from `Math.max(iconPx, starGalaxySpritePx)`. `drawnSize`/`pick`/overlayLayer/empireLayer untouched (they call the same functions).
- `test/main-view-fades.test.ts` — removed the stale `system-zoom minimum body sizes` describe (its 14/7/40 px constants are gone); left an import-only comment stub pointing at the new test.
- `test/main-view-system-sizes.test.ts` (new) — all specified cases: zoom factors (incl. 12→10 floor, 50→40, 70→56, moon 50→45.4545 / 70→63.636), sprite px floors, star/galaxy-star px, `starDiscMaxFactor` per type, `habitatLabelVisible` five cases, `habitatLabelFontSize` 2→17 / 3→11.

Verification:
- `npm run typecheck` passes; `npm test`: 55 files / 628 tests pass (incl. unchanged `main-view-pick.test.ts` — its comments about 14/7/40 px are now stale but it still passes since the pick helper takes size functions as arguments).
- Screenshots saved (not opened): `shots/12p-system-zoom-f50.png` (`?autostart=1&zoom=50`, i.e. z = 0.02 / f 50) and `shots/12p-system-zoom-f10.png` (`?zoom=10`, planet-label band). The headless shot script printed only vite connect lines — no console errors or pageerrors.

Left undone / follow-ups:
- **Star glow (out of scope, as noted in the task):** when `f > outV` (method_60's out value: MainSequence 25, RedGiant/SuperGiant 30, WhiteDwarf 9, Neutron 6, BlackHole/SuperNova 30, default 20): `s = f < result ? 1 + (f-outV)/(result-outV) : 2`, `alpha = f < result ? (f-outV)/(result-outV) : 1`; the glow rect is the map-star rect inflated by `w*s/2` per side (width `w*(1+s)`). Blocked until the glow frames (`texture2D_19`) are wired into our assets.
- Colony panel (method_89) for populated colonies — plain name drawn instead, per task.
- Ruin marker (flag13) not ported.
- `test/main-view-pick.test.ts` comments reference the old 14/7/40 px floors; harmless, could be refreshed later.
