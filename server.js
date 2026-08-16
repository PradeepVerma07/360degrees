import fs from 'node:fs';

if (fs.existsSync(new URL('./server/dist/index.js', import.meta.url))) {
  await import('./server/dist/index.js');
} else {
  await import('./server/src/index.js');
}
