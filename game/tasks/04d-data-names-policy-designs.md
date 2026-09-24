# Task 04d — Data loaders: names, empire policies, design templates

thinking: off
scope: locked

Everything you need is below. Edit only `src/sim/data/` (new modules) and `test/` (new test file). Do not touch `src/main.ts`, `src/ui/`, `src/render/`, `src/sim/galaxy.ts`. Start editing right away.

Port each C# loader below as a **pure parser taking file text** (like the existing parsers in `src/sim/data/`), same field order/semantics:
- `colonyNames.txt`, `shipNames.txt` (SubRoleNameSet), `agentNames.txt`, design names (`designNames.txt`) → `names.ts`
- `Policy/<name>.txt` (EmpirePolicy fields) → `policy.ts` (port the EmpirePolicy field list from the parse code)
- `designTemplates/<race>/<SubRole>.txt` (DesignSpecification) → `designTemplates.ts`
Add them to `loadGameData` in `gameData.ts` (policies: the files listed in `Policy/` + `Policy/pirate/`; design templates per race folder — the file list must come from `public/asset-manifest.json` if it lists those folders, otherwise add a TODO and load only DEFAULT). The test helper `test/helpers/loadGameDataFs.ts` should read them from disk.

Tests: each parser on the real files (read from `public/assets/dwu/…` in tests): colony names > 100, ship-name sets non-empty, a policy file parses with no NaN numeric fields, the DEFAULT design templates parse (≥ 20 sub-roles).
`npm run typecheck` && `npm test`. Append `## Worker report`.

## C# source

### Galaxy.4.cs line 234 — LoadColonyNames
```csharp
        public static List<string> LoadColonyNames(string applicationStartupPath, string customizationSetName)
        {
            List<string> list = new List<string>();
            int num = 0;
            string text = applicationStartupPath + "\\colonyNames.txt";
            if (!string.IsNullOrEmpty(customizationSetName) && customizationSetName.ToLower(CultureInfo.InvariantCulture) != "default")
            {
                text = applicationStartupPath + "\\Customization\\" + customizationSetName + "\\colonyNames.txt";
            }
            try
            {
                if (!File.Exists(text))
                {
                    return list;
                }
                using FileStream stream = File.OpenRead(text);
                using StreamReader streamReader = new StreamReader(stream);
                while (!streamReader.EndOfStream)
                {
                    string validFileLine = GetValidFileLine(streamReader);
                    num++;
                    if (string.IsNullOrEmpty(validFileLine))
                    {
                        continue;
                    }
                    string[] array = validFileLine.Replace(" ", "").Split(',');
                    for (int i = 0; i < array.Length; i++)
                    {
                        if (!string.IsNullOrWhiteSpace(array[i]))
                        {
                            list.Add(array[i]);
                        }
                    }
                }
                return list;
            }
            catch (ApplicationException)
            {
                throw;
            }
            catch (Exception)
            {
                throw new ApplicationException("Error at line " + num + " reading file " + text);
            }
        }

```

### Galaxy.4.cs line 280 — LoadShipNames
```csharp
        public static SubRoleNameSet LoadShipNames(string applicationStartupPath, string customizationSetName)
        {
            int num = 0;
            string text = applicationStartupPath + "\\shipNames.txt";
            if (!string.IsNullOrEmpty(customizationSetName) && customizationSetName.ToLower(CultureInfo.InvariantCulture) != "default")
            {
                text = applicationStartupPath + "\\Customization\\" + customizationSetName + "\\shipNames.txt";
            }
            string[] names = Enum.GetNames(typeof(BuiltObjectSubRole));
            SubRoleNameSet subRoleNameSet = new SubRoleNameSet();
            try
            {
                if (!File.Exists(text))
                {
                    return subRoleNameSet;
                }
                FileStream fileStream = File.OpenRead(text);
                StreamReader streamReader = new StreamReader(fileStream);
                while (!streamReader.EndOfStream)
                {
                    string text2 = GetValidFileLine(streamReader);
                    num++;
                    if (string.IsNullOrEmpty(text2))
                    {
                        continue;
                    }
                    string text3 = string.Empty;
                    int num2 = text2.IndexOf(":");
                    if (num2 > 0)
                    {
                        text3 = text2.Substring(0, num2);
                        text3 = text3.Trim();
                    }
                    if (string.IsNullOrEmpty(text3))
                    {
                        continue;
                    }
                    BuiltObjectSubRole builtObjectSubRole = BuiltObjectSubRole.Undefined;
                    for (int i = 0; i < names.Length; i++)
                    {
                        if (names[i].ToLower(CultureInfo.InvariantCulture) == text3.ToLower(CultureInfo.InvariantCulture))
                        {
                            builtObjectSubRole = (BuiltObjectSubRole)Enum.Parse(typeof(BuiltObjectSubRole), text3, ignoreCase: true);
                            break;
                        }
                    }
                    if (builtObjectSubRole == BuiltObjectSubRole.Undefined)
                    {
                        continue;
                    }
                    if (text2.Length > num2)
                    {
                        text2 = text2.Substring(num2 + 1, text2.Length - (num2 + 1));
                    }
                    if (!string.IsNullOrEmpty(text2) && text2.Length > 0)
                    {
                        string[] array = text2.Split(',');
                        if (array.Length == 1 && string.IsNullOrEmpty(array[0].Trim()))
                        {
                            array = new string[0];
                        }
                        for (int j = 0; j < array.Length; j++)
                        {
                            string text4 = (array[j] = array[j].Trim());
                        }
                        SubRoleNameList subRoleNameList = new SubRoleNameList(builtObjectSubRole);
                        subRoleNameList.Names.AddRange(array);
                        subRoleNameSet.SubRoleNames.Add(subRoleNameList);
                    }
                }
                streamReader.Close();
                fileStream.Close();
                return subRoleNameSet;
            }
            catch (ApplicationException)
            {
                throw;
            }
            catch (Exception)
            {
                throw new ApplicationException("Error at line " + num + " reading file " + text);
            }
        }

```

### Galaxy.4.cs line 374 — LoadAgentNames
```csharp
        public void LoadAgentNames(string applicationStartupPath, string customizationSetName)
        {
            int num = 0;
            string text = applicationStartupPath + "\\characterNames.txt";
            if (!string.IsNullOrEmpty(customizationSetName) && customizationSetName.ToLower(CultureInfo.InvariantCulture) != "default")
            {
                text = applicationStartupPath + "\\Customization\\" + customizationSetName + "\\characterNames.txt";
            }
            if (!File.Exists(text))
            {
                text = applicationStartupPath + "\\characterNames.txt";
            }
            try
            {
                if (!File.Exists(text))
                {
                    throw new ApplicationException("Missing file: " + text);
                }
                FileStream fileStream = File.OpenRead(text);
                StreamReader streamReader = new StreamReader(fileStream);
                for (int i = 0; i < RaceFamilies.Count; i++)
                {
                    string[] item = GetValidFileLine(streamReader).Replace(" ", "").Split(',');
                    string[] item2 = GetValidFileLine(streamReader).Replace(" ", "").Split(',');
                    _AgentFirstNames.Add(item);
                    _AgentLastNames.Add(item2);
                }
                streamReader.Close();
                fileStream.Close();
            }
            catch (ApplicationException)
            {
                throw;
            }
            catch (Exception)
            {
                throw new ApplicationException("Error at line " + num + " reading file " + text);
            }
        }

```

### Galaxy.4.cs line 3371 — LoadDesignNames
```csharp
        public void LoadDesignNames(string applicationStartupPath, string customizationSetName)
        {
            int num = 0;
            string text = applicationStartupPath + "\\designNames.txt";
            if (!string.IsNullOrEmpty(customizationSetName) && customizationSetName.ToLower(CultureInfo.InvariantCulture) != "default")
            {
                text = applicationStartupPath + "\\Customization\\" + customizationSetName + "\\designNames.txt";
            }
            if (!File.Exists(text))
            {
                text = applicationStartupPath + "\\designNames.txt";
            }
            try
            {
                if (!File.Exists(text))
                {
                    throw new ApplicationException("Missing file: " + text);
                }
                FileStream fileStream = File.OpenRead(text);
                StreamReader streamReader = new StreamReader(fileStream);
                while (!streamReader.EndOfStream)
                {
                    num++;
                    List<string> list = new List<string>();
                    string text2 = streamReader.ReadLine();
                    if (string.IsNullOrEmpty(text2) || !(text2.Trim() != string.Empty) || !(text2.Trim().Substring(0, 1) != "'"))
                    {
                        continue;
                    }
                    int num2 = 0;
                    int num3 = 0;
                    while (num3 >= 0)
                    {
                        num3 = text2.IndexOf(",", num2);
                        string empty = string.Empty;
                        empty = ((num3 < 0) ? text2.Substring(num2, text2.Length - num2) : text2.Substring(num2, num3 - num2));
                        empty = empty.Trim();
                        if (!string.IsNullOrEmpty(empty))
                        {
                            list.Add(empty);
                        }
                        num2 = num3 + 1;
                    }
                    if (list.Count == 0)
                    {
                        throw new ApplicationException("No design names at line " + num + " in file " + text);
                    }
                    _DesignNames.Add(list.ToArray());
                }
                streamReader.Close();
                fileStream.Close();
            }
            catch (ApplicationException)
            {
                throw;
            }
            catch (Exception)
            {
                throw new ApplicationException("Error at line " + num + " reading file " + text);
            }
            if (_DesignNames.Count < 14)
            {
                throw new ApplicationException("Must be at least 14 design name families in designs.txt");
            }
        }

```

### EmpirePolicy.cs line 229 — EmpirePolicy.LoadFromFile
```csharp
    public void LoadFromFile(string filePath)
    {
      try
      {
        string str1 = ";";
        using (FileStream fileStream = new FileStream(filePath, FileMode.Open, FileAccess.Read))
        {
          using (StreamReader streamReader = new StreamReader((Stream) fileStream))
          {
            while (!streamReader.EndOfStream)
            {
              string str2 = streamReader.ReadLine();
              if (!string.IsNullOrEmpty(str2) && str2.Trim() != string.Empty && str2.Trim().Substring(0, 1) != "'")
              {
                int length = str2.IndexOf(str1);
                if (length >= 0)
                  this.SetNameValuePair(str2.Substring(0, length).Trim(), str2.Substring(length + 1, str2.Length - (length + 1)).Trim());
              }
            }
          }
        }
      }
      catch (Exception ex)
      {
      }
    }

```

### DesignSpecification.cs line 185 — DesignSpecification.LoadFromFile
```csharp
    public static DesignSpecification LoadFromFile(
      string applicationPath,
      string customPath,
      string subRoleName,
      BuiltObjectSubRole subRole,
      bool isMobile,
      Race race,
      bool isPirate,
      bool standAlone,
      string raceNameOverride)
    {
      if (race != null)
      {
        string str1 = ";";
        int num = 0;
        string str2 = applicationPath + "\\designTemplates\\" + raceNameOverride + "\\" + subRoleName + ".txt";
        string path1 = customPath + "designTemplates\\" + raceNameOverride + "\\" + subRoleName + ".txt";
        string path2 = applicationPath + "\\designTemplates\\" + raceNameOverride + "\\pirate\\" + subRoleName + ".txt";
        string path3 = customPath + "designTemplates\\" + raceNameOverride + "\\pirate\\" + subRoleName + ".txt";
        string path4 = str2;
        if (isPirate)
        {
          path4 = path2;
          if (!string.IsNullOrEmpty(customPath) && File.Exists(path3))
            path4 = path3;
          else if (!File.Exists(path2))
            path4 = str2;
        }
        else if (!string.IsNullOrEmpty(customPath) && File.Exists(path1))
          path4 = path1;
        DesignSpecification designSpecification = new DesignSpecification(subRole, isMobile);
        if (File.Exists(path4))
        {
          designSpecification.ComponentRules.Add(new DesignSpecificationComponentRule(DesignSpecificationComponentRuleType.MustHave, ComponentType.ComputerCommandCenter, 1));
          if (isMobile)
            designSpecification.ComponentRules.Add(new DesignSpecificationComponentRule(DesignSpecificationComponentRuleType.MustHave, ComponentCategoryType.HyperDrive, 1));
          using (FileStream fileStream = new FileStream(path4, FileMode.Open, FileAccess.Read))
          {
            using (StreamReader streamReader = new StreamReader((Stream) fileStream))
            {
              while (!streamReader.EndOfStream)
              {
                string str3 = streamReader.ReadLine();
                ++num;
                if (!string.IsNullOrEmpty(str3) && str3.Trim() != string.Empty && str3.Trim().Substring(0, 1) != "'")
                {
                  int length = str3.IndexOf(str1);
                  if (length >= 0)
                  {
                    string str4 = str3.Substring(0, length).Trim();
                    string s = str3.Substring(length + 1, str3.Length - (length + 1)).Trim();
                    if (str4.ToLower(CultureInfo.InvariantCulture) == "tacticsweaker")
                    {
                      BattleTactics battleTactics = BattleTactics.Undefined;
                      switch (s.Trim().ToLower(CultureInfo.InvariantCulture))
                      {
                        case "evade":
                          battleTactics = BattleTactics.Evade;
                          break;
                        case "standoff":
                          battleTactics = BattleTactics.Standoff;
                          break;
                        case "allweapons":
                          battleTactics = BattleTactics.AllWeapons;
                          break;
                        case "pointblank":
                          battleTactics = BattleTactics.PointBlank;
                          break;
                      }
                      designSpecification.TacticsWeaker = battleTactics;
                    }
                    else if (str4.ToLower(CultureInfo.InvariantCulture) == "tacticsstronger")
                    {
                      BattleTactics battleTactics = BattleTactics.Undefined;
                      switch (s.Trim().ToLower(CultureInfo.InvariantCulture))
                      {
                        case "evade":
                          battleTactics = BattleTactics.Evade;
                          break;
                        case "standoff":
                          battleTactics = BattleTactics.Standoff;
                          break;
                        case "allweapons":
                          battleTactics = BattleTactics.AllWeapons;
                          break;
                        case "pointblank":
                          battleTactics = BattleTactics.PointBlank;
                          break;
                      }
                      designSpecification.TacticsStronger = battleTactics;
                    }
                    else if (str4.ToLower(CultureInfo.InvariantCulture) == "tacticsinvasion")
                    {
                      InvasionTactics invasionTactics = InvasionTactics.Undefined;
                      switch (s.Trim().ToLower(CultureInfo.InvariantCulture))
                      {
                        case "donotinvade":
                          invasionTactics = InvasionTactics.DoNotInvade;
                          break;
                        case "invadewhenclear":
                          invasionTactics = InvasionTactics.InvadeWhenClear;
                          break;
                        case "invadeimmediately":
                          invasionTactics = InvasionTactics.InvadeImmediately;
                          break;
                      }
                      designSpecification.TacticsInvasion = invasionTactics;
                    }
                    else if (str4.ToLower(CultureInfo.InvariantCulture) == "fleewhen")
                    {
                      BuiltObjectFleeWhen builtObjectFleeWhen = BuiltObjectFleeWhen.Undefined;
                      switch (s.Trim().ToLower(CultureInfo.InvariantCulture))
                      {
                        case "enemymilitarysighted":
                          builtObjectFleeWhen = BuiltObjectFleeWhen.EnemyMilitarySighted;
                          break;
                        case "attacked":
                          builtObjectFleeWhen = BuiltObjectFleeWhen.Attacked;
                          break;
                        case "shields50":
                          builtObjectFleeWhen = BuiltObjectFleeWhen.Shields50;
                          break;
                        case "shields20":
                          builtObjectFleeWhen = BuiltObjectFleeWhen.Shields20;
                          break;
                        case "armor50":
                          builtObjectFleeWhen = BuiltObjectFleeWhen.Armor50;
                          break;
                        case "never":
                          builtObjectFleeWhen = BuiltObjectFleeWhen.Never;
                          break;
                      }
                      designSpecification.FleeWhen = builtObjectFleeWhen;
                    }
                    else if (str4.ToLower(CultureInfo.InvariantCulture) == "imagescaling")
                    {
                      float result = 1f;
                      string str5 = "absolute";
                      string str6 = "scaled";
                      DesignImageScalingMode imageScalingMode;
                      if (s.ToLower(CultureInfo.InvariantCulture).StartsWith(str5))
                      {
                        imageScalingMode = DesignImageScalingMode.Absolute;
                        if (!float.TryParse(s.Substring(str5.Length, s.Length - str5.Length).Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out result))
                          throw new ApplicationException("Error reading Image Scaling Factor in line " + num.ToString() + " of file " + path4);
                        if ((double) result < 10.0 || (double) result > 1000.0)
                          throw new ApplicationException("Invalid Image Scaling Factor (when mode is Absolute should be between 10 and 1000) in line " + num.ToString() + " of file " + path4);
                      }
                      else
                      {
                        if (!s.ToLower(CultureInfo.InvariantCulture).StartsWith(str6))
                          throw new ApplicationException("Invalid Image Scaling Mode (should be Absolute or Scaled) in line " + num.ToString() + " of file " + path4);
                        imageScalingMode = DesignImageScalingMode.Scaled;
                        if (!float.TryParse(s.Substring(str6.Length, s.Length - str6.Length).Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out result))
                          throw new ApplicationException("Error reading Image Scaling Factor in line " + num.ToString() + " of file " + path4);
                        if ((double) result < 0.05000000074505806 || (double) result > 10.0)
                          throw new ApplicationException("Invalid Image Scaling Factor (when mode is Scaled should be between 0.05 and 10.0) in line " + num.ToString() + " of file " + path4);
                      }
                      designSpecification.ImageScalingMode = imageScalingMode;
                      designSpecification.ImageScalingFactor = result;
                    }
                    else
                    {
                      int result = 0;
                      if (int.TryParse(s, out result) && result > 0)
                      {
                        ComponentType type = ComponentType.Undefined;
                        ComponentCategoryType category = ComponentCategoryType.Undefined;
                        DesignSpecification.ResolveComponentTypeFromName(str4.ToLower(CultureInfo.InvariantCulture), out type, out category);
                        if (type != ComponentType.ComputerCommandCenter && category != ComponentCategoryType.HyperDrive)
                        {
                          if (type != ComponentType.Undefined)
                            designSpecification.ComponentRules.Add(new DesignSpecificationComponentRule(DesignSpecificationComponentRuleType.MustHave, type, result));
                          else if (category != ComponentCategoryType.Undefined)
                            designSpecification.ComponentRules.Add(new DesignSpecificationComponentRule(DesignSpecificationComponentRuleType.MustHave, category, result));
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        else
          designSpecification = !standAlone ? Galaxy.DesignSpecifications.GetBySubRole(subRole) : (DesignSpecification) null;
        return designSpecification;
      }
      return standAlone ? (DesignSpecification) null : Galaxy.DesignSpecifications.GetBySubRole(subRole);
    }

```
