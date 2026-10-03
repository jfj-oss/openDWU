// Headless screenshots of the message windows (messagePopups.ts): the popup card, the conversation panel and the event
// panel for several message types, at 1920 × 1080 (dpr 1) and the 4K frame (dpr 2).
// Usage: node scripts/msgpopups-shots.mjs <baseUrl> [outDir]
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots/msgpopups'] = process.argv.slice(2);
import { mkdirSync } from 'node:fs';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const logs = [];

async function run(dpr) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
    page.on('console', (m) => m.type() === 'error' && logs.push(`[dpr${dpr} ${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[dpr${dpr} pageerror] ${e.message}`));
    await page.goto(`${base}?autostart=1`);
    await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 180000 });
    await page.waitForFunction(async () => (await import('/src/ui/messagePopups.ts')).showEventMessagePopup !== undefined && document.querySelector('.message-stubs') !== null, null, { timeout: 60000 });
    await page.waitForTimeout(3000);
    const scenes = ['card-underattack', 'card-colonylost', 'card-research', 'card-war', 'talk-pirate', 'talk-war', 'talk-treaty', 'talk-info', 'event-ruins', 'event-wonder', 'event-history', 'suggestion'];
    for (const scene of scenes) {
        const info = await page.evaluate(async (scene) => {
            const { galaxy } = window.__dwu;
            const player = galaxy.playerEmpire;
            const M = await import('/src/sim/messages.ts');
            const P = await import('/src/ui/messagePopups.ts');
            const D = await import('/src/sim/diplomacy.ts');
            const { galaxyStarDate } = await import('/src/sim/tick/simTime.ts');
            const { closeAllOriginalWindows } = await import('/src/ui/originalWindow.ts');
            closeAllOriginalWindows();
            const T = M.EmpireMessageType;
            const others = galaxy.empires.filter((e) => e !== player && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null);
            const pirate = [...galaxy.empires, ...(galaxy.pirateEmpires ?? [])].find((e) => e && e.pirateEmpireBaseHabitat !== null) ?? null;
            const other = others[0];
            const colony = player.colonies?.[0] ?? player.capital ?? null;
            // A conversation opened from its stub is a queued entry (the dialog closes when its entry leaves the queue).
            const talk = (entry) => {
                P.conversationQueue().push(entry);
                P.openConversation(entry);
            };
            const mk = (sender, type, subject, text, title = '') => {
                const m = new M.EmpireMessage(sender, type, subject);
                m.description = text;
                m.title = title;
                m.starDate = galaxyStarDate(galaxy);
                return m;
            };
            switch (scene) {
                case 'card-underattack':
                    P.openMessageCard(mk(player, T.BattleUnderAttack, colony, `Our colony at ${colony?.name ?? 'Home'} is under attack by pirate raiders!`));
                    break;
                case 'card-colonylost':
                    P.openMessageCard(mk(other, T.ColonyLost, colony, `We have lost control of ${colony?.name ?? 'a colony'} to the ${other.name}.`));
                    break;
                case 'card-research': {
                    const node = player.research?.techTree?.find((n) => n.def.components.length > 0) ?? null;
                    P.openMessageCard(mk(player, T.ResearchBreakthrough, node, `Our engineers have completed research in ${node?.def?.name ?? 'Wave Weapons'}. This breakthrough provides access to new components`));
                    break;
                }
                case 'card-war':
                    P.openMessageCard(mk(other, T.DiplomaticRelationChange, D.DiplomaticRelationType.War, 'You have left us no choice. We declare WAR on your empire!'));
                    break;
                case 'talk-pirate': {
                    if (pirate === null) return 'no pirate';
                    const m = mk(pirate, T.PirateOfferProtection, null, 'Space is a dangerous place. For a modest monthly fee our fleets will make sure nothing bad happens to your ships and colonies...');
                    m.money = 1500;
                    talk({ message: m, conversation: 'PIRATE_PROTECTIONPROPOSEINITIATE', sender: pirate });
                    break;
                }
                case 'talk-war':
                    talk({ message: mk(other, T.DiplomaticRelationChange, D.DiplomaticRelationType.War, 'Your aggression cannot go unanswered. From this moment we are at war!'), conversation: 'WAR_DECLARE', sender: other });
                    break;
                case 'talk-treaty': {
                    // A real pending proposal from the other empire (the answerable treaty offer).
                    // Make it the treaty their strategy wants (isProposalValid), with a strategy that wants one.
                    const { determineDesiredDiplomaticRelationTypical } = await import('/src/sim/diplomacyTick.ts');
                    const theirs = other.diplomaticRelations.byEmpire(player);
                    if (theirs) theirs.strategy = D.DiplomaticStrategy.Ally;
                    const want = determineDesiredDiplomaticRelationTypical(theirs ? theirs.strategy : D.DiplomaticStrategy.Undefined, theirs ? theirs.type : D.DiplomaticRelationType.NotMet);
                    const prop = new D.DiplomaticRelation(want, other, other, player, false);
                    prop.lastDiplomacyTradeOfferDate = galaxyStarDate(galaxy);
                    player.proposedDiplomaticRelations.add(prop);
                    talk({ message: mk(other, T.ProposeDiplomaticRelation, want, 'We propose a Free Trade Agreement between our empires. Our merchants would profit greatly.'), conversation: 'OFFER_FREETRADE', sender: other });
                    break;
                }
                case 'talk-info': {
                    const m = mk(other, T.SellInfoRuins, null, 'We have discovered some interesting ruins in a nearby system. For 2,000 credits we will tell you where they are.');
                    m.money = 2000;
                    talk({ message: m, conversation: 'INFO_OFFER_RUINS', sender: other });
                    break;
                }
                case 'event-ruins':
                    P.showEventMessagePopup({
                        title: 'Ancient Ruins discovered',
                        text: 'Our explorers have found the remains of an ancient civilization on this world. The ruins appear to be largely intact.\n\nShould we investigate the ruins?',
                        imageUrl: '/assets/dwu/images/environment/ruins/ruin_3.png',
                        footer: 'Star date 2500.3',
                        actions: [{ label: 'Investigate Ruins', onClick: () => {} }, { label: 'Leave the Ruins alone', onClick: () => {} }],
                    });
                    break;
                case 'event-wonder':
                    P.showEventMessagePopup({
                        title: 'Wonder built: Great Temple',
                        text: 'The Great Temple has been completed. Its splendour will inspire our people for generations to come.',
                        imageUrl: '/assets/dwu/images/environment/planetaryfacilities/facility_10.png',
                        footer: 'Star date 2500.3',
                        onGoTo: () => {},
                    });
                    break;
                case 'suggestion': {
                    const aq = await import('/src/sim/advisorQueue.ts');
                    const A = await import('/src/ui/advisorSuggestions.ts');
                    const sg = new M.EmpireMessage(player, T.AdvisorSuggestion, colony);
                    sg.advisorMessageType = aq.AdvisorMessageType.Colonization;
                    sg.starDate = galaxyStarDate(galaxy);
                    sg.description = `We recommend colonizing ${colony?.name ?? 'this world'}: it has a suitable climate and valuable resources.`;
                    aq.addAdvisorSuggestion(player, sg);
                    A.openAdvisorSuggestion(sg);
                    break;
                }
                case 'event-history':
                    P.showEventMessagePopup({ title: 'A secret revealed', text: 'Long ago the Shakturi waged a terrible war across the galaxy...', imageUrl: null, footer: 'Star date 2500.3' });
                    break;
            }
            return scene === 'talk-treaty' ? `ok ${document.querySelector('.msg-talk') ? 'open' : 'closed'}` : 'ok';
        }, scene);
        await page.waitForTimeout(1200);
        const out = `${outDir}/${scene}-${dpr === 2 ? '4k' : '1080'}.png`;
        await page.screenshot({ path: out });
        console.log(`${scene}: ${info} -> ${out}`);
    }
    // The real flow: messages arrive as stubs; a left click on a stub opens its window (the card sits beside the list).
    await page.evaluate(async () => {
        const { closeAllOriginalWindows } = await import('/src/ui/originalWindow.ts');
        closeAllOriginalWindows();
        const M = await import('/src/sim/messages.ts');
        const galaxy = window.__dwu.galaxy;
        const player = galaxy.playerEmpire;
        const other = galaxy.empires.find((e) => e !== player && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null);
        M.sendMessageToEmpire(player, player, M.EmpireMessageType.ColonyGained, player.capital ?? null, 'We have gained control of a new colony!');
        M.sendMessageToEmpire(other, player, M.EmpireMessageType.GiveGift, null, 'Please accept this gift of 5,000 credits as a token of our friendship.');
    });
    await page.waitForTimeout(1500);
    for (const [kind, name] of [['message', 'stub-card'], ['conversation', 'stub-talk']]) {
        const stub = page.locator(`.message-stubs .message-stub-${kind}`).first();
        if ((await stub.count()) === 0) {
            console.log(`${name}: no stub`);
            continue;
        }
        await stub.click();
        await page.waitForTimeout(800);
        const out = `${outDir}/${name}-${dpr === 2 ? '4k' : '1080'}.png`;
        await page.screenshot({ path: out });
        console.log(`${name}: -> ${out}`);
    }
    // The pause rule: a conversation paused the game; closing it resumes.
    const pause = await page.evaluate(async () => {
        const P = await import('/src/ui/messagePopups.ts');
        const { closeAllOriginalWindows } = await import('/src/ui/originalWindow.ts');
        closeAllOriginalWindows();
        const time = window.__dwu.time;
        if (time) time.paused = false;
        const before = time?.paused;
        const M = await import('/src/sim/messages.ts');
        const galaxy = window.__dwu.galaxy;
        const other = galaxy.empires.find((e) => e !== galaxy.playerEmpire && e !== galaxy.independentEmpire);
        const entry = { message: new M.EmpireMessage(other, M.EmpireMessageType.GeneralWarning, null), conversation: 'WARNING_GENERAL', sender: other };
        entry.message.starDate = (await import('/src/sim/tick/simTime.ts')).galaxyStarDate(galaxy);
        P.conversationQueue().push(entry);
        P.openConversation(entry);
        const during = time?.paused;
        const opened = P.openMessageKey() === entry.message && document.querySelector('.msg-talk') !== null;
        closeAllOriginalWindows();
        return { before, during, opened, after: time?.paused };
    });
    console.log('pause', JSON.stringify(pause));
    await page.close();
}

await run(1);
await run(2);
await browser.close();
for (const l of logs) console.log(l);
