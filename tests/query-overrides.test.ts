import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isSongQuery,
  loadQueryOverride,
  saveQueryOverride,
  clearQueryOverride,
} from '../src/lib/query-overrides';

/** Installs an in-memory stand-in for chrome.storage.local with remove support. */
function installMockStorage(): void {
  const store: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    }),
    remove: vi.fn(async (key: string) => {
      delete store[key];
    }),
  };
  vi.stubGlobal('chrome', { storage: { local } } as unknown as typeof chrome);
}

describe('isSongQuery', () => {
  it('accepts an object with string title and artist', () => {
    expect(isSongQuery({ title: 'Idol', artist: 'YOASOBI' })).toBe(true);
  });

  it('rejects null, non-objects, and missing/typed-wrong fields', () => {
    expect(isSongQuery(null)).toBe(false);
    expect(isSongQuery('Idol')).toBe(false);
    expect(isSongQuery({ title: 'Idol' })).toBe(false);
    expect(isSongQuery({ title: 1, artist: 2 })).toBe(false);
  });
});

describe('query overrides storage', () => {
  beforeEach(() => {
    installMockStorage();
  });

  it('returns null when no override is saved', async () => {
    expect(await loadQueryOverride('abc')).toBeNull();
  });

  it('round-trips a saved override by videoId', async () => {
    await saveQueryOverride('abc', { title: 'Pretender', artist: 'Official髭男dism' });
    expect(await loadQueryOverride('abc')).toEqual({
      title: 'Pretender',
      artist: 'Official髭男dism',
    });
  });

  it('keeps overrides separate per videoId', async () => {
    await saveQueryOverride('v1', { title: 'A', artist: 'X' });
    await saveQueryOverride('v2', { title: 'B', artist: 'Y' });
    expect(await loadQueryOverride('v1')).toEqual({ title: 'A', artist: 'X' });
    expect(await loadQueryOverride('v2')).toEqual({ title: 'B', artist: 'Y' });
  });

  it('does not save when videoId or title is empty', async () => {
    await saveQueryOverride('', { title: 'A', artist: 'X' });
    await saveQueryOverride('v3', { title: '', artist: 'X' });
    expect(await loadQueryOverride('v3')).toBeNull();
  });

  it('clears a saved override', async () => {
    await saveQueryOverride('abc', { title: 'A', artist: 'X' });
    await clearQueryOverride('abc');
    expect(await loadQueryOverride('abc')).toBeNull();
  });
});
