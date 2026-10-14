// The Orbital superiority add-on's flag, in a module of its own (no imports): orbitalAI.ts reads it at module load
// (its registerScenarioPeriodic / Query objects), and through the orbitalSuperiority.ts → … → packages.ts →
// orbitalAI.ts import cycle the binding was not yet initialised there ("Cannot access 'ORBITAL_SUPERIORITY_FLAG'
// before initialization": the sim worker / sim process failed to start, and so did every new game).
export const ORBITAL_SUPERIORITY_FLAG = 'orbitalSuperiority';
