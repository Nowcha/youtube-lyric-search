import { describe, it, expect, beforeEach } from 'vitest';
import { getSongQuery } from '../src/content/youtube-metadata';

describe('getSongQuery', () => {
  beforeEach(() => {
    document.title = '';
    document.body.innerHTML = '';
  });

  it('resolves "Title - Artist MV" using the DOM channel name', () => {
    document.title = 'いのちの食べ方 - Eve MV - YouTube';
    document.body.innerHTML =
      '<div id="owner"><ytd-channel-name id="channel-name"><a href="/@x">Eve</a></ytd-channel-name></div>';
    expect(getSongQuery()).toEqual({ artist: 'Eve', title: 'いのちの食べ方' });
  });

  it('returns null while the title is still the "YouTube" placeholder', () => {
    document.title = 'YouTube';
    expect(getSongQuery()).toBeNull();
  });

  it('returns null when the title is empty', () => {
    document.title = '';
    expect(getSongQuery()).toBeNull();
  });

  it('parses "Artist - Title" from the document title, stripping noise and suffix', () => {
    document.title = 'Official髭男dism - Pretender [Official Video] - YouTube';
    expect(getSongQuery()).toEqual({ artist: 'Official髭男dism', title: 'Pretender' });
  });

  it('strips a "(N)" notification-count prefix', () => {
    document.title = '(3) YOASOBI「アイドル」 - YouTube';
    expect(getSongQuery()).toEqual({ artist: 'YOASOBI', title: 'アイドル' });
  });

  it('uses the channel name as artist when the title has no separator', () => {
    document.title = 'Pretender - YouTube';
    document.body.innerHTML =
      '<div id="owner"><ytd-channel-name id="channel-name"><a href="/@x">Official髭男dism</a></ytd-channel-name></div>';
    expect(getSongQuery()).toEqual({ artist: 'Official髭男dism', title: 'Pretender' });
  });

  it('prefers the music card when it matches the current title heading', () => {
    document.title = 'YOASOBI - アイドル【OFFICIAL MUSIC VIDEO】 - YouTube';
    document.body.innerHTML = `
      <ytd-watch-metadata>
        <yt-video-attribute-view-model>
          <div class="ytVideoAttributeViewModelTitle">アイドル</div>
          <div class="ytVideoAttributeViewModelSubtitle">YOASOBI</div>
        </yt-video-attribute-view-model>
      </ytd-watch-metadata>`;
    expect(getSongQuery()).toEqual({ artist: 'YOASOBI', title: 'アイドル' });
  });

  it('rejects a stale music card that does not match the current video heading', () => {
    // URL/heading have moved to "Pretender", but the previous video's card lingers.
    document.title = 'Official髭男dism - Pretender [Official Video] - YouTube';
    document.body.innerHTML = `
      <ytd-watch-metadata>
        <yt-video-attribute-view-model>
          <div class="ytVideoAttributeViewModelTitle">アイドル</div>
          <div class="ytVideoAttributeViewModelSubtitle">YOASOBI</div>
        </yt-video-attribute-view-model>
      </ytd-watch-metadata>`;
    // Falls back to parsing the heading instead of returning the stale card's song.
    expect(getSongQuery()).toEqual({ artist: 'Official髭男dism', title: 'Pretender' });
  });
});
