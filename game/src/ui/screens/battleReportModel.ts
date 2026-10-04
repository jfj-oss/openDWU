// Battle report window model (an Improvement inspired by Distant Worlds 2; NOT in DW:U): the texts the report window
// and the Battle Reports list show for a finished report (sim/battleReports/battleReports.ts). Pure (no DOM).

import type { BattleFate, BattleReport, BattleResult, BattleSide, BattleUnit } from '../../sim/battleReports/battleReports';
import { resolveStarDateDescription } from '../../sim/galaxyTime';
import { resolveSubRoleDescription } from '../../sim/designGeneration';
import { resolveCreatureDescription, type CreatureType } from '../../sim/creature';
import type { BuiltObjectSubRole } from '../../sim/builtObjectTypes';

export const RESULT_LABELS: Record<BattleResult, string> = { victory: 'Victory', defeat: 'Defeat', draw: 'Draw', retreat: 'Retreat' };
/** Result colours: green / red / grey / amber. */
export const RESULT_COLORS: Record<BattleResult, string> = { victory: 'rgb(144, 238, 144)', defeat: 'rgb(255, 80, 80)', draw: 'rgb(200, 200, 200)', retreat: 'rgb(255, 192, 0)' };
export const FATE_LABELS: Record<BattleFate, string> = { intact: 'Intact', damaged: 'Damaged', disabled: 'Disabled', destroyed: 'Destroyed', captured: 'Captured' };
export const FATE_COLORS: Record<BattleFate, string> = { intact: 'rgb(170, 170, 170)', damaged: 'rgb(255, 192, 0)', disabled: 'rgb(255, 140, 0)', destroyed: 'rgb(255, 80, 80)', captured: 'rgb(255, 80, 255)' };

/** "S184" / "S184 (near S184 2)" / "Deep space near S184". */
export function battleLocationText(r: BattleReport): string {
    if (r.deepSpace) return r.locationName !== '' ? `Deep space near ${r.locationName}` : 'Deep space';
    return r.nearName !== '' ? `${r.locationName} (near ${r.nearName})` : r.locationName;
}

/** The window title / ticker line: "Battle report: <system>". */
export function battleReportTitle(r: BattleReport): string {
    return `Battle report: ${r.deepSpace ? `deep space near ${r.locationName}` : r.locationName}`;
}

/** "Battle of S184 — Victory" (the list's subject). */
export function battleListTitle(r: BattleReport): string {
    const where = r.deepSpace ? `Deep space near ${r.locationName}` : `Battle of ${r.locationName}`;
    return `${where} — ${RESULT_LABELS[r.result]}${r.minor ? ' (skirmish)' : ''}`;
}

/** "Star date 2450.3 – 2450.4 (37 s)". */
export function battleWhenText(r: BattleReport): string {
    const secs = Math.max(0, Math.round((r.endMs - r.startMs) / 1000));
    const dur = secs >= 120 ? `${Math.round(secs / 60)} min` : `${secs} s`;
    const a = resolveStarDateDescription(r.startStarDate);
    const b = resolveStarDateDescription(r.endStarDate);
    return `Star date ${a}${b !== a ? ` – ${b}` : ''} (${dur})`;
}

/** A unit's type text: the sub-role ("Escort", "Medium Space Port"), the creature type, or "Colony". */
export function unitTypeText(u: BattleUnit): string {
    if (u.kind === 'colony') return 'Colony';
    if (u.kind === 'creature') return u.creatureType >= 0 ? resolveCreatureDescription(u.creatureType as CreatureType) : 'Creature';
    return u.subRole >= 0 ? resolveSubRoleDescription(u.subRole as BuiltObjectSubRole) : u.kind === 'base' ? 'Base' : 'Ship';
}

/** A unit's fate text ("Captured by X", "Intact (withdrew)"). */
export function unitFateText(u: BattleUnit): string {
    let t = FATE_LABELS[u.fate];
    if (u.fate === 'captured' && u.capturedBy !== '') t += ` by ${u.capturedBy}`;
    if (u.withdrew && u.fate !== 'destroyed' && u.fate !== 'captured') t += ' (withdrew)';
    return t;
}

/** "3 ships, 2 bases, 1 colony" for a side's starting forces. */
export function sideForcesText(r: BattleReport, s: BattleSide): string {
    const n = { ship: 0, base: 0, creature: 0, colony: 0 };
    for (const u of r.units) if (u.side === s.key) n[u.kind]++;
    const part = (k: number, one: string, many: string): string | null => (k > 0 ? `${k} ${k === 1 ? one : many}` : null);
    return [part(n.ship, 'ship', 'ships'), part(n.base, 'base', 'bases'), part(n.creature, 'creature', 'creatures'), part(n.colony, 'colony', 'colonies')].filter((x) => x !== null).join(', ') || 'none';
}

/** "1 destroyed, 1 captured, 2 damaged" (or "none"). */
export function sideLossesText(s: BattleSide): string {
    const parts: string[] = [];
    if (s.destroyed > 0) parts.push(`${s.destroyed} destroyed`);
    if (s.captured > 0) parts.push(`${s.captured} captured`);
    if (s.disabled > 0) parts.push(`${s.disabled} disabled`);
    if (s.damaged > 0) parts.push(`${s.damaged} damaged`);
    if (s.fightersStart > s.fightersEnd) parts.push(`${s.fightersStart - s.fightersEnd} fighters`);
    return parts.length > 0 ? parts.join(', ') : 'none';
}

/** "485 → 475 (−2%)". */
export function beforeAfterText(a: number, b: number): string {
    const pct = a > 0 ? Math.round(((b - a) / a) * 100) : 0;
    return `${Math.round(a)} → ${Math.round(b)}${a > 0 && pct !== 0 ? ` (${pct > 0 ? '+' : '−'}${Math.abs(pct)}%)` : ''}`;
}

/** The camp label shown beside a side. */
export function campText(s: BattleSide): string {
    if (s.kind === 'player') return 'Your forces';
    if (s.camp === 'player') return 'Allied';
    if (s.camp === 'enemy') return 'Enemy';
    return 'Third party';
}

/** The sides in display order: the player's camp, the enemies, the rest. */
export function orderedSides(r: BattleReport): BattleSide[] {
    const rank = (s: BattleSide): number => (s.kind === 'player' ? 0 : s.camp === 'player' ? 1 : s.camp === 'enemy' ? 2 : 3);
    return [...r.sides].sort((a, b) => rank(a) - rank(b));
}

/** The units in display order: by side (orderedSides), losses first, then by start strength. */
export function orderedUnits(r: BattleReport): BattleUnit[] {
    const sideRank = new Map(orderedSides(r).map((s, i) => [s.key, i] as const));
    const fateRank: Record<BattleFate, number> = { destroyed: 0, captured: 1, disabled: 2, damaged: 3, intact: 4 };
    return [...r.units].sort((a, b) => (sideRank.get(a.side) ?? 9) - (sideRank.get(b.side) ?? 9) || fateRank[a.fate] - fateRank[b.fate] || b.startStrength - a.startStrength);
}

/** A plain-text summary (the Battle Reports list's text pane, tests). */
export function battleReportSummary(r: BattleReport): string {
    const lines: string[] = [battleLocationText(r), battleWhenText(r), `Result: ${RESULT_LABELS[r.result]}`, ''];
    for (const s of orderedSides(r)) {
        lines.push(`${s.name} (${campText(s)})`);
        lines.push(`  Forces: ${sideForcesText(r, s)}`);
        lines.push(`  Losses: ${sideLossesText(s)}`);
        lines.push(`  Firepower: ${beforeAfterText(s.firepowerStart, s.firepowerEnd)}   Strength: ${beforeAfterText(s.strengthStart, s.strengthEnd)}`);
    }
    return lines.join('\n');
}
