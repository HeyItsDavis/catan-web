// `npm run e2e:pages`: run the subpath (GitHub Pages-like) e2e against a production build.
// (A tiny wrapper so the env var works on every OS without extra dependencies.)
import { spawnSync } from 'node:child_process';

const res = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, E2E_PAGES: '1' },
});
process.exit(res.status ?? 1);
