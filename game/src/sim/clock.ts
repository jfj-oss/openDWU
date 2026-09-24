// Galaxy-time clock for the streamlined HUD (task 07b). The original drives
// galaxy time from Main.Part*.cs via a paused flag and a game-speed index;
// task 05c kept just the two fields the HUD needed. Task 07b replaces that
// with the full GalaxyTime model (galaxyTime.ts, port of Galaxy.cs /
// Main.Part4.cs): pause/resume, speed ×2/÷2 clamped to [0.25, 4], and
// advance(realDtMs) → game ms advanced.

export { GalaxyTime } from './galaxyTime';
export type { GalaxyTime as GameClock } from './galaxyTime';