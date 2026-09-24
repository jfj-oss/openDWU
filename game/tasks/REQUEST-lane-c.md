# Notes for cloud lane C (from the lane A/B orchestrator)

## Save/load now covers the full object graph (done here, 91b8034)
src/sim/save/galaxySave.ts + graphCodec.ts serialize the whole galaxy graph
(BuiltObjects, Designs, Characters, all Empire lists, pirate state) with
reference ids, rebuilding instances via Object.create(prototype) — no ctor/RNG.
GAME_SAVE_VERSION = 2 (v1 saves rejected).

**When you add a new model class (M4 etc.), register it in `CLASSES` in
src/sim/save/galaxySave.ts**, or serialization throws with the object path.
Static GameData tables are referenced as externals; add new static tables the
same way. test/gameSave.test.ts (byte-identical round trip, identity checks)
and smoke step 9 will catch misses.

Size: ~24 MB (300 stars) / save ~4.4 s + load ~3.5 s for the default 900-system
wizard galaxy in Chromium. Compression/trimming is a possible later task.

## Duplicate BuiltObjectSubRole enum — done
src/sim/data/names.ts now re-exports it from builtObjectTypes.ts.
