import { describe, it, expect } from 'vitest';
import { swapSongQuery } from '../src/types';

describe('swapSongQuery', () => {
  it('swaps title and artist', () => {
    expect(swapSongQuery({ title: 'Official髭男dism', artist: 'Pretender' })).toEqual({
      title: 'Pretender',
      artist: 'Official髭男dism',
    });
  });

  it('returns a new object without mutating the input', () => {
    const original = { title: 'A', artist: 'B' };
    const swapped = swapSongQuery(original);

    expect(swapped).not.toBe(original);
    expect(original).toEqual({ title: 'A', artist: 'B' });
  });

  it('is an involution — swapping twice yields the original', () => {
    const query = { title: 'アイドル', artist: 'YOASOBI' };
    expect(swapSongQuery(swapSongQuery(query))).toEqual(query);
  });
});
