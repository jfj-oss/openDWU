# Contributing to openDWU

Thanks for your interest! openDWU is a faithful recreation of *Distant Worlds: Universe* (v1.9.5). The guiding rule
is: **port, don't invent.** Wherever the original game has a mechanic, formula or constant, we reproduce it exactly,
from the decompiled engine source.

## Before you start

- **You need your own copy of the game.** The code reads the original data, art and sounds at runtime from a
  Distant Worlds: Universe install (see the [README](README.md)). Most tests need it too.
- **Never commit original game files**: no art, sounds, data files or decompiled source. Screenshots of the
  running game are fine. Art we make ourselves (procedural, or composited at runtime from the original frames) goes
  under `game/public/art/`.
- Read [`game/CLAUDE.md`](game/CLAUDE.md). It is the project's working conventions: sources of truth, layout and
  test commands.

## How the code is organised

- `game/src/sim/`: the headless, deterministic game model. It has no DOM or Pixi imports, and all randomness goes
  through `sim/random.ts`, a port of .NET `System.Random`.
- `game/src/render/`: PixiJS rendering.
- `game/src/ui/`: the HUD, windows and screens.
- `game/test/`: vitest tests.

When you port a function, keep the C# names recognisable. Cite the source in a short comment, e.g.
`// Port of Galaxy.5.cs SetupSolarSystem`. If something is out of scope, leave a
`// TODO(port): <what> — <source file:method>` note.

Additions that are **not** in the original game are welcome as optional **Improvements**: opt-in or toggleable,
registered in `src/ui/improvements.ts`, and the game must play exactly like the original when they are off.

## Checks before a pull request

From `game/`:

```sh
npm run typecheck
npm run test:fast            # quick suite while iterating
npm test                     # full suite before you open the PR
npm run repin -- --check     # golden pins: must report 0 unless the change is meant to alter the sim
```

GitHub only runs the typecheck and the tests that need no game files (`.github/workflows/check.yml`). Please run the
full suite locally.

## Reporting bugs

Use the issue templates. For "the original game does it differently" bugs, say how the original behaves, and attach a
save (`.dwusave`) or the galaxy seed if you can.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
