import { parseSongQuery, refineStructuredQuery, type RawVideoInfo } from '../lib/title-parser';
import type { SongQuery } from '../types';

/**
 * Selectors for YouTube's "Music in this video" attribute card, which carries
 * pre-separated, ad-free song / artist fields — the single most accurate source.
 * The card is rendered into the DOM even with the description collapsed.
 *
 * It MUST be scoped to `ytd-watch-metadata`: the same `yt-video-attribute-view-model`
 * element is also used for music cards in the related-videos rail, so an unscoped
 * query can grab a recommended track instead of the one that is playing.
 */
const MUSIC_SECTION_SELECTOR = 'ytd-watch-metadata yt-video-attribute-view-model';
const MUSIC_TITLE_SELECTOR = '.ytVideoAttributeViewModelTitle';
const MUSIC_ARTIST_SELECTOR = '.ytVideoAttributeViewModelSubtitle';

/** Selectors for the watch-page video title, ordered by preference. */
const TITLE_SELECTORS = [
  'ytd-watch-metadata #title h1 yt-formatted-string',
  'h1.ytd-watch-metadata yt-formatted-string',
  '#title h1 yt-formatted-string',
  'h1.title yt-formatted-string',
];

/** Selectors for the uploader / channel name, ordered by preference. */
const CHANNEL_SELECTORS = [
  'ytd-watch-metadata ytd-channel-name#channel-name a',
  '#owner ytd-channel-name a',
  'ytd-video-owner-renderer #channel-name a',
  '#upload-info #channel-name a',
];

/** Titles that mean "metadata is not ready yet", not a real song title. */
const PLACEHOLDER_TITLES = new Set(['', 'youtube']);

function firstText(selectors: readonly string[]): string {
  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) {
      return text;
    }
  }
  return '';
}

/** Strips the notification count prefix and " - YouTube" suffix from document.title. */
function cleanDocumentTitle(): string {
  return document.title
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s*-\s*YouTube\s*$/, '')
    .trim();
}

function isPlaceholder(title: string): boolean {
  return PLACEHOLDER_TITLES.has(title.toLowerCase());
}

/** True while a YouTube ad is playing — its overlay marks the player element. */
function isAdPlaying(): boolean {
  const player = document.querySelector('.html5-video-player');
  if (!player) {
    return false;
  }
  return player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
}

/**
 * Reads the channel/artist field from YouTube's Media Session metadata, used only
 * as a fallback when the DOM owner element is not yet populated. The Media Session
 * `title` is intentionally ignored — on youtube.com it is just the raw video title
 * (noise and all), so the structured music card / title parser handle the title.
 * Returns '' while an ad is playing, since the session then describes the ad.
 */
function readMediaSessionArtist(): string {
  if (isAdPlaying()) {
    return '';
  }
  return navigator.mediaSession?.metadata?.artist.trim() ?? '';
}

/**
 * Reads the "Music in this video" attribute card, if YouTube has matched this
 * video to a track. This is the most accurate source: the song and artist arrive
 * already separated and free of "Official Music Video" / bracket noise.
 */
function readMusicSectionInfo(): { title: string; artist: string } | null {
  const card = document.querySelector(MUSIC_SECTION_SELECTOR);
  if (!card) {
    return null;
  }
  const title = card.querySelector(MUSIC_TITLE_SELECTOR)?.textContent?.trim() ?? '';
  const artist = card.querySelector(MUSIC_ARTIST_SELECTOR)?.textContent?.trim() ?? '';
  if (!title || !artist || isPlaceholder(title)) {
    return null;
  }
  return { title, artist };
}

/** Strips whitespace and lowercases so two strings can be compared loosely. */
function normalizeLoose(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

/**
 * Confirms a music card belongs to the *currently playing* video.
 *
 * YouTube does not clear the previous video's attribute card immediately on
 * navigation — it lingers in the DOM until the new metadata renders. Because the
 * card is otherwise our preferred source, a stale card would make us search for
 * the previous song. The watch-page title heading (driving `heading.videoTitle`)
 * updates reliably per video, so we only trust the card when the current heading
 * actually contains the card's song title or artist; otherwise it is stale.
 */
function musicCardMatchesHeading(
  music: { title: string; artist: string },
  heading: RawVideoInfo,
): boolean {
  const headingText = normalizeLoose(`${heading.videoTitle} ${heading.channelName}`);
  if (!headingText) {
    return false;
  }
  const cardTitle = normalizeLoose(music.title);
  const cardArtist = normalizeLoose(music.artist);
  return (
    (cardTitle.length > 1 && headingText.includes(cardTitle)) ||
    (cardArtist.length > 1 && headingText.includes(cardArtist))
  );
}

/**
 * Reads the current video title and channel, or null when metadata is not ready.
 *
 * The document title (usually "Title - Artist" / "Artist - Title …") is preferred
 * because it carries both fields and, unlike the Media Session API, never reflects
 * a playing ad. The DOM heading is a fallback. The channel name (DOM owner, or the
 * Media Session artist when the DOM is not ready) disambiguates artist/title order.
 * Returning null while the title is still the placeholder ("YouTube") lets the
 * caller keep polling for real metadata.
 */
export function readVideoInfo(): RawVideoInfo | null {
  const docTitle = cleanDocumentTitle();
  const videoTitle = !isPlaceholder(docTitle) ? docTitle : firstText(TITLE_SELECTORS);
  if (isPlaceholder(videoTitle)) {
    return null;
  }
  const channelName = firstText(CHANNEL_SELECTORS) || readMediaSessionArtist();
  return { videoTitle, channelName };
}

/**
 * Derives a {@link SongQuery} for the currently playing video, if detectable.
 *
 * The watch-page title heading (read by {@link readVideoInfo}) is the per-video
 * anchor: it updates reliably when the video changes and never lingers from the
 * previous video. So it drives the result, and the "Music in this video" card is
 * used only as a clean-up *enhancement* when it is confirmed to belong to the
 * current video (see {@link musicCardMatchesHeading}). Returning null while the
 * heading is still a placeholder lets the caller keep polling for real metadata.
 *
 * Source priority (most reliable first):
 *  1. The "Music in this video" card, only when it matches the current heading —
 *     pre-separated, noise-free song / artist.
 *  2. Parsing the combined video title + channel name for everything else
 *     (covers user uploads, covers, remixes that YouTube has not matched).
 */
export function getSongQuery(): SongQuery | null {
  const info = readVideoInfo();
  if (!info) {
    return null;
  }

  const music = readMusicSectionInfo();
  if (music && musicCardMatchesHeading(music, info)) {
    const refined = refineStructuredQuery(music);
    if (refined.title && !isPlaceholder(refined.title)) {
      return refined;
    }
  }

  const query = parseSongQuery(info);
  return query.title && !isPlaceholder(query.title) ? query : null;
}
