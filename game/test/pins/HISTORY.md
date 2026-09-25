# Seed-pin history

Appended by `npm run repin -- --reason "<why>"` (scripts/repin.mjs).

## 2026-09-25 — seed pins moved into test/pins

- Value-neutral refactor: the `PINNED_*` constants and inline seed-1 literals of 14 test files became `toMatchPin` pins (37 in seed1.json, 13 in-place literals); tickDeterminism also pins the 120 s digest / draws and the 600 s counts / draws next to the 600 s digest. Earlier moves are in the reason comments above each pin.
