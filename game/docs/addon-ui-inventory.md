# Add-on / openDWU UI inventory (menu audit, 2026-10-14)

User rule: *reduce the total number of menus across the add-ons, tie in as many as possible to existing (original)
menus, no major modifications to the normal HUD.* This lists every window, tab, section, link, button and menu entry
that our add-ons and openDWU features add on top of the DW:U 1.9.5 UI. Ports of original screens (Build Order,
Ground Report, Map Key, Ruin Summary, Advisor Suggestion, Game Editor, ...) are not listed.

Recommendation key: **keep** (fine where it is) · **merged** (done in this pass) · **merge** (proposed, plan below) ·
**drop** (proposed).

## Counts

Entries = rows of the tables below (a row may group several small items of one feature on one screen).

| | before | after |
|---|---|---|
| Own windows (ScreenPanels an add-on / openDWU feature opens) | 22 | 21 |
| Tabs / sections / blocks inside original screens | 17 | 18 |
| Links / buttons added to original screens | 9 | 9 |
| HUD extras (buttons, strips, menu entries, rows) | 11 | 10 |
| **Total** | **59** | **58** |

Changes in this pass: the *Internal Security* window and its "Internal Security..." link on the Characters
(Intelligence) screen are gone — folded into a new **Threats & Leads** section of that screen (one toggle button under
the Galactopedia link, no extra window); the HUD top "•••" menu no longer lists *The Interstellar Diet* (the Diplomacy
screen's Diet block opens it).

## 1. Own windows

| Window | Add-on / feature | Opened from | Recommendation |
|---|---|---|---|
| ~~Internal Security~~ (leads table) | Internal Security (19m) | "Internal Security..." link, Characters screen | **merged** → Characters screen *Threats & Leads* section |
| Charters screen + charter dialog | Chartered Companies (19c) | Empires list "Charters" header button; Diplomacy "Manage charter"; selection More → Charter (dialog) | merge (B3) |
| The Interstellar Diet (3 tabs) | Characters & Victory part 2 | Diplomacy Diet block button (HUD ••• entry removed) | keep (its own tabs are too big for the Diplomacy side panel) |
| Treasury — bonds & debt | Colony Economy | Empire Summary "Bonds & debt →" link | merge (B2) |
| Trade Flows panel | openDWU 19e-9 freight flows | Empire Summary "Where does the money go? →", Resource Supply link, map overlay "…" | keep (one window, three natural entry points) |
| Resource supply (per resource) | Improvement `supplyChain` | resource row clicks (Colonies, Construction Yards, Empire Summary link) | keep |
| Build Queue | openDWU extension | "Build Queue" button in Build Order | keep |
| Fleet Settings | Improvement `fleetSettings` | selection More → Settings, Fleets window row, Q | keep |
| Battle Report | Improvement (DW2-inspired) | ticker line / message stub, Galactic History → Battle Reports | keep |
| Message History (ticker lines) | openDWU 12i | click on the top message ticker | merge (B4) |
| Advisor chat (admiral) | LLM advisor 18a | K; HUD ••• → Talk to your admiral | keep (LLM-only, off without a model) |
| Empire councils (local model) log | LLM AI advisor 18c | opens itself on each AI decision round (setting off by default) | merge (B5) |
| Speak freely (negotiation) | LLM diplomacy P4 | Diplomacy screen button | keep |
| Peace-terms dialog | Lively Galaxy war goals | Diplomacy war row | keep (dialog) |
| Human offers panel | Multiplayer phase 5 | incoming human offers | keep |
| Add Add-ons | openDWU add-on system | Load Game screen | keep |
| Improvements... | openDWU Improvements | Game Options button | keep |
| Music & Mood | openDWU | Game Options button | keep |
| Local model | LLM features | Game Options button | keep |
| Bacon Mod Settings | Bacon mod | Game Options button | keep |
| Hotkeys | Expanded-mod hotkeys port | Game Options → HotKeys | keep |
| Hot-seat players | Multiplayer phase 2 | new-game wizard (not touched: wizard owned by another agent) | keep |

## 2. Tabs / sections / blocks inside original screens

| Where (original screen) | What | Add-on | Recommendation |
|---|---|---|---|
| Characters (F4, "Intelligence") | **Threats & Leads** section (known threat sites + 19m leads: Investigate, Go to, arrest / exile / purge / amnesty / quarantine / martial law / recall fleet / scrap ship) | any Galactic Threat add-on or Internal Security | **merged** (new home of the Internal Security window) |
| Characters | Loyalty / Ambition columns, politics actions in the summary | Emergent politics 19d1 | keep |
| Characters | court seats / schemes detail | Court & Dynasties 19n | keep |
| Characters | travel / post block (VIP trips, governor posts) | Characters & Victory | keep |
| Characters | mission frame / blame option | Espionage consequences 19d3 | keep |
| Colonies | Economy tab | Colony Economy | keep |
| Colonies | designation column + icon, governor slot, approval-ledger tooltip | Colony Economy / C&V / Internal Security | keep |
| Empire Summary | Stability / court / crises rows under the bonuses | 19d1 / 19m / 19n / crises | keep |
| Diplomacy (per-empire side panel) | proposals list, trade negotiation, war goals, Speak freely, diplomatic voice | proposals / tradenego / wargoals / LLM | keep |
| Diplomacy | rim trader terms block + Voidbloom block | Rim Trade / Voidbloom War | keep |
| Diplomacy | charter line, "Why they feel this way" (reputation), "Incidents" | Charters / Reputation 19o / Espionage 19d3 | keep |
| Diplomacy | Interstellar Diet summary block / Galactic Council block | C&V / Galactic Council 19d8 | keep |
| Empires list | company tag, Concord tag | Charters / Rim Trade | keep |
| Galactic History | Chronicle, Ask, Orders tabs | Archivist / chronicle add-ons | keep |
| Galactic History | Battle Reports tab | Improvement | keep |
| Galactopedia | add-on topics (Colony Economy root, expansion articles) | several | keep |
| Map overlays (original Overlays list) | Freight Flows / Trade Hubs rows, Improvements' inline "…" panels | 19e-9 / Improvements | keep |
| Selected-object info | "Threat" row (known threat site) | Galactic Threats | keep (the Threats & Leads section lists the same sites) |

## 3. Links / buttons on original screens

| Where | What | Recommendation |
|---|---|---|
| ~~Characters~~ | ~~"Internal Security..." link~~ | **merged** → "Threats & Leads" toggle (same spot, switches the screen in place) |
| Characters | "Threats & Leads" / "Characters" toggle | new (replaces the link) |
| Empire Summary | "Where does the money go? →" (Trade Flows), "Bonds & debt →" (Treasury), "Supply by resource →" | keep; "Bonds & debt" goes with B2 |
| Resource Supply | "Trade Flows panel…" link | keep |
| Empires list | "Charters" header button | merge (B3) |
| Diplomacy | "Manage charter", "Open the Interstellar Diet", "Speak freely", peace-terms, treasure-stop request, Voidbloom actions | keep |
| Build Order | "Build Queue" button | keep |
| Fleet Settings | "Ship Designs...", "Fleet Designs..." links | keep |
| Game Options | Improvements..., Music & Mood..., Local model..., Bacon settings..., HotKeys | keep |
| Load Game | Add Add-ons | keep |

## 4. HUD extras

| What | Feature | Recommendation |
|---|---|---|
| Top-bar "•••" More menu (Galaxy Map, Empires list, Game Options, Talk to your admiral, Keyboard shortcuts) | openDWU (frees top-bar room) | keep |
| ~~••• → The Interstellar Diet~~ | Characters & Victory | **merged** (removed; Diplomacy's Diet block opens it) |
| Selection panel "More" button: Settings (fleet), Charter, dispatch orders | Improvements / Charters | keep (one button for every non-original order) |
| **Intercept / Defend / Watch** buttons (free slots of the selection panel action buttons; Watch in the More menu when the slots are full) | openDWU (just landed, seen by the user) | keep — not touched |
| Follow toggle (ships / fleets) | openDWU follow camera | keep |
| Ticker click → Message History | openDWU 12i | see B4 |
| Message popup stubs under the top-right panel | openDWU popup stubs | keep (setting) |
| Right-click entries: Salvage (wreck fields), waypoint Rename / Delete, threat actions (Purge farm, Destroy nest) | Wreckage 19e-7 / waypoints / threats | keep (order-menu entries, no new menu) |
| Selected-object "Threat" row | Galactic Threats | keep |
| Map: threat markers | Galactic Threats | keep |
| Map: freight flows / dw2 overlays | 19e-9 / Improvements | keep |

## Proposed bigger merges (not done — for the user to decide)

- **B2 Treasury → Empire Summary.** The bonds & debt window is empire-level money, Empire Summary's own subject. Plan: a
  collapsible "Bonds & debt" group under Empire Summary's income block (same rows and buttons as the window), the link
  and the window removed. Cost: Empire Summary is already dense at 1020 × 770; needs a layout pass.
- **B3 Charters screen → Colonies screen / Diplomacy.** The player's companies are empires the player founded. Plan: a
  "Charters" tab on the Empires list (same table + Renew / Release / Nationalise), drop the header button and the
  separate screen; the charter *dialog* stays (it is the action). Alternative: inside Diplomacy's company panel only.
- **B4 Message History → Messages window (H).** The ticker history and the original Messages list (Galactic History /
  messages) overlap. Plan: a "Ticker" tab in the H window; the ticker click opens H on that tab; the separate window
  goes. Needs care: the ticker window deliberately does not pause the game, the H window does.
- **B5 Empire councils log → Galactic History tab.** The local-model AI decision log is a history of decisions. Plan: a
  "Councils" tab in Galactic History (shown while the setting is on) instead of a self-opening window; optionally a
  ticker line per round. Loses the "pops up as it happens" transparency the feature was built for.
- **B6 Interstellar Diet → Diplomacy.** Possible only as a tabbed page inside the Diplomacy window (its Session / In
  force / Members tabs do not fit the side panel); would make Diplomacy's layout depend on the add-on. Not recommended.
