import '../styles/panel.css';
import { getSongQuery } from './youtube-metadata';
import { parseLyricDocument } from './lyric-render';
import { LyricPanel } from './panel';
import type { LyricResponse, SearchLyricRequest } from '../lib/messages';
import type { SongQuery } from '../types';

const MOUNT_SELECTOR = '#secondary-inner';
const MOUNT_TIMEOUT_MS = 15000;
const QUERY_TIMEOUT_MS = 12000;
const QUERY_POLL_MS = 300;

let panel: LyricPanel | null = null;
/** The `?v=` id whose detection we have already started; dedupes events + polling. */
let handledVideoId = '';
/** Title we last searched, used to detect when metadata has updated to a new video. */
let lastTitle = '';
/** Incremented on every navigation so late async results can be discarded. */
let navToken = 0;
const VIDEO_POLL_MS = 2000;

function isWatchPage(): boolean {
  return location.pathname === '/watch';
}

function currentVideoId(): string {
  return new URLSearchParams(location.search).get('v') ?? '';
}

/** Resolves with the first matching element, or null after the timeout. */
function waitForElement(selector: string, timeoutMs: number): Promise<Element | null> {
  const existing = document.querySelector(selector);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(found);
      }
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

/**
 * Polls until a song query is detectable whose title differs from the previous
 * video's title. YouTube fires navigation events before the title metadata
 * updates, so waiting for the title to change avoids searching with the prior
 * video's information. On timeout it returns the most recent query seen (best
 * effort — e.g. when two consecutive videos genuinely share a title).
 */
function waitForFreshQuery(previousTitle: string, timeoutMs: number): Promise<SongQuery | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    let latest: SongQuery | null = null;
    const tick = (): void => {
      const query = getSongQuery();
      if (query) {
        latest = query;
        if (query.title !== previousTitle) {
          resolve(query);
          return;
        }
      }
      if (Date.now() - start > timeoutMs) {
        resolve(latest);
        return;
      }
      setTimeout(tick, QUERY_POLL_MS);
    };
    tick();
  });
}

function isLyricResponse(value: unknown): value is LyricResponse {
  return (
    typeof value === 'object' && value !== null && typeof (value as { ok?: unknown }).ok === 'boolean'
  );
}

/** False after the extension is reloaded/updated while this old script keeps running. */
function isExtensionContextValid(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

async function requestLyric(query: SongQuery): Promise<LyricResponse> {
  const request: SearchLyricRequest = { type: 'SEARCH_LYRIC', query };
  const raw: unknown = await chrome.runtime.sendMessage(request);
  if (!isLyricResponse(raw)) {
    return { ok: false, reason: 'network_error', message: '拡張機能の応答が不正です' };
  }
  return raw;
}

async function runSearch(query: SongQuery, token: number): Promise<void> {
  if (!panel) {
    return;
  }
  if (!isExtensionContextValid()) {
    panel.setError('拡張機能が更新されました。ページを再読み込み（F5）してください。');
    return;
  }
  panel.setLoading(query);

  try {
    const response = await requestLyric(query);
    if (token !== navToken) {
      return; // A newer navigation superseded this search; discard the result.
    }
    if (!response.ok) {
      if (response.reason === 'not_found') {
        panel.setNotFound(query);
      } else {
        panel.setError(response.message);
      }
      return;
    }

    const parsed = parseLyricDocument(response.html);
    if (!parsed) {
      panel.setNotFound(query);
      return;
    }
    panel.setLyric(parsed.titleText || query.title, parsed.lyricFragment, response.lyricUrl);
  } catch (error) {
    if (token !== navToken) {
      return;
    }
    console.error(
      '[YouTube Lyric Search] search failed',
      error instanceof Error ? error.message : String(error),
    );
    panel.setError('拡張機能の通信に失敗しました');
  }
}

/** Handles a manual search from the panel inputs. */
function handleManualSearch(query: SongQuery): void {
  handledVideoId = currentVideoId();
  lastTitle = query.title;
  void runSearch(query, ++navToken);
}

async function syncWithCurrentVideo(): Promise<void> {
  if (!isWatchPage()) {
    handledVideoId = '';
    lastTitle = '';
    return;
  }

  const videoId = currentVideoId();

  // Same video (event re-fired or polled again): only ensure the panel is still
  // mounted. Crucially, do NOT bump the nav token here, or a concurrent trigger
  // would invalidate an in-flight search for this same video.
  if (videoId && videoId === handledVideoId) {
    const existing = document.querySelector(MOUNT_SELECTOR);
    if (panel && existing instanceof HTMLElement) {
      panel.mount(existing);
    }
    return;
  }

  // A genuinely new video — commit to handling it and supersede older work.
  handledVideoId = videoId;
  const token = ++navToken;

  const container = await waitForElement(MOUNT_SELECTOR, MOUNT_TIMEOUT_MS);
  if (token !== navToken || !(container instanceof HTMLElement)) {
    return;
  }

  if (!panel) {
    panel = new LyricPanel({ onSearch: handleManualSearch });
  }
  panel.mount(container);
  panel.setBusy('曲情報を取得中…');

  const query = await waitForFreshQuery(lastTitle, QUERY_TIMEOUT_MS);
  if (token !== navToken) {
    return;
  }
  if (!query) {
    panel.setError('曲情報を取得できませんでした。手動で検索してください。');
    return;
  }

  lastTitle = query.title;
  void runSearch(query, token);
}

// React to SPA navigation events, and poll the video id as a fallback for
// navigations that do not emit a recognized event (autoplay, playlist "next").
window.addEventListener('yt-navigate-finish', () => {
  void syncWithCurrentVideo();
});
setInterval(() => {
  if (isWatchPage() && currentVideoId() !== handledVideoId) {
    void syncWithCurrentVideo();
  }
}, VIDEO_POLL_MS);

void syncWithCurrentVideo();
