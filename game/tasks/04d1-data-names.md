# Task 04d1 — Data: name lists

thinking: off
scope: locked

Everything you need is in this file. Edit only `src/sim/data/` (new module named below), `src/sim/data/gameData.ts` (register it), `test/helpers/loadGameDataFs.ts` and a new test file. No other files. Start editing right away; do not try to read other source.

Module `src/sim/data/names.ts`: pure parsers (file text in) ported from the C# below for `colonyNames.txt`, `shipNames.txt` (→ SubRoleNameSet), `agentNames.txt`, `designNames.txt`. Tests on the real files (`public/assets/dwu/...` via fs): colony names > 100 entries; ship-name set has entries for at least 5 sub-roles; agent names non-empty.
`npm run typecheck` && `npm test`. Append `## Worker report`.

## C#
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
```csharp
// Decompiled with JetBrains decompiler
// Type: DistantWorlds.Types.SubRoleNameSet
// Assembly: DistantWorlds.Types, Version=1.9.5.12, Culture=neutral, PublicKeyToken=null
// MVID: C87DBA0E-BD3A-46BA-A8F0-EE9F5E5721E2
// Assembly location: H:\7\DistantWorlds.Types.dll

using System;
using System.Collections.Generic;

namespace DistantWorlds.Types
{
  [Serializable]
  public class SubRoleNameSet
  {
    private List<SubRoleNameList> _SubRoleNames = new List<SubRoleNameList>();

    public List<SubRoleNameList> SubRoleNames
    {
      get => this._SubRoleNames;
      set => this._SubRoleNames = value;
    }

    public List<string> GetNames(BuiltObjectSubRole subRole)
    {
      foreach (SubRoleNameList subRoleName in this._SubRoleNames)
      {
        if (subRoleName.SubRole == subRole)
          return subRoleName.Names;
      }
      return (List<string>) null;
    }
  }
}
```
