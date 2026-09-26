# Research pace audit 2026-09-26 (soak anomaly A6): faithful, closed

SOAK-2026-09-26 A6 reported +4 to +9 completed research projects per empire in 2 game years. This audit checked the
research formulas statement by statement against the C#, worked out the expected output by hand, and compared that with
an instrumented 2-year run. **The pace is faithful. Nothing in `src/` was changed.** With DW:U's default research cost
("Normal", BaseTechCost 120000), a starting empire has one lab station and no research stations. At that point an
early level-1 project takes about 1.1–1.2 game years in each of the three research fields.

Probe: `node scripts/research-pace.mjs 1 1200 10`. It is read-only and uses the sim-run defaults: seed 1, 700 stars,
10 empires, age 1, tech 0.5, pirates 1. It prints the research inputs per empire, the queue heads and every completion
with its game day. One game year is `RealSecondsInGalacticYear` = 600 s.

## C# checked (DistantWorlds.Types unless noted)

| C# | TS | result |
|---|---|---|
| Empire.3.cs 1756 PerformResearch, 1890 PerformResearchProjects (`power × dt / 600 × ResearchSpeedModifier × bonuses`, float progress, carry-over, 50-iteration cap, crash ×3, critical events) | researchTick.ts performResearch / performResearchProjects | same |
| Empire.cs 1817 AnnualResearchPotential (`sqrt(sqrt(pop/1000)) × 10000 × EconomyEfficiency × ResearchRate`, pirate branch) | annualResearchPotential | same |
| Empire.cs 1860/1881/1902 Research*Potential (sum of the `IsResearchLab` labs, floor `max(12000, pop/1e6 × 3)`, × Research*Factor) | researchPotential | same |
| Empire.3.cs 2915 CalculateResearchTotal (scaled down only if the annual cap is smaller) | calculateResearchTotal | same |
| Empire.3.cs 2818 CalculateResearchOutputBonuses (race ResearchBonus, government ResearchSpeed, special/ruin/wonder bonuses, research-station location bonus (float), colony resource bonus capped at 1.0, race event ×1.1, leader skill) | calculateResearchOutputBonuses | same (RaceEventType value 29 checked) |
| Galaxy.3.cs 5766 SetResearchCosts (`2^(TechLevel−1) × BaseTechCost`, 256× at level ≥ 100, BaseCostMultiplierOverride) + ResearchNodeDefinitionList.cs 842 UpdateProjectCostsForRace | componentStatic.ts computeResearchCost, researchSystem.ts | same |
| BaseTechCost default: Main.Part9.cs 2668 `GalaxyResearchSpeed = 120` → Start.2.cs 111 `BaseTechCost = 120000`; wizard labels Start.1.cs 4394 (0→480000 … 2→120000 "Normal" … 4→30000) | `DEFAULT_BASE_TECH_COST = 120000` | same. The wizard option itself belongs to another task (todosweep2). This audit used the C# default. |
| `ResearchSpeedModifier` (Galaxy.4.cs 2147 and Start.2.cs 110 always 1.0) | galaxy.researchSpeedModifier = 1 | same |
| BaconGalaxy.cs 146 `ResearchRate = ResearchRateDefault(1.0) / DifficultyLevel` | difficultyFactors.researchRate | same. It only feeds the annual cap, which is never reached at start (565k against a 270k sum). |
| BuiltObject.cs 2423 Labs: `Research* += improvement.Value1`; components.txt 91–93 labs 30000 each | builtObject.ts | same. The capital port has 3 labs of each kind, so 90000 per field. |
| Empire.3.cs 1391 SelectNextResearchProject (race path, targeted categories/types, essential projects, colonization, list2/3/4 priorities, armour strip, race-specific strip, `lowest + 3` level cap, SelectRandomLowestProject) | selectNextResearchProject | same statement for statement. ResearchNodeList helpers (SelectRandomLowestProject, Get(Second)LowestProjectForTypeAny) also checked. |
| Selection cadence: only when a queue is empty, at the start of PerformResearchProjects and after each breakthrough (1898, 1925). No other C# caller. | same | same |
| Empire.3.cs 3093 DoCrashResearch (long interval, AI only, `(Cost − Progress)/4`, ≤ 70% of StateMoney) + Galaxy.6.cs 848 | doCrashResearch | same |
| Start.2.cs 1108–1350: two game-start empire DoTasks (the first before the labs exist), then touch times staggered by `Rnd.Next(1,120)` s | game.ts createGame | same. This gives the start-of-game research head start described below. |
| Tech trading (Galaxy.4.cs 4017 removes a traded project from the receiver's queue) | diplomacyTick.ts | ported. No trades happened in this run: every completion was self-researched. |

**Not ported (known TODO, `story/eventActions.ts:1681`):** Bacon `BaconEmpire.ProcessScienceShips`. BaconSettings.txt
sets `researchPerLab=1000`. About once a month (`Rnd.Next(26,35)` days) each exploration ship that has a lab and has
banked scientificData adds 1000 × (1 + race ResearchBonus) to one project. Each run uses up one unit of data. At most this is about
12k per lab per explorer per year, next to about 100k per field from the capital. It would not change A6.

## Hand-worked: seed-1 player (S540 Nation, Human, Military Dictatorship)

- Labs: 1 lab object (the capital space port) with 3 × 30000 in each field, so 90000 E / 90000 H / 90000 W. The floor is
  `max(12000, trunc(10.17e9/1e6) × 3 = 30519)`, so the labs value applies. The annual cap is
  `sqrt(sqrt(10.17e9/1000)) × 10000 = 564,758`, above the 270,000 total, so nothing is scaled down.
- Bonuses: the race ResearchBonus 15 (races.txt) gives ×1.15. The government ResearchSpeed is 1.0. The leader has Energy −5, so
  E = 1.15 × 0.95 = **1.0925**, H = W = **1.15**. There are no station, resource or ruin bonuses at start.
- Research per game year: **E 98,325 / H 103,500 / W 103,500**. The probe measured exactly +20,700 per 120 s in H and W.
  Around day 300 E rises to ×1.18 when a colony resource bonus arrives. From about day 400 E has 270,000 labs (the first research station).
- The first three projects (queue heads at start):
  - Improved Assault Tactics (W, level 1): 120,000
  - Proximity Sensors (H, level 1): 120,000
  - Enhanced Engines (E, level 2): 240,000
- Head start: the two game-start DoTasks each credit 121 s (the Empire ctor sets touch times to now − 121 s). The first
  runs before the labs exist and credits 30,519 × 121/600 = 6,155. The second credits 103,500 × 121/600 = 20,872. The
  total is 27,027 at t = 0, which is what the probe shows. The staggered touch time then credits another ~118 s on the
  first periodic tick. In total that is about 0.6 year of research in hand at start.

## Predicted against observed (2-year run, 1200 s)

| player project | cost | predicted | observed |
|---|---|---|---|
| Improved Assault Tactics (W) | 120,000 | (120,000 − 47,385 after the first tick) / 103,500 per year → day ~262 ± one 30 s periodic interval (18 days) | day 280 |
| Proximity Sensors (H) | 120,000 | same | day 280 |
| Enhanced Engines (E) | 240,000 | 98k/yr, then 106k/yr, then 318k/yr from the station | day 481 |
| Energy Torpedo Weapons (W) | 120,000 | 280 + (120,000 − 5,010 carry-over)/103,500 × 365 = day 685–703 | day 700 |
| Target Tracking (H) | 120,000 | same | day 700 |

That is **+5 for the player in 2 years**, matching the prediction. AI gains were +9 Zenox (Technocracy ×1.5 and a weapons station),
+6 Teekan, +8 Quameno, +6 Great S442, +9 Free S139, +8 Ketarov, +8 Haakonish, +5 S420 Enclave (Feudalism ×0.75), and
+4 Free S520. This is the same +4..+9 range as the soak. The spread follows government ResearchSpeed (0.75–1.5), research stations
and leader skills. Rushing (×3) queue heads appeared in 5 of the 120-s snapshots: Teekan on days 73, 146 and 438, Zenox on day 511,
Free S520 on day 730. These come from crash research (AI only, ≤ 70% of StateMoney must cover (cost − progress)/4 ≈
20–30k) or from a critical-success event. Early AI treasuries are small, so crash research is rare.

## Conclusion

A6 is faithful. Research speeds up as the C# intends: through research stations (each +90k in its field),
more colonies (which raise only the floor and the cap, not lab output), Technocracy, and, with the "Cheap" or "Very Cheap"
wizard settings, BaseTechCost 60000 or 30000, which make every project 2× or 4× faster.
