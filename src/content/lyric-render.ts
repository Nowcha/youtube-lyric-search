/**
 * Parses a utaten.com lyric page and rebuilds the lyric body as a safe DOM tree.
 *
 * Security: the source HTML comes from a third-party site, so it is never inserted
 * via innerHTML. Instead it is parsed with DOMParser (which does not execute
 * scripts) and only whitelisted nodes — text, <br>, and ruby groups — are
 * reconstructed with createElement/textContent. Unknown elements are collapsed to
 * their plain text, so scripts, event-handler attributes, and links cannot survive.
 */
export interface ParsedLyric {
  /** Song title read from the lyric page (may be empty if absent). */
  titleText: string;
  /** A freshly built, sanitized fragment containing the lyric body. */
  lyricFragment: DocumentFragment;
}

/** Builds a sanitized clone of a single source node, or null if it is dropped. */
function buildNode(node: ChildNode): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent ?? '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (tag === 'br') {
    return document.createElement('br');
  }

  if (tag === 'span' && element.classList.contains('ruby')) {
    return buildRuby(element);
  }

  // Unknown element: keep only its text content, never its markup or attributes.
  const text = element.textContent ?? '';
  return text ? document.createTextNode(text) : null;
}

/** Converts utaten's span-based ruby markup into a native <ruby> element. */
function buildRuby(rubyElement: Element): HTMLElement {
  const base = rubyElement.querySelector('.rb')?.textContent ?? rubyElement.textContent ?? '';
  const reading = rubyElement.querySelector('.rt')?.textContent ?? '';

  const ruby = document.createElement('ruby');
  ruby.appendChild(document.createTextNode(base));

  const rt = document.createElement('rt');
  rt.textContent = reading;
  ruby.appendChild(rt);

  return ruby;
}

/** Rebuilds a sanitized fragment from the children of a lyric body element. */
export function sanitizeLyricBody(source: Element): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const child of Array.from(source.childNodes)) {
    const built = buildNode(child);
    if (built) {
      fragment.appendChild(built);
    }
  }
  return fragment;
}

/**
 * Parses a full utaten lyric page HTML string into a sanitized {@link ParsedLyric}.
 * Returns null when the expected lyric body is absent.
 */
export function parseLyricDocument(html: string): ParsedLyric | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.querySelector('.lyricBody .hiragana');
  if (!body) {
    return null;
  }
  const titleText = doc.querySelector('.newLyricTitle__main')?.textContent?.trim() ?? '';
  return { titleText, lyricFragment: sanitizeLyricBody(body) };
}
