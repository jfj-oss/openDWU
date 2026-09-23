# Distant Worlds: Universe — Help Articles: UI & Screens (verbatim extraction)

Source: `dwu-research/help_all.txt` (plain-text extraction of in-game Galactopedia articles).
This file extracts the UI/interaction and screen articles nearly verbatim. Exact UI strings are kept; tables are rewritten as markdown tables/lists but no item, value, or UI string is dropped.

---

## UI_MouseActions

You can use the mouse to move around, select items and give commands. Most commonly you will use the following actions:

- Moving the mouse pointer to the edge of the main screen will cause the view to move in that direction.
- You can also move the main view by holding down the right mouse button while dragging.
- Hovering over an item in the main view displays summary information about the item at the bottom-middle of the screen.
- Left-clicking selects the item under the mouse pointer, displaying detailed information in the Selection Panel at the bottom left of the screen.
- Right-clicking displays a pop-up menu with actions appropriate to the selected item, or if no item is selected it centers the view on the mouse pointer position.
- The mouse scroll wheel zooms the main view in and out from 100% (individual planets and ships) to full galaxy view, and any zoom level in between.

## UI_KeyboardCommands

The following keys can be used to control gameplay in Distant Worlds:

| Key | Action |
|---|---|
| F1 | Galactopedia Help screen |
| F2 | Colonies screen |
| F3 | Expansion Planner screen |
| F4 | Intelligence Agents screen |
| F5 | Diplomacy screen |
| F6 | Your Empire Summary screen |
| F7 | Research screen |
| F8 | Ship Designs screen |
| F9 | Build Order screen |
| F10 | Construction Yards screen |
| F11 | Ships and Bases screen |
| F12 | Fleets screen |
| G | Galaxy Map screen |
| H | Message History screen |
| V | Empire Comparison and Victory Conditions screen |
| O | Game Options screen |
| Pause or Spacebar | Pauses or resumes the game |
| Escape | Displays the Game menu |
| Arrow keys | Scrolls the main view up/down/left/right |
| Backspace | Zooms to the selected item |
| Insert | Zooms the main view to System level |
| Delete | Zooms the main view to Sector level |
| End | Zooms the main view to Galaxy level |
| Home | Zooms the main view to 100% |
| Page Up | Zooms the main view Out |
| Page Down | Zooms the main view In |
| + | Increases game speed by one level |
| – | Decreases game speed by one level |
| N | Move forward in selection history |
| B | Move backward in selection history |
| L | Locks/unlocks the main view on the currently selected item |
| Z | Selects the nearest available military ship to the current location |
| C | Cycles your Colonies in the selection panel (Shift cycles backwards, Ctrl cycles and moves view) |
| P | Cycles your Space Ports in the selection panel (Shift cycles backwards, Ctrl cycles and moves view) |
| M | Cycles your Military ships in the selection panel (Shift cycles backwards, Ctrl cycles and moves view) |
| Y | Cycles your Construction ships in the selection panel (Shift cycles backwards, Ctrl cycles and moves view) |
| X | Cycles your Exploration and Colony ships in the selection panel (Shift cycles backwards, Ctrl cycles and moves view) |
| F | Cycles your Fleets in the selection panel (Shift cycles backwards, Ctrl cycles and moves view) |
| I | Cycles your Idle ships in the selection panel (Shift cycles backwards, Ctrl cycles and moves view) |
| E | Commands the selected ship to Escape from attackers |
| R | Commands the selected ship to Refuel at the nearest refueling point |
| A | Automates the selected ship |
| S | Stops the selected ship, cancelling the current mission |
| comma | Cycles engagement ranges of selected military ship or fleet |
| D | Toggles the Display, alternating between detailed and simple views |
| T | Toggles screen elements on/off: selection panel, map, scrolling message list |
| 0-9 | Selection hotkeys for stored items – press key once to select, twice to move to item |
| Ctrl 0-Ctrl 9 | Hotkey storage – store selected items for later quick selection |
| Ctrl-left mouse click | Centers main view on location clicked and zooms in to 100% |
| PrtScn | Takes a screenshot, storing the picture in the "screenshots" folder |

## UI_ShipMissions

You can assign missions to any of your state-owned ships. Note that this does NOT include freighters, mining ships or passenger ships, which are privately-owned. Private ships automatically go about their business, transporting goods and mining resources. You cannot assign missions to private ships.

### Selecting items

Left-click with the mouse to select any item on the screen: ship, base, planet, moon, asteroid, gas cloud or star. A detailed read-out for the selected item will be displayed in the Selection Panel at the bottom-left of the screen.

### Assigning missions

- Right-click with the mouse to assign the default mission to the selected ship: move, attack, escort, patrol, blockade, etc.
- The default mission for a selected ship often depends on what the mouse is currently hovering over, e.g. if you have a military ship selected and you hover your mouse over a ship of another empire then the default mission is "Attack". But if the mouse is not currently hovering over anything then the default mission is "Move".
- The default mission type is often indicated by a change in the mouse cursor.
- If more than one mission is available then a pop-up menu appears with detailed mission options. Select one of the options from the menu to assign a mission. You can also force a pop-up menu to appear with all available missions for the selected ship by holding down the Ctrl key and right-clicking.
- Some missions are also available as Action buttons under the Selection Panel. Click an Action button to assign the mission to the selected ship.

### Automating your ships

- State-owned ships can be automated so that they assign their own missions appropriate to their type. (Privately-owned ships are always automated – you cannot assign missions to them)
- To automate a ship, select it and then press the 'A' key. To stop automation just assign a mission to the ship. You can also toggle automation on or off using the Action button under the Selection Panel.
- Note that after being built, all ships start off fully automated.

## UI_ShipMissionTypes

A list of all available ship mission types is presented below. To assign a mission to a ship you must first select it by left-clicking on it in the main view. Note that the specific missions that are available for a particular ship depends on the type of ship, e.g. only ships with weapons or troops can attack, only ships with construction yards can build, etc.

- **Move**: Sends the ship to the specified destination. If the destination is far away then the ship may perform a hyperjump first. This mission is available to all ships.
- **Patrol**: Causes the ship to orbit the specified colony or base, watching for enemies. You can assign Patrol missions to military ships when the mouse hovers over a colony or base of your empire.
- **Attack**: Causes the ship to close within range of the targeted ship, base, colony or space creature and fire its weapons at the target. This mission ends when either the attacker or the target flees or is destroyed. This mission is only available to military ships when hovering over a target of another empire.
- **Bombard**: Causes the ship to move towards the targeted enemy colony and commence orbital bombardment. This kills the population at the colony and damages the planet itself, lowering its quality. To enable this mission hold down the Shift key. This mission is only available to military ships with bombard weapons when hovering over a colony.
- **Capture**: Causes the ship to close within range of the targeted ship or base and attempt to board and capture the target. This mission ends when either the target is captured, or the attacker or the target flees or is destroyed. To enable this mission hold down the Shift key. This mission is only available to military ships with assault pods when hovering over a ship or base of another empire.
- **Raid**: Causes the ship to close within range of the targeted base or colony and Raid the target. This mission ends when either the target is raided, or the attacker flees or is destroyed. NOTE: only pirate factions can carry out raid missions. To enable this mission hold down the Alt key. This mission is only available to military ships with assault pods when hovering over a base or colony of another empire.
- **Blockade**: Causes the ship to park near the target colony or base, attacking any ships that attempt to dock at the blockade target. Available to military ships when the mouse hovers near the colony or base of an empire that you have trade sanctions against.
- **Escort**: Causes the ship to travel in close formation with the target ship, keeping a watch out for any attackers. Can assign to military ships when the mouse hovers over a non-military ship of your empire.
- **Build**: Initiates construction of a ship or base at the specified colony, space port or construction ship. Available to colonies and space ports at all times, or to construction ships when the mouse hovers over an uncolonized planet, moon, gas cloud or asteroid.
- **Colonize**: Causes the ship to attempt colonization of the specified planet or moon. Available to colony ships when the mouse hovers over an uncolonized planet or moon that your empire is able to colonize.
- **Explore**: Causes the ship to explore the specified planet or system. Can assign to exploration ships when the mouse hovers over a planet or system.
- **Escape**: Causes the ship to attempt to escape by hyperjumping a short distance into deep space. Available to any ship engaged in combat.
- **Retrofit**: Causes the ship or base to upgrade to the specified design at the specified construction yard. Available to any ship or base where there is a more recent design of the same type.
- **Retire**: Causes the ship to move to the specified construction yard to be scrapped. Available to any ship or base.
- **Repair**: Causes the ship to move to the specified construction yard to be repaired. Available to any ship that has damaged components.
- **Refuel**: Causes the ship to move to the specified refueling point to be refueled. Available to any ship at any time.
- **Stop**: Cancels the ship's current mission and brings to a full stop. Available to any ship that currently has a mission.

## UI_ShipSymbols

Distinctively-shaped symbols are used to identify each type of ship or base. These symbols are drawn around each ship so that you can quickly recognize a ship or base.

- The color of the symbol identifies the empire that the ship or base belongs to.
- State controlled ship and base symbols are drawn with a solid line. Privately controlled ship and base symbols are drawn with a dashed line.

The various symbols used for each type of ship and base are displayed below (the in-game article shows a two-column image table — the symbol graphics are not present in the text extraction; the ship/base categories are preserved):

| Ship / Base type (article row) | State Controlled | Privately Controlled |
|---|---|---|
| Military Ships (including Troop Transports and Resupply Ships) | symbol (solid line) | symbol (dashed line) |
| Freighters (Small, Medium and Large) | symbol (solid line) | symbol (dashed line) |
| Exploration Ships and Colony Ships | symbol (solid line) | symbol (dashed line) |
| Passenger Ships | symbol (solid line) | symbol (dashed line) |
| Construction Ships | symbol (solid line) | symbol (dashed line) |
| Mining Ships and Gas Mining Ships | symbol (solid line) | symbol (dashed line) |
| Space Ports, Defensive Bases, Resort Bases, Research stations, Monitoring stations | symbol (solid line) | symbol (dashed line) |
| Mining Stations and Gas Mining Stations | symbol (solid line) | symbol (dashed line) |

## UI_EmpireNavigationTool

At the left of the main view is the Empire Navigation Tool. This is a set of scrollable lists that provide quick access to everything in your empire. Combining the Empire Navigation Tool with the Selection Panel and Action buttons gives you one-click access to many common tasks, enabling you to easily manage most of your empire directly from the main screen.

For example, you can easily do the following tasks:
- colonize new planets
- build mining stations and other bases
- construct new ships at your spaceports
- select enemy targets to attack

The Empire Navigation Tool provides lists for the following items in your empire:
- Colonies
- Characters
- Spaceports and Construction Yards
- Mining stations
- Construction ships
- Exploration ships
- Enemy Targets
- Fleets
- Military ships
- Pirate Missions
- Potential colonies
- Potential mining stations
- Potential Research locations
- Potential Resort locations
- Special locations

Interaction:
- Click an icon to open a list. Click the icon again to close it, or use the close icon at top right of the list.
- Each list can be scrolled up and down by clicking on the arrows at top and bottom, or by using the mouse scroll wheel while hovered over the list.
- If you are zoomed out to Galaxy- or Sector-level, as your mouse hovers over each item its location is 'pinged' in the galaxy with an expanding yellow circle.
- Click an item in a list to select it in the Selection Panel below. You can then use the Action buttons under the Selection Panel to access common tasks for the selected item.
- Double-clicking an item in a list will move the main view to that item.
- Some of the lists allow you to multi-select ships (shift-click) and perform actions on them as a group. Thus from the "Military Ships" list you can shift-click items to select a group of military ships, and then form them into a fleet by clicking the "Create New Fleet" Action button below the Selection Panel.

### Enemy Targets List

One notable list in the Empire Navigation Tool is the Enemy Targets List. This list shows you all known enemy targets.

- Clicking on a target will assign your nearest available fleet to attack it. Right-clicking on a target that has a fleet assigned will cancel the attack.
- If you have a fleet selected when you click a target, then the selected fleet will be assigned to attack the target. Thus you can cycle through your fleets using the F key and assign attack targets by clicking in the Enemy Targets list.
- Clicking on a target that already has a fleet attacking it will instead select the assigned fleet. If you want to reassign the fleet you can then right-click the current target to cancel the attack and then click on the new target to attack it with the selected fleet.

## UI_Messages

Once your empire starts growing you'll find that important events will be happening in lots of different places – it'll become hard to keep track of it all.

To notify you of important events occurring throughout your empire several types of messages are sent to you:
- **Diplomacy and Advisor messages**: appear in a stacked list at the right of the screen
- **Popup messages**: appear in a popup panel that slides in at the right of the screen
- **Scrolling messages**: these appear in the scrolling message list at the top of the screen

These messages cover matters like encountering new empires, treaty offers, colonizing new worlds, or notifications that you are under attack at a particular location.

- Clicking on the message will take you directly to the location of the event.
- All messages that you receive are stored in the Message History screen (H key). Here you can review past messages and go directly to any related locations in the galaxy.

### Location Pings

Some messages reveal previously unknown locations. For your convenience, these locations are indicated in the galaxy view by a dashed blue expanding "ping" circle. Once these locations have been explored the "ping" circle will disappear.

You can fine tune which types of messages you receive in the Game Options screen (O key).

## Screen_GameMenu

From the Game menu you can load and save games, set game options and exit the game. You can display the Game menu by clicking the Game menu button (top left of the screen) or pressing the Escape key.

The Game menu functions are described below:
- **Exit Distant Worlds**: exit Distant Worlds to the Windows desktop. Note that the current game will be lost unless you first save it.
- **Exit to Main Menu**: exit the current game to the Distant Worlds start menu. Note that the current game will be lost unless you first save it.
- **Load Game**: loads a previously saved game.
- **Save Game**: saves the current game under the current file name.
- **Save Game As**: saves the current game under a new file name.
- **Options**: displays the Game Options screen, allowing you to change game settings.
- **Enter Game Editor**: switches the current game into edit mode, where you can alter the galaxy and empire settings
- **Resume Playing**: closes the Game menu

## Screen_StartNewGame

The Start a New Game screen allows you to set up a new game with complete control over all the details.

The screen is separated into seven separate wizard-style steps:
1. Playstyle
2. The Galaxy
3. Colonization and Territory
4. Your Race
5. Your Empire
6. Other Empires
7. Victory Conditions

Context-sensitive help messages are displayed in yellow at the top of the screen. These messages explain the function of each setting as you select it on the screen.

### Step 1: Playstyle

In step 1 (Playstyle) you have six options at the top of the screen that give you quick starts into various eras of galactic history, with various predefined settings to match.

Clicking options 2-6 next present you with an abbreviated quick start screen to allow adjusting galaxy size and shape, your empire's race and government, and the difficulty level of the game.

The six playstyle options (verbatim):
- **The Ancient Galaxy** is a game using a custom theme and a predefined galaxy map. The storyline in The Ancient Galaxy takes you back to the distant past when the galaxy was a different place. Clicking this option will immediately switch your theme to "The Ancient Galaxy" and start the game.
- **Pirate Faction in the Age of Shadows** let's you play as a marauding pirate faction during the Age of Shadows when civilization has crumbled and pirates rule the galaxy.
- **Standard Empire in the Age of Shadows** let's you start off as a primitive standard empire in the Age of Shadows without hyperdrive technology. You must slowly spread throughout your home star system prior to rediscovering faster-than-light travel.
- **Classic Era** sees you starting as a standard empire with a single colony. This option has the original Distant Worlds storyline, but without any story elements from Return of the Shakturi or Legends.
- **Return of the Shakturi** also sees you starting as a standard empire with a single colony. This option has the storyline elements from both the original Distant Worlds and Return of the Shakturi, but does not contain the Legends storyline.
- **Legends** also sees you starting as a standard empire with a single colony. This option contains all of the Distant Worlds storyline: original, Return of the Shakturi and Legends.

**Custom Games**: You can also set up completely customized games using the two buttons "Custom Game as Standard Empire" and "Custom Game as Pirate Faction". These options provide access to all startup options, as outlined in detail below.

### Step 2: The Galaxy

In step 2 (The Galaxy) you can determine the galaxy shape and size, including both the number of star systems and the physical dimensions of the galaxy.

- At top-right you can alternatively load an existing savegame as a galaxy map. This means that instead of generating a new random galaxy using the settings at top-left, you can load the galaxy as found in a savegame, with the previously saved layout of stars and planets, etc.
- **Expansion** controls how old and developed the galaxy is, which determines the size of auto-generated empires.
- The **Difficulty** setting makes harder or easier. This setting affects many different factors, making these factors more or less favorable for you relative to other empires. You can also turn on **Difficulty Scaling** so that the game gets harder as you near victory.
- **Aggression** level determines how aggressive computer players are.
- **Research Costs** determine how fast research occurs in the galaxy, and thus how quickly new components become available for use in ships and bases. You can use the slider to set common values for research costs, or you can type in your own custom value in the box at the right.
- Finally, you can also specify how many space creatures and pirates are present in the galaxy. For pirates you can also control how far away they start from empires. You can also specify that **Destroyed Pirates do not restart**, allowing you to more easily clear pirate presence from a section of the galaxy.

Click the Next button at bottom right to continue to step 3 (Colonization and Territory).

### Step 3: Colonization and Territory

- **Colony Prevalence** influences the number of colonizable planets and moons in the galaxy. Higher prevalences means denser empires with colonies packed closer together.
- **Independent Alien Life** determines how many independent populations of aliens exist in the galaxy and how large they are.
- **Colony Influence Range** controls how far your empire's territorial influence projects out from your colonies.
- You may also choose to enforce limits on how far new colonies can be established from any empire's existing colonies. If this is turned on, then you cannot establish new colonies further than the indicated range from any of your existing colonies. However you may still take over other empire's colonies outside this range.

Click the Next button at bottom right to continue to step 4 (Your Race).

### Step 4: Your Race

In step 4 (Your Race) you select which alien race you will play as. Choose a race from the drop-down list at top-left. Each alien race has unique characteristics that alter their style of play. This includes a set of resources that provide special bonuses for the race, as well as race-specific victory conditions.

Click the Next button at bottom right to continue to step 5 (Your Empire).

### Step 5: Your Empire

In the Your Empire step you can set all the characteristics of your empire, including its name, colors and flag. From here you can also set your empire's size, it's technology level and it's starting location in the galaxy.

- **Home System** determines the favorability of your starting system. In more favorable systems your starting colony will have higher quality and size. There will also be additional colonizable planets beyond your starting colony.
- **Corruption** determines the level of corruption and income loss across your empire. This setting only affects your empire, not other empires in the galaxy. All other empires use "Normal" corruption setting. Thus you can use this setting to make either an easier, or more difficult game for yourself against the computer players.
- At the bottom of this screen you can select the government style you want to play as. Details on the selected governments are shown here to help you decide which government you want to play.

**Pirate Factions**: If you selected to play as a pirate in step 1 (Playstyle) then there are different options on the Your Empire screen. You must select a pirate playstyle for your pirate faction from the dropdown list. Each particular Pirate Playstyle provides various bonuses and penalties that focus your pirate faction towards different activities. Pirate Playstyles also determine what victory conditions your pirate faction will pursue. Each pirate playstyle is explained in detail when you select it.

Click the Next button at bottom right to continue to step 6 (Other Empires).

### Step 6: Other Empires

In the Other Empires step you can determine the settings for all the other empires in the galaxy.

- If you wish you can automatically generate all other empires at random, specifying how many empires to generate.
- Or you can specify the details of each empire individually in the grid in the middle of the screen. Here you can set up specific competitor empires, including their race, government type, size, technology level and how close they start to your empire in the galaxy.
- Finally, you can decide whether new empires should spontaneously appear during the game. If you check this option, independent colonies can start new empires when they reach a sufficient size and development level.

Click the Next button to continue to step 7 (Victory Conditions).

### Step 7: Victory Conditions

In the Victory Conditions step you can choose how to win the game. Valid victory conditions include any combination of the following:
- **Territory**: control the specified percentage of all colonies in the galaxy
- **Population**: control the specified percentage of the galaxy's total population
- **Economy**: your empire's private economy generates the specified percentage of the galaxy's total economic output
- **Race-specific conditons**: each empire must reach it's own unique race-specific victory conditions

- The value for **Victory Threshold Percent** determines the proportion of the above victory conditions that must be met for victory.
- You can also choose to have victory conditions only apply after the game has progressed for the specified number of years. This setting can prevent a game from finishing prematurely, when empire progress may fluctuate more noticeably at the start of the game.
- You may also set a time limit, where the game finishes after the specified number of years. At this point the winner is determined by the empire with the highest total strategic value of all its colonies.
- At the left you can choose to disable story events from the original Distant Worlds storyline by unchecking the checkbox. This will turn off all backstory events, including debris fields, restricted zones and planet destroyer construction projects.
- Below this you can also choose to disable the Return Of The Shakturi story events and victory conditions by unchecking the checkbox.
- Special events new in Distant Worlds Legends can be enabled or disabled with the checkbox "Enable Disasters and other events"
- Under this you can choose whether to enable race-specific events in the game.
- Finally you can enable or disable story events related to the Age of Shadows.
- Note that some settings in the Victory Conditions screen may be disabled and unavailable depending on the game playstyle chosen in step 1.

Once all of the settings are complete, click the "Start the Game" button to generate the galaxy and begin playing!

## Screen_MainScreenElements

The main game screen that displays stars, planets, moons, space ships and bases is called the Main View. This view can be zoomed in to planet level or out to galaxy level (mouse scroll wheel or PageUp/PageDown keys).

You can select any item in the main view by clicking on it. If more than one ship or base is at the same location where you clicked then a popup menu will appear listing all the ships and bases at the location. Click on a ship or base from the popup menu to select it.

Hovering over an item will display a summary at the bottom of the screen.

Let's take a closer look at all the elements in the main screen.

At the top-left of the screen are buttons for the Game Menu (Escape) and Galactopedia (F1). Under these is the Pause/Resume button (spacebar) and buttons to increase (+) or decrease (-) the game speed. Under this is the current star date.

At top-right is the current cash on hand, your current cashflow, and any bonus income you have received so far this year. Under this is the name of the system you are viewing.

### Scrolling Message List

At the top of the screen is the Scrolling Message List. This displays the five most recent messages. Click on a message to move to the location of the message event or to open an appropriate screen. Under the scrolling message list are buttons that open various game screens, allowing you to handle matters like Diplomacy, Intelligence, Construction and Research.

### Empire Navigation Tool

At the left of the screen is the Empire Navigation Tool. This is a set of scrollable lists that provide quick access to everything in your empire: colonies, characters, space ports, fleets, potential colonies, potential mining stations, etc. Click an icon to open a list, which can be scrolled up or down with the mouse scroll wheel. Click an item in a list to select it in the Selection Panel (explained below).

### Diplomacy and Advisor Message List

At the right of the screen is a stacked list of messages from other empires, pirate factions and your advisors. Click on a message to open communications and respond to the other empire.

### Selection Panel

At bottom-left is the Selection Panel. This displays detailed information about the currently selected item. Buttons to the left and right allow you to cycle through various items in your empire.

- At the top of the Selection Panel are the forward and back buttons for moving through a history of all items you have previously selected.
- At the top-right is an Expand/Shrink button that allows you to enlarge the size of the Selection Panel, providing better clarity of the information displayed.
- At the bottom of the Selection Panel are a set of Action buttons that are used to give commands to the selected ship, base, fleet or colony. This includes actions like refuelling, joining fleets, loading troops and construction.

### Map

At bottom-right is the Map. This displays a map of the surrounding area. When zoomed in to a system, it displays the surrounding planets and moons. When zoomed out to the galaxy it displays the surrounding stars and nebula clouds. The area displayed in the main view is indicated by the light blue rectangle in the middle of the map. You can change your location in the main view by clicking on the map. At the left of the map are buttons to select different zoom-levels for the main view.

### Map Overlays

Above the mini-map are buttons for toggling various map overlays on or off. When a map overlay is switched on it displays additional information in the main view when zoomed out to sector or galaxy level. Available map overlays are as follows:
- Fade Civilian ships and bases (provides better visibility of state ships and bases that you control)
- Fleet Postures
- Ship Travel Vectors – state controlled ships
- Ship Travel Vectors – privately controlled ships
- Potential Colonies
- Potential Resort Locations
- Potential Research Locations
- Long Range Scanners
- Empire Influence

### Colonies in the Main View

Colonies are displayed with a colored name badge. This badge shows the colony name at the top. If the colony is the empire capital a gold star also appears to the left of the name. Any resources at a planet or moon are displayed in picture-form at the bottom-right of the badge. The bottom-left of the badge shows the dominant race at the colony along with a graph indicating the size and development level of the population.

From left-to-right the population graph displays population size in the following increments:
- 0 to 20 million
- 20 million to 100 million
- 100 million to 500 million
- 500 million to 2.5 billion
- Over 2.5 billion

From bottom-to-top the population graph displays development level in the following increments:
- 0% to 20%
- 20% to 40%
- 40% to 60%
- 60% to 80%
- 80% to 100%

## Screen_MainView

The main display area of the game shows all the activity proceeding throughout the galaxy. From here you can see stars, planets, moons, asteroids and gas clouds. Ships and bases are also visible here.

### Planet display

Any resources at a planet or moon are displayed in picture-form in the top-right corner. Inhabited worlds display the picture of the dominant race along with a graph indicating the population size and development level. Colonized worlds display the flag of the owning empire.

The 5×5 population graph shows both the size of the population and its development level.

From left-to-right displays population size:
- 0 to 20 million
- 20 million to 100 million
- 100 million to 500 million
- 500 million to 2.5 billion
- Over 2.5 billion

From bottom-to-top displays development level:
- 0% to 20%
- 20% to 40%
- 40% to 60%
- 60% to 80%
- 80% to 100%

### Ship and Base display

Ships and bases are displayed with their empire flag at the top-left corner. If they are independent then they have no flag. If the ship or base has shields these will be displayed as a solid blue line above the ship or base. Any shield damage is shown in red as a portion of the same line.

You can click a ship or base to select it. If more than one ship or base is at the same location where you clicked then a popup menu will appear listing all the ships and bases at the location. Select a ship or base from the popup menu.

## Screen_SectorView

As you zoom out the main view changes to display information about systems, indicating which empire owns each system. From this view you can still select ships, bases and fleets and assign missions to them.

Sectors are regions in the galaxy. The galaxy is divided into a 10×10 grid of sectors. Sector boundaries are visible as light blue lines in the main view when zoomed out.

In the zoomed out view ships and bases appear as circular icons. The icons have the following meanings:
- **Blue icons**: your empires ships and bases
- **Yellow icons**: neutral empires ships and bases
- **Red icons**: enemy empires ships and bases, or pirates

In systems that you control, your ships are not directly visible, only space ports and fleets are visible in these situations. This minimizes the number of icons and allows you to easily select the more important ships and bases when in the zoomed-out sector view.

## Screen_SystemView

As you zoom out the main view can display an entire system, showing planet orbits. From this view you can still select ships and planets. However, to minimize clutter in the display, the empire flags of ships are not shown. To see the empire flags of all ships and bases hold down either of the shift keys. Alternatively you can move the mouse close to ships to display their empire flags.

## Screen_Map

The map displays the surrounding area. This can be a map of the current system if zoomed in, or it can be a map of the sector or even the whole galaxy if zoomed out.

You can change your location in the main view by clicking on the map. The main view then centers on the area you clicked in the map. The area displayed in the main view is indicated by the light blue rectangle at the centre of the map.

Colors on the map are used to indicate different types of planets or stars.

When zoomed in to a system the colors are used as follows:
- Green – Continental planets and moons
- Yellow – Marshy Swamp planets and moons
- Light Brown – Sandy Desert planets and moons
- Dark Blue – Ocean planets and moons
- Light Blue – Ice Glacial planets and moons
- Orange – Volcanic planets and moons
- Grey – Barren Rock planets, moons and Asteroids
- Red – Gas Giant planets, Also: Red Giant and Super Giant stars
- Pink – Frozen Gas Giant planets

When zoomed out to a sector or the galaxy colors are used as follows:
- Yellow – Main Sequence stars
- Red – Red Giant and Super Giant stars
- White – White Dwarf and Neutron stars
- Light Blue – Supernovae
- Light pink – Gas Clouds

## Screen_InfoPanel

The Selection Panel displays summary information on your current selection in the main view. This can be a ship, base, fighter, colony, fleet, system, star, gas cloud, planet, moon, asteroid or space creature.

Some information in the selection panel is clickable, allowing you to drill-down for further details on the selected item. You can also click the selection panel to center the main view on the currently selected item.

Buttons to the left and right of the selection panel allow you to cycle backwards and forwards through various items in your empire.

### Action buttons

Below the Selection Panel are a set of buttons that are used to give commands to the selected ship, base, fleet or colony. Some examples of ship actions include:
- **Repair and Refuel**: sends the ship to repair (if damaged) and refuel at the nearest refuelling location
- **Retrofit**: sends the ship to the nearest construction yard to upgrade to the latest design
- **Load troops**: makes the ship load troops at the nearest colony with spare troops
- **Toggle Automation on/off**
- **Construction**: opens a new set of Action buttons allowing you to quickly build new ships or bases
- **Fighters**: opens a new set of Action buttons allowing you to manage build and deploy fighters onboard a ship or base
- …and many others

Some of the selection panel views are described in detail below:

### Colony summary

- A gold star at top-left indicates that this colony is the empire capital
- The empire owning the colony has its flag displayed at top-right
- A planet summary is displayed directly under the name. This shows the size of the planet (diameter), and the planet Quality
- **Populace**: lists all resident alien races, along with their sizes and current growth rates
- **Resource**: graphically displays the resources found at this world, along with the current amounts
- **Value**: lists the strategic value, the development level and the approval rating for the colony
- **GDP**: shows the gross domestic product, or economic output, of the colony. The proportion of the total empire GDP that this colony provides is also listed
- **Tax**: shows the current tax rate along with the actual tax income amount this equates to. The tax compliance rate amongst the general population is also listed here – if compliance is low then either your tax rate is too high or you are not keeping your citizens happy enough
- **Facilities**: show any planetary facilities that have been built at the colony. This includes facilities under construction (faded)
- **Troops**: shows any troops present at the colony. This includes troops being recruited (faded) and invading enemy troops (red background)
- **Building**: lists any ships or bases under construction at the colony
- **Docked**: shows ships that are currently docked at the colony. Colonies can have a maximum of three ships docked simultaneously

### Ship summary

- A silver star at the top-left indicates that the ship is the lead ship of its fleet (not shown here)
- The empire flag of the ship is displayed at top-right
- The current mission for the ship is displayed directly under the name. Next to this is displayed the engagement stance, which indicates the range at which the ship will automatically engage enemies
- **Type**: shows the ship type along with whether the ship is Privately-owned or State-owned
- **Fleet**: shows which fleet (if any) the ship belongs to
- **Design**: shows which design this ship is based on along with the size of the ship
- Component status is displayed directly under Design. This indicates whether any components are damaged from combat or whether some components are still under construction
- **Fuel, Energy, Shields and Speed** graphs show the current level for each along with the maximum level for each at the right
- **Troops**: any troops on board are shown
- **Weapons**: shows weapons strength and range
- **Fighters**: shows fighters and bombers onboard this ship. This also include fighters under construction (faded)
- If the ship is automated the blue circular arrow is shown at bottom-right

### Base summary

- The empire flag of the base is displayed at top-right
- **Type**: shows the base type along with whether the base is Privately-owned or State-owned
- **Design**: shows which design this base is based on along with the size of the base
- Component status is displayed directly under Design. This indicates whether any components are damaged from combat or whether some components are still under construction
- **Fuel, Energy and Shields** graphs show the current level for each along with the maximum level for each at the right
- **Weapons**: shows weapons strength and range
- **Fighters**: shows fighters and bombers onboard this base. This also include fighters under construction (faded)
- **Building**: lists any ships under construction at the base
- **Docked**: shows ships that are currently docked at the base

### Fleet summary

- The fleet name is displayed at the top
- The empire owning the fleet has its flag displayed at top-right
- The current mission for the fleet is displayed directly under the name. Next to this is displayed the engagement stance, which indicates the range at which the fleet will automatically engage enemies
- **Empire**: name of the fleet's empire
- **Summary**: number of ships in the fleet, their total weapons firepower and the number of fighters in the fleet
- **Troops**: number of troops in the fleet and their total strength
- **Lead Ship**: name of the fleet's lead ship
- Visual display of each ship in the fleet. The green bar next to each ship shows the current fuel level. If the ship is damaged its background displays red.

### System summary

- A summary of the number of planets and moons in the system appears directly under the name
- **Owner**: shows the strongest empire in the system according to strategic value, including the number of colonies for the empire in the system
- **Resource**: visual list of all known resources in the system. Hover over each resource for it's name, or click for details
- Visual display of all colonized planets and mining stations in the system, showing which empire owns the planet and which alien race inhabits it

## Screen_MessageHistory

The Message History screen (H key) holds a list of all messages that your empire has received during the game. This includes all of the various types of events that have occurred in your empire: discoveries, diplomacy, research breakthroughs, etc.

From here you can review individual messages by selecting them in the list at the left. The body of the message then appears in the area in the middle of the screen.

If a message has a related location in the galaxy, this location is displayed on the galaxy map at the right. You can also jump directly to this location in the main view by clicking the button below the galaxy map.

You can filter messages using the dropdown list at top-left. You can exclude battle messages, or you can choose to view messages relating to Galactic History.

## Screen_MessageSettings

You can control which messages you receive in the Message Settings screen.

### Scrolling Messages

Control which types of messages appear in the scrolling message panel at the top of the main view. Check a message type to have it appear in the panel, uncheck it to turn off these message types.

### Popup Messages

Control which types of messages appear in the popup message area at the right of the main view. Check a message type to have it appear as a popup message, uncheck it to turn off popup messages for these message types.

## Screen_YourEmpireSettings

Your Empire Settings gives you control over some of the finer details of your empire.

- **Default Engagement Stances** determines the range at which your military ships will automatically engage enemies. This stance can be set differently for different types of missions. When a mission is assigned to a ship, the default engagement stance for that mission (or "Other" if not a Patrol, Escort or Attack mission) is set for the ship.
  - Note that Default Engagement Stances have a separate group of settings for both auto-assigned missions and manually-assigned missions, so that you can further differentiate engagement stances based on whether you manually assign a mission to a ship or it is auto-controlled.
- **Fleet Attack Settings** determines when a fleet will refuel or assemble (if ships are dispersed) prior to engaging in an attack mission.
- **Attack Overmatch** controls the level of firepower your military ships consider adequate to attack an enemy target. When a space battle takes place, this setting will be used to determine how many military ships are assigned to each enemy target.
- The **Discoveries** panel gives you control over what action to take when one of your ships encounters some ancient ruins or an abandoned ship or base. You can choose to automatically investigate these items, or to handle them yourself.
- Finally, you can select how newly built state-owned ships should start off after construction: either automated or manually-controlled.
- And if you prefer not to be interrupted at all when playing the game then you can enable the checkbox "Suppress all pop-up screens."

## Screen_EmpireSummary

Your Empire Summary screen (F6) gives you a quick overview of your empire.

- At the top of the screen is the name of your empire. Change the name by typing a new one here.
- **Overview**: Under your empire name is a summary of your empire's size and relative strength. Below this are some details on your current government type, including the bonuses and handicaps your style of government brings.
- At the right is the Economy panel, which displays a summary of your state and private economies, showing income and expenses.
  - Some of your empire's income is regular annual amounts (colony tax revenue, tribute). But other types of income are one-off and unpredictable. These are shown as "This Year's Bonus Income", and include items like foreign trade bonuses and income from your Resort Bases. Note that "Space Port Income" includes both private ship purchases and space port transaction fees for the current year.
  - The most important number in your economy is your state Cashflow. Try to always maintain positive state cashflow, unless you have large state cash reserves.
- **Pirate Economy**: When playing as a pirate your sources of income are different. Most income is more variable, so it can be harder to plan cashflow. Your expenses can also be highly variable.
- At the bottom-left the Bonuses panel summarizes any bonuses from the alien races within your empire. Also listed here are any bonuses from special ruins at your colonies.
- **Ships and Bases** (at the bottom-right): the Ships and Bases panel provides a summary of all the ships and bases in your empire, including firepower and maintenance costs.
- **Changing your Government**: In the government section is a dropdown list allowing you to choose a new type of government for your empire. Click the "Have Revolution" button to change your government. Note that a revolution is never painless; there will probably be unwanted side effects...

## Screen_EmpireComparison

### Victory Conditions

The Empire Comparison screen shows your progress towards the victory conditions for the game. This includes all of the types of victory conditions specified when you started the game:
- **Economy**: how much money your colonies generate
- **Population**: how many people live in your empire
- **Territory**: how many colonies you have in your empire
- **Race-specific conditions**: unique victory conditions for your race

### Achievements

Special successes you have attained in the current game and all previous completed games are displayed in the Achievements tab. Medals detailing each success are shown for each empire in the current game. Select an empire from the list to display their medals. The bottom two panels show all of your current and previous medals and all of your previous completed games, along with their details. Hovering over the selected empire provides a breakdown of their score.

### Empire Comparison Graphs

For an overview of how your empire compares to others in the galaxy you can review the graphs in the Empire Comparison screen (V key). These graphs show your empires relative strength in several areas when compared to all other known empires. Areas compared include:
- **Population**: compares total population levels for all known empires
- **Territory**: compares number of colonies for all known empires
- **Economy**: compares annual GDP for all known empires
- **Strategic Value**: compares total colony strategic value for all known empires
- **Military Strength**: compares total raw firepower for all known empires

Note that these graphs only include empires that you currently know about.

### Top Colonies

All known colonies are also ranked and a list of the top ten colonies is presented on the "Top Colonies" tab. Colony ranking is based on strategic value. Note that this list only includes colonies that you have explored and know about.

## Screen_EmpirePolicy

The Empire Policy screen gives you fine-grained control over automation in your empire.

- Here you can set the automation level in each policy area of your empire. Some areas can be either automated or manually controlled. Other areas have a third intermediate option: your advisors make suggestions that you can approve or reject.
- Most policy areas also have more detailed settings that you can modify to suit your style of play. For example, you can choose which planetary facilities should be built at your colonies, and when they should be built.
- When you have completed altering your empire policy, click the "Apply Policy" button to save your changes.

### Load and Save Policy settings

At the bottom of the Empire Policy screen are the Load and Save buttons. These allow you to save customized policy settings for later recall. You can also switch your policy settings by loading the policy for another alien race.

## Screen_Colonies

Details on each of your colonies can be tracked on the Colonies screen (F2).

- At the top of the screen is a list of your empire's colonies showing high-level statistics for each of them. Click any column heading to sort the colonies.
- At the top-right is a map showing the location of the currently selected colony in the galaxy.
- A set of tabs at the bottom show detailed information on the currently selected colony:
  - **Population**: lists all resident alien populations with sizes and growth rates
  - **Cargo**: all resources and components stored at this colony, including which empire owns the cargo
  - **Resources**: the resources that this colony provides
  - **Troops and Characters**: shows all troops: active, under recruitment, and even any invading enemy troops. Also shows all characters at the colony
  - **Construction Yard**: shows what is currently under construction at the colony, as well as any other items queued up to be constructed next
  - **Docking Bay**: lists which ships are currently docked at the colony, and which ships are waiting to dock
  - **Facilities**: shows all of the planetary facilities built at this colony, and any facilities under construction
- The name of the colony is displayed at the middle-right of the screen. The name can be changed by typing a new one.
- The tax rate for the colony is shown underneath the name. Type a new value here to change the tax rate. Note that if you have automated the control of colony tax rates then any changes that you make here could be overridden later.

## Screen_Fleets

Fleets are managed from the Fleets screen (F12).

- At the top of the screen is a list of your empires fleets. Click any column heading to sort your fleets.
- Under the fleet list is the name of the currently selected fleet. Change the fleet's name by typing a new one here.
- At the right, under the list of fleets is a dropdown list that allows you to choose a new home colony for the currently selected fleet. Click the "Set Home Colony" button to set the new home colony for the currently selected fleet.
- At the bottom-left is a summary of the currently selected fleet, showing how many ships and troops are in the fleet.
- At the bottom-center is the troop loadout for the selected fleet. This allows you to specify the percentages of each troop type that should be loaded onto the troop transports in the fleet. When a fleet picks up troops it will attempt to follow this preferred loadout, although actual availability of ungarrisoned troops at your colonies will ultimately determine which troops end up in the fleet.
- At the bottom-right is a map showing the location of the currently selected fleet in the galaxy.

The buttons beneath the fleet list perform the following actions:
- **Select Fleet**: selects the fleet in Selection Panel in the main screen, making it easy for you to then assign missions to the fleet
- **Go to Fleet**: moves the view to the selected fleet in the main screen
- **Repair and Refuel**: sends all of the ships in the selected fleet to be refueled (and repaired if damaged) at the nearest refuelling point
- **Retrofit to Latest Designs**: sends all of the ships in the selected fleet to be retrofitted at the nearest construction yard. If all ships are up-to-date then they will instead be refuelled
- **Load Troops**: each of the troop-carrying ships in the selected fleet will load troops from the nearest colony

## Screen_ShipsAndBases

Keeping track of all the ships and bases in your empire can be a challenging job, especially when your empire becomes large. The Ships and Bases screen (F11) provides a centralized list of all your ships and bases, showing where they are and what they are doing.

- At the top of the screen is a dropdown list that allows you to filter which types of ships and bases appear in the list below.
- Under this is the list of all your ships and bases including location and current mission. This list includes both state-owned and privately-owned ships and bases. Click any column heading to sort the ships and bases in this list. You can also click directly in the Automation column to automate or unautomate a ship (blue circular arrow icon).
- Under the list of ships and bases are a set of buttons that provide quick access to various commands for the selected ship or base. Note that you can multi-select ships and bases in the list (drag-select, ctrl-click, shift-click) and assign commands to ALL of the selected ships at once. This applies to Refuel, Repair, Retrofit, Retire and Scrap buttons.
- At the bottom is set of tabbed panels that show detailed information on the currently selected ship or base:
  - **Cargo**: all resources and components stored or transported at this ship or base, including which empire owns the cargo.
  - **Components**: the components that make up this ship or base, including their current status.
  - **Construction Yards**: shows any ships or bases currently under construction here, as well as any other items queued up to be constructed next.
  - **Docking Bays**: lists which ships are currently docked here, and which ships are waiting to dock.
  - **Troops**: shows all troops onboard, including their current status.
  - **Weapons**: lists all the weapons available for combat at this ship or base.
- At the top-right is a map showing where the currently selected ship or base is in the galaxy.
- At right-middle is the name of the selected ship or base. The name can be changed by typing a new one here.
- Under the name is a summary of the selected ship or base.

## Screen_Research

Research is managed from the Research screen (F7). Research is divided into three separate areas: Weapons, Energy, HighTech. Each area includes different types of technology. The Research screen has a dedicated tech tree for each research area. Click the tabs at the top of the screen to switch between tech trees.

### Using the Tech Trees

- Each tech tree contains all of the research projects for that area. Click a project to queue it up for research. You can queue up as many projects as you like in a tech tree. Each project will begin immediately after its preceding project(s) are completed.
- Note that many projects require multiple parent projects to first be completed before they can be researched. If any of the lines leading to a project are red, then the preceding project must first be researched. Hovering over a project in the tech tree will provide further details on the project, including what prerequisites must first be met before the project can be researched.
- You can cancel a research project by right-clicking on it. All other subsequent queued projects will be moved up the queue.
- Some research projects are limited to specific alien races – these cannot be researched by anyone else. However these techs can sometimes be obtained through other means. For example you might be able to trade this tech with a race that has it. Note though that if you obtain a tech through trade, you cannot then trade it away to another empire – you do not understand the tech well enough to explain it to someone else.

### Crash Research

To obtain research breakthroughs faster you can initiate crash research programs. This means that by spending money you can accelerate a research project 3 times faster than normal. To begin a crash research program click the currently researching project in a tech tree (i.e. the first project in the queue). A prompt will indicate the cost of the crash program and ask you to confirm the spending. Research projects in a crash program are indicated in the tech tree by a lightning bolt icon at lower right of the project.

### Research Stations

Research is performed at research labs built into your bases. Space ports have built-in research labs that are used by your scientists and engineers. But it is important to also build dedicated research facilities to maximize your research output.

- All of your research stations are shown on the last tab of the Research screen. This list shows the amount of research in each of the three areas at each of these bases.
- You can move the view to the selected research station by clicking the button "Go to Research Station".

### Total Empire Research Potential

At the right your Total Empire Research Potential is displayed. This is the maximum research power from your empires colonies, and relates to your colonies population and development level. This research potential must be unlocked by building adequate research stations. Thus you should build enough research stations so that their Total Research Capacity (see below) always exceeds your Total Empire Research Potential.

### Total Research Capacity and Actual Output

- The Total Research Capacity for all of your research stations is shown below the list. This is a simple total of all of the research power of your labs in each of the three research areas.
- Under this is the Actual Output (red background) in each of the three areas (Weapons, Energy, HighTech). This is your empire's potential research power spread across your current research stations. If your research stations are inadequate, your actual research output will be capped to the capacity of your research stations.
- Note that your Actual Output also includes any bonuses for your empire, such as the following:
  - Racial research bonuses
  - Research bonuses from your government type
  - Bonuses in one of the three research areas from a research station built at a special research location
  - Any special research bonuses from ancient ruins you control

## Screen_Designs

Ship and base designs are managed from the Designs screen (F8).

- At the top of the screen is a dropdown list allowing you to filter which designs are shown in the list below. You can choose to view:
  - Latest designs for each type of ship or base
  - Latest buildable designs for each type of ship or base (i.e. designs that we have the tech and construction size to currently build)
  - All non-obsolete designs (not marked as obsolete)
  - All buildable non-obsolete designs (i.e. non-obsolete designs that we have the tech and construction size to currently build)
  - All designs for your empire
  - In addition you can also filter the view of designs to only show state or private ships or bases.
- Next to the view filters is displayed the maximum construction sizes for ships and bases using your empire's current level of construction technology.
- At top-right you can load or save ship and base designs to a separate file for use in other games. Note that when saving designs only the currently selected designs will be saved. You can select multiple designs in the list (Ctrl-click) to save more than one design.
- In the middle of the screen is a list of your ship and base designs, including how many ships or bases use each design. Click any of the column headings to sort the designs.
- You can mark a design as obsolete by clicking directly in the far-right column of the list. When a design is obsolete a red asterisk symbol will appear here. Click the column again to turn off the red asterisk and make the design current.
- Below the design list are some buttons that allow you to manage your designs:
  - **Edit**: edits the currently selected design. Or if the design is already in use by a ship or base, views this design in read-only mode.
  - **Add New**: adds a completely new blank design, which you can customize to your exact specifications.
  - **Copy As New**: copies the currently selected design and uses it as the basis of a new design.
  - **Manually Upgrade Design**: copies the currently selected design and uses it as the basis of a new design, while updating the design name to show that this is a new design version. The previous design is also marked as obsolete.
  - **Auto Upgrade Selected Designs**: automatically upgrades the currently selected designs. This will create new designs with all the components in the selected designs replaced with the most recent versions. Note that you may not necessarily prefer to simply have the latest component of each type in your designs, in which case you will want to modify the new designs further.
  - **Delete Selected Designs**: deletes the currently selected designs. This is only valid if the designs are not currently in use by any ships or bases.
- Note that you can multi-select designs in the list (drag-select, ctrl-click, shift-click) and upgrade all of the selected designs together in a single action.

## Screen_DesignDetail

Editing or viewing a single design is accomplished in the Design Detail screen. Here you can add and remove components to customize your design to your own special requirements.

- The top of the screen displays the design name, the purchase and maintenance costs for the design, and a checkbox that you can use to indicate that the design is obsolete.
- Under the design name is a dropdown list that gives you control over the default retrofit stance for the design. This means that you can allow ships or bases of this design to automatically retrofit, or have them instead only be manually retrofitted (i.e. you manually direct each ship to retrofit if and when you want).

### Role and Battle Tactics panel

The panel at top-left is used to define the role of the design and it's tactics when in combat.

- Select a picture for your design from the dropdown list. All ship and base pictures in the game are available.
- You can also choose to scale the image used to display the ship or base by using the Image Scaling controls.
- Assign a role for the design. This indicates the purpose of the ship or base. Each role has specific rules about what component types should be present.
- Assign tactical behavior when in combat using battle and invasion tactics (see more below).

### Warnings panel

The Warnings panel at top-middle lists rules and recommendations to assist in producing a valid design. As you add and remove components to the design the warnings are updated to identify current problems.
- Rules are in red and must be satisfied to allow the design to be saved.
- Recommendations are in yellow and can be ignored if desired.

### Energy panel

The Energy panel at top-right shows fuel and reactor information for the design.

### Available components

At left-middle is a list of all components available for building the design. This list can be filtered to only show the most recent version of each component type.

### Adding and Removing components

- Use the Add Component button (>) to add the currently selected component in the Available components list to the design. You can also use the smaller "x5" button above to add 5 of the same components at a time.
- Use the Remove Component button (<) to remove the currently selected component from the Design components list. You can also use the smaller "x5" button below to remove 5 of the same components at a time.
- The design name is shown above the list of components currently on the design. You can change the name by typing a new one here.

### Design components

In the middle of the screen is a list of all components currently used on the design. This effectively IS the design.

### Movement panel

The Movement panel at right-middle shows speed and fuel consumption graphically for the design.

### Industry panel

The Industry panel at right-middle shows information relating to cargo storage, construction yards, docking bays and other items for the design.

### Component detail panel

The Component detail panel at bottom-left provides detailed information for the currently selected component.

### Weapons panel

The Weapons panel at bottom-middle lists all the weapons present on the design, including ranges, strength, etc.

### Defense panel

The Defense panel at bottom-right shows information on armor and shields for the design.

### Battle Tactics

Choose appropriate battle tactics for the design. This specifies the tactical behavior of the ship in combat.
- **Evade**: Maneuver to avoid coming within weapons range of your opponent. This is a good choice for non-military ships.
- **Standoff**: Engage your opponent with torpedo weapons (if available), while attempting to avoid coming within range of your opponents beam weapons. If your ship does not have torpedo weapons then "Standoff" will automatically upgrade to "All Weapons" when in combat.
- **All Weapons**: Engage your opponent with all of your weapons, closing to a range where all weapons can strike your opponent.
- **Point Blank**: Close to point blank range and engage your opponent with all of your weapons. This is sometimes necessary to punch through strong armor with the full strength of your weapons.

For stronger opponents you should usually choose "Stand Off", for weaker opponents you should typically choose "All Weapons". Stronger opponents are defined as ships or bases whose raw firepower is more than 30% greater than yours. All other ships or bases use the tactics you define for "weaker" opponents.

### Invasion Tactics

Troop-carrying ships should define invasion tactics. This specifies when the ship deploys invading troops at an enemy colony. Options are:
- **Do Not Invade**: Troops will not be deployed. This is the obvious option for ships that do not carry troops
- **Invade When Clear**: Troops will be deployed only when all enemy defences have been cleared. This is a good default choice for most military ships
- **Invade Immediately**: Troops will be deployed immediately, without waiting for enemy defences to be cleared. This is the default choice for troop transports, which usually carry large invasion forces – quickly winning the ground invasion can swiftly end the battle, avoiding unnecessary losses.

### Flee When

Choose when the ship should flee combat.
- **Enemy Military Sighted**: Flee whenever an enemy military ship is encountered
- **Attacked**: Flee whenever attacked by another ship
- **Shields 50**: Flee when shields fall to 50%
- **Shields 20**: Flee when shields fall to 20%
- **Never**: Never flee, fight to the death

## Screen_Diplomacy

Diplomacy with other empires is managed from the Diplomacy screen (F5).

### Empire List

- At the left of the screen is a list of all empires that you have encountered, including any pirate factions. Your empire is at the top of this list.
- When you select an empire from this list, that empire's relationship with all other empires is shown. Each colored line indicates the type of diplomatic relation between the two empires. Gray mean no relationship. The meaning of other colors is shown in the "Diplomatic Relations" panel at far right.
- Each row shows the attitude of the empire to the currently selected empire. It also shows the total annualized trade volume between this empire and the currently selected empire. When a Free Trade Agreement or Mutual Defense Pact exists, the current trade bonus percentage is displayed next to the trade volume.
- Click on any empire to display further details at the right in the Empire Summary panel.
- Double-clicking on a row will open a small window that allows you to name the relationship. This alliance name is only for display purposes – it has no effect on the game itself.

### Empire Summary

At the right is a summary of the currently selected empire, showing the following information:
- Empire flag, Dominant race and Other races that are part of the empire and the empire's name
- Summary of the empire, including the government type, number of colonies, the empire's reputation and it's military strength
- Characteristics of the empire's dominant race, including any racial bonuses
- Your current relationship with this empire, including a list of all the factors that influence their view of you.

### Talking to Empires

At top-right is a "Speak" button that you can use to initiate a conversation with the currently selected empire. This allows you to offer treaties, declare war, trade items or give gifts to another empire.

### Territory Map

At middle-right is a galaxy map showing the known colonies for the currently selected empire. Note that this only shows the locations of colonies that you have explored.

## Screen_TalkingWithEmpires

You can speak with an empire by clicking the "Speak" button from the Diplomacy screen (F5). Other empires may also choose to initiate a conversation with you when they have a matter that they wish to discuss. These messages from other empires will show up at the top-right of your screen – click on the message to open communications and respond to the other empire.

There are a number of subjects you can discuss with other empires:
- Change your diplomatic relationship
- Send gifts
- Send warnings
- Make trade proposals

The conversation screen displays a picture of the empire you are speaking with at the top. Under this is their message to you. At the bottom are your conversation options to speak with them. Click one of these options to respond to the other empire. "Goodbye" ends the conversation and closes the screen.

### Changing diplomatic relationship

You can propose a change to your current diplomatic relationship here. When you request a Free Trade Agreement or a Mutual Defense Pact you are simply proposing such a treaty – the other empire must also agree to this proposal before it becomes active. Treaty requests will only succeed when the other empire likes you sufficiently – don't bother asking for a Mutual Defense Pact when the other empire hates you.

When you cancel an existing treaty, declare war or impose trade sanctions you are acting unilaterally – the change takes effect immediately without any approval from the other empire.

### Sending gifts

You may choose to send a gift to the other empire. This can increase their goodwill towards you. Larger gifts have greater affect on them. But gifts will only make an impact when the other empire already feels favorable towards you. Gift-giving that is too frequent also has little impact on the other empire.

### Sending warnings

You can also send warnings to other empires. These warnings could include:
- Stop your intelligence missions against us
- Stop your attacks against us
- Remove your military forces from our systems

The other empire may or may not take note of your warning. If they respect you, and particularly if you are stronger than them, then they are likely to listen. Otherwise they may just ignore your warning. Warnings can also cause the other empire to take offense. So don't send warnings over trivial things – save them for important matters.

### Making Trade Proposals

You can offer to swap territory maps and galaxy maps with the other empire. Territory maps are all the systems where an empire has colonies. Galaxy maps include ALL of an empire's exploration of the galaxy. You may also sell technology that the other empire does not yet have. Exactly which items an empire is willing to trade are determined by how friendly your two empires are with each other. The friendlier you are with the other empire, the more items they will be willing to trade.

## Screen_Troops

The troops in your empire can be managed from the Troops screen.

- At the top of the screen is the name of the currently selected troop – change the name by typing a new one here.
- To the right of the name is a summary of your troops, including total maintenance costs.
- Under the name is a list of all your empire's troops, including those in recruitment. Click on any column heading to sort your troops.
- At the top-right is a dropdown list that can be used to filter the troop list to a particular colony or fleet. When you apply a filter the summary at the top also changes to reflect the troops currently in the list.
- To the right is a map indicating the location of the currently selected troop in the galaxy.

### Managing Troops at your colonies

Troops can also be viewed at each colony from the Colonies screen (F2) or onboard individual ships from the Ships and Bases screen (F11).

From the Colonies screen you can recruit and disband troops in the Troops tab:
- Click the "Recruit" button to begin recruiting a new troop at this colony.
- Click the "Disband" button here to immediately disband the currently selected troop.

You can garrison and ungarrison troops at a colony:
- Click the "Garrison" button to garrison the selected troop at the colony
- Click the "Ungarrison" button to ungarrison the selected troop at the colony

You can also directly transfer individual troops to specific troop transports that are near the colony and have spare troop space. To do this, select a troop to transfer, select a nearby troop transport from the dropdown list, then click the "Transfer" button. The selected troop will be immediately loaded onto the ship.

### Recruiting Troops directly

Troops can also be recruited directly at colonies in the main screen. Select your colony and click the "Recruit Troops" Action button under the Selection Panel. You can also recruit troops using the popup menu that appears when you right-click one of your colonies. Click the option to "Recruit Troops" in the popup menu.

## Screen_IntelligenceMissions

The characters in your empire are managed from the Characters screen (F4).

- At the top of the screen is a brief summary of which characters you currently have in your empire.
- Under this is a list of all your characters, showing their current locations and missions. Click on any column heading to sort your characters.
- Click any character to display details about them in the panel at screen–right.
- Double-click any character in the list to move the main view to their current location.

### Character Detail

At the right is a detailed display of the currently selected character. This shows a picture of the character at their current location. The colored symbol at the bottom-right of their picture indicates their role. This role is also displayed in written form above their name at right.

To change the name of a character, click on their name at the right of their picture and type a new name.

Below the character picture is a list of the character's traits and skills (if known). A character's natural skills (not from traits) will gradually increase in level as they are used in the game. Their progress towards their next skill level increase is shown at the right of each natural skill. To see a detailed explanation of the character's traits and skills, hover over their picture with the mouse. A tooltip will display showing the total skill levels the character has. These skill level totals include all of the bonuses from their traits.

### Transferring Characters to new locations

At the bottom of the character detail panel is a drop-down list that can be used to transfer the character to a new location. Click the button "Transfer to new location" to send them to the new location. Character transfer is not immediate – it will take some time for the character to arrive at their destination.

The transfer location drop-down list only displays typical locations for the character. To transfer them to another valid location not shown in the list, right-click the location directly in the main view and select the "Transfer Character to Location" option from the pop-up menu.

### Event History

Each character keeps a history of all the events that they have been involved with. To see this history click the "Show Event History" button. This will open a new window with a list of events at the left and detail on the currently selected event at the right.

### Dismissing Characters

To permanently remove a character from your empire, click the Dismiss button at the top of the Characters screen. This will immediately remove the character from the game.

### Intelligence Agents and Missions

You can assign intelligence missions to Intelligence Agent characters by first selecting the agent in the character list at the left of the screen. A mission assignment panel will then display at the bottom-right of the screen.

#### Assigning a mission

To assign a new mission, first select the target empire for the mission. Next select the type of mission to execute. This includes counter-intelligence missions that can continue indefinitely until cancelled.

If applicable, select a specific target for the mission. This is only valid for certain mission types, e.g. if stealing research then you can specify a particular research area to target, if sabotaging a colony then you must specify which colony, etc.

Finally, select a time allowed to complete the mission. Allowing more time means better preparation and therefore a higher chance of success.

Click the "Assign Mission" button to assign this new mission to your agent.

#### Mission Success Probability

At the top-right is an estimate indicating the probability of mission success. When probability is near 100% this means that the mission will almost definitely succeed. However this estimation does not consider any counter-intelligence efforts of the target empire. Thus it is wise to only assign missions with very high success probabilities, ideally over 85%.

## Screen_GroundCombat

You can see a detailed view of ground forces at a colony using the Ground Report screen. To access this screen, select a colony and click the Troops area in the Selection Panel.

- You can expand or collapse the size of the Ground Report screen using the arrow icon at the top-right.
- At the far left are any characters present at the colony. Next to this is the population living at the colony. To the immediate right of the population are any facilities at the colony.
- Troops are shown defending the colony, sorted by their various types (infantry, planetary defense, armored, special forces).
- During an invasion you can see an animated display of the ground battle, with invading troops landing via assault pods from the right of the screen. The relative strength of each side is shown by a colored strength bar near the top of the screen, along with a dashed red front-line.
- At the top the current strength of defenders and invaders is displayed. Any operative combat bonuses are also displayed for defenders and invaders.

## Screen_ExpansionPlanner

The Expansion Planner screen (F3) is used to identify good locations for new colonies and mining stations. From here you can send out colony ships to colonize new planets, or send out construction ships to build new mining stations.

- At the top of the screen is a list of all resources in the galaxy, along with current information on supply and demand for each resource. Clicking on the name of a resource in the list will display further details on that resource.
- In the middle of the screen is a list of potential targets for either colonization or resource exploitation. You can change what type of information is displayed here by selecting from the dropdown list. The default view is "Potential Colonies". This list can be sorted by any column and also filtered by any resource. Hover over any row with colored text for more details on the status of a potential colony or mining location.
- When a potential mining location has a critical resource for your race, then these are highlighted by a dashed yellow rectangle around the resource image.
- When a potential colonization target or resource target is selected, available colony ships or construction ships are shown in the dropdown list at the bottom of the screen. You can assign colonization or build missions to these ships by using the buttons next to the dropdown ship list.
- At the right is a galaxy map that displays the location of the selected target in the list at the left. Below this map are buttons that allow you to select the current target in the Selection Panel in the main screen, or to move to the selected target in the main view.

## Screen_BuildOrder

The Build Order screen (F9) provides an easy way to build a set of new ships in one step.

- On this screen you can see your current levels for each ship type, as well as the number of new ships suggested by your advisors.
- You can modify the amount of ships for each type, and select a specific design to build.
- When you are satisfied with the order, click the "Purchase" button to buy the new ships and begin construction.
- The ships will be built at any available space ports and colonies throughout your empire.

## Screen_QuickStart

The Quick Start screen allows you to jump directly into a preconfigured game with a minimum of setup.

- A list of preconfigured game setups are shown at the left. Selecting one of these quick starts displays the details of that game in the panel at the right. This outlines the galaxy size, your empire size and the state of the galaxy.
- You may choose to play as a specific alien race by selecting from the dropdown list at the bottom. Or simply leave this setting random to let the game decide who you should play as.
- You may also choose to disable story events from the original Distant Worlds storyline by unchecking the checkbox. This will turn off all backstory events, including debris fields, restricted zones and planet destroyer construction projects.
- Below this you can also choose to disable the Return Of The Shakturi story events and victory conditions by unchecking the checkbox.
- When you are ready, click the "Start Game" button to generate the galaxy and begin playing!

## Screen_GameOptions

You can customize game behavior by setting options in the Game Options screen (O key). This includes display and audio settings, as well as game automation and message display settings.

### Display Settings

- Here you can control the scroll speed in the main view. Move the slider to the left to make scrolling slower, move it to the right to speed up scrolling.
- You can also control the zooming speed in the main view. Move the slider to the left to make zooming slower, move it to the right to speed up zooming.
- **Star Density** controls how many stars appear in the background star field of the main view. Move the slider to the left for less stars, move to the right for more stars. Note that the background star field is purely for appearance – it has no function in the game.

### Sound Volume

The music and sound effect volumes can be increased by moving the appropriate slider to the right. To make sounds quieter, move the slider to the left.

### Auto Save

Here you can choose to have the game automatically save at specified intervals.

### Loaded Games Are Paused

Enable this if you want loaded games to start off paused. This can be useful if you have very large games that take a while to load.

### Mouse scroll-wheel behavior

Choose how the mouse scroll-wheel functions by selecting from this list:
- **No movement**: scrolling the mouse wheel does not move the main view
- **Move to selected item**: scrolling the mouse wheel will cause the main view to center on the currently selected item (if any)
- **Move to mouse cursor location**: scrolling the mouse wheel will zoom in or out from the galaxy location currently under the mouse cursor

### Automation

Here you can control which game activities are handled for you automatically. Automating various tasks allows you to focus on other parts of the game that you find more enjoyable.

For some of these activities you can ask your advisors to make suggestions, periodically recommending a course of action that you should take. Using this setting allows you to learn the strategic aspects of the game from your advisors.

Note that the Empire Policy screen also controls these automation settings, but with even finer control over how each of these game areas are handled.

The Mode dropdown list provides a set of preconfigured automation settings for playing various roles, allowing you to focus on particular areas of gameplay.

## Screen_ChangeTheme

The Change Theme screen allows you to customize your Distant Worlds experience by switching the images, names, music and settings used in the game.

The standard Distant Worlds theme is the default option. To change to another theme select it from the list and then click the "Switch Theme" button. A summary of the selected theme will be displayed in the panel at the right.

Note that this screen will display any themes stored in the Customization folder, under the root game folder. To add a new theme create a new subfolder under the Customization folder.

The following items can be customized in a theme:
- Resources
- Ship Components
- Research tech trees
- Governments
- Planetary facilities and wonders
- Fighter designs
- Ship and Base pictures
- Alien race pictures
- Troop pictures
- Empire Flag images
- Alien races
- Empire policies per race
- Predefined Characters
- Race bias settings
- Star system names
- Ship design names
- Character names
- Player ship names per type
- Dialog for each alien race
- Music
- Sound effects
- …and many, many other items

Please refer to the Distant Worlds Universe Modding Guide for further details on creating custom themes.

## Screen_AdvancedDisplaySettings

The Advanced Display Settings screen allows you to control some of the finer details of game appearance.

- The **Maximum Framerate** setting puts a limit on how many frames are displayed per second in the game. Lowering the FPS can be of benefit on older machines or laptops that might heat up because of high CPU usage.
- You may choose to turn off the display of system nebulae clouds. Doing this will improve game performance.
- Alternatively you can choose to adjust the level of detail shown in system nebulae clouds. Higher levels require faster multi-core CPUs. If you are using a single-core machine you should leave this setting at Low.
- When zoomed out to the Galaxy View, you can control which ship icons are displayed. Turning off some ship icons at this level can reduce screen clutter when your empire becomes large.

## Screen_ComponentGuide

The Component Guide shows details about the a component that your empire has researched. This panel displays the specifications of the component, including its size and technology level.

- Below this is a help link that opens a Galactopedia topic explaining the component type.
- At the bottom is a list of the strategic resources required to manufacture the component.

## GameConcepts_Research

*(Key facts from the article; the full tree tiers / areas below.)*

Research opens up new technologies for use in constructing ships and bases. It can also provide your empire with new capabilities, like colonizing new types of planets or constructing larger ships and bases.

### Research areas (tech tree tiers)

Research is divided into three different areas that each cover certain types of technology:
- **Weapons (W)**: Beam weapons, Torpedo weapons, Area weapons, Ion weapons, Phased beam weapons, Gravity weapons, Tractor Beams, Missile weapons, Bombard weapons, Fighters, Point Defense, Armor, Assault Pods, Troop upgrades
- **Energy (E)**: Shields, Engines, Hyperdrives, Reactors, Energy collectors, Resource extractors, Construction yards, Manufacturers, Damage control
- **HighTech (HT)**: All types of sensors, Combat targeting, Countermeasures, Command centers, Commerce centers, Research laboratories, Life support, Habitation modules, Docking bays, Fuel storage, Cargo storage, Troop compartments, Passenger compartments, Medical centers, Recreation centers, Colonization modules

Research advances can provide several different types of benefits:
- Completely new components that can be built into your ships and bases, giving them new capabilities
- Improvements to existing components: your ships and bases that use these improved components are automatically and immediately upgraded with enhanced capabilities. This reduces the need to retrofit your ships and bases to benefit from research breakthroughs
- New planetary facilities that can be built at your colonies
- New abilities for your empire like: colonizing new types of planets, or building larger ships and bases
- New fighter and bomber types for your carriers
- New troop types that can be recruited at your colonies

### Tech Trees

You choose which research projects you want to undertake in the Research screen (F7). Each of the three research areas has its own tech tree containing all of the research projects for that area. Click a project to queue it up for research. You can queue up as many projects as you like in a tech tree. Each project will begin immediately after its preceding project(s) are completed. Note that many projects require multiple parent projects to first be completed before they can be researched. If any of the lines leading to a project are red, then the preceding project must first be researched. Hovering over a project in the tech tree will provide further details on the project, including what prerequisites must first be met before the project can be researched.

Some research projects are limited to specific alien races – these cannot be researched by anyone else. However these techs can sometimes be obtained through other means. For example you might be able to trade this tech with a race that has it. Note though that if you obtain a tech through trade, you cannot then trade it away to another empire – you do not understand the tech well enough to explain it to someone else.

### Crash Research

To obtain research breakthroughs faster you can initiate crash research programs. This means that by spending money you can accelerate a research project 3 times faster than normal. To begin a crash research program click the currently researching project in a tech tree (i.e. the first project in the queue). A prompt will indicate the cost of the crash program and ask you to confirm the spending. Research projects in a crash program are indicated in the tech tree by a lightning bolt icon at lower right of the project.

### Research Stations

Research is performed at research labs built into your bases. Space ports have built-in research labs that are used by your scientists and engineers. But it is important to also build dedicated research facilities to maximize your research output.

You should attempt to always maintain more capacity in research facilities than your empire currently needs. This may mean building additional space ports, or more likely dedicated research stations. Specialized research stations should be built near galactic anomalies that provide research bonuses. These special bonus locations include:
- parked in orbit around Neutron stars
- inside the pulsing radiation zones of Supernovae
- on the edge of deadly Black Holes

You can find good research locations by using the "Potential Research Locations" list in the Empire Navigation Tool.

When a location has a research bonus, the research station built there may give your entire empire a boost in one of the three research areas (Weapons, Energy or HighTech). The highest bonus you have for a particular research area is used to increase your empire's entire research output for that area. Thus locations with high research bonuses are especially valuable.

### Natural Limit

As your empire grows research speed will also continue to increase in line with the strategic value of your empire. However there is a natural limit which, when reached, will cause the rate of increase in your research speed to drop off considerably. Once your empire's colonies reach a certain strategic value your research speed will not increase appreciably. This means that very large empires do not have a great advantage over medium-sized empires when it comes to research speed and access to new technologies.

## GameConcepts_Fleets

Fleets allow you to group a number of military ships together and assign missions to the entire group. This is useful for coordinating large attacks on enemy targets. Large fleets are effective for major assaults against enemy targets like colonies or spaceports. Smaller fleets (often called strike forces) are useful for intercepting enemy attacks and making small raids. Your automated fleets will respond to intercept enemy attacks when there are insufficient forces to defend the target. The nearest available automated fleet will travel to the attack location and defend the target.

### Creating a new fleet

To create a new fleet first select at least one military ship. You may also multi-select a group of military ships, either using drag-select or by shift-clicking the ships. With one or more military ships selected, do one of the following:
- Click the "New Fleet" Action button (under the Selection Panel)
- Right-click to show a pop-up menu with a "Join Fleet" menu option. This will contain a submenu item to join a "(New Fleet)"

### Assigning ships to fleets

To assign a military ship to a fleet you have three options:
- From the main screen select the ship, then click the "Join Nearest Fleet" Action button (below the Selection Panel).
- From the main screen select the ship, then right-click to show a pop-up menu with a "Join Fleet" menu option. This will contain a submenu listing all of the fleets in your empire. You also have the option to assign the ship to a new fleet.
- In the Ships and Bases screen (F11) select the ship in the master list, then select a fleet from the list at the bottom of the screen.

### Selecting fleets

There are four ways to select a fleet in the main view:
- When zoomed out to sector-level or greater your fleets appear as an inverted triangle icon. Click the fleet icon to select it.
- When zoomed in to system-level or lower, you can double-click any ship in the fleet to select the entire fleet.
- Using the Empire Navigation Tool, open the Fleets list and click the desired fleet
- Cycle all of your fleets by repeatedly pressing the F key

When a fleet is selected you can assign missions to it in the same way you would assign missions to a single ship.

### Fleet Postures

Fleets are assigned postures that define how they are used. Fleets are set to either **Attack** or **Defend**. They also have a response range set that determines how far they will respond from their home base (for Defend fleets), or how far from their attack target they will select a new target (for Attack fleets).

**Setting Posture**: To set a fleet's posture (Attack or Defend), with the fleet selected, click the Set Posture action button below the Selection Panel. This will toggle between the two settings.

**Setting Range**: To set a fleet's range, with the fleet selected, click the Set Range action button below the Selection Panel. This will cycle through the various ranges as described below.

Ranges for Attack Fleets:
- **Target**: only attack specified target
- **System**: attack specified target and then any other enemy targets in the same system
- **Nearby Systems**: attack specified target and then any other enemy targets in the nearby systems
- **Sector**: attack specified target and then any other enemy targets in the surrounding sector
- **Anywhere**: attack specified target and then any other enemy target, or if no attack target set just attack any enemy target

Ranges for Defend Fleets:
- **Target**: only defend Home Base
- **System**: defend Home Base and its system
- **Nearby Systems**: defend Home Base and nearby systems
- **Sector**: defend Home Base and surrounding sector
- **Anywhere**: defend Home Base and any other empire colonies or bases under attack, or if no home base set just defend any empire colony or base that is attacked

**Setting a Home Base**: To set a fleet's home base, with the fleet selected, click the Set Home Base action button below the Selection Panel. The mouse pointer will change to show a symbol of a colony and fleet. Then click on any valid home base in the main view to set this as the fleet's new home base. Valid bases include any space port, colony or gas mining station of your empire. If you have a military refueling agreement with another empire then you can also set your fleet's home base to be any of their space ports, colonies or gas mining stations. To clear the fleet's home base, click the Set Home Base action button, then click anywhere in empty space.

For Defend fleets, the defend area (centered on the fleet's home base, and the size of the fleet's range) is shown in the main view as a blue circle (if Fleet Postures map overlay is switched on).

**Setting an Attack Target**: To set the attack target of an Attack fleet, with the fleet selected, click the Set Attack Target action button below the Selection Panel. The mouse pointer will change to show a symbol of a fleet and targeting reticule. Then click any valid enemy target in the main view to set this as the Attack fleet's attack target. When war begins your Attack fleet will travel to this target and attack your enemy. Valid enemy attack targets include any colonies or bases of another empire. To clear the fleet's attack target, click the Set Attack Target action button, then click anywhere in empty space.

For Attack fleets, the path from the fleet's home base to its attack target is shown in the main view as a dotted red line (if Fleet Postures map overlay is switched on).

## GameConcepts_GovernmentTypes

Empires have various forms of government, each with their own characteristics. Different types of government also naturally attract and repel other types, shaping diplomatic relations throughout the galaxy.

### Government names list

The six basic government types are: **Democracy, Republic, Feudalism, Monarchy, Despotism and Military Dictatorship**. These government types are available to all empires and alien races.

Five other government types are available only to certain alien races: **Mercantile Guild, Technocracy, Hive Mind, Utopian Paradise and Corporate Nationalism**. Two other special forms of government also exist: the **Way of the Ancients** and the **Way of Darkness**. These two ancient government types must be rediscovered before they are available to an empire.

Each of these government types is explained in detail in their own topic. Refer to each of these individual topics for more details.

Each alien race has natural tendencies towards certain forms of government: more aggressive races often prefer Military Dictatorships or Despotisms; more peaceful races usually prefer Democracy or Republics.

### Advantages and Disadvantages of Government types

Each form of government may influence the following factors positively or negatively:
- **Approval**: the empire approval rating at each of your colonies can be affected positively or negatively.
- **Population Growth**: the speed of population growth at your colonies can be enhanced or slowed.
- **War Weariness**: the negative impact of prolonged wars can be alleviated or aggravated.
- **Research Speed**: the speed of research and technology breakthroughs can be increased or slowed.
- **Corruption**: the level of corruption amongst your local government officials at each colony can be reduced or increased. More corruption means lower tax revenue as corrupt officials siphon off funds for their own use.
- **Maintenance Costs**: annual costs to maintain ships, bases and troops can be higher or lower.
- **Troop Recruitment**: rate of troop recruitment at your colonies can be increased or slowed.
- **Trade Bonus**: income at your colonies can be boosted or lowered.

### Natural Affinity

Each type of government has natural friends and rivals in other specific government types. However government types are simply one of many factors that influence how empires interact with each other – empires with government types that are naturally rivals can still be friends because of other factors like trade. On the other hand empires with government types that are naturally friends can still be enemies due to other factors like disputes over systems.

## GameConcepts_Pirates

Pirates are entirely space-based factions. Pirates have a focus on survival and a tougher path for growth than a normal planetary empire. Pirates are not necessarily evil, chaotic and destructive, though they can be played that way. Pirate factions usually start with one space port orbiting a fuel-providing gas giant, several military ships, a few private ships, one construction ship and possibly one resupply ship.

If a pirate faction loses all its space ports, controlled colonies (see later), construction ships and resupply ships, it is considered to be eliminated. Often any survivors will join another pirate faction or planetary empire before this point is reached. Construction ships are a very valuable resource for pirates. Each faction has a working hyperspace-capable construction ship, but cannot immediately build more. They do however start with the technology to rapidly travel between the stars and to capture or raid for anything they may need.

### Different Playstyles

The race and Pirate playstyle selected in Game Setup greatly affect how your pirate faction will play. The playstyle is the most significant choice: each playstyle adds bonuses or penalties to various parts of the game as well as unique victory conditions.

- **Balanced**: This faction has no significant advantages or disadvantages and is able to play as any of the other playstyles, but not quite as well. If you want to try a bit of everything, this is the playstyle to choose.
- **Mercenary**: Focused on attack and defense missions. Good at capturing enemy ships and conducting raids. Can maintain a larger military fleet. Improved Weapons and Energy research, slow High Tech research. Strong hidden bases which can be built quickly and inexpensively.
- **Raider**: The most "nomadic" of the pirate playstyles. Focused on raids and ship and base capture at which they are unsurpassed. Poor smugglers. Slightly higher maintenance costs. Bonus on Weapons research, but slow High Tech research. Base building is slow and expensive.
- **Smuggler**: The most peaceful of the pirate playstyles. Focused on smuggling and trade. Weak at raids and ship and base capture. Slow to research Weapons, but bonuses to Energy and High Tech research. Fastest playstyle for taking over planets completely, very hard to remove from a planet once they have facilities there.

### Pirate Economy

The pirate economy is very different from a normal empire. Normal empires derive most of their income from taxing their colonies. Pirates do not usually own colonies directly, so cannot earn tax income. Overall pirate income is much less stable and relies on a much more active playstyle to maintain and grow.

- **Protection Agreements** are the easiest way for pirates to make money. Protection Agreements can be offered to any empire through the Diplomacy screen (F5). If they are intimidated enough, they will accept and pay you regularly to leave them alone. Between Pirate factions, these are considered truces and do not involve any payment, but can also be easily broken.
- **Controlled Colonies** represent income your faction gains through increasing its influence on a colony. This can be an independent colony or one belonging to another empire. Larger colonies in terms of population are much harder to control than smaller colonies. As pirate influence on a planet increases, the planet's corruption also increases and a portion of the planet's economy is redirected to the pirate faction. Depending on the pirate playstyle this can represent anything from an actual tribute payment to running the planetary black market.
- **Pirate Missions** give rewards for attacking or defending targets. If you complete a pirate mission successfully, your relations with the planet or empire that requested the mission increases. This will result in future missions being more lucrative. However failure will harm your relations with the requesting empire.
- **Looting Destroyed Ships or Bases** and **Scrapping Captured Ships or Bases** is income gained from the simple act of using your own ships to cause mayhem. It is entirely possible to raid a base for valuable loot and then earn more income by destroying it afterwards.
- **Smuggling and Mining** are the most peaceful sources of income for Pirates. Smuggling rewards are earned through completing Pirate Smuggling Missions. Mining is earned through the sale of resources to other factions. A great way to earn extra income is to have a good network of mines (especially for rare and in demand resources) along with enough freighters to take on smuggling missions.
- **Selling Information** is done through the Diplomacy screen (F5) and can be very lucrative, especially in the Age of Shadows where the planetary empires start off with much less knowledge and technology than the Pirate factions. Beware though: any knowledge or technology you sell may end up being used against you!
- **Resorts** are a source of income for Pirates just as they are for Empires. Build them near systems with large planetary populations and on locations with large scenery bonuses for the best results.
- **Raids** can result in direct credit income, which is reported here. Loot from raids can also be in the form of resources or research, which are reported separately in the Messages screen (H key).

### Controlling Colonies

One of the key strategies for a pirate faction is colony control. Any pirate ship from your faction, whether an explorer, an armed frigate or a peaceful smuggler, will increase your influence on a planet. Intimidation is the fastest way to increase influence, so military power in orbit works more quickly than smuggling missions, and a successful raid can result in a very significant influence increase.

As a pirate faction gains greater control over a colony, they siphon off income from the colony. The amount of income depends on the size of the population at the colony and the level of control the pirate faction has over the colony. Thus the greatest income is gained from high levels of control at colonies with large populations.

- Up to three pirate factions can have influence on any single colony, but only one can have full control.
- Influence decays over time and can only be regained by having a presence at the colony, typically by having ships nearby. If multiple pirate factions have ships near a colony, their relative strength will determine who gains influence and who loses influence, so an occasional smuggling ship will not trump the influence of an orbiting pirate fleet.
- The larger the population of a colony, the more difficult it is to fully control. Some large colonies may not be possible to fully control, so pirate factions tend to focus on small and medium population colonies where they can have more influence. Large population colonies are worth some effort though as they typically have much larger planetary incomes as well and thus reward a pirate faction with influence with more siphoned revenue than a smaller planet would.

### Hidden Pirate Bases and Fortresses

Once a pirate faction has 50% control of a colony they can build a Hidden Pirate Base planetary facility at the colony. The first faction to build a Hidden Pirate Base gains permanent control of the colony. Once a Pirate Base is built at the colony, the owning faction no longer needs to keep military ships nearby to retain control – the Pirate Base will permanently retain at least 50% control of the colony.

If a pirate faction reaches 100% control of a colony they can build a Hidden Pirate Fortress planetary facility. However they must first have a completed Pirate Base facility at the colony. Once a faction builds a Pirate Fortress they will permanently retain 100% control of the colony.

Hidden Pirate Bases and Fortresses can sometimes be destroyed during a raid by another faction. If built at a colony owned by a normal planetary empire, they can be destroyed by a ground attack. A colony owner can launch a ground attack against the Pirate Base by selecting the base in the Facilities tab of the Colonies screen and clicking the "Attack" button.

### Criminal Network

Once a pirate faction has a Pirate Fortress at a controlled colony they can then build the Criminal Network pirate wonder. The Criminal Network is a powerful criminal organization that allows a pirate faction to take full ownership of a colony, controlling it just like a standard empire. This allows the pirate faction to earn tax income from the colony. This means that the colony publicly identifies as belonging to the pirate faction. The pirate faction can then recruit troops here to invade other colonies. They can also build Colony Ships here to colonize other planets. And they can also build additional Contruction Ships here. At this point the pirate faction has become a pseudo-empire and can compete directly with normal empires.

Each colony owned by a pirate faction (instead of just controlled) adds a significant bonus to that pirate faction's victory level, above and beyond other victory conditions. The Criminal Network is the path away from a nomadic space existence and towards ultimate galactic power.

### Pirate Missions

Other empires and independent colonies can offer paid missions to pirates. These missions include smuggling resources, defending a base or colony or attacking an enemy target.

When another empire offers a pirate mission it will appear in the Pirate Missions list in the Empire Navigation Tool. To accept and carry out the mission a pirate faction must first place a bid on the mission. If other empires also bid on the same mission the price will be lowered, and other empires then have an opportunity to place an even lower bid. Eventually the bidding expires and the lowest bid gets the mission.

The assigned pirate faction must then carry out the mission within the allotted time, usually 2 years. If they sucessfully carry out the mission they are automatically paid the mission fee by the requesting empire. If they fail the mission then no fee is paid and their reputation with the requesting empire suffers.

To complete an Attack mission you must either destroy or capture the target before the mission expiry date. Completing a Defense mission means preventing an attack of any kind (destroy, capture, raid) on the target until the mission expiry date.

**Assigning Attack and Defense Missions**: To assign a pirate Attack mission, first select an enemy base. Then click the Assign Attack Mission action button underneath the Selection Panel. The new pirate Attack mission will appear in the Pirate Missions list in the Empire Navigation Tool. Pirate factions can then place bids on the mission. Assigning a pirate Defense mission is similar. First select a base or colony in your empire. Then click the Assign Defense Mission action button underneath the Selection Panel.

### Smuggling Missions

Smuggling missions can be requested for any colony. Click on the "Assign Smuggling Mission" action button underneath the Selection Panel to post the mission. You can choose to either request smuggling for all resources that are in low supply or to focus your request on a single resource. Focusing on a single resource will generally address that specific shortage much more quickly, but when there is a shortage in more than one resource, a smuggling mission for all resources will be more helpful.

Note that for smuggling missions there is no bidding – any pirate faction can simply accept the mission and begin smuggling the requested resources to the requesting colony. Every 100 units of the requested resource delivered to the colony earns credits. Note that pirate factions cannot directly control their smuggling freighters. But freighters will give priority to fulfilling accepted smuggling missions.

### Raids

Raids can be assigned to any pirate ship with assault pods. Raids can be targeted at colonies or bases. The goal of a raid is not to conquer or destroy, but to loot. The type of target influences the type of loot gained. Colonies are the most dangerous targets but also the most likely to give the largest rewards. However other locations such as mining stations and research stations (which are much easier to raid) will give more focused rewards.

Raids can damage their target. For planetary raids, the economy of the colony is damaged for some time after a raid and the happiness of the colony population is also reduced. A raid increases your influence and control over a colony more quickly than any other mechanism. But if you continue raiding a colony, the reduced economic output of the colony will also reduce your income from control of the colony. Thus you must weigh short term gain against long term gain when deciding how often to raid or whether to simply siphon income from a colony more gradually. Targets that have recently been raided will provide much less loot for repeated raids.

**How to Raid**: To raid a base or colony select a military ship or fleet with assault pods, hold down the Alt-key, and right click the enemy target.

When raiding an enemy base the raiding ships will attempt to lower the shields of the target and board it. A battle then takes place on the base between the defenders and the raiding forces. This is very similar to capturing a base. But in this case, if the boarding party defeats the defenders, instead of capturing the base the raiders simply loot it and leave.

Raiding an enemy colony is similar to an invasion. The raiding ships will approach the colony and launch assault pods. The assault pods land special Pirate Raider troops that then battle with any defending troops at the colony. If the raiders win the ground battle they then loot the colony.

## GameConcepts_Fuel

All ships require fuel to move around the galaxy. Fuel is a critical resource that allows your empire to expand.

### How fuel is used

Fuel is consumed by reactor components to generate raw energy. This energy is then used by all of the components on a ship or base that require it. This includes energy for engines and hyperdrives to move a ship. Other components that consume energy include: shields (when recharging), weapons, construction yards, and many others.

Each type of reactor consumes a particular type of fuel. **Fission and Quantum reactors consume Caslon fuel. Fusion and HyperFusion reactors consume Hydrogen fuel.**

### Refuelling

Refuelling points are locations that are willing to sell fuel to the ships in your empire. This includes all friendly space ports, colonies and gas mining stations that mine a fuel resource. This also includes independent colonies. The location of refuelling points are indicated by a blue circular icon next to the system name when zoomed out to the galaxy level.

The current movement range of the selected ship is shown by a dashed gray range circle that can be seen when zoomed out to the galaxy level. This helps you to visually gauge how far a ship can travel before it requires refuelling.

You can choose to receive warning messages when a ship is low on fuel. You can then assign a refuel mission to the ship.

When a ship runs out of fuel it will automatically switch to using it's emergency fuel supply. When using the emergency fuel supply the ship will move at one third of normal speed. The emergency fuel supply will last indefinitely, but you should refuel the ship to regain normal movement speeds.

### Energy Collectors

Bases can typically supply most of their energy needs by using energy collector components. Energy collectors generate energy from the radiation of a nearby star, reducing the need for fuels like Caslon or Hydrogen. However energy collectors only operate while stationary, so they are typically only of use on immobile bases.

## GameConcepts_Exploration

At the start of the game the galaxy is largely unknown. You only have information about a few nearby systems. You must expand your knowledge of the galaxy by sending out exploration ships. These ships chart new systems, identifying valuable resources and potential colonies. They may also encounter other empires, allowing you to conduct diplomacy with them.

### Exploration Ships and missions

Exploration Ships are purpose-built: they are fast and have powerful resource profile sensors that allow them to scan for resources at planets and moons. You can manually assign exploration missions to your exploration ships, or you can automate them so that they seek out unexplored areas on their own.

### System Visibility

Before your empire's first visit to a system, it is unexplored. You cannot see any planets or moons in the system. When you visit the system for the first time it then becomes explored – you can then always see all the planets and moons in the system. When your empire has a ship, base or colony present in a system everything in the system is visible to you, including the ships and bases of other empires. But when you have no presence in a system, you cannot see any ships or bases of other empires in the system. To indicate that you cannot directly see inside the system, the display is overlaid with a dark gray hatch pattern.

In summary, systems are displayed differently depending on whether you have explored them or not:
- **Unexplored**: only stars and gas clouds visible
- **Explored, but not currently visible**: planets and moons visible, but ships and bases not visible, displayed with gray hatching
- **Visible**: everything visible

In the main view, when the display is zoomed out to sector or galaxy level, explored systems have their name displayed next to them. Unexplored systems are unnamed.

---

## Supplementary (not in the requested list)

## Screen_GalaxyMap

*(Included because it documents the galaxy/system map UI relevant to navigation.)*

The galaxy is a vast place and it can be hard to find your way around. The Galaxy Map (G key) provides all the tools you need to find just what you're looking for:
- where to place your next colony
- where to find supplies of a rare resource
- identifying enemy colonies to attack
- steering clear of pirates

The galaxy is divided into a 10×10 grid of sectors. The boundaries for each sector are visible on the Galaxy Map as light blue lines.

The following elements are found on the galaxy map screen:
- **View filter**: at top-left you can filter what you want to see by selecting from the list. The galaxy and system maps will be immediately updated to focus on the requested items
- **Galaxy map**: the large map in the middle of the screen is the Galaxy map. All stars and gas clouds in the galaxy are shown here. The current selection is indicated by the bright blue intersecting horizontal and vertical lines. To select a star click on it – the selection will snap to the nearest star.
- **System map**: at top-right is the system map, where all planets, moons and asteroids in the currently selected system are shown. The current selection is indicated by the bright blue intersecting horizontal and vertical lines. To select a planet or moon click on it – the selection will snap to the nearest planet or moon.
- **Selection summary**: at middle-right is a summary of the current selection
- **Surface image**: at bottom-right is an image of the currently selected planetary surface
