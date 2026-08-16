import fs from 'node:fs';

const mod = fs.existsSync(new URL('./server/dist/index.js', import.meta.url))
  ? await import('./server/dist/index.js')
  : await import('./server/src/index.js');

export const app = mod.app || mod.default;
export const httpServer = mod.httpServer;
export default mod.default || mod.app;
