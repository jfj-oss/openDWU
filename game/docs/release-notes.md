# Release notes

Notes for the next release, to copy into the GitHub release (RELEASING.md step 2).

## Unreleased

- **Ancient Guardians keep their name:** themed empire names no longer rename the story empires — the Ancient Guardians
  (and the Shakturi / Erutkah Refugees) are always called what the original calls them.
- **Fix: no Mechanoid / Shakturi natives outside the story:** a player who picks one of these story races no longer finds independent colonies of that race next to their start (they were seeded in the player race's region, e.g. "Utopia 2"); those natives are now a normal race. Normal-race games are unchanged.
- **Backdrop animation now visible:** the animated dust, glow cells and godrays of the Deep galaxy backdrops moved too
  little to notice. The moving layer now carries more of the dust, runs 2.5x faster, and has brighter, more frequent
  glows and stronger godrays; stars stay brighter than the dust. "Animate backdrop" was already on by default.
- **Slower hyperdrive (new gameplay change, off by default):** a "Gameplay changes" checkbox, "Slower hyperdrive ×" with
  a number box (1–10, default 3): every ship's hyperdrive takes that many times as long to spool up before a jump, for
  all empires, pirates and the player. Interdicted ships spool 5× the original in total. Jumps themselves are unchanged.
- **Gameplay changes are all off by default** (Longer ground battles was ticked for new games in 0.1.30). The
  "Gameplay changes" heading is now a switch that turns them all on (except Slower hyperdrive) or all off.
- **Rendering:** the engine flame of a ship in a hyperjump no longer disappears or flickers when you zoom in on it with the follow camera (the flame is drawn at full length at warp speed and no longer culled on the ship's pre-warp position).
- **Galaxy Map:** double-clicking a planet in the system picture selects it and shows it in the info panel, as in the original.
- **Crash reports:** the desktop app now sends crash reports (error, stack, app version, OS, graphics card; no IP address, saves or personal files, and your user name and home folder are replaced by "~") to Sentry to help fix bugs. It has no setting.
- **More crash-report data:** in about 1 % of sessions the app sends a once-a-minute performance summary (average fps, slowest frames and sim tick, galaxy size, graphics card); a multiplayer desync sends the frame, the two checksums and the differing parts (no save). New **Report a Bug** button in the Esc menu: you write what happened and it sends that with a screenshot of the game, the recent log, your version and graphics card, but no saved games.
- **UI polish:** column headers shrink to fit before they are cut off, hot-key and Bacon Mod Settings descriptions wrap in full, the new-game track bar caption clears its tick label, the credits roll is clipped to its window, and aborted help-page loads and the optional BaconSettings.txt no longer log errors on stock installs.

- **Anonymous usage statistics** (Aptabase, EU): the desktop app now sends app version/OS/graphics vendor and the setup of games you start or load (no names, paths or saves), minutes played, and which screens were opened. See the README's Privacy section. It has no setting.
- **Automatic updates** for the Windows setup (.exe) and the Linux AppImage: the new version downloads in the background (checked against the release's .sha256, paused while a multiplayer game runs) and installs when you quit; a one-line notice tells you it is ready, and Check for Updates offers Restart now. macOS, the Windows zip and the Linux tar.gz keep the Download offer. `"checkForUpdates": false` still turns it all off.

## 0.1.30

- **Game menu:** "Save Game As" is gone — Save Game opens the same save window, where you can type a new name.
- **Layout fixes from a full UI audit** (docs/windows-ui-audit.md): the Local model window's Test / Apply buttons are
  inside the window again, the Research screen's instructions no longer run into the tabs, the Improvements
  descriptions and the wizard's galaxy-shape description are no longer cut off.
- **New games start again** when the sim runs in its own process / worker (the default): an import-order bug in the
  Orbital superiority add-on stopped the sim from starting ("Cannot access 'ORBITAL_SUPERIORITY_FLAG' before
  initialization").
- **Hot seat hidden:** the new-game wizard no longer offers "Human Players..." (several humans sharing one PC); LAN and
  Internet multiplayer are unchanged. A hot-seat list remembered from older settings is dropped.
- **Fullscreen** is now a checkbox in Game Options → Display Settings (remembered between launches); F11, Alt+Enter and
  Ctrl+F toggle it too (laptop F11 keys often need Fn).
- **Graphics:** Game Options shows which GPU the game runs on ("Graphics: NVIDIA GeForce RTX 5080 (D3D11)"), or says so
  when it runs without WebGL; the desktop app prefers the high-performance GPU on hybrid PCs, ignores Chromium's GPU
  blocklist on Windows and writes what it got to gpu-log.txt. Without WebGL the orbit rings no longer wash the whole
  system view out.
- **Blank map after a GPU reset fixed:** if the graphics driver resets and the map's WebGL context does not come back,
  the game now rebuilds the map by itself (no more save and reload); Chromium no longer blocks WebGL for the game after
  GPU crashes, and the losses are logged in crash-log.txt.
- **Colony plates on the map:** zoomed right in, populated colonies show the original's plate: name in the empire's
  colour (capital icon), race, population / development bars and known resources.
- **Double-click the selection panel** to open the selection's screen, as in the original: your colony → Colonies,
  another planet → Galaxy Map, a ship or base → Ships and Bases, your fleet → Fleets.
- **No more white text backgrounds:** dark empire names in the Diplomacy list no longer get the white 1 px shadow that
  read as a white box behind them (the selection panel had the same fix); a double-click or drag no longer paints the browser's selection highlight behind
  panel text (selection panel, Diplomacy, ...), and unstyled form controls are dark everywhere.
- **Windows / stock installs: the right font and the missing pictures.** The game's font (Forgotten Futurist) and the
  pictures the original keeps inside DistantWorlds.exe (the new-game wizard's Playstyle buttons and page pictures, the
  map zoom buttons, the game-menu header, the expansion planner picture) were read from a folder only the developer's
  install had, so on a normal install every window used Arial (much wider: text overflowed and overlapped everywhere)
  and those pictures were blank. Both now ship with the game. Verdana text falls back to DejaVu Sans where Verdana is
  not installed (Linux).
- **Mothballing (new Gameplay change, off by default; Other Empires page):** put a fleet or warship into reserve at
  one of your space ports — the selection panel's **Mothball** button (also on the Fleets screen and the Ships and Bases
  screen) picks the safest interior port with room; right-click lists every port with distance, ETA and ships in
  reserve against its capacity (6 / 12 / 24 for small / medium / large ports). The ships park in even rings around the port, facing it, drawn greyer while in reserve
  at 15% upkeep — immobile, weapons cold, ignored by automation, the AI and Intercept / Defend; a fleet stays the same
  fleet. **Reactivate** takes 240 days for a mid-sized ship (120–480 by size) at full upkeep. A reserve is vulnerable: a
  destroyed port forces an emergency reactivation, a captured port takes the reserve ships with it. AI empires mothball
  up to 30% of their navy after 5 years of peace on a tight budget, reactivate at the first war warning, and see a
  mothballed rival as weaker. Every number is a parameter.
- **Threats & Leads (Characters / Intelligence screen):** with any Galactic Threat add-on or Internal Security on, a
  **Threats & Leads** button under the Galactopedia link switches the screen to a list of every threat site and
  security lead your empire knows: what it is, where, suspected or confirmed, when it was found and what is being done.
  **Go to** (or a double-click) centres the map on it; **Investigate** puts one of your idle or counter-intelligence
  agents on a suspected site for about three months — it now works without Internal Security too, and a successful
  investigation confirms the site. With Internal Security on, confirmed leads also offer its arrest / exile / purge /
  amnesty / quarantine / martial law / recall fleet / scrap ship actions here. The separate Internal Security window
  and its link are gone (everything it did is in this section).
- **Fewer add-on menus:** the Interstellar Diet is no longer in the top bar's ••• menu (open it from the Diplomacy
  screen's Diet block). `docs/addon-ui-inventory.md` lists every add-on window, tab, link and HUD extra with the merges
  proposed next.
- **Diplomacy screen firepower (also wrong in the original):** the figure dropped a whole warship as soon as its engines
  were knocked out or any component was unbuilt, so a battered fleet read as a fraction of itself. The empire panel now
  has a live **Firepower** row (and pirates show "operational firepower") counting every finished warship at the weapons
  it has working right now; ships in construction or refit stay out. It refreshes every second. Display only; the AI's
  own figures are unchanged.
- **Return of the Shakturi can no longer stall (also true of the original):** the Beacon of Shaktur is now placed by the
  forced date plus ten years even if the Ancient Guardians were never met (from your position, as the original's
  fallback does); a Beacon nobody explores is marked on your charts and later investigated by the nearest AI empire; a
  Beacon is no longer used up when no start world for the Shakturi can be found (it stays for the next try); and with the
  Guardians gone, the invasion starts 12 years after the Shakturi enrage, aimed at your capital. Games where the story
  already runs are unchanged.
- **Local model fix (desktop app):** Ollama refused every request from the app (it rejects the app's `dwu://` page
  origin with 403), so Refresh, Test and all local-model features failed unless `OLLAMA_ORIGINS` was set. The app now
  allows its requests to model servers on this machine (localhost only); no Ollama setup is needed.
- **Fighting retreats (new gameplay change, off by default; Other Empires page):** a fleet that notices the fight has
  turned against it (less firepower than the enemies it is fighting, for 5 seconds) withdraws together to the nearest
  friendly repair point, then resumes its duties (automated) or waits for orders ("3rd Fleet withdrew from Sol to repair
  at …"). AI fleets follow the same rule; ships keep the original's per-design Flee setting, and a fleet set to Flee:
  never fights on. The numbers are add-on parameters.
- **Intercept (new command):** select a ship, fleet, base or space creature that is not yours and an **Intercept**
  button (crosshair) appears in a free slot of the selection panel's action buttons; its hover message names the force
  it sends, e.g. "Intercept: 1st Fleet (ETA 101 d)" — the best free fleet (or, failing one, a single warship) strong
  enough to win (1.5× its strength), in fuel range, weighing travel time, spare strength (the smallest force that will
  do), fuel and damage. Right-click the button to pick another eligible force (listed in score order) or to select the
  chosen one. A moving target is met where it is going (its course and hyperjump are predicted, re-checked every few
  seconds) instead of chased from behind; in range the force attacks as normal. The order ends when the target is
  destroyed, or after the force reaches the last known point of a target it lost sight of. Empires only at war;
  pirates unless you have an agreement. When no force can go, the button is greyed and its hover message says why.
- **Defend (new command):** with a star system selected, a **Defend** button (shield) sends the best free force (strong
  enough for the hostiles you can see there) to patrol the system; right-click works the same way.
- **Watch system (new fleet toggle):** for your own fleet a **Watch <system>** button (eye; in the More menu when all
  eight action slots are taken, as they usually are for a fleet): with the fleet's automation off it stays there defending it, flies off
  to the best refuel point when low on fuel and comes back by itself. The selection panel shows "Watching <system>"; a
  new order to the fleet or turning its automation on ends the watch.
- **Orbital superiority (new gameplay change, off by default):** a "Gameplay changes" checkbox on the new game's Other
  Empires page (also in openDWU Classic). During a ground invasion, who holds the orbit decides more than the original's
  flat +25%: attackers holding it get +50%; a contested orbit costs the invaders -35% to -50% and a little strength
  every day ("Supply lines disrupted"); a defender-held orbit costs them -50%, heavier losses and any further landings
  ("Supply lines cut"). AI empires invade where they can hold the orbit, keep troops aboard until they do, keep their
  fleet over the planet, send relief fleets to invaded colonies and withdraw from orbits they cannot win.
- **Defensive jump interdiction (new gameplay change, off by default):** a third "Gameplay changes" checkbox on the new
  game's Other Empires page (also in openDWU Classic). Armed defensive bases and space ports project an interdiction
  field (4,000 to 6,000 units with their firepower): enemy ships starting a hyperjump inside it spool five times as long
  as in the original (in total, also with the slower spool) before they can jump out, unless they cruise out of the field first. Jumping in is unchanged. The ship's panel shows
  "Interdicted by <base>", a base's panel its field. Pirates raid defended systems only with fleets strong enough to
  kill the bases first; AI empires at war favour a defensive base at the border colony facing the enemy; their strikes and invasions are unchanged.
  ("Supply lines cut"). AI empires fight for the orbit when they (with the fleets they can gather) at least match the
  defenders there, keep their troops aboard while they are losing it, send more fleets while it is undecided, send relief
  fleets to their invaded colonies and withdraw only from orbits they cannot match.
- **Longer ground battles (new gameplay change, on by default for new games):** a second "Gameplay changes" checkbox,
  "Longer ground battles (2×)": ground battles take twice as long (both sides lose troops at half the rate); who wins is
  decided as before. Untick it for the original pace.
- **Blockades that bite (new gameplay change, off by default):** a third "Gameplay changes" checkbox (also in openDWU
  Classic). A colony whose orbit is held by an enemy at war with it (more than 1.5 times the owner's armed ships and bases
  within 2,000, the Orbital superiority measure; or by an empire that declared a blockade of it) is blockaded: it loses
  the trade half of its taxes, its space ports earn no trade income, construction and population growth there stop and
  its approval falls slowly (0.1 a day, at most 15). It ends when the orbit is free; both sides get a message, and the
  colony panel shows "Blockaded by X". AI empires blockade their enemies' richest colonies before invading and send
  their nearest strong enough fleet to break a blockade of their own.
- **Galaxy Backdrop picker:** new **Dimmed Original** (the original's colours, darkened halfway toward Deep, faint grey
  dust), **Deep Azure** (navy and steel-blue dust, teal accents), **Deep Ember** (crimson and ember dust, the odd dull
  gold) and **Deep Violet** (purple and magenta dust, blue accents), all built like Deep from the original image. Galactic
  Core, Golden Spiral, Eerie and Nebula are gone (saves and settings with them load as Deep), and so is the Storm flashes
  option. The 2D galaxy maps and the picker thumbnails now show the Deep-style backdrops too.
- **Influence borders:** where two empires meet, only the darker empire's side gets the dark band (the "Both darker"
  option is gone; that setting loads as Darker side).
- **Galactopedia:** clicking an open group's header closes it again.
- **Empire colours in big galaxies:** with more than 20 empires your own colour (standard or custom) is kept exactly,
  no other empire gets a colour close to it, and up to 101 empires now get distinct colours (100 extra colours, was 40).
- **Colony Defence add-on withdrawn:** pirate control of colonies works as in the original again. The add-on is no longer
  in the picker or the Living Galaxy preset; saves that use it still load.

## 0.1.29

- **Multiplayer host wizard fix:** Game Settings from the host lobby (LAN or Internet) opened the new-game wizard behind the
  multiplayer screen, so nothing in it could be clicked; the multiplayer screen now properly hides while the wizard is open.
- **Multiplayer menus:** the Host / Join screen now uses the stock glass buttons, window colours and HUD scale, shows one section
  at a time with a single highlighted main action, and takes Enter (main action) and Esc (back); the invite-code dialog too.

- **Update check on every launch:** the desktop app now asks GitHub for a newer release each time it opens (it was at
  most once a day). "Skip This Version" and the checkForUpdates switch in config.json still apply.
- **AI rulers remember negotiations:** with the diary on, an AI ruler now notes a fair deal, a generous offer or an insulting offer from you (refusals leave no trace).
- **Add-on picker:** the new threats, Privateers, Characters, Diet & Victory, the Voidbloom War, Slavery and War Crimes
  are now Recommended; the Work in progress section is folded until you open it (or one of its add-ons is ticked).
- **The local model layer brings in war goals:** switching on the Local LLM Layer now also switches on Lively Galaxy's War goals & peace terms (the peace talks need them) and nothing else of Lively Galaxy unless you tick it; in the add-on settings that option shows as required.
- **Add-on picker reorganised:** a "Recommended" section on top and a "Work in progress" section below (WIP rows carry a tag and a hover reason), each keeping the topic groups. The Event Log is now part of the base game in every new game (no row; it no longer pulls in Internal Security). The Galactic Council is no longer a row: it runs inside Characters, Diet & Victory (renamed) and follows its Interstellar Diet option.
- **Real diplomatic negotiation (new `llmNegotiation` option of the Local LLM Layer add-on):** a Speak freely box on the Diplomacy screen turns your words into a legal proposal card (trade items, money, and treaties such as free trade or a mutual defence pact, now tradeable as part of a package), the game's own trade code decides, and a refusal comes with up to 3 counter-offers (also on the trade screen, no model needed); between human players your words go with the offer. Off by default.
- **Local model settings window:** Game Options, Local model... has endpoint presets for Ollama / LM Studio / llama-server, a list of the installed models, a Thinking switch (forced off on OpenAI-compatible servers too) and a Test button.
- **Rulers' memory turns Reputation on:** switching on the Local LLM Layer's rulers' memory option now also switches on the Reputation add-on and its ledger, which the attitude nudge needs (add-on options can now name the add-ons they need).
- **Rulers' memory (new `llmMemory` option of the Local LLM Layer add-on):** each AI ruler keeps a short dated diary of what other empires did to or for them (wars, peace, treaties, gifts, colonies, pirates driven off); the lines and a mood word feed the model prompts, and a small capped, fading attitude nudge (only for things the original game does not already count; turns the Reputation ledger on) follows. Off by default.
- **openDWU Classic (second edition per platform):** base game + Bacon + our base-game changes + the new-game wizard, with only Themed Names (always on), Smarter AI (the Other Empires page) and the Event Log (always on, Galactic History). No add-on picker. Own app id and profile folder, so it installs next to the full openDWU; it can host or join multiplayer games with the full edition when the game uses only those add-ons. A save that needs other add-ons says "This save needs add-ons from the full edition".
- **Big-galaxy colours are built in:** with more than 20 empires the extended 40-colour palette is used automatically (display only, nothing in the simulation changes); the Big Galaxies add-on is gone from the picker (old saves that have it still load).
- **Peace talks in plain words:** with the local model on, the peace-terms panel has a words box ("give me Kygnos and 2,000 a year for five years") that fills in the real terms for you to edit and offer, a live line saying whether the other empire would accept, and offers of peace come with a voiced cover letter. Without a model the panel works as before.
- **LLM multiplayer fixes:** with several humans, each empire's strategic moves are no longer repeated twice in a year, the
  AI's strategic planning runs on the host only, and peace terms offered to a human now raise a decision for them to answer.
- **War objectives scale with galaxy size:** an empire at war now looks for enemy colonies and bases to capture within a
  range that grows with the galaxy past the biggest stock size (15 sectors): the original 1.5 / 1.0 sectors become about
  4.4 / 2.9 at 26 sectors and about 8 / 5.3 at 40. Stock-size galaxies are unchanged.
- **Potential Colonies shows future sites:** the Galaxy Map's Potential Colonies view and the map overlay now also show habitable planets you cannot colonise yet. They are drawn in blue (a dashed ring on the map), say which colonisation technology they need, and help you plan your research. Yellow still means colonisable now; colony ship targeting is unchanged.
- **Colony link lines:** the lines joining an empire's systems on the galaxy map. With the new influence borders on they are
  thick, pale, slightly faded dashes with rounded ends, 5 px wide on screen, static (the travelling pulses are gone), and
  they keep their screen size while you zoom in; zoomed far out past the galaxy scale they shrink with the map (to 30% at
  most) so they don't swamp it. With the new borders off they stay the classic thin 1 px dashed lines, now antialiased with
  no stair-stepping on near-vertical links.
- **Shared border edges:** with influence borders on, where two empires' regions touch, each side gets a darker edge of its
  own colour: thin continuous bands (about 3 screen px) that sit side by side on the shared line. Game Options ->
  Advanced Display -> Map Display -> Shared border edges: Both darker / Darker only (only the darker empire's edge) / Off.
- **Galaxy nebula clouds:** the galaxy map draws its nebula clouds from the original nebula art again. On the Original
  backdrop they have the original's lighter grey patches; on Deep they show as faint smoke. Switching backdrop mid-game
  updates them.
- **Galaxy backdrops centred:** the backdrop structure is centred and scaled on the galaxy's own layout, so it sits
  behind the map rather than at a fixed spot.
- **Map markers:** the Waypoints & Known Locations overlay and the minimap no longer mark black holes (their Pull and Event
  Horizon, the wormholes and gravity wells), supernovas, or the location hints that point at them. The remaining
  known-location diamonds are light purple and a little smaller.
- **Treasure fleet beacon:** the galaxy map's ring around the Concord treasure fleet is smaller, thinner and dark purple,
  a little stronger, with a soft fading halo, so it no longer dominates the map.
- **VIP shuttle rings:** the rings around VIP shuttles are a thin, translucent dark orange and stay smooth at maximum zoom.
- **VIP shuttles:** no crash when the trip shuttles cannot be named, and a VIP trip is never started in a read-only galaxy.
- **Follow camera while warping:** the followed ship stays visible when zoomed in, even mid-warp, and its hyperjump flash
  is drawn where the ship is shown. The camera's motion is steadier when the simulation delivers its steps in bursts.
- **Main menu Multiplayer buttons:** on hover, focus or press they get the stock treatment: a teal band that fades in from
  the left, with a gold label (no planet icon). Their letters have a soft edge like the stock art instead of a halo, and the
  multiplayer submenu's Resume Multiplayer Game is just Resume.
- **Selection panel buttons:** the eight icon buttons under the selection panel look and behave like the original again:
  original glass colours, icon-only with the build count centred, and the hint shown as the yellow message above the panel
  (disabled buttons too) instead of a tooltip. The mercenary smuggling icon is fixed, and our own extras (fleet settings,
  dispatch orders, charter) sit behind a "More" button left of the strip.
- **Build buttons:** a build button whose yard lacks resources the design needs shows the original warning overlay (the
  exclamation icon beside the ship), and its hint gains " (RESOURCE SHORTAGE: <resources>)".
- **Station orders give feedback at once:** ordering a station or base from the selection panel (or the More menu's dispatch
  build slots) shows "Construction queued: <design> at <planet>" immediately, with a pending "Awaiting construction ship" row
  in the Build Queue and Construction Yards job lists until the job is on the board. The job only starts building when a
  construction ship arrives, which can be a long trip in a late-game galaxy.
- **Playable Mechanoid and Shakturi:** the new-game wizard (and the multiplayer and hot-seat race pickers) now offer the
  Mechanoid and Shakturi races for your own empire. AI empires still never get them, and the story's Ancient Guardians and
  Shakturi lookups skip your empire, so it is never mistaken for or absorbed as the Guardians.
- **Galactopedia:** the Mechanoid and Shakturi race pages say they are playable for the player, and the Emperor bid article
  is rewritten for the year-65 rules and the locked uprising.
- **Robot Mutiny rework:** the Broadcast's beacon fleet is sized to the strongest normal empire's military: about 1.3 times
  its firepower in the first year, rising 0.1 times a year (to 1.8 times) while the transmitter stands, with losses
  replaced and nothing more. At the rising every BattleBot garrison defects at tech level 5 and is at war with everyone
  for good. Usually it takes an eighth of the Ancient Guardians' fleet, 30 troop transports and three founded worlds, and
  attacks the weakest-garrisoned colonies near the transmitter. One time in five it absorbs the whole of the Ancient
  Guardians and turtles: it defends its worlds and sends no fleets beyond them.
- **Diet enforcers never hold a colony:** the Interstellar Diet's enforcers cannot capture, colonise or peacefully take over
  a colony, and in saves made before this a colony they held goes to the independents.
- **Emperor bids are a late-game endgame:** the Interstellar Diet's Emperor bid cannot start before year 65. AI Regents bid
  only when overwhelmingly ahead (2.5x the next empire's score, 40% of the galaxy) and then only rarely. When any empire
  bids, nearly every other major empire declares a locked war on it; the bidder must hold its capital for 10 years to win (a failed bid ends the wars' lock). The Diet screen shows
  the countdown, and the yearly ticker keeps count.
- **Emperor bid uprising:** when an Emperor bid starts, the uprising empires' idle attack fleets are refuelled and sent
  straight at the bidder's nearest colony, and re-sent every 10 days, instead of sitting out of range.
- **VIP shuttle crash fix:** a VIP trip could crash the game while naming its shuttle when it was started from a read of the
  game outside a sim update; such reads now never start a trip. Nothing changes in a normal game.

## 0.1.28

- **Diet notifications:** every motion and every result (with the tally) now reaches the message log and ticker, also for
  empires outside the Diet; results that hit you or your allies, and major ones, pop up.

## 0.1.27

- **VIP shuttles say who they carry:** "VIP Shuttle — <name>, <role>" (Governor of <colony>, Diet delegate, Leader,
  Admiral, …) on the map and in the selection panel. The ruler's decoys carry the same label as the real one.

## 0.1.26

- **Interstellar Diet: History tab** listing the motions passed, by year (who proposed them, the vote and the target), with
  an option to also show failed and vetoed motions.

## 0.1.25

- **Fix:** construction ships arriving in their build system no longer get sent back out to the edge of the star's
  gravity well (they turned back towards home instead of building).

## 0.1.24

- **Resource Crises fully switched off,** including in saves that had it on: no more depleting deposits ("resources
  being drained") and no more "Shortages" unrest from it.

## 0.1.23

- **Fix: colonies at −70 approval from "Shortages".** Resource Crises was still switched on behind the scenes by Internal
  Security and Reputation (Politics & Characters). They no longer include it, and its shortage penalty is now capped at
  −12, which also fixes existing saves.

## 0.1.22

- **Resource Crises withdrawn:** removed from the add-on picker and the Economy expansion, because its approval loss per
  missing luxury could stack far too high. Saves that already use it still load.

## 0.1.21

- **Fix:** removed the influence-border edge shading added in 0.1.20, which could crash the game.

## 0.1.20

- **Notifications volume:** a new slider in Options → Sound Volume for the message and alert sounds (new message,
  event, alarm), on top of Effects.
- **Influence borders:** empire names in a serif font (Source Serif 4, bundled), and each region darkens softly
  towards its edges.

## 0.1.19

- **The treasure fleet no longer gives away the Concord's homeworld.** Until you have met the Concord it follows normal
  fog of war: no map marker, route or selection lines for systems you haven't explored, and no treasure-fleet news
  naming its home. After contact it behaves as before.

## 0.1.18

- **Construction ships no longer die at black holes.** Builds there used the star's centre instead of the safe parking
  point, and ships came out of hyperspace inside the pull; both are fixed.
- **Construction priority list** on the Build Order screen (F9): rank research and resort bases, mining stations and
  everything else for your automated construction ships (new games default to that order; "Original order" restores
  the stock one).
- **Fewer map markers:** black holes and supernovae are only marked when they carry a real research or scenery bonus.
- **Slavery is now a standalone add-on.** Off, the original game's enslavement works exactly as before; on, it takes over
  the stock Enslave policy and penal colonies with output up to 6× and tax up to 2× by staffing, garrisons, revolts and
  labour convoys.
- **Rim Atmosphere's galaxy-map haze fixed:** it no longer shows as a tilted square past the map edge; it is now dark,
  soft storm clouds that fill the rim to the map's edges.

## 0.1.17

### The Voidbloom War (new add-on in The Rim)

- An Opium-War-style arc around the Oranthi Concord. Voidbloom, a narcotic spore, grows only on deadly rim worlds worked
  by forced labour and held down by garrisons, and is smuggled into the Concord's closed market. Addiction spreads, the
  Concord's treasury bleeds and its commissioner cracks down with blockades, raids, burned fields, freed workers,
  freighter hunts and occupations. Tolerate it or go to war: a late war can end in an unequal treaty (ceded worlds,
  indemnities, treaty ports, legal Voidbloom), followed by one of five aftermaths. The Interstellar Diet can ban it,
  sanction either side or force the Concord's ports open.

### The Rim

- **A wild rim:** the AI rarely settles it, its planets are poorer, rim pirates are many and strong, and derelict
  high-tech warships wait to be claimed.
- **Concord patrols** around its colonies and stations, escorts for its construction ships, new listening posts.
- **Faster, deadlier creatures** that can catch ships, and about 2.5× more wildlife in the rim.
- **Rim Herders** earn money from their goods plus a small yearly stipend.
- **Ordinary empires no longer start inside the rim**, and that check no longer stalls "Founding empires".

### Galactic Threats

- **Generation Ships:** an early-game crisis. A world ship and a fleet about 1.3× its target's strength arrive at the
  galaxy edge, make contact and, 18 months later, demand a world: Pilgrims, Heirs, Ark Faith or the silent Quiet Ship.
- **Archive Cores:** lost tech to study (four yearly boosts) or seal for one large payoff.
- **The Dead Probe Swarm:** self-replicating machines that mine outward from their Mothercore and attack any ship in
  their systems, shown as a dark-brown presence on the map.

### Dark themes

- **Slavery:** penal colonies worked by enslaved peoples, with output up to 6× and tax up to 2× by staffing, at the price
  of garrisons, revolts and reputation; AI use depends on species and government.
- **Scorched earth** (Living Galaxy) and **War crimes remembered** (Politics & Characters) add-ons.

### Map, look and menus

- **Deep (DW2-style) backdrop,** the new default for new games: the original image darkened, with slowly drifting rust and
  teal dust, glows and faint godrays.
- **Influence borders** (Advanced Display Settings): angular empire regions from colonies and stations, optional empire
  names, and pulses flowing out from each capital along the link lines.
- **One Multiplayer entry** on the main menu, with Host, Join and Resume inside.
- The Diet map icon stays sharp at any zoom.

### Options

- **Arrival** (new-game wizard): Early / Normal / Late for the Return of the Shakturi refugees.
- **Auto-rebuild lost ships / stations** on the Build Order screen (off by default).

### Multiplayer

- **Join a game in progress.** A new player can join a running LAN or Internet game: the host offers a free empire and
  you take control at the next frame.
- **Multiplayer saves and Resume.** Multiplayer saves are marked in the load list (with a "Multiplayer saves only"
  filter), and "Resume Multiplayer Game" on the main menu reopens the lobby on the save; players get their empires
  back. The last 100 chat lines are saved with the game.
- **Host migration.** If the host leaves or crashes, the next player takes over without a restart, and the old host can
  rejoin. Two-player games wait with Reconnect / Take Over instead of playing on alone.
- **Host on the Internet, join by code.** Invite and reply codes connect players directly (WebRTC, no server).
- **Diplomacy and chat with other humans.** Offers to another human can be accepted, rejected, countered or withdrawn
  ("Your offers"). Chat in the lobby and in game, with mute per player.
- **Pop-ups no longer pause the game** for everyone in a LAN or Internet game (single player and hot seat unchanged).
- **Deeper sync check** that names the part of the game that went out of sync and resyncs once.
- **Compact multiplayer status row** beside the selection panel; the full status shows on hover or click.

### Expansions and add-ons

- **Expansions.** The add-on picker groups the add-ons into five expansions with one switch each: The Rim, Politics &
  Characters, Economy, Galactic Threats and Living Galaxy. Each has an About fold with "Changes" and "Difficulty"
  meters, and a Galactopedia article with a field guide (64 new articles on the creatures, factions, goods, ships and
  mechanics they add). Individual add-ons can still be switched under "Advanced".
- **Calmer add-on UI.** Add-on screens match the stock look, and only big moments pop up (a new Message Settings box);
  the rest goes to the message log.
- **Characters & Victory.** VIP shuttles carry characters between worlds, with escorts. Every colony has a governor; a
  vacant post has a one-year grace.
- **The Interstellar Diet** (Galactic Council): sessions at a host world, delegates who travel there, weighted votes,
  enforcer blockades, a Regent and Emperor bids. Opened from Diplomacy or the top bar's ••• menu. The Ancient
  Guardians are not members.
- **Frontier Autonomy** no longer switches on Court & Dynasties.

### Colony Economy

- **Colony designations** (Mining Hub, Core World, …) with private facilities (42 in all), bonds, a colony Economy tab,
  a Designation column in the Colonies list and badges on the map and in the selection panel.
- **The refinement chain.** Refineries turn raw resources into refined goods that ships need, more of them the higher
  the component tech: missing goods slow builds at tech 3–4 and stop them at tech 5+. Refinery-only slots, a Fund
  button to pay for a refinery from the treasury, supply alerts, and a Precision Components good for the top tier.

### The Rim

- **Rim Trade.** The treasure fleet keeps calling at ports until its holds are empty, its route shows when you select
  it, its escort is smaller, and rare goods cost less standing. You can request a stop.
- **Rim Herders.** Herds regrow, mature and stampede; herders can become protectorates and pay tribute; their standing
  is capped and fades; AI conquest stages its troops first; herder colonies can't be taken over peacefully.
- **New fauna.** A hull grazer that rides on ships until it's shot off or scraped at a port, void whales that roam the
  whole galaxy, and wildlife that recovers over time.
- **Rim Atmosphere** only shows once you zoom halfway to a system (never at galaxy view), adds faint wind in rim
  systems, and gives the rim on the galaxy map a slowly drifting dust haze.
- **Ordinary empires no longer start inside the rim** when a Rim add-on is on.

### Music & Mood

- Options → Sound Volume → **Music & Mood...**: a background mood (Off by default, **Rim only**, or the new **Deep
  Space** bed: sparse wind, an underwater rumble and the odd distant creature call or hull creak, synthesised, everywhere
  in the game) and the music source (**Original**, **Off** or **your own playlists** with Shuffle and Next Track). The
  desktop app reads playlists from a `Music` folder next to your saves (one subfolder per playlist; mp3, ogg, flac,
  wav, m4a/aac). See the README's "Music & mood".

### Game rules

- **Attacking an independent colony** now costs reputation and angers the territory owner, as in the original game.

### Fixes

- **Saves** made with some add-on combinations now reload exactly (a −0 value was saved differently).
- **Destroyed or scrapped private ships** no longer linger in their owner's lists.
- **An invasion of a colony with no defender** no longer crashes the game.
- **Camera:** no more repeated "reading 'NaN'" render error.
- **Sector grid lines** on the galaxy map are fainter.
- **Autosave** runs one save at a time; **range rings** draw only on screen (fixes a late-game out-of-memory crash);
  **restarts** no longer keep the old game running; **espionage** no longer crashes when an agent has no empire.

### Compatibility

- **Leaner, faster saves.** Saves use a new compact format (save format 3): the same late-game galaxy is about a third
  of the text (449 MB → 152 MB; 42 MB → 34 MB compressed), saves about twice as fast and loads with about half the
  memory. Every older save and `.dwusave` file still loads exactly as before; saves made with this version cannot be
  opened by older versions (0.1.15 and earlier).
- **Multiplayer needs the same version** of the app on every machine. Windows, Mac and Linux are bit-identical.

## 0.1.15

- **Galaxy Backdrop picker.** New-game wizard (galaxy page) and Game Options → Advanced Display Settings. Choose
  Original (the game's own image, default), **Golden Spiral**, **Galactic Core**, **Nebula** or **Eerie**. The new
  backdrops are generated from your galaxy's own star layout, animate slowly, and can show storm flashes. Both can be
  switched off ("Animate backdrop", "Storm flashes"). The choice is saved with the game.
- **Sector grid like the original.** Faint grid lines at full zoom-out and A/B/C… / 1/2/3… sector labels along the map
  edges.
- **Saves are compressed.** In-game saves, autosaves and exported `.dwusave` files are now gzip-compressed: a late-game
  save of 450 MB takes about 45 MB. The save itself is unchanged inside; it loads as before.
- **Compatibility:** saves made with this version (including exported `.dwusave` files) **cannot be opened by older
  versions of the app**. This version still opens every older save and `.dwusave` file (uncompressed ones are recognised
  automatically).
- **Performance.** About 5% faster simulation on big late games, overlays only redraw when something changed, and a
  cheaper galaxy-zoom update. New option: Game Options → Performance → "Off-screen update rate" (Original by default).
- **Fixes.** Less shimmer on small, zoomed-out art (mipmaps); a wrong backdrop thumbnail; old destroyed-ship
  references pruned from pirate and independent empires.
- **Multiplayer groundwork.** Mac and Linux now run bit-identical games; orders name their targets by stable ids; a
  lockstep networking core is in place (not in the menus yet). The hot-seat "Human Players…" option in the wizard is
  not finished in this release; games still start with one human player.
