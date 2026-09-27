// 19n court & dynasties: the pure view model the Characters screen (Court block) and the Empire Summary (Legitimacy,
// ruling house, succession, council rows) show when the `courtDynasties` flag is on. Not a port. No DOM here; read-only:
// never creates the court state, never draws.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { type Character, CharacterRole } from '../sim/characters';
import { scenarioText } from '../sim/scenario/messages';
import {
    SEATS,
    appointBlocked,
    courtOn,
    empireFaction,
    houseOf,
    leaderLegitimacy,
    peekCourtState,
    rulingHouse,
    seatHolder,
    seatLabel,
    seatOf,
    successionLaw,
    type SeatName,
} from '../sim/scenario/court/court';

export function courtVisible(galaxy: Galaxy): boolean {
    return courtOn(galaxy) && peekCourtState(galaxy) !== null;
}

export interface CourtSeatButton {
    seat: SeatName;
    label: string;
    enabled: boolean;
    reason: string;
}

export interface CourtDetail {
    house: string;
    seat: string;
    heir: boolean;
    buttons: CourtSeatButton[];
    /** The seat to vacate (null: holds none). */
    vacate: SeatName | null;
}

/** The Court block of a character (null: flag off, or a foreign character). */
export function courtDetail(galaxy: Galaxy, player: Empire, c: Character): CourtDetail | null {
    if (!courtVisible(galaxy) || c.empire !== player) return null;
    const h = houseOf(galaxy, c);
    const seat = seatOf(galaxy, c);
    const st = peekCourtState(galaxy)!;
    const leader = c.role === CharacterRole.Leader;
    return {
        house: h !== null ? `House ${h.name} (prestige ${Math.round(h.prestige)})${rulingHouse(galaxy, player) === h ? ' — ruling' : ''}` : '—',
        seat: leader ? 'Ruler' : seat !== null ? seatLabel(seat) : 'No seat',
        heir: st.heirs.get(player) === c,
        buttons: leader
            ? []
            : SEATS.filter((s) => s !== seat).map((s) => {
                  const why = appointBlocked(galaxy, player, s, c);
                  return { seat: s, label: `Appoint ${seatLabel(s)}`, enabled: why === null, reason: why ?? '' };
              }),
        vacate: seat,
    };
}

export interface CourtSummaryRow {
    label: string;
    value: string;
    title?: string;
}

/** Empire Summary rows (empty with the flag off). */
export function courtSummaryRows(galaxy: Galaxy, empire: Empire): CourtSummaryRow[] {
    if (!courtVisible(galaxy)) return [];
    const st = peekCourtState(galaxy)!;
    const rows: CourtSummaryRow[] = [];
    const ruling = rulingHouse(galaxy, empire);
    const regency = st.regencies.get(empire);
    const legit = Math.round(leaderLegitimacy(galaxy, empire));
    rows.push({
        label: 'Legitimacy',
        value: `${legit} / 100${regency !== undefined ? ' (regency)' : ''}`,
        title: 'Low legitimacy makes plots and factions more likely; it rises with prestige and lawful successions and falls with purges, coups and regencies.',
    });
    if (ruling !== null) {
        const rivals = ruling.rivals.map((id) => st.houses.find((h) => h.id === id)?.name).filter((n): n is string => n !== undefined);
        rows.push({ label: 'Ruling house', value: `${ruling.name} (prestige ${Math.round(ruling.prestige)})`, title: rivals.length > 0 ? `Feuding with: ${rivals.join(', ')}` : undefined });
    }
    const heir = st.heirs.get(empire);
    rows.push({ label: 'Succession', value: `${scenarioText(`Court Law ${successionLaw(galaxy, empire)}`)}${heir !== undefined ? ` — heir ${heir.name}` : ''}` });
    const lines = SEATS.map((s) => `${seatLabel(s)}: ${seatHolder(galaxy, empire, s)?.name ?? 'vacant'}`);
    const filled = SEATS.filter((s) => seatHolder(galaxy, empire, s) !== null).length;
    rows.push({ label: 'Council', value: `${filled} / ${SEATS.length} seats`, title: lines.join('\n') });
    const f = empireFaction(galaxy, empire);
    if (f !== null) rows.push({ label: 'Faction', value: `${f.leader.name} (${f.members.length}) — ${f.state === 'backing' ? 'backing a plot' : 'ultimatum'}` });
    return rows;
}
