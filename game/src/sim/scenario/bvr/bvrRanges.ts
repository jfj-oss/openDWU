// BVR combat, weapon and sensor ranges (scenarios/bvr-combat, flag bvrCombat). Not a port. No Rnd.
//
// With the add-on on, the static component tables are scaled once per game (scenario/componentScale.ts): weapon ranges by the
// percentages below (a launcher's or a base's weapon is the same component), the BVR missile launchers by bvrRangeMissilePct on
// their own values, torpedoes by bvrRangeTorpedoPct on the STOCK range (the add-on's overlay keeps the stock torpedo range, its
// damage, speed and fire interval are the BVR ones), and the long-range scanner, proximity array and trace scanner by
// bvrSensorRangePct. Area / wave weapons, tractor and gravity beams, the planet-destroying super weapons, fighters and bombers are
// not scaled. Everything else follows from the tables: reDefine's range figures, the AI's design choices, the stand-off distance
// and the kiting bands, the target-lock range (bvrTrackRange plus a share of the scanner ranges) and the visibility sensors.

import { ComponentType } from '../../data/components';
import { registerScenarioQuery } from '../hooks';
import { BVR_MISSILE_NAMES } from './bvr';
import { scenarioParam } from '../state';

/** The range percentage for a weapon / sensor component, or null (not scaled). */
function rangePct(galaxy: Parameters<typeof scenarioParam>[0], type: ComponentType, name: string): { field: 'value1' | 'value2'; pct: number } | null {
    const P = (n: string, d: number): number => scenarioParam(galaxy, n, d);
    switch (type) {
        case ComponentType.WeaponBeam:
        case ComponentType.WeaponPhaser:
            return { field: 'value2', pct: P('bvrRangeBeamPct', 150) };
        case ComponentType.WeaponRailGun:
            return { field: 'value2', pct: P('bvrRangeRailPct', 150) };
        case ComponentType.WeaponTorpedo:
            return { field: 'value2', pct: P('bvrRangeTorpedoPct', 125) };
        case ComponentType.WeaponMissile:
            return { field: 'value2', pct: BVR_MISSILE_NAMES.has(name) ? P('bvrRangeMissilePct', 300) : P('bvrRangeTorpedoPct', 125) };
        case ComponentType.WeaponIonCannon:
        case ComponentType.WeaponIonPulse:
            return { field: 'value2', pct: P('bvrRangeIonPct', 125) };
        case ComponentType.WeaponPointDefense:
            return { field: 'value2', pct: P('bvrRangePdPct', 150) };
        case ComponentType.SensorLongRange:
        case ComponentType.SensorProximityArray:
        case ComponentType.SensorTraceScanner:
            return { field: 'value1', pct: P('bvrSensorRangePct', 200) };
        default:
            return null;
    }
}

registerScenarioQuery({
    id: 'bvr.componentRanges',
    query: 'componentValueScale',
    flag: 'bvrCombat', // BVR_FLAG as a literal: this module registers at load
    run: (galaxy, value, { component }) => {
        const r = rangePct(galaxy, component.type as ComponentType, component.name);
        if (r === null || r.pct === 100) return value;
        return r.field === 'value1' ? { value1: r.pct, value2: value.value2 } : { value1: value.value1, value2: r.pct };
    },
});
