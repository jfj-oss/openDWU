// Original-style screen windows: the shared chrome and widgets for every screen opened from the top bar.
//
// ===================================================================================================================
// GUIDE (read before building a screen on this module)
// ===================================================================================================================
// The original opens each screen as a DistantWorlds.Controls.ScreenPanel (a BorderPanel with a HeaderPanel and a
// GradientPanel body), sized in its own pixels in Main.Part*.cs (e.g. pnlEmpireInfo = Diplomacy: Main.Part11.cs
// method_195, 1040 × 760, or 1180 × 900 when the window is at least 1180 × 900 — EmpireDetailView.Kickstart) and
// centred on the main view. Port a screen like this:
//
//   1. `const win = openOriginalWindow({ id: 'research', title: 'Research', icon: 'research.png', width, height,
//      onClose })` — width / height are the ORIGINAL ScreenPanel size. The window lays itself out (header at (7, 8),
//      body at (8, 59), ScreenPanel.DoLayout) and scales as one with `transform: scale(k)`, k = originalWindowScale():
//      the HUD's factor (topBar.ts topBarScale: window height × UI scale × HUD_FRAME_SIZE) capped so the window fits.
//      Text stays crisp at 4K because the browser re-rasterises a scaled transform. A non-chrome header icon (the
//      player's flag on Empire Summary) goes in `iconUrl` / `win.setIcon(url)`.
//   2. Everything inside `win.body` is positioned in the original's body-relative pixels: copy the Location / Size
//      the source gives each control and call `place(el, x, y, w, h)`. Do NOT use flex/grid for the main layout —
//      the point is a 1:1 port. Pick the large / small variant with `win.virtualSize` (the window in original pixels,
//      the original's ClientSize) when the source has one (`isLargeScreen`).
//   3. Use the widgets below rather than ad-hoc DOM so all screens share one look:
//        gradientPanel()  GradientPanel (3-colour vertical gradient, shaded border, curved corners)
//        glassButton()    GlassButton (black glass, shine on the top half, glow on hover, grey→white text); `colors`
//                         recolours it (OuterBorderColor / ShineColor / GlowColor), `minorText` adds the second line
//        messageBox()     MessageBoxEx (caption, text, Yes / No / OK buttons) → Promise of the clicked button
//        OwGrid           DataGridView via ListViewBase (row colours, header, selection, sortable columns;
//                         `multiSelect` = MultiSelect with Ctrl / Shift, column `onClick` = CellClick)
//        tabStrip()       EnhancedTabControl
//        text() / dropText()  labels (GraphicsHelper.DrawStringWithDropShadow)
//        valueRow()       "Label  value" rows with the label right-aligned (EmpireDetailView stat block)
//        barGraph()       the DataGridViewTextBoxDropShadowCell amount bar
//        scrollPanel()    a scrolling region with the original-coloured scrollbar
//        linkLabel()      LinkLabel (255, 192, 0), underline on hover
//        dropDown() / textBox() / checkBox()  the (48, 48, 64) / (170, 170, 170) input controls
//        darkRect()       the translucent black blocks EmpireDetailView fills behind each section
//        numericUpDown()  NumericUpDown (clamped integer, up / down buttons, arrow keys / wheel)
//        imageCombo()     an owner-drawn ComboBox (DesignDropDown / ResourceDropDown: pictures + text per item)
//   4. Fonts: the game's font (Forgotten Futurist, loaded by hud.css) at the GenerateFont pixel sizes from the source
//      (FONT.normal 15.33, FONT.large 16.67, FONT.header 18.67, FONT.title 22.67 …). Colours: the source's
//      Color.FromArgb values; reuse the COLORS constants here.
//   5. Refresh with a timer that updates text in place (setText) or rebuilds a sub-panel; keep scroll positions.
//      Escape closes the topmost window (one document listener, registered first so the HUD's game-menu Escape on
//      window does not also fire). `win.close()` removes it and calls onClose.
//   6. Images: only `/assets/dwu/images/...` URLs (chromeUrl()); never copy the original art into the repo.
//   7. Controls the source parents to the HeaderPanel (e.g. a filter combo) go in `win.header`, header-relative.
// ===================================================================================================================
//
// Sources: DistantWorlds.Controls/Controls/ScreenPanel.cs (DoLayout: header (7, 8) W-14 × 51, body (8, 59)),
// HeaderPanel.cs (title font 22.67 px bold white at (45, 11), icon 30 × 30 at (10, 10), black fill, (96, 96, 104)
// shine on the top half, inner border (67, 67, 77)), CloseButton.cs (30 × 30 at (W - 41, 9), rounded rect radius 8,
// pen 3 (67, 67, 77) / hover pen 2 (134, 134, 154)), BorderPanel.cs (3 px border in four alpha-96 greys on
// (48, 48, 64)), GradientPanel.cs (DrawBackground / DrawBorderShaded), GlassButton.cs (DrawButtonBackground),
// ListViewBase.cs (DataGridView styles), EnhancedTabControl.cs (tab_DrawItem), DataGridViewTextBoxDropShadowCell.cs.

import './originalWindow.css';
import { HUD_FRAME_SIZE, TOP_BASE_SCALE } from './topBar';
import { onSettingsChange, uiScaleFactor } from './settings';
import { autoPauseClose, autoPauseOpen } from './autoPause';

// -------------------------------------------------------------------------------------------------------------------
// Pure helpers (tested)
// -------------------------------------------------------------------------------------------------------------------

/** GenerateFont pixel sizes used across the original's screens. */
export const FONT = {
    tiny: 13.33,
    small: 14,
    normal: 15.33,
    large: 16.67,
    header: 18.67,
    header20: 20,
    title: 22.67,
} as const;

/** Colours of the shared controls (Color.FromArgb values from the sources above). */
export const COLORS = {
    screenBack: 'rgb(48, 48, 64)', // BorderPanel.BackColor
    bodyTop: 'rgb(39, 40, 44)', // GradientPanel BackColor
    bodyMid: 'rgb(22, 21, 26)', // BackColor2
    bodyBottom: 'rgb(51, 54, 61)', // BackColor3
    bodyBorder: 'rgb(67, 67, 77)',
    gridBack: 'rgb(32, 32, 40)', // ListViewBase DefaultCellStyle
    gridAlt: 'rgb(48, 48, 56)', // AlternatingRowsDefaultCellStyle
    gridText: 'rgb(170, 170, 170)',
    gridHeaderBack: 'rgb(24, 24, 24)',
    gridSelBack: 'rgb(96, 96, 96)',
    gridSelText: 'rgb(255, 255, 0)',
    link: 'rgb(255, 192, 0)',
    linkActive: 'rgb(255, 128, 0)',
    label: 'rgb(170, 170, 170)',
    text: 'rgb(200, 200, 200)', // EmpireDetailView _NormalFontColor
    green: 'rgb(144, 238, 144)', // Color.LightGreen
    red: 'rgb(255, 0, 0)',
} as const;

/** Reference height of the HUD scale: topBar.ts topBarScale's factor at a 1080 px tall window. */
const REFERENCE_HEIGHT = 1080;

/** The HUD's scale for a viewport (topBar.ts topBarScale's height term): the original's pixels × this = CSS px. */
export function hudScale(viewportHeight: number, uiScale: number): number {
    return TOP_BASE_SCALE * HUD_FRAME_SIZE * Math.max(0.5, viewportHeight / REFERENCE_HEIGHT) * uiScale;
}

/** The viewport in the original's pixels (the original's Main ClientSize), used for the large / small variants. */
export function originalVirtualSize(viewportWidth: number, viewportHeight: number, uiScale: number): { w: number; h: number } {
    const k = hudScale(viewportHeight, uiScale);
    return { w: Math.floor(viewportWidth / k), h: Math.floor(viewportHeight / k) };
}

/** EmpireDetailView.Kickstart's test (and the other screens' LargeSize switches): a ClientSize of at least w × h. */
export function isLargeScreen(virtual: { w: number; h: number }, minW = 1180, minH = 900): boolean {
    return virtual.w >= minW && virtual.h >= minH;
}

/** Margin kept free around a window (CSS px) when it has to shrink to fit. */
export const FIT_MARGIN = 8;

/** A window's CSS scale: the HUD scale, capped so the `w` × `h` original-pixel window fits the viewport. */
export function originalWindowScale(viewportWidth: number, viewportHeight: number, uiScale: number, w: number, h: number): number {
    const k = hudScale(viewportHeight, uiScale);
    const fit = Math.min((viewportWidth - 2 * FIT_MARGIN) / w, (viewportHeight - 2 * FIT_MARGIN) / h);
    return Math.max(0.2, Math.min(k, fit));
}

/** ScreenPanel.DoLayout: header and body rects for a ScreenPanel of `w` × `h`. */
export function screenPanelLayout(w: number, h: number): { header: Rect; body: Rect; close: Rect } {
    const header = { x: 7, y: 8, w: w - 14, h: 51 };
    const body = { x: 8, y: 51 + 8, w: w - 16, h: h - (51 + 12) };
    // HeaderPanel.DoLayout: btnClose 30 × 30 at (ClientRectangle.Width - 41, 9), header-relative.
    const close = { x: header.w - 41, y: 9, w: 30, h: 30 };
    return { header, body, close };
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** DataGridView automatic sort: stable, ascending or descending, strings case-insensitively. */
export function sortRows<T>(rows: readonly T[], value: ((r: T) => number | string) | undefined, dir: 'asc' | 'desc' | null): T[] {
    const out = rows.slice();
    if (value === undefined || dir === null) return out;
    const sign = dir === 'asc' ? 1 : -1;
    const idx = new Map<T, number>(out.map((r, i) => [r, i]));
    out.sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        let c: number;
        if (typeof va === 'number' && typeof vb === 'number') c = va - vb;
        else c = String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
        return c !== 0 ? c * sign : idx.get(a)! - idx.get(b)!;
    });
    return out;
}

/** Next sort state of a header click: none → asc → desc → asc (DataGridView toggles once sorted). */
export function nextSortDir(current: 'asc' | 'desc' | null): 'asc' | 'desc' {
    return current === 'asc' ? 'desc' : 'asc';
}

/** DataGridViewTextBoxDropShadowCell.Paint: width of the amount bar inside a cell `cellWidth` wide (0 = none). */
export function amountBarWidth(amount: number, maximum: number, cellWidth: number): number {
    if (amount <= 0 || maximum <= 0) return 0;
    return Math.max(1, Math.trunc(amount * ((cellWidth - 4) / maximum)) - 4);
}

/** `rgb()` of a 0xRRGGBB colour, with an optional 0..255 alpha. */
export function rgbCss(rgb: number, alpha = 255): string {
    const r = (rgb >> 16) & 255;
    const g = (rgb >> 8) & 255;
    const b = rgb & 255;
    return alpha >= 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+(alpha / 255).toFixed(3)})`;
}

/** URL of an original chrome image (images/ui/chrome/<file>). */
export function chromeImageUrl(file: string): string {
    return `/assets/dwu/images/ui/chrome/${file}`;
}

// -------------------------------------------------------------------------------------------------------------------
// DOM helpers
// -------------------------------------------------------------------------------------------------------------------

/** Create an element with a class and optional text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (className !== '') e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
}

/** Absolutely position `e` at an original-pixel rect inside its parent (w / h optional). */
export function place<T extends HTMLElement>(e: T, x: number, y: number, w?: number, h?: number): T {
    e.style.position = 'absolute';
    e.style.left = `${x}px`;
    e.style.top = `${y}px`;
    if (w !== undefined) e.style.width = `${w}px`;
    if (h !== undefined) e.style.height = `${h}px`;
    return e;
}

/** Set text only when it changed (keeps selection / avoids layout churn on timer refreshes). */
export function setText(e: HTMLElement, text: string): void {
    if (e.textContent !== text) e.textContent = text;
}

export interface TextOptions {
    size?: number;
    bold?: boolean;
    color?: string;
    /** GraphicsHelper.DrawStringWithDropShadow: a 1 px black copy at (+1, +1). Default true. */
    shadow?: boolean;
    /** Wrap inside this width (MeasureString with a layout width; newlines kept); default: one line. */
    wrapWidth?: number;
    className?: string;
}

/** A label drawn at a point (Graphics.DrawString / DrawStringWithDropShadow). Position it with place(). */
export function text(content: string, o: TextOptions = {}): HTMLDivElement {
    const t = el('div', `ow-text${o.shadow === false ? '' : ' ow-shadow'}${o.className ? ` ${o.className}` : ''}`, content);
    t.style.fontSize = `${o.size ?? FONT.normal}px`;
    if (o.bold) t.style.fontWeight = 'bold';
    if (o.color) t.style.color = o.color;
    if (o.wrapWidth !== undefined) {
        // DrawString in a layout rectangle: wraps at the width and keeps the text's own line breaks.
        t.style.whiteSpace = 'pre-line';
        t.style.width = `${o.wrapWidth}px`;
    }
    return t;
}

/** A label at (x, y) in its parent's original pixels. */
export function dropText(parent: HTMLElement, content: string, x: number, y: number, o: TextOptions = {}): HTMLDivElement {
    const t = place(text(content, o), x, y);
    parent.appendChild(t);
    return t;
}

/**
 * EmpireDetailView's stat line: the label (normal font) right-aligned so it ends at `labelRight`, the value (bold) at
 * labelRight + 5, two pixels higher. Returns the value element (for in-place updates).
 */
export function valueRow(parent: HTMLElement, label: string, value: string, labelRight: number, y: number, o: { size?: number; color?: string; valueColor?: string } = {}): HTMLDivElement {
    const size = o.size ?? FONT.normal;
    const l = text(label, { size, color: o.color ?? COLORS.text });
    l.classList.add('ow-right');
    place(l, labelRight, y);
    const v = text(value, { size, bold: true, color: o.valueColor ?? o.color ?? COLORS.text });
    place(v, labelRight + 5, y - 2);
    parent.append(l, v);
    return v;
}

export type CornerSet = { tl?: boolean; tr?: boolean; br?: boolean; bl?: boolean };

export interface GradientPanelOptions {
    /** BackColor, BackColor2, BackColor3 (vertical, stops 0 / 0.5 / 1). Default the screen body colours. */
    colors?: [string, string, string];
    /** CornerCurveMode as a set of curved corners; default none. */
    corners?: CornerSet;
    /** Curvature (px). Default 20. */
    radius?: number;
    /** BorderColor; null = BorderStyle.None. Default (67, 67, 77). */
    border?: string | null;
    /** BorderWidth. Default 2. */
    borderWidth?: number;
    className?: string;
}

/** GradientPanel (DrawBackground + DrawBorderShaded: top light, left base, right dark, bottom darker). */
export function gradientPanel(o: GradientPanelOptions = {}): HTMLDivElement {
    const p = el('div', `ow-gradient${o.className ? ` ${o.className}` : ''}`);
    const [c1, c2, c3] = o.colors ?? [COLORS.bodyTop, COLORS.bodyMid, COLORS.bodyBottom];
    p.style.background = `linear-gradient(to bottom, ${c1} 0%, ${c2} 50%, ${c3} 100%)`;
    const r = o.radius ?? 20;
    const c = o.corners ?? {};
    p.style.borderRadius = `${c.tl ? r : 0}px ${c.tr ? r : 0}px ${c.br ? r : 0}px ${c.bl ? r : 0}px`;
    if (o.border !== null) {
        const base = o.border ?? COLORS.bodyBorder;
        p.style.borderStyle = 'solid';
        p.style.borderWidth = `${o.borderWidth ?? 2}px`;
        // ControlPaint.Light / Dark / DarkDark of the border colour.
        p.style.borderColor = `color-mix(in srgb, ${base} 60%, white) color-mix(in srgb, ${base} 55%, black) color-mix(in srgb, ${base} 20%, black) ${base}`;
    }
    return p;
}

/** EmpireDetailView's section block: FillRectangle(Color.FromArgb(96, 0, 0, 0), rect). */
export function darkRect(alpha = 96): HTMLDivElement {
    const d = el('div', 'ow-dark');
    d.style.background = `rgba(0, 0, 0, ${+(alpha / 255).toFixed(3)})`;
    return d;
}

export interface GlassButtonOptions {
    onClick?: (e: MouseEvent) => void;
    /** Rounded corners (SetCornerCurves); default all four. */
    corners?: CornerSet;
    title?: string;
    disabled?: boolean;
    /** ToggledOn: drawn hovered (glow + white text). */
    toggled?: boolean;
    /** Chrome image file (images/ui/chrome/...) drawn centred. */
    image?: string;
    size?: number;
    bold?: boolean;
    className?: string;
    /** SetBackColor / OuterBorderColor / ShineColor / GlowColor (0xRRGGBB): the glass fill is the outer border colour
     *  (GlassButton.DrawButtonBackground fills with it). */
    colors?: GlassColors;
    /** GlassButton.MinorText: a second, centred line in the font 2 px smaller, regular (DrawText). */
    minorText?: string;
}

export interface GlassColors {
    outer?: number;
    shine?: number;
    glow?: number;
    inner?: number;
}

const rgbTriple = (c: number): string => `${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}`;

/** Recolour a glass button (GlassButton.SetBackColor / SetOuterBorderColor / SetShineColor / GlowColor). */
export function setGlassColors(b: HTMLElement, c: GlassColors): void {
    if (c.outer !== undefined) b.style.setProperty('--outer', rgbCss(c.outer));
    if (c.shine !== undefined) b.style.setProperty('--shine', rgbTriple(c.shine));
    if (c.glow !== undefined) b.style.setProperty('--glow', rgbTriple(c.glow));
    if (c.inner !== undefined) b.style.setProperty('--inner', rgbCss(c.inner));
}

/** GlassButton: (0, 0, 16) glass, (112, 112, 128) shine on the top half, (48, 48, 128) glow from the bottom on hover,
 *  inner border (67, 67, 77), text (120, 120, 120) fading to white on hover. Radius 7. */
export function glassButton(label: string, o: GlassButtonOptions = {}): HTMLButtonElement {
    const b = el('button', `ow-glass${o.toggled ? ' ow-glass-on' : ''}${o.className ? ` ${o.className}` : ''}`);
    b.type = 'button';
    const c = o.corners ?? { tl: true, tr: true, br: true, bl: true };
    b.style.borderRadius = `${c.tl ? 7 : 0}px ${c.tr ? 7 : 0}px ${c.br ? 7 : 0}px ${c.bl ? 7 : 0}px`;
    if (o.image) {
        const img = el('img');
        img.src = chromeImageUrl(o.image);
        img.alt = '';
        img.draggable = false;
        b.appendChild(img);
    }
    if (o.minorText !== undefined) {
        // DrawText: the text and the minor text centred as a block, one pixel apart.
        b.classList.add('ow-glass-minor');
        const col = el('span', 'ow-glass-lines');
        col.append(el('span', 'ow-glass-text', label), el('span', 'ow-glass-minortext', o.minorText));
        b.appendChild(col);
    } else if (label !== '') b.appendChild(el('span', 'ow-glass-text', label));
    if (o.colors) setGlassColors(b, o.colors);
    b.style.fontSize = `${o.size ?? FONT.normal}px`;
    if (o.bold !== false) b.style.fontWeight = 'bold';
    if (o.title) b.title = o.title;
    b.disabled = o.disabled === true;
    if (o.onClick) {
        const fn = o.onClick;
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            fn(e);
        });
    }
    return b;
}

/** Change a glass button's label in place. */
export function setButtonLabel(b: HTMLButtonElement, label: string): void {
    const t = b.querySelector<HTMLElement>('.ow-glass-text');
    if (t) setText(t, label);
    else b.appendChild(el('span', 'ow-glass-text', label));
}

/** Change a glass button's minor text in place (buttons made with `minorText`). */
export function setButtonMinorText(b: HTMLButtonElement, text: string): void {
    const t = b.querySelector<HTMLElement>('.ow-glass-minortext');
    if (t) setText(t, text);
}

/** LinkLabel: (255, 192, 0), (255, 128, 0) while pressed, underline on hover (LinkBehavior.HoverUnderline). */
export function linkLabel(label: string, onClick: () => void, size: number = FONT.normal): HTMLAnchorElement {
    const a = el('a', 'ow-link', label);
    a.href = '#';
    a.style.fontSize = `${size}px`;
    a.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    });
    return a;
}

/** A scrolling region (the original's panels with AutoScroll) with the dark scrollbar. */
export function scrollPanel(className = ''): HTMLDivElement {
    return el('div', `ow-scroll${className ? ` ${className}` : ''}`);
}

/** The amount bar of DataGridViewTextBoxDropShadowCell: a horizontal gradient of the text colour from alpha 32 to 128,
 *  3 px inset top and bottom. Position it under the cell's text. */
export function barGraph(amount: number, maximum: number, cellWidth: number, cellHeight: number, color: string): HTMLDivElement {
    const bar = el('div', 'ow-bar');
    const w = amountBarWidth(amount, maximum, cellWidth);
    place(bar, 0, 3, w, Math.max(0, cellHeight - 6));
    bar.style.background = `linear-gradient(to right, color-mix(in srgb, ${color} 12.5%, transparent), color-mix(in srgb, ${color} 50%, transparent))`;
    if (w === 0) bar.style.display = 'none';
    return bar;
}

/** A combo box in the original's (48, 48, 64) / (170, 170, 170) colours. */
export function dropDown(options: readonly { value: string; label: string }[], value: string, onChange: (v: string) => void, title = ''): HTMLSelectElement {
    const s = el('select', 'ow-input ow-select');
    for (const o of options) {
        const opt = el('option', '', o.label);
        opt.value = o.value;
        s.appendChild(opt);
    }
    s.value = value;
    if (title) s.title = title;
    s.addEventListener('change', () => onChange(s.value));
    s.addEventListener('keydown', (e) => e.stopPropagation());
    return s;
}

/** A text box in the input colours (keys do not reach the game's hotkeys while it has focus). */
export function textBox(value: string, placeholder: string, onInput: (v: string) => void): HTMLInputElement {
    const i = el('input', 'ow-input ow-textbox');
    i.type = 'text';
    i.value = value;
    i.placeholder = placeholder;
    i.autocomplete = 'off';
    i.spellcheck = false;
    i.addEventListener('input', () => onInput(i.value));
    i.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') e.stopPropagation();
    });
    return i;
}

/** A check box with its label (DistantWorlds.Controls CheckBox: (170, 170, 170) text). */
export function checkBox(label: string, checked: boolean, onChange: ((v: boolean) => void) | null, size: number = FONT.normal): HTMLLabelElement {
    const l = el('label', 'ow-check');
    l.style.fontSize = `${size}px`;
    const c = el('input');
    c.type = 'checkbox';
    c.checked = checked;
    c.disabled = onChange === null;
    if (onChange) c.addEventListener('change', () => onChange(c.checked));
    l.append(c, el('span', '', label));
    return l;
}

export interface TabSpec {
    id: string;
    label: string;
}

/** EnhancedTabControl's tab strip: (128, 128, 144) frame, (64, 64, 80) tabs with white text, the selected tab
 *  (48, 48, 64) with yellow text, a 5 px (64, 64, 80) bar under the row. Returns the strip (21 px tabs + 5 px bar). */
export function tabStrip(tabs: readonly TabSpec[], selected: string, onChange: (id: string) => void, tabWidth?: number): HTMLDivElement {
    const strip = el('div', 'ow-tabs');
    for (const t of tabs) {
        const b = el('button', `ow-tab${t.id === selected ? ' ow-tab-on' : ''}`, t.label);
        b.type = 'button';
        if (tabWidth !== undefined) b.style.width = `${tabWidth}px`;
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (t.id === selected) return;
            selected = t.id;
            for (const x of strip.querySelectorAll('.ow-tab')) x.classList.toggle('ow-tab-on', x === b);
            onChange(t.id);
        });
        strip.appendChild(b);
    }
    strip.appendChild(el('div', 'ow-tabs-bar'));
    return strip;
}

// -------------------------------------------------------------------------------------------------------------------
// Grid (DataGridView via ListViewBase)
// -------------------------------------------------------------------------------------------------------------------

export interface GridColumn<T> {
    id: string;
    header: string;
    /** Width in original px; omit for a fill column (FillWeight `fill`, default 1). */
    width?: number;
    fill?: number;
    align?: 'left' | 'center' | 'right';
    /** Sort key (DataGridViewColumnSortMode.Automatic); omit for NotSortable. */
    sort?: (row: T) => number | string;
    /** Fill the cell (text or nodes). */
    render: (row: T, cell: HTMLDivElement) => void;
    title?: string;
    /** DataGridView.CellClick on this column (after the row selection updated). */
    onClick?: (row: T, e: MouseEvent) => void;
}

export interface GridOptions<T> {
    columns: GridColumn<T>[];
    key: (row: T) => unknown;
    /** RowTemplate.Height; default 20. */
    rowHeight?: number;
    /** ColumnHeadersVisible; default true. */
    headers?: boolean;
    /** Cell colours (default the ListViewBase ones). */
    rowBack?: string;
    rowAltBack?: string;
    onSelect?: (row: T) => void;
    onDoubleClick?: (row: T) => void;
    /** Extra class per row (e.g. the player's row). */
    rowClass?: (row: T) => string;
    empty?: string;
    fontSize?: number;
    /** DataGridView.MultiSelect: Ctrl+click toggles a row, Shift+click selects the range from the anchor
     *  (Ctrl+Shift adds it); `selectAll()` for Ctrl+A. Default false (full-row single selection). */
    multiSelect?: boolean;
    /** SelectionChanged: the selected rows (display order) after a click changed them. */
    onSelectionChange?: (rows: T[]) => void;
}

/** Next selection of a DataGridView click (MultiSelect semantics, keys in display order): a plain click selects one
 *  row, Ctrl toggles it, Shift selects the range from the anchor (Ctrl+Shift adds the range). Returns the new
 *  selection and anchor; without `multi` every click is a plain click. */
export function gridClickSelection<K>(
    keys: readonly K[],
    selected: ReadonlySet<K>,
    anchor: K | undefined,
    key: K,
    mods: { ctrl?: boolean; shift?: boolean },
    multi: boolean,
): { selected: Set<K>; anchor: K | undefined } {
    const a = anchor === undefined ? -1 : keys.indexOf(anchor);
    const i = keys.indexOf(key);
    if (multi && mods.shift && a >= 0 && i >= 0) {
        const out = mods.ctrl ? new Set(selected) : new Set<K>();
        for (let j = Math.min(a, i); j <= Math.max(a, i); j++) out.add(keys[j]);
        return { selected: out, anchor };
    }
    if (multi && mods.ctrl) {
        const out = new Set(selected);
        if (out.has(key)) out.delete(key);
        else out.add(key);
        return { selected: out, anchor: key };
    }
    return { selected: new Set([key]), anchor: key };
}

/** A DataGridView in ListViewBase's styles: header (24, 24, 24) / (170, 170, 170), rows alternating (32, 32, 40) and
 *  (48, 48, 56), (170, 170, 170) text, the selected row (96, 96, 96) with yellow text, full-row selection (single, or
 *  `multiSelect`), vertical scrollbar, click a header to sort (when the column has a sort key). */
export class OwGrid<T> {
    readonly el: HTMLDivElement;
    readonly body: HTMLDivElement;
    private readonly head: HTMLDivElement | null;
    private rows: T[] = [];
    private selectedKeys = new Set<unknown>();
    private anchorKey: unknown = undefined;
    private rowEls = new Map<unknown, HTMLElement>();
    private sortCol: string | null = null;
    private sortDir: 'asc' | 'desc' | null = null;

    constructor(private readonly o: GridOptions<T>) {
        this.el = el('div', 'ow-grid');
        this.el.style.fontSize = `${o.fontSize ?? FONT.normal}px`;
        if (o.rowBack) this.el.style.setProperty('--ow-row', o.rowBack);
        if (o.rowAltBack) this.el.style.setProperty('--ow-row-alt', o.rowAltBack);
        this.el.style.setProperty('--ow-row-h', `${o.rowHeight ?? 20}px`);
        const template = o.columns.map((c) => (c.width !== undefined ? `${c.width}px` : `minmax(0, ${c.fill ?? 1}fr)`)).join(' ');
        this.el.style.setProperty('--ow-cols', template);
        this.head = o.headers === false ? null : el('div', 'ow-grid-head');
        if (this.head) {
            for (const c of o.columns) {
                const h = el('div', `ow-grid-hcell ow-align-${c.align ?? 'left'}${c.sort ? ' ow-sortable' : ''}`, c.header);
                if (c.title) h.title = c.title;
                if (c.sort) {
                    h.addEventListener('click', () => {
                        this.sortDir = this.sortCol === c.id ? nextSortDir(this.sortDir) : 'asc';
                        this.sortCol = c.id;
                        this.render();
                    });
                }
                this.head.appendChild(h);
            }
            this.el.appendChild(this.head);
        }
        this.body = el('div', 'ow-grid-body ow-scroll');
        this.el.appendChild(this.body);
    }

    /** The (first, in display order) selected row. */
    get selected(): T | null {
        return this.displayed.find((r) => this.selectedKeys.has(this.o.key(r))) ?? null;
    }

    /** Every selected row, in display order (DataGridView.SelectedRows). */
    get selectedRows(): T[] {
        return this.displayed.filter((r) => this.selectedKeys.has(this.o.key(r)));
    }

    /** Select exactly these rows (no callbacks); keys not in the grid are dropped. */
    setSelection(keys: readonly unknown[], scroll = false): void {
        const present = new Set(this.rows.map((r) => this.o.key(r)));
        this.selectedKeys = new Set(keys.filter((k) => present.has(k)));
        if (!this.selectedKeys.has(this.anchorKey)) this.anchorKey = keys.find((k) => present.has(k));
        this.paintSelection(scroll);
    }

    /** Ctrl+A on a MultiSelect grid. */
    selectAll(): void {
        if (!this.o.multiSelect) return;
        this.selectedKeys = new Set(this.rows.map((r) => this.o.key(r)));
        this.paintSelection(false);
        this.o.onSelectionChange?.(this.selectedRows);
    }

    private paintSelection(scroll: boolean): void {
        for (const [k, r] of this.rowEls) r.classList.toggle('ow-sel', this.selectedKeys.has(k));
        if (scroll) this.scrollToSelected();
    }

    private scrollToSelected(): void {
        const r = this.body.querySelector<HTMLElement>('.ow-grid-row.ow-sel');
        if (r) {
            const top = r.offsetTop;
            if (top < this.body.scrollTop || top + r.offsetHeight > this.body.scrollTop + this.body.clientHeight) this.body.scrollTop = top;
        }
    }

    /** DataGridView.SelectedRows (same as `selectedRows`). */
    get selectedAll(): T[] {
        return this.selectedRows;
    }

    /** The rows in display order (after sorting). */
    get displayed(): T[] {
        const col = this.o.columns.find((c) => c.id === this.sortCol);
        return sortRows(this.rows, col?.sort, this.sortDir);
    }

    setRows(rows: readonly T[]): void {
        this.rows = rows.slice();
        this.render();
    }

    /** Select the row with this key (no onSelect call) and scroll it into view (FirstDisplayedScrollingRowIndex). */
    select(key: unknown, scroll = true): void {
        this.selectedKeys = new Set([key]);
        this.anchorKey = key;
        this.render();
        if (scroll) this.scrollToSelected();
    }

    render(): void {
        const scroll = this.body.scrollTop;
        this.body.replaceChildren();
        if (this.head) {
            this.o.columns.forEach((c, i) => {
                const h = this.head!.children[i] as HTMLElement;
                h.classList.toggle('ow-sort-asc', this.sortCol === c.id && this.sortDir === 'asc');
                h.classList.toggle('ow-sort-desc', this.sortCol === c.id && this.sortDir === 'desc');
            });
        }
        const rows = this.displayed;
        const keys = rows.map((row) => this.o.key(row));
        this.rowEls.clear();
        if (rows.length === 0 && this.o.empty) this.body.appendChild(el('div', 'ow-grid-empty', this.o.empty));
        rows.forEach((row, i) => {
            const key = keys[i];
            const extra = this.o.rowClass?.(row) ?? '';
            const r = el('div', `ow-grid-row${i % 2 === 1 ? ' ow-alt' : ''}${this.selectedKeys.has(key) ? ' ow-sel' : ''}${extra ? ` ${extra}` : ''}`);
            this.rowEls.set(key, r);
            const cellClicks: [HTMLDivElement, (row: T, e: MouseEvent) => void][] = [];
            for (const c of this.o.columns) {
                const cell = el('div', `ow-grid-cell ow-align-${c.align ?? 'left'}`);
                c.render(row, cell);
                if (c.onClick) {
                    cell.classList.add('ow-hot');
                    cellClicks.push([cell, c.onClick]);
                }
                r.appendChild(cell);
            }
            // No text selection while Shift-selecting a range.
            if (this.o.multiSelect) r.addEventListener('mousedown', (e) => { if (e.shiftKey) e.preventDefault(); });
            r.addEventListener('click', (e) => {
                const next = gridClickSelection(keys, this.selectedKeys, this.anchorKey, key, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, this.o.multiSelect === true);
                this.selectedKeys = next.selected;
                this.anchorKey = next.anchor;
                this.paintSelection(false);
                this.o.onSelect?.(row);
                this.o.onSelectionChange?.(this.selectedRows);
                for (const [cell, fn] of cellClicks) if (cell.contains(e.target as Node)) fn(row, e);
            });
            r.dataset.i = String(i);
            if (this.o.onDoubleClick) r.addEventListener('dblclick', () => this.o.onDoubleClick!(row));
            this.body.appendChild(r);
        });
        this.body.scrollTop = scroll;
    }
}

// -------------------------------------------------------------------------------------------------------------------
// The window (ScreenPanel)
// -------------------------------------------------------------------------------------------------------------------

export interface OriginalWindowOptions {
    /** Short id: the window gets `ow-screen-<id>` and `data-ow="<id>"`. */
    id: string;
    title: string;
    /** HeaderIcon: a chrome image file (images/ui/chrome/<icon>), e.g. 'diplomacy.png'. */
    icon?: string;
    /** HeaderIcon as any image URL (e.g. the player's LargeFlagPicture as a data URL); wins over `icon`. Set it
     *  later with `win.setIcon(url)` (an async flag). */
    iconUrl?: string;
    /** ScreenPanel Size in the original's pixels. */
    width: number;
    height: number;
    /** No HeaderPanel: a bare BorderPanel whose body is the whole client area inside the 3 px border (e.g. the
     *  diplomacy talk panel). */
    headerless?: boolean;
    /** Called after the window is removed (close button, Escape or close()). */
    onClose?: () => void;
    /** Default true. */
    escapeCloses?: boolean;
    /** Opt out of pausing the game while open (AutoPauseWhenInPopupWindow). Default false. */
    noAutoPause?: boolean;
    /** Pause the game while open even with AutoPauseWhenInPopupWindow off (the event panel's method_154). Default false. */
    forcePause?: boolean;
    /** Called when the viewport or the UI scale changes, after the window re-scaled (re-pick large / small layouts). */
    onResize?: (win: OriginalWindow) => void;
    /** Where the scaled window's top-left corner goes (CSS px) instead of the viewport centre — for a ScreenPanel the
     *  source places itself (e.g. pnlColonyInvasion beside the selection panel, Main.Part11.cs method_164). */
    anchor?: (viewport: { w: number; h: number }, size: { w: number; h: number }, scale: number) => { left: number; top: number };
}

export interface OriginalWindow {
    /** The full-screen layer holding the window. */
    readonly root: HTMLDivElement;
    /** The ScreenPanel (BorderPanel), sized in original pixels and scaled as one. */
    readonly frame: HTMLDivElement;
    /** pnlBody (GradientPanel): lay the screen's controls out in it, in body-relative original pixels. */
    readonly body: HTMLDivElement;
    /** pnlHeader (null when headerless): for controls the source parents to the header (e.g. a filter combo), placed
     *  in header-relative original pixels. */
    readonly header: HTMLDivElement | null;
    /** Body size in original pixels. */
    readonly bodySize: { w: number; h: number };
    /** The viewport in original pixels (for the large / small variants). */
    readonly virtualSize: { w: number; h: number };
    readonly scale: number;
    setTitle(title: string): void;
    /** Change the HeaderIcon to an image URL (creates it when the window was opened without an icon). */
    setIcon(url: string): void;
    /** Resize the ScreenPanel (original pixels) and re-centre it. */
    setSize(width: number, height: number): void;
    close(): void;
    readonly closed: boolean;
}

const openWindows: { win: OriginalWindow; escape: boolean }[] = [];
let keyListening = false;

function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    const top = [...openWindows].reverse().find((w) => w.escape);
    if (!top) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    top.win.close();
}

/** Close every open original-style window (e.g. on returning to the main menu). */
export function closeAllOriginalWindows(): void {
    for (const w of [...openWindows]) w.win.close();
}

/** Open a ScreenPanel-style window centred on the viewport. See the guide at the top of this file. */
export function openOriginalWindow(o: OriginalWindowOptions): OriginalWindow {
    const root = el('div', 'ow-layer');
    const frame = el('div', `ow-screen ow-screen-${o.id}`);
    frame.dataset.ow = o.id;
    const headerEl = o.headerless ? null : el('div', 'ow-header');
    const titleEl = el('div', 'ow-title');
    let iconEl: HTMLImageElement | null = null;
    if (headerEl) {
        if (o.icon || o.iconUrl) {
            iconEl = el('img', 'ow-header-icon');
            iconEl.src = o.iconUrl ?? chromeImageUrl(o.icon!);
            iconEl.alt = '';
            iconEl.draggable = false;
            headerEl.appendChild(iconEl);
        } else titleEl.style.left = '10px';
        headerEl.appendChild(titleEl);
        const closeBtn = el('button', 'ow-close');
        closeBtn.type = 'button';
        closeBtn.title = 'Close';
        closeBtn.innerHTML =
            '<svg viewBox="0 0 30 30" width="30" height="30" aria-hidden="true"><rect x="2" y="2" width="26" height="26" rx="8" ry="8"/>' +
            '<path class="ow-close-x" d="M8 8 L22 22 M8 22 L22 8"/></svg>';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            win.close();
        });
        headerEl.appendChild(closeBtn);
        frame.appendChild(headerEl);
    }
    // A headerless BorderPanel has no body panel of its own: a plain area the caller fills.
    const body = o.headerless ? el('div', 'ow-body ow-plain') : gradientPanel({ corners: { br: true, bl: true }, className: 'ow-body' });
    frame.appendChild(body);
    root.appendChild(frame);
    document.body.appendChild(root);

    let w = o.width;
    let h = o.height;
    let dragDx = 0;
    let dragDy = 0;
    const bodySize = { w: 0, h: 0 };
    const virtualSize = { w: 0, h: 0 };
    let scale = 1;
    let closed = false;

    const layout = (): void => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const ui = uiScaleFactor();
        scale = originalWindowScale(vw, vh, ui, w, h);
        const v = originalVirtualSize(vw, vh, ui);
        virtualSize.w = v.w;
        virtualSize.h = v.h;
        frame.style.width = `${w}px`;
        frame.style.height = `${h}px`;
        const at = o.anchor?.({ w: vw, h: vh }, { w, h }, scale) ?? { left: (vw - w * scale) / 2, top: (vh - h * scale) / 2 };
        const left = Math.round(at.left + dragDx);
        const top = Math.round(at.top + dragDy);
        frame.style.left = `${left}px`;
        frame.style.top = `${top}px`;
        frame.style.transform = scale === 1 ? '' : `scale(${scale})`;
        if (headerEl) {
            const l = screenPanelLayout(w, h);
            place(headerEl, l.header.x, l.header.y, l.header.w, l.header.h);
            place(body, l.body.x, l.body.y, l.body.w, l.body.h);
            bodySize.w = l.body.w;
            bodySize.h = l.body.h;
        } else {
            // A headerless BorderPanel: the body fills the client area (the caller places its own panels).
            place(body, 3, 3, w - 6, h - 6);
            bodySize.w = w - 6;
            bodySize.h = h - 6;
        }
    };

    // ScreenPanel.HeaderDragStart / Move: drag the window by its header.
    if (headerEl) {
        headerEl.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest('.ow-close, select, input, button')) return;
            const sx = e.clientX - dragDx;
            const sy = e.clientY - dragDy;
            headerEl.setPointerCapture(e.pointerId);
            const move = (m: PointerEvent): void => {
                dragDx = m.clientX - sx;
                dragDy = m.clientY - sy;
                layout();
            };
            const up = (): void => {
                headerEl.removeEventListener('pointermove', move);
                headerEl.removeEventListener('pointerup', up);
                headerEl.removeEventListener('pointercancel', up);
            };
            headerEl.addEventListener('pointermove', move);
            headerEl.addEventListener('pointerup', up);
            headerEl.addEventListener('pointercancel', up);
        });
    }

    const onResize = (): void => {
        layout();
        o.onResize?.(win);
    };

    const win: OriginalWindow = {
        root,
        frame,
        body,
        header: headerEl,
        bodySize,
        virtualSize,
        get scale() {
            return scale;
        },
        get closed() {
            return closed;
        },
        setTitle(t: string) {
            setText(titleEl, t);
        },
        setIcon(url: string) {
            if (!headerEl) return;
            if (iconEl === null) {
                iconEl = el('img', 'ow-header-icon');
                iconEl.alt = '';
                iconEl.draggable = false;
                headerEl.insertBefore(iconEl, headerEl.firstChild);
                titleEl.style.left = '';
            }
            if (iconEl.src !== url) iconEl.src = url;
        },
        setSize(nw: number, nh: number) {
            w = nw;
            h = nh;
            layout();
        },
        close() {
            if (closed) return;
            closed = true;
            window.removeEventListener('resize', onResize);
            const i = openWindows.findIndex((x) => x.win === win);
            if (i >= 0) openWindows.splice(i, 1);
            root.remove();
            if (!o.noAutoPause) autoPauseClose();
            o.onClose?.();
        },
    };
    win.setTitle(o.title);
    layout();
    window.addEventListener('resize', onResize);
    openWindows.push({ win, escape: o.escapeCloses !== false });
    if (!o.noAutoPause) autoPauseOpen(o.forcePause === true);
    if (!keyListening) {
        keyListening = true;
        document.addEventListener('keydown', onKeyDown);
        // The UI scale slider re-scales every open window. (The module function itself: an arrow here would capture
        // this first window's scope — its options, its screen, the game — for the rest of the session.)
        onSettingsChange(relayoutAllOnSettings);
    }
    // Bring to front on click (several screens can be open, like the original's BringToFront).
    // The windows above this one move below it instead of this one moving to the end: re-inserting the pressed
    // window's own nodes during pointerdown cancels the click on its button (and closes a select as it opens).
    frame.addEventListener('pointerdown', () => {
        for (let n = root.nextSibling; n !== null; ) {
            const next = n.nextSibling;
            if (n instanceof HTMLElement && n.classList.contains('ow-layer')) document.body.insertBefore(n, root);
            n = next;
        }
        const i = openWindows.findIndex((x) => x.win === win);
        if (i >= 0 && i !== openWindows.length - 1) openWindows.push(...openWindows.splice(i, 1));
    });
    return win;
}

/** Re-scale every open window (the UI scale setting changed). */
function relayoutAllOnSettings(): void {
    relayoutOriginalWindows();
}

export function relayoutOriginalWindows(): void {
    window.dispatchEvent(new Event('resize'));
}

// -------------------------------------------------------------------------------------------------------------------
// Message box (MessageBoxEx)
// -------------------------------------------------------------------------------------------------------------------

export interface MessageBoxOptions {
    caption: string;
    text: string;
    /** Button labels left to right (MessageBoxExButtons.Yes / No / Ok …). Default ['OK']. */
    buttons?: string[];
    /** The button Enter presses (default the first). Escape resolves null. */
    defaultButton?: string;
    /** MessageBoxExIcon: Question / Warning / Stop (drawn as a glyph left of the text). */
    icon?: 'question' | 'warning' | 'stop' | 'information';
    /** Window width in original pixels (default 460). */
    width?: number;
    /** Each button's width in original pixels (default 100). */
    buttonWidth?: number;
}

const MESSAGE_ICON: Record<NonNullable<MessageBoxOptions['icon']>, string> = { question: '?', warning: '!', stop: '\u2716', information: 'i' };

/** MessageBoxExManager.CreateMessageBox(…).Show(): a small ScreenPanel with the caption as its title, the text (newlines
 *  kept) and glass buttons along the bottom. Resolves the clicked button's label, or null (closed / Escape). */
export function messageBox(o: MessageBoxOptions): Promise<string | null> {
    return new Promise((resolve) => {
        const width = o.width ?? 460;
        const buttons = o.buttons ?? ['OK'];
        let result: string | null = null;
        const win = openOriginalWindow({
            id: 'msgbox',
            title: o.caption,
            width,
            height: 200,
            onClose: () => {
                document.removeEventListener('keydown', onKey, true);
                resolve(result);
            },
        });
        win.root.classList.add('ow-modal');
        const iconW = o.icon ? 44 : 0;
        if (o.icon) {
            const ic = el('div', `ow-msg-icon ow-msg-icon-${o.icon}`, MESSAGE_ICON[o.icon]);
            win.body.appendChild(place(ic, 14, 14, 30, 30));
        }
        const t = text(o.text, { size: FONT.normal, color: COLORS.text, wrapWidth: win.bodySize.w - 28 - iconW });
        t.classList.add('ow-msg-text');
        win.body.appendChild(place(t, 14 + iconW, 14));
        const textH = Math.max(o.icon ? 30 : 0, t.offsetHeight || 60);
        const bw = o.buttonWidth ?? 100;
        const gap = 10;
        const height = 59 + 4 + 14 + textH + 16 + 30 + 14;
        win.setSize(width, height);
        const by = win.bodySize.h - 14 - 30;
        let bx = Math.round((win.bodySize.w - (buttons.length * bw + (buttons.length - 1) * gap)) / 2);
        const finish = (label: string | null): void => {
            result = label;
            win.close();
        };
        let defaultBtn: HTMLButtonElement | null = null;
        for (const label of buttons) {
            const b = glassButton(label, { onClick: () => finish(label) });
            win.body.appendChild(place(b, bx, by, bw, 30));
            if (label === (o.defaultButton ?? buttons[0])) defaultBtn = b;
            bx += bw + gap;
        }
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopImmediatePropagation();
                finish(o.defaultButton ?? buttons[0]);
            }
        };
        document.addEventListener('keydown', onKey, true);
        defaultBtn?.focus();
    });
}

// -------------------------------------------------------------------------------------------------------------------
// NumericUpDown and the owner-drawn image combo (DesignDropDown / ResourceDropDown …)
// -------------------------------------------------------------------------------------------------------------------

/** NumericUpDown.Value semantics: an integer clamped to [min, max]; non-numbers → min. */
export function clampSpinValue(v: unknown, min: number, max: number): number {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.trunc(n)));
}

export interface NumericUpDownOptions {
    value: number;
    min: number;
    max: number;
    /** ValueChanged (after clamping). */
    onChange?: (v: number) => void;
    size?: number;
    /** TextAlign; default center. */
    align?: 'left' | 'center' | 'right';
}

export interface NumericUpDown {
    readonly el: HTMLDivElement;
    readonly input: HTMLInputElement;
    get value(): number;
    /** Set the value (clamped) without firing onChange. */
    setValue(v: number): void;
    setEnabled(enabled: boolean): void;
    /** ForeColor / Font.Bold (e.g. the Build Order's yellow bold spinners). */
    setStyle(color: string, bold: boolean): void;
}

/** A WinForms NumericUpDown: a text box with the up / down buttons on the right. Arrow keys / wheel step by 1;
 *  typing commits on change / blur (clamped, like the control on leave); Enter selects the text (method_635). */
export function numericUpDown(o: NumericUpDownOptions): NumericUpDown {
    const wrap = el('div', 'ow-spin');
    const input = el('input', 'ow-spin-input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.fontSize = `${o.size ?? FONT.normal}px`;
    input.style.textAlign = o.align ?? 'center';
    const up = el('button', 'ow-spin-btn ow-spin-up');
    const down = el('button', 'ow-spin-btn ow-spin-down');
    up.type = down.type = 'button';
    up.tabIndex = down.tabIndex = -1;
    wrap.append(input, up, down);
    let value = clampSpinValue(o.value, o.min, o.max);
    input.value = String(value);
    const commit = (v: unknown): void => {
        const n = clampSpinValue(v, o.min, o.max);
        if (input.value !== String(n)) input.value = String(n);
        if (n === value) return;
        value = n;
        o.onChange?.(n);
    };
    input.addEventListener('input', () => {
        // Live totals while typing (the control raises ValueChanged on each valid edit).
        const t = input.value.trim();
        if (t === '' || !/^\d+$/.test(t)) return;
        const n = clampSpinValue(t, o.min, o.max);
        if (n !== value) {
            value = n;
            o.onChange?.(n);
        }
    });
    input.addEventListener('change', () => commit(input.value));
    input.addEventListener('blur', () => commit(input.value));
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') return;
        e.stopPropagation();
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            commit(value + 1);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            commit(value - 1);
        } else if (e.key === 'Enter') commit(input.value);
    });
    input.addEventListener(
        'wheel',
        (e) => {
            if (document.activeElement !== input) return;
            e.preventDefault();
            commit(value + (e.deltaY < 0 ? 1 : -1));
        },
        { passive: false },
    );
    // Hold to repeat, like the control's UpDownButtons timer.
    const hold = (b: HTMLButtonElement, step: number): void => {
        let t: number | undefined;
        const stop = (): void => {
            window.clearTimeout(t);
            window.clearInterval(t);
        };
        b.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || input.disabled) return;
            e.preventDefault();
            e.stopPropagation();
            commit(value + step);
            t = window.setTimeout(() => {
                t = window.setInterval(() => commit(value + step), 60);
            }, 400);
        });
        b.addEventListener('pointerup', stop);
        b.addEventListener('pointerleave', stop);
        b.addEventListener('click', (e) => e.stopPropagation());
    };
    hold(up, 1);
    hold(down, -1);
    return {
        el: wrap,
        input,
        get value() {
            return value;
        },
        setValue(v: number) {
            value = clampSpinValue(v, o.min, o.max);
            if (input.value !== String(value)) input.value = String(value);
        },
        setEnabled(enabled: boolean) {
            input.disabled = !enabled;
            up.disabled = !enabled;
            down.disabled = !enabled;
            wrap.classList.toggle('ow-disabled', !enabled);
        },
        setStyle(color: string, bold: boolean) {
            input.style.color = color;
            input.style.fontWeight = bold ? 'bold' : 'normal';
        },
    };
}

/** One picture of an owner-drawn combo item, drawn `height` tall at `x` (OnDrawItem's DrawImage rects). */
export interface ImageComboPicture {
    url: string | Promise<string | null> | null;
    x: number;
    /** Keep a square box (ship pictures); default false: width follows the image's aspect. */
    square?: boolean;
    /** Degrees (Bitmap.RotateFlip), e.g. 90 for the small ship images (BuiltObjectImageCache Rotate90FlipNone). */
    rotate?: number;
}

export interface ImageComboItem {
    value: string;
    label: string;
    pictures?: ImageComboPicture[];
    title?: string;
}

export interface ImageComboOptions {
    items: readonly ImageComboItem[];
    value: string;
    onChange: (v: string) => void;
    /** OnMeasureItem ItemHeight; default 21. */
    itemHeight?: number;
    /** x of the text (OnDrawItem's PointF); default 4. */
    textX?: number;
    size?: number;
    /** Rows shown before the list scrolls (MaxDropDownItems); default 8. */
    maxItems?: number;
}

export interface ImageCombo {
    readonly el: HTMLDivElement;
    get value(): string;
    setValue(v: string): void;
    close(): void;
}

function comboItemRow(item: ImageComboItem, height: number, textX: number): HTMLDivElement {
    const row = el('div', 'ow-combo-item');
    row.style.height = `${height}px`;
    const ph = Math.max(1, height - 2);
    for (const p of item.pictures ?? []) {
        if (p.url === null) continue;
        const img = el('img', 'ow-combo-pic');
        img.alt = '';
        img.draggable = false;
        img.style.left = `${p.x}px`;
        img.style.height = `${ph}px`;
        if (p.square) img.style.width = `${ph}px`;
        if (p.rotate) img.style.transform = `rotate(${p.rotate}deg)`;
        if (typeof p.url === 'string') img.src = p.url;
        else
            void p.url.then((u) => {
                if (u) img.src = u;
                else img.remove();
            });
        row.appendChild(img);
    }
    const t = el('span', 'ow-combo-text', item.label);
    t.style.left = `${textX}px`;
    row.appendChild(t);
    if (item.title) row.title = item.title;
    return row;
}

/** An owner-drawn ComboBox (DrawMode.OwnerDrawFixed, DropDownList): the (48, 48, 64) box shows the selected item as
 *  OnDrawItem draws it (pictures + text), the arrow button on the right opens the list under it. The list is placed in
 *  the same parent (so it scales with the window); Escape / a click elsewhere closes it. */
export function imageCombo(o: ImageComboOptions): ImageCombo {
    const ih = o.itemHeight ?? 21;
    const textX = o.textX ?? 4;
    const box = el('div', 'ow-combo');
    box.tabIndex = 0;
    box.style.fontSize = `${o.size ?? FONT.normal}px`;
    const shown = el('div', 'ow-combo-shown');
    const arrow = el('div', 'ow-combo-arrow');
    box.append(shown, arrow);
    let value = o.value;
    let list: HTMLDivElement | null = null;
    const render = (): void => {
        const item = o.items.find((i) => i.value === value);
        shown.replaceChildren(...(item ? [comboItemRow(item, ih, textX)] : []));
        box.title = item?.title ?? item?.label ?? '';
    };
    const pick = (v: string): void => {
        close();
        if (v === value) return;
        value = v;
        render();
        o.onChange(v);
    };
    const onOutside = (e: PointerEvent): void => {
        if (list && !list.contains(e.target as Node) && !box.contains(e.target as Node)) close();
    };
    const onEsc = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' && list) {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    };
    function close(): void {
        if (!list) return;
        list.remove();
        list = null;
        box.classList.remove('ow-combo-open');
        document.removeEventListener('pointerdown', onOutside, true);
        window.removeEventListener('keydown', onEsc, true);
    }
    const open = (): void => {
        const parent = box.offsetParent as HTMLElement | null;
        if (!parent || o.items.length === 0) return;
        list = el('div', 'ow-combo-list ow-scroll');
        list.style.fontSize = box.style.fontSize;
        for (const item of o.items) {
            const row = comboItemRow(item, ih, textX);
            if (item.value === value) row.classList.add('ow-combo-sel');
            row.addEventListener('pointerdown', (e) => e.stopPropagation());
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                pick(item.value);
            });
            list.appendChild(row);
        }
        // Under the box, or above it when it would leave the parent.
        const rows = Math.min(o.items.length, o.maxItems ?? 8);
        const h = rows * ih + 2;
        const below = box.offsetTop + box.offsetHeight;
        const top = below + h > parent.clientHeight && box.offsetTop - h >= 0 ? box.offsetTop - h : below;
        place(list, box.offsetLeft, top, box.offsetWidth, h);
        parent.appendChild(list);
        box.classList.add('ow-combo-open');
        document.addEventListener('pointerdown', onOutside, true);
        window.addEventListener('keydown', onEsc, true);
    };
    box.addEventListener('click', (e) => {
        e.stopPropagation();
        if (box.classList.contains('ow-disabled')) return;
        if (list) close();
        else open();
    });
    box.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') return;
        e.stopPropagation();
        const i = o.items.findIndex((x) => x.value === value);
        if (e.key === 'ArrowDown' && i < o.items.length - 1) pick(o.items[i + 1].value);
        else if (e.key === 'ArrowUp' && i > 0) pick(o.items[i - 1].value);
        else if (e.key === 'Enter' || e.key === ' ') list ? close() : open();
        else return;
        e.preventDefault();
    });
    render();
    return {
        el: box,
        get value() {
            return value;
        },
        setValue(v: string) {
            if (v === value) return;
            value = v;
            render();
        },
        close,
    };
}
