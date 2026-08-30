/** A song lookup target derived from the currently playing YouTube video. */
export interface SongQuery {
  /** Song title (e.g. "Pretender"). */
  title: string;
  /** Artist / performer name (e.g. "Official髭男dism"). */
  artist: string;
}

/**
 * Returns a new query with the title and artist swapped. Used when YouTube
 * metadata extraction picks them up in the wrong order; immutable so the caller
 * controls when the swapped value is applied.
 */
export function swapSongQuery(query: SongQuery): SongQuery {
  return { title: query.artist, artist: query.title };
}
