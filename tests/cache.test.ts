import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cacheKey, getCached, setCached, type CacheEntry } from '../src/lib/cache';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Installs an in-memory stand-in for chrome.storage.local. */
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

function entry(overrides: Partial<CacheEntry> = {}): CacheEntry {
  return { html: '<div>lyric</div>', lyricUrl: 'https://utaten.com/lyric/x/', ts: Date.now(), ...overrides };
}

describe('cacheKey', () => {
  it('combines artist and title case-insensitively', () => {
    expect(cacheKey({ artist: 'YOASOBI', title: 'Idol' })).toBe(
      cacheKey({ artist: 'yoasobi', title: 'idol' }),
    );
  });
});

describe('cache storage', () => {
  beforeEach(() => {
    installMockStorage();
  });

  it('returns a stored entry that is still fresh', async () => {
    await setCached('k', entry());
    const got = await getCached('k');
    expect(got?.lyricUrl).toBe('https://utaten.com/lyric/x/');
  });

  it('returns null for a missing key', async () => {
    expect(await getCached('missing')).toBeNull();
  });

  it('returns null for an expired entry', async () => {
    await setCached('old', entry({ ts: Date.now() - 8 * DAY_MS }));
    expect(await getCached('old')).toBeNull();
  });

  it('prunes the oldest entries beyond the cap', async () => {
    for (let i = 0; i < 85; i += 1) {
      await setCached(`k${i}`, entry({ ts: Date.now() + i }));
    }
    // The earliest inserted keys should have been evicted.
    expect(await getCached('k0')).toBeNull();
    expect(await getCached('k84')).not.toBeNull();
  });
});
