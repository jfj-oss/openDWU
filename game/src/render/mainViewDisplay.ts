// The Main View display type: Main.int_34 (Main.cs 3035), cycled by the D key (Main.Part7.cs Main_KeyUp
// CycleMainDisplayTypes → Main.Part6.cs:3069 btnMainViewDisplayToggle_Click; the button itself is created hidden,
// Main.InitializeComponent.cs 7636 Visible = false). A view setting of the running Main form: not saved, not sim state.
//
// What the draw code gates on it (MainView.1.cs, the XNA path; MainView.cs has the same tests in its GDI twin):
//   int_34 < 1  the battle bars at f <= 3: the shield bar (method_194) and the boarding / assault bar (method_195) of a
//               ship in battle (1253), a fighter's shield bar (1542)            → here: render/combatBars.ts
//   int_34 < 2  a habitat's owner circle at f < 100 (792)                       → render/empireLayer.ts colony rings
//               a ship's role symbol in the per-ship pass (1080)                → render/galaxyMarkers.ts (f < 150)
//               the fleet-leader badge (method_191, 1290)                       → not drawn by the port (parity #8)
//               the habitat labels / colony info images (flag11-13, 1826 / 1891) → render/mainView.ts body labels
// So 0 = everything, 1 = no battle bars, 2 = the bare view.
// No DOM / Pixi imports.

export type MainViewDisplayType = 0 | 1 | 2;

let displayType: MainViewDisplayType = 0;

/** Main.int_34. */
export function mainViewDisplayType(): MainViewDisplayType {
    return displayType;
}

/** Test / teardown hook. */
export function setMainViewDisplayType(t: MainViewDisplayType): void {
    displayType = t;
}

/** Port of Main.Part6.cs:3069 btnMainViewDisplayToggle_Click: 0 → 1 → 2 → 0 (any other value → 0). */
export function nextMainViewDisplayType(t: number): MainViewDisplayType {
    switch (t) {
        case 0:
            return 1;
        case 1:
            return 2;
        default:
            return 0;
    }
}

/** The D key: advance int_34 and return the new value. */
export function cycleMainViewDisplayType(): MainViewDisplayType {
    displayType = nextMainViewDisplayType(displayType);
    return displayType;
}

/** `main_0.int_34 < 1`: the battle bars are drawn. */
export function showsBattleBars(t: number = displayType): boolean {
    return t < 1;
}

/** `main_0.int_34 < 2`: owner circles, per-ship symbols and habitat labels are drawn. */
export function showsMapIndicators(t: number = displayType): boolean {
    return t < 2;
}
