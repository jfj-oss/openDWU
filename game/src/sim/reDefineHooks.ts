// A leaf module (imports nothing, so it is initialised whatever import cycle loads its users): the mod layer's hook that
// BuiltObject.reDefine runs near its end in a game with a scenario. scenario/combat2/criticals.ts installs it (the lasting engine
// effect of a critical hit); builtObject.ts calls it. Not a port.
import type { BuiltObject } from './builtObject';

export const reDefineHooks: { after: ((bo: BuiltObject) => void) | null; extra: ((bo: BuiltObject) => void)[] } = { after: null, extra: [] };
