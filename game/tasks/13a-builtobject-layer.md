# Task 13a — Draw BuiltObjects (ships, bases, pirates, traders) in the Main View

thinking: off
scope: locked

Create `src/render/builtObjectLayer.ts` and `test/builtobject-layer.test.ts`. Edit `src/render/mainView.ts` only as described in step 6: one import, one field, one constructor call and one update call. Do NOT edit anything under `src/sim/` (another lane owns it). Do NOT edit `src/ui/`. Start editing right away.

Notation: `z` is our camera zoom (px per world unit, max 1). `f = 1 / z` is the original's zoom factor (`main_0.double_0`). The world container is already scaled by `z` (mainView.ts `this.world.scale.set(z)`), so a size of `px` screen pixels is `px / z` world units.

## Sim data you read (read-only; verified to exist)

- `galaxy.builtObjects: BuiltObject[]` (src/sim/galaxy.ts). Holds every ship and base: empire ships, space ports, mining and research stations, pirate bases and fleets, independent traders, and abandoned ships (`empire === null`).
- `BuiltObject` (src/sim/builtObject.ts) has these fields: `xpos`, `ypos`, `name`, `size` (int, set by reDefine), `pictureRef` (int), `heading` (getter, radians; the start value is −π/2), `subRole: BuiltObjectSubRole`, `role: BuiltObjectRole`, `builtObjectID`, `hasBeenDestroyed`, `owner: Empire | null`, `empire: Empire | null`, `isPlanetDestroyer` (getter), and `design: Design`.
- `Design` (src/sim/design.ts) has `imageScalingType: DesignImageScalingMode` and `imageScalingFactor: number`.
- Enums:
  - `BuiltObjectSubRole` comes from `../sim/builtObjectTypes`. Its member order is Undefined, Escort, Frigate, Destroyer, Cruiser, CapitalShip, TroopTransport, Carrier, ResupplyShip, ExplorationShip, SmallFreighter, MediumFreighter, LargeFreighter, ColonyShip, PassengerShip, ConstructionShip, GasMiningShip, MiningShip, GasMiningStation, MiningStation, SmallSpacePort, MediumSpacePort, LargeSpacePort, ResortBase, GenericBase, …
  - `DesignImageScalingMode { None, Absolute, Scaled }` comes from `../sim/data/designSpecifications`.
- `MapOverlayState.fadeCivilianShips: boolean` is in `src/ui/mapOverlays.ts`. mainView.ts already holds it as `this.overlays`. Type-import it only.

## C# source (verbatim, trimmed)

**Image index → file.** From BuiltObjectImageCache.cs:949-1158 (GenerateBuiltObjectImageFilepaths) and BaconBuiltObjectImageCache.cs:20-80 (AddMoreImages). The index order is:
```cs
index 0: other\planetdestroyer
for (i < 2)  other\minorsets\bases\base_<i>                                       // 1..2
for (j < 7)  other\minorsets\family<j>\ military_small, military_medium, military_large, colonyship   // 3..30
for (k < 4)  other\majorsets\<Shakturi|ShakturiAllies|AncientHelpers|FreedomAlliance>\
                frigate, destroyer, cruiser, capitalship, trooptransport, base_0, base_1              // 31..58
             if (k == FreedomAllianceFamily /*3*/) majorsets\FreedomAlliance\aged\
                frigate, destroyer, cruiser, capitalship, trooptransport                              // 59..63
other\majorsets\PhantomPirates\ escort, frigate, destroyer, cruiser, capitalship, carrier, defensivebase, homebase  // 64..71
// then for each images\units\ships\family<N> in numeric order, AddMoreImages adds, per name in
{ "Escort","Frigate","Destroyer","Cruiser","CapitalShip","TroopTransport","Carrier","ResupplyShip",
  "ExplorationShip","SmallFreighter","MediumFreighter","LargeFreighter","ColonyShip","PassengerShip",
  "ConstructionShip","GasMiningShip","MiningShip","GasMiningStation","MiningStation","SmallSpacePort",
  "MediumSpacePort","LargeSpacePort","ResortBase","GenericBase" }  // one image each      // 72 + N*24 + slot
```
The sim already uses `pictureRef = 72 + family*24 + (legacySubRole − 1)` (designGeneration.ts `standardPictureRef`). Super pirates use `64 + n`.

**Real files in the install (verified; the Linux paths are case-sensitive, so use these exact spellings).** Under `/assets/dwu/images/units/ships/`:
- `family0/` … `family26/` (27 folders). Each has all 24 lower-case files: `escort.png frigate.png destroyer.png cruiser.png capitalship.png trooptransport.png carrier.png resupplyship.png explorationship.png smallfreighter.png mediumfreighter.png largefreighter.png colonyship.png passengership.png constructionship.png gasminingship.png miningship.png gasminingstation.png miningstation.png smallspaceport.png mediumspaceport.png largespaceport.png resortbase.png genericbase.png`. No numbered variants exist, so every family is exactly 24 images.
- `other/planetdestroyer.png`
- `other/MinorSets/bases/base_0.png`, `base_1.png`
- `other/MinorSets/family0/` … `family6/`: `military_small.png military_medium.png military_large.png colonyship.png`
- `other/MajorSets/Shakturi/`, `ShakturiAllies/`, `AncientHelpers/`, `FreedomAlliance/`: `frigate.png destroyer.png cruiser.png capitalship.png trooptransport.png base_0.png base_1.png`
- `other/MajorSets/FreedomAlliance/aged/`: `frigate.png destroyer.png cruiser.png capitalship.png trooptransport.png`
- `other/MajorSets/PhantomPirates/`: `escort.png frigate.png destroyer.png cruiser.png capitalship.png carrier.png defensivebase.png homebase.png`

**Minor-ship stand-in.** The sim leaves `pictureRef = 0` for some pirate minor ships (designGeneration.ts: `TODO(port): ShipImageHelper.ResolveMinorShipImageIndex (own clock-seeded Random)`). The C# picks those at random (ShipImageHelper.cs:176-231):
```cs
MinorBaseStartIndex = 1; MinorBaseCount = 2; MinorShipStartIndex = 3; MinorFamilyCount = 7;
ResolveMinorShipImageIndex(family = _Rnd.Next(0, 7), subRole, largeShips):
  case GasMiningStation/MiningStation/SmallSpacePort/GenericBase: ... num = MinorBaseStartIndex + _Rnd.Next(0, 2);
  case Escort: num2 = 0; Frigate: 1; Destroyer: largeShips ? 0 : 2; Cruiser: 1; CapitalShip: 2; ColonyShip: 3;
  if (num < 0) num = (MinorShipStartIndex + family * 4) + num2;
```

**Size.** From Main.Part12.cs:4604-4626 (DetermineBuiltObjectSizeNEW), called with `zoom = main_0.double_0` (MainView.1.cs:1027 `method_77(builtObject6, builtObjectImageData2, main_0.double_0)`):
```cs
double num = 1.0;
int num2 = imageData.Image.Size.Width * imageData.Image.Size.Height;
double num3 = (double)num2 / (double)imageData.Size;            // image area / content-pixel count
num = Math.Sqrt((double)builtObject.Size * num3 * Galaxy.BuiltObjectDrawResizeFactor /*8.0*/ / (zoom * zoom));
if (builtObject.Design != null && builtObject.Design.ImageScalingType != 0) switch (...) {
  case DesignImageScalingMode.Absolute: num = builtObject.Design.ImageScalingFactor / (float)zoom; break;
  case DesignImageScalingMode.Scaled:   num *= (double)builtObject.Design.ImageScalingFactor; break; }
return new Size((int)num, (int)num);
```
`imageData.Image` is the art after these steps (BuiltObjectImageCache.cs:521-534, 616-730):
1. CropImageContent(bitmap, padding 4). This finds the bbox of "content" pixels, pads it by 4 on each side, and makes it a square of side `max(width, height)` centred on the bbox.
2. Rotate 90° clockwise.
3. Scale to 30×30.

`imageData.Size` is DetermineImageContentSize, the count of content pixels. A content pixel is:
```cs
pixel.A > 0 && pixel.ToArgb() != Color.Black.ToArgb() /*opaque 0,0,0*/ && != ARGB(0,0,0,0) && != ARGB(0,255,255,255)
```
Crop maths:
```cs
num3 -= padding; num4 += padding; num -= padding; num2 += padding;   // minY, maxY, minX, maxX
int num8 = num4 - num3;  int num9 = num2 - num;                       // height, width
// square side = max(num8, num9), centred on the padded bbox
```

**Draw.** From MainView.1.cs:856-859 and 1034-1133, plus MainView.2.cs:2020-2029. Ships are drawn only while `double_0 < 500`. The texture is drawn at the size above, centred on (Xpos, Ypos), rotated by `Heading`. There is no empire tint: PrepareBuiltObjectImageNEW ignores its colour arguments.
```cs
if (main_0.double_0 < 500.0) { ... }
public void DrawBuiltObjectToMainXna(SpriteBatch spriteBatch, Texture2D ToDraw, BuiltObject builtObject, Rectangle destination, bool fadeCivilianShips) {
    float rotationAngle = builtObject.Heading;
    Color tintColor = Color.White;
    if (fadeCivilianShips && builtObject.Owner == null) tintColor = Color.FromArgb(144, 255, 255, 255);
    XnaDrawingHelper.DrawTexture(spriteBatch, ToDraw, destination, rotationAngle, tintColor); }
```
The cache rotates the art 90° clockwise at load, so on the raw PNG the Pixi rotation is `heading + π/2`.

## Steps

1. In `builtObjectLayer.ts`, add these constants:
   - `BUILT_OBJECT_DRAW_RESIZE_FACTOR = 8.0`
   - `BUILT_OBJECT_MAX_FACTOR = 500`
   - `STANDARD_SHIP_IMAGE_START_INDEX = 72`
   - `SHIP_SET_IMAGE_COUNT = 24`
   - `STANDARD_FAMILY_COUNT = 27`
   - `SHIP_SET_FILES`: the 24 lower-case names above, in the AddMoreImages order, without `.png`.
2. Add `export function builtObjectImagePath(pictureRef: number): string | null`. It returns the path relative to `units/ships/`, following the index table above with the exact folder spellings from the verified list.
   - Examples: `0 → 'other/planetdestroyer.png'`, `2 → 'other/MinorSets/bases/base_1.png'`, `9 → 'other/MinorSets/family1/military_large.png'`, `59 → 'other/MajorSets/FreedomAlliance/aged/frigate.png'`, `71 → 'other/MajorSets/PhantomPirates/homebase.png'`, `72 → 'family0/escort.png'`, `72+24*3+19 → 'family3/smallspaceport.png'`.
   - Return `null` for a negative index or for `family >= 27`.
   - Also add `export function builtObjectImageUrl(pictureRef: number): string | null`. It returns `'/assets/dwu/images/units/ships/' + path`, or null.
3. Add `export function resolveDrawPictureRef(bo: { pictureRef: number; isPlanetDestroyer: boolean; subRole: BuiltObjectSubRole; builtObjectID: number }): number`.
   - If `pictureRef !== 0 || isPlanetDestroyer`, return `pictureRef`.
   - Otherwise this is a render stand-in for the random ResolveMinorShipImageIndex. Leave a `// TODO(port): ShipImageHelper.ResolveMinorShipImageIndex — clock-seeded Random; deterministic stand-in` comment. The stand-in:
     - GasMiningStation/MiningStation/SmallSpacePort/GenericBase → `1 + (builtObjectID % 2)`;
     - otherwise `num2` from the table above (largeShips = false, default 0) → `3 + (builtObjectID % 7) * 4 + num2`. Use `Math.abs` on the ID.
4. Add `export interface ShipImageMetrics { areaRatio: number; cropSide: number; cropCenterX: number; cropCenterY: number }` and `export function shipImageMetrics(rgba: ArrayLike<number>, w: number, h: number): ShipImageMetrics | null`. This is a pure port of Crop + ContentSize on the raw RGBA:
   - Content pixel: `a > 0 && !(r === 0 && g === 0 && b === 0 && a === 255)`. Transparent pixels already fail `a > 0`.
   - Find minX, maxX, minY, maxY and the count. If the count is 0, return null.
   - `cropSide = Math.max(maxX - minX, maxY - minY) + 8`
   - `areaRatio = cropSide * cropSide / count`. Comment that the C# measures this on the 30×30 rescale, so this is the scale-free equivalent.
   - `cropCenterX = (minX + maxX) / 2`, `cropCenterY = (minY + maxY) / 2`.
5. Add `export function builtObjectSizePx(size: number, areaRatio: number, f: number, scalingType: DesignImageScalingMode, scalingFactor: number): number`. It is an exact port of the snippet above:
   - `num = Math.sqrt(size * areaRatio * 8.0 / (f * f))`
   - Absolute → `num = Math.fround(scalingFactor) / Math.fround(f)`
   - Scaled → `num *= scalingFactor`
   - `return Math.trunc(num)`.
6. Add `export class BuiltObjectLayer`:
   - `root = new Container()`.
   - `constructor(private galaxy: Galaxy, world: Container, private store: AssetStore, private overlays: MapOverlayState)` adds `root` to `world`.
   - Keep a `Map<BuiltObject, Sprite>`, created lazily the first time an object is on screen. Keep a per-URL `Map<string, ShipImageMetrics>`.
   - Loading, on the first sighting of a URL:
     - Load the texture with `store.loadFirst([url], () => makeDotTexture('#cccccc', 32))`. `makeDotTexture` is exported by `./assets`.
     - Measure metrics with an async helper `measureShipImage(url)`. Copy the Image + canvas + `getImageData(0, 0, w, h)` pattern from `sampleCentreColour` in `src/render/assets.ts` ~line 208, then call `shipImageMetrics`.
     - Skip measuring when `!store.dwuPresent`. If measuring fails, or the URL is null, use `{ areaRatio: 2, cropSide: tex.width, cropCenterX: tex.width / 2, cropCenterY: tex.height / 2 }`.
   - `update(z: number, cam: Camera)`:
     - `f = 1 / z`. `root.visible = f < 500`. If false, return.
     - For each `bo` of `galaxy.builtObjects`:
       - Skip `hasBeenDestroyed`.
       - Cull when `cam.worldToScreen(bo.xpos, bo.ypos)` is more than 100 px outside `[0, cam.width] × [0, cam.height]`. Hide the sprite if it exists.
       - Get the texture and metrics for `builtObjectImageUrl(resolveDrawPictureRef(bo))`. While they are loading, keep the sprite hidden.
       - `px = builtObjectSizePx(bo.size, m.areaRatio, f, bo.design?.imageScalingType ?? DesignImageScalingMode.None, bo.design?.imageScalingFactor ?? 1)`. If `px < 1`, hide the sprite.
       - Otherwise: position `(bo.xpos, bo.ypos)`; `anchor.set(m.cropCenterX / tex.width, m.cropCenterY / tex.height)`; `rotation = bo.heading + Math.PI / 2`; `scale.set(px / m.cropSide / z)`; `alpha = this.overlays.fadeCivilianShips && bo.owner === null ? 144 / 255 : 1`; `visible = true`.
   - Add a `// TODO(port): Empire.IsObjectVisibleToThisEmpire(BuiltObject) (MainView.1.cs:883) — not in sim; all objects drawn` comment. Add another TODO for the ship symbol `DrawShipSymbolXna` (MainView.1.cs:1085-1110) and for engine exhaust.
7. `src/render/mainView.ts`:
   - Import `BuiltObjectLayer`.
   - Add a field `private builtObjectLayer!: BuiltObjectLayer;`.
   - In `init()`, right after `this.overlayLayer = new OverlayLayer(...)` (~line 1128), add `this.builtObjectLayer = new BuiltObjectLayer(this.galaxy, this.world, this.store, this.overlays);`.
   - In `update()`, right after `this.overlayLayer.update(z, cam);` (~line 1234), add `this.builtObjectLayer.update(z, cam);`.
   - Nothing else changes.

## Tests (`test/builtobject-layer.test.ts`, no jsdom)

- `builtObjectImagePath`: the 7 examples in step 2, plus `-1 → null` and `72 + 27*24 → null`.
- `resolveDrawPictureRef`:
  - `{pictureRef: 100, …}` → 100.
  - pictureRef 0 with `isPlanetDestroyer: true` → 0.
  - pictureRef 0, subRole SmallSpacePort, ID 5 → 2.
  - pictureRef 0, subRole Frigate, ID 9 → `3 + 2*4 + 1 = 12`.
- `shipImageMetrics`: build a 10×10 RGBA `Uint8ClampedArray` (all zero), then set opaque red at x 2..5, y 3..4 (8 pixels). Set one opaque black pixel at (8, 8) and one pixel `(255,255,255,0)` at (0, 0).
  - Expect count-based `areaRatio` = `(3 + 8)² / 8 = 15.125`, `cropSide` 11, centre (3.5, 3.5).
  - An all-transparent image → null.
- `builtObjectSizePx` (None unless stated):
  - (300, 2, 1) → 69; (300, 2, 3) → 23; (300, 2, 10) → 6.
  - (0, 2, 1) → 0.
  - Absolute factor 40 at f 2 → 20.
  - Scaled factor 1.5, (300, 2, 1) → 103.

Run `npm run typecheck && npm test`. With `npm run dev` running, save `node scripts/shot.mjs 'http://localhost:5173/?autostart=1&zoom=2' shots/13a-ships-f2.png` and `…zoom=8… shots/13a-ships-f8.png`. Do not open them. Then append `## Worker report`: files changed, the console output from shot.mjs, and whatever was left undone.

## Worker report

**Files changed**
- `src/render/builtObjectLayer.ts` (new) — constants (`BUILT_OBJECT_DRAW_RESIZE_FACTOR`, `BUILT_OBJECT_MAX_FACTOR`, `STANDARD_SHIP_IMAGE_START_INDEX`, `SHIP_SET_IMAGE_COUNT`, `STANDARD_FAMILY_COUNT`, `SHIP_SET_FILES`); `builtObjectImagePath` / `builtObjectImageUrl` (full index table incl. minor/major sets, aged FreedomAlliance, PhantomPirates, family0..26); `resolveDrawPictureRef` (deterministic stand-in for ResolveMinorShipImageIndex, marked TODO(port)); `ShipImageMetrics` + `shipImageMetrics` (pure port of CropImageContent padding 4 + DetermineImageContentSize); `builtObjectSizePx` (exact port of DetermineBuiltObjectSizeNEW incl. Absolute/Scaled design scaling); `BuiltObjectLayer` class (lazy per-URL texture load via `store.loadFirst` with grey-dot fallback, async `measureShipImage` pixel measurement skipped when `!store.dwuPresent` with a 2:1 area-ratio fallback, viewport culling at 100 px, f < 500 gate, heading + π/2 rotation, crop-centre anchor, civilian fade alpha 144/255).
- `src/render/mainView.ts` — one import (`BuiltObjectLayer`), one field (`private builtObjectLayer!`), one constructor call in `init()` right after `overlayLayer`, one `this.builtObjectLayer.update(z, cam)` in `update()` right after `overlayLayer.update`. Nothing else changed.
- `test/builtobject-layer.test.ts` (new) — all specified cases: path-table examples + nulls, URL prefixing, resolveDrawPictureRef (explicit ref, planet destroyer, SmallSpacePort ID 5 → 2, Frigate ID 9 → 12, negative-ID abs), shipImageMetrics (10×10 red block → areaRatio 15.125 / cropSide 11 / centre 3.5,3.5; all-transparent → null), builtObjectSizePx (69 / 23 / 6 / 0, Absolute 40@f2 → 20, Scaled 1.5 → 103).

**Verification**
- `npm run typecheck`: passes (one fix during development: replaced a non-existent `Promise.isSettled()` check with a local settled flag).
- `npm test`: 85 files, 844 tests, all pass.
- Screenshots (not opened): `shots/13a-ships-f2.png`, `shots/13a-ships-f8.png`. Console output from both shot.mjs runs:
  ```
  [debug] [vite] connecting...
  [debug] [vite] connected.
  saved shots/13a-ships-f2.png
  ```
  ```
  [debug] [vite] connecting...
  [debug] [vite] connected.
  saved shots/13a-ships-f8.png
  ```
  No console errors reported by either run.

**Left undone (TODO(port) notes in code)**
- `Empire.IsObjectVisibleToThisEmpire(BuiltObject)` (MainView.1.cs:883) — not in sim; all objects are drawn.
- `DrawShipSymbolXna` (MainView.1.cs:1085-1110) — small symbol for ships too far away to show their art.
- Engine exhaust flames (MainView.1.cs ~1112-1133) — animated thrust frames behind moving ships.
- `ShipImageHelper.ResolveMinorShipImageIndex` uses its own clock-seeded Random in the original; the render stand-in is deterministic (ID-based) as specified.
