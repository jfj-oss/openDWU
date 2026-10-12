# Release notes

Notes for the next release, to copy into the GitHub release (RELEASING.md step 2).

## Unreleased

- **Music & Mood.** Options → Sound Volume → **Music & Mood...**: a background mood (Off by default, **Rim only** for
  the Rim Atmosphere add-on, or the new **Deep Space** bed: sparse wind, an underwater rumble and the odd distant
  creature call or hull creak, all synthesised, everywhere in the game) and the music source (**Original**, **Off**
  or **your own playlists** with Shuffle and Next Track). The desktop app reads playlists from a `Music` folder next
  to your saves (one subfolder per playlist; mp3, ogg, flac, wav, m4a/aac); see the README's "Music & mood".
- **Leaner, faster saves.** Saves use a new compact format (save format 3): the same late-game galaxy is about a third
  of the text (449 MB → 152 MB; 42 MB → 34 MB compressed), saves about twice as fast and loads with about half the
  memory. Every older save and `.dwusave` file still loads exactly as before; saves made with this version cannot be
  opened by older versions (0.1.15 and earlier).

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
