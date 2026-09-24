# Task 06g — Wizard: Victory Conditions page

thinking: off
scope: locked

Everything you need is below. Edit `src/ui/screens/newGameWizard.ts` (+css), `src/sim/startGameOptions.ts`, tests. Do not edit `src/sim/galaxy.ts`, `src/sim/empire.ts`, `src/main.ts`. Start editing right away.

Add the "Victory Conditions" page (last page before Start). Port the fields of `VictoryConditions` below into `StartGameOptions.victory` with the C# defaults. Build the page from the original controls listed below (labels, default values, min/max) — checkboxes for each victory type and numeric inputs/sliders for thresholds and time limits. Modern panel style like the other pages.
Tests: defaults equal the C# defaults; min/max clamps; options round-trip.
`npm run typecheck` && `npm test`; save (don't open) `shots/06g-victory.png` via `?screen=wizard&page=victory`. Append `## Worker report`.

## Original controls (Start.InitializeComponent.cs — name = initial value/text)
```

```
## VictoryConditions.cs
```csharp
// Decompiled with JetBrains decompiler
// Type: DistantWorlds.Types.VictoryConditions
// Assembly: DistantWorlds.Types, Version=1.9.5.12, Culture=neutral, PublicKeyToken=null
// MVID: C87DBA0E-BD3A-46BA-A8F0-EE9F5E5721E2
// Assembly location: H:\7\DistantWorlds.Types.dll

using System;
using System.Runtime.Serialization;

namespace DistantWorlds.Types
{
  [Serializable]
  public class VictoryConditions
  {
    private bool _Territory;
    private double _TerritoryPercent;
    private bool _Population;
    private double _PopulationPercent;
    private bool _Economy;
    private double _EconomyPercent;
    private bool _TimeLimit;
    private long _TimeLimitDate;
    private long _StartDate;
    private bool _EnableStoryEvents;
    private Habitat _DefendHabitat;
    private Empire _DefendHabitatEmpire;
    private Habitat _TargetHabitat;
    private Empire _TargetHabitatEmpire;
    public bool EnableDisasterEvents = true;
    public bool EnableRaceSpecificEvents = true;
    public bool EnableRaceSpecificVictoryConditions = true;
    [OptionalField]
    public bool EnableStoryEventsShadows = true;
    public double VictoryThresholdPercentage = 1.0;

    public Habitat DefendHabitat
    {
      get => this._DefendHabitat;
      set => this._DefendHabitat = value;
    }

    public Empire DefendHabitatEmpire
    {
      get => this._DefendHabitatEmpire;
      set => this._DefendHabitatEmpire = value;
    }

    public Habitat TargetHabitat
    {
      get => this._TargetHabitat;
      set => this._TargetHabitat = value;
    }

    public Empire TargetHabitatEmpire
    {
      get => this._TargetHabitatEmpire;
      set => this._TargetHabitatEmpire = value;
    }

    public bool EnableStoryEvents
    {
      get => this._EnableStoryEvents;
      set => this._EnableStoryEvents = value;
    }

    public double TerritoryPercent
    {
      get => this._TerritoryPercent;
      set => this._TerritoryPercent = value;
    }

    public double PopulationPercent
    {
      get => this._PopulationPercent;
      set => this._PopulationPercent = value;
    }

    public double EconomyPercent
    {
      get => this._EconomyPercent;
      set => this._EconomyPercent = value;
    }

    public bool Territory
    {
      get => this._Territory;
      set => this._Territory = value;
    }

    public bool Population
    {
      get => this._Population;
      set => this._Population = value;
    }

    public bool Economy
    {
      get => this._Economy;
      set => this._Economy = value;
    }

    public bool TimeLimit
    {
      get => this._TimeLimit;
      set => this._TimeLimit = value;
    }

    public long TimeLimitDate
    {
      get => this._TimeLimitDate;
      set => this._TimeLimitDate = value;
    }

    public long StartDate
    {
      get => this._StartDate;
      set => this._StartDate = value;
    }
  }
}
```
