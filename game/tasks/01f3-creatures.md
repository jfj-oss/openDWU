# Task 01f3 — SelectCreatures (space creatures at generation)

thinking: off
scope: locked

`$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`

**Mechanical port — start editing within your first few tool calls.** The C# source is pasted at the bottom of this file — translate it line by line into `src/sim/galaxy.ts` (or a new `src/sim/` module), keeping **every `Rnd` call in the same order** and the same constants. Cite the source above each function (`// Port of Galaxy.6.cs <Name>`). Do not survey other files; do not Read image files.

Depends on 01f2. Port:
- `$SRC/Galaxy.6.cs` 654–712 `SelectCreatures(habitat)` and 713–717 `GenerateCreatureAtHabitat` (+ the overload it calls — Grep `-n` for `GenerateCreatureAtHabitat(` and Read just that).
- `$SRC/Creature.cs` (constructor + fields set at generation only — no movement/AI), `$SRC/CreatureType.cs` enum (member order exact).

Wire at both call sites: the `TODO(port)` for SelectCreatures in the setupSolarSystem port, and the gas-cloud loop in the constructor port (`$SRC/Galaxy.4.cs` ~2297–2305: `SelectCreatures(habitat)` right after `GenerateGasCloud()`). Expose `galaxy.creatures`.

Tests: creatures exist, reference valid habitats, types in enum range; deterministic. `npm run typecheck` && `npm test`. Append `## Worker report`.


## C# source (verbatim excerpts — this is everything you need)

### Galaxy.6.cs line 654
```csharp
        public void SelectCreatures(Habitat habitat)
        {
            if (_CreaturePrevalence <= 0.0)
            {
                return;
            }
            double num = Rnd.NextDouble();
            if (habitat.Type == HabitatType.BarrenRock || habitat.Category == HabitatCategoryType.Asteroid)
            {
                double num2 = _CreaturePrevalence * 0.009;
                if (num <= num2)
                {
                    GenerateCreatureAtHabitat(CreatureType.RockSpaceSlug, habitat);
                }
            }
            else if (habitat.Type == HabitatType.Desert)
            {
                double num3 = _CreaturePrevalence * 0.32;
                bool flag = habitat.Resources.ContainsName("Korabbian Spice");
                if (num <= num3 || flag)
                {
                    GenerateCreatureAtHabitat(CreatureType.DesertSpaceSlug, habitat);
                    if (flag)
                    {
                        GenerateCreatureAtHabitat(CreatureType.DesertSpaceSlug, habitat);
                        GenerateCreatureAtHabitat(CreatureType.DesertSpaceSlug, habitat);
                    }
                }
            }
            else if (habitat.Type == HabitatType.FrozenGasGiant)
            {
                double num4 = _CreaturePrevalence * 0.15;
                if (AllowGiantKaltorGeneration && num <= num4)
                {
                    GenerateCreatureAtHabitat(CreatureType.Kaltor, habitat);
                }
            }
            else if (habitat.Category == HabitatCategoryType.GasCloud)
            {
                double num5 = _CreaturePrevalence * 0.15;
                if (AllowGiantKaltorGeneration && num <= num5)
                {
                    int num6 = Rnd.Next(3, 10);
                    for (int i = 0; i < num6; i++)
                    {
                        GenerateCreatureAtHabitat(CreatureType.Kaltor, habitat);
                    }
                }
            }
            else if (habitat.Type == HabitatType.GasGiant)
            {
                double num7 = _CreaturePrevalence * 0.06;
                if (num <= num7)
                {
                    GenerateCreatureAtHabitat(CreatureType.Ardilus, habitat);
                }
            }
        }

```

### Galaxy.6.cs line 713
```csharp
        private Creature GenerateCreatureAtHabitat(CreatureType creatureType, Habitat habitat)
        {
            return GenerateCreatureAtHabitat(creatureType, habitat, lockLocation: false);
        }

```

### Galaxy.6.cs line 718
```csharp
        public Creature GenerateCreatureAtHabitat(CreatureType creatureType, Habitat habitat, bool lockLocation)
        {
            return GenerateCreatureAtHabitat(creatureType, habitat, lockLocation, -2000000001, -2000000001);
        }

```

### Galaxy.6.cs line 723
```csharp
        public Creature GenerateCreatureAtHabitat(CreatureType creatureType, Habitat habitat, bool lockLocation, int offsetX, int offsetY)
        {
            Habitat habitat2 = DetermineHabitatSystemStar(habitat);
            switch (creatureType)
            {
                case CreatureType.SilverMist:
                    {
                        Creature creature2 = new Creature(this, CreatureType.SilverMist, habitat, offsetX, offsetY);
                        creature2.LocationLocked = false;
                        Creatures.Add(creature2);
                        creature2.NearestSystemStar = habitat2;
                        if (Systems != null && Systems.Count > habitat2.SystemIndex)
                        {
                            Systems[habitat2.SystemIndex].Creatures.Add(creature2);
                        }
                        return creature2;
                    }
                case CreatureType.Ardilus:
                    {
                        Creature creature3 = new Creature(this, CreatureType.Ardilus, habitat, offsetX, offsetY);
                        creature3.LocationLocked = lockLocation;
                        Creatures.Add(creature3);
                        creature3.NearestSystemStar = habitat2;
                        if (Systems != null && Systems.Count > habitat2.SystemIndex)
                        {
                            Systems[habitat2.SystemIndex].Creatures.Add(creature3);
                        }
                        return creature3;
                    }
                case CreatureType.DesertSpaceSlug:
                    {
                        Creature creature4 = new Creature(this, CreatureType.DesertSpaceSlug, habitat, offsetX, offsetY);
                        creature4.LocationLocked = lockLocation;
                        Creatures.Add(creature4);
                        creature4.NearestSystemStar = habitat2;
                        if (Systems != null && Systems.Count > habitat2.SystemIndex)
                        {
                            Systems[habitat2.SystemIndex].Creatures.Add(creature4);
                        }
                        return creature4;
                    }
                case CreatureType.RockSpaceSlug:
                    {
                        Creature creature5 = new Creature(this, CreatureType.RockSpaceSlug, habitat, offsetX, offsetY);
                        if (Rnd.Next(0, 30) == 1)
                        {
                            creature5.Size = Rnd.Next(300, 400);
                            creature5.MaxSize = 450;
                            creature5.AttackStrength = (int)((double)creature5.Size / 30.0);
                            creature5.DamageKillThreshhold = (int)((double)creature5.Size * 1.1);
                        }
                        creature5.LocationLocked = lockLocation;
                        Creatures.Add(creature5);
                        creature5.NearestSystemStar = habitat2;
                        if (Systems != null && Systems.Count > habitat2.SystemIndex)
                        {
                            Systems[habitat2.SystemIndex].Creatures.Add(creature5);
                        }
                        return creature5;
                    }
                case CreatureType.Kaltor:
                    {
                        Creature creature = new Creature(this, CreatureType.Kaltor, habitat, offsetX, offsetY);
                        creature.LocationLocked = lockLocation;
                        Creatures.Add(creature);
                        creature.NearestSystemStar = habitat2;
                        if (Systems != null && Systems.Count > habitat2.SystemIndex)
                        {
                            Systems[habitat2.SystemIndex].Creatures.Add(creature);
                        }
                        return creature;
                    }
                default:
                    return null;
            }
        }

```

### CreatureType.cs
```csharp
// Decompiled with JetBrains decompiler
// Type: DistantWorlds.Types.CreatureType
// Assembly: DistantWorlds.Types, Version=1.9.5.12, Culture=neutral, PublicKeyToken=null
// MVID: C87DBA0E-BD3A-46BA-A8F0-EE9F5E5721E2
// Assembly location: H:\7\DistantWorlds.Types.dll

using System;

namespace DistantWorlds.Types
{
  [Serializable]
  public enum CreatureType : byte
  {
    Undefined,
    Kaltor,
    RockSpaceSlug,
    DesertSpaceSlug,
    Ardilus,
    SilverMist,
  }
}

```

### Creature.cs (constructor region)
```csharp
riodicTouch;
    private DateTime _LastLongTouch;
    [NonSerialized]
    public bool PromptSystemCheck;
    [NonSerialized]
    private GalaxyLocationList _Locations = new GalaxyLocationList();

    public Creature()
    {
    }

    public Creature(SerializationInfo info, StreamingContext context)
      : base(info, context)
    {
      using (MemoryStream input = new MemoryStream((byte[]) info.GetValue("Cr_D", typeof (byte[]))))
      {
        using (BinaryReader binaryReader = new BinaryReader((Stream) input))
        {
          this._CreatureID = binaryReader.ReadInt32();
          this._AttackStrength = binaryReader.ReadInt32();
          this._PictureRef = binaryReader.ReadInt32();
          this._MaxSize = binaryReader.ReadInt32();
          this._Damage = (double) binaryReader.ReadSingle();
          this._DamageKillThreshhold = binaryReader.ReadInt32();
          this._Type = (CreatureType) binaryReader.ReadByte();
          this._TurnRate = binaryReader.ReadSingle();
          this._AccelerationRate = binaryReader.ReadSingle();
          this._HealRate = binaryReader.ReadSingle();
          this._BirthDate = binaryReader.ReadInt64();
          this._AnchorRange = binaryReader.ReadInt32();
          this._AttackRange = binaryReader.ReadInt32();
          this._MovementSpeed = (int) binaryReader.ReadInt16();
          this._MovementSpeedBase = (int) binaryReader.ReadInt16();
          this._HyperSpeed = binaryReader.ReadInt32();
          this._HyperCountdown = binaryReader.ReadInt64();
          this._CanHide = binaryReader.ReadBoolean();
          this._IsBenign = binaryReader.ReadBoolean();
          this._LungeSpeed = (int) binaryReader.ReadInt16();
          this._LungeSpeedBase = (int) binaryReader.ReadInt16();
          this._LungeLength = (double) binaryReader.ReadSingle();
          this._LungeAccelerationRate = (double) binaryReader.ReadSingle();
          this._LungeInterval = (double) binaryReader.ReadSingle();
          this._ParentOffsetX = binaryReader.ReadDouble();
          this._ParentOffsetY = binaryReader.ReadDouble();
          this._LocationLocked = binaryReader.ReadBoolean();
          this._LastPositionX = binaryReader.ReadDouble();
          this._LastPositionY = binaryReader.ReadDouble();
          this._ParentX = binaryReader.ReadDouble();
          this._ParentY = binaryReader.ReadDouble();
          this._CurrentHeading = binaryReader.ReadSingle();
          this._TurnDirection = (TurnDirection) binaryReader.ReadByte();
          this._TargetSpeed = binaryReader.ReadSingle();
          this._LastDistance = binaryReader.ReadDouble();
          this._DistanceToTarget = binaryReader.ReadDouble();
          this._IsVisible = binaryReader.ReadBoolean();
          this._IsAttacking = binaryReader.ReadBoolean();
          this._ReproductionCounter = (double) binaryReader.ReadSingle();
          this._MovementSlowedLocation = binaryReader.ReadBoolean();
          this._HyperjumpDisabledLocation = binaryReader.ReadBoolean();
          this._CreaturePullAmountLocation = binaryReader.ReadSingle();
          this._CreaturePullAngleLocation = binaryReader.ReadSingle();
          this._CreatureDamageAmountLocation = binaryReader.ReadSingle();
          this._LastTouch = new DateTime(binaryReader.ReadInt64());
          this._LastShortTouch = new DateTime(binaryReader.ReadInt64());
          this._LastPeriodicTouch = new DateTime(binaryReader.ReadInt64());
          this._LastLongTouch = new DateTime(binaryReader.ReadInt64());
          this._LastLunge = new DateTime(binaryReader.ReadInt64());
          binaryReader.Close();
        }
      }
      this._Galaxy = (Galaxy) info.GetValue("Gx", typeof (Galaxy));
      this._AnchorHabitat = (Habitat) info.GetValue("AnH", typeof (Habitat));
      this._AnchorPoint = (Point) info.GetValue("AnP", typeof (Point));
      this._NearestSystemStar = (Habitat) info.GetValue("NSS", typeof (Habitat));
    }

    public new void GetObjectData(SerializationInfo info, StreamingContext context)
    {
      base.GetObjectData(info, context);
      using (MemoryStream output = new MemoryStream())
      {
        using (BinaryWriter binaryWriter = new BinaryWriter((Stream) output))
        {
          binaryWriter.Write(this._CreatureID);
          binaryWriter.Write(this._AttackStrength);
          binaryWriter.Write(this._PictureRef);
          binaryWriter.Write(this._MaxSize);
          binaryWriter.Write((float) this._Damage);
          binaryWriter.Write(this._DamageKillThreshhold);
          binaryWriter.Write((byte) this._Type);
          binaryWriter.Write(this._TurnRate);
          binaryWriter.Write(this._AccelerationRate);
          binaryWriter.Write(this._HealRate);
          binaryWriter.Write(this._BirthDate);
          binaryWriter.Write(this._AnchorRange);
          binaryWriter.Write(this._AttackRange);
          binaryWriter.Write((short) this._MovementSpeed);
          binaryWriter.Write((short) this._MovementSpeedBase);
          binaryWriter.Write(this._HyperSpeed);
          binaryWriter.Write(this._HyperCountdown);
          binaryWriter.Write(this._CanHide);
          binaryWriter.Write(this._IsBenign);
          binaryWrite
```
