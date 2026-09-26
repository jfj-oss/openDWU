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
2. Megaprojects: multi-stage wonders needing multi-empire resources. [medium]
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
(lost contact, missing survey ship, unusual readings); (13) faint grain/vignette on the main view deep in the rim, minimap
dims the outer band. Effort: ~1 agent-day; build with 19h; must not change any sim digest (render/audio/text only except 2).

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
   from its own designs, stance defend-home), (b) mining stations in its home system placed by an independent
   construction ship (stationPlacement rules), (c) freighters (already ported), (d) a militia refresh when ships die —
   but NO colony ships / colonisation and no expansion beyond the home system (hard cap param: systems per independent
   colony = 1, fleet size cap, station cap) so they never become a 61st empire on their own. Herder independents (19j)
   use tamed creatures instead of ships for (a)–(c). Flag off = byte-identical (the base independents stay pure C#).
Effort: 1 ≈ half a day (soak + palette + UI check); 2 ≈ 1 agent-day. Effort: medium (~1 agent-day);
build after 19d2 (unrest plumbing) alongside 19g-7 rim fauna; 19a/19c tests must still pass with 19h on.
