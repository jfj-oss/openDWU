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
    type EncyclopediaItem,
    type EncyclopediaTreeNode,
    type GameText,
} from '../../sim/data/gameText';
import { loadGameData, type GameData } from '../../sim/data/gameData';
import type { Race } from '../../sim/data/races';
import type { RaceFamily } from '../../sim/data/raceFamilies';
import { HabitatCategoryType, HabitatType } from '../../sim/types';
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
async function helpFileExists(file: string): Promise<boolean> {
    try {
        const r = await fetch(`${HELP}${file}`, { method: 'HEAD' });
        return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
    } catch {
        return false;
    }
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
    await Promise.all(
        [...candidates].map(async (f) => {
            if (await helpFileExists(f)) existing.add(f.toLowerCase());
        }),
    );
    const items = buildEncyclopediaItems(text, {
        resources: gameData?.resources ?? [],
        races: gameData?.races ?? [],
        governments: gameData?.governments ?? [],
        helpFileExists: (f) => existing.has(f.toLowerCase()),
    });
    return {
        text,
        items,
        tree: buildEncyclopediaTree(items),
        races: gameData?.races ?? [],
        raceFamilies: gameData?.raceFamilies ?? [],
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

/** Port of method_459's file resolution: Help/<file>, then the DE_/FR_/ES_
 *  localized fallbacks. */
function loadPage(filename: string): Promise<LoadedPage | null> {
    const key = filename.toLowerCase();
    let p = pageCache.get(key);
    if (!p) {
        p = (async () => {
            for (const prefix of ['', 'DE_', 'FR_', 'ES_']) {
                try {
                    const r = await fetch(`${HELP}${prefix}${filename}`);
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

/** C# ToString("0%") / ("+0%"): value * 100 rounded half away from zero. */
function pct(value: number, signed: boolean): string {
    const n = Math.sign(value) * Math.round(Math.abs(value * 100));
    return `${signed && n >= 0 ? '+' : ''}${n}%`;
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

/** HabitatType description keys (Galaxy.2.cs ResolveDescription(HabitatType)). */
function habitatTypeDescription(text: GameText, type: number): string {
    const name = HabitatType[type];
    return name ? getText(text, `HabitatType ${name}`) : '';
}

/**
 * Port of the first sections of Galaxy.2.cs GenerateRaceSummary: general
 * (family, native planet type, reproduction rate), Characteristics
 * (Galaxy.cs ResolveRaceCharacteristics) and Bonuses (ResolveRaceBonuses).
 * TODO(port): Resource Bonuses, Race Victory Conditions, Colonies,
 * Characters and Other sections — Galaxy.2.cs GenerateRaceSummary.
 */
export function generateRaceSummary(text: GameText, race: Race, families: ReadonlyArray<RaceFamily>): RaceSummarySection[] {
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
    return sections;
}

// ---------------------------------------------------------------------------
// Context topic for the in-game help button (Main.Part5.cs btnHelp_Click).
// ---------------------------------------------------------------------------

/** GameText key of the topic the help button opens for a selected habitat
 *  (btnHelp_Click's Habitat branch); "Main Screen" when nothing applies.
 *  TODO(port): the ship/fleet/creature/open-screen branches — Main.Part5.cs
 *  btnHelp_Click (no such selections/screens exist yet). */
export function helpTopicKeyForHabitat(h: { category: HabitatCategoryType; type: HabitatType } | null): string {
    if (!h) return 'Main Screen';
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
                for (const section of generateRaceSummary(data.text, race, data.raceFamilies)) {
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
