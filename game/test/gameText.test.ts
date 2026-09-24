import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    buildEncyclopediaItems,
    buildEncyclopediaTree,
    EncyclopediaCategory,
    findEncyclopediaItem,
    getText,
    parseGameText,
    removeSpecialCharacters,
    resolveEncyclopediaTopic,
    splitString,
} from '../src/sim/data/gameText';
import { parseRace } from '../src/sim/data/races';
import { parseResources } from '../src/sim/data/resources';
import { parseGovernments } from '../src/sim/data/governments';
import { decodeQuotedPrintable, findMhtPart, parseMht } from '../src/ui/screens/mht';
import { generateRaceSummary, helpTopicKeyForCreature, helpTopicKeyForHabitat, TopicHistory } from '../src/ui/screens/galactopedia';
import { parseRaceFamilies } from '../src/sim/data/raceFamilies';
import { parseResearch } from '../src/sim/data/research';
import { parseComponents } from '../src/sim/data/components';
import { parseFacilities } from '../src/sim/data/facilities';
import { CreatureType } from '../src/sim/creature';
import { HabitatCategoryType, HabitatType } from '../src/sim/types';

const dwuRoot = resolve(__dirname, '../public/assets/dwu');
const readDwu = (rel: string): string => readFileSync(resolve(dwuRoot, rel), 'utf-8');
const helpFiles = new Set(readdirSync(resolve(dwuRoot, 'Help')).map((f) => f.toLowerCase()));
const helpExists = (f: string): boolean => helpFiles.has(f.toLowerCase());

const { text, duplicates } = parseGameText(readDwu('GameText.txt'));
const races = readdirSync(resolve(dwuRoot, 'races'))
    .filter((f) => f.endsWith('.txt'))
    .map((f) => parseRace(readFileSync(resolve(dwuRoot, 'races', f), 'utf-8')));
const resources = parseResources(readDwu('resources.txt'));
const governments = parseGovernments(readDwu('governments.txt'));
const items = buildEncyclopediaItems(text, { races, resources, governments, helpFileExists: helpExists });

describe('parseGameText (TextResolver.LoadText)', () => {
    it('parses the real GameText.txt without duplicate keys', () => {
        expect(text.size).toBeGreaterThan(3000);
        expect(duplicates).toEqual([]);
    });
    it('splits on the first ";" and trims', () => {
        expect(getText(text, 'Galactopedia')).toBe('Galactopedia');
        expect(getText(text, 'Racial Characteristic INTENSITY QUALITY')).toBe('{0} {1}');
        expect(getText(text, 'no such key')).toBe("KEY NOT FOUND: 'no such key'");
    });
    it('handles comments, BOM and \\n escapes', () => {
        const p = parseGameText("﻿'comment\r\nA\t\t;x;y\r\n  'indented comment\r\nB ;line1\\nline2\r\n;novalue\r\n");
        expect(p.text.get('A')).toBe('x;y');
        expect(p.text.get('B')).toBe('line1\nline2');
        expect(p.text.size).toBe(2);
    });
});

describe('buildEncyclopediaItems (Main.Part5.cs method_465)', () => {
    it('resolves every hard-coded title through GameText', () => {
        expect(items.filter((i) => i.title.startsWith('KEY NOT FOUND'))).toEqual([]);
    });
    it('has the 11 category roots, sorted in the tree', () => {
        const tree = buildEncyclopediaTree(items);
        expect(tree.map((n) => n.root.title)).toEqual([
            'Alien Races', 'Components', 'Finding Your Way Around', 'Game Concepts', 'Game Editor',
            'Game Screens', 'Government Types', 'Planet and Star Types', 'Resources', 'Ships and Bases', 'Space Creatures',
        ]);
        const planets = tree.find((n) => n.root.category === EncyclopediaCategory.PlanetsAndStars)!;
        expect(planets.children[0].title).toBe('Asteroids');
        expect(planets.children.length).toBe(13);
    });
    it('every base topic points at an existing help file', () => {
        const missing = items.filter((i) => !helpExists(i.filename)).map((i) => i.filename);
        expect(missing).toEqual([]);
    });
    it('adds data-driven race / resource / government topics', () => {
        const human = findEncyclopediaItem(items, 'Human')!;
        expect(human.category).toBe(EncyclopediaCategory.Races);
        expect(human.filename).toBe('Race_Human.mht');
        expect(human.relatedItems.map((r) => r.title)).toEqual(['Continental Planets', 'Alien Races']);
        expect(findEncyclopediaItem(items, 'Continental Planets')!.relatedItems.map((r) => r.title)).toContain('Human');
        const res = items.filter((i) => i.category === EncyclopediaCategory.Resources && !i.isCategoryRoot);
        expect(res.length).toBeGreaterThan(30);
        const gov = findEncyclopediaItem(items, 'Corporate Nationalism')!;
        expect(gov.category).toBe(EncyclopediaCategory.GovernmentTypes);
        expect(gov.relatedItems.map((r) => r.title)).toEqual(['Government Types', 'Diplomacy']);
    });
    it('links fuel resources both ways with Fuel', () => {
        const fuel = findEncyclopediaItem(items, 'Fuel')!;
        const fuelResources = resources.filter((r) => r.isFuel && helpExists(`Resource_${removeSpecialCharacters(r.name)}.mht`));
        expect(fuelResources.length).toBeGreaterThan(0);
        for (const r of fuelResources) {
            expect(fuel.relatedItems.map((x) => x.title)).toContain(r.name);
        }
    });
    it('keeps the original related-topic order (explicit pairs, loops, pairs)', () => {
        const colonyGrowth = findEncyclopediaItem(items, 'Colony Growth')!;
        expect(colonyGrowth.relatedItems.slice(0, 4).map((r) => r.title)).toEqual([
            'Colony Taxes', 'Colony Population Policies', 'Economy Tips', 'Colony Approval',
        ]);
        const armor = findEncyclopediaItem(items, 'Armor')!;
        expect(armor.relatedItems.map((r) => r.title)).toEqual(['Components', 'Ship Designs']);
        // L["Components"] is the category root (first match), which gets the links.
        const componentsRoot = findEncyclopediaItem(items, 'Components')!;
        expect(componentsRoot.isCategoryRoot).toBe(true);
        expect(componentsRoot.relatedItems.map((r) => r.title)).toEqual(['Research', 'Ship Designs', 'Resources']);
    });
    it('adds no theme / game-info topics for the stock install', () => {
        expect(items.filter((i) => i.category === EncyclopediaCategory.Theme || i.category === EncyclopediaCategory.GameInfo)).toEqual([]);
        expect(helpFiles.has('gameinfo_default.mht')).toBe(false);
    });
    it('AddThemeTopics: root + main theme topic, one topic per <set>_*.mht', () => {
        const built = buildEncyclopediaItems(text, {
            helpFileExists: helpExists,
            helpListing: { customizationSetName: 'Mass Effect', themeRootExists: true, themeFiles: ['Mass Effect_TheReapers.mht', 'Mass Effect_Races.mht'] },
        });
        const theme = built.filter((i) => i.category === EncyclopediaCategory.Theme);
        expect(theme.map((i) => [i.title, i.filename, i.isCategoryRoot])).toEqual([
            ['Mass Effect Theme', 'Mass Effect.mht', true],
            ['Mass Effect Theme', 'Mass Effect.mht', false],
            ['The Reapers', 'Mass Effect_TheReapers.mht', false],
            ['Races', 'Mass Effect_Races.mht', false],
        ]);
        expect(theme[0].relatedItems.map((i) => i.title)).toEqual(['The Reapers', 'Races']);
        expect(theme[2].relatedItems).toEqual([theme[1]]);
        // No <set>.mht: the first listed file becomes the theme page (and is still listed).
        const noRoot = buildEncyclopediaItems(text, {
            helpFileExists: helpExists,
            helpListing: { customizationSetName: 'X', themeFiles: ['X_Intro.mht'] },
        }).filter((i) => i.category === EncyclopediaCategory.Theme);
        expect(noRoot.map((i) => [i.title, i.filename])).toEqual([['X Theme', 'X_Intro.mht'], ['X Theme', 'X_Intro.mht'], ['Intro', 'X_Intro.mht']]);
        // No customization set: nothing.
        expect(buildEncyclopediaItems(text, { helpFileExists: helpExists, helpListing: { themeFiles: ['X_Intro.mht'] } })
            .some((i) => i.category === EncyclopediaCategory.Theme)).toBe(false);
    });
    it('AddGameInfoTopics: Game Info root from GameInfo_Default.mht or the first file', () => {
        const withDefault = buildEncyclopediaItems(text, {
            helpFileExists: helpExists,
            helpListing: { gameInfoDefaultExists: true, gameInfoFiles: ['GameInfo_Default.mht', 'GameInfo_StoryLine.mht'] },
        }).filter((i) => i.category === EncyclopediaCategory.GameInfo);
        expect(withDefault.map((i) => [i.title, i.filename, i.isCategoryRoot])).toEqual([
            ['Game Info', 'GameInfo_Default.mht', true],
            ['Game Info', 'GameInfo_Default.mht', false],
            ['Story Line', 'GameInfo_StoryLine.mht', false],
        ]);
        const noDefault = buildEncyclopediaItems(text, {
            helpFileExists: helpExists,
            helpListing: { gameInfoFiles: ['GameInfo_MapNotes.mht', 'GameInfo_Rules.mht'] },
        }).filter((i) => i.category === EncyclopediaCategory.GameInfo);
        expect(noDefault.map((i) => [i.title, i.filename, i.isCategoryRoot])).toEqual([
            ['Game Info', 'GameInfo_MapNotes.mht', true],
            ['Map Notes', 'GameInfo_MapNotes.mht', false],
            ['Rules', 'GameInfo_Rules.mht', false],
        ]);
    });
    it('splitString follows Galaxy.SplitString', () => {
        expect(splitString('StoryLine')).toBe('Story Line');
        expect(splitString('abcDef')).toBe('Def');
        expect(splitString('HyperDisrupt')).toBe('Hyper Disrupt');
        expect(splitString('12')).toBe('');
    });
    it('resolves ?topic= by id, title and file name', () => {
        expect(resolveEncyclopediaTopic(items, 'ocean-planets')?.title).toBe('Ocean Planets');
        expect(resolveEncyclopediaTopic(items, 'combat - space battles')?.title).toBe('Combat - Space Battles');
        expect(resolveEncyclopediaTopic(items, 'Planet_Ocean')?.title).toBe('Ocean Planets');
        expect(resolveEncyclopediaTopic(items, 'Component_Overview.mht')?.isCategoryRoot).toBe(false);
        expect(resolveEncyclopediaTopic(items, 'components')?.isCategoryRoot).toBe(true);
        expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    });
});

describe('mht reader', () => {
    it('decodes quoted-printable', () => {
        expect(Array.from(decodeQuotedPrintable('a=3Db=\r\nc=92'))).toEqual([97, 61, 98, 99, 0x92]);
    });
    it('parses a real help page with images', () => {
        const buf = new Uint8Array(readFileSync(resolve(dwuRoot, 'Help', 'Planet_Ocean.mht')));
        const doc = parseMht(buf);
        expect(doc.html).toContain('<body');
        expect(doc.htmlLocation).toMatch(/Planet_Ocean\.htm$/);
        const img = findMhtPart(doc, 'Planet_Ocean_files/image002.png');
        expect(img?.contentType).toBe('image/png');
        // PNG signature
        expect(Array.from(img!.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });
    it('decodes windows-1252 punctuation', () => {
        const buf = new Uint8Array(readFileSync(resolve(dwuRoot, 'Help', 'default.mht')));
        const doc = parseMht(buf);
        expect(doc.html).toContain('Distant Worlds is a big, deep');
    });
});

describe('galactopedia helpers', () => {
    it('TopicHistory follows method_467 (overwrite next slot, drop forward)', () => {
        const h = new TopicHistory<string>();
        h.visit('a');
        h.visit('b');
        h.visit('c');
        expect(h.back()).toBe('b');
        expect(h.back()).toBe('a');
        expect(h.canBack).toBe(false);
        h.visit('d');
        expect(h.items).toEqual(['a', 'd']);
        expect(h.canForward).toBe(false);
        expect(h.back()).toBe('a');
        expect(h.forward()).toBe('d');
    });
    it('generates the race summary header sections', () => {
        const families = parseRaceFamilies(readDwu('raceFamilies.txt'));
        const human = races.find((r) => r.name === 'Human')!;
        const s = generateRaceSummary(text, human, families);
        expect(s[0].items[0]).toMatch(/^Race Family: /);
        expect(s[0].items[2]).toBe(`Default Reproduction Rate: +${Math.round((human.reproductionRate - 1) * 100)}%`);
        expect(s[1].heading).toBe('Characteristics');
        expect(s[1].items).toHaveLength(5);
    });
    it('generates the later race summary sections (GenerateRaceSummary)', () => {
        const families = parseRaceFamilies(readDwu('raceFamilies.txt'));
        const data = {
            races,
            resources,
            governments,
            research: parseResearch(readDwu('research.txt')),
            components: parseComponents(readDwu('components.txt')),
            facilities: parseFacilities(readDwu('facilities.txt')),
        };
        const section = (name: string, heading: string) =>
            generateRaceSummary(text, races.find((r) => r.name === name)!, families, data).find((s) => s.heading === heading);
        const human = generateRaceSummary(text, races.find((r) => r.name === 'Human')!, families, data);
        expect(human.map((s) => s.heading)).toEqual([
            '', 'Characteristics', 'Bonuses', 'Resource Bonuses', 'Race Victory Conditions', 'Characters', 'Other',
        ]);
        expect(section('Human', 'Resource Bonuses')!.items[0]).toBe('Yarras Marble: +5 happiness bonus for all colonies with access to this resource');
        expect(section('Human', 'Race Victory Conditions')!.items).toEqual([
            '25%:  Control 33% of all Continental Colonies in the galaxy',
            '25%:  Make Mutual Defense Pacts with 15% of all empires in the galaxy',
            '20%:  Destroy more enemy ships and bases than you lose',
            '15%:  Earn the most Tourist Income in the galaxy',
            '15%:  Earn the most Trade Income in the galaxy',
        ]);
        expect(section('Human', 'Characters')!.items.slice(0, 2)).toEqual([
            'Extra Intelligence Agents: 1',
            'More likely to generate new Ambassador characters (+30%)',
        ]);
        expect(section('Human', 'Other')!.items).toEqual([
            'Special Government: Corporate Nationalism',
            'Special Technology: (None)',
            'Disallowed Technology: (None)',
        ]);
        expect(section('Quameno', 'Characters')!.items).toContain('Ambassador characters have Linguist starting trait');
        expect(section('Quameno', 'Other')!.items).toContain('Special Technology: NovaCore Reactor (Reactor)');
        expect(section('Ikkuro', 'Colonies')!.items[0]).toBe('Continental planet Colonization Research -10% of normal costs');
        expect(section('Shandar', 'Colonies')!.items).toContain('Volcanic colonies can usually avoid natural disasters');
        expect(section('Gizurean', 'Race Victory Conditions')!.items).toContain('20%:  Build the Universal Hive wonder');
        expect(section('Teekan', 'Race Victory Conditions')!.items).toContain('25%:  Destroy the most Sand Slugs');
        expect(section('Teekan', 'Other')!.items).toEqual(expect.arrayContaining([
            'Smaller military ship sizes: -20%',
            'Larger civilian ship sizes: +20%',
            'Higher Trade Income: +20%',
        ]));
        expect(section('Dhayut', 'Other')!.items).toContain('Regular 5-year change cycle: For 2 years have increased aggression, increased population growth');
        expect(section('Zenox', 'Other')!.items).toContain('Historical Locations Known at Game Start: 2');
        // Without the static data lists the sections still render.
        expect(generateRaceSummary(text, races.find((r) => r.name === 'Human')!, families).at(-1)!.items).toContain('Special Technology: (None)');
    });
    it('maps selected creatures to help topics (btnHelp_Click)', () => {
        expect(helpTopicKeyForCreature(null)).toBe('Main Screen');
        expect(helpTopicKeyForCreature({ type: CreatureType.Kaltor })).toBe('Giant Kaltor');
        expect(helpTopicKeyForCreature({ type: CreatureType.RockSpaceSlug })).toBe('Space Slug');
        expect(helpTopicKeyForCreature({ type: CreatureType.DesertSpaceSlug })).toBe('Sand Slug');
        expect(helpTopicKeyForCreature({ type: CreatureType.SilverMist })).toBe('SilverMist');
        expect(helpTopicKeyForCreature({ type: CreatureType.Undefined })).toBe('Main Screen');
        for (const t of [CreatureType.Kaltor, CreatureType.RockSpaceSlug, CreatureType.DesertSpaceSlug, CreatureType.Ardilus, CreatureType.SilverMist]) {
            expect(resolveEncyclopediaTopic(items, getText(text, helpTopicKeyForCreature({ type: t })))?.category).toBe(EncyclopediaCategory.Creatures);
        }
    });
    it('maps selected habitats to help topics (btnHelp_Click)', () => {
        expect(helpTopicKeyForHabitat(null)).toBe('Main Screen');
        expect(helpTopicKeyForHabitat({ category: HabitatCategoryType.Star, type: HabitatType.MainSequence })).toBe('Stars');
        expect(helpTopicKeyForHabitat({ category: HabitatCategoryType.Planet, type: HabitatType.Ocean })).toBe('Ocean Planets');
        expect(existsSync(resolve(dwuRoot, 'Help', 'Planet_Ocean.mht'))).toBe(true);
    });
    it('maps a blockaded or independent-owned habitat before its category/type (btnHelp_Click)', () => {
        // Port of Main.Part5.cs btnHelp_Click's Habitat branch: IsBlockaded
        // wins first, then Empire == Galaxy.IndependentEmpire, then the
        // category/type switch. Empire.cs initializeIndependentCtor gives
        // the independent empire empireId 0.
        expect(
            helpTopicKeyForHabitat({ category: HabitatCategoryType.Planet, type: HabitatType.Ocean, isBlockaded: true }),
        ).toBe('Blockades');
        expect(
            helpTopicKeyForHabitat({
                category: HabitatCategoryType.Planet,
                type: HabitatType.Ocean,
                empire: { empireId: 0 },
            }),
        ).toBe('Independent planets and Traders');
        // Blockaded takes priority over independent ownership.
        expect(
            helpTopicKeyForHabitat({
                category: HabitatCategoryType.Planet,
                type: HabitatType.Ocean,
                isBlockaded: true,
                empire: { empireId: 0 },
            }),
        ).toBe('Blockades');
        // A normal (non-independent) owner doesn't trigger the independent
        // topic, and an unowned/unblockaded habitat still falls through to
        // its category/type.
        expect(
            helpTopicKeyForHabitat({
                category: HabitatCategoryType.Planet,
                type: HabitatType.Ocean,
                isBlockaded: false,
                empire: { empireId: 3 },
            }),
        ).toBe('Ocean Planets');
        expect(
            helpTopicKeyForHabitat({ category: HabitatCategoryType.Planet, type: HabitatType.Ocean, empire: null }),
        ).toBe('Ocean Planets');
    });
});
