// [musicmood] User playlists (Options → Music & Mood). Platform-neutral: no Node APIs here.
//
// Desktop app: the shell (desktop/userMusic.cjs) keeps a "Music" folder in the app's user-data folder, next to the
// saves; each subfolder is one playlist. It serves the listing at /user-music/index.json and the files under
// /user-music/<playlist>/<file>, the same way it maps the DW:U install under /assets/dwu/.
// Browser / dev build: no such folder; the player can pick one with "Choose folder…" (<input webkitdirectory>), kept
// for this session only as blob URLs.

import { encodePathSegments } from "../sim/data/customization";

export interface UserTrack {
  name: string;
  url: string;
}

export interface UserPlaylist {
  name: string;
  tracks: UserTrack[];
  /** Chosen with "Choose folder…" (browser; gone on reload). */
  session: boolean;
}

export interface UserMusicListing {
  playlists: UserPlaylist[];
  /** Short notes for the panel (empty folders, skipped files, …). */
  notes: string[];
  /** The Music folder's path on disk (desktop), else null. */
  folder: string | null;
}

export const USER_MUSIC_PREFIX = "/user-music/";
export const USER_MUSIC_INDEX = "/user-music/index.json";

/** Supported extensions → the MIME type asked of HTMLMediaElement.canPlayType. */
export const MUSIC_TYPES: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg; codecs=opus",
  flac: "audio/flac",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
};

/** The MIME type of a supported music file name, else null. */
export function musicMimeType(fileName: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(fileName);
  return m === null ? null : (MUSIC_TYPES[m[1].toLowerCase()] ?? null);
}

/** Whether this browser can play the file's format (always true where canPlayType is unavailable, e.g. tests). */
export function canPlayMusicFile(
  fileName: string,
  canPlay: (mime: string) => boolean = defaultCanPlay,
): boolean {
  const mime = musicMimeType(fileName);
  return mime !== null && canPlay(mime);
}

function defaultCanPlay(mime: string): boolean {
  try {
    return typeof Audio === "undefined"
      ? true
      : new Audio().canPlayType(mime) !== "";
  } catch {
    return true;
  }
}

/** The settings value of a playlist (UiSettings.musicSource). */
export function playlistSource(name: string): string {
  return `playlist:${name}`;
}

/** The playlist name of a UiSettings.musicSource value, or null for 'original' / 'off'. */
export function sourcePlaylistName(source: string): string | null {
  return source.startsWith("playlist:")
    ? source.slice("playlist:".length)
    : null;
}

/** Pure: the playlist a chosen-folder file belongs to, from its webkitRelativePath ("Root/Sub/x.mp3" → "Sub",
 *  "Root/x.mp3" → "Root"; deeper files join their first subfolder). */
export function sessionPlaylistName(relativePath: string): string {
  const parts = relativePath.split("/").filter((p) => p !== "");
  return parts.length >= 3 ? parts[1] : (parts[0] ?? "Music");
}

/** Pure: the shell's listing JSON → playlists (file URLs under USER_MUSIC_PREFIX), dropping files this browser cannot
 *  play and empty playlists, with a note for each. */
export function parseDesktopListing(
  body: unknown,
  canPlay?: (mime: string) => boolean,
): UserMusicListing {
  const out: UserMusicListing = { playlists: [], notes: [], folder: null };
  if (body === null || typeof body !== "object") return out;
  const b = body as { folder?: unknown; notes?: unknown; playlists?: unknown };
  if (typeof b.folder === "string") out.folder = b.folder;
  if (Array.isArray(b.notes))
    for (const n of b.notes) if (typeof n === "string") out.notes.push(n);
  if (!Array.isArray(b.playlists)) return out;
  for (const p of b.playlists as { name?: unknown; files?: unknown }[]) {
    if (typeof p?.name !== "string" || !Array.isArray(p.files)) continue;
    const tracks: UserTrack[] = [];
    let unplayable = 0;
    for (const f of p.files as { name?: unknown; rel?: unknown }[]) {
      if (typeof f?.name !== "string" || typeof f.rel !== "string") continue;
      if (!canPlayMusicFile(f.name, canPlay)) {
        unplayable++;
        continue;
      }
      tracks.push({
        name: f.name,
        url: USER_MUSIC_PREFIX + encodePathSegments(f.rel),
      });
    }
    if (unplayable > 0)
      out.notes.push(
        `${p.name}: ${unplayable} file${unplayable === 1 ? "" : "s"} this build cannot play, skipped.`,
      );
    if (tracks.length === 0) {
      if (unplayable === 0) out.notes.push(`${p.name}: no music files.`);
      continue;
    }
    out.playlists.push({ name: p.name, tracks, session: false });
  }
  return out;
}

/** The desktop shell is present (desktop/gamePreload.cjs). */
export function isDesktopApp(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as unknown as { dwuDesktop?: unknown }).dwuDesktop !== undefined
  );
}

const sessionPlaylists = new Map<string, UserPlaylist>();
let lastListing: UserMusicListing = { playlists: [], notes: [], folder: null };

/** Browser: the files of a folder chosen with <input webkitdirectory> become session playlists. Returns notes. */
export function addSessionFolder(files: Iterable<File>): string[] {
  const groups = new Map<string, File[]>();
  let skipped = 0;
  for (const f of files) {
    const rel =
      (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
      f.name;
    if (!canPlayMusicFile(f.name)) {
      if (musicMimeType(f.name) !== null) skipped++;
      continue;
    }
    if (f.size === 0) {
      skipped++;
      continue;
    }
    const name = sessionPlaylistName(rel);
    const list = groups.get(name) ?? [];
    list.push(f);
    groups.set(name, list);
  }
  for (const [name, list] of groups) {
    const old = sessionPlaylists.get(name);
    for (const t of old?.tracks ?? []) URL.revokeObjectURL(t.url);
    list.sort((a, b) => a.name.localeCompare(b.name));
    sessionPlaylists.set(name, {
      name,
      session: true,
      tracks: list.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
    });
  }
  const notes: string[] = [];
  if (groups.size === 0) notes.push("No playable music files in that folder.");
  if (skipped > 0)
    notes.push(
      `${skipped} file${skipped === 1 ? "" : "s"} skipped (empty or a format this browser cannot play).`,
    );
  return notes;
}

/** Re-read the playlists: the desktop Music folder (when the shell serves it) plus this session's chosen folders. */
export async function listUserPlaylists(
  fetchFn: typeof fetch = fetch,
): Promise<UserMusicListing> {
  let listing: UserMusicListing = { playlists: [], notes: [], folder: null };
  if (isDesktopApp()) {
    try {
      const r = await fetchFn(USER_MUSIC_INDEX, { cache: "no-store" });
      if (r.ok && (r.headers.get("Content-Type") ?? "").includes("json"))
        listing = parseDesktopListing(await r.json());
      else listing.notes.push("The Music folder could not be read.");
    } catch {
      listing.notes.push("The Music folder could not be read.");
    }
  }
  for (const p of sessionPlaylists.values())
    if (!listing.playlists.some((q) => q.name === p.name))
      listing.playlists.push(p);
  lastListing = listing;
  return listing;
}

/** The playlist of that name from the last listing, or null. */
export function cachedPlaylist(name: string): UserPlaylist | null {
  return lastListing.playlists.find((p) => p.name === name) ?? null;
}
