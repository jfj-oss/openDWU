# Task 06 — Main menu + new-game wizard

Depends on 01b/01c (galaxy generation), 04a/04b (data), 02 (Main View). Build the start screens with the **original art**, producing a `StartGameOptions` that starts a game in the Main View.

**Work style:** read the listed ranges with Read offset/limit; port; move on.

`$APP` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds`
`$TYPES` = `$APP/../DistantWorlds.Types`

## Sources
- `$APP/Start.InitializeComponent.cs` — every control of the start form: panels `pnlNewGame`, `pnlStartNewGameYourEmpireType` (playstyle), `pnlStartNewGameTheGalaxy`, `pnlStartNewGameColonizationTerritory`, `pnlStartNewGameYourRace`, `pnlStartNewGameYourEmpire`, `pnlStartNewGameOtherEmpires`, `pnlStartNewGameVictoryConditions`, `pnlQuickStart`, `pnlJumpStart*`. Grep `-n` a panel name to find its sizes/labels/child controls.
- `$APP/Start.cs`, `Start.1.cs`, `Start.2.cs` — option ranges, slider mappings (e.g. star amount / sector sizes / expansion / aggression / difficulty / pirates / research cost / creatures), defaults, playstyle presets (Start.1.cs ~3250–3440: galaxy shape per preset), and how options map to `new Galaxy(...)` (Start.2.cs:494).
- `$TYPES/StartGameOptions.cs`, `$TYPES/GameOptions.cs`, `$TYPES/EmpireStart.cs` — option fields and defaults.
- Main menu art: `/assets/dwu/images/ui/chrome/MainBackground.jpg`, `Title.png`, `smallTitle.png`, `Menu_<Item>_{Active,Inactive}.png` for Tutorials, StartNewGame, LoadGame, Options, ChangeTheme, Galactopedia, Credits, CheckForUpdates, Exit. Font: Forgotten Futurist (see task 05).

## What it looks like (real gameplay frames, 720p)
- **Main menu:** full-screen `MainBackground` art (blue glowing alien face at left, armoured insectoid alien with red eyes at right, bright blue starburst centre). Centred near the top: a dark rounded translucent panel listing *Tutorials, Start New Game, Load Game, Options, Change Theme, Exit* — each item is its Menu_*_Inactive image, swapping to _Active on hover. Big "DISTANT WORLDS / UNIVERSE" title image lower-centre. Small corner buttons: Galactopedia (top-left), Updates + version (bottom-left), Credits (bottom-right). Top-centre small yellow text "Current Theme: <name>". Small copyright line at the very bottom.
- **Wizard pages:** a dark grey window (~900×740 at 1080p) centred over the menu background, title bar "Start a New Game: The Galaxy" with a close ⓧ. Yellow section headers and yellow "About …" help links; light-grey labels; option groups in rounded darker boxes. Navigation buttons at the bottom: "<< Previous Playstyle" left and "Next: Colonization and Territory >>" right (labels name the adjacent page).
- **Playstyle page:** a big green-bordered "Introductory Game" button on top, a row of playstyle tiles below (Ancient Past / Age of Shadows / Classic Era … with small images), a timeline arrow underneath.
- **The Galaxy page:** shape radio list (Elliptical, Spiral, Ring, Irregular, Even Clusters, Varied Clusters) with a square galaxy preview picture + description at right; **Star Amount** slider with ticks *Dwarf 100 · Tiny 250 · Small 400 · Standard 700 · Large 1000 · Huge 1400 stars*; **Physical Size** slider *Tiny 4×4 · Small 6×6 · Medium 8×8 · Large 10×10 · Huge 15×15 sectors*; right box "OR Load existing Galaxy as map" with Browse/Clear and "Regenerate …" checkboxes; lower section sliders: Expansion (PreWarp…Old), Aggression (Peaceful…Chaos), Difficulty (Easy…Extreme) + "Difficulty scales as player nears victory" checkbox, Research Costs (Very Expensive…Very Cheap), Space Creatures (None…Many), Pirates (None…Very Many) + Pirate Proximity dropdown, Pirate Strength (Very Weak…Strong).
- Use the source for the exact labels/ticks on the other pages.

## Implementation
- `src/ui/screens/mainMenu.ts`, `src/ui/screens/newGameWizard.ts` (DOM, styled to match), `src/sim/startGameOptions.ts` (types + defaults + slider-tick→value mappings as pure functions, with unit tests against the numbers in the source).
- "Start" generates the galaxy with the chosen shape/stars/sectors/seed and switches to the Main View (task 02) + HUD (task 05). Options not yet used by the sim are stored and marked `TODO(sim)`.
- The race page lists the 22 races from 04a with their portraits (`/assets/dwu/images/units/races/…` — find the naming) and stats.

## Verify
`npm run typecheck`, `npm test`; screenshots of the main menu and each wizard page via `scripts/shot.mjs` (add URL params or `window.__dwu` hooks to jump to a page); no console errors; list shots in the Worker report.
