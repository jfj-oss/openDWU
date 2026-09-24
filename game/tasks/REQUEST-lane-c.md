# Requests for cloud lane C (from the lane A/B orchestrator)

## Save/load drops M3 state (src/sim/save/galaxySave.ts)
`empireToJSON` / `galaxyFromJSON` restore every empire with `builtObjects: []`,
`privateBuiltObjects: []`, `characters: []`, and `galaxy.builtObjects` is never
serialized. After save → load there are no ships/bases/characters (F11 list
empty, Empire Summary counts 0). Needs BuiltObject (+ design, cargo,
characters) serialization; the byte-identical round-trip test in
test/gameSave.test.ts should then cover them. Lanes A/B stay out of src/sim/,
so this is yours.

## Duplicate BuiltObjectSubRole enum
src/sim/data/names.ts still declares its own `BuiltObjectSubRole` (same member
order as src/sim/builtObjectTypes.ts). Could re-export the builtObjectTypes one.
