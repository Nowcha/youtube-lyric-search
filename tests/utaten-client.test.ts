import { describe, it, expect } from 'vitest';
import { buildSearchUrl, extractFirstLyricPath, toLyricUrl } from '../src/lib/utaten-client';

describe('buildSearchUrl', () => {
  it('builds a query-parameter search URL with title, artist and sort', () => {
    const url = buildSearchUrl({ title: 'Pretender', artist: 'Official髭男dism' });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://utaten.com');
    expect(parsed.pathname).toBe('/search');
    expect(parsed.searchParams.get('title')).toBe('Pretender');
    expect(parsed.searchParams.get('artist_name')).toBe('Official髭男dism');
    expect(parsed.searchParams.get('sort')).toBe('popular_sort_asc');
  });

  it('encodes spaces as %20 rather than +', () => {
    const url = buildSearchUrl({ title: 'Lost Stars', artist: 'Adam Levine' });
    expect(url).toContain('%20');
    expect(url).not.toContain('+');
  });
});

describe('extractFirstLyricPath', () => {
  it('extracts the first /lyric/{id}/ path from search HTML', () => {
    const html = '<a href="/artist/10955/">x</a><a href="/lyric/qk19044046/">Pretender</a>';
    expect(extractFirstLyricPath(html)).toBe('/lyric/qk19044046/');
  });

  it('returns null when no lyric link is present', () => {
    expect(extractFirstLyricPath('<p>no results</p>')).toBeNull();
  });

  it('ignores /lyric/ links that appear before the search-results container', () => {
    const html =
      '<header><a href="/lyric/promo000/">featured</a></header>' +
      '<table class="searchResult artistLyricList"><a href="/lyric/qk19044046/">real</a></table>';
    expect(extractFirstLyricPath(html)).toBe('/lyric/qk19044046/');
  });
});

describe('toLyricUrl', () => {
  it('resolves a path to an absolute utaten URL', () => {
    expect(toLyricUrl('/lyric/qk19044046/')).toBe('https://utaten.com/lyric/qk19044046/');
  });
});
