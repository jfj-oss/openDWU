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
