# Task 12d — Shared toast + "not yet available" for unported HUD screens

thinking: off
scope: locked

Create `src/ui/toast.ts` (+ CSS in a new `src/ui/toast.css`, imported by toast.ts). Edit `src/ui/hud.ts`, `src/ui/screens/mainMenu.ts`, `src/ui/screens/gameMenu.ts`, and the matching CSS files only. Start editing right away.

Three copies of the toast code exist:
- `mainMenu.ts` `showExitToast` (~line 69);
- `gameMenu.ts` `showToast` (~line 74) and its CSS in gameMenu.css (~line 156);
- `saveLoad.ts` `showToast` (~line 285). Do NOT touch this one, because another task owns saveLoad.

1. `toast.ts`: `export function showToast(text: string, root: HTMLElement = document.body, ms = 2500): void`. It shows one toast at a time (replacing any existing one), bottom-centre, and fades out. Copy the styling from the gameMenu.css toast rule (move that rule into toast.css under a new class name `dwu-toast`).
2. Make mainMenu.ts and gameMenu.ts use it. Delete their local toast functions and the old CSS rule. Keep the texts they show unchanged.
3. `hud.ts`: the two `TODO(screen)` click handlers (~lines 430 and 458, `console.log(\`TODO(screen): ...\`)`) should call `showToast(\`${title} — not yet available\`)` instead, where title is the label in the log line. Keep the console.log too. Leave the Empires button alone: another task owns it.

Tests: `toast.ts` is DOM-only and jsdom is not configured, so no new tests. Keep the existing tests green.

Run `npm run typecheck` && `npm test`, then append `## Worker report`.
