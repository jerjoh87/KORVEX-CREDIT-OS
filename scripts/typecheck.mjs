import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const jsFiles = [
  'server.js',
  'instrument.js',
  'lib/billing.js',
  'routes/ai.js',
  'routes/credits.js',
  'routes/creditApi.js',
];

const htmlFiles = [
  'app.html',
  'index.html',
];

function runCheck(file) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  return {
    ok: result.status === 0,
    stderr: (result.stderr || '').trim(),
  };
}

function extractScripts(htmlPath, tempDir) {
  const html = readFileSync(htmlPath, 'utf8');
  const scripts = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    const script = match[1].trim();
    if (script) scripts.push(script);
  }
  return scripts.map((script, idx) => {
    const out = join(tempDir, `${htmlPath.replace(/[\\/]/g, '_')}-${idx}.mjs`);
    writeFileSync(out, script, 'utf8');
    return out;
  });
}

console.log('CREDITOS typecheck');

let failed = false;
for (const file of jsFiles) {
  const result = runCheck(file);
  if (result.ok) {
    console.log(`[pass] ${file}`);
  } else {
    failed = true;
    console.log(`[fail] ${file}`);
    if (result.stderr) console.log(result.stderr);
  }
}

const tempDir = mkdtempSync(join(tmpdir(), 'creditos-typecheck-'));
try {
  for (const file of htmlFiles) {
    const scriptFiles = extractScripts(file, tempDir);
    if (!scriptFiles.length) {
      console.log(`[na] ${file} contains no inline scripts`);
      continue;
    }
    for (const scriptFile of scriptFiles) {
      const result = runCheck(scriptFile);
      if (result.ok) {
        console.log(`[pass] ${file} inline script`);
      } else {
        failed = true;
        console.log(`[fail] ${file} inline script`);
        if (result.stderr) console.log(result.stderr);
      }
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('Typecheck complete');
}
