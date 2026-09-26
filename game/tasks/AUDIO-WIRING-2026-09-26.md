# Audio wiring — every C# sound trigger and its TS site (2026-09-26)

C# root: `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds/`.
All effects go through `Main.method_0(request)` into `soundEffectRequestList_0` (Main.Part13.cs; at most
`int_3 = 10` pending, extra dropped, flushed once per Main View frame). In TS: `startEffects().request()` →
`SoundEffectQueue` (effectsPlayer.ts), flushed by `gameAudio.frame()` after `view.update()` (main.ts `[audio]`).

The C# has **no** `SoundEffectRequests.Add` / `AddSoundEffectRequest` / `PlaySoundEffect` in `DistantWorlds.Types`:
the sim never requests sounds. Every sim-side sound (weapons, explosions, hyperjumps, ion strikes, mining…) is
requested by the Main View **draw code** from flags the sim keeps on its objects (`Weapon.SoundEffectPlayed`,
`Explosion.ExplosionSoundPlayed`, `BuiltObject.HyperjumpAboutToEnter[SoundPlayed]`, `HyperjumpJustExited`,
`IonStrikeSoundPlayed`, `DoingMining`…). The TS sim already ports all of those flags (and their resets), so no sim
change was needed: `src/audio/mainViewSounds.ts` walks the same objects per frame (zoom factor < 500, on screen,
`IsObjectVisibleToThisEmpire(player)`), marks the flags played and requests the sound. No Galaxy.Rnd draws
(test: `audioWiring.test.ts` compares `galaxy.rnd` before/after); `npm run repin -- --check`: 0 changes.

Distance/balance rule "M90" = MainView.1.cs:2760 method_90 (`resolveBalanceAndDistance`): balance = (x − W/2)/(W/2);
distance = max(0.02, (1.5·halfDiag − dist)/(1.5·halfDiag)) / max(1, √zoomFactor), 0 when zoomFactor > 50.
"centre" = balance 0, full volume. Volumes are EffectsPlayer.cs Resolve* factors × the effects volume.

## Effects (EffectsPlayer requests)

| # | Trigger (C# site) | Sound file(s) (`Sounds/Effects`) | Distance / balance | Before | After (TS site) |
|---|---|---|---|---|---|
| 1 | Ship/base weapon shot drawn first frame — MainView.2.cs:1509 method_171 (via 1124 method_167, MainView.1.cs:1310) `ResolveWeapon(component)` ×0.23 | component `SoundEffectFilename` (components.txt col 5): laser.wav (Maxos/Pulse Blaster), laser2 (Shatterforce), laser3 (Impact Assault), laser4 (Titan Beam, PulseWave, Death Ray, Super Laser), torpedo_small (Epsilon), torpedo_medium (Velocity Shard, Shockwave), torpedo_large (Plasma Thunderbolt, Shaktur FireStorm), Torpedo_Large (Nuclear Devastator/Exterminator), missile_launch (Concussion, Seeking), missile_launch_massive (Assault Missile), point_defense (PD Cannon, Terminator), ion_bolt (Ion Cannon), ion_blast (Ion Pulse), AreaWeapon (Surgewave, Derasian Shockwave, Devastator Pulse), phaser (Phaser Cannon/Lance), railgun (Rail Gun, Long Range Gun), railgun_heavy (Heavy/Massive Rail Gun), tractorbeam, highpowertractorbeam, gravitonbeam, resonantgravitonbeam, areagravitonpulse, areatransientsingularity, assaultpod | M90 at the ship | no | mainViewSounds.ts `weaponSound` |
| 2 | Giant Ion Cannon shot — MainView.2.cs:1509 via 1143 method_169 (MainView.1.cs:843) | ion_bolt.wav | M90 at the planet | no | `collect` habitat loop |
| 3 | Fighter/bomber weapon — MainView.2.cs:1010 method_165 `ResolveFighterWeapon` (beam ×0.19, torpedo/missile ×0.25) | fighters.txt col 25: laser/laser2/laser4, torpedo_small/medium/large, missile_launch | M90 at the fighter | no | `collect` fighter loop |
| 4 | Ship/fighter explosion — MainView.2.cs:2789 method_185 (via 2777/2783) `ResolveExplosion(size)` | size < 100: explosion_small{,2,3}.wav ×0.75; else explosion{,2,3}.wav ×0.9 (×1 cap) | M90 at the explosion rect's top-left | no | `explosions` |
| 5 | Habitat explosions (bombardment) — MainView.2.cs:2640/2687 method_179/180 | as #4 | M90 | no | `explosions` (habitat loop) |
| 6 | Planet destroyed — MainView.2.cs:2854 method_187 `ResolvePlanetExplosion` ×2.1 | planetExplosion.wav | M90 | no | habitat loop |
| 7 | Ion strike on a ship (≤1400 ms after `LastIonStrike`, once per `IonStrikeSoundPlayed`, reset by BuiltObject.2.cs:6146 InflictIonDamage) — MainView.1.cs:1161 ×1.8 | ion_strike.wav | M90 | no | `collect` ship loop |
| 8 | Hyperjump entry (`HyperjumpAboutToEnter && !…SoundPlayed`) — MainView.1.cs:3083 method_97 ×0.45 | Hyperjump_Enter.wav | M90 | no | `hyperjump` |
| 9 | Hyperjump exit (every frame while `HyperjumpJustExited`; the sim clears it next tick) — MainView.1.cs:3093 ×0.5 | Hyperjump_Exit.wav | M90 | no | `hyperjump` |
| 10 | Ship construction (`DoingConstruction`, every 4100 ms star date) — MainView.1.cs:2932 method_95 ×0.7 | construction{,_2..._5}.wav | M90 | no | `industry` |
| 11 | Mining (`DoingMining`, 3000 ms) — MainView.1.cs:2969 ×0.22 (mining_4 ×0.5) | Mining_1/2/3.wav, mining_4.wav | M90 | no | `industry` |
| 12 | Gas mining (`DoingGasMining`, 5600 ms) — MainView.1.cs:3000 ×0.5 | GasMining1/2.wav, gasmining3.wav | M90 | no | `industry` |
| 13 | Star hum (current system's star drawn, every 4200 ms) — MainView.1.cs:2821 method_92 `ResolveStar(type)` ×1.2×(0.5–1.2) | star_basic/bass/hollow/ring/intense{1,2}.wav by HabitatType | M90 | no | `habitatSounds` |
| 14 | Planet/moon shipyard at work (yard busy, visible to player, every 4100 ms) — MainView.1.cs:2843 ×0.7 | construction*.wav | M90 | no | `habitatSounds` |
| 15 | Restricted-area ambient voices (view centre within range, zoom < 100, next at `+nextEffectOffset`) — MainView.1.cs:2779 method_91 `ResolveAmbientEffect(SoundScheme)` ×0.7 | ambient1_voice1-3, ambient2_voice1-4, ambient3_energy1-3, ambient4_boom1-3 | balance 0, distance 200 (→ min 1) | no | `ambient` |
| 16 | Nebula lightning thunder (view in a LightningDamage nebula, zoom < 150) — MainView.cs:1792 method_28 `ResolveThunder` ×1.3 | thunder1/2/3.wav | M90 at view centre | no | `lightning` (draws a view-local Random, not Galaxy.Rnd) |
| 17 | Empire message received (popup or ticker on, !SuppressAllPopups) — Main.Part9.cs:2352 `ResolveMessage(type)` ×0.7 (alarm ×0.4) | message_Minor/Alarm/Major/Standard.wav | centre | no | messagePopups.ts tick `[audio]` → `playMessageSounds` |
| 18 | Diplomatic conversation received — Main.Part9.cs:2358 (and 1556 method_253 when it opens) `ResolveImportantMessage` | message_Major.wav | centre | no | same (`route.conversation`) |
| 19 | Right-click attack/bombard order (ship; fleet incl. WaitAndAttack/Bombard) — Main.Part10.cs:3401 / 3539 `ResolveAttackClick` | attack_click.wav | centre | no | orderMenu.ts right-click `[audio]` (`r.attackClick`) |
| 20 | Main View left-click picks an object — Main.Part10.cs:3306 method_225 | grid.wav (effects volume) | centre | no | mainView.ts click `[audio]` |
| 21 | Set control group (Ctrl+0..9) — Main.Part7.cs:2509-2586 method_225 | grid.wav | centre | no | **no TS site** (control groups not ported) |
| 22 | GlassButton click — GlassButton.cs:119 (Main.Part13.cs:905) | button1.wav (SoundPlayer, full gain) | — | HUD only (hud.ts) | + every other screen: uiClicks.ts delegated listener (main.ts `[audio]`) |
| 23 | HoverButton / HoverMenuItem click — HoverButton.cs:40, HoverMenuItem.cs:82 | button2.wav | — | HUD options rows only | + order/context menu items, main-menu items |
| 24 | ListViewBase selection — ListViewBase.cs:167 | grid.wav | — | no | table / list rows (uiClicks.ts) |
| 25 | Link-label clicks (galactopedia 466, diplomacy 241, message 249, event link) — method_226 | button2.wav | — | no | covered by #22/#23 where the TS uses buttons; plain links: not wired |

## Music (MusicPlayer.cs; musicPlayer_0 = music, musicPlayer_1 = stings)

| Trigger (C#) | Rule | Before | After |
|---|---|---|---|
| Main menu shown — Start.1.cs:1211 `StartTheme()` | DistantWorldsTheme.mp3 | theme via mood "Theme" | `startMusic()` → `startTheme()` |
| Track ends — MusicPlayer.cs:210 MediaEnded → EbsZqjqvhZ | random **any** mp3 of Sounds/Music (all 21, incl. theme variants), never the current one; tracks do **not** loop | **deviation**: invented mood pools, `loop = true` (next track never picked) | fixed: `pickNextTrack(MUSIC_FILES)`, `loop = false` |
| Game view opened — Main.Part12.cs:2918 `ForceSwitch()` | fade out, then random track | **missing** (theme kept) | `musicGameStarted()` in installGameAudio |
| Game end — Main.Part12.cs:3428 DoGameEnd `StartTheme()` | theme | missing | empireComparison.ts `[audio]` |
| Quit — Main.Part7.cs:4568, Start.cs:2427 `Stop()` ×2 | stop both | missing | gameMenu/mainMenu exit `[audio]` |
| Fade timer — MusicPlayer.cs:286 | 50 ms, step max(0.005, √(lvl+0.1)·0.02), 20 settle ticks, then action; Volume·0.6 | ported, but fade-resume/pause semantics and IsPlaying differed | exact port (FadePause/FadeResume/FadeStop/ForceSwitch, IsPlaying = PlayPosition > 0) |
| Ambient area — MainView.1.cs:2812 | FadePause in a sound-scheme area below zoom 100; FadeResume when running, silent, no sting | missing | `ambientMusicAction` (+ a running fade timer blocks the resume: the XNA build shares one MediaPlayer, so a ForceSwitch could not be overridden there) |
| Event stings — Main.Part4.cs:487 method_523 → method_515 wonder / 516 happyEvent / 517 raceEvent / 518 characterEvent / 519 disaster / 520 dread / ArhCaEfBkk discovery | FadePause music, play the sting on musicPlayer_1 at the music volume | missing | `eventStingFile` via `Empire.eventMessageRecipient` (gate: SuppressAllPopups + sting not playing; TODO(port) flag7 per-type popup levels — event popup not ported) |
| Diplomacy talk opened — Main.Part8.cs:469 method_521 | diplomacyMood Menacing (pirate) / Neutral (reclusive, −10 ≤ att < 10) / Angry (< −10) / Happy | missing | messagePopups.ts openDialog `[audio]` |
| Talk / event window closed — Main.Part4.cs:465 method_522 | sting playing → FadeStop it + FadeResume music; else music silent → ForceSwitch | missing | messagePopups.ts closeDialog |
| Investigate ruins / abandoned ship — Main.Part7.cs:504 / 515 | discovery.mp3 (abandoned ship at SoundVolume.Maximum) | missing (comment only) | orderMenu.ts performAction `[audio]` → `investigateSting` |

## Volume / mute

Options "Music Volume"/mute and "Sound Effects Volume"/mute (settings.ts): `updateSettings` → `applySoundSettings`
now pushes music to **both** music players (SetVolume(Mute) = volume 0) as well as effects + UI click classes; players
created later read the stored settings. Before: the music volume/mute were only applied by the in-game menu rows and
were not read at start.

## Verification
Headless autostart game (speed 4, camera following a firing ship visible to the player): 97 requests, 78 × laser.wav
from one battle, plus message_* sounds; 1 dropped by the 10-request cap; no page errors.

## Notes
- The event-sting recipient is set on the player empire as a non-enumerable property (a UI callback, not game state:
  `serializeGame` skips it; a loaded game gets it again from `installGameAudio`).
- Songs are fetched whole and played from a blob URL, so a ForceSwitch never aborts a half-streamed media request.
- Not wired (no TS site): control-group hotkeys (#21), link-label clicks outside buttons (#25), the event popup's
  per-type `flag7` level gate, screen shake on big explosions (Main.method_217/218, not audio).
