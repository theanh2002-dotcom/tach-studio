import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const spawnOptions = {
  stdio: 'inherit',
  shell: process.platform === 'win32'
};
const children = [
  spawn(npmCommand, ['run', 'start:api'], spawnOptions),
  spawn(npmCommand, ['run', 'start:frontend'], spawnOptions)
];

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    child.kill();
  }
  process.exit(exitCode);
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!stopping && code !== 0) {
      stop(code ?? 1);
    }
  });
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
