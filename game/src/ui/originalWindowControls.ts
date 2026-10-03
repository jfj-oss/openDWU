// More of the original's WinForms / DistantWorlds.Controls widgets for screens built on originalWindow.ts (same
// conventions: original pixels, place() for the position, the source's colours):
//   groupBox()          System.Windows.Forms.GroupBox: a thin frame whose caption breaks the top line
//   colorSlider()       DistantWorlds.Controls.ColorSlider (ColorSlider.cs DrawColorSlider)
//   labelledTrackBar()  DistantWorlds.Controls.LabelledTrackBar: a GradientPanel with a bold caption, a ColorSlider
//                       and one label + tick per step (LabelledTrackBar.cs Setup / DoLayout / OnPaint)
//   checkBoxRight()     a CheckBox with CheckAlign = MiddleRight (text first, box on the right)

import './originalWindowControls.css';
import { checkBox, el, FONT, gradientPanel, place } from './originalWindow';

// -------------------------------------------------------------------------------------------------------------------
// Pure helpers (tested)
// -------------------------------------------------------------------------------------------------------------------

/** ColorSlider.DrawColorSlider: the thumb's left edge, (value - min) × (width - thumbSize) / (max - min). */
export function sliderThumbLeft(value: number, min: number, max: number, width: number, thumbSize: number): number {
    if (max <= min) return 0;
    return Math.trunc(((value - min) * (width - thumbSize)) / (max - min));
}

/** The slider value under a client x (the inverse of sliderThumbLeft for the thumb's centre), clamped. */
export function sliderValueAt(x: number, min: number, max: number, width: number, thumbSize: number): number {
    if (max <= min || width <= thumbSize) return min;
    const v = min + Math.round(((x - thumbSize / 2) * (max - min)) / (width - thumbSize));
    return Math.max(min, Math.min(max, v));
}

/** LabelledTrackBar.DoLayout (LinkWidth 0): the slider's rect inside a trackbar of w × h. */
export function trackBarSliderRect(w: number, h: number, labelWidth: number, sliderOffset = 25): { x: number; y: number; w: number; h: number } {
    const padding = 3;
    const sliderHeight = 22;
    return { x: padding + labelWidth + sliderOffset, y: h - (sliderHeight + padding), w: Math.max(1, w - (padding * 2 + labelWidth + sliderOffset * 2)), h: sliderHeight };
}

/** LabelledTrackBar.OnPaint: the x of step `index`'s tick / label centre. */
export function trackBarTickX(index: number, count: number, sliderX: number, sliderW: number, thumbSize: number): number {
    if (count <= 1) return sliderX - 1 + thumbSize / 2;
    return sliderX - 1 + Math.trunc(thumbSize / 2) + Math.trunc((sliderW - thumbSize) * (index / (count - 1)));
}

// -------------------------------------------------------------------------------------------------------------------
// GroupBox
// -------------------------------------------------------------------------------------------------------------------

/** A GroupBox of w × h at its caption font (font_2 = 18.67 px bold by default). Children are placed in its own
 *  coordinates (the frame's top-left is (0, 0), as in WinForms): the frame and caption are a separate fieldset layer
 *  behind them, so the legend does not push the children down. */
export function groupBox(title: string, w: number, h: number, size: number = FONT.header): HTMLDivElement {
    const g = el('div', 'owc-group');
    g.style.width = `${w}px`;
    g.style.height = `${h}px`;
    const frame = el('fieldset', 'owc-group-frame');
    const legend = el('legend', 'owc-group-title', title);
    legend.style.fontSize = `${size}px`;
    frame.appendChild(legend);
    g.appendChild(frame);
    return g;
}

// -------------------------------------------------------------------------------------------------------------------
// ColorSlider
// -------------------------------------------------------------------------------------------------------------------

export interface ColorSliderOptions {
    value: number;
    min: number;
    max: number;
    /** Size in original pixels (the control's Size). */
    width: number;
    height: number;
    /** ThumbSize; default 20 (the Options sliders). */
    thumbSize?: number;
    /** SmallChange (arrow keys); default 1. */
    smallChange?: number;
    /** LargeChange (Page Up / Down); default 5. */
    largeChange?: number;
    /** MouseWheelBarPartitions (a wheel notch moves (max - min) / partitions); default 10. */
    wheelPartitions?: number;
    /** Scroll / ValueChanged. */
    onChange?: (v: number) => void;
}

export interface ColorSlider {
    readonly el: HTMLDivElement;
    readonly value: number;
    /** Set without firing onChange. */
    setValue(v: number): void;
    setEnabled(enabled: boolean): void;
}

/** A horizontal ColorSlider: the bar (Inflate(-1, -Height / 3), (32, 32, 40) → (64, 64, 72) → (32, 32, 40)), the elapsed
 *  part up to the thumb's centre ((48, 48, 64) / (80, 80, 96)) and the round-rect thumb (radius 3). */
export function colorSlider(o: ColorSliderOptions): ColorSlider {
    const thumb = o.thumbSize ?? 20;
    const small = o.smallChange ?? 1;
    const large = o.largeChange ?? 5;
    const partitions = o.wheelPartitions ?? 10;
    const root = el('div', 'owc-slider');
    root.tabIndex = 0;
    root.style.width = `${o.width}px`;
    root.style.height = `${o.height}px`;
    const inset = Math.trunc(o.height / 3);
    const bar = place(el('div', 'owc-slider-bar'), 1, inset, o.width - 2, Math.max(1, o.height - 2 * inset));
    const elapsed = place(el('div', 'owc-slider-elapsed'), 1, inset, 0, Math.max(1, o.height - 2 * inset));
    const thumbEl = place(el('div', 'owc-slider-thumb'), 0, 1, thumb - 1, Math.max(1, o.height - 3));
    root.append(bar, elapsed, thumbEl);
    let value = clamp(o.value);
    let enabled = true;

    function clamp(v: number): number {
        return Math.max(o.min, Math.min(o.max, Math.round(v)));
    }
    function draw(): void {
        const left = sliderThumbLeft(value, o.min, o.max, o.width, thumb);
        thumbEl.style.left = `${left}px`;
        elapsed.style.width = `${Math.max(0, left + Math.trunc(thumb / 2) - 1)}px`;
    }
    function set(v: number, fire: boolean): void {
        const nv = clamp(v);
        if (nv === value) return;
        value = nv;
        draw();
        if (fire) o.onChange?.(value);
    }
    /** Client x → original-pixel x inside the slider (the window is CSS-scaled as one). */
    function localX(clientX: number): number {
        const r = root.getBoundingClientRect();
        const k = r.width > 0 ? o.width / r.width : 1;
        return (clientX - r.left) * k;
    }
    root.addEventListener('pointerdown', (e) => {
        if (!enabled || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        root.focus();
        root.setPointerCapture(e.pointerId);
        root.classList.add('owc-active');
        set(sliderValueAt(localX(e.clientX), o.min, o.max, o.width, thumb), true);
        const move = (m: PointerEvent): void => set(sliderValueAt(localX(m.clientX), o.min, o.max, o.width, thumb), true);
        const up = (): void => {
            root.classList.remove('owc-active');
            root.removeEventListener('pointermove', move);
            root.removeEventListener('pointerup', up);
            root.removeEventListener('pointercancel', up);
        };
        root.addEventListener('pointermove', move);
        root.addEventListener('pointerup', up);
        root.addEventListener('pointercancel', up);
    });
    root.addEventListener(
        'wheel',
        (e) => {
            if (!enabled) return;
            e.preventDefault();
            e.stopPropagation();
            const step = Math.max(1, Math.round((o.max - o.min) / partitions));
            set(value + (e.deltaY < 0 ? step : -step), true);
        },
        { passive: false },
    );
    root.addEventListener('keydown', (e) => {
        if (!enabled) return;
        let d = 0;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = small;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -small;
        else if (e.key === 'PageUp') d = large;
        else if (e.key === 'PageDown') d = -large;
        else if (e.key === 'Home') d = o.min - value;
        else if (e.key === 'End') d = o.max - value;
        else return;
        e.preventDefault();
        e.stopPropagation();
        set(value + d, true);
    });
    draw();
    return {
        el: root,
        get value() {
            return value;
        },
        setValue(v: number) {
            set(v, false);
        },
        setEnabled(on: boolean) {
            enabled = on;
            root.classList.toggle('owc-disabled', !on);
        },
    };
}

// -------------------------------------------------------------------------------------------------------------------
// LabelledTrackBar
// -------------------------------------------------------------------------------------------------------------------

export interface LabelledTrackBarOptions {
    width: number;
    height: number;
    /** LabelText (drawn bold, centred in the LabelWidth column). */
    labelText: string;
    labelWidth: number;
    /** SetLabels: one step per label (Minimum 0, Maximum labels.length - 1). */
    labels: readonly string[];
    value: number;
    /** The control's Font size (font_4 on the Options screens). */
    size?: number;
    onChange?: (v: number) => void;
}

/** LabelledTrackBar after Setup(): a GradientPanel ((39, 40, 44) / (36, 35, 40) / (51, 54, 61), 1 px (67, 67, 77) border,
 *  curvature 10) with the caption, a 10 px-thumb ColorSlider along the bottom and the step labels above it. */
export function labelledTrackBar(o: LabelledTrackBarOptions): { el: HTMLDivElement; slider: ColorSlider } {
    const size = o.size ?? FONT.normal;
    const p = gradientPanel({
        colors: ['rgb(39, 40, 44)', 'rgb(36, 35, 40)', 'rgb(51, 54, 61)'],
        corners: { tl: true, tr: true, br: true, bl: true },
        radius: 10,
        borderWidth: 1,
        className: 'owc-trackbar',
    });
    p.style.width = `${o.width}px`;
    p.style.height = `${o.height}px`;
    p.style.fontSize = `${size}px`;
    p.style.boxSizing = 'border-box';
    // Absolute children sit inside the 1 px border: B shifts them back to the control's own coordinates.
    const B = 1;
    const caption = el('div', 'owc-trackbar-caption', o.labelText);
    place(caption, -B, -B, o.labelWidth, o.height);
    p.appendChild(caption);
    const r = trackBarSliderRect(o.width, o.height, o.labelWidth);
    const thumb = 10;
    const n = o.labels.length;
    for (let i = 0; i < n; i++) {
        const x = trackBarTickX(i, n, r.x, r.w, thumb);
        p.appendChild(place(el('div', 'owc-trackbar-tick'), x - B, r.y - B, 2, 7));
        p.appendChild(place(el('div', 'owc-trackbar-label', o.labels[i]), x - B, 3 - B));
    }
    const slider = colorSlider({ value: o.value, min: 0, max: Math.max(1, n - 1), width: r.w, height: r.h, thumbSize: thumb, largeChange: 1, wheelPartitions: Math.max(1, n - 1), onChange: o.onChange });
    p.appendChild(place(slider.el, r.x - B, r.y - B));
    return { el: p, slider };
}

// -------------------------------------------------------------------------------------------------------------------
// CheckBox, CheckAlign = MiddleRight
// -------------------------------------------------------------------------------------------------------------------

/** A check box with the text left of the box (CheckAlign / TextAlign MiddleRight). */
export function checkBoxRight(label: string, checked: boolean, onChange: ((v: boolean) => void) | null, size: number = FONT.normal): HTMLLabelElement {
    const c = checkBox(label, checked, onChange, size);
    c.classList.add('owc-check-right');
    return c;
}
