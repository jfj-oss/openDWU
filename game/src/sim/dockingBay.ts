// Port of DockingBay.cs (split out of builtObject.ts by M4e: logistics/dockingBays.ts creates habitat bays from
// empire.ts / galaxy.ts / startHabitats.ts, which must not import builtObject.ts at module-evaluation time).

import { toShort } from './builtObjectComponent';
import type { BuiltObject } from './builtObject';

export class DockingBay {
    private _dockedShip: BuiltObject | null = null;
    _capacity: number;
    private _componentId: number; // short
    private _builtObjectComponentId: number; // short

    constructor(componentId: number, builtObjectComponentId: number, capacity: number) {
        this._capacity = capacity;
        this._componentId = toShort(componentId);
        this._builtObjectComponentId = builtObjectComponentId;
    }

    get parentBuiltObjectComponentId(): number { return this._builtObjectComponentId; }
    get parentComponentId(): number { return this._componentId; }
    get dockedShip(): BuiltObject | null { return this._dockedShip; }
    set dockedShip(v: BuiltObject | null) { this._dockedShip = v; }
    get capacity(): number { return this._capacity; }
}
