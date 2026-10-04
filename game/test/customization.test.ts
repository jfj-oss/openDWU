// Themes (customization sets): the original's Customization\<set>\ resolution rules — data files (Galaxy.3.cs
// Initialize*, Galaxy.4.cs LoadRaces / LoadColonyNames, DesignSpecification.cs LoadFromFile), art and sounds
// (Main.Part12/13.cs Load*), the theme list (Start.cs method_28) and the save header (GalaxySummary ThemeName).
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
    CustomizationSet,
    customizationFileUrl,
    normalizeCustomizationSetName,
    setActiveCustomizationSet,
} from '../src/sim/data/customization';
import { resolveDataUrl, resolveThemedDataUrl, themedRaceFiles } from '../src/sim/data/paths';
import { setThemeChromeRace, themeArtFolder, themedAssetUrl, themeFlagShapeUrls, themeMenuBackgroundUrl, themeMusicFolder, STOCK_ASSET_QUERY } from '../src/themeAssets';
import { loadGameData, type FetchText } from '../src/sim/data/gameData';
import { DESIGN_SPECIFICATION_MISSING } from '../src/sim/data/designSpecifications';
import { builtObjectImagePath, themeShipFamilyNumbers } from '../src/render/builtObjectLayer';
import { fighterImageCount, fighterImageUrl } from '../src/render/fighterLayer';
import { weaponImageCount } from '../src/render/effectsLayer';
import { savedCustomizationSet } from '../src/sim/save/gameSave';
import { themeListEntries, themeSwitchEnabled } from '../src/ui/screens/changeTheme';
import { defaultBaconSettings } from '../src/sim/data/baconSettings';

const themeIndexLib = createRequire(import.meta.url)('../desktop/themeIndex.cjs') as {
    listThemes(root: string): string[];
    buildThemeIndex(root: string, set: string): { set: string; files: string[]; dirs: string[] } | null;
};

afterEach(() => {
    setActiveCustomizationSet(null);
    setThemeChromeRace('');
});

const theme = (files: string[], dirs: string[] = []) => new CustomizationSet({ set: 'My Theme, 2', files, dirs });
const T = '/assets/dwu/Customization/My%20Theme,%202/';

describe('set names', () => {
    it('"", "default" and "(Default)" mean the stock game (Main.Part12.cs CustomizationSetName, Start.cs method_2)', () => {
        expect(normalizeCustomizationSetName(undefined)).toBe('');
        expect(normalizeCustomizationSetName('Default')).toBe('');
        expect(normalizeCustomizationSetName('(Default)')).toBe('');
        expect(normalizeCustomizationSetName('RetreatUE Bacon')).toBe('RetreatUE Bacon');
    });
    it('URLs keep commas/apostrophes literal and encode spaces', () => {
        expect(customizationFileUrl("Alvek's Mod", 'images/a b.png')).toBe("/assets/dwu/Customization/Alvek's%20Mod/images/a%20b.png");
        expect(customizationFileUrl('Warhammer 40,000 (V14)', 'x.txt')).toBe('/assets/dwu/Customization/Warhammer%2040,000%20(V14)/x.txt');
    });
});

describe('data path resolution order', () => {
    it('resolveDataUrl: customized first, then the stock file', () => {
        expect(resolveDataUrl('research.txt', 'X')).toEqual(['/assets/dwu/Customization/X/research.txt', '/assets/dwu/research.txt']);
        expect(resolveDataUrl('research.txt')).toEqual(['/assets/dwu/research.txt']);
    });
    it('with a theme index: the theme copy only when it exists (File.Exists, case-insensitive)', () => {
        setActiveCustomizationSet(theme(['Research.TXT', 'Policy/Human.txt']));
        expect(resolveThemedDataUrl('research.txt')).toEqual([`${T}Research.TXT`]);
        expect(resolveThemedDataUrl('policy/human.txt')).toEqual([`${T}Policy/Human.txt`]);
        expect(resolveThemedDataUrl('components.txt')).toEqual(['/assets/dwu/components.txt']);
    });
    it("races\\ is replaced as a folder (Galaxy.4.cs LoadRaces), else the stock list", () => {
        setActiveCustomizationSet(theme(['races/b.txt', 'races/A.txt', 'races/notes.doc']));
        const r = themedRaceFiles(['human.txt']);
        expect(r.files).toEqual(['A.txt', 'b.txt']);
        expect(r.url('A.txt')).toEqual([`${T}races/A.txt`]);
        setActiveCustomizationSet(theme(['research.txt']));
        expect(themedRaceFiles(['human.txt']).files).toEqual(['human.txt']);
    });
});

describe('loadGameData with a theme', () => {
    // A tiny in-memory install: the stock files plus one theme.
    const stock: Record<string, string> = {
        'raceFamilies.txt': '', 'raceBiases.txt': '', 'raceFamilyBiases.txt': '', 'governments.txt': '', 'governmentBiases.txt': '',
        'resources.txt': '', 'components.txt': '', 'fighters.txt': '', 'facilities.txt': '', 'plagues.txt': '', 'research.txt': '',
        'characterNames.txt': '', 'designNames.txt': '', 'colonyNames.txt': 'Stockville,', 'BaconSettings.txt': 'tradeEverything=true\r\n',
    };
    function serve(themeFiles: Record<string, string>): { fetch: FetchText; requested: string[] } {
        const requested: string[] = [];
        const fetch: FetchText = async (candidates) => {
            for (const url of candidates) {
                requested.push(url);
                const rel = decodeURI(url.replace(/^\/assets\/dwu\//, ''));
                if (rel.startsWith('Customization/My Theme, 2/')) {
                    const f = rel.slice('Customization/My Theme, 2/'.length);
                    if (f in themeFiles) return themeFiles[f];
                } else if (rel in stock) return stock[rel];
            }
            throw new Error(`missing ${candidates.join(', ')}`);
        };
        return { fetch, requested };
    }
    it('colonyNames.txt has no stock fallback with a theme (Galaxy.4.cs 234); BaconSettings.txt is never themed (BaconMain.cs 1107)', async () => {
        const files = { 'BaconSettings.txt': 'tradeEverything=false\r\n' };
        const set = theme(Object.keys(files));
        const { fetch, requested } = serve(files);
        const data = await loadGameData(fetch, set, [], [], []);
        expect(data.colonyNames).toEqual([]);
        expect(requested.some((u) => u.endsWith('/colonyNames.txt'))).toBe(false);
        expect(data.baconSettings?.tradeEverything).toBe(true);
        expect(requested.filter((u) => u.includes('BaconSettings'))).toEqual(['/assets/dwu/BaconSettings.txt']);
    });
    it('the stock game is unchanged: colonyNames from the install', async () => {
        const { fetch } = serve({});
        const data = await loadGameData(fetch, undefined, [], [], []);
        expect(data.colonyNames).toEqual(['Stockville']);
        expect(data.baconSettings).not.toEqual(defaultBaconSettings());
    });
});

describe('design templates (DesignSpecification.cs 197-214)', () => {
    it('a pirate template falls back to the STOCK race file, never the theme race file', async () => {
        const raceText = "'Distant Worlds Race file\r\nName\t\t;Zorg\r\nPlayable\t\t;Y\r\n";
        const files: Record<string, string> = {
            'races/zorg.txt': raceText,
            'designTemplates/zorg/frigate.txt': "'theme frigate\r\n",
        };
        const set = theme(Object.keys(files));
        const requested: string[] = [];
        const fetch: FetchText = async (candidates) => {
            for (const url of candidates) {
                requested.push(url);
                const rel = decodeURI(url).replace(/^\/assets\/dwu\/Customization\/My Theme, 2\//, '');
                if (rel in files) return files[rel];
                if (url === '/assets/dwu/designTemplates/zorg/escort.txt') return "'stock escort\r\n";
                if (!url.includes('Customization') && /\.txt$/.test(url) && !url.includes('designTemplates') && !url.includes('characters') && !url.includes('Policy')) return '';
            }
            throw new Error('missing');
        };
        const data = await loadGameData(fetch, set, [], [], []);
        const t = data.designSpecificationTexts!;
        expect(t.get('designTemplates/zorg/frigate.txt')).toBe("'theme frigate\r\n");
        // pirate frigate: no theme pirate, no stock pirate, no stock race file → missing (not the theme race file)
        expect(t.get('designTemplates/zorg/pirate/frigate.txt')).toBe(DESIGN_SPECIFICATION_MISSING);
        // pirate escort: falls back to the stock race file
        expect(t.get('designTemplates/zorg/pirate/escort.txt')).toBe("'stock escort\r\n");
    });
});

describe('art and sounds (themedAssetUrl)', () => {
    const img = (rel: string) => `/assets/dwu/images/${rel}`;
    it('no theme: every URL unchanged', () => {
        expect(themedAssetUrl(img('ui/chrome/happy.png'))).toBe(img('ui/chrome/happy.png'));
    });
    it('per file: the theme copy when it exists, else the stock file (Main.Part13.cs method_10)', () => {
        setActiveCustomizationSet(theme(['images/environment/planets/ocean/Ocean-0001.png', 'Sounds/Effects/button1.wav']));
        expect(themedAssetUrl(img('environment/planets/ocean/ocean-0001.png'))).toBe(`${T}images/environment/planets/ocean/Ocean-0001.png`);
        expect(themedAssetUrl(img('environment/planets/ocean/Ocean-0002.png'))).toBe(img('environment/planets/ocean/Ocean-0002.png'));
        expect(themedAssetUrl('/assets/dwu/Sounds/Effects/button1.wav')).toBe(`${T}Sounds/Effects/button1.wav`);
        expect(themedAssetUrl(`http://host${img('environment/planets/ocean/Ocean-0001.png')}`)).toBe(`http://host${T}images/environment/planets/ocean/Ocean-0001.png`);
        expect(themedAssetUrl(img(`environment/planets/ocean/Ocean-0001.png${STOCK_ASSET_QUERY}`))).toContain('/assets/dwu/images/');
    });
    it('map stars and nebulae are never themed (LoadMapStars / LoadNebulae take the stock path only)', () => {
        setActiveCustomizationSet(theme(['images/environment/mapstars/flares/a.png', 'images/environment/nebulae/n.png']));
        expect(themedAssetUrl(img('environment/mapstars/flares/a.png'))).toBe(img('environment/mapstars/flares/a.png'));
        expect(themedAssetUrl(img('environment/nebulae/n.png'))).toBe(img('environment/nebulae/n.png'));
    });
    it("chrome: the player race's folder, then the theme, then stock; method_10 files skip the race folder; resx chrome is not themed", () => {
        setActiveCustomizationSet(theme(['images/ui/chrome/Klingon/happy.png', 'images/ui/chrome/happy.png', 'images/ui/chrome/Klingon/galaxy.png', 'images/ui/chrome/galaxy.png', 'images/ui/chrome/MainBackground.jpg']));
        expect(themedAssetUrl(img('ui/chrome/happy.png'))).toBe(`${T}images/ui/chrome/happy.png`);
        setThemeChromeRace('klingon');
        expect(themedAssetUrl(img('ui/chrome/happy.png'))).toBe(`${T}images/ui/chrome/Klingon/happy.png`);
        expect(themedAssetUrl(img('ui/chrome/galaxy.png'))).toBe(`${T}images/ui/chrome/galaxy.png`);
        expect(themedAssetUrl(img('ui/chrome/MainBackground.jpg'))).toBe(img('ui/chrome/MainBackground.jpg'));
    });
    it('components / resources: theme .png, theme .bmp, then stock (LoadUiComponents / LoadUiResources)', () => {
        setActiveCustomizationSet(theme(['images/ui/components/Component_3.png', 'images/ui/components/Component_4.bmp']));
        expect(themedAssetUrl(img('ui/components/Component_3.bmp'))).toBe(`${T}images/ui/components/Component_3.png`);
        expect(themedAssetUrl(img('ui/components/Component_4.bmp'))).toBe(`${T}images/ui/components/Component_4.bmp`);
        expect(themedAssetUrl(img('ui/components/Component_5.bmp'))).toBe(img('ui/components/Component_5.bmp'));
    });
    it('effects\\weapons is replaced as a folder only when it holds a *.png; counts follow its listing', () => {
        setActiveCustomizationSet(theme(['images/effects/weapons/readme.txt']));
        expect(themeArtFolder('images/effects/weapons')).toBeNull();
        expect(weaponImageCount('beam')).toBe(13);
        setActiveCustomizationSet(theme(['images/effects/weapons/beam_0.png', 'images/effects/weapons/beam_1.png', 'images/effects/weapons/torpedo_0.png']));
        expect(weaponImageCount('beam')).toBe(2);
        expect(weaponImageCount('area')).toBe(0);
        expect(themedAssetUrl(img('effects/weapons/beam_1.png'))).toBe(`${T}images/effects/weapons/beam_1.png`);
    });
    it('flag shapes: the theme folder replaces the stock list when it exists (Galaxy.4.cs LoadFlagShapes)', () => {
        setActiveCustomizationSet(theme(['images/ui/flagshapes/b.png', 'images/ui/flagshapes/a.png', 'images/ui/flagshapes/pirate/p.png']));
        expect(themeFlagShapeUrls(false)).toEqual([`${T}images/ui/flagshapes/a.png`, `${T}images/ui/flagshapes/b.png`]);
        expect(themeFlagShapeUrls(true)).toEqual([`${T}images/ui/flagshapes/pirate/p.png`]);
        setActiveCustomizationSet(theme(['images/x.png']));
        expect(themeFlagShapeUrls(false)).toBeNull();
    });
    it('music: the theme folder replaces the list when it holds an mp3; DistantWorldsTheme.mp3 else the first (method_68)', () => {
        setActiveCustomizationSet(theme(['Sounds/Music/b.mp3', 'Sounds/Music/a.mp3']));
        expect(themeMusicFolder()?.themeFile).toBe('a.mp3');
        setActiveCustomizationSet(theme(['Sounds/Music/b.mp3', 'Sounds/Music/DistantWorldsTheme.mp3']));
        expect(themeMusicFolder()?.themeFile).toBe('DistantWorldsTheme.mp3');
        setActiveCustomizationSet(theme(['Sounds/Music/readme.txt']));
        expect(themeMusicFolder()).toBeNull();
    });
    it('the menu background (BaconStart.InitializeMore customBackgroundImage.jpg)', () => {
        setActiveCustomizationSet(theme(['images/customBackgroundImage.jpg']));
        expect(themeMenuBackgroundUrl()).toBe(`${T}images/customBackgroundImage.jpg`);
    });
});

describe('ships and fighters (BuiltObjectImageCache.cs 1115-1157, AddMoreImages)', () => {
    it('stock: the fixed family table', () => {
        expect(builtObjectImagePath(72)).toBe('family0/escort.png');
        expect(builtObjectImagePath(72 + 27 * 24)).toBeNull();
    });
    it('a theme family appends after the stock ones; variants and missing roles shift later slots', () => {
        setActiveCustomizationSet(theme(['images/units/ships/family27/Escort.png', 'images/units/ships/family27/escort1.png', 'images/units/ships/family27/Cruiser.bmp', 'images/units/ships/family30/fighter.png']));
        expect(themeShipFamilyNumbers(theme(['images/units/ships/family27/x.png'])).slice(-2)).toEqual([26, 27]);
        expect(builtObjectImagePath(72)).toBe('family0/escort.png');
        const first = 72 + 27 * 24;
        expect(builtObjectImagePath(first)).toBe('family27/Escort.png');
        expect(builtObjectImagePath(first + 1)).toBe('family27/Escort1.png');
        expect(builtObjectImagePath(first + 2)).toBe('family27/Cruiser.bmp');
        expect(builtObjectImagePath(first + 3)).toBeNull();
        // fighters: one fighter + bomber per family folder (27 stock + 27 + 30)
        expect(fighterImageCount()).toBe(29 * 2);
        expect(fighterImageUrl(28 * 2)).toBe('/assets/dwu/images/units/ships/family30/fighter.png');
    });
});

describe('theme list (Start.cs method_28)', () => {
    it('every Customization subfolder, sorted, after "(Default)"; Switch disabled for the current theme', () => {
        const root = mkdtempSync(join(tmpdir(), 'dwu-themes-'));
        for (const d of ['Zeta', 'DW Universe-STPE Ver 2', 'DW Universe-ST Picard Era', 'alpha', 'DistantWorldsExpanded-main', 'Distant Worlds Original']) mkdirSync(join(root, 'Customization', d), { recursive: true });
        writeFileSync(join(root, 'Customization', 'stray.txt'), 'x');
        const list = themeIndexLib.listThemes(root);
        expect(list).toEqual(['alpha', 'Distant Worlds Original', 'DistantWorldsExpanded-main', 'DW Universe-ST Picard Era', 'DW Universe-STPE Ver 2', 'Zeta']);
        expect(themeListEntries(list)[0]).toBe('(Default)');
        expect(themeSwitchEnabled('(Default)', '')).toBe(false);
        expect(themeSwitchEnabled('Zeta', '')).toBe(true);
        expect(themeSwitchEnabled('Zeta', 'Zeta')).toBe(false);
    });
    it('a theme index covers top-level files and the engine folders only, with their casing', () => {
        const root = mkdtempSync(join(tmpdir(), 'dwu-themes-'));
        const t = join(root, 'Customization', 'T');
        mkdirSync(join(t, 'Policy', 'pirate'), { recursive: true });
        mkdirSync(join(t, 'x64'), { recursive: true });
        mkdirSync(join(t, 'images', 'empty'), { recursive: true });
        writeFileSync(join(t, 'about.txt'), 'hi');
        writeFileSync(join(t, 'Policy', 'pirate', 'Human.txt'), '');
        writeFileSync(join(t, 'x64', 'steam_api.dll'), '');
        const idx = themeIndexLib.buildThemeIndex(root, 't')!;
        expect(idx.set).toBe('T');
        expect(idx.files).toEqual(['about.txt', 'Policy/pirate/Human.txt']);
        const set = new CustomizationSet(idx);
        expect(set.dirExists('images/empty')).toBe(true);
        expect(set.fileExists('policy/PIRATE/human.txt')).toBe(true);
        expect(themeIndexLib.buildThemeIndex(root, '../x')).toBeNull();
    });
});

describe('save header theme (GalaxySummary.ThemeName)', () => {
    it('is read from the save tail; absent for the stock game', () => {
        expect(savedCustomizationSet('{"version":2,"galaxy":{}}')).toBe('');
        expect(savedCustomizationSet('{"version":2,"galaxy":{},"customizationSet":"Warhammer 40,000 (V14)"}')).toBe('Warhammer 40,000 (V14)');
        expect(savedCustomizationSet('{"version":2,"customizationSet":"Alvek\'s \\"Mod\\""}')).toBe('Alvek\'s "Mod"');
    });
});
