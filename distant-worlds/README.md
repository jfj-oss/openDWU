# Distant Worlds: Universe — Re-implementation

A complete, original re-implementation of the 2D top-down real-time 4X space
strategy game *Distant Worlds: Universe* (Code Force / Stellar Onyx), built
from the specification in `Distant_Worlds_Universe_Recreation_Prompt.md`
(workspace root; the single source of truth for every rule, formula, constant
and content item).

## Platforms (hard requirement)

| Platform                 | Target                  | Graphics backend (wgpu) | Status |
|--------------------------|-------------------------|-------------------------|--------|
| macOS — Apple Silicon    | `aarch64-apple-darwin`  | Metal                   | native build |
| Linux — x86_64           | `x86_64-unknown-linux-gnu` | Vulkan                | native build |

The codebase is pure Rust: no platform C/C++ dependencies beyond the window
serving libraries pulled in by `winit`. Both targets build with the same
source tree — the build is host-native (there is no cross-compilation step
required on either supported host), and CI (`.github/workflows/ci.yml`)
builds, tests and clippy-checks **both** targets on every push.

## Layout

```
distant-worlds/
├── Cargo.toml                  # workspace
├── data/                       # all game content (modding surface, Part 13)
│   ├── FORMAT.md               # exact on-disk format contract
│   ├── races.txt, governments.txt, components.txt, ...
│   ├── designTemplates/<race>/ # 31 templates x 24 races + pirate/
│   ├── Policy/<race>.txt       # 165 settings per race (per Part 11/Appendix J)
│   └── Customization/          # theme folders (M10)
├── crates/
│   ├── dwu-data/               # content model + file loaders (pure Rust)
│   │   └── src/bin/verify-data.rs  # counts + cross-reference checker
│   ├── dwu-core/               # headless simulation (no UI, no GPU)
│   │   └── src/bin/dwu-headless-sim.rs  # CI stress driver
│   └── dwu-ui/                 # desktop app: winit + wgpu + egui
├── scripts/build.sh            # host-detecting build (macOS arm / linux x86_64)
└── .github/workflows/ci.yml    # both-target CI
```

## Building & running

```sh
# macOS (Apple Silicon) or Linux (x86_64):
./scripts/build.sh            # release build of the app + tools
./target/release/distant-worlds

# or with plain cargo:
cargo build --release
cargo run                     # debug app

# Headless simulation / stress run (no GPU needed):
cargo run -p dwu-core --bin dwu-headless-sim -- --stars 700 --years 100 --seed 42

# Content verification (runs against data/):
cargo run -p dwu-data --bin verify-data -- data
```

### CI

Push to GitHub to get both artifacts:
- `distant-worlds-linux-x86_64`
- `distant-worlds-macos-arm64`

## Status

See [ROADMAP.md](ROADMAP.md) for the milestone status (M1–M10 per spec
Part 15). The simulation core is being built headless-first so every system
is testable without a GPU; the UI renders the same state through egui.

## Notes

- Art is generated procedurally in the classic DWU style (2D top-down
  sci-fi) — no assets are copied from the original game (per the spec's
  licensing note).
- Save games serialize the full simulation state (M10); stats XML files are
  sampled for the comparison/end screens.
- All content (races, governments, components, research tree, design
  templates, policies, name pools, text) is loaded from the plain-text files
  in `data/` in the formats documented in `data/FORMAT.md`.