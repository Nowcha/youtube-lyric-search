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
/** The `?v=` id whose result is currently displayed in the panel ('' when none). */
let renderedVideoId = '';
/** The `?v=` id of the navigation currently being processed (in-flight). */
let pipelineVideoId = '';
/** Query of the currently displayed result; used to detect when metadata is fresh. */
let lastQuery: SongQuery | null = null;
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

function queriesEqual(a: SongQuery, b: SongQuery): boolean {
  return a.title === b.title && a.artist === b.artist;
}

/**
 * Polls for the song query that belongs to `videoId`.
 *
 * YouTube fires navigation events (and changes the URL) before the title / artist
 * metadata in the DOM catches up, so a naive read returns the *previous* video's
 * information. To avoid that we resolve only when the query is:
 *  - **stable** — identical across two consecutive polls, so we never read a
 *    half-updated DOM (e.g. new title but stale channel), and
 *  - **fresh** — different from the query currently displayed (`previous`), so we
 *    do not grab the outgoing video's still-rendered metadata.
 *
 * The poll aborts early if the user navigates again (the URL's `v` no longer
 * matches `videoId`). On timeout it returns the last query seen **only if that
 * query is fresh** (differs from `previous`); if the DOM never produced anything
 * but the outgoing video's metadata, it returns null so the caller treats it as
 * "could not read this video" rather than silently keeping the previous lyrics.
 * Returns null when no metadata was ever readable.
 */
function waitForVideoQuery(
  videoId: string,
  previous: SongQuery | null,
  timeoutMs: number,
): Promise<SongQuery | null> {
  const isFresh = (query: SongQuery | null): boolean =>
    query !== null && (previous === null || !queriesEqual(query, previous));
  return new Promise((resolve) => {
    const start = Date.now();
    let lastSeen: SongQuery | null = null;
    const tick = (): void => {
      if (currentVideoId() !== videoId) {
        // Superseded by a newer navigation: only hand back fresh metadata, never
        // the outgoing video's lingering query.
        resolve(isFresh(lastSeen) ? lastSeen : null);
        return;
      }
      const query = getSongQuery();
      if (query) {
        const stable = lastSeen !== null && queriesEqual(lastSeen, query);
        if (stable && isFresh(query)) {
          resolve(query);
          return;
        }
        lastSeen = query;
      }
      if (Date.now() - start > timeoutMs) {
        // Best effort, but reject a stale read: returning the previous video's
        // query here would mark this video "rendered" with the wrong lyrics.
        resolve(isFresh(lastSeen) ? lastSeen : null);
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

/** True when a newer navigation has superseded this search, or the video changed. */
function isStale(videoId: string, token: number): boolean {
  return token !== navToken || currentVideoId() !== videoId;
}

/** Marks `videoId` as the one currently displayed so we stop reprocessing it. */
function markRendered(videoId: string, query: SongQuery): void {
  renderedVideoId = videoId;
  lastQuery = query;
}

async function runSearch(query: SongQuery, videoId: string, token: number): Promise<void> {
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
    if (isStale(videoId, token)) {
      return; // A newer navigation superseded this search; discard the result.
    }
    if (!response.ok) {
      if (response.reason === 'not_found') {
        panel.setNotFound(query);
      } else {
        panel.setError(response.message);
      }
      markRendered(videoId, query); // Resolved (even if no match) — don't reprocess.
      return;
    }

    const parsed = parseLyricDocument(response.html);
    if (!parsed) {
      panel.setNotFound(query);
      markRendered(videoId, query);
      return;
    }
    panel.setLyric(parsed.titleText || query.title, parsed.lyricFragment, response.lyricUrl);
    markRendered(videoId, query);
  } catch (error) {
    if (isStale(videoId, token)) {
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
  void runSearch(query, currentVideoId(), ++navToken);
}

/**
 * Forces a fresh metadata read + search for the current video, even if it was
 * already rendered. This is the user's escape hatch when auto-detection kept the
 * previous video's lyrics: clearing `lastQuery` drops the "freshness" constraint
 * so the next stable DOM read is accepted as-is (no diff against stale state).
 */
function handleRefresh(): void {
  if (!isWatchPage()) {
    return;
  }
  renderedVideoId = '';
  pipelineVideoId = '';
  lastQuery = null;
  void syncWithCurrentVideo();
}

/** Re-attaches the panel to its mount point if YouTube re-rendered the rail. */
function ensureMounted(): void {
  const existing = document.querySelector(MOUNT_SELECTOR);
  if (panel && existing instanceof HTMLElement) {
    panel.mount(existing);
  }
}

async function syncWithCurrentVideo(): Promise<void> {
  if (!isWatchPage()) {
    pipelineVideoId = '';
    renderedVideoId = '';
    lastQuery = null;
    return;
  }

  const videoId = currentVideoId();
  if (!videoId) {
    return;
  }

  // Already shown, or already being processed: just keep the panel mounted. Do NOT
  // bump the nav token here, or a concurrent trigger would invalidate the in-flight
  // search for this same video.
  if (videoId === renderedVideoId || videoId === pipelineVideoId) {
    ensureMounted();
    return;
  }

  // A genuinely new video — claim it and supersede older work. `pipelineVideoId`
  // (distinct from `renderedVideoId`) marks it as in-flight, not yet displayed.
  pipelineVideoId = videoId;
  const token = ++navToken;

  const container = await waitForElement(MOUNT_SELECTOR, MOUNT_TIMEOUT_MS);
  if (token !== navToken || !(container instanceof HTMLElement)) {
    return;
  }

  if (!panel) {
    panel = new LyricPanel({ onSearch: handleManualSearch, onRefresh: handleRefresh });
  }
  panel.mount(container);
  panel.setBusy('曲情報を取得中…'); // Clears the previous video's lyrics immediately.

  const query = await waitForVideoQuery(videoId, lastQuery, QUERY_TIMEOUT_MS);
  if (isStale(videoId, token)) {
    return;
  }
  if (!query) {
    pipelineVideoId = ''; // Metadata never appeared — allow a later retry.
    panel.setError('曲情報を取得できませんでした。手動で検索してください。');
    return;
  }

  // Metadata is identical to what is already displayed (e.g. a replay or chapter
  // jump): the shown lyrics are already correct, so keep them and stop polling.
  if (lastQuery && queriesEqual(query, lastQuery)) {
    markRendered(videoId, query);
    return;
  }

  await runSearch(query, videoId, token);
}

// React to SPA navigation events, and poll the video id as a fallback for
// navigations that do not emit a recognized event (autoplay, playlist "next").
window.addEventListener('yt-navigate-finish', () => {
  void syncWithCurrentVideo();
});
setInterval(() => {
  if (!isWatchPage()) {
    return;
  }
  const videoId = currentVideoId();
  if (videoId && videoId !== renderedVideoId && videoId !== pipelineVideoId) {
    void syncWithCurrentVideo();
  }
}, VIDEO_POLL_MS);

void syncWithCurrentVideo();
