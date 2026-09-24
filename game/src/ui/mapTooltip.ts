// Task 12k: Main View hover tooltip. One absolutely positioned div
// (pointer-events: none) next to the cursor, styled like the HUD panels.
import './mapTooltip.css';
import { HabitatCategoryType, type Habitat } from '../sim/types';

/** Pure tooltip text for a hovered habitat (task 12k):
 * - star: just its name;
 * - anything else: name, then " — <empire>" when it has a named empire,
 *   then " (<systemName>)" when systemName is given and differs from the
 *   habitat's own name. */
export function tooltipText(h: Habitat, systemName: string | null): string {
    if (h.category === HabitatCategoryType.Star) {
        return h.name;
    }
    let text = h.name;
    if (h.empire !== null && h.empire.name !== '') {
        text += ` — ${h.empire.name}`;
    }
    if (systemName !== null && systemName !== '' && systemName !== h.name) {
        text += ` (${systemName})`;
    }
    return text;
}

let tooltipEl: HTMLDivElement | null = null;

/** Show the map tooltip with `text` at 14 px right / 14 px below the
 * cursor position (clientX/clientY). Replaces any existing one. */
export function showMapTooltip(text: string, x: number, y: number): void {
    if (tooltipEl === null) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'dwu-map-tooltip';
        document.body.appendChild(tooltipEl);
    }
    tooltipEl.textContent = text;
    tooltipEl.style.left = `${x + 14}px`;
    tooltipEl.style.top = `${y + 14}px`;
    tooltipEl.style.display = 'block';
}

/** Hide (and remove) the map tooltip. */
export function hideMapTooltip(): void {
    if (tooltipEl !== null) {
        tooltipEl.remove();
        tooltipEl = null;
    }
}