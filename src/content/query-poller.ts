import type { SongQuery } from '../types';

/** True when two queries carry the same title and artist. */
export function queriesEqual(a: SongQuery, b: SongQuery): boolean {
  return a.title === b.title && a.artist === b.artist;
}

/** Snapshot of pipeline coordination state for {@link shouldReleaseClaim}. */
export interface ClaimState {
  /** The token of the operation deciding whether to release. */
  token: number;
  /** The current global token; a mismatch means a newer operation took over. */
  navToken: number;
  /** The video id currently claimed as in-flight. */
  pipelineVideoId: string;
  /** The video id currently rendered in the panel. */
  renderedVideoId: string;
  /** The video id this operation was processing. */
  videoId: string;
}

/**
 * Decides whether an operation that is exiting should release the in-flight
 * pipeline claim. Releasing lets the 2s watchdog retry, which is correct ONLY
 * when this operation is still the current one. The `token === navToken` guard is
 * essential: a *stale* operation (superseded by a newer manual search or sync)
 * must NOT release a claim the newer operation now owns — doing so lets the
 * watchdog start a concurrent sync that discards the newer operation's result,
 * the cause of the "manual change loops forever" bug.
 */
export function shouldReleaseClaim(state: ClaimState): boolean {
  return (
    state.token === state.navToken &&
    state.pipelineVideoId === state.videoId &&
    state.renderedVideoId !== state.videoId
  );
}

/** Dependencies for {@link pollForVideoQuery}; injectable so the poller is unit-testable. */
export interface PollDeps {
  /** The `?v=` id this poll is bound to; the poll aborts if it no longer matches. */
  videoId: string;
  /** Query currently displayed; used to reject the outgoing video's lingering DOM. */
  previous: SongQuery | null;
  /** Hard upper bound on polling, in ms. */
  timeoutMs: number;
  /** Delay between polls, in ms. */
  pollMs: number;
  /** Reads the current song query from the page (e.g. getSongQuery). */
  read: () => SongQuery | null;
  /** Returns the `?v=` id currently in the URL (e.g. currentVideoId). */
  currentId: () => string;
  /** Clock, injectable for tests. Defaults to Date.now. */
  now?: () => number;
  /** Scheduler, injectable for tests. Defaults to setTimeout. */
  schedule?: (callback: () => void, ms: number) => void;
}

/**
 * Polls for the song query that belongs to `videoId`.
 *
 * YouTube changes the URL on navigation *before* the title / artist metadata in
 * the DOM catches up, so a naive read returns the *previous* video's info. The
 * poll therefore resolves early only when the read is both:
 *  - **stable** — identical across two consecutive polls (never a half-updated DOM), and
 *  - **fresh** — different from `previous` (never the outgoing video's still-rendered
 *    metadata, which lingers for a brief window after navigation).
 *
 * On **timeout** the freshness gate is dropped: the lingering window is long gone,
 * so the last stable read reflects *this* video even if it equals `previous` (e.g.
 * the same song re-uploaded). It returns the last value read, or null only when the
 * DOM never produced anything readable — the caller then knows metadata was truly
 * absent rather than silently keeping stale lyrics.
 *
 * The poll aborts (resolves null) if the URL's `v` no longer matches `videoId`,
 * since a newer navigation now owns the pipeline.
 */
export function pollForVideoQuery(deps: PollDeps): Promise<SongQuery | null> {
  const { videoId, previous, timeoutMs, pollMs, read, currentId } = deps;
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? setTimeout;

  const isFresh = (query: SongQuery | null): boolean =>
    query !== null && (previous === null || !queriesEqual(query, previous));

  return new Promise((resolve) => {
    const start = now();
    let lastSeen: SongQuery | null = null;
    const tick = (): void => {
      if (currentId() !== videoId) {
        resolve(null); // Superseded — let the newer navigation handle it.
        return;
      }
      const query = read();
      if (query) {
        const stable = lastSeen !== null && queriesEqual(lastSeen, query);
        if (stable && isFresh(query)) {
          resolve(query);
          return;
        }
        lastSeen = query;
      }
      if (now() - start > timeoutMs) {
        resolve(lastSeen); // Best effort: lingering window has passed (see doc).
        return;
      }
      schedule(tick, pollMs);
    };
    tick();
  });
}
