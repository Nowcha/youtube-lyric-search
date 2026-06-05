import '../styles/panel.css';
import { getSongQuery } from './youtube-metadata';
import { parseLyricDocument } from './lyric-render';
import { LyricPanel } from './panel';
import { pollForVideoQuery, queriesEqual } from './query-poller';
import {
  loadQueryOverride,
  saveQueryOverride,
  clearQueryOverride,
} from '../lib/query-overrides';
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

/** Thin wrapper binding {@link pollForVideoQuery} to the live page reads. */
function waitForVideoQuery(
  videoId: string,
  previous: SongQuery | null,
  timeoutMs: number,
): Promise<SongQuery | null> {
  return pollForVideoQuery({
    videoId,
    previous,
    timeoutMs,
    pollMs: QUERY_POLL_MS,
    read: getSongQuery,
    currentId: currentVideoId,
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

/**
 * Runs a lyric search for `query` and renders the outcome.
 *
 * `persist` is set only for user-initiated searches: when such a search finds
 * lyrics, the query is saved as this video's override (see `query-overrides.ts`)
 * so future plays reuse the corrected words. Auto-detected searches never persist
 * — we do not want to freeze a possibly-wrong auto guess.
 */
async function runSearch(
  query: SongQuery,
  videoId: string,
  token: number,
  persist = false,
): Promise<void> {
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
    if (persist) {
      void saveQueryOverride(videoId, query); // Remember this correction for next time.
    }
  } catch (error) {
    if (isStale(videoId, token)) {
      return;
    }
    console.error(
      '[YouTube Lyric Search] search failed',
      error instanceof Error ? error.message : String(error),
    );
    panel.setError('拡張機能の通信に失敗しました。「再検索」で再試行できます。');
    // Terminal for this attempt — mark rendered so the fallback poll does not
    // retry a hard failure every couple of seconds. The user retries via 再検索.
    markRendered(videoId, query);
  }
}

/** Handles a manual search from the panel inputs; persists it as the override. */
function handleManualSearch(query: SongQuery): void {
  void runSearch(query, currentVideoId(), ++navToken, true);
}

/**
 * Forces a fresh metadata read + search for the current video, even if it was
 * already rendered. This is the user's escape hatch when auto-detection kept the
 * previous video's lyrics — and the reset for a saved override that turned out
 * wrong: it discards the override and re-detects from the page. Clearing
 * `lastQuery` drops the "freshness" constraint so the next stable DOM read is
 * accepted as-is (no diff against stale state).
 */
function handleRefresh(): void {
  if (!isWatchPage()) {
    return;
  }
  const videoId = currentVideoId();
  renderedVideoId = '';
  pipelineVideoId = '';
  lastQuery = null;
  // Discard any saved override first, then re-detect with it skipped so we never
  // race the async removal against the override lookup in the re-sync.
  void clearQueryOverride(videoId).finally(() => {
    void syncWithCurrentVideo({ skipOverride: true });
  });
}

/** Re-attaches the panel to its mount point if YouTube re-rendered the rail. */
function ensureMounted(): void {
  const existing = document.querySelector(MOUNT_SELECTOR);
  if (panel && existing instanceof HTMLElement) {
    panel.mount(existing);
  }
}

interface SyncOptions {
  /** Skip the saved-override lookup and re-detect from the page (used by refresh). */
  skipOverride?: boolean;
}

async function syncWithCurrentVideo(options: SyncOptions = {}): Promise<void> {
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

  // CRITICAL self-heal: every exit from here must either render `videoId` or
  // release the in-flight claim. If we bail (mount timeout, superseded, no
  // metadata) without releasing, `pipelineVideoId` stays stuck === videoId and
  // the fallback poll below is blocked forever — the panel never recovers (this
  // was the recurring "title not loaded on navigation" bug, e.g. when
  // #secondary-inner is briefly absent in theater mode). The finally guarantees
  // release so the 2s poll can retry.
  try {
    const container = await waitForElement(MOUNT_SELECTOR, MOUNT_TIMEOUT_MS);
    if (token !== navToken || !(container instanceof HTMLElement)) {
      return;
    }

    if (!panel) {
      panel = new LyricPanel({ onSearch: handleManualSearch, onRefresh: handleRefresh });
    }
    panel.mount(container);
    panel.setBusy('曲情報を取得中…'); // Clears the previous video's lyrics immediately.

    // A saved correction for this video wins over auto-detection: search it
    // directly and skip the metadata poll entirely. Refresh passes `skipOverride`
    // to bypass this and force re-detection from the page.
    if (!options.skipOverride) {
      const override = await loadQueryOverride(videoId);
      if (isStale(videoId, token)) {
        return;
      }
      if (override) {
        await runSearch(override, videoId, token);
        return;
      }
    }

    const query = await waitForVideoQuery(videoId, lastQuery, QUERY_TIMEOUT_MS);
    if (isStale(videoId, token)) {
      return;
    }
    if (!query) {
      panel.setError('曲情報を取得できませんでした。「更新」か手動検索をお試しください。');
      return; // finally releases the claim so the poll retries metadata later.
    }

    // Metadata is identical to what is already displayed (e.g. a replay or chapter
    // jump): the shown lyrics are already correct, so keep them and stop polling.
    if (lastQuery && queriesEqual(query, lastQuery)) {
      markRendered(videoId, query);
      return;
    }

    await runSearch(query, videoId, token);
  } finally {
    // Release the claim unless we successfully rendered this video. Only touch it
    // if we still own it (`=== videoId`); a newer navigation may have taken over.
    if (pipelineVideoId === videoId && renderedVideoId !== videoId) {
      pipelineVideoId = '';
    }
  }
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
