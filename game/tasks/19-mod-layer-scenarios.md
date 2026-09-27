# 19 — Mod layer & scenarios (after the game is complete)

User idea (2026-09-25): larger maps / different sector size, and edge-of-map empires that behave differently —
e.g. a Ming-China-like isolationist mega-exporter: sits on the rim, barely expands, never attacks, holds extremely
rare luxury goods, and only trades them for resources that exist in the outer reaches, so the player must
colonize far out to have something to offer.

Approach: keep src/sim a faithful port; add a mod/scenario layer like DW:U themes (another data folder overlaying
/assets/dwu: races.txt, resources.txt, Policy/*.txt, designTemplates/…).
- Map: galaxy extent already = wizard star count/shape; sector grid = constants (territory/index grids derive) →
  small change + `npm run repin`. Perf is the limit (single-threaded sim).
- Data-only part: new race (low expansion/aggression, high caution/trade), policy file (colonization cap, no war
  declarations, high tax, research focus), new luxury resources as the rare goods.
- Code hooks: (a) home-system placement "prefer rim" per race; (b) resource placement by distance from centre for
  a few resources; the private economy already moves goods between empires under trade agreements.
- Different *behaviour* (tribute, single trading port, conditional treaties): a strategy hook in diplomacy/trade
  evaluation behind a flag, or an LLM persona for that empire via 18c (advisor-level decisions).
Effort after completion: map ~1 day; rim trader (data + hooks) ~2 days; behavioural variant ~1 week (less via 18c).

**19a addendum — treasure fleet + stagnation (user, 2026-09-26):** mimic Zheng He's treasure fleet. Tech: the Concord is
created at wizard **tech level 4** (createEmpireMidGame techLevel 4.0; normal AIs start at 0.5) with the Ship Construction
line pushed to **level 7** (research.txt: max ship size 230/300/400/500/650/800/1100/1500 for construction levels 1–8, so
its hulls are ~3–4× a starting empire's 230–300) — strong at start and through the mid game; a scenario param
`rimTraderResearchCap` = **5** freezes research once every category reaches level 5 (construction stays at 7): normal AIs
reach 4–5 around years 10–15 and 7 late, so the Concord is overtaken in the late game and never gets the level 7–8
weapons. Zero research focus after the cap (replaces the spec's "high research"); no expansion (colony cap unchanged).
Treasure fleet: a Concord-only design template "Treasure Ship" (size 1100 freighter hull: cargo bays, fuel, shields, a few
weapons) + escorts, sailing as ONE large state convoy on a fixed circuit of foreign space ports (Empire.1.cs 3899 convoy
code reused; 19e-9 shows the route) that sells rare goods / buys rim goods at each stop — the visible, escortable, raidable
face of the trade; losing it hurts standing. **Always visible (user, 2026-09-26):** the treasure fleet is revealed to every
empire regardless of sensors/fog — its ships carry a scenario "beacon" so the visibility pass treats them as known to all
(like the original's planet destroyer / story announcements: a galaxy-wide position broadcast), with a fleet marker at
galaxy zoom, a message + news item when it leaves port and when it arrives at a foreign port, and a route line on the
freight overlay. Params: convoy size, circuit interval, treasure ship size, beacon on/off.

## 19b — "Dark Farms" end-game storyline (user idea, 2026-09-26)
An overdeveloped colony gets a small yearly chance to spawn a hidden self-replicating factory; it produces
private-sector ships that are secretly armed (sleeper flag, freighter template with hidden weapons); after a delay
or a count they turn: a new hostile faction is created mid-game (like the Shakturi), ownership flips, missions →
attack, aggressive posture; they fight dirty — virus-class ("chemical") bombardment reusing the Xaraktor virus
path, boarding/capture, sabotage via intelligence missions. Framed as a story arc: hints, news broadcasts,
victory/defeat condition. Wizard toggle, off by default (faithful game untouched). Maps onto: story-event system
(triggers/delayed actions), facilities data, private economy ship spawning, design templates, mid-game empire
creation + ownership transfer, attack AI, threats, virus/bombardment, intel missions, victory conditions.
New code: facility + production loop, sleeper flag (saved), awakening script, one bombardment effect, texts,
tests. ~1 week of agent work after the core is complete. Open design points: discoverability before the turn,
inspecting private ships, awakening size vs host fleet.
Addendum (user, 2026-09-26): the factory also builds its own **robot army** (robotic troop types already exist)
on its planet, hidden and free of money/resources; the turn is an **invasion from inside** (existing invasion
resolution: hidden troops vs garrison → colony flips to the new faction); then the sleeper freighters get
troop capacity and carry the factory's continuous troop output to invade more planets (existing troop-transport
invasion missions + attack-AI invasion planning targeting weakly garrisoned colonies). Balance knobs: troops/day,
whether retaking the planet destroys the factory, sleeper count before the turn.

## 19c — Chartered companies (VOC / Dutch East Indies) (user idea, 2026-09-26)
A faction funds a private expedition to colonize named worlds under a company: a persistent sub-empire created
mid-game (existing mid-game empire creation) with the founder's race, its own colony ship + escort fleet and AI;
relation = Subjugated Dominion (existing: pays % income tribute; Protectorate as the softer form) + trade
agreement + refuelling rights. New: a tariff rule — a % of the company's sales of rim goods to the rim trader
goes to the charter holder (hooks the existing private-economy sale counters). Drift: subjugated empires can
break away when the overlord is weak (existing) → autonomy demands; nationalising = existing absorb-dominion path.
Added ideas: charter terms as a treaty (exclusive luxury rights, tribute %, duration; renegotiated in the trade
panel); rival AI-chartered companies competing for the rim trade; a company HQ port as the only legal export
point; requisition of the company fleet in war for a fee (loyalty cost); company shipyard so the fleet grows with
profits; corruption/scandal story events (embezzlement, bought governor, pirate smuggling).
Effort: ~1 week on top of 19a (charter action, tariff rule, company AI persona).

## 19d — Emergent-gameplay additions (ACCEPTED by the user 2026-09-26 — "i love these ideas and i want them added"; ranked by emergence per effort)
1. Internal politics: ambitious characters (traits/loyalty/events exist; empire split ported) → defections, secessions, coups when approval low.
2. Resource crises: scarcity shocks propagate through the private economy (luxury loss → unrest, fuel-out → grounded fleets, price spikes → smuggling).
3. Espionage consequences: exposed agents → diplomatic crises; stolen tech proliferates; false-flag missions start wars between rivals.
4. Refugees & demographics: refugee fleets (events) settle and shift colony race mix (multi-race populations + race attitudes exist).
5. Pirate evolution: rich factions go legitimate, ally, or serve as deniable proxies for empires.
6. Independents as actors: leagues, hired pirate protection, protectorate petitions.
7. Plague & ecology: disease along freighter routes (quarantine decisions), overdevelopment degrading planets (links to 19b).
8. Galactic institutions: a council voting sanctions/embargoes → blocs.
9. Finance: loans (on the port list), bonds, default, creditors seizing assets (links to 19c).
10. Persona layer (18c) as the multiplier that makes empires weigh all of the above by their traits.
Effort: 1–4 days each after the mod layer; 5–9 one to two weeks each.

## Order of work (decided 2026-09-26)
1. **modlayer** foundation (starts now): scenario/data overlay folder loaded over /assets/dwu (races, resources, policies, templates, GameText additions), wizard "Scenario" toggles, feature flags read by the sim (off = byte-identical faithful game, pins unchanged), story-event hook points and a scenario test harness.
2. Then: 19d1 internal politics FIRST (it holds the shared approval hook + player-decisions module the others reuse — see 19d1 §S), and in parallel with it 19a rim trader, 19b Dark Farms + robot army, 19e-9 freight overlay; then 19c chartered companies (needs 19a's ledger + the contract hook), 19d2–19d4. Specs: tasks/19a-rim-trader.md, 19b-dark-farms.md, 19c-chartered-companies.md, 19d1-…19d4-*.md, 19e9-freight-overlay.md, 19f-hidden-threats.md.
2b. Once 19b lands: the ten 19f hidden threats as data + spread rules on its hooks, in parallel, each behind its own scenario flag.
3. Then 19d items 5–10 and the cheap 19e items (1 replay theatre, 4 chronicle, 9 freight overlay, 11 situational music).
4. Then 19e medium (5 living characters, 7 wreckage/salvage, 8 space weather, 10 race designer).
5. Then 19e ambitious (3 legacy galaxies, 6 spectator broadcast, 2 async multiplayer).
6. 19g (accepted; 10/11/12/14 removed): stargates, megaprojects, war goals & peace terms, succession, frontier autonomy, anomalies, creature ecology, first-contact protocol, doctrines, personality packs — slot the cheap ones (8, 13) with step 3, the rest with step 4.

## 19e — Second idea batch (ACCEPTED by the user 2026-09-26 — "i like all those ideas"; builds on replay, the persona layer, the seamless 4K map, the data overlay)
1. Replay theatre: scrub a whole game as a time-lapse from seed + command log; jump to any moment; fork a "what if"; shareable replays (KB, not MB). [cheap]
2. Async multiplayer via exchanged command logs (lockstep, no netcode). [ambitious, later]
3. Legacy galaxies: a finished game seeds the next (wrecks → ruins, heroes → precursor lore, a rival survives as the rim power). [ambitious]
4. Chronicle: the local model writes an in-character history from Galactic History/news (named wars/eras), in-game + export. [cheap]
5. Living characters: governors/admirals with opinions, messages, grudges and rivalries affecting cooperation (ties to 19d-1). [medium]
6. Spectator broadcast: AI-vs-AI galaxy with personas on and a commentator voice. [ambitious]
7. Battle wreckage & salvage: persistent debris fields; salvage ships recover resources/foreign tech. [medium]
8. Space weather: nebula storms / solar flares moving across the map, degrading sensors and blocking jumps. [medium]
9. Freight-flow overlay: make the simulated private economy visible (flows, where money accumulates) — needed by 19a/19c anyway. [cheap]
10. Race designer on the data overlay, with model-written bios. [medium]
11. Situational music (battle/exploration/crisis mood selector). [cheap]

## 19f — Dark-Farms-like hidden threats (ACCEPTED by the user 2026-09-26 — "ALL THESE IDEAS ARE BANGERS"; same hooks as 19b: hidden facility/flag, spread rule, trigger, new faction, dirty methods)
1. Grey Tide: self-replicating mining swarm from an unexplored gas giant eats asteroid fields/mining stations; exponential; found by scanners, killed at spawn worlds.
2. The Cult: belief spreading character→character (ambassadors/governors convert via traits/loyalty); converted colonies secede into a theocracy; assassins/martyrs; fought with agents and happiness.
3. The Silence: ruin signal disables hyperdrives in a widening radius; pirates immune; expedition must shut the source.
4. Doppelgangers: captured ships returned as sleepers with your own designs; recaptured ships are suspect.
5. The Hive: independents are one hidden mind; each absorbed/protected world joins; declares itself at a threshold — the land-grab is the fuse.
6. Time-bomb tech: precursor tech with huge bonuses and a small yearly planet-killing side-effect chance; tech leaders most exposed.
7. Ghost Armada: battle wreckage reactivates under a dead empire's persona (LLM) and raids its destroyers.
8. The Exchange: neutral trading megastation secretly funding both sides + sabotage; win = discover and blockade it.
9. Robot mutiny: robotic troops galaxy-wide answer one hidden broadcast; robot-heavy empires lose planets first.
10. Corporate coup: a chartered company (19c) buys governors and declares independence with its fleet/colonies.
Build after 19b lands; each is mostly data + a spread rule on the 19b hooks.

## 19g — Third idea batch (ACCEPTED by the user 2026-09-26 with items 10, 11, 12, 14 REMOVED; strategy depth, exploration, port-only capabilities)
1. Stargate networks (player-built gate pairs → chokepoints, gate wars). [medium]
2. Megaprojects: multi-stage wonders needing multi-empire resources. [medium] — **Concrete design (2026-09-27):** a
   megaproject = a planetary facility with N stage facilities in the overlay's facilities data (wonder placement rule +
   a scenario site check); each stage built by the host colony's yard from resources in colony cargo; partner
   contributions = the diplomacy tradeable-item transfer (money/resources) into the host cargo, delivered by partners'
   freighters under ordinary contracts; shares = a scenario ledger. Effects via existing hooks: Beacon = huge-range
   long-range scanner component on the facility (+ lifts 19h fog in range via scanRangeModifier); Rim wall = removes
   19h storm clouds (nebula locations) in a radius; Gate hub = anchor for 19g-1 stargates (Bacon stargate stub in
   movement.ts); Ark = moves a colony's population off a doomed world via the passenger/migration path (planet
   destroyer / 19f time-bomb); Observatory = detection bonus in 19m's leads roll. Between-stage events: 19d3 sabotage-
   construction against the site, a 19d2 shortage strike, a partner treaty break (attitude penalty); council condemn /
   protect motions. A finished project is a colony facility → a 19g-3 war goal like any colony. Stellar engine DROPPED
   (no star lifecycle in the original).
3. War goals & peace terms (cede colonies, reparations, demilitarised systems). [medium]
4. Succession: leaders age/die, heirs, regencies, crises → persona shifts. [cheap-medium]
5. Frontier autonomy: distance-based drift toward local rule, sector governors with power. [medium]
6. Anomalies with branching investigations (derelicts, hazards, precursor caches) via the story system. [medium]
7. Creature ecology: breeding, migration, hunting. [medium] — **Rim fauna design (user, 2026-09-26):** creature density
   scales with distance from the galactic centre (far more herds at the rim than the core; the five ported CreatureTypes
   keep their C# generation, the scenario adds rim herds on top); herds move as a group with a leader and a home range;
   seasonal (yearly, Rnd-driven) migrations push herds into rim-adjacent territory; herds must feed: they graze gas
   clouds, asteroid fields and mining stations' habitats, draining a resource-stock fraction and damaging/blocking
   mining stations while feeding, so rim colonies face a recurring choice between defending the stations (killing
   herds, which also shrinks the population and the migration pressure) and tolerating the losses (herd hunting yields
   creature-specific resources/tech as in the base game). Tension hook: repeated losses raise colony unrest (19d2 crisis
   plumbing) and the empire AI weighs escort/defence vs. relocation. Data-driven: herd size, feed rate, migration
   radius/season, density curve as scenario params; flag off = byte-identical.
   **19g-7b New fauna (user, 2026-09-26; art route decided "creature b" = fully PROCEDURAL on a shared body rig, matched
   to the originals' measured palette/contrast/edge softness; composites only for recolours/giants of existing types):**
   1 Void whales (huge slow grazers, rim migrants, big kill haul); 2 Hunter packs (small fast aggressive, stalk freighters,
   flee warships); 3 Hull grazers (latch onto stations, eat hull through shields); 4 Storm drifters (ride storm belts,
   blind sensors, misfire jumps); 5 Lantern shoals (procedural light swarms, harmless, lead ships toward shoals);
   6 Nest mothers (giant stationary boss guarding a rich site, spawns young); 7 Scavengers (eat wreck debris, carry the
   salvage); 8 Brood carriers (seed hunter packs on planets they pass). Sim: a creature-variant table (base type,
   behaviour params, look) over the herd model; each variant's rendering = a body definition on the shared rig
   (whalePilotLayer B technique → creatureLayer). Requires the base creature layer (in progress) and 19g-7.
   **Tamed look (user, 2026-09-26):** creatures tamed by herders (19j `rimHerdDocileTo` / tamed-ship tagging) render
   with a harness overlay: strapped cargo containers along the back (procedural boxes in the original freighter
   container palette, 2–6 by creature size, following the rope rig's undulation), a rigging line, and small flickering
   nav/work lights on the containers (reuse the ambient layer's nav-light blink pattern, dimmer, warm colour; they blink
   out of phase). The harness fades in over a few seconds when a creature becomes tamed and drops off (containers
   detach as debris sprites for a few seconds) when it goes feral. Herder empires' tamed "freighters" and "miners"
   (19j item 2) use this look, so a herder convoy reads as a caravan of laden beasts. Part of the creatureLayer rig.
8. First-contact protocol: short negotiation setting the starting attitude, voiced by personas. [cheap]
9. Doctrines: exclusive empire-wide choices with lasting effects. [medium]
13. AI personality packs via overlay presets. [cheap]

## 19h — Rim frontier geography (ACCEPTED by the user 2026-09-26 — "do it"; stacks with 19a rim trader and the 19g-7 rim fauna)
Makes the rim itself hard to reach and hold, independent of the fauna. Scenario layer, data-driven, flag off = byte-identical.
1. Storm belts: nebula / ion storms generated on a distance-from-centre curve so the outer ring is a hazard band (base storm
   rules apply: slower movement, hull damage without shields; Bacon checkInStorm / storm-survival checks already ported).
2. Sparser rim: star placement thins past a radius (fewer waypoints, longer jumps) so hyperdrive range and fuel decide who
   can reach the rim goods. Generation change → re-pins only inside the scenario (wizard-level option).
3. Gravity shoals: a few fixed deep-space features that end hyperjumps early (Bacon gravity-well rule generalised to a
   scenario feature), creating natural chokepoints / ambush points for pirates and herds.
4. Fuel scarcity: caslon / hydrogen placement biased inward so rim outposts need supply lines, gas mining or 19c company depots.
5. Sensor fog: a rim-wide sensor-range penalty until listening posts / long-range sensors are built, so herds and pirate bases
   stay hidden longer.
6. Map scale (user, 2026-09-26): a galaxy-extent multiplier (same star count spread wider, so the rim is far in travel time)
   and a raised star cap above the wizard's 1400 for those with the CPU, both scenario/wizard options; sector grid stays
   the C# constant (Galaxy.3.cs SectorSize 2,000,000) unless the multiplier demands otherwise (territory/index grids derive
   from it). Re-pins only inside the scenario. Must ship with a speed check at the top setting (single-threaded sim; the
   36 game-days/min budget must hold or the option is capped).
Params: belt inner radius, storm density, thinning radius/factor, shoal count, fuel bias, fog factor, extent multiplier, star cap.
7. Starts out of the rim (user, 2026-09-26: "keep normal empires and player empire out of the rim"): with the frontier flag
   on, ordinary empires' and the player's home systems are never placed past the rim inner radius (a home-habitat accept
   hook on the C# capital search; the Concord, independents, herders and fauna keep the rim). Param
   `rimFrontierKeepStartsOut` default on. Star cap raised to 4000 (user, 2026-09-26) with two-letter sector labels.
8. Pirates in the rim (user, 2026-09-26): an exact share of pirate factions (`rimFrontierPirateRimShare` 0.6) get rim home
   bases, the rest core bases, assigned in the C#'s creation order (no extra draws); base placement (pirates AND the
   19k-2 independents' stations) avoids herd home ranges (19g-7 RimHerd.homeRange) so nobody spawns inside a nest; pirate
   factions get a HERD-HUNTING mission when a herd wanders within a param range of their base (kill drop = creature
   resources they sell; thins herds near bases; herders lose standing with herd killers → pirate-vs-herder friction feeds
   19k-3 leagues). Params: share, avoid radius, hunt range, hunt chance/year.

## 19i — Rim atmosphere (ACCEPTED by the user 2026-09-26 — "yes"; presentation only, reads a distance-from-centre curve; flag off = untouched)
Visual: (1) colour grading by radius — desaturate + cold blue-violet tint on star field/nebulae past the rim band, fading in
over a band; (2) rim star types biased to dim red/brown dwarfs and white dwarfs (generation curve, re-pins only in the
scenario); (3) dark dust lanes instead of bright nebula art, and 19h-5 sensor fog rendered as grainy grey murk for
unexplored rim space; (4) thinner deep-field star layer / sparser background art; (5) derelicts, dead stations, gutted
independent colonies on the rim curve from the original ruins/debris art (some become 19g-7 herd feeding sites);
(6) distant creature silhouettes drifting in the background at galaxy zoom; (7) fewer nav lights / dimmer city glow on
rim outposts. Audio: (8) 19e-11 music selector gets a "rim" mood weighted by radius (sparse drones, silences, original
tracks that fit); (9) low wind/static ambient bed growing with distance, distant creature calls and hull creaks at system
zoom; (10) faint static layer on advisor/diplomacy voice in the fog; garbled rim distress calls in the ticker. Text/UI:
(11) bleaker rim name table, more numbered survey designations; (12) rim-specific exploration/colony message wording
(lost contact, missing survey ship, unusual readings); (13) faint grain/vignette on the main view deep in the rim, (no minimap: the user does not want one built — dimming dropped, 2026-09-26). Effort: ~1 agent-day; build with 19h; must not change any sim digest (render/audio/text only except 2).
Model split (user, 2026-09-26): anything that CREATES visuals — colour-grading filters, dust-lane/murk rendering, creature
silhouettes, grain/vignette, any procedural art (no art files are ever committed; new visuals are Pixi filters/graphics
over the original art) — is an Opus package; the data/wiring pieces (name tables, message wording, music/ambient selector
weights, nav-light/glow params, minimap dimming) are a Sonnet package that consumes the Opus-built render hooks.
Sub-agents cannot spawn sub-agents in this harness, so the orchestrator runs the two packages in sequence: Opus render first.
Audio addendum (user, 2026-09-26, "i like the creature call and hull creak sound ideas"): the original ships no such
sounds and no audio files are ever committed, so both are SYNTHESISED at runtime with Web Audio (like the ambient bed):
creature calls = formant-filtered noise/oscillator sweeps with per-creature-type timbre (kaltor low bellow, slug wet
click-chirp, ardilus keening, silver mist shimmer), triggered rarely at system zoom when herds/creatures are within a
range, panned by direction, gain by rim weight; hull creaks = low resonant filtered-noise bursts with slow pitch drop,
triggered at system zoom in storms/deep rim with the camera near a ship; params creatureCallRate, creakRate, gains.
Opus package (sound design), consumes 19i wiring's rimWeightAt + the fauna's herd positions.

## 19j — Rim herders (ACCEPTED by the user 2026-09-26 — "yes"; rim independents coexist with and use the fauna; builds right after 19g-7)
1. Herder peoples: a rim independent race trait "symbiotic" — herds are docile to that race's colonies/ships; herder worlds
   sit inside herd home ranges, so herds are their defence (attack a herder colony → the herd turns on you; leave them
   alone → herds ignore your freighters crossing the range).
2. Living infrastructure: herder private-sector freighters/miners are tamed creatures — slow, self-fuelling, storm-immune —
   the cheap way across 19h storm belts.
3. Sustainable harvest: herds shed the creature resources the base game drops on a kill; herders gather without killing, so
   their ports are the only steady source → plugs into 19a (the Concord wants herd products; rivals compete for herders).
4. Drovers and guides: herder characters gained by diplomacy — a drover on a fleet lets it pass a herd; a guide on an
   explorer reveals safe lanes through shoals/fog; they leave when goodwill is lost.
5. Two paths per colony: protect the herd range → protectorate that keeps its herds and pays in herd goods; conquer →
   herds go feral for years and migrate harder into your space; third route: steal herding tech via espionage (19d3
   proliferation) and domesticate herds yourself.
6. Migration-season events: herders warn friendly empires before a migration and ask warships out of the corridor;
   ignoring it drops relations and makes herds aggressive.
7. AI: cautious rim AIs take the protectorate path, aggressive ones conquest — different outcomes per neighbour.
Reuses: race traits, protectorate relations, character joining, resource system, 19d-6 independents as actors, 19g-7 herd
rules. Effort: medium (~1–2 agent-days). Flag off = byte-identical.

## 19k — Big galaxies: 60 empires + independents as real actors (ACCEPTED by the user 2026-09-26)
1. 60-empire games: the wizard cap is already 100 (startGameOptions.ts OTHER_EMPIRES_COUNT_MAX; the C# lists no bound), so
   this is verification, not a cap change: (a) a 60-empire / 1400-star soak must hold the 36 game-days/min budget or the
   wizard warns above the measured limit; (b) Galaxy.cs SelectColorFromKey has 20 key colours → with >20 empires colours
   repeat as in the original; add a scenario option for an extended palette (data) so 60 empires stay distinguishable;
   (c) 22 races → duplicate-race empires (original behaviour) keep distinct names/flags (83 flag shapes); (d) diplomacy
   screen / empire lists must scroll and stay usable at 60 (UI check); (e) 19h-6 map scale is the natural pairing.
2. Independents as actors (extends 19d-6): the independent empire gets, per independent colony and scaled by population
   like Galaxy.7.cs GenerateIndependentTraders already does for freighters, (a) a small defence fleet (escorts/frigates
   from its own designs, stance defend-home), (b) mining stations placed by an independent construction ship
   (stationPlacement rules) in its home system AND in nearby unclaimed systems within a radius param (user, 2026-09-26:
   "let them build stations in other systems as well") — stations, not colonies, so their reach grows without their
   borders; stations in a system another empire later claims become a friction point (buy-out / tolerate / clear), (c) freighters (already ported), (d) a militia refresh when ships die —
   but NO colony ships / colonisation (hard cap params: station radius in sectors, stations per independent colony, fleet
   size cap) so they never become a 61st empire on their own. Herder independents (19j)
   use tamed creatures instead of ships for (a)–(c). Flag off = byte-identical (the base independents stay pure C#).
3. Independent leagues (user, 2026-09-26): independent colonies within reach of each other (radius param, same or
   compatible race attitudes, both under threat — pirate raids, a neighbour's expansion, herd losses — or simply prosperous)
   may form a league: a named sub-faction of the independent empire (one league flag/colour, a council seat at the founding
   colony). Effects while in a league: (a) pooled defence — the fleet cap rises with member count and league ships answer
   raids on any member; (b) shared stations — the station radius grows and members share income; (c) exactly ONE extra
   colony per league (never per member): the league sends one colony ship to the best nearby unclaimed world to simulate
   reaching out of isolation, after which colonisation stops again; the new colony is a league member; (d) leagues negotiate
   as a bloc — protectorate / trade offers go to the league, joining one member's empire pulls the rest toward it (relation
   bonus) or splits the league if they refuse; (e) leagues can dissolve (a member conquered, relations collapse) → back to
   isolated behaviour, the extra colony stays independent. Params: league radius, min members, chance per year, fleet
   multiplier, one-colony toggle. Ties: 19d-6 independents as actors, 19j herder leagues (herds pooled), 19a (a league on
   the rim becomes a trade partner bloc). Flag off = byte-identical.
Effort: 1 ≈ half a day (soak + palette + UI check); 2 ≈ 1 agent-day; 3 ≈ 1 agent-day after 2.

## 19l — Livelier mid game (ACCEPTED by the user 2026-09-26 — "do only new ideas"; from the 10-year seed-1 run: 1 war, 0 invasions in 10 years)
1. Ambition pressure: a per-empire drive that rises with idle military strength (warships not in a war, years since the
   last war) and falls with each war/loss; above a threshold the war-review gates get a scenario-side bias (attitude
   threshold relaxed by ambition × param) so a strong, peaceful AI eventually goes looking for a fight. Fixes the
   "14 warships, 1 colony, forever" pattern. Data-driven; flag off = byte-identical.
2. Border friction: overlapping territory (territory grid) generates yearly incidents — mining-station disputes, blockades,
   seizures — fed into the 19d3 crisis machinery so tension builds toward war instead of appearing from nowhere.
3. Smaller invasions: scenario option lowering the C# ≥10-ship troop-fleet minimum (Empire.8.cs 1047 PrepareFleetsForWar)
   for weak targets (target troop strength ≤ param), so invasions happen in the mid game; off by default.
4. Pirate ambition: rich factions (money/ships above params) graduate from raids to seizing an independent colony as a
   permanent base and start acting like a small empire (colony defence, freighters), producing a real underworld enemy.
5. Living calendar: festivals, elections, coronations as yearly events per empire with small diplomacy/approval effects
   and messages, so the feed has texture between crises; ties to 19g-4 succession and the 19i rim calendar idea.
Effort: 1, 3 cheap (data + one gate each); 2, 4 medium; 5 cheap. Build after the 19d wave is merged.

## 19m — Internal security (ACCEPTED by the user 2026-09-26 — "yes 19m seems like a good idea"; ties 19d1 politics, 19d3 espionage, 19d4 tension, 19d2 crises, 19g-7 herd losses, the 19f Cult/Doppelgangers/Hive/corporate coup and the base rebellion into one system)
1. One stability ledger per colony and per empire: approval, tension, shortages, herd losses, cult influence, character
   loyalty all write into it WITH A CAUSE; the base rebellion/revolt (ColonyRebellion) reads the ledger, so every package
   feeds the same revolt; the Empire Summary Stability row and colony tooltip show the causes.
2. Leads: every hidden thing (plot, convert, sleeper ship, foreign agent, bought governor, Hive node, farm, nest) produces
   leads through ONE detection roll — counter-intelligence skill vs the thing's concealment — replacing the per-package
   rolls; leads live in an "Internal Security" tab on the Intelligence screen (suspected / confirmed / cleared).
3. Investigate: assign an agent to a lead (new intel mission kind); confirm/clear; confirmed leads unlock actions: arrest,
   exile, purge, quarantine colony, martial law (blocks secession N years, approval cost), amnesty, recall fleet, scrap a
   suspect ship; AIs run the same loop by policy (caution/aggression).
4. Chain reactions: converted governor lowers loyalty; purge lowers approval; a cultist coup founds the theocracy; refugees
   can carry the creed; exposed foreign agent → 19d3 crisis; failed investigation emboldens the plotter (+ambition).
Effort ~2 agent-days (Opus); requires 19d1/19d3/19d4/19f on main (batch D). Player answers via the command queue.

## 19n — Court & dynasties (ACCEPTED by the user 2026-09-26 — "19n yes"; Crusader Kings-style character layer on top of 19m)
Package 1 (after 19m core): 1 Houses — every character belongs to a house; the leader's house gains prestige (wars,
wonders, long reigns); house members favour each other for seats/plots; rival houses feud (plots get a shape).
2 Council — seats (spymaster = counter-intelligence, chancellor = diplomacy, marshal = fleets, steward = tax efficiency,
magistrate = stability) with real powers wired to the existing stats; powerful nobles without a seat are the likely
plotters. 3 Character factions with demands — discontented characters form a faction (lower taxes, a war, autonomy for
a colony, a seat) and issue an ultimatum: concede or face the plot it backs. 4 Succession — laws per government
(primogeniture, election, military acclamation), heirs, regencies, succession crises where houses back rival claimants
(absorbs 19g-4). 9 Legitimacy — rises with prestige and lawful succession, falls with purges/coups; multiplies every
plot chance.
Package 2: 5 Schemes — agents run sway, blackmail, sabotage-loyalty and assassination schemes against characters (own or
foreign); every scheme is a hidden thing discovered through 19m leads. 6 Secrets & hooks — characters carry secrets
(corruption, cult membership, defection talks); a discovered secret is a hook to force compliance or expose publicly.
7 Dynastic ties — characters exchanged as envoys/wards/spouses between empires → relation bonus, defensive pacts, and
claims. 8 Relationships — friends/rivals/lovers modify loyalty, fleet/colony cooperation and plot membership (absorbs
19e-5 living characters). 10 Claims & war goals — houses hold claims on colonies (marriages, former ownership) → the war
goals 19g-3 needs.
All data + existing character/diplomacy hooks; off by default; player actions via the command queue; AI runs the same
loops by traits. Effort: package 1 ~2 agent-days, package 2 ~2 agent-days (Opus). Requires 19m. Effort: medium (~1 agent-day);
build after 19d2 (unrest plumbing) alongside 19g-7 rim fauna; 19a/19c tests must still pass with 19h on.
