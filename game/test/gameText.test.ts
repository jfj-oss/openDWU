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
} from '../src/sim/data/gameText';
import { parseRace } from '../src/sim/data/races';
import { parseResources } from '../src/sim/data/resources';
import { parseGovernments } from '../src/sim/data/governments';
import { decodeQuotedPrintable, findMhtPart, parseMht } from '../src/ui/screens/mht';
import { generateRaceSummary, helpTopicKeyForHabitat, TopicHistory } from '../src/ui/screens/galactopedia';
import { parseRaceFamilies } from '../src/sim/data/raceFamilies';
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
    it('maps selected habitats to help topics (btnHelp_Click)', () => {
        expect(helpTopicKeyForHabitat(null)).toBe('Main Screen');
        expect(helpTopicKeyForHabitat({ category: HabitatCategoryType.Star, type: HabitatType.MainSequence })).toBe('Stars');
        expect(helpTopicKeyForHabitat({ category: HabitatCategoryType.Planet, type: HabitatType.Ocean })).toBe('Ocean Planets');
        expect(existsSync(resolve(dwuRoot, 'Help', 'Planet_Ocean.mht'))).toBe(true);
    });
});
