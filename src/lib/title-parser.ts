import type { SongQuery } from '../types';

/** Raw signals read from the YouTube watch page. */
export interface RawVideoInfo {
  /** The video title text (e.g. "Official髭男dism - Pretender [Official Video]"). */
  videoTitle: string;
  /** The uploader / channel name (e.g. "Official髭男dism" or "Ado - Topic"). */
  channelName: string;
}

/**
 * Pre-separated title / artist signals, e.g. from the Media Session API where
 * YouTube exposes curated `title` and `artist` fields for music content.
 */
export interface RawStructuredInfo {
  /** The song title field (usually already the bare title, e.g. "Pretender"). */
  title: string;
  /** The artist field (usually the bare performer, e.g. "Official髭男dism"). */
  artist: string;
}

/** Keywords that mark a bracketed segment or token as non-title "noise". */
const NOISE_KEYWORDS =
  /(official|video|music\s*video|m\/?v|audio|lyrics?|visualizer|hd|hq|4k|full|ver\.?|version|teaser|trailer|live|cover|remix|prod\.?|feat\.?|ft\.?|featuring|歌詞|字幕|歌ってみた|フル|公式|本編|ミュージック\s*[・]?\s*ビデオ)/i;

/** Matches a single bracketed group of any common ASCII / full-width bracket type. */
const BRACKET_GROUP = /[【(\[（｛{][^】)\]）｝}]*[】)\]）｝}]/g;

/** Standalone noise tokens to drop from an artist fragment (e.g. "米津玄師 MV"). */
const LOOSE_NOISE = /(?:^|\s)(MV|M\/V|official|music\s*video|ミュージックビデオ)(?=\s|$)/gi;

/**
 * Separators between artist and title. ASCII dash/slash/pipe require surrounding
 * spaces so hyphenated words ("Self-Control") are not split, while full-width
 * slash/pipe (／｜) may appear without spaces.
 */
const SEPARATOR = /\s+[-–—−－|/]\s+|\s*[／｜]\s*/;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Removes bracketed groups that contain a noise keyword, keeping meaningful ones. */
function stripNoiseBrackets(value: string): string {
  return value.replace(BRACKET_GROUP, (group) => (NOISE_KEYWORDS.test(group) ? ' ' : group));
}

/** Removes a trailing "feat. X" / "ft. X" / "featuring X" segment. */
function stripFeaturing(value: string): string {
  return value.replace(/\s*(?:feat\.?|ft\.?|featuring)\s+.*$/i, '');
}

function stripLooseNoise(value: string): string {
  return value.replace(LOOSE_NOISE, ' ');
}

/** Splits "Artist - Title" on the first separator. Returns null when absent. */
function splitOnSeparator(value: string): { left: string; right: string } | null {
  const match = SEPARATOR.exec(value);
  const separator = match?.[0];
  if (!match || separator === undefined) {
    return null;
  }
  const left = collapseWhitespace(value.slice(0, match.index));
  const right = collapseWhitespace(value.slice(match.index + separator.length));
  if (!left || !right) {
    return null;
  }
  return { left, right };
}

/** Extracts a Japanese-quoted title like Artist「Title」, returning the parts. */
function extractQuotedTitle(value: string): { title: string; before: string } | null {
  const match = /[「『]([^」』]+)[」』]/.exec(value);
  if (!match || !match[1]) {
    return null;
  }
  return {
    title: collapseWhitespace(match[1]),
    before: collapseWhitespace(value.slice(0, match.index)),
  };
}

/** Cleans a split fragment: removes featuring/loose noise, falling back to the raw value. */
function cleanPart(value: string): string {
  return collapseWhitespace(stripLooseNoise(stripFeaturing(value))) || collapseWhitespace(value);
}

function normalizeForMatch(value: string): string {
  return collapseWhitespace(value).toLowerCase();
}

/** True when a fragment plausibly refers to the channel (one contains the other). */
function matchesChannel(part: string, channel: string): boolean {
  const p = normalizeForMatch(part);
  const c = normalizeForMatch(channel);
  return p.length > 0 && c.length > 0 && (p.includes(c) || c.includes(p));
}

/**
 * Resolves which side of an "A {sep} B" title is the artist vs. the title.
 *
 * Order is ambiguous ("Artist - Title" vs. "Title / Artist"), so the channel name
 * is used to disambiguate: the side that matches the channel is the artist. Falls
 * back to the "Artist - Title" convention when the channel matches neither side.
 */
function chooseArtistTitle(left: string, right: string, channel: string): SongQuery {
  const cleanLeft = cleanPart(left);
  const cleanRight = cleanPart(right);

  if (channel) {
    const leftIsArtist = matchesChannel(cleanLeft, channel);
    const rightIsArtist = matchesChannel(cleanRight, channel);
    if (leftIsArtist && !rightIsArtist) {
      return { artist: channel, title: cleanRight };
    }
    if (rightIsArtist && !leftIsArtist) {
      return { artist: channel, title: cleanLeft };
    }
  }

  return { artist: cleanLeft, title: cleanRight };
}

/** Strips a YouTube Music auto-generated "- Topic" suffix from a channel name. */
function parseChannel(channelName: string): { artist: string; isTopic: boolean } {
  const match = /^(.*?)\s*-\s*Topic$/i.exec(channelName);
  if (match && match[1]) {
    return { artist: collapseWhitespace(match[1]), isTopic: true };
  }
  return { artist: collapseWhitespace(channelName), isTopic: false };
}

/**
 * Derives a best-effort {@link SongQuery} from a YouTube video title and channel.
 *
 * Strategy order (most reliable first):
 *  1. Quoted title — Artist「Title」 / Artist『Title』
 *  2. "- Topic" channel — the video title is the bare song name
 *  3. Separator split — "Artist - Title"
 *  4. Fallback — whole cleaned title, artist taken from the channel
 */
export function parseSongQuery(info: RawVideoInfo): SongQuery {
  const channel = parseChannel(info.channelName);

  const quoted = extractQuotedTitle(info.videoTitle);
  if (quoted) {
    const beforeArtist = collapseWhitespace(stripLooseNoise(stripNoiseBrackets(quoted.before)));
    return {
      title: collapseWhitespace(stripFeaturing(quoted.title)),
      artist: beforeArtist || channel.artist,
    };
  }

  const cleaned = collapseWhitespace(stripNoiseBrackets(info.videoTitle));

  if (channel.isTopic) {
    return { title: stripFeaturing(cleaned) || cleaned, artist: channel.artist };
  }

  const split = splitOnSeparator(cleaned);
  if (split) {
    return chooseArtistTitle(split.left, split.right, channel.artist);
  }

  return { title: stripFeaturing(cleaned) || cleaned, artist: channel.artist };
}

/**
 * Refines pre-separated metadata (e.g. from the Media Session API) into a
 * {@link SongQuery}.
 *
 * Because the title and artist already arrive separated and curated, this avoids
 * the order-ambiguity of {@link parseSongQuery}. It still:
 *  - strips noise brackets / loose noise / "feat." tails from both fields, and
 *  - re-splits the title when a provider passes the full "Artist - Title" string,
 *    using the artist field to decide which side is the real title.
 */
export function refineStructuredQuery(info: RawStructuredInfo): SongQuery {
  const artist = collapseWhitespace(stripLooseNoise(stripNoiseBrackets(info.artist)));
  const cleanedTitle = collapseWhitespace(stripNoiseBrackets(info.title));

  let titleSide = cleanedTitle;
  const split = splitOnSeparator(cleanedTitle);
  if (split && artist) {
    if (matchesChannel(split.left, artist)) {
      titleSide = split.right;
    } else if (matchesChannel(split.right, artist)) {
      titleSide = split.left;
    }
  }

  const title = collapseWhitespace(stripFeaturing(stripLooseNoise(titleSide)));
  return {
    title: title || cleanedTitle || collapseWhitespace(info.title),
    artist: artist || collapseWhitespace(info.artist),
  };
}
