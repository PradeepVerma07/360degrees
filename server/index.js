import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const distTarget = path.resolve(here, 'dist/index.js');
const srcTarget = path.resolve(here, 'src/index.js');

if (fs.existsSync(distTarget)) {
  await import(distTarget);
} else {
  await import(srcTarget);
}
