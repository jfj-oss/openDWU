// Shared constant for the 19i "Rim atmosphere" sim-side wiring (name overrides, message-key remap). Duplicated from
// src/render/rimAtmosphereLayer.ts's own RIM_FLAG (same string, 'rimAtmosphere') rather than imported: that module
// pulls in pixi.js at the top, and src/sim must stay DOM/Pixi-free (game/CLAUDE.md). Both sides read the same
// scenario manifest (scenarios/rim-atmosphere/scenario.json), so the string only has one place it can drift from.

export const RIM_FLAG_NAME = 'rimAtmosphere';
