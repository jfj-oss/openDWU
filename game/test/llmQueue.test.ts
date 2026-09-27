// 19s-1 local-model request queue (src/llm/queue.ts) with a fake endpoint: priority classes, the per-game-year budget
// (player-facing requests exempt), the situation-hash cache with its game-day TTL, shared in-flight requests, the hard
// timeout, concurrency, graceful silence when the endpoint is absent (and the probe retry), metrics, dispose — plus the
// rule that nothing under src/sim imports the queue (the model never runs inside the tick).
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_LLM_POLICY, LlmQueue, advisorTransport, situationHash, type LlmClock, type LlmQueuePolicy, type LlmRequest, type LlmTransport } from '../src/llm/queue';
import { llmMetricsText } from '../src/ui/llmOverlay';

interface Call {
    req: LlmRequest;
    signal: AbortSignal;
    resolve: (text: string) => void;
    reject: (e: Error) => void;
}

/** A controllable endpoint: each complete() waits until the test resolves it. */
function fakeTransport(up = true): LlmTransport & { calls: Call[]; probes: number; up: boolean } {
    const t = {
        calls: [] as Call[],
        probes: 0,
        up,
        model: () => 'fake-8b',
        probe: async () => {
            t.probes++;
            return t.up;
        },
        complete: (req: LlmRequest, signal: AbortSignal) =>
            new Promise<{ text: string }>((res, rej) => {
                t.calls.push({ req, signal, resolve: (text) => res({ text }), reject: rej });
            }),
    };
    return t;
}

function fakeClock(): LlmClock & { y: number; d: number } {
    const c = { y: 2101, d: 0, year: () => c.y, day: () => c.d };
    return c;
}

function req(priority: LlmRequest['priority'], situation: string, extra: Partial<LlmRequest> = {}): LlmRequest {
    return { priority, purpose: 'test', situation, messages: [{ role: 'user', content: `about ${situation}` }], ...extra };
}

const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

function queue(t: LlmTransport, clock: LlmClock, policy: Partial<LlmQueuePolicy> = {}, now?: () => number): LlmQueue {
    return new LlmQueue({ transport: t, clock, policy: () => ({ ...DEFAULT_LLM_POLICY, ...policy }), now });
}

describe('LlmQueue', () => {
    it('serves player-facing requests first, then voices, then background (FIFO within a class); concurrency 1', async () => {
        const t = fakeTransport();
        const q = queue(t, fakeClock(), { concurrency: 1 });
        const order: string[] = [];
        const ps = [req('background', 'bg1'), req('voice', 'v1'), req('background', 'bg2'), req('player', 'p1'), req('voice', 'v2')].map((r) =>
            q.submit(r).then((x) => order.push(`${r.situation}:${x.outcome}`)),
        );
        await flush();
        // Only one in flight: the first request that reached the pump after the probe (all were queued before it).
        expect(t.calls.length).toBe(1);
        expect(t.calls[0].req.situation).toBe('p1');
        for (let i = 0; i < 5; i++) {
            t.calls[i].resolve('ok');
            await flush();
        }
        await Promise.all(ps);
        expect(order).toEqual(['p1:ok', 'v1:ok', 'v2:ok', 'bg1:ok', 'bg2:ok']);
        expect(q.metrics()).toMatchObject({ submitted: 5, sent: 5, ok: 5, inFlight: 0, queued: 0 });
    });

    it('runs two at once with concurrency 2 (never more)', async () => {
        const t = fakeTransport();
        const q = queue(t, fakeClock(), { concurrency: 5 });
        for (const s of ['a', 'b', 'c']) void q.submit(req('voice', s));
        await flush();
        expect(t.calls.length).toBe(2);
        expect(q.metrics().inFlight).toBe(2);
        t.calls[0].resolve('x');
        await flush();
        expect(t.calls.length).toBe(3);
    });

    it('caches by situation hash for the TTL in game days, shares an identical request in flight', async () => {
        const t = fakeTransport();
        const clock = fakeClock();
        const q = queue(t, clock, { cacheTtlDays: 30 });
        const a = q.submit(req('background', 'same digest'));
        const b = q.submit(req('background', 'same digest'));
        await flush();
        expect(t.calls.length).toBe(1);
        t.calls[0].resolve('answer');
        expect((await a).outcome).toBe('ok');
        expect((await b).text).toBe('answer');
        clock.d = 20;
        const c = await q.submit(req('background', 'same digest'));
        expect(c).toMatchObject({ outcome: 'cached', text: 'answer', tokens: 0 });
        expect(t.calls.length).toBe(1);
        // A different situation (or purpose) misses.
        void q.submit(req('background', 'other digest'));
        void q.submit(req('background', 'same digest', { purpose: 'other' }));
        await flush();
        expect(t.calls.length).toBe(2);
        t.calls[1].resolve('x');
        await flush();
        expect(t.calls.length).toBe(3);
        t.calls[2].resolve('y');
        await flush();
        // Past the TTL the entry is dropped and the model is asked again.
        clock.d = 51;
        void q.submit(req('background', 'same digest'));
        await flush();
        expect(t.calls.length).toBe(4);
        expect(q.metrics()).toMatchObject({ cacheHits: 1, shared: 1 });
        // cache: false never reads or writes the cache.
        t.calls[3].resolve('z');
        await flush();
        void q.submit(req('background', 'same digest', { cache: false }));
        await flush();
        expect(t.calls.length).toBe(5);
        expect(situationHash('abc')).toBe(situationHash('abc'));
        expect(situationHash('abc')).not.toBe(situationHash('abd'));
    });

    it('enforces the per-game-year request and token budget on non-player requests; resets with the year', async () => {
        const t = fakeTransport();
        const clock = fakeClock();
        const q = queue(t, clock, { requestsPerYear: 2, tokensPerYear: 1000, cacheTtlDays: 0 });
        const r1 = q.submit(req('background', 'one'));
        const r2 = q.submit(req('voice', 'two'));
        await flush();
        t.calls[0].resolve('a');
        await flush();
        t.calls[1].resolve('b');
        await flush();
        expect((await r1).outcome).toBe('ok');
        expect((await r2).outcome).toBe('ok');
        expect((await q.submit(req('background', 'three'))).outcome).toBe('budget');
        // Player-facing: counted, never refused.
        const p = q.submit(req('player', 'four'));
        await flush();
        t.calls[2].resolve('c');
        expect((await p).outcome).toBe('ok');
        expect(q.metrics()).toMatchObject({ yearRequests: 3, budgetRefused: 1 });
        // Tokens: a prompt that would exceed the year's tokens is refused.
        clock.y++;
        expect(q.metrics().yearRequests).toBe(0);
        const big = 'x'.repeat(5000);
        expect((await q.submit({ ...req('background', 'big'), messages: [{ role: 'user', content: big }] })).outcome).toBe('budget');
        const ok = q.submit(req('background', 'small'));
        await flush();
        t.calls[3].resolve('d');
        expect((await ok).outcome).toBe('ok');
        const m = q.metrics();
        expect(m.tokensIn).toBeGreaterThan(0);
        expect(m.tokensOut).toBeGreaterThan(0);
        expect(m.yearTokens).toBeGreaterThan(0);
    });

    it('a hard timeout ends a request the endpoint never answers (the signal is aborted) and the queue moves on', async () => {
        const t = fakeTransport();
        const q = queue(t, fakeClock(), { timeoutMs: 30 });
        const slow = q.submit(req('voice', 'slow'));
        const next = q.submit(req('voice', 'next'));
        const r = await slow;
        expect(r.outcome).toBe('timeout');
        expect(t.calls[0].signal.aborted).toBe(true);
        await flush();
        expect(t.calls.length).toBe(2);
        t.calls[1].resolve('fine');
        expect((await next).outcome).toBe('ok');
        expect(q.metrics().timeouts).toBe(1);
    });

    it('an endpoint error resolves with outcome error (never rejects)', async () => {
        const t = fakeTransport();
        const q = queue(t, fakeClock());
        const p = q.submit(req('voice', 'e'));
        await flush();
        t.calls[0].reject(new Error('HTTP 500'));
        expect(await p).toMatchObject({ outcome: 'error', error: 'HTTP 500' });
    });

    it('stays silent when the endpoint is absent: no request is sent, the probe is retried only after probeRetryMs', async () => {
        const t = fakeTransport(false);
        let now = 0;
        const q = queue(t, fakeClock(), { probeRetryMs: 1000 }, () => now);
        expect((await q.submit(req('player', 'hello'))).outcome).toBe('silent');
        expect((await q.submit(req('background', 'again'))).outcome).toBe('silent');
        expect(t.probes).toBe(1);
        expect(t.calls.length).toBe(0);
        expect(q.available).toBe(false);
        expect(q.metrics()).toMatchObject({ endpoint: 'down', silent: 2, sent: 0 });
        now = 1500;
        t.up = true;
        const p = q.submit(req('background', 'back'));
        await flush();
        expect(t.probes).toBe(2);
        expect(q.available).toBe(true);
        t.calls[0].resolve('hi');
        expect((await p).outcome).toBe('ok');
    });

    it('dispose cancels waiting and in-flight requests; metrics render for the overlay', async () => {
        const t = fakeTransport();
        const q = queue(t, fakeClock());
        const a = q.submit(req('voice', 'a'));
        const b = q.submit(req('voice', 'b'));
        await flush();
        q.dispose();
        expect((await b).outcome).toBe('cancelled');
        expect(t.calls[0].signal.aborted).toBe(true);
        t.calls[0].reject(new Error('aborted'));
        expect((await a).outcome).toBe('cancelled');
        const text = llmMetricsText(q.metrics());
        expect(text).toContain('LLM up');
        expect(text).toContain('test 2');
    });

    it('the app transport probes and calls the endpoint client (Ollama wire), and reports no endpoint as down', async () => {
        const seen: string[] = [];
        const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
            seen.push(url);
            if (url.endsWith('/api/version')) return new Response('{"version":"x"}', { status: 200 });
            const body = JSON.parse(String(init?.body)) as { format: unknown };
            expect(body.format).toEqual({ type: 'object' });
            return new Response(JSON.stringify({ message: { content: '{"text":"hello"}' } }), { status: 200 });
        };
        const tr = advisorTransport(() => ({ endpoint: 'http://model', model: 'm', api: 'auto' }), fetchImpl);
        expect(await tr.probe()).toBe(true);
        const r = await tr.complete(req('player', 's', { schema: { type: 'object' } }), new AbortController().signal);
        expect(r.text).toBe('{"text":"hello"}');
        expect(seen).toEqual(['http://model/api/version', 'http://model/api/chat']);
        const none = advisorTransport(() => ({ endpoint: '', model: 'm', api: 'auto' }), fetchImpl);
        expect(await none.probe()).toBe(false);
    });
});

describe('the model never runs inside the tick', () => {
    it('nothing under src/sim imports src/llm or the endpoint client', () => {
        const root = resolve(__dirname, '../src/sim');
        const bad: string[] = [];
        const walk = (dir: string): void => {
            for (const f of readdirSync(dir)) {
                const p = join(dir, f);
                if (statSync(p).isDirectory()) walk(p);
                else if (p.endsWith('.ts')) {
                    const src = readFileSync(p, 'utf8');
                    if (/from '[^']*\/llm\/(queue|chronicleJob|llmLayer)'|from '[^']*ui\/advisorClient'/.test(src)) bad.push(p);
                }
            }
        };
        walk(root);
        expect(bad).toEqual([]);
    });
});
