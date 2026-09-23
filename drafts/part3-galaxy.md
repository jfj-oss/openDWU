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
