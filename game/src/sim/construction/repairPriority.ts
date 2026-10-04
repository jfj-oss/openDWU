// Repair-priority templates of the Expansion mod (ExpansionMod/RepairPriority/RepairPriorityManager.cs): a Design's
// RepaitPriorityTemplateName (C# spelling) names the component-category order its free repairs follow
// (BaconBuiltObject.cs 4806 DoRepairs). Null keeps the original random-start repair.
//
// In the shipped game nothing names a template: the design screen's button (Main.Part7.cs 5124
// btnRepairPriorityEdit_Click) discards the selection, and FixAllDesignRepairTemplates (Start.cs 1816 / 2087) copies the
// Player / AI defaults of ExapnsionModSettings.json, which the mod does not ship. The user template file
// (RepairPriorityTemplates.json) is not shipped either, so the only templates are the two built-in ones below.
// No Rnd.

import { ComponentCategoryType } from '../data/policies';

export interface RepairPriority {
    templateName: string;
    /** Null for the Original template (the random-start repair). */
    priority: ComponentCategoryType[] | null;
}

/** RepairPriorityManager._OriginalTemplateName / _DefaultTemplateName. */
export const ORIGINAL_TEMPLATE_NAME = 'Original';
export const DEFAULT_TEMPLATE_NAME = 'Default';

const C = ComponentCategoryType;
/** RepairPriorityManager.cs 34 static ctor: Default (WeaponTorpedo is listed twice in the C#; IndexOf finds the first). */
export const DEFAULT_REPAIR_PRIORITY: RepairPriority = {
    templateName: DEFAULT_TEMPLATE_NAME,
    priority: [
        C.HyperDrive, C.Reactor, C.Shields, C.Engine, C.WeaponSuperBeam, C.WeaponTorpedo, C.WeaponSuperArea, C.WeaponBeam,
        C.WeaponGravity, C.WeaponIon, C.WeaponTorpedo, C.WeaponArea, C.WeaponPointDefense, C.Computer, C.Armor, C.HyperDisrupt,
        C.Sensor, C.AssaultPod, C.EnergyCollector, C.Construction, C.Extractor, C.Fighter, C.Habitation, C.Manufacturer,
        C.ShieldRecharge, C.Storage, C.Labs,
    ],
};
export const ORIGINAL_REPAIR_PRIORITY: RepairPriority = { templateName: ORIGINAL_TEMPLATE_NAME, priority: null };

/** RepairPriorityManager.RepairPriorityTemplates: the user templates (RepairPriorityTemplates.json; none shipped). */
export const repairPriorityTemplates: RepairPriority[] = [];

/**
 * RepairPriorityManager.cs GetRepairPriorityList(current) (via ExpansionModMain.cs 101): the user template of that name
 * (case-insensitive), else the Default template's list when the name is "Default", else null.
 */
export function getRepairPriorityList(current: string): ComponentCategoryType[] | null {
    const lower = current.toLowerCase();
    const item = repairPriorityTemplates.find((x) => x.templateName.toLowerCase() === lower);
    if (item !== undefined) return item.priority;
    if (DEFAULT_REPAIR_PRIORITY.templateName.toLowerCase() === lower) return DEFAULT_REPAIR_PRIORITY.priority;
    return null;
}
