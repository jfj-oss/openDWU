// The original Diplomacy screen's model (pure, no DOM): the relation strip beside each empire row
// (DiplomaticRelationListView.DrawRelations), the window / detail layouts of the small and large variants
// (Main.Part11.cs method_195, EmpireDetailView.Kickstart / DrawEmpireDetail) and the dominant race lines
// (Galaxy.cs ResolveRaceCharacteristics).

import type { Empire } from '../../sim/empire';
import type { Race } from '../../sim/data/races';
import { DiplomaticRelationType, empireEvaluationByEmpire, empireEvaluationsOf } from '../../sim/diplomacy';
import { PirateRelationType } from '../../sim/pirateRelations';
import { PiratePlayStyle } from '../../sim/pirates';
import { CharacterRole } from '../../sim/characters';
import { IntelligenceMissionOutcome, IntelligenceMissionType } from '../../sim/espionage';
import { feelingDescription } from '../../sim/player/relationFactors';

/** DiplomaticRelationListView.DrawRelations pens (pen3 … pen13): one colour per relation type. NotMet is pen3, the
 *  strip's own back colour (60, 60, 72). */
export const RELATION_PEN: Record<DiplomaticRelationType, number> = {
    [DiplomaticRelationType.NotMet]: 0x3c3c48,
    [DiplomaticRelationType.None]: 0x808080,
    [DiplomaticRelationType.FreeTradeAgreement]: 0x00ff00,
    [DiplomaticRelationType.MutualDefensePact]: 0x4040e8,
    [DiplomaticRelationType.SubjugatedDominion]: 0xffff00,
    [DiplomaticRelationType.Protectorate]: 0x7070ff,
    [DiplomaticRelationType.TradeSanctions]: 0xffa500,
    [DiplomaticRelationType.War]: 0xff0000,
    [DiplomaticRelationType.Truce]: 0xffff00,
};

/** The pirate pens: None pen7 (128, 128, 128), Protection pen13 (160, 160, 255); NotMet draws nothing. */
export function pirateRelationPen(type: PirateRelationType): number | null {
    if (type === PirateRelationType.None) return 0x808080;
    if (type === PirateRelationType.Protection) return 0xa0a0ff;
    return null;
}

/** The strip's back colour (LayoutControls: Color.FromArgb(60, 60, 72), also the grid's rows). */
export const RELATION_STRIP_BACK = 0x3c3c48;

/** C# `((int)(value / 1000.0)).ToString("######0K")` + `" (+" + bonus.ToString("##0%") + ")"` when the bonus is > 0. */
export function tradeValueText(normalizedAnnualTradeValue: number, tradeBonus: number): string {
    let s = `${Math.trunc(normalizedAnnualTradeValue / 1000)}K`;
    if (tradeBonus > 0) s += ` (+${Math.round(tradeBonus * 100)}%)`;
    return s;
}

export type RelationShape = 'line' | 'wedge-in' | 'wedge-out' | 'none';

export interface RelationLine {
    /** Pen colour; null = nothing drawn for this row. */
    color: number | null;
    /** 'line': the 3 px line with the 10 px fade-in. Subjugated / Protectorate (and NotMet) draw a wedge: 'wedge-out'
     *  (thin at the list, wide at the right) when the viewpoint initiated it, else 'wedge-in'. */
    shape: RelationShape;
    /** Feeling text drawn at x 2 above the line. */
    feeling: string;
    /** Annual trade value text drawn centred above the line ('' for pirate rows). */
    trade: string;
    /** The row empire's alliance name (grey, centred under the line). */
    alliance: string;
    /** A player agent in deep cover in the row empire (characters.png). */
    agent: boolean;
    /** Military refuelling: the row empire grants the viewpoint (flag1) / the viewpoint grants the row (flag2). */
    refuelToViewpoint: boolean;
    refuelFromViewpoint: boolean;
    /** Mining rights, same split. */
    miningToViewpoint: boolean;
    miningFromViewpoint: boolean;
}

const EMPTY_LINE: RelationLine = {
    color: null,
    shape: 'none',
    feeling: '',
    trade: '',
    alliance: '',
    agent: false,
    refuelToViewpoint: false,
    refuelFromViewpoint: false,
    miningToViewpoint: false,
    miningFromViewpoint: false,
};

function pirateFeeling(evaluation: number): string {
    // Empire.4.cs:16 ResolveFeelingDescription(PirateRelation): (int)Evaluation through the same thresholds.
    return feelingDescription(Math.trunc(evaluation));
}

function pirateRelationOf(empire: Empire, other: Empire): { type: PirateRelationType; evaluation: number } {
    const r = empire.pirateRelations?.getRelationByOtherEmpire(other) ?? null;
    return r === null ? { type: PirateRelationType.NotMet, evaluation: 0 } : { type: r.type, evaluation: r.evaluation };
}

/** A player agent with a successful, undetected DeepCover mission against `target` (DrawRelations agent icon). */
export function hasDeepCoverAgent(player: Empire, target: Empire): boolean {
    for (const c of (player.characters ?? []) as { role: CharacterRole; mission: unknown }[]) {
        if (c == null || c.role !== CharacterRole.IntelligenceAgent) continue;
        const m = c.mission as { targetEmpire: Empire | null; type: number; outcome: number } | null;
        if (m != null && m.targetEmpire === target && m.type === IntelligenceMissionType.DeepCover && m.outcome === IntelligenceMissionOutcome.SucceedNotDetect) return true;
    }
    return false;
}

/**
 * Port of DiplomaticRelationListView.DrawRelations for one row: the relation between the selected empire
 * (`viewpoint`, the empire whose relations the strip shows) and the row's empire, from the viewpoint's side.
 */
export function relationLine(viewpoint: Empire, row: Empire, player: Empire): RelationLine {
    if (viewpoint.pirateEmpireBaseHabitat !== null) {
        const pr = pirateRelationOf(viewpoint, row);
        const color = pirateRelationPen(pr.type);
        if (color === null) return EMPTY_LINE;
        return { ...EMPTY_LINE, color, shape: 'line', feeling: pirateFeeling(pirateRelationOf(row, viewpoint).evaluation) };
    }
    if (row.pirateEmpireBaseHabitat !== null) {
        if (viewpoint !== player) return EMPTY_LINE;
        const pr = pirateRelationOf(row, viewpoint);
        const color = pirateRelationPen(pr.type);
        if (color === null) return EMPTY_LINE;
        return { ...EMPTY_LINE, color, shape: 'line', feeling: pirateFeeling(pr.evaluation) };
    }
    const rel = viewpoint.diplomaticRelations.byEmpire(row);
    if (rel === null) return { ...EMPTY_LINE, agent: hasDeepCoverAgent(player, row) };
    const color = RELATION_PEN[rel.type];
    const wedge = rel.type === DiplomaticRelationType.SubjugatedDominion || rel.type === DiplomaticRelationType.Protectorate || rel.type === DiplomaticRelationType.NotMet;
    const shape: RelationShape = !wedge ? 'line' : rel.initiator === rel.thisEmpire ? 'wedge-out' : 'wedge-in';
    // this._Empire (the player).ResolveFeelingDescription(row.EmpireEvaluations[selected]): how the row feels about the viewpoint.
    const ev = empireEvaluationByEmpire(empireEvaluationsOf(row), viewpoint);
    const theirs = row.diplomaticRelations.byEmpire(viewpoint);
    return {
        color,
        shape,
        feeling: ev !== null ? feelingDescription(ev.overallAttitude) : '',
        trade: tradeValueText(rel.normalizedAnnualTradeValue, rel.tradeBonus),
        alliance: row.diplomaticRelations.getHighestAllianceName(),
        agent: hasDeepCoverAgent(player, row),
        refuelToViewpoint: theirs?.militaryRefuelingToOther === true,
        refuelFromViewpoint: rel.militaryRefuelingToOther,
        miningToViewpoint: theirs?.miningRightsToOther === true,
        miningFromViewpoint: rel.miningRightsToOther,
    };
}

/** Main.Part11.cs method_195 + EmpireDetailView.Kickstart: the two sizes of the Diplomacy window, in original px. */
export interface DiplomacyLayout {
    large: boolean;
    /** pnlEmpireInfo (ScreenPanel) size. */
    window: { w: number; h: number };
    /** ctlEmpireDiplomaticRelationList at (10, 10): width num2, height num. RelationViewWidth 180. */
    list: { x: number; y: number; w: number; h: number; relationWidth: number };
    /** pnlEmpireDetailInfo at (430, 10). */
    detail: { x: number; y: number; w: number; h: number };
    /** The right column at x num3: Speak (195 × 50 at y 30), map title (y 97), map (195 × 195 at y 115), colour key
     *  (195 × 168 at y 320), links at y 530 / 555 / 580. */
    column: { x: number; w: number };
    /** EmpireDetailView fonts (GenerateFont px). */
    fonts: { title: number; header: number; normal: number; large: number };
    /** DrawEmpireDetail rectangles and spacings (non-pirate branch). */
    stats: { x: number; y: number; w: number; h: number };
    race: { x: number; y: number; w: number; h: number };
    relation: { x: number; y: number; w: number; h: number };
    /** num14 (row step), num15, num16 (pirate fee step), num17 (factor start), num18 (ambassador line), num19 (race
     *  picture), x4 (race text x), x3 (second stat column / characteristics x), y16 (feeling line), width3. */
    rowStep: number;
    raceGap: number;
    feeStep: number;
    factorGap: number;
    ambassadorStep: number;
    racePicture: number;
    raceTextX: number;
    column2X: number;
    feelingY: number;
    textWidth: number;
    /** btnEmpireDetailAcceptTreaty Location (130 × 25). */
    accept: { x: number; y: number };
    /** The pirate branch's rect2, line steps (num4, num5, num6, num7) and text width. */
    pirate: { rect: { x: number; y: number; w: number; h: number }; step: number; gap: number; bigGap: number; offerStep: number; width: number };
}

export function diplomacyLayout(large: boolean): DiplomacyLayout {
    if (large) {
        return {
            large,
            window: { w: 1180, h: 900 },
            list: { x: 10, y: 10, w: 420, h: 820, relationWidth: 180 },
            detail: { x: 430, y: 10, w: 520, h: 820 },
            column: { x: 960, w: 195 },
            fonts: { title: 22.67, header: 20, normal: 18, large: 16.67 },
            stats: { x: 12, y: 115, w: 496, h: 97 },
            race: { x: 12, y: 221, w: 496, h: 232 },
            relation: { x: 12, y: 462, w: 496, h: 345 },
            rowStep: 17,
            raceGap: 14,
            feeStep: 40,
            factorGap: 24,
            ambassadorStep: 15,
            racePicture: 53,
            raceTextX: 78,
            column2X: 280,
            feelingY: 516,
            textWidth: 480,
            accept: { x: 250, y: 496 },
            pirate: { rect: { x: 12, y: 115, w: 496, h: 695 }, step: 20, gap: 11, bigGap: 33, offerStep: 13, width: 480 },
        };
    }
    return {
        large,
        window: { w: 1040, h: 760 },
        list: { x: 10, y: 10, w: 420, h: 680, relationWidth: 180 },
        detail: { x: 430, y: 10, w: 380, h: 680 },
        column: { x: 820, w: 195 },
        fonts: { title: 22.67, header: 18.67, normal: 15.33, large: 16.67 },
        stats: { x: 12, y: 115, w: 356, h: 72 },
        race: { x: 12, y: 196, w: 356, h: 182 },
        relation: { x: 12, y: 387, w: 356, h: 280 },
        rowStep: 12,
        raceGap: 10,
        feeStep: 30,
        factorGap: 18,
        ambassadorStep: 13,
        racePicture: 40,
        raceTextX: 65,
        column2X: 210,
        feelingY: 441,
        textWidth: 300,
        accept: { x: 230, y: 456 },
        pirate: { rect: { x: 12, y: 115, w: 356, h: 555 }, step: 15, gap: 8, bigGap: 25, offerStep: 10, width: 300 },
    };
}

/** Galaxy.cs:2172 ResolveRaceCharacteristicIntensity. */
export function raceCharacteristicIntensity(level: number): string {
    const d = Math.abs(level - 100);
    if (d >= 30) return 'Extremely';
    if (d >= 17) return 'Very';
    if (d >= 6) return 'Quite';
    return 'Slightly';
}

/** Galaxy.cs:2148 ResolveRaceCharacteristics: "{intensity} {quality}" for aggression, caution, friendliness,
 *  intelligence and loyalty (races.txt levels, 100 = neutral). */
// TODO(port): Race.AggressionLevel adds the periodic aggression swing (Race.cs PeriodicAggressionLevel); this uses the
// races.txt base levels — Race.cs AggressionLevel.
export function raceCharacteristics(race: Pick<Race, 'aggression' | 'caution' | 'friendliness' | 'intelligence' | 'loyalty'>): string[] {
    const line = (level: number, low: string, high: string): string => `${raceCharacteristicIntensity(level)} ${level < 100 ? low : high}`;
    return [
        line(race.aggression, 'Passive', 'Aggressive'),
        line(race.caution, 'Reckless', 'Cautious'),
        line(race.friendliness, 'Unfriendly', 'Friendly'),
        line(race.intelligence, 'Stupid', 'Intelligent'),
        line(race.loyalty, 'Unreliable', 'Dependable'),
    ];
}

/** Galaxy.ResolveDescription(PiratePlayStyle) (GameText "Pirate Playstyle Description" = "Pirate {0}"). */
export function piratePlayStyleName(style: PiratePlayStyle): string {
    switch (style) {
        case PiratePlayStyle.Pirate:
            return 'Raider';
        case PiratePlayStyle.Mercenary:
            return 'Mercenary';
        case PiratePlayStyle.Smuggler:
            return 'Smuggler';
        default:
            return 'Balanced';
    }
}

/** RaceImageCache pirate portraits: images/units/races/pirates/<balanced|raider|mercenary|smuggler>.png. */
export function piratePortraitUrl(style: PiratePlayStyle): string {
    const file = style === PiratePlayStyle.Pirate ? 'raider' : style === PiratePlayStyle.Mercenary ? 'mercenary' : style === PiratePlayStyle.Smuggler ? 'smuggler' : 'balanced';
    return `/assets/dwu/images/units/races/pirates/${file}.png`;
}

/** BaconMain.SetColorForDiplomacyBackground: the main colour halved (the detail panel's BackColor2). */
export function diplomacyBackgroundColor(mainColor: number): number {
    const r = ((mainColor >> 16) & 255) >> 1;
    const g = ((mainColor >> 8) & 255) >> 1;
    const b = (mainColor & 255) >> 1;
    return (r << 16) | (g << 8) | b;
}

/** EmpireDetailView.BindData: the empire's races, dominant race first, with their population in millions. */
export function empireRaces(empire: Empire): { race: Race; millions: number }[] {
    const out: { race: Race; millions: number }[] = [];
    if (empire.dominantRace != null) out.push({ race: empire.dominantRace as Race, millions: 0 });
    for (const colony of empire.colonies) {
        for (const p of colony.population?.items ?? []) {
            const race = p.race as Race | null;
            if (race == null) continue;
            const e = out.find((x) => x.race === race);
            if (e) e.millions += p.amount / 1000000;
            else out.push({ race, millions: p.amount / 1000000 });
        }
    }
    return out;
}

/** The player's ambassador at `empire`'s capital (Characters.FindCharactersAtLocationNotTransferring(capital,
 *  Ambassador)[0]): role, name and the diplomacy bonus ("+#0%;-#0%", "?%" until the bonuses are known). */
export function ambassadorAt<C extends { role: CharacterRole; location: unknown; transferDestination: unknown; name: string; diplomacy: number; bonusesKnown: boolean }>(
    player: Empire,
    empire: Empire,
): { role: string; name: string; bonus: string; character: C } | null {
    const capital = empire.capital;
    if (capital == null) return null;
    for (const c of (player.characters ?? []) as unknown as C[]) {
        if (c == null || c.role !== CharacterRole.Ambassador || c.location !== capital || c.transferDestination != null) continue;
        const pct = Math.round(c.diplomacy);
        return { role: 'Ambassador', name: c.name, bonus: c.bonusesKnown ? `${pct >= 0 ? '+' : '-'}${Math.abs(pct)}%` : '?%', character: c };
    }
    return null;
}
