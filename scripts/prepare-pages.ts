import { copyFile, writeFile } from 'node:fs/promises';

// The shared arena is the first page judges see at /boss_forge/.
await copyFile(new URL('../dist/pages/play/index.html', import.meta.url), new URL('../dist/pages/index.html', import.meta.url));
await writeFile(new URL('../dist/pages/.nojekyll', import.meta.url), '');
console.log('Judge arena ready in dist/pages. No server or API keys required.');
