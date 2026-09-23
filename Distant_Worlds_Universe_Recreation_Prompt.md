# RECREATION PROMPT — "Distant Worlds: Universe"
## A Complete, Exhaustive Specification for Reimplementing the Entire Game

**To the AI reading this document:** You are being asked to recreate, in full and working form, the 2D top-down real-time 4X space strategy game *Distant Worlds: Universe* (original: Code Force / Stellar Onyx, Steam build 1.9.5.0). This document is the single source of truth: it contains the game's complete rules, every exact formula and numeric constant, every data table and content item, the full user interface specification, the complete data-file formats, the asset inventory, and a staged implementation plan with acceptance gates. Build the game so that a player could not tell it apart from the original in features, content, balance, or behavior. Do not simplify, skip, or "approximate" any listed feature — the definition of done in Part 0 is a hard requirement. Where this document gives an exact constant or formula, reproduce it exactly. Where it gives a range or a table, implement the whole table.

# TABLE OF CONTENTS

**CORE GAME**
- Part 0 — Mission and Definition of Done
- Part 1 — Game Overview (genre, scale, storylines, session flow, content inventory)
- Part 2 — Technical Architecture and Engine Requirements
- Part 3 — The Galaxy: generation, structure, simulation, visibility
- Part 4 — Ships, Fleets, and Combat (complete combat model with exact formulas)
- Part 5 — Races, Governments, and Civilizations
- Part 6 — Economy (state, private sector, resources, trade, piracy)
- Part 7 — Research and Ship/Design Construction
- Part 8 — Diplomacy (relations, effects, messages, war, intelligence)
- Part 9 — Characters, Victory, Game End, Achievements, Disasters & Events
- Part 10 — Empire AI, Automation, and Policies

**SURFACE**
- Part 11 — User Interface and Game Flow (complete, every window, key, and flow)
- Part 12 — Data File Formats (the modding/content surface)
- Part 13 — Presentation and Assets (what to create)
- Part 14 — Implementation Plan and Acceptance Criteria

**APPENDICES (data to reproduce verbatim)**
- Appendix A — Race data (all 24 races, exact values)
- Appendix B — Government data, race-family data, and all bias matrices
- Appendix C — Resource data (41 resources + distribution table)
- Appendix D — Component data (129 components)
- Appendix E — Planetary facility and wonder data
- Appendix F — Complete research tree (337 projects)
- Appendix G — Design template roster and format
- Appendix H — Fleet system
- Appendix I — Plague data
- Appendix J — Empire policy defaults (165 settings)
- Appendix K — Complete enumeration glossary (every game enum, verbatim)
- Appendix L — Fidelity verification checklist



## 0. MISSION AND DEFINITION OF DONE

You are to build a **complete, fully playable, original re-implementation** of the 4X space strategy game **Distant Worlds: Universe** (a 2D top-down real-time 4X galactic strategy game). This document is the complete specification: every system, formula, data table, UI element, content item, and asset requirement is described below. Where an exact numeric value is given, use it. Where a behavior is described, implement exactly that behavior. Nothing may be stubbed, omitted, or "simplified": every feature listed here must be fully functional in the final build.

**Genre and feel:** A vast real-time (with pause and speed controls) 4X — eXplore, eXpand, eXploit, eXterminate — space strategy game. The player leads one space civilization among a dozen or more AI civilizations (and pirate factions) across a procedurally generated galaxy containing up to 1,400 star systems and 50,000+ planets, moons, asteroids, gas clouds, nebulae and space creatures. The camera is a free 2D top-down map that continuously zooms from 100% (individual planets and ships visible) through system level, sector level (grid of 10x10 sectors) to full-galaxy view. There are no turns: everything is simulated in continuous real time (the default time scale is 1 year of game time per minute of real time; the player can pause and set speed levels 1-8 and higher).

**Two-seconomy model:** Every empire has a **State** economy (controlled by the player/AI leader: taxes, ship construction funding, maintenance) and a **Private** economy (fully automatic: private citizens build and operate freighters, mining ships, passenger ships, run tourism and inter-colony trade). The player's influence is limited to: setting tax rates, keeping trade routes safe, building space ports and mining stations, and setting policies — the private sector then acts on its own. This must be faithfully simulated (see Economy section).

**Definition of done (all must be true):**
1. A player can create a fully custom new game (all options described in the New Game section) and play it to victory or defeat, in any of the game modes (Classic Era planetary empire, Pirate faction, Pre-Warp era, Ancient Galaxy storyline, or pure custom sandbox).
2. Every screen, button, list, overlay, message, and hotkey listed in the UI section exists and works.
3. Every race (24), government (13), resource (41), component (129), planetary facility (17 types + wonders), fighter type, plague (4), ship design template role (31 per race), research project (337), and victory condition (60 race conditions + general) listed in the Content section exists in the game.
4. Every AI empire, pirate faction, and space creature behaves per the AI section, with full automation working unattended.
5. Save/load, autosave, game editor, theme/mod loading, and scenario/event system all work.
6. The game runs a full custom galaxy at interactive frame rates with the performance requirements in the Architecture section.

**Licensing note:** This re-implementation is for the user's personal project. Recreate the *mechanics, systems, data and behavior* described here; generate new original artwork in the described style (2D top-down sci-fi) — do not copy pixel art or audio assets. All in-game names, race names, and lore text given in this document are part of the specification and should be reproduced as text.

---

## PART 1 — GAME OVERVIEW

### 1.1 What the game is
- A single-player (local) real-time 4X space strategy game. One human player controls one empire; all other empires, pirate factions, independent alien populations, and space creatures are AI.
- The map is a single spiral galaxy in 2D. Systems (stars) are placed across a 2D plane in a galactic shape; each system contains 0-15+ stellar objects (planets, moons, gas giants, asteroids, gas clouds, ruins) and may contain nebulosity.
- Time: continuous. Game date displayed as year (e.g. "2986.45" style decimal years). Default rate: 1 game year per real minute. Speed buttons +/– step through 8 or more speed levels (0 = paused). Autosave every 10-30 minutes (default 30) into rotating autosave slots.
- The galaxy starts largely unexplored: each empire only knows systems near its homeworld; everything else must be explored by ships (or bought from pirates/other empires).

### 1.2 Series context (lore that drives content)
The game package contains five "eras"/storylines the player can enable in any combination (off, some, or all):
1. **Original Distant Worlds / Classic Era** — planetary civilizations rediscover faster-than-light travel and expand.
2. **Return of the Shakturi** — the insectoid Shakturi race (a hidden, extremely aggressive non-playable race that arrives partway through the game) invades the galaxy; the player's side (the Freedom Alliance) and others fight them off.
3. **Legends** — post-second-war era: new special events, disasters, and faction-specific victory conditions.
4. **Shadows (pre-hyperspace era / Age of Shadows)** — space-based **pirate** factions (nomadic survivors of the old fleets) vs. re-emerging planetary civilizations that can only travel within their own systems until they rediscover hyperspace; pirates can control/raids/exterminate planets.
5. **Ancient Galaxy (new in Universe)** — the first war between the Freedom Alliance and the Shaktur Axis, roughly 500 years before the original timeline; includes planet destroyers, Ancient Guardians, and the researchable/deployable Xaraktor virus.
When storylines are enabled, scripted events (empire destruction, race invasions, plague waves, discoveries of the galaxy's history) fire on timers/conditions; the player may play them with full story, partial story, or none, and may toggle Disasters, Events, and special victory conditions.

### 1.3 Core player tasks
Explore the galaxy; colonize new planets; construct ships; defend the empire. All four are supported by: research (unlocking new components, abilities, facilities), diplomacy (treaties, gifts, trade), espionage (intelligence agents), troops (invasion/defense), and the private economy (taxes, trade fees, construction revenue).

### 1.4 Victory
The player chooses victory criteria at game start (see Victory section): territory %, population %, economy (strategic value) % of galaxy, or time-limit (highest strategic value when timer ends); plus optional race-specific victory conditions (60 total, per race) and pirate playstyle conditions; storyline can replace normal conditions. Planetary empires are compared only to other planetary empires for victory; pirate factions only to other pirates. The game can also be won/lost to total elimination (all colonies + space ports + construction ships destroyed for pirates = eliminated; planetary empire eliminated when it loses all colonies and space ports).

---

## PART 2 — TECHNICAL ARCHITECTURE AND ENGINE REQUIREMENTS

### 2.1 Engine and presentation
- A 2D top-down real-time strategy engine (e.g. a modern equivalent: C++/C# with a GPU-accelerated 2D renderer — OpenGL/DirectX/Metal/Vulkan, or a game engine such as Godot/Unity used in 2D mode). The original was a .NET/XNA application; the re-implementation may use any language/engine that meets the performance and feature requirements.
- The map is rendered as a continuous pannable/zoomable 2D world. Zoom range: from 100% (system level — individual planets, moons, ships, bases visible as sprites; you can see a planet's surface map and resource icons) down to full-galaxy view (every system a dot; nebula clouds visible; sector grid lines visible). In between: "system overview" level (planets as small icons around each star) and "sector level" (each system a symbol on a grid).
- Smooth scrolling (drag or mouse-at-edge), smooth zoom (mouse wheel, configurable to center on selection or on cursor), arrow-key panning, minimap with clickable viewport rectangle.
- Background: a starfield of varying density (configurable "Star Density" performance option — decorative only).
- Objects are rendered as sprite-based units: ships and bases have per-race art families (60+ ship art families), animated engine exhaust, running lights, explosion effect sequences (dozens of explosion frame sets), weapon effects (beam, area, missile/torpedo, ion, point-defense, tractor beam, hyperjump enter/exit animations with per-hyperdrive-type art), mining/gas-mining effects, beacon effects, scanner/long-range-scanner effect rings, nebula cloud volumetric layers (Perlin/FBm noise-generated), lightning effects (for some weapons), supernovae and black-hole event-horizon visuals.
- Planet rendering: each planet type (9 surface classes: continental, marshy swamp, ocean, desert, ice/glacial, volcanic, barren rock, gas giant, frozen gas giant) has a planet sprite, a planet map (surface texture with resource placement), and a landscape/surface art set; gas giants have ring variants; facilities on planets have their own sprites; wonders have unique sprites; ruins have unique sprites.
- UI: a skinnable 2D control set (chrome panels, list views, tree views, buttons, sliders, dropdowns, tooltips/hover panels). Fonts: four font sizes (normal, bold, small, tiny) plus a title font. UI icons for: resources (41), components (per component), messages (per message type), plagues, achievements, events, flags (39 flag shapes × 20 primary + 21 secondary colors), ship status symbols, cursors (default, target-red, cursor variants for special missions).

### 2.2 Simulation model
- Fixed-step simulation ticks (the original used a real-time tick loop with sub-second ticks for combat/movement and coarser ticks for economic research/AI decisions). Requirement: ship movement and weapon combat resolve every tick (sub-second); resource production, population, cargo movement, and trade resolve on a per-game-day basis; empire AI decisions run on a slower interval (a few in-game days); galaxy-level events on yet slower intervals. Time compression scales the tick rate.
- The simulation must support: 100-1,400 systems, 50,000+ planets/moons, several thousand ships/bases, thousands of freighters (private), hundreds of fighters in flight, all at ≥30 FPS on the system view (galaxy view may relax requirements: distant objects are culled/summarized).
- Determinism is not required, but save/load must fully serialize all state (see below) and the game must continue correctly after reload, including mid-combat.
- Multi-core: nebula rendering, AI decisions, and combat of distant systems may be parallelized; the original supported multi-core nebula detail levels (Off/Low/High).

### 2.3 Data-driven design (CRITICAL)
The entire game's content must be loadable from plain-text definition files with exactly the formats given in the Content & Data section (Part 13). These files are the modding surface: the game loads them from its own data directory, and any file present in an active "theme" folder overrides the default. Files: races.txt, raceFamilies.txt, raceBiases.txt, raceFamilyBiases.txt, governments.txt, governmentBiases.txt, biases.txt, components.txt, fighters.txt, facilities.txt, plagues.txt, research.txt, resources.txt, systems.txt, designs.txt, designNames.txt, agentNames.txt, characterNames.txt, colonyNames.txt, shipNames.txt, Passengers.txt, GameText.txt (all player-facing text: race descriptions, government descriptions, component descriptions, message texts, screen help texts, scenario texts), Policy/*.txt (one per race: default empire policies), races/*.txt (per-race extra data), designTemplates/<race>/*.txt (31 ship design templates per race), Policy/pirate/*.txt (per-race pirate policies), systems.txt (system name pool), plus a custom event/scenario file for the game editor.
- A **theme** is a folder under `Customization/` containing optional overrides of all of the above plus optional image folders (units/ships/familyNN, units/races, units/characters, units/troops, units/creatures, environment/planets, environment/stars, environment/nebulae, environment/ruins, environment/landscapes, environment/planetmaps, environment/mapstars, ui/components, ui/resources, ui/flags, ui/messages, ui/cursors, ui/achievements, ui/plagues, ui/events, effects/…), optional music/sound folders, and optional Help files. The game can hot-swap themes from the main menu (list of themes with summary preview).

### 2.4 Save games
- A save is a fully serialized game state (galaxy, all empires, ships, colonies, characters, treaties, research, pirate state, scenario progress). Autosaves rotate through slots; the player can Save/Save-As/Load; on load the galaxy may be paused (configurable); the star date is preserved.
- Stats are also recorded: time-series per-empire statistics (money, population, territory, research, military strength, etc.) sampled periodically and saved as XML statistics files — used by the victory/comparison screens and end-of-game reports.

### 2.5 Game editor (built-in)
A full in-game editor accessible from the Game menu and Options: place/erase/edit empires, colonies, ships, bases, planets, stars, nebulae, ruins, resources, characters, plagues; edit any property of any object via a right-side edit panel; edit empires (races, governments, relationships, research); define scripted **events** (trigger conditions on objects/events → execute action lists, immediate or delayed) and **scenario objectives** with win/lose results; save the edited galaxy and start a new game on it ("use saved galaxy as map"). This is the modding tool for custom storylines.

### 2.6 Performance options (player-configurable)
Scroll speed, zoom speed, star density, maximum frame rate cap, nebula detail (off/low/high), and per-option message controls. All in the Options screen.

---

## PART 3 — THE GALAXY: GENERATION, STRUCTURE, AND SIMULATION

### 3.1 Galaxy generation (new game)
Given the wizard options (shape, star amount 100–1400, physical size 4×4–15×15 sectors [default 10×10], expansion era, aggression, difficulty, research cost, space creatures, pirates, pirate strength, colony prevalence, alien life, resources per planet/system), generate:
1. **Star placement** per the chosen shape:
   - **Elliptical**: two spiral nebula-cloud arms from a dense core + a distinct outer rim of stars (classic spiral).
   - **Spiral**: two spiral arms, dense core, no rim.
   - **Ring**: dense perimeter, scattered interior.
   - **Irregular**: even spread, no structure.
   - **Even Clusters / Varied Clusters**: star groups clustered in constellation-like cells (equal size / varied sizes).
   Stars are stellar objects (main-sequence by spectrum class, plus red giants, supergiants, white dwarfs, neutron stars, black holes; flares for some main-sequence stars; supernovae as special transient locations). The galactic core is a special location. Each system gets a name from systems.txt (or generated).
2. **Per-system stellar objects**: planets and moons (0–~15+ per system, scaled by "Colony Prevalence" option), gas giants (with ring variants), frozen gas giants, barren rock bodies, asteroid fields (rocky/metal/ice), gas clouds (17 compositions: metal, ammonia, argon, carbon dioxide, chlorine, helium, hydrogen, nitrogen/oxygen, oxygen, etc.), ruins (ancient alien structures — several types; some hold discoverable lore/tech), and optionally a **planet destroyer** (Ancient Galaxy / storyline), **black holes**, and **supernovae**.
3. **Planet types** (9): Continental, Marshy Swamp, Ocean, Desert, Ice/Glacial, Volcanic, Barren Rock (uncolonizable), Gas Giant, Frozen Gas Giant (gas types are uncolonizable but carry gas resources; ringed variants). Each colonizable planet: 0–N resource deposits (mineral/gas per the resources.txt prevalence table per surface class; super-luxury resources placed at their "sources per 700-star galaxy" rate), a planet map (surface texture) with resources visibly placed, landscape class. Planet quality = base (by type) + bonuses (ruins: up to +50% development bonus; scenic locations: ringed planets, certain gas giants, etc.) and minus damage.
4. **Nebula clouds** (GalaxyLocationEffectType bitflags; a cloud can combine effects):
   - `HyperjumpDisabled`: ships inside cannot hyperjump.
   - `MovementSlowed`: max and cruise speeds ×0.75 inside.
   - `ShieldReduction`: drains 3.0–3.5 shield points per game-second (exact: (3.0 + Rnd×0.5) × timePassed) from ships inside.
   - `LightningDamage`: random lightning strikes — every >7 s (random 0–7 s gate) a ship with speed ≤ top speed takes 20–90 shield damage (if shields ≤ that, set to 0 and the remainder 0–5 damages the hull; armor-invincible).
   - `ShipDamage`: continuous hull damage (EffectAmount) to ships inside.
   - `ShipPull`: pulls ships toward the cloud center; pull = EffectAmount × (cloudRadius/2 / distance).
   Nebula art is generated with Perlin/FBm noise (configurable detail: off/low/high); nebulae also have gas-cloud sub-types that can be mined for gas resources.
5. **Space creatures** (CreatureType, placed per "Space Creatures" option): **Kaltor** (large predator; attacks ships; can be "giant" per difficulty), **Desert Space Slug** and **Rock Space Slug** (slow, tanky; live on desert/rocky bodies), **Ardilus** (swarm-like attacker), **Silver Mist** (drains shields of ships inside; can only be destroyed by ion weapons; killing one raises the killer's civility rating/reputation). Creatures have shield + hull (size), move, hunt, and can be killed for reputation and (pirate) achievements.
6. **Independent alien populations**: unaligned populations on some planets (per "Alien Life" option) — they can be colonized/enslaved by empires (with the population policy applying) or left independent; pirates can raid them.
7. **Empire starts**: for each starting empire (player + AI): place its homeworld (a system with the race's native planet type, harshness/fecundity per option), starting colonies (per empire size/age and "Starting/Young/…/Old" growth stage), starting spaceports/construction ships/fleet (military + civilian per size and policy), starting research (per starting tech level 0–8; pre-warp empires get pre-warp tech including the primitive warp bubble), starting resources and money (scaled by size and galaxy research-cost option). Opponent proximity option (Nearby/Average/Distant) controls placement distance from the player.
8. **Pirate factions** (per "Pirates" + "Pirate Strength" options): each pirate faction starts with one spaceport near a fuel gas cloud, a construction ship, several military ships, private ships, a resupply ship, and starting tech incl. hyperdrives; factions have a primary race mix and a playstyle (Balanced/Mercenary/Raider/Smuggler).
9. **Special locations** per enabled storylines: Ancient Guardian sites (Ancient Galaxy), Shakturi entry points (ROTS), pre-warp "restricted areas" (Shadows) that block hyperjump until the pre-warp empire completes progression events.
10. **Sectors**: the galaxy is divided into the chosen NxN sector grid; each sector indexes its systems (for the galaxy map screen and sector-level AI).

### 3.2 Visibility and fog of war (SystemVisibility)
- Every system is, per empire: `Unexplored` (unknown), `Explored` (known location, contents partly known — e.g. from a passing ship's proximity sensor or a bought map), or `Visible` (fully observed by a ship's proximity array / long-range scanner / trade traffic).
- Observability sources: a ship's Proximity Array (scan range; also gives a hyperjump-tracking chance vs jumping ships), Long-Range Scanner (much larger range, passive), Resource Profile Sensor (reveals resource profile of scanned systems), Trace Scanner (reveals stealthed ships within range), Scanner Jammers (reduce others' sensor effectiveness against you), Stealth Cloak (reduces your signature). Shared visibility: Mutual Defense Pact/Protectorate partners see everything you see; Subjugated Dominions: the subjugator sees all of the vassal's ships/bases/colonies; Deep-Cover intelligence: ongoing visibility of the target empire's operations.
- When a ship explores a system, its full contents (planets, resources, creatures, other ships/bases present) become known to that empire; previously unseen locations revealed by events show blue "ping" markers.
- Galaxy maps and territory maps can be traded/stolen (diplomacy/intelligence), converting whole regions to Explored/Visible for the recipient.
- The game tracks per-empire `EmpireSystemSummary` (known planet counts, known resource lists, known colony/owner per planet) for the comparison and expansion-planner screens.

### 3.3 Time and simulation
- Continuous time; the game date is a star date (year.decimal). Speeds: pause + 7+ run-speed steps (each roughly doubling the real-time-per-game-time ratio; the original ranged from ~1 year/minute up to very fast). Time compression must keep combat ticks accurate (weapon fire rates, fighter speeds are time-based).
- Autosave: interval 10–30 minutes (configurable), rotating slots; optional pause-on-load.
- The simulation resolves: movement (sub-second), weapons/combat (sub-second, including in-flight projectiles), population/production/cargo (per-game-day granularity), economy/trade prices and empire AI (every few in-game days), galaxy events (rarer).

---

## PART 4 — SHIPS, FLEETS, AND COMBAT (complete model)

### 4.1 Ship and base model
A ship/base = Design + Components + state.
- **Components**: each is an instance of a researched component definition (see Part 13) with Value1–7 stats and status `Normal` / `Damaged` / `Destroyed` (damaged components still occupy space but provide no effect; destroyed ones are gone until repaired).
- **Size** = sum of component sizes (the "hull"). A ship's hull integrity is measured against the sum of sizes of its undamaged components: cumulative hull damage ≥ that sum destroys the ship.
- **Energy**: reactors produce energy (Value1/s) into storage (Value2), consuming fuel (Value3 fuel units to charge; fuel resource per Value4) when storage is low; Energy Collectors generate energy passively; Energy-to-Fuel converters produce fuel from energy (for pirates/empires with fuel-shortage policies); Fuel Cells store fuel. If energy or fuel runs out, dependent components (weapons, shields, engines) go inactive.
- **Movement**: main thrust engines give top speed (Value1) and cruise speed (Value3) with per-second energy costs; vectoring engines add maneuverability; inside movement-slowed nebulae both are ×0.75. Fuel-hungry ships run out of fuel if not refueled (fuel-hungry: weapons + engines consume fuel indirectly through reactor recharging).
- **Hyperdrive**: one per ship (auto-added). Jump initiation time (Value3), top speed and energy use (Value1/V2). Hyperjumps take the ship out of the system for a travel time proportional to distance; the destination is chosen by the ship's next mission waypoint. **HyperDeny** (and HyperStop/Gravity Well Projector) components prevent enemy hyperjumps within their range; ships in a `HyperjumpDisabled` location cannot jump.
- **Fighter bays**: store fighters/bombers (capacity = Value1); repair rate Value2/s (manufacture rate = half); carriers and large military ships have bays; fighters are launched automatically for defense (if the parent ship is under attack) or per assigned fighter missions (attack: fly out and engage the target's fighters/ship; defend: orbit the parent and intercept incoming fighters). Fighters: shield capacity, recharge, hull (Size), health fraction, countermeasure bonus, armor, 2 weapon slots, reactor (capacity/recharge), top speed (half speed when not attacking), acceleration (5–100), turn rate (0.5–6.28 rad/s). The AI builds the highest-tech-level researched fighter/bomber for its carriers.
- **Crew/support**: Life Support + Hab Modules (Value1 = supported size) + Command Center (Value1 = maintenance savings %) determine how many ships can dock and how cheaply the ship maintains. Command centers also give a maintenance cost discount for the whole ship/base.
- **Cargo / passengers / troops**: Cargo Bays (capacity), Passenger Compartments, Troop Compartments (capacity), Docking Bays (cargo throughput for docked ships), Commerce Centers (trade bonus %).
- **Manufacturers**: ship-board factories that build new ships/bases (3 industry variants) — the core of expansion; Construction Yards likewise (Value1 = build speed). Building a new ship consumes the builder's components' manufacturing points and takes time (build time scales with the new ship's size and the yard's speed; a "build queue" per yard).
- **Extractors**: Mining Engine (minerals), Gas Extractor, Luxury Extractor — on mining ships/stations; extraction rate Value1 (boosted by the empire's ResourceExtractionBonus).
- **Sensors/computers**: Proximity Array (range + hyperjump tracking %), Long-Range Scanner, Resource Profile Sensor, Trace Scanner (range+power; reveals stealthed ships and boosts boarding attack +power/100%), Scanner Jammer, Combat Targeting (targeting bonus %; fleet variants apply to the whole fleet), Countermeasures (fleet or ship; % bonus to evade enemy fire), Stealth (rating), Ion Defense.
- **Defense**: Shields (capacity, recharge/s), Area Shield Recharge (restores nearby friendly ships' shields below 50% within range), Armor (rating + reactive rating; see damage model), Damage Control (damage reduction % + repair time per component), Point Defense (vs fighters and assault pods; each PD weapon fires at targets within range with the normal hit math; PD target selection: the incoming fighter with "size + shields + 1" × empire attack-overmatch factor as its priority weight), Assault Pods (see boarding).
- **Weapons** (every type fires with: range check (including fleet weapons-range bonus and captain weapons-range bonus), energy availability, fire rate (ms) + random ±400 ms jitter, hit determination (below), then projectile flight and impact). Types and behaviors:
  - **Beam / Super Beam**: instant hit at fire time (no projectile); full damage on hit.
  - **Phaser / Super Phaser**: hits shields but does NOT trigger the shield-strike stun window (LastShieldStrike is not updated), i.e. phasers can punch through the "shield flicker" timing other weapons suffer.
  - **Rail Gun / Super Rail Gun**: split damage — a random 25%–75% of the hit power still hits shields, the remainder (50%–75%) goes straight to armor/hull (armored penetration).
  - **Missile / Super Missile, Torpedo / Super Torpedo**: homing projectiles (speed Value4); damage halved (min 1) when consumed by armor; torpedo Value7 = bombard damage for colony strikes.
  - **Area (Ion Pulse / Area Destruction / Super Area / Area Gravity)**: blast weapon — checks a minimum number of weapons/targets condition (CheckFireAreaWeaponAtTarget) before firing; damages multiple targets in radius; area-gravity also pulls.
  - **Gravity Beam / Area Gravity**: continuous beam/field; **bypasses shields entirely** (full power to armor/hull); gravity beam applies an alternating push/pull force to the target (damage rate scales with raw damage / target size and distance falloff, clamped 20–60 per tick).
  - **Ion Cannon**: no hull damage; disables target components (ion damage; ion defense resists); **the only weapon that can destroy Silver Mist creatures**.
  - **Tractor Beam**: pulls/pushes the target (Value1 power, range, energy per firing, projection speed, power loss per 100 range, fire rate ms); cannot target bases; used to push ships/creatures.
  - **Bombard weapons**: any weapon with Value7>0 can bombard a colony (see 4.6).
  - **HyperDeny / HyperStop**: not damage; disable enemy hyperjumps in range.
  - **Assault Pod**: the boarding weapon (see 4.7).
- **Superweapons** (race-unique SpecialComponents, researchable via special-function-3 projects, mostly race-locked): Death Ray, Devastator Pulse, Super Laser (super beam), StarBurner XX-12 (engine), TurboThruster ER7 (engine), Swift Vector 5000 (vectoring), Megatron Z4 (shields), NovaCore NX-700 (reactor), VelocityDrive ST3 (hyperdrive), ShadowGhost ECM 2000 (countermeasures), Shaktur FireStorm (beam), High Density Fuel Cell, S2F7 RepairBot (damage control), PulseWave Cannon (super area), Raptor Targetting System.
- **Planet Destroyer** (storyline): a base carrying super beam/super torpedo/super missile/super railgun/super phaser; when attacking a designated colony within range+300 it focuses fire to destroy the planet (permanent); it cannot fire other super weapons at non-designated targets.

### 4.2 Hit determination (exact, from source)
For a firing weapon at a target at distance D (D < weapon effective range R_eff = Range × fleet-WeaponsRangeBonus × captain-WeaponsRangeBonus):
1. `hitRangeChance = 0.15 + max(0, (R_eff − D) / R_eff)` (0.15 at range edge → 1.15 at point blank).
2. Target-speed factor `val = 10 / max(1, target.CurrentSpeed)`, clamped 0.7–5.0, then ×2. For fighter targets: val/1.1 for non-PD weapons, val×2.0 for point defense (PD is much more accurate vs fighters).
3. Targeting modifier `t = (TargettingModifier + FleetTargetingBonus) / 100` (targeting components; +20 flat for the PredictiveHistory race event).
4. `score = val × (hitRangeChance + Rnd(0..1) + t)`; × fleet TargetingBonus; × captain targeting bonus.
5. Rare luck events (1/15 chance): if score > 0.5 it is set to 0 (botch); if score ≤ 0.5 and in range it is set to 1 (ace).
6. Hit iff score > 0.5. On a miss the projectile expires at range (WeaponMissEnemy battle stat).
Countermeasures: the defender's countermeasure bonus (ship + fleet + captain + race) reduces the attacker's effective hit score (applied in the weapon-hit step); stealth reduces detection, not hit chance.

### 4.3 Damage pipeline (exact, from InflictDamage)
When a hit lands with power P (already scaled by attacker weapon-damage bonuses, e.g. captain weapons skill):
- **Creature target**: creature damage model (Silver Mist: ion only).
- **Fighter target**: if P ≤ shields → shields −= P (record strike time/direction for FX). Else shields → 0 and hull damage = P − shields; hull destroyed when size×health ≤ damage (explosion, war-damage event, visibility updated).
- **Ship/base target**:
  1. Weapon-class handling: rail/super-rail splits (random 25–75% to shields, rest to armor/hull); phaser/super-phaser and beam/area-gravity classes as in 4.1; gravity bypasses shields.
  2. Armor pass (unless bypassed): for the first armor component block: reactive rating V2 (× empire armor-reactivity multiplier, × ArmorReinforcingFactor/100; halved vs phasers) absorbs up to V2 points — if remaining ≤ V2 the damage is nulled (or leaves 0–1 point randomly). Remaining damage vs base armor rating V1 (× ArmorReinforcingFactor/100): with probability max(0.1, remaining/V1) that armor block is Disabled (damaged); damage reduced by V1; repeat through armor blocks. Missile/rail/super-missile/super-rail damage is first halved (min 1) against armor.
  3. Damage control: damage ×= (1 − DamageReduction × fleet-damage-control-bonus × captain-damage-control-bonus).
  4. Hull: capped at ship Size. When cumulative hull damage ≥ sum of undamaged component sizes → ship destroyed (explosion sequence, cargo/troops/characters aboard die per their death types, war-damage recorded, position becomes visible to the killer).
  5. Component-level damage (from certain weapons/bombard/boarding) sets components Damaged (Value effects suspended) until repaired by damage control (Value2 seconds per component) or a repair mission.
- **Shield-strike stun**: a shield hit records LastShieldStrike + direction; (used for FX and the "shields at X%" flee triggers).

### 4.4 Nebula/environmental effects during combat — see 3.1.4 (exact formulas).

### 4.5 Fighters and point defense in combat
- On being attacked, a ship with bays launches defenders (auto or by policy); incoming enemy fighters are engaged by point-defense weapons (each PD weapon fires at the closest available fighter target with the hit math of 4.2, PD accuracy ×2 speed factor) and by the fleet's defenders. Fighters attack enemy fighters (interceptors) or enemy ships/bases (bombers) per their type and assigned mission. Fighter squadrons: a bay's fighters act as a group; the parent's battle stats aggregate children's hits/misses.
- **Fleet posture**: Attack / Defend (Neutral via no assignment); **BattleTactics** per design/fleet: Evade (disengage when losing), Standoff (maintain range), All Weapons (fire everything), Point Blank (close in). Engagement range settings: ship/fleet default engagement range (cycled with comma key). Flee-when policies: EnemyMilitarySighted / Attacked / Shields50 / Shields20 / Armor50 / Never (per-ship and per-fleet defaults from empire policy). Encounter actions: Prompt (player popup) / Notify (message only) / None.
- **Blockade**: a military ship with a Blockade mission parks near an enemy colony/spaceport (only against empires with Trade Sanctions) and attacks anything attempting to dock/leave; blockaded targets cannot dock; repeated blockades escalate diplomatic offense.

### 4.6 Bombardment and planet damage
A military ship with a weapon carrying Value7 (bombard damage) can be given a Bombard mission (Shift-right-click on an enemy colony; policy-gated: WarAttacksAllowColonyBombardment 0=always/1=intensely-disliked/2=diabolical-reputation/3=never):
- If the planet has a Planetary Shield facility: no bombard damage.
- Otherwise: artillery garrison mitigation — factor = max(1, 0.5 + sqrt(artilleryDefendStrength × empire-intercept-bonus / 7500)); bombard power ÷ factor.
- Planet takes permanent damage: `habitat.Damage += power/8000` (capped at 1.0), then quality is recalculated (reduced quality → lower development cap; can be healed over very long time or by terraforming).
- Both sides' troops aboard/invading take `power × 1.5` losses; characters on the planet: each has power/1000 chance to be killed (death type ColonyBombardment).
- **Planetary defense units** (troops) are the only ground units that can fire at troops during the space→surface transition (invading troops are vulnerable "assault pod" sprites), and they mitigate bombardment (above).

### 4.7 Boarding, capture, and raiding (exact, from source)
- Prerequisites: research "Ship Boarding" (assault pod tech); the attacker must have Assault Pods and the target's `CurrentShields < pod's shield-penetration (V5)` (significantly depleted shields). Planets with a Planetary Shield cannot be raided by pods.
- While in AssaultRange, each available pod weapon fires (1-in-5 per tick) a pod at the target. Pod power = RawDamage(V1) × (race TroopStrength/100) × empire BoardingAttackFactor × RaidStrengthFactor; boosted +power/100 by attacker Trace Scanner and +1%/level by attacker BoardingAssault character skill.
- **Assault combat**: the target accumulates AssaultAttackValue; the target's own defense value = CalculateBoardingDefenseValue (based on size, life support/crew components, defense pods if any, character skills); both sides' pods also add to their side's values. Each tick both values decay: `attackers decay by dt×(2..4)/ratio`, `defenders decay by dt×(2..4)×ratio` where `ratio = clamp(attack/defense, 0.5, 2.0)` — a stronger boarding force drains the defense faster. During the fight, when `num2+num3 > Rnd×10×dt`, a random target component is disabled for 20–30 s (boarding damage).
- If the attacker value reaches 0 first: repelled; defense resets.
- If the defense value reaches 0: **capture** — the ship changes empire (owner, color, design kept), characters aboard die or are captured per rules, cargo/troops transferred; a crossed-swords symbol and an assault/defense summary show on the ship while boarding. Captured ships per empire policy (CaptureTargetConditionShip/Base, CaptureEnlist/Disassemble military & civilian, CaptureEnlistBase, UpgradeEnlistedMilitaryShips): the captor may enlist it into its fleets, upgrade it, or scrap it for loot (loot = 2 × ship's looting value × income factor × (1 − corruption); if the ship has no engines/hyperdrive or zero top speed it must be scrapped immediately, inflicting 1,000,000 damage to destroy it).
- **Raid** (Shift-Alt or pirate/mercenary mission): pods board; on success the raider gets raid bonuses (credits/research/resources per policy RaidBonusFactor) and the target suffers a 60-second raid countdown with penalties (cargo/tech loss); pirates raid planets too (see Pirate section).
- Point defense can shoot down inbound pods (same PD math).

---

## PART 5 — RACES, GOVERNMENTS, AND CIVILIZATIONS

### 5.1 The 24 playable/non-playable races (exact data table)
Full numeric data (reproduction rate, intelligence, aggression, caution, friendliness, reliability, war weariness, troop strength, research bonus, trade bonus, ship maintenance savings, satisfaction modifier, government preferences, special components, pre-warp techs, key resources, victory condition, disaster exceptions, native habitat) is in **Appendix A** (reproduced verbatim from races.txt). All 24 races:

**22 playable races:** Ackdarian, Atuuk, Boskara, Dhayut, Gizurean, Haakonish, Human, Ikkuro, Ketarov, Kiadian, Mortalen, Naxxilian, Quameno, Securan, Shandar, Sluken, Teekan, Ugnari, Wekkarus, Zenox, plus the two special playable-in-ancient-mode races **Shakturi** and **Mechanoid** (playable only in the Ancient Galaxy storyline / specific scenarios).

Race summaries (general characteristics, victory conditions, key resources — from the official manual):
- **Ackdarian** (Amphibian, Ocean): reproduce 19%, quite intelligent, very passive, very cautious, very dependable, gifted scientists, master engineers. Victory: control Ocean colonies and build the largest ships; slower at colonizing Desert and Volcanic. Special tech: TurboThruster ER7 (main thrust engine). Key resources: Nepthys Wine, Ucantium, Pearl, Steel.
- **Atuuk** (Ursidian, Continental): reproduce 28%, extremely stupid, quite aggressive, extremely reckless, very dependable, naturally optimistic, Luddites (slow builders). Victory: keep their homeworld with a large, happy population. Key: Caguar Fur, Chromium, Rephidium, Ale.
- **Boskara** (Insectoid, Volcanic): reproduce 24%, moderately intelligent, extremely aggressive, very reckless, quite unfriendly, very unreliable, warrior class, fierce rivalry; special government: Hive Mind. Victory: destroy enemy ships, bases, and troops, enslave or exterminate their people, control their homeworlds. Special tech: Shaktur Firestorm (beam weapon). Key: Aculon, Emeros, Crystal, Rephidium, Ale.
- **Dhayut** (Insectoid, Desert): reproduce 12%, quite intelligent, very aggressive, extremely unfriendly, extremely unreliable, fierce rivalry; special hyperdrive: Velocity Drive ST3. Victory: keep their homeworld, conquer and enslave enemy colonies and people; a regular change cycle increases aggression and population growth. Key: Wiconium, Tyderios, Osalia.
- **Gizurean** (Insectoid, Volcanic): reproduce 30%, quite stupid, quite aggressive, extremely unfriendly, very unreliable, master engineers; special government: Hive Mind. Victory: build the Universal Hive, keep the Leader alive, build a large military, control many Volcanic colonies; faster builders; change cycle increases population growth. Key: Nekros, Stone, Iridium.
- **Haakonish** (Reptilian, Marshy Swamp): reproduce 16%, quite intelligent, quite aggressive, very cautious, very unfriendly, cunning schemers, master engineers; special government: Mercantile Guild. Victory: successful espionage and counter-espionage, trade, control restricted resources, larger military ships. Special tech: mega-density fuel cell. Key: Ilosian Jade, Polymer, Falajian Spice.
- **Human** (Humanoid, Continental): reproduce 18%, quite intelligent, quite aggressive, quite cautious, quite friendly, very dependable, cunning schemers, gifted scientists; special government: Corporate Nationalism. Victory: control Continental colonies, make alliances, be victorious when at war, build trade and tourism. Key: Yarras, Marble, Emeros, Crystal, Gold.
- **Ikkuro** (Ursidian, Continental): reproduce 16%, quite intelligent, quite aggressive, quite cautious, quite unfriendly, quite dependable, master engineers, warrior class, natural merchants. Victory: control Continental colonies, build space ports, form alliances, keep military casualties minimal, fast builders, colonization technology experts. Special tech: S2F7 RepairBot (damage control). Key: Megallos Nut, Lead, Osalia.
- **Ketarov** (Ursidian, Marshy Swamp): reproduce 16%, quite intelligent, extremely passive, very cautious, quite unfriendly, extremely unreliable, cunning schemers; special government: Corporate Nationalism. Victory: successful espionage and counter-espionage, avoid war but maintain a large military, smaller civilian ships. Key: Ekarus Meat, Carbon Fibre, Vodkol.
- **Kiadian** (Humanoid, Continental): reproduce 18%, very intelligent, slightly aggressive, very cautious, extremely dependent, gifted scientists, master engineers; special tech: ShadowGhost ECM 2000 (countermeasures). Victory: maintain long-term treaties, be trustworthy, research. Key: Natarran Incense, Polymer, Rephidium, Ale.
- **Mortalen** (Reptilian, Desert): reproduce 16%, moderately intelligent, very aggressive, quite reckless, very unfriendly, very unreliable, warrior class, fierce rivalry; special tech: Swift Vector 5000 (vectoring engine). Victory: have the best admirals and generals, destroy enemy troops, subjugate their empires and conquer their colonies. Key: Dantha Fur, Wiconium, Silicon.
- **Naxxilian** (Reptilian, Ice): reproduce 23%, slightly stupid, very aggressive, very cautious, quite unfriendly, quite dependable, warrior class. Victory: control Ice and Continental colonies, form alliances, export culture, higher tourism; armor technology disallowed; slow to colonize Volcanic. Key: Jakanta Ivory, Tyderios, Vodkol.
- **Quameno** (Amphibian, Ocean): reproduce 14%, extremely intelligent, extremely passive, very cautious, very unfriendly, extremely dependable, gifted scientists; special government: Technocracy. Victory: avoid wars and treaties, research, research, research! Special tech: NovaCore NX-700 (reactor). Key: Aquasian Incense, Polymer.
- **Securan** (Humanoid, Desert): reproduce 27%, moderately intelligent, very passive, quite reckless, quite friendly, very dependable, natural optimists; special government: Utopian Paradise. Victory: build resort bases, form alliances, promote tourism and happiness; regular change cycle increases happiness and population growth; higher tourism. Key: Wiconium, Natarran Incense, Osalia.
- **Shandar** (Reptilian, Volcanic): reproduce 21%, slightly stupid, quite passive, slightly friendly, quite dependable, natural optimists; special government: Utopian Paradise; avoid disasters on Volcanic planets. Victory: be happy and have lots of luxury resources, control Volcanic colonies and build the Lava Palace resort wonder; slow to colonize Ocean and Ice. Key: Otandium, Opal, Osalia, Aculon.
- **Sluken** (Insectoid, Marshy Swamp): reproduce 21%, quite intelligent, very aggressive, slightly cautious, very unfriendly, very unreliable, warrior class, fierce rivalry; special government: Hive Mind. Victory: control Swamp and Continental colonies, maintain the largest ground forces, faster troop regeneration. Special tech: StarBurner XX-12 (main thrust engine). Key: Chromium, Falajian Spice, Questurian Skin.
- **Teekan** (Rodent, Desert): reproduce 19%, quite stupid, extremely passive, quite reckless, quite friendly, extremely dependable, industrious miners, natural merchants; special government: Mercantile Guild. Victory: make money through trade and the private economy, avoid war, annihilate the hated Sand Slugs; smaller military ships, larger civilian ships, faster builders, good traders, high migration rate. Key: Silicon, Dantha Fur.
- **Ugnari** (Rodent, Ice): reproduce 14%, quite stupid, very passive, very reckless, quite friendly, extremely unreliable, industrious miners, natural optimists; special government: Mercantile Guild; avoid disasters on Ice. Victory: control Ice colonies, complete HighTech research, trade, mine resources; fast builders, good traders. Key: Terallion Down, Aculon, Tyderios.
- **Wekkarus** (Amphibian, Ocean): reproduce 16%, moderately intelligent, very passive, quite cautious, very unfriendly, quite unreliable, industrious miners, natural merchants. Victory: keep your homeworld, avoid war, trade and mine resources, build the Underwater Palace wonder. Key: Questurian Skin, Dilithium, Crystal, Lead.
- **Zenox** (Rodent, Continental): reproduce 17%, quite intelligent, quite passive, very cautious, quite unfriendly, slightly dependable, natural optimists, master engineers; special government: Technocracy. Victory: explore the galaxy and control colonies with ruins, keep military casualties minimal, build the Galactic Archives wonder; knowledge of additional historical locations. Special tech: Megatron Z4 (shields). Key: Bifurian Silk, Carbon Fibre, Osalia.
- **Shakturi** (playable only in Ancient Galaxy storyline): a resurgent ancient invasion force; victory: defeat the player's galactic civilization / conquer the galaxy (as the invading empire in ROTS).
- **Mechanoid** (non-biological; playable in select scenarios): the ancient robot race; their ruins litter the galaxy and contain the Ancient tech line (Warp technology origins).

Race families (7): Amphibian (Ackdarian, Quameno, Wekkarus), Reptilian (Haakonish, Mortalen, Naxxilian, Shandar), Insectoid (Boskara, Dhayut, Gizurean, Sluken), Humanoid (Human, Kiadian, Securan), Ursidian (Atuuk, Ikkuro, Ketarov), Rodent (Teekan, Ugnari, Zenox), plus Mechanoid as its own family — the family system feeds the race-family bias matrix (Appendix C) and family-specific population policies.

### 5.2 Governments (13 types; exact attributes in Appendix B)
Six available to all races: **Democracy** (approval, population growth, corruption, colony income up; war weariness, maintenance, troop recruitment down; elected leader), **Republic** (corruption, research speed, colony income up; maintenance down; elected leader), **Feudalism** (troop recruitment, war weariness, maintenance up; approval, research down; hereditary), **Monarchy** (war weariness, troop recruitment up; hereditary), **Despotism** (war weariness, maintenance up; corruption, approval, research down; appointed/strongman), **Military Dictatorship** (war weariness, troop recruitment, maintenance up; approval down; military leader).
Five race-locked: **Corporate Nationalism** (Human/Ketarov: private income fully merged into state funds; short-term revenue, long-term private-sector efficiency decay; very hard to switch from), **Mercantile Guild** (Haakonish/Teekan/Ugnari: maintenance and colony income up), **Technocracy** (Quameno/Zenox: corruption and research up), **Hive Mind** (Boskara/Gizurean/Sluken: corruption, war weariness, maintenance, approval up; the "leader" is the hive consciousness — special rules: hive leaders cannot be killed like normal characters, replacement on death is special), **Utopian Paradise** (Securan/Shandar: approval and population growth up; war weariness, troop recruitment down).
Two storyline governments (rediscovered through the Ancient Galaxy storyline, then selectable): **Way of the Ancients** (corruption, maintenance, approval, population growth, research, colony income up) and **Way of Darkness** (war weariness, maintenance, population growth, research, troop recruitment up).
Government attributes (18 numeric modifiers, Appendix B): Approval, PopulationGrowth, WarWeariness, ResearchSpeed, Corruption, MaintenanceCosts, TroopRecruitment, TradeBonus, plus leader-replacement rules and natural friend/rival government pairs (the manual's tables in Appendix B drive the 13×13 government bias matrix). Changing government: the player may "Have a Revolution" at any time (empire screen) with economic disruption; governments with elections (Democracy, Republic, Utopian Paradise, Mercantile Guild, Technocracy) replace leaders periodically by election; others by coup/death (LeaderReplacement attributes).

### 5.3 Characters (model details)
See Part 9 of this document (character roles, 46 skills, ~90 traits, lifecycle, replacement rules) — the full CharacterRole/CharacterSkillType/CharacterTraitType/CharacterEventType lists are in the enum appendix. Characters appear at colonies, on ships/bases, and in fleets; their portraits, names (per-race name pools), and skill tooltips are shown in the characters screen (F10).

---

## PART 6 — ECONOMY (state, private sector, resources, trade, piracy)

### 5.1 The two economies
- **Private economy** (never directly controlled): private citizens own and operate all freighters, mining ships, gas mining ships, and passenger ships; they automatically: mine resources at mines/mine stations and haul them to spaceports; trade resources between colonies (own and other empires') following supply/demand; generate tourism traffic (passenger ships between colonies and resort bases); build and run trade. Private-ship construction demand is stimulated by empire expansion (new colonies → citizens buy new freighters/miners at your yards → state income).
- **State economy** (player/AI controlled): cash on hand, income, expenses, construction funding.
  **Income lines** (exact categories from the Empire Summary screen):
  1. **Colony tax revenue** — per colony: (colony income) × tax rate (0–40%; policy default by colony size: small 0/low, medium ~2, large ~3 on the 0=Zero/1=Low/2=Normal/3=High scale; tax auto-adjusts per policy; raising taxes → evasion: some citizens dodge, lowering actual revenue, and lowering approval/happiness). Natural merchants (races with TradeBonus, e.g. Quameno/Teekan) and governments with TradeBonus>1.0 (Mercantile Guild 1.3, Utopian 1.0...) earn more.
  2. **Private ship construction fees** — revenue when private citizens buy new ships at your yards (a % of construction).
  3. **Trade transaction fees** — a fee on every transaction executed at your spaceports/mining stations (why safe trade matters).
  4. **Treaty bonus income** — Free Trade Agreements: each party earns a growing percentage of the bilateral trade volume, capped at **20%**; Mutual Defense Pact / Protectorate: same mechanic capped at **30%**; Subjugated Dominion: the vassal pays **10% of its annual state revenue** as tribute to the overlord.
  5. Tourism income (resort bases) and pirate income lines (pirate empires only, 5.6).
  **Expense lines**: ship maintenance (military + civilian split; base rate per ship size/role × government MaintenanceCosts × race ShipMaintenanceSavings × command-center bonus; ships in fuel-hungry states cost more), base maintenance (same model), troop maintenance (per troop size × government × race savings), intelligence agent maintenance.
- **Money** can go negative (debt); corruption (empire-wide, grows with size/age, reduced by republic/technocracy/utopian attributes) siphons a percentage off all income (ApplyCorruptionToIncome) — displayed as a separate line.

### 5.2 Colonies produce (per colony, per game day)
- **Population**: grows at the race ReproductionRate (annual), scaled by: government PopulationGrowth, colony happiness/approval (from the attitude model below), availability of the colony's **growth resources** (Hydrogen 1.0, Steel 0.6, Lead 0.4, Silicon 0.3, Polymer 0.3, Carbon Fibre 0.3 required levels per resources.txt), food (colonies on certain surface types need food resources), medical/recreation facilities, wonders (population growth wonders), population policies of the owning empire, and the natural population cap of the world type (gas giants have none; barren rock none; others per surface area/quality). Populations are multi-racial (colonists from the colonizing race + original natives + later immigrants per population policies).
- **Resources**: each planet's resource deposits are mined by the colony's own extractors and by visiting mining ships/stations; luxury resources flow to spaceports; **manufactured (colony-manufactured) resources** appear at colonies above `population(billions) × development ≥ resource.ColonyManufacturingLevel`.
- **Colony income** (tax base) scales with population, development level (0–100+%, boosted by ruins up to +50%), luxury resource availability, commerce, and facilities; development also gates which facilities can be built (facility thresholds from policy: e.g. Planetary Shield at 2,000M population, Giant Ion Cannon/Regional Capital at 5,000M, academies at 2,000–5,000M, cloning/bunker/terraform/robotic-foundry/training at 500M) and which troop types can be recruited.
- **Attitude/approval model** (per colony; shown as attitude factors in the UI): factors include food/resource shortages (each missing required resource hurts), tax rate (higher tax → lower approval), war weariness (government WarWeariness rate × war duration, attenuated by race), corruption, luxury availability, recreation/medical quality, population density vs cap, foreign-instigated revolution risk (vs government Stability), conquest/occupation penalties, enslavement resentment, disasters. Low approval → lower growth, lower income multiplier, possible **revolt** (colony flips to independence or to a nearby friendly empire — the "colony flip" mechanic: colonizing a system already settled by another empire is a diplomatic offense and the newcomer's colony often flips back to the original owner).
- **Strategic value** of a colony (used for victory comparisons and AI targeting): a weighted function of population, development, resources, and facilities (the "colony value" shown in Expansion Planner and Empire Comparison).

### 5.3 Resource markets (exact, from source)
- Each resource has a BasePrice (minerals/gas 5.0; luxuries 5–200 by tier; super-luxuries 200).
- Prices are reviewed periodically (ReviewResourcePrices):
  - demand = total outstanding contract quantities for the resource (all empires' trade orders);
  - supply = total available cargo of the resource at all colonies + spaceports + mining stations (all empires and pirates);
  - target price = BasePrice × demand / max(1, supply);
  - if target < current: price moves down by **half** the gap (fast drops); if target > current: moves up by **a quarter** of the gap (slow rises), capped at +50% of the current price per review.
- Freighters buy at one spaceport and sell where the price differential (minus transport cost/time) is positive; super-luxury scarcity drives the high prices (a super-luxury's prevalence value is "sources per 700-star galaxy").

### 5.4 Trade mechanics
- Trade orders: quantity, source (spaceport/colony/mine), commodity, price terms; fulfilled by private freighters (small/medium/large) hired/operated privately; **freight missions** (the state can also commission state freighters). Contracts can be offered between empires in diplomacy (resources for resources/credits; technology; designs; maps — see Diplomacy).
- **Trade Sanctions**: no trade between the two empires; the sanctioning empire may also enforce blockades (4.5). Lifting sanctions is a diplomatic action.
- **Tourism**: scenic locations (ringed planets, gas giants, ruins, wonders) draw tourists from nearby large colonies; private passenger ships ferry them to resort bases; resort income depends on passenger volume × admission (commerce); policy EngageInTourism and TourismPriority shape it; pirates can build resorts too.

### 5.5 Construction
- **Planetary/spaceport yards**: build ships from queued designs; build time = f(ship size, yard speed (ConstructionYard Value1 / facility bonuses / wonder ColonyConstructionSpeed), crew). Spaceport construction: a construction ship (or a ship with a construction yard) hovers over an uncolonized planet/moon/gas cloud/asteroid with a "Build" mission and constructs the base over time; bases can also be built/retrofitted/repaired at other yards (Repair, Retrofit, Retire/Scrap missions).
- **Manufacturer components** on ships build new ships in orbit (ship-on-ship construction), limited by manufacturer speed (Value1) and the builder's cargo (resources) — the AI uses this to expand fleets away from home.
- **Scrap**: scrapping returns a % of build cost as cash (looting value) and frees the design slot; the F9 Build Order screen manages all queues (pause/reorder/cancel).

### 5.6 Pirate economy (pirate empires only)
Pirate income types (exact from PirateIncomeType): **Piracy** (bounties/loot from completed pirate attack missions and successful attacks — loot value × LootingFactor × (1−corruption)), **Smuggling** (mission rewards for moving cargo for other factions, per Smuggler playstyle), **Protections** (protection-agreement income from empires that pay you not to raid them), **Raid** (loot/credits/research from raiding planets/bases), **Mining** (sale of mined resources to other factions), **Information** (selling maps/tech/research via diplomacy), **Resorts** (tourism income from pirate resort bases), **Subjugation** (tribute from subjugated targets), **Captured ships** (enlisted value), **Scrap** (scrap value of unusable captures), **Taxes** (from controlled planets — see below).
Pirate expenses: wages (fleet maintenance), construction, facilities, agent costs.
**Controlling colonies (pirate influence)**: pirate ships in orbit of a planet raise that faction's influence on it (intimidation from military presence > smuggling; a successful raid gives a big jump); up to 3 factions can hold influence per planet, only one full control; influence decays without presence; bigger populations are harder to control (small/medium planets are the practical targets). At **50% control** you may build a **Hidden Pirate Base** (locks your control floor at 50%, +50% faction research potential, +income from the planet, +planetary corruption; vulnerable to enemy raids while under construction); at **100% control** + finished base you may build a **Hidden Pirate Fortress** (locks control at 100%); atop a fortress, a **Criminal Network** gives complete control (removes the planet from the owner's control). The planet's owner can attack these facilities (ground battle vs base defenders).
Pirates are eliminated when they lose all spaceports, controlled colonies, construction ships, and resupply ships (survivors often defected before that); pirate factions that get fearful can join the player's side (FearfulPirateFactionJoinsPlayer), and factions attacked by super-pirates may join the Phantom Pirates.
**Pirate missions** (the mission marketplace, per PirateMissionType): **Attack** (offer/bid: "capture or destroy this ship/base for a reward"), **Defend** ("escort/defend this ship for a fee"), **Smuggle** ("move this cargo from A to B"), **Raid** (planets/bases), **Eradicate** (pirate facilities). Empires set OfferPirateAttackMissions / BidOnPirateAttackMissions / OfferDefensivePirateMissions / AcceptPirateSmugglingMissions policies; pirates bid on and complete them; completion pays out income/loot and can trigger faction-switching events.

### 5.7 Wonders
Galactic Wonders: unique empire-scale or colony-scale projects (Type WONDER) researched via a special project, then built at one colony (cost + build time + ongoing maintenance). Only ONE wonder of each WonderType exists galaxy-wide; the first empire to complete it gets the benefit and cancels all others' partial builds. WonderTypes: EmpirePopulationGrowth, EmpireHappiness, EmpireResearchWeapons/Energy/HighTech, EmpireIncome, ColonyPopulationGrowth, ColonyHappiness, ColonyDefense, ColonyConstructionSpeed, ColonyIncome, RaceAchievement (race-specific, e.g. the Lava Palace for Shandar, Underwater Palace for Wekkarus, aquasian/wiconium-related, etc.). Some are race-locked and tie into race victory conditions. Wonders are scenic (tourism).

---

## PART 7 — RESEARCH (exact model)

### 6.1 Structure
- Three industries: **Weapons** (beam/area/ion/gravity/super weapons, torpedoes/missiles, point defense, armor, assault pods, fighters, troops), **Energy** (shields, engines, hyperdrives/hyper-disruption, reactors, collectors, extractors, construction, manufacturers, damage control), **HighTech** (all sensors, targeting, countermeasures, command/commerce centers, labs, life support/habitation/medical/recreation, storage, docking, colonization modules).
- Tech trees: projects arranged in tech levels 0–8 (level N projects cost 2^N × BaseTechCost; each level doubles cost; the galaxy option "Research Costs" scales BaseTechCost, custom 1–999K). A project unlocks via PARENTS (all must be researched; multiple parents allowed — the UI shows red prerequisite lines). Projects may have: unlocked COMPONENTS (up to 4 new component IDs), COMPONENT IMPROVEMENTS (replace Value1–7 of existing components — **existing ships/bases using those components upgrade automatically and immediately**), FIGHTERS (new fighter/bomber types), FACILITY (new planetary facility/wonder), ABILITIES (e.g. "Colonize X-type planets", "Increased Construction Size (tier → max hull size)", "Dedicated Carriers", "Resupply Ships", "Enable Armored Forces", "Enable Special Forces", "Enable Planetary Defense", troop upgrade levels, "Improved Boarding Attack/Defense", "Lower Troop Maintenance"), PLAGUE CHANGE (e.g. Xaraktor virus becomes researchable/deployable), ALLOWED RACES (race-locked projects).
- The complete 337-project tree (all names, levels, rows, unlocks) is in the Content section of this document (generated verbatim from research.txt) and MUST be reproduced as data.
- **Crash research**: pay money (cost scales with the project's remaining cost) to triple the research speed on the first queued project (lightning icon); one crash at a time per queue slot.
- **Research output**: total empire **Research Potential** = sum over colonies (population × development × labs) + research stations (research labs Value1, with location bonuses: orbits of neutron stars, inside supernova radiation zones, edges of black holes, and on planets with Ruins give significant multipliers — "anomalies") + character scientist bonuses + government ResearchSpeed + race ResearchBonus + ResearchIndustryFocus (0=None,1=Weapons,2=Energy,3=HighTech) + wonders. **Research Capacity** = how much of the potential is actually staffed/distributed (three parallel workstreams, one per industry, split by policy). **Actual Output** (red when < capacity) is what progresses the queue: the queue advances projects in order; a project completes when its cost (tech points) is paid; on completion all its unlocks apply galaxy-wide to that empire.
- Pre-warp empires start with pre-warp tech already researched (SpecialFunctionCode 1) and must unlock the primitive hyperdrive ("warp bubble", code 2) before accessing the rest of the tree; some projects start locked until a game event (code 5).

### 6.2 Design system (ship & base construction)
- A **Design** = role (one of the 29 BuiltObjectSubRole ship/base types) + component list. Ship designs: hull budget = size; auto-added components: Command Center, Life Support, Hab Modules (enough for the ship's crew size), exactly one HyperDrive (ships only), and enough Reactors/Energy Collectors to meet energy demand. Bases: no hyperdrive; more support components.
- **Design specifications** (per role; from the design data): minimum/maximum counts per component category, allowed component types, required components (e.g. military ships need weapons; colony ships need Colonization Modules; carriers need fighter bays; freighters need cargo), size limits per construction-size tier (unlocked by research "Increased Construction Size" abilities: tier 1 small → tier 2 medium → tier 3 large → tier 4 huge), and role-specific rules (e.g. only carriers/resupply may carry dedicated fighter bays above a threshold — "Dedicated Carriers" ability; resupply ships need fuel converters).
- **Component placement**: components fill the design; the design editor validates counts against the specification rules; components must be researched (unlocked or improved up to the current level); race SpecialComponents are only usable by that race.
- **Designs are per-empire assets**: built from race templates (31 templates per race — the full tables are in the Content section), improved as research improves components (auto-retrofit policy DesignUpgrade* per role + ResearchDesignAutoRetrofit), and can be **traded, stolen (intelligence), or leaked** (a captured ship's design is visible to the captor). Design image scaling mode controls sprite fit (Original / Scale To Fit / Crop).
- New designs are created by the player (F8) or by AI (the AI designs follow the empire's OverallShipDesignFocus 0=Balanced/1=Speed-Agility/2=Power/3=Efficiency and TechFocus1–6 priorities).

---

## PART 8 — DIPLOMACY (complete model)

### 7.1 Relations (DiplomaticRelationType) and exact effects
- **NotMet**: empires have not yet made contact (no messages possible; discovered via first contact when a ship scans/visits the other's known systems or via long-range scanner).
- **None**: neutral.
- **Free Trade Agreement**: trade bonus income (growing % of bilateral trade volume, cap 20%); closest colony of each side revealed immediately on signing.
- **Mutual Defense Pact** / **Protectorate**: like FTA (cap 30%) + mutual (pact) or one-way (protectorate: the larger protects the smaller) defense obligation — if one is attacked, the other must aid; **full visibility sharing** (each sees everything the other sees, exploration included).
- **Subjugated Dominion**: the subjugated empire pays 10% of annual state revenue as tribute; the overlord sees all vassal ships/bases/colonies; imposed by the winner of a war (or accepted under pressure).
- **Trade Sanctions**: no trade; may be enforced with blockades.
- **War**: full hostility (attacks, blockades, espionage, bombardment); continues until peace (see 7.4).
- **Truce**: (pirate context) a temporary non-aggression between pirate factions.
Relations are bilateral and exclusive (one relation per pair, war supersedes).

### 7.2 Relationship evaluation (what shifts how empires feel about each other)
Each empire maintains a relationship score toward every other empire, computed from:
- **Natural biases**: race→race (24×24 matrix, −50..+50), race-family→family (−30..+30), government→government (−30..+30) — full matrices in the Content section.
- **Trade volume** (high trade = strong positive), **gifts** (bigger = bigger positive; intelligence matters — smarter empires are more placated by gifts), **treaty history** (honored treaties positive; broken treaties strongly negative — governed by loyalty), **war and attacks** (very negative; bombardment/planet-destroying and "diabolical" reputations stack), **blockades** (each new blockade adds offense), **competition** (colonizing or building in a system settled by another empire — colonizing is a major offense, stations minor), **friends-of-friends** (at war with your friend = negative; treaty with your friend = positive), **reputation** (empire-wide civility rating: killing Silver Mists, diabolical acts; other empires' concern level from their government attributes), **events** (storyline/race events shift attitudes in bulk).
- The score drives: first-contact posture, treaty acceptance, war likelihood, trade willingness, and which empires ally/declare war on each other.

### 7.3 Messages and conversation
- **EmpireMessageType** (full 95-value list in Content section): from "EmpireDiscovered / Contact" through treaty offers (Alliance, NonAggression, FreeTrade, MutualDefense, Protectorate, TradeSanctions, tribute/dominion, gifts, warnings), war declarations and peace offers (with/without terms), blockade notifications, trade proposals (resources/tech/designs/maps/credits/passengers/troops), intelligence-mission detected/failed, plague events, disaster events, storyline events, ship/base captures and scrappings, pirate mission offers, subjugation offers, surrender offers, etc.
- **Delivery**: popup (player must dismiss, optionally suppressed), scrolling message (top bar), or advisor/diplomatic queue (stacked on the right). All go to Message History (H) with location pings.
- **Conversation dialog** (Diplomacy screen "Speak"): a message tree — the other empire's message appears (with its portrait), and the player chooses from ConversationOptions generated by the situation: offer/accept/decline/cancel each treaty type, declare war / offer peace (with terms: unconditional, subjugation, territory transfer), give gifts (select amount), warn, propose trade (select items to give/receive from both empires' offerings — resources with quantities, technology (specific research projects), ship designs, territory maps, galaxy maps, secret locations; the other side's willingness to share scales with the relationship), propose subjugation/tribute. AI empires initiate conversations too (they send the dialog; the player responds). The dialog grammar (DialogPartType: ~100 part types) composes every message naturally.
- **Diplomatic strategies** (AI per empire, per target empire): Conquer, Befriend, Placate, Defend, Ally, Undermine, Defend+Placate, Defend+Undermine, Punish — chosen from the relationship, relative power (EmpireComparisonType: research/economy/military/expansion comparisons), and policy.

### 7.4 War mechanics
- Declaration: a message (declared or surprise — governed by policy/race caution); **WarObjective**: TotalConquest / CaptureObjectives / EndWar. During war: attacks (fleet battles, bombardment per policy, blockades, intelligence), war weariness accumulates (government rate, race attenuation; when it exceeds tolerance the populace can force an end — WarEndReason.WarWearinessExceeded), heavy losses push empires to peace (HeavyLosses), empires at war with your allies complicate treaties (AtWarWithOtherEmpires).
- **Peace**: end-war message with terms (unconditional, subjugation/tribute, territory); accepted → relation returns to the pre-war baseline adjusted by war events.
- AI decides wars from: WarWillingness policy (0.5–4.0), relationship score, relative military strength (fleet attack-power comparisons), opportunity (enemy weakness, alliance situations), and the target's DefensivePact partners (attacking one drags in pact partners).

### 7.5 Intelligence (agents) — see Part 9; note diplomatic fallout: failed/caught missions damage reputation (all empires) and the specific relationship heavily; counter-intelligence agents (IntelligenceCounterIntelligenceProportion of your agents) intercept enemy missions.

---

## PART 9 — CHARACTERS (the human element)

### 8.1 Roles (CharacterRole)
**Leader** (one per empire; assigned to the homeworld; empire-wide bonuses; much less effective away from the capital; replaced per government: elected governments (Republic/Democracy/Utopian Paradise) hold elections, others coup/replacement — government LeaderReplacement* attributes), **Ambassador** (improves a specific empire relationship; must be assigned to that empire's homeworld — which requires discovering it), **Colony Governor** (colony-wide bonuses: income, happiness, growth, corruption, construction, mining, troop recruiting), **Scientist** (boosts research output at one spaceport/research station; specialization in Weapons/Energy/HighTech), **Fleet Admiral** (fleet-wide combat bonuses: targeting, countermeasures, maneuvering, fighters, weapons damage, damage control, weapons range; pirates' admirals may attempt to usurp the Pirate Leader), **Troop General** (troop bonuses on a planet or fleet: ground attack/defense, troop recovery; some specialize in troop types), **Intelligence Agent** (runs the 12 intelligence missions; default assignment: Counter-Intelligence), **Ship Captain** (single-ship bonuses; may auto-promote to Fleet Admiral; captain+admiral bonuses stack for the captain's ship), **Pirate Leader** (pirates only; one per faction; acts as leader at the main spaceport or as admiral on a fleet).
### 8.2 Skills and traits
46 CharacterSkills (Diplomacy, ColonyIncome, TradeIncome, TourismIncome, CorruptionReduction, Happiness, PopulationGrowth, Mining, TroopRecruitment, Military/Civilian/Colony ship construction, FacilityConstruction, Weapons/Energy/HighTech research, Espionage, CounterEspionage, Sabotage, Concealment, PsyOps, Assassination, maintenance savings ×5, WarWearinessReduction, Targeting, Countermeasures, Maneuvering, Fighters, WeaponsDamage, DamageControl, WeaponsRange, BoardingAssault, TroopRecovery, TroopGroundAttack/Defense, …) at levels 0–100; characters start with role-appropriate skills and improve with experience/success (success of missions, treaties signed, colonies developed). ~90 CharacterTraitTypes (Xenophobic, Belligerent, Diplomatic, Corrupt, Honest, Optimist, Pessimist, Loner, Conformist, Rebellious, Leader, …) shape behavior and generate race events; some traits are hidden until "tested" (Untested characters).
### 8.3 Lifecycle
Characters age and die (death types: GenericDeath, Assassination, ShipDestroyed, BaseDestroyed, ColonyInvasion, ColonyBombardment, Disaster, ShipCaptured, BaseCaptured, Dismissed); new characters are generated over time, biased by the empire's recent activities (expansion → admiral; treaties → ambassador; breakthroughs → scientist); the player can Dismiss characters (the next replacement takes time to appear).

---

## PART 10 — VICTORY, GAME END, AND ACHIEVEMENTS

### 9.1 General victory conditions (chosen at game start; threshold 75–100%)
- **Territory**: your territory (colonies + influence) ≥ X% of all territory.
- **Population**: your population ≥ X% of galaxy population.
- **Economy (strategic value)**: your empire's strategic value ≥ X% of the galaxy's (the same metric used in the comparison screen).
- **Time limit**: at the end date, the highest strategic value wins (defeat if last).
- **Race-specific** (if enabled; 60 conditions, per race — full list in Content): e.g. Ketarov "win with the strongest spy network", Atuuk conquest-style, Gizurean/Dhayut military, Quameno trade, Shandar "build the Lava Palace wonder", Wekkarus "build the Underwater Palace", Teekan "annihilate the Sand Slugs", Shakturi/ancient storyline variants, pirate playstyle sets, etc. Progress is tracked and shown on the Victory screen with the nearest-rival bar.
- **Pirate playstyle victory sets**: Balanced (varied: colony control, protection income, captures, pirate missions, Criminal Network), Mercenary (attack/defend missions, captures, raids, Criminal Network), Raider ("Pirate" playstyle: raids, colony control, eliminating other pirates, hidden bases/fortresses), Smuggler (trade income, research, protection agreements, intelligence missions, Criminal Network).
- **Storyline victories**: Ancient Galaxy (defeat the Shaktur Axis / join an alliance / specific historical outcomes), ROTS (defeat the Shakturi), Legends (special events), Shadows (pre-warp empires: complete hyperspace discovery; pirates: dominate the Shadows era).
- **Elimination**: a planetary empire is eliminated losing all colonies + space ports; a pirate faction losing all spaceports + controlled colonies + construction/resupply ships (see 5.6). Eliminated empires' objects transfer/destroy per rules; the game can continue (other empires keep playing) until a winner.
### 9.2 Game end
End screen: winner (or time-limit result), per-empire end statistics (population, territory, economy, research, military — the stats tracked in the SaveStats XML files), achievements earned, and "Continue" (sandbox keeps running) or exit.
### 9.3 Achievements (AchievementType, 25): e.g. AchieveAllRaceVictoryConditions, DestroyEnemyMilitaryShipsAndBases, DestroyEnemyCivilianShipsAndBases, DestroyEnemyTroops, DestroySpaceMonsters, DestroySilverMists, ConquerEnemyColonies, SuccessfulIntelligenceMissions, StartWars, BreakTreaties, EliminateEnemyCharacters, EliminateEnemyEmpires, HighestTradeIncome, HighestMiningVolume, CaptureEnemyShips, EliminatePirateFactions, SpendAllTimeAtWar, SpendNoTimeAtWar, SuccessfulRaids, ChangeGovernmentToWayOfDarkness, ChangeGovernmentToWayOfTheAncients, EmpireSplits, BuildWonders, OwnOperationalPlanetDestroyer, JoinTheFreedomAlliance, JoinTheShakturi, DefeatAncients, DefeatShakturi, DefeatLegendaryPirates — tracked per faction (player and AI) and shown on the V screen with medals.
### 9.4 Disasters and events
**Disasters** (DisasterEventType, on habitable planets): Earthquake, Sinkhole, Tsunami, Sandstorm, Blizzard, Eruption (surface-type appropriate; race-specific disaster resistances, e.g. Shandar avoids disasters on Volcanic, Ugnari on Ice) — reduce population/development; some are storyline-triggered. **Plagues** (PlagueType: HekretosFever, DekaraVirus, GeneticScrambler, MerturovPlague — full parameters in Content): natural occurrence rate, mortality (population/s), infection spread to nearby colonies, duration, per-race exceptions, optional total elimination (floors at 10M if disabled); **Xaraktor Virus** (Ancient Galaxy): a researchable AND deployable bioweapon (SpecialFunctionCode 1). **Race events** (RaceEventType, 28 — e.g. PredictiveHistory, EmpireSplits, ChangeCycle, …) fire on conditions and grant bulk buffs/events to a race. **Storyline events** fire on timers/conditions (Shakturi arrival, ancient discoveries, pre-warp progression: 12 PreWarpProgressEventType milestones for pre-warp empires).

---

## PART 11 — EMPIRE AI, AUTOMATION, AND POLICIES

### 10.1 Automation (the player's control dial)
Each empire has per-domain **AutomationLevel**s: `Manual` (player decides), `SemiAutomated` (AI proposes via advisor messages; player approves/declines — the IAutomationAuthorizer), `FullyAutomated` (AI decides silently). Domains:
1. **Colonization** (ControlColonization) — picking planets and sending colony ships.
2. **State construction** (ControlStateConstruction) — what ships/bases the state builds (military/civilian mix per construction policy).
3. **Military attacks** (ControlMilitaryAttacks) — fleet engagements, blockades, bombardment authorization.
4. **Diplomacy gifts** (ControlDiplomacyGifts).
5. **Diplomacy treaties** (ControlDiplomacyTreaties) — accept/decline offers.
6. **Diplomacy offense** (ControlDiplomacyOffense) — declare war, impose sanctions/subjugation, initiate intelligence.
7. **Agent assignment** (ControlAgentAssignment).
8. **Colony facilities** (ControlColonyFacilities) — which facilities to build on colonies.
9. **Pirate mission offering** (ControlOfferPirateMissions; default FullyAutomated for empires — offer/bid/accept pirate attack/defend/smuggle missions).
Plus **per-ship automation** (the "A" key): an individual state ship auto-missions itself by role (patrol its system, escort trade, hunt pirates, explore, mine, supply) until the player manually assigns it a mission; all newly built ships start fully automated. Private ships are always automated. The Options → Automation screen sets each domain; "suppress all pop-ups" + full automation allows unattended play.
**Advisor messages** (AdvisorMessageType, 32 kinds): the semi-automation prompts — BuildOrder, BuildOneOff, Colonization, IntelligenceMission, EnemyAttack/Bombard/Blockade/PlanetDestroyer, InvadeIndependent, PrepareRaid, DiplomaticGift, TreatyOffer, War/TradeSanctions (declared on you), ColonyFacility, Offer/Cancel MilitaryRefueling, Offer/Cancel MiningRights, Allow/Disallow TradeRestrictedResources, ComplyTradeSanctions/War, DefendTerritory, Retrofit, RequestLiftTradeSanctions, RequestEndWar, pirate mission offers, DefendTarget — each renders as an advisor panel with Approve/Decline buttons and context.

### 10.2 Empire policies (the full per-empire settings set; per-race defaults in Policy/<race>.txt)
All settings below exist in the game's Empire Policy screen (in-game name in parentheses):
- **Troops**: ImmediatelyRecruitNewTroopsWhenColonize (Y/N), ColonyPopulationThresholdTroopRecruitment (millions).
- **Facilities** (13): per facility (CloningFacility, FortifiedBunker, GiantIonCannon, PlanetaryShield, RegionalCapital, RoboticTroopFoundry, TerraformingFacility, TroopTrainingCenter, ArmoredFactory, SpyAcademy, ScienceAcademy, NavalAcademy, MilitaryAcademy): `ColonyAllowFacilityX` (Y/N) + `ColonyFacilityPopulationThresholdX` (population in millions before the AI builds it; defaults: cloning/bunker/terraform/robotic/training 500, planetary shield 2000, giant ion cannon & regional capital 5000, spy 2000, naval/science 5000, military 2000).
- **Taxation**: ColonyTaxRateIncreaseWhenAtWar (Y/N), ColonyTaxRateSmall/Medium/LargeColony (each 0=Zero,1=Low,2=Normal,3=High; defaults 0/2/3).
- **Military construction**: MilitaryConstructionLevel (0=Low,1=Normal,2=High; default 1) + per-role fleet composition proportions: ConstructionMilitaryCapitalShip/Carrier/Cruiser/Destroyer/Escort/Frigate/TroopTransport (percent of military construction; default 7/8/15/20/18/24/8).
- **Spaceports**: ConstructionSpaceportSmall/Medium/LargeColonyPopulationThreshold (30/500/3000) + ConstructionSpaceportMinimumDistance (700).
- **Diplomacy**: DiplomacySendGiftsUpToAmount (credits, default 20000), DiplomacyTradeSanctionsUseBlockades (Y/N), WarAttacksAllowColonyBombardment (0–3), WarAttacksAllowPlanetDestroying (0–3), WarAttacksHarassEnemies (Y/N), TradeWithOtherEmpires (Y/N), EngageInTourism (Y/N).
- **Fleets**: FleetMilitaryProportionForFleets (70% of military ships in fleets), FleetTypicalSize (15), FleetStrikeForceTypicalSize (4).
- **Intelligence**: per-mission allowances (AllowMissionDeepCover, InciteRevolution, SabotageColony, SabotageConstruction, StealGalaxyMap, StealOperationsMap, StealTechData, StealTerritoryMap, AssassinateCharacter, DestroyBase — all Y/N), IntelligenceCounterIntelligenceProportion (30% of agents to counter-intel), IntelligenceUseEspionageAgainstEmpireWhen / IntelligenceUseSabotageAgainstEmpireWhen (relationship thresholds 0–2).
- **Research & design**: ResearchDesignOverallFocus (0=Balanced,1=Speed/Agility,2=Power,3=Efficiency), ResearchDesignTechFocus1..6 (priority-ordered tech focus list from the 29 tech focus codes), ResearchDesignAutoRetrofit (Y/N), ResearchDesignAutoUpgradeFighters (Y/N), per-role DesignUpgrade<ShipRole> (29 Y/N switches: retrofit each role to new designs when researched), ResearchIndustryFocus (0=None,1=Weapons,2=Energy,3=HighTech).
- **Population policy** (how the empire treats populations of new colonies): NewColonyPopulationPolicyYourRaceFamily and NewColonyPopulationPolicyAllRaces, each 0=Assimilate, 1=DoNotAccept, 2=Resettle, 3=Enslave, 4=Exterminate; ImplementEnslavementWithPenalColonies (Y/N — enslaved populations are relocated to penal colonies).
- **Priorities** (all 0.5–4.0, default 1.0 = Normal; the AI weights its decisions by these): HomeworldDefensePriority, ColonizeContinental/MarshySwamp/Ocean/Desert/Ice/Volcanic/RuinsPriority, ControlRestrictedResourcesPriority, ResearchPriority, TradePriority, AlliancePriority, SubjugationPriority, TourismPriority, ExplorationPriority, WarWillingness, BreakTreatyWillingness, InvasionOverkillFactor, ShipBattleCautionFactor.
- **Other**: ProtectLeaderAtAllCosts (Y/N), PrioritizeBuildWonderId (−1 or facility ID), DefaultMilitaryFleeWhen (1=EnemyMilitarySighted,2=Attacked,3=Shields50,4=Shields20,5=Armor50,6=Never... code list per BuiltObjectFleeWhen), Default engagement stance (BuiltObjectStance per ship class), attack overmatch factor (how much firepower the AI tries to bring).
- **Pirate mission policies**: OfferPirateAttackMissions / OfferDefensivePirateMissions / OfferSmugglingPirateMissions (0=Never,1=Rarely?,2=Often... levels), BidOnPirateAttackMissions / BidOnPirateDefendMissions / AcceptPirateSmugglingMissions (Y/N), PirateSmugglerFreighterLevel / MiningLevel / PassengerLevel (how many private ships a pirate faction fields for smuggling).
- **Capture/disposition of captures**: CaptureTargetConditionShip / CaptureTargetConditionBase (0=always attempt,1=only when strong,2=never...), CaptureEnlistMilitaryShip / CaptureEnlistCivilianShip / CaptureEnlistBase (0–2 levels), CaptureDisassembleMilitaryShip / CaptureDisassembleCivilianShip (1/2 levels), UpgradeEnlistedMilitaryShips (Y/N).

### 10.3 How the AI empire "thinks" (decision architecture)
The AI runs the same simulation objects as the player; its decisions come from the policy values + priorities above, applied by periodic decision passes (per domain). Documented decision structure (from the Empire.*.cs AI code):
- **Evaluation**: the AI maintains per-empire summaries (EmpireSummary: research level, economy/strategic value, military strength, territory, population, reputation, war status) and compares itself against every other empire per EmpireComparisonType (Research, Economy, Military, Expansion, …) to pick diplomatic strategies (Conquer/Befriend/Placate/Defend/Ally/Undermine/Punish) and to gauge when it is winning/losing (drives war entry/exit, treaty offers, and difficulty scaling).
- **Force structure**: the AI projects its desired force structure (ForceStructureProjection per ship role, from MilitaryConstructionLevel + per-role proportions + threat level + priorities) and queues construction at yards to match it (new-build or retrofit per DesignUpgrade policies); fleets are formed at FleetTypicalSize with strike forces at FleetStrikeForceTypicalSize; fleet posture (Attack/Defend) and tactics per threat; nearest-fleet auto-response to attacks on empire assets when defending fleets are insufficient.
- **Research selection** (the actual heuristic structure from the code): the AI walks each industry's tree; it prioritizes projects by (a) policy ResearchIndustryFocus and TechFocus1–6, (b) race traits — e.g. caution ≥100 adds Fortified Bunker + Artillery (caution ≥110 adds Planetary Shield + fleet countermeasures); aggression ≥110 adds Special Forces (≥115 adds Bombard weapons + fleet targeting); intelligence ≥100 adds colony-construction-speed wonder projects; trade-focused (government/race TradeBonus ≥1.15) adds Empire Income wonders; approval-focused adds Colony Happiness wonders (≥1.15 adds more) — and (c) the **lagging-component rule**: for each key component category (shields, main thrust, vectoring, hyperdrive, reactor, armor, damage control) the AI identifies projects whose tech level trails the empire's highest researched level in that industry by more than 2 (maximumAllowableTechLevelGap=2) and adds them, keeping the fleet's components from falling behind.
- **Expansion**: the AI scans the galaxy for candidate planets (colony surface types weighted by Colonize*Priorities, ruins bonus by ColonizeRuinsPriority, restricted resources by ControlRestrictedResourcesPriority), respects its colonization range limit and other empires' influence (policy: allow/disallow building in other empires' systems), sends colony ships (fleet or solo), sets tax rates on new colonies, and builds spaceports per the population thresholds.
- **Colonies**: facility construction per AllowFacility + thresholds; population policy applied on colonization/invasion; troop garrisoning per defense priorities; wonder building if PrioritizeBuildWonderId is set.
- **Economy**: taxes per size-class policy; construction funding; trade is left to the private sector; the AI adjusts fleet/production when cash is negative (colony tax war increase, etc.).
- **Diplomacy & war**: as in Part 8 (strategies, WarWillingness × threat comparison, treaty acceptance from relationship + Loyalty, gift offers up to DiplomacySendGiftsUpToAmount, sanctions/blockades per policy, subjugation offers when SubjugationPriority is high and the target is weak).
- **Intelligence**: agents assigned per policy allowances; target selection = empires below the UseEspionage/UseSabotage relationship thresholds or with high intelligence value; counter-intel keeps IntelligenceCounterIntelligenceProportion of agents on defensive duty.
- **Pirates**: pirate AI additionally runs the pirate economy (5.6), bids/offers pirate missions per playstyle bonuses (Balanced/Mercenary/Raider/Smuggler modify mission success bonuses, research speeds, base-building costs/speeds, maintenance), builds hidden bases/fortresses/criminal networks on controlled planets, raids per policy, and can defect (fearful pirates join the player; super-pirate targets join the Phantom Pirates).
- **Difficulty**: the difficulty setting scales AI attributes (intelligence/aggression/friendliness multipliers, starting research, income bonuses, decision quality); with "scale as player approaches victory" enabled, AI empires improve as the player nears victory; "prevent destroyed pirates being replaced" disables pirate respawn.

### 10.4 Player-vs-AI parity
Every mechanic the player uses (taxes, priorities, policies, automation levels, design editor, missions) exists for AI empires with the policy-file defaults; the difference is only who decides. A fully-automated game (all domains FullyAutomated, popups suppressed) must run to a conclusion unattended.

## PART 12 — USER INTERFACE AND GAME FLOW (complete)

> Research compiled from: decompiled C# source (`DistantWorldsExpanded` — `DistantWorlds/Start*.cs`, `Main*.cs`, `DistantWorlds/Controls/`, `DistantWorlds.Controls/`, `DistantWorlds.Types/`), the in-game Galactopedia help articles (UI_*, Screen_*), and the 11 official tutorial scripts. Exact UI strings are quoted where available.

---

## 1. GAME FLOW

### 1.1 Launch

1. Executable starts, shows a **Splash screen** (`Splash.cs`) with animated progress text while the galaxy is generated and UI resources are loaded. Progress lines seen in code: `"Creating new Galaxy..."`, `"Igniting stellar cores..."`, `"Initiating orbital motion..."`, `"Forming nebulae clouds..."`, `"Recharging reactors..."`, `"Recalibrating hyperdrives..."`, `"Emptying Black Holes..."`, `"Feeding the Giant Kaltors..."`, `"Tidying up asteroid fields..."`, `"Building mining stations..."`, `"Fueling pirate ships..."`, `"Hiding low-quality colonies..."`, then `"Loading the Galaxy..."` / `"Saving the Galaxy..."`.
2. After the splash, the **Main Menu** (the `Start` form) is shown.

### 1.2 Main Menu

The main menu is a full-screen image (`picTitle`) with a hover menu (`HoverMenuGroup menuGroup` + `HoverMenuItem`s) and hint/version labels. Items (exact strings):

- **Start New Game** (`lnkNewGame` / `menuStartNewGame`) — opens the new-game wizard (or playstyle picker).
- **Tutorials** (`lnkTutorial` / `menuTutorials`) — sub-list of 9 links:
  - "Launch Finding Your Way Around Tutorial"
  - "Launch Empire and Colonies Tutorial"
  - "Launch Ships and Bases Tutorial"
  - "Launch Fleets, Troops and Intelligence missions Tutorial"
  - "Launch Expansion and Diplomacy Tutorial"
  - "Launch Research, Ship Design and Construction Tutorial"
  - "Launch Dealing with Pirates Tutorial"
  - "Launch Play As Pirate Tutorial"
  - "Launch PreWarp Empire Tutorial"
- **Quick Start** (`lnkPlayScenario` / `menuLoadGame`-adjacent `btnQuickStart`) — preconfigured scenarios (see 1.4).
- **Load Game** (`lnkLoadGame` / `menuLoadGame`) — file dialog: "Load Distant Worlds game" / "Distant Worlds saved game files".
- **Galactopedia** (`lnkGalactopedia` / `menuGalactopedia`) — the in-game encyclopedia; hint "Browse the built-in galactic encyclopedia"; checkbox "Show this screen at startup".
- **Options** (`lnkOptions` / `menuOptions`) — the Game Options screen (Display Settings, Sound, Auto Saves, Mouse Scroll-Wheel Behaviour, Automation, Empire Settings, Messages, Change Theme).
- **Check For Updates** (`lnkCheckForUpdates`) — "Visit CODEFORCE to check for updates to Distant Worlds".
- **Credits** (`lnkAbout` / `menuCredits`) — "About Distant Worlds" / scrolling credits panel.
- **Change Theme** (`lnkThemes` / `menuChangeTheme`) — themes screen.
- **Exit** (`lnkExit` / `menuExit`) — exit to desktop.
- Bottom labels: **Version**, **Copyright**, **Active Theme**, **Menu Hints**.

### 1.3 New Game Wizard (complete option inventory)

The wizard (`pnlNewGame`, a `ScreenPanel` with `HeaderTitle` "Start a New Game: …") is a 7-step flow with Previous/Next buttons whose labels are, exactly:

| Step | Panel | Prev button text | Next button text |
|---|---|---|---|
| 1 | Playstyle | — | (scenario buttons) |
| 2 | The Galaxy | "<<" Previous: Playstyle | "Next: Colonization && Territory >>" |
| 3 | Colonization & Territory | "<< Previous: The Galaxy" | "Next: Your Race >>" |
| 4 | Your Race | "<< Previous: Colonization && Territory" | "Next: Your Empire >>" |
| 5 | Your Empire | "<< Previous: Your Race" | "Next: Other Empires >>" |
| 6 | Other Empires | "<< Previous: Your Empire" | "Next: Victory Conditions >>" |
| 7 | Victory Conditions | "<< Previous: Other Empires" | "Start the Game!" |

Context-sensitive help messages are shown "in yellow at the top of the screen" as the user hovers each control (each slider/checkbox has a `LabelText` + `LinkText` help link, e.g. "About Research...", "About Space Creatures...", "About Pirates...", "About Alien Life...").

#### Step 1 — Playstyle

Top of screen: big **"Introductory Game >>"** button (`btnStartNewGameIntroductory`, in a rounded border panel). Then six prebuilt-era buttons (exact text):

- "The Ancient Galaxy >>" — "a game using a custom theme and a predefined galaxy map… takes you back to the distant past"
- "Pirate Faction in the Age of Shadows >>" — "marauding pirate faction during the Age of Shadows when civilization has crumbled and pirates rule the galaxy"
- "Standard Empire in the Age of Shadows >>" — "primitive standard empire in the Age of Shadows without hyperdrive technology… slowly spread throughout your home star system prior to rediscovering faster-than-light travel"
- "Classic Era >>" — "standard empire with a single colony… original Distant Worlds storyline, but without any story elements from Return of the Shakturi or Legends"
- "Return of the Shakturi >>" — "storyline elements from both the original Distant Worlds and Return of the Shakturi, but does not contain the Legends storyline"
- "Legends >>" — "all of the Distant Worlds storyline: original, Return of the Shakturi and Legends"

Two custom-game buttons (340×100): **"Play a Custom Game as a Standard Empire >>"** and **"Play a Custom Game as a Pirate Faction >>"** — these launch the full 7-step wizard below. Also: **"Quick Starts >>"** and **"Play selected Galaxy and Faction >>"** (Galaxy Maps screen: pick a prebuilt galaxy from "Playable Galaxies" + a faction from "Playable Factions", with an "Explanation" panel; button "No thanks, I want to set up a Custom Game >>"). A timeline image (`picStartNewGameYourEmpireTypeTimeline`) shows the era order.

#### Step 2 — The Galaxy

Left panel "Galaxy Shape" radio buttons (each sets the shape title "SHAPE Galaxy", a 190×190 preview picture, description text, and the valid starting-location list):

- **Elliptical** — "Elliptical galaxies have a classic spiral shape"
- **Spiral** — "Spiral galaxies have a distinctive shape"
- **Ring** — "Ring galaxies contain most of their stars"
- **Irregular** — "Irregular galaxies have no fixed shape or structure"
- **Even Clusters** / **Varied Clusters** — "Cluster galaxies have groups of stars clustered together"

Sliders (`LabelledTrackBar`s; each label + value shown under the bar):

| Slider | Label | Values (left→right) |
|---|---|---|
| `tbarStartNewGameTheGalaxyStarDensity` | "Star\nAmount" | Dwarf (100 stars), Tiny (250), Small (400), Standard (700), Large (1000), Huge (1400) |
| `tbarStartNewGameTheGalaxyDimensions` | "Physical\nSize" | Tiny (4x4 sectors), Small (6x6), Medium (8x8), Large (10x10), Huge (15x15) |
| `tbarStartNewGameTheGalaxyExpansion` | "Expansion" | PreWarp, Starting, Young, Expanding, Mature, Old — "Determines how old and developed the entire galaxy is" (sets auto-generated empire sizes) |
| `tbarStartNewGameTheGalaxyAggression` | "Aggression" | Peaceful, Normal, Restless, Unstable, Chaos — "Determines how aggressive computer players are in the game" |
| `tbarStartNewGameTheGalaxyDifficulty` | "Difficulty" | Easy, Normal, Hard, Very Hard, Extreme — "Determines difficulty and aggression of gameplay" |
| `tbarStartNewGameTheGalaxyResearchSpeed` | "Research \nCosts" | Very Expensive, Expensive, Normal, Cheap, Very Cheap — "Determines how fast research occurs in the galaxy" |
| `tbarStartNewGameTheGalaxySpaceCreatures` | "Space Creatures" | None, Few, Normal, Many — "Determines how many space creatures are present in the galaxy" |
| `tbarStartNewGameTheGalaxyPirates` | "Pirates" | None, Very Few, Few, Normal, Many, Very Many — "Determines how many pirates are present in the galaxy" |
| `tbarStartNewGameTheGalaxyPirateStrength` | "Pirate Strength" | Very Weak, Weak, Normal, Strong — "Determines how strong pirates are and how fast they grow" |

Other options:

- `numStartNewGameTheGalaxyResearchBaseTech` — custom research base cost, numeric, 1–999, suffix "K" ("K" label).
- `cmbStartNewGameTheGalaxyPirateProximity` — "Pirate Proximity" to empires: **Nearby / Average / Distant**.
- `chkStartNewGameTheGalaxyDifficultyScaling` — "Difficulty scales as player nears victory".
- `chkStartNewGameTheGalaxyPiratesRespawn` — "Destroyed Pirates do not respawn".
- `chkStartNewGameEnableGiantKaltors` — "Allow Giant Kaltors at game start".
- `chkStartNewGameEnableTechTrading` — "Allow Tech Trading".

Right panel: **"OR Load an existing Galaxy as a map"** — filepath box ("(No Galaxy Map specified)"), buttons "Browse for Maps..." / "Clear Map", and regenerate checkboxes: "Regenerate Resources", "Regenerate Scenery and Research bonuses", "Regenerate Space Creatures", "Regenerate Ruins", "Regenerate Special Locations".

#### Step 3 — Colonization and Territory

- `tbarStartNewGameTheGalaxyColonyPrevalence` — "Colony Prevalence": **Scarce, Occasional, Normal, Plentiful, Abundant** — "influences the number of colonizable planets and moons in the galaxy".
- `tbarStartNewGameTheGalaxyAlienLife` — "Independent Alien Life": **Rare, Scattered, Normal, Plentiful, Teeming** — "determines how many independent populations of aliens exist in the galaxy and how large they are".
- `sldStartNewGameColonizationTerritoryColonyInfluenceRange` (ColorSlider) — "Colony Influence Range", default **100%**, with a "Suggestion" text box — "controls how far your empire's territorial influence projects out from your colonies".
- `chkStartNewGameColonizationTerritoryEnforceColonizationRange` — group "Enforce Colonization Range Limits" + `sldStartNewGameColonizationTerritoryColonizationRange` slider, default **4000K** — "you cannot establish new colonies further than the indicated range from any of your existing colonies… however you may still take over other empire's colonies outside this range".
- `chkOptionsAllowSameSystemAsOtherEmpires` — "Allow colonization and mining stations in other empires systems".

#### Step 4 — Your Race

- `cmbStartNewGameYourEmpireRace` (`RaceDropDown`) — dropdown of all alien races, with "(Random)" / "Race randomly selected" null item.
- `picStartNewGameYourEmpireRace` — large race portrait; `pnlStartNewGameYourEmpireRaceAttributes` (`RaceSummaryPanel`) — race characteristics (racial characteristic INTENSITY/QUALITY, e.g. "Reckless"/"Cautious", "Unreliable"/"Dependable", plus racial bonuses); `lnkStartNewGameYourEmpireRace` — "Read more about this race...".

#### Step 5 — Your Empire

- `txtYourEmpireName` — "Empire Name" (hint: "Type the name of your empire here").
- `cmbPrimaryColor` / `cmbSecondaryColor` (`ColorDropDown`) — "Main Color" / "Secondary Color"; `cmbFlagShape` (`FlagShapeDropDown`) — flag shape.
- `cmbYourEmpireStartLocation` — "Galaxy Starting Location" (list depends on galaxy shape):
  - Elliptical: (Random), Deep Core, Outer Core, Inner Rim, Outer Rim
  - Spiral: (Random), Deep Core, Outer Core, Far Regions
  - Ring: (Random), Core, Void, Rim
  - Irregular: (Random), Center, Edge
  - (preview picture `picStartNewGameYourEmpireGalaxyLocation`)
- `tbarStartNewGameYourEmpireHomeSystem` — "Home System": **Harsh, Trying, Normal, Agreeable, Excellent** — "The favorability of your home system. In more favorable systems your starting colony will have higher quality and size… additional colonizable planets beyond your starting colony".
- `tbarStartNewGameYourEmpireSize` — "Size": **Random, Starting, Young, Expanding, Mature, Old**.
- `tbarStartNewGameYourEmpireTechLevel` — "Tech Level": **PreWarp, Normal, Level 1 … Level 7** (9 stops) — "Determines how advanced your research is".
- `tbarStartNewGameYourEmpireCorruption` — "Corruption": **Low, Normal, High, Very High** — "the level of corruption and income loss across your empire… only affects your empire" (others are always Normal).
- `cmbStartNewGameYourEmpireGovernment` (`GovernmentStyleDropDown`) — "Your Government", with "(Random)" null item; `lblStartNewGameYourEmpireGovernmentAttributes` — "Government Attributes" (bonuses/handicaps of the selected government: Approval, Population Growth, War Weariness, Research Speed, Corruption, Maintenance Costs, Troop Recruitment, Trade Bonus); `lnkStartNewGameYourEmpireGovernment` — "Read more about this Government type...".
- **Pirate factions only:** `cmbVictoryPiratePlayStyle` — "Pirate Playstyle": **Balanced, Pirate (Raider), Mercenary, Smuggler** (code enum `PiratePlayStyle: Balanced, Pirate, Mercenary, Smuggler`), with description panel + image:
  - Balanced: "no significant advantages or disadvantages… play as any of the other playstyles, but not quite as well"
  - Mercenary: "Focused on attack and defense missions. Good at capturing enemy ships and conducting raids. Can maintain a larger military fleet. Improved Weapons and Energy research, slow High Tech research."
  - Raider (Pirate): "The most 'nomadic' of the pirate playstyles. Focused on raids and ship and base capture… poor smugglers."
  - Smuggler: "The most peaceful of the pirate playstyles. Focused on smuggling and trade… bonuses to Energy and High Tech research. Fastest playstyle for taking over planets completely."
  - Pirate playstyles also set the pirate victory conditions ("Pirate factions compete against other pirate factions to achieve victory, NOT against standard empires").

#### Step 6 — Other Empires

- `chkOtherEmpiresAutogenerate` — "Auto-Generate Starting Empires" + `numAutogenerateEmpiresAmount` with labels "Generate **N** starting empires" (N = number of AI empires).
- OR ("OR specify the starting empires below") `ctlStartingEmpiresList` (`StartingEmpiresListView`) grid with columns **Name, Race, Government, Size, TechLevel, HomeSystem, Proximity, Remove**, plus **"Add New Empire"** button (`btnAddNewEmpire`) to hand-pick each competitor's race/government/size/tech/start-proximity.
- `chkGalaxyNewEmpiresDuringGame` — "Allow independent alien colonies to start new empires during the game" (help text: "New Empires appear during game").

#### Step 7 — Victory Conditions

Group panel "Victory Conditions Explanation" (left box: **"Leave all Victory Conditions unchecked to play in Sandbox mode (open play)"**):

- `chkVictoryTerritory` — "TERRITORY control XX%" of colonies in the galaxy (`numVictoryTerritoryPercent`).
- `chkVictoryPopulation` — "POPULATION control XX%" of galaxy population (`numVictoryPopulationPercent`).
- `chkVictoryEconomy` — "ECONOMY: private economy generates XX% of galaxy total" (`numVictoryEconomyPercent`).
- `chkVictoryEnableRaceSpecificConditions` — "Enable Race-specific Victory Conditions" (each race's unique victory).
- `cmbVictoryThresholdPercentage` + `lblVictoryThresholdPercentage` ("Victory Threshold Percent"): **75% / 80% / 85% / 90% / 95% / 100%** — "the proportion of the above victory conditions that must be met for victory".
- `chkVictoryTimeStart` + `numVictoryTimeStartYears` — "Victory Conditions apply after X years" (prevents early game-end).
- `chkVictoryTimeLimit` + `numVictoryTimeLimitYears` — "Time Limit: game finishes after X years" — "the winner is determined by the empire with the highest total strategic value of all its colonies".
- Story checkboxes: `chkStoryDistantWorlds` "Enable original Distant Worlds story events"; `chkStoryReturnOfTheShakturi` "Enable Return Of The Shakturi story events and victory conditions"; `chkStoryShadows` "Enable Shadows story events"; `chkVictoryEnableDisasterEvents` "Enable Disasters and other events" (Legends-era events); `chkVictoryEnableRaceSpecificEvents` "Enable race-specific events".
- **"Start the Game!"** (`btnStartNewGameStart`) → galaxy generation → first in-game screen.

#### Quick Start screen (`pnlQuickStart`)

Left: radio list of 12 preconfigured setups (exact names): **Fast, Conflict!, Epic, Expanding from the Core, Expanding Settlements, Fully Developed - Small, Fully Developed - Standard, Fully Developed - Large, Galactic Republic - Supreme Ruler, Galactic Republic - Wild Frontiers, Ring Race, Sovereign Territories - Minor Faction, Sovereign Territories - Regional Ruler** (each has a "Title" + "Detail" description, e.g. "QuickStart Title Conflict"). Bottom: `cmbQuickStartRace` ("Race" — pick a race or leave random, "About this Race..."), `chkQuickStartDistantWorldsStoryEvents` ("Distant Worlds original storyline"), `chkQuickStartReturnOfTheShakturiStoryEvents` ("Return Of The Shakturi storyline"). **"Start Game"** button generates the galaxy directly.

#### Jump Start (scenario shortcut)

Used by the six era buttons: pick Your Race (`cmbJumpStartYourEmpireRace`), Your Government (`cmbJumpStartYourEmpireGovernment`, with attributes + "Read more…"), galaxy shape (6 radios: Elliptical/Spiral/Ring/Irregular/Even Clusters/Varied Clusters), sliders: `tbarJumpStartTheGalaxyStarDensity` (Dwarf…Huge), `tbarJumpStartTheGalaxyDimensions` (Tiny…Huge), `tbarJumpStartTheGalaxyDifficulty` (Easy…Extreme), `chkJumpStartTheGalaxyDifficultyScaling`, and (pirates) `cmbJumpStartVictoryPiratePlayStyle`. Button: **"Start the Game!"**.

### 1.4 First in-game screen

- After loading, the game optionally shows the **Introduction screen** (`pnlIntroduction` BorderPanel with `btnIntroductionStart`) — sections "Introduction", "What You Should Do" ("Game WhatToDo Normal Classic"/"Pirate Classic"/"Normal Shadows"/"Pirate Shadows"), "Starting the Game" (`btnIntroductionStart` "Start Playing").
- Then the **Main screen** (see §2): Main View map, top status bar, scrolling message list, Empire Navigation Tool, selection panel, mini-map, diplomatic message stack.
- All ships start **fully automated** ("Note that after being built, all ships start off fully automated"; "Newly built ships are automated" is a game option), so the early game runs hands-off until the player takes control (tutorial: "When you first start Distant Worlds many tasks are automated for you. The automation of these tasks can be progressively turned off").

### 1.5 In-game flow (loop)

1. Player explores (exploration ships, automated or manual "Explore" missions) → discoveries create message pings (dashed blue expanding circles) for newly revealed locations.
2. Colonize (colony ships; "Colonize X", "Build and Send Colony Ship"), build mining stations (construction ships: "Queue nearest Construction Ship to build Mining Station here"), build space ports at colonies.
3. Grow economy: colony taxes (auto or manual per-colony tax rates), space port transaction fees, private ship purchases, trade bonuses.
4. Research (three tech trees: Weapons/Energy/HighTech; crash research 3× faster for credits) → new components/designs/facilities/capabilities.
5. Build ships/bases three ways: right-click "Build" submenu on a colony/space port; **Construction Yards** screen (F10, "Purchase" button, "Available Funds" flashes red if unaffordable); **Build Order** screen (F9, per-ship-type levels + advisor suggestions, "Purchase" button).
6. Design ships/bases in **Designs** (F8) / **Design Detail** (components, role, battle/invasion/flee tactics, warnings: red = rules, yellow = recommendations).
7. Expand with **Expansion Planner** (F3: resource supply/demand table + target lists + send colony/construction ships).
8. Diplomacy (F5: relations, treaties, gifts, warnings, trade proposals: map/tech swaps), or war (attack/bombard/capture/blockade missions; fleets with Attack/Defend postures).
9. Intelligence agents (F4: espionage missions with target empire, mission type, optional specific target, time allowed, success-probability estimate), counter-intelligence.
10. Troops: recruit/garrison/disband at colonies (F2 Troops tab; right-click colony → "Recruit Troops"), load onto troop transports, invade enemy colonies (ground combat).
11. Pirates: protection agreements, mercenary smuggling/attack/defend missions (action buttons "Assign Mercenary Smuggling/Attack/Defense Mission"), raids (Alt+right-click), colony control, pirate bases/fortresses, Criminal Network.
12. Save/Load/Options/Editor via the **Game Menu** (top-left button or Escape): "Resume Playing", "Save Game", "Save Game As", "Load Game", "Options", "Enter Game Editor" (password-protected: "Enter Editor Password"), "Exit to Main Menu", "Exit Distant Worlds". Confirmation prompts: "Are you sure that you wish to exit to the main menu?" / "…exit this game?" ("current game will be lost unless you first save it").
13. Victory: any enabled victory condition (Territory/Population/Economy %/race-specific) reached at or above the **Victory Threshold Percent**, or time limit expiry (winner = highest total strategic value), or story endings (e.g. "You have Defeated the Shakturi!"). Defeat = losing all colonies ("When you lose all of your colonies, you lose the game"; "Your empire has been completely wiped out!").

### 1.6 Game end

- `Galaxy.GameEnd` → `Main.DoGameEnd()`: sets `IsFinished`, stores `VictorEmpire`, plays the victory/defeat theme, then shows the **game-end panel** (`pnlGameEnd`, a full `BorderPanel` over the main view) with a title + flavor text and two buttons:
  - `btnGameEndContinue` — "Continue Playing..." (sandbox mode: keep playing after the end).
  - `btnGameEndExit` — "Exit to Main Menu".
- Flavor strings in code: "WINNER!", "Victory", "Defeat", "You won!", "You have failed!", "Your failure is complete!", "Your enemies tremble before your mighty fleets!", "You're the big chief now", "Perhaps galactic conquest just isn't your thing...", "Winner is the empire with the greatest strategic value at this time" (time-limit/sandbox), "SANDBOX MODE", "To win - Start Date", "You are ruler of …", "Congratulations to our new galactic ruler!", "Welcome to our new Galactic Emperor!", plus per-victory-type intro labels ("Game Intro Victory" / "...Territory" / "...Population" / "...Economy" / "...Race" / "...Time Limit" / "...Pirate") and enemy taunts ("You lost - ha ha!", "How could you lose when you had such a big headstart?", "You move slower than a blind space slug!", …).
- Storyline endings: "You have Defeated the Shakturi!" / "The Shakturi have defeated the Freedom Alliance!" / "The Shakturi have Returned for Revenge!", with extra story-event dialogs (e.g. "Yes, we will unite to fight the Shakturi!", "Yes, our dire situation calls for the use of this superweapon!").

---

## 2. MAIN MAP INTERFACE

### 2.1 The Main View (`mainView`, a `MainView` custom-drawn `Panel`)

The entire map is one custom control rendered with GDI+ and an XNA/SlimDX sprite path (`DrawMainViewXna`, `DrawMainView`), not child controls. It holds the current `Galaxy`, `SystemInfo`, `Habitat`, `BuiltObject`, `ShipGroup`, `Creature`, `LightningGenerator`, `NebulaCloudGenerator`, `SectorCloudGenerator`, `StarFieldItemList` (4 layers) and all preprocessed image caches (planets with rings/shadows, built-object sprites, fighter sprites, nebula clouds, backdrop).

**Zoom model:** a continuous zoom factor from 100% (planet/ship level) up to full galaxy. Zoom presets (buttons `btnZoomIn`, `btnZoomOut` and keys):
- **Home** → "Zoom to 100%"
- **Insert** → "Zoom to System"
- **Delete** → "Zoom to Sector"
- **End** → "Zoom to Galaxy"
- **Backspace** → "Zoom to the selected item"
- `btnZoomSelection` ("Zoom to selected item"), `btnZoomSystem` ("Zoom to System"), `btnZoomRegion` ("Zoom to Sector"), plus `btnZoomColony` (zoom to a colony — used with the Expansion Planner / colony selection) and `btnLockView` ("Lock/unlock view on selected item", tooltip "View locked on SELECTED").

**What is drawn at each level:**

1. **System view (100% and zoomed in)** — top-down 2D: the central star (with animated effects: lightning for certain stars), planets/moons/asteroids/gas clouds on visible orbital rings (planetary rings via `PlanetaryRingsGenerator`), nebula clouds (`NebulaCloudGenerator`, toggleable "Display nebulae clouds in systems" + "System Nebulae Detail" Low/Medium/High), space creatures, fighters, explosions, weapons fire (beams/torpedoes/area weapons/tractor beams via `StellarObject`+`Weapon` draw paths), and ships/bases as sprite images.
   - Colonies show a **colored name badge**: name at top; **gold star** to the left of the name if it is the **empire capital**; empire flag at top-right of the badge; bottom-left: **dominant race** + a **5×5 population/development graph** (columns = population: 0–20M, 20M–100M, 100M–500M, 500M–2.5B, >2.5B; rows = development: 0–20%, 20–40%, 40–60%, 60–80%, 80–100%); bottom-right: **resource pictures** for the world's resources; the owning empire is shown by the **color of the surrounding circle and badge**.
   - Ships/bases: sprite + **empire flag at top-left corner** (no flag if independent); **shields shown as a solid blue line above the ship** (damage portion in red). Empire flags are hidden at system zoom to reduce clutter — "hold down either of the shift keys" to show them all, or they appear when the mouse is close.
   - A **dashed gray range circle** shows the selected ship's movement range; **blue circular icons** next to system names mark refuelling points at galaxy zoom.
2. **Sector view** — the galaxy is a grid of sectors (the Galaxy Map article says "The galaxy is divided into a 10×10 grid of sectors"; sector boundary lines appear light blue). Each **system** is drawn as a node:
   - **Systems you control**: colored background (your empire color); within controlled territory only **space ports and fleets** are drawn as icons (other friendly ships hidden to cut clutter).
   - **Colonized systems** of any empire: circled in the **empire's color**; "The size of the circle indicates the system's relative importance - larger systems are more valuable".
   - **Independent systems** (alien colonies of no empire): circled with a **solid grey line** — "good targets… the aliens provide a critical boost to the population".
   - **Systems with potential colonies**: **dashed grey circle**.
   - **Empire territory** (uncolonized systems within colony influence): **colored background** of the owning empire.
   - **Unexplored systems**: no name displayed; **explored systems**: name displayed next to them.
   - Ships/bases are **circular icons**; icon **color**: **blue = your empire**, **yellow = neutral empires**, **red = enemy empires or pirates**.
   - **Fleets**: **inverted triangle icon with the ship count inside**; selecting a fleet at sector level = click the icon; double-clicking any member ship at system level selects the whole fleet.
3. **Galaxy view** — whole galaxy: stars as colored points (yellow main sequence, red giant/supergiant, white dwarf/neutron white, light-blue supernovae, light-pink gas clouds), territory-tinted system regions, sector grid, and the same blue/yellow/red icons for ships/bases (which icon classes appear is controlled by Advanced Display Settings, see §3.13).

**Map overlays** (toggled by the 8 top buttons `btnMapOverlay1..8` + `btnMapCivilianFade`, backed by `GameOptions` booleans; when on they add layer info in the main view at sector/galaxy zoom):
- "Fade Civilian ships and bases" (`MapOverlayFadeCivilianShip`)
- "Show Fleet Postures" (`MapOverlayFleetPostures` — defend area = blue circle, attack route = dotted red line)
- "Show Travel Vectors State" / "Show Travel Vectors Private"
- "Show Potential Colonies"
- "Show Potential Resort Locations" (Scenic Locations)
- "Show Research Locations"
- "Show Long Range Scanners"
- "Show Empire Territory" (Empire Influence)

**Mini-map** (bottom-right, `pnlSystemMap` BorderPanel containing `picSystem`, a `SystemView` control): shows the surrounding area — the current system (planets/moons) when zoomed in, or sector/galaxy when zoomed out; the currently visible main-view area is a **light blue rectangle** in the middle; **click anywhere on the map to move the main view** ("Map: click to move view to a new location"); it auto-zooms with the main view. Alongside/above it: the zoom preset buttons and the "Map Key" button (`btnGalaxyMapKey` → `pnlGalaxyMapKey` with a `MapKey` legend: the full color legend, title from `lblGalaxyMapKeyTitle`, close button).

**Colors/legend (mini-map + map key):**
- System zoom: Green = Continental; Yellow = Marshy Swamp; Light Brown = Sandy Desert; Dark Blue = Ocean; Light Blue = Ice Glacial; Orange = Volcanic; Grey = Barren Rock/asteroids; Red = Gas Giant (+ Red Giant & Super Giant stars); Pink = Frozen Gas Giant.
- Sector/galaxy zoom: Yellow = Main Sequence stars; Red = Red/Super Giants; White = White Dwarfs & Neutrons; Light Blue = Supernovae; Light pink = Gas Clouds.

### 2.2 Navigation (how you move the camera)

- Move the mouse pointer to the **edge of the screen** → view pans that direction (scroll speed set in Display Settings).
- **Right-button drag** → pan.
- **Arrow keys** → pan.
- **Mouse wheel** → zoom in/out (behavior selectable: "No movement" / "Move to selected item" / "Move to mouse cursor location").
- **Ctrl + left-click** → center on that location and zoom in to 100% ("You can zoom in to any location by holding down the 'Ctrl' key while clicking").
- Page Up/Page Down → zoom out/in; +/− → game speed.
- Clicking the **mini-map** or double-clicking items in Empire Navigation lists moves the view.

### 2.3 Selection & hover

- **Left-click** selects the item under the cursor → the **Selection Panel** (bottom-left, `pnlInfoPanel` `InfoPanel` + `pnlDetailInfo` `HoverDetail` expandable detail) shows its full readout (see §3.10). If several ships/bases overlap at the clicked point, a **popup list** appears to pick one ("If more than one ship or base is at the same location where you clicked then a popup menu will appear listing all the ships and bases at the location").
- **Hover** over any item → a **hover summary** appears at the **bottom-middle of the screen** (rendered by `HoverPanel`, `mainView.HoverMessageLocation`) and a `Hotspot` (rectangle + related object + hover message) drives the hover detection for the mini-map, galaxy map and detail panels.
- **Right-click**:
  - If a ship/base is selected → the **ship action menu** (`actionMenu`, a `ContextMenuStrip`) pops up with mission options (see §5.2).
  - If no item is selected → **centers the view on the mouse pointer position** (help text: "or if no item is selected it centers the view on the mouse pointer position").
  - **Ctrl + right-click** forces the full mission popup even when a single default mission would apply ("You can also force a pop-up menu to appear with all available missions for the selected ship by holding down the Ctrl key and right-clicking"; in-game hint "Ctrl-Right-click for more missions").
  - Right-click on a **target while a ship is selected** assigns the **default mission** for what the mouse hovers over: e.g. military ship hovering an enemy target → "Attack"; hovering nothing → "Move". The default mission is often signalled by a **cursor change**.

### 2.4 Right-click context menus (exact items from source strings)

**Ship / fleet action menu** (`actionMenu`), context-dependent — items and submenus actually emitted by the code:

- **Move to X / "Move here"** — with subitems: "At X", "At nearest colony", "At your nearest Space Port", "Move to mouse cursor location", "Move to selected item".
- **Attack X** / **Prepare and Attack X** (WaitAndAttack).
- **Bombard X** / **Prepare and Bombard X** (only if the group has bombard power) — Shift-click on a colony gives Bombard directly.
- **Capture X** / **Raid X** (only if boarding-assault strength > 0; Raid = pirates only, Alt-click) — Shift-click on a ship/base gives Capture.
- **Blockade X** (only vs. empires under trade sanctions).
- **Escort X**, **Patrol X** (hover your own colony/base), **Explore** ("Explore nearest system", "Nearest unexplored system").
- **Colonize X** ("Build new Colony Ship and Colonize X", "Build and Send Colony Ship" — "SHIPNAME colonizing PLANETNAME" status line), "Recruit Troops at X", "Load Troops at X" / "Unload Troops at X" (subitems "At nearest colony with available troops", "At X"), "Deploy at X" / "Undeploy".
- **Refuel** ("At nearest refuelling point", "Refuel at X", "Refuel all ships"), **Repair** ("Repair and Refuel damaged ships" with subitems "At X", "At nearest ship yard", "At your nearest Space Port"; "Repair damaged ships").
- **Build** ("Build here", "Build at X", "Queue nearest Construction Ship to build Mining Station here", "Queue construction ship to build a DESIGN here", "Build new ship or base", "Build new civilian ship", "Build new bomber", "Build new fighter").
- **Retrofit** ("Retrofit to latest design(s)", "Retrofit Selected Items to New Design", "At X"/"At nearest ship yard").
- **Retire** ("Retire selected ships?" confirm, "Retiring ships permanently removes them from the game"), **Scrap** ("Scrap Ship immediately" / "Scrap Base immediately" — "Scrapping ships and bases permanently and immediately removes them from the game"; "The purchase cost will not be refunded if you scrap this ship"), **Escape** ("Escape from attackers").
- Fleet items: **Join Fleet** (submenu of all fleets + "(New Fleet)" / "New Fleet" / "Nth Fleet"), **Leave Fleet** ("Leave FLEETNAME"), **Make lead ship for FLEETNAME**, **Join nearest Fleet**, **Disband Fleet**, **Set Home Base** ("Set Home Base X", "valid home base is friendly refueling point"), **Set Attack Target** ("Set Fleet Target X", "valid target is colony or base of another empire"), **Set Posture**, **Set Range**, **Refuel and Repair Fleet**, "Retrofit fleet to latest designs".
- "Return to base ({0})", **"Clear All Queued Missions"**, **"Queue Next Mission"**, **"Automate"** / **"Turn off automation"** / "Automate all ships" ("Would you like to turn off automation" prompt), "Retire all ships".
- Mercenary (player empires): **"Assign Mercenary Attack Mission"** / **"Assign Mercenary Defense Mission"** / **"Assign Mercenary Smuggling Mission"** and their "Cancel Mercenary … Mission" counterparts.
- "Stop" (S key: "Stops the selected ship, cancelling the current mission").

**Selection/other-object menu** (`selectionMenu`) — right-click on a **colony/planet/base/system/creature/ruin** (with or without a ship selected) offers type-appropriate actions, including:
- Colony: "Recruit Troops", "Change Colony Tax" / "Change Colony Tax Rates", "Build new planetary facility", "Build planetary facilities", "Build Wonders", "Build new Wonder", "Deploy PLAGUE at this colony" (event action), "Set as Home Colony", "Select new home colony", "Go to Colony", "Show On Galaxy Map", "Show Expansion Planner", "Show Ruin Details", "Recruit Agent"/"Disband Agent", "Transfer Character to Location", "Build new colony ship…", pirate-control related ("Control"), "Have Revolution and switch to GOVERNMENT".
- Base/yard: "Build at X", "Build new ship or base", "View Docking Bays", "View Fleet", "Investigate Base", "Go to Base", "Set as Home Base", "Queue construction ship to build…/Repair X", "Recruit Troops" (at bases), "Build new civilian ship", "Build new planetary facility".
- Target objects: "Investigate Ship" / "Investigate Base" / **"Investigate Ruins"** (discovery behavior per Your Empire Settings: "Ask what to do" / "Investigate - show all results" / "Investigate - report discoveries" / "Investigate - report major discoveries" / "Investigate - do not show results"; abandoned ships/bases: "Leave the Ship alone" / "Leave the Base alone" / "Leave the Ruins alone" + investigate variants), "Destroy X".
- "Go to Location", "Go to Event Location", "Go to Event Target", "Go to Facility", "Go to Fleet", "Go to Research Station", "Go to Resource Location", "Go to Resource Target", "Go to Troop", "Go to selected item", "Go to X system".
- "Transfer" (troops to a listed transport), "Garrison selected troops" / "Ungarrison selected troops", "Disband Selected Troops", "Load Character image", "Disband Selected Character".
- "Buy information" / "Swap maps or tech" / "Swap Galaxy maps (all exploration)" / "Swap Territory maps (empire systems)" (intelligence/selling info).

**Other-empire right-clicks** (hovering their assets) yield the military missions against them (Attack/Bombard/Capture/Raid/Blockade/Escort/Investigate) per the default-mission logic; right-clicking an **enemy fleet target in the ENT** assigns/ cancels attacks (§3.5). Right-click on **empty map space** with a ship selected = Move; with nothing selected = recenter view.

### 2.5 Top status bar & toolbars (exact controls)

Top labels: `lblSystemName` (system being viewed), `lblStarDate` (game date), `lblStateMoney` (state credits + cashflow + "This Year's Bonus Income"), `lblPrivateMoney` (private economy), `lblGodData` (hidden debug label), plus `DrawUPS` (updates-per-second, dev build).

Top-left column of `GlassButton`s: `btnGameMenu` ("Game Menu" — "Show Game Menu: load & save, options, exit"), `btnHelp` ("Open Galactopedia Help screen"), `btnPlayPause` ("Pause the game"/"Resume the game", Spacebar), `btnGameSpeedIncrease` ("Increase game speed", +), `btnGameSpeedDecrease` ("Decrease game speed", −).

Top toolbar (below the scrolling message list) — screen openers (`tbtn*`): **tbtnEmpires** (Empire Summary, F6), **tbtnColonies** (F2), **tbtnBuiltObjects** (Ships and Bases, F11), **tbtnShipGroups** (Fleets, F12), **tbtnConstructionYards** (F10), **tbtnDesigns** (F8), **tbtnResearch** (`ResearchButton`, F7), **tbtnTroops** (Troops), **tbtnIntelligenceAgents** (F4), **tbtnGalaxyMap** (G), plus `btnEmpireSummary` (F6 "Open Your Empire Summary screen"), `btnEmpirePolicy` (Empire Policy), `btnEmpireGraphs` (Empire Comparison/Victory, V), `btnExpansionPlanner` (F3), `btnBuildOrder` (F9), `btnHistoryMessages` (Message History, H), `btnGalacticHistory`, `btnGameEditor` ("Enter Game Editor" / "Switch to Game Editor", password-gated), `btnHelp`, `btnHistoryMessages`, `btnLockView`, `btnMainViewDisplayToggle` ("Toggle display detail level" — D key), `btnMapCivilianFade` ("Fade civilian ships and bases"), `btnMapOverlay1..8` (the 8 overlay toggles), zoom buttons (`btnZoomIn/Out/Region/Selection/System/Colony`), `btnSelectNearestMilitary` ("Select nearest available military ship", Z).

Cycle buttons (left column, above the selection panel; each has a paired "previous" button; hotkeys with Shift = backwards, Ctrl = cycle and move view):
- `btnCycleColonies` / Back — "Next Colony" (C)
- `btnCycleBases` / Back — "Next Space Port" (P)
- `btnCycleMilitary` / Back — "Next Military ship" (M)
- `btnCycleConstruction` / Back — "Next Construction ship" (Y)
- `btnCycleOther` / Back — (other bases: research/monitoring/resort/defensive)
- `btnCycleShipGroups` / Back — "Next Fleet" (F)
- `btnCycleIdleShips` / Back — "Next Idle ship" (I)
- `btnCycleColonies`+`btnCycleOther` share the "Next Exploration or Colony ship" (X) group,
- `btnCycleShipStance` — "Change engagement stance" (comma key),
- `btnSelectionBack` / `btnSelectionForward` — "Previous selected item" / "Next selected item" (B / N),
- `btnSelectionPanelSize` — "Shrink Selection Panel"/"Enlarge Selection Panel",
- `btnLockView` — "Lock/unlock view on selected item" (L).

**Selection Action buttons** (`btnSelectionAction1..8`) — a dynamic row under the Selection Panel that changes per selection type (ships: Repair and Refuel, Retrofit, Load troops, Toggle Automation, Construction, Fighters, Refuel, Esc, etc.; see §3.10).

**Scrolling message list** (`lstMessages`, `ScrollingLinkList`) — top of screen, "displays the five most recent messages… Click on a message to move to the location of the message event or to open an appropriate screen" ("Messages: click a message for more information").

**Diplomatic message stack** (`diplomaticMessageQueue_0`, `DiplomaticMessageQueue`) — top-right, 300px-wide stacked cards (up to 7 rows at ≥768px tall): treaty offers, gifts, warnings, pirate protection offers, trade proposals, etc. Click a message to open the conversation screen.

**Story event bar** (`pnlStoryEvent` + `btnStoryEventAction`, `lblStoryEventTitle`, `btnStoryEventClose`) — full-screen story overlays (Shakturi events, planet-destroyer warnings, "You must decide...").

**Advisor suggestion popup** (`pnlAdvisorSuggestion` with `btnAdvisorSuggestionApprove` "Approve", `btnAdvisorSuggestionDecline` "Decline", `btnAdvisorSuggestionShow` "Show") — advisor suggestions (build orders, colonies, facilities, treaties, gifts, targets…) when automation is set to "advisor suggests" mode.

**Message popup** (`pnlMessagePopup`, `MessagePopup` control) — "appears in a popup panel that slides in at the right of the screen"; click to jump to the event location; "Under attack!" etc.

**Game Event panel** (`ynbOfkDbGY` hosting `ctlGameEvent`, `GameEventPanel`) and **pnlEventMessage** (`BorderPanel` with `btnEventMessageInvestigate` / `btnEventMessageAvoid` / `btnEventMessageGoto` / `btnEventMessageClose`) — event decisions (e.g. "When encounter Ruins": Investigate / Leave alone / Ask what to do).---

## 3. EVERY WINDOW / PANEL (complete inventory)

The main form (`DistantWorlds.Main`, ~1,000 controls in `Main.InitializeComponent.cs`) hosts everything. Top-level ("root") controls first, then each openable screen.

### 3.0 Root controls of the Main form

| Control (field) | Type | Purpose |
|---|---|---|
| `mainView` | `MainView` (custom `Panel`) | The map: all drawing (systems, planets, ships, nebulae), mouse/zoom/pan, hover detection. |
| `lblSystemName`, `lblStarDate`, `lblStateMoney`, `lblPrivateMoney`, `lblGodData` | Labels | Top status bar: current system, star date, state economy, private economy, (debug). |
| `lstMessages` | `ScrollingLinkList` | Scrolling recent-message list across the top. |
| `diplomaticMessageQueue_0` | `DiplomaticMessageQueue` | Top-right stack of diplomatic event cards. |
| `itemListCollectionPanel_0` | `ItemListCollectionPanel` | The **Empire Navigation Tool** (left side, 300px wide, row of square icon buttons + one active list panel). |
| `pnlSystemMap` (BorderPanel) + `picSystem` | `SystemView` | Bottom-right mini-map (system/sector/galaxy depending on zoom) + click-to-move. |
| `pnlInfoPanel` | `InfoPanel` | **Selection Panel** (bottom-left): readout for the selected object + `pnlDetailInfo` (`HoverDetail`) expandable detail; large 482×370 or small 392×360 mode (`btnSelectionPanelSize`). |
| `pnlHoverDetail` | `HoverDetail` | Secondary hover detail area. |
| `pnlMessagePopup` | `MessagePopup` | Right-side popup messages (Under Attack!, etc.). |
| `pnlStoryEvent` | `Panel` | Full-screen story/event overlay with title + action/close buttons. |
| `pnlGameMenu` | `BorderPanel` | In-game game menu (Escape). |
| `pnlMessageHistory` | `ScreenPanel` | Message History (H). |
| `pnlGameOptions`, `pnlGameOptionsAdvancedDisplaySettings`, `pnlGameOptionsEmpireSettings`, `pnlGameOptionsMessages` | `GameOptions*ScreenPanel` | Options screens (O): Advanced Display / Empire Settings (automation & policies) / Messages. |
| `pnlEmpireInfo` | `ScreenPanel` | Your Empire summary (F6 area) — overview, economy, bonuses, ships & bases, government change ("Have Revolution"). |
| `pnlEmpireSummary` (+ `EmpireSummaryPanel` `ctlEmpireSummary`) | `ScreenPanel` | Empire Summary: size/strength, government, economy, race/ruin bonuses, ships/bases summary. |
| `pnlEmpireComparison` (`vHfFsoqMev` hosts `tabEmpireComparisonGraphs`, `EmpireComparison`) | `ScreenPanel` | **Game Overview / Empire Comparison and Victory Conditions** (V): comparison graphs, achievements, top colonies, victory progress. |
| `pnlEmpirePolicy` | `ScreenPanel` | **Empire Policy** — save/load policies ("Save Policy"/"Load Policy"), the automation-detail screen. |
| `pnlColonyInfo` | `ScreenPanel` | **Colony screen** (F2): colony tabs (Summary/Troops/Facilities…), construction queue, attitudes, tax, population policy, ruin, expansion planner button. |
| `pnlBuiltObjectInfo` | `ScreenPanel` | **Ship/Base details** (F11 area): components, cargo, docking bays, fighters, mission queue, construction queue; buttons: Go to Ship, View Design, View Ship Group, Repair/Refuel/Retire/Retrofit/Scrap Selected, Show Mining Planner. |
| `pnlShipGroupInfo` | `ScreenPanel` | **Fleet screen** (F12): fleet summary, posture, home base, target, tactics, member list; buttons: Repair and Refuel Fleet, Retrofit Fleet, Disband Fleet, New Fleet. |
| `pnlResearch` + `pnlResearchTree` (`ResearchTree`) | `ScreenPanel` | **Research screen** (F7): three tech trees (Weapons/Energy/HighTech via `btnResearchTreeWeapons/Energy/HighTech`), progress, crash research, research facilities (`btnResearchFacilities`, `pnlResearchFacilities`), facilities `ResearchFacilities`/`ResearchProgress`. |
| `pnlDesigns` + `pnlDesignDetail` | `ScreenPanel` | **Designs** (F8): design list (type filter, "Show Latest Designs"/"Show All Designs"/"Show Buildable Non-Obsolete Designs"…), design detail (components, role, defenses, movement, industry, warnings, image scaling mode), buttons: Add New, Edit, Copy As New, Delete, Load, Save, Save Design, Show Component Guide, Show Construction Summary, Show Empire Policy, Upgrade/Upgrade Manual. |
| `pnlComponentGuide` | `ScreenPanel` | Component Guide (all components: description, costs, tiers). |
| `pnlDiplomacyTalk` (`DiplomacyEmpireSummary`, `DiplomaticRelationListView`, `DiplomacyTradeTree`) | `ScreenPanel` | **Diplomacy** (F5): relation list per empire, "Speak" conversation (text options), trade offer tree (monetary small/medium/large gifts, tech/map/territory trades), restricted-resource trading (`TradeRestrictedResourcesPanel`). |
| `pnlMessageHistory` | `ScreenPanel` | Message History with filter dropdown ("all messages", exclude battle messages, Galactic History) + galaxy map with location markers + "Go to" button. |
| `pnlGameOptionsMessages` | `GameOptionsMessagesScreenPanel` | Message Settings: Scrolling Messages + Popup Messages checklists per category. |
| `pnlGameOptionsEmpireSettings` | `ScreenPanel` | Your Empire Settings: Default Engagement Stances (Patrol/Escort/Attack/Other × auto/manual), Fleet Attack Settings, Attack Overmatch, Discoveries, "Newly built ships are automated", "Suppress all pop-up screens", "Loaded games are paused". |
| `pnlGameOptionsAdvancedDisplaySettings` | `GameOptionsAdvancedDisplaySettingsScreenPanel` | Display: GUI scale, Clean Galaxy View, Auto Pause in Game Screens, Auto Save (Every X minutes / (SPACER)), Mouse scroll-wheel behaviour, Sound (Effects/Music), "Maximum Framerate" (Unlimited / N FPS), Zoom Speed, Scroll Speed, Star Field size, "Display nebulae clouds in systems", System Nebulae Detail (Low/Med/High), Galaxy View – Ship Display checkboxes (Fleets, Resupply, Military, Space Ports, Other Bases, Exploration, Colony, Construction, Civilian, Always enemy Fleets/Military/Pirates). |
| `kYdDyYeMls` (pnlIntelligenceAgents) | `ScreenPanel` | **Intelligence Agents** (F4): `ctlCharacterSummary`, `ctlIntelligenceAgents` list, `pnlCharacterMission` (mission: target empire, type, specific target, time allowed, success probability), Recruit/Disband Agent, "Show Event History", "Learn About" (`lnkCharactersLearnAbout`). |
| `pnlCharacterInfo` / `pnlCharacterEditSkillsTraits` / `pnlCharacterEventHistory` | `ScreenPanel`s | Character details (skills/traits progress, role), edit skills/traits (with apply), event history. |
| `pnlTroopInfo` | `ScreenPanel` | Troops screen: troop list (type, strength, experience), garrison/recruit/disband/transfer buttons. |
| `pnlColoniesList` (inside colony screen) | `HabitatListView` etc. | Colony list + detail. |
| `CaLkaMyrMQ` (pnlGalaxyMap) | `ScreenPanel` | **Galaxy Map** (G): `gmapMain` (`GalaxyMap`), `picSystemMap` mini system view, view filter dropdown `cmbGalaxyMapViewMode` (**(Default), Our Systems, Potential Colonies, Known Resources, Explored Systems, Independent Populations, Enemy Systems, Pirate Bases, Ancient Ruins, Scenic Locations, Research Locations**), habitat type filter `cmbGalaxyMapHabitatType`, `txtHabitatSearch`, habitat list `lvwHabitats` + `GalaxyHabitatResourceListView`, habitat info `pnlHabitatInfo` + picture, map key button, Back/Forward/Goto navigation. |
| `pnlGalaxyMapKey` + `MapKey` | BorderPanel | Map legend (colors) popup. |
| `pnlRetrofit` | `ScreenPanel` | Retrofit screen: design dropdown + "Retrofit Selected Items to New Design" (btnRetrofitGo). |
| `pnlBuildOrder` | `ScreenPanel` | **Build Order** (F9): current ship/base levels vs suggested levels by advisor, per-type design selection, "Purchase"/"Cancel", "Available Funds" (flashes red when unaffordable). |
| `pnlConstructionSummary` / `pnlBuildOrder`-related | panels | Construction summary (per-yard queue: design, size, components, progress; "Show Construction Summary", "Show Mining Planner"). |
| `pnlExpansionPlanner` | `ScreenPanel` | **Expansion Planner** (F3): resource supply/demand table + "Potential Colonies"/"Potential Mining Locations"/"Potential Research Locations"/"Potential Resort Locations"/"Special Locations" target lists; actions: "Send Colony Ship", "Send Construction Ship", "Show on Galaxy Map", "Select Target", "Goto Target", "Sort Resources". |
| `pnlEncyclopedia` (+ `EncyclopediaTopicTree`, `RelatedEncyclopediaItemsBox`, WebBrowser) | `ScreenPanel` | **Galactopedia** (F1): topic tree (Races, Resources, Planet Types, Game Concepts, Screens, …), browser view, Back/Forward/Home (`btnEncyclopediaBack/Forward/Home`), "Show this screen at startup" checkbox, context-sensitive entry for the selected item. |
| `pnlGameEnd` (+ `btnGameEndContinue`, `btnGameEndExit`) | `BorderPanel` | Game-over screen (victory/defeat/sandbox) with flavor text. |
| `pnlGameRaceVictoryConditions` / `pnlGameSummary` (`GameSummaryPanel`) / `pnlGameVictoryConditions` (`GameVictoryConditions`) | panels | Per-race victory condition display / game summary panel. |
| `pnlGalacticHistory` | `ScreenPanel` | Galactic History: historical story messages ("Galactic History revealed", "Reveal Historical Secret", "HistoryOfferLocationHint"). |
| `pnlRuinDetail` / `pnlSpecialRuin` (`SpecialRuin`/`RuinPanel`) | panels | Ruin details (bonuses, events). |
| `pnlResourceComponents` | panel | Resource → component/industry usage table. |
| `pnlColonyInvasion` (`ColonyInvasionPanel`) | panel | Live invasion status (attacker/defender troops, progress). |
| `pnlPirateSmugglingMissionResourceSelection` | panel | Mercenary smuggling mission setup (resource, amount, bid price, "Bid PRICE credits"). |
| `pnlRelationAllianceName` (`btnRelationAllianceNameApply`) | panel | Name your new alliance (after alliance treaty). |
| `pnlSaveLoadProgress` | panel | Save/load progress indicator. |
| `pnlAdvisorSuggestion` | panel | Advisor suggestion popup (Approve/Decline/Show). |
| `pnlEventMessage` | `BorderPanel` | Event decision popup: "Investigate" / "Avoid" / "Go to location" / "Close". |
| `pnlTutorial` | `BorderPanel` | Tutorial window (draggable; "Continue" button; shown during the 11 tutorials; step text from `TutorialItem`s). |
| `pnlIntroduction` | `BorderPanel` | First-run introduction screen. |
| `pnlGameEditor*` (`btnGameEditor`, `btnGameEditorSave/SaveAs/Exit`, password dialogs) | panels | Game Editor entry (edit empires, galaxy, ships, colonies, creatures, events; "Editing of this game is protected by a password"). |
| `pnlQuickStart` | `BorderPanel` (in Start form) | Quick Start screen. |
| `pnlGameOptions*` in Start form | panels | Options screens also reachable pre-game (same controls). |
| `actionMenu`, `selectionMenu` | `ContextMenuStrip`s | Right-click menus. |

### 3.1 Empire screen (`pnlEmpireInfo` / `pnlEmpireSummary`)

Data shown: empire name (editable — "Change the name by typing a new one here"), **Overview** (size & relative strength: colonies, population, ships, strategic value), **government** (type + bonuses/handicaps, e.g. Approval, Population Growth, War Weariness, Research Speed, Corruption, Maintenance Costs, Troop Recruitment, Trade Bonus), **Economy panel** (state vs private: income — colony taxes, tribute, space port income [private ship purchases + transaction fees], trade bonuses — expenses — ship construction, maintenance; state Cashflow; "This Year's Bonus Income" one-offs like resort income and foreign trade bonuses), **Pirate Economy** variant when playing pirate (more variable income/expenses), **Bonuses panel** (alien race bonuses within your empire + special-ruin bonuses at colonies), **Ships and Bases panel** (counts, total firepower, maintenance cost).
Buttons: **"Have Revolution"** (dropdown of the 13 government types: Corporate Nationalism, Democracy, Despotism, Feudalism, Hive Mind, Mercantile Guild, Military Dictatorship, Monarchy, Republic, Technocracy, Utopian Paradise, Way of Darkness, Way of the Ancients — "a revolution is never painless; there will probably be unwanted side effects…", including a temporary development setback at colonies), "Show Empire Policy", "Show Expansion Planner", Empire Graphs (comparison), Galactic History.

### 3.2 Empire Comparison / Game Overview (`pnlEmpireComparison`, V key)

Tabbed graphs comparing empires over time: **Population, Territory, Economy, Strategic Value, Military Strength** (`tabEmpireComparisonGraphs`), plus **Top Colonies** list, **Achievements** list, and current **Victory Conditions** progress per empire ("Empire Comparisons and Victory Conditions", "SANDBOX MODE" text when time-limited).

### 3.3 Colony screen (`pnlColonyInfo`, F2)

Tabs/areas (from control set): colony list (`HabitatListView` with `HabitatDropDown`), colony summary (name, population, development, approval/attitudes via `HabitatAttitudeSummary` — "Colony Approval", attitude percentages, dominant race, resources, tax rate slider (`numColonyTaxRate`), **Population Policy** dropdown (`ColonyPopulationPolicyDropDown`: Assimilate / Do Not Accept / Resettle / Enslave / Exterminate + "Apply to all colonies" button `btnColonyPopulationApplyPolicyToAll`), reproduction rate), **construction queue** (`ConstructionYardListView` + buttons: "Build Facility" (`btnColonyFacilityBuild`), "Scrap" (`btnColonyFacilityScrap`), "Show Summary" (`btnColonyConstructionShowSummary`), "Remove from Queue" (`btnColonyConstructionRemoveFromQueue`), Move Up/Down/To Top/To Bottom (`btnColonyConstructionYardMove*`)), **facilities** list (all 24 planetary facilities incl. Cloning Facility, Terraforming Facility, Robotic Troop Foundry, Giant Ion Cannon, Planetary Shield, Regional Capital, Fortified Bunker, academies — with "Do not build FACILITY until population reaches N" advisor gates), **wonders** ("Build Wonders", "Build Special Wonder"), **troops** (garrison, recruit/disband/ungarrison/transfer — `btnColonyTroopsRecruit`, `btnColonyTroopGarrison`, `btnColonyTroopsDisband`, `btnColonyTroopsUngarrison`, `btnColonyTroopTransferTransport`), **ruin** ("Show Ruin" `btnColonyShowRuin`), **capital** ("Make Capital" `btnColonyMakeCapital`), **expansion planner** (`btnColonyShowExpansionPlanner`), "Show on Galaxy Map" (`btnColonyShowOnGalaxyMap`), "Goto habitat" (`btnColonyGotoHabitat`), invasion status (`ColonyInvasionPanel`). Pirate variant: "Colony Control" list (`PirateColonyControlListView`), control % and Pirate Base/Fortress/Criminal Network facilities.
Advisor policies visible: "Default Tax Rate policy for small/medium/large colonies", "Increase colony tax rates when at War", "Default Population Policy: Your Race Family / All Other Races", "Use Penal Colonies to implement 'Enslave' population policy", "Default Reproduction Rate".

### 3.4 Ships & Bases screen (F11) + Fleet screen (F12)

**Ships and Bases** (`pnlBuiltObjectInfo`): filter tabs State ships / Private ships / State bases / Private bases ("Show State Ships" / "Show Private Ships" / "Show State Bases" / "Show Private Bases"), `BuiltObjectListView` + `BuiltObjectDropDown`, role filter, search box, "View Design", "Go to", fleet membership ("View Ship Group"). Buttons: "Refuel Selected Items", "Repair Selected Items", "Retire Selected Items", "Retrofit Selected Items", "Scrap Selected Items" (with confirmation "Are you sure that you wish to scrap the selected ships?"), "Show Mining Planner", "Show Construction Summary", "Queue Next Mission" etc. Detail pane: `BuiltObjectComponentListView` (component category + size + status), cargo (`CargoListView`), docking bays (`DockingBayListView`), fighter bays, mission queue (`BuiltObjectMissionView`), construction queue, `CharacterDropDown` (ship captain), "Edit Design", "Manage Fighters and Bombers", "Launch available Fighters" / "Launch available Bombers", "Set Attack Target", "Set Home Base", "Set Posture", "Set Range", "Join/Leave Fleet", "Disband Fleet", "Change engagement stance" (comma), subrole (`BuiltObjectSubRoleDropDown`: e.g. Strike Force, Fleet role).
**Fleet screen** (`pnlShipGroupInfo`): `ShipGroupListView` (posture icon, range, fleet name, home base, target), lead ship, total firepower/ship count, member list; "New Fleet" (from selected ships: "To create a new fleet first select at least one military ship… click the 'New Fleet' Action button (under the Selection Panel)" or right-click → "Join Fleet"), "Disband Fleet", "Retrofit Fleet", "Repair and Refuel Fleet", tactics (`BattleTactics`: Evade, Standoff, All Weapons, Point Blank), posture (Attack/Defend) and range settings, "Fleet Attack Settings" (assemble when X% dispersed; refuel when X% of fleet need fuel; attack overmatch).

### 3.5 Empire Navigation Tool (left side, `itemListCollectionPanel_0`)

A vertical strip of square icon buttons (20/26px) each toggling a collapsible **ItemListPanel** (custom-drawn list with title bar, scroll arrows, item rows with small icons + text + pings). The 15 list types (from the UI_EmpireNavigationTool help + code):
1. **Empires** (all empires incl. pirates/independents: population, GDP, ship counts; click = select empire)
2. **Your Colonies** (with population bar)
3. **Enemy Colonies**
4. **Space Ports / Bases**
5. **Mining Stations** (resource, "Mining" bonus text)
6. **Research Stations** ("BONUSAMOUNT from FEATURE", "Research" bonus)
7. **Resort Bases**
8. **Fleets** (posture, range, target; hover shows "firepower format"; **click a fleet icon → its member ships are listed; right-click an Enemy Targets entry assigns the nearest automated fleet**)
9. **Ships** (state ships by category)
10. **Idle Ships** ("No movement")
11. **Enemy Targets** (colony/base under attack: "FLEET attacking", "X ships are attacking this target", "X ships are defending this target", "Target Firepower", "In our system"/"In another empire's system", "Near LOCATION", "Pirate base in this system", "Hostile population")
12. **Potential Colonies** (planet type, quality: "Low quality - poor colonization", "Too far from existing colonies", "Special Luxury Resources", "Pirate base in this system")
13. **Potential Mining Locations** (resource, "Our empire has access to X sources of this resource", "Unknown resources", "Restricted Area", "Debris Field", "Scenery Bonus")
14. **Potential Research Locations** ("Special Ruins", "Research", "Scenery Bonus", "Galactic storm")
15. **Pirate Missions** (smuggling/attack/defend offers: "Smuggling requested by EMPIRE/Independent/All Resources", "Attack/Defense requested by EMPIRE", "Current bid: EMPIRE", "No bids yet", "Already Bidded", "X pirate factions accepted", "Pirate Mission Expires/Completes DATE", "We have X smugglers available for this mission"; buttons: "Bid PRICE credits", "Accept Smuggling Mission", "Cancel", toggle filters "Type: All/Attack/Defend/Smuggling", "Status: All/Open/Accepted")
Interactions: "click to select item, double-click to move view", "Shift-click to multi-select items", "Right-click to cancel" (missions/pings), "cycle fleets (X key) and click to assign attack". Hovering an item draws a **yellow circular ping** on the map; message locations ping **dashed blue expanding circles** (see §7). The tool has a size setting (Small/Medium/Large — `EmpireNavigationToolSize` 0/1/2 → scale factors 1.0/1.33/1.77) and "Shrink/Enlarge" button.

### 3.6 Research screen (F7)

`pnlResearchTree` (a `ResearchTree` custom control) with three area tabs: **Weapons**, **Energy**, **HighTech** (`btnResearchTreeWeapons/Energy/HighTech` + `ResearchLevelSlider` per area showing level 1–7+, "Research speed" multiplier). Tree view: nodes = research projects/components; each node shows tier (small/medium/large), name, description on hover ("Hovering over a project in the tech tree will provide further details on the project, including what prerequisites must first be met"); **red prerequisite lines** = blocked; click to queue ("You can queue up as many projects as you like… each project will begin immediately after its preceding project(s)"); the currently-researching project is first in the queue; **crash research**: click the active project → prompt with cost → "3 times faster than normal", marked by a **lightning bolt icon at lower right of the project**. Right area: **Research Summary** (per-area output, capacity, "Total Empire Research Potential", "Total Research Capacity and Actual Output"), **Research Facilities** list (`btnResearchFacilities`, `ResearchFacilities` control: space ports' built-in labs + research stations with bonus %: "parked in orbit around Neutron stars", "inside the pulsing radiation zones of Supernovae", "on the edge of deadly Black Holes"; "No Research Bonus Here"), "Goto Facility", "Show Component Guide". Race-limited techs: "limited to specific alien races – these cannot be researched by anyone else… you might be able to trade this tech" (but traded tech can't be re-traded). "Natural Limit" on research speed for very large empires.

### 3.7 Designs screen (F8) & Design Detail

**Designs** (`pnlDesigns` + `DesignListView`, `DesignDropDown`): list of built designs by type (26 ship/base roles: Capital Ship, Carrier, Colony Ship, Construction Ship, Cruiser, Defensive Base, Destroyer, Escort, Exploration Ship, Freighter, Frigate, Generic Base, Mining Ship, Mining Station, Monitoring Station, Passenger Ship, Research Station, Resort Base, Resupply Ship, Space Port, Troop Transport, …), filters: "Show All Designs", "Show All Design Types", "Show Latest Designs", "Show Latest Buildable Designs", "Show Non-Obsolete Designs", "Show Buildable Non-Obsolete Designs"; buttons: "Add New" (create new design), "Edit", "Copy As New", "Delete" ("Cannot Delete Design" if in use), "Load" / "Save" (design files: "Distant Worlds ship designs files"), "Save Design", "Show Component Guide", "Show Construction Summary", "Show Empire Policy", "Upgrade" / "Upgrade Manual" (auto-apply new components: "Auto Retrofit (including advisor suggestions)", "Manually Upgrade Design", "Only Retrofit When Manually Ordered", "Prompt for Retrofit when new tech becomes available", explanations "Design Upgrade Explanation"/"Design Upgrade Affirmative/Negative Explanation").
**Design Detail** (`pnlDesignDetail`): tabs **Overview** (name, role, size (small/medium/large, "Maximum Ship size"/"Maximum Base size"), cost "Purchase Cost" "Maintenance Cost", image with "Image Scaling Mode"), **Industry** (`DesignIndustry`: construction capacity, "Maximum Weapons Energy use per second"), **Energy** (`DesignEnergy`), **Movement** (`DesignMovement`: speed, range, "HyperjumpSpeed"), **Defense** (`DesignDefense`: shields, "ShieldRechargeRate", "DamageControl", "RepairBonus"), component list (`ComponentListView` with `ComponentCategoryDropDown`, `ComponentDetail`, `ComponentResourceListView`), fighter bays ("Civilian ships cannot have fighter bays"), role-specific rules and warnings panel (`DesignWarnings`: red = hard rules, e.g. "Civilian ships may not have more than 10 weapons", "Only one HyperDrive component is required"; yellow = recommendations, e.g. "Carriers: min X% fighter bays", "Colony Ships: min X% colonization module"), **Battle tactics** dropdown (`BattleTactics`: Evade, Standoff, All Weapons, Point Blank), **invasion/ground tactics**, **flee-when** (`BuiltObjectFleeWhen`: Never / Enemy Military Sighted / Attacked / Shields 50% / Shields 20% — "Default 'Flee When' Stance for Military ships"), "Cannot edit this design" (locked designs).

### 3.8 Diplomacy screen (F5) & Talking With Empires

**Diplomacy** (`pnlDiplomacyTalk`): empire list (`DiplomaticRelationListView` with `EmpireList`/`EmpireRelationList`, relation type + color key `DiplomaticRelationColorKey`: at war / hostile / neutral / friendly / allied), per-empire `DiplomacyEmpireSummary` (relations: "No Treaty"/"Alliance", etc.; reputation; "Change relationship"), **Trade** (`DiplomacyTradeTree` — tree of offer categories: monetary gifts small/medium/large, tech sales, map swaps, territory, restricted resources; "RestrictedResourceDiscovered", "Trading Allowed/Blocked"), **Send Diplomatic Gifts**, warnings, treaty negotiation ("Suggest new treaties", "War and Trade Sanctions"), "Pirate Offer Protection" (monthly fee), "Pirates Offer Truce".
**Talking With Empires** (conversation, "Speak"): scripted dialog lines with options such as: "We declare peace", "We declare war", "We will end our war with you", "Ok, we declare war on the X", "Ok, we will end our war with the X", "No, we will continue our fight", "No, we will fight on", "No, we see no need for Trade Sanctions", "No, our Trade Sanctions will continue", "End your treacherous covert missions against us", "Can you go easy on us next time?", "No, you must suffer further before this war will end", "No, you must remain our slaves", "No, we will not become your slaves!", "No, we do not care about Utopia, and we will not join this alliance", "No, we do not need any further help", "Not at the moment, thanks", "No, we do not need…", "Buy information", trade/map/tech proposals ("Swap maps or tech", "Sell TECH for X credits", "Swap Territory maps (empire systems)", "Swap Galaxy maps (all exploration)"), alliance naming ("Name your new alliance" → "Apply"). Advisor: "Suggest gifts to empires", "Suggest new treaties", "Suggest war and trade sanctions".

### 3.9 Intelligence Agents (F4)

`pnlCharacterSummary` (portrait, name, role, skills), `ctlIntelligenceAgents` list, **character mission** panel: select **target empire**, **mission type** (espionage, sabotage, counter-espionage, psy-ops, assassination — via `CharacterSkillType` Espionage/CounterEspionage/Sabotage/Concealment/PsyOps/Assassination), optional **specific target** (colony/base/character), **time allowed** ("The more time you allow for the mission, the greater the chance of success"), success-probability estimate, cost; "Recruit Agent" (`btnIntelligenceAgentsRecruit`), "Disband Agent" (`btnIntelligenceAgentsDisband`), "Show Event History", "Learn About" the mission type. "Counter Intelligence: You can assign agents to prevent enemy intelligence missions… Beware of the negative fallout from botched intelligence missions - if another empire discovers your actions against them it will dramatically lower their estimation of your empire, and could even lead to war." Character roles (10): Leader, Ambassador, Colony Governor, Fleet Admiral, Troop General, Intelligence Agent, Scientist, Pirate Leader, Ship Captain (+ Undefined). 54 skill types and ~70 traits (Paranoid/Trusting, Pacifist, Luddite, Xenophobic, Corrupt, …) modify skills/attitudes.

### 3.10 Selection Panel & hover readouts (data shown per object type)

`InfoPanel` (bottom-left) — dynamic content by selection:
- **Colony**: name, capital star, empire, population + development (5×5 graph), dominant race, resources, approval (attitudes: "Colony Approval"), tax rate, production, garrison, facilities.
- **Ship/Base**: name, role, empire (flag), firepower, health/shields, velocity, mission (current + queued), cargo, fuel, docking bays, fighters, captain, "docked" status, "Construction: SHIPNAME building at COLONY to colonize PLANETNAME" style status lines, maintenance cost.
- **Fleet**: name, posture, range, member count, firepower, home base, target.
- **Planet/moon/star**: type, quality, resources, population, "Gas Cloud", asteroid, "Planet Destroyer Project" etc.
- **Creature**: type + description.
- **Ruin/facility**: bonus details.
Action buttons row (8 slots) changes with selection; plus `pnlDetailInfo` expandable ("HoverDetail") with extra info and hotspots. **Automation indicator**: "When a ship is automated a circular blue arrow appears in the bottom-right corner of the Selection Panel".

### 3.11 Galaxy Map screen (G) & map key

As detailed in §3.0: big `GalaxyMap` (all stars & gas clouds; selection = "bright blue intersecting horizontal and vertical lines"; click snaps to nearest star), system mini-map, selection summary middle-right, surface image bottom-right, 11 view filters, habitat search, Back/Forward history, "Go to" (moves main view), Map Key legend button.

### 3.12 Message History (H) & Message Settings

**Message History** (`pnlMessageHistory`): message list left; body middle; "If a message has a related location in the galaxy, this location is displayed on the galaxy map at the right" + "Go to" button; filter dropdown top-left ("You can filter messages using the dropdown list… You can exclude battle messages, or you can choose to view messages relating to Galactic History").
**Message Settings** (`pnlGameOptionsMessages`): two checklists — **Scrolling Messages** ("Control which types of messages appear in the scrolling message panel at the top of the main view") and **Popup Messages** ("…popup message area at the right of the main view").

### 3.13 Your Empire Settings / Game Options (O)

**Automation** (`cmbOptionsAutomationMode` presets: **(Custom), Default, Expert (None), Rule in Absence (Full), Expansion, War and Combat, Diplomacy, Spy Master**) — then per-area automation levels (AutomationLevel = **Manual / Semi-Automated (advisor suggests) / Fully-Automated**): Troop Recruitment, Character Locations, Agent Assignment, Colony Tax Rates, Population Policy, Ship Design, Ship Building, Fleet Formation, Fleet Postures, Research, Colonization, Diplomatic Gifts, Treaty Negotiation, War & Trade Sanctions, Attacks on Enemies, Colony Facilities, Offer Pirate Missions (default Fully Automated).
**Empire Settings detail** (all exact strings from code): "Tax Rate policy for small colonies / medium colonies / large colonies" (sliders), "Increase colony tax rates when at War", "Default Population Policy: Your Race Family" / "…All Other Races", "Use Penal Colonies to implement 'Enslave' population policy", "Default Reproduction Rate", "Infantry / Artillery / Armored / Special Forces Recruitment Level", "Never recruit Troops until colony population reaches X", "Minimum number of Troop Units per Colony", "Troop Garrison Level at Colonies", "Ungarrisoned Troops At Colonies", "Use Default Troop Transport Loadouts", "When establish new colony, always recruit new Troops", "When establish new colony, immediately build this base", military construction proportions (Escorts, Frigates, Destroyers, Cruisers, Capital Ships, Troop Transports), "Protect Leader At All Costs", "Proportion of Military ships assigned to Fleets && Strike Forces", "Typical number of ships in Fleet", "Typical number of ships in Strike Force", "Use Blockades when have Trade Sanctions against an empire", "Use bombardment against enemy colonies", "Use planet destroyers against enemy colonies", "Build Planet Destroyers when able", "Default 'Flee When' Stance for Military ships" (Never / Enemy Military Sighted / Attacked / Shields 50 / Shields 20), "Use Exploration Ships to scout enemy systems", "Engage in Tourism", "Tourism Priority", "Homeworld Defense Priority", "Exploration Priority", "Free Trade Agreement Priority", "Mutual Defense Pact Priority", "Subjugation Priority", "Willingness to Break Treaties", "Willingness to Go To War", planet-type colonization priorities ("Continental Planets", "Ice Glacial Planets", "Sandy Desert Planets", "Ocean Planets", "Marshy Swamp Planets", "Volcanic Planets", "Planets with Ruins"), "Overall focus", "Tech emphasis 1..6", "Minimum distance between new spaceports", "Minimum population for Small/Medium/Large spaceport", "Minimum size for Small/Medium/Large spaceport", "Build Special Wonder", "Build Planet Destroyers when able", fleet attack settings ("First assemble when this percentage of fleet dispersed / need fuel", "Attack Overmatch" 1:1–5:1), default engagement stances (Patrol/Escort/Attack/Other, auto + manual: "No default stance" / "Engage when attacked" / "Engage nearby targets" / "Engage system targets"; manual = "Control manually" / stance / "Fully automate"), discoveries (ruins & abandoned ships, §1.3), "Newly built ships are automated", "Suppress all pop-up screens", "Loaded games are paused".
**Display settings** (`pnlGameOptionsAdvancedDisplaySettings`): "GUI scale" (50–100%), "Clean Galaxy View", "Auto Pause in Game Screens", "Auto Save" (Every X minutes; "Auto Saves"), "Mouse scroll-wheel behaviour" ("No movement" / "Move to selected item" / "Move to mouse cursor location"), sound (Effects/Music volume, "Sound Volume"), "Maximum Framerate" (Unlimited or "X FPS" numeric), "Zoom Speed", "Scroll Speed" (Main View scroll), "Star Field" size, "Display nebulae clouds in systems", "System Nebulae Detail" (Low/Medium/High), "Galaxy View - Ship Display" (Fleets, Resupply Ships, Military Ships, Space Ports, Other Bases, Exploration Ships, Colony Ships, Construction Ships, Civilian ships, Always show enemy Fleets, Always show enemy Military ships, Always show Pirates).
**Change Theme** (`ThemesScreenPanel`): theme list + 23 customizable items.

### 3.14 Custom control classes (`DistantWorlds.Controls` assembly, 193 classes)

Grouped by purpose (file names in `DistantWorlds.Controls/Controls/`):
- **Window chrome**: `ScreenPanel` (standard screen window: title, close button, kickstart/reset), `BorderPanel` (+ `BorderPanel.resx`), `ExtendedPanel`, `GradientPanel`, `PersistentGradientPanel`, `RoundRectanglePanel`, `Form`, `CloseButton`, `CaptionCtrl`, `CornerCtrl`, `HeaderPanel`, `HoverButton`, `TransparentButton`, `GlassButton`, `DropLabel`, `SmoothLabel`, `LabelDropshadow`, `CheckBox`, `DirectionCtrl`, `BufferPaintingCtrl`, `CollapseAnimation`, `ScrollingLabel`, `ScrollingCreditsPanel`, `FontSize`, `IFontCache`, `Win32Wrapper`, `CustomMessageBox` (MessageBoxEx: custom dialogs with buttons/icons), `EnhancedTabControl`, `NumericUpDownNoArrows`, `ColorDropDown`/`ColorSlider`.
- **Map/list views**: `GalaxyMap`, `SystemView`, `MapKey`, `GenericIconView`, `CreatureTypeIconView`, `HabitatTypeIconView`, `PlanetaryFacilityListIconView`, `EmpireList`, `EmpireListView`, `EmpireListViewBasic`, `EmpireRelationList`, `EmpireSummaryListView`, `EmpireSummaryPanel`, `EmpireDetailView`, `EmpireComparison`, `GalaxySummaryListView/Panel`, `GameSummaryPanel`, `GameVictoryConditions`, `RaceSummaryPanel`, `RaceVictoryConditionsPanel`, `StartingEmpiresListView`, `HabitatListView`, `HabitatResourceListView`, `HabitatPrioritizationListView`, `PopulationListView`, `BuiltObjectListView`, `BuiltObjectMissionView`, `ConstructionYardListView`, `ManufacturerListView`, `CargoListView`, `ComponentListView`, `ComponentResourceListView`, `ComponentDetail`, `ComponentCategoryDropDown`, `ConstructionYardPurchaser`, `CharacterListView`, `CharacterEventListView`, `CharacterSkillsTraitsProgress`, `CharacterSkillTraitEditPanel`, `CharacterSummary`, `CharacterMission`, `CharacterTroopListIconView`, `CharacterDropDown/CharacterSkillTypeDropDown/CharacterTraitTypeDropDown`, `CommandListView`, `ColonyInvasionPanel`, `ColonyPopulationPolicyDropDown`, `CollapsingHabitatTypeSelector`, `CreatureTypeDropDown`, `DesignListView`, `DesignDefense/Energy/Industry/Movement/Warnings`, `DesignDropDown`, `DesignImageScalingModeDropDown`, `DiplomacyEmpireSummary`, `DiplomacyTradeTree`, `DiplomaticRelationListView`, `DiplomaticRelationColorKey`, `DiplomaticRelationTypeActualDropDown`, `DockingBayListView`, `EmpireDropDown`, `EncyclopediaTopicTree`, `EventActionListView/Panel/TypeDropDown/ExecutionTypeDropDown/TriggerTypeDropDown` (game-event editor), `FleetDropDown`, `FleetHabitatDropDown`, `FleetBuiltObjectHabitatDropdown`, `FlagShapeDropDown`, `GalaxyLocationDropDown`, `GameEventListView`, `GameEventPanel`, `GameOptionsScreenPanel` (+ `AdvancedDisplaySettings` / `Messages` variants), `GovernmentStyleDropDown`, `HoverDetail`, `HoverMenuGroup`, `HoverMenuItem`, `InfoPanel`, `ItemListPanel` (the ENT lists), `LabelledTrackBar`, `ListBase`, `ListViewBase`, `MultipleEventActionTypeDropDown`, `PirateColonyControlListView`, `PiratePlaystyleDropDown`, `PlanetaryFacilityDefinitionDropDown`, `ResearchButton`, `ResearchFacilities`, `ResearchProgress`, `ResearchSummary`, `ResearchTree`, `ResearchLevelSlider`, `ResourceDropDown`, `ResourceListView`, `RuinPanel`, `SpecialRuin`, `ShipGroupListView`, `ThemesScreenPanel`, `TopColonies`, `TradeRestrictedResourcesPanel`, `TroopDropDown`, `TroopListView`, `WeaponListView`, `TargetAssignmentList` (in `DistantWorlds/Controls/`), `RelatedEncyclopediaItemsBox`, `EmpireSummaryBonuses/Title/BuiltObject/Economy/Colony`, `PersistentScrollablePanel`.
- **CustomDataGridViewElements**: `DataGridViewNumericUpDownCell/Column/EditingControl`, `DataGridViewTextBoxDropShadowCell/Column`, `DiplomaticRelationCell/Column` (used by starting-empires grid).

### 3.15 Game Editor windows (password-gated)

`btnGameEditor` → "Enter Editor Password" (or "Click 'Save' to save the password") → editor panels: "Edit Galaxy" (`pnlEditGalaxy` + `btnEditGalaxyShowEvents`), "Edit Empires" (list + "Add"/"Edit"/"Remove"; per-empire: "Edit Empire - Details/Colonies/Characters/Research/Ships and Bases", `btnEditEmpireApplyTechLevel`, `btnEditEmpireSelectTechs`, `btnEditEmpireBuiltObjectAutoGen`, `btnEditEmpireBuiltObjectGoto`, `btnEditEmpireColonyGoto`), "Edit Game Events" (`GameEventPanel`/`EventActionPanel`: triggers, actions, execution types; "Add New"/"Edit"/"Delete"/"Goto"), habitat editor (`btnEditHabitat*`: Add/Remove Resource, Planetary Facility, Ruins, Troop, Pirate Colony Control, landscape scroll, "Edit Planet or Moon"), built-object editor ("Edit Ship or Base": "Add/Remove Troop", "Game Event"), creature editor ("Edit Creature", "Edit Space Creature"), star/planet/asteroid/gas-cloud editors ("Edit Star", "Place/Edit Asteroid/Field", "Place Planet", "Place Moon", "Place Gas Cloud", "Place Star", "Place Colony", "Place Creature", "Place Ruins", "Place Pirates", "Place Empire", "Place Independent Alien Race", "Erase …"), Save/Save As/Exit editor.---

## 4. MOUSE ACTIONS (UI_MouseActions, verbatim + code-verified)

From the in-game help (UI_MouseActions.mht), verbatim:

> You can use the mouse to move around, select items and give commands. Most commonly you will use the following actions:
> - Moving the mouse pointer to the edge of the main screen will cause the view to move in that direction.
> - You can also move the main view by holding down the right mouse button while dragging.
> - Hovering over an item in the main view displays summary information about the item at the bottom-middle of the screen.
> - Left-clicking selects the item under the mouse pointer, displaying detailed information in the Selection Panel at the bottom left of the screen.
> - Right-clicking displays a pop-up menu with actions appropriate to the selected item, or if no item is selected it centers the view on the mouse pointer position.
> - The mouse scroll wheel zooms the main view in and out from 100% (individual planets and ships) to full galaxy view, and any zoom level in between.

Additional behaviors (from tutorials + decompiled code):
- **Ctrl + left-click** a location: "You can zoom in to any location by holding down the 'Ctrl' key while clicking."
- **Shift + left-click** a ship/base: multi-select (shift-click adds to selection; drag-select box also works).
- **Shift + right-click** on a target with a military ship selected → **Bombard** (colony/planet) or **Capture** (ship/base) instead of the default attack ("you can use the Shift key to change the right-click menu… Shift-right click to bombard or capture").
- **Alt + right-click** (pirates only) → **Raid**.
- **Ctrl + right-click** → force the full mission popup menu even when one default mission would be chosen; in-game hint: "Ctrl-Right-click for more missions".
- Right-clicking a target while a ship is selected assigns the **default mission** determined by the hovered object (enemy → Attack; your own colony/base → Patrol/Build/etc.; empty space → Move), often indicated by a cursor change.
- If multiple ships share the clicked location, a **popup list** lets you pick one.
- Mini-map click → move view; map item double-click → select + move; ENT item double-click → "click to select item, double-click to move view"; shift-click an ENT item → multi-select; right-click an ENT entry → cancel its mission/assignment.
- Tutorial window is draggable; the selection panel can be shrunk/enlarged via `btnSelectionPanelSize`.

## 5. KEYBOARD COMMANDS (UI_KeyboardCommands, verbatim table)

| Key | Action (verbatim) |
|---|---|
| F1 | Galactopedia Help screen |
| F2 | Colonies screen |
| F3 | Expansion Planner screen |
| F4 | Intelligence Agents screen |
| F5 | Diplomacy screen |
| F6 | Your Empire Summary screen |
| F7 | Research screen |
| F8 | Ship Designs screen |
| F9 | Build Order screen |
| F10 | Construction Yards screen |
| F11 | Ships and Bases screen |
| F12 | Fleets screen |
| G | Galaxy Map screen |
| H | Message History screen |
| V | Empire Comparison and Victory Conditions screen |
| O | Game Options screen |
| Pause or Spacebar | Pauses or resumes the game |
| Escape | Displays the Game menu |
| Arrow keys | Scrolls the main view up/down/left/right |
| Backspace | Zooms to the selected item |
| Insert | Zooms the main view to System level |
| Delete | Zooms the main view to Sector level |
| End | Zooms the main view to Galaxy level |
| Home | Zooms the main view to 100% |
| Page Up | Zooms the main view Out |
| Page Down | Zooms the main view In |
| + | Increases game speed by one level |
| – | Decreases game speed by one level |
| N | Move forward in selection history |
| B | Move backward in selection history |
| L | Locks/unlocks the main view on the currently selected item |
| Z | Selects the nearest available military ship to the current location |
| C | Cycles your Colonies in the selection panel (Shift cycles backwards, Ctrl cycles and moves view) |
| P | Cycles your Space Ports in the selection panel (Shift backwards, Ctrl cycles + moves view) |
| M | Cycles your Military ships (same modifiers) |
| Y | Cycles your Construction ships (same modifiers) |
| X | Cycles your Exploration and Colony ships (same modifiers) |
| F | Cycles your Fleets (same modifiers) |
| I | Cycles your Idle ships (same modifiers) |
| E | Commands the selected ship to Escape from attackers |
| R | Commands the selected ship to Refuel at the nearest refueling point |
| A | Automates the selected ship |
| S | Stops the selected ship, cancelling the current mission |
| comma (,) | Cycles the engagement stance of the selected ship ("Cycles the engagement stance of the selected ship or fleet") |
| Shift + right-click | Bombard/Capture (see §4) |
| Alt + right-click | Raid (pirates) |
| Ctrl + right-click | Full mission popup |
| Ctrl + left-click | Zoom to location at 100% |
| Ctrl (with zoom keys/buttons) | cycles-and-moves variants of C/P/M/Y/X/F/I |

Tutorials confirm the same mappings ("Use the Cycle Construction Ships button… or use the 'Y' key", "press the 'F2' key", "F12", "F11", "F4", "F6", "F5", "F8", "F9", "F10", "F3", "press the 'A' key", "F1").

## 6. SHIP MISSION UI (UI_ShipMissions + UI_ShipMissionTypes + code enums)

### 6.1 How mission assignment works

- Missions can be assigned to **any state-owned ship or base** — "this does NOT include privately-owned ships like freighters, mining ships or mining stations. You have no control over these privately-owned ships and bases. They go about their business automatically, selecting missions for themselves."
- Method 1: select the ship (left-click), then **right-click the target** → default mission (Move / Attack / Patrol / Build …) based on the hovered object; "Note that you may need to unpause the game to see the ship move."
- Method 2: **right-click the ship or base** → popup menu "listing a number of missions… specific to the particular type of ship or base. They may include: Exploration, Colonization, Building, Refueling, or many others."
- Method 3: **automate** — "Ships can also be completely automated. This means that they assign missions for themselves… select it and then press the 'A' key. To turn off automation just assign a mission to the ship. When a ship is automated a circular blue arrow appears in the bottom-right corner of the Selection Panel. Note that ALL ships start the game automated."
- Bases: "Although bases are stationary, they can also have missions. Base missions can include: building new ships, retrofitting to a new design or scrapping the base when it is no longer needed."
- Queuing: "Queue Next Mission" / "Clear All Queued Missions" — missions execute in order; the action menu groups related missions (e.g. "Return to base ({0})" with the gather point).
- Mercenary (player empires acting as hired muscle): "Assign Mercenary Attack Mission" / "Assign Mercenary Defense Mission" / "Assign Mercenary Smuggling Mission" + "Cancel Mercenary … Mission" items.

### 6.2 All mission types

The code enum `BuiltObjectMissionType` (31 values): Undefined, **Explore, Build, BuildRepair, Transport, Patrol, Escort, Rescue, Blockade, Attack, Escape, Retire, Retrofit, Colonize, Waypoint, Hold, WaitAndAttack, WaitAndBombard, MoveAndWait, Refuel, ExtractResources, LoadTroops, UnloadTroops, Deploy, Undeploy, Repair, Move, Bombard, Capture, Reinforce, Raid**.

The 17 player-facing missions (UI_ShipMissionTypes.mht, verbatim summaries) and how each dialog works:

1. **Move** — "moves the ship to the target location" — right-click anywhere.
2. **Explore** — "explores the target location, revealing… systems" — submenu "Nearest unexplored system" / target system.
3. **Patrol** — "patrols the target area" watching for attackers — hover your colony/base/fleet; engagement stance applies.
4. **Escort** — "escorts the target ship" — target selection = pick a ship (auto-generated escort ships for convoy); sub-options on destination ("Move to mouse cursor location", "Move to selected item").
5. **Attack** — "attacks and destroys the target" — submenu "Prepare and Attack" (WaitAndAttack: fleet assembles before engaging) and "Prepare and Bombard"; target must be an enemy.
6. **Bombard** — "bombards the target colony from orbit, destroying surface facilities and population" — requires bombard weapons.
7. **Capture** — "boards and captures the target ship or base" — requires boarding-assault strength; captured assets can be "Enlist captured Military ships / Civilian ships / Bases" or "Scrapped" ("Captured Ship Scrapped" / "Captured Base Scrapped").
8. **Raid** (pirates) — "raids the target, stealing resources and troops".
9. **Blockade** — "blockades the target system/colony" (only vs. empires under your trade sanctions).
10. **Escort/Patrol stances**: per-ship **engagement stance** (`BuiltObjectStance`: DoNotAttack / AttackIfAttacked / AttackEnemies / AttackUnallied) cycled with comma; defaults per mission type from Empire Settings.
11. **Refuel** — "refuels at the target refuelling point" — submenus "At nearest refuelling point", "Refuel all ships" (fleet), "at X".
12. **Repair** (BuildRepair) — "repairs damaged components" — "At X", "At nearest ship yard", "At your nearest Space Port".
13. **Build** — construction ships: "Build here", "Build at X", "Queue nearest Construction Ship to build Mining Station here", "Queue construction ship to build a DESIGN here" (mining stations, space ports at colonies, pirate bases).
14. **ExtractResources / mining** (private mining ships automate this; player ships can "Mine X").
15. **Transport / LoadTroops / UnloadTroops** — "Load troops at X" / "Unload troops at X" (sub: "At nearest colony with available troops"); troop transports shuttle garrison troops.
16. **Colonize** — colony ships: "Colonize X", "Build new Colony Ship and Colonize X" (auto-queue a colony ship at a colony), status lines "SHIPNAME colonizing PLANETNAME" / "…building at COLONY to colonize PLANETNAME"; the ship is consumed (or partially — resources kickstart the colony).
17. **Deploy / Undeploy** (troop transport deploy mode), **Hold/Waypoint/MoveAndWait**, **Escape** (E key), **Retire** ("Retiring ships permanently removes them from the game" — confirmation), **Retrofit** ("Retrofit to latest designs" / "Retrofit Selected Items to New Design" via the Retrofit screen), **Reinforce** (fleet), **Rescue** (distress signals: "Under Attack", "Need Refuelling", "Need Repair", "Galactic Disaster", "Colony Bombarded" — `DistressSignalType`).

### 6.3 Fleet missions & tactics

Fleet action items: "New Fleet" (from selected ships, via Action button or right-click → "Join Fleet"), "Join Fleet" (submenu of all fleets + "(New Fleet)" + "Nth Fleet"), "Leave Fleet" ("Leave FLEETNAME"), "Make lead ship for FLEETNAME", "Disband Fleet", "Retrofit fleet to latest designs", "Refuel and Repair Fleet". Fleet properties: **posture** (Attack/Defend), **range**, **home base** ("Set Home Base" — "valid home base is friendly refueling point"), **target** ("Set Attack Target" — "valid target is colony or base of another empire"), **tactics** (`BattleTactics`: Evade / Standoff / All Weapons / Point Blank). "Fleet Attack Settings": assemble threshold ("First assemble when this percentage of fleet dispersed"), refuel threshold ("First assemble when this percentage of fleet need fuel"), "Attack OverMatchFactor" (firepower overmatch, e.g. 2:1). Automated fleets intercept: "Your automated fleets will respond to intercept enemy attacks when there are insufficient forces to defend the target. The nearest available automated fleet will travel to the attack location and defend the target."

### 6.4 Mission UI dialogs

- Mission **queue view** (`BuiltObjectMissionView`) lists current + queued missions with target, priority, ETA; hover shows details.
- **Mercenary smuggling setup** (`pnlPirateSmugglingMissionResourceSelection`): resource dropdown, amount, bid ("Bid PRICE credits"), "for X credits per 100 units", "Smuggling Mission for RESOURCE for PRICE"; "Delivery Report" messages on completion ("Smuggling Mission Delivery Report", "…Report For Requester").
- **Escort target selection**: from the Escort submenu or "Set Attack Target"/home-base dialogs; the dialog lists candidate ships/targets (e.g. "Assigned to: EMPIRE", "Current bid: EMPIRE").

## 7. TUTORIALS (all 11, from the in-game tutorial scripts)

The tutorial system shows a draggable **tutorial window** (`pnlTutorial`) with step text and a **'Continue'** button ("To progress through each step of this tutorial click the 'Continue' button. You can move this tutorial window by dragging it with the mouse."). Launched from the main menu's Tutorials list; each corresponds to a `TutorialItemList` (Tutorial.cs). Systems covered:

1. **basic.txt** ("Distant Worlds Tutorial" / the core intro): the four key areas ("Explore the galaxy, Colonize new planets, Extract valuable resources, Defend your empire"); moving around (edge-scroll, arrow keys, right-drag); zooming (mouse wheel, PageUp/PageDown, ZoomIn/ZoomOut buttons); **system view** (identify colonies/ships by empire main color; Ctrl-click to zoom in); **sector view** (systems as icons; "The icon color indicates which empire the ship or base belongs to"); explored systems show names, unexplored don't; colonized systems "circled with their empire's color… The size of the circle indicates the system's relative importance"; **Empire Territory** ("Systems that are part of an empire's territory have a colored background… Colonies project their empire's influence into nearby systems"); independent systems "circled with a solid grey line… the aliens provide a critical boost to the population"; potential colonies "indicated by a dashed grey circle… Build a new colony ship and send it to these uninhabited planets"; **zoom presets** (100%, system, sector, galaxy); **Galactopedia** (F1/Help button, context-sensitive help); main screen elements; cycle buttons and hotkeys (C, P, M, Y, X, I — "Use the Cycle Construction Ships button… or use the 'Y' key"); military ship missions (Attack, Patrol, Escort); finding idle ships (I key); ending: try the Advanced Tutorial.
2. **FindingYourWayAround.txt**: same movement/zoom/navigation material as basic (the "find your way around" variant), plus main-screen elements.
3. **EmpireAndColonies.txt**: Empire Summary (F6); **State vs Private** ("Your empire is divided into two sections: State: the portion you control, Private: your private citizens who go about their own business without your help"); private citizens "trade goods, transport cargo and mine resources - all without any intervention from you"; state's four tasks; **government style** ("You can change your government style by having a revolution. But there are negative side effects from revolution, including a temporary setback of development at your colonies"); **state income** (colony taxes, space port transaction fees, purchases of new ships by private citizens, bonuses from trade with other empires); **colonies** ("Colonies are the heart of your empire. When you lose all of your colonies, you lose the game."); taxes (auto by default, per-colony override); growth (population to planet max; development level from luxury resources → more wealth → more tax); **population indicator** ("The population size and development level of a colony is indicated by the graph displayed in the colony's name badge. The horizontal axis indicates the population size. The vertical axis relates to the development level."); **empire & capital** ("the color of the surrounding circle and name badge… If the colony is the empire capital a gold star also appears to the left of the name"); **dominant race** and **resources** at the bottom of the name badge (auto-mined, used or sold); **colony list** (Colonies screen, F2) and cycling (C key).
4. **ShipsAndMissions.txt**: ships travel "performing a wide range of tasks, from transporting cargo to defending your empire"; bases "are fixed platforms in space, usually located at a planet"; Ships and Bases screen (F11); Designs screen (F8); mission assignment: state ships only, not private; "To assign a mission to a ship first select it… Then right-click the mouse over the mission target"; popup menu on right-click of the ship ("Exploration, Colonization, Building, Refueling, or many others"); **automating** ("press the 'A' key… a circular blue arrow appears in the bottom-right corner of the Selection Panel… ALL ships start the game automated"); base missions (building, retrofitting, scrapping); ship classes: Exploration ships (chart unknown areas; X key), Colony ships (consumed on colonization, "The resources from the ship are used to give the colony a kickstart… Colony ships can only be built at colonies"; start with native planet type; can always colonize planets with independent alien populations "the preexisting population may resist your colonization attempt, with the loss of your colony ship"), Construction ships (build bases/mining stations), Space ports (at colonies: "build new ships, repair and retrofit ships, refuel ships, and conduct research"), Mining ships/stations, Freighter/passenger, military classes (Frige/Destroyer/Cruiser/Capital etc.), fleets ("Fleets: group military ships… assign a mission to the whole fleet"), troop transports.
5. **FleetsTroops.txt** ("Fleets, Troops and Intelligence missions"): fleet management (F12) — "Fleets are groups of military ships… select at least one military ship… 'New Fleet'"; fleet posture/range/target; strike forces vs large fleets; automated fleet response to attacks; **troops**: "Troops are the soldiers you use to invade enemy colonies and to defend your own"; recruiting/garrisons/disbanding (Colony screen → Troops tab; right-click colony); troop types (Infantry, Artillery, Armored, Special Forces); troop transports ("Load troops" / "Unload troops"); invasion flow (load → move → unload at enemy colony → ground combat); **intelligence**: "Intelligence agents are specially trained specialists that you use to accomplish these missions. Your agents can be managed from the Characters screen (F4 key)"; assigning missions: "The Mission summary panel at the bottom-right of the screen allows you to assign missions to agents. Select a target empire for the mission and a mission type. The more time you allow for the mission, the greater the chance of success."; **counter intelligence**: "You can assign agents to prevent enemy intelligence missions… Beware of the negative fallout from botched intelligence missions - if another empire discovers your actions against them it will dramatically lower their estimation of your empire, and could even lead to war."
6. **ExpansionDiplomacy.txt**: using the **Expansion Planner** (F3: resource supply vs demand, "Potential Colonies" / "Potential Mining Locations" lists, send colony/construction ships); diplomacy basics (F5: relations, "Speak" to empires, treaties — alliance/defense pact/free trade/trade sanctions, gifts, warnings); expanding territory; pre-diplomacy context (meet empires, choose peace or war).
7. **ResearchDesign.txt**: **research** — three tech areas (Weapons, Energy, HighTech) each with a tech tree (F7); queueing projects; prerequisites (red lines); crash research (3× for credits, lightning icon); research stations near bonus locations (neutron stars, supernovae, black holes); natural limit; **ship design** (F8): create new designs, add/remove components (categories), sizes (small/medium/large), costs vs performance; warnings (red = rules, yellow = recommendations); **construction** — three ways: right-click Build, Construction Yards screen (F10, "Purchase" button, "If you cannot afford to build the selected ship your Available Funds will flash red"), **Build Order screen** (F9: "you can see your current levels for each ship type, as well as the number of new ships suggested by your advisors. You can modify the amount of ships for each type, and select a specific design to build. When you are satisfied with the order, click the 'Purchase' button").
8. **DealingWithPirates.txt**: pirates don't colonize (they use spaceports anywhere); pirate income (controlled colonies, protection agreements, pirate missions, mining, raids); **protection agreements** (monthly fee; "You can offer protection agreements from the Diplomacy screen (F5)… can pave the way to a mutually-beneficial long-term relationship… Defense Missions"); truces between pirate factions; **pirate missions** (attack/defend/smuggling offered by standard empires & independents — "Pirate Missions panel in the Empire Navigation Tool", "Bid", "Accept"); defending against pirates; playing as pirate.
9. **PlayAsPirate.txt**: "Pirates differ from standard empires in a number of important ways. A major difference is that pirates usually do not have colonies. Instead they start with a spaceport at a gas giant planet. Pirates cannot colonize planets. But they can build spaceports anywhere."; starting spaceport (build/repair/retrofit/refuel; Pirate Leader based there); construction ships (pirates start with one; "pirates cannot build additional Construction Ships. So protect your starting Construction Ship well… however pirates can board and capture Construction Ships"); income sources; controlled colonies ("The more military strength they have near a colony, the faster their level of control will increase, topping out at 100%… multiple pirate factions can control a colony at the same time… very large colonies have a lower maximum control level"); Pirate Base (control ≥50%) / Pirate Fortress (control =100%); protection agreements & truces; pirate missions (accept from the list; smuggling bid process); raids; pirate victory ("Pirate factions compete against other pirate factions to achieve victory, NOT against standard empires").
10. **PreWarpEmpire.txt**: playing the Age of Shadows pre-warp scenario: "You are a young empire without faster-than-light travel. Your goal is to expand your territory within your home star system and prepare for the rediscovery of warp drive"; research **Hyperdrive** ("research the technology to jump between stars… once achieved you can then begin expanding to other star systems"); then **Colonization** tech; "Once these two key breakthroughs are reached you are well on your way to becoming a mighty stellar empire!"; then "spread your territory across the galaxy… encounter other empires and pirate factions, leading to peaceful cooperation and sharp conflict"; reminder: Galactopedia F1.
11. **advanced.txt** ("Advanced Tutorial"): the full advanced loop — starting with the pre-warp setup context, exploring, colonizing, building mining infrastructure, researching, ship design & construction, fleets, diplomacy/intelligence, pirates, and the path to galactic victory; combines and extends all of the above.

## 8. MESSAGES & ALERTS (message system, alerts, pings)

### 8.1 Architecture

Three independent channels (UI_Messages.mht):
1. **Scrolling message panel** — "at the top of the main view… displays the five most recent messages in the galaxy affecting you or your empire… Click on a message to move to the location of the message event or to open an appropriate screen" (`lstMessages`, `ScrollingLinkList`; each row is a clickable link).
2. **Popup messages** — "appears in a popup panel that slides in at the right of the screen" (`pnlMessagePopup`, `MessagePopup`); clicking a popup jumps to the event location; includes "Under attack!" style alerts; each category individually enable-able (Message Settings).
3. **Message History** (H) — full log; "you can review individual messages by selecting them in the list at the left. The body of the message then appears in the area in the middle of the screen. If a message has a related location in the galaxy, this location is displayed on the galaxy map at the right. You can also jump directly to this location in the main view by clicking the button below the galaxy map." Filter: "You can exclude battle messages, or you can choose to view messages relating to Galactic History."

Plus, outside these three channels: the **advisor suggestion popup** (`pnlAdvisorSuggestion` — Approve/Decline/Show), **event decision popups** (`pnlEventMessage` — Investigate/Avoid/Go to/Close; e.g. "When encounter Ruins", "When encounter Abandoned Ship or Base"), **story event overlays** (`pnlStoryEvent`), the **diplomatic message queue** (top-right stack — "Outstanding requests in your empire" / "in the galaxy"), and **pings**: message locations show **dashed blue expanding circles** ("When a message with a location is displayed… a dashed blue circle expands at that location"); ENT hover shows **yellow circular pings**. "Suppress all pop-up screens" (game option) silences popups (code enforces discovery-action defaults when enabled); "Auto Pause in Game Screens" / `AutoPauseWhenInPopupWindow` pauses the game while popups are open; "Loaded games are paused".

### 8.2 Message categories (Message Settings screen; `GameOptions` boolean pairs DisplayMessage/DisplayPopup)

**Scrolling & popup toggle categories** (each appears as a checkbox in both lists):
- "BuiltObjectBuilt" → New Ship Built
- Diplomacy: "DiplomacyGift" (Diplomatic Gifts), "DiplomacyTreaty" (Treaties), "DiplomacyWarTradeSanctions" (War and Trade Sanctions), "DiplomacyEmpireMetDestroyed" ("New Empire" / empire defeated), "DiplomacyRequestWarning" (Requests, Warnings and Gifts)
- "NewColony" (New Colony / "Newly Colonized")
- "ColonyInvaded" (Colony Invaded)
- "ResearchNewComponent" (Research Breakthrough / "Research")
- "IntelligenceMissions" (Intelligence Missions)
- "Exploration" (Exploration discoveries / "Empire Discovery")
- "ShipMissionComplete" (Ship Mission Complete)
- "ShipNeedsRefuelling" (Ship Needs Refuelling or Repair)
- "ConstructionResourceShortage" (Construction Resource Shortage)
- **Under Attack categories** (popup list): "Under Attack - Civilian Ships", "Under Attack - Civilian Bases", "Under Attack - Exploration Ships", "Under Attack - Military Ships", "Under Attack - Research, Monitoring, Resorts" (code: `UnderAttackCivilianShips`, `UnderAttackCivilianBases`, `UnderAttackExplorationShips`, `UnderAttackColonyConstructionShips`, `UnderAttackMilitaryShips`, `UnderAttackOtherStateBases`, `UnderAttackColoniesSpaceportsDefensiveBases`).

### 8.3 All message types (EmpireMessageType — 95 values, grouped)

- **Diplomacy**: DiplomaticRelationChange, ProposeDiplomaticRelation, AcceptDiplomaticRelation, RefuseDiplomaticRelation, RemoveColoniesFromSystem, StopMissionsAgainstUs, StopAttacks, LeaveSystem, RequestJointWar, RequestJointTradeSanctions, RequestStopWar, RequestLiftTradeSanctions, GiveGift, Informational, RequestHonorMutualDefense, BlockadeInitiated, BlockadeCancelled, OfferTrade, RemoveForcesFromSystem, MilitaryRefuelingAllowed/Blocked, MiningRightsAllowed/Blocked, PirateOfferProtection, CancelPirateProtection.
- **Construction/empire**: ShipBaseCompleted, ShipBasePurchased, NewColony, NewColonyFailed, ShipBaseScrapped, ColonyFacilityCompleted, ColonyFacilityCancelled, ColonyWonderBegun, ColonyShipMissionCancelled, PlanetaryFacilityDestroyed, PlanetaryFacilityDamaged, ConstructionResourceShortage.
- **Combat**: ResearchBreakthrough, BattleUnderAttack, BattleAttacking, IncomingEnemyFleet, ColonyGained, ColonyLost, ColonyDefended, ColonyRebelling, Revolution, ColonyDestroyed, ShipBaseBoardedCaptured, ShipBaseBoardedLost, RaidBonuses, RaidVictim.
- **Characters/agents**: CharacterAppearance, CharacterDeath, CharacterMissionAccomplished, CharacterMissionFailure, CharacterSkillTraitChange.
- **Exploration/intel**: EmpireDiscovered, ExplorationRuins, ExplorationBuiltObject, ExplorationHabitat, ExplorationLocation, RestrictedResourceDiscovered, RestrictedResourceTradingAllowed/Blocked, SellInfoUnmetEmpire / SellInfoIndependentColony / SellInfoSystemMap / SellInfoRuins / SellInfoDebrisField / SellInfoRestrictedArea / SellInfoPlanetDestroyer.
- **History/story**: GalacticHistory, GalacticNewsNet, StoryMessage, HistoryOfferLocationHint, HistoryOfferStoryClue.
- **Ship state**: ShipMissionComplete, ShipNeedsRefuelling, ShipNeedsRepair.
- **General**: GeneralWarning, GeneralBadEvent, GeneralNeutralEvent, GeneralGoodEvent, GeneralDecision.
- **Advisor**: AdvisorSuggestion (→ advisor popup).
- **Pirate**: PirateAttackMissionAvailable/Completed/Failed, PirateDefendMissionFailed/Available/Completed, PirateSmugglingMissionAvailable/Completed, PirateSmugglerDetected.
- **Empire-level**: EmpireDefeated (e.g. "Empire Defeated!").

`EventMessageType` additionally classifies scripted game-event messages; `DistressSignalType` (Under Attack, Need Refuelling, Need Repair, Galactic Disaster, Colony Bombarded) drives distress-signal pings; `AdvisorMessageType` (32 values: BuildOrder, BuildOneOff, Colonization, IntelligenceMission, EnemyAttack, EnemyBombard, EnemyBlockade, EnemyAttackPlanetDestroyer, InvadeIndependent, PrepareRaid, DiplomaticGift, TreatyOffer, WarTradeSanctions, ColonyFacility, Offer/Cancel MilitaryRefueling, Offer/Cancel MiningRights, Allow/Disallow TradeRestrictedResources, ComplyTradeSanctionsOther, ComplyWarOther, DefendTerritory, Retrofit, RequestLiftTradeSanctionsOther, RequestEndWarOther, OfferPirateAttack/Defend/SmuggleMission, PirateRaid, PirateFacilityEradicate, AcceptPirateSmugglingMission, DefendTarget) drives advisor suggestions.

### 8.4 How popups are triggered (code flow)

`Game.ReceiveMessage` → `Main.ReceiveMessage`/`PromptForAuthorization` (Main.Part9) decides per category: if the category's popup option is on and the game isn't suppressing popups → show `MessagePopup` (right-side slide-in) and optionally pause (`AutoPauseWhenInPopupWindow`); the message is always appended to the scrolling list (if the scrolling option is on) and to the message-history log; messages with a `location` also spawn a location ping; diplomatic messages additionally feed the top-right `DiplomaticMessageQueue`; advisor messages open the advisor suggestion panel; discovery encounters ("When encounter Ruins / Abandoned Ship or Base") respect the player's DiscoveryAction settings ("Ask what to do" opens the `pnlEventMessage` dialog with Investigate/Leave-alone/Avoid options).

---

### Appendix A — Source locations for the facts above

- Wizard: `DistantWorlds/Start.cs` (labels, sliders, SetLabels at lines ~2848–3472; victory ~3640–3740; start-location lists in `Start.1.cs:3995–4035`; engagement stances `Start.1.cs:5001–5019`; discoveries `Start.1.cs:4783–4802`; threshold items `Start.InitializeComponent.cs:2883`; automation modes `Main.InitializeComponent.cs:10999`).
- Main form: `Main.InitializeComponent.cs` (all 989 control fields), `Main.Part2–13.cs` (screens, menus, messages, game flow; game end `Main.Part12.cs DoGameEnd`, story overlay `Main.Part4.cs method_572`), `MainView.cs/1/2` (rendering), `HoverPanel.cs`, `ItemListPanel.cs`, `ItemListCollectionPanel.cs` (ENT; geometry `Main.Part12.cs:2268`, sizing `Main.Part2.cs method_666`), `DiplomaticMessageQueue.cs`.
- Enums/types: `DistantWorlds.Types/` (EmpireMessageType, AutomationLevel, AdvisorMessageType, BuiltObjectMissionType, BuiltObjectStance, BattleTactics, ColonyPopulationPolicy, CharacterRole/SkillType/TraitType, DistressSignalType, GameOptions, Hotspot, StartGameOptions, VictoryConditions).
- Controls: `DistantWorlds.Controls/Controls/` (193 classes), `CustomDataGridViewElements/`, `CustomMessageBox/`.
- Help: `dwu-research/help_all.txt` (all Galactopedia articles; UI_*, Screen_* extracted in `dwu-research/sections/_work/help_ui.md`).
- Tutorials: the 11 .txt scripts in the game's Tutorial folder (quoted above).

---

## PART 13 — DATA FILE FORMATS (the modding/content surface)

All game content is defined in plain-text files loaded at startup (and overridable by the active theme). The re-implementation MUST load exactly these files in these formats (the user's existing game folder is the reference dataset):

### 14.1 races.txt — one line per race (max 30), comma-separated, in fixed order (races must NOT be reordered; per-race override files also live in races/<name>.txt with the same fields as `Name ;value` lines). Fields:
`Name, PictureIndex (0-based index into images/units/races), RaceFamilyID, ReproductionRate (annual population growth, 1.0-1.5), Intelligence (50-150, 100=normal), Aggression (50-150), Caution (50-150), Friendliness (50-150), Loyalty (50-150), DesignsPictureFamilyIndex (0-50, ship art family folder), DesignNamesIndex (0-50), ShipMaintenanceSavings% (0-100), TroopMaintenanceSavings% (0-100), ResourceExtractionBonus% (0-100), WarWearinessAttenuation% (0-100), SatisfactionModifier% (0-100), ResearchBonus% (0-100), EspionageBonus% (0-100), TradeBonus% (0-100), OverallShipDesignFocus (0=Balanced,1=Speed/Agility,2=Power,3=Efficiency), TechFocus1 (0=None,1=Beams,2=Torpedoes,3=Missiles,4=Area,5=Ion,6=Fighters,7=Shields,8=Reactors,9=Engines,10=HyperDrives,11=HyperDisruption,12=Construction,13=Computers,14=Sensors), TechFocus2 (same codes), NativePlanetType (0=Continental,1=MarshySwamp,2=Desert,3=Ocean,4=Ice,5=Volcanic), SpecialComponent (0=None,1=DeathRay,2=DevastatorPulse,3=SuperLaser,4=StarBurnerXX-12,5=TurboThrusterER7,6=SwiftVector5000,7=MegatronZ4,8=NovaCoreNX-700,9=VelocityDriveST3,10=ShadowGhostECM2000,11=ShakturFireStorm,12=HighDensityFuelCell,13=S2F7RepairBot,14=PulseWaveCannon,15=RaptorTargetting), SpecialGovernment (0=None,1=Technocracy,2=HiveMind,3=MercantileGuild,4=UtopianParadise,5=WayOfTheAncients,6=WayOfDarkness,7=Despotism,8=Feudalism,9=Monarchy,10=Republic,11=Democracy,12=MilitaryDictatorship), PreferredStartingGovernment (same codes), Expanding (Y/N — N = static empire), CanBePirate (Y/N), Playable (Y/N), DefaultPrimaryColor (0-19), DefaultSecondaryColor (0-20), DefaultFlagDesign (0-38), HomeSystemName, TroopName`

Race behavioral effects (implemented exactly): Intelligence → research speed, troop strength, gift-sensitivity, tax caution. Aggression → military building, war likelihood, troop strength. Caution → caution in combat/diplomacy. Friendliness → treaty likelihood. Loyalty → treaty-honoring. Race-specific modifiers apply to the whole empire (maintenance savings, extraction, research, espionage, trade, happiness, war weariness). Native planet type = homeworld surface (and preferred colonization). Special component = a unique super-weapon/engine/shield/etc. only that race can build (race-limited in design editor). Special government = that government only available to the race.

### 14.2 raceFamilies.txt — `ID, Name, SpecialFunctionCode` (0=None,1=ShakturiLikes,2=ShakturiHates). The 7 families: Humanoid, Ursidian, Insectoid, Reptilian, Amphibian, Rodent, Machine.
### 14.3 raceBiases.txt — 24×24 matrix, row race feels towards column race, range -50..+50 (full matrix in Content section).
### 14.4 raceFamilyBiases.txt — 7×7 matrix, range -30..+30 (full matrix in Content section).
### 14.5 governments.txt — one line per government (max 30): `ID, Name, Corruption (0-3, 1=normal), WarWearinessRate (0-3), MaintenanceCosts (0-3), ApprovalRating (0-3), PopulationGrowth (0-3), ResearchSpeed (0-3), TroopRecruitment (0-3), TradeBonus (0-3), LeaderReplacementLikeliness (0-3), LeaderReplacementDisruptionLevel (0-3), LeaderReplacementBoost (0-3), LeaderReplacementCharacterPool (0=None,1=Governors,2=Admirals/Generals,3=Scientists), LeaderReplacementManner (0=replacement,1=coup,2=election), Stability (0-3, resistance to foreign-instigated revolution), OwnReputationConcern (0-2), OtherEmpireReputationImportance (0-2), SpecialFunctionCode (0=None,1=NationalizePrivateSector), Availability (0=all,1=race-specific,2=ancient-guardians-only,3=shakturi-only), 5×NameAdjectives (comma-joined, may be empty), NameNouns (comma-joined)`.
### 14.6 governmentBiases.txt — 13×13 matrix, range -30..+30 (full matrix in Content section).
### 14.7 components.txt — one line per component (max 500): `ID, Name, PictureRef (ui/components index), SpecialImageIndex (per-type effect art set: engine thrust / hyperjump anim / weapon effect art), SoundEffectFilename (weapons only), Type (see code list below), Category, Industry (0=Weapons,1=Energy,2=HighTech), Value1..Value7 (meanings per Type below), then up to 5 (ResourceId, Amount) manufacturing cost pairs`.
Type codes: 0=AreaShieldRecharge, 1=Armor, 2=AssaultPod, 3=CargoBay, 4=ColonizationModule, 5=CommandCenter, 6=CommerceCenter, 7=ConstructionYard, 8=Countermeasures, 9=CountermeasuresFleet, 10=DamageControl, 11=DockingBay, 12=EnergyCollector, 13=EnergyToFuel, 14=EngineMainThrust, 15=EngineVectoring, 16=ExtractorGas, 17=ExtractorLuxury, 18=ExtractorMine, 19=FighterBay, 20=FuelCell, 21=HabModule, 22=HyperDeny, 23=HyperDrive, 24=HyperStop/GravityWellProjector, 25=LifeSupport, 26=LongRangeScanner, 27=ManufacturerEnergy, 28=ManufacturerHighTech, 29=ManufacturerWeapons, 30=MedicalCenter, 31=PassengerCompartment, 32=ProximityArray, 33=Reactor, 34=RecreationCenter, 35=ResearchLabEnergy, 36=ResearchLabHighTech, 37=ResearchLabWeapons, 38=ResourceProfileSensor, 39=ScannerJammer, 40=Shields, 41=Stealth, 42=Targeting, 43=TractorBeam, 44=TroopCompartment, 45=WeaponArea, 46=WeaponBeam, 47=WeaponBombard, 48=WeaponIonCannon? — implement the full code list as listed in the original file header (all weapon types: Area, Beam, Bombard, Countermeasures, Ion Cannon, Ion Pulse, Missile, PointDefense, Phaser, RailGun, Torpedo, plus gravity weapons and super weapons).
Value1-7 meanings (exact, from the file header):
- Area Shield Recharge: V1=recharge range, V2=max recharge amount, V3=energy for full recharge.
- Armor: V1=rating, V2=reactive rating.
- Assault Pod: V1=assault strength, V2=boarding range, V3=energy per launch, V4=movement speed, V5=shield penetration, V6=launch rate (ms).
- Cargo Bay: V1=cargo capacity.
- Colonization Module: V1=population of new colony (millions).
- Command Center: V1=maintenance savings %.
- Commerce Center: V1=trade bonus %.
- Construction Yard: V1=construction speed.
- Countermeasures: V1=countermeasures bonus %.
- Damage Control: V1=damage reduction %, V2=seconds to repair one damaged component.
- Docking Bay: V1=cargo throughput.
- Energy Collector: V1=energy collection rate.
- Energy To Fuel: V1=fuel production rate.
- Engine Main Thrust: V1=max thrust, V2=energy/s at max, V3=cruise thrust, V4=energy/s at cruise.
- Engine Vectoring: V1=thrust, V2=energy/s.
- Extractors (gas/luxury/mine): V1=extraction rate.
- Fighter Bay: V1=fighter storage capacity, V2=repair rate (%/s; manufacture rate = half).
- Fleet Countermeasures / Fleet Targeting: V1=bonus % for the fleet.
- Fuel Cell: V1=fuel storage capacity.
- HyperStop/Gravity Well: V2=hyper-stopping range.
- Hab Module / Life Support: V1=support size (population supported).
- Hyper Deny: V2=range, V3=energy when operational.
- Hyper Drive: V1=top speed, V2=energy/s, V3=jump initiation time (s).
- Ion Defense: V1=ion defense strength.
- Long Range Scanner / Proximity Array (V1=scan range, V2=hyperjump tracking % for proximity array) / Resource Profile Sensor / Trace Scanner (V1=range, V2=power): as listed.
- Manufacturer: V1=manufacturing speed.
- Medical Center: V1=effectiveness.
- Passenger Compartment: V1=passenger capacity.
- Reactor: V1=energy output/s, V2=storage capacity, V3=fuel to full charge, V4=fuel resource ID.
- Recreation Center: V1=recreation value.
- Research Labs (3 types): V1=research output.
- Scanner Jammer: V1=jamming power.
- Shields: V1=max strength, V2=recharge rate/s.
- Stealth: V1=stealth rating.
- Targeting: V1=targeting bonus %.
- Tractor Beam: V1=power, V2=range, V3=energy per firing, V4=projection speed, V5=power loss per 100 range, V6=fire rate (ms).
- Troop Compartment: V1=troop size capacity.
- Weapons (beam/missile/torpedo/phaser/rail/ion/super...): V1=damage, V2=range, V3=energy per firing, V4=projectile/movement speed, V5=damage loss per 100 range, V6=fire rate (ms), V7=bombard damage amount.
- Area Gravity Weapons: V1=damage, V2=range to epicenter, V3=energy, V4=expansion speed (V2/V4 = firing duration), V5=pull range, V6=fire rate (ms), V7=damage range from epicenter.

### 14.8 fighters.txt — one line per fighter (max 30): `ID, Name, Type (0=interceptor [targets fighters], 1=bomber [targets ships/bases]), TechLevel (AI builds highest researched), EnergyCapacity, EnergyRechargeRate, TopSpeed (attacking speed; otherwise half speed), TopSpeedEnergyConsumptionRate (half at half speed), AccelerationRate (5-100), TurnRate rad/s (0.5-6.28), EngineExhaustImageIndex, ShieldsCapacity, ShieldRechargeRate, DamageRepairRate (0-10; 1 = 10%/s), CountermeasureModifier% (0-99), ArmorRating, Weapon1Id+values..., Weapon2...` (two weapon slots, each a fighter weapon ID from the fighter weapon list).
### 14.9 facilities.txt — one line per planetary facility/wonder (max 50): `ID, Name, Type (0=TroopTrainingCenter,1=RoboticTroopFoundry,2=CloningFacility,3=PlanetaryShield,4=GiantIonCannon,5=RegionalCapital,6=FortifiedBunker,7=TerraformingFacility,8=WONDER,9=PirateBase,10=PirateFortress,11=ArmoredFactory,12=SpyAcademy,13=ScienceAcademy,14=NavalAcademy,15=MilitaryAcademy,16=PirateCriminalNetwork), WonderType (1=EmpirePopulationGrowth,2=EmpireHappiness,3=EmpireResearchWeapons,4=EmpireResearchEnergy,5=EmpireResearchHighTech,6=EmpireShipMaintenanceSavings,7=EmpireTroopMaintenanceSavings,8=EmpireTradeBonus,9=ColonyHappiness,10=ColonyPopulationGrowth,11=ColonyResearch,12=ColonyConstructionSpeed,13=ColonyTroopBonus,14=ColonyTradeBonus,15=EmpireResearchAll,16=EmpireAllMaintenance... — use the original file's full list), WonderTypeValue (multiplier or %), ConstructionCost, MaintenanceCost, BuildTimeDays, AllowedRaces (comma list or blank=all), RequiredResearch (project ID), Description`.
### 14.10 plagues.txt — one line per plague (max ~10): `ID, Name, NaturalOccurrenceRate (0-10; 0=never natural), MortalityRate (population lost per second, up to 100M), InfectionChance (0-1000; spread to nearby colonies), Duration (seconds of game time; 300 ≈ 6 months), CanCompletelyEliminatePopulation (Y/N; if N, population floors at 10M), ExceptionRaceName (blank=all same), ExceptionMortalityRate, ExceptionInfectionChance, ExceptionDuration, SpecialFunctionCode (0=None,1=XaraktorVirus [researchable+deployable]), Description (≤200 chars)`.
### 14.11 research.txt — grouped records, one per project:
```
PROJECT ; ID, Name, TechLevel (0-8; each level doubles default cost), Row, Industry (0=W,1=E,2=HT), Category (0=Armor,1=AssaultPod,2=Computer,3=Construction,4=EnergyCollector,5=Engine,6=Extractor,7=Fighter,8=Habitation,9=HyperDisrupt,10=HyperDrive,11=Labs,12=Manufacturer,13=Reactor,14=Sensor,15=ShieldRecharge,16=Shields,17=Storage,18=WeaponArea,19=WeaponBeam,20=WeaponGravity,21=WeaponIon,22=WeaponPointDefense,23=WeaponSuperArea,24=WeaponSuperBeam,25=WeaponTorpedo,26=WeaponSuperTorpedo), SpecialFunctionCode (0=None,1=PreWarpStartTech,2=PrimitiveHyperdriveLock,3=Superweapon,4=InitialColonizationTech,5=LockedUntilEvent), BaseCostMultiplierOverride
COMPONENTS ; up to 4 unlocked component IDs        (optional)
COMPONENT IMPROVEMENTS ; per component: ComponentId, TechLevel, Value1..Value7 improved values (optional)
FIGHTERS ; new fighter IDs                            (optional)
FACILITY ; facility/wonder ID                         (optional)
ABILITIES ; e.g. "Colonize X planets", "Increased Construction Size (2, tier, size)", "Dedicated Carriers", "Resupply Ships", troop upgrades, boarding improvements (optional)
PLAGUE CHANGE ; plague value overrides                (optional)
ALLOWED RACES ; race name filter                      (optional)
PARENTS ; parent project IDs, Y/N (all must be complete)
```
### 14.12 resources.txt — one line per resource (max 80): `ID, Name, PictureRef (ui/resources), BasePrice (price fluctuates with supply/demand), Type (0=Mineral,1=Gas,2=Luxury), SuperLuxuryBonusAmount (0-50; 0 = not super-luxury; colonies with it get development bonus), IsFuel (Y/N), IsImportantPreWarpResource (Y/N), ColonyGrowthResourceLevel (0-1.0 required level), ColonyManufacturingLevel (>0 = manufactured resource; value = population(billions)×development required), then 0+ prevalence rows: Type (0=Planet/Moon,1=Asteroid,2=GasCloud), SubType (0=Continental,1=MarshySwamp,2=Ocean,3=Desert,4=Ice,5=Volcanic,6=BarrenRock,7=GasGiant,8=FrozenGasGiant,9=Metal,10=Ammonia,11=Argon,12=CarbonDioxide,13=Chlorine,14=Helium,15=Hydrogen,16=NitrogenOxygen,17=Oxygen), Prevalance (0-1.0 chance; for super-luxury: sources per 700-star galaxy), AbundanceMin (0-1), AbundanceMax (0-1)`. Gas and mineral resources must never both be defined at the same location.
### 14.13 designTemplates/<race>/*.txt — 31 template files per race (BLANK, capitalship, carrier, colonyship, constructionship, cruiser, defensivebase, destroyer, energyresearchstation, escort, explorationship, frigate, gasminingship, gasminingstation, hightechresearchstation, largefreighter, largespaceport, mediumfreighter, mediumspaceport, miningship, miningstation, monitoringstation, passengership, [pirate/ folder], resortbase, resupplyship, smallfreighter, smallspaceport, trooptransport, weaponsresearchstation). Format: `ComponentCategoryName ;count` per line, for every category (AreaShieldRecharge, Armor, AssaultPod, CargoBay, ColonizationModule, CombatTargettingSystem, CommerceCenter, ConstructionYard, CountermeasuresSystem, DamageControl, DockingBay, EnergyCollector, EnergyManufacturingPlant, EnergyResearchLab, EnergyToFuelConverter, Engine, FighterBay, FleetCountermeasuresSystem, FleetTargettingSystem, FuelCell, GasExtractor, GravityWellProjector, HighTechManufacturingPlant, HighTechResearchLab, HyperDeny, IonCannon, IonDefense, IonPulse, LongRangeScanner, LuxuryResourceExtractor, MedicalCenter, MiningEngine, MissileWeapon, PassengerCompartment, PhasedBeamWeapon, PointDefense, ProximityArray, RailGun, Reactor, RecreationCenter, ResearchLabEnergy?, ResourceProfileSensor, ScannerJammer, Shields, Stealth, SuperAreaWeapon, SuperBeamWeapon, TraceScanner, TractorBeam, TroopCompartment, VectoringEngine). Auto-added: Command Center, Life Support, Hab Modules (sufficient counts), adequate Reactors/Energy Collectors, and exactly one HyperDrive per ship.
### 14.14 Policy/<race>.txt (and Policy/pirate/<race>.txt) — `SettingName ;value` lines, one per empire policy (full list in the AI/Automation section: ~100+ settings covering automation toggles, priorities 0.5-4.0, facility allowances + population thresholds, tax rates per colony size, construction levels and per-role military build counts, trade/tourism/war behaviors, population policies, wonder priorities, research industry focus, default flee-when, engagement stance, etc.).
### 14.15 Name pools: agentNames.txt, characterNames.txt, colonyNames.txt, shipNames.txt, systemNames.txt (one name per line — hundreds of names each; used for random naming of agents, characters, colonies, ships and systems). designNames.txt (per-race design name sets), Passengers.txt (passenger race names).
### 14.16 GameText.txt — all player-facing text: Galactopedia topic titles + article text, screen labels, message texts, race/government/component/creature/planet descriptions, dialog lines. Key-value lines `Topic ;text`.
### 14.17 Event/scenario files (game editor) — trigger conditions (object states/events) → action lists (immediate/delayed; target other objects; message, research, build, war, peace, plague, destruction, etc.) + scenario objectives (type, target, value) and results (victory/defeat/continue).
### 14.18 systems.txt — pool of ~600 fictional system names used when generating new system names (or the editor's "name systems" option).
### 14.19 Save format: full-state serialization (see Architecture); stats XML files sampled over time (state money, population, territory, research, military, etc. per empire) for the comparison screens and end-of-game report.
### 14.20 Startup.ini — optional `SCREENWIDTH/SCREENHEIGHT` (windowed, min 1024×768), `HYPERDRIVESPEED` (1.0-3.0 multiplier, new games only), `playmovie`.

---

## PART 14 — PRESENTATION AND ASSETS (what to create)

Generate an original 2D art and audio asset set in the classic DWU style (top-down, dark-space sci-fi, 2010s indie RTS look). Required asset inventory (the reference install's folder layout is the map of what exists):

### 15.1 images/
- **images/environment/**: `planets/` (per surface class: continental, forest, ocean, desert, ice, volcanic, marshy swamp, barren rock, gas giant, frozen gas giant, "other" — planet sprite + planetmap texture + ring variants), `landscapes/` (surface art per class + custom "other"), `stars/` (main sequence, red giant, supergiant, white dwarf, neutron + rays subfolder; black hole), `supernovae/` (Minor + full sets), `mapstars/` (galaxy-view star symbols incl. flares, blackhole), `nebulae/` (nebula cloud tileset), `asteroids/` (rocky, metal, ice), `ruins/` (ancient ruin sprites), `galaxybackdrops/` (background), `overlays/` (clouds, cloudssparse, damage, shadow — planet overlay layers), `planetaryfacilities/` (facility sprites incl. wonders and pirate facilities).
- **images/units/**: `ships/family0..family26` (per-race ship art families: frigate, destroyer, cruiser, capital ship, carrier, colony ship, construction ship, exploration ship, freighters, mining ship, gas mining ship, passenger ship, troop transport, resupply ship, space ports small/medium/large, defensive base, monitoring station, research stations ×3, resort base, generic base — each with engine exhaust + running light frames), `ships/other/MajorSets` (AncientHelpers, FreedomAlliance [+aged], PhantomPirates, Shakturi, ShakturiAllies), `ships/other/MinorSets` (bases + family0-6 minor units), `races/` (alien head sprites per race + pirate variants), `characters/` (character portraits: leader, ambassador, governor, scientist, admiral, general, intelligence agent, ship captain, pirate leader), `troops/` (troop type sprites), `creatures/` (ardilus, kaltor, sandslug, silvermist, spaceslug).
- **images/effects/**: `explosions/` (frame sets Expl01/01b/01c/01d/01e/02a-02d/05a-05e/07c-07h), `enginethrusters/` (thrust frames), `hyperenter/` + `hyperexit/` (per hyperdrive family: 0,1,2,3, calistadal, equinox, gerax, kaldos), `weapons/` (beam, area, missile/torpedo, ion, point-defense, tractor strike, super beam/area), `mining/`, `gasmining/`, `beacon/`, `construction/`, `scanners/`, `longrangescanners/`, `systeminfluence/`, `lights/`, `planetdestroy/`, `other/`.
- **images/ui/**: `chrome/` (panel chrome/skin), `components/` (one icon per component), `resources/` (one icon per resource), `shipsymbols/` (ship-type symbols), `cursors/`, `messages/` (message type icons), `achievements/`, `events/`, `plagues/`, `flagshapes/` (39 flag shapes + pirate variant), `ui` misc icons.
- **Fonts**: Normal, Bold, Small, Tiny + Title font (the original used XNB font assets — re-create equivalent TTF-based fonts).

### 15.2 Sounds
- **Sounds/Music/**: theme music (several era variants: Universe/Original/Legends/ROTS moods) + battle/action tracks with layered variants for intensity transitions (layered action tracks 1-5).
- **Sounds/Effects/**: weapon fire sounds (per weapon, e.g. laser.wav, laser2.wav, ...), explosions (multiple), hyperjump enter/exit, refueling, mining, tractor beam, UI clicks, message alerts.
- **movies/**: intro movie (short cinematic) played at startup (playmovie setting).

### 15.3 Rendering behavior
- Ships rotate to face velocity; engine exhaust particles when thrusting; weapon fire effects per type; explosions on damage thresholds; hull damage overlays; shield flicker when shields take hits; boarding action (crossed-swords symbol over target); nebulosity slows/darkens; supernovae radiation drains shields in blast radius; black holes annihilate ships crossing the event horizon; planetary shields (facility) show as domes; bombardment strikes visible; raid effects; plague visual on colonies; construction progress beacons.
- The galaxy view renders: sector grid, stars (per type), nebula clouds (noise-generated, multi-detail), system influence circles, territory coloring by owner (primary/secondary empire colors + flag shape), ping circles (blue dashed for new discoveries, yellow for navigation hovers).

---

## PART 15 — IMPLEMENTATION PLAN AND ACCEPTANCE CRITERIA

### 16.1 Recommended build order (milestones)
1. **M1 — Map & rendering core**: 2D world, zoom/pan/minimap, galaxy generation (all shapes, stars, planets, resources, nebulae, sectors), object rendering, fog of war/visibility, time system. *Accept: a generated galaxy looks right at all zoom levels; systems generate per the generation rules; visibility works per the rules.*
2. **M2 — Empires & colonies**: empire data model (race, government, leader, policies), homeworld setup, population model, attitude/development, resources at colonies, facilities, tax rates, state/private economy split, private freighter/mining simulation, resource prices. *Accept: a static 2-empire galaxy simulates growth, trade, and economy correctly over 100 game years without player input.*
3. **M3 — Ships & space ops**: ship design system + data, construction (yards, build times, cost), fuel/energy, engines/hyperdrive, all ship roles, movement, missions (all 20+), docking, cargo, refueling, repair/retrofit/scrap. *Accept: an empire can build, fuel, move, and repair ships; freighters trade.*
4. **M4 — Combat**: full combat model (all weapon types, shields/armor, point defense, fighters, boarding, bombardment, blockades, ground combat with all troop types, planetary defense interception), stances/tactics, fleet grouping, escape. *Accept: scripted battles resolve per the combat rules; boarding can capture a ship; invasions succeed/lose per ground combat math.*
5. **M5 — Research & progression**: research tree (337 nodes), crash research, research stations with location bonuses, component improvements auto-upgrading existing ships, ability unlocks (colonization types, construction size, dedicated carriers, troop types), fighter unlocks. *Accept: from a starting research level the empire can research through all trees; new tech changes designs/abilities.*
6. **M6 — Diplomacy & espionage**: relations, all message types, conversation dialog (offer/accept/decline logic), treaties with exact effects, reputation, gifts/warnings, war declaration/peace/subjugation, trade offers (resources/tech/designs/credits/passengers/troops/maps), intelligence missions (all 12 types, success/counter-intel math), pirate diplomacy (protection agreements, truces). *Accept: AI empires make treaties, declare wars, trade, and respond to the player's messages per the decision rules.*
7. **M7 — Full AI & automation**: empire automation (all domains, off/suggest/on), priorities, policies, force structure projection, fleet automation, construction automation, exploration automation, pirate AI (playstyles), space creatures, independent populations, AI difficulty scaling. *Accept: a fully automated 12-empire + pirates game plays itself to a winner at any victory setting with no player input.*
8. **M8 — Content & storylines**: all 24 races, 13 governments, 41 resources, 129 components, facilities/wonders, plagues, 31 design templates × 24 races, all 337 research nodes, all 60 race victory conditions, pirate playstyles, the five storylines (Shakturi invasion events, Ancient Galaxy, Shadows pre-warp, Legends events/disasters), achievements. *Accept: every content item listed in Part 13 exists and is reachable/usable.*
9. **M9 — UI completeness**: every screen/panel/button/list/overlay/hotkey from Part 12, message system, options (all), empire policy screen, expansion planner, galaxy map, game editor (place/erase/edit + events/scenarios), Galactopedia (all topics), 11 tutorials, quick-start presets. *Accept: every screen opens, displays live data, and every control works.*
10. **M10 — Persistence & modding**: full save/load (including mid-combat and pirate/creature state), autosave, stats XML, theme system (Customization folders, image/text/data overrides, hot-swap from menu), "use saved galaxy as map", moddable everything per Part 13. *Accept: save→quit→load continues seamlessly; a theme folder overrides art/text/data live.*

### 16.2 Cross-cutting quality gates
- **Performance**: ≥30 FPS on a large galaxy (1,000+ systems, ~40k+ objects, ~2k ships) at system zoom on reference hardware; galaxy zoom always smooth; no GC hitches (or equivalent) that stall the sim; nebula detail option actually degrades gracefully.
- **Stability**: a 200-game-year fully-automated stress game (max-size galaxy, max empires, all storylines on, pirates on) completes without crashes; save/load round-trips at random points mid-game.
- **Fidelity**: every numeric constant in this document (race stats, government multipliers, bias matrices, component values, treaty percentages, troop stats, plague parameters, research cost curve) is implemented exactly as given.
- **Completeness check**: run through the Definition of Done list in Part 0 with a scripted playthrough (menu → custom game with every option touched → mid-game with war, invasion, capture, trade, espionage, plague, storyline event, victory screen → load → mod/theme swap → game editor scenario → pirate game → pre-warp game).

## APPENDIX A — RACE DATA (races.txt — all 24 races, exact values)

### All 24 races (exact values from races.txt, Distant Worlds: Universe 1.9.5.0)

Fields per race (in file order):
Name, PictureIndex, RaceFamily(0=Humanoid,1=Ursidian,2=Insectoid,3=Reptilian,4=Amphibian,5=Rodent,6=Machine), ReproductionRate(annual growth, ~1.0-1.3), Intelligence(100=normal, 50-150), Aggression(100=normal), Caution(100=normal), Friendliness(100=normal), Loyalty(100=normal), DesignsPictureFamilyIndex(0-50), DesignNamesIndex(0-50), ShipMaintenanceSavings%, TroopMaintenanceSavings%, ResourceExtractionBonus%, WarWearinessAttenuation%, SatisfactionModifier%, ResearchBonus%, EspionageBonus%, TradeBonus%, OverallShipDesignFocus(0=Balanced,1=Speed/Agility,2=Power,3=Efficiency), TechFocus1(0=None,1=Beams,2=Torpedoes,3=Missiles,4=AreaWeapons,5=IonWeapons,6=Fighters,7=Shields,8=Reactors,9=Engines,10=HyperDrives,11=HyperDisruption,12=Construction,13=Computers,14=Sensors), TechFocus2(same codes), NativePlanetType(0=Continental,1=MarshySwamp,2=Desert,3=Ocean,4=Ice,5=Volcanic), SpecialComponent(0=None,1=DeathRay,2=DevastatorPulse,3=SuperLaser,4=StarBurnerXX-12,5=TurboThrusterER7,6=SwiftVector5000,7=MegatronZ4,8=NovaCoreNX-700,9=VelocityDriveST3,10=ShadowGhostECM2000,11=ShakturFireStorm,12=HighDensityFuelCell,13=S2F7RepairBot,14=PulseWaveCannon,15=RaptorTargetting), SpecialGovernment(0=None,1=Technocracy,2=HiveMind,3=MercantileGuild,4=UtopianParadise,5=WayOfTheAncients,6=WayOfDarkness,7=Despotism,8=Feudalism,9=Monarchy,10=Republic,11=Democracy,12=MilitaryDictatorship), PreferredStartingGovernment(same codes), Expanding(Y/N), CanBePirate(Y/N), Playable(Y/N), DefaultPrimaryColor(0-19), DefaultSecondaryColor(0-20), DefaultFlagDesign(0-38), HomeSystemName, TroopName

**Ketarov** — family: Ursidian, home system: Ketaros, troop: Ketarov Battle Group
  growth 1.12 | int 115 aggr 60 caution 117 friend 90 loyalty 70
  savings: ships 0% troops 0% | mining +0% | warwear -0% | happiness +0% | research +0% | espionage +50% | trade +0%
  design focus: Balanced | tech focus: Sensors + None
  native planet: MarshySwamp | special tech: None | special gov: None | preferred start gov: None
  expanding: Y | can-be-pirate: N | playable: Y | colors 5/9 flag 6 | ship art family 4 names 1

**Atuuk** — family: Ursidian, home system: Atuuko, troop: Angry Hunting Party
  growth 1.24 | int 50 aggr 115 caution 40 friend 138 loyalty 125
  savings: ships 0% troops 0% | mining +0% | warwear -0% | happiness +30% | research +0% | espionage +0% | trade +0%
  design focus: Power | tech focus: Missiles + None
  native planet: Continental | special tech: None | special gov: None | preferred start gov: None
  expanding: Y | can-be-pirate: Y | playable: Y | colors 4/14 flag 7 | ship art family 5 names 12

**Gizurean** — family: Insectoid, home system: Gizurea, troop: Gizurean War Swarm
  growth 1.27 | int 84 aggr 110 caution 116 friend 70 loyalty 80
  savings: ships 35% troops 0% | mining +0% | warwear -0% | happiness +0% | research +0% | espionage +0% | trade +0%
  design focus: Speed/Agility | tech focus: Ion Weapons + None
  native planet: Volcanic | special tech: None | special gov: HiveMind | preferred start gov: HiveMind
  expanding: Y | can-be-pirate: N | playable: Y | colors 8/11 flag 38 | ship art family 8 names 7

**Dhayut** — family: Insectoid, home system: Dhayu, troop: Dhayut Mercenary Trooper
  growth 1.06 | int 106 aggr 119 caution 95 friend 65 loyalty 70
  savings: ships 0% troops 0% | mining +0% | warwear -50% | happiness +0% | research +0% | espionage +0% | trade +0%
  design focus: Balanced | tech focus: HyperDrives + None
  native planet: Desert | special tech: VelocityDrive ST3 | special gov: None | preferred start gov: None
  expanding: Y | can-be-pirate: Y | playable: Y | colors 10/20 flag 36 | ship art family 7 names 2

**Human** — family: Humanoid, home system: Sol, troop: Strike Trooper Battalion
  growth 1.14 | int 110 aggr 110 caution 110 friend 110 loyalty 120
  savings: ships 0% troops 0% | mining +0% | warwear -0% | happiness +0% | research +15% | espionage +15% | trade +0%
  design focus: Balanced | tech focus: Fighters + None
  native planet: Continental | special tech: None | special gov: None | preferred start gov: None
  expanding: Y | can-be-pirate: N | playable: Y | colors 1/20 flag 18 | ship art family 0 names 0

**Quameno** — family: Amphibian, home system: Quameno, troop: Quameno BattleMech
  growth 1.09 | int 135 aggr 70 caution 117 friend 75 loyalty 130
  savings: ships 0% troops 0% | mining +0% | warwear -0% | happiness +0% | research +40% | espionage +0% | trade +0%
  design focus: Efficiency | tech focus: Reactors + None
  native planet: Ocean | special tech: NovaCore NX-700 | special gov: Technocracy | preferred start gov: Technocracy
  expanding: Y | can-be-pirate: N | playable: Y | colors 19/11 flag 24 | ship art family 2 names 4

**Mortalen** — family: Reptilian, home system: Mortalu, troop: Mortalen Conqueror
  growth 1.11 | int 105 aggr 127 caution 92 friend 80 loyalty 80
  savings: ships 0% troops 25% | mining +0% | warwear -35% | happiness +0% | research +0% | espionage +0% | trade +0%
  design focus: Power | tech focus: Engines + None
  native planet: Desert | special tech: Swift Vector 5000 | special gov: None | preferred start gov: None
  expanding: Y | can-be-pirate: Y | playable: Y | colors 11/14 flag 12 | ship art family 7 names 5

**Ackdarian** — family: Amphibian, home system: Ackdar, troop: Ackdar Defender
  growth 1.14 | int 110 aggr 80 caution 122 friend 110 loyalty 120
  savings: ships 20% troops 0% | mining +0% | warwear -0% | happiness +0% | research +10% | espionage +0% | trade +0%
  design focus: Speed/Agility | tech focus: Engines + None
  native planet: Ocean | special tech: TurboThruster ER7 | special gov: None | preferred start gov: None
  expanding: Y | can-be-pirate: N | playable: Y | colors 3/1 flag 16 | ship art family 6 names 6

**Haakonish** — family: Reptilian, home system: Haako, troop: Haakonish Battlematon
  growth 1.12 | int 110 aggr 113 caution 125 friend 75 loyalty 80
  savings: ships 20% troops 0% | mining +0% | warwear -0% | happiness +0% | research +0% | espionage +10% | trade +0%
  design focus: Balanced | tech focus: Hyper Disruption + None
  native planet: MarshySwamp | special tech: High Density Fuel Cell | special gov: MercantileGuild | preferred start gov: MercantileGuild
  expanding: Y | can-be-pirate: N | playable: Y | colors 14/12 flag 31 | ship art family 8 names 13

**Naxxilian** — family: Reptilian, home system: Naxxil, troop: Naxxil Fighting Squad
  growth 1.18 | int 97 aggr 121 caution 125 friend 88 loyalty 112
  savings: ships 0% troops 40% | mining +0% | warwear -0% | happiness +0% | research +0% | espionage +0% | trade +0%
  design focus: Balanced | tech focus: Torpedoes + None
  native planet: Ice | special tech: None | special gov: None | preferred start gov: None
  expanding: Y | can-be-pirate: Y | playable: Y | colors 17/8 flag 15 | ship art family 2 names 5

**Zenox** — family: Rodent, home system: Zenox, troop: Zenox RoboGuard
  growth 1.13 | int 115 aggr 90 caution 129 friend 87 loyalty 105
  savings: ships 10% troops 0% | mining +0% | warwear -0% | happiness +20% | research +0% | espionage +0% | trade +0%
  design focus: Efficiency | tech focus: Shields + None
  native planet: Continental | special tech: Megatron Z4 | special gov: Technocracy | preferred start gov: Technocracy
  expanding: Y | can-be-pirate: N | playable: Y | colors 13/20 flag 1 | ship art family 4 names 9

**Teekan** — family: Rodent, home system: Teeka, troop: Teekan Trapper Group
  growth 1.15 | int 88 aggr 63 caution 86 friend 107 loyalty 142
  savings: ships 0% troops 0% | mining +40% | warwear -0% | happiness +0% | research +0% | espionage +0% | trade +20%
  design focus: Balanced | tech focus: Ion Weapons + None
  native planet: Desert | special tech: None | special gov: MercantileGuild | preferred start gov: MercantileGuild
  expanding: Y | can-be-pirate: Y | playable: Y | colors 12/9 flag 29 | ship art family 3 names 12

**Wekkarus** — family: Amphibian, home system: Wekkaru, troop: Wekkaru Guardian
  growth 1.12 | int 101 aggr 80 caution 107 friend 71 loyalty 90
  savings: ships 0% troops 0% | mining +20% | warwear -0% | happiness +0% | research +0% | espionage +0% | trade +25%
  design focus: Speed/Agility | tech focus: Beams + None
  native planet: Ocean | special tech: PulseWave Cannon | special gov: None | preferred start gov: None
  expanding: Y | can-be-pirate: N | playable: Y | colors 7/12 flag 20 | ship art family 6 names 11

**Boskara** — family: Insectoid, home system: Boskar, troop: Boskaran Executioner
  growth 1.18 | int 100 aggr 140 caution 72 friend 84 loyalty 80
  savings: ships 0% troops 25% | mining +0% | warwear -70% | happiness +0% | research +0% | espionage +0% | trade +0%
  design focus: Power | tech focus: Torpedoes + None
  native planet: Volcanic | special tech: Shaktur FireStorm | special gov: HiveMind | preferred start gov: HiveMind
  expanding: Y | can-be-pirate: Y | playable: Y | colors 16/20 flag 3 | ship art family 1 names 3

**Shandar** — family: Reptilian, home system: Shandar, troop: Shandar Protector
  growth 1.16 | int 96 aggr 84 caution 116 friend 103 loyalty 109
  savings: ships 0% troops 0% | mining +0% | warwear -0% | happiness +40% | research +0% | espionage +0% | trade +0%
  design focus: Balanced | tech focus: Missiles + None
  native planet: Volcanic | special tech: None | special gov: UtopianParadise | preferred start gov: UtopianParadise
  expanding: Y | can-be-pirate: N | playable: Y | colors 9/12 flag 14 | ship art family 3 names 9

**Ugnari** — family: Rodent, home system: Ugnar, troop: Ugnari WarBot
  growth 1.09 | int 94 aggr 76 caution 81 friend 108 loyalty 70
  savings: ships 0% troops 0% | mining +30% | warwear -0% | happiness +10% | research +0% | espionage +0% | trade +0%
  design focus: Balanced | tech focus: Computers + None
  native planet: Ice | special tech: Raptor Targetting System | special gov: MercantileGuild | preferred start gov: MercantileGuild
  expanding: Y | can-be-pirate: N | playable: Y | colors 18/11 flag 11 | ship art family 5 names 2

**Kiadian** — family: Humanoid, home system: Kiadia, troop: Kiadian Strike Trooper
  growth 1.13 | int 128 aggr 100 caution 125 friend 105 loyalty 137
  savings: ships 10% troops 0% | mining +0% | warwear -0% | happiness +0% | research +20% | espionage +0% | trade +0%
  design focus: Speed/Agility | tech focus: Computers + Missiles
  native planet: Continental | special tech: ShadowGhost ECM 2000 | special gov: None | preferred start gov: None
  expanding: Y | can-be-pirate: N | playable: Y | colors 0/3 flag 13 | ship art family 0 names 8

**Sluken** — family: Insectoid, home system: Slukis, troop: Sluken Terminator
  growth 1.16 | int 108 aggr 123 caution 103 friend 82 loyalty 80
  savings: ships 0% troops 20% | mining +0% | warwear -40% | happiness +0% | research +0% | espionage +0% | trade +0%
  design focus: Power | tech focus: Engines + None
  native planet: MarshySwamp | special tech: StarBurner XX-12 | special gov: HiveMind | preferred start gov: HiveMind
  expanding: Y | can-be-pirate: Y | playable: Y | colors 15/8 flag 17 | ship art family 1 names 3

**Securan** — family: Humanoid, home system: Secura, troop: Securan Assassin
  growth 1.23 | int 102 aggr 73 caution 91 friend 110 loyalty 125
  savings: ships 0% troops 0% | mining +0% | warwear -0% | happiness +50% | research +0% | espionage +0% | trade +0%
  design focus: Balanced | tech focus: Hyper Disruption + None
  native planet: Desert | special tech: None | special gov: UtopianParadise | preferred start gov: UtopianParadise
  expanding: Y | can-be-pirate: N | playable: Y | colors 2/8 flag 25 | ship art family 7 names 10

**Ikkuro** — family: Ursidian, home system: Ikkuro, troop: Ikkuro Strike Commando
  growth 1.12 | int 114 aggr 115 caution 111 friend 92 loyalty 114
  savings: ships 10% troops 30% | mining +0% | warwear -0% | happiness +0% | research +0% | espionage +0% | trade +10%
  design focus: Efficiency | tech focus: Construction + None
  native planet: Continental | special tech: S2F7 RepairBot | special gov: None | preferred start gov: None
  expanding: Y | can-be-pirate: Y | playable: Y | colors 6/4 flag 34 | ship art family 5 names 5

**Shakturi** — family: Insectoid, home system: Shaktur, troop: Shakturi Slayer
  growth 1.19 | int 128 aggr 150 caution 65 friend 65 loyalty 70
  savings: ships 20% troops 20% | mining +0% | warwear -90% | happiness +0% | research +0% | espionage +0% | trade +0%
  design focus: Power | tech focus: Torpedoes + None
  native planet: Desert | special tech: Shaktur FireStorm | special gov: WayOfDarkness | preferred start gov: WayOfDarkness
  expanding: Y | can-be-pirate: N | playable: N | colors 22/19 flag 40 | ship art family 9 names 13

**Mechanoid** — family: Machine, home system: Utopia, troop: Mechanoid Guardian
  growth 1.07 | int 140 aggr 50 caution 140 friend 60 loyalty 150
  savings: ships 20% troops 0% | mining +0% | warwear -100% | happiness +50% | research +0% | espionage +0% | trade +0%
  design focus: Balanced | tech focus: Ion Weapons + Hyper Disruption
  native planet: Continental | special tech: None | special gov: WayOfTheAncients | preferred start gov: WayOfTheAncients
  expanding: N | can-be-pirate: N | playable: N | colors 21/4 flag 39 | ship art family 10 names 6

## APPENDIX B — GOVERNMENT DATA AND BIAS MATRICES (governments.txt, raceFamilies.txt, raceBiases.txt, raceFamilyBiases.txt, governmentBiases.txt)

### Race-to-Race bias matrix (raceBiases.txt; row feels towards column; range -50..+50)

       Ketarov        Atuuk     Gizurean       Dhayut        Human      Quameno     Mortalen    Ackdarian    Haakonish    Naxxilian        Zenox       Teekan     Wekkarus      Boskara      Shandar       Ugnari      Kiadian       Sluken      Securan       Ikkuro     Shakturi    Mechanoid
Ketarov                  10           10            0            0            0            0            0            0            0            0            5            5            0            0            0            5            0            0            0           10            0            0
Atuuk                    10           10            0            0            0            0            0            0            0            0            5            5            0            0            0            5            0            0            0           10            0            0
Gizurean                  0            0           10           10          -10          -10            5          -10            5            5          -10          -10          -10           10            5            0          -10           10          -10            0           10          -10
Dhayut                    0            0           10           10          -10          -10            5          -10            5            5          -10          -10          -10           10            5            0          -10           10          -10            0           10          -10
Human                     0            0          -10          -10           10            0            0            0            0            0            0            0            0          -10            0            0           10          -10           10            0          -10            0
Quameno                   0            0          -10          -10            0           10            0           10            0            0            0            0           10          -10            0            0            0          -10            0            0          -10            0
Mortalen                  0            0            5            5            0            5           10            5           10           10            0            0            5            5           10            0            0            5            0            0            5            0
Ackdarian                 0            0          -10          -10            0           10            0           10            0            0            0            0           10          -10            0            0            0          -10            0            0          -10            0
Haakonish                 0            0            5            5            0            5           10            5           10           10            0            0            5            5           10            0            0            5            0            0            5            0
Naxxilian                 0            0            5            5            0            5           10            5           10           10            0            0            5            5           10            0            0            5            0            0            5            0
Zenox                     0            0          -15          -10            0            0            0            0            0            0           10           10            0          -15            0           10            0          -15            0            0          -15            0
Teekan                    0            0          -10          -10            0            0            0            0            0            0           10           10            0          -10            0           10            0          -10            0            0          -10            0
Wekkarus                  0            0          -10          -10            0           10            0           10            0            0            0            0           10          -10            0            0            0          -10            0            0          -10            0
Boskara                   0            0           10           10          -10          -10            5          -10            5            5          -10          -10          -10           10            5            0          -10           10          -10            0           10          -10
Shandar                   0            0            5            5            0            5           10            5           10           10            0            0            5            5           10            0            0            5            0            0            5            0
Ugnari                    0            0          -10          -10            0            0            0            0            0            0           10           10            0          -10            0           10            0          -10            0            0          -10            0
Kiadian                   0            0          -10          -10           10            0            0            0            0            0            0            0            0          -10            0            0           10          -10           10            0          -10            0
Sluken                    0            0           10           10          -10          -10            5          -10            5            5          -10          -10          -10           10            5            0          -10           10          -10            0           10          -10
Securan                   0            0          -10          -10           10            0            0            0            0            0            0            0            0          -10            0            0           10          -10           10            0          -10            0
Ikkuro                   10           10            0            0            0            0            0            0            0            0            5            5            0            0            0            5            0            0            0           10            0            0
Shakturi                  0            0           10           10          -10          -10            5          -10            5            5          -10          -10          -10           10            5            0          -10           10          -10            0           10          -10
Mechanoid                 0            0          -10          -10           10            0            0            0            0            0            0            0            0          -10            0            0           10          -10           10            0          -10            0

### Race-family bias matrix (raceFamilyBiases.txt; range -30..+30)

      Humanoid     Ursidian    Insectoid    Reptilian    Amphibian       Rodent      Machine
Humanoid                 10            0          -10            0            0            0            0
Ursidian                  0           10            0            0            0            5            0
Insectoid               -10            0           10            5          -10          -10          -10
Reptilian                 0            0            5           10            5            0            0
Amphibian                 0            0          -10            0           10            0            0
Rodent                    0            0          -10            0            0           10            0
Machine                  10            0          -10            0            0            0            0

### Governments (governments.txt; each attribute is a multiplier vs 1.0=normal, range 0-3 unless noted)

ID  Name                      Corruption WarWear Maint ApprPop PopGrow ResSpeed TroopRec TradeBonus LeadRepl LeadDisrup LeadBoost LeadPool LeadManner Stability OwnRepConcern OtherRepImport SpecialFn Availability  NameAdjectives / NameNouns
 0  Despotism              1.1  0.65  0.85  0.95   1.0  0.75   1.2   1.0   0.2   1.3     0     0     1   0.9   1.0  0.25     0     0  | Great Grand    Empire Union Territory Supremacy Authority Sovereignty Hegemony
 1  Feudalism              1.0   0.8   0.9   0.9   1.0  0.75   1.4   1.0   0.3   1.6     0     1     1   1.3   1.0  0.75     0     0  | United Combined    Empire Alliance Union Group Federation Enclave Confederacy Council Colonies Alignment
 2  Monarchy               1.0   0.7   1.0   1.0   1.0   1.0  1.25   1.0   0.5   0.4     0     1     1   1.2   1.0   1.0     0     0  | Imperial Royal Great   Dominion Kingdom Realm Commonwealth Domain Dynasty
 3  Republic              0.85   1.2   1.1   1.0   1.0  1.25   1.0  1.05   1.0     0   1.0     0     2   2.0   1.0  0.75     0     0  | Free United Combined Imperial Great Empire Republic Alliance Territory Nation Federation Confederacy Coalition
 4  Democracy             0.85   1.4   1.2   1.2   1.1  1.25  0.75   1.1   1.0     0   1.0     0     2   1.8   1.0  0.75     0     0  | Free United Combined Great Grand Empire Republic Alliance Territory Federation Confederacy Coalition Colonies
 5  Military Dictatorship  1.0   0.5  0.85   0.8   1.0   1.0   1.3   1.0  0.25   1.5     0     2     1   0.7   1.0  0.25     0     0  | Imperial Great Grand   Empire Territory Nation Supremacy Authority Sovereignty Hegemony
 6  Way of the Ancients    0.8   1.0   0.9   1.3  1.15   1.5   1.0   1.1   1.0     0   1.0     0     2   2.0   0.2   1.2     0     2  |      
 7  Way of Darkness        1.0   0.2   0.7   1.0   1.1   1.3   1.5   1.0  0.35   0.2     0     2     1   1.6   0.1  0.25     0     3  |      
 8  Technocracy           0.85   1.0   1.1   1.0   1.0   1.5   0.9   1.0   0.3   0.7     0     3     0   1.3   1.0  0.75     0     1  | United     Empire Technocracy Ascendancy
 9  Mercantile Guild       1.0   1.0   0.9   1.0   1.0   1.0   0.9   1.3   1.0     0   1.0     0     2   1.5   1.0  0.25     0     1  | Free     Syndicate Consortium Corporation Industries Guilds
10  Utopian Paradise       1.0  1.75   1.5   1.3   1.2   1.0   0.5   1.0   1.0     0   1.5     0     2   1.0   1.0  0.25     0     1  | Free     Utopia Harmony Paradise Renaissance
11  Hive Mind              0.8   0.6  0.95   1.1   1.0   1.0   1.0   1.0  0.15   0.5     0     0     0   2.2   1.0   1.0     0     1  | Great     Hive Collective Conformity Consciousness
12  Corporate Nationalism 1.15  0.75   1.1   1.0  0.95   0.9  1.25   0.9   0.5   0.8     0     1     1   1.0   1.0   1.0     1     1  |      

Attribute order: 1=Corruption, 2=WarWearinessRate, 3=MaintenanceCosts, 4=ApprovalRating, 5=PopulationGrowth, 6=ResearchSpeed, 7=TroopRecruitment, 8=TradeBonus, 9=LeaderReplacementLikeliness, 10=LeaderReplacementDisruption, 11=LeaderReplacementBoost, 12=LeaderReplacementCharacterPool(0=None,1=Governors,2=Admirals/Generals,3=Scientists), 13=LeaderReplacementManner(0=replacement,1=coup,2=election), 14=Stability, 15=OwnReputationConcern(0-2), 16=OtherEmpireReputationImportance(0-2), 17=SpecialFunctionCode(0=None,1=NationalizePrivateSector), 18=Availability(0=all,1=race-specific,2=ancient guardians,3=shakturi)

### Government-to-Government bias matrix (governmentBiases.txt; range -30..+30)

     Despotism    Feudalism     Monarchy     Republic    Democracy Military Dic Way of the A Way of Darkn  Technocracy Mercantile G Utopian Para    Hive Mind Corporate Na
Despotism                      7            0            5            0          -10           11            0           16            0           -5            0            0            5
Feudalism                      0           11           13            7            4            0           12            0            0            6            0            0            0
Monarchy                       4           12           11            2            8           -7           12            0            0            0            0           -6            0
Republic                      -5            7            1           12           12          -12           19           -4            0            6            6            0           -2
Democracy                     -8            0            7           12           12          -14           20           -5            0            6           12            0           -4
Military Dictatorship          13            0            0          -14          -17            6           -5           22            0           -6          -12            0           12
Way of the Ancients          -10            0            7           16           17          -20           18          -30            0            6           14          -12          -12
Way of Darkness               16            0            0          -19          -22           18          -30           -8            0            0          -16            0           13
Technocracy                    0            0            0            4            6            0           10            0            8            2            6            0            0
Mercantile Guild              -6            6            0            7           12          -11           12          -15            6            8            6            0          -12
Utopian Paradise              -8            0            0            6            8          -12           12          -16            0            0           12          -10           -6
Hive Mind                      6            0            8           -7          -12           12            0           18            0           -5            0           24            0
Corporate Nationalism           7            0            4            0          -10           11           -6           16            0          -10            0            0            8

## APPENDIX C — RESOURCE DATA (resources.txt)

## RESOURCE DEFINITIONS (verbatim data, 41 resources — reproduce as data file)

| ID | Name | PicRef | BasePrice | Type(0=Mineral,1=Gas,2=Luxury) | SuperLuxBonus | Fuel | PreWarpImp | GrowthLevel | MfgLevel |
|----|------|--------|-----------|-----|------|------|------|-------------|----------|
| 0 | Emeros Crystal | 0 | 5.0 | 0 | 0 | N | N | 0 | 0 |
| 1 | Nekros Stone | 1 | 5.0 | 0 | 0 | N | Y | 0 | 0 |
| 2 | Osalia | 2 | 5.0 | 0 | 0 | N | N | 0 | 0 |
| 3 | Dilithium Crystal | 3 | 5.0 | 0 | 0 | N | N | 0 | 0 |
| 4 | Helium | 4 | 5.0 | 1 | 0 | N | Y | 0 | 0 |
| 5 | Argon | 5 | 5.0 | 1 | 0 | N | N | 0 | 0 |
| 6 | Krypton | 6 | 5.0 | 1 | 0 | N | N | 0 | 0 |
| 7 | Tyderios | 7 | 5.0 | 1 | 0 | N | N | 0 | 0 |
| 8 | Hydrogen | 8 | 5.0 | 1 | 0 | Y | Y | 1.0 | 0 |
| 9 | Silicon | 9 | 5.0 | 0 | 0 | N | Y | 0.3 | 0 |
| 10 | Steel | 10 | 5.0 | 0 | 0 | N | Y | 0.6 | 0 |
| 11 | Aculon | 11 | 5.0 | 0 | 0 | N | N | 0 | 0 |
| 12 | Chromium | 12 | 5.0 | 0 | 0 | N | Y | 0 | 0 |
| 13 | Lead | 13 | 5.0 | 0 | 0 | N | Y | 0.4 | 0 |
| 14 | Gold | 14 | 5.0 | 0 | 0 | N | Y | 0 | 0 |
| 15 | Iridium | 15 | 5.0 | 0 | 0 | N | N | 0 | 0 |
| 16 | Polymer | 16 | 5.0 | 0 | 0 | N | Y | 0.3 | 0 |
| 17 | Carbon Fibre | 17 | 5.0 | 0 | 0 | N | Y | 0.3 | 0 |
| 18 | Caslon | 18 | 5.0 | 1 | 0 | Y | Y | 1.0 | 0 |
| 19 | Loros Fruit | 19 | 200.0 | 2 | 30 | N | N | 0 | 0 |
| 20 | Megallos Nut | 20 | 5.0 | 2 | 0 | N | N | 0 | 0 |
| 21 | Falajian Spice | 21 | 20.0 | 2 | 0 | N | N | 0 | 0 |
| 22 | Korabbian Spice | 22 | 200.0 | 2 | 30 | N | N | 0 | 0 |
| 23 | Ekarus Meat | 23 | 20.0 | 2 | 0 | N | N | 0 | 0 |
| 24 | Nepthys Wine | 24 | 20.0 | 2 | 0 | N | N | 0 | 0 |
| 25 | Rephidium Ale | 25 | 5.0 | 2 | 0 | N | N | 0 | 0 |
| 26 | Wiconium | 26 | 5.0 | 2 | 0 | N | N | 0 | 0 |
| 27 | Vodkol | 27 | 10.0 | 2 | 0 | N | N | 0 | 0 |
| 28 | Questurian Skin | 28 | 10.0 | 2 | 0 | N | N | 0 | 0 |
| 29 | Bifurian Silk | 29 | 10.0 | 2 | 0 | N | N | 0 | 0 |
| 30 | Caguar Fur | 30 | 20.0 | 2 | 0 | N | N | 0 | 0 |
| 31 | Terallion Down | 31 | 5.0 | 2 | 0 | N | N | 0 | 0 |
| 32 | Dantha Fur | 32 | 10.0 | 2 | 0 | N | N | 0 | 0 |
| 33 | Aquasian Incense | 33 | 20.0 | 2 | 0 | N | N | 0 | 0 |
| 34 | Natarran Incense | 34 | 20.0 | 2 | 0 | N | N | 0 | 0 |
| 35 | Zentabia Fluid | 35 | 200.0 | 2 | 30 | N | N | 0 | 0 |
| 36 | Ilosian Jade | 36 | 20.0 | 2 | 0 | N | N | 0 | 0 |
| 37 | Otandium Opal | 37 | 20.0 | 2 | 0 | N | N | 0 | 0 |
| 38 | Jakanta Ivory | 38 | 20.0 | 2 | 0 | N | N | 0 | 0 |
| 39 | Ucantium Pearl | 39 | 20.0 | 2 | 0 | N | N | 0 | 0 |
| 40 | Yarras Marble | 40 | 20.0 | 2 | 0 | N | N | 0 | 0 |

## Prevalence / distribution table

## APPENDIX D — COMPONENT DATA (components.txt — all 129 components)

## COMPONENT DEFINITIONS (components.txt — 129 components; reproduce as data file)

| ID | Name | Type | Category | Value1 | Value2 | Value3 | Value4 | Value5 | Value6 | Value7 |
|----|------|------|----------|--------|--------|--------|--------|--------|--------|--------|
| 0 | Maxos Blaster | 48 | 5 | 5 | 190 | 12 | 360 | 1 | 1240 | 0 |
| 1 | Shatterforce Laser | 48 | 4 | 7 | 320 | 20 | 310 | 1 | 1500 | 0 |
| 2 | Impact Assault Blaster | 48 | 5 | 12 | 220 | 38 | 260 | 3 | 1700 | 0 |
| 3 | Titan Beam | 48 | 6 | 20 | 390 | 28 | 330 | 4 | 1400 | 0 |
| 4 | PulseWave Cannon | 48 | 5 | 13 | 310 | 24 | 350 | 3 | 1400 | 0 |
| 5 | Epsilon Torpedo | 60 | 15 | 11 | 300 | 30 | 60 | 3 | 2900 | 0 |
| 6 | Velocity Shard | 60 | 11 | 16 | 630 | 44 | 120 | 2 | 3300 | 0 |
| 7 | Shockwave Torpedo | 60 | 12 | 24 | 430 | 60 | 75 | 4 | 3800 | 0 |
| 8 | Plasma Thunderbolt | 60 | 12 | 36 | 690 | 64 | 125 | 4 | 3200 | 0 |
| 9 | Shaktur FireStorm | 60 | 12 | 36 | 295 | 52 | 65 | 10 | 2900 | 6 |
| 10 | Concussion Missile | 54 | 10 | 6 | 520 | 18 | 120 | 0 | 2700 | 0 |
| 11 | Nuclear Devastator | 49 | 8 | 0 | 210 | 15 | 50 | 0 | 6000 | 3 |
| 12 | Nuclear Exterminator | 49 | 14 | 0 | 270 | 44 | 60 | 13 | 6700 | 8 |
| 13 | Point Defense Cannon | 56 | 3 | 3 | 140 | 4 | 430 | 1 | 540 | 0 |
| 14 | Terminator AutoCannon | 56 | 3 | 6 | 190 | 6 | 550 | 1 | 480 | 0 |
| 15 | Ion Cannon | 51 | 12 | 20 | 260 | 80 | 230 | 5 | 3300 | 0 |
| 16 | Ion Pulse | 53 | 20 | 24 | 210 | 125 | 120 | 7 | 6600 | 0 |
| 17 | Ion Defense | 52 | 2 | 18 | 0 | 0 | 0 | 0 | 0 | 0 |
| 18 | HyperDeny GW1000 | 22 | 12 | 3 | 340 | 2 | 0 | 0 | 0 | 0 |
| 19 | Intimidator Surgewave | 46 | 16 | 35 | 220 | 54 | 120 | 13 | 8200 | 0 |
| 20 | HyperDeny GW4000 | 22 | 14 | 6 | 1020 | 2 | 0 | 0 | 0 | 0 |
| 21 | Derasian Shockwave | 46 | 18 | 74 | 300 | 90 | 150 | 21 | 9000 | 0 |
| 22 | Gravity Well Projector | 24 | 52 | 6 | 1800 | 92 | 0 | 0 | 0 | 0 |
| 23 | Death Ray | 59 | 140 | 1800 | 440 | 400 | 370 | 270 | 8500 | 0 |
| 24 | Devastator Pulse | 58 | 170 | 1200 | 520 | 470 | 125 | 210 | 12000 | 0 |
| 25 | Super Laser | 59 | 640 | 30000 | 700 | 800 | 450 | 380 | 32000 | 0 |
| 26 | Standard Fighter Bay | 19 | 50 | 40 | 4 | 0 | 0 | 0 | 0 | 0 |
| 27 | Advanced Fighter Bay | 19 | 45 | 40 | 7 | 0 | 0 | 0 | 0 | 0 |
| 28 | Standard Armor | 1 | 1 | 10 | 2 | 0 | 0 | 0 | 0 | 0 |
| 29 | Enhanced Armor | 1 | 1 | 18 | 4 | 0 | 0 | 0 | 0 | 0 |
| 30 | Reactive Armor | 1 | 1 | 25 | 7 | 0 | 0 | 0 | 0 | 0 |
| 31 | UltraDense Armor | 1 | 1 | 40 | 10 | 0 | 0 | 0 | 0 | 0 |
| 32 | Corvidian Shields | 40 | 10 | 100 | 3 | 0 | 0 | 0 | 0 | 0 |
| 33 | Talassos Shields | 40 | 10 | 130 | 8 | 0 | 0 | 0 | 0 | 0 |
| 34 | Deucalios Shields | 40 | 10 | 180 | 4 | 0 | 0 | 0 | 0 | 0 |
| 35 | Meridian Shields | 40 | 10 | 220 | 10 | 0 | 0 | 0 | 0 | 0 |
| 36 | Megatron Z4 | 40 | 9 | 155 | 12 | 0 | 0 | 0 | 0 | 0 |
| 37 | Area Shield Recharge | 0 | 20 | 250 | 400 | 600 | 0 | 0 | 0 | 0 |
| 38 | Proton Thruster | 14 | 7 | 1000 | 5 | 560 | 2 | 0 | 0 | 0 |
| 39 | Quantum Engine | 14 | 8 | 1230 | 5 | 620 | 2 | 0 | 0 | 0 |
| 40 | Acceleros Engine | 14 | 8 | 1540 | 8 | 720 | 3 | 0 | 0 | 0 |
| 41 | Vortex Engine | 14 | 8 | 1630 | 6 | 950 | 3 | 0 | 0 | 0 |
| 42 | TurboThruster | 14 | 7 | 1380 | 3 | 850 | 1 | 0 | 0 | 0 |
| 43 | StarBurner | 14 | 7 | 1880 | 7 | 1180 | 4 | 0 | 0 | 0 |
| 44 | Thrust Vector | 15 | 2 | 6 | 1 | 0 | 0 | 0 | 0 | 0 |
| 45 | Multi Vector | 15 | 2 | 12 | 1 | 0 | 0 | 0 | 0 | 0 |
| 46 | Swift Vector | 15 | 2 | 10 | 1 | 0 | 0 | 0 | 0 | 0 |
| 47 | Gerax HyperDrive | 23 | 11 | 12500 | 78 | 15 | 0 | 0 | 0 | 0 |
| 48 | Kaldos HyperDrive | 23 | 9 | 13750 | 94 | 7 | 0 | 0 | 0 | 0 |
| 49 | Equinox JumpDrive | 23 | 9 | 18750 | 88 | 13 | 0 | 0 | 0 | 0 |
| 50 | Calista-Dal WarpDrive | 23 | 9 | 15000 | 60 | 12 | 0 | 0 | 0 | 0 |
| 51 | Torrent Drive | 23 | 9 | 25000 | 83 | 6 | 0 | 0 | 0 | 0 |
| 52 | VelocityDrive | 23 | 8 | 23500 | 64 | 6 | 0 | 0 | 0 | 0 |
| 53 | Fission Reactor | 33 | 22 | 60 | 105 | 400 | 18 | 0 | 0 | 0 |
| 54 | Fusion Reactor | 33 | 15 | 84 | 180 | 520 | 8 | 0 | 0 | 0 |
| 55 | Quantum Reactor | 33 | 18 | 120 | 230 | 800 | 18 | 0 | 0 | 0 |
| 56 | HyperFusion Reactor | 33 | 16 | 180 | 350 | 975 | 8 | 0 | 0 | 0 |
| 57 | NovaCore Reactor | 33 | 20 | 120 | 240 | 480 | 8 | 0 | 0 | 0 |
| 58 | Energy Collector | 12 | 8 | 24 | 0 | 0 | 0 | 0 | 0 | 0 |
| 59 | Mining Engine | 18 | 14 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| 60 | Gas Extractor | 16 | 16 | 20 | 0 | 0 | 0 | 0 | 0 | 0 |
| 61 | Luxury Resource Extractor | 17 | 22 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| 62 | Weapons Plant | 29 | 35 | 20000 | 0 | 0 | 0 | 0 | 0 | 0 |
| 63 | Energy Plant | 27 | 35 | 20000 | 0 | 0 | 0 | 0 | 0 | 0 |
| 64 | HighTech Plant | 28 | 28 | 20000 | 0 | 0 | 0 | 0 | 0 | 0 |
| 65 | Standard Fuel Cell | 20 | 6 | 65 | 0 | 0 | 0 | 0 | 0 | 0 |
| 66 | UltraDense Fuel Cell | 20 | 6 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| 67 | Mega-Density Fuel Cell | 20 | 6 | 140 | 0 | 0 | 0 | 0 | 0 | 0 |
| 68 | Standard Cargo Bay | 3 | 8 | 500 | 0 | 0 | 0 | 0 | 0 | 0 |
| 69 | Massive Cargo Bay | 3 | 8 | 800 | 0 | 0 | 0 | 0 | 0 | 0 |
| 70 | Standard Troop Compartment | 45 | 8 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| 71 | Massive Troop Compartment | 45 | 8 | 160 | 0 | 0 | 0 | 0 | 0 | 0 |
| 72 | Standard Passenger Compartment | 31 | 10 | 1200000 | 0 | 0 | 0 | 0 | 0 | 0 |
| 73 | Massive Passenger Compartment | 31 | 10 | 2400000 | 0 | 0 | 0 | 0 | 0 | 0 |
| 74 | Docking Bay | 11 | 4 | 150 | 0 | 0 | 0 | 0 | 0 | 0 |
| 75 | Basic Proximity Array | 32 | 3 | 48000 | 1 | 0 | 0 | 0 | 0 | 0 |
| 76 | Advanced Proximity Array | 32 | 3 | 54000 | 10 | 0 | 0 | 0 | 0 | 0 |
| 77 | Resource Profile Sensor | 38 | 2 | 500 | 0 | 0 | 0 | 0 | 0 | 0 |
| 78 | Long Range Scanner | 26 | 72 | 450000 | 0 | 0 | 0 | 0 | 0 | 0 |
| 79 | Ultra Long Range Scanner | 26 | 98 | 1100000 | 0 | 0 | 0 | 0 | 0 | 0 |
| 80 | Trace Scanner | 44 | 2 | 500 | 10 | 0 | 0 | 0 | 0 | 0 |
| 81 | Scanner Jammer | 39 | 2 | 0 | 10 | 0 | 0 | 0 | 0 | 0 |
| 82 | Stealth Cloak | 41 | 60 | 500 | 0 | 0 | 0 | 0 | 0 | 0 |
| 83 | Combat Targetting System | 42 | 1 | 10 | 0 | 0 | 0 | 0 | 0 | 0 |
| 84 | Countermeasures System | 8 | 1 | 10 | 0 | 0 | 0 | 0 | 0 | 0 |
| 85 | Command Center | 5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 86 | Commerce Center | 6 | 3 | 50 | 0 | 0 | 0 | 0 | 0 | 0 |
| 87 | ShadowGhost ECM | 8 | 1 | 40 | 0 | 0 | 0 | 0 | 0 | 0 |
| 88 | Raptor Targetting System | 42 | 1 | 40 | 0 | 0 | 0 | 0 | 0 | 0 |
| 89 | Fleet Targetting System | 43 | 3 | 25 | 10 | 0 | 0 | 0 | 0 | 0 |
| 90 | Fleet Countermeasures System | 9 | 3 | 25 | 10 | 0 | 0 | 0 | 0 | 0 |
| 91 | Weapons Lab | 37 | 20 | 30000 | 0 | 0 | 0 | 0 | 0 | 0 |
| 92 | Energy Lab | 35 | 20 | 30000 | 0 | 0 | 0 | 0 | 0 | 0 |
| 93 | HighTech Lab | 36 | 20 | 30000 | 0 | 0 | 0 | 0 | 0 | 0 |
| 94 | Construction Yard | 7 | 10 | 200 | 100 | 0 | 0 | 0 | 0 | 0 |
| 95 | Damage Control Unit | 10 | 4 | 400 | 0 | 0 | 0 | 0 | 0 | 0 |
| 96 | S2F4 RepairBot | 10 | 3 | 500 | 5 | 0 | 0 | 0 | 0 | 0 |
| 97 | S2F7 RepairBot | 10 | 2 | 650 | 4 | 0 | 0 | 0 | 0 | 0 |
| 98 | Life Support | 25 | 1 | 60 | 0 | 0 | 0 | 0 | 0 | 0 |
| 99 | Hab Module | 21 | 2 | 60 | 0 | 0 | 0 | 0 | 0 | 0 |
| 100 | Medical Center | 30 | 4 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| 101 | Recreation Center | 34 | 20 | 100 | 0 | 0 | 0 | 0 | 0 | 0 |
| 102 | Basic Colonization Module | 4 | 300 | 30000000 | 0 | 0 | 0 | 0 | 0 | 0 |
| 103 | Enhanced Colonization Module | 4 | 390 | 60000000 | 0 | 0 | 0 | 0 | 0 | 0 |
| 104 | Massive Colonization Module | 4 | 440 | 100000000 | 0 | 0 | 0 | 0 | 0 | 0 |
| 105 | Giant Ion Cannon | 51 | 200 | 220 | 400 | 0 | 220 | 4 | 8000 | 0 |
| 106 | Phaser Cannon | 55 | 7 | 9 | 200 | 32 | 500 | 0 | 2200 | 0 |
| 107 | Rail Gun | 57 | 7 | 6 | 120 | 6 | 120 | 0 | 1000 | 0 |
| 108 | Assault Missile | 54 | 14 | 20 | 740 | 18 | 110 | 0 | 4200 | 0 |
| 109 | Energy To Fuel Converter | 13 | 280 | 50 | 0 | 0 | 0 | 0 | 0 | 0 |
| 110 | Phaser Lance | 55 | 9 | 20 | 300 | 50 | 520 | 0 | 4000 | 0 |
| 111 | Heavy Rail Gun | 57 | 12 | 10 | 180 | 8 | 180 | 0 | 2000 | 1 |
| 112 | Massive Rail Gun | 57 | 18 | 16 | 280 | 12 | 200 | 0 | 2800 | 2 |
| 113 | Tractor Beam | 61 | 10 | 10 | 320 | 28 | 800 | 5 | 4000 | 0 |
| 114 | Assault Pod | 2 | 8 | 50 | 140 | 6 | 50 | 20 | 120000 | 0 |
| 115 | Graviton Beam | 50 | 20 | 15 | 150 | 40 | 400 | 4 | 7000 | 0 |
| 116 | Resonant Graviton Beam | 50 | 30 | 28 | 240 | 60 | 400 | 3 | 7000 | 0 |
| 117 | High Power Tractor Beam | 61 | 10 | 16 | 400 | 34 | 400 | 2 | 4000 | 0 |
| 118 | Area Graviton Pulse | 47 | 40 | 40 | 360 | 100 | 60 | 240 | 9000 | 80 |
| 119 | Area Transient Singularity | 47 | 50 | 100 | 520 | 200 | 65 | 350 | 12000 | 120 |
| 120 | Basic Space Reactor | 33 | 18 | 46 | 90 | 370 | 18 | 0 | 0 | 0 |
| 121 | Ion Thruster | 14 | 6 | 600 | 4 | 520 | 2 | 0 | 0 | 0 |
| 122 | Directional Thruster | 15 | 2 | 3 | 1 | 0 | 0 | 0 | 0 | 0 |
| 123 | Small Fuel Cell | 20 | 6 | 55 | 0 | 0 | 0 | 0 | 0 | 0 |
| 124 | Small Cargo Bay | 3 | 8 | 350 | 0 | 0 | 0 | 0 | 0 | 0 |
| 125 | Warp Bubble Generator | 23 | 10 | 2000 | 132 | 18 | 0 | 0 | 0 | 0 |
| 126 | Pulse Blaster | 48 | 4 | 4 | 150 | 13 | 360 | 1 | 1240 | 0 |
| 127 | Long Range Gun | 57 | 6 | 5 | 100 | 7 | 100 | 0 | 1000 | 0 |
| 128 | Seeking Missile | 54 | 8 | 5 | 400 | 20 | 80 | 0 | 2700 | 0 |

## APPENDIX E — PLANETARY FACILITY DATA (facilities.txt)

## PLANETARY FACILITY DEFINITIONS (facilities.txt — reproduce as data file)

0, Troop Academy, 0, 0, 0,						10000.0, 2000.0, 0, 0, 0,		Allows the training of elite troops at a colony, giving them 50% greater strength than normal
1, Robotic Troop Foundry, 1, 0, 1,				15000.0, 2000.0, 0, 0, 0,		Manufactures robotic troops at a colony. Robotic troops are not especially strong, but can be manufactured quickly, and have one quarter the normal maintenance costs
2, Troop Cloning Facility, 2, 0, 2,				15000.0, 2000.0, 0, 0, 0,		Produces clone troops at a colony. The strongest current troop in your empire is cloned
3, Giant Ion Cannon, 4, 0, 3,					15000.0, 2000.0, 105, 0, 0,		Fires massive ionized blasts at nearby enemy ships, disabling their engines and weapons
4, Planetary Shield, 3, 0, 4,					20000.0, 2000.0, 0, 0, 0,		Projects a defensive shield around a planet, protecting the colony from enemy bombardment
5, Regional Capital, 5, 0, 5,					20000.0, 2000.0, 0, 0, 0,		Regional Capitals lower corruption in your nearby colonies, increasing revenue for your empire. This project allows you to build one additional regional capital in your empire
6, Regional Capital, 5, 0, 6,					20000.0, 2000.0, 0, 0, 0,		Regional Capitals lower corruption in your nearby colonies, increasing revenue for your empire. This project allows you to build one additional regional capital in your empire
7, Regional Capital, 5, 0, 7,					20000.0, 2000.0, 0, 0, 0,		Regional Capitals lower corruption in your nearby colonies, increasing revenue for your empire. This project allows you to build one additional regional capital in your empire
8, Fortified Bunker, 6, 0, 8,					10000.0, 2000.0, 10, 0, 0,		Provides a defensive bonus for troops defending a colony. Their defensive strength is increased by the amount below when fending off invasions
9, Terraforming Facility, 7, 0, 9,				20000.0, 2000.0, 200, 0, 0,		Repairs planetary damage to a colony, thus improving the quality and increasing the happiness and income of the colony. Although damage will naturally repair over time, the Terraforming Facility repairs damage much faster
10, Bakuras Highspeed Shipyards, 8, 10, 10,		50000.0, 10000.0, 20, 200, 0,	A massive array of orbital star-ship construction yards. Construction speed is increased for all ships and bases built at the colony with this wonder
11, Merkidor Planetary Fortress, 8, 9, 11,		50000.0, 10000.0, 20, 20, 0,	An impregnable stronghold with heavy defensive weaponry. Defense against invasion is increased for the colony with this wonder
12, Holographic Network, 8, 8, 12,				50000.0, 10000.0, 20, 100, 0,	A huge virtual reality system that presents highly immersive recreation. Happiness is increased for the colony with this wonder
13, Traders Bazaar, 8, 11, 13,					50000.0, 10000.0, 20, 30, 0,	A colossal marketplace connected by a maze of alleys and bridges. Income is increased for the colony with this wonder
14, Advanced Medicomplex, 8, 7, 14,				50000.0, 10000.0, 20, 100, 0,	The finest medical treatment is available at this facility. The population growth rate is increased for the colony with this wonder
15, Holographic Universe, 8, 2, 15,				100000.0, 20000.0, 40, 30, 0,	An all-encompassing virtual reality world that can entertain an individual for weeks at a time. Increases the happiness for every colony in an empire
16, Koloros Medical Academy, 8, 1, 16,			100000.0, 20000.0, 40, 30, 0,	Provides unequalled medical training to produce the best physicians in the galaxy. Increases the population growth rate for every colony in an empire
17, Danuta Engineering Center, 8, 4, 17,		100000.0, 20000.0, 40, 50, 0,	Advanced facilities for studying the secrets of high-energy physics. Provides an Energy research bonus for the empire
18, Rusan Technology Installation, 8, 5, 18,	100000.0, 20000.0, 40, 50, 0,	Center for advanced technology projects. Provides a HighTech research bonus for the empire
19, Casidor Weapons Facility, 8, 3, 19,			100000.0, 20000.0, 40, 50, 0,	Center for development and testing of radical new weaponry. Provides a Weapons research bonus for the empire
20, Trade Guild, 8, 6, 20,						100000.0, 20000.0, 40, 20, 0,	A vast hub of galactic commerce spread across hundreds of free-floating atmospheric platforms. Increases the income for every colony in an empire
21, Universal Hive, 8, 12, 21,					100000.0, 20000.0, 50, 0, 0,	The ultimate expression of telepathic harmony, the Universal Hive is a crowning cultural achievement
22, Galactic Archives, 8, 12, 22,				100000.0, 20000.0, 50, 0, 0,	Both a museum and a library, the Galactic Archives are a vast storehouse of all galactic history. Ancient records and artifacts from the remotest corners of the galaxy are stored here
23, Lava Palace Resort, 8, 12, 23,				100000.0, 20000.0, 50, 0, 6,	An exquisite resort with shimmering lava lakes and millions of glittering gemstones. The Lava Palace Resort attracts visitors from all over the known galaxy
24, Underwater Palace, 8, 12, 24,				100000.0, 20000.0, 50, 0, 4,	A spectacular underwater palace with thousands of pearl-encrusted spires. Vast vaults beneath the Underwater Palace also store an enormous wealth of precious crystals
25, Hidden Pirate Base, 9, 0, 25,				30000.0, 0, 50, 25, 10,			The Hidden Pirate Base is a secret base of operations for raiders, smugglers and criminals of all kinds. From here the local planetary crimelord directs his network of criminal enterprises, amassing income from various sources.\n\nThis planetary facility gives our pirate faction permanent control of the colony where it is built. It also increases the research output for our pirate faction
26, Hidden Pirate Fortress, 10, 0, 26,			100000.0, 0, 100, 50, 20,		The Hidden Pirate Fortress is a large secret base of operations for raiders, smugglers and criminals of all kinds. From this enormous fortress the local planetary crimelord directs his network of criminal enterprises, amassing income from various sources.\n\nThis planetary facility gives our pirate faction permanent control of the colony where it is built. It also increases the research output for our pirate faction
27, Armored Factory, 11, 0, 27,					20000.0, 2000.0, 0, 0, 0,		Allows the recruitment of Armored troop units at a colony. Armored troops have very high attack strength and are thus specialized at invading enemy colonies
28, Spy Academy, 12, 0, 28,						40000.0, 2000.0, 30, 0, 0,		Increases the chance of new Intelligence Agents appearing in our empire
29, Science Academy, 13, 0, 29,					40000.0, 2000.0, 30, 0, 0,		Increases the chance of new Scientists appearing in our empire
30, Naval Academy, 14, 0, 30,					40000.0, 2000.0, 30, 0, 0,		Increases the chance of new Fleet Admirals appearing in our empire
31, Military Academy, 15, 0, 31,				30000.0, 2000.0, 30, 0, 0,		Increases the chance of new Troop Generals appearing in our empire. Also allows recruitment of Special Forces troop units. Special Forces are specialized at taking out enemy defences prior to a colony invasion
32, Criminal Network, 16, 0, 32,				200000.0, 0, 100, 0, 40,		The Criminal Network is a powerful criminal organization that allows a pirate faction to take full ownership of a colony, controlling it just like a standard empire. This means that the colony publicly identifies as belonging to us. We can then recruit troops here to invade other colonies. We can also build Colony Ships here to colonize other planets. And we can build Contruction Ships here too

### Facility type codes: 0=TroopTrainingCenter,1=FortifiedBunker,2=CloningFacility,3=PlanetaryShield,4=TerraformingFacility,5=GiantIonCannon,6=RegionalCapital,7=ScienceAcademy,8=WONDER,9=NavalAcademy,10=RoboticTroopFoundry,11=MilitaryAcademy,12=SpyAcademy,13=Commerce,14=Tourism,15=Research,16=PirateCriminalNetwork

### WonderType codes: 0=EmpirePopulationGrowth,1=EmpireHappiness,2=EmpireResearchWeapons,3=EmpireResearchEnergy,4=EmpireResearchHighTech,5=EmpireIncome,6=ColonyPopulationGrowth,7=ColonyHappiness,8=ColonyDefense,9=ColonyConstructionSpeed,10=ColonyIncome,11=RaceAchievement

## APPENDIX F — COMPLETE RESEARCH TREE (research.txt — 337 projects, all three industries)

Project format: `L<techLevel> r<row>: Name [unlocks/improves/fighters/facility/abilities/race-lock/plague]`.

=== WEAPONS (152 projects) ===
  L2 r1: Wave Weapons  [unlocks:4]
  L4 r1: Enhanced Wave Weapons
  L6 r1: Advanced Wave Weapons
  L3 r2: Long Range Lasers  [unlocks:1]
  L4 r2: Advanced Laser Focussing
  L6 r2: High Intensity Lasers
  L0 r3: Beam Weapons  [unlocks:126]
  L1 r3: Enhanced Beam Weapons  [unlocks:0]
  L2 r3: Efficient Blasters
  L3 r3: Advanced Blasters
  L5 r3: Advanced Beams  [unlocks:3]
  L6 r3: Beam Intensification
  L7 r3: Beam Superflow
  L3 r4: High Power Blasters  [unlocks:2]
  L4 r4: Synchronized Energy Output
  L6 r4: Devastating Energy Release
  L100 r4: Super Beam Weapons  [special:3; unlocks:23]
  L101 r4: Advanced Super Weapons  [unlocks:25]
  L3 r5: Phased Beams  [unlocks:106]
  L4 r5: Phaser Intensification
  L6 r5: Phaser Optimization
  L4 r6: Phaser Focusing  [unlocks:110]
  L6 r6: Advanced Phasers
  L7 r6: Extreme Energy Beams
  L2 r7: Ion Weapons  [unlocks:15]
  L3 r7: EMP Defenses  [unlocks:17]
  L4 r7: Advanced Ion Weapons
  L5 r7: Advanced EMP Defenses
  L4 r8: EMP Blasting  [unlocks:16]
  L5 r8: Massive Ion Weapons  [facility:3]
  L6 r8: Optimized EMP Blasting
  L3 r9: Gravitic Resonance  [unlocks:116]
  L4 r9: Advanced Gravitic Resonance
  L6 r9: Superior Gravitic Resonance
  L1 r10: Gravitic Weapons  [unlocks:115]
  L2 r10: Enhanced Gravitic Beams
  L3 r10: Advanced Gravitic Beams
  L5 r10: Gravitic Distortion Field  [unlocks:118]
  L6 r10: Gravitic Distortion Zone
  L7 r10: Gravitic Singularity Creation  [unlocks:119]
  L100 r10: Super Area Weapons  [special:3; unlocks:24]
  L2 r11: Tractor Beams  [unlocks:113]
  L3 r11: Improved Tractor Beams
  L4 r11: Extended Range Tractor Beams
  L5 r11: Gravitic Stretching
  L6 r11: Intense Gravitic Stretching
  L4 r12: High Power Tractor Beams  [unlocks:117]
  L5 r12: Gravity Densification
  L6 r12: Intense Gravitic Warping
  L1 r13: Area Weapons  [unlocks:19]
  L2 r13: Enhanced Area Weapons
  L3 r13: Advanced Area Weapons  [unlocks:21]
  L4 r13: Devastating Area Effects
  L6 r13: Optimized Blast Wave
  L2 r14: Devastating Plasma Charge  [unlocks:9]
  L4 r14: Plasma Focussing
  L6 r14: Resonant Energy Pulsing
  L3 r15: Fast Energy Propulsion  [unlocks:6]
  L4 r15: Total Energy Acceleration
  L6 r15: Smooth Energy Streams
  L1 r16: Energy Torpedo Weapons  [unlocks:5]
  L2 r16: Enhanced Torpedoes
  L3 r16: Advanced Torpedoes
  L5 r16: Advanced Plasma Physics  [unlocks:8]
  L6 r16: Intense Plasma Eruptions
  L7 r16: Plasma Hardening
  L3 r17: High Energy Cohesion  [unlocks:7]
  L4 r17: High Power Discharges
  L6 r17: Extreme Energy Vortexes
  L2 r18: Light Torpedo Bombers  [fighters:6]
  L4 r18: Medium Torpedo Bombers  [fighters:7]
  L6 r18: Strike Bombers  [fighters:8]
  L7 r18: Heavy Assault Bombers  [fighters:9]
  L1 r19: Star Fighters  [unlocks:26; fighters:0, 5]
  L2 r19: Light Interceptors  [fighters:1]
  L3 r19: Tactical Interceptors  [fighters:2; Dedicated Carriers, 3, 3, 0, 0]
  L5 r19: Advanced Fighters  [unlocks:27]
  L6 r19: Advanced Star Fighters  [fighters:3]
  L7 r19: Superiority Fighters  [fighters:4]
  L2 r20: Missile Bombers  [fighters:10]
  L3 r20: Enhanced Missile Bombers  [fighters:11]
  L5 r20: Advanced Missile Bombers  [fighters:12]
  L7 r20: Super Missile Bombers  [fighters:13]
  L1 r21: Ship Boarding  [unlocks:114]
  L3 r21: Improved Assault Techniques
  L5 r21: Heavy Ship Assault
  L7 r21: Advanced Ship Assault
  L4 r22: DualPhase Point Defense  [unlocks:14]
  L5 r22: MultiPhase Point Defense
  L6 r22: Terminal Point Defense
  L2 r23: Point Defense Weapons  [unlocks:13]
  L3 r23: Enhanced Point Defense
  L4 r23: Advanced Point Defense
  L0 r24: Missile Weapons  [unlocks:128]
  L1 r24: Enhanced Missiles  [unlocks:10]
  L3 r24: Improved Missiles
  L4 r24: Advanced Missiles
  L5 r24: Heavy Missiles  [unlocks:108]
  L6 r24: Long Range Missiles
  L7 r24: Massive Missile Assaults
  L2 r25: Bombard Weapons  [unlocks:11]
  L3 r25: Enhanced Bombardment
  L4 r25: Advanced Bombardment
  L4 r26: Annihilating Bombardment  [unlocks:12]
  L5 r26: Severe Radiation Blast
  L6 r26: Total Destruction
  L0 r27: Projectile Weapons  [unlocks:127]
  L1 r27: Rail Gun Weaponry  [unlocks:107]
  L2 r27: Rapid Fire Projectiles
  L3 r27: Projectile Arrays
  L4 r27: Massive Projectile Arrays
  L2 r28: Accelerated Projectiles  [unlocks:111]
  L3 r28: Long Range Projectiles
  L4 r28: Hyper-Accelerated Projectiles
  L5 r28: Super-Heavy Mass Drivers  [unlocks:112]
  L6 r28: Assault Mass Drivers
  L1 r29: Armor Plating  [unlocks:28]
  L3 r29: High Density Alloys  [unlocks:29]
  L4 r29: Reinforced Construction  [facility:8]
  L5 r29: Ablative Metals  [unlocks:30]
  L6 r29: Impregnable Structures  [facility:11]
  L7 r29: Indestructible Compounds  [unlocks:31]
  L2 r30: Armored Ground Assault  [facility:27; Enable Armored Forces, 5, 2, 0, 2]
  L4 r30: Armored Shock Forces  [Improved Armor Attack, 5, 4, 25, 2]
  L6 r30: Heavy Armor Forces  [Improved Armor Defense, 5, 6, -25, 2]
  L7 r30: Super Heavy Armor  [Improved Armor Attack, 5, 7, 50, 2]
  L0 r31: Ground Combat  [special:1; Enable Infantry, 5, 0, 0, 1]
  L1 r31: Improved Assault Tactics  [Improved Infantry Attack, 5, 1, 25, 1]
  L3 r31: BattleField Sabotage  [facility:31; Enable Special Forces, 5, 3, 0, 4]
  L4 r31: Special Operations  [Improved Special Forces Attack, 5, 4, 25, 4]
  L6 r31: Stealth Operations  [Improved Special Forces Defense, 5, 6, -25, 4]
  L7 r31: Elite Operations  [Improved Special Forces Attack, 5, 7, 50, 4]
  L3 r32: Superior Defense Tactics  [Improved Infantry Defense, 5, 3, -50, 1]
  L5 r32: Superior Assault Tactics  [Improved Infantry Attack, 5, 5, 50, 1]
  L7 r32: Tactical Supremacy  [Improved Infantry Defense, 5, 7, -75, 1]
  L1 r33: Improved Defense Tactics  [Improved Infantry Defense, 5, 1, -25, 1]
  L3 r33: Shipboard Marines  [Improved Boarding Attack, 0, 3, 10, 0]
  L4 r33: Ship Defense Systems  [Improved Boarding Defense, 0, 4, -10, 0]
  L5 r33: Assault Marines  [Improved Boarding Attack, 0, 5, 25, 0]
  L6 r33: Ship Defense Network  [Improved Boarding Defense, 0, 6, -25, 0]
  L7 r33: Armored Assault Marines  [Improved Boarding Attack, 0, 7, 50, 0]
  L2 r34: Planetary Defense Units  [Enable Planetary Defense, 5, 2, 0, 3]
  L3 r34: Single Layer Planetary Defense  [Improved Interception Accuracy, 5, 3, -10, 3]
  L5 r34: Multi-Layer Planetary Defense  [Improved Interception Accuracy, 5, 5, -20, 3]
  L6 r34: Orbital Defense Network  [Improved Interception Accuracy, 5, 6, -30, 3]
  L7 r34: High Orbital Defenses  [Improved Interception Accuracy, 5, 7, -50, 3]
  L3 r35: Heavy Installations  [Improved Interception Damage, 5, 3, 10, 3]
  L5 r35: Integrated Installations  [Improved Interception Damage, 5, 5, 20, 3]
  L6 r35: Core-Powered Installations  [Improved Interception Damage, 5, 6, 30, 3]
  L1 r36: Improved Logistics  [Lower Troop Maintenance, 5, 1, -10, 0]
  L4 r36: Advanced Logistics  [Lower Troop Maintenance, 5, 4, -30, 0]
  L7 r36: Superior Logistics  [Lower Troop Maintenance, 5, 7, -50, 0]
=== ENERGY (115 projects) ===
  L3 r1: Fusion Physics  [unlocks:54]
  L4 r1: Advanced Fusion Physics
  L6 r1: Fusion Cycle Secrets
  L0 r2: Space Reactors  [unlocks:120]
  L1 r2: Advanced Nuclear Fission  [unlocks:53]
  L2 r2: Nuclear Supercharging
  L3 r2: Fission Mastery
  L5 r2: Fusion Balance  [unlocks:56]
  L6 r2: HyperFusion Intensification
  L7 r2: Advanced Fusion Balance
  L3 r3: Quantum Exploitation  [unlocks:55]
  L4 r3: Quantum MicroUtilization
  L6 r3: Quantum Mastery
  L2 r4: Fusion Ignition  [unlocks:57]
  L4 r4: Intense Fusion Reactions
  L6 r4: Zero Fusion Threshold
  L2 r5: UltraFast Shield Recharging  [unlocks:36]
  L4 r5: Capacitor Overloading
  L6 r5: Pure Energy Discharge
  L3 r6: Accelerated Shield Recharge  [unlocks:33]
  L4 r6: High Energy Capacitors
  L6 r6: MultiPhase Capacitors
  L3 r7: Intensified Shield Strength  [unlocks:34]
  L4 r7: High Storage Capacitors
  L6 r7: Dense Energy Banks
  L1 r8: Shields  [unlocks:32]
  L2 r8: Enhanced Shields
  L3 r8: Shield Reinforcement
  L5 r8: Advanced Shields  [unlocks:35]
  L6 r8: Shield Multipliers
  L7 r8: Exponential Shield Effects
  L4 r9: Massive Shield Projection  [facility:4]
  L6 r9: Remote Shield Recharging  [unlocks:37]
  L7 r9: Intense Recharge Power
  L6 r10: Submerged Forcefields  [facility:24]
  L2 r11: Pulse Jump Theory  [unlocks:52]
  L4 r11: Advanced Jump Techniques
  L6 r11: Unified Pulse Jump Theory
  L3 r12: Fast Jump HyperDrives  [unlocks:48]
  L4 r12: Accelerated HyperJump
  L6 r12: Instant Jump Initiation
  L3 r13: High Speed HyperDrives  [unlocks:49]
  L4 r13: Hyper Slipstreaming
  L6 r13: Hyper Flow Dynamics
  L3 r14: Efficient HyperDrives  [unlocks:50]
  L4 r14: Jump Efficiency
  L6 r14: Jump Energy Recycling
  L0 r15: Warp Field Precursors  [special:2; unlocks:125]
  L1 r15: HyperDrive Technology  [unlocks:47]
  L2 r15: Enhanced HyperDrives
  L3 r15: Jump Sequence Optimization
  L5 r15: Advanced HyperDrives  [unlocks:51]
  L6 r15: Hyperspace PathSlicing
  L7 r15: Unified HyperDrive Theory
  L2 r16: Hyperjump Inhibiting  [unlocks:18]
  L3 r16: Advanced Jump Stalling
  L4 r16: Refined Hyperjump Theory  [unlocks:20]
  L5 r16: Long Range Jump Blocking
  L6 r16: Hyperjump Disruption  [unlocks:22]
  L7 r16: Advanced Jump Disruption
  L2 r17: Ultra Efficient Engines  [unlocks:42]
  L4 r17: Lossless Energy Conversion
  L6 r17: Energy Overloading
  L3 r18: Efficient Energy Conversion  [unlocks:39]
  L4 r18: Pure Energy Conversion
  L6 r18: Optimized Engine Efficiency
  L0 r19: Starship Engines  [unlocks:121]
  L1 r19: Proton Ionization  [unlocks:38]
  L2 r19: Enhanced Engines
  L3 r19: Advanced Proton Ionization
  L5 r19: Advanced Engines  [unlocks:41]
  L6 r19: Harmonized Thrust
  L7 r19: Resonant Thrust Output
  L3 r20: High Volume Thrust  [unlocks:40]
  L4 r20: Maximized Thrust Output
  L6 r20: Surplus Thrust Overload
  L2 r21: Very High Thrust Engines  [unlocks:43]
  L4 r21: Synchronized Thrust
  L6 r21: Intense Thrust Output
  L0 r22: Starship Maneuvering  [unlocks:122]
  L1 r22: Enhanced Maneuvering  [unlocks:44]
  L2 r22: Advanced Maneuvering
  L3 r22: Coordinated Maneuvering
  L4 r22: High Speed Turning  [unlocks:45]
  L5 r22: Advanced Maneuvering
  L6 r22: Ultimate Maneuvering
  L2 r23: Accelerated Maneuvering  [unlocks:46]
  L3 r23: Swift Maneuvering
  L5 r23: Directional Vectoring
  L0 r24: Mining  [special:1; unlocks:59, 60, 61]
  L3 r24: Fast Mining
  L4 r24: Self-Optimizing Extractors
  L6 r24: High Power Extractors
  L1 r25: Energy Collection  [unlocks:58]
  L3 r25: Enhanced Energy Collection
  L4 r25: High Power Receptors
  L6 r25: Total Energy Absorption
  L7 r25: Advanced Energy Secrets  [unlocks:109]
  L3 r26: Accelerated Construction  [facility:10; Resupply Ships, 3, 3, 0, 1]
  L4 r26: Robotic Defenses  [facility:1]
  L0 r27: Orbital Assembly  [unlocks:94, 62, 63, 64]
  L1 r27: Space Construction  [Increased Construction Size, 2, 1, 230, 0]
  L2 r27: Enhanced Construction  [Increased Construction Size, 2, 2, 300, 0]
  L3 r27: Component PreFabrication  [Increased Construction Size, 2, 3, 400, 0]
  L4 r27: LargeScale Construction  [Increased Construction Size, 2, 4, 500, 0]
  L5 r27: Rapid Assembly  [Increased Construction Size, 2, 5, 650, 0]
  L6 r27: MegaScale Construction  [Increased Construction Size, 2, 6, 800, 0]
  L7 r27: Automated Manufacturing  [Increased Maximum Construction Size, 2, 7, 1100, 0]
  L8 r27: Colossal Construction  [Increased Maximum Construction Size, 2, 8, 1500, 0]
  L3 r28: Damage Control  [unlocks:95]
  L4 r28: Enhanced Damage Control
  L5 r28: Robotic Repairs  [unlocks:96]
  L6 r28: Enhanced Robotic Repairs
  L3 r29: Swift Robotic Repairs  [unlocks:97]
  L5 r29: Advanced Robotic Repairs
=== HIGHTECH (105 projects) ===
  L2 r1: Holographic Projection  [unlocks:87]
  L3 r1: Advanced Holograms
  L4 r1: MultiDimensional Holograms
  L6 r1: Holographic Manipulation
  L1 r2: Countermeasures  [unlocks:84]
  L2 r2: Enhanced Countermeasures
  L3 r2: Fleet Countermeasures  [unlocks:90]
  L4 r2: Advanced Countermeasures
  L5 r2: Advanced Fleet Countermeasures
  L6 r2: Optimal Countermeasures
  L1 r3: Target Tracking  [unlocks:83]
  L2 r3: Enhanced Target Tracking
  L3 r3: Fleet Targeting  [unlocks:89]
  L4 r3: Advanced Target Tracking
  L5 r3: Advanced Fleet Targeting
  L6 r3: Optimal Target Tracking
  L2 r4: Situational Awareness AI  [unlocks:88]
  L3 r4: Advanced Tracking AI
  L4 r4: Predictive Target Tracking
  L6 r4: Tracking Omniscience
  L2 r5: Long Range Scanners  [unlocks:78]
  L3 r5: Enhanced Scanners
  L4 r5: Advanced Scanners
  L5 r5: Deep Space Arrays  [unlocks:79]
  L6 r5: Enhanced Arrays
  L7 r5: Advanced Arrays
  L1 r6: Proximity Sensors  [unlocks:75]
  L2 r6: Enhanced Sensors
  L3 r6: Advanced Sensors
  L4 r6: Stealth  [unlocks:82; facility:28]
  L5 r6: Directional Jump Sensing  [unlocks:76]
  L6 r6: Jump Intercept
  L7 r6: Jump Prediction
  L8 r6: Advanced Stealth
  L0 r7: Resource Exploration  [special:1; unlocks:77]
  L1 r7: Enhanced Resource Exploration
  L2 r7: Advanced Resource Exploration
  L3 r7: Ship Scanning  [unlocks:80]
  L4 r7: Scanner Jamming  [unlocks:81]
  L5 r7: Enhanced Ship Scanning
  L6 r7: Advanced Jamming
  L7 r7: Advanced Ship Scanning
  L2 r8: Marshy Swamp Colonization  [special:4; Colonize Marshy Swamp planets, 1, 2, 2, 0]
  L4 r8: Ocean Colonization  [unlocks:103; facility:9; Colonize Ocean planets, 1, 3, 3, 0,		Marshy Swamp colony growth rate doubled, 4, 3, 2, 0]
  L6 r8: Ice Colonization  [Colonize Ice planets, 1, 5, 5, 0,		Ocean colony growth rate doubled, 4, 5, 3, 0]
  L7 r8: Hive Colonies  [facility:21]
  L1 r9: Colonization  [unlocks:102]
  L2 r9: Continental Colonization  [Colonize Continental planets, 1, 1, 1, 0]
  L4 r9: Desert Colonization  [unlocks:103; facility:9; Colonize Desert planets, 1, 3, 4, 0,		Continental colony growth rate doubled, 4, 2, 1, 0]
  L6 r9: Volcanic Colonization  [Colonize Volcanic planets, 1, 5, 6, 0,		Desert colony growth rate doubled, 4, 5, 4, 0]
  L7 r9: Advanced Colonization  [unlocks:104; Ice colony growth rate doubled, 4, 6, 5, 0,		Volcanic colony growth rate doubled, 4, 6, 6, 0]
  L1 r10: Transport Systems  [unlocks:70, 72]
  L2 r10: Enhanced Transport
  L3 r10: Advanced Troop Transport  [unlocks:71]
  L4 r10: Planetary Defense  [facility:0]
  L5 r10: Ultimate Troop Transport
  L7 r10: Magma Harnessing  [facility:23]
  L3 r11: Advanced Passenger Transport  [unlocks:73]
  L4 r11: Luxury Passenger Transport
  L2 r12: Compressed Fuel Storage  [unlocks:67]
  L4 r12: Advanced Fuel Storage  [unlocks:66]
  L6 r12: Optimized Fuel Storage
  L0 r13: Basic Storage and Payloads  [unlocks:123, 124]
  L1 r13: Storage Systems  [unlocks:65, 68]
  L2 r13: Enhanced Storage
  L4 r13: Advanced Cargo Storage  [unlocks:69]
  L6 r13: Optimized Cargo Storage
  L7 r13: Archival Facilities  [facility:22]
  L0 r14: Docking Bay  [special:1; unlocks:74]
  L3 r14: Coordinated Docking
  L5 r14: High Volume Cargo Transfer
  L7 r14: Automated Cargo Conveyers
  L0 r15: Basic Crew Environment  [unlocks:98, 99]
  L1 r15: Crew Systems
  L3 r15: Enhanced Crew Systems
  L5 r15: Advanced Crew Systems
  L7 r15: Luxury Crew Environment
  L1 r16: Medical Systems  [unlocks:100]
  L3 r16: Advanced Medicine
  L4 r16: Biological Workshops  [facility:14]
  L5 r16: Genetic Replication  [facility:2]
  L6 r16: Genetic Rewiring  [facility:16]
  L1 r17: Entertainment Systems  [unlocks:101]
  L3 r17: Holographic Entertainment
  L4 r17: Networked Entertainment  [facility:12]
  L5 r17: Virtual Reality
  L6 r17: Total Immersion Recreation  [facility:15]
  L0 r18: Research Laboratories  [unlocks:91, 92, 93]
  L2 r18: Structured Research  [facility:29]
  L3 r18: Enhanced Research  [facility:18]
  L4 r18: Armaments Research  [facility:19]
  L5 r18: Advanced Research  [facility:17]
  L7 r18: Accelerated Research
  L0 r19: Space Command  [special:1; unlocks:85]
  L2 r19: Coordinated Control
  L3 r19: Planetary Governance  [facility:5]
  L4 r19: Officer Training  [facility:30]
  L5 r19: Regional Governance  [facility:6]
  L6 r19: Advanced Command
  L7 r19: Galactic Governance  [facility:7]
  L0 r20: Space Commerce  [special:1; unlocks:86]
  L3 r20: Enhanced Commerce
  L4 r20: Open Trade Network  [facility:13]
  L5 r20: Efficient Transactions
  L6 r20: Unlimited Commerce  [facility:20]
TOTAL 372

## APPENDIX G — DESIGN TEMPLATE ROSTER AND FORMAT

Every race folder (22 playable races + Shakturi + Mechanoid + a DEFAULT set) contains the identical set of starting design templates (30 ship/base templates + BLANK):

BLANK, Capital Ship, Carrier, Colony Ship, Construction Ship, Cruiser, Defensive Base, Destroyer, Energy Research Station, Escort, Exploration Ship, Frigate, Gas Mining Ship, Gas Mining Station, HighTech Research Station, Large Freighter, Large Spaceport, Medium Freighter, Medium Spaceport, Mining Ship, Mining Station, Monitoring Station, Passenger Ship, Resort Base, Resupply Ship, Small Freighter, Small Spaceport, Troop Transport, Weapons Research Station — plus a `pirate` subfolder holding pirate-faction starting designs.

Template file format (verbatim structure, from designTemplates/<race>/<template>.txt — the counts differ per race and per template; human/carrier.txt shown as a complete example):

```
'Distant Worlds Design Template - 1.9.0.0

'Specify amounts of each component type below. The amount should be a whole number greater than or equal to zero, and should be placed immediately after the semi-colon.
'Note that it is not necessary to specify Command Center, Life Support or Hab Module components. A sufficient number of each of these components will automatically be added to all designs.
'Also note that while Reactors and Energy Collectors can be specified here, an adequate amount of these components will always be added to meet the energy needs of the design.
'Also, for ships you do not need to specify a HyperDrive - a single hyperdrive will always automatically be added to ship design templates.

'Carrier ship type

AreaShieldRecharge			;0
Armor						;20
AssaultPod					;0
CargoBay					;0
ColonizationModule			;0
CombatTargettingSystem		;1
CommerceCenter				;0
ConstructionYard			;0
CountermeasuresSystem		;1
DamageControl				;1
DockingBay					;0
EnergyCollector				;1
EnergyManufacturingPlant	;0
EnergyResearchLab			;0
EnergyToFuelConverter		;0
Engine						;12
FighterBay					;6
FleetCountermeasuresSystem	;1
FleetTargettingSystem		;1
FuelCell					;5
GasExtractor				;0
GravityWellProjector		;0
HighTechManufacturingPlant	;0
HighTechResearchLab			;0
HyperDeny					;0
IonCannon					;0
IonDefense					;1
IonPulse					;0
LongRangeScanner			;0
LuxuryResourceExtractor		;0
MedicalCenter				;0
MiningEngine				;0
PassengerCompartment		;0
PointDefense				;8
ProximityArray				;1
Reactor						;2
RecreationCenter			;0
ResourceProfileSensor		;0
ScannerJammer				;0
Shields						;6
StealthCloak				;1
TraceScanner				;1
TroopCompartment			;0
VectoringEngine				;3
WeaponArea					;0
WeaponBeam					;1
WeaponBombard				;0
WeaponMissile				;0
WeaponPhaser				;0
WeaponRailGun				;0
WeaponsManufacturingPlant	;0
WeaponsResearchLab			;0
WeaponSuperBeam				;0
WeaponTorpedo				;0
WeaponTractorBeam			;0
WeaponGravitonBeam			;0
WeaponAreaGravity			;0
```

The same component-type vocabulary is used by every race. What differs between races is which underlying component *definitions* (stat blocks from components.txt) each named type resolves to (each race has its own variant set) and which race-locked SpecialComponents each race can use. The 1.9.x template sets also include super-weapon component lines (WeaponSuperMissile, WeaponSuperPhaser, WeaponSuperRailGun, WeaponSuperTorpedo) in military templates.

## APPENDIX H — FLEET SYSTEM (fleet creation, postures, ranges, auto-response — from official documentation)

Fleets allo=
w you to
group a number of military ships together and assign missions to the entire
group. This is useful for coordinating large attacks on enemy targets.=
Large fleets are effective for major assaults against enemy targets li=
ke colonies
or spaceports. Smaller fleets (often called strike forces) are useful for
intercepting enemy attacks and making small raids.
Your automated fleets will respond to intercept enemy attacks when the=
re
are insufficient forces to defend the target. The nearest available automat=
ed
fleet will travel to the attack location and defend the target.
Creating a =
new
fleet
T=
o create a
new fleet first select at least one military ship. You may also multi-selec=
t a
group of military ships, either using drag-select or by shift-clicking the
ships.
W=
ith one or
more military ships selected, do one of the following:
&middot;      =
  
Click
the &#8220;New Fleet&#8221; Action button (under the Selection Panel)
&middot;      =
  
Right-click to show a pop-up=
 menu
with a &#8220;Join Fleet&#8221; menu option. This will contain a submenu it=
em
to join a &#8220;(New Fleet)&#8221;
A=
ssigning
ships to fleets
To assign a military ship to a fleet you have three options:
&middot;      =
  
From the main screen select the ship, then click the
&#8220;Join Nearest Fleet&#8221; Action button (below the Selection Panel).=
&middot;      =
  
From the ma=
in screen
select the ship, then right-click to show a pop-up menu with a &#8220;Join
Fleet&#8221; menu option. This will contain a submenu listing all of the fl=
eets
in your empire. You also have the option to assign the ship to a new fleet.=
&middot;      =
  
In the Ships and Bases screen (F11) select the ship in the
master list, then select a fleet from the list at the bottom of the screen.=
S=
electing
fleets
There are f=
our ways
to select a fleet in the main view:
&middot;      =
  
When zoomed out to sector-level or greater your fleets ap=
pear
as an inverted triangle icon. Click the fleet icon to select it.=
&middot;      =
  
When zoomed in to system-level or lower, you can double-c=
lick
any ship in the fleet to select the entire fleet.
&middot;      =
  
Using the Empire Navigation Tool, open the Fleets list and
click the desired fleet
&middot;      =
  
Cycle all of your fleets by repeatedly pressing the F key=
When a fleet is selected you can assign missions to it in the same way=
 you
would assign missions to a single ship.
F=
leet Postures
Fleets are assigned postures that define how they are used. Fleets are=
 set
to either Attack or Defend. They also have a response range set that determ=
ines
how far they will respond from their home base (for Defend fleets), or how =
far
from their attack target they will select a new target (for Attack fleets).=
Setting Posture
To set a=
 fleet&#8217;s
posture (Attack or Defend), with the fleet selected, click the Set Posture =
action
button below the Selection Panel. This will toggle between the two setting=
s.
Setting Range=
To set a fleet&#8217;s range=
, with
the fleet selected, click the Set Range action button below the Selection
Panel. This will cycle through the various ranges as described below.
Ranges for Attack Fleets
&middot;      =
  
Target: only attack specified target=
&middot;      =
  
System: attack specified target and then any ot=
her
enemy targets in the same system
&middot;      =
  
Nearby Systems: attack specified target an=
d then
any other enemy targets in the nearby systems
&middot;      =
  
Sector: attack specified target and then any ot=
her
enemy targets in the surrounding sector
&middot;      =
  
Anywhere: attack specified target and then any ot=
her
enemy target, or if no attack target set just attack any enemy target
Ranges for Defend Fleets
&middot;      =
  
Target: only defend Home Base=
&middot;      =
  
System: defend Home Base and its system
&middot;      =
  
Nearby Systems: defend Home Base and nearby
systems 
&middot;      =
  
Sector: defend Home Base and surrounding sector=
&middot;      =
  
Anywhere: defend Home Base and any other empire
colonies or bases under attack, or if no home base set just defend any empi=
re
colony or base that is attacked
Setting a Home Bas=
e
To set a fleet&#8217;s home =
base,
with the fleet selected, click the Set Home Base action button below the
Selection Panel. The mouse pointer will change to show a symbol of a colony=
 and
fleet. Then click on any valid home base in the main view to set this as the
fleet&#8217;s new home base.
V=
alid bases
include any space port, colony or gas mining station of your empire. If you
have a military refueling agreement with another empire then you can also s=
et
your fleet&#8217;s home base to be any of their space ports, colonies or gas
mining stations. To clear the fleet&#8217;s home base, click the Set Home B=
ase action
button, then click anywhere in empty space.
F=
or Defend
fleets, the defend area (centered on the fleet&#8217;s home base, and the s=
ize
of the fleet&#8217;s range) is shown in the main view as a blue circle (if =
Fleet
Postures map overlay is switched on).
Setting an Attack =
Target
To set the attack target of =
an
Attack fleet, with the fleet selected, click the Set Attack Target action
button below the Selection Panel. The mouse pointer will change to show a
symbol of a fleet and targeting reticule. Then click any valid enemy target=
 in
the main view to set this as the Attack fleet&#8217;s attack target. When w=
ar
begins your Attack fleet will travel to this target and attack your enemy.
V=
alid enemy
attack targets include any colonies or bases of another empire. To clear the
fleet&#8217;s attack target, click the Set Attack Target action button, then
click anywhere in empty space.
F=
or Attack
fleets, the path from the fleet&#8217;s home base to its attack target is s=
hown
in the main view as a dotted red line (if Fleet Postures map overlay is
switched on).
.32888070--

## APPENDIX I — PLAGUE DATA (plagues.txt)

Field layout per line: `ID, Name, PictureRef, MortalityRate (0.001–5.0, fraction of population lost per year), InfectionChance (0–1000, spread chance to nearby colonies), Duration (in-game seconds; 300 = 6 months), NaturalOccurrenceLevel (0–10; 0 = no natural outbreaks), CanCompletelyEliminatePopulation (Y/N; if N the population floors at 10 million), ExceptionRaceName, ExceptionMortalityRate, ExceptionInfectionChance, ExceptionDuration, SpecialFunctionCode (0=NONE, 1=Xaraktor virus — researchable and deployable bioweapon), Description (≤200 characters)`

```
0, Hekretos Fever, |  |  |  |  | 0, 0.06, 30, 150, 3, N, |  | , 0, 0, 0, 0, |  |  |  |  |  | Hekretos Fever is a deadly infection that attacks the internal organs, causing rapid degeneration and death. An outbreak of Hekretos Fever typically lasts about 3 months.
1, Dekara Virus, |  |  |  |  | 1, 0.09, 10, 300, 3, N, |  | , 0, 0, 0, 0, |  |  |  |  |  | Dekara Virus is a very painful disease that slowly cripples the central nervous system of any creature it infects, ultimately leading to death. An outbreak of Dekara Virus typically lasts about 6 months.
2, Genetic Scrambling Syndrome, |  | 2, 0.45, 85, 60, 2, N, |  | , 0, 0, 0, 0, |  |  |  |  |  | Genetic Scrambling Syndrome attacks the genetic code in all of the cells of an infected creature, wiping out any useful biological instructions. This leads to very rapid disintegration of the infected creature, finally breaking them down to a puddle of protein slime. An outbreak of Genetic Scrambling Syndrome typically lasts only one month. However it is highly infectious and thus can spread rapidly.
3, Merturov Plague, |  |  |  |  | 3, 0.27, 25, 180, 1, N, |  | , 0, 0, 0, 0, |  |  |  |  |  | Merturov Plague is the most deadly disease in the known galaxy. It swiftly eats the brain of the infected creature, progressively causing insanity, immobilization and eventual death. Merturov Plague is a highly resilient air-borne virus, and is thus very infectious. An outbreak of Merturov Plague typically lasts 4 months.
```

The four base plagues (exact values, in the order above):
1. **Hekretos Fever** (PictureRef 0): mortality 0.06, infection 30, duration 150 s (≈3 months), natural occurrence 3, cannot eliminate — "a deadly infection that attacks the internal organs, causing rapid degeneration and death."
2. **Dekara Virus** (1): mortality 0.09, infection 10, duration 300 s (≈6 months), natural occurrence 3 — "a very painful disease that slowly cripples the central nervous system... ultimately leading to death."
3. **Genetic Scrambling Syndrome** (2): mortality 0.45, infection 85, duration 60 s (≈1 month), natural occurrence 2 — "highly infectious and thus can spread rapidly."
4. **Merturov Plague** (3): mortality 0.27, infection 25, duration 180 s (≈4 months), natural occurrence 1 — "the most deadly disease in the known galaxy... a highly resilient air-borne virus, and is thus very infectious."

The **Xaraktor Virus** (Ancient Galaxy storyline) is defined with SpecialFunctionCode 1: it is researchable (via a special research project) and then deployable by the player as a bioweapon against enemy colonies.

In-game plague behavior: an outbreak strikes a colony (natural occurrence weighted by NaturalOccurrenceLevel; or deployed via Xaraktor/pirate special abilities); the colony population decays at the mortality rate over the duration; each game day an InfectionChance roll can seed a new outbreak at another nearby colony; colonies of a race matching ExceptionRaceName use the exception values; plagues are drawn on the galaxy map, reported in colony messages, and can be countered (vaccines via research/policy). Plague definitions are one of the moddable content files and one of the intelligence-sabotage event actions (StartPlague/EndPlague).

## APPENDIX J — EMPIRE POLICY DEFAULTS

The game ships one policy file per race (Policy/<race>.txt) — 22 files using the identical schema of 165 settings shown below (human defaults reproduced verbatim; every other race's file must be reproduced with its exact values from the game data). Format: `SettingName ;value`.

```
ImmediatelyRecruitNewTroopsWhenColonize		;N
ColonyAllowFacilityCloningFacility		;Y
ColonyAllowFacilityFortifiedBunker		;Y
ColonyAllowFacilityGiantIonCannon		;Y
ColonyAllowFacilityPlanetaryShield		;Y
ColonyAllowFacilityRegionalCapital		;Y
ColonyAllowFacilityRoboticTroopFoundry		;Y
ColonyAllowFacilityTerraformingFacility		;Y
ColonyAllowFacilityTroopTrainingCenter		;Y
ColonyAllowFacilityArmoredFactory		;Y
ColonyAllowFacilitySpyAcademy		;Y
ColonyAllowFacilityScienceAcademy		;Y
ColonyAllowFacilityNavalAcademy		;Y
ColonyAllowFacilityMilitaryAcademy		;Y
ColonyFacilityPopulationThresholdCloningFacility		;500
ColonyFacilityPopulationThresholdFortifiedBunker		;500
ColonyFacilityPopulationThresholdGiantIonCannon		;5000
ColonyFacilityPopulationThresholdPlanetaryShield		;2000
ColonyFacilityPopulationThresholdRegionalCapital		;5000
ColonyFacilityPopulationThresholdRoboticTroopFoundry		;500
ColonyFacilityPopulationThresholdTerraformingFacility		;500
ColonyFacilityPopulationThresholdTroopTrainingCenter		;500
ColonyFacilityPopulationThresholdArmoredFactory		;500
ColonyFacilityPopulationThresholdSpyAcademy		;2000
ColonyFacilityPopulationThresholdScienceAcademy		;5000
ColonyFacilityPopulationThresholdNavalAcademy		;5000
ColonyFacilityPopulationThresholdMilitaryAcademy		;2000
ColonyPopulationThresholdTroopRecruitment		;0
ColonyTaxRateIncreaseWhenAtWar		;Y
ColonyTaxRateLargeColony		;3
ColonyTaxRateMediumColony		;2
ColonyTaxRateSmallColony		;0
MilitaryConstructionLevel		;1
ConstructionMilitaryCapitalShip		;7
ConstructionMilitaryCarrier		;8
ConstructionMilitaryCruiser		;15
ConstructionMilitaryDestroyer		;20
ConstructionMilitaryEscort		;18
ConstructionMilitaryFrigate		;24
ConstructionMilitaryTroopTransport		;8
ConstructionSpaceportLargeColonyPopulationThreshold		;3000
ConstructionSpaceportMediumColonyPopulationThreshold		;500
ConstructionSpaceportSmallColonyPopulationThreshold		;30
ConstructionSpaceportMinimumDistance		;700
DiplomacySendGiftsUpToAmount		;20000
DiplomacyTradeSanctionsUseBlockades		;Y
FleetMilitaryProportionForFleets		;70
FleetStrikeForceTypicalSize		;4
FleetTypicalSize		;15
IntelligenceAllowMissionDeepCover		;Y
IntelligenceAllowMissionInciteRevolution		;Y
IntelligenceAllowMissionSabotageColony		;Y
IntelligenceAllowMissionSabotageConstruction		;Y
IntelligenceAllowMissionStealGalaxyMap		;Y
IntelligenceAllowMissionStealOperationsMap		;Y
IntelligenceAllowMissionStealTechData		;Y
IntelligenceAllowMissionStealTerritoryMap		;Y
IntelligenceAllowMissionAssassinateCharacter		;Y
IntelligenceAllowMissionDestroyBase		;Y
IntelligenceCounterIntelligenceProportion		;30
IntelligenceUseEspionageAgainstEmpireWhen		;2
IntelligenceUseSabotageAgainstEmpireWhen		;1
ResearchDesignAutoRetrofit		;Y
ResearchDesignOverallFocus		;0
ResearchDesignTechFocus1		;9
ResearchDesignTechFocus2		;6
ResearchDesignTechFocus3		;1
ResearchDesignTechFocus4		;0
ResearchDesignTechFocus5		;0
ResearchDesignTechFocus6		;0
ResearchDesignAutoUpgradeFighters		;Y
WarAttacksAllowColonyBombardment		;2
WarAttacksAllowPlanetDestroying		;2
WarAttacksHarassEnemies		;Y
TradeWithOtherEmpires		;Y
EngageInTourism		;Y
NewColonyPopulationPolicyYourRaceFamily		;0
NewColonyPopulationPolicyAllRaces		;0
ImplementEnslavementWithPenalColonies		;N
HomeworldDefensePriority		;1
ProtectLeaderAtAllCosts		;N
PrioritizeBuildWonderId		;-1
ColonizeContinentalPriority		;2
ColonizeMarshySwampPriority		;1
ColonizeOceanPriority		;1
ColonizeDesertPriority		;1
ColonizeIcePriority		;1
ColonizeVolcanicPriority		;1
ColonizeRuinsPriority		;1
ControlRestrictedResourcesPriority		;1
ResearchIndustryFocus		;0
ResearchPriority		;1
TradePriority		;2
AlliancePriority		;2
SubjugationPriority		;1
TourismPriority		;2
ExplorationPriority		;1
WarWillingness		;1
BreakTreatyWillingness		;1
InvasionOverkillFactor		;1
ShipBattleCautionFactor		;1
DefaultMilitaryFleeWhen		;4
DesignUpgradeEscort		;Y
DesignUpgradeFrigate		;Y
DesignUpgradeDestroyer		;Y
DesignUpgradeCruiser		;Y
DesignUpgradeCapitalShip		;Y
DesignUpgradeTroopTransport		;Y
DesignUpgradeCarrier		;Y
DesignUpgradeResupplyShip		;Y
DesignUpgradeExplorationShip		;Y
DesignUpgradeColonyShip		;Y
DesignUpgradeConstructionShip		;Y
DesignUpgradeSmallSpacePort		;Y
DesignUpgradeMediumSpacePort		;Y
DesignUpgradeLargeSpacePort		;Y
DesignUpgradeResortBase		;Y
DesignUpgradeGenericBase		;Y
DesignUpgradeEnergyResearchStation		;Y
DesignUpgradeWeaponsResearchStation		;Y
DesignUpgradeHighTechResearchStation		;Y
DesignUpgradeMonitoringStation		;Y
DesignUpgradeDefensiveBase		;Y
DesignUpgradeSmallFreighter		;Y
DesignUpgradeMediumFreighter		;Y
DesignUpgradeLargeFreighter		;Y
DesignUpgradePassengerShip		;Y
DesignUpgradeGasMiningShip		;Y
DesignUpgradeMiningShip		;Y
DesignUpgradeGasMiningStation		;Y
DesignUpgradeMiningStation		;Y
CaptureTargetConditionShip		;1
CaptureTargetConditionBase		;1
OfferPirateAttackMissions		;2
BidOnPirateAttackMissions		;N
BidOnPirateDefendMissions		;N
OfferDefensivePirateMissions		;2
OfferDefensivePirateMissionsSituation		;2
AcceptPirateSmugglingMissions		;N
OfferSmugglingPirateMissions		;2
PirateSmugglerFreighterLevel		;1
PirateSmugglerMiningLevel		;1
PirateSmugglerPassengerLevel		;1
CaptureEnlistMilitaryShip		;0
CaptureDisassembleMilitaryShip		;1
CaptureEnlistCivilianShip		;2
CaptureDisassembleCivilianShip		;1
CaptureEnlistBase		;0
UpgradeEnlistedMilitaryShips		;Y
UpgradeEnlistedCivilianShips		;Y
TroopRecruitInfantryLevel		;1
TroopRecruitArmorLevel		;1
TroopRecruitArtilleryLevel		;1
TroopRecruitSpecialForcesLevel		;1
TroopUseDefaultTransportLoadout		;Y
TroopDefaultTransportLoadoutInfantry		;0.25
TroopDefaultTransportLoadoutArmor		;0.5
TroopDefaultTransportLoadoutArtillery		;0
TroopDefaultTransportLoadoutSpecialForces		;0.25
TroopGarrisonMinimumPerColony		;0
TroopGarrisonLevel		;1
UseExplorationShipsToScoutEnemySystems		;Y
BuildPlanetDestroyers		;N
```

Race policy files present in the game data: Ackdarian, Atuuk, Boskara, Dhayut, Gizurean, Haakonish, Human, Ikkuro, Ketarov, Kiadian, Mortalen, Naxxilian, Quameno, Securan, Shakturi, Shandar, Sluken, Teekan, Ugnari, Wekkarus, Zenox (one per race; same setting order).

The policy system is fully player-editable in the Empire → Policy screen (every setting has a UI row with in-game help text), and every AI empire runs on its race's policy defaults modified by its decision-making.

## APPENDIX K — COMPLETE ENUMERATION GLOSSARY (every enum in the game's data model, verbatim from the reference build — this is the game's complete controlled vocabulary)

## AchievementType (AchievementType.cs)
Undefined, AchieveAllRaceVictoryConditions, DestroyEnemyMilitaryShipsAndBases, DestroyEnemyCivilianShipsAndBases, DestroyEnemyTroops, DestroySpaceMonsters, DestroySilverMists, ConquerEnemyColonies, SuccessfulIntelligenceMissions, StartWars, BreakTreaties, EliminateEnemyCharacters, EliminateEnemyEmpires, HighestTradeIncome, HighestMiningVolume, CaptureEnemyShips, EliminatePirateFactions, SpendAllTimeAtWar, SpendNoTimeAtWar, SuccessfulRaids, ChangeGovernmentToWayOfDarkness, ChangeGovernmentToWayOfTheAncients, EmpireSplits, BuildWonders, OwnOperationalPlanetDestroyer, JoinTheFreedomAlliance, JoinTheShakturi, DefeatAncients, DefeatShakturi, DefeatLegendaryPirates

## AdvisorMessageType (AdvisorMessageType.cs)
Undefined, BuildOrder, BuildOneOff, Colonization, IntelligenceMission, EnemyAttack, EnemyBombard, EnemyBlockade, EnemyAttackPlanetDestroyer, InvadeIndependent, PrepareRaid, DiplomaticGift, TreatyOffer, WarTradeSanctions, ColonyFacility, OfferMilitaryRefueling, CancelMilitaryRefueling, OfferMiningRights, CancelMiningRights, AllowTradeRestrictedResources, DisallowTradeRestrictedResources, ComplyTradeSanctionsOther, ComplyWarOther, DefendTerritory, Retrofit, RequestLiftTradeSanctionsOther, RequestEndWarOther, OfferPirateAttackMission, OfferPirateDefendMission, OfferPirateSmuggleMission, PirateRaid, PirateFacilityEradicate, AcceptPirateSmugglingMission, DefendTarget

## AutomationLevel (AutomationLevel.cs)
Manual, SemiAutomated, FullyAutomated

## AutomationResponse (AutomationResponse.cs)
Undefined, Yes, No

## BattleTactics (BattleTactics.cs)
Undefined, Evade, Standoff, AllWeapons, PointBlank

## BuiltObjectEncounterAction (BuiltObjectEncounterAction.cs)
Prompt, Notify, None

## BuiltObjectEncounterEventType (BuiltObjectEncounterEventType.cs)
Acquire, PirateAmbush, Explodes

## BuiltObjectFleeWhen (BuiltObjectFleeWhen.cs)
Undefined, EnemyMilitarySighted, Attacked, Shields50, Shields20, Never, Armor50

## BuiltObjectImageSize (BuiltObjectImageSize.cs)
Undefined, Small, Fullsize

## BuiltObjectMissionPriority (BuiltObjectMissionPriority.cs)
Undefined, Low, Normal, High, VeryHigh, Unavailable

## BuiltObjectMissionType (BuiltObjectMissionType.cs)
Undefined, Explore, Build, BuildRepair, Transport, Patrol, Escort, Rescue, Blockade, Attack, Escape, Retire, Retrofit, Colonize, Waypoint, Hold, WaitAndAttack, WaitAndBombard, MoveAndWait, Refuel, ExtractResources, LoadTroops, UnloadTroops, Deploy, Undeploy, Repair, Move, Bombard, Capture, Reinforce, Raid

## BuiltObjectRole (BuiltObjectRole.cs)
Undefined, Military, Exploration, Freight, Passenger, Colony, Build, Resource, Base

## BuiltObjectStance (BuiltObjectStance.cs)
Undefined, AttackUnallied, AttackEnemies, AttackIfAttacked, DoNotAttack

## BuiltObjectSubRole (BuiltObjectSubRole.cs)
Undefined, Escort, Frigate, Destroyer, Cruiser, CapitalShip, TroopTransport, Carrier, ResupplyShip, ExplorationShip, SmallFreighter, MediumFreighter, LargeFreighter, ColonyShip, PassengerShip, ConstructionShip, GasMiningShip, MiningShip, GasMiningStation, MiningStation, SmallSpacePort, MediumSpacePort, LargeSpacePort, ResortBase, GenericBase, EnergyResearchStation, WeaponsResearchStation, HighTechResearchStation, MonitoringStation, DefensiveBase

## CharacterDeathType (CharacterDeathType.cs)
Undefined, GenericDeath, Assassination, ShipDestroyed, BaseDestroyed, ColonyInvasion, ColonyBombardment, Disaster, ShipCaptured, BaseCaptured, Dismissed

## CharacterEventType (CharacterEventType.cs)
Undefined, TreatySigned, WarStarted, WarEnded, TradeIncome, TourismIncome, ColonyDevelopmentIncrease, ColonyDevelopmentDecrease, CashNegative, CashPositive, TroopComplete, IntelligenceMissionSucceedEspionage, IntelligenceMissionSucceedSabotage, IntelligenceMissionFailEspionage, IntelligenceMissionFailSabotage, IntelligenceMissionInterceptEnemy, IntelligenceAgentOursCaptured, IntelligenceAgentRecruited, ResearchAdvanceWeapons, ResearchAdvanceEnergy, ResearchAdvanceHighTech, BuildMilitaryShip, BuildCivilianShip, BuildColonyShip, BuildMilitaryBase, BuildSpaceport, BuildResearchStationWeapons, BuildResearchStationEnergy, BuildResearchStationHighTech, BuildMiningStation, BuildResortBase, BuildOtherBase, BuildFacility, BuildWonder, HyperjumpExit, SpaceBattle, GroundInvasion, TargetOfFailedAssassination, Subjugated, TreatyBroken, AmbassadorAssignedToEmpire, CriticalResearchSuccess, CriticalResearchFailure, CharacterStart, CharacterTraitGain, CharacterSkillGain, CharacterSkillProgress, CharacterTransferLocation, Boarding, Raid, SmugglingSuccess, SmugglingDetection

## CharacterRole (CharacterRole.cs)
Undefined, Leader, Ambassador, ColonyGovernor, FleetAdmiral, TroopGeneral, IntelligenceAgent, Scientist, PirateLeader, ShipCaptain

## CharacterSkillType (CharacterSkillType.cs)
Undefined, Diplomacy, ColonyIncome, TradeIncome, TourismIncome, ColonyCorruption, ColonyHappiness, PopulationGrowth, MiningRate, TroopRecruitment, MilitaryShipConstructionSpeed, CivilianShipConstructionSpeed, ColonyShipConstructionSpeed, FacilityConstructionSpeed, ResearchWeapons, ResearchEnergy, ResearchHighTech, Espionage, CounterEspionage, Sabotage, Concealment, PsyOps, Assassination, MilitaryShipMaintenance, MilitaryBaseMaintenance, CivilianShipMaintenance, CivilianBaseMaintenance, TroopMaintenance, WarWeariness, Targeting, Countermeasures, ShipManeuvering, Fighters, ShipEnergyUsage, WeaponsDamage, WeaponsRange, ShieldRechargeRate, DamageControl, RepairBonus, HyperjumpSpeed, TroopGroundAttack, TroopGroundDefense, TroopExperienceGain, TroopRecoveryRate, TroopStrengthArmor, TroopStrengthInfantry, TroopStrengthSpecialForces, TroopStrengthPlanetaryDefense, SmugglingIncome, SmugglingEvasion, BoardingAssault

## CharacterTraitType (CharacterTraitType.cs)
Undefined, Paranoid, Trusting, PeaceThroughStrength, Pacifist, Expansionist, Isolationist, Diplomat, Obnoxious, Famous, Disliked, GoodAdministrator, PoorAdministrator, BeanCounter, Generous, Engineer, Luddite, FreeTrader, Protectionist, Environmentalist, Industrialist, InspiringPresence, Demoralizing, Organized, Disorganized, HealthOriented, LaborOriented, Spiritual, Logical, GoodStrategist, PoorStrategist, Uninhibited, Measured, Addict, Sober, Courageous, Weak, Tolerant, Xenophobic, EloquentSpeaker, PoorSpeaker, Corrupt, Lawful, Lazy, Energetic, Linguist, TongueTied, Technical, NonTechnical, GoodTactician, PoorTactician, StrongSpaceAttacker, PoorSpaceAttacker, StrongSpaceDefender, PoorSpaceDefender, Drunk, ToughDiscipline, LaxDiscipline, LocalDefenseTactics, PlanetarySupport, GoodSpaceLogistician, PoorSpaceLogistician, NaturalSpaceLeader, SkilledNavigator, PoorNavigator, StrongGroundAttacker, PoorGroundAttacker, StrongGroundDefender, PoorGroundDefender, GoodGroundLogistician, PoorGroundLogistician, NaturalGroundLeader, GoodRecruiter, PoorRecruiter, CarefulAttacker, RecklessAttacker, DoubleAgent, Creative, Methodical, ForeignSpy, Patriot, UltraGenius, IntelligenceUninhibited, IntelligenceMeasured, IntelligenceAddict, IntelligenceSober, IntelligenceCourageous, IntelligenceWeak, IntelligenceTolerant, IntelligenceXenophobic, IntelligenceEloquentSpeaker, IntelligencePoorSpeaker, IntelligenceCorrupt, IntelligenceLawful, Smuggler, BountyHunter

## ColonyPopulationPolicy (ColonyPopulationPolicy.cs)
Assimilate, DoNotAccept, Resettle, Enslave, Exterminate

## ColonyResourceEffect (ColonyResourceEffect.cs)
Undefined, Happiness, Development, ConstructionSpeed, RecruitedTroopStrength, ResearchWeapons, ResearchEnergy, ResearchHighTech, PopulationGrowthRate, WarWearinessReduction, IncomeBoost, BaseMaintenanceReduction

## CommandAction (CommandAction.cs)
Hold, ImpulseTo, MoveTo, SprintTo, HyperTo, ConditionalHyperTo, Escort, Dock, Undock, Load, Unload, Attack, Refuel, Build, Scrap, Retrofit, Repair, SelfDestruct, RepeatSubsequentCommands, EvaluateThreats, SelectTargetToAttack, ReassignMission, SetParent, ClearParent, ClearAttackers, Blockade, Colonize, ExtractResources, ScanArea, Deploy, Undeploy, Bombard, Capture, Raid, HoldSyncFleet

## CompletionType (CompletionType.cs)
All, Any

## ComponentCategoryType (ComponentCategoryType.cs)
Undefined, WeaponBeam, WeaponTorpedo, WeaponArea, WeaponPointDefense, WeaponIon, WeaponGravity, Armor, AssaultPod, Fighter, Shields, ShieldRecharge, Engine, HyperDrive, HyperDisrupt, Reactor, EnergyCollector, Extractor, Manufacturer, Storage, Sensor, Computer, Labs, Construction, Habitation, WeaponSuperBeam, WeaponSuperArea, WeaponSuperTorpedo

## ComponentStatus (ComponentStatus.cs)
Unbuilt, Normal, Damaged

## ComponentType (ComponentType.cs)
Undefined, WeaponBeam, WeaponTorpedo, WeaponBombard, WeaponMissile, WeaponPointDefense, WeaponIonCannon, WeaponIonPulse, WeaponIonDefense, WeaponTractorBeam, WeaponGravityBeam, WeaponAreaGravity, AssaultPod, HyperDeny, HyperStop, WeaponAreaDestruction, WeaponSuperBeam, WeaponSuperArea, FighterBay, Armor, Shields, ShieldRecharge, EngineMainThrust, EngineVectoring, HyperDrive, Reactor, EnergyCollector, ExtractorMine, ExtractorGasExtractor, ExtractorLuxury, ManufacturerWeaponsPlant, ManufacturerEnergyPlant, ManufacturerHighTechPlant, StorageFuel, StorageCargo, StorageTroop, StoragePassenger, StorageDockingBay, SensorProximityArray, SensorResourceProfileSensor, SensorLongRange, SensorTraceScanner, SensorScannerJammer, SensorStealth, ComputerTargetting, ComputerTargettingFleet, ComputerCountermeasures, ComputerCountermeasuresFleet, ComputerCommandCenter, ComputerCommerceCenter, LabsWeaponsLab, LabsEnergyLab, LabsHighTechLab, ConstructionBuild, HabitationLifeSupport, HabitationHabModule, DamageControl, HabitationMedicalCenter, HabitationRecreationCenter, HabitationColonization, WeaponPhaser, WeaponRailGun, EnergyToFuel, WeaponSuperTorpedo, WeaponSuperMissile, WeaponSuperPhaser, WeaponSuperRailGun

## CreatureType (CreatureType.cs)
Undefined, Kaltor, RockSpaceSlug, DesertSpaceSlug, Ardilus, SilverMist

## DesignImageScalingMode (DesignImageScalingMode.cs)
None, Absolute, Scaled

## DesignSpecificationComponentRuleType (DesignSpecificationComponentRuleType.cs)
MustNotHave, ShouldNotHave, ShouldHave, MustHave

## DialogPartType (DialogPartType.cs)
Undefined, Exit, INFO_OFFER_UNMETEMPIRE, INFO_OFFER_INDEPENDENTCOLONY, INFO_OFFER_SYSTEMMAPS, INFO_OFFER_RUINS, INFO_OFFER_RESTRICTEDAREA, INFO_OFFER_DEBRISFIELD, INFO_OFFER_PLANETDESTROYER, INFO_UNMETEMPIRE, INFO_EXPLORATION, INFO_INDEPENDENTCOLONY, INFO_RUINS, INFO_DEBRISFIELD, INFO_PLANETDESTROYER, INFO_RESTRICTEDAREA, INFO_NOFUNDS, PIRATE_PROTECTIONPROPOSE, PIRATE_PROTECTIONPROPOSEINITIATE, PIRATE_PROTECTIONACCEPTRESPONSE, PIRATE_PROTECTIONREJECTRESPONSE, PIRATE_PROTECTIONALREADYPAID, PIRATE_BUYINFO, PIRATE_ATTACKOFFER_EMPIRES, PIRATE_ATTACKOFFER_SINGLEEMPIRE, PIRATE_ATTACKCOMMENCE, CANCELPIRATEPROTECTION, PIRATE_ALLIANCEPROPOSE, PIRATE_ALLIANCEACCEPT, PIRATE_ALLIANCEACCEPTRESPONSE, PIRATE_ALLIANCEREJECT, PIRATE_ALLIANCEREJECTRESPONSE, PIRATE_ALLIANCECANCEL, PIRATE_ALLIANCECANCELRESPONSE, GREETING_INTRODUCTION, GREETING_FRIENDLY, GREETING_NEUTRAL, GREETING_ANGRY, OFFER_FREETRADE, OFFER_PROTECTORATE, OFFER_MUTUALDEFENSE, OFFER_DEAL, OFFER_DEAL_RESPONSE, OFFER_DEAL_TERRITORYMAP, OFFER_DEAL_GALAXYMAP, OFFER_DEAL_COMPONENT, DEAL_BEGIN, DEAL_OFFER, DEAL_DEMAND, DEAL_THREAT, DEAL_ACCEPT, DEAL_ACCEPTCOMPLAIN, DEAL_IMPROVE, DEAL_REJECT, DEAL_REJECTCOMPLAIN, DEAL_REJECT_RESPONSE, DEAL_REJECTDEMAND_RESPONSE, DEAL_ACCEPT_RESPONSE, MUTUALDEFENSE_ACCEPT, MUTUALDEFENSE_REJECT, MUTUALDEFENSE_REQUESTHELP, MUTUALDEFENSE_HONORREQUESTHELP, MUTUALDEFENSE_HONORREQUESTHELP_RESPONSE, MUTUALDEFENSE_DECLINEREQUESTHELP, MUTUALDEFENSE_DECLINEREQUESTHELP_RESPONSE, PROTECTORATE_ACCEPT, PROTECTORATE_REJECT, FREETRADE_ACCEPT, FREETRADE_REJECT, CANCELTREATY, CANCELTREATY_RESPONSE_FRIENDLY, CANCELTREATY_RESPONSE_NEUTRAL, CANCELTREATY_RESPONSE_ANGRY, TREATY_PROPOSAL, TREATY_ACCEPTRESPONSE, TREATY_REJECTRESPONSE, TRADESANCTIONS_IMPOSE, TRADESANCTIONS_IMPOSE_RESPONSE_ANGRY, TRADESANCTIONS_IMPOSE_RESPONSE_NEUTRAL, TRADESANCTIONS_IMPOSE_RESPONSE_SURPRISED, TRADESANCTIONS_LIFT, TRADESANCTIONS_LIFT_RESPONSE, TRADESANCTIONS_REQUESTLIFTOTHER, TRADESANCTIONS_REQUESTLIFTOTHER_ACCEPT, TRADESANCTIONS_REQUESTLIFTOTHER_REJECT, TRADESANCTIONS_REQUESTIMPOSEJOINT, TRADESANCTIONS_REQUESTIMPOSEJOINT_ACCEPT, TRADESANCTIONS_REQUESTIMPOSEJOINT_REJECT, WAR_DECLARE, WAR_DECLARE_RESPONSE_EAGER, WAR_DECLARE_RESPONSE_NEUTRAL, WAR_DECLARE_RESPONSE_SURPRISED, WAR_DECLARE_REQUESTJOINT, WAR_DECLARE_REQUESTJOINT_ACCEPT, WAR_DECLARE_REQUESTJOINT_REJECT, WAR_END, WAR_END_SUBJUGATIONDEMAND, WAR_END_SUBJUGATIONOFFER, WAR_END_ACCEPT, WAR_END_REJECT, WAR_END_REQUESTOTHER, WAR_END_REQUESTOTHER_ACCEPT, WAR_END_REQUESTOTHER_REJECT, SUBJUGATIONDEMAND_ACCEPT, SUBJUGATIONDEMAND_REJECT, SUBJUGATIONOFFER_ACCEPT, SUBJUGATIONOFFER_REJECT, SUBJUGATION_REQUESTRELEASE, SUBJUGATION_RELEASE, SUBJUGATION_REFUSERELEASE, GIFT_GIVE, GIFT_THANKS, GIFT_PROPOSE, WARNING, WARNING_INTELLIGENCEMISSIONS, WARNING_INTELLIGENCEMISSIONS_RESPONSE_FRIENDLY, WARNING_INTELLIGENCEMISSIONS_RESPONSE_NEUTRAL, WARNING_INTELLIGENCEMISSIONS_RESPONSE_ANGRY, WARNING_ATTACKS, WARNING_ATTACKS_RESPONSE_FRIENDLY, WARNING_ATTACKS_RESPONSE_NEUTRAL, WARNING_ATTACKS_RESPONSE_ANGRY, SUBJUGATION_RELEASE_RESPONSE, SUBJUGATIONDEMAND_ACCEPT_RESPONSE, WAR_END_ACCEPT_RESPONSE, WARNING_REMOVEFORCESSYSTEM, WARNING_REMOVEFORCESSYSTEM_RESPONSE_COMPLY, WARNING_REMOVEFORCESSYSTEM_RESPONSE_REFUSE, WARNING_REMOVEFORCESSYSTEM_RESPONSE_NOFORCESPRESENT, GOTO_TARGET, WARNING_GENERAL, HISTORY_OFFER_LOCATIONHINT, HISTORY_OFFER_LOCATIONHINT_ACCEPT, HISTORY_OFFER_LOCATIONHINT_REJECT, HISTORY_LOCATIONHINT, HISTORY_OFFER_STORYCLUE, HISTORY_OFFER_STORYCLUE_ACCEPT, HISTORY_OFFER_STORYCLUE_REJECT, HISTORY_OFFER_STORYMESSAGE, HISTORY_OFFER_STORYMESSAGE_ACCEPT, HISTORY_OFFER_STORYMESSAGE_REJECT, MININGRIGHTS_OFFER, MININGRIGHTS_CANCEL, MILITARYREFUELING_OFFER, MILITARYREFUELING_CANCEL, PIRATE_PROTECTIONPROPOSE_OFFER, PIRATE_PROTECTIONPROPOSE_OFFER_ACCEPT, PIRATE_PROTECTIONPROPOSE_OFFER_REJECT, PIRATE_EXTORTPROTECTION, CANCELPIRATEPROTECTIONPIRATE, PIRATE_TRUCEPROPOSE, PIRATE_TRUCEPROPOSEINITIATE, PIRATE_TRUCEACCEPTRESPONSE, PIRATE_TRUCEREJECTRESPONSE

## DiplomaticRelationType (DiplomaticRelationType.cs)
NotMet, None, FreeTradeAgreement, MutualDefensePact, SubjugatedDominion, Protectorate, TradeSanctions, War, Truce

## DiplomaticStrategy (DiplomaticStrategy.cs)
Undefined, Conquer, Befriend, Placate, Defend, Ally, Undermine, DefendPlacate, DefendUndermine, Punish

## DisasterEventType (DisasterEventType.cs)
Undefined, Earthquake, Sinkhole, Tsunami, Sandstorm, Blizzard, Eruption, Plague, EconomicCrisis

## DistressSignalType (DistressSignalType.cs)
UnderAttack, NeedRefuelling, NeedRepair, GalacticDisaster, ColonyBombarded

## EditorMode (EditorMode.cs)
Undefined, System, GasCloud, Star, Planet, Moon, Asteroid, AsteroidField, BuiltObject, Colony, AlienRace, Creature, Pirates, Ruins, RuinsSpecialGovernment, RuinsSuperWeapon, RuinsSleepingRace, RuinsRefugees, RuinsOrigins, RuinsLostShip, RuinsLostColony, DebrisField, EmpireExploration, ClearItems, ClearColony, ClearAlienRace, ClearRuins, ClearAsteroidField, Character

## EmpireActivityType (EmpireActivityType.cs)
Undefined, Attack, Defend, Smuggle

## EmpireComparisonType (EmpireComparisonType.cs)
Undefined, Population, Territory, Economy, StrategicValue, MilitaryStrength

## EmpireMessageType (EmpireMessageType.cs)
Undefined, DiplomaticRelationChange, ProposeDiplomaticRelation, AcceptDiplomaticRelation, RefuseDiplomaticRelation, RemoveColoniesFromSystem, StopMissionsAgainstUs, StopAttacks, LeaveSystem, RequestJointWar, RequestJointTradeSanctions, RequestStopWar, RequestLiftTradeSanctions, GiveGift, Informational, ShipBaseCompleted, ShipBasePurchased, NewColony, NewColonyFailed, ResearchBreakthrough, BattleUnderAttack, BattleAttacking, IncomingEnemyFleet, CharacterAppearance, CharacterDeath, CharacterMissionAccomplished, CharacterMissionFailure, EmpireDiscovered, ColonyGained, ColonyLost, ColonyDefended, ColonyRebelling, EmpireDefeated, RequestHonorMutualDefense, BlockadeInitiated, BlockadeCancelled, ExplorationRuins, ExplorationBuiltObject, ExplorationHabitat, ExplorationLocation, GalacticHistory, SellInfoUnmetEmpire, SellInfoIndependentColony, SellInfoSystemMap, SellInfoRuins, SellInfoDebrisField, SellInfoRestrictedArea, SellInfoPlanetDestroyer, PirateOfferProtection, CancelPirateProtection, Revolution, RestrictedResourceDiscovered, RestrictedResourceTradingAllowed, RestrictedResourceTradingBlocked, OfferTrade, ShipMissionComplete, ShipNeedsRefuelling, ShipNeedsRepair, RemoveForcesFromSystem, GeneralWarning, GeneralBadEvent, GeneralNeutralEvent, GeneralGoodEvent, GeneralDecision, HistoryOfferLocationHint, HistoryOfferStoryClue, ColonyFacilityCompleted, ColonyFacilityCancelled, ColonyWonderBegun, ColonyShipMissionCancelled, StoryMessage, AdvisorSuggestion, ColonyDestroyed, MilitaryRefuelingAllowed, MilitaryRefuelingBlocked, MiningRightsAllowed, MiningRightsBlocked, CharacterSkillTraitChange, ResearchCriticalBreakthrough, ResearchCriticalFailure, GalacticNewsNet, ShipBaseBoardedCaptured, ShipBaseBoardedLost, PirateAttackMissionAvailable, PirateAttackMissionCompleted, PirateAttackMissionFailed, PirateDefendMissionFailed, PirateDefendMissionAvailable, PirateDefendMissionCompleted, PirateSmugglingMissionAvailable, PirateSmugglingMissionCompleted, PirateSmugglerDetected, PlanetaryFacilityDestroyed, ShipBaseScrapped, ConstructionResourceShortage, RaidBonuses, RaidVictim, PlanetaryFacilityDamaged

## EncyclopediaCategory (EncyclopediaCategory.cs)
Undefined, Components, Resources, PlanetsAndStars, Ships, Races, GameConcepts, Screens, UserInterface, Creatures, Editor, GovernmentTypes, Theme, GameInfo

## EngineType (EngineType.cs)
Undefined, Proton, Quantum, Acceleros, Vortex, StarBurner, TurboThruster

## EventActionExecutionType (EventActionExecutionType.cs)
Immediately, Delay, RandomDelay

## EventActionType (EventActionType.cs)
Undefined, AcquireBuiltObject, AcquireHabitat, DestroyBuiltObject, FindMoneyTreasure, LearnExplorationInfo, LearnTech, UnlockTech, LearnGovernmentType, LearnAboutSpecialLocation, LearnAboutLostColony, SleepingRaceAwokenAtHabitat, SplitEmpirePeacefully, SplitEmpireCivilWar, EnemyFleetDefectsToTriggerEmpire, PirateFactionJoinsTriggerEmpire, EmpireDeclaresWarOnTriggerEmpire, ChangeEmpireGovernment, StartPlague, EndPlague, GenerateBuiltObject, GenerateCreatureSwarm, GeneratePirateAmbush, GenerateRefugeeFleet, GenerateNewEmpire, GenerateNewPirateFaction, GenerateErutkah, MakeEmpireContact, InterceptResource, GenerateResourceAtHabitat, RemoveResourceAtHabitat, DisasterAtColony, BuildPlanetaryFacility, DestroyPlanetaryFacility, RevealObject, ChangeRaceBias, ChangeEmpireReputation, ChangeEmpireEvaluation, InitiateTreaty, BreakTreaty, StartTradingSuperLuxuryResources, StopTradingSuperLuxuryResources, GeneralMessageToEmpire, EmpireMessageToEmpire, ResearchBonusInProject, UnlockTechForEmpire, EmpireDeclaresWarOnOtherEmpire, VictoryConditionBonus, SendFleetAttack, SendPlanetDestroyerAttack, IntergalacticConvoyMilitary, IntergalacticConvoyCivilian, CharacterGenerate, CharacterKill, CharacterChangeEmpire, CharacterChangeRole, CharacterChangeImage

## EventMessageType (EventMessageType.cs)
Undefined, NewEmpireRaceAbility, ExoticTechDiscovered, SpecialGovernmentType, CreatureOutbreak, GalacticRefugees, SleepersAwake, NewEmpireEmerges, OriginsDiscovery, LostBuiltObjectCoordinates, LostColonyCoordinates, FreeSuperShip, PirateFactionJoinsYou, TreasureFound, LostColonyFound, AncientBattleDebrisField, IndependentPopulation, GeneralRuinsDiscovery, EncounterRuins, EncounterBuiltObject, BuiltObjectExplodes, PirateAmbush, CreatureSwarm, StoryClue, SpecialArea, RestrictedResourceDiscovered, RuinsEmpireBonus, RogueFleetDefectsToUs, RogueFleetDefectsFromUs, EmpireSplits, UncoverPirateAttackFundingAnotherEmpire, UncoverPirateAttackFundingYourEmpire, UncoverPlanetDestroyerConstruction, UncoverKnownLocation, RareResourceIntercepted, GeneralDiscovery, DisasterEvent, ResourceAppearance, ResourceDepletion, RaceEvent, WonderBuilt, CharacterEvent, PhantomPirates, LeaderChange

## EventTriggerType (EventTriggerType.cs)
Undefined, Investigate, Destroy, Capture, Build, DiplomaticRelationChange, EmpireEncounter, ResearchBreakthrough, PlanetDestroyerConstructionCompleted, EmpireEliminated, CharacterAppears, CharacterKilled

## FighterMissionType (FighterMissionType.cs)
Undefined, Attack, Patrol, ReturnToCarrier

## FighterType (FighterType.cs)
Undefined, Interceptor, Bomber

## FleetPosture (FleetPosture.cs)
Attack, Defend

## GalaxyLocationEffectType (GalaxyLocationEffectType.cs)
None=0, HyperjumpDisabled=1, MovementSlowed=2, LightningDamage=4, ShieldReduction=8, ShipDamage=16, ShipPull=32

## GalaxyLocationShape (GalaxyLocationShape.cs)
Square, Circular

## GalaxyLocationType (GalaxyLocationType.cs)
Undefined, DebrisField, NebulaCloud, GalacticCore, PlanetDestroyer, BlackHole, RaceRegion, SuperNova, RestrictedArea

## GalaxyShape (GalaxyShape.cs)
Spiral, Elliptical, Irregular, Ring, ClustersEven, ClustersVaried

## GalaxyTimeState (GalaxyTimeState.cs)
Running, Paused

## GameEndOutcome (GameEndOutcome.cs)
Undefined, Victory, Defeat, Stalemate

## GameMode (GameMode.cs)
Undefined, Game, Editor

## GovernmentStyle (GovernmentStyle.cs)
Undefined, Despotism, Feudalism, Monarchy, Republic, Democracy, MilitaryDictatorship, WayOfTheAncients, WayOfDarkness, Technocracy, MercantileGuild, UtopianParadise, HiveMind, CorporateNationalism

## GraphicsQuality (GraphicsQuality.cs)
Undefined, Low, Medium, High

## HabitatAtmosphereType (HabitatAtmosphereType.cs)
None, NitrogenOxygen, Oxygen, CarbonDioxide, HydrogenHelium, SulphurDioxide, NitrogenArgonMethane

## HabitatCategoryType (HabitatCategoryType.cs)
Star, Planet, Moon, Asteroid, GasCloud

## FilterType (HabitatPrioritizationListFilter.cs)
NotSet=0, TotalResource, SelectedResource

## HabitatType (HabitatType.cs)
Undefined, MainSequence, RedGiant, SuperGiant, WhiteDwarf, Neutron, BlackHole, SuperNova, Volcanic, Desert, MarshySwamp, Continental, Ocean, BarrenRock, Ice, GasGiant, FrozenGasGiant, Hydrogen, Helium, Argon, Ammonia, CarbonDioxide, Oxygen, NitrogenOxygen, Chlorine, Metal

## IndustryType (IndustryType.cs)
Undefined, Weapon, Energy, HighTech

## IntelligenceMissionOutcome (IntelligenceMissionOutcome.cs)
Undefined, SucceedNotDetect, SucceedDetect, FailNotDetect, FailDetect, Capture

## IntelligenceMissionType (IntelligenceMissionType.cs)
Undefined, SabotageConstruction, StealGalaxyMap, StealOperationsMap, StealTechData, SabotageColony, DeepCover, InciteRevolution, CounterIntelligence, StealTerritoryMap, AssassinateCharacter, DestroyBase

## InvasionTactics (InvasionTactics.cs)
Undefined, DoNotInvade, InvadeWhenClear, InvadeImmediately

## MouseHoverMode (MouseHoverMode.cs)
Undefined, SetFleetAttackPoint, SetFleetHomeBase, SetEventActionTarget

## MultipleEventActionType (MultipleEventActionType.cs)
ExecuteAllActions, ExecuteSingleRandomAction

## MusicMood (MusicMood.cs)
Undefined, Quiet, Moderate, Intense, Theme

## OrderType (OrderType.cs)
Standard, RetrofitResourcesForBase, ConstructionShortage, ConstructionShortageMobile

## PirateExpenseType (PirateExpenseType.cs)
Undefined, ShipMaintenance, Construction, PurchaseResources, CrashResearch, FacilityConstruction, Fuel

## PirateIncomeType (PirateIncomeType.cs)
Undefined, ProtectionAgreement, Mining, Looting, Missions, SellInfo, ControlColony, Smuggling, ScrapCapturedShips, Resort

## PiratePlayStyle (PiratePlayStyle.cs)
Undefined, Balanced, Pirate, Mercenary, Smuggler

## PirateRelationEvaluationType (PirateRelationEvaluationType.cs)
Gifts, OffenseOverRequests, DetectedIntelligenceMissions, PirateMissionsSucceed, PirateMissionsFail, ShipAttacks, ProtectionCancelled, CovetedColony, LongRelationship, RaidsAgainstOurColonies

## PirateRelationType (PirateRelationType.cs)
NotMet, None, Protection

## PlagueType (PlagueType.cs)
Undefined, HekretosFever, DekaraVirus, GeneticScrambler, MerturovPlague

## PlanetaryFacilityType (PlanetaryFacilityType.cs)
Undefined, TroopTrainingCenter, RoboticTroopFoundry, CloningFacility, PlanetaryShield, IonCannon, RegionalCapital, FortifiedBunker, TerraformingFacility, Wonder, PirateBase, PirateFortress, ArmoredFactory, MilitaryAcademy, SpyAcademy, NavalAcademy, ScienceAcademy, PirateCriminalNetwork

## PreWarpProgressEventType (PreWarpProgressEventType.cs)
Undefined, FirstContactPirateOrIndependent, FirstContactNormalEmpire, BuildFirstShip, BuildFirstSpaceport, BuildFirstMiningStation, BuildFirstResearchStation, DiscoverHyperspaceTech, DiscoverColonizationTech, FirstHyperjump, EncounterFirstKaltor, BuildFirstMilitaryShip, FirstPirateRaid

## RaceEventType (RaceEventType.cs)
Undefined, NepthysWineVintage, UnderwaterLeviathan, GreatHuntStrongTroops, SuppressedKnowledgeLoseResearch, ShakturiArtifactWeaponResearch, WarriorWaveTroopRecruitment, SwarmsFullTroopTransport, CannibalismPopulationShrinks, MetamorphosisCharacterChange, StrengthInNumbersMaintenanceLowerForSmallShips, AntiXenoRiotsExterminate, XenophobiaNoAssimilate, DestinyCharacterTraits, NaturalHarmonyColonyQualityIncreased, SecurityConcernsCharacterReplaced, NeverSurrenderWarWearinessReset, ScientificBreakthroughResearchProgress, ForcedRetirementLeaderReplaced, TodashGalacticChampionships, HistoricalKnowledgeUncoverHiddenLocation, IsolationistsResetFirstContactPenalty, GrandPerformanceDiplomacyBonus, FriendsInManyPlacesRevealTerritory, LuckyAvertColonyDisaster, SupremeWarriorNewGeneral, DeathCultExterminate, CreativeReengineeringFreeCrashResearch, PredictiveHistory, HistoricalDiscoveryExploreRuinsForResearchBoost

## RaceFamilyType (RaceFamilyType.cs)
Humanoid, Ursidian, Insectoid, Reptilian, Amphibian, Rodent, Machine

## RaceVictoryConditionType (RaceVictoryConditionType.cs)
Undefined, ControlHomeworld, ControlPlanetTypePercentage, ControlLargestColoniesByType, ControlMostRuins, PopulationHighest, PopulationHappiest, MostHomeworlds, OwnLargestCapitalShip, MostSpaceports, MostMiningStations, MostResortBases, DestroyMostShips, DestroyMostTroops, DestroyMoreShipsThanLoseTimesFactor, DestroyMoreEnemyTroopsThanLoseTimesFactor, DestroyMostCreaturesByType, LoseFewestShips, LoseFewestTroops, MostIntelligenceMissionsSucceed, MostIntelligenceMissionsIntercepted, ConquerMostEnemyColonies, ExterminateOrEnslaveMostPopulation, EnslavePopulationProportionEmpire, BuildWonder, KeepLeaderAlive, MostScientists, MostExperiencedAdmiral, MostExperiencedGeneral, ResearchLeastAdvanced, ResearchMostAdvanced, ResearchMostCompletedBranches, ResearchMostCompletedBranchesByIndustry, HighestTradeVolume, MostTourismIncome, MostTradeIncome, HighestPrivateRevenue, ControlRestrictedResourceSupply, LargestMilitary, LargestMilitaryNonAllied, MostTroops, MostTroopsNonAllied, MutualDefensePactsFormedProportionAllEmpires, FreeTradeAgreementsFormedProportionAllEmpires, LeastWarsStarted, LeastBrokenTreaties, LeastTreaties, MostTimeWarring, LeastTimeWarring, MostSubjugatedDominions, OldestMutualDefensePact, OldestFreeTradeAgreement, ExploreMostSystems, ExploreGalaxyPercentage, MineMostResourcesLuxury, MineMostResourcesStrategic, BuildMostMilitaryShips, BuildMostCivilianShips, BuildMostBases, CaptureMostShips, PirateBuildMostHiddenBases, PirateBuildHiddenFortress, PirateControlColoniesPercentage, PirateEliminateMostPirateFactions, PirateMostSuccessfulMissionsAttack, PirateMostSuccessfulMissionsDefend, PirateMostSmugglingIncome, PirateMostProtectionIncome, PirateMostSuccessfulRaids, PirateBuildCriminalNetwork, MineMostResourcesColonyManufactured

## ResearchAbilityType (ResearchAbilityType.cs)
Undefined, ConstructionSize, PopulationGrowthRate, ColonizeHabitatType, EnableShipSubRole, Troop, Boarding

## ResourceCategoryType (ResourceCategoryType.cs)
Food, Beverages, Textiles, Scents, PreciousMinerals, Silicon, Gemstone, InertGas, Gas, MetalRefined, Polymer, MolecularFibre

## ResourceGroup (ResourceGroup.cs)
Undefined, Mineral, Gas, Luxury

## ResourceType (ResourceType.cs)
LorosFruit, MegallosNut, FalajianSpice, KorabbianSpice, EkarusMeat, NepthysWine, RephidiumAle, Wiconium, Vodkol, QuesturianSkin, BifurianSilk, CaguarFur, TerallionDown, DanthaFur, AquasianIncense, NatarranIncense, ZentabiaFluid, IlosianJade, OtandiumOpal, JakantaIvory, UcantiumPearl, YarrasMarble, EmerosCrystal, NekrosStone, Osalia, DilithiumCrystal, Helium, Argon, Krypton, Tyderios, Hydrogen, Silicon, Steel, Aculon, Chromium, Lead, Gold, Iridium, Polymer, CarbonFibre, Caslon, Undefined

## RuinType (RuinType.cs)
Undefined, Standard, Government, Component, NewPopulation, Refugees, Origins, LostBuiltObject, LostColony, CreatureSwarm, PirateAmbush, EmpireBonus, StoryEvent, CreatureSwarmSilverMist, UnlockResearchProject

## ScenarioObjectiveType (ScenarioObjectiveType.cs)
HabitatEncountered, HabitatColonized, HabitatChangeOwnership, RuinsEncountered, GalaxyLocationEncountered, BuiltObjectDestroyed, BuiltObjectEncountered, BuiltObjectArriveAtLocation, BuiltObjectConstructedAtLocation, CreatureDestroyed, CreatureEncountered, CharacterDestroyed, CharacterEncountered, CharacterArriveAtLocation, EmpireDestroyed, EmpireEncountered, EmpireDiplomaticRelationChange, FleetDestroyed, FleetArriveAtLocation

## ScenarioResultType (ScenarioResultType.cs)
ChangeOwnershipHabitat, ChangeOwnershipBuiltObject, WinScenario, LoseScenario, GenerateShip, GenerateBase, GenerateTroops, GenerateCharacter, GenerateCreature, GenerateColony, DiplomaticRelationChange, EmpireEvaluationChange, ResearchAdvance, SpecialComponentDiscovered, GovernmentTypeChange, MoneyBonus, ExploreSystem, RevealGalaxyLocation, GenerateNewEmpire, EliminateEmpire, InitiateCivilWar, AssignMissionToShip, AssignMissionToFleet, DestroyBuiltObject, DestroyTroops, DestroyCharacter, DestroyCreature

## ShipActionType (ShipActionType.cs)
Undefined, RecruitTroops, AutomateShip, JoinShipGroup, LeaveShipGroup, SetAsLeadShipInGroup, AssignShipGroupHomeColony, ClearQueuedMissions, InvestigateRuins, InvestigateBuiltObject, ColonyTaxUp1, ColonyTaxUp5, ColonyTaxDown1, ColonyTaxDown5, BuildColonize, FighterOptions, FighterBuildFighter, FighterBuildBomber, FighterLaunchFighters, FighterLaunchBombers, FighterRetrieveFighters, FighterRetrieveBombers, BuildOptions, ReturnToTop, UnautomateShip, CreateNewFleet, ColonyBuildOptions, BuildPlanetaryFacility, AssignAttack, FighterUpgradeAll, SetFleetPosture, SetFleetRange, SetFleetAttackPoint, SetFleetHomeBase, TransferCharacter, ColonyBuildWonder, BuildOptionsPrivate, GeneratePirateMissionAttack, GeneratePirateMissionDefend, GeneratePirateMissionSmuggling, GiveBuiltObject, DeployVirus, DisbandShipGroup, ChangePirateHomeBase

## ShipDesignFocus (ShipDesignFocus.cs)
Balanced, SpeedAgility, Power, Efficiency

## SoundVolume (SoundVolume.cs)
Undefined, Mute, Faint, Soft, Normal, Loud, Maximum

## SystemVisibilityStatus (SystemVisibilityStatus.cs)
Undefined, Unexplored, Explored, Visible

## TradeOfferResponse (TradeOfferResponse.cs)
Undefined, RefuseUnfair, Refuse, PromptForImprovement, Accept, AcceptUnfair

## TradeableItemType (TradeableItemType.cs)
Undefined, Money, Colony, Base, TerritoryMap, GalaxyMap, AdoptGovernmentStyle, ThreatenWar, DeclareWarOther, ThreatenTradeSanctions, InitiateTradeSanctionsOther, EndWar, EndWarOther, LiftTradeSanctions, LiftTradeSanctionsOther, ResearchProject, ContactEmpire, SecretLocation, SystemMap, IndependentColonyLocation

## TroopType (TroopType.cs)
Undefined, Infantry, Armored, Artillery, SpecialForces, PirateRaider

## TurnDirection (TurnDirection.cs)
Undefined, StraightAhead, Left, Right

## WarEndReason (WarEndReason.cs)
Undefined, ObjectivesMet, WarWearinessExceeded, WantEnd, AtWarWithOtherEmpires, HeavyLosses, NoAttackFleets

## WarObjective (WarObjective.cs)
Undefined, TotalConquest, CaptureObjectives, EndWar

## WonderType (WonderType.cs)
Undefined, EmpirePopulationGrowth, EmpireHappiness, EmpireResearchWeapons, EmpireResearchEnergy, EmpireResearchHighTech, EmpireIncome, ColonyPopulationGrowth, ColonyHappiness, ColonyDefense, ColonyConstructionSpeed, ColonyIncome, RaceAchievement

## APPENDIX L — FIDELITY VERIFICATION CHECKLIST (run against the finished game)

Content counts — the finished game must contain exactly:
- **24 races** (22 playable + Shakturi + Mechanoid; Shakturi playable only in the Ancient Galaxy storyline; Mechanoid non-playable outside select scenarios)
- **13 government types** (6 universal + 5 race-locked + 2 storyline: Way of the Ancients, Way of Darkness)
- **7 race families** (Amphibian, Reptilian, Insectoid, Humanoid, Ursidian, Rodent, Mechanoid)
- **41 resources** (IDs 0–40: 13 minerals, 6 gases, 22 luxuries of which 3 are super-luxury with a +30 development bonus — Loros Fruit (19), Korabbian Spice (22), Zentabia Fluid (35), all base price 200 — per Appendix C; fuels: Hydrogen (8) and Caslon (18); colony growth requirements: Hydrogen 1.0, Steel 0.6, Lead 0.4, Silicon 0.3, Polymer 0.3, Carbon Fibre 0.3)
- **129 components** (Appendix D; 50 component type codes)
- **337 research projects** across tech levels 0–8 (levels 100/101 are super-weapon tiers; Appendix F), 27 project categories per industry
- **17 planetary facility types + 12 wonder types** (Appendix E)
- **up to 30 fighters per design; fighter types from fighters.txt**
- **4 plagues + Xaraktor virus** (Appendix I)
- **5 space creatures** (exact CreatureType list: Kaltor — with a "giant" size variant per difficulty, Rock Space Slug, Desert Space Slug, Ardilus, Silver Mist; Silver Mist is destroyable only by ion weapons and killing one raises the killer's civility)
- **29 ship sub-roles / design specifications** and **30 mission types** (Appendix K)
- **31 design templates × 24 race folders** (Appendix G)
- **60 race victory conditions** (per-race conditions in Part 5 + pirate playstyle victory sets + storyline victories; Appendix K VictoryConditionType)
- **25 achievement types** (Appendix K, AchievementType)
- **30 advisor message types** and **~95 empire message types** (Appendix K)
- **309 help topics** (in-game help system, 309 articles — reproduce the help browser and article corpus)
- **11 tutorials** (scripted, Appendix H context / Part 12)
- **14 quick-start galaxy presets** (the "start screen" galaxy configurations)
- **6 galaxy shapes** (Spiral, Elliptical, Irregular, Ring, ClustersEven, ClustersVaried)
- **27 ship art families × per-race color variants**, **20 primary + 21 secondary palette colors**, **39 flag shapes** (Part 14 asset inventory)
- **6 storyline packs** (Original Galaxy, ROTS/Shakturi, Legends, Shadows of the Past + pirates, Ancient Galaxy, and the base scenario set)
- bias matrices exactly: 24×24 race, 7×7 family, 13×13 government (Appendix B)

Behavioral gates (sample — the full list is Part 15):
1. A fresh 700-star spiral galaxy generates with correct distribution of planet types, resource prevalence, nebulas with all 6 effect flags, creatures, ruins, and pirate factions per wizard options.
2. Full combat simulation: hit rolls, shield/armor/damage-control pipeline, fighter PD, boarding/capture, bombardment, planet damage, blockades, and fleet auto-response all behave per Parts 4 and 11.
3. Economy: prices follow the exact ReviewResourcePrices formula; taxes, evasion, treaty income caps (20%/30%), and subjugation tribute (10%) are correct; a fully-automated two-empire game runs to a victory condition with zero player input and zero crashes.
4. Research: cost curve 2^(level−1)×BaseTechCost; component improvements retro-fit existing ships instantly; crash research triples speed; pre-warp empires unlock warp bubble before the rest of the tree.
5. Diplomacy: all 7 relation types with exact income/visibility effects; message dialogs with correct ConversationOption sets; war/truce/sanctions/blockade/subjugation flows complete.
6. Every screen, hotkey, and right-click action in Part 12 exists and behaves as documented; all 309 help topics and 11 tutorials are present.
7. All data files load in the documented formats; save/load round-trips losslessly; the in-game galaxy editor produces any custom galaxy and starts a game.
