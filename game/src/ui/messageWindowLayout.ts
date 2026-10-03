// Pure layout of the message windows (no DOM): the event message panel (Main.Part4.cs:115 method_513 pnlEventMessage),
// the popup card (Main.Part9.cs:2394 pnlMessagePopup, MessagePopup.cs OnPaint) and the conversation panel
// (Main.Part8.cs:449 method_296 pnlDiplomacyTalk). All sizes are the original's pixels.

import type { Rect } from './originalWindow';

/** pnlMessagePopup.Size (Main.Part9.cs:2394) and MessagePopup._Padding. */
export const CARD = { width: 335, height: 280, padding: 12, imageMaxW: 240, imageMaxH: 180, flagW: 50, flagH: 30 } as const;
/** The strip under the card for the star date and its buttons (not in the original, whose card has no buttons). */
export const CARD_STRIP_H = 40;

/** pnlDiplomacyTalk (Main.Part8.cs:475-523). */
export const TALK = {
    width: 430,
    height: 778,
    panel: { x: 10, y: 10, w: 410, h: 758 },
    flag: { w: 50, h: 30, y: 8 },
    titleY: 10,
    race: { x: 65, y: 45, w: 280, h: 280 },
    response: { x: 10, y: 335, w: 390, h: 188 },
    options: { x: 10, y: 528, w: 390, h: 220 },
} as const;

/** pnlEventMessage: 420 × 660 (num, num2), the GradientPanel 10 px in. */
export const EVENT = { width: 420, height: 660, inset: 10 } as const;

export interface EventPanelLayout {
    /** pnlEventMessagePanel, frame-relative. */
    panel: Rect;
    /** picEventMessage (panel-relative), null without a picture. */
    picture: Rect | null;
    /** lblEventMessageTitle's top (panel-relative); the title is centred, at most `titleMaxW` wide. */
    titleY: number;
    titleMaxW: number;
    /** pnlEventMessageContainer (panel-relative): the scrolling text. */
    container: Rect;
    /** lblEventMessageText's MaximumSize width (the text wraps inside the container at this width). */
    textW: number;
    /** The y of the button row (panel-relative). */
    buttonY: number;
}

/**
 * Port of Main.Part4.cs:115 method_513(bool_28 small picture, int_64 extra button height): the panel, picture, title,
 * text container and the button row, given the title's measured height.
 */
export function eventPanelLayout(hasPicture: boolean, titleH: number, small = false, extraButtonH = 0): EventPanelLayout {
    const num = EVENT.width;
    const num2 = EVENT.height;
    const num3 = small ? 200 : 360;
    const num4 = small ? 150 : 270;
    const panel = { x: EVENT.inset, y: EVENT.inset, w: num - 20, h: num2 - 20 };
    const buttonY = num2 - (10 + extraButtonH) - 50;
    if (hasPicture) {
        return {
            panel,
            picture: { x: (num - 20 - num3) / 2, y: 10, w: num3, h: num4 },
            titleY: num4 + 20,
            titleMaxW: num - 40,
            container: { x: 10, y: num4 + 20 + titleH + 5, w: num - 35, h: panel.h - (num4 + 75 + titleH + extraButtonH) },
            textW: num - 55,
            buttonY,
        };
    }
    return {
        panel,
        picture: null,
        titleY: 10,
        titleMaxW: num - 40,
        container: { x: 10, y: 20 + titleH + 5, w: num - 35, h: panel.h - (75 + titleH + extraButtonH) },
        textW: num - 55,
        buttonY,
    };
}

/**
 * The event panel's buttons (Main.Part4.cs:262-283): 175 × 30 (+ int_64) from x = (380 - 360) / 2.
 * - two choices (Investigate / Avoid): at num11 and num11 + 185;
 * - Close + Go to (a located event): Close at num11, Go to at num11 + 185;
 * - Close alone: centred at num11 + 92.
 * More than two choices (not in the original) share the 360 px row.
 */
export function eventButtonRects(count: number, buttonY: number, extraButtonH = 0): Rect[] {
    const x0 = (EVENT.width - 20 - 360) / 2;
    const h = 30 + extraButtonH;
    if (count <= 0) return [];
    if (count === 1) return [{ x: x0 + 92, y: buttonY, w: 175, h }];
    if (count === 2) return [{ x: x0, y: buttonY, w: 175, h }, { x: x0 + 185, y: buttonY, w: 175, h }];
    const gap = 10;
    const w = Math.floor((360 - (count - 1) * gap) / count);
    return Array.from({ length: count }, (_, i) => ({ x: x0 + i * (w + gap), y: buttonY, w, h }));
}

/** The card's height: the original 280 plus the button / date strip. */
export function cardHeight(): number {
    return CARD.height + CARD_STRIP_H;
}

/**
 * Where the card sits (CSS px): left of the stub list, top-aligned with it, when the list is on screen; otherwise at
 * the right edge, vertically centred (Main.Part9.cs:2415 timer_1_Elapsed: X = width - (Width + 10), Y centred).
 */
export function cardPosition(viewW: number, viewH: number, scale: number, stubs: { left: number; top: number } | null): { left: number; top: number } {
    const w = CARD.width * scale;
    const h = cardHeight() * scale;
    if (stubs !== null) {
        const left = Math.max(8, Math.round(stubs.left - 10 - w));
        const top = Math.max(8, Math.min(Math.round(stubs.top), Math.round(viewH - h - 8)));
        return { left, top };
    }
    return { left: Math.round(viewW - w - 10), top: Math.round((viewH - h) / 2) };
}
