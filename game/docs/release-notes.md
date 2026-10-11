# Release notes

Notes for the next release, to copy into the GitHub release (RELEASING.md step 2).

## Unreleased

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
