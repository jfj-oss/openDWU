// Port of fighters.txt loader: FighterSpecificationList.cs LoadFromFile (line 44).
// Pure parsing — no fs. Handles UTF-8 BOM, `'`-comment lines, and CRLF.

export interface Fighter {
    fighterId: number;
    name: string;
    type: number; // 0=Interceptor, 1=Bomber, 2=Missile Bomber
    techLevel: number;

    energyCapacity: number;
    energyRechargeRate: number;

    topSpeed: number;
    topSpeedEnergyConsumptionRate: number;
    accelerationRate: number;
    turnRate: number;
    engineExhaustImageIndex: number;

    shieldsCapacity: number;
    shieldRechargeRate: number;
    damageRepairRate: number;
    countermeasureModifier: number;
    targetingModifier: number;

    weaponType: number; // 0=beam, 1=torpedo, 2=missile
    weaponImageIndex: number;
    weaponDamage: number;
    weaponRange: number;
    weaponEnergyRequired: number;
    weaponSpeed: number;
    weaponDamageLoss: number;
    weaponFireRate: number;
    weaponSoundEffectFilename: string;
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Port of FighterSpecificationList.cs LoadFromFile (line 44).
export function parseFighters(text: string): Fighter[] {
    const fighters: Fighter[] = [];
    const lines = stripBom(text).split(/\r\n|\r|\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line === '' || line.substring(0, 1) === "'") {
            continue;
        }

        const parts = line.split(',').map((p) => p.trim());
        if (parts.length < 25) {
            continue;
        }

        const fighterId = parseInt(parts[0], 10);
        const name = parts[1];
        const type = parseInt(parts[2], 10);
        const techLevel = parseFloat(parts[3]); // double

        const energyCapacity = parseInt(parts[4], 10);
        const energyRechargeRate = parseFloat(parts[5]); // float

        const topSpeed = parseInt(parts[6], 10);
        const topSpeedEnergyConsumptionRate = parseFloat(parts[7]); // float
        const accelerationRate = parseFloat(parts[8]); // float
        const turnRate = parseFloat(parts[9]);
        const engineExhaustImageIndex = parseInt(parts[10], 10);

        const shieldsCapacity = parseInt(parts[11], 10);
        const shieldRechargeRate = parseFloat(parts[12]);
        const damageRepairRate = parseInt(parts[13], 10);
        const countermeasureModifier = parseInt(parts[14], 10);
        const targetingModifier = parseInt(parts[15], 10);

        const weaponType = parseInt(parts[16], 10);
        const weaponImageIndex = parseInt(parts[17], 10);
        const weaponDamage = parseInt(parts[18], 10);
        const weaponRange = parseInt(parts[19], 10);
        const weaponEnergyRequired = parseInt(parts[20], 10);
        const weaponSpeed = parseInt(parts[21], 10);
        const weaponDamageLoss = parseInt(parts[22], 10);
        const weaponFireRate = parseInt(parts[23], 10);
        const weaponSoundEffectFilename = parts[24];

        if (
            Number.isNaN(fighterId) ||
            Number.isNaN(type) ||
            Number.isNaN(techLevel) ||
            Number.isNaN(energyCapacity) ||
            Number.isNaN(energyRechargeRate) ||
            Number.isNaN(topSpeed) ||
            Number.isNaN(topSpeedEnergyConsumptionRate) ||
            Number.isNaN(accelerationRate) ||
            Number.isNaN(turnRate) ||
            Number.isNaN(engineExhaustImageIndex) ||
            Number.isNaN(shieldsCapacity) ||
            Number.isNaN(shieldRechargeRate) ||
            Number.isNaN(damageRepairRate) ||
            Number.isNaN(countermeasureModifier) ||
            Number.isNaN(targetingModifier) ||
            Number.isNaN(weaponType) ||
            Number.isNaN(weaponImageIndex) ||
            Number.isNaN(weaponDamage) ||
            Number.isNaN(weaponRange) ||
            Number.isNaN(weaponEnergyRequired) ||
            Number.isNaN(weaponSpeed) ||
            Number.isNaN(weaponDamageLoss) ||
            Number.isNaN(weaponFireRate)
        ) {
            continue;
        }

        fighters.push({
            fighterId,
            name,
            type,
            techLevel,
            energyCapacity,
            energyRechargeRate,
            topSpeed,
            topSpeedEnergyConsumptionRate,
            accelerationRate,
            turnRate,
            engineExhaustImageIndex,
            shieldsCapacity,
            shieldRechargeRate,
            damageRepairRate,
            countermeasureModifier,
            targetingModifier,
            weaponType,
            weaponImageIndex,
            weaponDamage,
            weaponRange,
            weaponEnergyRequired,
            weaponSpeed,
            weaponDamageLoss,
            weaponFireRate,
            weaponSoundEffectFilename,
        });
    }

    return fighters;
}
