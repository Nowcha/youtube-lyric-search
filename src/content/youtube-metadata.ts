import { parseSongQuery, type RawVideoInfo } from '../lib/title-parser';
import type { SongQuery } from '../types';

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

/**
 * Reads the current video title and channel, or null when metadata is not ready.
 *
 * The document title (usually "Title - Artist" / "Artist - Title …") is preferred
 * because it carries both fields and, unlike the Media Session API, never reflects
 * a playing ad. The DOM heading is a fallback. The channel name from the DOM owner
 * disambiguates artist/title order. Returning null while the title is still the
 * placeholder ("YouTube") lets the caller keep polling for real metadata.
 */
export function readVideoInfo(): RawVideoInfo | null {
  const docTitle = cleanDocumentTitle();
  const videoTitle = !isPlaceholder(docTitle) ? docTitle : firstText(TITLE_SELECTORS);
  if (isPlaceholder(videoTitle)) {
    return null;
  }
  return { videoTitle, channelName: firstText(CHANNEL_SELECTORS) };
}

/** Derives a {@link SongQuery} for the currently playing video, if detectable. */
export function getSongQuery(): SongQuery | null {
  const info = readVideoInfo();
  if (!info) {
    return null;
  }
  const query = parseSongQuery(info);
  return query.title && !isPlaceholder(query.title) ? query : null;
}
