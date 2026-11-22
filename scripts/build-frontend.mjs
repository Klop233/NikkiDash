import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaSrc = path.join(root, 'schema', 'nikki-schema.json');
const schemaDst = path.join(root, 'package', 'nikki-dash', 'files', 'usr', 'share', 'nikki-dash', 'schema.json');
const wwwDir = path.join(root, 'package', 'nikki-dash', 'files', 'www', 'nikki-dash');

console.log('[build-frontend] Syncing schema/nikki-schema.json -> package files...');
copyFileSync(schemaSrc, schemaDst);

console.log('[build-frontend] Building Preact + Vite SPA...');
execSync('npm run build', { cwd: path.join(root, 'frontend'), stdio: 'inherit' });

if (!existsSync(path.join(wwwDir, 'index.html'))) {
  throw new Error('Build output index.html is missing');
}

// Verify zero external CDN URLs and zero node_modules leaked into www bundle
const walk = (dir) => {
  let list = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) list = list.concat(walk(p));
    else list.push(p);
  }
  return list;
};

const files = walk(wwwDir);
let totalBytes = 0;
for (const f of files) {
  if (f.includes('node_modules')) {
    throw new Error(`Unexpected node_modules file in build output: ${f}`);
  }
  const st = statSync(f);
  totalBytes += st.size;
  if (/\.(html|js|css)$/.test(f)) {
    const text = readFileSync(f, 'utf8');
    const forbidden = /(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)/i;
    if (forbidden.test(text)) {
      throw new Error(`Forbidden external CDN reference found in ${f}`);
    }
  }
}

console.log(`[build-frontend] OK: ${files.length} files, ${(totalBytes / 1024).toFixed(1)} KiB total in ${wwwDir}`);
