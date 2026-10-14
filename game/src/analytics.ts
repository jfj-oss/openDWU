// Anonymous usage statistics from the page (desktop app only; the shell, desktop/aptabase.cjs, whitelists, batches and
// sends them; nothing happens in the browser build). Builders here are pure so the payloads are unit-tested.

interface AnalyticsBridge {
    track?: (name: string, props: Record<string, string | number | boolean>) => void;
    session?: (props: Record<string, string | number | boolean>) => void;
}

const bridge = (): AnalyticsBridge | undefined => (window as unknown as { dwuDesktop?: { analytics?: AnalyticsBridge } }).dwuDesktop?.analytics;

export type EventProps = Record<string, string | number | boolean>;

export function trackEvent(name: string, props: EventProps = {}): void {
    try {
        bridge()?.track?.(name, props);
    } catch {
        /* statistics never break the game */
    }
}

/** What game_started / game_loaded report: the setup only (counts and ids), no names. */
export interface GameSummary {
    stars: number;
    empires: number;
    shape: string;
    age: number;
    difficulty: number;
    edition: 'full' | 'classic';
    addons: readonly string[];
    multiplayer: boolean;
    players: number;
    theme: string;
}

export function gameEventProps(g: GameSummary): EventProps {
    return {
        stars: g.stars,
        empires: g.empires,
        shape: g.shape,
        age: g.age,
        difficulty: g.difficulty,
        edition: g.edition,
        addons: [...g.addons].sort().join(','),
        multiplayer: g.multiplayer,
        players: g.players,
        theme: g.theme === '' ? 'default' : g.theme,
    };
}

/** session_ended's numbers: real minutes with a game open, the game year reached, and how it ended. */
export function sessionProps(startedAtMs: number, nowMs: number, gameYear: number, finished: boolean, won: boolean): EventProps {
    return { minutes: Math.round((nowMs - startedAtMs) / 600) / 100, year: Math.max(0, Math.floor(gameYear)), result: finished ? (won ? 'won' : 'lost') : 'ongoing' };
}

/** Screen id from an element added to the page: its id, else its first class; null for things that are not screens. */
export function screenIdOf(el: Element): string | null {
    const raw = el.id !== '' ? el.id : (el.classList[0] ?? '');
    if (raw === '' || /toast|tooltip|tip$|cursor|canvas|hint|ticker/i.test(raw) || el.tagName === 'CANVAS' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return null;
    return raw.slice(0, 48);
}

/** First open of each screen (the shell keeps one per session): watches elements added to the body. */
export function installScreenTracking(): void {
    if (bridge()?.track === undefined) return;
    new MutationObserver((records) => {
        for (const r of records) {
            r.addedNodes.forEach((n) => {
                if (n instanceof Element) {
                    const id = screenIdOf(n);
                    if (id !== null) trackEvent('screen_opened', { screen: id });
                }
            });
        }
    }).observe(document.body, { childList: true });
}
