import { describe, it, expect } from 'vitest';
import { parseSongQuery, refineStructuredQuery } from '../src/lib/title-parser';

describe('parseSongQuery', () => {
  it('splits "Artist - Title" and strips a noise bracket', () => {
    expect(
      parseSongQuery({
        videoTitle: 'Official髭男dism - Pretender [Official Video]',
        channelName: 'Official髭男dism',
      }),
    ).toEqual({ artist: 'Official髭男dism', title: 'Pretender' });
  });

  it('extracts a Japanese-quoted title (Artist「Title」)', () => {
    expect(
      parseSongQuery({ videoTitle: 'YOASOBI「アイドル」', channelName: 'Ayase / YOASOBI' }),
    ).toEqual({ artist: 'YOASOBI', title: 'アイドル' });
  });

  it('drops a leading "MV" noise token before a quoted title', () => {
    expect(
      parseSongQuery({ videoTitle: '米津玄師 MV「Lemon」', channelName: '米津玄師' }),
    ).toEqual({ artist: '米津玄師', title: 'Lemon' });
  });

  it('uses the channel name for a "- Topic" auto-channel and keeps the bare title', () => {
    expect(
      parseSongQuery({ videoTitle: 'Subtitle', channelName: 'Official髭男dism - Topic' }),
    ).toEqual({ artist: 'Official髭男dism', title: 'Subtitle' });
  });

  it('does not split a Topic-channel title that contains a hyphen', () => {
    expect(
      parseSongQuery({ videoTitle: 'Self-Control', channelName: 'TM NETWORK - Topic' }),
    ).toEqual({ artist: 'TM NETWORK', title: 'Self-Control' });
  });

  it('keeps a meaningful parenthetical that is not noise', () => {
    expect(parseSongQuery({ videoTitle: 'Ado - 唱 (Sho)', channelName: 'Ado' })).toEqual({
      artist: 'Ado',
      title: '唱 (Sho)',
    });
  });

  it('strips a "feat." segment from the title', () => {
    expect(
      parseSongQuery({
        videoTitle: 'Artist - Song feat. Someone',
        channelName: 'Artist',
      }),
    ).toEqual({ artist: 'Artist', title: 'Song' });
  });

  it('removes a full-width 【MV】 bracket and splits', () => {
    expect(
      parseSongQuery({ videoTitle: 'あいみょん - マリーゴールド【MV】', channelName: 'あいみょん' }),
    ).toEqual({ artist: 'あいみょん', title: 'マリーゴールド' });
  });

  it('falls back to the channel name when there is no separator', () => {
    expect(parseSongQuery({ videoTitle: 'Lemon', channelName: 'Some Channel' })).toEqual({
      artist: 'Some Channel',
      title: 'Lemon',
    });
  });

  it('handles a leading noise bracket before "Artist - Title"', () => {
    expect(
      parseSongQuery({ videoTitle: '【Official Music Video】Ado - 唱', channelName: 'Ado' }),
    ).toEqual({ artist: 'Ado', title: '唱' });
  });

  it('collapses redundant whitespace', () => {
    expect(
      parseSongQuery({ videoTitle: '  Artist   -   Title  ', channelName: 'Artist' }),
    ).toEqual({ artist: 'Artist', title: 'Title' });
  });

  it('splits on a full-width slash separator', () => {
    expect(parseSongQuery({ videoTitle: 'Artist／Title', channelName: 'x' })).toEqual({
      artist: 'Artist',
      title: 'Title',
    });
  });

  it('splits on a spaced full-width hyphen-minus (－)', () => {
    expect(parseSongQuery({ videoTitle: 'あいみょん － 裸の心', channelName: 'x' })).toEqual({
      artist: 'あいみょん',
      title: '裸の心',
    });
  });

  it('uses the channel to correct "Title / Artist MV" order and strips MV', () => {
    expect(parseSongQuery({ videoTitle: 'いのちの食べ方 / Eve MV', channelName: 'Eve' })).toEqual({
      artist: 'Eve',
      title: 'いのちの食べ方',
    });
  });

  it('keeps "Artist - Title" when the channel matches the left side', () => {
    expect(parseSongQuery({ videoTitle: 'Eve - いのちの食べ方', channelName: 'Eve' })).toEqual({
      artist: 'Eve',
      title: 'いのちの食べ方',
    });
  });

  it('falls back to Artist-Title order when the channel matches neither side', () => {
    expect(parseSongQuery({ videoTitle: 'Artist - Song', channelName: 'Unrelated Label' })).toEqual({
      artist: 'Artist',
      title: 'Song',
    });
  });

  it('parses 【Artist】Title / Subtitle, ignoring an anime name quoted inside a noise bracket', () => {
    // Regression: the 『マリッジトキシン』 inside "（TVアニメ…Collab MV）" used to be
    // extracted as the song title. Noise brackets are now stripped first.
    expect(
      parseSongQuery({
        videoTitle: '【AKASAKI】シャケナベイベー / Shake Na Baby（TVアニメ『マリッジトキシン』Collab MV）',
        channelName: 'AKASAKI (19)',
      }),
    ).toEqual({ artist: 'AKASAKI', title: 'シャケナベイベー' });
  });

  it('treats a leading 【Artist】 as the artist when the channel agrees', () => {
    expect(
      parseSongQuery({ videoTitle: '【ヨルシカ】花に亡霊', channelName: 'ヨルシカ' }),
    ).toEqual({ artist: 'ヨルシカ', title: '花に亡霊' });
  });

  it('treats a leading 【franchise】 tag as non-artist and trusts the channel order', () => {
    // The bracket is a series tag, not the artist; channel "Omoi" disambiguates.
    expect(
      parseSongQuery({ videoTitle: '【プロセカ】テオ / Omoi', channelName: 'Omoi' }),
    ).toEqual({ artist: 'Omoi', title: 'テオ' });
  });

  it('does not mistake a 『』 quote inside a noise bracket for the title', () => {
    expect(
      parseSongQuery({
        videoTitle: 'Eve - 廻廻奇譚（アニメ『呪術廻戦』OP）',
        channelName: 'Eve',
      }),
    ).toEqual({ artist: 'Eve', title: '廻廻奇譚' });
  });
});

describe('refineStructuredQuery', () => {
  it('keeps pre-separated Media Session fields as-is', () => {
    expect(refineStructuredQuery({ title: 'アイドル', artist: 'YOASOBI' })).toEqual({
      artist: 'YOASOBI',
      title: 'アイドル',
    });
  });

  it('strips a noise bracket left in the title field', () => {
    expect(
      refineStructuredQuery({ title: 'Pretender [Official Video]', artist: 'Official髭男dism' }),
    ).toEqual({ artist: 'Official髭男dism', title: 'Pretender' });
  });

  it('strips a "feat." tail from the title field', () => {
    expect(refineStructuredQuery({ title: 'Song feat. Someone', artist: 'Artist' })).toEqual({
      artist: 'Artist',
      title: 'Song',
    });
  });

  it('re-splits when the title field carries the full "Artist - Title"', () => {
    expect(refineStructuredQuery({ title: 'YOASOBI - アイドル', artist: 'YOASOBI' })).toEqual({
      artist: 'YOASOBI',
      title: 'アイドル',
    });
  });

  it('uses the artist side to pick the title from "Title - Artist" order', () => {
    expect(refineStructuredQuery({ title: 'いのちの食べ方 - Eve', artist: 'Eve' })).toEqual({
      artist: 'Eve',
      title: 'いのちの食べ方',
    });
  });

  it('does not split a hyphenated title when neither side is the artist', () => {
    expect(refineStructuredQuery({ title: 'Self - Control', artist: 'TM NETWORK' })).toEqual({
      artist: 'TM NETWORK',
      title: 'Self - Control',
    });
  });

  it('trims surrounding whitespace from both fields', () => {
    expect(refineStructuredQuery({ title: '  Lemon  ', artist: '  米津玄師  ' })).toEqual({
      artist: '米津玄師',
      title: 'Lemon',
    });
  });
});
