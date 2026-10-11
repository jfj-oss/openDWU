// Resource icon URLs. Stock resources: the original's /assets/dwu/images/ui/resources/Resource_<PictureRef>.bmp. Picture
// refs 9000+ are the Colony Economy add-on's refined goods (our own art, public/art/economy/good-<key>.svg).

const ECON_GOOD_ICONS = ['alloys', 'electronics', 'polymers', 'fuelCells', 'exotics', 'precision'];

export function resourceIconPath(pictureRef: number): string {
    if (pictureRef >= 9000 && pictureRef < 9000 + ECON_GOOD_ICONS.length) return `/art/economy/good-${ECON_GOOD_ICONS[pictureRef - 9000]}.svg`;
    return `/assets/dwu/images/ui/resources/Resource_${pictureRef}.bmp`;
}
