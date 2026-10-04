// Change Theme (main menu): port of Start.cs pnlThemes — a ThemesScreenPanel (DistantWorlds.Controls/Controls/
// ThemesScreenPanel.cs + .Designer.cs) opened by menuChangeTheme_Click → method_26 at 827 × 681.
//   - method_28: one radio button per theme, "(Default)" first then every Customization subfolder sorted, at
//     (10, 40 + j × 25), 200 × 25, bold, (170, 170, 170); the current theme is checked;
//   - method_29 (CheckedChanged): the detail panel shows the theme's name, about.txt and about.png (the default theme:
//     "The default Distant Worlds theme, …" and the stock title art), "This theme has X galaxy maps available to play"
//     when its maps\ folder has any, and enables Switch Theme unless it is the current theme;
//   - btnThemeSwitch_Click (Start.1.cs 4695): method_2(lblThemeTitle.Text, bool_5: true, bool_6: true) — the choice
//     becomes GameOptions.CustomizationSetName and the theme is loaded — then the panel closes; Cancel / the close
//     button just close it (method_27).
import { el, FONT, glassButton, gradientPanel, openOriginalWindow, place, type OriginalWindow } from '../originalWindow';
import { DEFAULT_THEME_LABEL } from '../../sim/data/customization';
import { fetchThemeAbout, fetchThemeList, fetchThemeMapCount } from '../../themeLoader';
import { tryGetText } from '../../sim/textResolver';
import { STOCK_ASSET_QUERY } from '../../themeAssets';

export interface ChangeThemeOptions {
    /** GameOptions.CustomizationSetName ("" = the stock game). */
    current: string;
    /** Switch Theme pressed for `name` ("" = "(Default)"). */
    onSwitch: (name: string) => void | Promise<void>;
}

/** GameText lookup with the English text as fallback (TextResolver.GetText). */
function text(tag: string, fallback: string): string {
    const t = tryGetText(tag);
    return t === null || t === '' ? fallback : t;
}

/** The radio list of Start.cs method_28: "(Default)" then the Customization subfolders (already sorted). */
export function themeListEntries(folders: readonly string[]): string[] {
    return [DEFAULT_THEME_LABEL, ...folders];
}

/** Whether Switch Theme is enabled for `selected` (method_29: disabled for the current GameOptions theme). */
export function themeSwitchEnabled(selected: string, current: string): boolean {
    return selected === DEFAULT_THEME_LABEL ? current !== '' : selected !== current;
}

/** Open the Change Theme panel; resolves to the window. */
export async function openChangeTheme(o: ChangeThemeOptions): Promise<OriginalWindow> {
    const folders = await fetchThemeList();
    const win = openOriginalWindow({ id: 'themes', title: text('Change Theme', 'Change Theme'), width: 827, height: 681, noAutoPause: true });
    const body = win.body;
    const currentLabel = o.current === '' ? DEFAULT_THEME_LABEL : o.current;

    // lblCurrentTheme (10, 10), font_7.
    const lblCurrent = place(el('div', 'ow-theme-current', `${text('Current Theme', 'Current Theme')}: ${currentLabel}`), 10, 10);
    lblCurrent.style.fontSize = `${FONT.large}px`;
    lblCurrent.style.fontWeight = 'bold';
    lblCurrent.style.color = 'rgb(170, 170, 170)';
    body.appendChild(lblCurrent);

    // pnlThemeDetail (250, 40) 550 × 530.
    const detail = place(gradientPanel(), 250, 40, 550, 530);
    detail.style.position = 'absolute';
    body.appendChild(detail);
    const lblTitle = place(el('div', 'ow-theme-title'), 10, 10);
    lblTitle.style.color = '#fff';
    lblTitle.style.fontWeight = 'bold';
    lblTitle.style.fontSize = `${FONT.title}px`;
    const lblDesc = place(el('div', 'ow-theme-desc'), 10, 45);
    lblDesc.style.maxWidth = '320px';
    lblDesc.style.maxHeight = '480px';
    lblDesc.style.overflow = 'hidden';
    lblDesc.style.whiteSpace = 'pre-wrap';
    lblDesc.style.color = 'rgb(170, 170, 170)';
    lblDesc.style.fontSize = `${FONT.normal}px`;
    const pic = place(el('img', 'ow-theme-pic'), 338, 45, 200, 200);
    pic.style.objectFit = 'contain'; // PictureBoxSizeMode.Zoom
    pic.alt = '';
    const lblMaps = place(el('div', 'ow-theme-maps'), 338, 255);
    lblMaps.style.maxWidth = '200px';
    lblMaps.style.color = 'rgb(170, 170, 170)';
    lblMaps.style.fontSize = `${FONT.large}px`;
    detail.append(lblTitle, lblDesc, pic, lblMaps);

    let selected = currentLabel;
    const btnCancel = place(glassButton(text('Cancel', 'Cancel'), { onClick: () => win.close() }), 250, 580, 200, 30);
    const btnSwitch = place(
        glassButton(text('Switch Theme', 'Switch Theme'), {
            onClick: () => {
                const name = selected === DEFAULT_THEME_LABEL ? '' : selected;
                btnSwitch.disabled = true;
                document.body.style.cursor = 'wait'; // Application.UseWaitCursor
                void Promise.resolve(o.onSwitch(name)).finally(() => {
                    document.body.style.cursor = '';
                    win.close();
                });
            },
        }),
        460,
        580,
        340,
        30,
    );
    body.append(btnCancel, btnSwitch);

    let token = 0;
    const show = async (name: string): Promise<void> => {
        const my = ++token;
        selected = name;
        btnSwitch.disabled = !themeSwitchEnabled(name, o.current);
        lblTitle.textContent = name;
        let desc: string;
        let image: string | null;
        if (name === DEFAULT_THEME_LABEL) {
            desc = text('The default Distant Worlds theme, using the standard images, names and music.', 'The default Distant Worlds theme, using the standard images, names and music.');
            // bitmap_0 = Image.FromFile(<install>\images\ui\chrome\galaxy.png) (Start.cs 1051): the stock file, never themed.
            image = `/assets/dwu/images/ui/chrome/galaxy.png${STOCK_ASSET_QUERY}`;
        } else {
            const about = await fetchThemeAbout(name);
            desc = about.text;
            image = about.imageUrl;
        }
        const maps = await fetchThemeMapCount(name === DEFAULT_THEME_LABEL ? '' : name);
        if (my !== token) return;
        lblDesc.textContent = desc;
        if (image === null) pic.removeAttribute('src');
        else pic.src = image;
        pic.style.visibility = image === null ? 'hidden' : '';
        lblMaps.textContent = maps > 0 ? text('This theme has X galaxy maps available to play', 'This theme has {0} galaxy maps available to play').replace('{0}', String(maps)) : '';
    };

    // method_28: the radio buttons.
    themeListEntries(folders).forEach((name, j) => {
        const row = place(el('label', 'ow-theme-radio'), 10, 40 + j * 25, 230, 25);
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '4px';
        row.style.color = 'rgb(170, 170, 170)';
        row.style.fontWeight = 'bold';
        row.style.fontSize = `${FONT.normal}px`;
        row.style.whiteSpace = 'nowrap';
        row.style.cursor = 'pointer';
        const input = el('input');
        input.type = 'radio';
        input.name = 'dwu-theme';
        input.value = name;
        input.checked = name === currentLabel;
        input.addEventListener('change', () => {
            if (input.checked) void show(name);
        });
        row.append(input, document.createTextNode(name));
        body.appendChild(row);
    });
    await show(currentLabel);
    return win;
}
