# Distant Worlds: Universe — Tutorial Script Research

Source directory: `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Tutorial/`
Files covered: `advanced.txt`, `basic.txt`, `DealingWithPirates.txt`, `EmpireAndColonies.txt`, `ExpansionDiplomacy.txt`, `FindingYourWayAround.txt`, `FleetsTroops.txt`, `PlayAsPirate.txt`, `PreWarpEmpire.txt`, `ResearchDesign.txt`, `ShipsAndMissions.txt`

Format notes:
- Each file is a step-by-step in-game tutorial. Steps are separated by a `~` line. Each step has a step title (repeated on two lines) and tutorial body text shown to the player.
- Every tutorial opens with a "Welcome" step: "To progress through each step of this tutorial click the 'Continue' button." / "You can move this tutorial window by dragging it with the mouse." / "Let's get started: click the 'Continue' button below." (wording varies slightly per file; see each section).
- Below, sentences in double quotes are VERBATIM from the tutorial files. Inner single or double quotes (e.g. 'Continue', 'Ctrl', "Build", 'Scrap') are part of the original wording and denote UI labels, button names, or keys — keep them when using these verbatim.
- Several files overlap heavily (advanced.txt contains the content of ExpansionDiplomacy.txt + FleetsTroops.txt + ResearchDesign.txt; basic.txt contains the content of FindingYourWayAround.txt + EmpireAndColonies.txt + ShipsAndMissions.txt; EmpireAndColonies.txt, FleetsTroops.txt, ResearchDesign.txt, and ShipsAndMissions.txt are subsets of those). Overlaps are reproduced per file as required.

## advanced.txt

Tutorial title: "Distant Worlds advanced tutorial" (taken from the main menu; it tells the player to "take the basic tutorial from the main menu" first).

### 1. Summary

The advanced tutorial teaches the advanced tools for expanding and managing an empire: the Galaxy Map (galaxy/system maps with snap-to indicator lines, Info Panel, planet surface picture, view filters), the Expansion Planner (galaxy-wide resource price/demand status plus target lists for sending colony ships and construction ships), diplomacy (relations, trade volume, treaties, warnings, gifts, trade sanctions, blockades, the Diplomacy screen and conversation screen with the "Speak" button), the Empire Comparison screen (race-specific victory condition progress and ranking graphs), research (three tech trees: Weapons, Energy, HighTech; research labs in Space Ports or Research Stations), ship and base design (Designs screen, Design Detail screen with role/tactics, red rules vs. yellow recommendations warnings, available/design components, component detail, Save), construction (right-click "Build" popup menu on a colony or space port, Construction Yards screen with a dropdown and "Purchase" button, Build Order screen with advisor-suggested ship counts), fleets (right-click "Join Fleet" submenu, inverted-triangle fleet icons with ship count, Fleets screen), troops (recruited at colonies via the Troops tab of the Colonies screen or the colony right-click popup, transported in ships with troop storage, managed in the Troops screen), and intelligence (agents managed in the Characters screen, missions assigned via the Mission summary panel with target empire + mission type + time, counter-intelligence agents, and the diplomatic fallout from discovered spy missions).

### 2. Game systems / UI elements / actions mentioned

- Galaxy Map (G key): shows everything known about the galaxy — potential colonies, resources, alien populations, pirates; constantly updated by discoveries from the player's ships
- Galaxy map at left: click to select a system; "map indicator lines will snap-to the system nearest the location where you clicked"
- System map at top right: click to select a planet, moon or asteroid; indicator lines snap-to nearest planet
- Info Panel at right middle: details of the selected planet or moon
- Planet surface picture displayed at bottom right
- Dropdown list filters the galaxy/system map view; matching systems/planets appear in yellow
- Expansion Planner screen (F3): plan next colony or mining station; assign missions to colony ships and construction ships
- Expansion Planner top: current status of all resources in the galaxy, current price and level of demand
- Expansion Planner bottom: target list (dropdown for types: potential colonies, potential mining locations, etc.); selected target shown on the map at right; buttons at the bottom send a colony ship or construction ship
- Diplomacy screen (F5): all relations for the selected empire; each relation shows total annual trade volume between the two empires
- Factors influencing relations: trade volume between empires; competition over systems and resources; like/dislike of an empire's Government type
- Selected empire summary at right (flag and dominant race); current relationship with the player's empire at the bottom
- "Speak" button at top-right initiates a conversation
- Conversation screen: options in the bottom panel — sending warnings, changing relationship (proposing treaties, declaring war), offering gifts
- Trade sanctions (empire refuses to trade with another; no resources bought or sold) and blockades (declared against enemy colonies and space ports; no trade by ANY empire; enforced by military ships from the initiating empire)
- Galactopedia (F1): context-sensitive help; referenced for blockades and general information
- Empire Comparison screen (V key): progress of each empire towards victory conditions, including unique race-specific victory conditions
- Empire Comparison graphs: ordered rankings of all known empires on several factors
- Research screen (F7): three research areas (Weapons, Energy, HighTech), each with its own tech tree
- Research labs at Space Ports or dedicated Research Stations; research categories; components usable in ships or bases
- Designs screen (F8): all ships and bases must be based on a design (templates/blueprints); edit existing or create new designs
- Design Detail screen: edit/view a design, add/remove components
- Design picture selectable from any ship picture in the game
- Design roles (each role has specific rules about which component types should be present); battle tactics and invasion tactics (see online help: Battle Tactics, Invasion Tactics)
- Warnings panel: rules in red (must be satisfied to save), recommendations in yellow (can be ignored); updated as components are added/removed
- Available Components panel (filtered by default to most recent version of each component type)
- Design Components panel ("This list effectively IS the design"); Add Component and Remove Component buttons; a design already used to build a ship or base cannot be modified
- Component Detail panel for the selected component (changes as selection changes in either component list)
- Save button: makes design available for construction; red Warnings requirements must be satisfied
- Construction: all construction costs money (Available Funds); tech level grows construction abilities (progressively larger ships/bases)
- Construction method 1: select build location in main view (space port for most ship types; colony for colony ships or construction ships); right-click → pop-up menu with a "Build" menu option; "Build" submenu lists valid designs for that location; unaffordable designs are disabled in the submenu
- Construction method 2: Construction Yards button/screen (F10) — Space Port construction yards; Construction Yards tab; dropdown list at right to select a ship; "Purchase" button; Available Funds flash red if unaffordable
- Construction method 3: Build Order button/screen (F9); shows current levels for each ship type and number of new ships suggested by advisors; modify ship amounts; select a specific design; 'Purchase' button
- Fleets: group military ships, assign missions to the whole group (coordinating large attacks)
- Assign ships to a fleet: select ships → right-click → mission popup menu → "Join Fleet" → select fleet in submenu (or create a new fleet with the selected ship as first ship)
- Fleet appearance at system zoom level: inverted triangle icon; number of ships displayed inside the triangle symbol
- Select a fleet: double-click any ship in the fleet
- Fleets screen (F12)
- Troops: defend colonies against invasion; can invade/take over enemy colonies; recruited at colonies (cost money to maintain)
- Troops tab of the Colonies screen (F2); right-click a colony in the main view → popup menu to recruit troops
- Troops loaded onto ships with troop storage components (troop transports, larger military ships); sent to another colony and unloaded to reinforce it, or used as an invasion force
- Troops screen: manages the troops in your empire
- Intelligence missions: secretly infiltrate other empires, steal or destroy their assets; intelligence agents are highly-trained specialists
- Characters screen (F4): manage agents
- Mission summary panel at bottom-right: assign missions to agents — select a target empire and a mission type; more time allowed = greater chance of success
- Counter intelligence: assign agents to prevent enemy intelligence missions; they seek out spies and saboteurs and report discoveries
- Fallout: if another empire discovers your intelligence actions it dramatically lowers their estimation of your empire and could lead to war
- Main menu: tutorials taken from the main menu; Galactopedia (F1) for more detailed information

### 3. Exact UI-relevant quotes (verbatim)

- "If you have not done so already, please take the basic tutorial from the main menu."
- "To progress through each step of this tutorial click the 'Continue' button."
- "Remember that you can move this tutorial window by dragging it with the mouse."
- "Let's get started: click the 'Continue' button below."
- "The Galaxy Map shows everything that you currently know about the galaxy: potential colonies, resources, alien populations, pirates and more."
- "Information on this map is constantly updated by discoveries made by the ships in your empire."
- "You access the Galaxy Map using the button indicated, or by pressing the G key."
- "Click the galaxy map at left to select a system. The map indicator lines will snap-to the system nearest the location where you clicked."
- "Click the system map at top right to select a particular planet, moon or asteroid."
- "As in the galaxy map, the system map indicator lines will snap-to the planet nearest the location where you clicked."
- "Details on the selected planet or moon are displayed in the Info Panel at right middle."
- "A picture of the surface of the selected planet or moon is displayed at bottom right."
- "You can filter the type of information displayed in the galaxy and system maps by selecting a view from the dropdown list."
- "Systems and planets matching the selected view appear in yellow on the galaxy and system maps."
- "The Expansion Planner screen provides powerful tools to help you plan the location of your next colony or mining station."
- "From here you can assign missions to your colony ships and construction ships, using them to expand your empire."
- "Open the Expansion Planner screen by using the button indicated or by pressing F3."
- "The top part of the screen shows the current status of all resources in the galaxy, including their current price and level of demand."
- "The bottom list can be changed to show various types of targets: potential colonies, potential mining locations, etc. Use the dropdown list to change the information shown here."
- "When you select a target from the list its location in the galaxy is shown on the map at the right. You can use the buttons at the bottom to send a colony ship or construction ship to the location."
- "You can monitor diplomatic relations from the Diplomacy screen (F5 key)"
- "The diplomacy screen shows all of the relations for the selected empire. Each relation shows the total annual trade volume between the two empires."
- "A summary of the selected empire appears at the right. This shows the empire's flag and dominant race."
- "The selected empire's current relationship with us appears at the bottom."
- "You can initiate a conversation with the selected empire by clicking the Speak button at the top-right."
- "In the conversation screen you can select from the options in the bottom panel."
- "This includes sending warnings, changing your relationship (proposing treaties, declaring war) or offering gifts."
- "Trade sanctions are where an empire refuses to trade with another empire. No resources will be bought or sold between the two empires."
- "When trade sanctions exist between two empires, blockades may be declared against enemy colonies and space ports. In this situation no trade by ANY empire is permitted with the blockaded colony or base. Blockades are enforced by military ships from the initiating empire."
- "See the Galactopedia (F1) for more information on initiating blockades."
- "You can track how you compare with other empires in the Empire Comparison screen."
- "Open this screen using the indicated button or the V key."
- "The progress of each empire towards meeting the victory conditions are shown here."
- "This includes each empire's unique race-specific victory conditions."
- "Here you can also view graphs showing ordered rankings of all known empires based on several different factors."
- "You choose which research projects you want to undertake in the Research screen (F7). Each of the three research areas (Weapons, Energy, HighTech) has its own tech tree containing all of the research projects for that area."
- "Research is performed in research laboratories at Space Ports or other dedicated Research Stations."
- "There are a number of different research categories. Each category has a collection of components that can be used in ships or bases."
- "All of the ships and bases in your empire must be based on a design. Designs are templates or blueprints for building a ship or base."
- "Designs are managed from the Designs screen (F8 key)."
- "In the Designs screen you can edit an existing design or create a new one."
- "In the Design Detail screen you can edit or view a design."
- "Here you can add and remove components to customize your design to your own special requirements."
- "The various panels on this screen give detailed information about the design."
- "Here you can select a picture for your design from any of the ship pictures in the game."
- "Assign a role for the design. This indicates the purpose of the ship or base. Each role has specific rules about what component types should be present."
- "Assign tactical behavior when in combat using battle and invasion tactics. See online help for more information on Battle Tactics and Invasion Tactics."
- "This panel lists rules and recommendations to assist in producing a valid design. As you add and remove components to the design the warnings are updated to identify current problems."
- "Rules are in red and must be satisfied to allow the design to be saved."
- "Recommendations are in yellow and can be ignored if desired."
- "This panel lists all components available for using in the design."
- "By default this list is filtered to only show the most recent version of each component type."
- "This panel lists all of the components currently used on the design. This list effectively IS the design."
- "Use the Add Component and Remove Component buttons to modify your design."
- "If the design has already been used to build a ship or base you cannot modify it. You cannot change the components that it uses."
- "This panel provides detailed information for the currently selected component."
- "The component shown here changes as you select different components in either the Available Components list or the Design Components list."
- "When you are finished creating your new design click the Save button to make the design available for construction."
- "Note that all requirements in the Warnings panel (in red) must be satisfied before you can save the new design."
- "All construction costs money - you must have sufficient funds to buy new ships and bases."
- "The first way to build a new ship is to select the build location in the main view. The build location can be either a space port (for most ship types) or a colony (for colony ships or construction ships)."
- "With your colony or space port selected, right click to show a pop-up menu with a "Build" menu option."
- "The "Build" submenu lists all designs that are valid to build at this location. Select one to begin construction."
- "If you cannot afford to build a particular design it will be disabled in the submenu."
- "The second way to build a new ship involves jumping directly to the Space Port construction yards. Do this by clicking on the Construction Yards button (F10 key)."
- "In the Construction Yards tab, select a ship to purchase from the dropdown list at the right. Then click the "Purchase" button to begin construction."
- "If you cannot afford to build the selected ship your Available Funds will flash red."
- "Another very efficient way to build new ships is the Build Order screen. Open this screen by clicking the Build Order button (F9 key)."
- "On this screen you can see your current levels for each ship type, as well as the number of new ships suggested by your advisors."
- "You can modify the amount of ships for each type, and select a specific design to build."
- "When you are satisfied with the order, click the 'Purchase' button to buy the new ships and begin construction."
- "Fleets allow you to group a number of military ships together and assign missions to the entire group. This is useful for coordinating large attacks on enemy targets."
- "You can assign any of your military ships to a fleet by selecting them, then right-clicking on them to display the mission popup menu. Select "Join Fleet" from the menu and then select which fleet you want to join in the submenu."
- "From the submenu you can also create a new fleet with the selected ship as the first ship in the fleet."
- "When you are zoomed out to system level, fleets appear as an inverted triangle icon."
- "The number of ships in the fleet is displayed inside the triangle symbol."
- "To select one of your fleets, just double-click any ship in the fleet."
- "Fleets are managed from the Fleets screen (F12 key)."
- "Troops are recruited at your colonies. They cost money to maintain, so only recruit troops that you really need."
- "You can recruit troops from the Troops tab of the Colonies screen (F2 key)."
- "You can also right-click on any of your colonies in the main view to recruit them from the popup menu."
- "Troops can be loaded onto ships that have troop storage components, such as troop transports or larger military ships. They can then be sent to another colony and unloaded there to reinforce it. Or they can be used as an invasion force at an enemy colony."
- "The troops in your empire can be managed from the Troops screen."
- "Intelligence missions enable you to secretly infiltrate other empires and steal or destroy their assets."
- "Your agents can be managed from the Characters screen (F4 key)."
- "The Mission summary panel at the bottom-right of the screen allows you to assign missions to agents."
- "Select a target empire for the mission and a mission type."
- "The more time you allow for the mission, the greater the chance of success."
- "Beware of the negative fallout from botched intelligence missions - if another empire discovers your actions against them it will dramatically lower their estimation of your empire, and could even lead to war."
- "Please refer to the Galactopedia (F1) for even more detailed information."

## basic.txt

Tutorial title: "the Distant Worlds tutorial" (basics of how to run your empire).

### 1. Summary

The basic tutorial is the core getting-started guide. It teaches main-view navigation (edge-of-screen scrolling, arrow keys, right-mouse-button drag, scroll-wheel/PageUp/PageDown zoom, ZoomIn/ZoomOut buttons, Ctrl-click to zoom in, and zoom presets for 100%/system/sector/galaxy views), how the map reads (explored vs unexplored system names, colonized systems circled in the empire's color with circle size = importance, empire territory shown with a colored background, independent systems circled with a solid grey line, potential colonies shown as a dashed grey circle), and every main-screen element: the Selection Panel (bottom left), the Empire Navigation Tool (left side, scrollable icon lists, Action buttons under the Selection Panel, double-click to fly to, yellow "ping" circle on hover), the bottom-right map with a blue rectangle indicating the main view, the top-of-screen scrolling message list of recent events, the Pause button (top-left), the Game Menu button (top-left: load/save, game options, exit), and the Game Options screen (O key) for automation levels. It then covers empire structure (State vs Private citizens, government style and revolutions, state income from colony taxes, space-port transaction fees, private ship purchases, and trade bonuses), colonies (the game is lost when all colonies are lost; automatic vs manual tax; population and development level growth shown in the colony name badge graph; gold star for the empire capital; dominant race and resources at the bottom of the name badge; the Colonies screen at F2 and the Cycle Colonies button / 'C' key), and ships/bases (Ships and Bases screen F11; Designs screen F8; missions assigned by left-click select + right-click on the target; right-click popup menu with type-specific missions such as Exploration, Colonization, Building, Refueling; the 'A' automation key with a circular blue arrow indicator in the Selection Panel; base missions like building, retrofitting, scrapping; and the ship-type tour with cycle buttons/keys: Cycle Colony and Exploration Ships 'X', Cycle Space Ports 'P', Cycle Construction Ships 'Y', Cycle Military Ships 'M', Cycle Idle Ships 'I'), plus ship types (exploration ships, colony ships built only at colonies and consumed on colonization, space ports, private freighters and mining ships that cannot be given missions, mining stations, construction ships, military ships with Attack/Patrol/Escort missions).

### 2. Game systems / UI elements / actions mentioned

- Main view: shows a portion of the galaxy; move by moving the mouse pointer to the edge of the screen (scroll up/down/left/right), arrow keys, or dragging with the right mouse button held down
- Zoom: mouse scroll wheel, PageUp and PageDown keys, ZoomIn and ZoomOut buttons on the main screen; zoom presets via Zoom buttons: 100% (default), system view, sector view, galaxy view; zoom into any location by holding the 'Ctrl' key while clicking
- System view: colonies and ships of an empire identified by the empire's main color
- Sector view: main view shows systems; ships and bases shown as icons; icon color indicates owning empire
- Explored systems: names displayed next to them; unexplored systems: no name displayed
- Colonized systems: circled with the empire's color; circle size indicates the system's relative importance (larger = more valuable)
- Empire territory: colored background on the system; a system can be owned even when not colonized; colonies project the empire's influence into nearby systems
- Independent systems: circled with a solid grey line; good colonization targets (existing alien population boosts new colony population)
- Systems with potential colonies: indicated by a dashed grey circle
- Galactopedia Help: context-sensitive help on the selected item or open screen; detailed planet/ship info; game concepts; each screen; access by pressing F1 or clicking the Help button
- Selection Panel at the bottom left of the screen: detailed information on the selected item (colony, ship, system, etc.); select items by clicking them in the main screen
- Empire Navigation Tool at the left of the screen: a set of scrollable lists for quick access to empire items — colonies, space ports, construction ships, exploration ships, enemy targets, fleets, new potential colonies, potential mining locations, and more
- ENT lists: click an icon to open a list, click again to close, or use the close button at the right of the list's title bar; click an item to select it in the Selection Panel below; Action buttons under the Selection Panel give common tasks for the selected item; double-click an item in a list to move the main view to it; hovering over an item at sector/galaxy zoom 'pings' its location with an expanding yellow circle
- Map at the bottom right: shows the surrounding area; the blue rectangle in the middle of the map indicates the area displayed in the main view; click anywhere on the map to move the main view; the map auto-zooms with the main view
- Scrolling message list at the top of the screen: displays recent events in your empire; click an event to move to the location of the event
- Pause button at the top-left of the screen: click once to pause, click again to resume
- Game Menu button at the top-left of the screen: load and save games, alter game options, or exit the game
- Game Options screen (O key): customize game settings; automate empire tasks (Colonization, Ship Building, etc.); at new game many tasks are automated; automation can be progressively turned off
- Empire Summary screen (F6): summary of your empire
- State vs Private: State = the portion you control; Private = private citizens who act without your help (trade goods, transport cargo, mine resources automatically)
- State's four basic tasks: Exploring the galaxy, Colonizing new planets, Constructing new ships, Defending your empire
- Government Style: each empire has a government type with advantages/disadvantages; change by revolution (negative side effects: temporary setback of development at colonies)
- State income: colony taxes; transaction fees at your space ports; purchases of new ships by private citizens; bonuses from trade with other empires
- Colonies: lose all colonies = lose the game; colonies produce wealth via tax; colony tax levels controlled automatically by default, alterable per colony
- Colony growth: population (grows to a planet maximum) and development level (grows with steady luxury resource supply; more wealth and tax revenue)
- Population Indicator: graph in the colony's name badge — horizontal axis = population size, vertical axis = development level
- Empire and Capital: owning empire shown by color of surrounding circle and name badge; empire capital gets a gold star to the left of the name
- Dominant alien race displayed at the bottom of the name badge; natural resources at the colony also displayed at the bottom of the name badge (auto-mined, used to build or sold)
- Colonies screen: complete list of all colonies; opened by the button indicated or the 'F2' key
- Cycle Colonies button (or 'C' key): cycle through all colonies
- Ships and Bases button (F11 key): complete list of all ships and bases
- Designs screen (F8 key): design ships and bases to exact specifications (see Advanced tutorial)
- Mission assignment: left-click a ship in the main view to select; right-click over the mission target (e.g., right-click a location to make a ship move there); may need to unpause to see movement
- Right-click popup menu on a ship/base: missions specific to the ship/base type — "Exploration, Colonization, Building, Refueling, or many others"
- Automation: select a ship and press the 'A' key to automate (ship assigns missions for itself); assign a mission to turn off automation; automated ships show a circular blue arrow in the bottom-right corner of the Selection Panel; ALL ships start the game automated
- Base missions: building new ships, retrofitting to a new design, scrapping the base
- Exploration ships: chart unknown areas, reveal colonizable planets/resources, make contact; automatable ('A' key); cycle with the Cycle Colony and Exploration Ships button or 'X' key
- Colony ships: colonize planets; consumed when a colony is established (ship resources kickstart the colony); can only be built at colonies (most other ships at space ports); initially only the native planet type is colonizable (research unlocks others); planets with existing independent alien populations are always colonizable (the population may resist, risking the colony ship); cycle with the same button/'X' key
- Space Ports: bases built only at a colony; central point of trade (freighters and mining ships bring mined resources); construction facilities (state and private ships built here; empire earns income when private citizens buy ships); heavy weapons defend the colony; research facilities for scientists and engineers; population happiness bonuses (medical facilities and recreation centres); cycle with the Cycle Space Ports button or 'P' key
- Freighters: transport cargo between colonies, mining stations and space ports; small/medium/large sizes; privately owned; cannot be given missions
- Mining Ships: mobile resource extraction; mine high-demand resources and return them to the nearest space port; privately owned; cannot be given missions
- Mining Stations: bases extracting resources from planets, moons, asteroids and gas clouds; standard or gas mining stations; built by Construction Ships at resource-rich planets
- Construction Ships: mobile construction yards; build bases at uninhabited planets or in deep space; cycle with the Cycle Construction Ships button or 'Y' key
- Military Ships: defend from enemy empires and pirates; missions: Attack an enemy target, Patrol a colony or base, Escort a civilian ship (e.g., construction ship or mining ship); various sizes and classes; cycle with the Cycle Military Ships button or 'M' key
- Find Idle Ships: Cycle Idle Ships button (or 'I' key) finds ships with no current mission
- Main menu: the Advanced Tutorial can be taken from the main menu

### 3. Exact UI-relevant quotes (verbatim)

- "To progress through each step of this tutorial click the 'Continue' button."
- "You can move this tutorial window by dragging it with the mouse."
- "Let's get started: click the 'Continue' button below."
- "The main view shows a portion of the galaxy - in this case a small portion of one star system near one of your colony planets."
- "Move the mouse pointer to the edge of the screen to scroll the main view up, down, left or right. You can also use the arrow keys on your keyboard to do the same thing."
- "You can also drag the main view by holding down the right mouse button."
- "Use the mouse scroll wheel to zoom the main view in or out. You can also use the PageUp and PageDown keys to do the same thing."
- "The ZoomIn and ZoomOut buttons on the main screen also allow you to zoom in or out."
- "When zoomed out to system level you can identify the colonies and ships for an empire by the empire's main color."
- "You can zoom in to any location by holding down the 'Ctrl' key while clicking."
- "As you zoom out further the main view changes to show systems."
- "At this level ships and bases are shown as icons. The icon color indicates which empire the ship or base belongs to."
- "Systems that you have explored have their names displayed next to them."
- "Systems that you have not yet explored have no name displayed next to them."
- "Systems that have been colonized by an empire are circled with their empire's color."
- "The size of the circle indicates the system's relative importance - larger systems are more valuable."
- "Systems that are part of an empire's territory have a colored background."
- "A system can be owned by an empire even when it is not colonized."
- "Colonies project their empire's influence into nearby systems, making them part of their empire's territory."
- "These independent systems are circled with a solid grey line."
- "Any systems with potential colonies are indicated by a dashed grey circle."
- "The Zoom buttons allow you to instantly zoom to several preset levels:
  - 100% (default)
  - system view
  - sector view
  - galaxy view"
- "You can access the Galactopedia Help system at any time by pressing F1 or by clicking the Help button."
- "At the bottom left of the screen is the Selection Panel."
- "This displays detailed information on the selected item, whether that be a colony, ship, system, etc."
- "To select an item in the main screen simply click on it with the mouse."
- "At the left of the screen is the Empire Navigation Tool. This is a set of scrollable lists that provide quick access to everything in your empire."
- "This includes items like: your colonies, space ports, construction ships, exploration ships, enemy targets, fleets, new potential colonies, potential mining locations, and much more."
- "Click an icon to open one of the lists. Click the icon again to close the list, or use the close button at the right of the list's title bar."
- "Click an item in a list to select it in the Selection Panel below."
- "You can then use the Action buttons under the Selection Panel to access many common tasks for the selected item, allowing you to easily manage most of your empire directly from the main screen."
- "Double-clicking an item in a list will move the main view to that item."
- "When you are zoomed out to the sector- or galaxy-level then hovering over an item in a list will 'ping' the location of that item in the galaxy with an expanding yellow circle."
- "At the bottom right is a map. This shows the surrounding area."
- "The area displayed in the main view is indicated by the blue rectangle in the middle of the map."
- "Click anywhere on the map to move the main view to that location."
- "The map automatically zooms in or out when you zoom the main view."
- "At the top of the screen is a list that displays recent events that have occurred in your empire."
- "Click on an event in this list to move to the location of the event."
- "At the top-left of the screen is the Pause button. This allows you to pause or resume the game at any time."
- "Click once to pause the game. Click again to resume the game."
- "At the top-left of the screen is the Game Menu button."
- "This accesses the Game Menu where you can load and save games, alter game options or exit the game."
- "The Game Options screen (O key) allows you to customize game settings."
- "In particular, you can automate certain empire tasks like Colonization, Ship Building, etc. This allows you to focus on other areas of your empire that interest you more."
- "When you first start Distant Worlds many tasks are automated for you. The automation of these tasks can be progressively turned off, as you desire greater control over the details of your empire."
- "You can view a summary of your empire from the Empire Summary screen (F6). Click the Empire Summary button to show this screen."
- "Colonies are the heart of your empire. When you lose all of your colonies, you lose the game."
- "By default colony tax levels are controlled automatically, but you can alter each colony tax rate directly if you prefer."
- "The population size and development level of a colony is indicated by the graph displayed in the colony's name badge."
- "The horizontal axis indicates the population size. The vertical axis relates to the development level."
- "The empire owning a colony is indicated by the color of the surrounding circle and name badge. If the colony is the empire capital a gold star also appears to the left of the name."
- "The dominant alien race at the colony is displayed at the bottom of the name badge."
- "The natural resources present at the colony are also displayed at the bottom of the name badge."
- "You can open this screen using the button indicated or by pressing the 'F2' key."
- "You can quickly cycle through all of the colonies in your empire by using the Cycle Colonies button."
- "You can do the same thing by pressing the 'C' key."
- "To see a complete list of all the ships and bases in your empire click the Ships and Bases button (F11 key)."
- "All your empire's ships and bases can be designed to your exact specifications in the Designs screen (F8 key)."
- "To assign a mission to a ship first select it in the main view by left-clicking on it with the mouse."
- "Then right-click the mouse over the mission target, e.g. to make a ship move to another location right-click the mouse at that location."
- "Note that you may need to unpause the game to see the ship move."
- "Right-clicking on the ship or base may also bring up a popup menu listing a number of missions."
- "These missions are specific to the particular type of ship or base. They may include: Exploration, Colonization, Building, Refueling, or many others."
- "To automate a ship first select it and then press the 'A' key. To turn off automation just assign a mission to the ship."
- "When a ship is automated a circular blue arrow appears in the bottom-right corner of the Selection Panel."
- "Note that ALL ships start the game automated."
- "Base missions can include: building new ships, retrofitting to a new design or scrapping the base when it is no longer needed."
- "Exploration ships can be automated to explore on their own ('A' key)."
- "To cycle through all of your Exploration ships use the Cycle Colony and Exploration Ships button, or use the 'X' key."
- "To cycle through all your colony ships use the Cycle Colony and Exploration Ships button, or use the 'X' key."
- "To cycle through all of your Space Ports use the Cycle Space Ports button, or use the 'P' key."
- "Use the Cycle Construction Ships button to cycle through all the construction ships in your empire, or use the 'Y' key."
- "Use the Cycle Military Ships button to cycle through them, or use the 'M' key."
- "You can find ships that don't currently have a mission by clicking the Cycle Idle Ships button (or press the I key)."
- "When you are ready you can also try the Advanced Tutorial from the main menu."

## DealingWithPirates.txt

Tutorial title: "the Distant Worlds tutorial about Dealing with Pirates when playing as a normal empire".

### 1. Summary

This tutorial explains how a normal (non-pirate) empire should deal with pirates. It advises paying a Protection Agreement to pirates early in the game (especially before the home spaceport is armed) to buy time to establish the empire. It then shows how to put pirates to work as mercenaries: the player selects a colony and clicks the 'Assign Mercenary Smuggling Mission' action button under the Selection Panel (choosing a resource or 'All' in a small pop-up panel, then clicking Assign), or selects an enemy base and clicks 'Assign Mercenary Attack Mission', or selects a base/colony to protect and clicks 'Assign Mercenary Defense Mission' (defend missions last two years and require an existing Protection Agreement). Pirate Missions appear in the Pirate Missions panel in the Empire Navigation Tool (ENT) at screen left; factions bid until one wins; fees are paid automatically on completion; missions can be cancelled via the Cancel button. Finally it covers eradicating pirates: eliminating a faction requires destroying its colonies (controlled or owned), refuelling locations (spaceports or gas mining stations), and construction/resupply ships — destroying their spaceport alone severely handicaps them; and removing pirates that have established a Pirate Base or Pirate Fortress at your own colony by launching a ground invasion from the Facilities tab of the Colonies screen (F2), where the 'Scrap' button changes to 'Attack' and the attack uses all troops currently at the colony.

### 2. Game systems / UI elements / actions mentioned

- Protection Agreement: pay pirates to refrain from attacking; recommended early on, "especially true before your spaceport is armed"
- Pirate smuggling missions: pirates fill resource shortages by smuggling resources to your colony
- Action buttons underneath the Selection Panel: 'Assign Mercenary Smuggling Mission', 'Assign Mercenary Attack Mission', 'Assign Mercenary Defense Mission'
- Small pop-up panel: select the desired resource (or 'All'), then click the Assign button
- Pirate Missions panel in the Empire Navigation Tool (ENT) at screen left: shows smuggling/attack/defend missions; Cancel button cancels a mission at any time
- Pirate factions bid on attack and defend missions until one wins; fees are paid automatically when the mission is completed (attack: target destroyed or captured; defend: base/colony protected until the specified date — defend missions last two years and require a Protection Agreement)
- Pirate smuggling freighters arrive at your colony to drop off the requested resources once accepted
- Eradication requirements: destroy all of the faction's colonies (controlled or owned), refuelling locations (spaceports or gas mining stations), and construction ships or resupply ships; destroying the spaceport eliminates their construction yard so they can no longer build ships
- Pirates can establish control at your colonies and build pirate facilities: Pirate Base or Pirate Fortress
- Colonies screen (F2), Facilities tab: select the target pirate facility — the 'Scrap' button changes to 'Attack'; clicking it launches a ground attack using all troops currently at the colony; success destroys the pirate facility
- Galactopedia (F1) for more information

### 3. Exact UI-relevant quotes (verbatim)

- "Early in the game you are poorly equipped to resist any pirates, so you should agree to pay a Protection Agreement with any pirates. This is especially true before your spaceport is armed."
- "To request a pirate smuggling mission select your colony and click the 'Assign Mercenary Smuggling Mission' action button underneath the Selection Panel. Select the desired resource (or 'All') in the small pop-up panel that appears and click the Assign button."
- "The smuggling mission will appear in the Pirate Missions panel in the Empire Navigation Tool at screen left. You can cancel the smuggling mission at any time by clicking the Cancel button here."
- "Once accepted by a pirate faction, their smuggling freighters will eventually arrive at your colony to drop off the requested resources."
- "To request one of these Pirate Attack missions, select the target enemy base and click the 'Assign Mercenary Attack Mission' action button underneath the Selection Panel."
- "The new attack mission will appear in the Pirate Missions panel in the ENT, the same as for smuggling missions. Pirate factions will bid on the mission, until one faction wins the mission."
- "When the pirates complete the attack mission for you (by destroying or capturing the target base) the fee will automatically be paid to them."
- "To request one of these Pirate Defend missions, select the base or colony you want protected and click the 'Assign Mercenary Defense Mission' action button underneath the Selection Panel."
- "The new defend mission will appear in the Pirate Missions panel in the ENT, the same as for smuggling missions. Pirate factions will bid on the mission, until one faction wins the mission."
- "When the pirates complete the defend mission for you (by protecting your base or colony until the specified date) the fee will automatically be paid to them."
- "Pirate factions may establish control at one or more of your colonies. They may have also built a pirate facility at the colony, such as a Pirate Base or Pirate Fortress."
- "To do this open the Facilities tab in the Colonies screen (F2). Select the target pirate facility - the 'Scrap' button will change to 'Attack'. Clicking the attack button will launch a ground attack against the pirate facility using all of your troops currently at the colony. If successful, the ground attack will destroy the pirate facility."
- "Please refer to the Galactopedia (F1) for more information."

## EmpireAndColonies.txt

Tutorial title: "the Distant Worlds tutorial about your Empire and Colonies".

### 1. Summary

A focused sub-tutorial (a subset of the basic tutorial) covering empire overview and colonies. It shows the Empire Summary screen (F6, via the Empire Summary button); explains the State vs Private split (you control only the State portion — exploring, colonizing, constructing, defending — while private citizens trade, transport, and mine on their own); explains government styles and changing them by revolution (with negative side effects including a temporary setback of development at your colonies); lists the four state income sources (colony taxes, space-port transaction fees, private ship purchases, trade bonuses with other empires); states the game-over rule (lose all colonies = lose the game); and covers colony management: automatic vs directly-set tax rates, growth in population and development level (luxury resources drive development and tax revenue), the population/development graph in the colony's name badge, the owning-empire color coding and the gold star for the empire capital, dominant race and natural resources shown at the bottom of the name badge, the full Colony List in the Colonies screen (F2), and cycling through colonies with the Cycle Colonies button or the 'C' key. It closes by pointing to the other tutorials from the main menu.

### 2. Game systems / UI elements / actions mentioned

- Empire Summary screen (F6): summary of your empire; opened by the Empire Summary button
- State vs Private sections of the empire: State (you control it: exploring the galaxy, colonizing new planets, constructing new ships, defending your empire), Private (private citizens who trade goods, transport cargo, and mine resources without your intervention)
- Government Style: each empire type has advantages/disadvantages; change by revolution (side effects include a temporary setback of development at your colonies)
- State income sources: colony taxes; transaction fees at your space ports; purchases of new ships by private citizens; bonuses from trade with other empires
- Game over: "When you lose all of your colonies, you lose the game."
- Colonies: main revenue from taxing colonies; tax levels controlled automatically by default, alterable per colony
- Colony growth: population (grows over time to a planetary maximum) and development level (grows with a steady supply of luxury resources; higher = more wealth and tax revenue)
- Population Indicator: graph in the colony's name badge — horizontal axis = population size, vertical axis = development level
- Empire and Capital: owning empire indicated by color of surrounding circle and name badge; empire capital marked by a gold star to the left of the name
- Dominant alien race displayed at the bottom of the name badge
- Natural resources displayed at the bottom of the name badge; automatically mined and used to build things or sold
- Colony List: complete list of all colonies in the Colonies screen, opened by the button indicated or the 'F2' key
- Cycle Colonies button (or 'C' key): quickly cycle through all colonies
- Main menu: "you can also try the other tutorials from the main menu"

### 3. Exact UI-relevant quotes (verbatim)

- "You can view a summary of your empire from the Empire Summary screen (F6). Click the Empire Summary button to show this screen."
- "Colonies are the heart of your empire. When you lose all of your colonies, you lose the game."
- "By default colony tax levels are controlled automatically, but you can alter each colony tax rate directly if you prefer."
- "The population size and development level of a colony is indicated by the graph displayed in the colony's name badge."
- "The horizontal axis indicates the population size. The vertical axis relates to the development level."
- "The empire owning a colony is indicated by the color of the surrounding circle and name badge. If the colony is the empire capital a gold star also appears to the left of the name."
- "The dominant alien race at the colony is displayed at the bottom of the name badge."
- "The natural resources present at the colony are also displayed at the bottom of the name badge."
- "You can open this screen using the button indicated or by pressing the 'F2' key."
- "You can quickly cycle through all of the colonies in your empire by using the Cycle Colonies button."
- "You can do the same thing by pressing the 'C' key."
- "When you are ready you can also try the other tutorials from the main menu."

## ExpansionDiplomacy.txt

Tutorial title: "the Distant Worlds tutorial about Expansion and Diplomacy".

### 1. Summary

A focused sub-tutorial (a subset of the advanced tutorial) covering galaxy expansion and diplomacy. It teaches the Galaxy Map (G key): it shows everything you know (potential colonies, resources, alien populations, pirates, and more), is constantly updated by your ships' discoveries; you click the galaxy map at left to select a system (indicator lines snap to the nearest system), click the system map at top right to select a planet/moon/asteroid, see details in the Info Panel at right middle and the planet surface picture at bottom right, and filter the maps with a view dropdown (matching systems/planets appear in yellow). It teaches the Expansion Planner (F3): the top of the screen shows all galaxy resources with current price and level of demand; the bottom list (dropdown) shows targets such as potential colonies and potential mining locations; selecting a target shows it on the map at right and buttons at the bottom send a colony ship or construction ship. It teaches the Diplomacy screen (F5): relations with total annual trade volume per empire pair; influences (trade volume, competition over systems and resources, government type likes/dislikes); the selected empire's summary (flag and dominant race) at the right and the current relationship at the bottom; the "Speak" button at top-right opens the conversation screen, whose bottom panel offers warnings, relationship changes (proposing treaties, declaring war), or gifts. It covers trade sanctions (no trade between the two empires) and blockades (no trade by ANY empire with the blockaded colony/base, enforced by the initiating empire's military ships, see Galactopedia F1), and the Empire Comparison screen (V key) showing each empire's progress towards the victory conditions (including unique race-specific ones) plus graphs of ordered rankings.

### 2. Game systems / UI elements / actions mentioned

- Galaxy Map (G key): known galaxy information — potential colonies, resources, alien populations, pirates; constantly updated by discoveries from your ships
- Galaxy map at left: click to select a system; map indicator lines snap-to the nearest system
- System map at top right: click to select a planet, moon or asteroid; indicator lines snap-to the nearest planet
- Info Panel at right middle: details of the selected planet or moon
- Planet surface picture at bottom right
- Dropdown list to filter the type of information in the galaxy and system maps; matching systems and planets appear in yellow
- Expansion Planner screen (F3): plan the location of your next colony or mining station; assign missions to colony ships and construction ships
- Top part of the screen: current status of all resources in the galaxy (current price, level of demand) — used to decide which planets to mine
- Bottom list: dropdown to change target types (potential colonies, potential mining locations, etc.); selecting a target shows its location on the map at the right; buttons at the bottom send a colony ship or construction ship to the location
- Diplomacy screen (F5 key): relations with the selected empire; each relation shows total annual trade volume between the two empires
- Relations influenced by: trade volume between empires; competition over systems and resources; like or dislike of an empire's Government type
- Selected empire summary at the right: empire's flag and dominant race
- Current relationship with the player's empire shown at the bottom
- "Speak" button at the top-right initiates a conversation
- Conversation screen: options in the bottom panel — sending warnings, changing your relationship (proposing treaties, declaring war), offering gifts
- Trade sanctions: an empire refuses to trade with another; no resources bought or sold between them
- Blockades: declared against enemy colonies and space ports when sanctions exist; no trade by ANY empire with the blockaded colony or base; enforced by military ships from the initiating empire; see the Galactopedia (F1) on initiating blockades
- Empire Comparison screen (V key): how you compare with other empires
- Victory Conditions: progress of each empire towards meeting the victory conditions, including each empire's unique race-specific victory conditions
- Empire Comparison graphs: ordered rankings of all known empires based on several different factors
- Galactopedia (F1) for more detailed information

### 3. Exact UI-relevant quotes (verbatim)

- "You access the Galaxy Map using the button indicated, or by pressing the G key."
- "Click the galaxy map at left to select a system. The map indicator lines will snap-to the system nearest the location where you clicked."
- "Click the system map at top right to select a particular planet, moon or asteroid."
- "As in the galaxy map, the system map indicator lines will snap-to the planet nearest the location where you clicked."
- "Details on the selected planet or moon are displayed in the Info Panel at right middle."
- "A picture of the surface of the selected planet or moon is displayed at bottom right."
- "You can filter the type of information displayed in the galaxy and system maps by selecting a view from the dropdown list."
- "Systems and planets matching the selected view appear in yellow on the galaxy and system maps."
- "The Expansion Planner screen provides powerful tools to help you plan the location of your next colony or mining station."
- "From here you can assign missions to your colony ships and construction ships, using them to expand your empire."
- "Open the Expansion Planner screen by using the button indicated or by pressing F3."
- "The top part of the screen shows the current status of all resources in the galaxy, including their current price and level of demand."
- "The bottom list can be changed to show various types of targets: potential colonies, potential mining locations, etc. Use the dropdown list to change the information shown here."
- "When you select a target from the list its location in the galaxy is shown on the map at the right. You can use the buttons at the bottom to send a colony ship or construction ship to the location."
- "You can monitor diplomatic relations from the Diplomacy screen (F5 key)"
- "The diplomacy screen shows all of the relations for the selected empire. Each relation shows the total annual trade volume between the two empires."
- "A summary of the selected empire appears at the right. This shows the empire's flag and dominant race."
- "The selected empire's current relationship with us appears at the bottom."
- "You can initiate a conversation with the selected empire by clicking the Speak button at the top-right."
- "In the conversation screen you can select from the options in the bottom panel."
- "This includes sending warnings, changing your relationship (proposing treaties, declaring war) or offering gifts."
- "Trade sanctions are where an empire refuses to trade with another empire. No resources will be bought or sold between the two empires."
- "When trade sanctions exist between two empires, blockades may be declared against enemy colonies and space ports. In this situation no trade by ANY empire is permitted with the blockaded colony or base. Blockades are enforced by military ships from the initiating empire."
- "See the Galactopedia (F1) for more information on initiating blockades."
- "You can track how you compare with other empires in the Empire Comparison screen."
- "Open this screen using the indicated button or the V key."
- "The progress of each empire towards meeting the victory conditions are shown here."
- "This includes each empire's unique race-specific victory conditions."
- "Here you can also view graphs showing ordered rankings of all known empires based on several different factors."
- "Please refer to the Galactopedia (F1) for even more detailed information."

## FindingYourWayAround.txt

Tutorial title: "the Distant Worlds tutorial" (basics of how to find your way around in the game).

### 1. Summary

A focused sub-tutorial (a subset of the basic tutorial) that is purely about navigation and the main-screen layout. It covers moving around the main view: the main view shows a portion of the galaxy; scroll by moving the mouse pointer to the edge of the screen (up/down/left/right), use the arrow keys, or drag with the right mouse button held down. Zooming: mouse scroll wheel, PageUp/PageDown keys, the ZoomIn and ZoomOut buttons on the main screen, and zoom presets via the Zoom buttons (100% default, system view, sector view, galaxy view); zoom into any location with Ctrl+click. Map reading: at system level, colonies and ships are identified by the empire's main color; at sector level, ships and bases are icons colored by owning empire; explored systems display their names, unexplored ones show no name; colonized systems are circled in the empire's color with circle size showing relative importance; empire territory has a colored background (colonies project influence into nearby systems); independent systems are circled with a solid grey line; systems with potential colonies show a dashed grey circle. It tours the main-screen elements: the Galactopedia Help system (F1 or the Help button), the Selection Panel at the bottom left, the Empire Navigation Tool at the left (scrollable icon lists; click an item to select it in the Selection Panel; Action buttons under the Selection Panel; double-click flies the main view to the item; hovering at sector/galaxy zoom 'pings' the location with an expanding yellow circle), the map at the bottom right (blue rectangle shows the main-view area; click to move; auto-zooms), the scrolling message list at the top of the screen (recent events; click an event to move to it), the Pause button at the top-left (click once to pause, again to resume), the Game Menu button at the top-left (load and save games, alter game options, exit), and the Game Options screen (O key) where automation of tasks like Colonization and Ship Building can be set or progressively turned off. It ends by pointing to the other tutorials from the main menu.

### 2. Game systems / UI elements / actions mentioned

- Main view: shows a portion of the galaxy; in this tutorial a small portion of one star system near one of your colony planets
- Scrolling: mouse pointer at the edge of the screen scrolls the main view up, down, left or right; arrow keys do the same
- Dragging: hold down the right mouse button to drag the main view
- Zooming: mouse scroll wheel; PageUp and PageDown keys; ZoomIn and ZoomOut buttons on the main screen
- Zoom presets: Zoom buttons zoom instantly to 100% (default), system view, sector view, galaxy view
- Zoom into any location: hold down the 'Ctrl' key while clicking
- System view: colonies and ships of an empire identified by the empire's main color
- Sector view: main view shows systems; ships and bases shown as icons; icon color indicates which empire the ship or base belongs to
- Explored systems: names displayed next to them; unexplored systems: no name displayed
- Colonized systems: circled with the empire's color; circle size = relative importance (larger systems more valuable)
- Empire territory: colored background; a system can be owned even when not colonized; colonies project the empire's influence into nearby systems
- Independent systems: circled with a solid grey line; good colonization targets (aliens boost the new colony's population)
- Systems with potential colonies: indicated by a dashed grey circle; build a colony ship and send it to these uninhabited planets
- Galactopedia Help: context-sensitive help on the currently selected item or currently open screen; detailed planet/ship information; game concepts; explains each game screen; press F1 or click the Help button
- Selection Panel: at the bottom left of the screen; displays detailed information on the selected item (colony, ship, system, etc.); select by clicking in the main screen
- Empire Navigation Tool: at the left of the screen; a set of scrollable lists providing quick access to everything in your empire — colonies, space ports, construction ships, exploration ships, enemy targets, fleets, new potential colonies, potential mining locations, and much more
- ENT interaction: click an icon to open a list; click it again to close, or use the close button at the right of the list's title bar; click an item to select it in the Selection Panel below; Action buttons under the Selection Panel for common tasks on the selected item; double-click an item to move the main view to it; hovering over an item at sector/galaxy zoom 'pings' the location with an expanding yellow circle
- Map: at the bottom right; shows the surrounding area; blue rectangle in the middle indicates the area displayed in the main view; click anywhere on the map to move the main view; the map automatically zooms with the main view
- Scrolling message list: at the top of the screen; displays recent events that have occurred in your empire; click an event to move to the location of the event
- Pause/Resume: Pause button at the top-left of the screen; click once to pause, click again to resume
- Game Menu: Game Menu button at the top-left of the screen; load and save games, alter game options, or exit the game
- Game Options screen (O key): customize game settings; automate certain empire tasks (Colonization, Ship Building, etc.); many tasks are automated at the start; automation can be progressively turned off for greater control
- Main menu: "you can also try the other tutorials from the main menu"

### 3. Exact UI-relevant quotes (verbatim)

- "The main view shows a portion of the galaxy - in this case a small portion of one star system near one of your colony planets."
- "Move the mouse pointer to the edge of the screen to scroll the main view up, down, left or right. You can also use the arrow keys on your keyboard to do the same thing."
- "You can also drag the main view by holding down the right mouse button."
- "Use the mouse scroll wheel to zoom the main view in or out. You can also use the PageUp and PageDown keys to do the same thing."
- "The ZoomIn and ZoomOut buttons on the main screen also allow you to zoom in or out."
- "When zoomed out to system level you can identify the colonies and ships for an empire by the empire's main color."
- "You can zoom in to any location by holding down the 'Ctrl' key while clicking."
- "As you zoom out further the main view changes to show systems."
- "At this level ships and bases are shown as icons. The icon color indicates which empire the ship or base belongs to."
- "Systems that you have explored have their names displayed next to them."
- "Systems that you have not yet explored have no name displayed next to them."
- "Systems that have been colonized by an empire are circled with their empire's color."
- "The size of the circle indicates the system's relative importance - larger systems are more valuable."
- "Systems that are part of an empire's territory have a colored background."
- "A system can be owned by an empire even when it is not colonized."
- "Colonies project their empire's influence into nearby systems, making them part of their empire's territory."
- "These independent systems are circled with a solid grey line."
- "Any systems with potential colonies are indicated by a dashed grey circle."
- "The Zoom buttons allow you to instantly zoom to several preset levels:
  - 100% (default)
  - system view
  - sector view
  - galaxy view"
- "You can access the Galactopedia Help system at any time by pressing F1 or by clicking the Help button."
- "At the bottom left of the screen is the Selection Panel."
- "This displays detailed information on the selected item, whether that be a colony, ship, system, etc."
- "To select an item in the main screen simply click on it with the mouse."
- "At the left of the screen is the Empire Navigation Tool. This is a set of scrollable lists that provide quick access to everything in your empire."
- "This includes items like: your colonies, space ports, construction ships, exploration ships, enemy targets, fleets, new potential colonies, potential mining locations, and much more."
- "Click an icon to open one of the lists. Click the icon again to close the list, or use the close button at the right of the list's title bar."
- "Click an item in a list to select it in the Selection Panel below."
- "You can then use the Action buttons under the Selection Panel to access many common tasks for the selected item, allowing you to easily manage most of your empire directly from the main screen."
- "Double-clicking an item in a list will move the main view to that item."
- "When you are zoomed out to the sector- or galaxy-level then hovering over an item in a list will 'ping' the location of that item in the galaxy with an expanding yellow circle."
- "At the bottom right is a map. This shows the surrounding area."
- "The area displayed in the main view is indicated by the blue rectangle in the middle of the map."
- "Click anywhere on the map to move the main view to that location."
- "The map automatically zooms in or out when you zoom the main view."
- "At the top of the screen is a list that displays recent events that have occurred in your empire."
- "Click on an event in this list to move to the location of the event."
- "At the top-left of the screen is the Pause button. This allows you to pause or resume the game at any time."
- "Click once to pause the game. Click again to resume the game."
- "At the top-left of the screen is the Game Menu button."
- "This accesses the Game Menu where you can load and save games, alter game options or exit the game."
- "The Game Options screen (O key) allows you to customize game settings."
- "In particular, you can automate certain empire tasks like Colonization, Ship Building, etc. This allows you to focus on other areas of your empire that interest you more."
- "When you first start Distant Worlds many tasks are automated for you. The automation of these tasks can be progressively turned off, as you desire greater control over the details of your empire."
- "When you are ready you can also try the other tutorials from the main menu."

## FleetsTroops.txt

Tutorial title: "the Distant Worlds tutorial about Fleets, Troops and Intelligence missions".

### 1. Summary

A focused sub-tutorial (a subset of the advanced tutorial) on three systems. Fleets: group military ships and assign missions to the entire group for coordinated large attacks; assign ships by selecting them and right-clicking to display the mission popup menu, choosing "Join Fleet" and then a fleet in the submenu (or creating a new fleet with the selected ship as its first ship); at system zoom level fleets appear as an inverted triangle icon with the number of ships displayed inside the triangle; select a fleet by double-clicking any ship in it; manage fleets in the Fleets screen (F12). Troops: defend colonies from invasion or invade/take over enemy colonies; recruited at your colonies (they cost money to maintain) from the Troops tab of the Colonies screen (F2) or via the right-click popup menu on a colony in the main view; loaded onto ships with troop storage components (troop transports, larger military ships), sent to another colony and unloaded to reinforce it, or used as an invasion force; managed in the Troops screen. Intelligence: intelligence missions let you secretly infiltrate other empires and steal or destroy their assets, using trained intelligence agents managed in the Characters screen (F4); missions are assigned via the Mission summary panel at the bottom-right of the screen — select a target empire and a mission type, and more allowed time means a greater chance of success; counter-intelligence agents actively seek out spies and saboteurs and report discoveries; botched missions discovered by another empire dramatically lower their estimation of your empire and could even lead to war.

### 2. Game systems / UI elements / actions mentioned

- Fleets: group a number of military ships together and assign missions to the entire group (useful for coordinating large attacks on enemy targets)
- Assigning ships to a fleet: select the ships → right-click to display the mission popup menu → select "Join Fleet" → select which fleet to join in the submenu
- Creating a fleet: from the same submenu, create a new fleet with the selected ship as the first ship in the fleet
- Fleet appearance: at system-level zoom, fleets appear as an inverted triangle icon; the number of ships in the fleet is displayed inside the triangle symbol
- Selecting a fleet: double-click any ship in the fleet
- Fleets screen (F12 key): manage fleets
- Troops: defend colonies against invasion by enemy empires; can be used as attacking forces to invade and take over enemy colonies
- Recruiting troops: recruited at your colonies (cost money to maintain, so only recruit what you need); from the Troops tab of the Colonies screen (F2 key); or right-click any of your colonies in the main view and recruit from the popup menu
- Transporting troops: loaded onto ships with troop storage components (troop transports or larger military ships); sent to another colony and unloaded to reinforce it; or used as an invasion force at an enemy colony
- Troops screen: manage the troops in your empire
- Intelligence missions: secretly infiltrate other empires and steal or destroy their assets
- Intelligence agents: highly-trained and skilled specialists; managed from the Characters screen (F4 key)
- Mission summary panel at the bottom-right of the screen: assign missions to agents — select a target empire and a mission type; the more time allowed, the greater the chance of success
- Counter intelligence: assign agents to prevent enemy intelligence missions; they actively seek out spies and saboteurs and report any discoveries
- Fallout of botched intelligence missions: if another empire discovers your actions, it dramatically lowers their estimation of your empire and could even lead to war
- Galactopedia (F1) for even more detailed information

### 3. Exact UI-relevant quotes (verbatim)

- "You can assign any of your military ships to a fleet by selecting them, then right-clicking on them to display the mission popup menu. Select "Join Fleet" from the menu and then select which fleet you want to join in the submenu."
- "From the submenu you can also create a new fleet with the selected ship as the first ship in the fleet."
- "When you are zoomed out to system level, fleets appear as an inverted triangle icon."
- "The number of ships in the fleet is displayed inside the triangle symbol."
- "To select one of your fleets, just double-click any ship in the fleet."
- "Fleets are managed from the Fleets screen (F12 key)."
- "Troops are recruited at your colonies. They cost money to maintain, so only recruit troops that you really need."
- "You can recruit troops from the Troops tab of the Colonies screen (F2 key)."
- "You can also right-click on any of your colonies in the main view to recruit them from the popup menu."
- "Troops can be loaded onto ships that have troop storage components, such as troop transports or larger military ships. They can then be sent to another colony and unloaded there to reinforce it. Or they can be used as an invasion force at an enemy colony."
- "The troops in your empire can be managed from the Troops screen."
- "Intelligence missions enable you to secretly infiltrate other empires and steal or destroy their assets."
- "Your agents can be managed from the Characters screen (F4 key)."
- "The Mission summary panel at the bottom-right of the screen allows you to assign missions to agents."
- "Select a target empire for the mission and a mission type."
- "The more time you allow for the mission, the greater the chance of success."
- "Beware of the negative fallout from botched intelligence missions - if another empire discovers your actions against them it will dramatically lower their estimation of your empire, and could even lead to war."
- "Please refer to the Galactopedia (F1) for even more detailed information."

## PlayAsPirate.txt

Tutorial title: the Distant Worlds tutorial about playing as a pirate faction ("Distant Worlds offers the ability to play as a pirate faction.").

### 1. Summary

This tutorial explains how to play as a pirate faction, which differs fundamentally from a standard empire: pirates usually have no colonies, start with a spaceport at a gas giant (where the Pirate Leader character is usually based; the spaceport builds, repairs, and retrofits ships and serves as a refuelling depot; additional spaceports can be built anywhere with the Construction Ship), cannot colonize planets (but can build spaceports anywhere), and start with a single Construction Ship that cannot be replaced (but pirates can board and capture other empires' construction ships). Pirate income comes from five sources: Controlled Colonies, Protection Agreements, Pirate Missions, Mining, and Raids. Pirates CONTROL colonies by parking military ships there (control rises with nearby military strength, topping out at 100%; multiple factions can control one colony; very large colonies cap below 100%), siphoning off income; permanent control is established by building a Pirate Base planetary facility (requires 50% control; the first faction to build one controls the colony) or a Pirate Fortress (requires 100% control), both increasing colony income. Pirate diplomacy is simple: pirates are aggressive (freely attack ships and bases) but can offer Protection Agreements (monthly payment for non-attack, from the Diplomacy screen F5) to standard empires and Truces to other pirate factions (no fee). Pirate Missions are accessed and accepted/bid on in the Pirate Missions panel in the Empire Navigation Tool at screen left; the three mission types are Smuggling (bonus paid for resources delivered to the colony; pirate freighters appear as independent freighters to other empires; pirates can build civilian ships such as smuggling freighters directly with the 'Build new civilian ship' action button at their spaceport), Attack (factions bid, lowering the price with each bid; last bidder wins; payment on completion when the target is destroyed or captured; must be completed by a specific date or relations with the requesting empire suffer very badly), and Defense (same bidding; only factions with a protection agreement may bid; payment when the time period expires with the base unharmed). Pirates also earn from mining stations (especially in games with many pre-warp empires) and Raids (Assault Pods board an enemy base or launch a ground invasion of a colony; loot is money, research breakthroughs, or resources; re-raiding a recently raided target earns much lower bonuses). Boarding/capture requires Assault Pod components: select a military ship with assault capability, hover over the target while holding down the Shift key, then right-click; the target's shields must be lowered and the attacker within assault pod range; a battle occurs inside (defenders = crew from Hab Module components, unexpended Assault Pods, Troops onboard); success transfers ownership; Point Defense weapons can shoot down Assault Pods in transit. Pirates typically use Tractor Beam weapons to pull targets toward them or push attackers away (better against smaller, closer targets; very useful for captures). The four playstyles — Balanced, Raider, Mercenary, Smuggler — are selected for your pirate faction in the 'Your Empire' screen in game setup, and also define the victory conditions: pirates compete against other pirate factions, NOT against standard empires; a faction is eliminated when it loses all of its colonies (controlled or owned), refuelling locations (spaceports or gas mining stations), and construction ships or resupply ships. Achieving 100% control and building a Pirate Fortress unlocks the 'Criminal Network' special pirate mini-wonder: it fully entrenches control, lets you completely take over the colony like a normal empire (build Construction Ships, Resupply Ships, even Colony Ships and colonize new planets), recruit troops there (to invade enemy colonies), and grants a bonus 1% victory points per 500 million population at fully owned colonies. Defensively, pirate facilities (Pirate Base, Pirate Fortress, Criminal Network) can be destroyed in raids by other pirate factions, and the owning empire of a colony you control can launch a ground attack from the Facilities tab of the Colonies screen (F2) — selecting the pirate facility changes the 'Scrap' button to 'Attack', using all troops at the colony. Pirates have slow research but better spies (stealing tech and information), and can exploit undeveloped pre-warp empires.

### 2. Game systems / UI elements / actions mentioned

- Pirate basics: pirates usually do not have colonies; they start with a spaceport at a gas giant planet; pirates cannot colonize planets but can build spaceports anywhere
- Pirate spaceport: center of the faction; where your Pirate Leader character is usually based; build new ships, repair and retrofit existing ships; refuelling depot for your ships; build additional spaceports at any location using your Construction Ship
- Construction Ships: each pirate faction starts with its own (used to build mining stations and other bases); pirates cannot build additional ones (no colonies); losing it is a major blow; pirates can board and capture Construction Ships of other empires
- Pirate income sources: Controlled Colonies, Protection Agreements, Pirate Missions, Mining, Raids
- Controlled Colonies: pirates CONTROL colonies by moving military ships to a colony; more military strength near the colony = faster control increase, topping out at 100%; siphon off the colony's income (higher control = more money); multiple pirate factions can control a colony at the same time; very large colonies have a lower maximum control level (cannot reach 100%)
- Pirate Bases / Pirate Fortresses: planetary facilities; a Pirate Base establishes permanent control (first faction to build it controls the colony; control must reach 50% before it can be built); a Pirate Fortress requires control at 100%; both increase income from the colony
- Pirate diplomacy: pirates are aggressive (freely attack ships and bases of factions they meet); Protection Agreements: request monthly payment in exchange for refraining from attacks — offered from the Diplomacy screen (F5); can lead to Defense Missions and other opportunities; Truces between pirate factions (no monthly fee, mutual non-attack)
- Pirate Missions panel in the Empire Navigation Tool at screen left: access missions; a pirate faction must first accept or bid on the mission in the Empire Navigation Tool; three types: Smuggling, Attack and Defense
- Smuggling missions: offered when an empire or independent colony is short of resources; pirate freighters earn some smuggling income on any delivery into another empire, plus a large bonus for deliveries to the colony while a Smuggling mission is active; pirate freighters appear as independent freighters to other empires and can usually dock undetected
- 'Build new civilian ship' action button at the pirate spaceport: build civilian ships (including smuggling freighters) directly
- Attack missions: offered by other empires to pay pirates to attack an enemy target; pirate factions must bid, lowering the price with each bid; the last faction to bid gets the mission; payment on completion (target destroyed or captured); accepted attack missions must be completed by a specific date — failure very negatively affects relations with the requesting empire
- Defense missions: other empires pay pirates to protect one of their bases for a time period; same bidding (last bidder wins); only pirate factions with a protection agreement with the requesting empire can bid; payment when the time period expires and the base remains unharmed
- Mining: pirates supply other empires with resources from their mining stations; especially profitable with many pre-warp empires; smuggling missions can also increase mining income
- Raids: against bases and colonies of other empires; use Assault Pods to board an enemy base or launch a ground invasion of an enemy colony; loot = money, research breakthroughs, or resources; raiding a recently raided target earns much lower bonuses
- Boarding and capture: attacking ship must have Assault Pod components; initiate a Capture mission by selecting a military ship with assault capability, hovering over the target while holding down the Shift key, then right-clicking the target; the target's shields must be lowered and the attacker must close within assault pod range; Assault Pods launch and board on arrival; a battle takes place inside the target (defenders = the ship's crew based on Hab Module components, any unexpended Assault Pods, any Troops onboard); success captures the ship/base, changing ownership to the attacking empire; Assault Pods can be shot down by Point Defense weapons in transit
- Tractor Beams: weapons that pull and push enemy targets — pull a target towards a pursuing ship for more effective attack; push an attacker away when fleeing; work better against smaller and closer targets; very useful when attempting to capture enemy ships
- Pirate playstyles (four): Balanced (control colonies, protection agreements, capturing ships); Raider (control colonies, build Pirate Bases and Fortresses); Mercenary (attack and defense missions, raids, capturing ships); Smuggler (smuggling missions, protection agreements, spying)
- Playstyle selection: select the playstyle for your pirate faction in the 'Your Empire' screen in game setup (new game wizard)
- Pirate victory conditions: pirate play styles affect them; pirates compete against other pirate factions to achieve victory, NOT against standard empires; a pirate faction is eliminated from the game when it loses all of: colonies (controlled or owned); refuelling locations (spaceports or gas mining stations); construction ships or resupply ships
- Criminal Network: special pirate mini-wonder; available after achieving 100% control of a colony and building a Pirate Fortress there; fully entrenches control, allowing you to completely take over the colony like a normal empire; then build Construction Ships, Resupply Ships and even Colony Ships there to colonize new planets; also allows recruiting troops at the colony (then invade enemy colonies); bonus 1% victory points for each 500 million of population at fully owned colonies
- Defense against attacks: pirate facilities (Pirate Base, Pirate Fortress, Criminal Network) can sometimes be destroyed in raids on your colony by other pirate factions; defend colonies by preventing enemy ships from getting close enough to raid; the owning empire of a colony you control may launch a ground attack to eradicate you (destroying your pirate facilities)
- Ground attacks against pirate facilities: launched by the owning empire from the Facilities tab of the Colonies screen (F2); selecting the target pirate facility causes the 'Scrap' button to change to 'Attack'; clicking it launches a ground attack using all troops currently at the colony
- Pirates have slow research but better spies (steal tech and other information); in the pre-warp era pirates can exploit undeveloped standard empires; focus is on ships and bases instead of colonies
- Galactopedia (F1) for even more detailed information on Pirates

### 3. Exact UI-relevant quotes (verbatim)

- "Pirates cannot colonize planets. But they can build spaceports anywhere."
- "The center of your pirate faction is your starting spaceport. This is where your Pirate Leader character is usually based."
- "At your pirate spaceport you can build new ships, as well as repair and retrofit existing ships."
- "Your spaceport also serves as a refuelling depot for your ships."
- "When your income allows, you can build additional spaceports at any location using your Construction Ship."
- "Note that because pirates do not own colonies, they cannot build additional Construction Ships. So protect your starting Construction Ship well - losing it would be a major blow!"
- "Let's take a look at the primary sources of pirate income: - Controlled Colonies - Protection Agreements - Pirate Missions - Mining - Raids"
- "Although pirates cannot own colonies like standard empires, they can CONTROL colonies by moving their military ships to a colony."
- "The more military strength they have near a colony, the faster their level of control will increase, topping out at 100%."
- "Controlling a colony allows pirates to siphon off it's income - the higher the control, the more money is collected from the colony."
- "Note that multiple pirate factions can control a colony at the same time. Also note that very large colonies have a lower maximum control level (i.e. cannot reach 100%)"
- "Pirates can establish permanent control of a colony by building a Pirate Base planetary facility. The first faction to build a Pirate Base controls the colony. Control must reach 50% before a Pirate Base can be built."
- "Pirates can also build a Pirate Fortress planetary facility at a controlled colony. Control must be at 100% before a Pirate Fortress can be built."
- "Having a Pirate Base or Pirate Fortress at a controlled colony increases the income from the colony."
- "You can offer protection agreements from the Diplomacy screen (F5)."
- "Pirates can also offer Truces to other pirate factions. In this case there is no monthly fee - each pirate faction simply agrees not to attack the other."
- "These missions can be accessed from the Pirate Missions panel in the Empire Navigation Tool at screen left."
- "Before a pirate faction can undertake a mission they must first either accept or bid on the mission in the Empire Navigation Tool."
- "Let's take a look at the three types of missions available: Smuggling, Attack and Defense."
- "Note that pirate freighters appear as independent freighters to other empires, so they can usually dock at a colony or base undetected."
- "Also note that pirate factions can build civilian ships (including smuggling freighters) directly using the 'Build new civilian ship' action button at their spaceport."
- "Payment is made for the attack mission when it is completed. The mission is completed when the target is either destroyed or captured."
- "Accepted attack missions must be completed by a specific date. Failure to complete the mission will very negatively affect your relations with the requesting empire."
- "Defense missions can only be bidded on by pirate factions that have a protection agreement with the requesting empire."
- "Payment is made for the defense mission when the time period expires and the base remains unharmed."
- "Raids involve using Assault Pods to either board an enemy base, or to launch a ground invasion of an enemy colony."
- "Successful raids gain loot for the pirate faction. Loot may take the form of money, research breakthroughs or resources."
- "Note that raiding a target that has already been recently raided will earn much lower bonuses."
- "To board a target the attacking ship must have Assault Pod components."
- "To initiate a Capture mission: select a military ship with assault capability, hover over the target while holding down the Shift key, then right-click the target."
- "Click 'Continue' for details on how boarding and capture works."
- "Tractor beams work better against smaller and closer targets."
- "Note that Tractor Beam weapons are very useful when attempting to capture enemy ships."
- "Pirate factions follow one of four playstyles that define how they act: - Balanced: control colonies, protection agreements, capturing ships - Raider: control colonies, build Pirate Bases and Fortresses - Mercenary: attack and defense missions, raids, capturing ships - Smuggler: smuggling missions, protection agreements, spying"
- "Select the playstyle for your pirate faction in the 'Your Empire' screen in game setup."
- "Note that pirates compete against other pirate factions to achieve victory, NOT against standard empires."
- "Pirate factions are eliminated from the game when they lose all of the following: - colonies (controlled or owned) - refuelling locations (spaceports or gas mining stations) - construction ships or resupply ships"
- "You may eventually achieve 100% control of a colony and build a Pirate Fortress facility there. At this point you then have the option of building a special pirate mini-wonder called the 'Criminal Network'."
- "The Criminal Network fully entrenches your control of a colony, allowing you to completely take it over, owning it just like a normal empire. You can then build Construction Ships, Resupply Ships and even Colony Ships here. This allows you to colonize new planets for your pirate faction."
- "The Criminal Network also allows you to recruit troops at the colony. With recruited troops you can then invade enemy colonies and take them over."
- "You also receive a bonus 1% victory points for each 500 million of population at colonies that you fully own."
- "These ground invasions are launched by the owning empire from the Facilities tab of the Colonies screen (F2). Selecting the target pirate facility will cause the 'Scrap' button to change to 'Attack'. Clicking the attack button will launch a ground attack against the pirate facility using all of the troops currently at the colony."
- "Pirates have slow research, but compensate by having better spies, allowing them to steal tech and other information."
- "Please refer to the Galactopedia (F1) for even more detailed information on Pirates."

## PreWarpEmpire.txt

Tutorial title: the Distant Worlds tutorial about playing as a pre-warp (non-space-faring) empire.

### 1. Summary

This tutorial explains how to play as a non-space-faring empire that must first develop hyperspace travel and colonization technologies. You start with no ships or bases at all — only basic space technology (no hyperdrives, shields, or colonization). The first task is to build an orbital spaceport, which serves as the construction yard for most ships and provides research labs for progressing the technology level. Next, build exploration ships at the spaceport to explore the home system (without hyperdrives all travel is at slow sub-light speeds, so even exploring the home system takes time). Once useful nearby resources are identified, build a Construction Ship at your colony and send it out to build mining stations; the most important early resources are fuel (Caslon) and Steel, with Hydrogen, Lead, Carbon Fibre, Polymer, and Silicon also to prioritize (usually present in the home system, sometimes in low abundances); building a network of mining stations across the home system automatically triggers the private economy to build freighters and mining ships to transport resources back to the home colony. Research priorities: get some kind of weapon early for defense, add shields for spaceport/military endurance, increase construction size of ships and bases, and begin researching hyperdrives (Warp Field Precursors) as soon as possible. The two key breakthroughs are hyperdrives (allowing ships to leave the home system and travel to other stars) and Colonization (allowing Colony Ships and new colonies). After that, expand territory across the galaxy: encounter other empires and pirate factions (peaceful cooperation and sharp conflict), continue researching new technology, colonize promising new planets, and build a comprehensive mining network. The tutorial closes by pointing to the Finding Your Way Around tutorial from the main menu and the Galactopedia (F1).

### 2. Game systems / UI elements / actions mentioned

- Pre-warp empire starting state: no ships or bases at all; only basic space technology — no hyperdrives, shields or colonization; "at the dawn of the age of space exploration"
- Orbital spaceport: first construction; serves as a construction yard for building most of your space ships; provides research labs for progressing your technology level
- Exploring your home system: build exploration ships at your spaceport and send them out; without hyperdrives all travel is at slow sub-light speeds (even investigating the home system takes time)
- Mining: build a Construction Ship at your colony and send it out to build a mining station to extract resources
- Key early resources: fuel (Caslon) and Steel are most important; also prioritize Hydrogen, Lead, Carbon Fibre, Polymer and Silicon; all usually present somewhere in your home system, though sometimes in low abundances
- Private economy automation: building a network of mining stations spread across the home system automatically triggers your private economy to build freighters and mining ships to transport resources back to your home colony
- Research priorities: get some kind of weapon as early as possible (defense); shields (spaceport and military ship endurance in battle); increasing the construction size of ships and bases; begin researching hyperdrives (Warp Field Precursors) as soon as able
- Breakthrough technologies: hyperdrives (ships can leave the home system and travel to other nearby stars; may take some time); Colonization (build Colony Ships and found new colonies)
- Expanding: explore and encounter other empires and pirate factions (peaceful cooperation and sharp conflict); research new technology; colonize promising new planets; build a comprehensive mining network to make the empire rich in resources
- Main menu: "you can also take the Finding Your Way Around tutorial from the main menu"
- Galactopedia (F1): can be referred to at any time for more information

### 3. Exact UI-relevant quotes (verbatim)

- "As a pre-warp empire you initially have no ships or bases at all. You are at the dawn of the age of space exploration!"
- "You start with only basic space technology - no hyperdrives, shields or colonization."
- "Your first task is to build an orbital spaceport. This spaceport will serve as a construction yard for building most of your space ships."
- "The spaceport also provides research labs for progressing your technology level."
- "Remember that without hyperdrives all travel will be at slow sub-light speeds. So even investigating your home system will take time."
- "Build some exploration ships at your spaceport and send them out to discover what resources and other items exist nearby."
- "Once you have identified useful nearby resources, you should build a Construction Ship at your colony and send it out to build a mining station to extract the resources."
- "Remember that the most important early resources are fuel (Caslon) and Steel. Other resources that you should prioritize include: Hydrogen, Lead, Carbon Fibre, Polymer and Silicon. All of these resources should usually be present somewhere in your home system, though sometimes in low abundances."
- "Building a network of mining stations spread across your home system will automatically trigger your private economy to build freighters and mining ships to transport the resources back to your home colony."
- "You should try to get some kind of weapon as early as possible to give your fledgling empire some defenses. Shields are also very useful to have to give your spaceport and military ships more endurance in battle."
- "Increasing the construction size of your ships and bases is also a good research choice."
- "As soon as you are able, you should begin researching hyperdrives (Warp Field Precursors)."
- "The next key technology to research is Colonization. This will allow you to build Colony Ships and found new colonies for your empire."
- "Once these two key breakthroughs are reached you are well on your way to becoming a mighty stellar empire!"
- "When you are ready you can also take the Finding Your Way Around tutorial from the main menu."
- "Remember that you can refer to the Galactopedia (F1) at any time for more information."

## ResearchDesign.txt

Tutorial title: "the Distant Worlds tutorial about Research, Ship Design and Construction".

### 1. Summary

A focused sub-tutorial (a subset of the advanced tutorial) on research, ship/base design, and construction. Research is undertaken in the Research screen (F7), where each of the three research areas — Weapons, Energy, HighTech — has its own tech tree containing all of the research projects for that area; research itself is performed in research laboratories at Space Ports or other dedicated Research Stations (more facilities = faster research as the empire grows), and research categories each provide collections of components usable in ships or bases. All ships and bases must be based on a design (templates/blueprints), managed in the Designs screen (F8): edit an existing design or create a new one (the tutorial views a frigate design). The Design Detail screen lets you edit or view a design and add/remove components, with panels giving detailed information: a design picture selectable from any ship picture in the game; a role (each role has specific rules about which component types should be present); battle and invasion tactics for combat behavior (see online help on Battle Tactics and Invasion Tactics); a Warnings panel listing rules (in red — must be satisfied to save) and recommendations (in yellow — can be ignored); the Available Components panel (filtered by default to the most recent version of each component type); the Design Components panel ("This list effectively IS the design") with Add Component and Remove Component buttons (a design already used to build a ship or base cannot be modified); the Component Detail panel (tracks the currently selected component from either list); and the Save button (red Warnings requirements must be satisfied first). Construction costs money and grows with technology level: method one is to select the build location in the main view (space port for most ship types; colony for colony ships or construction ships) and right-click to show a pop-up menu with a "Build" menu option — the "Build" submenu lists all designs valid at that location, and unaffordable designs are disabled; method two is the Construction Yards button/screen (F10) — in the Construction Yards tab, select a ship from the dropdown list at the right and click the "Purchase" button (Available Funds flash red if you cannot afford it); method three is the Build Order button/screen (F9) — shows current levels for each ship type plus advisor-suggested numbers of new ships, lets you modify amounts and pick a specific design, and buys everything with the 'Purchase' button.

### 2. Game systems / UI elements / actions mentioned

- Research screen (F7): choose which research projects to undertake; three research areas (Weapons, Energy, HighTech), each with its own tech tree containing all research projects for that area
- Research stations: research laboratories at Space Ports or other dedicated Research Stations; more facilities = faster research; research categories each have collections of components usable in ships or bases
- Designs: all ships and bases must be based on a design (templates or blueprints); as research progresses, more advanced components become available and designs should be upgraded
- Designs screen (F8 key): edit an existing design or create a new one
- Design Detail screen: edit or view a design; add and remove components; various panels give detailed information about the design
- Design picture: select a picture from any of the ship pictures in the game
- Design role: indicates the purpose of the ship or base; each role has specific rules about what component types should be present
- Battle Tactics and Invasion Tactics: tactical behavior in combat; see online help for more information
- Warnings panel: rules and recommendations that assist in producing a valid design; updated as components are added/removed; Rules are in red (must be satisfied to save the design); Recommendations are in yellow (can be ignored)
- Available Components panel: lists all components available for the design; filtered by default to only the most recent version of each component type
- Design Components panel: lists all components currently used on the design ("This list effectively IS the design"); Add Component and Remove Component buttons modify the design; a design already used to build a ship or base cannot be modified (its components cannot be changed)
- Component Detail panel: detailed information for the currently selected component; changes as you select different components in either the Available Components list or the Design Components list
- Save button: makes the design available for construction; all Warnings panel requirements in red must be satisfied before saving
- Construction: all construction costs money (sufficient funds required); as technology level increases, construction abilities grow (progressively larger ships and bases)
- Construction method 1 (main view): select the build location in the main view — a space port (most ship types) or a colony (colony ships or construction ships); with the colony or space port selected, right-click to show a pop-up menu with a "Build" menu option; the "Build" submenu lists all designs valid to build at this location; select one to begin construction; unaffordable designs are disabled in the submenu
- Construction method 2 (Construction Yards screen, F10): jump directly to the Space Port construction yards; in the Construction Yards tab, select a ship to purchase from the dropdown list at the right; click the "Purchase" button to begin construction; if unaffordable, your Available Funds will flash red
- Construction method 3 (Build Order screen, F9): see current levels for each ship type and the number of new ships suggested by your advisors; modify the amount of ships for each type; select a specific design to build; click the 'Purchase' button to buy the new ships and begin construction
- Galactopedia (F1) for even more detailed information

### 3. Exact UI-relevant quotes (verbatim)

- "You choose which research projects you want to undertake in the Research screen (F7). Each of the three research areas (Weapons, Energy, HighTech) has its own tech tree containing all of the research projects for that area."
- "Research is performed in research laboratories at Space Ports or other dedicated Research Stations."
- "There are a number of different research categories. Each category has a collection of components that can be used in ships or bases."
- "All of the ships and bases in your empire must be based on a design. Designs are templates or blueprints for building a ship or base."
- "Designs are managed from the Designs screen (F8 key)."
- "In the Designs screen you can edit an existing design or create a new one."
- "In the Design Detail screen you can edit or view a design."
- "Here you can add and remove components to customize your design to your own special requirements."
- "The various panels on this screen give detailed information about the design."
- "Here you can select a picture for your design from any of the ship pictures in the game."
- "Assign a role for the design. This indicates the purpose of the ship or base. Each role has specific rules about what component types should be present."
- "Assign tactical behavior when in combat using battle and invasion tactics. See online help for more information on Battle Tactics and Invasion Tactics."
- "This panel lists rules and recommendations to assist in producing a valid design. As you add and remove components to the design the warnings are updated to identify current problems."
- "Rules are in red and must be satisfied to allow the design to be saved."
- "Recommendations are in yellow and can be ignored if desired."
- "This panel lists all components available for using in the design."
- "By default this list is filtered to only show the most recent version of each component type."
- "This panel lists all of the components currently used on the design. This list effectively IS the design."
- "Use the Add Component and Remove Component buttons to modify your design."
- "If the design has already been used to build a ship or base you cannot modify it. You cannot change the components that it uses."
- "This panel provides detailed information for the currently selected component."
- "The component shown here changes as you select different components in either the Available Components list or the Design Components list."
- "When you are finished creating your new design click the Save button to make the design available for construction."
- "Note that all requirements in the Warnings panel (in red) must be satisfied before you can save the new design."
- "All construction costs money - you must have sufficient funds to buy new ships and bases."
- "The first way to build a new ship is to select the build location in the main view. The build location can be either a space port (for most ship types) or a colony (for colony ships or construction ships)."
- "With your colony or space port selected, right click to show a pop-up menu with a "Build" menu option."
- "The "Build" submenu lists all designs that are valid to build at this location. Select one to begin construction."
- "If you cannot afford to build a particular design it will be disabled in the submenu."
- "The second way to build a new ship involves jumping directly to the Space Port construction yards. Do this by clicking on the Construction Yards button (F10 key)."
- "In the Construction Yards tab, select a ship to purchase from the dropdown list at the right. Then click the "Purchase" button to begin construction."
- "If you cannot afford to build the selected ship your Available Funds will flash red."
- "Another very efficient way to build new ships is the Build Order screen. Open this screen by clicking the Build Order button (F9 key)."
- "On this screen you can see your current levels for each ship type, as well as the number of new ships suggested by your advisors."
- "You can modify the amount of ships for each type, and select a specific design to build."
- "When you are satisfied with the order, click the 'Purchase' button to buy the new ships and begin construction."
- "Please refer to the Galactopedia (F1) for even more detailed information."

## ShipsAndMissions.txt

Tutorial title: "the Distant Worlds tutorial about Ships and Bases, and assigning missions to your ships".

### 1. Summary

A focused sub-tutorial (a subset of the basic tutorial) on ships and bases and mission assignment. It lists all ships and bases via the Ships and Bases button (F11 key) and points to the Designs screen (F8 key) for designing them to exact specifications (referencing the separate "Research, Ship Design and Construction" tutorial). Mission assignment: missions can be assigned to any state-owned ship or base, but NOT to privately-owned ships like freighters, mining ships, or mining stations (those select missions for themselves automatically); to assign a mission, first select the ship in the main view by left-clicking, then right-click the mouse over the mission target (e.g., right-click a location to make a ship move there); you may need to unpause the game to see the ship move. Right-clicking on the ship or base may also bring up a popup menu listing a number of missions specific to that ship/base type — "Exploration, Colonization, Building, Refueling, or many others". Ships can be completely automated (they assign missions for themselves): select the ship and press the 'A' key; to turn off automation just assign a mission; when a ship is automated a circular blue arrow appears in the bottom-right corner of the Selection Panel; ALL ships start the game automated. Bases are stationary but can also have missions: building new ships, retrofitting to a new design, or scrapping the base when no longer needed. It then tours ship/base types: Exploration ships (chart unknown areas, reveal colonizable planets/resources, make contact; automatable via 'A'; cycle with the Cycle Colony and Exploration Ships button or 'X' key); Colony ships (colonize other planets; consumed when a new colony is established, with the ship's resources kickstarting the colony; can only be built at colonies; initially only the native planet type is colonizable — research unlocks more types; planets with existing independent alien populations are always colonizable though the population may resist with the loss of the colony ship; cycle with the same button/'X' key); Space Ports (bases built only at a colony; central point of trade — freighters and mining ships bring mined resources here; construction facilities where both state and private ships are built, with the empire earning income when private citizens purchase ships; other functions: heavy weapons defending the colony, research facilities for scientists and engineers, and population-happiness bonuses from medical facilities and recreation centres; cycle with the Cycle Space Ports button or 'P' key); Freighters (transport cargo between colonies, mining stations, and space ports; small, medium, and large sizes; belong to private citizens — all transportation is performed by them — so you cannot assign missions to them); Mining Ships (mobile resource extraction; mine high-demand resources and return them to the nearest space port; privately owned — no mission assignment); Mining Stations (bases extracting resources from planets, moons, asteroids, and gas clouds; standard or gas mining stations; built by Construction Ships at resource-rich planets); Construction Ships (mobile construction yards; can build bases at uninhabited planets or in deep space; cycle with the Cycle Construction Ships button or 'Y' key); Military Ships (defend from enemy empires and marauding pirates; missions: Attack an enemy target, Patrol a colony or base watching for attackers, Escort a civilian ship such as a construction or mining ship; various sizes and classes; cycle with the Cycle Military Ships button or 'M' key); and finding idle ships via the Cycle Idle Ships button (or 'I' key) to locate ships without a current mission so you can assign missions to them.

### 2. Game systems / UI elements / actions mentioned

- Ships and Bases button (F11 key): complete list of all ships and bases in your empire
- Ships travel throughout the galaxy performing a wide range of tasks (transporting cargo to defending your empire); bases are fixed platforms in space, usually located at a planet
- Designs screen (F8 key): design all ships and bases to exact specifications; see the tutorial 'Research, Ship Design and Construction' for details
- Mission assignment: allowed for any state-owned ship or base; NOT allowed for privately-owned ships (freighters, mining ships, mining stations — they automatically select missions for themselves)
- Assigning a mission: left-click the ship in the main view to select; right-click the mouse over the mission target (e.g., right-click a location to make a ship move there); you may need to unpause the game to see the ship move
- Right-click popup menu on a ship or base: lists missions specific to the particular type of ship or base — "Exploration, Colonization, Building, Refueling, or many others"
- Automation: select a ship and press the 'A' key to make it assign missions for itself; assign a mission to turn automation off; a circular blue arrow appears in the bottom-right corner of the Selection Panel when a ship is automated; ALL ships start the game automated
- Base missions (bases are stationary but can have missions): building new ships, retrofitting to a new design, scrapping the base when it is no longer needed
- Exploration ships: chart unknown areas of the galaxy; reveal colonizable planets, uncover valuable resources, make contact with other empires; can be automated to explore on their own ('A' key); cycle with the Cycle Colony and Exploration Ships button or the 'X' key
- Colony ships: colonize other planets, founding new worlds; the ship is consumed when a new colony is established (the ship's resources kickstart the colony); while most ships are built at space ports, colony ships can only be built at colonies; initially only the native planet type of your race is colonizable (research progressively unlocks other planet types); planets with an existing independent alien population can always be colonized regardless of planet type — the preexisting population may resist your colonization attempt, with the loss of your colony ship; cycle with the Cycle Colony and Exploration Ships button or the 'X' key
- Space Ports: bases providing many important services; must always be built at a colony; central point of trade (mined resources brought here by freighters and mining ships); construction facilities for the empire (both state and private ships built here; the empire earns income when private citizens purchase freighters or other ships); other vital functions: heavy weapons providing strong defense for the colony; research facilities for scientists and engineers; bonuses that keep the colony population happy (medical facilities and recreation centres); cycle with the Cycle Space Ports button or the 'P' key
- Freighters: transport cargo between colonies, mining stations, and space ports; come in small, medium, and large sizes; work for the empire but belong to private citizens (all transportation of goods is performed by private citizens); you cannot assign missions to them
- Mining Ships: mobile resource extraction; mine resources in high demand and return them to the nearest space port; belong to private citizens; you cannot assign missions to them
- Mining Stations: bases extracting resources from planets, moons, asteroids, and gas clouds; either standard mining stations or gas mining stations; built by Construction Ships at resource-rich planets
- Construction Ships: mobile construction yards; can build bases at uninhabited planets or even in deep space; cycle with the Cycle Construction Ships button or the 'Y' key
- Military Ships: defend the empire from enemy empires and marauding pirates; assignable missions: Attack an enemy target; Patrol a colony or base, watching for attackers; Escort a civilian ship, such as a construction ship or mining ship; various sizes and classes of military ships; cycle with the Cycle Military Ships button or the 'M' key
- Find Idle Ships: the Cycle Idle Ships button (or the 'I' key) finds ships that don't currently have a mission, helping you find unused ships to assign missions to
- Main menu: "you can also try the other tutorials from the main menu"

### 3. Exact UI-relevant quotes (verbatim)

- "To see a complete list of all the ships and bases in your empire click the Ships and Bases button (F11 key)."
- "All your empire's ships and bases can be designed to your exact specifications in the Designs screen (F8 key)."
- "See the tutorial 'Research, Ship Design and Construction' for more information on how to do this."
- "To assign a mission to a ship first select it in the main view by left-clicking on it with the mouse."
- "Then right-click the mouse over the mission target, e.g. to make a ship move to another location right-click the mouse at that location."
- "Note that you may need to unpause the game to see the ship move."
- "Right-clicking on the ship or base may also bring up a popup menu listing a number of missions."
- "These missions are specific to the particular type of ship or base. They may include: Exploration, Colonization, Building, Refueling, or many others."
- "To automate a ship first select it and then press the 'A' key. To turn off automation just assign a mission to the ship."
- "When a ship is automated a circular blue arrow appears in the bottom-right corner of the Selection Panel."
- "Note that ALL ships start the game automated."
- "Base missions can include: building new ships, retrofitting to a new design or scrapping the base when it is no longer needed."
- "Exploration ships can be automated to explore on their own ('A' key)."
- "To cycle through all of your Exploration ships use the Cycle Colony and Exploration Ships button, or use the 'X' key."
- "To cycle through all your colony ships use the Cycle Colony and Exploration Ships button, or use the 'X' key."
- "To cycle through all of your Space Ports use the Cycle Space Ports button, or use the 'P' key."
- "Use the Cycle Construction Ships button to cycle through all the construction ships in your empire, or use the 'Y' key."
- "Use the Cycle Military Ships button to cycle through them, or use the 'M' key."
- "You can find ships that don't currently have a mission by clicking the Cycle Idle Ships button (or press the I key)."
- "When you are ready you can also try the other tutorials from the main menu."