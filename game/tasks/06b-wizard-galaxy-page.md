# Task 06b — New-game wizard: The Galaxy page

thinking: off
scope: locked

Depends on 06a (main menu). Everything you need is here. Create `src/ui/screens/newGameWizard.ts` (+ css) and `src/sim/startGameOptions.ts`; edit `src/ui/screens/mainMenu.ts` / `src/main.ts` so **Start New Game** opens this page and its **Start** button starts the game. Start editing right away. Do not Read image files.

## Source (verbatim C# slider mappings)
```csharp
// star amount slider (BaconStart.method_60, vanilla values)
switch (value) { case 0: 100; case 1: 250; case 2: 400; case 3: 700; case 4: 1000; case 5: 1400; }   // default 400 if out of range
// physical size slider (Start.method_69)
switch (value) { case 0: (4,4); case 1: (6,6); case 2: (8,8); case 3: (10,10); case 4: (15,15); }   // default (10,10)
```
Galaxy shapes (radio list, order + labels): Elliptical, Spiral, Ring, Irregular, Even Clusters, Varied Clusters (→ `GalaxyShape` enum in `src/sim/types.ts`). Shape preview images: `/assets/dwu/images/ui/chrome/galaxyshape_elliptical.png`, `galaxyshape_spiral.png`, `galaxyshape_ring.png`, `galaxyshape_irregular.png`, `galaxyshape_clusterseven.png`, `galaxyshape_clustersvaried.png`.

## Page (from real gameplay frames; modernize styling like the HUD panels)
A centred dark window (~900×620) over the menu background, title bar "Start a New Game: The Galaxy" with a close ✕ (back to menu).
- Left: shape radio list; right of it the shape preview image (square ~180 px) and a one-line description.
- **Star Amount** slider with 6 ticks labelled `Dwarf 100 · Tiny 250 · Small 400 · Standard 700 · Large 1000 · Huge 1400` (default Standard).
- **Physical Size** slider with 5 ticks `Tiny 4×4 · Small 6×6 · Medium 8×8 · Large 10×10 · Huge 15×15 sectors` (default Medium).
- **Seed** number input (default random) with a 🎲 re-roll button.
- Bottom: "← Main Menu" left, **Start Game** right. (Other wizard pages come later — leave a TODO.)

## Code
`startGameOptions.ts`: `interface StartGameOptions { shape; starCountIndex; dimensionIndex; seed }`, `defaultStartGameOptions()`, pure `starCountFor(index)` / `sectorsFor(index)` per the tables above. Start Game → `generateGalaxy` with `starCount = starCountFor(i)`, `sectorWidth/Height = sectorsFor(j)`, shape, seed (keep the other existing generateGalaxy options as main.ts passes them today) → enter the Main View + HUD.

Tests: `starCountFor(0..5)` = 100/250/400/700/1000/1400, out-of-range → 400; `sectorsFor(0..4)` = 4/6/8/10/15, out-of-range → 10; defaults = spiral? no — **Elliptical** is the first radio but default selection is Spiral; default star index 3, dimension index 2.

Verify: `npm run typecheck`, `npm test`; save (don't open) `shots/06b-wizard.png` after navigating: open `/`, click Start New Game (use a URL param `?screen=wizard` that opens the wizard directly, for screenshots). Append `## Worker report`.
