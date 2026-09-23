# Data file formats (contract for `data/`)

Every file below lives in `distant-worlds/data/` and is loaded by the `dwu-data`
crate. Values come verbatim from `Distant_Worlds_Universe_Recreation_Prompt.md`
(the spec, in the workspace root): Appendices A (races), B (governments + bias
matrices), C (resources), D (components), E (facilities), F (research tree),
G (design templates), I (plagues), J (policy defaults), K (enums). The field
layouts in this file are the parser contract — follow them exactly.

## Rulings (final, 2026)
- **22 races, not 24**: spec narrative says "24" but §5.1/Appendix A define
  exactly 22 races (20 playable + Shakturi + Mechanoid). All data files use 22;
  verify-data enforces 22 races and 22x22 race biases.
- **372 research projects, not 337**: Appendix F's own content enumerates 372
  projects (WEAPONS 152, ENERGY 115, HIGHTECH 105; its own "TOTAL 372" line).
  The "337" figure in the spec narrative is stale; all 372 were transcribed.
- **163 policy settings, not 165**: Appendix J enumerates 163 unique settings;
  all 22 race policy files carry the complete 163-setting schema.
- **Component Type codes**: the Appendix D table uses the original game's
  codes, which match the official modding-guide header list verbatim
  (0=AreaShieldRecharge ... 46=WeaponAreaDestruction, 47=WeaponAreaGravity,
  48=WeaponBeam, 49=WeaponBombard, 50=WeaponGravityBeam, ... 60=WeaponTorpedo,
  61=WeaponTractorBeam). `ComponentType::from_code` implements that list.
  Spec line 191's "Shaktur FireStorm (beam)" annotation does NOT change its
  table code 60 (WeaponTorpedo).
- **Facility Type codes**: the spec's Appendix E table values are canonical
  (0=TroopTrainingCenter, 1=RoboticTroopFoundry, 2=CloningFacility,
  3=PlanetaryShield, 4=GiantIonCannon, 5=RegionalCapital, 6=FortifiedBunker,
  7=TerraformingFacility, 8=Wonder, 9=PirateBase, 10=PirateFortress,
  11=ArmoredFactory, 12=SpyAcademy, 13=ScienceAcademy, 14=NavalAcademy,
  15=MilitaryAcademy, 16=PirateCriminalNetwork). NOTE: the official modding
  guide lists 12=MilitaryAcademy/13=SpyAcademy/14=NavalAcademy/15=ScienceAcademy
  for the four academies; the spec table differs and is canonical in this project.
- Component energy/motion values are synthesized **and rescaled to the spec's
  stated ranges** (Part 4.1): main-thrust Value1 = top speed 6-60 u/s,
  Value2 = cruise (~60% of top), Value3 = energy use/s; vectoring Value1 =
  turn rate 1.5-6.0 rad/s; hyperdrive Value1 = travel speed 40-120 u/s,
  Value2 = energy use/s, Value3 = jump initiation seconds.
- **Synthesized fields** (spec gives no values; documented per file):
  component cost pairs (deterministic scheme per component type), facility
  BuildTimeDays (30/60/100/200 by type & cost), fighter stats (within spec
  ranges, smooth tech progression), PictureRef/SpecialImageIndex (0),
  Industry (by component type), name pools (generated), design template
  counts (role budgets + race tech-focus weapon mix), GameText topics
  (generated from the data sets + spec vocabulary).

General rules:
- UTF-8, one record per line (research.txt is the exception: grouped records).
- Blank lines and lines starting with `#` are ignored by all loaders.
- No quoting; fields are split on commas (research uses `;` between key/value).
- Booleans are `Y`/`N`. Numbers are plain (decimals with `.`).

## races.txt (Appendix A → 34 comma-separated fields, in this order)
`Name, PictureIndex, RaceFamilyID, ReproductionRate, Intelligence, Aggression, Caution, Friendliness, Loyalty, DesignsPictureFamilyIndex, DesignNamesIndex, ShipMaintenanceSavings, TroopMaintenanceSavings, ResourceExtractionBonus, WarWearinessAttenuation, SatisfactionModifier, ResearchBonus, EspionageBonus, TradeBonus, OverallShipDesignFocus, TechFocus1, TechFocus2, NativePlanetType, SpecialComponent, SpecialGovernment, PreferredStartingGovernment, Expanding, CanBePirate, Playable, DefaultPrimaryColor, DefaultSecondaryColor, DefaultFlagDesign, HomeSystemName, TroopName`

Mapping from the spec's per-race summaries:
- PictureIndex = ship art family index from "ship art family N" (use N).
- RaceFamilyID: 0=Humanoid,1=Ursidian,2=Insectoid,3=Reptilian,4=Amphibian,5=Rodent,6=Machine.
- ReproductionRate: "growth 1.12" → 1.12.
- Intelligence/Aggression/Caution/Friendliness/Loyalty: int values as given.
- ShipMaintenanceSavings/TroopMaintenanceSavings: "savings: ships 20%" → 20; "mining +40%" → ResourceExtractionBonus 40.
- WarWearinessAttenuation: "warwear -70%" → 70 (use the absolute number; sign in spec = attenuation).
- SatisfactionModifier: "happiness +30%" → 30; ResearchBonus: "research +15%" → 15; EspionageBonus, TradeBonus likewise.
- OverallShipDesignFocus: 0=Balanced,1=Speed/Agility,2=Power,3=Efficiency.
- TechFocus1/2: 0=None,1=Beams,2=Torpedoes,3=Missiles,4=Area,5=Ion,6=Fighters,7=Shields,8=Reactors,9=Engines,10=HyperDrives,11=HyperDisruption,12=Construction,13=Computers,14=Sensors (from "tech focus: Sensors + None" → TechFocus1=14, TechFocus2=0).
- NativePlanetType: 0=Continental,1=MarshySwamp,2=Desert,3=Ocean,4=Ice,5=Volcanic.
- SpecialComponent: 0=None,1=DeathRay,2=DevastatorPulse,3=SuperLaser,4=StarBurnerXX-12,5=TurboThrusterER7,6=SwiftVector5000,7=MegatronZ4,8=NovaCoreNX-700,9=VelocityDriveST3,10=ShadowGhostECM2000,11=ShakturFireStorm,12=HighDensityFuelCell,13=S2F7RepairBot,14=PulseWaveCannon,15=RaptorTargetting (from "special tech:").
- SpecialGovernment / PreferredStartingGovernment: 0=None,1=Technocracy,2=HiveMind,3=MercantileGuild,4=UtopianParadise,5=WayOfTheAncients,6=WayOfDarkness,7=Despotism,8=Feudalism,9=Monarchy,10=Republic,11=Democracy,12=MilitaryDictatorship.
- Expanding/CanBePirate/Playable: Y/N.
- DefaultPrimaryColor/DefaultSecondaryColor/DefaultFlagDesign: "colors 5/9 flag 6" → 5, 9, 6.
- DesignNamesIndex: "names N" → N.
- HomeSystemName / TroopName: as given.
Order of the 22 races: the Appendix A block order (Ketarov, Atuuk, Gizurean,
Dhayut, Human, Quameno, Mortalen, Ackdarian, Haakonish, Naxxilian, Zenox,
Teekan, Wekkarus, Boskara, Shandar, Ugnari, Kiadian, Sluken, Securan, Ikkuro,
Shakturi, Mechanoid) — which is also the raceBiases.txt matrix row order.
Indexes must not change later.

## raceFamilies.txt
`ID, Name, SpecialFunctionCode` — 7 rows: 0 Humanoid, 1 Ursidian, 2 Insectoid, 3 Reptilian, 4 Amphibian, 5 Rodent, 6 Machine; SpecialFunctionCode 0 for all (no Shakturi likes/hates listed).

## raceBiases.txt (Appendix B matrix)
22 rows: `RowRaceName, v1, v2, ..., v22` — row feels toward columns in the same race order as races.txt. Values exactly from the Appendix B table.

## raceFamilyBiases.txt
7 rows in family order (Humanoid, Ursidian, Insectoid, Reptilian, Amphibian, Rodent, Machine): `FamilyName, v1..v7` from Appendix B.

## governments.txt (Appendix B table)
`ID, Name, Corruption, WarWearinessRate, MaintenanceCosts, ApprovalRating, PopulationGrowth, ResearchSpeed, TroopRecruitment, TradeBonus, LeaderReplacementLikeliness, LeaderReplacementDisruptionLevel, LeaderReplacementBoost, LeaderReplacementCharacterPool, LeaderReplacementManner, Stability, OwnReputationConcern, OtherEmpireReputationImportance, SpecialFunctionCode, Availability, Adj1, Adj2, Adj3, Adj4, Adj5, Noun1, Noun2, ...`
- 13 rows, IDs 0-12: 0 Despotism, 1 Feudalism, 2 Monarchy, 3 Republic, 4 Democracy, 5 Military Dictatorship, 6 Way of the Ancients, 7 Way of Darkness, 8 Technocracy, 9 Mercantile Guild, 10 Utopian Paradise, 11 Hive Mind, 12 Corporate Nationalism (the spec table column "ID" — use it).
- The 8 float multipliers are the spec table's first 8 numeric columns (Corruption … TradeBonus).
- LeaderReplacementLikeliness/Disruption/Boost: columns 9-11 of the table (e.g. Despotism 0.2/1.3/0).
- LeaderReplacementCharacterPool: column 12 (0=None,1=Governors,2=Admirals/Generals,3=Scientists); LeaderReplacementManner: column 13 (0=replacement,1=coup,2=election).
- Stability: column 14; OwnReputationConcern: column 15; OtherEmpireReputationImportance: column 16.
- SpecialFunctionCode: column 17 (Corporate Nationalism = 1, others 0).
- Availability: column 18: 0 = all races; 1 = race-specific (race-locked: Technocracy, MercantileGuild, UtopianParadise, HiveMind, CorporateNationalism); 2 = ancient-guardians-only (Way of the Ancients); 3 = shakturi-only (Way of Darkness).
- Adjectives: the table's adjective list fills Adj1..Adj5 in order, remaining Adj slots EMPTY; Nouns: the noun list after the `|` separator, comma-joined.

## governmentBiases.txt (Appendix B matrix)
13 rows in governments.txt ID order: `RowGovernmentName, v1..v13` (column = feels toward).

## components.txt (Appendix D — all 129 components, IDs 0-128)
`ID, Name, PictureRef, SpecialImageIndex, SoundEffectFilename, Type, Category, Industry, Value1, Value2, Value3, Value4, Value5, Value6, Value7[ ; ResourceId,Amount ; ...]`
- PictureRef = 0, SpecialImageIndex = 0, SoundEffectFilename empty (synthesized; no art/sound files ship with the reimplementation).
- Type: use the code table in dwu-data/src/components.rs (`ComponentType`); the Appendix D "Type" column is the component's functional class — map it as: 48=WeaponBeam, 60=WeaponTorpedo (shockwave/plasma = WeaponAreaDestruction if the name indicates area, otherwise torpedo), 54=WeaponMissile, 49=WeaponBombard, 56=WeaponPointDefense, 51=WeaponIonCannon, 53=WeaponIonPulse, 52=WeaponIonDefense, 22=HyperDeny, 46=WeaponArea (area weapons; "Derasian Shockwave"/"Intimidator Surgewave" are area weapons), 24=HyperStop (Gravity Well Projector), 59=WeaponSuperBeam (Death Ray/Super Laser), 58=WeaponSuperArea (Devastator Pulse), 19=FighterBay, 1=Armor, 40=Shields, 0=ShieldRecharge (Area Shield Recharge), 14=EngineMainThrust, 15=EngineVectoring, 23=HyperDrive, 33=Reactor, 12=EnergyCollector, 18=ExtractorMine, 16=ExtractorGasExtractor, 17=ExtractorLuxury, 29=ManufacturerWeaponsPlant, 27=ManufacturerEnergyPlant, 28=ManufacturerHighTechPlant, 20=StorageFuel, 3=StorageCargo, 45=StorageTroop, 31=StoragePassenger, 11=StorageDockingBay, 32=SensorProximityArray, 38=SensorResourceProfileSensor, 26=SensorLongRange, 44=SensorTraceScanner, 39=SensorScannerJammer, 41=SensorStealth, 42=ComputerTargetting, 43=ComputerTargettingFleet, 8=ComputerCountermeasures, 9=ComputerCountermeasuresFleet, 5=ComputerCommandCenter, 6=ComputerCommerceCenter, 37=LabsWeaponsLab, 35=LabsEnergyLab, 36=LabsHighTechLab, 7=ConstructionBuild, 25=HabitationLifeSupport, 21=HabitationHabModule, 30=HabitationMedicalCenter, 34=HabitationRecreationCenter, 4=HabitationColonization, 50=WeaponGravityBeam, 47=WeaponAreaGravity, 61=WeaponTractorBeam, 10=WeaponGravityBeam, 67=WeaponArea, 55=WeaponPhaser, 57=WeaponRailGun, 13=EnergyToFuel, 63=WeaponSuperTorpedo, 64=WeaponSuperMissile, 65=WeaponSuperPhaser, 66=WeaponSuperRailGun.
- Category: use the Appendix D "Category" column value as-is (it is the category code).
- Industry: 0=Weapons (all weapons, armor, fighter bay, assault pod, point defense), 1=Energy (shields/shield recharge, engines, hyperdrive, hyperdeny/hyperstop, reactors, collectors, extractors, manufacturers, fuel cells, damage control, construction), 2=HighTech (sensors, computers/targeting/countermeasures/command/commerce, labs, habitation, cargo/troop/passenger/docking storage, colonization).
- Value1..Value7 exactly from the table.
- Manufacturing cost pairs: the spec does not enumerate them; a deterministic scheme per component type is used (documented in components.txt header): weapons Steel+Silicon (super weapons +Iridium, ion +Lead, gravity +Dilithium), structure Steel, energy systems Steel+Silicon/Polymer, hyperdrives +Lead+Iridium, reactors +Silicon+Aculon, colonization heavy. Resource IDs: Steel=10, Silicon=9, Polymer=16, Lead=13, Iridium=15, Dilithium=3, Aculon=11, Caslon=18.

## fighters.txt
14 fighters, IDs 0-13 (unlocked by the fighter projects in Appendix F):
`ID, Name, Type, TechLevel, EnergyCapacity, EnergyRechargeRate, TopSpeed, TopSpeedEnergyConsumptionRate, AccelerationRate, TurnRate, EngineExhaustImageIndex, ShieldsCapacity, ShieldRechargeRate, DamageRepairRate, CountermeasureModifier, ArmorRating, Weapon1Id, Weapon2Id`
- Type: 0=Interceptor (fighters 0-4: "Star Fighters" series rows: Light/Tactical/Advanced/Star/Superiority Interceptors & fighters), 1=Bomber (torpedo/missile bomber rows).
- TechLevel: from the project's L value (L1..L7 → 1..7).
- Names: use the project names from Appendix F (e.g. "Light Interceptors", "Tactical Interceptors", "Advanced Fighters", "Advanced Star Fighters", "Superiority Fighters", "Light Torpedo Bombers", "Medium Torpedo Bombers", "Strike Bombers", "Heavy Assault Bombers", "Missile Bombers", "Enhanced Missile Bombers", "Advanced Missile Bombers", "Super Missile Bombers", "Star Fighters").
- Stats: the spec gives no per-fighter stats; values are synthesized within the spec's stated ranges (accel 5-100, turn 0.5-6.28, countermeas 0-99, repair 0-10) with a smooth tech-level progression (documented in fighters.txt header).
- Weapon1Id/Weapon2Id: reference components.txt IDs — interceptors: beam + torpedo family (0-4, 126 late); torpedo bombers: two torpedoes (5-8); missile bombers: missiles (10, 108, 128).

## facilities.txt (Appendix E — 33 facilities, IDs 0-32)
`ID, Name, Type, WonderType, WonderTypeValue, ConstructionCost, MaintenanceCost, BuildTimeDays, Value1, Value2, Value3, AllowedRaces, RequiredResearch, Description`
- Type codes = the Appendix E table's own "Type" column values, which are canonical here (0=TroopTrainingCenter ... 16=PirateCriminalNetwork; see Rulings). The table rows use them directly (Troop Academy 0, Robotic Troop Foundry 1, Troop Cloning 2, Planetary Shield 3, Giant Ion Cannon 4, Regional Capital 5 x3, Fortified Bunker 6, Terraforming 7, all wonders 8, Hidden Pirate Base 9, Hidden Pirate Fortress 10, Armored Factory 11, Spy Academy 12, Science Academy 13, Naval Academy 14, Military Academy 15, Criminal Network 16).
- WonderType codes: 0=none; wonders: Bakuras Highspeed Shipyards→10 (ColonyConstructionSpeed, value 20), Merkidor Planetary Fortress→9 (ColonyDefense, value 20), Holographic Network→8 (ColonyHappiness, value 100), Traders Bazaar→11 (ColonyIncome, value 30), Advanced Medicomplex→7 (ColonyPopulationGrowth, value 100), Holographic Universe→2 (EmpireHappiness, value 30), Koloros Medical Academy→1 (EmpirePopulationGrowth, value 30), Danuta Engineering Center→4 (EmpireResearchEnergy, value 50), Rusan Technology Installation→5 (EmpireResearchHighTech, value 50), Casidor Weapons Facility→3 (EmpireResearchWeapons, value 50), Trade Guild→6 (EmpireIncome, value 20), Universal Hive→12 (RaceAchievement, Gizurean), Galactic Archives→12 (RaceAchievement, Zenox), Lava Palace Resort→12 (RaceAchievement, Shandar), Underwater Palace→12 (RaceAchievement, Wekkarus). Non-wonder facilities: WonderType 0, WonderTypeValue 0.
- ConstructionCost/MaintenanceCost: from the spec table columns. BuildTimeDays: the spec table has no build-time column; synthesized (30 days standard, 60 Planetary Shield/Terraforming, 100/200 wonders by 50k/100k cost).
- Value1/Value2/Value3: the remaining two numeric columns after build days (Giant Ion Cannon Value1=105 → the component ID of the ion cannon it projects; Fortified Bunker Value1=10 defense bonus; Hidden Pirate Base Value2=25, Value3=10; Hidden Pirate Fortress Value2=50, Value3=20; Criminal Network Value3=40).
- AllowedRaces: empty for all (all races), EXCEPT Universal Hive (Gizurean), Galactic Archives (Zenox), Lava Palace Resort (Shandar), Underwater Palace (Wekkarus) — those are race-locked wonders.
- RequiredResearch: 0 (wonders are unlocked via research projects that reference the facility ID in Appendix F).
- Description: verbatim from Appendix E.

## plagues.txt (Appendix I)
4 rows:
`0, Hekretos Fever, 0, 0.06, 30, 150, 3, N, , 0, 0, 0, 0, <description>`
`1, Dekara Virus, 1, 0.09, 10, 300, 3, N, , 0, 0, 0, 0, <description>`
`2, Genetic Scrambling Syndrome, 2, 0.45, 85, 60, 2, N, , 0, 0, 0, 0, <description>`
`3, Merturov Plague, 3, 0.27, 25, 180, 1, N, , 0, 0, 0, 0, <description>`
(descriptions verbatim from Appendix I). Xaraktor Virus is NOT in plagues.txt (it appears via research/plague-change in the Ancient Galaxy storyline).

## research.txt (Appendix F — all 372 projects)
Grouped records, one block per project, in the spec's order (Weapons section first, then Energy, then HighTech). Block format:
```
PROJECT ; <id>, <Name>, <TechLevel>, <Row>, <Industry>, <Category>, <SpecialFunctionCode>, <BaseCostMultiplierOverride=1>
PARENTS ; <parent ids comma-joined, or omit the line>
COMPONENTS ; <component ids, up to 4, from "[unlocks:...]">
COMPONENT IMPROVEMENTS ; <ComponentId>, <TechLevel>, V1..V7   (repeat one line per improved component — V1..V7 = the improved component's final values from components.txt)
FIGHTERS ; <fighter ids from "[fighters:...]">
FACILITY ; <facility id from "[facility:]">
ABILITIES ; <key>, <code>, <tier>, <valueA>, <valueB>
PLAGUE CHANGE ; <plague id>, <field>, <value>
ALLOWED RACES ; <race names>
```
Rules:
- IDs: assign sequential IDs per industry in file order (Weapons 0..151, Energy 152..266, HighTech 267..371). Cross-references ("unlocks:4", "facility:3", "fighters:6") refer to components.txt IDs / facilities.txt IDs / fighters.txt IDs respectively — keep those verbatim.
- TechLevel: from "L<n>" (keep 100/101 for the two super-weapon rows).
- Row: from "r<n>".
- Industry: 0=WEAPONS, 1=ENERGY, 2=HIGHTECH.
- Category: derive from the project's theme using codes 0-26 listed in dwu-data/src/research.rs (WeaponBeam for beam/laser/phaser rows, WeaponTorpedo, WeaponMissile, WeaponArea, WeaponIon (ion/EMP), WeaponGravity (gravitic/graviton), WeaponPointDefense, Armor, Fighter, ShieldRecharge/Shields (shield rows), Engine (engine/thrust/maneuvering rows), HyperDrive (hyperdrive rows), HyperDisrupt (hyperjump inhibiting rows), Reactor, Extractor (mining rows), EnergyCollector, Manufacturer/Construction (construction rows), Labs (research), Storage (fuel/cargo rows), Habitation (crew rows), Sensor (scanner rows), Computer (targeting/holograms), AssaultPod (ship boarding rows), WeaponSuperBeam/WeaponSuperArea/WeaponSuperTorpedo (super weapon rows), WeaponBombard (bombardment rows)).
- SpecialFunctionCode: 1 for rows with [special:1] (PreWarpStartTech: Ground Combat, Mining, Resource Exploration, Docking Bay, Basic Crew Environment, Space Command, Space Commerce, Warp Field Precursors is [special:2], Super Beam/Super Area are [special:3], colonization-initial rows [special:4]); keep the spec's code.
- PARENTS: the spec's tree is implicit (rows form the tree: a project's parents are the immediately preceding projects in the same row with lower level, plus cross-row dependencies the spec marks). Use this deterministic rule: parents = the nearest lower-tech-level project(s) in the same row (if any) plus any same-row project with level exactly 1 lower if the row's levels are contiguous. For rows with L100/L101 super-weapon projects, parents = the highest-level project in that row.
- COMPONENT IMPROVEMENTS: for projects whose name indicates improvement ("Enhanced ...", "Advanced ...", "Improved ...") and that share a category with an unlock project earlier in the row, improve the component that row's first unlock project unlocked (V values = the next component tier's values from components.txt; if no better tier exists, leave the improvement line out).
- ABILITIES: transcribe from the bracket text using the keys in dwu-data/src/research.rs: "Colonize X planets" → `ColonizeHabitatType, 1, <tier>, <planetType>, 0` (planetType: Continental=1, Desert=3, Ocean=3, Volcanic=6, Ice=5, MarshySwamp=2 — use the spec's own numbers when given in brackets, e.g. "Colonize Desert planets, 1, 3, 4, 0" → valueA=4); "Increased Construction Size (2, tier, size, 0)" → `IncreasedConstructionSize, 2, <tier>, <size>, 0`; "Dedicated Carriers, 3, 3, 0, 0" → `EnableShipSubRole, 3, 3, 0, 0`; "Resupply Ships, 3, 3, 0, 1" → `EnableShipSubRole, 3, 3, 0, 1`; "Enable Infantry, 5, 0, 0, 1" → `EnableTroopType, 5, <tier>, 0, 1`; "Enable Armored Forces, 5, 2, 0, 2" → `EnableTroopType, 5, 2, 0, 2`; "Enable Special Forces, 5, 3, 0, 4" → `EnableTroopType, 5, 3, 0, 4`; "Enable Planetary Defense, 5, 2, 0, 3" → `EnableTroopType, 5, 2, 0, 3`; "Improved Infantry Attack, 5, 1, 25, 1" → `ImprovedTroopStat, 5, 1, 25, 1`; "Improved Infantry Defense, 5, 1, -25, 1" → `ImprovedTroopStat, 5, 1, -25, 1`; "Improved Armor Attack/Defense" → `ImprovedTroopStat, 5, <tier>, ±value, 2`; "Improved Special Forces ..." → `ImprovedTroopStat, 5, <tier>, ±value, 4`; "Improved Interception Accuracy" → `ImprovedTroopStat, 5, <tier>, -value, 3`; "Improved Interception Damage" → `ImprovedTroopStat, 5, <tier>, +value, 3`; "Improved Boarding Attack" → `Boarding, 0, <tier>, +value, 0`; "Improved Boarding Defense" → `Boarding, 0, <tier>, -value, 0`; "Lower Troop Maintenance" → `LowerTroopMaintenance, 5, <tier>, <value>, 0`; "X colony growth rate doubled, 4, 3, 2, 0" → `PopulationGrowthRate, 4, 3, 2, 0`.

## resources.txt (Appendix C — 41 resources, IDs 0-40)
Definition line: `ID, Name, PictureRef, BasePrice, Type, SuperLuxuryBonus, IsFuel, IsImportantPreWarp, ColonyGrowthResourceLevel, ColonyManufacturingLevel`
(PictureRef = ID; Type 0=Mineral, 1=Gas, 2=Luxury; values from the spec table; ColonyManufacturingLevel 0 for all — the spec table has no manufactured resources listed; keep 0.)
Prevalence rows: the spec's distribution table is not fully enumerated in the document. For each resource emit prevalence rows that make the game playable and are consistent with spec statements:
- Growth resources: Hydrogen (ID 8) on planets (all colonizable subtypes, prevalence 1.0, abundance 0.3-1.0); Steel (10) prevalence 0.8; Lead (13) 0.5; Silicon (9) 0.5; Polymer (16) 0.3; Carbon Fibre (17) 0.3 (planet subtypes 0-5, plus GasGiant/FrozenGasGiant 0.2).
- Other minerals (Emeros 0, Nekros 1, Osalia 2, Dilithium 3, Aculon 11, Chromium 12, Gold 14, Iridium 15): planets prevalence 0.2-0.5, asteroids (subtypes 9 Metal, 10 rocky) 0.1-0.3.
- Gases (Helium 4, Argon 5, Krypton 6, Tyderios 7, Hydrogen 8, Caslon 18): gas clouds (subtypes 9-17 match the cloud composition where the name matches: Helium→14, Argon→11, Hydrogen→15; Krypton/Tyderios/Caslon → NitrogenOxygen 16) prevalence 0.15-0.3, plus on gas giants (7/8) 0.3.
- Luxuries (19-40): planets prevalence 0.05-0.15 by tier (cheap luxuries higher), super-luxuries (Loros Fruit 19, Korabbian Spice 22, Zentabia Fluid 35) use "sources per 700-star galaxy" (use 0.001-0.002 for 700-star scale).
- Keep gas/mineral separation per location type (gas resources only on gas clouds/gas giants; minerals on planets/asteroids; luxuries on planets).

## designTemplates/ (Appendix G)
Directory `data/designTemplates/<RACE-UPPERCASE>/` for each of the 22 races (Appendix A order) plus `DEFAULT/`. Each dir gets 29 role files (lower-case stems): blank, capitalship, carrier, colonyship, constructionship, cruiser, defensivebase, destroyer, energyresearchstation, escort, explorationship, frigate, gasminingship, gasminingstation, hightechresearchstation, largefreighter, largespaceport, mediumfreighter, mediumspaceport, miningship, miningstation, monitoringstation, passengership, resortbase, resupplyship, smallfreighter, smallspaceport, trooptransport, weaponsresearchstation — and the 8 CanBePirate races (Atuuk, Boskara, Dhayut, Ikkuro, Mortalen, Naxxilian, Sluken, Teekan) additionally get a `pirate/` subfolder with the same 29 role files (pirate variants). The spec's "31 templates per race" count includes the pirate-folder marker in its own list; the loader accepts any template set and falls back to DEFAULT.
Each file: `CategoryName ;count` lines (comments `'` or `#`) for the categories the role uses (whole-number counts; 0-count categories may be omitted). CommandCenter, LifeSupport and HabModule are auto-added by the game — they do not appear in template files; Reactors/Collectors are topped up to energy demand and exactly one HyperDrive is auto-added. Counts: use the human/carrier.txt example from Appendix G as the reference for carriers; derive sensible counts for other roles from role requirements (military ships: weapons per role tier — frigate ~2 weapons 15 size, escort 3, destroyer 5-6, cruiser 8, capital 12, carrier 6 + 6-10 fighter bays; construction ships: ConstructionYard 1-2 + Reactor/Collector; spaceports: ConstructionYard, DockingBay, Reactor, Collector, large fuel cells; mining ships/stations: MiningEngine/GasExtractor/LuxuryResourceExtractor; research stations: ResearchLabEnergy/Weapons/HighTech; resort bases: CommerceCenter, PassengerCompartment, RecreationCenter; colony ships: ColonizationModule + fuel; freighters: CargoBay; troop transports: TroopCompartment; resupply: EnergyToFuelConverter + large fuel cells; defensive bases: shields + weapons; monitoring: LongRangeScanner; BLANK: all zeros). Vary per race by design focus (Power: +25% weapons/armor, -10% engines; Speed/Agility: +25% engines; Efficiency: -20% size, +10% collectors/fuel cells; Balanced: as DEFAULT). Keep counts as whole numbers.

## Policy/ and Policy/pirate/ (Appendix J)
`Policy/<Race>.txt` for the 22 races (20 playable + Shakturi + Mechanoid) using the exact 163-setting schema and the human values from Appendix J as the base; per-race variation rules: races with HiveMind special government get ColonyPopulationPolicyAllRaces 4 (Exterminate) — Boskara, Gizurean, Sluken; Utopian Paradise races (Securan, Shandar) get ColonyPopulationPolicy 0 and EngageInTourism Y; aggressive races (Boskara, Dhayut, Gizurean, Mortalen, Naxxilian, Shakturi, Sluken) get WarWillingness 1.5, WarAttacksAllowColonyBombardment 0-1; passive races (Quameno, Teekan, Wekkarus, Ackdarian, Kiadian) get WarWillingness 0.5-0.7, EngageInTourism Y; trading races (Teekan, Wekkarus, Haakonish, Ugnari, Ikkuro) get TradePriority 2-3; research-focused (Quameno, Kiadian, Human, Zenox) get ResearchPriority 2.
`Policy/pirate/<Race>.txt` for the 8 CanBePirate races (Atuuk, Boskara, Dhayut, Ikkuro, Mortalen, Naxxilian, Sluken, Teekan) + Shakturi excluded: same schema with pirate defaults: OfferPirateAttackMissions 2, OfferSmugglingPirateMissions 2, OfferDefensivePirateMissions 2, AcceptPirateSmugglingMissions Y, WarWillingness 2 (Raider playstyle varies per playstyle), CaptureEnlistMilitaryShip 2, CaptureEnlistCivilianShip 2, CaptureEnlistBase 2, UpgradeEnlistedMilitaryShips Y.

## Name pools
- agentNames.txt: 60 names (e.g. generic sci-fi agent code names).
- characterNames.txt: 200 names (generated).
- colonyNames.txt: 300 colony names (e.g. "New X", "Port X", race-flavored).
- shipNames.txt: 300 ship names.
- systems.txt: 600 fictional system names (Appendix J says ~600; spec §14.18 says pool of ~600).
- designNames/<0..13>.txt: 14 sets (race DesignNamesIndex 0-13) × 40 generated ship-class names each.
- Passengers.txt: 60 passenger-race names.
Generate these as original plausible sci-fi names (they are content the game uses for random naming).

## GameText.txt
`Topic ;text` lines covering at least: race descriptions (one per race: "RaceDescription_<Race>"), government descriptions ("GovernmentDescription_<Name>"), planet type descriptions ("PlanetType_<Name>"), creature descriptions ("Creature_<Type>"), resource descriptions ("Resource_<Name>"), screen help ("ScreenHelp_<Screen>" for main screens), message templates for the EmpireMessageType list (at least short forms), galactopedia topic titles. Use the spec's own descriptive text where it exists (race summaries §5.1, government descriptions §5.2, component descriptions from the spec, facility descriptions from Appendix E, plague descriptions from Appendix I).

## startup.ini (optional)
`SCREENWIDTH=1920`, `SCREENHEIGHT=1080`, `HYPERDRIVESPEED=1.0`, `playmovie=0`.