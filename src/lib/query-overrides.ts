import type { SongQuery } from '../types';

/**
 * Per-video search-word overrides. When the user manually corrects the song /
 * artist for a video (manual search, re-search, or the swap button), we remember
 * their query keyed by the YouTube `?v=` id so the next time that video plays we
 * search with the corrected words instead of re-running auto-detection.
 *
 * Stored as individual `override:<videoId>` keys in `chrome.storage.local` (not a
 * single map) so reads touch only the one video in play and writes never race the
 * whole collection.
 */
const KEY_PREFIX = 'override:';

function keyFor(videoId: string): string {
  return `${KEY_PREFIX}${videoId}`;
}

/** Structural guard: storage is untrusted (could be stale/corrupt schema). */
export function isSongQuery(value: unknown): value is SongQuery {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const query = value as Record<string, unknown>;
  return typeof query['title'] === 'string' && typeof query['artist'] === 'string';
}

/** Returns the saved query for a video, or null when none/unreadable. */
export async function loadQueryOverride(videoId: string): Promise<SongQuery | null> {
  if (!videoId) {
    return null;
  }
  try {
    const key = keyFor(videoId);
    const stored = await chrome.storage.local.get(key);
    const value: unknown = stored[key];
    return isSongQuery(value) ? { title: value.title, artist: value.artist } : null;
  } catch {
    return null; // Persistence is non-critical; fall back to auto-detection.
  }
}

/** Persists the user's corrected query for a video. */
export async function saveQueryOverride(videoId: string, query: SongQuery): Promise<void> {
  if (!videoId || !query.title) {
    return;
  }
  try {
    await chrome.storage.local.set({
      [keyFor(videoId)]: { title: query.title, artist: query.artist },
    });
  } catch {
    // Non-critical; ignore persistence failures.
  }
}

/** Removes a saved override so the video falls back to auto-detection. */
export async function clearQueryOverride(videoId: string): Promise<void> {
  if (!videoId) {
    return;
  }
  try {
    await chrome.storage.local.remove(keyFor(videoId));
  } catch {
    // Non-critical; ignore.
  }
}
