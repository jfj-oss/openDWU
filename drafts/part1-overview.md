# RECREATION PROMPT — "Distant Worlds: Universe" (Complete Game Specification)

## 0. MISSION AND DEFINITION OF DONE

You are to build a **complete, fully playable, original re-implementation** of the 4X space strategy game **Distant Worlds: Universe** (a 2D top-down real-time 4X galactic strategy game). This document is the complete specification: every system, formula, data table, UI element, content item, and asset requirement is described below. Where an exact numeric value is given, use it. Where a behavior is described, implement exactly that behavior. Nothing may be stubbed, omitted, or "simplified": every feature listed here must be fully functional in the final build.

**Genre and feel:** A vast real-time (with pause and speed controls) 4X — eXplore, eXpand, eXploit, eXterminate — space strategy game. The player leads one space civilization among a dozen or more AI civilizations (and pirate factions) across a procedurally generated galaxy containing up to 1,400 star systems and 50,000+ planets, moons, asteroids, gas clouds, nebulae and space creatures. The camera is a free 2D top-down map that continuously zooms from 100% (individual planets and ships visible) through system level, sector level (grid of 10x10 sectors) to full-galaxy view. There are no turns: everything is simulated in continuous real time (the default time scale is 1 year of game time per minute of real time; the player can pause and set speed levels 1-8 and higher).

**Two-seconomy model:** Every empire has a **State** economy (controlled by the player/AI leader: taxes, ship construction funding, maintenance) and a **Private** economy (fully automatic: private citizens build and operate freighters, mining ships, passenger ships, run tourism and inter-colony trade). The player's influence is limited to: setting tax rates, keeping trade routes safe, building space ports and mining stations, and setting policies — the private sector then acts on its own. This must be faithfully simulated (see Economy section).

**Definition of done (all must be true):**
1. A player can create a fully custom new game (all options described in the New Game section) and play it to victory or defeat, in any of the game modes (Classic Era planetary empire, Pirate faction, Pre-Warp era, Ancient Galaxy storyline, or pure custom sandbox).
2. Every screen, button, list, overlay, message, and hotkey listed in the UI section exists and works.
3. Every race (24), government (13), resource (41), component (129), planetary facility (17 types + wonders), fighter type, plague (4), ship design template role (31 per race), research project (372), and victory condition (60 race conditions + general) listed in the Content section exists in the game.
4. Every AI empire, pirate faction, and space creature behaves per the AI section, with full automation working unattended.
5. Save/load, autosave, game editor, theme/mod loading, and scenario/event system all work.
6. The game runs a full custom galaxy at interactive frame rates with the performance requirements in the Architecture section.

**Licensing note:** This re-implementation is for the user's personal project. Recreate the *mechanics, systems, data and behavior* described here; generate new original artwork in the described style (2D top-down sci-fi) — do not copy pixel art or audio assets. All in-game names, race names, and lore text given in this document are part of the specification and should be reproduced as text.

---

## PART 1 — GAME OVERVIEW

### 1.1 What the game is
- A single-player (local) real-time 4X space strategy game. One human player controls one empire; all other empires, pirate factions, independent alien populations, and space creatures are AI.
- The map is a single spiral galaxy in 2D. Systems (stars) are placed across a 2D plane in a galactic shape; each system contains 0-15+ stellar objects (planets, moons, gas giants, asteroids, gas clouds, ruins) and may contain nebulosity.
- Time: continuous. Game date displayed as year (e.g. "2986.45" style decimal years). Default rate: 1 game year per real minute. Speed buttons +/– step through 8 or more speed levels (0 = paused). Autosave every 10-30 minutes (default 30) into rotating autosave slots.
- The galaxy starts largely unexplored: each empire only knows systems near its homeworld; everything else must be explored by ships (or bought from pirates/other empires).

### 1.2 Series context (lore that drives content)
The game package contains five "eras"/storylines the player can enable in any combination (off, some, or all):
1. **Original Distant Worlds / Classic Era** — planetary civilizations rediscover faster-than-light travel and expand.
2. **Return of the Shakturi** — the insectoid Shakturi race (a hidden, extremely aggressive non-playable race that arrives partway through the game) invades the galaxy; the player's side (the Freedom Alliance) and others fight them off.
3. **Legends** — post-second-war era: new special events, disasters, and faction-specific victory conditions.
4. **Shadows (pre-hyperspace era / Age of Shadows)** — space-based **pirate** factions (nomadic survivors of the old fleets) vs. re-emerging planetary civilizations that can only travel within their own systems until they rediscover hyperspace; pirates can control/raids/exterminate planets.
5. **Ancient Galaxy (new in Universe)** — the first war between the Freedom Alliance and the Shaktur Axis, roughly 500 years before the original timeline; includes planet destroyers, Ancient Guardians, and the researchable/deployable Xaraktor virus.
When storylines are enabled, scripted events (empire destruction, race invasions, plague waves, discoveries of the galaxy's history) fire on timers/conditions; the player may play them with full story, partial story, or none, and may toggle Disasters, Events, and special victory conditions.

### 1.3 Core player tasks
Explore the galaxy; colonize new planets; construct ships; defend the empire. All four are supported by: research (unlocking new components, abilities, facilities), diplomacy (treaties, gifts, trade), espionage (intelligence agents), troops (invasion/defense), and the private economy (taxes, trade fees, construction revenue).

### 1.4 Victory
The player chooses victory criteria at game start (see Victory section): territory %, population %, economy (strategic value) % of galaxy, or time-limit (highest strategic value when timer ends); plus optional race-specific victory conditions (60 total, per race) and pirate playstyle conditions; storyline can replace normal conditions. Planetary empires are compared only to other planetary empires for victory; pirate factions only to other pirates. The game can also be won/lost to total elimination (all colonies + space ports + construction ships destroyed for pirates = eliminated; planetary empire eliminated when it loses all colonies and space ports).
