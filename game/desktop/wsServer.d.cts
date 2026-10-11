// Types of desktop/wsServer.cjs (for the TS scripts, e.g. scripts/determinism-check/lockstepPeer.ts).
declare const wsServer: {
    listenWebSocket(opts: { port?: number; host?: string; maxMessageBytes?: number }, onSocket: (socket: unknown, request: unknown) => void): Promise<{ port: number; close(): void }>;
    CONNECTING: number;
    OPEN: number;
    CLOSING: number;
    CLOSED: number;
};
export = wsServer;
