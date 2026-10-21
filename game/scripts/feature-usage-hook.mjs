// Feature-usage measurement for the 50-year `everything50` soak: scripts/soak.mjs --set everything50 --hook scripts/feature-usage-hook.mjs.
//
// Every sim frame (one game day) this reads the live scenario state of each added feature (galaxy.scenario.state, the keys of
// src/sim/scenario/**) and counts what the AI empires did: new objects in a feature's lists (WeakSet identity, so each object
// counts once), transitions of a field (a level, a phase, a stage, a holder), and numeric counter deltas. Every count is
// attributed to the empire that owns the act, classed as ai / human / pirate / independent / faction (machine factions and the
// Compact, which have no dominant race), and carries the game year of its first AI use (year = nowMs / 600000, to 0.01).
//
// Writes report.featureUsage at every chunk (every ~36 game days, so every scan and the end of the run):
//   features: { <name>: { ai, human, pirate, independent, faction, firstAiYear, firstHumanYear, byKind: {kind: n} (AI only),
//                         byEmpire: { <empire name>: { cls, n, firstYear, byKind } } } }
//   globals:  counter deltas with no owning empire (the galaxy-wide stats of a feature)
//   gcAi:     ground battles by AI invaders (start / end day, duration in game days) per AI empire
//   stateKeys / flags: the scenario state keys present at the last chunk and the resolved flags (a feature with no state key
//                      is reported as absent, not as zero)
//   errors:   a probe that threw (its name, count and the first message), so an exception is never read as zero use
//
// Counts are of events the sim already produced; the hook only reads (it registers no observer and writes no state).
// Limits: the state probes sample every 10 frames (0.1 game day) and the habitat / fleet sweeps once a game day, so an
// object created and removed inside that window is missed.

const YEAR_MS = 600_000;
let H = null; // humans module (isHumanEmpire)
let SL = null; // slavery module (slaveryAllowed)
let frames = 0;

const feats = new Map();
const seen = new Map();
const seenKeys = new Map();
const last = new Map();
const globals = {};
const errors = {};
const gcAi = {};
const invading = new Map();
const vetPrev = new WeakMap();
const vetBattles = new WeakMap();
const seenMissions = new WeakSet();

const STRIKE_TYPES = new Map([[8, 'blockade'], [9, 'attack'], [16, 'attack'], [17, 'bombard'], [27, 'bombard'], [28, 'capture'], [30, 'raid']]);

// --- helpers -----------------------------------------------------------------------------------------------------------

const yearOf = (g) => +(g.nowMs / YEAR_MS).toFixed(2);

function rec(name) {
    let f = feats.get(name);
    if (f === undefined) {
        f = { ai: 0, human: 0, pirate: 0, independent: 0, faction: 0, none: 0, firstAiYear: null, firstHumanYear: null, byKind: {}, byEmpire: {} };
        feats.set(name, f);
    }
    return f;
}

function classOf(g, e) {
    if (e === null || e === undefined) return 'none';
    if (e === g.independentEmpire) return 'independent';
    if (e.pirateEmpireBaseHabitat !== null && e.pirateEmpireBaseHabitat !== undefined) return 'pirate';
    if (H.isHumanEmpire(g, e)) return 'human';
    if (e.dominantRace === null || e.dominantRace === undefined) return 'faction';
    return 'ai';
}

/** Records n acts of `name` by empire `e` (cls: the class, when the act is AI by its nature and has no empire). */
function hit(g, name, e, kind = '', n = 1, cls = null) {
    if (!(n > 0)) return;
    const f = rec(name);
    const c = cls ?? classOf(g, e);
    f[c] = (f[c] ?? 0) + n;
    const y = yearOf(g);
    if (e) {
        const b = (f.byEmpire[e.name] ??= { cls: c, n: 0, firstYear: y, byKind: {} });
        b.n += n;
        if (kind) b.byKind[kind] = (b.byKind[kind] ?? 0) + n;
    }
    if (c === 'ai') {
        if (f.firstAiYear === null) f.firstAiYear = y;
        if (kind) f.byKind[kind] = (f.byKind[kind] ?? 0) + n;
    }
    if (c === 'human' && f.firstHumanYear === null) f.firstHumanYear = y;
}

function gl(name, n) {
    if (n > 0) globals[name] = +((globals[name] ?? 0) + n).toFixed(3);
}

/** True once per object (WeakSet identity) under `name`. */
function fresh(name, obj) {
    if (obj === null || typeof obj !== 'object') return false;
    let s = seen.get(name);
    if (s === undefined) seen.set(name, (s = new WeakSet()));
    if (s.has(obj)) return false;
    s.add(obj);
    return true;
}

/** True once per primitive key under `name` (a Record key, an id). */
function freshKey(name, key) {
    let s = seenKeys.get(name);
    if (s === undefined) seenKeys.set(name, (s = new Set()));
    const k = String(key);
    if (s.has(k)) return false;
    s.add(k);
    return true;
}

/** The value changed since it was last seen (the first sighting counts as a change when `v` is not undefined). */
function changedTo(key, v) {
    if (last.has(key) && last.get(key) === v) return false;
    last.set(key, v);
    return true;
}

/** The numeric counter's growth since its last reading (negative when it fell; the first reading is its whole value). */
function delta(key, v) {
    const p = last.get(key) ?? 0;
    last.set(key, v);
    return v - p;
}

function empireById(g, id) {
    const n = Number(id);
    const arr = g.empires;
    const e = arr[n];
    if (e && e.empireId === n) return e;
    return arr.find((x) => x && x.empireId === n) ?? null;
}

// --- probes ------------------------------------------------------------------------------------------------------------

function probeSmarterAI(g, S) {
    const st = S.smarterAI;
    if (st) {
        for (const k of Object.keys(st.orders ?? {})) {
            const e = empireById(g, k);
            const o = st.orders[k];
            if (fresh('smarterAI.orders', o)) hit(g, 'smarterAI.orders', e, 'orders assigned');
            const sig = JSON.stringify(o.current);
            const prev = last.get(`sa.cur.${k}`);
            last.set(`sa.cur.${k}`, sig);
            if (prev !== undefined && prev !== sig) hit(g, 'smarterAI.orders', e, 'reweighed');
            const thrPrev = last.get(`sa.thr.${k}`) ?? false;
            if (o.threat && !thrPrev) hit(g, 'smarterAI.orders', e, 'threat signal');
            last.set(`sa.thr.${k}`, !!o.threat);
            const reachPrev = last.get(`sa.reach.${k}`) ?? false;
            if (o.reach && !reachPrev) hit(g, 'smarterAI.orders', e, 'reach signal');
            last.set(`sa.reach.${k}`, !!o.reach);
        }
        for (const k of Object.keys(st.debt ?? {})) {
            const prev = last.get(`sa.debt.${k}`) ?? false;
            if (st.debt[k] && !prev) hit(g, 'smarterAI.growthTaxDebt', empireById(g, k), 'entered debt override');
            last.set(`sa.debt.${k}`, !!st.debt[k]);
        }
    }
    const ec = S.smarterAIEconomy;
    if (ec) {
        for (const k of Object.keys(ec.debt ?? {})) {
            const prev = last.get(`se.debt.${k}`) ?? false;
            if (ec.debt[k] && !prev) hit(g, 'smarterAI.economy', empireById(g, k), 'in debt');
            last.set(`se.debt.${k}`, !!ec.debt[k]);
        }
        for (const k of Object.keys(ec.surplus ?? {})) {
            const prev = last.get(`se.sur.${k}`) ?? false;
            if (ec.surplus[k] && !prev) hit(g, 'smarterAI.economy', empireById(g, k), 'cash surplus');
            last.set(`se.sur.${k}`, !!ec.surplus[k]);
        }
    }
    const sc = S.smarterAIStatecraft;
    if (sc) {
        for (const k of Object.keys(sc.wonders ?? {})) {
            const plan = sc.wonders[k];
            if (plan !== null && plan !== undefined && fresh('smarterAI.wonders', plan)) hit(g, 'smarterAI.wonders', empireById(g, k), 'wonder plan');
        }
        for (const k of Object.keys(sc.spiedOn ?? {})) {
            const d = delta(`sa.spy.${k}`, (sc.spiedOn[k] ?? []).length);
            if (d > 0) hit(g, 'smarterAI.spiedOn', empireById(g, k), 'intelligence mission exposed (target)', d);
        }
    }
    const op = S.smarterAIOpening;
    if (op && typeof op === 'object') {
        for (const k of Object.keys(op)) {
            if (freshKey('smarterAI.opening', k)) hit(g, 'smarterAI.opening', empireById(g, k), 'opening entry');
        }
    }
}

function probeDiet(g, S) {
    const st = S.interstellarDiet;
    if (!st) return;
    const s = st.session;
    if (s) {
        if (fresh('diet.sessions', s)) hit(g, 'diet.sessions', st.host, s.emergency ? 'emergency' : 'regular');
        for (const d of s.delegates ?? []) if (fresh('diet.delegates', d)) hit(g, 'diet.delegates', d.empire, d.lesser ? 'lesser delegate' : 'delegate');
        for (const m of s.motions ?? []) {
            if (fresh('diet.motions', m)) hit(g, 'diet.motions', m.proposer, m.kind);
            for (const v of m.votes ?? []) if (fresh('diet.votes', v)) hit(g, 'diet.votes', v.empire, `vote ${v.vote}`);
        }
    }
    for (const h of st.history ?? []) {
        if (!fresh('diet.history', h)) continue;
        if (h.result === 'passed') hit(g, 'diet.passed', h.proposer, h.kind);
        else hit(g, 'diet.notPassed', h.proposer, `${h.result} ${h.kind}`);
    }
    for (const law of st.laws ?? []) if (fresh('diet.lawsInForce', law)) hit(g, 'diet.lawsInForce', law.empire, law.kind);
    if (st.emperor && fresh('diet.emperor', st.emperor)) hit(g, 'diet.emperorBids', st.emperor.empire, 'bid');
    const rg = st.regent ?? null;
    if (rg !== null && changedTo('diet.regent', rg.empireId)) hit(g, 'diet.regents', rg, 'regency');
    for (const fl of st.enforcers ?? []) if (fresh('diet.enforcers', fl)) hit(g, 'diet.enforcers', fl.target, `enforcers (${fl.stage ?? ''})`);
    for (const k of Object.keys(st.expelled ?? {})) if (freshKey('diet.expelled', k)) hit(g, 'diet.expelled', empireById(g, k), 'expelled');
    const c = st.counters ?? {};
    for (const k of Object.keys(c)) {
        if (typeof c[k] !== 'number') continue;
        gl(`diet.counter.${k}`, delta(`diet.c.${k}`, c[k]));
    }
    for (const k of ['passed', 'proposed']) {
        for (const kind of Object.keys(c[k] ?? {})) gl(`diet.counter.${k}.${kind}`, delta(`diet.c.${k}.${kind}`, c[k][kind]));
    }
}

function probeCouncil(g, S) {
    const st = S.council;
    if (!st) return;
    for (const c of st.councils ?? []) {
        const m = c.motion;
        if (m && fresh('council.motions', m)) hit(g, 'council.motions', m.proposer, m.kind);
        for (const v of m?.votes ?? []) if (fresh('council.votes', v)) hit(g, 'council.votes', v.empire, `vote ${v.vote}`);
        for (const r of c.results ?? []) if (fresh('council.results', r)) hit(g, 'council.results', r.proposer, `${r.passed ? 'passed' : 'failed'} ${r.kind}`);
        for (const s of c.sanctions ?? []) if (fresh('council.sanctions', s)) hit(g, 'council.sanctions', s.target, `${s.kind} (target)`);
        for (const k of Object.keys(c.condemned ?? {})) if (freshKey(`council.condemned.${c.id}`, k)) hit(g, 'council.condemned', empireById(g, k), 'condemned (target)');
        for (const t of c.threats ?? []) if (freshKey(`council.threats.${c.id}`, t.empireId)) hit(g, 'council.threats', t, 'threat (target)');
        for (const t of c.recognised ?? []) if (freshKey(`council.recognised.${c.id}`, t.empireId)) hit(g, 'council.recognised', t, 'recognised');
    }
}

function probeEspionage(g, S) {
    const es = S.espionage;
    if (!es) return;
    for (const c of es.crises ?? []) {
        if (fresh('espionage.crises', c)) {
            hit(g, 'espionage.crises', c.offender, 'crisis opened (offender)');
            hit(g, 'espionage.victims', c.victim, 'crisis opened (victim)');
        }
        if (c.response !== 'pending' && changedTo(`esp.resp.${c.id}`, c.response)) hit(g, 'espionage.responses', c.offender, `offender ${c.response}`);
    }
    for (const f of es.frames ?? []) if (fresh('espionage.frames', f)) hit(g, 'espionage.falseFlags', f.originator, 'false flag laid');
    for (const t of es.stolen ?? []) if (fresh('espionage.stolen', t)) hit(g, 'espionage.stolen', t.thief, 'tech stolen');
    for (const x of es.exposures ?? []) if (fresh('espionage.exposures', x)) hit(g, 'espionage.exposures', x.offender, `exposure (mission ${x.missionType})`);
}

function probeSecurity(g, S) {
    const sec = S.security;
    if (!sec) return;
    for (const t of sec.things ?? []) if (fresh('security.things', t)) hit(g, 'security.hiddenThings', t.empire, t.kind);
    for (const l of sec.leads ?? []) {
        if (fresh('security.leads', l)) hit(g, 'security.leads', l.empire, `${l.kind} lead`);
        if (changedTo(`sec.lvl.${l.id}`, l.level) && l.level === 'confirmed') hit(g, 'security.confirmed', l.empire, `${l.kind} confirmed`);
    }
    for (const i of sec.investigations ?? []) if (fresh('security.investigations', i)) hit(g, 'security.investigations', i.empire, 'investigation');
    for (const entry of sec.log ?? []) {
        if (fresh('security.log', entry)) hit(g, 'security.actions', entry.empire, entry.text.split(' ').slice(0, 2).join(' '));
    }
    for (const [e, d] of sec.purges ?? []) if (freshKey(`security.purge.${e.empireId}`, d)) hit(g, 'security.purges', e, 'purge');
    for (const [h, until] of sec.quarantine ?? []) if (freshKey('security.quarantine', `${h.habitatIndex}:${until}`)) hit(g, 'security.quarantines', h.empire, 'quarantine');
    for (const [h, until] of sec.martialLaw ?? []) if (freshKey('security.martial', `${h.habitatIndex}:${until}`)) hit(g, 'security.martialLaw', h.empire, 'martial law');
}

function probeReputation(g, S) {
    const rep = S.reputation;
    if (!rep) return;
    for (const key of Object.keys(rep.pairs ?? {})) {
        const owner = empireById(g, parseInt(key.split('>')[0], 10));
        for (const en of rep.pairs[key]) {
            if (fresh('reputation.entries', en)) hit(g, 'reputation.entries', owner, `${en.cause} ${en.value < 0 ? '(-)' : '(+)'}`);
        }
    }
}

function probeExchange(g, S) {
    const ex = S.exchange;
    if (!ex) return;
    for (const s of ex.sales ?? []) if (fresh('exchange.sales', s)) hit(g, 'exchange.intelSales', empireById(g, s.buyerId), `${s.by} sold ${s.item}`);
    for (const f of ex.fundLog ?? []) if (fresh('exchange.funding', f)) hit(g, 'exchange.funding', empireById(g, f.empireId), 'funded the Exchange');
    for (const c of ex.caughtLog ?? []) if (fresh('exchange.caught', c)) hit(g, 'exchange.caught', empireById(g, c.victimId), `caught outcome ${c.outcome}`);
    for (const m of ex.missionLog ?? []) if (fresh('exchange.missions', m)) hit(g, 'exchange.missionsAgainst', empireById(g, m.victimId), `mission type ${m.type}`);
    for (const gr of ex.grudgeLog ?? []) if (fresh('exchange.grudges', gr)) hit(g, 'exchange.grudges', empireById(g, gr.empireId), gr.source);
    for (const gf of ex.giftLog ?? []) if (fresh('exchange.gifts', gf)) hit(g, 'exchange.gifts', empireById(g, gf.weakerId), 'gift to weaker');
    for (const c of ex.contracts ?? []) if (fresh('exchange.contracts', c)) hit(g, 'exchange.contracts', c.victim, `${c.kind} contract (client or target)`);
}

function probePrivateers(g, S) {
    const pv = S.privateers;
    if (!pv) return;
    for (const k of Object.keys(pv.empires ?? {})) {
        const e = empireById(g, k);
        const st = pv.empires[k];
        for (const b of st.builds ?? []) if (fresh('privateers.builds', b)) hit(g, 'privateers.builds', e, 'privateer built');
        for (const inc of st.incidents ?? []) if (fresh('privateers.incidents', inc)) hit(g, 'privateers.incidents', e, 'privateer attack');
    }
}

function probeCharacters(g, S) {
    const cv = S.charactersVictory;
    if (!cv) return;
    for (const t of cv.trips ?? []) if (fresh('cv.vipTrips', t)) hit(g, 'cv.vipTrips', t.empire, String(t.reason).slice(0, 40));
    for (const k of Object.keys(cv.empires ?? {})) {
        const e = empireById(g, k);
        const st = cv.empires[k];
        for (const key of Object.keys(st.stats ?? {})) {
            if (typeof st.stats[key] !== 'number') continue;
            hit(g, 'cv.stats', e, key, delta(`cv.st.${k}.${key}`, st.stats[key]));
        }
        for (const tr of st.training ?? []) if (fresh('cv.training', tr)) hit(g, 'cv.training', e, 'governor training');
    }
}

function probeGenShips(g, S) {
    for (const key of Object.keys(S)) {
        if (key !== 'generationShips' && !key.startsWith('generationShips#')) continue;
        const st = S[key];
        if (st === null || typeof st !== 'object') continue;
        const owner = st.owner ?? null;
        if (st.phase && changedTo(`gs.ph.${key}`, st.phase)) hit(g, 'genShips.phase', owner, `phase ${st.phase}`);
        if (st.answer && changedTo(`gs.ans.${key}`, st.answer)) hit(g, 'genShips.answers', owner, `answer ${st.answer} by ${st.answeredBy ?? '?'}`);
        if (st.outcome && changedTo(`gs.out.${key}`, st.outcome)) hit(g, 'genShips.outcomes', owner, `outcome ${st.outcome}`);
        if (st.worldShipFate && changedTo(`gs.fate.${key}`, st.worldShipFate)) hit(g, 'genShips.worldShipFate', owner, `fate ${st.worldShipFate}`);
    }
}

function probePurifier(g, S) {
    const pu = S.purifier;
    if (!pu) return;
    if (pu.waker && changedTo('pur.waker', pu.waker.empireId)) hit(g, 'purifier.wakes', pu.waker, `wake (${pu.program ?? '?'})`);
    for (const v of pu.victims ?? []) if (freshKey('purifier.victims', v.empireId)) hit(g, 'purifier.victims', v, 'victim (an empire it has hit)');
    if (pu.phase && changedTo('pur.phase', pu.phase)) gl(`purifier.phase.${pu.phase}`, 1);
    gl('purifier.worlds.delta', delta('pur.worlds', pu.worlds ?? 0));
    gl('purifier.launches.delta', delta('pur.launches', pu.launches ?? 0));
}

function probeArchiveCores(g, S) {
    const ac = S.archiveCores;
    if (!ac) return;
    for (const c of ac.cores ?? []) {
        if (fresh('archiveCores.found', c)) hit(g, 'archiveCores.found', c.empire, `found at ${c.source}`);
        if (c.choice && changedTo(`ac.ch.${c.id}`, c.choice)) hit(g, 'archiveCores.choices', c.empire, `chose ${c.choice}`);
        hit(g, 'archiveCores.boosts', c.empire, 'boost', delta(`ac.st.${c.id}`, c.steps ?? 0));
    }
}

function probeProbeSwarm(g, S) {
    const ps = S.probeSwarm;
    if (!ps) return;
    if (ps.mothercoreKiller && freshKey('probe.killer', 'k')) hit(g, 'probeSwarm.mothercoreKilled', ps.mothercoreKiller, 'killed the mothercore');
    if (ps.phase && changedTo('ps.phase', ps.phase)) gl(`probeSwarm.phase.${ps.phase}`, 1);
    for (const k of ['stationsBuilt', 'shipsBuilt', 'engagements', 'kills', 'losses']) gl(`probeSwarm.${k}`, delta(`ps.${k}`, ps[k] ?? 0));
}

function probeGiantworks(g, S) {
    const gw = S.giantworks;
    if (!gw) return;
    for (const [si, site] of (gw.sites ?? []).entries()) {
        const sid = `${si}:${site.scaffoldName ?? ''}`;
        if (fresh('gw.sites', site)) gl('gw.sitesStarted', 1);
        for (const h of site.suppliers ?? []) if (fresh('gw.suppliers', h)) hit(g, 'gw.suppliers', h.empire, 'supplier world of a work');
        for (const k of Object.keys(site.protectDays ?? {})) {
            hit(g, 'gw.protectDays', empireById(g, k), 'warship days on station', delta(`gw.pd.${sid}.${k}`, site.protectDays[k]));
        }
        if (site.attackedBy && fresh('gw.attacks', site.attackedBy)) hit(g, 'gw.attacks', site.attackedBy.empire, 'attacked a work');
        if (site.sabotage && fresh('gw.sabotage', site.sabotage)) hit(g, 'gw.sabotage', site.sabotage.by, site.sabotage.kill ? 'destroyed scaffold' : 'construction sabotage');
        if (site.holder && changedTo(`gw.hold.${sid}`, site.holder.empireId)) hit(g, 'gw.holders', site.holder, 'took the finished work');
        if (site.captureBy !== undefined && site.captureBy !== null && changedTo(`gw.cap.${sid}`, site.captureBy)) hit(g, 'gw.captures', empireById(g, site.captureBy), 'captured by ground war');
        for (const k of Object.keys(site.aiPlan ?? {})) if (fresh('gw.aiPlan', site.aiPlan[k])) hit(g, 'gw.aiPlan', empireById(g, k), `plan ${site.aiPlan[k].action}`);
        if (site.exposed && fresh('gw.exposed', site.exposed)) hit(g, 'gw.exposed', empireById(g, site.exposed.empireId), 'exposed (Diet)');
        for (const c of site.convoys ?? []) if (fresh('gw.convoys', c)) hit(g, 'gw.convoys', c.origin?.empire ?? null, 'convoy left');
        for (const k of Object.keys(site.violations ?? {})) if (changedTo(`gw.vio.${sid}.${k}`, site.violations[k])) hit(g, 'gw.violations', empireById(g, k), 'Diet-law violation');
    }
    for (const k of Object.keys(gw.blockaded ?? {})) {
        const r = gw.blockaded[k];
        if (r && freshKey('gw.blockade', `${k}:${r.since}`)) hit(g, 'gw.blockades', empireById(g, r.by), "founders' supplier world blockaded");
    }
    for (const k of Object.keys(gw.stats ?? {})) gl(`gw.stat.${k}`, delta(`gw.st.${k}`, gw.stats[k]));
}

const BEACON_AI_STATS = new Set(['aiStrikes', 'aiRelief', 'aiCattle', 'aiCore', 'aiDepot', 'aiRetake', 'stagingSeen', 'stagingKills', 'retaken', 'wfFormed', 'wfOffensives', 'wfResponses', 'moratoriums', 'moratoriumBreaches', 'evacuations']);

function probeBeacon(g, S) {
    const bc = S.beacon;
    if (!bc) return;
    for (const k of Object.keys(bc.stats ?? {})) {
        const d = delta(`bc.st.${k}`, bc.stats[k] ?? 0);
        if (d <= 0) continue;
        if (BEACON_AI_STATS.has(k)) hit(g, 'beacon.aiCounters', null, k, d, 'ai');
        else gl(`beacon.stat.${k}`, d);
    }
    const wc = bc.warCredit;
    if (wc) {
        for (const k of Object.keys(wc.points ?? {})) {
            const tot = Object.values(wc.points[k] ?? {}).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
            hit(g, 'beacon.warCredit', empireById(g, k), 'war credit points', delta(`bc.wc.${k}`, tot));
        }
        if (wc.top >= 0 && changedTo('bc.wc.top', wc.top)) hit(g, 'beacon.warCreditTop', empireById(g, wc.top), 'top contributor');
    }
    const m = bc.mega;
    if (m) {
        if (fresh('beacon.mega', m)) hit(g, 'beacon.mega', empireById(g, m.builder), 'proposed the Severance');
        for (const id of m.contributors ?? []) if (freshKey('beacon.contrib', id)) hit(g, 'beacon.megaPledges', empireById(g, id), 'pledged parts');
        for (const k of Object.keys(m.lastSentBy ?? {})) {
            if (changedTo(`bc.ms.${k}`, m.lastSentBy[k])) hit(g, 'beacon.megaFreighters', empireById(g, k), 'freighter sent');
        }
        if (m.status && changedTo('bc.mega.status', m.status)) gl(`beacon.mega.status.${m.status}`, 1);
    }
    const pr = bc.parts;
    if (pr) {
        for (const k of Object.keys(pr.held ?? {})) {
            const hp = pr.held[k];
            const e = empireById(g, k);
            for (const f of ['beamLens', 'linkConduit', 'cloakLattice']) {
                if (hp[f] && freshKey(`beacon.part.${k}`, f)) hit(g, 'beacon.parts', e, f);
            }
            if (typeof hp.mindFragments === 'number') hit(g, 'beacon.parts', e, 'mindFragments', delta(`bc.mf.${k}`, hp.mindFragments));
            if (typeof hp.voidFrames === 'number') hit(g, 'beacon.parts', e, 'voidFrames', delta(`bc.vf.${k}`, hp.voidFrames));
            if (hp.blueprint && freshKey(`beacon.bp`, k)) hit(g, 'beacon.parts', e, 'blueprint');
        }
        for (const k of Object.keys(pr.sent ?? {})) if (changedTo(`bc.sent.${k}`, pr.sent[k].id)) hit(g, 'beacon.planetVisits', empireById(g, k), 'sent a ship to the precursor planet');
    }
    for (const c of bc.cores ?? []) if (fresh('beacon.cores', c)) gl('beacon.coresDesignated.objects', 1);
}

function probeRelocation(g, S) {
    const rl = S.beaconRelocation;
    if (!rl) return;
    for (const o of rl.orders ?? []) {
        const e = empireById(g, o.empireId);
        if (fresh('reloc.orders', o)) hit(g, 'reloc.orders', e, o.abandon ? 'abandon' : 'evacuate');
        hit(g, 'reloc.peopleMoved', e, 'people moved', delta(`rl.mv.${o.id}`, o.moved ?? 0));
        hit(g, 'reloc.seized', e, 'people taken by the Reclaimers', delta(`rl.sz.${o.id}`, o.seized ?? 0));
        if (o.ended && changedTo(`rl.end.${o.id}`, o.ended)) hit(g, 'reloc.ended', e, `ended ${o.ended}`);
    }
    for (const k of Object.keys(rl.aiLast ?? {})) {
        for (const h of Object.keys(rl.aiLast[k] ?? {})) if (freshKey(`reloc.ai.${k}`, h)) hit(g, 'reloc.aiOrders', empireById(g, k), 'AI evacuation order from a world');
    }
}

function probeStillness(g, S) {
    const sl = S.stillness;
    if (!sl) return;
    const en = sl.engine;
    if (en) {
        const owner = empireById(g, en.ownerId);
        if (fresh('stillness.engines', en)) hit(g, 'stillness.built', owner, 'Stillness Engine built');
        if (en.status && changedTo('sl.status', en.status)) hit(g, 'stillness.status', owner, `status ${en.status}`);
        for (const id of en.struck ?? []) if (freshKey('sl.struck', id)) hit(g, 'stillness.attacks', empireById(g, id), 'attacked the Engine');
        for (const id of en.answered ?? []) if (freshKey('sl.answered', id)) hit(g, 'stillness.protects', empireById(g, id), 'answered to protect the Engine');
        for (const k of Object.keys(en.sides ?? {})) if (changedTo(`sl.side.${k}`, en.sides[k])) hit(g, 'stillness.sides', empireById(g, k), `side ${en.sides[k]}`);
        for (const id of en.warOver ?? []) if (freshKey('sl.warOver', id)) hit(g, 'stillness.warOver', empireById(g, id), 'went to war over it');
        for (const k of Object.keys(en.strikes ?? {})) if (changedTo(`sl.strike.${k}`, en.strikes[k])) hit(g, 'stillness.strikes', empireById(g, k), 'strike sent');
    }
    for (const w of sl.wars ?? []) {
        if (!fresh('stillness.wars', w)) continue;
        hit(g, 'stillness.wars', empireById(g, w.a), `${w.kind} war (first empire)`);
        hit(g, 'stillness.wars', empireById(g, w.b), `${w.kind} war (second empire)`);
    }
    for (const k of Object.keys(sl.stats ?? {})) gl(`stillness.stat.${k}`, delta(`sl.st.${k}`, sl.stats[k]));
}

function probeCorrupted(g, S) {
    const co = S.corruptedEmpire;
    if (!co) return;
    const ce = empireById(g, co.empireId);
    if (co.empireId !== null && co.empireId !== undefined && changedTo('co.id', co.empireId)) hit(g, 'corrupt.chosen', ce, 'chosen as the corrupted empire');
    if (co.ended && changedTo('co.ended', co.ended)) hit(g, 'corrupt.ended', ce, `ended ${co.ended}`);
    hit(g, 'corrupt.acts', ce, 'pattern act', delta('co.acts', co.acts ?? 0));
    hit(g, 'corrupt.raids', ce, 'raid', delta('co.raids', co.raids ?? 0));
    hit(g, 'corrupt.parks', ce, 'park', delta('co.parks', co.parks ?? 0));
    for (const w of co.wars ?? []) if (fresh('corrupt.wars', w)) hit(g, 'corrupt.wars', ce, `war on target: ${w.reason}`);
    for (const v of co.votes ?? []) if (fresh('corrupt.votes', v)) hit(g, 'corrupt.votes', ce, `Diet vote against preparation: ${v.kind}`);
}

function probeHoldouts(g, S) {
    const ho = S.age2Holdouts;
    if (!ho) return;
    for (const h of ho.holdouts ?? []) {
        if (fresh('age2.holdouts', h)) hit(g, 'age2.holdouts', h.empire, 'holdout core');
        if (h.coreFate && changedTo(`ho.fate.${h.id}`, h.coreFate)) hit(g, 'age2.coreFate', h.empire, `core ${h.coreFate}`);
    }
    for (const p of ho.pending ?? []) if (fresh('age2.pending', p)) hit(g, 'age2.riggedColonies', p.by, 'rigged colony taken');
    for (const k of Object.keys(ho.heldNote ?? {})) if (changedTo(`ho.note.${k}`, ho.heldNote[k])) hit(g, 'age2.heldNote', empireById(g, k), 'shield-holds note');
    for (const ev of ho.evacuees ?? []) if (fresh('age2.evacuees', ev)) gl('age2.evacueeGroups', 1);
}

function probeArks(g, S) {
    const ak = S.giantworksArk;
    if (!ak) return;
    for (const a of ak.arks ?? []) {
        const e = a.lastEmpire ?? null;
        if (fresh('arks.arks', a)) hit(g, 'arks.arks', e, `ark ${a.phase}`);
        if (a.phase && changedTo(`ak.ph.${a.workId}`, a.phase)) hit(g, 'arks.phases', e, `phase ${a.phase}`);
        for (const att of a.attackers ?? []) if (freshKey(`arks.att.${a.workId}`, att)) hit(g, 'arks.attacks', empireById(g, att), 'attacked an ark');
        hit(g, 'arks.fights', e, 'fight', delta(`ak.f.${a.workId}`, a.fights ?? 0));
        hit(g, 'arks.escapes', e, 'escape', delta(`ak.e.${a.workId}`, a.escapes ?? 0));
    }
}

function probeWarCrimes(g, S) {
    const wc = S.warCrimes;
    if (!wc) return;
    for (const rec of Object.values(wc.records ?? {})) {
        const e = empireById(g, rec.empireId);
        for (const kind of Object.keys(rec.counts ?? {})) hit(g, 'warCrimes.counts', e, kind, delta(`wc.${rec.empireId}.${kind}`, rec.counts[kind] ?? 0));
    }
    for (const t of wc.tribunals ?? []) {
        if (!fresh('warCrimes.tribunals', t)) continue;
        const te = g.empires.find((x) => x && (x.name === t.target || String(x.empireId) === String(t.target))) ?? null;
        hit(g, 'warCrimes.tribunals', te, `${t.outcome}${t.passed ? ' (passed)' : ''}`);
    }
}

function probeOrbital(g, S) {
    const os = S.orbitalSuperiority;
    if (!os) return;
    for (const inv of os.invasions ?? []) {
        const key = `${inv.h}:${inv.started}`;
        if (fresh('orbital.invasions', inv)) hit(g, 'orbital.invasions', empireById(g, inv.inv), 'orbital landing started');
        if (inv.reliefSent && changedTo(`orb.rel.${key}`, true)) hit(g, 'orbital.reliefs', empireById(g, inv.def), 'relief fleet sent (defender)');
        if (inv.withdrawn && changedTo(`orb.wd.${key}`, true)) hit(g, 'orbital.withdrawals', empireById(g, inv.inv), 'invader withdrew');
    }
    for (const h of os.holds ?? []) if (fresh('orbital.holds', h)) hit(g, 'orbital.holds', empireById(g, h.e), 'AI held an orbit');
    for (const k of Object.keys(os.stats ?? {})) gl(`orbital.stat.${k}`, delta(`os.st.${k}`, os.stats[k] ?? 0));
}

function probeBlockades(g, S) {
    const bb = S.blockadesBite;
    if (!bb) return;
    for (const b of bb.active ?? []) {
        if (fresh('blockades.declared', b)) hit(g, 'blockades.declared', empireById(g, b.by), 'blockade declared (holder)');
        if (b.relief && fresh('blockades.reliefs', b.relief)) hit(g, 'blockades.reliefs', empireById(g, b.owner), 'relief fleet (blockaded side)');
    }
    for (const d of bb.duties ?? []) if (fresh('blockades.duties', d)) hit(g, 'blockades.duties', empireById(g, d.e), 'blockade duty fleet');
    for (const p of bb.pending ?? []) if (fresh('blockades.pending', p)) hit(g, 'blockades.pending', empireById(g, p.by), 'blockade pending (holder)');
}

function probeMothball(g, S) {
    const mb = S.mothballing;
    if (!mb) return;
    for (const s of mb.ships ?? []) if (fresh('mothball.ships', s)) hit(g, 'mothball.ships', s.empire, 'ship put in reserve');
    const st = mb.stats ?? {};
    for (const k of Object.keys(st)) {
        if (typeof st[k] === 'number') {
            const d = delta(`mb.st.${k}`, st[k]);
            if (k === 'aiMothballed' || k === 'aiReactivated') hit(g, 'mothball.aiCounters', null, k, d, 'ai');
            else gl(`mothballing.stat.${k}`, d);
        } else if (st[k] && typeof st[k] === 'object') {
            for (const kk of Object.keys(st[k])) hit(g, 'mothball.aiReviews', null, `${k}:${kk}`, delta(`mb.st.${k}.${kk}`, st[k][kk]), 'ai');
        }
    }
}

function probeVeterans(g, S) {
    const vt = S.veterans;
    if (!vt || !vt.ships) return;
    for (const [bo, rec] of vt.ships) {
        const e = bo.empire ?? null;
        const pr = vetPrev.get(bo) ?? 0;
        if (rec.rank > pr) {
            hit(g, 'veterans.promotions', e, `reached rank ${rec.rank}`);
            vetPrev.set(bo, rec.rank);
        }
        const pb = vetBattles.get(bo) ?? 0;
        if (rec.battles > pb) {
            hit(g, 'veterans.battles', e, 'battle counted', rec.battles - pb);
            vetBattles.set(bo, rec.battles);
        }
    }
}

function probeBeaching(g, S) {
    const bch = S.beaching;
    if (!bch) return;
    for (const s of bch.ships ?? []) if (fresh('beaching.beached', s)) hit(g, 'beaching.beached', s.empire, 'ship beached');
    for (const [h, id] of bch.battles ?? []) if (fresh('beaching.battles', h)) hit(g, 'beaching.battles', empireById(g, id), 'ground battle over a beached ship');
    const st = bch.stats ?? {};
    for (const k of Object.keys(st)) {
        if (typeof st[k] === 'number') {
            const d = delta(`bch.st.${k}`, st[k]);
            if (k === 'ai' || k === 'aiCapital' || k === 'aiCleanups') hit(g, 'beaching.aiCounters', null, k, d, 'ai');
            else gl(`beaching.stat.${k}`, d);
        } else if (st[k] && typeof st[k] === 'object') {
            for (const kk of Object.keys(st[k])) hit(g, 'beaching.aiReviews', null, `${k}:${kk}`, delta(`bch.r.${k}.${kk}`, st[k][kk]), 'ai');
        }
    }
}

function probeInterdiction(g, S) {
    const ji = S.jumpInterdiction;
    if (!ji) return;
    for (const sp of ji.spools ?? []) {
        if (!fresh('interdiction.spools', sp)) continue;
        hit(g, 'interdiction.ships', sp.ship?.empire ?? null, 'jump interdicted (ship)');
        hit(g, 'interdiction.fields', sp.base?.empire ?? null, 'field held the jump (interdicting base)');
    }
    const st = ji.stats ?? {};
    for (const k of Object.keys(st)) {
        if (typeof st[k] !== 'number') continue;
        const d = delta(`ji.st.${k}`, st[k]);
        if (k === 'borderBaseLocations' || k === 'raidsRaised') hit(g, 'interdiction.aiCounters', null, k, d, 'ai');
        else gl(`interdiction.stat.${k}`, d);
    }
}

function probeGroundAndStrikes(g) {
    // AI fleet missions (a new mission object): blockades, attacks, bombard, capture, raids. As orbital hook's strike sampling.
    for (const e of g.empires) {
        if (e === null || e === g.independentEmpire) continue;
        for (const f of e.shipGroups ?? []) {
            const m = f.mission;
            if (m == null || seenMissions.has(m)) continue;
            seenMissions.add(m);
            const kind = STRIKE_TYPES.get(m.type);
            if (kind === undefined) continue;
            const th = m.targetHabitat ?? null;
            const tb = m.targetBuiltObject ?? null;
            const ts = m.targetShipGroup ?? null;
            const owner = th !== null ? th.empire : tb !== null ? tb.empire : ts !== null ? ts.empire : null;
            if (owner === null || owner === e) continue;
            hit(g, 'strikes.missions', e, `${kind} mission (${th !== null ? 'colony' : tb !== null ? 'base or ship' : 'fleet'})`);
        }
    }
    // Ground battles: a habitat with invading troops from another normal empire, from the first to the last day.
    for (const h of g.habitats) {
        const inv = h.invadingTroops !== null && h.invadingTroops !== undefined && h.invadingTroops.count > 0 ? invaderOf(g, h) : null;
        const was = invading.get(h.habitatIndex);
        if (inv !== null && was === undefined) {
            invading.set(h.habitatIndex, { e: inv, start: g.nowMs });
            hit(g, 'groundCombat.battles', inv, 'ground battle begun');
        } else if (inv === null && was !== undefined) {
            invading.delete(h.habitatIndex);
            const days = (g.nowMs - was.start) / (YEAR_MS / 360);
            const rec2 = (gcAi[was.e.name] ??= { empireId: was.e.empireId, battles: 0, days: 0, maxDays: 0, firstYear: yearOf(g) });
            rec2.battles++;
            rec2.days += days;
            rec2.maxDays = Math.max(rec2.maxDays, days);
        }
    }
}

function invaderOf(g, h) {
    const t = h.invadingTroops;
    if (t === null || t.count === 0) return null;
    for (const troop of t.items) {
        const e = troop?.empire ?? null;
        if (e === null || troop.type === 5 /* TroopType.PirateRaider */) continue;
        if (e === g.independentEmpire || e.pirateEmpireBaseHabitat !== null || e === h.empire) continue;
        return e;
    }
    return null;
}

function probeSlavery(g) {
    for (const e of g.empires) {
        if (e === null || classOf(g, e) !== 'ai') continue;
        const allow = SL.slaveryAllowed(e);
        if (allow && changedTo(`sl.allow.${e.empireId}`, true)) hit(g, 'slavery.allowed', e, 'allowed slavery');
        const pen = e.slavery?.penal ?? [];
        hit(g, 'slavery.penalColonies', e, 'penal colony', delta(`sl.pen.${e.empireId}`, pen.length));
        const stats = e.slavery?.stats ?? {};
        for (const k of Object.keys(stats)) if (typeof stats[k] === 'number') hit(g, 'slavery.stats', e, k, delta(`sl.st.${e.empireId}.${k}`, stats[k]));
    }
}

// --- hook entry points -------------------------------------------------------------------------------------------------

const PROBES = [
    ['smarterAI', probeSmarterAI], ['diet', probeDiet], ['council', probeCouncil], ['espionage', probeEspionage],
    ['security', probeSecurity], ['reputation', probeReputation], ['exchange', probeExchange], ['privateers', probePrivateers],
    ['characters', probeCharacters], ['genShips', probeGenShips], ['purifier', probePurifier], ['archiveCores', probeArchiveCores],
    ['probeSwarm', probeProbeSwarm], ['giantworks', probeGiantworks], ['beacon', probeBeacon], ['relocation', probeRelocation],
    ['stillness', probeStillness], ['corrupted', probeCorrupted], ['holdouts', probeHoldouts], ['arks', probeArks],
    ['warCrimes', probeWarCrimes], ['orbital', probeOrbital], ['blockades', probeBlockades], ['mothball', probeMothball],
    ['veterans', probeVeterans], ['beaching', probeBeaching], ['interdiction', probeInterdiction],
];

function run(name, fn) {
    try {
        fn();
    } catch (e) {
        const x = (errors[name] ??= { count: 0, first: String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ') });
        x.count++;
    }
}

export async function start(ctx) {
    H = await ctx.load('humans');
    SL = await ctx.load('slavery');
    ctx.report.featureUsage = {};
}

// A sim frame is 1/100 of a game day (36,000 frames a game year). The state probes run every PROBE_EVERY frames (a
// created object lives in its list for days, so nothing is missed); the sweeps of every habitat and fleet run once a game day.
const PROBE_EVERY = 10;
const DAY_FRAMES = 100;

export function frame(ctx, _dt, g) {
    frames++;
    const S = g.scenario?.state;
    if (!S) return;
    if (frames % PROBE_EVERY === 0) for (const [name, fn] of PROBES) run(name, () => fn(g, S));
    if (frames % DAY_FRAMES === 0) {
        run('groundAndStrikes', () => probeGroundAndStrikes(g));
        run('slavery', () => probeSlavery(g));
    }
}

export function chunk(ctx) {
    const g = ctx.g;
    const S = g.scenario?.state ?? {};
    ctx.report.featureUsage = {
        gameYears: yearOf(g),
        frames,
        features: Object.fromEntries(feats),
        globals,
        gcAi,
        stateKeys: Object.keys(S).sort(),
        flags: g.scenario?.flags ?? null,
        errors,
    };
}
