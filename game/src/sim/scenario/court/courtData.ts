// 19n court & dynasties: data tables (tasks/19-mod-layer-scenarios.md §19n). Not a port: the original game has no
// houses. House names per race (a character's house is picked deterministically from these by a hash of its name and
// empire, see court.ts houseIndexFor); a race missing here uses DEFAULT_HOUSE_NAMES. Succession laws per government
// derive from governments.txt's LeaderReplacementTypicalManner / LeaderReplacementCharacterPool (successionLawFor).

export const HOUSE_NAMES: Readonly<Record<string, readonly string[]>> = {
    Ackdarian: ['Tharn', 'Vessik', 'Oruun', 'Kaldra', 'Mereth', 'Sallun'],
    Atuuk: ['Gubbo', 'Trask', 'Hoolum', 'Brakka', 'Pellun', 'Warrub'],
    Boskara: ['Kruul', 'Oggath', 'Dresk', 'Varrok', 'Morgul', 'Thukk'],
    Dhayut: ['Ishenti', 'Varuun', 'Keshal', 'Omari', 'Talesh', 'Sunvar'],
    Gizurean: ['Zzikt', 'Kraxis', 'Tchelk', 'Vrizz', 'Ixxal', 'Skarn'],
    Haakonish: ['Oskarn', 'Brevik', 'Haldane', 'Torvund', 'Ulfgar', 'Selmark'],
    Human: ['Ashford', 'Delacroix', 'Okonkwo', 'Varga', 'Nakamura', 'Sterling'],
    Ikkuro: ['Mumbo', 'Tikka', 'Lollu', 'Pom', 'Wubba', 'Kiki'],
    Ketarov: ['Drazhen', 'Volkov', 'Kresnik', 'Zarkov', 'Belaya', 'Orlan'],
    Kiadian: ['Serai', 'Lumeth', 'Aviel', 'Quorin', 'Tessaly', 'Vireen'],
    Mechanoid: ['Unit Alpha', 'Unit Kappa', 'Unit Sigma', 'Unit Theta', 'Unit Omega', 'Unit Delta'],
    Mortalen: ['Grimvald', 'Hrothek', 'Skullmar', 'Varakh', 'Durgan', 'Kaldrok'],
    Naxxilian: ['Nyssara', 'Vexith', 'Sslaan', 'Irixis', 'Zhaal', 'Oxxith'],
    Quameno: ['Aolun', 'Evehr', 'Ouvi', 'Ilaen', 'Uoma', 'Aerith'],
    Securan: ['Vantor', 'Selvan', 'Corrin', 'Madrel', 'Ostrin', 'Pallax'],
    Shakturi: ['Xeth', 'Vrakh', 'Zhul', 'Morkai', 'Tzarn', 'Qesh'],
    Shandar: ['Shalai', 'Moriv', 'Teshan', 'Aurel', 'Kanvi', 'Luthen'],
    Sluken: ['Glorp', 'Mudwallow', 'Sluuth', 'Blegg', 'Ooze', 'Grubnik'],
    Teekan: ['Tikkel', 'Pekkit', 'Zeebo', 'Nikka', 'Tekkun', 'Rikki'],
    Ugnari: ['Hrunn', 'Blodd', 'Gornak', 'Thurg', 'Vulk', 'Morr'],
    Wekkarus: ['Wekk', 'Tarrag', 'Hollum', 'Brun', 'Kessik', 'Ordo'],
    Zenox: ['Zenrah', 'Oxtel', 'Quivar', 'Xantis', 'Velor', 'Iridan'],
};

export const DEFAULT_HOUSE_NAMES: readonly string[] = ['Aldane', 'Borrin', 'Castell', 'Darrow', 'Everard', 'Faloren', 'Garrick', 'Hollis'];

export type SuccessionLaw = 'primogeniture' | 'election' | 'acclamation';
export const SUCCESSION_LAWS: readonly SuccessionLaw[] = ['primogeniture', 'election', 'acclamation'];

/**
 * governments.txt LeaderReplacementTypicalManner (0 = replacement, 1 = coup d'état, 2 = election) and
 * LeaderReplacementCharacterPool (0 none, 1 governors, 2 admirals & generals, 3 scientists) → a law:
 *   election manner → election; coup manner with the military pool → military acclamation; any other coup manner →
 *   primogeniture (Despotism, Feudalism, Monarchy, Corporate Nationalism); replacement manner → election within the pool
 *   when it has one (Technocracy), else primogeniture (Hive Mind).
 */
export function successionLawFor(manner: number, pool: number): SuccessionLaw {
    if (manner === 2) return 'election';
    if (manner === 1) return pool === 2 ? 'acclamation' : 'primogeniture';
    return pool !== 0 ? 'election' : 'primogeniture';
}
