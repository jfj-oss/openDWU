# Task 06l — Tutorials (list screen + in-game tutorial window)

thinking: off
scope: locked

Everything you need is below. Create `src/sim/data/tutorials.ts` (parser), `src/ui/screens/tutorials.ts` (+css), tests; wire the main menu's Tutorials item (`src/ui/screens/mainMenu.ts`, one call). Do not edit other src/sim files, the HUD, overlays, the Galactopedia or save/load. Start editing right away. Do not Read image files.

Tutorial files (served at `/assets/dwu/Tutorial/<file>`): DealingWithPirates.txt, EmpireAndColonies.txt, ExpansionDiplomacy.txt, FindingYourWayAround.txt, FleetsTroops.txt, PlayAsPirate.txt, PreWarpEmpire.txt, ResearchDesign.txt, ShipsAndMissions.txt, advanced.txt, basic.txt. Format (see the sample in the C# loader below): steps separated by a line `~`; each step = title line, a second title/key line, then body text.
- Parser port of the C# `Tutorial`/`TutorialItem` loading below (same fields/semantics) + tests on all real files (step counts > 0, first step title "Welcome" for advanced.txt).
- **Tutorials screen** (from the main menu): list of tutorials with their display names from the C# (the order/names the original uses — see the menu code below), a short description, and **Start**. Start launches a game with default options via the existing `startGameView` path and opens the tutorial window.
- **Tutorial window** (in game): draggable panel (modern HUD style) showing the step title + body, **Continue →** / **← Back** / **Close**, step counter `3 / 17`. Steps whose original behaviour highlights/opens game UI: show the text only and leave `// TODO(tutorial): <what the C# does>`.
`npm run typecheck` && `npm test`; save (don't open) `shots/06l-tutorials.png` (`?screen=tutorials`). Append `## Worker report`.

## Tutorial.cs
```csharp
// Decompiled with JetBrains decompiler
// Type: DistantWorlds.Types.Tutorial
// Assembly: DistantWorlds, Version=1.9.5.12, Culture=neutral, PublicKeyToken=null
// MVID: DFB67E2D-B390-4FC8-9690-CA3C0824704F
// Assembly location: F:\SteamLibrary\steamapps\common\Distant Worlds Universe\DistantWorlds - Copy-Unpacked.exe

using System;

namespace DistantWorlds.Types
{
    [Serializable]
    public class Tutorial
    {
        private string string_0;

        private int int_0;

        private TutorialItemList tutorialItemList_0;

        public string Name
        {
            get
            {
                return string_0;
            }
            set
            {
                string_0 = value;
            }
        }

        public int Index
        {
            get
            {
                return int_0;
            }
            set
            {
                int_0 = value;
            }
        }

        public TutorialItemList Items
        {
            get
            {
                return tutorialItemList_0;
            }
            set
            {
                tutorialItemList_0 = value;
            }
        }

        public bool LastStep
        {
            get
            {
                if (int_0 == tutorialItemList_0.Count - 1)
                {
                    return true;
                }
                return false;
            }
        }

        public bool Finished
        {
            get
            {
                if (int_0 >= tutorialItemList_0.Count)
                {
                    return true;
                }
                return false;
            }
        }

        public TutorialItem PreviousStep
        {
            get
            {
                if (tutorialItemList_0.Count > 1 && int_0 <= tutorialItemList_0.Count && int_0 >= 0)
                {
                    return tutorialItemList_0[int_0];
                }
                return null;
            }
        }

        public TutorialItem CurrentStep
        {
            get
            {
                if (int_0 < tutorialItemList_0.Count)
                {
                    return tutorialItemList_0[int_0];
                }
                return null;
            }
        }

        public void ClearData()
        {
            if (tutorialItemList_0 != null)
            {
                tutorialItemList_0.Clear();
            }
        }

        public void Next()
        {
            int_0++;
        }

        public Tutorial():base()
        {
            
            tutorialItemList_0 = new TutorialItemList();
        }
    }

}
```
## TutorialItem.cs
```csharp
// Decompiled with JetBrains decompiler
// Type: DistantWorlds.Types.TutorialItem
// Assembly: DistantWorlds, Version=1.9.5.12, Culture=neutral, PublicKeyToken=null
// MVID: DFB67E2D-B390-4FC8-9690-CA3C0824704F
// Assembly location: F:\SteamLibrary\steamapps\common\Distant Worlds Universe\DistantWorlds - Copy-Unpacked.exe

using DistantWorlds.Controls;
using System;

namespace DistantWorlds.Types
{
  [Serializable]
  public class TutorialItem
  {
    private string string_0;
    private string string_1;
    private string string_2;
    private object object_0;
    private bool bool_0;
    private bool bool_1;
    private bool bool_2;
    private bool bool_3;
    private bool bool_4;
    private object object_1;
    private double double_0;
    private object object_2;
    private BorderPanel borderPanel_0;
    private string string_3;
    private object object_3;
    public int HighlightActionButtonNumber;
    public bool UnpauseGame;
    public string HighlightEmpireNavigationToolPanelTitle;

    public string Name
    {
      get => this.string_0;
      set => this.string_0 = value;
    }

    public string Title
    {
      get => this.string_1;
      set => this.string_1 = value;
    }

    public string Text
    {
      get => this.string_2;
      set => this.string_2 = value;
    }

    public object HighlightObject
    {
      get => this.object_0;
      set => this.object_0 = value;
    }

    public bool HighlightHabitatEmpire
    {
      get => this.bool_0;
      set => this.bool_0 = value;
    }

    public bool HighlightHabitatPopulationGraph
    {
      get => this.bool_1;
      set => this.bool_1 = value;
    }

    public bool HighlightHabitatDominantRace
    {
      get => this.bool_2;
      set => this.bool_2 = value;
    }

    public bool HighlightHabitatResources
    {
      get => this.bool_3;
      set => this.bool_3 = value;
    }

    public bool HighlightOpenEmpireNavigationToolPanel
    {
      get => this.bool_4;
      set => this.bool_4 = value;
    }

    public object ZoomScrollObject
    {
      get => this.object_1;
      set => this.object_1 = value;
    }

    public double ZoomLevel
    {
      get => this.double_0;
      set => this.double_0 = value;
    }

    public object SelectionObject
    {
      get => this.object_2;
      set => this.object_2 = value;
    }

    public BorderPanel OpenScreen
    {
      get => this.borderPanel_0;
      set => this.borderPanel_0 = value;
    }

    public string ScreenTabName
    {
      get => this.string_3;
      set => this.string_3 = value;
    }

    public object ListSelection
    {
      get => this.object_3;
      set => this.object_3 = value;
    }

    public TutorialItem():base()
    {
      
      // ISSUE: explicit constructor call
    }
  }
}
```
## Main.Part5.cs 31–170 (tutorial loading / starting)
```csharp
using DistantWorlds.Controls;
using DistantWorlds.Types;
using Ionic.Zlib;
using Microsoft.VisualBasic.Devices;
using Microsoft.Xna.Framework.Graphics;
//using SlimDX.DirectSound;
using ExpansionMod.HotKeyMapping;
using ExpansionMod.Objects;
using System.Collections.Concurrent;

namespace DistantWorlds {

  public partial class Main {


        private TutorialItemList method_454(string string_30)
        {
            TutorialItemList tutorialItemList = new TutorialItemList();
            int num = 0;
            string path = Application.StartupPath + "\\Tutorial\\" + string_30;
            if (!File.Exists(path))
            {
                path = Application.StartupPath + "\\Tutorial\\DE_" + string_30;
                if (!File.Exists(path))
                {
                    path = Application.StartupPath + "\\Tutorial\\FR_" + string_30;
                    if (!File.Exists(path))
                    {
                        path = Application.StartupPath + "\\Tutorial\\ES_" + string_30;
                    }
                }
            }
            try
            {
                if (!File.Exists(path))
                {
                    throw new ApplicationException("Missing file: " + string_30);
                }
                FileStream fileStream = File.OpenRead(path);
                StreamReader streamReader = new StreamReader(fileStream);
                TutorialItem tutorialItem = null;
                bool flag = true;
                while (!streamReader.EndOfStream)
                {
                    num++;
                    string text = streamReader.ReadLine();
                    if (flag)
                    {
                        if (tutorialItem != null)
                        {
                            tutorialItemList.Add(tutorialItem);
                        }
                        tutorialItem = new TutorialItem();
                        tutorialItem.Name = text.Trim();
                        if (!streamReader.EndOfStream)
                        {
                            text = streamReader.ReadLine();
                            tutorialItem.Title = text.Trim();
                        }
                        flag = false;
                    }
                    else if (text.Trim() == "~")
                    {
                        flag = true;
                    }
                    else
                    {
                        TutorialItem tutorialItem2 = tutorialItem;
                        tutorialItem2.Text = tutorialItem2.Text + text + "\n";
                    }
                }
                if (tutorialItem != null)
                {
                    tutorialItemList.Add(tutorialItem);
                }
                streamReader.Close();
                fileStream.Close();
                return tutorialItemList;
            }
            catch (ApplicationException)
            {
                throw;
            }
            catch (Exception)
            {
                throw new ApplicationException("Error at line " + num + " reading file " + string_30);
            }
        }

        private void method_455()
        {
            if (tutorial_0.LastStep)
            {
                method_155();
                btnTutorialContinue.Text = TextResolver.GetText("Play This Game");
                btnTutorialContinue.Location = new Point(btnTutorialContinue.Left + btnTutorialContinue.Width / 2 + 5, btnTutorialContinue.Top - 15);
                btnTutorialContinue.Size = new Size(btnTutorialContinue.Width / 2 - 5, btnTutorialContinue.Height + 15);
                btnTutorialExit.Location = new Point(btnTutorialExit.Left, btnTutorialExit.Top - 15);
                btnTutorialExit.Size = new Size(btnTutorialExit.Width, btnTutorialExit.Height + 15);
                btnTutorialExit.Visible = true;
            }
            else if (tutorial_0.CurrentStep.UnpauseGame)
            {
                method_155();
            }
            else
            {
                method_154();
            }
            lblTutorialTitle.Enabled = true;
            lblTutorialText.Enabled = true;
            lblTutorialTitle.Text = TextResolver.GetText("Tutorial") + ": " + tutorial_0.CurrentStep.Title;
            lblTutorialText.Text = tutorial_0.CurrentStep.Text;
            lblTutorialTitle.Enabled = false;
            lblTutorialText.Enabled = false;
            if (tutorial_0.PreviousStep != null && tutorial_0.PreviousStep.OpenScreen != null)
            {
                tutorial_0.PreviousStep.OpenScreen.HighlightControls = null;
            }
            if (tutorial_0.CurrentStep.ZoomScrollObject != null)
            {
                if (tutorial_0.CurrentStep.ZoomScrollObject is ShipGroup)
                {
                    ShipGroup shipGroup = (ShipGroup)tutorial_0.CurrentStep.ZoomScrollObject;
                    mainView.method_2(shipGroup.LeadShip.Xpos, shipGroup.LeadShip.Ypos, tutorial_0.CurrentStep.ZoomLevel);
                }
                else if (tutorial_0.CurrentStep.ZoomScrollObject is BuiltObject)
                {
                    BuiltObject builtObject = (BuiltObject)tutorial_0.CurrentStep.ZoomScrollObject;
                    mainView.method_2(builtObject.Xpos, builtObject.Ypos, tutorial_0.CurrentStep.ZoomLevel);
                }
                else if (tutorial_0.CurrentStep.ZoomScrollObject is Habitat)
                {
                    Habitat habitat = (Habitat)tutorial_0.CurrentStep.ZoomScrollObject;
                    mainView.method_2(habitat.Xpos, habitat.Ypos, tutorial_0.CurrentStep.ZoomLevel);
                }
                else if (tutorial_0.CurrentStep.ZoomScrollObject is SystemInfo)
                {
                    SystemInfo systemInfo = (SystemInfo)tutorial_0.CurrentStep.ZoomScrollObject;
                    mainView.method_2(systemInfo.SystemStar.Xpos, systemInfo.SystemStar.Ypos, tutorial_0.CurrentStep.ZoomLevel);
```
