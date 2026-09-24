// Galactopedia (the in-game encyclopedia). Port of the original's
// pnlEncyclopedia (Main.Part5.cs method_456..method_468, Start.1.cs
// method_127..): a topic tree (EncyclopediaTopicTree), the help page for the
// selected topic (webEncyclopediaContent showing $DWU/Help/<file>.mht), the
// related-topics links (RelatedEncyclopediaItemsBox) and back / forward /
// home history buttons. Streamlined modern layout: tree + search on the
// left, content + related topics on the right, nav in the header.

import './galactopedia.css';
import {
    buildEncyclopediaItems,
    buildEncyclopediaTree,
    EncyclopediaCategory,
    getText,
    parseGameText,
    resolveEncyclopediaTopic,
    removeSpecialCharacters,
    splitString,
    type EncyclopediaItem,
    type HelpFolderListing,
    type EncyclopediaTreeNode,
    type GameText,
} from '../../sim/data/gameText';
import { loadGameData, type GameData } from '../../sim/data/gameData';
import {
    CharacterTraitType,
    ComponentCategoryType,
    RaceVictoryConditionType,
    type Race,
    type RaceVictoryCondition,
    type ResourceBonus,
} from '../../sim/data/races';
import type { RaceFamily } from '../../sim/data/raceFamilies';
import type { Resource } from '../../sim/data/resources';
import type { Government } from '../../sim/data/governments';
import type { ResearchNode } from '../../sim/data/research';
import { ComponentType, type Component } from '../../sim/data/components';
import type { Facility } from '../../sim/data/facilities';
import { CreatureType } from '../../sim/creature';
import { HabitatCategoryType, HabitatType, IndustryType } from '../../sim/types';
import { fileNameOf, findMhtPart, parseMht, type MhtDocument } from './mht';

const DWU = '/assets/dwu/';
const HELP = `${DWU}Help/`;

// ---------------------------------------------------------------------------
// Data loading (GameText.txt + the parsed game data for data-driven topics).
// ---------------------------------------------------------------------------

interface GalactopediaData {
    text: GameText;
    items: EncyclopediaItem[];
    tree: EncyclopediaTreeNode[];
    races: Race[];
    raceFamilies: RaceFamily[];
    summaryData: RaceSummaryData;
}

let dataPromise: Promise<GalactopediaData> | null = null;

/** $DWU/races/*.txt in Directory.GetFiles order (Galaxy.LoadRaces); the
 *  browser cannot list the folder. NOTE: loadGameData's own default list
 *  names files that do not exist in the stock install. */
const RACE_FILES = [
    'ackdarian.txt', 'atuuk.txt', 'boskara.txt', 'dhayut.txt', 'gizurean.txt', 'haakonish.txt',
    'human.txt', 'ikkuro.txt', 'ketarov.txt', 'kiadian.txt', 'mechanoid.txt', 'mortalen.txt',
    'naxxilian.txt', 'quameno.txt', 'securan.txt', 'shakturi.txt', 'shandar.txt', 'sluken.txt',
    'teekan.txt', 'ugnari.txt', 'wekkarus.txt', 'zenox.txt',
];

async function fetchFirstText(candidates: string[]): Promise<string> {
    for (const url of candidates) {
        try {
            const r = await fetch(url);
            if (r.ok) return await r.text();
        } catch {
            // next candidate
        }
    }
    throw new Error(`Could not load any of: ${candidates.join(', ')}`);
}

/** File.Exists for Help/<file>: a HEAD request that is OK and not the dev
 *  server's HTML fallback. */
function helpFileExists(file: string): Promise<boolean> {
    return urlExists(`${HELP}${file}`);
}

/** The customization set whose Customization/<set>/help/ folder the
 *  Galactopedia reads (the original's _Game.CustomizationSetName).
 *  TODO(port): wire to the active customization set once themes can be
 *  chosen — Main.Part5.cs method_459 / method_465 (string_31). */
const CUSTOMIZATION_SET: string | undefined = undefined;

function customHelpDir(set: string): string {
    return `${DWU}Customization/${encodeURIComponent(set)}/help/`;
}

/** File.Exists(<dir><file>) via HEAD (404 / dev-server HTML fallback = no). */
async function urlExists(url: string): Promise<boolean> {
    try {
        const r = await fetch(url, { method: 'HEAD' });
        return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
    } catch {
        return false;
    }
}

/**
 * Inputs for Galaxy.9.cs AddThemeTopics / AddGameInfoTopics. The original
 * lists Help/ and Customization/<set>/help/ with Directory.GetFiles; the
 * browser cannot, and public/asset-manifest.json only covers
 * images/environment/, so only the file names the C# itself names are
 * probed: <set>.mht and GameInfo_Default.mht. Other <set>_*.mht /
 * GameInfo_*.mht pages are not discoverable (TODO(port): list Help/ and
 * Customization/<set>/help/ in the asset manifest). The stock install has
 * none of these files, so both probes normally 404 and no topics are added.
 */
async function probeHelpListing(set: string | undefined): Promise<HelpFolderListing> {
    const hasSet = set !== undefined && set.trim() !== '' && set.trim().toLowerCase() !== '(default)';
    const defaultName = 'GameInfo_Default.mht';
    const [themeRootExists, customInfo, baseInfo] = await Promise.all([
        hasSet ? urlExists(`${customHelpDir(set)}${set}.mht`) : Promise.resolve(false),
        hasSet ? urlExists(`${customHelpDir(set)}${defaultName}`) : Promise.resolve(false),
        urlExists(`${HELP}${defaultName}`),
    ]);
    const gameInfoFiles: string[] = [];
    if (customInfo) gameInfoFiles.push(defaultName);
    if (baseInfo) gameInfoFiles.push(defaultName);
    return {
        customizationSetName: hasSet ? set : undefined,
        themeFiles: [],
        themeRootExists,
        gameInfoFiles,
        gameInfoDefaultExists: customInfo || baseInfo,
    };
}

async function loadGalactopediaData(): Promise<GalactopediaData> {
    const gtSource = await fetchFirstText([`${DWU}GameText.txt`]);
    const { text } = parseGameText(gtSource);
    let gameData: GameData | null = null;
    try {
        gameData = await loadGameData(fetchFirstText, undefined, RACE_FILES);
    } catch (err) {
        console.warn('Galactopedia: game data unavailable; race/resource/government topics omitted', err);
    }
    const candidates = new Set<string>();
    for (const r of gameData?.resources ?? []) candidates.add(`Resource_${removeSpecialCharacters(r.name)}.mht`);
    for (const r of gameData?.races ?? []) candidates.add(`Race_${removeSpecialCharacters(r.name)}.mht`);
    for (const g of gameData?.governments ?? []) candidates.add(`GameConcepts_GovernmentTypes_${removeSpecialCharacters(g.name)}.mht`);
    const existing = new Set<string>();
    const [, helpListing] = await Promise.all([
        Promise.all(
            [...candidates].map(async (f) => {
                if (await helpFileExists(f)) existing.add(f.toLowerCase());
            }),
        ),
        probeHelpListing(CUSTOMIZATION_SET),
    ]);
    const items = buildEncyclopediaItems(text, {
        resources: gameData?.resources ?? [],
        races: gameData?.races ?? [],
        governments: gameData?.governments ?? [],
        helpFileExists: (f) => existing.has(f.toLowerCase()),
        helpListing,
    });
    return {
        text,
        items,
        tree: buildEncyclopediaTree(items),
        races: gameData?.races ?? [],
        raceFamilies: gameData?.raceFamilies ?? [],
        summaryData: {
            races: gameData?.races ?? [],
            resources: gameData?.resources ?? [],
            governments: gameData?.governments ?? [],
            research: gameData?.research ?? [],
            components: gameData?.components ?? [],
            facilities: gameData?.facilities ?? [],
        },
    };
}

function getData(): Promise<GalactopediaData> {
    if (!dataPromise) {
        dataPromise = loadGalactopediaData().catch((err) => {
            dataPromise = null;
            throw err;
        });
    }
    return dataPromise;
}

// ---------------------------------------------------------------------------
// Help page loading (.mht -> sanitized DOM).
// ---------------------------------------------------------------------------

interface LoadedPage {
    doc: MhtDocument;
    /** Part location (lower-case) -> blob URL, created lazily. */
    urls: Map<string, string>;
}

const pageCache = new Map<string, Promise<LoadedPage | null>>();

/** Port of method_459's file resolution: Customization/<set>/help/<file>
 *  (when a set is active), Help/<file>, then the DE_/FR_/ES_ localized
 *  fallbacks. */
function loadPage(filename: string): Promise<LoadedPage | null> {
    const key = filename.toLowerCase();
    let p = pageCache.get(key);
    if (!p) {
        p = (async () => {
            const set = CUSTOMIZATION_SET;
            const urls = [
                ...(set && set.trim() !== '' && set.trim().toLowerCase() !== '(default)' ? [`${customHelpDir(set)}${filename}`] : []),
                ...['', 'DE_', 'FR_', 'ES_'].map((prefix) => `${HELP}${prefix}${filename}`),
            ];
            for (const url of urls) {
                try {
                    const r = await fetch(url);
                    if (!r.ok) continue;
                    const bytes = new Uint8Array(await r.arrayBuffer());
                    const doc = parseMht(bytes);
                    if (doc.html === '') continue;
                    return { doc, urls: new Map<string, string>() };
                } catch {
                    // next candidate
                }
            }
            return null;
        })();
        pageCache.set(key, p);
    }
    return p;
}

function partUrl(page: LoadedPage, ref: string): string | null {
    const part = findMhtPart(page.doc, ref);
    if (!part || !part.contentType.startsWith('image/')) return null;
    const key = part.location.toLowerCase();
    let url = page.urls.get(key);
    if (!url) {
        const buf = new ArrayBuffer(part.bytes.byteLength);
        new Uint8Array(buf).set(part.bytes);
        url = URL.createObjectURL(new Blob([buf], { type: part.contentType }));
        page.urls.set(key, url);
    }
    return url;
}

const DROP_TAGS = new Set(['script', 'style', 'head', 'meta', 'link', 'title', 'xml', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'svg', 'math', 'noscript']);
const KEEP_TAGS = new Set(['p', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'br', 'hr', 'sup', 'sub', 'img', 'a']);

/** Pick the safe, meaningful bits of a Word inline style. */
function safeStyle(style: string, tag: string): string {
    const out: string[] = [];
    for (const decl of style.split(';')) {
        const idx = decl.indexOf(':');
        if (idx < 0) continue;
        const prop = decl.slice(0, idx).trim().toLowerCase();
        const val = decl.slice(idx + 1).trim();
        const colorOk = /^(#[0-9a-f]{3,6}|[a-z]+)$/i.test(val);
        if (prop === 'color' && colorOk && !/^(black|windowtext|#000000|#000)$/i.test(val)) out.push(`color:${val}`);
        else if (prop === 'text-align' && /^(left|right|center|justify)$/i.test(val)) out.push(`text-align:${val}`);
        else if ((tag === 'td' || tag === 'th') && (prop === 'background' || prop === 'background-color') && /^#[0-9a-f]{3,6}$/i.test(val)) out.push(`background:${val}`);
    }
    return out.join(';');
}

/** List bullet from Word's "mso-list:Ignore" marker text. */
function listMarker(text: string): string {
    const t = text.replace(/ /g, ' ').trim();
    if (t === '' || /^[·§o•-]$/.test(t)) return '•';
    return t;
}

/**
 * Sanitize Word-generated help HTML into a DOM fragment: allow-listed tags
 * only, no scripts/handlers/styles (bar a few inline colours/alignment),
 * images mapped to the archive's embedded parts, links to other help pages
 * turned into topic links (data-help-file), everything else unwrapped.
 */
function sanitizeHelpHtml(page: LoadedPage): DocumentFragment {
    const parsed = new DOMParser().parseFromString(page.doc.html, 'text/html');
    const frag = document.createDocumentFragment();

    const walk = (src: Node, dst: Node): void => {
        for (const child of Array.from(src.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                dst.appendChild(document.createTextNode(child.textContent ?? ''));
                continue;
            }
            if (child.nodeType !== Node.ELEMENT_NODE) continue; // comments (VML, conditionals)
            const el = child as Element;
            const tag = el.tagName.toLowerCase();
            if (DROP_TAGS.has(tag) || tag.includes(':')) {
                // Word namespaced tags (o:p, v:shape, w:wrap) carry no text we want
                // except o:p, which is an empty paragraph mark.
                continue;
            }
            const style = el.getAttribute('style') ?? '';
            // Word list bullets: <span style='mso-list:Ignore'>·<span>&nbsp;...</span></span>.
            if (/mso-list\s*:\s*ignore/i.test(style)) {
                const m = document.createElement('span');
                m.className = 'gp-li-marker';
                m.textContent = listMarker(el.textContent ?? '');
                dst.appendChild(m);
                continue;
            }
            if (!KEEP_TAGS.has(tag)) {
                walk(el, dst);
                continue;
            }
            if (tag === 'img') {
                const url = partUrl(page, el.getAttribute('src') ?? '');
                if (!url) continue;
                const img = document.createElement('img');
                img.src = url;
                img.alt = '';
                img.loading = 'lazy';
                const w = parseInt(el.getAttribute('width') ?? '', 10);
                const h = parseInt(el.getAttribute('height') ?? '', 10);
                if (w > 0) img.width = w;
                if (h > 0) img.height = h;
                const align = (el.getAttribute('align') ?? '').toLowerCase();
                if (align === 'left' || align === 'right') img.className = `gp-float-${align}`;
                dst.appendChild(img);
                continue;
            }
            if (tag === 'a') {
                const href = el.getAttribute('href') ?? '';
                const file = fileNameOf(href.replace(/\\/g, '/'));
                if (/\.mht$/i.test(file)) {
                    const a = document.createElement('a');
                    a.href = '#';
                    a.className = 'gp-link';
                    a.dataset.helpFile = decodeURIComponent(file);
                    walk(el, a);
                    dst.appendChild(a);
                } else {
                    walk(el, dst);
                }
                continue;
            }
            const out = document.createElement(tag);
            const cls = el.getAttribute('class') ?? '';
            if (/^MsoListParagraph/i.test(cls)) out.className = 'gp-li';
            else if (/^MsoTitle/i.test(cls)) out.className = 'gp-title';
            const s = safeStyle(style, tag);
            const align = (el.getAttribute('align') ?? '').toLowerCase();
            const alignStyle = /^(left|right|center|justify)$/.test(align) ? `text-align:${align}` : '';
            const finalStyle = [s, alignStyle].filter((x) => x !== '').join(';');
            if (finalStyle !== '') out.setAttribute('style', finalStyle);
            if (tag === 'td' || tag === 'th') {
                for (const attr of ['colspan', 'rowspan']) {
                    const v = parseInt(el.getAttribute(attr) ?? '', 10);
                    if (v > 1) out.setAttribute(attr, String(v));
                }
                const valign = (el.getAttribute('valign') ?? '').toLowerCase();
                if (/^(top|middle|bottom)$/.test(valign)) (out as HTMLElement).style.verticalAlign = valign;
            }
            walk(el, out);
            dst.appendChild(out);
        }
    };
    walk(parsed.body, frag);
    return frag;
}

// ---------------------------------------------------------------------------
// Race summary (appended to race pages, Main.Part5.cs method_460).
// ---------------------------------------------------------------------------

export interface RaceSummarySection {
    heading: string;
    items: string[];
}

/** |value| * 10^decimals rounded half away from zero the way .NET custom
 *  numeric formats do (the double is first taken to 15 significant digits). */
function netRoundAbs(value: number, decimals: number): number {
    const scaled = Number((Math.abs(value) * 10 ** decimals).toPrecision(15));
    return Math.floor(scaled + 0.5);
}

/** C# ToString("0%") / ("+0%"): value * 100 rounded half away from zero. */
function pct(value: number, signed: boolean): string {
    const n = Math.sign(value) * netRoundAbs(value, 2);
    return `${signed && n >= 0 ? '+' : ''}${n}%`;
}

/** C# ToString("+0%;-0%"). A negative value that rounds to 0 uses the first
 *  section (.NET rule), i.e. "+0%". */
function pctPlusMinus(value: number): string {
    const n = netRoundAbs(value, 2);
    return `${value < 0 && n !== 0 ? '-' : '+'}${n}%`;
}

/** C# ToString("0") / ("#0"): integer, half away from zero. */
function fmt0(value: number): string {
    const n = netRoundAbs(value, 0);
    return `${value < 0 && n !== 0 ? '-' : ''}${n}`;
}

/** C# ToString("0.0"). */
function fmt01(value: number): string {
    const n = netRoundAbs(value, 1);
    const s = `${Math.floor(n / 10)}.${n % 10}`;
    return value < 0 && n !== 0 ? `-${s}` : s;
}


/** Port of Galaxy.cs ResolveRaceCharacteristicIntensity. */
function characteristicIntensity(text: GameText, level: number): string {
    const d = Math.abs(level - 100);
    if (d >= 30) return getText(text, 'Extremely');
    if (d >= 17) return getText(text, 'Very');
    if (d >= 6) return getText(text, 'Quite');
    return getText(text, 'Slightly');
}

function format(template: string, ...args: string[]): string {
    return template.replace(/\{(\d+)\}/g, (_m, i: string) => args[Number(i)] ?? '');
}

/** Port of Galaxy.2.cs ResolveDescription(HabitatType). */
function habitatTypeDescription(text: GameText, type: number): string {
    if (type === HabitatType.Undefined) return getText(text, 'None');
    const name = HabitatType[type];
    return name ? getText(text, `HabitatType ${name}`) : splitString(String(type));
}

/** Port of Galaxy.2.cs ResolveDescription(CreatureType). */
function creatureTypeDescription(text: GameText, type: number): string {
    switch (type) {
        case CreatureType.Ardilus: return getText(text, 'Ardilus');
        case CreatureType.DesertSpaceSlug: return getText(text, 'Sand Slug');
        case CreatureType.RockSpaceSlug: return getText(text, 'Space Slug');
        case CreatureType.Kaltor: return getText(text, 'Giant Kaltor');
        case CreatureType.SilverMist: return getText(text, 'SilverMist');
        default: return `(${getText(text, 'Unknown')})`;
    }
}

/** Port of Galaxy.2.cs ResolveDescription(IndustryType). */
function industryTypeDescription(text: GameText, type: number): string {
    switch (type) {
        case IndustryType.Energy: return getText(text, 'Energy');
        case IndustryType.HighTech: return getText(text, 'HighTech');
        case IndustryType.Weapon: return getText(text, 'Weapons');
        case IndustryType.Undefined: return getText(text, 'None');
        default: return splitString(String(type)); // Enum.ToString of an undefined value = digits
    }
}

/** Port of Galaxy.2.cs ResolveDescription(ComponentCategoryType). */
function componentCategoryDescription(text: GameText, category: ComponentCategoryType): string {
    switch (category) {
        case ComponentCategoryType.WeaponIon: return getText(text, 'Component Category Ion Weapon');
        case ComponentCategoryType.WeaponPointDefense: return getText(text, 'Component Category Point Defense Weapon');
        case ComponentCategoryType.Undefined: return getText(text, 'None');
        case ComponentCategoryType.Armor:
        case ComponentCategoryType.Computer:
        case ComponentCategoryType.Construction:
        case ComponentCategoryType.EnergyCollector:
        case ComponentCategoryType.Engine:
        case ComponentCategoryType.Extractor:
        case ComponentCategoryType.Habitation:
        case ComponentCategoryType.HyperDrive:
        case ComponentCategoryType.Labs:
        case ComponentCategoryType.Manufacturer:
        case ComponentCategoryType.Reactor:
        case ComponentCategoryType.Sensor:
        case ComponentCategoryType.Shields:
        case ComponentCategoryType.Storage:
        case ComponentCategoryType.WeaponArea:
        case ComponentCategoryType.WeaponBeam:
        case ComponentCategoryType.WeaponSuperArea:
        case ComponentCategoryType.WeaponSuperBeam:
        case ComponentCategoryType.WeaponSuperTorpedo:
        case ComponentCategoryType.WeaponTorpedo:
        case ComponentCategoryType.WeaponGravity:
        case ComponentCategoryType.AssaultPod:
            return getText(text, `Component Category ${ComponentCategoryType[category]}`);
        default:
            return splitString(ComponentCategoryType[category] ?? String(category));
    }
}

/** Galaxy.2.cs ResolveDescription(ComponentType): GameText key suffixes. */
const COMPONENT_TYPE_KEYS: Partial<Record<ComponentType, string>> = {
    [ComponentType.SensorStealth]: 'Stealth',
    [ComponentType.DamageControl]: 'Damage Control',
    [ComponentType.ComputerCommandCenter]: 'Command Center',
    [ComponentType.ComputerCommerceCenter]: 'Commerce Center',
    [ComponentType.ComputerCountermeasures]: 'Countermeasures',
    [ComponentType.ComputerTargetting]: 'Targetting',
    [ComponentType.ConstructionBuild]: 'Construction Yard',
    [ComponentType.EngineMainThrust]: 'Main Thrust Engine',
    [ComponentType.EngineVectoring]: 'Vectoring Engine',
    [ComponentType.ExtractorGasExtractor]: 'Gas Extractor',
    [ComponentType.ExtractorLuxury]: 'Luxury Resource Extractor',
    [ComponentType.ExtractorMine]: 'Mine',
    [ComponentType.HabitationColonization]: 'Colony',
    [ComponentType.HabitationHabModule]: 'Habitation Module',
    [ComponentType.HabitationLifeSupport]: 'Life Support',
    [ComponentType.HabitationMedicalCenter]: 'Medical Center',
    [ComponentType.HabitationRecreationCenter]: 'Recreation Center',
    [ComponentType.LabsEnergyLab]: 'Energy Lab',
    [ComponentType.LabsHighTechLab]: 'HighTech Lab',
    [ComponentType.LabsWeaponsLab]: 'Weapons Lab',
    [ComponentType.ManufacturerEnergyPlant]: 'Energy Manufacturer',
    [ComponentType.ManufacturerHighTechPlant]: 'HighTech Manufacturer',
    [ComponentType.ManufacturerWeaponsPlant]: 'Weapons Manufacturer',
    [ComponentType.SensorProximityArray]: 'Proximity Array',
    [ComponentType.SensorResourceProfileSensor]: 'Resource Profile Sensor',
    [ComponentType.SensorLongRange]: 'Long Range Scanner',
    [ComponentType.StorageCargo]: 'Cargo Module',
    [ComponentType.StorageDockingBay]: 'Docking Bay',
    [ComponentType.StorageFuel]: 'Fuel Storage Cell',
    [ComponentType.StorageTroop]: 'Troop Module',
    [ComponentType.WeaponAreaDestruction]: 'Area Weapon',
    [ComponentType.WeaponSuperArea]: 'Super Area Weapon',
    [ComponentType.WeaponSuperBeam]: 'Super Beam Weapon',
    [ComponentType.WeaponSuperTorpedo]: 'Super Torpedo Weapon',
    [ComponentType.WeaponSuperMissile]: 'Super Missile Weapon',
    [ComponentType.WeaponSuperRailGun]: 'Super RailGun Weapon',
    [ComponentType.WeaponSuperPhaser]: 'Super Phaser Weapon',
    [ComponentType.WeaponMissile]: 'Missile Weapon',
    [ComponentType.WeaponPointDefense]: 'Point Defense',
    [ComponentType.WeaponIonCannon]: 'Ion Cannon',
    [ComponentType.WeaponIonPulse]: 'Ion Pulse',
    [ComponentType.WeaponIonDefense]: 'Ion Defense',
    [ComponentType.HyperDeny]: 'HyperDeny Weapon',
    [ComponentType.HyperStop]: 'HyperStop',
    [ComponentType.FighterBay]: 'Fighter Bay',
    [ComponentType.SensorTraceScanner]: 'Sensor TraceScanner',
    [ComponentType.SensorScannerJammer]: 'Sensor ScannerJammer',
    [ComponentType.ComputerTargettingFleet]: 'Targetting Fleet',
    [ComponentType.ComputerCountermeasuresFleet]: 'Countermeasures Fleet',
    [ComponentType.AssaultPod]: 'Assault Pod',
    [ComponentType.WeaponTractorBeam]: 'Tractor Beam Weapon',
    [ComponentType.WeaponAreaGravity]: 'Gravity Area Weapon',
    [ComponentType.WeaponGravityBeam]: 'Gravity Beam Weapon',
    [ComponentType.WeaponBombard]: 'Bombard Weapon',
    [ComponentType.WeaponBeam]: 'Beam Weapon',
    [ComponentType.WeaponTorpedo]: 'Torpedo Weapon',
    [ComponentType.Shields]: 'Shields',
    [ComponentType.HyperDrive]: 'HyperDrive',
};

/** Port of Galaxy.2.cs ResolveDescription(ComponentType). */
function componentTypeDescription(text: GameText, type: ComponentType): string {
    const key = COMPONENT_TYPE_KEYS[type];
    return key !== undefined ? getText(text, `Component Type ${key}`) : splitString(ComponentType[type] ?? String(type));
}

/** Port of Galaxy.2.cs ResolveDescription(CharacterTraitType): "Character
 *  Trait <name>", the Intelligence* variants sharing the plain trait's text. */
function characterTraitDescription(text: GameText, trait: CharacterTraitType): string {
    if (trait === CharacterTraitType.Undefined) return getText(text, 'None');
    const name = CharacterTraitType[trait];
    return name ? getText(text, `Character Trait ${name.replace(/^Intelligence/, '')}`) : '';
}

/** ColonyResourceEffect member names (ColonyResourceEffect.cs, value = index). */
const COLONY_RESOURCE_EFFECTS = [
    'Undefined', 'Happiness', 'Development', 'ConstructionSpeed', 'RecruitedTroopStrength', 'ResearchWeapons',
    'ResearchEnergy', 'ResearchHighTech', 'PopulationGrowthRate', 'WarWearinessReduction', 'IncomeBoost',
    'BaseMaintenanceReduction',
];

/** Port of Galaxy.2.cs ResolveDescriptionGeneral(ResourceBonus). */
function resourceBonusDescriptionGeneral(text: GameText, bonus: ResourceBonus, resources: ReadonlyArray<Resource>): string {
    const effect = COLONY_RESOURCE_EFFECTS[bonus.effect];
    if (!effect || effect === 'Undefined') return '';
    const name = resources.find((r) => r.resourceId === bonus.resourceId)?.name ?? '';
    const key = `Race Resource Bonus General ${effect}${bonus.appliesOnlyToSources ? ' Source' : ''}`;
    return format(getText(text, key), name, fmt0(bonus.value));
}

/** Race victory condition types whose text is formatted with Amount ("0"). */
const VICTORY_AMOUNT_FORMAT = new Set<RaceVictoryConditionType>([
    RaceVictoryConditionType.PirateControlColoniesPercentage,
    RaceVictoryConditionType.ControlRestrictedResourceSupply,
    RaceVictoryConditionType.EnslavePopulationProportionEmpire,
    RaceVictoryConditionType.ExploreGalaxyPercentage,
    RaceVictoryConditionType.FreeTradeAgreementsFormedProportionAllEmpires,
    RaceVictoryConditionType.MutualDefensePactsFormedProportionAllEmpires,
]);

/** Port of Galaxy.2.cs ResolveDescription(RaceVictoryCondition, Empire) with
 *  empire = null (the race summary's call). */
function victoryConditionDescription(text: GameText, c: RaceVictoryCondition, facilities: ReadonlyArray<Facility>): string {
    const T = (key: string): string => getText(text, `Race Victory Condition ${key}`);
    const name = RaceVictoryConditionType[c.type];
    switch (c.type) {
        case RaceVictoryConditionType.Undefined:
            return '';
        case RaceVictoryConditionType.BuildWonder: {
            const f = c.additionalData !== null ? facilities[c.additionalData] : undefined;
            return f ? format(T('BuildWonder'), f.name) : '';
        }
        case RaceVictoryConditionType.ControlHomeworld:
            return format(T('ControlHomeworld'), '');
        case RaceVictoryConditionType.ControlLargestColoniesByType:
        case RaceVictoryConditionType.ControlPlanetTypePercentage:
            return c.additionalData !== null ? format(T(name), fmt0(c.amount), habitatTypeDescription(text, c.additionalData)) : '';
        case RaceVictoryConditionType.DestroyMoreEnemyTroopsThanLoseTimesFactor:
        case RaceVictoryConditionType.DestroyMoreShipsThanLoseTimesFactor:
            if (c.amount === 1.0) return T(`${name}Single`);
            return format(T(name), c.amount % 1.0 !== 0 ? fmt01(c.amount) : fmt0(c.amount));
        case RaceVictoryConditionType.DestroyMostCreaturesByType:
            return c.additionalData !== null ? format(T(name), creatureTypeDescription(text, c.additionalData)) : '';
        case RaceVictoryConditionType.ResearchMostCompletedBranchesByIndustry:
            return c.additionalData !== null ? format(T(name), industryTypeDescription(text, c.additionalData)) : '';
        case RaceVictoryConditionType.LeastWarsStarted:
            return T('LeastWars');
        default:
            if (name === undefined) return '';
            return VICTORY_AMOUNT_FORMAT.has(c.type) ? format(T(name), fmt0(c.amount)) : T(name);
    }
}

/** Port of Galaxy.cs ResolveRaceChangeQualitiesDescription (the "Original"
 *  levels are the race file values). */
function raceChangeQualitiesDescription(text: GameText, race: Race): string {
    const parts: string[] = [];
    const cmp = (periodic: number, original: number, up: string, down: string): void => {
        if (periodic > original) parts.push(getText(text, up));
        else if (periodic < original) parts.push(getText(text, down));
    };
    cmp(race.periodicAggressionLevel, race.aggression, 'increased aggression', 'decreased aggression');
    cmp(race.periodicCautionLevel, race.caution, 'increased caution', 'decreased caution');
    cmp(race.periodicFriendlinessLevel, race.friendliness, 'increased friendliness', 'decreased friendliness');
    cmp(race.periodicGrowthRate, race.reproductionRate, 'increased population growth', 'decreased population growth');
    return parts.join(', ');
}

/** Port of Galaxy.4.cs DetermineComponentCategoryByIndex (research.txt Category). */
function determineComponentCategoryByIndex(index: number): ComponentCategoryType {
    const map: ComponentCategoryType[] = [
        ComponentCategoryType.Armor, ComponentCategoryType.AssaultPod, ComponentCategoryType.Computer,
        ComponentCategoryType.Construction, ComponentCategoryType.EnergyCollector, ComponentCategoryType.Engine,
        ComponentCategoryType.Extractor, ComponentCategoryType.Fighter, ComponentCategoryType.Habitation,
        ComponentCategoryType.HyperDisrupt, ComponentCategoryType.HyperDrive, ComponentCategoryType.Labs,
        ComponentCategoryType.Manufacturer, ComponentCategoryType.Reactor, ComponentCategoryType.Sensor,
        ComponentCategoryType.ShieldRecharge, ComponentCategoryType.Shields, ComponentCategoryType.Storage,
        ComponentCategoryType.WeaponArea, ComponentCategoryType.WeaponBeam, ComponentCategoryType.WeaponGravity,
        ComponentCategoryType.WeaponIon, ComponentCategoryType.WeaponPointDefense, ComponentCategoryType.WeaponSuperArea,
        ComponentCategoryType.WeaponSuperBeam, ComponentCategoryType.WeaponTorpedo, ComponentCategoryType.WeaponSuperTorpedo,
    ];
    return map[index] ?? ComponentCategoryType.Undefined;
}

/** facilities.txt codes (PlanetaryFacilityDefinitionList.cs LoadFromFile):
 *  Type 8 = PlanetaryFacilityType.Wonder, WonderType 12 = WonderType.RaceAchievement. */
const FACILITY_TYPE_WONDER = 8;
const WONDER_TYPE_RACE_ACHIEVEMENT = 12;

/**
 * The research projects (indices into `research`) whose AllowedRaces contain
 * `race` after Galaxy.3.cs SetResearchRaceSpecialProjects(races) — the steps
 * that concern this race, in order: specified races (ALLOWED RACES, matched
 * case-insensitively against the loaded races as RaceList[name] does), the
 * race's SpecialComponent (every project unlocking or improving it), the
 * first project building each of its BuildWonder race-achievement wonders,
 * then removal for its DisallowedResearchAreas / DisallowedComponents.
 */
function resolveRaceAllowedProjects(
    race: Race,
    races: ReadonlyArray<Race>,
    research: ReadonlyArray<ResearchNode>,
    components: ReadonlyArray<Component>,
    facilities: ReadonlyArray<Facility>,
): Set<number> {
    const lower = (s: string): string => s.toLowerCase();
    const allowed = new Set<number>();
    research.forEach((node, i) => {
        if (node.allowedRaces.some((n) => races.find((r) => lower(r.name) === lower(n)) === race)) allowed.add(i);
    });
    // Galaxy.ResolveSpecialComponent: 0 <= code < ComponentDefinitionsStatic.Length.
    const special = race.specialComponent;
    if (special >= 0 && special < components.length) {
        research.forEach((node, i) => {
            if (node.components.includes(special) || node.componentImprovements.some((ci) => ci.componentId === special)) allowed.add(i);
        });
    }
    for (const c of race.victoryConditions) {
        if (c.type !== RaceVictoryConditionType.BuildWonder || c.additionalData === null) continue;
        const f = facilities[c.additionalData];
        if (!f || f.type !== FACILITY_TYPE_WONDER || f.wonderType !== WONDER_TYPE_RACE_ACHIEVEMENT) continue;
        const i = research.findIndex((node) => node.facilityId === f.facilityId);
        if (i >= 0) allowed.add(i);
    }
    research.forEach((node, i) => {
        if (race.disallowedResearchAreas.includes(determineComponentCategoryByIndex(node.category))) allowed.delete(i);
    });
    // Race.cs DisallowedComponentIds: 0 <= id < ComponentDefinitionsStatic.Length.
    const disallowed = race.disallowedComponentIds.filter((id) => id < components.length);
    if (disallowed.length > 0) {
        research.forEach((node, i) => {
            if (node.components.some((id) => disallowed.includes(id)) || node.componentImprovements.some((ci) => disallowed.includes(ci.componentId))) {
                allowed.delete(i);
            }
        });
    }
    return allowed;
}

/** Port of ResearchNodeDefinitionList.cs ResolveRaceSpecificComponents(race)
 *  (includeImprovements = false): the components of every project whose
 *  AllowedRaces contains the race, in project order (duplicates kept). */
export function resolveRaceSpecificComponents(
    race: Race,
    races: ReadonlyArray<Race>,
    research: ReadonlyArray<ResearchNode>,
    components: ReadonlyArray<Component>,
    facilities: ReadonlyArray<Facility>,
): Component[] {
    const allowed = resolveRaceAllowedProjects(race, races, research, components, facilities);
    const out: Component[] = [];
    for (let i = 0; i < research.length; i++) {
        if (!allowed.has(i)) continue;
        for (const id of research[i].components) {
            const c = components[id]; // new Component(id) -> ComponentDefinitionsStatic[id]
            if (c) out.push(c);
        }
    }
    return out;
}

/** Static game data GenerateRaceSummary reads (the C# statics
 *  ResourceSystem, GovernmentsStatic, ResearchNodeDefinitionsStatic,
 *  ComponentDefinitionsStatic, PlanetaryFacilityDefinitionsStatic and the
 *  galaxy's race list). Missing lists behave as empty. */
export interface RaceSummaryData {
    races?: ReadonlyArray<Race>;
    resources?: ReadonlyArray<Resource>;
    governments?: ReadonlyArray<Government>;
    research?: ReadonlyArray<ResearchNode>;
    components?: ReadonlyArray<Component>;
    facilities?: ReadonlyArray<Facility>;
}

/** Character roles in GenerateRaceSummary's order: race field suffix and
 *  the ResolveDescription(CharacterRole) GameText key. */
const SUMMARY_ROLES = [
    ['Leader', 'Leader'],
    ['Ambassador', 'Ambassador'],
    ['Governor', 'Colony Governor'],
    ['Admiral', 'Fleet Admiral'],
    ['General', 'Troop General'],
    ['Scientist', 'Scientist'],
    ['IntelligenceAgent', 'Intelligence Agent'],
    ['PirateLeader', 'Pirate Leader'],
    ['ShipCaptain', 'Ship Captain'],
] as const;

/** Colony habitat types in GenerateRaceSummary's order (race field suffix). */
const SUMMARY_COLONY_TYPES = [
    ['Continental', HabitatType.Continental],
    ['MarshySwamp', HabitatType.MarshySwamp],
    ['Ocean', HabitatType.Ocean],
    ['Desert', HabitatType.Desert],
    ['Ice', HabitatType.Ice],
    ['Volcanic', HabitatType.Volcanic],
] as const;

/**
 * Port of Galaxy.2.cs GenerateRaceSummary: general (family, native planet
 * type, reproduction rate), Characteristics (Galaxy.cs
 * ResolveRaceCharacteristics), Bonuses (ResolveRaceBonuses), Resource
 * Bonuses, Race Victory Conditions, Colonies, Characters and Other.
 */
export function generateRaceSummary(
    text: GameText,
    race: Race,
    families: ReadonlyArray<RaceFamily>,
    data: RaceSummaryData = {},
): RaceSummarySection[] {
    const sections: RaceSummarySection[] = [];
    const family = families.find((f) => f.raceFamilyId === race.raceFamily)?.name ?? '';
    sections.push({
        heading: '',
        items: [
            `${getText(text, 'Race Family')}: ${family}`,
            `${getText(text, 'Native Planet Type')}: ${habitatTypeDescription(text, race.nativeHabitatType)}`,
            `${getText(text, 'Default Reproduction Rate')}: ${pct(race.reproductionRate - 1, true)}`,
        ],
    });
    const tpl = getText(text, 'Racial Characteristic INTENSITY QUALITY');
    const ch = (level: number, low: string, high: string): string =>
        format(tpl, characteristicIntensity(text, level), getText(text, level < 100 ? low : high));
    sections.push({
        heading: getText(text, 'Characteristics'),
        items: [
            ch(race.aggression, 'Passive', 'Aggressive'),
            ch(race.caution, 'Reckless', 'Cautious'),
            ch(race.friendliness, 'Unfriendly', 'Friendly'),
            ch(race.intelligence, 'Stupid', 'Intelligent'),
            ch(race.loyalty, 'Unreliable', 'Dependable'),
        ],
    });
    const bonuses: string[] = [];
    const bonus = (value: number, key: string, sign: '+' | '-'): void => {
        if (value > 0) bonuses.push(format(getText(text, key), sign + pct(value / 100, false)));
    };
    bonus(race.espionageBonus, 'Espionage Ability Bonus', '+');
    bonus(race.researchBonus, 'Research Ability Bonus', '+');
    bonus(race.resourceExtractionBonus, 'Resource Extraction Ability Bonus', '+');
    bonus(race.satisfactionModifier, 'Satisfaction Ability Bonus', '+');
    bonus(race.shipMaintenanceSavings, 'Ship Maintenance Ability Bonus', '-');
    bonus(race.troopMaintenanceSavings, 'Troop Maintenance Ability Bonus', '-');
    bonus(race.warWearinessAttenuation, 'War Weariness Ability Bonus', '-');
    bonus(race.tradeBonus, 'Trade Ability Bonus', '+');
    if (bonuses.length > 0) sections.push({ heading: getText(text, 'Bonuses'), items: bonuses });

    const T = (key: string): string => getText(text, key);
    const resources = data.resources ?? [];
    const governments = data.governments ?? [];
    const components = data.components ?? [];
    const facilities = data.facilities ?? [];

    if (race.criticalResources.length > 0) {
        sections.push({
            heading: T('Resource Bonuses'),
            items: race.criticalResources.map((rb) => resourceBonusDescriptionGeneral(text, rb, resources)),
        });
    }

    if (race.victoryConditions.length > 0) {
        sections.push({
            heading: T('Race Victory Conditions'),
            items: race.victoryConditions.map((c) => `${fmt0(c.proportion)}%:  ${victoryConditionDescription(text, c, facilities)}`),
        });
    }

    const colonies: string[] = [];
    for (const [suffix, type] of SUMMARY_COLONY_TYPES) {
        const f = race[`researchColonizationCostFactor${suffix}`];
        if (f !== 1.0) colonies.push(format(T('Colonization Cost Factor Description'), habitatTypeDescription(text, type), pctPlusMinus(f - 1.0)));
    }
    for (const [suffix, type] of SUMMARY_COLONY_TYPES) {
        const f = race[`colonyConstructionSpeedFactor${suffix}`];
        if (f !== 1.0) colonies.push(format(T('Colony Construction Speed Factor Description'), habitatTypeDescription(text, type), pctPlusMinus(f - 1.0)));
    }
    if (race.colonyPopulationPolicyGrowthFactorExterminate !== 1.0) {
        colonies.push(format(T('Colony Exterminate Policy Growth Factor Description'), pctPlusMinus(race.colonyPopulationPolicyGrowthFactorExterminate - 1.0)));
    }
    if (race.immuneNaturalDisastersAtColonyType !== HabitatType.Undefined) {
        colonies.push(format(T('Colony Immune Disasters Description'), habitatTypeDescription(text, race.immuneNaturalDisastersAtColonyType)));
    }
    if (colonies.length > 0) sections.push({ heading: T('Colonies'), items: colonies });

    const characters: string[] = [];
    if (race.intelligenceAgentAdditional > 0) characters.push(`${T('Extra Intelligence Agents')}: ${race.intelligenceAgentAdditional}`);
    for (const [suffix, roleKey] of SUMMARY_ROLES) {
        const chance = race[`characterRandomAppearanceChance${suffix}`];
        if (chance < 1.0) characters.push(format(T('Character Appearance Chance Less Description'), T(roleKey), pctPlusMinus(chance - 1.0)));
        else if (chance > 1.0) characters.push(format(T('Character Appearance Chance More Description'), T(roleKey), pctPlusMinus(chance - 1.0)));
    }
    for (const [suffix, roleKey] of SUMMARY_ROLES) {
        const trait = race[`characterStartingTrait${suffix}`];
        if (trait !== CharacterTraitType.Undefined) {
            characters.push(format(T('Character Starting Trait Description'), T(roleKey), characterTraitDescription(text, trait)));
        }
    }
    if (characters.length > 0) sections.push({ heading: T('Characters'), items: characters });

    const other: string[] = [];
    // Empire.ResolveRaceSpecificGovernmentTypes: [SpecialGovernmentId] when >= 0.
    if (race.specialGovernment >= 0) {
        const g = governments[race.specialGovernment]; // GovernmentsStatic[id]
        if (g) other.push(`${T('Special Government')}: ${g.name}`);
    }
    if (race.disallowedGovernments.length > 0) {
        const names = race.disallowedGovernments.map((id) => governments[id]?.name ?? '');
        other.push(`${T('Disallowed Governments')}: ${names.join(', ')}`.replace(/[ ,]+$/, ''));
    }
    const special = resolveRaceSpecificComponents(race, data.races ?? [race], data.research ?? [], components, facilities);
    other.push(
        `${T('Special Technology')}: ${special.length > 0
            ? special.map((c) => `${c.name} (${componentTypeDescription(text, c.type)})`).join(', ')
            : `(${T('None')})`}`,
    );
    if (race.disallowedResearchAreas.length > 0) {
        const disallowedComponents = race.disallowedComponentIds.filter((id) => id < components.length);
        const flag = race.disallowedResearchAreas.some((a) => a !== ComponentCategoryType.Undefined) || disallowedComponents.length > 0;
        let tech: string;
        if (!flag) {
            tech = `(${T('None')})`;
        } else {
            const parts: string[] = [];
            for (const area of race.disallowedResearchAreas) {
                if (area === ComponentCategoryType.Undefined) continue;
                // Point defense is shown as the missile component type.
                parts.push(area === ComponentCategoryType.WeaponPointDefense
                    ? componentTypeDescription(text, ComponentType.WeaponMissile)
                    : componentCategoryDescription(text, area));
            }
            for (const id of disallowedComponents) {
                const c = components[id];
                if (c) parts.push(c.name);
            }
            tech = parts.join(', ');
        }
        other.push(`${T('Disallowed Technology')}: ${tech}`);
    }
    if (race.changePeriodYearsInterval > 0 && race.changePeriodYearsLength > 0) {
        other.push(format(
            T('Regular X-year change cycle: For Y years have CHANGES'),
            String(race.changePeriodYearsInterval),
            String(race.changePeriodYearsLength),
            raceChangeQualitiesDescription(text, race),
        ));
    }
    if (race.militaryShipSizeFactor !== 1.0) {
        const d = race.militaryShipSizeFactor - 1.0;
        other.push(race.militaryShipSizeFactor > 1.0
            ? `${T('Larger military ship sizes')}: +${pct(d, false)}`
            : `${T('Smaller military ship sizes')}: ${pct(d, false)}`);
    }
    if (race.civilianShipSizeFactor !== 1.0) {
        const d = race.civilianShipSizeFactor - 1.0;
        other.push(race.civilianShipSizeFactor > 1.0
            ? `${T('Larger civilian ship sizes')}: +${pct(d, false)}`
            : `${T('Smaller civilian ship sizes')}: ${pct(d, false)}`);
    }
    if (race.constructionSpeedModifier !== 1.0) {
        const d = race.constructionSpeedModifier - 1.0;
        other.push(d > 0 ? `${T('Faster Construction Speed')}: +${pct(d, false)}` : `${T('Slower Construction Speed')}: ${pct(d, false)}`);
    }
    const factor = (value: number, more: string, less: string): void => {
        if (value > 1.0) other.push(`${T(more)}: ${pctPlusMinus(value - 1.0)}`);
        else if (value < 1.0) other.push(`${T(less)}: ${pctPlusMinus(value - 1.0)}`);
    };
    factor(race.spaceportArmorStrengthFactor, 'Stronger Spaceport Armor', 'Weaker Spaceport Armor');
    factor(race.tourismIncomeFactor, 'Higher Tourism Income', 'Lower Tourism Income');
    factor(race.freeTradeIncomeFactor, 'Higher Trade Income', 'Lower Trade Income');
    factor(race.migrationFactor, 'Higher Migration Rate', 'Lower Migration Rate');
    factor(race.troopRegenerationFactor, 'Faster Troop Regeneration', 'Slower Troop Regeneration');
    if (race.knownStartingGalacticHistoryLocations > 1) {
        other.push(`${T('Historical Locations Known at Game Start')}: ${race.knownStartingGalacticHistoryLocations}`);
    }
    if (other.length > 0) sections.push({ heading: T('Other'), items: other });
    return sections;
}

// ---------------------------------------------------------------------------
// Context topic for the in-game help button (Main.Part5.cs btnHelp_Click).
// ---------------------------------------------------------------------------

/** GameText key of the topic the help button opens for a selected creature
 *  (btnHelp_Click's Creature branch); "Main Screen" for an unknown type. */
export function helpTopicKeyForCreature(c: { type: CreatureType } | null): string {
    switch (c?.type) {
        case CreatureType.Kaltor: return 'Giant Kaltor';
        case CreatureType.RockSpaceSlug: return 'Space Slug';
        case CreatureType.DesertSpaceSlug: return 'Sand Slug';
        case CreatureType.Ardilus: return 'Ardilus';
        case CreatureType.SilverMist: return 'SilverMist';
        default: return 'Main Screen';
    }
}

/** GameText key of the topic the help button opens for a selected habitat
 *  (btnHelp_Click's Habitat branch); "Main Screen" when nothing applies.
 *  Port of the Habitat branch order: IsBlockaded ("Blockades"), then
 *  Empire == Galaxy.IndependentEmpire ("Independent planets and Traders"),
 *  then Asteroid/GasCloud/Star category, then per-HabitatType. `isBlockaded`
 *  and `empire` are read-only, optional fields: the sim's Habitat.ts doesn't
 *  model blockades yet (see galaxy.ts's "BlockadeCount ... — need
 *  ruins/blockades/plagues/designs" TODO), and an empire counts as the
 *  independent empire when its `empireId` is 0 (Empire.cs
 *  initializeIndependentCtor: `empireId = isIndependentEmpire ? 0 : ...`).
 *  TODO(port): the rest of Main.Part5.cs btnHelp_Click — SystemInfo
 *  ("Stars"), ShipGroup ("Fleets"), BuiltObject (blockaded / pirate /
 *  independent / per-SubRole topics), Fighter, the open-screen overrides
 *  (Game Options, Designs, Research, Colonies, ... screens) and the
 *  game-editor topics. None of those selections/screens exist yet;
 *  creatures: helpTopicKeyForCreature (the selection model cannot hold a
 *  creature yet either). */
export function helpTopicKeyForHabitat(
    h:
        | ({ category: HabitatCategoryType; type: HabitatType }
              & { isBlockaded?: boolean; empire?: { empireId: number } | null })
        | null,
): string {
    if (!h) return 'Main Screen';
    if (h.isBlockaded) return 'Blockades';
    if (h.empire != null && h.empire.empireId === 0) return 'Independent planets and Traders';
    if (h.category === HabitatCategoryType.Asteroid) return 'Asteroids';
    if (h.category === HabitatCategoryType.GasCloud) return 'Gas Clouds';
    if (h.category === HabitatCategoryType.Star) return 'Stars';
    switch (h.type) {
        case HabitatType.Volcanic: return 'Volcanic Planets';
        case HabitatType.Desert: return 'Desert Planets';
        case HabitatType.MarshySwamp: return 'Marshy Swamp Planets';
        case HabitatType.Continental: return 'Continental Planets';
        case HabitatType.Ocean: return 'Ocean Planets';
        case HabitatType.BarrenRock: return 'Barren Rock Planets';
        case HabitatType.Ice: return 'Ice Planets';
        case HabitatType.GasGiant: return 'Gas Giant Planets';
        case HabitatType.FrozenGasGiant: return 'Frozen Gas Giant Planets';
        default: return 'Main Screen';
    }
}

// ---------------------------------------------------------------------------
// History (Main.Part5.cs vTtmruAejE / int_25).
// ---------------------------------------------------------------------------

export class TopicHistory<T> {
    items: T[] = [];
    index = -1;

    /** Port of method_467 / method_466: overwrite the next slot and drop any
     *  forward history, or append. */
    visit(item: T): void {
        if (this.index < this.items.length - 1) {
            this.index++;
            this.items[this.index] = item;
            this.items.length = this.index + 1;
        } else {
            this.items.push(item);
            this.index++;
        }
    }
    get canBack(): boolean {
        return this.index > 0;
    }
    get canForward(): boolean {
        return this.index < this.items.length - 1;
    }
    back(): T | null {
        if (!this.canBack) return null;
        this.index--;
        return this.items[this.index];
    }
    forward(): T | null {
        if (!this.canForward) return null;
        this.index++;
        return this.items[this.index];
    }
}

// ---------------------------------------------------------------------------
// The modal.
// ---------------------------------------------------------------------------

export interface GalactopediaOptions {
    /** Topic to open: GameText key / title, topic id or help file name.
     *  Empty = the home page (Introduction, not added to history). */
    topic?: string;
    onClose?: () => void;
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
    navigate: (topic: string) => void;
}

let open: OpenState | null = null;

export function isGalactopediaOpen(): boolean {
    return open !== null;
}

export function closeGalactopedia(): void {
    open?.close();
}

/** Open (or retarget) the Galactopedia. */
export function openGalactopedia(opts: GalactopediaOptions = {}): void {
    if (open) {
        if (opts.topic) open.navigate(opts.topic);
        return;
    }
    open = createGalactopedia(opts);
}

/** btnHelp_Click: close when visible, else open at `topic`. */
export function toggleGalactopedia(topic?: string): void {
    if (open) {
        open.close();
    } else {
        openGalactopedia({ topic });
    }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

function createGalactopedia(opts: GalactopediaOptions): OpenState {
    const root = el('div');
    root.id = 'galactopedia';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    const dim = el('div', 'gp-dim');
    const win = el('div', 'gp-window');
    root.append(dim, win);

    // Header: title | back forward home | close.
    const header = el('div', 'gp-header');
    const brand = el('div', 'gp-brand', 'Galactopedia');
    const titleEl = el('div', 'gp-topic-title', '');
    const nav = el('div', 'gp-nav');
    const mkBtn = (label: string, title: string, cls = ''): HTMLButtonElement => {
        const b = el('button', `gp-btn ${cls}`.trim(), label);
        b.type = 'button';
        b.title = title;
        b.setAttribute('aria-label', title);
        return b;
    };
    const btnBack = mkBtn('‹', 'Back (Backspace)');
    const btnForward = mkBtn('›', 'Forward');
    const btnHome = mkBtn('⌂', 'Home');
    const btnClose = mkBtn('×', 'Close (Esc)', 'gp-btn-close');
    nav.append(btnBack, btnForward, btnHome);
    header.append(brand, titleEl, nav, btnClose);

    const body = el('div', 'gp-body');
    const side = el('aside', 'gp-side');
    const search = el('input', 'gp-search');
    search.type = 'search';
    search.placeholder = 'Search topics';
    search.spellcheck = false;
    const tree = el('div', 'gp-tree');
    side.append(search, tree);

    const main = el('div', 'gp-main');
    const content = el('article', 'gp-content');
    const related = el('div', 'gp-related');
    main.append(content, related);
    body.append(side, main);
    win.append(header, body);
    document.body.appendChild(root);

    const history = new TopicHistory<EncyclopediaItem>();
    let data: GalactopediaData | null = null;
    let current: EncyclopediaItem | null = null;
    const expanded = new Set<EncyclopediaCategory>();
    let renderToken = 0;

    const updateNavButtons = (): void => {
        btnBack.disabled = !history.canBack;
        btnForward.disabled = !history.canForward;
    };

    // ---- tree ----
    const renderTree = (): void => {
        if (!data) return;
        tree.textContent = '';
        const q = search.value.trim().toLowerCase();
        for (const node of data.tree) {
            const rootMatch = q === '' || node.root.title.toLowerCase().includes(q);
            const children = q === '' ? node.children : node.children.filter((c) => c.title.toLowerCase().includes(q));
            if (q !== '' && !rootMatch && children.length === 0) continue;
            const group = el('div', 'gp-group');
            const isOpen = q !== '' ? children.length > 0 : expanded.has(node.root.category);
            const head = el('button', 'gp-cat');
            head.type = 'button';
            head.append(el('span', 'gp-caret', isOpen ? '▾' : '▸'), el('span', 'gp-cat-label', node.root.title));
            if (current === node.root) head.classList.add('gp-selected');
            head.addEventListener('click', () => {
                if (expanded.has(node.root.category) && current === node.root) expanded.delete(node.root.category);
                else expanded.add(node.root.category);
                select(node.root);
            });
            group.appendChild(head);
            if (isOpen) {
                const list = el('div', 'gp-children');
                for (const item of children) {
                    const b = el('button', 'gp-topic', item.title);
                    b.type = 'button';
                    if (item === current) b.classList.add('gp-selected');
                    b.addEventListener('click', () => select(item));
                    list.appendChild(b);
                }
                group.appendChild(list);
            }
            tree.appendChild(group);
        }
        tree.querySelector('.gp-selected')?.scrollIntoView({ block: 'nearest' });
    };

    // ---- related topics (RelatedEncyclopediaItemsBox) ----
    const renderRelated = (item: EncyclopediaItem | null): void => {
        related.textContent = '';
        const links = item ? item.relatedItems.filter((r, i, arr) => arr.indexOf(r) === i && r !== item) : [];
        if (links.length === 0) {
            related.hidden = true;
            return;
        }
        related.hidden = false;
        const label = el('div', 'gp-related-label', data ? getText(data.text, 'Related Topics') : 'Related Topics');
        const list = el('div', 'gp-related-list');
        for (const r of links) {
            const a = el('button', 'gp-chip', r.title);
            a.type = 'button';
            a.addEventListener('click', () => select(r));
            list.appendChild(a);
        }
        related.append(label, list);
    };

    // ---- content (method_459) ----
    const renderContent = async (item: EncyclopediaItem | null): Promise<void> => {
        const token = ++renderToken;
        const filename = item ? item.filename : 'default.mht';
        const topicTitle = item ? item.title : data ? getText(data.text, 'Introduction') : 'Introduction';
        titleEl.textContent = topicTitle;
        content.classList.add('gp-loading');
        const page = await loadPage(filename);
        if (token !== renderToken) return;
        content.classList.remove('gp-loading');
        content.textContent = '';
        const h = el('h1', 'gp-page-title', topicTitle);
        content.appendChild(h);
        if (!page) {
            content.appendChild(el('p', 'gp-missing', `Help page ${filename} is not available (DW:U install not found).`));
        } else {
            const wrap = el('div', 'gp-page');
            wrap.appendChild(sanitizeHelpHtml(page));
            content.appendChild(wrap);
        }
        // Race pages get the generated race summary (method_460).
        if (item && data && item.category === EncyclopediaCategory.Races && !item.isCategoryRoot) {
            const race = data.races.find((r) => r.name === item.title);
            if (race) {
                const box = el('div', 'gp-summary');
                for (const section of generateRaceSummary(data.text, race, data.raceFamilies, data.summaryData)) {
                    if (section.heading !== '') box.appendChild(el('h3', '', section.heading));
                    const ul = el('ul');
                    for (const s of section.items) ul.appendChild(el('li', '', s));
                    box.appendChild(ul);
                }
                content.appendChild(box);
            }
        }
        content.scrollTop = 0;
    };

    // method_458: show item (null = home), update related + tree selection.
    const show = (item: EncyclopediaItem | null): void => {
        current = item;
        if (item) expanded.add(item.category);
        else expanded.clear(); // home collapses the tree (method_464)
        void renderContent(item);
        renderRelated(item);
        renderTree();
        updateNavButtons();
    };

    // method_467: tree / link selection pushes history.
    const select = (item: EncyclopediaItem): void => {
        history.visit(item);
        show(item);
    };

    const navigate = (topic: string): void => {
        if (!data) return;
        const item = resolveEncyclopediaTopic(data.items, getText(data.text, topic).startsWith('KEY NOT FOUND') ? topic : getText(data.text, topic));
        if (item) select(item);
    };

    // Links inside help pages (e.g. the Resources Visual Index).
    content.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.gp-link');
        if (!a) return;
        e.preventDefault();
        const file = a.dataset.helpFile ?? '';
        if (!data || file === '') return;
        const item = resolveEncyclopediaTopic(data.items, file);
        if (item) select(item);
    });

    btnBack.addEventListener('click', () => {
        const it = history.back();
        if (it) show(it);
    });
    btnForward.addEventListener('click', () => {
        const it = history.forward();
        if (it) show(it);
    });
    btnHome.addEventListener('click', () => show(null));
    search.addEventListener('input', () => renderTree());
    search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && data) {
            const first = tree.querySelector<HTMLButtonElement>('.gp-topic') ?? tree.querySelector<HTMLButtonElement>('.gp-cat');
            first?.click();
        }
    });

    // Keyboard: the original ignores game keys while the panel is visible
    // (Main.Part7.cs / Start.1.cs KeyDown guards). Capture phase so the game's
    // window listeners never see them.
    const onKey = (e: KeyboardEvent): void => {
        const typing = e.target === search;
        if (e.key === 'Escape') {
            if (typing && search.value !== '') {
                search.value = '';
                renderTree();
            } else {
                close();
            }
        } else if (e.key === 'F1') {
            e.preventDefault();
            close();
        } else if (e.key === 'Backspace' && !typing) {
            e.preventDefault();
            btnBack.click();
        } else if (e.altKey && e.key === 'ArrowLeft') {
            btnBack.click();
        } else if (e.altKey && e.key === 'ArrowRight') {
            btnForward.click();
        } else if (e.key === '/' && !typing) {
            e.preventDefault();
            search.focus();
        }
        e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    dim.addEventListener('click', () => close());
    btnClose.addEventListener('click', () => close());

    const close = (): void => {
        window.removeEventListener('keydown', onKey, true);
        root.remove();
        open = null;
        opts.onClose?.();
    };

    content.appendChild(el('p', 'gp-missing', 'Loading…'));
    updateNavButtons();
    getData()
        .then((d) => {
            data = d;
            // method_456 / method_127: history starts with the requested topic.
            let item: EncyclopediaItem | null = null;
            if (opts.topic) {
                const key = getText(d.text, opts.topic);
                item = resolveEncyclopediaTopic(d.items, key.startsWith('KEY NOT FOUND') ? opts.topic : key);
            }
            if (item) history.visit(item);
            show(item);
        })
        .catch((err) => {
            console.error('Galactopedia failed to load', err);
            content.textContent = '';
            content.appendChild(el('p', 'gp-missing', 'The Galactopedia needs the DW:U install (GameText.txt, Help/).'));
        });

    return { root, close, navigate };
}
