# Task 01f2 — SelectPopulation (independent native populations)

thinking: off
scope: locked

`$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`

**Mechanical port — start editing within your first few tool calls.** The C# source is pasted at the bottom of this file — translate it line by line into `src/sim/galaxy.ts` (or a new `src/sim/` module), keeping **every `Rnd` call in the same order** and the same constants. Cite the source above each function (`// Port of Galaxy.6.cs <Name>`). Do not survey other files; do not Read image files.

Depends on 01f1. Port:
- `$SRC/Galaxy.6.cs` 1218–1254 `SelectPopulation(habitat, sun)`
- helpers: `Galaxy.6.cs` 1330–1346 `CalculatePopulationAmount`, 1273–1292 `CheckIndependentColonyLimitForRace`, 1320–1329 `RenameSystemIfHome`, and `$SRC/Galaxy.4.cs` 1919–1938 `DetermineNearestRaceRegion`.
- `Population` / `PopulationList` types from `$SRC/Population.cs`, `PopulationList.cs` (only the fields these use; `RecalculateTotalAmount`).

Wire at the `TODO(port): SelectPopulation` site(s) in `src/sim/galaxy.ts` (inside the setupSolarSystem port), exactly where the C# calls it.

Tests: some colonizable planets carry native populations whose race ids exist in GameData; deterministic. `npm run typecheck` && `npm test`. Append `## Worker report`.


## C# source (verbatim excerpts — this is everything you need)

### Galaxy.6.cs line 1218
```csharp
        public void SelectPopulation(Habitat habitat, Habitat sun)
        {
            if (habitat.Diameter < 75)
            {
                return;
            }
            if (_RaceUsed == null)
            {
                _RaceUsed = new bool[Races.Count];
            }
            Race race = null;
            GalaxyLocation galaxyLocation = DetermineNearestRaceRegion(habitat.Xpos, habitat.Ypos);
            if (galaxyLocation != null)
            {
                race = galaxyLocation.RelatedRace;
            }
            if (race != null && race.NativeHabitatType == habitat.Type && !CheckIndependentColonyLimitForRace(race))
            {
                if (habitat.Quality < 0.6f)
                {
                    habitat.BaseQuality = 0.5f + (float)(Rnd.NextDouble() * 0.4);
                }
                int num = 1;
                for (int i = 0; i < num; i++)
                {
                    IndependentCount++;
                    long amount = CalculatePopulationAmount(habitat, race);
                    Population population = new Population(race, amount);
                    population.GrowthRate = 1f + ((float)race.ReproductiveRate - 1f) / 3f;
                    _RaceIndependentColonyCount[race.PictureRef]++;
                    habitat.Population.Add(population);
                    RenameSystemIfHome(sun, race);
                }
                habitat.Population.RecalculateTotalAmount();
            }
        }

```

### Galaxy.6.cs line 1330
```csharp
        private long CalculatePopulationAmount(Habitat habitat, Race race)
        {
            double num = habitat.Quality * 1000f;
            if (habitat.Type == race.NativeHabitatType)
            {
                num *= 1.5;
            }
            long num2 = 0L;
            int num3 = Rnd.Next(0, 30);
            num2 = ((num3 < 0 || num3 > 6) ? (Rnd.Next(100000, 300000) * (long)num) : (Rnd.Next(300000, 600000) * (long)num));
            if (_Age > 0)
            {
                num2 = (long)((double)num2 * Math.Pow(1.2, _Age));
            }
            return num2;
        }

```

### Galaxy.6.cs line 1273
```csharp
        private bool CheckIndependentColonyLimitForRace(Race race)
        {
            double num = (double)_LifePrevalence / 1000.0;
            int num2 = (int)(Math.Sqrt(StarCount) / 3.5 * num);
            if (_RaceIndependentColonyCount == null || _RaceIndependentColonyCount.Count == 0)
            {
                _RaceIndependentColonyCount = new List<int>();
                for (int i = 0; i < Races.Count; i++)
                {
                    _RaceIndependentColonyCount.Add(0);
                }
            }
            int num3 = _RaceIndependentColonyCount[race.PictureRef];
            if (num3 >= num2)
            {
                return true;
            }
            return false;
        }

```

### Galaxy.6.cs line 1320
```csharp
        private void RenameSystemIfHome(Habitat sun, Race race)
        {
            int pictureRef = race.PictureRef;
            if (!_RaceUsed[pictureRef])
            {
                sun.Name = race.HomeSystemName;
                _RaceUsed[pictureRef] = true;
            }
        }

```

### Galaxy.4.cs line 1919
```csharp
        public GalaxyLocation DetermineNearestRaceRegion(double x, double y)
        {
            GalaxyLocation result = null;
            double num = double.MaxValue;
            for (int i = 0; i < GalaxyLocations.Count; i++)
            {
                if (GalaxyLocations[i].Type == GalaxyLocationType.RaceRegion)
                {
                    GalaxyLocations[i].ResolveLocationCenter(out var x2, out var y2);
                    double num2 = CalculateDistanceSquared(x, y, x2, y2);
                    if (num2 < num)
                    {
                        result = GalaxyLocations[i];
                        num = num2;
                    }
                }
            }
            return result;
        }

```

### Population.cs (constructor/fields)
```csharp
// Decompiled with JetBrains decompiler
// Type: DistantWorlds.Types.Population
// Assembly: DistantWorlds.Types, Version=1.9.5.12, Culture=neutral, PublicKeyToken=null
// MVID: C87DBA0E-BD3A-46BA-A8F0-EE9F5E5721E2
// Assembly location: H:\7\DistantWorlds.Types.dll

using System;
using System.IO;
using System.Runtime.Serialization;

namespace DistantWorlds.Types
{
  [Serializable]
  public class Population : IComparable<Population>, ISerializable
  {
    private Race _Race;
    private long _Amount;
    private long _UnassimilatedAmount;
    private float _GrowthRate;

    public Population()
    {
    }

    public Population(SerializationInfo info, StreamingContext context)
      : this()
    {
      using (MemoryStream input = new MemoryStream((byte[]) info.GetValue("D", typeof (byte[]))))
      {
        using (BinaryReader binaryReader = new BinaryReader((Stream) input))
        {
          this._Amount = binaryReader.ReadInt64();
          this._UnassimilatedAmount = binaryReader.ReadInt64();
          this._GrowthRate = binaryReader.ReadSingle();
          binaryReader.Close();
        }
      }
      this._Race = (Race) info.GetValue("Ra", typeof (Race));
    }

    public void GetObjectData(SerializationInfo info, StreamingContext context)
    {
      using (MemoryStream output = new MemoryStream())
      {
        using (BinaryWriter binaryWriter = new BinaryWriter((Stream) output))
        {
          binaryWriter.Write(this._Amount);
          binaryWriter.Write(this._UnassimilatedAmount);
          binaryWriter.Write(this._GrowthRate);
          binaryWriter.Flush();
          binaryWriter.Close();
          info.AddValue("D", (object) output.ToArray());
        }
      }
      info.AddValue("Ra", (object) this._Race);
    }

    public Population(Race race, long amount)
    {
      this._Race = race;
      this._Amount = amount;
      this._GrowthRate = (float) race.ReproductiveRate;
    }

    public Race Race => this._Race;

    public long Amount
    {
      get => this._Amount;
      set => this._Amount = value;
    }

    public long UnassimilatedAmount
    {
      get => this._UnassimilatedAmount;
      set => this._UnassimilatedAmount = value;
    }

    public float GrowthRate
    {
      get => this._GrowthRate;
      set => this._GrowthRate = value;
    }

    int IComparable<Population>.CompareTo(Population other) => this.Amount.CompareTo(other.Amount);
  }
}

```
