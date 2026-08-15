import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npmCommand, ['run', 'dev', '-w', 'server'], { stdio: 'inherit' }),
  spawn(npmCommand, ['run', 'dev', '-w', 'client'], { stdio: 'inherit' })
];

let shuttingDown = false;
const stop = code => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 250);
};

for (const child of children) {
  child.on('exit', code => {
    if (!shuttingDown && code) stop(code);
  });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
