// Port of Main.Part12.cs MainInit(width, height, windowedMode) lines 1498–2232:
// the control positions/sizes it computes for the main-view HUD. Pure function
// (no DOM/Pixi): returns a rect per original control name. `mainView.Size` /
// `mainView.Width` / `mainView.Height` in the C# are the width/height args.
// Font/image/visibility/event code and SetCornerCurves calls are ignored; only
// Location/Size assignments are ported, in the original order (later
// assignments override earlier ones).

export interface Rect { x: number; y: number; w: number; h: number }

export function computeHudLayout(width: number, height: number): Record<string, Rect> {
    const layout: Record<string, Rect> = {};

    // Helper mirroring the C#: set Size first, then Location (or vice versa),
    // with later writes overriding earlier ones.
    const place = (name: string, x: number, y: number, w?: number, h?: number): void => {
        const prev = layout[name];
        layout[name] = {
            x,
            y,
            w: w ?? prev?.w ?? 0,
            h: h ?? prev?.h ?? 0,
        };
    };
    const size = (name: string, w: number, h: number): void => {
        const prev = layout[name];
        layout[name] = {
            x: prev?.x ?? 0,
            y: prev?.y ?? 0,
            w,
            h,
        };
    };

    // int num = 64; int num2 = 80; int num3 = (rectangle.Width - 700) / 2;
    const num3 = Math.floor((width - 700) / 2);

    size('btnHistoryMessages', 32, 48);
    size('btnGalacticHistory', 32, 32);
    place('btnHistoryMessages', num3 + 668, 10);
    place('btnGalacticHistory', num3 + 668, 58);

    size('lstMessages', 668, 80);
    place('lstMessages', num3, 10);

    // int num4 = (rectangle.Width - 624) / 2;
    const num4 = Math.floor((width - 624) / 2);

    size('tbtnColonies', 32, 32);
    size('btnExpansionPlanner', 32, 32);
    size('btnEmpireGraphs', 32, 32);
    size('btnEmpirePolicy', 32, 32);
    size('btnGameEditor', 32, 32);
    size('btnBuildOrder', 32, 32);
    size('tbtnConstructionYards', 32, 32);
    size('tbtnBuiltObjects', 32, 32);
    size('tbtnShipGroups', 32, 32);
    size('tbtnTroops', 32, 32);
    size('tbtnIntelligenceAgents', 32, 64);
    size('tbtnEmpires', 80, 64);
    size('btnEmpireSummary', 80, 64);
    size('tbtnResearch', 80, 64);
    size('tbtnDesigns', 32, 64);

    // int num5 = num4; then sequential += per button width.
    let num5 = num4;
    place('tbtnColonies', num5, 90);
    num5 += 32;
    place('btnExpansionPlanner', num5, 90);
    num5 += 32;
    place('btnEmpireGraphs', num5, 90);
    num5 += 32;
    place('btnEmpirePolicy', num5, 90);
    num5 += 32;
    place('btnGameEditor', num5, 90);
    num5 += 32;
    place('tbtnIntelligenceAgents', num5, 90);
    num5 += 32;
    place('tbtnEmpires', num5, 90);
    num5 += 80;
    place('btnEmpireSummary', num5, 90);
    num5 += 80;
    place('tbtnResearch', num5, 90);
    num5 += 80;
    place('tbtnDesigns', num5, 90);
    num5 += 32;
    place('btnBuildOrder', num5, 90);
    num5 += 32;
    place('tbtnConstructionYards', num5, 90);
    num5 += 32;
    place('tbtnBuiltObjects', num5, 90);
    num5 += 32;
    place('tbtnShipGroups', num5, 90);
    num5 += 32;
    place('tbtnTroops', num5, 90);
    num5 += 32;

    size('btnGameMenu', 40, 40);
    place('btnGameMenu', 10, 10);
    size('btnHelp', 40, 40);
    place('btnHelp', 50, 10);
    size('btnPlayPause', 80, 34);
    place('btnPlayPause', 10, 62);
    size('btnGameSpeedDecrease', 40, 20);
    place('btnGameSpeedDecrease', 10, 96);
    size('btnGameSpeedIncrease', 40, 20);
    place('btnGameSpeedIncrease', 50, 96);

    size('pnlDetailInfo', 280, 240);
    place('pnlDetailInfo', 44, 5);
    // pnlInfoPanel.Location.Y uses pnlDetailInfo.Size.Height (240).
    size('pnlInfoPanel', 370, 250);
    place('pnlInfoPanel', 26, height - (240 + 50));
    size('pnlDetailInfoShipGroup', 240, 240);
    place('pnlDetailInfoShipGroup', 20, height - (240 + 20));
    size('pnlHabitatInfo', 240, 240);
    place('pnlHabitatInfo', 20, height - (240 + 20));
    size('pnlColonyHabitatInfo', 240, 240);
    place('pnlColonyHabitatInfo', 20, height - (240 + 20));
    size('pnlBuiltObjectDetail', 240, 240);
    place('pnlBuiltObjectDetail', 20, height - (240 + 20));

    // int num6 = mainView.Size.Height - (pnlDetailInfo.Height + 45) + 1;
    const num6 = height - (240 + 45) + 1;
    place('btnCycleColoniesBack', 10, num6 + 30);
    place('btnCycleBasesBack', 10, num6 + 60);
    place('btnCycleMilitaryBack', 10, num6 + 90);
    place('btnCycleConstructionBack', 10, num6 + 120);
    place('btnCycleOtherBack', 10, num6 + 150);
    place('btnCycleShipGroupsBack', 10, num6 + 180);
    place('btnCycleIdleShipsBack', 10, num6 + 210);
    place('btnSelectionPanelSize', 353, num6 - 36);
    place('btnSelectNearestMilitary', 353, num6);
    place('btnCycleColonies', 353, num6 + 30);
    place('btnCycleBases', 353, num6 + 60);
    place('btnCycleMilitary', 353, num6 + 90);
    place('btnCycleConstruction', 353, num6 + 120);
    place('btnCycleOther', 353, num6 + 150);
    place('btnCycleShipGroups', 353, num6 + 180);
    place('btnCycleIdleShips', 353, num6 + 210);
    place('btnCycleShipStance', 353, num6 + 240);
    size('btnCycleShipStance', 56, 28);

    size('btnSelectionAction1', 35, 28);
    size('btnSelectionAction2', 35, 28);
    size('btnSelectionAction3', 35, 28);
    size('btnSelectionAction4', 35, 28);
    size('btnSelectionAction5', 35, 28);
    size('btnSelectionAction6', 35, 28);
    size('btnSelectionAction7', 35, 28);
    size('btnSelectionAction8', 35, 28);
    // int num7 = pnlInfoPanel.Bottom + 2; (Bottom = y + h = height - 290 + 250 + 2)
    const num7 = height - 290 + 250 + 2;
    place('btnSelectionAction1', 70, num7);
    place('btnSelectionAction2', 105, num7);
    place('btnSelectionAction3', 140, num7);
    place('btnSelectionAction4', 175, num7);
    place('btnSelectionAction5', 210, num7);
    place('btnSelectionAction6', 245, num7);
    place('btnSelectionAction7', 280, num7);
    place('btnSelectionAction8', 315, num7);

    size('btnSelectionBack', 138, 28);
    size('btnSelectionForward', 138, 28);
    place('btnSelectionBack', 71, num6 - 36);
    place('btnSelectionForward', 213, num6 - 36);
    place('btnLockView', 10, num6);

    size('pnlSystemMap', 330, 290);
    size('picSystem', 280, 280);

    // num6 = mainView.Size.Height - (pnlSystemMap.Height + 7) + 1;
    const num6b = height - (290 + 7) + 1;
    // TODO(size): btnZoomSelection — size not set anywhere in this excerpt.
    place('btnZoomSelection', width - (280 + (layout['btnZoomSelection']?.w ?? 0) + 17), num6b);
    // TODO(size): btnZoomIn — size not set anywhere in this excerpt.
    place('btnZoomIn', width - (280 + (layout['btnZoomIn']?.w ?? 0) + 17), num6b + 30);
    // TODO(size): btnZoomOut — size not set anywhere in this excerpt.
    place('btnZoomOut', width - (280 + (layout['btnZoomOut']?.w ?? 0) + 17), num6b + 60);
    // TODO(size): btnZoomColony — size not set anywhere in this excerpt.
    place('btnZoomColony', width - (280 + (layout['btnZoomColony']?.w ?? 0) + 17), num6b + 90);
    // TODO(size): btnZoomSystem — size not set anywhere in this excerpt.
    place('btnZoomSystem', width - (280 + (layout['btnZoomSystem']?.w ?? 0) + 17), num6b + 120);
    // TODO(size): jQaYpdpkDs — size not set anywhere in this excerpt.
    place('jQaYpdpkDs', width - (280 + (layout['jQaYpdpkDs']?.w ?? 0) + 17), num6b + 150);
    // TODO(size): btnZoomRegion — size not set anywhere in this excerpt.
    place('btnZoomRegion', width - (280 + (layout['btnZoomRegion']?.w ?? 0) + 17), num6b + 180);
    // tbtnGalaxyMap.Size = new Size(btnZoomColony.Width, 40);
    size('tbtnGalaxyMap', layout['btnZoomColony']?.w ?? 0, 40);
    place('tbtnGalaxyMap', width - (280 + (layout['btnZoomRegion']?.w ?? 0) + 17), num6b + 240);
    // pnlSystemMap flush to bottom-right with a 10 px margin.
    place('pnlSystemMap', width - (330 + 10), height - (290 + 10));
    place('picSystem', 45, 5);

    size('btnMapCivilianFade', 35, 28);
    size('btnMapOverlay1', 35, 28);
    size('btnMapOverlay2', 35, 28);
    size('btnMapOverlay3', 35, 28);
    size('btnMapOverlay4', 35, 28);
    size('btnMapOverlay5', 35, 28);
    size('btnMapOverlay6', 35, 28);
    size('btnMapOverlay7', 35, 28);
    size('btnMapOverlay8', 35, 28);
    // int num8 = mainView.Size.Width - (pnlSystemMap.Size.Width + 10) + 11;
    let num8 = width - (330 + 10) + 11;
    // int num9 = mainView.Size.Height - (pnlSystemMap.Size.Height + 10) - 29;
    const num9 = height - (290 + 10) - 29;
    place('btnMapCivilianFade', num8, num9);
    num8 += 35;
    place('btnMapOverlay1', num8, num9);
    num8 += 35;
    place('btnMapOverlay2', num8, num9);
    num8 += 35;
    place('btnMapOverlay3', num8, num9);
    num8 += 35;
    place('btnMapOverlay4', num8, num9);
    num8 += 35;
    place('btnMapOverlay5', num8, num9);
    num8 += 35;
    place('btnMapOverlay6', num8, num9);
    num8 += 35;
    place('btnMapOverlay7', num8, num9);
    num8 += 35;
    place('btnMapOverlay8', num8, num9);
    num8 += 35;

    // Labels: sizes never set in this excerpt.
    // TODO(size): lblStarDate — size not set anywhere in this excerpt.
    place('lblStarDate', 10, 10);
    // TODO(size): lblSystemName — size not set anywhere in this excerpt.
    place('lblSystemName', 10, 35);
    // TODO(size): lblStateMoney — size not set anywhere in this excerpt.
    place('lblStateMoney', width - 95, 10);
    // TODO(size): lblPrivateMoney — size not set anywhere in this excerpt.
    place('lblPrivateMoney', width - 95, 35);
    // TODO(size): lblGodData — size not set anywhere in this excerpt.
    place('lblGodData', 10, 180);

    return layout;
}