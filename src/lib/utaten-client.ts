import type { SongQuery } from '../types';

const UTATEN_ORIGIN = 'https://utaten.com';

/** Matches a lyric detail path such as "/lyric/qk19044046/". */
const LYRIC_PATH = /\/lyric\/[a-z0-9]+\//i;

/**
 * Builds the utaten.com search URL for a song.
 *
 * The query-parameter form is used because it reliably returns results, whereas
 * the path-based form (`/search/=/title=.../`) is brittle. Spaces are encoded as
 * `%20` (not `+`) for broader server compatibility.
 */
export function buildSearchUrl(query: SongQuery): string {
  const params = new URLSearchParams({
    title: query.title,
    artist_name: query.artist,
    sort: 'popular_sort_asc',
  });
  return `${UTATEN_ORIGIN}/search?${params.toString().replace(/\+/g, '%20')}`;
}

/**
 * Extracts the top lyric detail path from a search results HTML page.
 *
 * The match is scoped to the `searchResult` results container so that site-chrome
 * links (header, ranking, related) that also use the `/lyric/{id}/` shape are
 * ignored. The service worker has no DOMParser, so this uses a string offset
 * rather than a DOM query.
 */
export function extractFirstLyricPath(searchHtml: string): string | null {
  const resultsStart = searchHtml.indexOf('searchResult');
  const scope = resultsStart >= 0 ? searchHtml.slice(resultsStart) : searchHtml;
  const match = LYRIC_PATH.exec(scope);
  return match ? match[0] : null;
}

/** Resolves a lyric path to an absolute utaten.com URL. */
export function toLyricUrl(lyricPath: string): string {
  return `${UTATEN_ORIGIN}${lyricPath}`;
}
