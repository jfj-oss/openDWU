# Combat verification — 2026-09-26

Package **combattest**: prove combat works on the headless sim and matches the decompiled C#. Deliverables:
`test/combatScenarios.test.ts` (scenarios 1-5, test:fast tier), `test/combatSoak.test.ts` (scenario 6, `// @slow`),
`scripts/sim-run.mjs --combat` (battle report), two sim fixes (below).

C# root: `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/` (`DistantWorlds.Types/`, `BaconDistantWorlds/`).
All staged battles run on the seed-1 harness game (`cachedTickGame`), mostly in an empty patch of space (≥ 300 000 from any
habitat or ship) so no base or third party joins in. Every expected value in the tests is hand-worked from the C# and
cited next to the assertion; Rnd-dependent values are replayed draw for draw on a copy of `galaxy.rnd`.

## What was verified

### (1) One escort vs one pirate ship (player Attack order)
Cast: player Javelin 001 (2 × Standard Beam: 5 dmg, range 190, energy 12, speed 360, fire rate 1240 ms) vs S269
Confederacy's Hidden Aspiration (pirate explorer, shields 100, 4 armour plates 10/2, 37 components).
- `executeShipAction` Attack (Main.Part7.cs method_347 → AssignMission Attack) gives the escort the Attack mission on the target.
- **One shot, draw for draw** — BuiltObject.1.cs 5089 FireWeaponsAtTarget: jitter `NextDouble×800−400` against FireRate;
  5243 DetermineHitTarget with the numbers worked out (range 190, distance 150 → hitRangeChance 0.3605; target speed
  50 → val clamped to 0.7; all modifiers 0 → hit iff NextDouble > 0.3537, then the Next(0,12) flip); Weapon.cs 253
  FireInternal heading draws; 24 energy spent; firer joins Attackers. RNG state identical after the call.
- **Gates**: 400 ms later both beams are still cooling (jitter drawn, nothing fires); at 191 > range nothing is even
  rolled; at energy 11 < 12 nothing fires.
- **Beam flight** (BuiltObject.1.cs 3737 HandleWeaponsFiring): +2 on the launch step, then Speed×dt; out of view it hits
  when the distance to target starts growing (3, 39, 75, 111, 147, 183); power = BaconBuiltObject.cs 3057
  WeaponDamageDropoff = 5 − (183/190)×5 = 0.184; applied to shields only.
- **Damage order** (BuiltObject.2.cs 6221 InflictDamage): shields absorb whole hits (no draws); the hit that empties them
  spills `(int)(hit − shields + 0.5)` into the first Normal armour plate (Value2 2 absorbs, break roll `NextDouble <
  Max(0.1, rest/Value1)`, −Value1), then DamageReduction, then random components `Next(0, Count)` (re-drawn ≤ 30× while
  Damaged) until the damage is used up; then the 5-draw explosion. Destruction when UndamagedComponentSize ≤ damage.
- **Harness**: fires within 1 s, every shot within range, per-beam shot spacing ≥ 1240 − 400 ms, first armour hit only
  once shields < one hit, first component hit only after every plate is gone, target destroyed, its
  `galaxy.builtObjects` slot becomes `null` (CompleteTeardown), gone from its empire, attacker's mission cleared.

### (2) 4-ship fleet vs a pirate base
Cast: S83 Prowlers' S66 Outpost (8 Missile 520, 24 Rail Gun 120, shields 1800, recharge 5.4/s) vs a new player fleet of
Enforcer 001/002 + Colossia 001/002 at 450/500/400/480.
- **Threat ranking** (Galaxy.7.cs 3681 DetermineThreatLevel, 3253 EvaluateThreats): `(20000 − d)²/1e6 × 50 (pirate viewer)
  × Max(10, Size/10)` → Colossia 001 422 576 > Colossia 002 419 133 > Enforcer 001 382 202 > Enforcer 002 380 250; the
  sorted list matches exactly.
- **Base fires back** (BuiltObject.cs 4557 DefendBase walks Threats in that order): first base shot is a Missile (only
  weapon reaching 400-500) at Colossia 001.
- **Fleet target choice**: every ship keeps the base as its target for the whole 45 s: BuiltObject.1.cs 422
  CheckAssignAttackOnThreat refuses to retarget a ship on a fleet mission while `ShipGroup.AllowImmediateThreatEvaluation`
  is false (a player-ordered fleet; only the AI's fleet dispatch sets it, Empire.1.cs 3262 / Empire.3.cs 4965).
- **Shield recharge** (BuiltObject.1.cs 2225 RechargeShields): `ShieldRechargeRate = Σ Value2/10` (BuiltObject.cs 2296);
  `+Min(rate×dt, room, energy)` with the same energy spent — unit cases (rate-, energy-, room-limited) and every DoTasks
  frame of the harness run where the base was not struck.

### (3) Carrier fighters
Cast: Sol 2 Space Port (fighter capacity 160 → 16 Standard Fighters) vs Elite Scorpion 1580 away.
- A base engages only within 3000 (BuiltObject.1.cs 973, 9 000 000 squared); ShouldAttack true → DefendBase →
  LaunchAllFighters; all 16 launch, pursue and fire, the pirate is worn down.
- **Return rules** (BaconFighter.cs 153 DoTasks intermediate pass, every 3 s): damage — Health < 1 with DamageRepairRate 0
  (Fighter.cs 502); range — `225 × fighterRangeMultiple (BaconSettings 30) × TopSpeed² × 2 (base carrier)` = 148 837 500
  (BaconFighter.cs 30 / 131); out of ammo — a `*` mark with weapon 0 not in flight (BaconFighter.cs 218; CheckOutOfAmmo
  only marks missile/torpedo craft, 186). A healthy fighter inside range stays out.
- Fighters have **no fuel** in the C#: only energy (Fighter.cs 2092/2101 RechargeEnergy/RechargeShields). Out of view a
  fighter is leashed to its carrier (Fighter.cs 1805-1829: Patrol at 600, others at 1500), so the range rule only bites in
  view — faithful, and asserted.

### (4) Boarding
Cast: Black Pillagers' Worthy Firelance (1 Assault Pod 50/140; TroopStrength 138; Pirate play style RaidStrengthFactor
1.25) vs player Sol Starseeker (3 Hab Modules, TroopStrength 121), shields down, engines out.
- Attack per pod `(short)(50 × 1.38 × 1 × 1 × 1.25) = 86` (BuiltObject.1.cs 2626 / 3314); defence
  `3 × (int)(20 × 1.21) = 72` (3399). One ProcessBoardingAssault step (2954) replayed draw for draw (both attrition
  draws, the DisableRandomComponent roll). Harness: a Capture mission launches the pod within 2 s, defence only falls,
  and the ship changes hands (in the captor's list, out of the player's).

### (5) Invasion
Cast: independent colony Dhayu 3 (567 M Dhayut, no troops), a player Sabre troop transport with six infantry.
- One ResolveInvasionBattles round (Habitat.cs 3365-3470) hand-worked from the strengths: loss factors
  `Min(2, Max(0.5, D/(A+1)))`, `Max(0.5, √((A+D)/1e4)/2)`, the two `0.8 + NextDouble×0.4` draws, the overwhelm
  corrections, InflictTroopLosses (4978) landing on `Next(0, Count)`, the population-casualty draw. RNG identical.
- Success threshold `attack/defence ≥ 20` (3771); an undefended colony (defence 0, population strength not added
  without troops, 3431) falls on the first round.
- Harness: an Attack order sends the transport in, the troops land (InvadingTroops), the colony changes owner and the
  invaders become its garrison.

### (6) 30 game-minutes headless
`node scripts/sim-run.mjs --seed 1 --stars 300 --empires 4 --seconds 1800 --combat` (the harness game; 99 s wall):
**319 SpaceBattleStats records with weapon activity** (295 closed, 24 open at the end), **25 ships destroyed** (5 Free S160
Consortium frigates, 2+2 destroyers, pirate escorts/frigates, explorers, one player gas miner), 4 863 hits / 3 313 misses
(hit rate 0.60), 16 538 damage dealt, 12 046 absorbed by shields. `test/combatSoak.test.ts` (@slow) repeats the run in
vitest and asserts floors (> 50 records, > 5 destroyed, military losses, > 100 hits, kills recorded) plus per-record sanity.

## Deviations found and fixed

1. **GenerateBuiltObjectFromDesign built ships with every component Unbuilt** — `src/sim/exploration.ts` had
   `COMPONENT_STATUS_NORMAL = 0`, but ComponentStatus is `Unbuilt 0, Normal 1, Damaged 2` (ComponentStatus.cs); Empire.cs
   4346 sets `Normal`. Every ship spawned through it (event/story ships, pre-warp spaceports, empireEvents) was born
   with no engines, reactor, weapons or bays (topSpeed 0, troop capacity 0). Fixed to 1; test (5) asserts a generated
   transport is all Normal with troop capacity 300 and speed > 0.
2. **Empire.RaidStrengthFactor read as 1.0 in the boarding maths** — `combat/attackAI.ts` and `fleets/shipGroupTasks.ts`
   read a non-existent `empire.raidStrengthFactor` field (always 1.0) in CalculateAvailableAssaultPodAttackStrength
   (BuiltObject.1.cs 3314), CalculateBoardingDefenseValue (3399) and CalculateAssaultPodAttackValues (3342); the C#
   value is set per pirate play style by BaconEmpire.cs 75 SetPirateFactionModifiers (Pirate/Mercenary 1.25, Smuggler
   0.75; kept in `Empire.pirateFactionModifiers`). `boarding.ts` already read it correctly, so a pod hit (86) and the
   available-strength estimate (69) disagreed. One implementation now lives in attackAI.ts (boarding.ts re-exports it);
   test (4) asserts 86 from both.

**Pins moved** (`npm run repin -- --reason …`): `tickDeterminism.digest600`, `.counts600` (builtObjects 464 → 460),
`.rndDraws600` — the Rnd stream and the ship census change once generated ships work and pirate boarding strength is right.

## Observed, faithful (not changed)

- A lone Javelin on its stock AllWeapons tactics sits at 123-171 (BuiltObject.2.cs 131 SetOptimalAttackRanges), where the
  Bacon damage fall-off leaves a beam < 1 damage: it empties shields but can never beat a 10/2 armour plate. Scenario 1
  sets the design's tactics to Point Blank.
- `SpaceBattleStats.DamageToUs` goes negative (armour leaves `num5` negative before DamageHullUs, BuiltObject.2.cs 6524);
  BaconSpaceBattleStats.AddLatestCombatStats clamps with `Max(…, 0)`. Seen in the soak (hull dmg −48 / −85).
- Bases have no BattleStats; ships destroyed by bases, fighters or creatures show up in "destroyed" without a kill in a
  record (25 destroyed vs 6 attributed kills in the soak).
- Invasion rounds in the headless sim never draw the ColonyInvasion UI's `Next(0, InvadingTroops.Count)` (Habitat.cs
  3486, only with the invasion view open) — correct for a headless run.

## Not verified (remaining)

- Area weapons (Ion Pulse / Area Destruction / Area Gravity), torpedo/missile flight and point defence
  (BaconBuiltObject.cs 5032 InterceptMissiles), tractor beams, gravity beams, phasers, rail-gun shield bypass beyond the
  code read-through (only beam damage is exercised end to end).
- Planet destroyers, bombardment (InflictBombardDamage), ion damage, creature combat beyond the M4p slug smoke.
- Fighter vs fighter dogfights, bombers and ammo exhaustion on a live run (only the rule itself is unit-tested).
- Raids (assault pods at colonies, PerformRaidColonyInvasion), special forces, planetary defence units, reinforcements
  (CheckForReinforcements for non-independent defenders), invasion with characters (generals).
- The AI's own attack decisions (fleet dispatch with AllowImmediateThreatEvaluation, CheckAssignAttackOnThreat's
  retargeting branch, Escape/flee thresholds other than the FleeWhen switch) are only exercised by the soak.
- Why many soak records show only misses (e.g. Worthy Firelance 0 hits / 47 misses near Dhayu 3): misses count shots
  that fly past range (BuiltObject.1.cs 3931), plausible for long-range shots at moving targets, but not traced.
