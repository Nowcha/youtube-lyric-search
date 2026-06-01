import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'YouTube Lyric Search (utaten)',
  version: pkg.version,
  description: pkg.description,
  permissions: ['storage'],
  host_permissions: ['https://utaten.com/*'],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://www.youtube.com/*'],
      js: ['src/content/content-script.ts'],
      run_at: 'document_idle',
    },
  ],
  action: {
    default_title: 'YouTube Lyric Search',
  },
});
