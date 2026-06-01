import { buildSearchUrl, extractFirstLyricPath, toLyricUrl } from './utaten-client';
import { cacheKey, getCached, setCached } from './cache';
import type { LyricResponse } from './messages';
import type { SongQuery } from '../types';

/** Fetches the text body of a URL. Injected so the lookup is testable. */
export type FetchText = (url: string) => Promise<string>;

/**
 * Resolves a song's lyrics: cache → utaten search → utaten lyric page.
 *
 * Network and parsing concerns are isolated here (away from the service-worker
 * message plumbing) so the success / not-found / network-error branches can be
 * unit tested with an injected {@link FetchText}.
 */
async function findLyricPath(query: SongQuery, fetchText: FetchText): Promise<string | null> {
  const searchHtml = await fetchText(buildSearchUrl(query));
  return extractFirstLyricPath(searchHtml);
}

export async function lookupLyric(query: SongQuery, fetchText: FetchText): Promise<LyricResponse> {
  const key = cacheKey(query);

  const cached = await getCached(key);
  if (cached) {
    return { ok: true, html: cached.html, lyricUrl: cached.lyricUrl };
  }

  try {
    let lyricPath = await findLyricPath(query, fetchText);

    // Retry with artist/title swapped — YouTube titles are ambiguous about order
    // ("Title / Artist" vs. "Artist - Title"), so a miss may just be a swap.
    if (!lyricPath && query.artist && query.title && query.artist !== query.title) {
      lyricPath = await findLyricPath({ title: query.artist, artist: query.title }, fetchText);
    }

    if (!lyricPath) {
      return { ok: false, reason: 'not_found', message: '歌詞が見つかりませんでした' };
    }

    const lyricUrl = toLyricUrl(lyricPath);
    const html = await fetchText(lyricUrl);

    try {
      await setCached(key, { html, lyricUrl, ts: Date.now() });
    } catch {
      // Storage quota exceeded or unavailable — caching is best-effort, so ignore.
    }

    return { ok: true, html, lyricUrl };
  } catch (error) {
    console.error(
      '[YouTube Lyric Search] lookup failed',
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, reason: 'network_error', message: 'utaten.com への接続に失敗しました' };
  }
}
