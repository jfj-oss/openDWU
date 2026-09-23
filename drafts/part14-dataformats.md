---

## PART 14 — DATA FILE FORMATS (the modding/content surface)

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
