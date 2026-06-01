// Automated E2E probe: launches the user's installed Chrome with the built
// extension loaded, navigates to YouTube watch pages, and reports what the
// extension detected (console [YLS] logs + the injected panel state).
//
// Usage:
//   npm run build
//   node scripts/run-extension-test.mjs [<youtube watch url> ...]

import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distPath = path.join(root, 'dist');
const profilePath = path.join(root, '.pw-profile');

const DEFAULT_URLS = [
  'https://www.youtube.com/watch?v=U7L-3VXAkSA', // Eve - いのちの食べ方 (from user logs)
  'https://www.youtube.com/watch?v=SEABn1jepkY', // なとり - セレナーデ (from user logs)
];
const urls = process.argv.slice(2).filter((a) => a.startsWith('http'));
const targets = urls.length ? urls : DEFAULT_URLS;

async function dismissConsent(page) {
  const labels = ['すべて同意', 'すべて承諾', '同意する', 'Accept all', 'I agree', 'Reject all'];
  for (const label of labels) {
    const button = page.locator(`button:has-text("${label}")`).first();
    if (await button.count().catch(() => 0)) {
      await button.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

const context = await chromium.launchPersistentContext(profilePath, {
  headless: false,
  viewport: null,
  args: [
    `--disable-extensions-except=${distPath}`,
    `--load-extension=${distPath}`,
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

context.on('console', (msg) => {
  const text = msg.text();
  if (text.includes('[YLS]')) {
    console.log('  CTX-LOG>', text);
  }
});

const page = context.pages()[0] ?? (await context.newPage());

// Confirm the extension actually loaded by inspecting its service worker.
await page.waitForTimeout(1500);
console.log(
  'service workers:',
  context.serviceWorkers().map((w) => w.url()),
);

page.on('console', (msg) => {
  const text = msg.text();
  if (text.includes('[YLS]')) {
    console.log('  PAGE-LOG>', text);
  }
});
page.on('pageerror', (err) => console.log('  PAGEERROR>', err.message));

for (const url of targets) {
  console.log('\n================ NAV:', url);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await dismissConsent(page);
    await page.locator('video').click({ timeout: 2000 }).catch(() => {});

    // Poll the mount state over time to catch a mount-then-detach pattern.
    for (let i = 0; i < 9; i += 1) {
      await page.waitForTimeout(2000);
      const state = await page.evaluate(() => ({
        secondaryInner: Boolean(document.querySelector('#secondary-inner')),
        panel: Boolean(document.querySelector('#yls-lyric-panel')),
        panelConnected: document.querySelector('#yls-lyric-panel')?.isConnected ?? false,
      }));
      console.log(`  t+${(i + 1) * 2}s`, JSON.stringify(state));
    }

    const report = await page.evaluate(() => {
      const panel = document.querySelector('#yls-lyric-panel');
      const ms = navigator.mediaSession?.metadata ?? null;
      const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
      return {
        docTitle: document.title,
        pageWorldMediaSession: ms ? { title: ms.title, artist: ms.artist, album: ms.album } : null,
        domTitle: text('h1.ytd-watch-metadata yt-formatted-string') ?? text('h1.ytd-watch-metadata'),
        domChannel:
          text('ytd-channel-name#channel-name a') ?? text('#owner ytd-channel-name a'),
        panel: panel
          ? {
              title: panel.querySelector('.yls-song-title')?.textContent ?? null,
              artist: panel.querySelector('.yls-song-artist')?.textContent ?? null,
              body: (panel.querySelector('.yls-body')?.textContent ?? '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 120),
            }
          : 'NOT MOUNTED',
      };
    });
    console.log('  REPORT>', JSON.stringify(report, null, 2));
  } catch (error) {
    console.log('  NAV ERROR>', error instanceof Error ? error.message : String(error));
  }
}

// SPA navigation test: click a related video and confirm the panel follows.
console.log('\n================ SPA NAV TEST (click a related video)');
const beforeUrl = page.url();
await page.evaluate(() => window.scrollTo(0, 1600));
await page.waitForTimeout(3000);
// Click an in-page related-video anchor directly so YouTube's SPA router handles
// it (a real Playwright click is fragile against YouTube's overlays/href formats).
const targetHref = await page.evaluate(() => {
  const current = new URLSearchParams(location.search).get('v');
  for (const a of document.querySelectorAll('a[href*="/watch?v="]')) {
    const match = (a.getAttribute('href') ?? '').match(/[?&]v=([^&]+)/);
    if (match && match[1] !== current && a instanceof HTMLElement) {
      a.click();
      return a.getAttribute('href');
    }
  }
  return null;
});
console.log('  clicked related href:', targetHref);

// Timeline: observe document.title vs the DOM h1 vs the panel after SPA nav,
// to detect lag between metadata sources during the transition.
for (let i = 0; i < 14; i += 1) {
  await page.waitForTimeout(1000);
  const snap = await page.evaluate(() => {
    const panel = document.querySelector('#yls-lyric-panel');
    return {
      v: new URLSearchParams(location.search).get('v'),
      docTitle: document.title.replace(/\s*-\s*YouTube\s*$/, ''),
      h1: (
        document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ??
        document.querySelector('h1.ytd-watch-metadata')
      )?.textContent?.trim(),
      panelTitle: panel?.querySelector('.yls-song-title')?.textContent ?? 'NONE',
    };
  });
  console.log(`  t+${i + 1}s`, JSON.stringify(snap));
}
console.log('  urlChanged:', beforeUrl !== page.url());

await context.close();
console.log('\nDone.');
