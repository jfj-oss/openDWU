// Copy the original's resx-embedded pictures the UI uses (BUNDLED_RESX_IMAGES in src/ui/resxImage.ts) out of the
// decompiled Main.resx / Start.resx into public/art/original-resx/<main|start>/<name>.png, unmodified (the PNG cut out
// of the BinaryFormatter blob, as resxImage.ts does at runtime). Stock installs have no decompiled source, so these are
// bundled (original art, used with the publisher's permission: public/art/original-resx/README.txt).
//   DWU_DIR=<DW:U folder> node scripts/extract-resx-art.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resxDataBase64, pngFromBlob, BUNDLED_RESX_IMAGES } from '../src/ui/resxImage.ts';

const dwu = process.env.DWU_DIR ?? 'public/assets/dwu';
const dir = `${dwu}/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds/`;
for (const [file, names] of Object.entries(BUNDLED_RESX_IMAGES)) {
    const resx = readFileSync(`${dir}${file === 'main' ? 'Main' : 'Start'}.resx`, 'utf8');
    mkdirSync(`public/art/original-resx/${file}`, { recursive: true });
    for (const name of names) {
        const b64 = resxDataBase64(resx, name);
        const png = b64 === null ? null : pngFromBlob(Buffer.from(b64, 'base64'));
        if (png === null) throw new Error(`${file}: no PNG for ${name}`);
        writeFileSync(`public/art/original-resx/${file}/${name}.png`, png);
        console.log(`${file}/${name}.png ${png.length} bytes`);
    }
}
