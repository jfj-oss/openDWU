# Seed-pin history

Appended by `npm run repin -- --reason "<why>"` (scripts/repin.mjs).

## 2026-09-25 — seed pins moved into test/pins

- Value-neutral refactor: the `PINNED_*` constants and inline seed-1 literals of 14 test files became `toMatchPin` pins (37 in seed1.json, 13 in-place literals); tickDeterminism also pins the 120 s digest / draws and the 600 s counts / draws next to the 600 s digest. Earlier moves are in the reason comments above each pin.

## 2026-09-25 — 17d: human player starts with C# automation defaults (Start.2.cs:2122)

- `tickDeterminism.digest120` (test/tickDeterminism.test.ts): Moved "7e883fd654919362" → "de44201fa725100c": 17d: human player starts with C# automation defaults (Start.2.cs:2122)
- `tickDeterminism.rndDraws120` (test/tickDeterminism.test.ts): Moved 5019 → 4959: 17d: human player starts with C# automation defaults (Start.2.cs:2122)
- `tickDeterminism.digest600` (test/tickDeterminism.test.ts): Moved "d4e45fea75fa52d8" → "a59640a37d6c8238": 17d: human player starts with C# automation defaults (Start.2.cs:2122)
- `tickDeterminism.counts600` (test/tickDeterminism.test.ts): Moved #f1aebd5dcd → #d21f9fe281: 17d: human player starts with C# automation defaults (Start.2.cs:2122)
- `tickDeterminism.rndDraws600` (test/tickDeterminism.test.ts): Moved 389082 → 384537: 17d: human player starts with C# automation defaults (Start.2.cs:2122)

## 2026-09-25 — fix4sim: BaconMain.cs 605-640/859-874 BaconInitialize applies the stock BaconSettings.txt (useStarGravityWells=false, HyperJumpThreshhold=4000, BaseHyperJumpAccuracy=666, sublightFuelBurnDivisor=20, noFuel* 0.9/0.9/0.5) after createGame; Galaxy.5.cs 1609-1616/1747-1752 populated planets/moons get Cargo/Troop lists

- `tickDeterminism.digest120` (test/tickDeterminism.test.ts): Moved "de44201fa725100c" → "54fda35daf42512d": fix4sim: BaconMain.cs 605-640/859-874 BaconInitialize applies the stock BaconSettings.txt (useStarGravityWells=false, HyperJumpThreshhold=4000, BaseHyperJumpAccuracy=666, sublightFuelBurnDivisor=20, noFuel* 0.9/0.9/0.5) after createGame; Galaxy.5.cs 1609-1616/1747-1752 populated planets/moons get Cargo/Troop lists
- `tickDeterminism.rndDraws120` (test/tickDeterminism.test.ts): Moved 4959 → 6067: fix4sim: BaconMain.cs 605-640/859-874 BaconInitialize applies the stock BaconSettings.txt (useStarGravityWells=false, HyperJumpThreshhold=4000, BaseHyperJumpAccuracy=666, sublightFuelBurnDivisor=20, noFuel* 0.9/0.9/0.5) after createGame; Galaxy.5.cs 1609-1616/1747-1752 populated planets/moons get Cargo/Troop lists
- `tickDeterminism.digest600` (test/tickDeterminism.test.ts): Moved "a59640a37d6c8238" → "811d6c7248402a11": fix4sim: BaconMain.cs 605-640/859-874 BaconInitialize applies the stock BaconSettings.txt (useStarGravityWells=false, HyperJumpThreshhold=4000, BaseHyperJumpAccuracy=666, sublightFuelBurnDivisor=20, noFuel* 0.9/0.9/0.5) after createGame; Galaxy.5.cs 1609-1616/1747-1752 populated planets/moons get Cargo/Troop lists
- `tickDeterminism.counts600` (test/tickDeterminism.test.ts): Moved #d21f9fe281 → #3f75d659d2: fix4sim: BaconMain.cs 605-640/859-874 BaconInitialize applies the stock BaconSettings.txt (useStarGravityWells=false, HyperJumpThreshhold=4000, BaseHyperJumpAccuracy=666, sublightFuelBurnDivisor=20, noFuel* 0.9/0.9/0.5) after createGame; Galaxy.5.cs 1609-1616/1747-1752 populated planets/moons get Cargo/Troop lists
- `tickDeterminism.rndDraws600` (test/tickDeterminism.test.ts): Moved 384537 → 571596: fix4sim: BaconMain.cs 605-640/859-874 BaconInitialize applies the stock BaconSettings.txt (useStarGravityWells=false, HyperJumpThreshhold=4000, BaseHyperJumpAccuracy=666, sublightFuelBurnDivisor=20, noFuel* 0.9/0.9/0.5) after createGame; Galaxy.5.cs 1609-1616/1747-1752 populated planets/moons get Cargo/Troop lists
