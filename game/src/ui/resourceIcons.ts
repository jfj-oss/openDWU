// Resource icon URLs. Stock resources: the original's /assets/dwu/images/ui/resources/Resource_<PictureRef>.bmp. Picture
// refs 9000+ are the Colony Economy add-on's refined goods (our own art, public/art/economy/good-<key>.svg); 9100 is
// The Voidbloom War's Voidbloom (public/art/voidbloom/voidbloom.svg).

const ECON_GOOD_ICONS = ['alloys', 'electronics', 'polymers', 'fuelCells', 'exotics', 'precision'];

export function resourceIconPath(pictureRef: number): string {
    if (pictureRef >= 9000 && pictureRef < 9000 + ECON_GOOD_ICONS.length) return `/art/economy/good-${ECON_GOOD_ICONS[pictureRef - 9000]}.svg`;
    if (pictureRef === 9100) return '/art/voidbloom/voidbloom.svg'; // [voidbloom] our own icon (scenarios/voidbloom/resources.txt)
    return `/assets/dwu/images/ui/resources/Resource_${pictureRef}.bmp`;
}
