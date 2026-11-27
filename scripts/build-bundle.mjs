import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync
} from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'package', 'nikki-dash');
const dashFilesDir = path.join(pkgDir, 'files');
const upstreamDir = path.join(root, 'upstream');
const nikkiDir = path.join(upstreamDir, 'nikki');
const versionsPath = path.join(upstreamDir, 'versions.json');
const cacheDir = path.join(root, '.cache', 'mihomo');
const distDir = path.join(root, 'dist');

const makefile = readFileSync(path.join(pkgDir, 'Makefile'), 'utf8');
const getMakeVar = (name, fallback = '') => {
  const m = makefile.match(new RegExp(`^${name}:=\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : fallback;
};

const pkgVersion = getMakeVar('PKG_VERSION', '0.8.0');
const pkgRelease = getMakeVar('PKG_RELEASE', '1');
const fullVersion = `${pkgVersion}-r${pkgRelease}`;

const dashExecPaths = new Set([
  'etc/init.d/nikki-dash',
  'usr/libexec/nikki-dash/worker.uc',
  'usr/libexec/nikki-dash/netcheck.uc',
  'usr/libexec/nikki-dash/netprobe.uc',
  'usr/libexec/nikki-dash/revoke_guest.uc'
]);

const textExts = /\.(uc|ut|sh|nft|json|html|css|js|yaml|yml|txt|md)$/i;

function normalizeLf(buf, relPath) {
  if (
    textExts.test(relPath) ||
    relPath.startsWith('etc/config/') ||
    relPath.startsWith('etc/init.d/') ||
    relPath.startsWith('usr/share/rpcd/ucode/') ||
    relPath.startsWith('lib/upgrade/keep.d/')
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

function collectFilesMap(baseDir, map, relPrefix = '') {
  const names = readdirSync(baseDir).sort();
  for (const name of names) {
    if (name === '.gitkeep') continue;
    const full = path.join(baseDir, name);
    const rel = relPrefix ? `${relPrefix}/${name}` : name;
    const st = statSync(full);
    if (st.isDirectory()) {
      map.set(`${rel}/`, { rel: `${rel}/`, mode: 0o755, typeflag: '5', data: Buffer.alloc(0) });
      collectFilesMap(full, map, rel);
    } else {
      const raw = readFileSync(full);
      const data = normalizeLf(raw, rel);
      const mode = dashExecPaths.has(rel) ? 0o755 : 0o644;
      map.set(rel, { rel, mode, typeflag: '0', data });
    }
  }
}

function ensureParents(map, fileRel) {
  const parts = fileRel.replace(/\/$/, '').split('/');
  const limit = fileRel.endsWith('/') ? parts.length : parts.length - 1;
  let cur = '';
  for (let i = 0; i < limit; i++) {
    cur = cur ? `${cur}/${parts[i]}` : parts[i];
    const dirKey = `${cur}/`;
    if (!map.has(dirKey)) {
      map.set(dirKey, { rel: dirKey, mode: 0o755, typeflag: '5', data: Buffer.alloc(0) });
    }
  }
}

function putFile(map, rel, data, mode) {
  ensureParents(map, rel);
  map.set(rel, { rel, mode, typeflag: '0', data });
}

function putDir(map, rel) {
  const key = rel.endsWith('/') ? rel : `${rel}/`;
  ensureParents(map, key);
  if (!map.has(key)) {
    map.set(key, { rel: key, mode: 0o755, typeflag: '5', data: Buffer.alloc(0) });
  }
}

async function fetchMihomoBinary(asset) {
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, asset.file);
  let gzBuf = null;

  if (existsSync(cachePath)) {
    const cached = readFileSync(cachePath);
    const sha = createHash('sha256').update(cached).digest('hex');
    if (sha === asset.sha256) {
      gzBuf = cached;
    } else {
      console.log(`[build-bundle] Cache checksum mismatch for ${asset.file}, re-downloading...`);
    }
  }

  if (!gzBuf) {
    console.log(`[build-bundle] Downloading ${asset.file}...`);
    const headers = { 'User-Agent': 'NikkiDash-Bundle-Builder/1.0' };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(asset.url, { headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} downloading ${asset.url}`);
    }
    gzBuf = Buffer.from(await res.arrayBuffer());
    const sha = createHash('sha256').update(gzBuf).digest('hex');
    if (sha !== asset.sha256) {
      throw new Error(`SHA256 mismatch for ${asset.file}: expected ${asset.sha256}, got ${sha}`);
    }
    writeFileSync(cachePath, gzBuf);
  }

  return gunzipSync(gzBuf);
}

function addNikkiUpstreamFiles(map) {
  const fileMappings = [
    { src: 'nikki.init', dst: 'etc/init.d/nikki', mode: 0o755 },
    // Ship Nikki default config & mixin as templates so installing nikki-dash-all NEVER clobbers an existing /etc/config/nikki!
    { src: 'nikki.conf', dst: 'usr/share/nikki-dash/defaults/nikki.conf', mode: 0o600 },
    { src: 'mixin.yaml', dst: 'usr/share/nikki-dash/defaults/mixin.yaml', mode: 0o644 },
    { src: 'nikki.upgrade', dst: 'lib/upgrade/keep.d/nikki', mode: 0o644 },
    { src: 'ucode/include.uc', dst: 'etc/nikki/ucode/include.uc', mode: 0o755 },
    { src: 'ucode/mixin.uc', dst: 'etc/nikki/ucode/mixin.uc', mode: 0o755 },
    { src: 'ucode/hijack.ut', dst: 'etc/nikki/ucode/hijack.ut', mode: 0o755 },
    { src: 'scripts/include.sh', dst: 'etc/nikki/scripts/include.sh', mode: 0o755 },
    { src: 'scripts/firewall_include.sh', dst: 'etc/nikki/scripts/firewall_include.sh', mode: 0o755 },
    { src: 'scripts/debug.sh', dst: 'etc/nikki/scripts/debug.sh', mode: 0o755 },
    { src: 'nftables/geoip_cn.nft', dst: 'etc/nikki/nftables/geoip_cn.nft', mode: 0o755 },
    { src: 'nftables/geoip6_cn.nft', dst: 'etc/nikki/nftables/geoip6_cn.nft', mode: 0o755 },
    { src: 'uci-defaults/firewall.sh', dst: 'usr/share/nikki-dash/nikki-defaults/99_firewall_nikki', mode: 0o755 },
    { src: 'uci-defaults/init.sh', dst: 'usr/share/nikki-dash/nikki-defaults/99_init_nikki', mode: 0o755 },
    { src: 'uci-defaults/migrate.sh', dst: 'usr/share/nikki-dash/nikki-defaults/99_migrate_nikki', mode: 0o755 }
  ];

  for (const item of fileMappings) {
    const full = path.join(nikkiDir, ...item.src.split('/'));
    if (!existsSync(full)) {
      throw new Error(`Missing upstream nikki file: ${full}. Run 'node scripts/sync-upstream.mjs' first.`);
    }
    const raw = readFileSync(full);
    const data = normalizeLf(raw, item.dst);
    putFile(map, item.dst, data, item.mode);
  }

  for (const dir of [
    'etc/nikki/profiles',
    'etc/nikki/subscriptions',
    'etc/nikki/run',
    'etc/nikki/run/providers',
    'etc/nikki/run/providers/rule',
    'etc/nikki/run/providers/proxy'
  ]) {
    putDir(map, dir);
  }
}

const BUNDLE_DEPS = [
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
  'ucode-mod-math',
  'ca-bundle',
  'firewall4',
  'ip-full',
  'kmod-inet-diag',
  'kmod-nft-socket',
  'kmod-nft-tproxy',
  'kmod-tun',
  'kmod-dummy'
];

const POST_INSTALL_BODY = `mkdir -p /etc/nikki/profiles /etc/nikki/subscriptions /etc/nikki/run/providers/rule /etc/nikki/run/providers/proxy
# Initialize /etc/config/nikki and /etc/nikki/mixin.yaml ONLY when absent so existing configs are never clobbered
if [ ! -f /etc/config/nikki ] && [ -f /usr/share/nikki-dash/defaults/nikki.conf ]; then
\tcp /usr/share/nikki-dash/defaults/nikki.conf /etc/config/nikki
\tchmod 600 /etc/config/nikki
\t[ -f /usr/share/nikki-dash/nikki-defaults/99_init_nikki ] && ( . /usr/share/nikki-dash/nikki-defaults/99_init_nikki ) >/dev/null 2>&1 || true
fi
if [ ! -f /etc/nikki/mixin.yaml ] && [ -f /usr/share/nikki-dash/defaults/mixin.yaml ]; then
\tcp /usr/share/nikki-dash/defaults/mixin.yaml /etc/nikki/mixin.yaml
\tchmod 644 /etc/nikki/mixin.yaml
fi
if ! uci -q get firewall.nikki >/dev/null 2>&1 && [ -f /usr/share/nikki-dash/nikki-defaults/99_firewall_nikki ]; then
\t( . /usr/share/nikki-dash/nikki-defaults/99_firewall_nikki ) >/dev/null 2>&1 || true
fi
if [ -f /etc/config/nikki ] && [ -f /usr/share/nikki-dash/nikki-defaults/99_migrate_nikki ]; then
\t( . /usr/share/nikki-dash/nikki-defaults/99_migrate_nikki ) >/dev/null 2>&1 || true
fi
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache/* >/dev/null 2>&1 || true
if [ -S /var/run/ubus/ubus.sock ] && [ -x /etc/init.d/nikki-dash ]; then
\t/etc/init.d/rpcd reload >/dev/null 2>&1 || /etc/init.d/rpcd restart >/dev/null 2>&1 || true
\t/etc/init.d/nikki-dash enable >/dev/null 2>&1 || true
\t/etc/init.d/nikki-dash restart >/dev/null 2>&1 || true
fi
exit 0
`;

const PRE_REMOVE_BODY = `if [ -x /etc/init.d/nikki-dash ]; then
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

function buildIpk(arch, sortedEntries, manifest) {
  const ipkEntries = [
    { name: './', mode: 0o755, typeflag: '5', data: Buffer.alloc(0) },
    ...sortedEntries.map((e) => ({ ...e, name: `./${e.rel}` }))
  ];
  const installedSize = sortedEntries.reduce((acc, e) => acc + e.data.length, 0);
  const dataTarGz = gzipSync(buildTar(ipkEntries, true, false), { level: 9 });

  const controlText = [
    'Package: nikki-dash-all',
    `Version: ${fullVersion}`,
    `Depends: ${BUNDLE_DEPS.join(', ')}`,
    'Provides: nikki, mihomo, nikki-dash',
    'Conflicts: nikki, mihomo-meta, mihomo-alpha, nikki-dash',
    'Replaces: nikki, mihomo-meta, mihomo-alpha, nikki-dash',
    'Section: net',
    `Architecture: ${arch}`,
    `Installed-Size: ${installedSize}`,
    'Maintainer: Klop233',
    'License: MIT AND GPL-3.0-or-later',
    'URL: https://github.com/Klop233/NikkiDash',
    `Description: All-in-one OpenWrt package bundling Nikki (${manifest.nikki.tag}) + Mihomo (${manifest.mihomo.tag}) + NikkiDash Web UI + LuCI Services entry.`,
    ''
  ].join('\n');

  const conffilesText = '/etc/config/nikki_dash\n';
  const postinstText = `#!/bin/sh\n[ -n "\${IPKG_INSTROOT}" ] && exit 0\n${POST_INSTALL_BODY}`;
  const prermText = `#!/bin/sh\n[ -n "\${IPKG_INSTROOT}" ] && exit 0\n${PRE_REMOVE_BODY}`;

  const controlEntries = [
    { name: './', mode: 0o755, typeflag: '5', data: Buffer.alloc(0) },
    { name: './control', mode: 0o644, typeflag: '0', data: Buffer.from(controlText, 'utf8') },
    { name: './conffiles', mode: 0o644, typeflag: '0', data: Buffer.from(conffilesText, 'utf8') },
    { name: './postinst', mode: 0o755, typeflag: '0', data: Buffer.from(postinstText, 'utf8') },
    { name: './prerm', mode: 0o755, typeflag: '0', data: Buffer.from(prermText, 'utf8') }
  ];

  const controlTarGz = gzipSync(buildTar(controlEntries, true, false), { level: 9 });
  const outerTar = buildTar([
    { name: './debian-binary', mode: 0o644, typeflag: '0', data: Buffer.from('2.0\n', 'utf8') },
    { name: './data.tar.gz', mode: 0o644, typeflag: '0', data: dataTarGz },
    { name: './control.tar.gz', mode: 0o644, typeflag: '0', data: controlTarGz }
  ]);

  const ipkBuf = gzipSync(outerTar, { level: 9 });
  const filename = `nikki-dash-all_${fullVersion}_${arch}.ipk`;
  writeFileSync(path.join(distDir, filename), ipkBuf);
  const sha256 = createHash('sha256').update(ipkBuf).digest('hex');
  console.log(`[build-bundle] Built ${filename} (${(ipkBuf.length / 1024 / 1024).toFixed(2)} MiB, sha256=${sha256})`);
}

function buildApk(arch, sortedEntries, manifest) {
  const apkEntries = sortedEntries.map((e) => ({ ...e, name: e.rel }));
  const installedSize = sortedEntries.reduce((acc, e) => acc + e.data.length, 0);
  const dataTarGz = gzipSync(buildTar(apkEntries, true, true), { level: 9 });
  const dataHash = createHash('sha256').update(dataTarGz).digest('hex');

  const pkgInfoText = [
    'pkgname = nikki-dash-all',
    `pkgver = ${fullVersion}`,
    `pkgdesc = All-in-one Nikki (${manifest.nikki.tag}) + Mihomo (${manifest.mihomo.tag}) + NikkiDash Web UI + LuCI Services entry`,
    'url = https://github.com/Klop233/NikkiDash',
    'builddate = 1763800000',
    `size = ${installedSize}`,
    `arch = ${arch}`,
    'license = MIT AND GPL-3.0-or-later',
    `provides = nikki=${manifest.nikki.pkg_version}-r1`,
    `provides = mihomo=${manifest.mihomo.version}-r1`,
    `provides = nikki-dash=${fullVersion}`,
    'replaces = nikki',
    'replaces = mihomo-meta',
    'replaces = mihomo-alpha',
    'replaces = nikki-dash',
    ...BUNDLE_DEPS.map((d) => `depend = ${d}`),
    `datahash = ${dataHash}`,
    ''
  ].join('\n');

  const postInstallText = `#!/bin/sh\n${POST_INSTALL_BODY}`;
  const preDeinstallText = `#!/bin/sh\n${PRE_REMOVE_BODY}`;

  const controlEntries = [
    { name: '.PKGINFO', mode: 0o644, typeflag: '0', data: Buffer.from(pkgInfoText, 'utf8') },
    { name: '.post-install', mode: 0o755, typeflag: '0', data: Buffer.from(postInstallText, 'utf8') },
    { name: '.pre-deinstall', mode: 0o755, typeflag: '0', data: Buffer.from(preDeinstallText, 'utf8') }
  ];

  const controlTarGz = gzipSync(buildTar(controlEntries, false, false), { level: 9 });
  const apkBuf = Buffer.concat([controlTarGz, dataTarGz]);

  const filename = `nikki-dash-all-${fullVersion}_${arch}.apk`;
  writeFileSync(path.join(distDir, filename), apkBuf);
  const sha256 = createHash('sha256').update(apkBuf).digest('hex');
  console.log(`[build-bundle] Built ${filename} (${(apkBuf.length / 1024 / 1024).toFixed(2)} MiB, sha256=${sha256})`);
}

function updateChecksums() {
  const artifacts = readdirSync(distDir)
    .filter((f) => /\.(ipk|apk)$/.test(f))
    .sort();
  const lines = artifacts.map((f) => {
    const hash = createHash('sha256').update(readFileSync(path.join(distDir, f))).digest('hex');
    return `${hash}  ${f}`;
  });
  writeFileSync(path.join(distDir, 'SHA256SUMS'), lines.join('\n') + '\n', 'utf8');
}

function parseArgs(argv) {
  const opts = { arches: [], all: false, format: 'both' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--all') opts.all = true;
    else if (argv[i] === '--arch' && argv[i + 1]) {
      opts.arches.push(...argv[++i].split(',').map((s) => s.trim()).filter(Boolean));
    } else if (argv[i] === '--format' && argv[i + 1]) {
      opts.format = argv[++i];
    }
  }
  return opts;
}

async function main() {
  if (!existsSync(path.join(dashFilesDir, 'www', 'nikki-dash', 'index.html'))) {
    throw new Error('Frontend build missing! Run `node scripts/build-frontend.mjs` first.');
  }
  if (!existsSync(versionsPath)) {
    throw new Error('upstream/versions.json missing! Run `node scripts/sync-upstream.mjs` first.');
  }

  const manifest = JSON.parse(readFileSync(versionsPath, 'utf8'));
  const allArches = Object.keys(manifest.mihomo.assets || {});
  const opts = parseArgs(process.argv.slice(2));
  const targets = opts.all ? allArches : (opts.arches.length > 0 ? opts.arches : ['x86_64']);

  mkdirSync(distDir, { recursive: true });

  // Cache decompressed mihomo binaries in memory per asset filename so shared arm64 targets don't re-gunzip
  const binCache = new Map();

  for (const arch of targets) {
    const asset = manifest.mihomo.assets[arch];
    if (!asset) {
      throw new Error(`Unsupported arch '${arch}'. Supported: ${allArches.join(', ')}`);
    }

    let mihomoBin = binCache.get(asset.file);
    if (!mihomoBin) {
      mihomoBin = await fetchMihomoBinary(asset);
      binCache.set(asset.file, mihomoBin);
    }

    const entriesMap = new Map();
    collectFilesMap(dashFilesDir, entriesMap);
    addNikkiUpstreamFiles(entriesMap);
    putFile(entriesMap, 'usr/bin/mihomo', mihomoBin, 0o755);

    const bundleMeta = {
      bundle: true,
      dash_version: pkgVersion,
      arch,
      nikki_tag: manifest.nikki.tag,
      nikki_pkg_version: manifest.nikki.pkg_version,
      mihomo_tag: manifest.mihomo.tag,
      mihomo_version: manifest.mihomo.version
    };
    putFile(
      entriesMap,
      'usr/share/nikki-dash/bundle-versions.json',
      Buffer.from(JSON.stringify(bundleMeta, null, 2) + '\n', 'utf8'),
      0o644
    );

    const sortedEntries = [...entriesMap.values()].sort((a, b) => a.rel.localeCompare(b.rel));

    if (opts.format === 'both' || opts.format === 'ipk') {
      buildIpk(arch, sortedEntries, manifest);
    }
    if (opts.format === 'both' || opts.format === 'apk') {
      buildApk(arch, sortedEntries, manifest);
    }
  }

  updateChecksums();
  console.log(`[build-bundle] Done (${targets.length} arch targets).`);
}

main().catch((err) => {
  console.error('[build-bundle] Error:', err);
  process.exit(1);
});
