// 19i "Rim atmosphere" item 12 — rim-specific exploration/colony message wording: a text-key remap at
// message-resolve time for a message whose subject sits past the rim inner radius (lost contact, missing survey
// ship, unusual readings, ...). Not a new message mechanic: a gameText(...) / formatGameTextNow(...) call site for an
// exploration or colony message calls rimText(galaxy, key, systemIndex, ...args) in its place and gets the " Rim"
// variant's wording (scenarios/rim-atmosphere/GameText.txt) when the subject system sits in the rim band, the same
// base wording otherwise. No sim state write, no Rnd draw, and no effect on message count (the sim digest hashes
// only e.messages.length, never text — src/sim/tick/digest.ts hashEmpire) — with the flag off every key resolves
// exactly as gameText/formatGameTextNow already do.

import { tryGetText } from '../textResolver';
import { rimWeightOfSystem, type RimWeightHost } from './rimState';

/** GameText key suffix convention (item 12): scenarios/rim-atmosphere/GameText.txt pairs "<key>" with
 *  "<key> Rim" for every message this remap applies to. */
export const RIM_TEXT_SUFFIX = ' Rim';

/** Pure: the key rimText should resolve, given the subject system's installed rim weight (0 = outside the rim band,
 *  or the flag/scenario/system is not one installRimWeights ran for). */
export function rimMessageKey(baseKey: string, weight: number): string {
    return weight > 0 ? `${baseKey}${RIM_TEXT_SUFFIX}` : baseKey;
}

/**
 * .NET string.Format-style resolve (matches colonyTick.ts gameText / scenario/messages.ts scenarioText): the
 * rim-band wording of `baseKey` for a message about `systemIndex`, falling back to the base key's own text, then the
 * literal key, exactly as tryGetText-based resolution already falls back with no scenario.
 */
export function rimText(galaxy: RimWeightHost, baseKey: string, systemIndex: number, ...args: unknown[]): string {
    const key = rimMessageKey(baseKey, rimWeightOfSystem(galaxy, systemIndex));
    const template = tryGetText(key) ?? tryGetText(baseKey) ?? baseKey;
    return template.replace(/\{(\d+)\}/g, (m, i: string) => (Number(i) < args.length ? String(args[Number(i)]) : m));
}
