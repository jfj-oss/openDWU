// Task 12k: Main View hover tooltip. One absolutely positioned div
// (pointer-events: none) next to the cursor, drawn like the original's HoverPanel (HoverPanel.cs): a fill of the
// owner empire's main colour at alpha 32 ((64, 64, 64) at alpha 32 for nothing / independents — method_0 / method_13 /
// SetData(Creature)), padding int_2 = 6, white text with a black copy at (+1, +1) (method_11), the name in bold
// (font_1 = GenerateFont(18.67, bold)), the other lines in font_0 = GenerateFont(18.67) (method_12).
import './mapTooltip.css';
import { HabitatCategoryType, HabitatType, type Habitat } from '../sim/types';
import { installHudScaleVar } from './originalWindow';

/** HoverPanel solidBrush_0: the empire's main colour (0xRRGGBB) at alpha 32, or (64, 64, 64) at alpha 32. Pure. */
export function hoverPanelFill(tint: number | null): string {
    const c = tint ?? 0x404040;
    return `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${(32 / 255).toFixed(3)})`;
}

/** Pure tooltip text for a hovered habitat (task 12k):
 * - star: just its name;
 * - anything else: name, then " — <empire>" when it has a named empire,
 *   then " (<systemName>)" when systemName is given and differs from the
 *   habitat's own name. */
export function tooltipText(h: Habitat, systemName: string | null, known = true): string {
    if (h.category === HabitatCategoryType.Star) {
        return h.name;
    }
    if (h.category === HabitatCategoryType.GasCloud) return gasCloudTooltipText(h, known);
    let text = h.name;
    if (h.empire !== null && h.empire.name !== '') {
        text += ` — ${h.empire.name}`;
    }
    if (systemName !== null && systemName !== '' && systemName !== h.name) {
        text += ` (${systemName})`;
    }
    return text;
}

/**
 * A gas cloud, as HoverPanel.cs method_3 names it: its name, then Galaxy.ResolveDescription(Type) + " " +
 * ResolveDescription(Category) ("Hydrogen Gas Cloud", GameText.txt "HabitatType …" / "HabitatCategoryType GasCloud");
 * in a system the player has not explored, "(Unexplored Gas Cloud)" (GameText "UnexploredLocation" = "Unexplored {0}",
 * also the C# current-system label, Main.Part11.cs 1789-1794).
 */
export function gasCloudTooltipText(h: Habitat, known: boolean): string {
    if (!known) return '(Unexplored Gas Cloud)';
    const key = (HabitatType as unknown as Record<number, string>)[h.type] ?? '';
    return `${h.name}\n${key.replace(/([a-z])([A-Z])/g, '$1 $2')} Gas Cloud`;
}

let tooltipEl: HTMLDivElement | null = null;

/** Show the map tooltip with `text` at 14 px right / 14 px below the
 * cursor position (clientX/clientY). Replaces any existing one. `multiline`: keep the text's line breaks.
 * `tint`: the owner empire's main colour (0xRRGGBB) for the HoverPanel fill, null = the neutral grey. */
export function showMapTooltip(text: string, x: number, y: number, multiline = false, tint: number | null = null): void {
    if (tooltipEl === null) {
        installHudScaleVar();
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'dwu-map-tooltip';
        document.body.appendChild(tooltipEl);
    }
    // The first line is the name (bold); textContent stays `text`.
    const nl = text.indexOf('\n');
    const title = document.createElement('span');
    title.className = 'dwu-map-tooltip-title';
    title.textContent = nl < 0 ? text : text.slice(0, nl);
    tooltipEl.replaceChildren(title);
    if (nl >= 0) tooltipEl.appendChild(document.createTextNode(text.slice(nl)));
    tooltipEl.style.background = hoverPanelFill(tint);
    tooltipEl.classList.toggle('multiline', multiline);
    tooltipEl.style.left = `${x + 14}px`;
    tooltipEl.style.top = `${y + 14}px`;
    tooltipEl.style.display = 'block';
    if (multiline && typeof window !== 'undefined') {
        // A wide multi-line tooltip near the right / bottom edge: keep it on screen.
        const r = tooltipEl.getBoundingClientRect();
        if (r.right > window.innerWidth - 4) tooltipEl.style.left = `${Math.max(4, x - 14 - r.width)}px`;
        if (r.bottom > window.innerHeight - 4) tooltipEl.style.top = `${Math.max(4, y - 14 - r.height)}px`;
    }
}

/** Hide (and remove) the map tooltip. */
export function hideMapTooltip(): void {
    if (tooltipEl !== null) {
        tooltipEl.remove();
        tooltipEl = null;
    }
}