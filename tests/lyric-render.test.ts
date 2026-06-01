import { describe, it, expect } from 'vitest';
import { parseLyricDocument, sanitizeLyricBody } from '../src/content/lyric-render';

function pageWith(bodyInner: string, title = 'Pretender'): string {
  return `<!doctype html><html><body>
    <h2 class="newLyricTitle__main">${title}</h2>
    <div class="lyricBody"><div class="hiragana">${bodyInner}</div></div>
  </body></html>`;
}

function elementWith(inner: string): Element {
  const host = document.createElement('div');
  host.innerHTML = inner;
  return host;
}

describe('parseLyricDocument', () => {
  it('extracts the title and a lyric fragment', () => {
    const parsed = parseLyricDocument(pageWith('君<br>とのラブストーリー'));
    expect(parsed).not.toBeNull();
    expect(parsed?.titleText).toBe('Pretender');
    const wrap = document.createElement('div');
    wrap.appendChild(parsed!.lyricFragment);
    expect(wrap.querySelectorAll('br').length).toBe(1);
    expect(wrap.textContent).toContain('君とのラブストーリー');
  });

  it('returns null when the lyric body is missing', () => {
    expect(parseLyricDocument('<html><body><p>nope</p></body></html>')).toBeNull();
  });

  it('converts utaten ruby spans into native <ruby> elements', () => {
    const parsed = parseLyricDocument(
      pageWith('<span class="ruby"><span class="rb">君</span><span class="rt">きみ</span></span>と'),
    );
    const wrap = document.createElement('div');
    wrap.appendChild(parsed!.lyricFragment);
    const ruby = wrap.querySelector('ruby');
    expect(ruby).not.toBeNull();
    expect(ruby?.querySelector('rt')?.textContent).toBe('きみ');
    expect(wrap.textContent).toContain('君');
    expect(wrap.textContent).toContain('と');
  });
});

describe('sanitizeLyricBody (XSS hardening)', () => {
  it('does not preserve <script> elements as executable markup', () => {
    const fragment = sanitizeLyricBody(elementWith('<script>alert(1)</script>safe'));
    const wrap = document.createElement('div');
    wrap.appendChild(fragment);
    expect(wrap.querySelector('script')).toBeNull();
    expect(wrap.textContent).toContain('safe');
  });

  it('strips event-handler attributes and dangerous tags, keeping text only', () => {
    const fragment = sanitizeLyricBody(
      elementWith('<img src=x onerror="alert(1)"><a href="javascript:alert(1)">link</a>'),
    );
    const wrap = document.createElement('div');
    wrap.appendChild(fragment);
    expect(wrap.querySelector('img')).toBeNull();
    expect(wrap.querySelector('a')).toBeNull();
    expect(wrap.innerHTML).not.toContain('onerror');
    expect(wrap.textContent).toContain('link');
  });

  it('keeps <br> line breaks', () => {
    const fragment = sanitizeLyricBody(elementWith('a<br>b'));
    const wrap = document.createElement('div');
    wrap.appendChild(fragment);
    expect(wrap.querySelectorAll('br').length).toBe(1);
  });
});
