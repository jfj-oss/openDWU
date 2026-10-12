// [musicmood] Options → Sound Volume → "Music & Mood..." (ours, not in the original): one small window in the Options
// sub-window style with two independent choices, both UI settings (ui/settings.ts), never sim state.
//   Background Mood: Off (default) / Rim only (the Rim Atmosphere add-on's bed; greyed out in a game without it) /
//     Deep Space (audio/deepSpaceMood.ts), plus the mood's own level (on top of the Effects volume).
//   Music: Original (the install's soundtrack) / Off / one entry per user playlist (audio/userMusic.ts), Shuffle,
//     Next Track, and Open Music Folder (desktop) or Choose Folder... (browser: this session only).
// The playlists are listed again each time the window opens.
import {
  COLORS,
  checkBox,
  dropDown,
  el,
  glassButton,
  openOriginalWindow,
  place,
  text,
  type OriginalWindow,
} from "../originalWindow";
import { colorSlider, groupBox } from "../originalWindowControls";
import { getSettings, updateSettings, type BackgroundMood } from "../settings";
import {
  addSessionFolder,
  isDesktopApp,
  listUserPlaylists,
  playlistSource,
  sourcePlaylistName,
  type UserMusicListing,
} from "../../audio/userMusic";
import {
  applyMusicSource,
  musicSourceNote,
  nextMusicTrack,
} from "../../audio/musicPlayer";

export const MUSIC_MOOD_TITLE = "Music & Mood";

const W = 470;
const H = 420;
const F_LABEL = 20.77;
const F_NOTE = 16.67;
const F_BUTTON = 15.83;
const F_GROUP = 18.67;

export const MOOD_ITEMS: readonly { value: BackgroundMood; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "rim", label: "Rim only" },
  { value: "deep", label: "Deep Space" },
];

/** Pure: the Music choices for a listing (a saved playlist that is gone stays listed, marked missing). */
export function musicSourceItems(
  listing: UserMusicListing,
  saved: string,
): { value: string; label: string }[] {
  const items = [
    { value: "original", label: "Original" },
    { value: "off", label: "Off" },
  ];
  for (const p of listing.playlists)
    items.push({
      value: playlistSource(p.name),
      label: `${p.name} (${p.tracks.length})`,
    });
  const name = sourcePlaylistName(saved);
  if (name !== null && !listing.playlists.some((p) => p.name === name))
    items.push({ value: saved, label: `${name} (missing)` });
  return items;
}

interface DesktopMusicBridge {
  openMusicFolder?: () => Promise<unknown>;
}

function note(
  parent: HTMLElement,
  x: number,
  y: number,
  w: number,
): HTMLDivElement {
  const t = text("", {
    size: F_NOTE,
    color: COLORS.label,
    shadow: false,
    wrapWidth: w,
    className: "go-label mm-note",
  });
  parent.appendChild(place(t, x, y));
  return t;
}

function label(
  parent: HTMLElement,
  content: string,
  x: number,
  y: number,
): void {
  parent.appendChild(
    place(
      text(content, {
        size: F_LABEL,
        color: COLORS.label,
        shadow: false,
        className: "go-label",
      }),
      x,
      y,
    ),
  );
}

/** Open the window. `rimAvailable`: the Rim Atmosphere add-on is on in this game (null: no game, main menu). */
export function openMusicMoodWindow(
  rimAvailable: boolean | null,
  onClose: () => void,
): OriginalWindow {
  const win = openOriginalWindow({
    id: "gameoptions-musicmood",
    title: MUSIC_MOOD_TITLE,
    width: W,
    height: H,
    onClose,
  });
  const body = win.body;
  body.classList.add("go-body");
  const s = getSettings();

  // --- Background Mood
  const mood = place(groupBox("Background Mood", W - 40, 132, F_GROUP), 12, 8);
  body.appendChild(mood);
  label(mood, "Mood", 12, 26);
  const moodSel = dropDown(MOOD_ITEMS, s.backgroundMood, (v) => {
    updateSettings({ backgroundMood: v as BackgroundMood });
    refreshMoodNote();
  });
  moodSel.classList.add("go-combo");
  moodSel.style.fontSize = "18.67px";
  moodSel.dataset.id = "mood";
  mood.appendChild(place(moodSel, 110, 24, 300, 21));
  const rimOption = moodSel.options[1];
  if (rimAvailable === false) rimOption.disabled = true;
  label(mood, "Level", 12, 56);
  const level = colorSlider({
    value: Math.round(s.moodLevel * 100),
    min: 0,
    max: 100,
    width: 300,
    height: 16,
    thumbSize: 20,
    largeChange: 5,
    onChange: (v) => updateSettings({ moodLevel: v / 100 }),
  });
  mood.appendChild(place(level.el, 110, 58));
  const moodNote = note(mood, 12, 84, W - 70);
  function refreshMoodNote(): void {
    const v = moodSel.value as BackgroundMood;
    const lines: string[] = [];
    if (rimAvailable === false)
      lines.push(
        "Rim only needs the Rim Atmosphere add-on, which is off in this game.",
      );
    else if (rimAvailable === null && v === "rim")
      lines.push("Rim only plays in games with the Rim Atmosphere add-on.");
    if (v === "deep")
      lines.push(
        "Wind, a deep rumble, distant calls and hull creaks, everywhere. Uses the Effects volume.",
      );
    else if (v === "rim" && rimAvailable !== false)
      lines.push(
        "The rim fog's ambience near the galaxy edge. Uses the Effects volume.",
      );
    moodNote.textContent = lines.join("\n");
  }
  refreshMoodNote();

  // --- Music
  const music = place(groupBox("Music", W - 40, 220, F_GROUP), 12, 150);
  body.appendChild(music);
  label(music, "Music", 12, 26);
  let musicSel = dropDown([], s.musicSource, () => undefined);
  const desktop = isDesktopApp();
  const shuffle = checkBox(
    "Shuffle",
    s.musicShuffle,
    (v) => {
      updateSettings({ musicShuffle: v });
      refreshMusicNote();
    },
    F_LABEL,
  );
  shuffle.classList.add("go-check");
  music.appendChild(place(shuffle, 12, 56));
  const next = glassButton("Next Track", {
    onClick: () => nextMusicTrack(),
    size: F_BUTTON,
    className: "go-button",
  });
  music.appendChild(place(next, 140, 56, 120, 24));
  const picker = el("input");
  picker.type = "file";
  picker.multiple = true;
  picker.setAttribute("webkitdirectory", "");
  picker.style.display = "none";
  music.appendChild(picker);
  let sessionNotes: string[] = [];
  picker.addEventListener("change", () => {
    if (picker.files !== null)
      sessionNotes = addSessionFolder(Array.from(picker.files));
    picker.value = "";
    void refresh();
  });
  const folderBtn = glassButton(
    desktop ? "Open Music Folder" : "Choose Folder...",
    {
      onClick: () => {
        if (desktop)
          void (
            window as unknown as { dwuDesktop: DesktopMusicBridge }
          ).dwuDesktop
            .openMusicFolder?.()
            .catch(() => undefined);
        else picker.click();
      },
      size: F_BUTTON,
      className: "go-button",
    },
  );
  folderBtn.dataset.id = "folder";
  music.appendChild(place(folderBtn, 270, 56, 140, 24));
  const musicNote = note(music, 12, 90, W - 70);

  let listing: UserMusicListing = { playlists: [], notes: [], folder: null };
  function refreshMusicNote(): void {
    const lines: string[] = [];
    const src = musicSel.value;
    next.disabled = src === "off";
    shuffle.style.visibility = sourcePlaylistName(src) !== null ? "" : "hidden";
    const srcNote = musicSourceNote();
    if (srcNote !== null) lines.push(srcNote);
    if (desktop) {
      if (listing.folder !== null)
        lines.push(
          `Playlists: one subfolder per playlist in ${listing.folder}`,
        );
    } else
      lines.push(
        "Browser: choose a folder of music (one subfolder per playlist); it is kept for this session only.",
      );
    if (listing.playlists.length === 0) lines.push("No playlists yet.");
    lines.push(...listing.notes.slice(0, 3), ...sessionNotes.slice(0, 2));
    musicNote.textContent = lines.join("\n");
  }
  function buildMusicSelect(): void {
    const saved = getSettings().musicSource;
    const sel = dropDown(musicSourceItems(listing, saved), saved, (v) => {
      updateSettings({ musicSource: v });
      refreshMusicNote();
    });
    sel.classList.add("go-combo");
    sel.style.fontSize = "18.67px";
    sel.dataset.id = "music";
    musicSel.remove();
    musicSel = sel;
    music.appendChild(place(sel, 110, 24, 300, 21));
    refreshMusicNote();
  }
  async function refresh(): Promise<void> {
    listing = await listUserPlaylists();
    if (win.closed) return;
    const st = getSettings();
    // A playlist that is back (or changed) since the last listing: re-apply the source with the fresh tracks.
    if (
      sourcePlaylistName(st.musicSource) !== null &&
      musicSourceNote() !== null
    )
      applyMusicSource(st.musicSource, st.musicShuffle, true);
    buildMusicSelect();
  }
  buildMusicSelect();
  void refresh();
  return win;
}
