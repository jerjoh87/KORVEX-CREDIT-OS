import { existsSync, statSync } from 'node:fs';

const requiredPaths = [
  'app.html',
  'index.html',
  'server.js',
  'routes',
  'lib',
  'supabase',
];

let failed = false;

console.log('CREDITOS build check');

for (const path of requiredPaths) {
  if (!existsSync(path)) {
    failed = true;
    console.log(`[fail] Missing required path: ${path}`);
    continue;
  }
  const stats = statSync(path);
  console.log(`[pass] Found ${path}${stats.isDirectory() ? ' (directory)' : ''}`);
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('Launch build check complete');
}
