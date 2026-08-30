import { describe, it, expect } from 'vitest';
import {
  buildSearchUrl,
  extractFirstLyricPath,
  parseSearchResults,
  selectBestLyricPath,
  similarity,
  toLyricUrl,
} from '../src/lib/utaten-client';

/** Builds one utaten search-result row in the structure the live site emits. */
function row(path: string, title: string, artist: string): string {
  return (
    '<tr>' +
    `<td><p class="searchResult__title"><a href="${path}"> ${title} </a></p></td>` +
    `<td class="searchResult__artist"><p><a href="/artist/11343/"> ${artist} </a></p>` +
    '<div class="searchResult__lyricist"><p>作詞： <span class="songWriters">' +
    '<a href="/songWriter/24299/"> 誰か </a></span></p></div></td>' +
    `<td class="lyricList__beginning"><a href="${path}">歌い出し…</a></td>` +
    '</tr>'
  );
}

/** Wraps result rows in the searchResult table plus some site-chrome noise. */
function searchPage(...rows: string[]): string {
  return (
    '<header><a href="/lyric/promo000/">featured</a></header>' +
    '<table class="searchResult artistLyricList">' +
    '<tr><th class="searchResult__head">楽曲・タイトル</th>' +
    '<th class="searchResult__artist">アーティスト</th><th>歌詞・歌い出し</th></tr>' +
    rows.join('') +
    '</table>'
  );
}

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

describe('parseSearchResults', () => {
  it('parses path, title and artist for each result row', () => {
    const html = searchPage(
      row('/lyric/ma18062909/', 'マリーゴールド', 'あいみょん'),
      row('/lyric/ad19044046/', 'アイドル', 'YOASOBI'),
    );
    expect(parseSearchResults(html)).toEqual([
      { path: '/lyric/ma18062909/', title: 'マリーゴールド', artist: 'あいみょん' },
      { path: '/lyric/ad19044046/', title: 'アイドル', artist: 'YOASOBI' },
    ]);
  });

  it('returns an empty array when there is no results container', () => {
    expect(parseSearchResults('<p>該当する歌詞が見つかりませんでした</p>')).toEqual([]);
  });
});

describe('selectBestLyricPath', () => {
  it('returns the matching result when title and artist agree', () => {
    const html = searchPage(row('/lyric/ma18062909/', 'マリーゴールド', 'あいみょん'));
    expect(selectBestLyricPath(html, { title: 'マリーゴールド', artist: 'あいみょん' })).toBe(
      '/lyric/ma18062909/',
    );
  });

  it('rejects an unrelated result whose title is too dissimilar', () => {
    const html = searchPage(row('/lyric/sk00000000/', '逆様', '誰か'));
    expect(selectBestLyricPath(html, { title: 'I Love It', artist: 'Icona Pop' })).toBeNull();
  });

  it('prefers the same-title result whose artist matches the query', () => {
    const html = searchPage(
      row('/lyric/other00000/', 'アイドル', '別のアーティスト'),
      row('/lyric/yoasobi001/', 'アイドル', 'YOASOBI'),
    );
    expect(selectBestLyricPath(html, { title: 'アイドル', artist: 'YOASOBI' })).toBe(
      '/lyric/yoasobi001/',
    );
  });

  it('accepts a title match via containment ("唱 (Sho)" vs "唱")', () => {
    const html = searchPage(row('/lyric/sho000000/', '唱', 'Ado'));
    expect(selectBestLyricPath(html, { title: '唱 (Sho)', artist: 'Ado' })).toBe(
      '/lyric/sho000000/',
    );
  });

  it('returns null when there are no results at all', () => {
    expect(selectBestLyricPath('<p>no results</p>', { title: 'x', artist: 'y' })).toBeNull();
  });
});

describe('similarity', () => {
  it('scores an exact normalized match as 1', () => {
    expect(similarity('アイドル', 'アイドル')).toBe(1);
    expect(similarity('Pretender', 'pretender ')).toBe(1);
  });

  it('scores a containment relationship highly', () => {
    expect(similarity('唱 (Sho)', '唱')).toBeGreaterThanOrEqual(0.9);
  });

  it('scores unrelated strings low', () => {
    expect(similarity('I Love It', '逆様')).toBeLessThan(0.5);
  });

  it('returns 0 when either side is empty', () => {
    expect(similarity('', 'アイドル')).toBe(0);
  });
});

describe('extractFirstLyricPath', () => {
  it('extracts the first /lyric/{id}/ path from search HTML', () => {
    const html = '<table class="searchResult"><a href="/lyric/qk19044046/">Pretender</a></table>';
    expect(extractFirstLyricPath(html)).toBe('/lyric/qk19044046/');
  });

  it('returns null when no lyric link is present', () => {
    expect(extractFirstLyricPath('<p>no results</p>')).toBeNull();
  });
});

describe('toLyricUrl', () => {
  it('resolves a path to an absolute utaten URL', () => {
    expect(toLyricUrl('/lyric/qk19044046/')).toBe('https://utaten.com/lyric/qk19044046/');
  });
});
