// Port of DistantWorlds.Types/DialogSet.cs (+ DialogPartType.cs): the diplomacy conversation texts in
// $DWU/dialog/base_dialog.txt and the per-race $DWU/dialog/<race>.txt overrides. The conversation panel
// (Main.Part10.cs:3590 method_230) shows `string.Format(dialogSet.ResolveDialog(type, race), args)`.
//
// Pure: no DOM, no fs, no fetch. The caller supplies the file texts.

/** DialogPartType.cs, in declaration order (Enum.IsDefined in ResolveDialogPartType). */
export const DIALOG_PART_TYPES = [
    'Undefined', 'Exit',
    'INFO_OFFER_UNMETEMPIRE', 'INFO_OFFER_INDEPENDENTCOLONY', 'INFO_OFFER_SYSTEMMAPS', 'INFO_OFFER_RUINS', 'INFO_OFFER_RESTRICTEDAREA',
    'INFO_OFFER_DEBRISFIELD', 'INFO_OFFER_PLANETDESTROYER', 'INFO_UNMETEMPIRE', 'INFO_EXPLORATION', 'INFO_INDEPENDENTCOLONY', 'INFO_RUINS',
    'INFO_DEBRISFIELD', 'INFO_PLANETDESTROYER', 'INFO_RESTRICTEDAREA', 'INFO_NOFUNDS',
    'PIRATE_PROTECTIONPROPOSE', 'PIRATE_PROTECTIONPROPOSEINITIATE', 'PIRATE_PROTECTIONACCEPTRESPONSE', 'PIRATE_PROTECTIONREJECTRESPONSE',
    'PIRATE_PROTECTIONALREADYPAID', 'PIRATE_BUYINFO', 'PIRATE_ATTACKOFFER_EMPIRES', 'PIRATE_ATTACKOFFER_SINGLEEMPIRE', 'PIRATE_ATTACKCOMMENCE',
    'CANCELPIRATEPROTECTION', 'PIRATE_ALLIANCEPROPOSE', 'PIRATE_ALLIANCEACCEPT', 'PIRATE_ALLIANCEACCEPTRESPONSE', 'PIRATE_ALLIANCEREJECT',
    'PIRATE_ALLIANCEREJECTRESPONSE', 'PIRATE_ALLIANCECANCEL', 'PIRATE_ALLIANCECANCELRESPONSE',
    'GREETING_INTRODUCTION', 'GREETING_FRIENDLY', 'GREETING_NEUTRAL', 'GREETING_ANGRY',
    'OFFER_FREETRADE', 'OFFER_PROTECTORATE', 'OFFER_MUTUALDEFENSE', 'OFFER_DEAL', 'OFFER_DEAL_RESPONSE', 'OFFER_DEAL_TERRITORYMAP',
    'OFFER_DEAL_GALAXYMAP', 'OFFER_DEAL_COMPONENT',
    'DEAL_BEGIN', 'DEAL_OFFER', 'DEAL_DEMAND', 'DEAL_THREAT', 'DEAL_ACCEPT', 'DEAL_ACCEPTCOMPLAIN', 'DEAL_IMPROVE', 'DEAL_REJECT',
    'DEAL_REJECTCOMPLAIN', 'DEAL_REJECT_RESPONSE', 'DEAL_REJECTDEMAND_RESPONSE', 'DEAL_ACCEPT_RESPONSE',
    'MUTUALDEFENSE_ACCEPT', 'MUTUALDEFENSE_REJECT', 'MUTUALDEFENSE_REQUESTHELP', 'MUTUALDEFENSE_HONORREQUESTHELP',
    'MUTUALDEFENSE_HONORREQUESTHELP_RESPONSE', 'MUTUALDEFENSE_DECLINEREQUESTHELP', 'MUTUALDEFENSE_DECLINEREQUESTHELP_RESPONSE',
    'PROTECTORATE_ACCEPT', 'PROTECTORATE_REJECT', 'FREETRADE_ACCEPT', 'FREETRADE_REJECT',
    'CANCELTREATY', 'CANCELTREATY_RESPONSE_FRIENDLY', 'CANCELTREATY_RESPONSE_NEUTRAL', 'CANCELTREATY_RESPONSE_ANGRY',
    'TREATY_PROPOSAL', 'TREATY_ACCEPTRESPONSE', 'TREATY_REJECTRESPONSE',
    'TRADESANCTIONS_IMPOSE', 'TRADESANCTIONS_IMPOSE_RESPONSE_ANGRY', 'TRADESANCTIONS_IMPOSE_RESPONSE_NEUTRAL',
    'TRADESANCTIONS_IMPOSE_RESPONSE_SURPRISED', 'TRADESANCTIONS_LIFT', 'TRADESANCTIONS_LIFT_RESPONSE', 'TRADESANCTIONS_REQUESTLIFTOTHER',
    'TRADESANCTIONS_REQUESTLIFTOTHER_ACCEPT', 'TRADESANCTIONS_REQUESTLIFTOTHER_REJECT', 'TRADESANCTIONS_REQUESTIMPOSEJOINT',
    'TRADESANCTIONS_REQUESTIMPOSEJOINT_ACCEPT', 'TRADESANCTIONS_REQUESTIMPOSEJOINT_REJECT',
    'WAR_DECLARE', 'WAR_DECLARE_RESPONSE_EAGER', 'WAR_DECLARE_RESPONSE_NEUTRAL', 'WAR_DECLARE_RESPONSE_SURPRISED', 'WAR_DECLARE_REQUESTJOINT',
    'WAR_DECLARE_REQUESTJOINT_ACCEPT', 'WAR_DECLARE_REQUESTJOINT_REJECT',
    'WAR_END', 'WAR_END_SUBJUGATIONDEMAND', 'WAR_END_SUBJUGATIONOFFER', 'WAR_END_ACCEPT', 'WAR_END_REJECT', 'WAR_END_REQUESTOTHER',
    'WAR_END_REQUESTOTHER_ACCEPT', 'WAR_END_REQUESTOTHER_REJECT',
    'SUBJUGATIONDEMAND_ACCEPT', 'SUBJUGATIONDEMAND_REJECT', 'SUBJUGATIONOFFER_ACCEPT', 'SUBJUGATIONOFFER_REJECT',
    'SUBJUGATION_REQUESTRELEASE', 'SUBJUGATION_RELEASE', 'SUBJUGATION_REFUSERELEASE',
    'GIFT_GIVE', 'GIFT_THANKS', 'GIFT_PROPOSE',
    'WARNING', 'WARNING_INTELLIGENCEMISSIONS', 'WARNING_INTELLIGENCEMISSIONS_RESPONSE_FRIENDLY', 'WARNING_INTELLIGENCEMISSIONS_RESPONSE_NEUTRAL',
    'WARNING_INTELLIGENCEMISSIONS_RESPONSE_ANGRY', 'WARNING_ATTACKS', 'WARNING_ATTACKS_RESPONSE_FRIENDLY', 'WARNING_ATTACKS_RESPONSE_NEUTRAL',
    'WARNING_ATTACKS_RESPONSE_ANGRY',
    'SUBJUGATION_RELEASE_RESPONSE', 'SUBJUGATIONDEMAND_ACCEPT_RESPONSE', 'WAR_END_ACCEPT_RESPONSE',
    'WARNING_REMOVEFORCESSYSTEM', 'WARNING_REMOVEFORCESSYSTEM_RESPONSE_COMPLY', 'WARNING_REMOVEFORCESSYSTEM_RESPONSE_REFUSE',
    'WARNING_REMOVEFORCESSYSTEM_RESPONSE_NOFORCESPRESENT',
    'GOTO_TARGET', 'WARNING_GENERAL',
    'HISTORY_OFFER_LOCATIONHINT', 'HISTORY_OFFER_LOCATIONHINT_ACCEPT', 'HISTORY_OFFER_LOCATIONHINT_REJECT', 'HISTORY_LOCATIONHINT',
    'HISTORY_OFFER_STORYCLUE', 'HISTORY_OFFER_STORYCLUE_ACCEPT', 'HISTORY_OFFER_STORYCLUE_REJECT', 'HISTORY_OFFER_STORYMESSAGE',
    'HISTORY_OFFER_STORYMESSAGE_ACCEPT', 'HISTORY_OFFER_STORYMESSAGE_REJECT',
    'MININGRIGHTS_OFFER', 'MININGRIGHTS_CANCEL', 'MILITARYREFUELING_OFFER', 'MILITARYREFUELING_CANCEL',
    'PIRATE_PROTECTIONPROPOSE_OFFER', 'PIRATE_PROTECTIONPROPOSE_OFFER_ACCEPT', 'PIRATE_PROTECTIONPROPOSE_OFFER_REJECT', 'PIRATE_EXTORTPROTECTION',
    'CANCELPIRATEPROTECTIONPIRATE', 'PIRATE_TRUCEPROPOSE', 'PIRATE_TRUCEPROPOSEINITIATE', 'PIRATE_TRUCEACCEPTRESPONSE', 'PIRATE_TRUCEREJECTRESPONSE',
] as const;

/** DialogPartType.cs member name. */
export type DialogPartType = (typeof DIALOG_PART_TYPES)[number];

const DIALOG_PART_SET: ReadonlySet<string> = new Set<string>(DIALOG_PART_TYPES);

/** DialogPartList: type → dialog text (first definition wins). */
export type DialogPartList = Map<DialogPartType, string>;

// DialogSet.cs:43 ParseDialogFile: skip blank lines and lines starting with `'` (after trimming); split on the first
// ';'; code trimmed and mapped through ResolveDialogPartType (unknown → Undefined, skipped); dialog trimmed with the
// literal "\n" turned into a newline; a type already present is not overwritten.
export function parseDialogFile(source: string): DialogPartList {
    const list: DialogPartList = new Map();
    const body = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
    for (const line of body.split(/\r\n|\r|\n/)) {
        if (line === '' || line.trim() === '' || line.trim().substring(0, 1) === "'") continue;
        const length = line.indexOf(';');
        if (length < 0) continue;
        const code = line.substring(0, length).trim();
        const dialog = line.substring(length + 1).trim().split('\\n').join('\n');
        if (!DIALOG_PART_SET.has(code) || code === 'Undefined') continue; // DialogSet.cs:69 ResolveDialogPartType
        const type = code as DialogPartType;
        if (!list.has(type)) list.set(type, dialog);
    }
    return list;
}

/** DialogSet.cs: base dialog plus per-race overrides (keyed by race name). */
export class DialogSet {
    private readonly baseDialogParts: DialogPartList;
    private readonly raceDialogParts = new Map<string, DialogPartList>();

    constructor(baseDialogText: string) {
        this.baseDialogParts = parseDialogFile(baseDialogText);
    }

    /** DialogSet.cs:21 Initialize, one race: the parsed <race>.txt (when the file exists). */
    addRace(raceName: string, dialogText: string): void {
        this.raceDialogParts.set(raceName, parseDialogFile(dialogText));
    }

    hasRace(raceName: string): boolean {
        return this.raceDialogParts.has(raceName);
    }

    /** DialogSet.cs:75/81 ResolveDialog(type[, race]): the race's text, else the base text, else ''. */
    resolveDialog(type: DialogPartType, raceName?: string): string {
        if (raceName !== undefined) {
            const t = this.raceDialogParts.get(raceName)?.get(type);
            if (t !== undefined) return t;
        }
        return this.baseDialogParts.get(type) ?? '';
    }
}

/** DialogSet.cs:26 the race file name: race.Name.Replace("'", "") + ".txt" (the install's files are lower-case; Windows
 *  file lookups are case-insensitive, URL lookups are not). */
export function raceDialogFileName(raceName: string): string {
    return raceName.split("'").join('').toLowerCase() + '.txt';
}
