// Galactopedia data: GameText.txt parser + the encyclopedia topic list.
//
// - parseGameText: port of TextResolver.cs LoadText (the in-game text table
//   GameText.txt: "Key<ws>;Value", `'` comments, "\n" -> newline).
// - buildEncyclopediaItems: port of Main.Part5.cs method_465 (the hard-coded
//   Galactopedia topic list: titles resolved through GameText, help file
//   names, categories and related-topic links) plus the data-driven topics
//   from Galaxy.9.cs AddResourceTopics / AddRaceTopics / AddGovernmentTopics.
//
// Pure: no DOM, no fs, no fetch. The caller supplies the GameText.txt text
// and a synchronous "does Help/<file> exist" predicate (the original's
// File.Exists checks).

/** Port of EncyclopediaCategory.cs (same order / values). */
export enum EncyclopediaCategory {
    Undefined,
    Components,
    Resources,
    PlanetsAndStars,
    Ships,
    Races,
    GameConcepts,
    Screens,
    UserInterface,
    Creatures,
    Editor,
    GovernmentTypes,
    Theme,
    GameInfo,
}

/** Port of EncyclopediaItem.cs. `relatedItems` keeps insertion order (the
 *  related-topics box shows them in that order, RelatedEncyclopediaItemsBox
 *  method_2). */
export interface EncyclopediaItem {
    /** Stable id for URLs (?topic=): slug of the title; duplicates get a
     *  numeric suffix, so the first (category root) item keeps the bare slug. */
    id: string;
    title: string;
    /** Help file name under $DWU/Help/ (e.g. "Planet_Ocean.mht"). */
    filename: string;
    category: EncyclopediaCategory;
    isCategoryRoot: boolean;
    relatedItems: EncyclopediaItem[];
}

/** GameText.txt key -> value table. */
export type GameText = Map<string, string>;

export interface ParsedGameText {
    text: GameText;
    /** Keys that appeared more than once (the original throws
     *  "Dictionary already contains tag"; we keep the first value). */
    duplicates: string[];
}

// Port of TextResolver.cs LoadText: skip blank lines and lines whose first
// non-blank char is `'`; split on the FIRST ';'; key and value trimmed;
// literal "\n" in the value becomes a newline; empty keys ignored.
export function parseGameText(source: string): ParsedGameText {
    const text: GameText = new Map();
    const duplicates: string[] = [];
    const body = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
    for (const line of body.split(/\r\n|\r|\n/)) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith("'")) continue;
        const idx = line.indexOf(';');
        if (idx < 0) continue;
        const key = line.slice(0, idx).trim();
        if (key === '') continue;
        const value = line.slice(idx + 1).trim().split('\\n').join('\n');
        if (text.has(key)) {
            duplicates.push(key);
            continue;
        }
        text.set(key, value);
    }
    return { text, duplicates };
}

/** Port of TextResolver.GetText (missing keys yield the original's marker). */
export function getText(text: GameText, key: string): string {
    const v = text.get(key);
    return v !== undefined ? v : `KEY NOT FOUND: '${key}'`;
}

/** Port of Galaxy.9.cs RemoveSpecialCharacters: keep [a-zA-Z0-9-]. */
export function removeSpecialCharacters(s: string): string {
    return s.replace(/[^a-zA-Z0-9-]+/g, '');
}

/** Port of Galaxy.2.cs ResolveDescription(EncyclopediaCategory). */
export function resolveCategoryDescription(text: GameText, category: EncyclopediaCategory): string {
    switch (category) {
        case EncyclopediaCategory.Components: return getText(text, 'Components');
        case EncyclopediaCategory.Creatures: return getText(text, 'Space Creatures');
        case EncyclopediaCategory.Editor: return getText(text, 'Game Editor');
        case EncyclopediaCategory.GameConcepts: return getText(text, 'Game Concepts');
        case EncyclopediaCategory.GovernmentTypes: return getText(text, 'Government Types');
        case EncyclopediaCategory.PlanetsAndStars: return getText(text, 'Planet Types');
        case EncyclopediaCategory.Races: return getText(text, 'Alien Races');
        case EncyclopediaCategory.Resources: return getText(text, 'Resources');
        case EncyclopediaCategory.Screens: return getText(text, 'Game Screens');
        case EncyclopediaCategory.Ships: return getText(text, 'Ships and Bases');
        case EncyclopediaCategory.UserInterface: return getText(text, 'Finding Your Way Around');
        case EncyclopediaCategory.Undefined: return getText(text, 'None');
        default: return '';
    }
}

/** Minimal race / resource / government shapes the topic builder needs
 *  (structural, so sim/data Race/Resource/Government fit). */
export interface EncyclopediaRaceInput {
    name: string;
    /** HabitatType value (sim/types.ts): 8 Volcanic, 9 Desert, 10 MarshySwamp,
     *  11 Continental, 12 Ocean, 14 Ice. */
    nativeHabitatType: number;
}
export interface EncyclopediaResourceInput {
    name: string;
    isFuel: boolean;
}
export interface EncyclopediaGovernmentInput {
    name: string;
}

export interface BuildEncyclopediaOptions {
    races?: ReadonlyArray<EncyclopediaRaceInput | null>;
    resources?: ReadonlyArray<EncyclopediaResourceInput | null>;
    governments?: ReadonlyArray<EncyclopediaGovernmentInput | null>;
    /** File.Exists(Help/<filename>) — case-insensitive on the original. */
    helpFileExists: (filename: string) => boolean;
    /** Help-folder listings for AddThemeTopics / AddGameInfoTopics (the
     *  original enumerates the folders; a browser cannot, so the caller
     *  supplies what it found). Omitted = no such files. */
    helpListing?: HelpFolderListing;
}

/** What Galaxy.9.cs AddThemeTopics / AddGameInfoTopics read from disk. */
export interface HelpFolderListing {
    /** The active customization set (Customization/<set>/help/); '' / undefined = none. */
    customizationSetName?: string;
    /** Directory.GetFiles(Customization/<set>/help/, "<set>_*.mht") names, in GetFiles order. */
    themeFiles?: ReadonlyArray<string>;
    /** File.Exists(Customization/<set>/help/<set>.mht). */
    themeRootExists?: boolean;
    /** GetFiles("GameInfo_*.mht") of Customization/<set>/help/ followed by
     *  those of Help/, in GetFiles order. */
    gameInfoFiles?: ReadonlyArray<string>;
    /** File.Exists of GameInfo_Default.mht in Customization/<set>/help/ or Help/. */
    gameInfoDefaultExists?: boolean;
}

/** Port of Galaxy.1.cs SplitString: Regex.Split(input, "([A-Z])"), each
 *  captured capital joined with the text after it, space-separated (text
 *  before the first capital is dropped, as in the C#). */
export function splitString(input: string): string {
    const parts = input.split(/([A-Z])/);
    let out = '';
    for (let i = 1; i < parts.length; i += 2) out += `${parts[i]}${parts[i + 1] ?? ''} `;
    return out.trim();
}

/** Port of EncyclopediaItemList indexer this[string title]: first item whose
 *  title matches case-insensitively, else null. */
export function findEncyclopediaItem(items: ReadonlyArray<EncyclopediaItem>, title: string): EncyclopediaItem | null {
    const t = title.toLowerCase();
    for (const item of items) {
        if (item.title.toLowerCase() === t) return item;
    }
    return null;
}

/** Port of EncyclopediaItemList.GetItemsByCategory. */
export function getItemsByCategory(items: ReadonlyArray<EncyclopediaItem>, category: EncyclopediaCategory): EncyclopediaItem[] {
    return items.filter((i) => i.category === category);
}

// HabitatType values (sim/types.ts HabitatType) used by AddRaceTopics.
const HT_VOLCANIC = 8;
const HT_DESERT = 9;
const HT_MARSHY_SWAMP = 10;
const HT_CONTINENTAL = 11;
const HT_OCEAN = 12;
const HT_ICE = 14;

// Port of Main.Part5.cs method_465: [GameText key, help file, category,
// isCategoryRoot] in the original insertion order, then the explicit
// RelatedItems.Add pairs [from key, to key] before and after the
// per-category loops.
const BASE_ITEMS: ReadonlyArray<readonly [string, string, EncyclopediaCategory, boolean]> = [
    ["Components", "Component_Overview.mht", EncyclopediaCategory.Components, true],
    ["Finding Your Way Around", "UI_MouseActions.mht", EncyclopediaCategory.UserInterface, true],
    ["Game Concepts", "GameConcepts_YourEmpire.mht", EncyclopediaCategory.GameConcepts, true],
    ["Game Screens", "Screen_MainScreenElements.mht", EncyclopediaCategory.Screens, true],
    ["Planet and Star Types", "Planet_Asteroid.mht", EncyclopediaCategory.PlanetsAndStars, true],
    ["Resources", "Resource_Overview.mht", EncyclopediaCategory.Resources, true],
    ["Ships and Bases", "Ship_SpacePort.mht", EncyclopediaCategory.Ships, true],
    ["Alien Races", "AlienRaces.mht", EncyclopediaCategory.Races, true],
    ["Government Types", "GameConcepts_GovernmentTypes.mht", EncyclopediaCategory.GovernmentTypes, true],
    ["Space Creatures", "Creatures.mht", EncyclopediaCategory.Creatures, true],
    ["Game Editor", "editor_overview.mht", EncyclopediaCategory.Editor, true],
    ["Bombard Weapons", "Component_BombardWeapon.mht", EncyclopediaCategory.Components, false],
    ["Fighter Bays", "Component_FighterBay.mht", EncyclopediaCategory.Components, false],
    ["Gravity Well Projectors", "Component_HyperBlock.mht", EncyclopediaCategory.Components, false],
    ["HyperDeny Components", "Component_HyperDeny.mht", EncyclopediaCategory.Components, false],
    ["Ion Defense", "Component_IonDefense.mht", EncyclopediaCategory.Components, false],
    ["Ion Weapons", "Component_IonWeapon.mht", EncyclopediaCategory.Components, false],
    ["Missile Weapons", "Component_MissileWeapon.mht", EncyclopediaCategory.Components, false],
    ["Point Defense Weapons", "Component_PointDefenseWeapon.mht", EncyclopediaCategory.Components, false],
    ["Scanner Jammers", "Component_ScannerJammer.mht", EncyclopediaCategory.Components, false],
    ["Area Shield Recharge", "Component_ShieldRecharge.mht", EncyclopediaCategory.Components, false],
    ["Trace Scanners", "Component_TraceScanner.mht", EncyclopediaCategory.Components, false],
    ["Corruption", "GameConcepts_Corruption.mht", EncyclopediaCategory.GameConcepts, false],
    ["Fighters", "GameConcepts_Fighters.mht", EncyclopediaCategory.GameConcepts, false],
    ["Planetary Facilities", "GameConcepts_PlanetaryFacilities.mht", EncyclopediaCategory.GameConcepts, false],
    ["Build Order Screen", "Screen_BuildOrder.mht", EncyclopediaCategory.Screens, false],
    ["Empire Policy Screen", "Screen_EmpirePolicy.mht", EncyclopediaCategory.Screens, false],
    ["Game Options - Your Empire Settings Screen", "Screen_YourEmpireSettings.mht", EncyclopediaCategory.Screens, false],
    ["Game Options - Message Settings Screen", "Screen_MessageSettings.mht", EncyclopediaCategory.Screens, false],
    ["Defensive Bases", "Ship_DefensiveBase.mht", EncyclopediaCategory.Ships, false],
    ["Monitoring Stations", "Ship_MonitoringStation.mht", EncyclopediaCategory.Ships, false],
    ["Research Stations", "Ship_ResearchStation.mht", EncyclopediaCategory.Ships, false],
    ["Empire Navigation Tool", "UI_EmpireNavigationTool.mht", EncyclopediaCategory.UserInterface, false],
    ["Characters", "GameConcepts_Characters.mht", EncyclopediaCategory.GameConcepts, false],
    ["Wonders", "GameConcepts_Wonders.mht", EncyclopediaCategory.GameConcepts, false],
    ["Colony Population Policies", "GameConcepts_ColonyPopulationPolicies.mht", EncyclopediaCategory.GameConcepts, false],
    ["Carriers", "Ship_Carrier.mht", EncyclopediaCategory.Ships, false],
    ["Rail Guns", "Component_RailGunWeapon.mht", EncyclopediaCategory.Components, false],
    ["Energy To Fuel Converter", "Component_EnergyToFuelConverter.mht", EncyclopediaCategory.Components, false],
    ["Phased Weapons", "Component_PhaserWeapons.mht", EncyclopediaCategory.Components, false],
    ["SilverMist", "Creature_4.mht", EncyclopediaCategory.Creatures, false],
    ["Empire Territory", "GameConcepts_EmpireTerritory.mht", EncyclopediaCategory.GameConcepts, false],
    ["Assault Pods", "Component_AssaultPod.mht", EncyclopediaCategory.Components, false],
    ["Tractor Beams", "Component_TractorBeam.mht", EncyclopediaCategory.Components, false],
    ["Gravity Beam Weapons", "Component_GravityBeamWeapon.mht", EncyclopediaCategory.Components, false],
    ["Gravity Area Weapons", "Component_GravityAreaWeapon.mht", EncyclopediaCategory.Components, false],
    ["Boarding And Capture", "GameConcepts_BoardingAndCapture.mht", EncyclopediaCategory.GameConcepts, false],
    ["Ground Report Screen", "Screen_GroundCombat.mht", EncyclopediaCategory.Screens, false],
    ["Introduction", "default.mht", EncyclopediaCategory.GameConcepts, false],
    ["Continental Planets", "Planet_Continental.mht", EncyclopediaCategory.PlanetsAndStars, false],
    ["Marshy Swamp Planets", "Planet_MarshySwamp.mht", EncyclopediaCategory.PlanetsAndStars, false],
    ["Desert Planets", "Planet_SandyDesert.mht", EncyclopediaCategory.PlanetsAndStars, false],
    ["Ocean Planets", "Planet_Ocean.mht", EncyclopediaCategory.PlanetsAndStars, false],
    ["Ice Planets", "Planet_IceGlacial.mht", EncyclopediaCategory.PlanetsAndStars, false],
    ["Volcanic Planets", "Planet_Volcanic.mht", EncyclopediaCategory.PlanetsAndStars, false],
    ["Barren Rock Planets", "Planet_BarrenRock.mht", EncyclopediaCategory.PlanetsAndStars, false],
    ["Gas Giant Planets", "Planet_GasGiant.mht", EncyclopediaCategory.PlanetsAndStars, false],
    ["Frozen Gas Giant Planets", "Planet_FrozenGasGiant.mht", EncyclopediaCategory.PlanetsAndStars, false],
    ["Asteroids", "Planet_Asteroid.mht", EncyclopediaCategory.PlanetsAndStars, false],
    ["Gas Clouds", "Planet_GasCloud.mht", EncyclopediaCategory.PlanetsAndStars, false],
    ["Stars", "Planet_Star.mht", EncyclopediaCategory.PlanetsAndStars, false],
    ["Nebulae Clouds", "Planet_Nebulae.mht", EncyclopediaCategory.PlanetsAndStars, false],
    ["Edit Asteroid", "editor_editasteroid.mht", EncyclopediaCategory.Editor, false],
    ["Edit Space Creature", "editor_editcreature.mht", EncyclopediaCategory.Editor, false],
    ["Edit Empire - Colonies", "editor_editempirecolonies.mht", EncyclopediaCategory.Editor, false],
    ["Edit Empire - Details", "editor_editempiredetails.mht", EncyclopediaCategory.Editor, false],
    ["Edit Empire - Research", "editor_editempireresearch.mht", EncyclopediaCategory.Editor, false],
    ["Edit Empire - Characters", "editor_editempirecharacters.mht", EncyclopediaCategory.Editor, false],
    ["Edit Empire - Ships and Bases", "editor_editempireshipbase.mht", EncyclopediaCategory.Editor, false],
    ["Edit Galaxy", "editor_editgalaxy.mht", EncyclopediaCategory.Editor, false],
    ["Edit Game Events", "editor_editgameevents.mht", EncyclopediaCategory.Editor, false],
    ["Edit Gas Cloud", "editor_editgascloud.mht", EncyclopediaCategory.Editor, false],
    ["Edit Planet or Moon", "editor_editplanet.mht", EncyclopediaCategory.Editor, false],
    ["Edit Ship or Base", "editor_editshipbase.mht", EncyclopediaCategory.Editor, false],
    ["Edit Star", "editor_editstar.mht", EncyclopediaCategory.Editor, false],
    ["Empire Exploration", "editor_empireexploration.mht", EncyclopediaCategory.Editor, false],
    ["Erase Independent Alien Race", "editor_erasealienrace.mht", EncyclopediaCategory.Editor, false],
    ["Erase Asteroid Field", "editor_eraseasteroidfield.mht", EncyclopediaCategory.Editor, false],
    ["Erase Colony", "editor_erasecolony.mht", EncyclopediaCategory.Editor, false],
    ["Erase Items", "editor_eraseitems.mht", EncyclopediaCategory.Editor, false],
    ["Erase Ruins", "editor_eraseruins.mht", EncyclopediaCategory.Editor, false],
    ["Place Independent Alien Race", "editor_placealienrace.mht", EncyclopediaCategory.Editor, false],
    ["Place Asteroid", "editor_placeasteroid.mht", EncyclopediaCategory.Editor, false],
    ["Place Asteroid Field", "editor_placeasteroidfield.mht", EncyclopediaCategory.Editor, false],
    ["Place Colony", "editor_placecolony.mht", EncyclopediaCategory.Editor, false],
    ["Place Space Creature", "editor_placecreature.mht", EncyclopediaCategory.Editor, false],
    ["Place Gas Cloud", "editor_placegascloud.mht", EncyclopediaCategory.Editor, false],
    ["Place Moon", "editor_placemoon.mht", EncyclopediaCategory.Editor, false],
    ["Place Pirate Faction", "editor_placepirates.mht", EncyclopediaCategory.Editor, false],
    ["Place Planet", "editor_placeplanet.mht", EncyclopediaCategory.Editor, false],
    ["Place Ruins", "editor_placeruins.mht", EncyclopediaCategory.Editor, false],
    ["Place Ship or Base", "editor_placeshipbase.mht", EncyclopediaCategory.Editor, false],
    ["Place Star", "editor_placestar.mht", EncyclopediaCategory.Editor, false],
    ["Place System", "editor_placesystem.mht", EncyclopediaCategory.Editor, false],
    ["Exploration", "GameConcepts_Exploration.mht", EncyclopediaCategory.GameConcepts, false],
    ["Colonization", "GameConcepts_Colonization.mht", EncyclopediaCategory.GameConcepts, false],
    ["Colony Growth", "GameConcepts_ColonyGrowth.mht", EncyclopediaCategory.GameConcepts, false],
    ["Colony Approval", "GameConcepts_ColonyApproval.mht", EncyclopediaCategory.GameConcepts, false],
    ["Your Empire - State vs Private", "GameConcepts_YourEmpire.mht", EncyclopediaCategory.GameConcepts, false],
    ["Diplomacy", "GameConcepts_Diplomacy.mht", EncyclopediaCategory.GameConcepts, false],
    ["Empire Reputation", "GameConcepts_Reputation.mht", EncyclopediaCategory.GameConcepts, false],
    ["Diplomatic Relation Types", "GameConcepts_DiplomaticRelationTypes.mht", EncyclopediaCategory.GameConcepts, false],
    ["Blockades", "GameConcepts_Blockades.mht", EncyclopediaCategory.GameConcepts, false],
    ["Construction", "GameConcepts_Construction.mht", EncyclopediaCategory.GameConcepts, false],
    ["Research", "GameConcepts_Research.mht", EncyclopediaCategory.GameConcepts, false],
    ["Ship Designs", "GameConcepts_Designs.mht", EncyclopediaCategory.GameConcepts, false],
    ["Ship Costs", "GameConcepts_ShipCosts.mht", EncyclopediaCategory.GameConcepts, false],
    ["Fleets", "GameConcepts_Fleets.mht", EncyclopediaCategory.GameConcepts, false],
    ["Intelligence Missions", "GameConcepts_IntelligenceMissions.mht", EncyclopediaCategory.GameConcepts, false],
    ["Troops", "GameConcepts_Troops.mht", EncyclopediaCategory.GameConcepts, false],
    ["Combat - Space Battles", "GameConcepts_CombatSpace.mht", EncyclopediaCategory.GameConcepts, false],
    ["Combat - Colony Invasions", "GameConcepts_CombatInvasion.mht", EncyclopediaCategory.GameConcepts, false],
    ["Combat - Ground Combat", "GameConcepts_CombatGround.mht", EncyclopediaCategory.GameConcepts, false],
    ["Independent planets and Traders", "GameConcepts_Independents.mht", EncyclopediaCategory.GameConcepts, false],
    ["Pirates", "GameConcepts_Pirates.mht", EncyclopediaCategory.GameConcepts, false],
    ["Alternative Game play", "GameConcepts_AlternativeGamePlay.mht", EncyclopediaCategory.GameConcepts, false],
    ["Ancient Ruins", "GameConcepts_Ruins.mht", EncyclopediaCategory.GameConcepts, false],
    ["Tourism", "GameConcepts_Tourism.mht", EncyclopediaCategory.GameConcepts, false],
    ["Migration", "GameConcepts_Migration.mht", EncyclopediaCategory.GameConcepts, false],
    ["Mining for Resources", "GameConcepts_Mining.mht", EncyclopediaCategory.GameConcepts, false],
    ["Fuel", "GameConcepts_Fuel.mht", EncyclopediaCategory.GameConcepts, false],
    ["Economy Tips", "GameConcepts_EconomyTips.mht", EncyclopediaCategory.GameConcepts, false],
    ["Colonization Tips", "GameConcepts_ColonizationTips.mht", EncyclopediaCategory.GameConcepts, false],
    ["Colony Taxes", "GameConcepts_Tax.mht", EncyclopediaCategory.GameConcepts, false],
    ["Mouse Actions", "UI_MouseActions.mht", EncyclopediaCategory.UserInterface, false],
    ["Controlling your Ships", "UI_ShipMissions.mht", EncyclopediaCategory.UserInterface, false],
    ["Ship Mission Types", "UI_ShipMissionTypes.mht", EncyclopediaCategory.UserInterface, false],
    ["Keyboard Commands", "UI_KeyboardCommands.mht", EncyclopediaCategory.UserInterface, false],
    ["Messages and Events", "UI_Messages.mht", EncyclopediaCategory.UserInterface, false],
    ["Ship Symbols", "UI_ShipSymbols.mht", EncyclopediaCategory.UserInterface, false],
    ["Colonies Screen", "Screen_Colonies.mht", EncyclopediaCategory.Screens, false],
    ["Design Detail Screen", "Screen_DesignDetail.mht", EncyclopediaCategory.Screens, false],
    ["Designs Screen", "Screen_Designs.mht", EncyclopediaCategory.Screens, false],
    ["Diplomacy Screen", "Screen_Diplomacy.mht", EncyclopediaCategory.Screens, false],
    ["Empire Comparisons and Victory Conditions", "Screen_EmpireComparison.mht", EncyclopediaCategory.Screens, false],
    ["Your Empire Summary Screen", "Screen_EmpireSummary.mht", EncyclopediaCategory.Screens, false],
    ["Fleets Screen", "Screen_Fleets.mht", EncyclopediaCategory.Screens, false],
    ["Galaxy Map Screen", "Screen_GalaxyMap.mht", EncyclopediaCategory.Screens, false],
    ["Game Menu", "Screen_GameMenu.mht", EncyclopediaCategory.Screens, false],
    ["Game Options", "Screen_GameOptions.mht", EncyclopediaCategory.Screens, false],
    ["Selection Panel", "Screen_InfoPanel.mht", EncyclopediaCategory.Screens, false],
    ["Characters Screen", "Screen_IntelligenceMissions.mht", EncyclopediaCategory.Screens, false],
    ["Main Screen", "Screen_MainScreenElements.mht", EncyclopediaCategory.Screens, false],
    ["Research Screen", "Screen_Research.mht", EncyclopediaCategory.Screens, false],
    ["Ships and Bases Screen", "Screen_ShipsAndBases.mht", EncyclopediaCategory.Screens, false],
    ["Speaking to Other Empires", "Screen_TalkingWithEmpires.mht", EncyclopediaCategory.Screens, false],
    ["Troops Screen", "Screen_Troops.mht", EncyclopediaCategory.Screens, false],
    ["Message History Screen", "Screen_MessageHistory.mht", EncyclopediaCategory.Screens, false],
    ["Expansion Planner Screen", "Screen_ExpansionPlanner.mht", EncyclopediaCategory.Screens, false],
    ["Start New Game Screen", "Screen_StartNewGame.mht", EncyclopediaCategory.Screens, false],
    ["Game Options - Advanced Display Settings Screen", "Screen_AdvancedDisplaySettings.mht", EncyclopediaCategory.Screens, false],
    ["Component Guide", "Screen_ComponentGuide.mht", EncyclopediaCategory.Screens, false],
    ["Change Theme Screen", "Screen_ChangeTheme.mht", EncyclopediaCategory.Screens, false],
    ["Capital Ships", "Ship_CapitalShip.mht", EncyclopediaCategory.Ships, false],
    ["Colony Ships", "Ship_ColonyShip.mht", EncyclopediaCategory.Ships, false],
    ["Construction Ships", "Ship_ConstructionShip.mht", EncyclopediaCategory.Ships, false],
    ["Cruisers", "Ship_Cruiser.mht", EncyclopediaCategory.Ships, false],
    ["Destroyers", "Ship_Destroyer.mht", EncyclopediaCategory.Ships, false],
    ["Escorts", "Ship_Escort.mht", EncyclopediaCategory.Ships, false],
    ["Exploration Ships", "Ship_ExplorationShip.mht", EncyclopediaCategory.Ships, false],
    ["Freighters", "Ship_Freighter.mht", EncyclopediaCategory.Ships, false],
    ["Frigates", "Ship_Frigate.mht", EncyclopediaCategory.Ships, false],
    ["Star Bases", "Ship_GenericBase.mht", EncyclopediaCategory.Ships, false],
    ["Mining Ships", "Ship_MiningShip.mht", EncyclopediaCategory.Ships, false],
    ["Mining Stations", "Ship_MiningStation.mht", EncyclopediaCategory.Ships, false],
    ["Space Ports", "Ship_SpacePort.mht", EncyclopediaCategory.Ships, false],
    ["Troop Transports", "Ship_TroopTransport.mht", EncyclopediaCategory.Ships, false],
    ["Resupply Ships", "Ship_ResupplyShip.mht", EncyclopediaCategory.Ships, false],
    ["Resort Bases", "Ship_ResortBase.mht", EncyclopediaCategory.Ships, false],
    ["Passenger Ships", "Ship_PassengerShip.mht", EncyclopediaCategory.Ships, false],
    ["Area Weapons", "Component_AreaWeapon.mht", EncyclopediaCategory.Components, false],
    ["Armor", "Component_Armor.mht", EncyclopediaCategory.Components, false],
    ["Beam Weapons", "Component_BeamWeapon.mht", EncyclopediaCategory.Components, false],
    ["Cargo Storage", "Component_CargoStorage.mht", EncyclopediaCategory.Components, false],
    ["Colonization Modules", "Component_ColonizationModule.mht", EncyclopediaCategory.Components, false],
    ["Combat Targetting", "Component_CombatTargetting.mht", EncyclopediaCategory.Components, false],
    ["Command Centers", "Component_CommandCenter.mht", EncyclopediaCategory.Components, false],
    ["Commerce Centers", "Component_CommerceCenter.mht", EncyclopediaCategory.Components, false],
    ["Construction Yards", "Component_ConstructionYard.mht", EncyclopediaCategory.Components, false],
    ["Countermeasures", "Component_Countermeasures.mht", EncyclopediaCategory.Components, false],
    ["Docking Bays", "Component_DockingBay.mht", EncyclopediaCategory.Components, false],
    ["Energy Collectors", "Component_EnergyCollector.mht", EncyclopediaCategory.Components, false],
    ["Engines", "Component_Engines.mht", EncyclopediaCategory.Components, false],
    ["Fuel Storage", "Component_FuelStorage.mht", EncyclopediaCategory.Components, false],
    ["Habitation Modules", "Component_HabitationModule.mht", EncyclopediaCategory.Components, false],
    ["Hyperdrives", "Component_HyperDrive.mht", EncyclopediaCategory.Components, false],
    ["Life Support", "Component_LifeSupport.mht", EncyclopediaCategory.Components, false],
    ["Long Range Scanners", "Component_LongRangeScanner.mht", EncyclopediaCategory.Components, false],
    ["Manufacturers", "Component_Manufacturer.mht", EncyclopediaCategory.Components, false],
    ["Medical Centers", "Component_MedicalCenter.mht", EncyclopediaCategory.Components, false],
    ["Components", "Component_Overview.mht", EncyclopediaCategory.Components, false],
    ["Proximity Arrays", "Component_ProximityArray.mht", EncyclopediaCategory.Components, false],
    ["Reactors", "Component_Reactor.mht", EncyclopediaCategory.Components, false],
    ["Recreation Centers", "Component_RecreationCenter.mht", EncyclopediaCategory.Components, false],
    ["Research Laboratories", "Component_ResearchLaboratory.mht", EncyclopediaCategory.Components, false],
    ["Resource Extractors", "Component_ResourceExtractor.mht", EncyclopediaCategory.Components, false],
    ["Resource Profile Sensors", "Component_ResourceProfileSensor.mht", EncyclopediaCategory.Components, false],
    ["Shields", "Component_Shields.mht", EncyclopediaCategory.Components, false],
    ["Torpedo Weapons", "Component_TorpedoWeapon.mht", EncyclopediaCategory.Components, false],
    ["Troop Storage", "Component_TroopStorage.mht", EncyclopediaCategory.Components, false],
    ["Vectoring Engines", "Component_VectoringEngines.mht", EncyclopediaCategory.Components, false],
    ["Damage Control", "Component_DamageControl.mht", EncyclopediaCategory.Components, false],
    ["Stealth", "Component_Stealth.mht", EncyclopediaCategory.Components, false],
    ["Passenger Storage", "Component_PassengerStorage.mht", EncyclopediaCategory.Components, false],
    ["Resources Visual Index", "Resource_VisualIndex.mht", EncyclopediaCategory.Resources, false],
    ["Space Creatures", "Creatures.mht", EncyclopediaCategory.Creatures, false],
    ["Ardilus", "Creature_3.mht", EncyclopediaCategory.Creatures, false],
    ["Giant Kaltor", "Creature_2.mht", EncyclopediaCategory.Creatures, false],
    ["Space Slug", "Creature_0.mht", EncyclopediaCategory.Creatures, false],
    ["Sand Slug", "Creature_1.mht", EncyclopediaCategory.Creatures, false],
];

const RELATED_BEFORE_LOOPS: ReadonlyArray<readonly [string, string]> = [
    ["Introduction", "Your Empire - State vs Private"],
    ["Introduction", "Keyboard Commands"],
    ["Introduction", "Controlling your Ships"],
    ["Colony Taxes", "Colony Growth"],
    ["Colony Taxes", "Government Types"],
    ["Colony Taxes", "Colony Approval"],
    ["Colony Taxes", "Your Empire - State vs Private"],
    ["Colony Taxes", "Your Empire Summary Screen"],
    ["Colony Taxes", "Corruption"],
    ["Colonization Tips", "Colonization"],
    ["Colonization Tips", "Independent planets and Traders"],
    ["Colonization Tips", "Continental Planets"],
    ["Colonization Tips", "Marshy Swamp Planets"],
    ["Colonization Tips", "Desert Planets"],
    ["Colonization Tips", "Ocean Planets"],
    ["Colonization Tips", "Ice Planets"],
    ["Colonization Tips", "Volcanic Planets"],
    ["Colonization Tips", "Resources"],
    ["Colonization Tips", "Space Ports"],
    ["Colonization Tips", "Ancient Ruins"],
    ["Colonization Tips", "Empire Territory"],
    ["Colonization Tips", "Colony Population Policies"],
    ["Economy Tips", "Colonization"],
    ["Economy Tips", "Colonization Tips"],
    ["Economy Tips", "Colony Growth"],
    ["Economy Tips", "Colony Taxes"],
    ["Economy Tips", "Resources"],
    ["Economy Tips", "Ship Costs"],
    ["Economy Tips", "Space Ports"],
    ["Economy Tips", "Government Types"],
    ["Economy Tips", "Diplomatic Relation Types"],
    ["Economy Tips", "Your Empire Summary Screen"],
    ["Economy Tips", "Corruption"],
    ["Colony Growth", "Colony Taxes"],
    ["Colony Growth", "Colony Population Policies"],
    ["Colony Approval", "Colony Taxes"],
    ["Colony Approval", "Colony Population Policies"],
    ["Your Empire Summary Screen", "Colony Taxes"],
    ["Your Empire Summary Screen", "Empire Policy Screen"],
    ["Independent planets and Traders", "Colonization Tips"],
    ["Independent planets and Traders", "Alien Races"],
    ["Colonization", "Colonization Tips"],
    ["Colonization", "Empire Territory"],
    ["Colonization", "Colony Population Policies"],
    ["Colony Ships", "Colonization Tips"],
    ["Colonization Tips", "Economy Tips"],
    ["Your Empire - State vs Private", "Economy Tips"],
    ["Your Empire Summary Screen", "Economy Tips"],
    ["Your Empire Summary Screen", "Colonization Tips"],
    ["Colony Growth", "Economy Tips"],
    ["Continental Planets", "Colonization"],
    ["Marshy Swamp Planets", "Colonization"],
    ["Desert Planets", "Colonization"],
    ["Ocean Planets", "Colonization"],
    ["Ice Planets", "Colonization"],
    ["Volcanic Planets", "Colonization"],
    ["Colonization", "Continental Planets"],
    ["Colonization", "Ocean Planets"],
    ["Colonization", "Marshy Swamp Planets"],
    ["Colonization", "Desert Planets"],
    ["Colonization", "Ice Planets"],
    ["Colonization", "Volcanic Planets"],
    ["Colonization Modules", "Continental Planets"],
    ["Colonization Modules", "Marshy Swamp Planets"],
    ["Colonization Modules", "Desert Planets"],
    ["Colonization Modules", "Ocean Planets"],
    ["Colonization Modules", "Ice Planets"],
    ["Colonization Modules", "Volcanic Planets"],
    ["Colonization Modules", "Colonization"],
    ["Construction Yards", "Construction"],
    ["Ancient Ruins", "Colony Growth"],
    ["Ancient Ruins", "Tourism"],
    ["Exploration", "Ancient Ruins"],
    ["Space Slug", "Asteroids"],
    ["Space Slug", "Mining Stations"],
    ["Sand Slug", "Desert Planets"],
    ["Sand Slug", "Mining Stations"],
    ["Giant Kaltor", "Frozen Gas Giant Planets"],
    ["Giant Kaltor", "Gas Clouds"],
    ["Giant Kaltor", "Shields"],
    ["Ardilus", "Gas Giant Planets"],
    ["SilverMist", "Ion Weapons"],
];

const RELATED_AFTER_LOOPS: ReadonlyArray<readonly [string, string]> = [
    ["Alien Races", "Independent planets and Traders"],
    ["Alien Races", "Government Types"],
    ["Alien Races", "Diplomacy"],
    ["Alien Races", "Diplomacy Screen"],
    ["Alien Races", "Colony Population Policies"],
    ["Characters Screen", "Characters"],
    ["Characters", "Characters Screen"],
    ["Characters", "Intelligence Missions"],
    ["Characters Screen", "Intelligence Missions"],
    ["Intelligence Missions", "Characters Screen"],
    ["Galaxy Map Screen", "Exploration"],
    ["Exploration", "Galaxy Map Screen"],
    ["Exploration", "Exploration Ships"],
    ["Your Empire Summary Screen", "Your Empire - State vs Private"],
    ["Your Empire Summary Screen", "Government Types"],
    ["Your Empire Summary Screen", "Colony Growth"],
    ["Your Empire - State vs Private", "Your Empire Summary Screen"],
    ["Your Empire - State vs Private", "Corporate Nationalism"],
    ["Diplomacy Screen", "Diplomacy"],
    ["Diplomacy", "Diplomacy Screen"],
    ["Diplomacy", "Diplomatic Relation Types"],
    ["Diplomacy", "Empire Reputation"],
    ["Diplomacy", "Government Types"],
    ["Diplomacy", "Blockades"],
    ["Diplomacy", "Empire Territory"],
    ["Diplomacy Screen", "Speaking to Other Empires"],
    ["Diplomacy Screen", "Diplomatic Relation Types"],
    ["Diplomacy Screen", "Pirates"],
    ["Diplomatic Relation Types", "Diplomacy"],
    ["Diplomatic Relation Types", "Diplomacy Screen"],
    ["Diplomatic Relation Types", "Pirates"],
    ["Diplomatic Relation Types", "Empire Territory"],
    ["Empire Reputation", "Diplomacy"],
    ["Empire Reputation", "Government Types"],
    ["Empire Territory", "Diplomacy"],
    ["Government Types", "Diplomacy"],
    ["Government Types", "Empire Reputation"],
    ["Speaking to Other Empires", "Diplomacy"],
    ["Speaking to Other Empires", "Diplomacy Screen"],
    ["Speaking to Other Empires", "Diplomatic Relation Types"],
    ["Speaking to Other Empires", "Government Types"],
    ["Colonies Screen", "Colonization"],
    ["Colonies Screen", "Colony Growth"],
    ["Colonies Screen", "Colony Approval"],
    ["Colonies Screen", "Construction"],
    ["Colonies Screen", "Troops Screen"],
    ["Colonies Screen", "Colony Population Policies"],
    ["Colony Growth", "Colony Approval"],
    ["Colony Growth", "Colonies Screen"],
    ["Colony Growth", "Migration"],
    ["Colony Approval", "Colony Growth"],
    ["Colony Approval", "Colonies Screen"],
    ["Colonization", "Colony Ships"],
    ["Colonization", "Colony Growth"],
    ["Ships and Bases Screen", "Ship Designs"],
    ["Ships and Bases Screen", "Ship Costs"],
    ["Ships and Bases Screen", "Fleets"],
    ["Ships and Bases Screen", "Construction"],
    ["Ships and Bases Screen", "Controlling your Ships"],
    ["Ships and Bases Screen", "Ship Mission Types"],
    ["Fleets Screen", "Fleets"],
    ["Fleets Screen", "Ships and Bases Screen"],
    ["Fleets Screen", "Combat - Space Battles"],
    ["Fleets", "Fleets Screen"],
    ["Fleets", "Combat - Space Battles"],
    ["Troops", "Troops Screen"],
    ["Troops Screen", "Troops"],
    ["Troops Screen", "Combat - Ground Combat"],
    ["Troops", "Combat - Ground Combat"],
    ["Research", "Research Screen"],
    ["Research", "Components"],
    ["Research", "Ship Designs"],
    ["Research Screen", "Research"],
    ["Research Screen", "Components"],
    ["Research Screen", "Ship Designs"],
    ["Research", "Research Stations"],
    ["Research Screen", "Research Stations"],
    ["Designs Screen", "Ship Designs"],
    ["Designs Screen", "Components"],
    ["Design Detail Screen", "Ship Designs"],
    ["Design Detail Screen", "Components"],
    ["Design Detail Screen", "Ship Costs"],
    ["Design Detail Screen", "Research"],
    ["Design Detail Screen", "Construction"],
    ["Ship Designs", "Designs Screen"],
    ["Ship Designs", "Design Detail Screen"],
    ["Ship Designs", "Components"],
    ["Ship Designs", "Research"],
    ["Ship Designs", "Ship Costs"],
    ["Main Screen", "Selection Panel"],
    ["Main Screen", "Ship Symbols"],
    ["Main Screen", "Mouse Actions"],
    ["Main Screen", "Controlling your Ships"],
    ["Main Screen", "Messages and Events"],
    ["Expansion Planner Screen", "Colonization"],
    ["Expansion Planner Screen", "Mining for Resources"],
    ["Expansion Planner Screen", "Resources"],
    ["Expansion Planner Screen", "Empire Territory"],
    ["Message History Screen", "Messages and Events"],
    ["Game Options - Advanced Display Settings Screen", "Game Options"],
    ["Game Options - Message Settings Screen", "Game Options"],
    ["Game Options - Message Settings Screen", "Messages and Events"],
    ["Game Options - Your Empire Settings Screen", "Game Options"],
    ["Component Guide", "Components"],
    ["Component Guide", "Ship Designs"],
    ["Main Screen", "Empire Navigation Tool"],
    ["Passenger Ships", "Tourism"],
    ["Passenger Ships", "Migration"],
    ["Resort Bases", "Tourism"],
    ["Resort Bases", "Passenger Ships"],
    ["Resort Bases", "Ancient Ruins"],
    ["Passenger Storage", "Passenger Ships"],
    ["Passenger Storage", "Resort Bases"],
    ["Passenger Storage", "Tourism"],
    ["Passenger Storage", "Migration"],
    ["Colonization Tips", "Migration"],
    ["Mining for Resources", "Resources"],
    ["Mining for Resources", "Fuel"],
    ["Mining for Resources", "Mining Stations"],
    ["Mining for Resources", "Mining Ships"],
    ["Mining for Resources", "Expansion Planner Screen"],
    ["Mining for Resources", "Empire Territory"],
    ["Engines", "Fuel"],
    ["Reactors", "Fuel"],
    ["Resources", "Fuel"],
    ["Fuel", "Energy To Fuel Converter"],
    ["Resources", "Mining for Resources"],
    ["Economy Tips", "Mining for Resources"],
    ["Tourism", "Resort Bases"],
    ["Tourism", "Passenger Ships"],
    ["Tourism", "Ancient Ruins"],
    ["Tourism", "Wonders"],
    ["Migration", "Passenger Ships"],
    ["Migration", "Colony Population Policies"],
    ["Fuel", "Resources"],
    ["Fuel", "Mining for Resources"],
    ["Fuel", "Mining Stations"],
    ["Fuel", "Mining Ships"],
    ["Fleets", "Resupply Ships"],
    ["Resupply Ships", "Fleets"],
    ["Ship Symbols", "Main Screen"],
    ["Messages and Events", "Message History Screen"],
    ["Messages and Events", "Game Options - Message Settings Screen"],
    ["Fighter Bays", "Fighters"],
    ["Fighter Bays", "Carriers"],
    ["Point Defense Weapons", "Fighters"],
    ["Selection Panel", "Main Screen"],
    ["Combat - Space Battles", "Combat - Colony Invasions"],
    ["Combat - Space Battles", "Combat - Ground Combat"],
    ["Combat - Ground Combat", "Troops"],
    ["Combat - Ground Combat", "Combat - Colony Invasions"],
    ["Combat - Ground Combat", "Combat - Space Battles"],
    ["Combat - Colony Invasions", "Troops"],
    ["Combat - Colony Invasions", "Combat - Ground Combat"],
    ["Combat - Colony Invasions", "Combat - Space Battles"],
    ["Carriers", "Combat - Space Battles"],
    ["Capital Ships", "Combat - Space Battles"],
    ["Cruisers", "Combat - Space Battles"],
    ["Destroyers", "Combat - Space Battles"],
    ["Frigates", "Combat - Space Battles"],
    ["Escorts", "Combat - Space Battles"],
    ["Troop Transports", "Combat - Ground Combat"],
    ["Troop Transports", "Combat - Colony Invasions"],
    ["Troop Transports", "Troops"],
    ["Troop Transports", "Combat - Space Battles"],
    ["Colony Ships", "Colonization"],
    ["Exploration Ships", "Exploration"],
    ["Space Ports", "Construction"],
    ["Construction Ships", "Construction"],
    ["Construction", "Space Ports"],
    ["Construction", "Construction Ships"],
    ["Construction", "Ship Costs"],
    ["Construction", "Colonies Screen"],
    ["Construction", "Ships and Bases Screen"],
    ["Construction", "Components"],
    ["Blockades", "Diplomacy"],
    ["Blockades", "Diplomatic Relation Types"],
    ["Ship Costs", "Ship Designs"],
    ["Ship Costs", "Components"],
    ["Ship Costs", "Resources"],
    ["Controlling your Ships", "Ship Mission Types"],
    ["Ship Mission Types", "Controlling your Ships"],
    ["Mouse Actions", "Main Screen"],
    ["Main Screen", "Keyboard Commands"],
    ["Keyboard Commands", "Controlling your Ships"],
    ["Controlling your Ships", "Keyboard Commands"],
    ["Components", "Research"],
    ["Components", "Ship Designs"],
    ["Components", "Resources"],
    ["Resources", "Components"],
    ["Resources", "Colony Growth"],
    ["Colony Growth", "Resources"],
    ["Empire Comparisons and Victory Conditions", "Your Empire Summary Screen"],
    ["Freighters", "Your Empire - State vs Private"],
    ["Mining Ships", "Your Empire - State vs Private"],
    ["Colonization", "Independent planets and Traders"],
    ["Combat - Space Battles", "Pirates"],
    ["Independent planets and Traders", "Colonization"],
    ["Carriers", "Controlling your Ships"],
    ["Capital Ships", "Controlling your Ships"],
    ["Cruisers", "Controlling your Ships"],
    ["Destroyers", "Controlling your Ships"],
    ["Frigates", "Controlling your Ships"],
    ["Escorts", "Controlling your Ships"],
    ["Troop Transports", "Controlling your Ships"],
    ["Construction Ships", "Controlling your Ships"],
    ["Exploration Ships", "Controlling your Ships"],
    ["Colony Ships", "Controlling your Ships"],
    ["Resources", "Mining Ships"],
    ["Resources", "Mining Stations"],
    ["Messages and Events", "Main Screen"],
    ["Mining Ships", "Resources"],
    ["Mining Stations", "Resources"],
    ["Diplomatic Relation Types", "Blockades"],
    ["Combat - Space Battles", "Fighters"],
    ["Carriers", "Fighters"],
    ["Capital Ships", "Fighters"],
    ["Cruisers", "Fighters"],
    ["Destroyers", "Fighters"],
    ["Construction", "Build Order Screen"],
    ["Construction", "Empire Navigation Tool"],
    ["Game Options", "Empire Policy Screen"],
    ["Empire Navigation Tool", "Selection Panel"],
    ["Fighters", "Fighter Bays"],
    ["Fighters", "Carriers"],
    ["Build Order Screen", "Construction"],
    ["Empire Policy Screen", "Game Options"],
    ["Corruption", "Planetary Facilities"],
    ["Corruption", "Government Types"],
    ["Planetary Facilities", "Colonies Screen"],
    ["Planetary Facilities", "Wonders"],
    ["Colonies Screen", "Planetary Facilities"],
    ["Colonies Screen", "Wonders"],
    ["Colony Population Policies", "Colonies Screen"],
    ["Colony Population Policies", "Colony Approval"],
    ["Colony Population Policies", "Colony Growth"],
    ["Colony Population Policies", "Migration"],
    ["Empire Territory", "Colonization"],
    ["Empire Territory", "Mining for Resources"],
    ["Intelligence Missions", "Characters"],
    ["Wonders", "Colonies Screen"],
    ["Wonders", "Planetary Facilities"],
    ["Wonders", "Tourism"],
    ["Ion Weapons", "SilverMist"],
    ["Assault Pods", "Boarding And Capture"],
    ["Assault Pods", "Pirates"],
    ["Tractor Beams", "Boarding And Capture"],
    ["Boarding And Capture", "Assault Pods"],
    ["Boarding And Capture", "Pirates"],
    ["Boarding And Capture", "Combat - Space Battles"],
    ["Pirates", "Boarding And Capture"],
    ["Pirates", "Start New Game Screen"],
    ["Introduction", "Start New Game Screen"],
    ["Introduction", "Pirates"],
    ["Combat - Colony Invasions", "Ground Report Screen"],
    ["Combat - Ground Combat", "Ground Report Screen"],
    ["Combat - Space Battles", "Boarding And Capture"],
    ["Ground Report Screen", "Troops"],
    ["Ground Report Screen", "Combat - Ground Combat"],
    ["Troops", "Ground Report Screen"],
    ["Troops Screen", "Ground Report Screen"],
    ["Your Empire Summary Screen", "Pirates"],
];
function slugify(title: string): string {
    const s = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s === '' ? 'topic' : s;
}

/**
 * Port of Main.Part5.cs method_465 (+ Galaxy.9.cs AddResourceTopics,
 * AddRaceTopics, AddGovernmentTopics): build the full Galactopedia topic
 * list with categories and related-topic links, in the original order.
 * Related links to titles that do not exist are skipped (the original would
 * add a null entry that its link box cannot display). Ends with
 * Galaxy.9.cs AddThemeTopics / AddGameInfoTopics, driven by
 * opts.helpListing (the stock install has no theme or GameInfo help, so
 * those topics are normally absent).
 */
export function buildEncyclopediaItems(text: GameText, opts: BuildEncyclopediaOptions): EncyclopediaItem[] {
    const items: EncyclopediaItem[] = [];
    const usedIds = new Set<string>();
    const make = (title: string, filename: string, category: EncyclopediaCategory, isCategoryRoot: boolean): EncyclopediaItem => {
        let id = slugify(title);
        if (usedIds.has(id)) {
            let n = 2;
            while (usedIds.has(`${id}-${n}`)) n++;
            id = `${id}-${n}`;
        }
        usedIds.add(id);
        return { id, title, filename, category, isCategoryRoot, relatedItems: [] };
    };
    const T = (key: string): string => getText(text, key);
    const L = (title: string): EncyclopediaItem | null => findEncyclopediaItem(items, title);
    const relate = (from: string, to: string): void => {
        const a = L(from);
        const b = L(to);
        if (a && b) a.relatedItems.push(b);
    };

    for (const [key, file, category, isRoot] of BASE_ITEMS) {
        items.push(make(T(key), file, category, isRoot));
    }

    // Port of Galaxy.9.cs AddResourceTopics.
    for (const res of opts.resources ?? []) {
        if (!res) continue;
        const file = `Resource_${removeSpecialCharacters(res.name)}.mht`;
        if (!opts.helpFileExists(file)) continue;
        items.push(make(res.name, file, EncyclopediaCategory.Resources, false));
        relate(res.name, T('Resources'));
        if (res.isFuel) {
            relate(res.name, T('Fuel'));
            relate(T('Fuel'), res.name);
        }
    }

    // Port of Galaxy.9.cs AddRaceTopics.
    const nativeTopic: Record<number, string> = {
        [HT_CONTINENTAL]: 'Continental Planets',
        [HT_MARSHY_SWAMP]: 'Marshy Swamp Planets',
        [HT_OCEAN]: 'Ocean Planets',
        [HT_DESERT]: 'Desert Planets',
        [HT_ICE]: 'Ice Planets',
        [HT_VOLCANIC]: 'Volcanic Planets',
    };
    for (const race of opts.races ?? []) {
        if (!race) continue;
        const file = `Race_${removeSpecialCharacters(race.name)}.mht`;
        if (!opts.helpFileExists(file)) continue;
        items.push(make(race.name, file, EncyclopediaCategory.Races, false));
        const planetKey = nativeTopic[race.nativeHabitatType];
        if (planetKey !== undefined) {
            relate(race.name, T(planetKey));
            relate(T(planetKey), race.name);
        }
    }

    // Port of Galaxy.9.cs AddGovernmentTopics.
    for (const gov of opts.governments ?? []) {
        if (!gov) continue;
        const file = `GameConcepts_GovernmentTypes_${removeSpecialCharacters(gov.name)}.mht`;
        if (!opts.helpFileExists(file)) continue;
        items.push(make(gov.name, file, EncyclopediaCategory.GovernmentTypes, false));
        relate(T('Government Types'), gov.name);
    }

    for (const [a, b] of RELATED_BEFORE_LOOPS) relate(T(a), T(b));

    const add = (item: EncyclopediaItem, title: string): void => {
        const target = L(title);
        if (target) item.relatedItems.push(target);
    };
    for (const item of items) {
        if (item.category === EncyclopediaCategory.Creatures && item.title !== T('Space Creatures')) add(item, T('Space Creatures'));
    }
    for (const item of items) {
        if (item.category === EncyclopediaCategory.Races && item.title !== T('Alien Races')) add(item, T('Alien Races'));
    }
    for (const item of items) {
        if (item.category === EncyclopediaCategory.PlanetsAndStars) {
            add(item, T('Galaxy Map Screen'));
            add(item, T('Resources Visual Index'));
        }
    }
    for (const item of items) {
        if (item.category === EncyclopediaCategory.Resources && item.title !== T('Resources')) add(item, T('Resources'));
        if (item.category === EncyclopediaCategory.Resources && item.title !== T('Resources Visual Index')) add(item, T('Resources Visual Index'));
    }
    for (const item of items) {
        if (item.category === EncyclopediaCategory.Components && item.title !== T('Components')) {
            add(item, T('Components'));
            add(item, T('Ship Designs'));
        }
    }
    for (const item of items) {
        if (item.category === EncyclopediaCategory.Ships) {
            add(item, T('Ship Costs'));
            add(item, T('Ship Designs'));
            add(item, T('Ships and Bases Screen'));
        }
    }
    for (const item of items) {
        if (item.category === EncyclopediaCategory.GovernmentTypes && !item.isCategoryRoot) {
            add(item, T('Government Types'));
            add(item, T('Diplomacy'));
        }
    }

    for (const [a, b] of RELATED_AFTER_LOOPS) relate(T(a), T(b));

    const listing = opts.helpListing ?? {};
    const setName = listing.customizationSetName ?? '';

    // Port of Galaxy.9.cs AddThemeTopics.
    if (setName !== '') {
        const files = listing.themeFiles ?? [];
        const rootFile = listing.themeRootExists ? `${setName}.mht` : (files[0] ?? '');
        if (rootFile !== '') {
            const title = format(T('THEMENAME Theme'), setName);
            const root = make(title, rootFile, EncyclopediaCategory.Theme, true);
            items.push(root);
            const main = make(title, rootFile, EncyclopediaCategory.Theme, false);
            items.push(main);
            for (const name of files) {
                const t = splitString(name.substring(setName.length + 1, name.length - 4));
                const item = make(t, name, EncyclopediaCategory.Theme, false);
                items.push(item);
                item.relatedItems.push(main);
                root.relatedItems.push(item);
                main.relatedItems.push(item);
            }
        }
    }

    // Port of Galaxy.9.cs AddGameInfoTopics.
    const prefix = 'GameInfo_';
    const infoFiles = listing.gameInfoFiles ?? [];
    if (infoFiles.length > 0) {
        const defaultFile = listing.gameInfoDefaultExists ? `${prefix}Default.mht` : '';
        let root: EncyclopediaItem;
        let main: EncyclopediaItem;
        if (defaultFile !== '') {
            root = make(T('Game Info'), defaultFile, EncyclopediaCategory.GameInfo, true);
            items.push(root);
            main = make(T('Game Info'), defaultFile, EncyclopediaCategory.GameInfo, false);
            items.push(main);
        } else {
            const name = infoFiles[0];
            root = make(T('Game Info'), name, EncyclopediaCategory.GameInfo, true);
            items.push(root);
            main = make(splitString(name.substring(prefix.length, name.length - 4)), name, EncyclopediaCategory.GameInfo, false);
            items.push(main);
        }
        for (const name of infoFiles) {
            if (name === root.filename) continue;
            const item = make(splitString(name.substring(prefix.length, name.length - 4)), name, EncyclopediaCategory.GameInfo, false);
            items.push(item);
            item.relatedItems.push(main);
            root.relatedItems.push(item);
            main.relatedItems.push(item);
        }
    }
    return items;
}

/** string.Format with positional {n} placeholders. */
function format(template: string, ...args: string[]): string {
    return template.replace(/\{(\d+)\}/g, (_m, i: string) => args[Number(i)] ?? '');
}

/** One category node of the topic tree. */
export interface EncyclopediaTreeNode {
    root: EncyclopediaItem;
    children: EncyclopediaItem[];
}

/** C# string.CompareTo (culture-aware) used by EncyclopediaItem.CompareTo. */
function compareTitles(a: EncyclopediaItem, b: EncyclopediaItem): number {
    return a.title.localeCompare(b.title, 'en');
}

/** Port of EncyclopediaTopicTree.cs BindItemsToTreeView: category roots
 *  sorted by title; under each, the non-root items of that category sorted
 *  by title. */
export function buildEncyclopediaTree(items: ReadonlyArray<EncyclopediaItem>): EncyclopediaTreeNode[] {
    const roots = items.filter((i) => i.isCategoryRoot).sort(compareTitles);
    return roots.map((root) => ({
        root,
        children: items.filter((i) => !i.isCategoryRoot && i.category === root.category).sort(compareTitles),
    }));
}

/** Resolve a ?topic= value: topic id, then title (case-insensitive), then
 *  help file name (with or without .mht; non-root items first). */
export function resolveEncyclopediaTopic(items: ReadonlyArray<EncyclopediaItem>, key: string): EncyclopediaItem | null {
    const k = key.trim().toLowerCase();
    if (k === '') return null;
    const byId = items.find((i) => i.id === k);
    if (byId) return byId;
    const byTitle = findEncyclopediaItem(items, key.trim());
    if (byTitle) return byTitle;
    const file = k.endsWith('.mht') ? k : `${k}.mht`;
    return (
        items.find((i) => !i.isCategoryRoot && i.filename.toLowerCase() === file) ??
        items.find((i) => i.filename.toLowerCase() === file) ??
        null
    );
}
