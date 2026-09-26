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
7. Creature ecology: breeding, migration, hunting. [medium]
8. First-contact protocol: short negotiation setting the starting attitude, voiced by personas. [cheap]
9. Doctrines: exclusive empire-wide choices with lasting effects. [medium]
13. AI personality packs via overlay presets. [cheap]
