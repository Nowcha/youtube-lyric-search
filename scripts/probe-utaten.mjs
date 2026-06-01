// Standalone probe: replicates the service worker's search→lyric fetch path
// against the LIVE utaten.com, to verify the network/parse path outside Chrome.
// Usage: node scripts/probe-utaten.mjs "<title>" "<artist>"

const ORIGIN = 'https://utaten.com';
const LYRIC_PATH = /\/lyric\/[a-z0-9]+\//i;

function buildSearchUrl(title, artist) {
  const params = new URLSearchParams({ title, artist_name: artist, sort: 'popular_sort_asc' });
  return `${ORIGIN}/search?${params.toString().replace(/\+/g, '%20')}`;
}

function extractFirstLyricPath(html) {
  const start = html.indexOf('searchResult');
  const scope = start >= 0 ? html.slice(start) : html;
  const m = LYRIC_PATH.exec(scope);
  return m ? m[0] : null;
}

async function fetchText(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function probe(title, artist) {
  const searchUrl = buildSearchUrl(title, artist);
  console.log(`\n=== query: title="${title}" artist="${artist}"`);
  console.log('searchUrl:', searchUrl);
  try {
    const searchHtml = await fetchText(searchUrl);
    console.log('search status: OK, bytes=', searchHtml.length);
    const path = extractFirstLyricPath(searchHtml);
    console.log('first lyric path:', path);
    if (!path) {
      // show the first displayed result title if any, for insight
      const m = searchHtml.match(/searchResult__title[\s\S]{0,200}/);
      console.log('no path. result snippet:', m ? m[0].replace(/\s+/g, ' ').slice(0, 160) : 'none');
      return;
    }
    const lyricHtml = await fetchText(`${ORIGIN}${path}`);
    const titleMatch = lyricHtml.match(/newLyricTitle__main">\s*([^<]+)/);
    const hasBody = /lyricBody/.test(lyricHtml) && /class="hiragana"/.test(lyricHtml);
    console.log('lyric page title:', titleMatch ? titleMatch[1].trim() : '(?)');
    console.log('has lyric body:', hasBody, '| bytes=', lyricHtml.length);
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

const [, , t, a] = process.argv;
if (t) {
  await probe(t, a ?? '');
} else {
  await probe('いのちの食べ方', 'Eve');
  await probe('セレナーデ', 'なとり');
  await probe('Pretender', 'Official髭男dism');
}
