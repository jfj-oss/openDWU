// Generates the Colony Economy add-on's facility, designation and Precision Components icons (our own art; 24×24 SVG,
// the refined goods' style: a dark rounded tile with a ring in the designation's colour and a simple glyph).
// Usage: node scripts/gen-econ-icons.mjs   (writes public/art/economy/fac-<id>.svg, desig-<n>.svg, good-precision.svg)
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/art/economy');
const COL = { 1: '#e0892c', 2: '#f2c94c', 3: '#56d1c8', 4: '#b9906a', 5: '#6aa8ff', 6: '#d9534f' };
const L = '#e8edf2';
const st = (c) => `stroke="${c}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"`;
// Glyphs: (c = designation colour) → SVG inner markup, drawn in the 5..19 box.
const G = {
    ship: (c) => `<path d="M5 14 L9 10 L17 10 L19 13 L17 16 L9 16 Z" fill="${L}" ${st(c)}/><path d="M9 10 L11 7 L14 7 L15 10" fill="none" ${st(c)}/>`,
    anvil: (c) => `<path d="M5 9 H17 Q19 9 19 11 H15 V13 L17 17 H8 L10 13 V11 H7 Q5 11 5 9 Z" fill="${L}" ${st(c)}/>`,
    chip: (c) => `<rect x="8" y="8" width="8" height="8" rx="1" fill="${L}" ${st(c)}/><path d="M10 6V8M14 6V8M10 16V18M14 16V18M6 10H8M6 14H8M16 10H18M16 14H18" ${st(c)}/>`,
    wrench: (c) => `<path d="M7 17 L14 10 M14 10 A3.5 3.5 0 1 0 17.5 6.5 L15.5 8.5 L14.5 9.5 Z" fill="${L}" ${st(c)}/>`,
    robot: (c) => `<rect x="7" y="9" width="10" height="8" rx="2" fill="${L}" ${st(c)}/><path d="M12 9V6" ${st(c)}/><circle cx="12" cy="5.5" r="1" fill="${c}"/><circle cx="10" cy="13" r="1" fill="${c}"/><circle cx="14" cy="13" r="1" fill="${c}"/>`,
    drop: (c) => `<path d="M12 5 Q17 11 17 14 A5 5 0 0 1 7 14 Q7 11 12 5 Z" fill="${L}" ${st(c)}/>`,
    recycle: (c) => `<path d="M12 6 L17 15 H7 Z" fill="none" ${st(c)}/><path d="M12 6 L13.5 9M17 15 L13.8 15.5M7 15 L8.5 12" ${st(c)}/>`,
    arrows: (c) => `<path d="M6 10 H17 M14 7 L17 10 L14 13 M18 15 H7 M10 12 L7 15 L10 18" fill="none" ${st(c)}/>`,
    bank: (c) => `<path d="M5 10 L12 6 L19 10 Z" fill="${L}" ${st(c)}/><path d="M7 11V16M10.5 11V16M13.5 11V16M17 11V16M5.5 17.5H18.5" ${st(c)}/>`,
    anchor: (c) => `<circle cx="12" cy="7" r="1.6" fill="none" ${st(c)}/><path d="M12 8.6V18 M8 12H16 M6 14 Q7 18 12 18 Q17 18 18 14" fill="none" ${st(c)}/>`,
    seal: (c) => `<circle cx="12" cy="12" r="6" fill="${L}" ${st(c)}/><path d="M9 12 L11 14 L15 10" fill="none" ${st(c)}/>`,
    scales: (c) => `<path d="M12 6V18 M8 18H16 M6 9H18 M6 9 L4.5 13 H7.5 Z M18 9 L16.5 13 H19.5 Z" fill="none" ${st(c)}/>`,
    hall: (c) => `<path d="M5 11 L12 6 L19 11 V18 H5 Z" fill="${L}" ${st(c)}/><rect x="10" y="13" width="4" height="5" fill="${c}"/>`,
    mask: (c) => `<path d="M5 9 Q12 7 19 9 Q19 16 12 17 Q5 16 5 9 Z" fill="${L}" ${st(c)}/><ellipse cx="9.5" cy="11.5" rx="1.5" ry="1" fill="#11161c"/><ellipse cx="14.5" cy="11.5" rx="1.5" ry="1" fill="#11161c"/>`,
    sun: (c) => `<circle cx="12" cy="12" r="3.5" fill="${L}" ${st(c)}/><path d="M12 5V6.5M12 17.5V19M5 12H6.5M17.5 12H19M7 7L8 8M16 16L17 17M7 17L8 16M16 8L17 7" ${st(c)}/>`,
    antenna: (c) => `<path d="M12 11V18 M9 18H15" ${st(c)}/><circle cx="12" cy="10" r="1.4" fill="${c}"/><path d="M8.5 6.5 A5 5 0 0 0 8.5 13.5 M15.5 6.5 A5 5 0 0 1 15.5 13.5" fill="none" ${st(c)}/>`,
    flower: (c) => `<circle cx="12" cy="9" r="2.2" fill="${L}" ${st(c)}/><circle cx="9" cy="11.5" r="2.2" fill="${L}" ${st(c)}/><circle cx="15" cy="11.5" r="2.2" fill="${L}" ${st(c)}/><path d="M12 13V19" ${st(c)}/>`,
    ribbon: (c) => `<circle cx="12" cy="10" r="4" fill="${L}" ${st(c)}/><path d="M9.5 13 L8 19 L12 17 L16 19 L14.5 13" fill="none" ${st(c)}/>`,
    die: (c) => `<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="${L}" ${st(c)}/><circle cx="9.5" cy="9.5" r="1" fill="${c}"/><circle cx="12" cy="12" r="1" fill="${c}"/><circle cx="14.5" cy="14.5" r="1" fill="${c}"/>`,
    tree: (c) => `<path d="M12 5 L17 12 H14 L17.5 16 H6.5 L10 12 H7 Z" fill="${L}" ${st(c)}/><path d="M12 16V19" ${st(c)}/>`,
    temple: (c) => `<path d="M5 10 L12 5.5 L19 10 Z" fill="${L}" ${st(c)}/><path d="M7.5 11V17M12 11V17M16.5 11V17M5.5 18H18.5" ${st(c)}/>`,
    pick: (c) => `<path d="M6 9 Q12 4 18 9" fill="none" ${st(c)}/><path d="M12 6.5 L9 18" ${st(c)}/>`,
    crate: (c) => `<rect x="6.5" y="7.5" width="11" height="10" fill="${L}" ${st(c)}/><path d="M6.5 7.5 L17.5 17.5 M17.5 7.5 L6.5 17.5" ${st(c)}/>`,
    lens: (c) => `<circle cx="10.5" cy="10.5" r="4" fill="${L}" ${st(c)}/><path d="M13.5 13.5 L18 18" ${st(c)}/>`,
    furnace: (c) => `<path d="M7 18 V10 L12 6 L17 10 V18 Z" fill="${L}" ${st(c)}/><path d="M12 16 Q10 14 11.5 12 Q12 13.5 13 12.5 Q14 14.5 12 16 Z" fill="${c}"/>`,
    gas: (c) => `<circle cx="9" cy="13" r="3" fill="${L}" ${st(c)}/><circle cx="14.5" cy="11" r="3.5" fill="${L}" ${st(c)}/><circle cx="13" cy="16" r="2" fill="${L}" ${st(c)}/>`,
    drill: (c) => `<rect x="9" y="5" width="6" height="5" fill="${L}" ${st(c)}/><path d="M9.5 10 L12 18 L14.5 10 Z" fill="${L}" ${st(c)}/><path d="M10.5 12.5H13.5M11.2 15H12.8" ${st(c)}/>`,
    terrace: (c) => `<path d="M5 18 H19 V15 H16 V12 H13 V9 H10 V12 H7 V15 H5 Z" fill="${L}" ${st(c)}/>`,
    ingot: (c) => `<path d="M5 16 L7 11 H17 L19 16 Z" fill="${L}" ${st(c)}/><path d="M8 11 L9.5 8 H14.5 L16 11" fill="${L}" ${st(c)}/>`,
    flask: (c) => `<path d="M10 5 H14 M10.5 5 V10 L6.5 17.5 H17.5 L13.5 10 V5" fill="${L}" ${st(c)}/><path d="M8.5 14 H15.5" ${st(c)}/>`,
    cell: (c) => `<rect x="8" y="7" width="8" height="12" rx="1.5" fill="${L}" ${st(c)}/><path d="M10.5 5 H13.5 M12.8 9.5 L10.8 13 H13.2 L11.2 16.5" fill="none" ${st(c)}/>`,
    cross: (c) => `<path d="M10 6 H14 V10 H18 V14 H14 V18 H10 V14 H6 V10 H10 Z" fill="${L}" ${st(c)}/>`,
    book: (c) => `<path d="M5 8 L12 5.5 L19 8 L12 10.5 Z" fill="${L}" ${st(c)}/><path d="M8 9.5 V13 Q12 15.5 16 13 V9.5 M18 8.5 V13" fill="none" ${st(c)}/>`,
    tower: (c) => `<path d="M9 18 V8 L12 5 L15 8 V18 Z" fill="${L}" ${st(c)}/><path d="M6 18 V12 H9 M18 18 V11 H15 M5 18.5 H19" fill="none" ${st(c)}/>`,
    star: (c) => `<path d="M12 5 L13.9 9.6 L18.8 10 L15 13.2 L16.2 18 L12 15.4 L7.8 18 L9 13.2 L5.2 10 L10.1 9.6 Z" fill="${L}" ${st(c)}/>`,
    flagHall: (c) => `<rect x="6" y="11" width="12" height="7" fill="${L}" ${st(c)}/><path d="M12 11 V5 L16 6.5 L12 8" fill="${c}" ${st(c)}/>`,
    helix: (c) => `<path d="M8 5 Q16 9 8 12 Q16 15 8 19 M16 5 Q8 9 16 12 Q8 15 16 19" fill="none" ${st(c)}/>`,
    dome: (c) => `<path d="M6 13 A6 6 0 0 1 18 13 Z" fill="${L}" ${st(c)}/><path d="M5 13.5 H19 M7 14 V18 M12 14 V18 M17 14 V18 M5 18.5 H19" ${st(c)}/>`,
    crystal: (c) => `<path d="M12 5 L16 10 L12 19 L8 10 Z" fill="${L}" ${st(c)}/><path d="M8 10 H16 M12 5 V19" ${st(c)}/>`,
    gearAim: (c) => `<circle cx="12" cy="12" r="4.5" fill="${L}" ${st(c)}/><circle cx="12" cy="12" r="1.4" fill="${c}"/><path d="M12 5V7.5M12 16.5V19M5 12H7.5M16.5 12H19" ${st(c)}/>`,
    shield: (c) => `<path d="M12 5 L18 7.5 Q18 15 12 19 Q6 15 6 7.5 Z" fill="${L}" ${st(c)}/>`,
    swords: (c) => `<path d="M6 6 L17 17 M18 6 L7 17 M15 17.5 L18 14.5 M6 14.5 L9 17.5" fill="none" ${st(c)}/>`,
    radar: (c) => `<path d="M6 17 A8 8 0 0 1 17 6" fill="none" ${st(c)}/><path d="M9 17 A5 5 0 0 1 17 9" fill="none" ${st(c)}/><path d="M12 12 L17 7" ${st(c)}/><circle cx="12" cy="12" r="1.3" fill="${c}"/>`,
    house: (c) => `<path d="M6 12 L12 6.5 L18 12 V18 H6 Z" fill="${L}" ${st(c)}/><path d="M15 9.5 V6 H17 V11" fill="none" ${st(c)}/>`,
    castle: (c) => `<path d="M6 18 V8 H8 V10 H10.5 V8 H13.5 V10 H16 V8 H18 V18 Z" fill="${L}" ${st(c)}/><path d="M10.5 18 V14 H13.5 V18" fill="none" ${st(c)}/>`,
    badge: (c) => `<path d="M12 5 L13.6 8.6 L17.5 8.9 L14.6 11.5 L15.5 15.3 L12 13.3 L8.5 15.3 L9.4 11.5 L6.5 8.9 L10.4 8.6 Z" fill="${L}" ${st(c)}/><circle cx="12" cy="17.5" r="1.3" fill="${c}"/>`,
    scroll: (c) => `<path d="M8 6 H16 V16 Q16 18 14 18 H7 Q9 18 9 16 V7" fill="${L}" ${st(c)}/><path d="M11 9.5 H14 M11 12 H14 M11 14.5 H13" ${st(c)}/>`,
};
const FAC = [
    ['privateShipyard', 1, 'ship'], ['heavyFoundry', 1, 'anvil'], ['componentWorks', 1, 'chip'], ['orbitalDrydock', 1, 'wrench'], ['roboticsPlant', 1, 'robot'], ['fleetDepot', 1, 'drop'], ['salvageYard', 1, 'recycle'],
    ['tradeExchange', 2, 'arrows'], ['investmentBank', 2, 'bank'], ['freePort', 2, 'anchor'], ['customsBureau', 2, 'seal'], ['commoditiesMarket', 2, 'scales'], ['merchantGuild', 2, 'hall'], ['blackMarket', 2, 'mask'],
    ['resortComplex', 3, 'sun'], ['mediaNetwork', 3, 'antenna'], ['pleasureGardens', 3, 'flower'], ['diplomaticRetreat', 3, 'ribbon'], ['spaceportCasino', 3, 'die'], ['naturePreserve', 3, 'tree'], ['pilgrimageShrine', 3, 'temple'],
    ['miningConsortium', 4, 'pick'], ['orbitalWarehouse', 4, 'crate'], ['deepSurveyOffice', 4, 'lens'], ['oreRefinery', 4, 'furnace'], ['gasRefinery', 4, 'gas'], ['automatedExtractors', 4, 'drill'], ['stripMine', 4, 'terrace'],
    ['smelter', 4, 'ingot'], ['chemicalPlant', 4, 'flask'], ['fuelRefinery', 4, 'cell'],
    ['medicalComplex', 5, 'cross'], ['university', 5, 'book'], ['arcology', 5, 'tower'], ['culturalCenter', 5, 'star'], ['adminCenter', 5, 'flagHall'], ['geneticsInstitute', 5, 'helix'], ['senateHall', 5, 'dome'],
    ['electronicsFab', 5, 'chip'], ['exoticsLab', 5, 'crystal'], ['precisionWorks', 5, 'gearAim'],
    ['privateSecurity', 6, 'shield'], ['militiaYard', 6, 'swords'], ['surveyOutpost', 6, 'radar'], ['colonistOffice', 6, 'house'], ['fortressBunker', 6, 'castle'], ['bountyOffice', 6, 'badge'], ['frontierCharter', 6, 'scroll'],
];
const tile = (ring, inner, note) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">\n<!-- openDWU Colony Economy: ${note} (our own art; scripts/gen-econ-icons.mjs) -->\n<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b333d"/><stop offset="1" stop-color="#11161c"/></linearGradient></defs>\n<rect x="0.5" y="0.5" width="23" height="23" rx="3" fill="url(#b)" stroke="${ring}" stroke-width="1"/>\n${inner}\n</svg>\n`;
for (const [id, d, g] of FAC) writeFileSync(`${out}/fac-${id}.svg`, tile(COL[d], G[g](COL[d]), `facility ${id}`));
// Designation badges (a disc with the map badge's glyphs: gear, two arrows, star, pick, crown, shield).
const BADGE = {
    1: (c) => `<circle cx="12" cy="12" r="4" fill="none" ${st(c)}/><path d="M12 5V7M12 17V19M5 12H7M17 12H19M7 7L8.4 8.4M15.6 15.6L17 17M7 17L8.4 15.6M15.6 8.4L17 7" ${st(c)}/>`,
    2: G.arrows, 3: G.star, 4: G.pick,
    5: (c) => `<path d="M6 16 L6 9 L9 12 L12 7 L15 12 L18 9 L18 16 Z" fill="${c}" ${st(c)}/>`,
    6: (c) => `<path d="M12 5 L18 7.5 Q18 15 12 19 Q6 15 6 7.5 Z" fill="${c}" ${st(c)}/>`,
};
for (const d of [1, 2, 3, 4, 5, 6]) writeFileSync(`${out}/desig-${d}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">\n<!-- openDWU Colony Economy: designation badge ${d} (our own art; scripts/gen-econ-icons.mjs) -->\n<circle cx="12" cy="12" r="11" fill="#0c1218" fill-opacity="0.9" stroke="${COL[d]}" stroke-width="1.6"/>\n${BADGE[d](COL[d])}\n</svg>\n`);
// The third-step good, in the goods' grey style.
writeFileSync(`${out}/good-precision.svg`, tile('#9aa7b4', G.gearAim('#5d6a76').replace(/#e8edf2/g, '#e3e9ee'), 'refined good: precision components'));
console.log(`wrote ${FAC.length} facility icons, 6 badges, 1 good`);
