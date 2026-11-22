import {
  existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync
} from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'package', 'nikki-dash');
const filesDir = path.join(pkgDir, 'files');
const distDir = path.join(root, 'dist');

// Read metadata from OpenWrt Makefile
const makefile = readFileSync(path.join(pkgDir, 'Makefile'), 'utf8');
const getMakeVar = (name, fallback = '') => {
  const m = makefile.match(new RegExp(`^${name}:=\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : fallback;
};

const pkgName = getMakeVar('PKG_NAME', 'nikki-dash');
const pkgVersion = getMakeVar('PKG_VERSION', '0.1.0');
const pkgRelease = getMakeVar('PKG_RELEASE', '1');
const pkgArch = getMakeVar('PKGARCH', 'all') || 'all';
const fullVersion = `${pkgVersion}-r${pkgRelease}`;

const execPaths = new Set([
  'etc/init.d/nikki-dash',
  'usr/libexec/nikki-dash/worker.uc',
  'usr/libexec/nikki-dash/netcheck.uc',
  'usr/libexec/nikki-dash/netprobe.uc',
  'usr/libexec/nikki-dash/revoke_guest.uc'
]);

const textExts = /\.(uc|sh|json|html|css|js|yaml|yml|txt|md)$/i;

function normalizeLf(buf, relPath) {
  if (
    textExts.test(relPath) ||
    relPath.startsWith('etc/config/') ||
    relPath.startsWith('etc/init.d/') ||
    relPath.startsWith('usr/share/rpcd/ucode/')
  ) {
    return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  }
  return buf;
}

function createTarHeader(name, size, mode, typeflag, mtime = 1763800000) {
  const hdr = Buffer.alloc(512, 0);
  const nameBuf = Buffer.from(name, 'utf8');
  if (nameBuf.length > 100) {
    throw new Error(`TAR path too long (>100 bytes): ${name}`);
  }
  nameBuf.copy(hdr, 0);
  Buffer.from(mode.toString(8).padStart(7, '0') + '\0').copy(hdr, 100);
  Buffer.from('0000000\0').copy(hdr, 108); // uid 0
  Buffer.from('0000000\0').copy(hdr, 116); // gid 0
  Buffer.from(size.toString(8).padStart(11, '0') + '\0').copy(hdr, 124);
  Buffer.from(mtime.toString(8).padStart(11, '0') + '\0').copy(hdr, 136);
  Buffer.from('        ').copy(hdr, 148); // checksum placeholder
  hdr[156] = typeflag.charCodeAt(0);
  Buffer.from('ustar\0').copy(hdr, 257);
  Buffer.from('00').copy(hdr, 263);
  Buffer.from('root').copy(hdr, 265);
  Buffer.from('root').copy(hdr, 297);

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += hdr[i];
  Buffer.from(sum.toString(8).padStart(6, '0') + '\0 ').copy(hdr, 148);
  return hdr;
}

function buildTar(entries) {
  const chunks = [];
  for (const e of entries) {
    chunks.push(createTarHeader(e.name, e.data.length, e.mode, e.typeflag));
    if (e.data.length > 0) {
      chunks.push(e.data);
      const pad = (512 - (e.data.length % 512)) % 512;
      if (pad > 0) chunks.push(Buffer.alloc(pad, 0));
    }
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

function collectFiles(baseDir, relPrefix = '') {
  const entries = [];
  const names = readdirSync(baseDir).sort();
  for (const name of names) {
    if (name === '.gitkeep') continue;
    const full = path.join(baseDir, name);
    const rel = relPrefix ? `${relPrefix}/${name}` : name;
    const st = statSync(full);
    if (st.isDirectory()) {
      entries.push({ name: `./${rel}/`, mode: 0o755, typeflag: '5', data: Buffer.alloc(0) });
      entries.push(...collectFiles(full, rel));
    } else {
      const raw = readFileSync(full);
      const data = normalizeLf(raw, rel);
      const mode = execPaths.has(rel) ? 0o755 : 0o644;
      entries.push({ name: `./${rel}`, mode, typeflag: '0', data });
    }
  }
  return entries;
}

if (!existsSync(path.join(filesDir, 'www', 'nikki-dash', 'index.html'))) {
  throw new Error('Frontend build missing! Run `node scripts/build-frontend.mjs` first.');
}

const dataEntries = [
  { name: './', mode: 0o755, typeflag: '5', data: Buffer.alloc(0) },
  ...collectFiles(filesDir)
];

const installedSize = dataEntries.reduce((acc, e) => acc + e.data.length, 0);
const dataTarGz = gzipSync(buildTar(dataEntries), { level: 9 });

const controlText = [
  `Package: ${pkgName}`,
  `Version: ${fullVersion}`,
  'Depends: rpcd, rpcd-mod-ucode, uhttpd, uhttpd-mod-ubus, curl, yq, ucode, ucode-mod-fs, ucode-mod-uci, ucode-mod-ubus, ucode-mod-math',
  'Section: net',
  'Architecture: all',
  `Installed-Size: ${installedSize}`,
  'Maintainer: Klop233',
  'License: MIT',
  'URL: https://github.com/Klop233/NikkiDash',
  'Description: Standalone modern Clash-inspired web dashboard for Nikki (Mihomo) on OpenWrt >=24.10 with integrated Nikki core management.',
  ''
].join('\n');

const conffilesText = '/etc/config/nikki_dash\n';

const postinstText = `#!/bin/sh
[ -n "\${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/rpcd reload >/dev/null 2>&1 || /etc/init.d/rpcd restart >/dev/null 2>&1 || true
/etc/init.d/nikki-dash enable >/dev/null 2>&1 || true
/etc/init.d/nikki-dash restart >/dev/null 2>&1 || true
exit 0
`;

const prermText = `#!/bin/sh
[ -n "\${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/nikki-dash stop >/dev/null 2>&1 || true
/etc/init.d/nikki-dash disable >/dev/null 2>&1 || true
if uci -q get rpcd.nikki_dash_guest >/dev/null 2>&1; then
\tuci -q delete rpcd.nikki_dash_guest
\tuci -q commit rpcd
\t/etc/init.d/rpcd reload >/dev/null 2>&1 || true
fi
exit 0
`;

const controlEntries = [
  { name: './', mode: 0o755, typeflag: '5', data: Buffer.alloc(0) },
  { name: './control', mode: 0o644, typeflag: '0', data: Buffer.from(controlText, 'utf8') },
  { name: './conffiles', mode: 0o644, typeflag: '0', data: Buffer.from(conffilesText, 'utf8') },
  { name: './postinst', mode: 0o755, typeflag: '0', data: Buffer.from(postinstText, 'utf8') },
  { name: './prerm', mode: 0o755, typeflag: '0', data: Buffer.from(prermText, 'utf8') }
];

const controlTarGz = gzipSync(buildTar(controlEntries), { level: 9 });
const debianBinary = Buffer.from('2.0\n', 'utf8');

// OpenWrt opkg .ipk uses standard gzipped tar outer container (modern OpenWrt opkg format)
const outerTar = buildTar([
  { name: './debian-binary', mode: 0o644, typeflag: '0', data: debianBinary },
  { name: './data.tar.gz', mode: 0o644, typeflag: '0', data: dataTarGz },
  { name: './control.tar.gz', mode: 0o644, typeflag: '0', data: controlTarGz }
]);

const ipkBuf = gzipSync(outerTar, { level: 9 });
mkdirSync(distDir, { recursive: true });
const ipkFilename = `${pkgName}_${fullVersion}_${pkgArch}.ipk`;
const ipkPath = path.join(distDir, ipkFilename);
writeFileSync(ipkPath, ipkBuf);

const sha256 = createHash('sha256').update(ipkBuf).digest('hex');
writeFileSync(path.join(distDir, 'SHA256SUMS'), `${sha256}  ${ipkFilename}\n`, 'utf8');

console.log(`[build-ipk] Built ${ipkPath} (${(ipkBuf.length / 1024).toFixed(1)} KiB, sha256=${sha256})`);
