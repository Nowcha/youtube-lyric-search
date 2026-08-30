import { describe, it, expect, beforeEach, vi } from 'vitest';
import { lookupLyric } from '../src/lib/lyric-lookup';
import { setCached, cacheKey } from '../src/lib/cache';

const LYRIC_PATH = '/lyric/qk19044046/';
const LYRIC_URL = 'https://utaten.com/lyric/qk19044046/';
const LYRIC_HTML = '<div class="lyricBody"><div class="hiragana">君</div></div>';

/** Builds a parseable utaten search-results page with a single matching row. */
function searchResultHtml(title: string, artist: string): string {
  return (
    '<table class="searchResult artistLyricList">' +
    '<tr><th class="searchResult__head">楽曲・タイトル</th>' +
    '<th class="searchResult__artist">アーティスト</th></tr>' +
    `<tr><td><p class="searchResult__title"><a href="${LYRIC_PATH}"> ${title} </a></p></td>` +
    `<td class="searchResult__artist"><p><a href="/artist/1/"> ${artist} </a></p></td></tr>` +
    '</table>'
  );
}

const SEARCH_HTML = searchResultHtml('Pretender', 'Official髭男dism');

function installMockStorage(): void {
  const store: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    }),
  };
  vi.stubGlobal('chrome', { storage: { local } } as unknown as typeof chrome);
}

describe('lookupLyric', () => {
  beforeEach(() => {
    installMockStorage();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('returns a cached entry without fetching', async () => {
    const query = { title: 'Pretender', artist: 'X' };
    await setCached(cacheKey(query), { html: LYRIC_HTML, lyricUrl: LYRIC_URL, ts: Date.now() });
    const fetchText = vi.fn();

    const result = await lookupLyric(query, fetchText);

    expect(result).toEqual({ ok: true, html: LYRIC_HTML, lyricUrl: LYRIC_URL });
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('searches then fetches the lyric page on a cache miss', async () => {
    const fetchText = vi
      .fn<(url: string) => Promise<string>>()
      .mockResolvedValueOnce(SEARCH_HTML)
      .mockResolvedValueOnce(LYRIC_HTML);

    const result = await lookupLyric({ title: 'Pretender', artist: 'Y' }, fetchText);

    expect(result).toEqual({ ok: true, html: LYRIC_HTML, lyricUrl: LYRIC_URL });
    expect(fetchText).toHaveBeenCalledTimes(2);
  });

  it('retries with swapped artist/title when the first ordering misses', async () => {
    // Metadata arrived reversed (title/artist swapped); the swapped retry matches.
    const fetchText = vi
      .fn<(url: string) => Promise<string>>()
      .mockResolvedValueOnce('<p>no results</p>') // original (reversed) order misses
      .mockResolvedValueOnce(searchResultHtml('いのちの食べ方', 'Eve')) // swapped order hits
      .mockResolvedValueOnce(LYRIC_HTML); // lyric page

    const result = await lookupLyric({ title: 'Eve', artist: 'いのちの食べ方' }, fetchText);

    expect(result).toEqual({ ok: true, html: LYRIC_HTML, lyricUrl: LYRIC_URL });
    expect(fetchText).toHaveBeenCalledTimes(3);
  });

  it('rejects a confident-looking page whose title does not match the query', async () => {
    // utaten returned a real results page, but for an unrelated song — reject it.
    const fetchText = vi
      .fn<(url: string) => Promise<string>>()
      .mockResolvedValue(searchResultHtml('逆様', '誰か'));

    const result = await lookupLyric({ title: 'I Love It', artist: 'Icona Pop' }, fetchText);

    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('returns not_found when the search has no lyric link', async () => {
    const fetchText = vi
      .fn<(url: string) => Promise<string>>()
      .mockResolvedValueOnce('<p>no results</p>');

    const result = await lookupLyric({ title: 'z', artist: 'z' }, fetchText);

    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('returns network_error when a fetch rejects', async () => {
    const fetchText = vi
      .fn<(url: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('HTTP 500'));

    const result = await lookupLyric({ title: 'a', artist: 'b' }, fetchText);

    expect(result).toMatchObject({ ok: false, reason: 'network_error' });
  });

  it('caches a successful lookup so the next call avoids the network', async () => {
    const query = { title: 'Pretender', artist: 'C' };
    const firstFetch = vi
      .fn<(url: string) => Promise<string>>()
      .mockResolvedValueOnce(SEARCH_HTML)
      .mockResolvedValueOnce(LYRIC_HTML);
    await lookupLyric(query, firstFetch);

    const secondFetch = vi.fn();
    const result = await lookupLyric(query, secondFetch);

    expect(result.ok).toBe(true);
    expect(secondFetch).not.toHaveBeenCalled();
  });
});
