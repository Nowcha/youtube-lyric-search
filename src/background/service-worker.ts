import { lookupLyric } from '../lib/lyric-lookup';
import type { LyricResponse, RuntimeMessage } from '../lib/messages';
import type { SongQuery } from '../types';

const MAX_FIELD_LENGTH = 200;

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

/** Clamps untrusted query fields to a sane length before hitting the network. */
function sanitizeQuery(query: SongQuery): SongQuery {
  return {
    title: query.title.slice(0, MAX_FIELD_LENGTH),
    artist: query.artist.slice(0, MAX_FIELD_LENGTH),
  };
}

chrome.runtime.onMessage.addListener(
  (
    message: RuntimeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: LyricResponse) => void,
  ): boolean => {
    // Only accept messages from this extension's own content scripts.
    if (sender.id !== chrome.runtime.id || !sender.tab) {
      return false;
    }
    if (message.type === 'SEARCH_LYRIC') {
      void lookupLyric(sanitizeQuery(message.query), fetchText).then(sendResponse);
      return true; // Keep the message channel open for the async response.
    }
    return false;
  },
);
