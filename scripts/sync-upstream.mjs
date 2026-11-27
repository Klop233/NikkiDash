import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstreamDir = path.join(root, 'upstream');
const nikkiOutDir = path.join(upstreamDir, 'nikki');
const versionsPath = path.join(upstreamDir, 'versions.json');
const schemaPath = path.join(root, 'schema', 'nikki-schema.json');
const pkgSchemaPath = path.join(root, 'package', 'nikki-dash', 'files', 'usr', 'share', 'nikki-dash', 'schema.json');

const NIKKI_REPO = 'nikkinikki-org/OpenWrt-nikki';
const MIHOMO_REPO = 'MetaCubeX/mihomo';

// OpenWrt target architecture -> upstream MetaCubeX/mihomo Linux release binary asset
export const ARCH_MAP = {
  x86_64: {
    assetName: (tag) => `mihomo-linux-amd64-compatible-${tag}.gz`,
    mihomoArch: 'amd64-compatible'
  },
  aarch64_generic: {
    assetName: (tag) => `mihomo-linux-arm64-${tag}.gz`,
    mihomoArch: 'arm64'
  },
  'aarch64_cortex-a53': {
    assetName: (tag) => `mihomo-linux-arm64-${tag}.gz`,
    mihomoArch: 'arm64'
  },
  'aarch64_cortex-a72': {
    assetName: (tag) => `mihomo-linux-arm64-${tag}.gz`,
    mihomoArch: 'arm64'
  },
  'arm_cortex-a7_neon-vfpv4': {
    assetName: (tag) => `mihomo-linux-armv7-${tag}.gz`,
    mihomoArch: 'armv7'
  },
  mipsel_24kc: {
    assetName: (tag) => `mihomo-linux-mipsle-softfloat-${tag}.gz`,
    mihomoArch: 'mipsle-softfloat'
  },
  riscv64_generic: {
    assetName: (tag) => `mihomo-linux-riscv64-${tag}.gz`,
    mihomoArch: 'riscv64'
  }
};

function parseArgs(argv) {
  const opts = { checkOnly: false, force: false, githubOutput: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') opts.checkOnly = true;
    else if (argv[i] === '--force') opts.force = true;
    else if (argv[i] === '--github-output' && argv[i + 1]) opts.githubOutput = argv[++i];
  }
  return opts;
}

function ghHeaders(raw = false) {
  const h = {
    'User-Agent': 'NikkiDash-Upstream-Sync/1.0',
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json'
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: ghHeaders(false) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}: ${await res.text()}`);
  }
  return res.json();
}

async function fetchBuffer(url, rawGithub = false) {
  const res = await fetch(url, { headers: rawGithub ? ghHeaders(true) : { 'User-Agent': 'NikkiDash-Upstream-Sync/1.0' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function resolveTagCommit(repo, tag) {
  const ref = await fetchJson(`https://api.github.com/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`);
  if (ref.object?.type === 'tag' && ref.object?.url) {
    const tagObj = await fetchJson(ref.object.url);
    return tagObj.object?.sha || ref.object.sha;
  }
  return ref.object?.sha || '';
}

async function downloadNikkiFiles(tag, outDir) {
  const tree = await fetchJson(`https://api.github.com/repos/${NIKKI_REPO}/git/trees/${encodeURIComponent(tag)}?recursive=1`);
  const blobs = (tree.tree || []).filter((item) => item.type === 'blob' && item.path.startsWith('nikki/files/'));
  if (blobs.length === 0) {
    throw new Error(`No files found under nikki/files/ in ${NIKKI_REPO}@${tag}`);
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const fileList = [];
  for (const item of blobs.sort((a, b) => a.path.localeCompare(b.path))) {
    const rel = item.path.slice('nikki/files/'.length);
    const dest = path.join(outDir, ...rel.split('/'));
    mkdirSync(path.dirname(dest), { recursive: true });
    const rawUrl = `https://raw.githubusercontent.com/${NIKKI_REPO}/${encodeURIComponent(tag)}/${item.path}`;
    const buf = await fetchBuffer(rawUrl, false);
    const normalized = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    writeFileSync(dest, normalized);
    fileList.push({
      path: rel,
      sha256: createHash('sha256').update(normalized).digest('hex'),
      size: normalized.length
    });
  }
  return fileList;
}

function auditSchemaDrift(nikkiConfPath) {
  if (!existsSync(nikkiConfPath) || !existsSync(schemaPath)) return [];
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const conf = readFileSync(nikkiConfPath, 'utf8');
  const unknown = [];
  let curType = '';
  let curName = '';

  for (const rawLine of conf.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const secM = line.match(/^config\s+'?([^'\s]+)'?(?:\s+'?([^'\s]+)'?)?/);
    if (secM) {
      curType = secM[1];
      curName = secM[2] || '';
      continue;
    }
    const optM = line.match(/^(?:option|list)\s+'?([^'\s]+)'?/);
    if (optM && curType) {
      const opt = optM[1];
      const spec =
        (curName && schema.named_sections?.[curName]?.options) ||
        schema.repeatable_sections?.[curType]?.options;
      if (spec && !Object.prototype.hasOwnProperty.call(spec, opt)) {
        unknown.push(`${curName || curType}.${opt}`);
      }
    }
  }
  return [...new Set(unknown)].sort();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const prev = existsSync(versionsPath) ? JSON.parse(readFileSync(versionsPath, 'utf8')) : null;

  console.log('[sync-upstream] Querying latest releases for OpenWrt-nikki and MetaCubeX/mihomo...');
  const [nikkiRel, mihomoRel] = await Promise.all([
    fetchJson(`https://api.github.com/repos/${NIKKI_REPO}/releases/latest`),
    fetchJson(`https://api.github.com/repos/${MIHOMO_REPO}/releases/latest`)
  ]);

  const nikkiTag = nikkiRel.tag_name;
  const nikkiCommit = await resolveTagCommit(NIKKI_REPO, nikkiTag);
  const nikkiMakefileBuf = await fetchBuffer(
    `https://raw.githubusercontent.com/${NIKKI_REPO}/${encodeURIComponent(nikkiTag)}/nikki/Makefile`
  );
  const nikkiMakefile = nikkiMakefileBuf.toString('utf8');
  const pkgVerMatch = nikkiMakefile.match(/^PKG_VERSION:=\s*(.+)$/m);
  const nikkiPkgVersion = pkgVerMatch ? pkgVerMatch[1].trim() : nikkiTag.replace(/^v/, '');

  const mihomoTag = mihomoRel.tag_name;
  const mihomoVersion = mihomoTag.replace(/^v/, '');

  // Resolve per-arch Mihomo asset URLs and SHA256 digests (reuse digest for shared binaries)
  const assetByName = new Map((mihomoRel.assets || []).map((a) => [a.name, a]));
  const shaCache = new Map();
  const mihomoAssets = {};

  for (const [arch, spec] of Object.entries(ARCH_MAP)) {
    const fileName = spec.assetName(mihomoTag);
    const asset = assetByName.get(fileName);
    if (!asset) {
      throw new Error(`Expected Mihomo asset not found in ${mihomoTag}: ${fileName}`);
    }
    let sha256 = '';
    if (shaCache.has(fileName)) {
      sha256 = shaCache.get(fileName);
    } else if (typeof asset.digest === 'string' && asset.digest.startsWith('sha256:')) {
      sha256 = asset.digest.slice('sha256:'.length).toLowerCase();
      shaCache.set(fileName, sha256);
    } else {
      console.log(`[sync-upstream] Computing SHA256 for ${fileName}...`);
      const buf = await fetchBuffer(asset.browser_download_url);
      sha256 = createHash('sha256').update(buf).digest('hex');
      shaCache.set(fileName, sha256);
    }
    mihomoAssets[arch] = {
      file: fileName,
      url: asset.browser_download_url,
      size: asset.size,
      sha256
    };
  }

  const nikkiChanged =
    !prev ||
    prev.nikki?.tag !== nikkiTag ||
    prev.nikki?.commit !== nikkiCommit ||
    prev.nikki?.pkg_version !== nikkiPkgVersion ||
    !existsSync(path.join(nikkiOutDir, 'nikki.init'));

  const mihomoChanged =
    !prev ||
    prev.mihomo?.tag !== mihomoTag ||
    JSON.stringify(prev.mihomo?.assets || {}) !== JSON.stringify(mihomoAssets);

  const changed = opts.force || nikkiChanged || mihomoChanged;

  console.log(`[sync-upstream] Nikki:  ${prev?.nikki?.tag || '(none)'} -> ${nikkiTag} (pkg ${nikkiPkgVersion}, changed=${nikkiChanged})`);
  console.log(`[sync-upstream] Mihomo: ${prev?.mihomo?.tag || '(none)'} -> ${mihomoTag} (changed=${mihomoChanged})`);

  if (opts.checkOnly) {
    console.log(`[sync-upstream] Check-only mode: changed=${changed}`);
    if (opts.githubOutput) {
      writeFileSync(
        opts.githubOutput,
        `changed=${changed}\nnikki_tag=${nikkiTag}\nnikki_pkg_version=${nikkiPkgVersion}\nmihomo_tag=${mihomoTag}\nmihomo_version=${mihomoVersion}\n`,
        { flag: 'a' }
      );
    }
    return;
  }

  let nikkiFiles = prev?.nikki?.files || [];
  if (opts.force || nikkiChanged) {
    console.log(`[sync-upstream] Syncing nikki/files/* from ${NIKKI_REPO}@${nikkiTag}...`);
    nikkiFiles = await downloadNikkiFiles(nikkiTag, nikkiOutDir);
    console.log(`[sync-upstream] Synced ${nikkiFiles.length} nikki files into upstream/nikki/`);
  }

  const nextManifest = {
    schema_version: 1,
    nikki: {
      repo: NIKKI_REPO,
      tag: nikkiTag,
      pkg_version: nikkiPkgVersion,
      commit: nikkiCommit,
      published_at: nikkiRel.published_at || '',
      files: nikkiFiles
    },
    mihomo: {
      repo: MIHOMO_REPO,
      tag: mihomoTag,
      version: mihomoVersion,
      published_at: mihomoRel.published_at || '',
      assets: mihomoAssets
    }
  };

  mkdirSync(upstreamDir, { recursive: true });
  writeFileSync(versionsPath, JSON.stringify(nextManifest, null, 2) + '\n', 'utf8');

  // Keep schema/nikki-schema.json upstream metadata in sync
  if (existsSync(schemaPath)) {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const schemaNeedsUpdate =
      schema.upstream?.tag !== nikkiTag ||
      schema.upstream?.commit !== nikkiCommit ||
      schema.upstream?.mihomo_tag !== mihomoTag;
    if (schemaNeedsUpdate) {
      schema.upstream = {
        ...(schema.upstream || {}),
        repo: `https://github.com/${NIKKI_REPO}`,
        tag: nikkiTag,
        commit: nikkiCommit,
        mihomo_tag: mihomoTag
      };
      const outJson = JSON.stringify(schema, null, 2) + '\n';
      writeFileSync(schemaPath, outJson, 'utf8');
      writeFileSync(pkgSchemaPath, outJson, 'utf8');
      console.log('[sync-upstream] Updated upstream metadata in schema/nikki-schema.json');
    }
  }

  const schemaDrift = auditSchemaDrift(path.join(nikkiOutDir, 'nikki.conf'));
  if (schemaDrift.length > 0) {
    console.log(`[sync-upstream] Notice: new options in upstream nikki.conf not yet in schema: ${schemaDrift.join(', ')}`);
  }

  if (opts.githubOutput) {
    const lines = [
      `changed=${changed}`,
      `nikki_changed=${nikkiChanged}`,
      `mihomo_changed=${mihomoChanged}`,
      `nikki_prev=${prev?.nikki?.tag || 'none'}`,
      `nikki_tag=${nikkiTag}`,
      `nikki_pkg_version=${nikkiPkgVersion}`,
      `mihomo_prev=${prev?.mihomo?.tag || 'none'}`,
      `mihomo_tag=${mihomoTag}`,
      `mihomo_version=${mihomoVersion}`,
      `schema_drift=${schemaDrift.join(', ')}`
    ];
    writeFileSync(opts.githubOutput, lines.join('\n') + '\n', { flag: 'a' });
  }

  console.log('[sync-upstream] Done.');
}

main().catch((err) => {
  console.error('[sync-upstream] Error:', err);
  process.exit(1);
});
