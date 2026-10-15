// "Report a bug" (Esc menu): a small original-style window with a text box ("What happened?") and Send / Cancel. Send
// hands the text to the desktop shell, which sends it to Sentry as user feedback with a downscaled screenshot of the game
// view, the last ~200 log lines, version, GPU, galaxy size and the changed game settings. No save file is attached
// (README Privacy). Only the desktop app can send; the browser build says so.
import { COLORS, FONT, el, glassButton, openOriginalWindow, place, text } from '../originalWindow';
import { bugReportAvailable, sendBugReport } from '../../errorReporting';

export function openBugReport(): void {
    const win = openOriginalWindow({ id: 'bug-report', title: 'Report a Bug', width: 460, height: 300 });
    win.root.classList.add('ow-modal');
    const w = win.bodySize.w;
    win.body.appendChild(place(text('What happened? A screenshot of the game, the recent log, your version and graphics card are sent with it, but no saved games.', { size: FONT.normal, color: COLORS.text, wrapWidth: w - 28 }), 14, 10));
    const box = el('textarea', 'ow-input');
    box.maxLength = 2000;
    box.spellcheck = true;
    box.style.resize = 'none';
    box.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') e.stopPropagation();
    });
    win.body.appendChild(place(box, 14, 64, w - 28, win.bodySize.h - 64 - 14 - 30 - 34));
    const status = text('', { size: FONT.normal, color: COLORS.text, wrapWidth: w - 28 });
    win.body.appendChild(place(status, 14, win.bodySize.h - 14 - 30 - 26));
    const by = win.bodySize.h - 14 - 30;
    const send = glassButton('Send', {
        onClick: () => {
            const msg = box.value.trim();
            if (msg === '') return setStatus('Please describe what happened.');
            if (!bugReportAvailable()) return setStatus('Bug reports can be sent from the desktop app.');
            send.disabled = true;
            setStatus('Sending…');
            void sendBugReport(msg).then((r) => {
                if (r.ok) {
                    setStatus('Thanks — report sent');
                    setTimeout(() => win.close(), 1500);
                } else {
                    setStatus(r.error ?? 'The report could not be sent.');
                    send.disabled = false;
                }
            });
        },
    });
    const setStatus = (t: string): void => {
        status.textContent = t;
    };
    win.body.appendChild(place(send, w - 14 - 100 - 10 - 100, by, 100, 30));
    win.body.appendChild(place(glassButton('Cancel', { onClick: () => win.close() }), w - 14 - 100, by, 100, 30));
    box.focus();
}
