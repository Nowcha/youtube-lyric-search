/** A song lookup target derived from the currently playing YouTube video. */
export interface SongQuery {
  /** Song title (e.g. "Pretender"). */
  title: string;
  /** Artist / performer name (e.g. "Official髭男dism"). */
  artist: string;
}
