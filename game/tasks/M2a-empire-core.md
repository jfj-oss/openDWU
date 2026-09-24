# Task M2a — Empire core model (constructor)

thinking: off
scope: locked

Everything you need is below. Create `src/sim/empire.ts` and `test/empire.test.ts`; you may add small fields to `src/sim/types.ts`. Do not edit `src/main.ts`, `src/ui/`, `src/render/`. Start editing right away.

Port the three `Empire` constructors below into a TypeScript `class Empire`:
- Declare **only the fields these constructors assign or read** (camelCase of the C# names; C# `_Field` backing fields → the property name). Types: `Galaxy` → the TS Galaxy class, `Habitat`, `Race` (from `src/sim/data/races.ts`), `EmpirePolicy` (from `src/sim/data/policy.ts` if it exists, else `unknown` + TODO).
- Any call to a method not in this excerpt → keep the call as a stub method on `Empire` with `// TODO(port): <C# method name> — Empire*.cs` and a no-op/neutral return, so the constructor's order of operations stays visible.
- Keep every `Galaxy.Rnd` call in order (use the galaxy's `rnd`).
- `EmpireId`s: allocate like the C# does if shown; otherwise a counter on the Galaxy (`galaxy.nextEmpireId()`).

Tests: constructing an empire with a real race + capital habitat from a generated galaxy sets name, capital, dominant race, government id; independent-empire constructor works; deterministic.
`npm run typecheck` && `npm test`. Append `## Worker report` listing every TODO stub you created (these become the next slices).

## Empire.cs 3748–4146 (constructors)
```csharp
        public Empire(Galaxy galaxy, string name, Habitat capital, Race dominantRace, int governmentId, double corruptionMultiplier, EmpirePolicy policy)
            : this(galaxy, name, capital, dominantRace, governmentId, corruptionMultiplier, policy, isPlayerEmpire: false)
        {
        }

        public Empire(Galaxy galaxy, string name, Habitat capital, Race dominantRace, int governmentId, double corruptionMultiplier, EmpirePolicy policy, bool isPlayerEmpire)
        {
            _Galaxy = galaxy;
            _Active = true;
            _EmpireId = _Galaxy.GetNextEmpireID();
            _Counters = new EmpireCounters(this);
            _PirateEconomy = new PirateEconomy(galaxy.CurrentStarDate);
            _ResourceMap.InitializeFlags(_Galaxy.Habitats.Count, _Galaxy);
            _Name = name;
            _Capital = capital;
            HomeWorld = _Capital;
            _DominantRace = dominantRace;
            CorruptionMultiplier = corruptionMultiplier;
            if (isPlayerEmpire && galaxy.ColonyNames != null && galaxy.ColonyNames.Count > galaxy.ColonyNameIndex)
            {
                string name2 = galaxy.ColonyNames[galaxy.ColonyNameIndex];
                galaxy.ColonyNameIndex++;
                capital.Name = name2;
            }
            LastDisasterDate = galaxy.CurrentStarDate;
            if (_DominantRace != null)
            {
                Policy.ResearchDesignOverallFocus = _DominantRace.ShipDesignFocus;
                Policy.ResearchDesignTechFocus1 = _DominantRace.TechFocus1;
                Policy.ResearchDesignTechFocus2 = _DominantRace.TechFocus2;
                Policy.ResearchDesignTechFocusType1 = _DominantRace.TechFocusType1;
                Policy.ResearchDesignTechFocusType2 = _DominantRace.TechFocusType2;
                if (!_DominantRace.Expanding)
                {
                    Reclusive = true;
                }
            }
            if (policy != null)
            {
                Policy = policy;
            }
            _AllowableGovernmentTypes = ResolveDefaultAllowableGovernmentTypes(_DominantRace, forceIncludeSpecialTypesIfRaceAllows: true);
            ChangeGovernment(governmentId);
            _DesignNamesIndex = _DominantRace.DesignNameIndex;
            if (string.IsNullOrEmpty(name))
            {
                _Name = GenerateEmpireName(governmentId);
            }
            BuiltObjects = new BuiltObjectList();
            ShipGroups = new ShipGroupList();
            Designs = new DesignList();
            LatestDesigns = new DesignList();
            Array values = Enum.GetValues(typeof(BuiltObjectSubRole));
            for (int i = 0; i < values.Length; i++)
            {
                LatestDesigns.Add(null);
            }
            ForeignDesigns = new DesignList();
            Characters = new CharacterList();
            Troops = new TroopList();
            IntelligenceMissions = new IntelligenceMissionList();
            Outlaws = new BuiltObjectList();
            DiplomaticRelations = new DiplomaticRelationList();
            _ProposedDiplomaticRelations = new DiplomaticRelationList();
            _ProposedDiplomaticRelations.InvertEmpireIndexing = true;
            Colonies = new HabitatList();
            ConstructionYards = new BuiltObjectList();
            DistressSignals = new DistressSignalList();
            Manufacturers = new BuiltObjectList();
            PrivateBuiltObjects = new BuiltObjectList();
            RefuellingDepots = new BuiltObjectList();
            ResourceExtractors = new BuiltObjectList();
            SpacePorts = new BuiltObjectList();
            MiningStations = new BuiltObjectList();
            Freighters = new BuiltObjectList();
            ConstructionShips = new BuiltObjectList();
            LongRangeScanners = new BuiltObjectList();
            ResearchFacilities = new BuiltObjectList();
            ResortBases = new BuiltObjectList();
            ResupplyShips = new BuiltObjectList();
            PlanetDestroyers = new BuiltObjectList();
            Messages = new EmpireMessageList();
            EmpireEvaluations = new EmpireEvaluationList();
            SystemVisibility = new SystemVisibilityList();
            for (int j = 0; j < _Galaxy.Systems.Count; j++)
            {
                SystemVisibility item = new SystemVisibility
                {
                    Status = SystemVisibilityStatus.Unexplored,
                    SystemStar = _Galaxy.Systems[j].SystemStar
                };
                SystemVisibility.Add(item);
            }
            ControlColonization = AutomationLevel.FullyAutomated;
            ControlColonyDevelopment = true;
            ControlColonyStockLevels = true;
            ControlColonyTaxRates = true;
            ControlDesigns = true;
            ControlDiplomacyGifts = AutomationLevel.FullyAutomated;
            ControlDiplomacyOffense = AutomationLevel.FullyAutomated;
            ControlDiplomacyTreaties = AutomationLevel.FullyAutomated;
            ControlMilitaryAttacks = AutomationLevel.FullyAutomated;
            ControlMilitaryFleets = true;
            ControlStateConstruction = AutomationLevel.FullyAutomated;
            ControlTroopGeneration = true;
            ControlAgentAssignment = AutomationLevel.FullyAutomated;
            ControlResearch = true;
            ControlColonyFacilities = AutomationLevel.FullyAutomated;
            ControlPopulationPolicy = true;
            ControlCharacterLocations = true;
            ControlOfferPirateMissions = AutomationLevel.FullyAutomated;
            SelectEmpireColors(isPirateFaction: false, out _MainColor, out _SecondaryColor);
            if (_DominantRace != null)
            {
                FlagShape = Galaxy.GenerateEmpireFlag(_MainColor, _SecondaryColor, _DominantRace.DefaultFlagShape, Galaxy.FlagShapes, ref _SmallFlagPicture, ref _LargeFlagPicture);
            }
            else
            {
                FlagShape = Galaxy.GenerateEmpireFlag(_MainColor, _SecondaryColor, -1, Galaxy.FlagShapes, ref _SmallFlagPicture, ref _LargeFlagPicture);
            }
            Habitat habitat = null;
            for (int k = 0; k < Galaxy.IndexMaxX; k++)
            {
                for (int l = 0; l < Galaxy.IndexMaxY; l++)
                {
                    HabitatList habitatList = galaxy.HabitatIndex[k][l];
                    for (int m = 0; m < habitatList.Count; m++)
                    {
                        if (habitatList[m] == _Capital)
                        {
                            if (_Capital.Category == HabitatCategoryType.Asteroid || _Capital.Category == HabitatCategoryType.Planet)
                            {
                                habitat = _Capital.Parent;
                                k = Galaxy.IndexMaxX;
                                l = Galaxy.IndexMaxY;
                                break;
                            }
                            if (_Capital.Category == HabitatCategoryType.Moon)
                            {
                                habitat = _Capital.Parent.Parent;
                                k = Galaxy.IndexMaxX;
                                l = Galaxy.IndexMaxY;
                                break;
                            }
                        }
                    }
                }
            }
            for (int n = 0; n < _Galaxy.Habitats.Count; n++)
            {
                Habitat habitat2 = _Galaxy.Habitats[n];
                bool known = false;
                if (habitat2.Category == HabitatCategoryType.Star)
                {
                    known = true;
                }
                if (habitat != null && (habitat2.Parent == habitat || (habitat2.Parent != null && habitat2.Parent.Parent == habitat)))
                {
                    known = true;
                    SystemVisibility[habitat2.SystemIndex].Status = SystemVisibilityStatus.Visible;
                }
                _ResourceMap.SetResourcesKnown(_Galaxy.Habitats[n], known);
            }
            if (_Capital != null)
            {
                if (_Capital.Troops == null)
                {
                    _Capital.Troops = new TroopList();
                }
                _TroopDescription = _DominantRace.TroopName;
                _TroopPictureRef = _DominantRace.PictureRef;
                _Capital.SetDevelopmentLevel(10);
            }
            _LastLongTouch = galaxy.CurrentDateTime.Subtract(new TimeSpan(0, 0, (int)_LongProcessingInterval + 1));
            _LastIntermediateTouch = _LastLongTouch;
            _LastPeriodicTouch = _LastLongTouch;
            _LastRegularTouch = _LastLongTouch;
            _LastShortTouch = _LastLongTouch;
            if (capital != null)
            {
                CargoList cargoList = new CargoList();
                if (capital.Cargo != null)
                {
                    foreach (Cargo item2 in capital.Cargo)
                    {
                        if (item2.EmpireId == _Galaxy.IndependentEmpire.EmpireId)
                        {
                            cargoList.Add(item2);
                        }
                    }
                    foreach (Cargo item3 in cargoList)
                    {
                        capital.Cargo.Remove(item3);
                        Cargo cargo = null;
                        if (item3.CommodityIsComponent)
                        {
                            cargo = new Cargo(item3.Component, item3.Amount, this, item3.Reserved);
                        }
                        else if (item3.CommodityIsResource)
                        {
                            cargo = new Cargo(item3.Resource, item3.Amount, this, item3.Reserved);
                        }
                        if (cargo != null)
                        {
                            capital.Cargo.Add(cargo);
                        }
                    }
                }
                SetStartupColonyResourceCargo(Capital);
            }
            _StateMoney = 30000.0;
            _PrivateMoney = 100000.0;
            _Research = new ResearchSystem();
            _Research.TechTree = Galaxy.ResearchNodeDefinitionsStatic.ObtainTechTree(dominantRace);
            _Research.TechTree = Galaxy.ResearchNodeDefinitionsStatic.SetTechTreeStartingDefaults(_Research.TechTree, dominantRace, policy);
            Research.Update(DominantRace);
            ReviewResearchAbilities();
            ReviewDesignsBuiltObjectsImprovedComponents();
            ReviewColonizationTypes();
            ReviewPopulationGrowthRates();
            int newSize = 0;
            ReviewMaximumConstructionSize(out newSize);
            ReviewCanBuildShipTypes();
            ReviewTroopTypes();
            LastLeaderChangeDate = _Galaxy.CurrentStarDate;
        }

        public int SetStartupColonyResourceCargo(Habitat colony)
        {
            int val = 1 + (int)(colony.Population.TotalAmount / 250000000);
            val = Math.Min(10, val);
            double num = Galaxy.ColonyAnnualResourceConsumptionRate * ((double)colony.Population.TotalAmount / 15.0);
            if (num < 1.0)
            {
                num = 1.0;
            }
            else if (num > 5.0)
            {
                num = 5.0;
            }
            Cargo cargo = null;
            if (colony.Cargo == null)
            {
                colony.Cargo = new CargoList();
            }
            for (int i = 0; i < _Galaxy.ResourceSystem.StrategicResourcesOrderedByRelativeImportance.Count; i++)
            {
                ResourceDefinition resourceDefinition = _Galaxy.ResourceSystem.StrategicResourcesOrderedByRelativeImportance[i];
                if (resourceDefinition != null && resourceDefinition.ColonyManufacturingLevel <= 0)
                {
                    cargo = new Cargo(new Resource(resourceDefinition.ResourceID), (int)((double)(resourceDefinition.RelativeImportance * 6000f) * num), this);
                    colony.Cargo.Add(cargo);
                }
            }
            for (int j = 0; j < 4; j++)
            {
                int index = Galaxy.Rnd.Next(0, _Galaxy.ResourceSystem.LuxuryResources.Count);
                ResourceDefinition resourceDefinition2 = _Galaxy.ResourceSystem.LuxuryResources[index];
                if (resourceDefinition2 != null && resourceDefinition2.SuperLuxuryBonusAmount <= 0 && resourceDefinition2.ColonyManufacturingLevel <= 0)
                {
                    cargo = new Cargo(new Resource(resourceDefinition2.ResourceID), 600, this);
                    colony.Cargo.Add(cargo);
                }
            }
            long num2 = Math.Max(500000000L, colony.Population.TotalAmount);
            int num3 = (int)(Galaxy.ColonyAnnualLuxuryResourceConsumptionRate * (double)num2 * 5.0);
            num3 = Math.Max(num3 * 3, Galaxy.MinimumLuxuryResourceReorderAmount);
            num3 = Math.Max(400, num3);
            num3 = (int)((double)num3 * 1.5);
            for (int k = 0; k < val; k++)
            {
                Resource resource = _Galaxy.SelectRandomLuxuryResource();
                int num4 = colony.Cargo.IndexOf(resource, this);
                int num5 = 0;
                while (num4 >= 0 && num5 < 10)
                {
                    resource = _Galaxy.SelectRandomLuxuryResource();
                    num4 = colony.Cargo.IndexOf(resource, this);
                    num5++;
                }
                if (num4 >= 0)
                {
                    resource = _Galaxy.SelectRandomLuxuryResource();
                }
                cargo = new Cargo(new Resource(resource.ResourceID), num3, this);
                colony.Cargo.Add(cargo);
            }
            return val;
        }

        public static List<int> ResolveRaceSpecificGovernmentTypes(Race dominantRace)
        {
            List<int> list = new List<int>();
            if (dominantRace.SpecialGovernmentId >= 0)
            {
                list.Add(dominantRace.SpecialGovernmentId);
            }
            return list;
        }

        public static List<int> ResolveDefaultAllowableGovernmentTypes(Race dominantRace)
        {
            return ResolveDefaultAllowableGovernmentTypes(dominantRace, forceIncludeSpecialTypesIfRaceAllows: false);
        }

        public static List<int> ResolveDefaultAllowableGovernmentTypes(Race dominantRace, bool forceIncludeSpecialTypesIfRaceAllows)
        {
            List<int> list = new List<int>();
            for (int i = 0; i < Galaxy.GovernmentsStatic.Count; i++)
            {
                GovernmentAttributes governmentAttributes = Galaxy.GovernmentsStatic[i];
                if (governmentAttributes == null)
                {
                    continue;
                }
                bool flag = true;
                if (dominantRace != null && dominantRace.DisallowedGovernmentIds.Contains(governmentAttributes.GovernmentId))
                {
                    flag = false;
                }
                if (!flag)
                {
                    continue;
                }
                switch (governmentAttributes.Availability)
                {
                    case 0:
                        list.Add(governmentAttributes.GovernmentId);
                        break;
                    case 1:
                        if (dominantRace != null && dominantRace.SpecialGovernmentId == governmentAttributes.GovernmentId)
                        {
                            list.Add(governmentAttributes.GovernmentId);
                        }
                        break;
                    case 2:
                        if (dominantRace != null && (forceIncludeSpecialTypesIfRaceAllows || dominantRace.Name == "Mechanoid") && dominantRace.SpecialGovernmentId == governmentAttributes.GovernmentId)
                        {
                            list.Add(governmentAttributes.GovernmentId);
                        }
                        else if (dominantRace != null && dominantRace.SpecialGovernmentId == governmentAttributes.GovernmentId)
                        {
                            list.Add(governmentAttributes.GovernmentId);
                        }
                        break;
                    case 3:
                        if (dominantRace != null && (forceIncludeSpecialTypesIfRaceAllows || dominantRace.Name == "Shakturi") && dominantRace.SpecialGovernmentId == governmentAttributes.GovernmentId)
                        {
                            list.Add(governmentAttributes.GovernmentId);
                        }
                        else if (dominantRace != null && dominantRace.SpecialGovernmentId == governmentAttributes.GovernmentId)
                        {
                            list.Add(governmentAttributes.GovernmentId);
                        }
                        break;
                }
            }
            return list;
        }

        public void GenerateDesignSpecifications(Galaxy galaxy, Race dominantRace, bool isPirate, string raceNameOverride)
        {
            _DesignSpecifications.Clear();
            PlanetDestroyerDesignSpecification = null;
            if (!isPirate)
            {
                PlanetDestroyerDesignSpecification = DesignSpecification.LoadFromFile(galaxy.ApplicationStartupPath, galaxy.CustomizationSetPath, "PlanetDestroyer", BuiltObjectSubRole.CapitalShip, isMobile: true, dominantRace, isPirate, standAlone: true, raceNameOverride);
            }
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "CapitalShip", BuiltObjectSubRole.CapitalShip, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "Carrier", BuiltObjectSubRole.Carrier, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "ColonyShip", BuiltObjectSubRole.ColonyShip, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "ConstructionShip", BuiltObjectSubRole.ConstructionShip, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "Cruiser", BuiltObjectSubRole.Cruiser, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "DefensiveBase", BuiltObjectSubRole.DefensiveBase, isMobile: false, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "Destroyer", BuiltObjectSubRole.Destroyer, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "EnergyResearchStation", BuiltObjectSubRole.EnergyResearchStation, isMobile: false, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "Escort", BuiltObjectSubRole.Escort, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "ExplorationShip", BuiltObjectSubRole.ExplorationShip, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "Frigate", BuiltObjectSubRole.Frigate, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "GasMiningShip", BuiltObjectSubRole.GasMiningShip, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "GasMiningStation", BuiltObjectSubRole.GasMiningStation, isMobile: false, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "HighTechResearchStation", BuiltObjectSubRole.HighTechResearchStation, isMobile: false, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "LargeFreighter", BuiltObjectSubRole.LargeFreighter, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "LargeSpacePort", BuiltObjectSubRole.LargeSpacePort, isMobile: false, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "MediumFreighter", BuiltObjectSubRole.MediumFreighter, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "MediumSpacePort", BuiltObjectSubRole.MediumSpacePort, isMobile: false, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "MiningShip", BuiltObjectSubRole.MiningShip, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "MiningStation", BuiltObjectSubRole.MiningStation, isMobile: false, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "MonitoringStation", BuiltObjectSubRole.MonitoringStation, isMobile: false, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "PassengerShip", BuiltObjectSubRole.PassengerShip, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "ResortBase", BuiltObjectSubRole.ResortBase, isMobile: false, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "ResupplyShip", BuiltObjectSubRole.ResupplyShip, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "SmallFreighter", BuiltObjectSubRole.SmallFreighter, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "SmallSpacePort", BuiltObjectSubRole.SmallSpacePort, isMobile: false, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "TroopTransport", BuiltObjectSubRole.TroopTransport, isMobile: true, dominantRace, isPirate, raceNameOverride));
            _DesignSpecifications.Add(DesignSpecification.LoadFromFile(galaxy, "WeaponsResearchStation", BuiltObjectSubRole.WeaponsResearchStation, isMobile: false, dominantRace, isPirate, raceNameOverride));
        }

        public Empire(Galaxy galaxy, string name, bool isIndependentEmpire, Habitat homeHabitat, Race dominantRace, EmpirePolicy policy)
```

## Worker report

**Files changed:**
- `src/sim/empire.ts` (new) — `class Empire` porting the 7-arg and 8-arg constructors
  (Empire.cs 3748–4146) in exact order of operations, plus `SetStartupColonyResourceCargo`,
  `ResolveRaceSpecificGovernmentTypes`, `ResolveDefaultAllowableGovernmentTypes` (both
  overloads), and `GenerateDesignSpecifications` (full 28-spec call list). The third
  (independent-empire) constructor signature is wired up; its body was truncated from the
  excerpt so it delegates neutrally to the primary ctor.
- `src/sim/cargo.ts` (new) — minimal `Cargo` / `CargoList` / `ResourceRef` / `TroopList`
  surface needed by the constructors. **Note: this file is beyond the task's named list**
  (`empire.ts`, `types.ts`, `test/empire.test.ts`) but is required because the C# ctor
  manipulates `capital.Cargo` (a `CargoList`) and `capital.Troops` (a `TroopList`).
- `src/sim/types.ts` (edited) — added `cargo: CargoList | null`, `troops: TroopList | null`,
  `developmentLevel`, and `setDevelopmentLevel(level)` to `Habitat`.
- `test/empire.test.ts` (new) — constructs an empire with a real race + capital habitat
  from a generated galaxy (asserts name, capital, homeWorld, dominantRace, government id,
  state/private money, latestDesigns size, systemVisibility size, development level, cargo
  re-titling); empty-name → generated name; independent-empire ctor; determinism across two
  same-seed generations.

**Done:** `npm run typecheck` passes; `npm test` passes (242 tests, 23 files, incl. the 4 new
empire tests). All `Galaxy.Rnd` calls are preserved in position via `galaxy.rnd`.

**Left undone / TODO stubs created (these become the next slices):**
- `EmpireCounters` — EmpireCounters.cs (empty class).
- `PirateEconomy` — PirateEconomy.cs (ctor only).
- `ResourceMap.InitializeFlags` / `SetResourcesKnown` — ResourceMap.cs (no-ops).
- `ChangeGovernment(governmentId)` — Empire.cs (stores the id; no effects).
- `GenerateEmpireName(governmentId)` — Empire.cs (adjective+noun from the government
  definition, fallback `'Empire'`; not the full random name-part logic).
- `SelectEmpireColors(isPirateFaction, setColors)` — Empire.cs (uses race default colors).
- `Galaxy.GenerateEmpireFlag` + `Galaxy.FlagShapes` — Galaxy.cs (flag shape passes through
  the race's `defaultFlagDesign`; small/large flag pictures stay 0).
- `ResearchSystem` + tech tree `ObtainTechTree` / `SetTechTreeStartingDefaults` —
  ResearchSystem.cs / Galaxy.ResearchNodeDefinitionsStatic (techTree stays null).
- `ReviewResearchAbilities`, `ReviewDesignsBuiltObjectsImprovedComponents`,
  `ReviewColonizationTypes`, `ReviewPopulationGrowthRates`, `ReviewMaximumConstructionSize`,
  `ReviewCanBuildShipTypes`, `ReviewTroopTypes` — Empire.cs (all no-op stubs).
- `DesignSpecification.LoadFromFile` (28 specs + PlanetDestroyer path load) —
  DesignSpecification.cs (returns `{}`).
- `EmpirePolicy` type — Policy.cs (typed as `unknown`; policy data model not ported).
- `Galaxy.CurrentStarDate` / `CurrentDateTime` — Galaxy.cs (stood in with `START_STAR_DATE`;
  the five "last touch" back-dates are computed but not stored on any field yet).
- `Galaxy.ColonyNames` / `ColonyNameIndex` — Galaxy.cs (player-empire capital rename branch
  is a guarded no-op).
- `Galaxy.HabitatIndex` grid — Galaxy.cs (capital's parent star found by scanning the
  habitat list directly instead).
- `ResourceSystem` strategic-resource ordering + `RelativeImportance`, and the
  `ColonyAnnualResourceConsumptionRate` / `ColonyAnnualLuxuryResourceConsumptionRate` /
  `MinimumLuxuryResourceReorderAmount` constants — ResourceSystem.cs / Galaxy.cs (mineral
  resources substituted in file order with importance 1; rates = 1.0; reorder min = 400).
- `Galaxy.SelectRandomLuxuryResource` — Galaxy.cs (uniform pick over type-2 resources via
  `galaxy.rnd`).
- `Galaxy.IndependentEmpire` cargo-ownership check — Galaxy.cs (TS Galaxy has no
  IndependentEmpire; all pre-existing capital cargo is treated as independent-owned).
- `_LongProcessingInterval` value — Empire.cs (field initializer not in excerpt; used 60_000).
- `GetNextEmpireID` — Galaxy.cs (per-galaxy counter via a module-level `WeakMap<Galaxy, number>`
  since the TS Galaxy class can't be edited for this task).
- Independent-empire constructor body — Empire.cs:4146+ (truncated from the excerpt).
- `Troop` class — Troop.cs (only the `TroopList` wrapper is modeled).
- Full `Cargo` semantics (component vs resource commodities, per-empire merging) — Cargo.cs.
