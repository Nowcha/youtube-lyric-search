import type { SongQuery } from '../types';

const UTATEN_ORIGIN = 'https://utaten.com';

/** Matches a lyric detail path such as "/lyric/qk19044046/". */
const LYRIC_PATH = /\/lyric\/[a-z0-9]+\//i;

/** Per-result title cell: captures the lyric path and the displayed song title. */
const RESULT_TITLE = /searchResult__title[\s\S]*?href="(\/lyric\/[a-z0-9]+\/)"\s*>\s*([^<]+?)\s*</gi;

/** Within one result row, the performer anchor inside the artist cell. */
const RESULT_ARTIST = /searchResult__artist[\s\S]*?href="\/artist\/\d+\/"\s*>\s*([^<]+?)\s*</i;

/**
 * Minimum title similarity for a search result to be accepted. utaten's search is
 * lenient (it can return same-title-different-artist songs or loose partial
 * matches), so a result whose title is too dissimilar from the query is rejected
 * to avoid showing unrelated lyrics.
 */
const TITLE_MATCH_FLOOR = 0.5;

/** One parsed row from a utaten search results table. */
export interface SearchResult {
  /** Lyric detail path, e.g. "/lyric/ma18062909/". */
  path: string;
  /** Displayed song title, e.g. "マリーゴールド". */
  title: string;
  /** Displayed performer, e.g. "あいみょん" ('' when not parseable). */
  artist: string;
}

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
 * Parses the rows of a utaten search results page into {@link SearchResult}s.
 *
 * Scoped to the `searchResult` results container so site-chrome links (header,
 * ranking, related) that also use the `/lyric/{id}/` shape are ignored. The
 * service worker has no DOMParser, so this works on the raw HTML string: it walks
 * each `searchResult__title` cell and reads the performer from the following
 * artist cell (the slice up to the next title cell).
 */
export function parseSearchResults(searchHtml: string): SearchResult[] {
  const resultsStart = searchHtml.indexOf('searchResult');
  if (resultsStart < 0) {
    return [];
  }
  const scope = searchHtml.slice(resultsStart);

  const titleMatches = [...scope.matchAll(RESULT_TITLE)];
  return titleMatches.map((match, index) => {
    const path = match[1] ?? '';
    const title = match[2] ?? '';
    const rowStart = match.index ?? 0;
    const rowEnd = titleMatches[index + 1]?.index ?? scope.length;
    const artist = RESULT_ARTIST.exec(scope.slice(rowStart, rowEnd))?.[1]?.trim() ?? '';
    return { path, title: title.trim(), artist };
  });
}

/**
 * Selects the best-matching lyric path for a query, or null when no result is a
 * confident match. Among results whose title clears {@link TITLE_MATCH_FLOOR}, the
 * one with the highest combined title+artist similarity wins.
 */
export function selectBestLyricPath(searchHtml: string, query: SongQuery): string | null {
  let best: { path: string; score: number } | null = null;
  for (const result of parseSearchResults(searchHtml)) {
    if (!result.path) {
      continue;
    }
    const titleScore = similarity(query.title, result.title);
    if (titleScore < TITLE_MATCH_FLOOR) {
      continue;
    }
    const artistScore = query.artist ? similarity(query.artist, result.artist) : 0;
    const score = titleScore * 0.7 + artistScore * 0.3;
    if (!best || score > best.score) {
      best = { path: result.path, score };
    }
  }
  return best?.path ?? null;
}

/**
 * Extracts the top lyric detail path from a search results page, unverified.
 *
 * Retained as a last-resort fallback for when result rows cannot be parsed (e.g.
 * a markup change) but a `/lyric/{id}/` link is still present in the results
 * container. Prefer {@link selectBestLyricPath} for confidence-checked selection.
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

/**
 * Normalizes a title/artist for comparison: full-width→half-width, lower-cased,
 * and stripped of whitespace and decorative punctuation so "唱 (Sho)" and "唱",
 * or "アイドル" and "アイドル　", compare equal.
 */
function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[「」『』（）()[\]【】~〜・,，.。!！?？'"’”`\-–—_/／｜|]/g, '');
}

/** Bigram set of a string, used for the Dice similarity coefficient. */
function bigrams(value: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < value.length - 1; i += 1) {
    set.add(value.slice(i, i + 2));
  }
  return set;
}

/**
 * Similarity in [0, 1] between two titles/artists. Exact (normalized) match is 1,
 * a containment relationship scores high, otherwise the Sørensen–Dice coefficient
 * over character bigrams is used (works for both Japanese and Latin text).
 */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) {
    return 0;
  }
  if (x === y) {
    return 1;
  }
  if (x.includes(y) || y.includes(x)) {
    return 0.9;
  }
  if (x.length < 2 || y.length < 2) {
    return 0; // No bigrams to compare; the equality/containment checks above failed.
  }
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  for (const gram of bx) {
    if (by.has(gram)) {
      overlap += 1;
    }
  }
  return (2 * overlap) / (bx.size + by.size);
}
