// Explosion screen shake: a big explosion jolts the Main View back and forth for a few frames.
//
// Sources (DistantWorlds/):
//   Controls/MainView.2.cs 2680 / 2718 / 2766 / 2811 (method_179 / 180 / GwpRjOqBrJa / 185) — when an explosion is
//       drawn for the first time (its sound plays: !ExplosionSoundPlayed) and ExplosionSize > 150:
//       main_0.method_217(Math.Min(ExplosionSize / 50, 8))
//   Main.Part10.cs 1847 method_217(amp) → method_218(amp, 7): int_20 = amplitude, int_19 = 7 frames
//   Main.Part10.cs 1858 method_219, called once per program-loop pass (Main.Part11.cs 737, end of ProcessMain, just
//       before DrawMainViewXna): while int_19 > 0 the offsets int_21 / vhadzRiecM flip between +amp and -amp and int_19
//       counts down; then both are 0
//   Controls/MainView.1.cs 64, 3225-3589, MainView.2.cs 670-2862 — every map pass draws at view centre
//       (int_13 + int_21, int_14 + vhadzRiecM): the offset is in WORLD units, so it moves the picture amp / zoom
//       factor screen px.
// Render only: the C# marks the explosion (ExplosionSoundPlayed); here the effects layer keeps its own seen-set.

/** Main.Part10.cs 1849: method_218(int_64, 7) — a shake lasts 7 program-loop passes (rendered frames). */
export const SHAKE_FRAMES = 7;
/** MainView.2.cs 2811: only explosions larger than this shake the view. */
export const SHAKE_MIN_EXPLOSION_SIZE = 150;
/** MainView.2.cs 2814: the amplitude is capped at 8 world units. */
export const SHAKE_MAX_AMPLITUDE = 8;

/** MainView.2.cs 2811-2815: the shake amplitude (world units) of a newly drawn explosion; 0 = none. */
export function explosionShakeAmplitude(explosionSize: number): number {
    if (!(explosionSize > SHAKE_MIN_EXPLOSION_SIZE)) return 0;
    return Math.min(Math.trunc(explosionSize / 50), SHAKE_MAX_AMPLITUDE);
}

/** Port of Main.Part10.cs method_218 / method_219: the shake state of one Main View. */
export class ScreenShake {
    /** int_20: the amplitude of the running shake. */
    private amplitude = 0;
    /** int_19: frames left. */
    private framesLeft = 0;
    /** int_21 / vhadzRiecM: this frame's view-centre offset, world units. */
    dx = 0;
    dy = 0;

    /** method_217(amp) → method_218(amp, 7): (re)start a shake; a newer explosion replaces the running one. */
    trigger(amplitude: number): void {
        if (amplitude <= 0) return;
        this.amplitude = amplitude;
        this.framesLeft = SHAKE_FRAMES;
    }

    /** method_219: once per frame, before the view is drawn. */
    step(): void {
        if (this.framesLeft > 0) {
            this.dx = this.dx === this.amplitude ? -this.amplitude : this.amplitude;
            this.dy = this.dy === this.amplitude ? -this.amplitude : this.amplitude;
            this.framesLeft--;
        } else {
            this.dx = 0;
            this.dy = 0;
        }
    }

    get active(): boolean {
        return this.dx !== 0 || this.dy !== 0;
    }
}
