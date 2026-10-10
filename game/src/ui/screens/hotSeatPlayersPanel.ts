// The new-game wizard's "Human players (hot seat)" list (multiplayer Phase 2, docs/MULTIPLAYER.md §7). Not in the
// original. The Other Empires page opens it from its "Human Players..." button: a panel over the manual empire list
// with one row per EXTRA human (players 2..N; player 1 is the Your Race / Your Empire choice). Each row has the empire
// name, the race and government combos of the manual AI rows (the government list follows the race the same way:
// startGovernmentsForRace) and the two flag colours. The rows live in StartGameOptions.humanPlayers; the key is deleted
// when the last row goes, so a single-player start is unchanged.

import type { Government } from '../../sim/data/governments';
import type { Race } from '../../sim/data/races';
import { HOT_SEAT_EXTRA_HUMANS_MAX, type HumanPlayerStart } from '../../sim/humanPlayerStarts';
import type { StartGameOptions } from '../../sim/startGameOptions';
import { COLORS, FONT, el, glassButton, gradientPanel, place, text, textBox } from '../originalWindow';
import { colorDropDown } from '../originalWindowControls';
import './hotSeatPlayersPanel.css';

export interface HotSeatPlayersPanelDeps {
    options: StartGameOptions;
    /** The playable races, sorted by name (the manual rows' list). */
    races: () => Race[];
    /** The governments (governments.txt), [] until loaded. */
    governments: () => Government[];
    /** startGovernmentsForRace (newGameWizard.ts): the governments a combo offers for a race (null = Random). */
    governmentsForRace: (governments: readonly Government[], race: Race | null) => Government[];
    /** The ColorDropDown palette (wizardColorPalette). */
    palette: readonly string[];
    /** Where open combo lists go (the wizard window body). */
    listParent: () => HTMLElement;
    /** Called after any change (the page's preview line / the Start summary). */
    onChange: () => void;
}

export interface HotSeatPlayersPanel {
    el: HTMLDivElement;
    open: () => void;
    close: () => void;
    isOpen: () => boolean;
    /** Re-render the rows (after the race / government data loaded). */
    repaint: () => void;
}

/** "Hot seat: 3 human players (you + 2)" / "One human player (you)". */
export function hotSeatSummaryText(o: StartGameOptions): string {
    const extra = o.humanPlayers?.length ?? 0;
    return extra === 0 ? 'One human player (you)' : `Hot seat: ${extra + 1} human players (you + ${extra})`;
}

/** A primary colour for a new row: the first palette colour no human uses yet. */
function freshPrimary(o: StartGameOptions, palette: readonly string[]): string {
    const used = new Set([o.primaryColor, ...(o.humanPlayers ?? []).map((h) => h.primaryColor)].map((c) => c.toLowerCase()));
    // Step through the palette so neighbouring players get distinct hues.
    for (let k = 0; k < palette.length; k++) {
        const c = palette[(k * 7 + 3) % palette.length].toLowerCase();
        if (!used.has(c)) return c;
    }
    return palette[0] ?? '#808080';
}

/** Build the panel (hidden; `open` shows it). Placed by the caller over the manual empire list (882 × 307). */
export function buildHotSeatPlayersPanel(d: HotSeatPlayersPanelDeps): HotSeatPlayersPanel {
    const o = d.options;
    const root = gradientPanel({ corners: { tl: true, tr: true, br: true, bl: true }, radius: 20, borderWidth: 2, className: 'wizard-panel wizard-hotseat-panel' });
    root.hidden = true;

    root.appendChild(place(text('Human players (hot seat)', { size: FONT.header, bold: true, color: COLORS.label, shadow: false }), 15, 8));
    const note = text(
        'Player 1 is you (the Your Race and Your Empire pages). Each extra human plays on this PC: switch the screen to the next player with the top-bar Switch Player button or Ctrl+Shift+H.',
        { size: FONT.tiny, color: COLORS.label, shadow: false, wrapWidth: 640 },
    );
    root.appendChild(place(note, 15, 34));

    const addBtn = glassButton('Add Human Player', {
        size: FONT.normal,
        className: 'wizard-btn wizard-btn-secondary wizard-hotseat-add-btn',
        onClick: () => {
            const list = o.humanPlayers ?? [];
            if (list.length >= HOT_SEAT_EXTRA_HUMANS_MAX) return;
            list.push({ name: '', race: '', governmentId: -1, primaryColor: freshPrimary(o, d.palette), secondaryColor: '#ffffff' });
            o.humanPlayers = list;
            paint();
        },
    });
    root.appendChild(place(addBtn, 670, 8, 200, 25));
    const doneBtn = glassButton('Done', { size: FONT.normal, className: 'wizard-btn wizard-btn-primary wizard-hotseat-done-btn', onClick: () => close() });
    root.appendChild(place(doneBtn, 670, 38, 200, 25));

    const grid = place(el('div', 'ow-grid wizard-hotseat-grid'), 10, 72, 860, 222);
    grid.style.fontSize = `${FONT.normal}px`;
    const COLS = [70, 230, 180, 200, 70, 70, 30];
    grid.style.setProperty('--ow-cols', COLS.map((w) => `${w}px`).join(' '));
    const head = el('div', 'ow-grid-head');
    for (const h of ['Player', 'Empire name', 'Race', 'Government', 'Main', 'Second', '']) head.appendChild(el('div', 'ow-grid-hcell ow-align-left', h));
    grid.appendChild(head);
    const body = el('div', 'ow-grid-body ow-scroll wizard-hotseat-rows');
    grid.appendChild(body);
    root.appendChild(grid);

    function rowRace(h: HumanPlayerStart): Race | null {
        return h.race === '' ? null : (d.races().find((r) => r.name === h.race) ?? null);
    }

    function makeRow(h: HumanPlayerStart, i: number): HTMLDivElement {
        const row = el('div', `ow-grid-row wizard-hotseat-row${i % 2 === 1 ? ' ow-alt' : ''}`);
        row.style.setProperty('--ow-row-h', '25px');

        row.appendChild(el('div', 'ow-grid-cell', `Player ${i + 2}`));

        const nameCell = el('div', 'ow-grid-cell');
        const nameInput = textBox(h.name, h.race === '' ? `Player ${i + 2}'s empire` : `${h.race} Empire`, (v) => {
            h.name = v;
            d.onChange();
        });
        nameInput.classList.add('wizard-hotseat-name-input');
        nameInput.addEventListener('keydown', (e) => e.stopPropagation());
        nameCell.appendChild(nameInput);
        row.appendChild(nameCell);

        const raceCell = el('div', 'ow-grid-cell');
        const raceSelect = el('select', 'ow-input ow-select wizard-hotseat-race-select');
        const randomOpt = el('option', '', '(Random)');
        randomOpt.value = '';
        randomOpt.selected = h.race === '';
        raceSelect.appendChild(randomOpt);
        for (const r of d.races()) {
            const opt = el('option', '', r.name);
            opt.value = r.name;
            opt.selected = r.name === h.race;
            raceSelect.appendChild(opt);
        }
        raceCell.appendChild(raceSelect);
        row.appendChild(raceCell);

        const govCell = el('div', 'ow-grid-cell');
        const govSelect = el('select', 'ow-input ow-select wizard-hotseat-gov-select');
        function fillGovernments(): void {
            const none = el('option', '', '(Random)');
            none.value = '-1';
            none.selected = h.governmentId < 0;
            govSelect.replaceChildren(none);
            for (const g of d.governmentsForRace(d.governments(), rowRace(h))) {
                const opt = el('option', '', g.name);
                opt.value = String(g.governmentId);
                opt.selected = g.governmentId === h.governmentId;
                govSelect.appendChild(opt);
            }
        }
        fillGovernments();
        // As the manual AI rows (StartingEmpiresListView.cs 188 _Grid_CellValueChanged): the government list follows the
        // race; one it no longer offers falls back to (Random), and a race with a preferred government selects it.
        raceSelect.addEventListener('change', () => {
            h.race = raceSelect.value;
            nameInput.placeholder = h.race === '' ? `Player ${i + 2}'s empire` : `${h.race} Empire`;
            const race = rowRace(h);
            const offered = d.governmentsForRace(d.governments(), race);
            if (!offered.some((g) => g.governmentId === h.governmentId)) h.governmentId = -1;
            if (race !== null && race.preferredStartingGovernment !== -1 && offered.some((g) => g.governmentId === race.preferredStartingGovernment)) h.governmentId = race.preferredStartingGovernment;
            fillGovernments();
            d.onChange();
        });
        govSelect.addEventListener('change', () => {
            h.governmentId = parseInt(govSelect.value, 10);
            d.onChange();
        });
        raceSelect.addEventListener('keydown', (e) => e.stopPropagation());
        govSelect.addEventListener('keydown', (e) => e.stopPropagation());
        govCell.appendChild(govSelect);
        row.appendChild(govCell);

        for (const key of ['primaryColor', 'secondaryColor'] as const) {
            const cell = el('div', 'ow-grid-cell');
            const combo = colorDropDown({
                colors: d.palette,
                value: h[key],
                allowCustom: true,
                listParent: d.listParent,
                onChange: (c) => {
                    h[key] = c;
                    d.onChange();
                },
            });
            combo.el.classList.add('wizard-hotseat-color', `wizard-hotseat-${key === 'primaryColor' ? 'primary' : 'secondary'}`);
            combo.el.style.width = '62px';
            combo.el.style.height = '21px';
            cell.appendChild(combo.el);
            row.appendChild(cell);
        }

        const removeCell = el('div', 'ow-grid-cell ow-align-center');
        const removeBtn = el('button', 'wizard-empires-remove-btn wizard-hotseat-remove-btn');
        removeBtn.type = 'button';
        removeBtn.title = 'Remove player';
        const img = el('img');
        img.src = '/assets/dwu/images/ui/chrome/remove.png';
        img.alt = '✕';
        img.draggable = false;
        removeBtn.appendChild(img);
        removeBtn.addEventListener('click', () => {
            const list = o.humanPlayers ?? [];
            const k = list.indexOf(h);
            if (k >= 0) list.splice(k, 1);
            // No extra humans: no key at all, so the start options of a single-player game are unchanged.
            if (list.length === 0) delete o.humanPlayers;
            paint();
        });
        removeCell.appendChild(removeBtn);
        row.appendChild(removeCell);
        return row;
    }

    function paint(): void {
        const list = o.humanPlayers ?? [];
        if (list.length === 0) {
            body.replaceChildren(el('div', 'wizard-hotseat-empty', 'No extra human players: a single-player game. Add Human Player adds player 2.'));
        } else {
            body.replaceChildren(...list.map(makeRow));
        }
        addBtn.disabled = list.length >= HOT_SEAT_EXTRA_HUMANS_MAX;
        d.onChange();
    }

    function close(): void {
        root.hidden = true;
    }

    paint();
    return {
        el: root,
        open: () => {
            paint();
            root.hidden = false;
        },
        close,
        isOpen: () => !root.hidden,
        repaint: paint,
    };
}
