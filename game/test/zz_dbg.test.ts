import { it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
it('dbg', async () => {
    const gameData = await loadGameDataFs();
    const g = createTickGame(gameData).galaxy;
    for (const p of g.pirateEmpires) console.log('P', p.name, p.builtObjects.map((b) => `${b.role}/${b.subRole}/w${b.warpSpeed}/f${b.firepowerRaw}/fn${b.isFunctional}/t${b.topSpeed}`).join(' '));
    for (const e of g.empires) console.log('E', e.name, e.builtObjects.filter((b) => b.role === 1).length);
}, 600000);
