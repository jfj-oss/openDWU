# Task 01g — Galaxy leftovers: black-hole & moon names, scenic features, research-bonus industry

thinking: off
scope: locked

Everything you need is below. Edit **only** `src/sim/galaxy.ts`, `src/sim/types.ts` (new Habitat fields) and `test/galaxy.test.ts`. Do not touch `src/main.ts`, `src/ui/`, `src/render/` (another lane is editing them). Start editing right away.

Resolve these `TODO(port)` markers in `src/sim/galaxy.ts` by porting the verbatim C# below, keeping every `Rnd` call in order:
- `TODO(port): GenerateBlackHoleName` (~line 688) → port `GenerateBlackHoleName`.
- `TODO(port): GenerateMoonName` (~line 2400) → port `GenerateMoonName` and use it where the C# does.
- `TODO(port): ScenicFeature strings, HasRings` and `remaining scenic-feature cases` (~756/788) → complete `SetScenicFactor` (add `scenicFeature: string` and `hasRings: boolean` to `Habitat`).
- `TODO(port): ResearchBonusIndustry` (~731) → complete `SetResearchBonus` (add `researchBonusIndustry` to `Habitat`; port the `IndustryType` enum from the code below if referenced — member order as used).
If a C# call references something not yet ported, leave a precise `TODO(port)` instead of guessing.

Tests: black holes get non-empty names; every moon has a name; some habitats have a scenic feature; determinism unchanged (same seed → same output).
`npm run typecheck` && `npm test`. Append `## Worker report`.

## C# source

### Galaxy.5.cs line 2486 — GenerateBlackHoleName
```csharp
        public string GenerateBlackHoleName()
        {
            string empty = string.Empty;
            string empty2 = string.Empty;
            string empty3 = string.Empty;
            string[] array = new string[9] { "Devil's", "Dark", "Ravenous", "Deadly", "Perilous", "Traitor's", "Wretched", "Devouring", "Destroyer's" };
            string[] array2 = new string[16]
            {
            "Gate", "Vortex", "Whirlpool", "Wheel", "Lair", "Snare", "Desolation", "End", "Mouth", "Cauldron",
            "Pit", "Abyss", "Chasm", "Dungeon", "Inferno", "Void"
            };
            int num = Rnd.Next(0, array.Length);
            empty2 = array[num];
            num = Rnd.Next(0, array2.Length);
            empty3 = array2[num];
            return empty2 + " " + empty3;
        }

```

### Galaxy.4.cs line 2533 — GenerateMoonName
```csharp
        public string GenerateMoonName(Habitat moon)
        {
            string text = GenerateCodeName();
            _ = moon.Parent;
            DetermineHabitatSystemStar(moon);
            return GenerateRandomNameAlt();
        }

```

### Galaxy.5.cs line 2010 — SetScenicFactor(habitat, definitelySet)
```csharp
        public void SetScenicFactor(Habitat habitat, bool definitelySet)
        {
            Habitat habitat2 = DetermineHabitatSystemStar(habitat);
            switch (habitat.Type)
            {
                case HabitatType.BarrenRock:
                    if ((habitat.Category == HabitatCategoryType.Planet || habitat.Category == HabitatCategoryType.Moon) && (definitelySet || Rnd.Next(0, 600) == 1))
                    {
                        habitat.ScenicFactor = (float)(0.1 + Rnd.NextDouble() * 0.3);
                        habitat.ScenicFeature = string.Format(TextResolver.GetText("Ancient Monolith of X"), habitat2.Name);
                    }
                    break;
                case HabitatType.MarshySwamp:
                case HabitatType.Continental:
                    if (definitelySet || Rnd.Next(0, 70) == 1)
                    {
                        habitat.ScenicFactor = (float)(0.2 + Rnd.NextDouble() * 0.4);
                        switch (Rnd.Next(0, 2))
                        {
                            case 0:
                                habitat.ScenicFeature = string.Format(TextResolver.GetText("Rings of X"), habitat2.Name);
                                habitat.HasRings = true;
                                break;
                            case 1:
                                habitat.ScenicFeature = string.Format(TextResolver.GetText("X Falls"), habitat2.Name);
                                break;
                        }
                    }
                    break;
                case HabitatType.Ocean:
                    if (definitelySet || Rnd.Next(0, 100) == 1)
                    {
                        habitat.ScenicFactor = (float)(0.1 + Rnd.NextDouble() * 0.3);
                        habitat.ScenicFeature = string.Format(TextResolver.GetText("Undersea Ruins of X"), habitat2.Name);
                    }
                    break;
                case HabitatType.Ice:
                    if (definitelySet || Rnd.Next(0, 200) == 1)
                    {
                        habitat.ScenicFactor = (float)(0.2 + Rnd.NextDouble() * 0.4);
                        habitat.ScenicFeature = string.Format(TextResolver.GetText("Ice Rings of X"), habitat2.Name);
                        habitat.HasRings = true;
                    }
                    break;
                case HabitatType.Volcanic:
                case HabitatType.Desert:
                    if (!definitelySet && Rnd.Next(0, 200) != 1)
                    {
                        break;
                    }
                    habitat.ScenicFactor = (float)(0.2 + Rnd.NextDouble() * 0.4);
                    switch (Rnd.Next(0, 2))
                    {
                        case 0:
                            {
                                string scenicFeature2 = string.Format(TextResolver.GetText("Rings of X"), habitat2.Name);
                                if (habitat.Type == HabitatType.Volcanic)
                                {
                                    scenicFeature2 = string.Format(TextResolver.GetText("Fire Rings of X"), habitat2.Name);
                                }
                                habitat.ScenicFeature = scenicFeature2;
                                habitat.HasRings = true;
                                break;
                            }
                        case 1:
                            {
                                string scenicFeature = TextResolver.GetText("Great Canyon");
                                if (habitat2.Name.Length < 15)
                                {
                                    scenicFeature = string.Format(TextResolver.GetText("X Canyon"), habitat2.Name);
                                }
                                habitat.ScenicFeature = scenicFeature;
                                break;
                            }
                    }
                    break;
                case HabitatType.BlackHole:
                    habitat.ScenicFactor = (float)(0.3 + Rnd.NextDouble() * 0.6);
                    break;
                case HabitatType.GasGiant:
                    if (definitelySet || Rnd.Next(0, 100) == 1)
                    {
                        habitat.ScenicFactor = (float)(0.2 + Rnd.NextDouble() * 0.2);
                    }
                    break;
                case HabitatType.Neutron:
                    if (definitelySet || Rnd.Next(0, 2) > 0)
                    {
                        habitat.ScenicFactor = (float)(0.3 + Rnd.NextDouble() * 0.3);
                    }
                    break;
                case HabitatType.SuperNova:
                    break;
            }
        }

```

### Galaxy.5.cs line 1952 — SetResearchBonus(habitat, definitelySet)
```csharp
        public void SetResearchBonus(Habitat habitat, bool definitelySet)
        {
            switch (habitat.Type)
            {
                case HabitatType.Neutron:
                case HabitatType.BlackHole:
                case HabitatType.SuperNova:
                    if (definitelySet || Rnd.Next(0, 4) > 0)
                    {
                        int num2 = Rnd.Next(5, 16);
                        IndustryType researchBonusIndustry2 = IndustryType.Undefined;
                        switch (Rnd.Next(0, 3))
                        {
                            case 0:
                                researchBonusIndustry2 = IndustryType.Weapon;
                                break;
                            case 1:
                                researchBonusIndustry2 = IndustryType.Energy;
                                break;
                            case 2:
                                researchBonusIndustry2 = IndustryType.HighTech;
                                break;
                        }
                        habitat.ResearchBonus = (byte)num2;
                        habitat.ResearchBonusIndustry = researchBonusIndustry2;
                    }
                    break;
                case HabitatType.Volcanic:
                case HabitatType.GasGiant:
                case HabitatType.FrozenGasGiant:
                    if (definitelySet || Rnd.Next(0, 40) == 1)
                    {
                        int num = Rnd.Next(10, 31);
                        IndustryType researchBonusIndustry = IndustryType.Undefined;
                        switch (Rnd.Next(0, 3))
                        {
                            case 0:
                                researchBonusIndustry = IndustryType.Weapon;
                                break;
                            case 1:
                                researchBonusIndustry = IndustryType.Energy;
                                break;
                            case 2:
                                researchBonusIndustry = IndustryType.HighTech;
                                break;
                        }
                        habitat.ResearchBonus = (byte)num;
                        habitat.ResearchBonusIndustry = researchBonusIndustry;
                    }
                    break;
            }
        }

```
