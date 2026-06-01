import type { SongQuery } from '../types';

/** Reason codes returned when a lyric lookup does not succeed. */
export type LyricFailureReason = 'not_found' | 'network_error';

/** Message sent from the content script to the background service worker. */
export interface SearchLyricRequest {
  type: 'SEARCH_LYRIC';
  query: SongQuery;
}

/** Any message the service worker is expected to handle. */
export type RuntimeMessage = SearchLyricRequest;

/** Response returned by the service worker for a {@link SearchLyricRequest}. */
export type LyricResponse =
  | { ok: true; html: string; lyricUrl: string }
  | { ok: false; reason: LyricFailureReason; message: string };
