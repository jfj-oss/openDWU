// Shared toast (task 12d). One toast at a time, bottom-centre of `root`,
// fading out before removal. Replaces the per-screen copies in mainMenu.ts
// and gameMenu.ts (saveLoad.ts keeps its own; another task owns it).
import './toast.css';

let currentToast: HTMLElement | null = null;
let toastTimer: number | undefined;

/** Show a short-lived toast on `root` (default document.body), replacing any
 * existing one. Fades out after `ms` milliseconds. */
export function showToast(text: string, root: HTMLElement = document.body, ms = 2500): void {
    if (currentToast) {
        currentToast.remove();
        currentToast = null;
    }
    if (toastTimer !== undefined) {
        clearTimeout(toastTimer);
        toastTimer = undefined;
    }
    const toast = document.createElement('div');
    toast.className = 'dwu-toast';
    toast.textContent = text;
    root.appendChild(toast);
    currentToast = toast;
    toastTimer = window.setTimeout(() => {
        // Fade out, then remove once the transition has finished.
        toast.style.opacity = '0';
        window.setTimeout(() => {
            toast.remove();
            if (currentToast === toast) currentToast = null;
            toastTimer = undefined;
        }, 300);
    }, ms);
}
/** Remove the current toast now (e.g. an "in progress" notice whose work ended without a result). */
export function hideToast(): void {
    if (currentToast) {
        currentToast.remove();
        currentToast = null;
    }
    if (toastTimer !== undefined) {
        clearTimeout(toastTimer);
        toastTimer = undefined;
    }
}
