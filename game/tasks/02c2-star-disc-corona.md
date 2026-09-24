# Task 02c2 — System-zoom star: tinted rotating discs + animated corona

thinking: off
scope: locked

Everything you need is below — **do not search for anything else**. Edit only `src/render/mainView.ts` and `src/render/assets.ts` (+ a new test file). Start editing right away. Do not Read image files.

## What the original does (ported from `MainView.1.cs` 740–782, the GPU renderer)

```csharp
// color_6 = the centre pixel of this star's MAP-STAR image (the same image used at galaxy/sector zoom)
System.Drawing.Color color_6 = method_120(main_0.bitmap_196[habitat4.MapPictureRef]);   // GetPixel(w/2, h/2)
// disc rotation: double_5 -= elapsedSeconds * 0.02  (radians)
float num62 = (float)double_5 * -1f;
System.Drawing.Color color_7 = System.Drawing.Color.FromArgb(255, method_65(color_6, 1.2));
method_118(spriteBatch_0, x, y, w, h, texture2D_14[2], now, num62, color_7);      // star_disc_2, rotation +angle, tint colour*1.2, alpha 255
System.Drawing.Color color_8 = System.Drawing.Color.FromArgb(96, method_65(color_6, 1.0));
method_118(spriteBatch_0, x, y, w, h, texture2D_14[0], now, double_5, color_8);   // star_disc_0 on top, rotation -angle, tint colour, alpha 96
double num63 = 1.65; Texture2D[] frames = texture2D_15 /* CoronaB */; int fps = 15;
if (habitat4.Type == HabitatType.Neutron) { num63 = 2.3; frames = texture2D_16 /* CoronaC */; fps = 12; }
// corona drawn centred on the star at (star size * num63), no rotation
System.Drawing.Color color5 = System.Drawing.Color.FromArgb(240, method_65(color_6, 1.2));
method_117(spriteBatch_0, cx, cy, w * num63, h * num63, frames, now, fps, 0.0, 0.0, color5);

// method_65(c, f): each of R,G,B = clamp(0..255, (int)(channel * f))
// method_117 frame selection (100 frames):
//   loopMs = (int)(frames.Length / fps * 1000.0);  stepMs = loopMs / max(1, frames.Length - 1);
//   frame  = (int)((nowMs % loopMs) / stepMs);
// XNA sprite tint = per-channel multiply (same as Pixi `sprite.tint`), alpha = sprite.alpha.
```

Textures (URLs under `/assets/dwu/images/environment/stars/`): `star_disc_0.png`, `star_disc_2.png`; corona frames `rays/CoronaB-0001.png` … `rays/CoronaB-0100.png` and `rays/CoronaC-0001.png` … `rays/CoronaC-0100.png` (4-digit, 1-based). The map-star image for a star is the one `mapStarUrls(habitat)` in `assets.ts` already returns.

## Implement
1. `assets.ts`: `starDiscUrl(n)`, `coronaFrameUrls('B'|'C')` (100 URLs), and `async sampleCentreColour(url): Promise<number>` — draw the image to an `OffscreenCanvas`/canvas, read pixel (⌊w/2⌋, ⌊h/2⌋), return `0xRRGGBB`; cache per URL.
2. Pure helpers (exported, unit-tested): `scaleColour(rgb, f)` (method_65), `coronaFrameIndex(nowMs, frameCount, fps)` (method_117 formula above).
3. `mainView.ts`, system-zoom star (not black holes — leave those as they are): replace the plain disc with a container of: disc A (`star_disc_2`, tint `scaleColour(c,1.2)`, alpha 1, rotation `+angle`), disc B (`star_disc_0`, tint `c`, alpha 96/255, rotation `-angle`), corona (current frame of B or C, size × 1.65 or × 2.3 for neutron stars, tint `scaleColour(c,1.2)`, alpha 240/255, no rotation). `angle += dtSeconds * 0.02` each frame. Load corona frames lazily (only when a star is at system zoom) and only once.
4. Tests (`test/star-render.test.ts`): `scaleColour(0x808080, 1.2) === 0x999999`, clamps at 255; `coronaFrameIndex` = 0 at t=0, advances ~every 67 ms at 15 fps, wraps after ~6666 ms, never ≥ 100.

Verify: `npm run typecheck`, `npm test`; save (don't open) `?zoom=4&cx=4570664.9&cy=3835180.6` → `shots/02c2-star.png` with `npm run dev` running. Append `## Worker report`.
