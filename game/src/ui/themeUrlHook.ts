// Theme art for the DOM UI. The HUD, screens and popups set original art as `img.src = '/assets/dwu/images/...'`
// (hundreds of call sites); with a theme active each such URL must become the theme's copy when the original would
// load it (themeAssets.ts themedAssetUrl — the Windows File.Exists lookups of Main.Part12/13.cs). Instead of touching
// every call site, the URL-taking DOM setters are wrapped once: <img>/<audio> src, setAttribute('src'|'style'), and
// inline background(-image) styles. Installed only when a theme is first activated (themeLoader.ts), so the stock
// game runs with the browser's own setters; themedAssetUrl returns its input unchanged while no theme is active.
import { themedAssetUrl } from '../themeAssets';

let installed = false;

/** Rewrite every url(...) inside a CSS value. */
export function themedCssValue(value: string): string {
    if (!value.includes('/assets/dwu/')) return value;
    return value.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/g, (_m, q: string, u: string) => `url(${q}${themedAssetUrl(u)}${q})`);
}

function wrapSetter(proto: object, prop: string, map: (v: string) => string): void {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (d === undefined || d.set === undefined || d.get === undefined) return;
    const set = d.set;
    Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: d.enumerable,
        get: d.get,
        set(this: unknown, v: unknown) {
            set.call(this, typeof v === 'string' ? map(v) : v);
        },
    });
}

/** Install the DOM URL hooks (idempotent; no-op outside a browser). */
export function installThemeUrlHook(): void {
    if (installed || typeof window === 'undefined' || typeof HTMLImageElement === 'undefined') return;
    installed = true;
    wrapSetter(HTMLImageElement.prototype, 'src', themedAssetUrl);
    wrapSetter(HTMLMediaElement.prototype, 'src', themedAssetUrl);
    for (const p of ['backgroundImage', 'background', 'cssText']) wrapSetter(CSSStyleDeclaration.prototype, p, themedCssValue);
    const setProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (this: CSSStyleDeclaration, name: string, value: string | null, priority?: string) {
        return setProperty.call(this, name, typeof value === 'string' ? themedCssValue(value) : value, priority);
    };
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
        const n = name.toLowerCase();
        if (n === 'src') value = themedAssetUrl(String(value));
        else if (n === 'style') value = themedCssValue(String(value));
        return setAttribute.call(this, name, value);
    };
}
