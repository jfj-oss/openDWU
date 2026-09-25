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
