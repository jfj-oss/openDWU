// Desktop shell's background self-update (desktop/selfUpdate.cjs, gamePreload.cjs `dwuDesktop.updates`): a one-line
// notice when the update has been downloaded, and a "multiplayer is running" report so the download waits.
import { multiplayerActive } from './multiplayer/multiplayerApp';
import { showToast } from './toast';

interface UpdatesBridge {
    onReady?: (cb: (version: string) => void) => void;
    setBusy?: (busy: boolean) => void;
}

export function installDesktopUpdateNotice(): void {
    const b = (window as unknown as { dwuDesktop?: { updates?: UpdatesBridge } }).dwuDesktop?.updates;
    if (b === undefined) return;
    b.onReady?.((version) => showToast(`openDWU ${version} will be installed when you quit (Check for Updates to restart now)`, document.body, 9000));
    let last = false;
    window.setInterval(() => {
        const now = multiplayerActive();
        if (now !== last) {
            last = now;
            b.setBusy?.(now);
        }
    }, 3000);
}
