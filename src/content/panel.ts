import { swapSongQuery, type SongQuery } from '../types';

const PANEL_ID = 'yls-lyric-panel';
const FURIGANA_STORAGE_KEY = 'showFurigana';
const COLLAPSE_STORAGE_KEY = 'collapsed';

/** Callbacks the panel uses to ask the host (content script) to do work. */
export interface PanelCallbacks {
  /** Invoked when the user submits a manual search or requests a re-search. */
  onSearch: (query: SongQuery) => void;
  /**
   * Invoked when the user forces a refresh: re-read the current video's metadata
   * from the page and search again. Used to recover when auto-detection is stale.
   */
  onRefresh: () => void;
}

interface ElementOptions {
  className?: string;
  text?: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  return node;
}

function clear(node: HTMLElement): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

/**
 * Owns the lyric panel DOM injected next to the YouTube player and exposes
 * imperative state transitions (loading / lyric / not-found / error).
 */
export class LyricPanel {
  private readonly root: HTMLElement;
  private readonly songTitleEl: HTMLElement;
  private readonly songArtistEl: HTMLElement;
  private readonly utatenLink: HTMLAnchorElement;
  private readonly furiganaButton: HTMLButtonElement;
  private readonly collapseButton: HTMLButtonElement;
  private readonly titleInput: HTMLInputElement;
  private readonly artistInput: HTMLInputElement;
  private readonly swapButton: HTMLButtonElement;
  private readonly body: HTMLElement;
  private readonly callbacks: PanelCallbacks;
  private currentQuery: SongQuery = { title: '', artist: '' };

  constructor(callbacks: PanelCallbacks) {
    this.callbacks = callbacks;

    this.root = el('section', { className: 'yls-panel yls-hide-furigana' });
    this.root.id = PANEL_ID;

    const header = el('div', { className: 'yls-header' });

    const headerTop = el('div', { className: 'yls-header-top' });

    const song = el('div', { className: 'yls-song' });
    this.songTitleEl = el('span', { className: 'yls-song-title', text: '歌詞' });
    this.songArtistEl = el('span', { className: 'yls-song-artist' });
    song.append(this.songTitleEl, this.songArtistEl);

    this.collapseButton = el('button', { className: 'yls-icon-btn yls-collapse' });
    this.collapseButton.type = 'button';
    this.collapseButton.addEventListener('click', () => {
      void this.toggleCollapsed();
    });
    headerTop.append(song, this.collapseButton);

    const controls = el('div', { className: 'yls-controls' });

    const refreshButton = el('button', { className: 'yls-btn', text: '↻ 更新' });
    refreshButton.type = 'button';
    refreshButton.title = '保存した検索ワードを破棄し、再生中の曲情報をページから再取得';
    refreshButton.addEventListener('click', () => {
      this.callbacks.onRefresh();
    });

    this.furiganaButton = el('button', { className: 'yls-btn', text: 'ふりがな' });
    this.furiganaButton.type = 'button';
    this.furiganaButton.addEventListener('click', () => {
      void this.toggleFurigana();
    });

    const researchButton = el('button', { className: 'yls-btn', text: '再検索' });
    researchButton.type = 'button';
    researchButton.addEventListener('click', () => {
      this.callbacks.onSearch(this.readInputs());
    });

    this.utatenLink = el('a', { className: 'yls-btn yls-link', text: '元ページ' });
    this.utatenLink.target = '_blank';
    this.utatenLink.rel = 'noopener noreferrer';
    this.utatenLink.hidden = true;

    controls.append(refreshButton, this.furiganaButton, researchButton, this.utatenLink);

    const form = el('form', { className: 'yls-search' });
    this.titleInput = el('input', { className: 'yls-input' });
    this.titleInput.type = 'text';
    this.titleInput.placeholder = '曲名';

    this.swapButton = el('button', { className: 'yls-icon-btn yls-swap', text: '⇄' });
    this.swapButton.type = 'button';
    this.swapButton.title = '曲名と歌手名を入れ替えて再検索';
    this.swapButton.setAttribute('aria-label', '曲名と歌手名を入れ替えて再検索');
    this.swapButton.addEventListener('click', () => {
      this.swapFields();
    });

    this.artistInput = el('input', { className: 'yls-input' });
    this.artistInput.type = 'text';
    this.artistInput.placeholder = '歌手名';
    const submit = el('button', { className: 'yls-btn yls-btn-primary', text: '検索' });
    submit.type = 'submit';
    form.append(this.titleInput, this.swapButton, this.artistInput, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.callbacks.onSearch(this.readInputs());
    });

    header.append(headerTop, controls, form);

    this.body = el('div', { className: 'yls-body' });

    this.root.append(header, this.body);

    this.setCollapsed(false); // Sets the icon/aria before the stored value loads.
    void this.loadFuriganaPreference();
    void this.loadCollapsePreference();
  }

  /** Inserts the panel at the top of the given container if not already mounted. */
  mount(container: HTMLElement): void {
    if (!container.contains(this.root)) {
      container.prepend(this.root);
    }
  }

  /** Sets the "view original" link, but only for the expected utaten origin. */
  private setUtatenLink(lyricUrl: string): void {
    try {
      if (new URL(lyricUrl).origin === 'https://utaten.com') {
        this.utatenLink.href = lyricUrl;
        this.utatenLink.hidden = false;
        return;
      }
    } catch {
      // Malformed URL — fall through to hiding the link.
    }
    this.utatenLink.hidden = true;
  }

  setLoading(query: SongQuery): void {
    this.applyQuery(query);
    this.utatenLink.hidden = true;
    this.renderStatus('歌詞を検索中…');
  }

  /** Clears stale lyrics and shows a transient status while the next song loads. */
  setBusy(message: string): void {
    this.songTitleEl.textContent = '歌詞';
    this.songArtistEl.textContent = '';
    this.utatenLink.hidden = true;
    this.renderStatus(message);
  }

  setLyric(titleText: string, fragment: DocumentFragment, lyricUrl: string): void {
    if (titleText) {
      this.songTitleEl.textContent = titleText;
    }
    this.setUtatenLink(lyricUrl);

    clear(this.body);
    const lyric = el('div', { className: 'yls-lyric' });
    lyric.appendChild(fragment);
    this.body.appendChild(lyric);
  }

  setNotFound(query: SongQuery): void {
    this.applyQuery(query);
    this.utatenLink.hidden = true;
    this.renderStatus('歌詞が見つかりませんでした。曲名・歌手名を修正して再検索できます。');
  }

  setError(message: string): void {
    this.utatenLink.hidden = true;
    this.renderStatus(message);
  }

  private renderStatus(message: string): void {
    clear(this.body);
    this.body.appendChild(el('p', { className: 'yls-status', text: message }));
  }

  private applyQuery(query: SongQuery): void {
    this.currentQuery = query;
    this.songTitleEl.textContent = query.title || '歌詞';
    this.songArtistEl.textContent = query.artist;
    this.titleInput.value = query.title;
    this.artistInput.value = query.artist;
  }

  private readInputs(): SongQuery {
    return {
      title: this.titleInput.value.trim() || this.currentQuery.title,
      artist: this.artistInput.value.trim() || this.currentQuery.artist,
    };
  }

  /**
   * Swaps the title and artist fields (inputs and the fallback `currentQuery`)
   * then re-runs the search. Both must move together so `readInputs`'s
   * empty-field fallback stays consistent with what the user sees.
   */
  private swapFields(): void {
    const swapped = swapSongQuery(this.readInputs());
    this.currentQuery = swapped;
    this.titleInput.value = swapped.title;
    this.artistInput.value = swapped.artist;
    this.callbacks.onSearch(swapped);
  }

  private async loadFuriganaPreference(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(FURIGANA_STORAGE_KEY);
      this.setFurigana(stored[FURIGANA_STORAGE_KEY] === true);
    } catch {
      this.setFurigana(false); // Default to kanji-only; non-fatal.
    }
  }

  private async toggleFurigana(): Promise<void> {
    const next = this.root.classList.contains('yls-hide-furigana');
    this.setFurigana(next);
    try {
      await chrome.storage.local.set({ [FURIGANA_STORAGE_KEY]: next });
    } catch {
      // Preference is non-critical; ignore persistence failures.
    }
  }

  private setFurigana(show: boolean): void {
    this.root.classList.toggle('yls-hide-furigana', !show);
    this.furiganaButton.classList.toggle('yls-btn-active', show);
  }

  private async loadCollapsePreference(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(COLLAPSE_STORAGE_KEY);
      this.setCollapsed(stored[COLLAPSE_STORAGE_KEY] === true);
    } catch {
      this.setCollapsed(false); // Default to expanded; non-fatal.
    }
  }

  private async toggleCollapsed(): Promise<void> {
    const next = !this.root.classList.contains('yls-collapsed');
    this.setCollapsed(next);
    try {
      await chrome.storage.local.set({ [COLLAPSE_STORAGE_KEY]: next });
    } catch {
      // Preference is non-critical; ignore persistence failures.
    }
  }

  private setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle('yls-collapsed', collapsed);
    this.collapseButton.textContent = collapsed ? '▸' : '▾';
    this.collapseButton.setAttribute('aria-expanded', String(!collapsed));
    this.collapseButton.setAttribute(
      'aria-label',
      collapsed ? '歌詞パネルを展開' : '歌詞パネルを格納',
    );
  }
}
