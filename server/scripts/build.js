import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const projectRoot = path.resolve(serverRoot, '..');
const srcDir = path.join(serverRoot, 'src');
const distDir = path.join(serverRoot, 'dist');
const clientDist = path.join(projectRoot, 'client', 'dist');

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });
fs.cpSync(srcDir, distDir, { recursive: true });
if (!fs.existsSync(path.join(clientDist, 'index.html'))) {
  throw new Error('Client build not found. Run the root build command so the client builds first.');
}
fs.cpSync(clientDist, path.join(distDir, 'public'), { recursive: true });
fs.cpSync(clientDist, path.join(serverRoot, 'public'), { recursive: true });
fs.cpSync(clientDist, path.join(srcDir, 'public'), { recursive: true });

// Trigger Phusion Passenger / Hostinger automatic application reload
const restartDirs = [projectRoot, serverRoot];
for (const dir of restartDirs) {
  const tmpDir = path.join(dir, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'restart.txt'), new Date().toISOString());
}

console.log('Server build created at server/dist and static assets deployed (touched tmp/restart.txt)');
