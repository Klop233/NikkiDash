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

const makefile = readFileSync(path.join(pkgDir, 'Makefile'), 'utf8');
const getMakeVar = (name, fallback = '') => {
  const m = makefile.match(new RegExp(`^${name}:=\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : fallback;
};

const pkgName = getMakeVar('PKG_NAME', 'nikki-dash');
const pkgVersion = getMakeVar('PKG_VERSION', '0.2.0');
const pkgRelease = getMakeVar('PKG_RELEASE', '1');
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
  Buffer.from('0000000\0').copy(hdr, 108);
  Buffer.from('0000000\0').copy(hdr, 116);
  Buffer.from(size.toString(8).padStart(11, '0') + '\0').copy(hdr, 124);
  Buffer.from(mtime.toString(8).padStart(11, '0') + '\0').copy(hdr, 136);
  Buffer.from('        ').copy(hdr, 148);
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

function makePaxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let len = body.length + 1;
  while (String(len).length + body.length !== len) {
    len = String(len).length + body.length;
  }
  return Buffer.from(`${len}${body}`, 'utf8');
}

function buildTar(entries, withEof = true, withApkChecksum = false) {
  const chunks = [];
  for (const e of entries) {
    if (withApkChecksum && e.typeflag === '0') {
      const sha1 = createHash('sha1').update(e.data).digest('hex');
      const paxData = makePaxRecord('APK-TOOLS.checksum.SHA1', sha1);
      const paxName = `PaxHeaders/${path.posix.basename(e.name)}`.slice(0, 99);
      chunks.push(createTarHeader(paxName, paxData.length, 0o644, 'x'));
      chunks.push(paxData);
      const paxPad = (512 - (paxData.length % 512)) % 512;
      if (paxPad > 0) chunks.push(Buffer.alloc(paxPad, 0));
    }
    chunks.push(createTarHeader(e.name, e.data.length, e.mode, e.typeflag));
    if (e.data.length > 0) {
      chunks.push(e.data);
      const pad = (512 - (e.data.length % 512)) % 512;
      if (pad > 0) chunks.push(Buffer.alloc(pad, 0));
    }
  }
  if (withEof) {
    chunks.push(Buffer.alloc(1024, 0));
  }
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
      entries.push({ name: `${rel}/`, mode: 0o755, typeflag: '5', data: Buffer.alloc(0) });
      entries.push(...collectFiles(full, rel));
    } else {
      const raw = readFileSync(full);
      const data = normalizeLf(raw, rel);
      const mode = execPaths.has(rel) ? 0o755 : 0o644;
      entries.push({ name: rel, mode, typeflag: '0', data });
    }
  }
  return entries;
}

if (!existsSync(path.join(filesDir, 'www', 'nikki-dash', 'index.html'))) {
  throw new Error('Frontend build missing! Run `node scripts/build-frontend.mjs` first.');
}

const dataEntries = collectFiles(filesDir);
const installedSize = dataEntries.reduce((acc, e) => acc + e.data.length, 0);
const dataTarGz = gzipSync(buildTar(dataEntries, true, true), { level: 9 });
const dataHash = createHash('sha256').update(dataTarGz).digest('hex');

const deps = [
  'rpcd',
  'rpcd-mod-ucode',
  'uhttpd',
  'uhttpd-mod-ubus',
  'curl',
  'yq',
  'ucode',
  'ucode-mod-fs',
  'ucode-mod-uci',
  'ucode-mod-ubus',
  'ucode-mod-math'
];

const pkgInfoText = [
  `pkgname = ${pkgName}`,
  `pkgver = ${fullVersion}`,
  'pkgdesc = Standalone modern Clash-inspired web dashboard for Nikki (Mihomo) on OpenWrt >=24.10 with integrated Nikki core management',
  'url = https://github.com/Klop233/NikkiDash',
  'builddate = 1763800000',
  `size = ${installedSize}`,
  'arch = noarch',
  'license = MIT',
  ...deps.map((d) => `depend = ${d}`),
  `datahash = ${dataHash}`,
  ''
].join('\n');

const postInstallText = `#!/bin/sh
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache/* >/dev/null 2>&1 || true
if [ -S /var/run/ubus/ubus.sock ] && [ -x /etc/init.d/nikki-dash ]; then
\t/etc/init.d/rpcd reload >/dev/null 2>&1 || /etc/init.d/rpcd restart >/dev/null 2>&1 || true
\t/etc/init.d/nikki-dash enable >/dev/null 2>&1 || true
\t/etc/init.d/nikki-dash restart >/dev/null 2>&1 || true
fi
exit 0
`;

const preDeinstallText = `#!/bin/sh
if [ -x /etc/init.d/nikki-dash ]; then
\t/etc/init.d/nikki-dash stop >/dev/null 2>&1 || true
\t/etc/init.d/nikki-dash disable >/dev/null 2>&1 || true
fi
if uci -q get rpcd.nikki_dash_guest >/dev/null 2>&1; then
\tuci -q delete rpcd.nikki_dash_guest
\tuci -q commit rpcd
\t/etc/init.d/rpcd reload >/dev/null 2>&1 || true
fi
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache/* >/dev/null 2>&1 || true
exit 0
`;

// APKv2 control stream MUST omit the trailing 1024-byte TAR EOF block so apk-tools 3 parses the concatenated data stream cleanly
const controlEntries = [
  { name: '.PKGINFO', mode: 0o644, typeflag: '0', data: Buffer.from(pkgInfoText, 'utf8') },
  { name: '.post-install', mode: 0o755, typeflag: '0', data: Buffer.from(postInstallText, 'utf8') },
  { name: '.pre-deinstall', mode: 0o755, typeflag: '0', data: Buffer.from(preDeinstallText, 'utf8') }
];

const controlTarGz = gzipSync(buildTar(controlEntries, false), { level: 9 });
const apkBuf = Buffer.concat([controlTarGz, dataTarGz]);

mkdirSync(distDir, { recursive: true });
const apkFilename = `${pkgName}-${fullVersion}.apk`;
const apkPath = path.join(distDir, apkFilename);
writeFileSync(apkPath, apkBuf);

// Rebuild SHA256SUMS for all .ipk and .apk artifacts in dist/
const artifacts = readdirSync(distDir)
  .filter((f) => /\.(ipk|apk)$/.test(f))
  .sort();
const sumLines = artifacts.map((f) => {
  const hash = createHash('sha256').update(readFileSync(path.join(distDir, f))).digest('hex');
  return `${hash}  ${f}`;
});
writeFileSync(path.join(distDir, 'SHA256SUMS'), sumLines.join('\n') + '\n', 'utf8');

const sha256 = createHash('sha256').update(apkBuf).digest('hex');
console.log(`[build-apk] Built ${apkPath} (${(apkBuf.length / 1024).toFixed(1)} KiB, sha256=${sha256})`);
