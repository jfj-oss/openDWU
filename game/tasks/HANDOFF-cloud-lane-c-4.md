# Handoff — cloud lane C, task C4: sound effects

Branch `claude/cloud-lane-c4` (based on working branch `4cdd3a7`). Typecheck clean; full suite passes, including `test/effectsPlayer.test.ts` (11 tests).

## Files
- **New:** `src/audio/effectsPlayer.ts`, `test/effectsPlayer.test.ts`.
- **Wiring:** `src/ui/hud.ts` adds one delegated click listener on the HUD root that plays one sound per HUD button click. `src/audio/musicPlayer.ts` (lane B, 09a) is untouched.

## Ported (C# refs, DistantWorlds/)
- `EffectsPlayer.cs`: every Resolve* builder with the exact gain constants and file choices (IonStrike, Weapon, FighterWeapon, AmbientEffect with next-effect offsets, AttackClick, ImportantMessage, Message with the standard/minor/alarm/major groups, HyperjumpEntry/Exit, Star, Mining, Thunder, Construction, GasMining, PlanetExplosion, Explosion). Also PlayEffect (pan clamp, volume, pitch), the sfx bank with on-demand load, Initialize's preload list, and ClearFinishedBuffers. Master volume is 0.7 (`double_0`). The variety RNG is seeded from the clock, as in C#; it never touches the galaxy stream.
- `SoundEffectRequest.cs` becomes the `SoundEffectRequest` interface.
- **Concurrency limit:** Main.Part13.cs method_0/1/2 becomes `SoundEffectQueue`. At most `int_3 = 10` pending requests; later ones are dropped (first-come, no other priority in the C#). `flush()` plays them in order and clears finished instances once per frame.
- **Positional volume:** MainView.1.cs method_90 becomes `resolveBalanceAndDistance(screenX, screenY, viewW, viewH, zoomFactor)`. Balance is the horizontal offset (-1..1). Distance runs 1 → 0.02 from the view centre, is divided by √zoomFactor, and is 0 past factor 50.
- **UI clicks:** following Main.Part13.cs 905-944, GlassButton → `button1.wav`, HoverButton/HoverMenuItem → `button2.wav`, ListViewBase → `grid.wav`. Each class restarts its sound on every play (one static SoundPlayer) and is silent when its Volume ≤ 0. In the HUD, options-list rows play button2 (HoverMenuItem); every other button plays button1 (the toolbar/cycle buttons are GlassButtons in Main.cs).
- `resolveGrid()` for Main.Part10.cs method_225 (grid.wav on control-group hotkeys / Main View picks). Not wired yet.

## Not ported / TODO
- `EffectsPlayer.DX.cs` (DirectSound) is skipped as requested.
- **Game-event wiring** (weapons, explosions, stars, mining, ambient nebula sounds, messages) waits for those systems. Call `queue.enqueue(player.resolveX(...resolveBalanceAndDistance(...)))` from the Main View and `queue.flush()` once per frame (MainView.cs 1493/1659 call method_1 per draw).
- **Options:** set `effectsPlayer.volume` / `uiClickSounds().volume` from SoundEffectsVolume when an options screen exists.
- **Weapon preload** needs component SoundEffectFilenames. `preload()` takes them; until then weapon sounds load on first use, as the C# PlayEffect fallback does.

## Verified
Headless Chromium: clicking the play/pause button fetches and plays `button1.wav`, and an options-list row plays `button2.wav` (both 200 from the real assets), with no page errors.
