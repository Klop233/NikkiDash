'use strict';

import { access, lstat, readfile } from 'fs';
import {
	BACKUP_DIR, cmd_exists, ensure_dir, exec_argv, make_tmp_file,
	redact_text, safe_unlink, write_file_atomic, err_res, ok_res
} from '/usr/share/nikki-dash/lib/common.uc';

const NIKKI_REPO_BASE = 'https://nikkinikki.pages.dev';

function parse_release_field(content, key) {
	let lines = split(content ?? '', '\n');
	let prefix = `${key}=`;
	for (let l in lines) {
		let t = trim(l);
		if (substr(t, 0, length(prefix)) == prefix) {
			let v = substr(t, length(prefix));
			v = replace(v, /^['"]/, '');
			v = replace(v, /['"]$/, '');
			return trim(v);
		}
	}
	return '';
}

function map_nikki_branch(release) {
	if (type(release) != 'string' || length(release) == 0) return '';
	if (index(release, '24.10') >= 0) return 'openwrt-24.10';
	if (index(release, '25.12') >= 0) return 'openwrt-25.12';
	if (release == 'SNAPSHOT' || index(release, 'SNAPSHOT') >= 0) return 'SNAPSHOT';
	return '';
}

function query_pkg_version(pkg_mgr, pkg_name) {
	if (!pkg_name || !match(pkg_name, /^[A-Za-z0-9._-]+$/)) return '';
	if (pkg_mgr == 'apk') {
		let r = exec_argv(['apk', 'query', '--installed', '--fields', 'version', pkg_name]);
		if (r.code == 0 && length(trim(r.stdout)) > 0) {
			for (let line in split(r.stdout, '\n')) {
				let m = match(trim(line), /^Version:[ \t]+(.+)$/);
				if (m) return trim(m[1]);
			}
		}
		// Fallback for older apk output
		let r2 = exec_argv(['apk', 'list', '-I', pkg_name]);
		if (r2.code == 0) {
			let pref = `${pkg_name}-`;
			for (let line in split(r2.stdout, '\n')) {
				let tok = split(trim(line), /[ \t]+/)[0] ?? '';
				if (substr(tok, 0, length(pref)) == pref) {
					return substr(tok, length(pref));
				}
			}
		}
		return '';
	}
	if (pkg_mgr == 'opkg') {
		let r = exec_argv(['opkg', 'list-installed', pkg_name]);
		if (r.code == 0 && length(trim(r.stdout)) > 0) {
			let parts = split(trim(r.stdout), /[ \t\r\n]+/);
			if (parts[0] == pkg_name) return parts[2] ?? '';
		}
	}
	return '';
}

function list_luci_nikki_packages(pkg_mgr) {
	let found = [];
	if (pkg_mgr == 'apk') {
		let r = exec_argv(['apk', 'info']);
		if (r.code == 0) {
			for (let line in split(r.stdout, '\n')) {
				let name = trim(line);
				if (match(name, /^luci-(app|i18n)-nikki(-[a-z0-9_-]+)?$/)) {
					push(found, name);
				}
			}
		}
	} else if (pkg_mgr == 'opkg') {
		let r = exec_argv(['opkg', 'list-installed']);
		if (r.code == 0) {
			for (let line in split(r.stdout, '\n')) {
				let name = split(trim(line), /[ \t]+/)[0] ?? '';
				if (match(name, /^luci-(app|i18n)-nikki(-[a-z0-9_-]+)?$/)) {
					push(found, name);
				}
			}
		}
	}
	// Remove language packs before luci-app-nikki
	sort(found, (a, b) => {
		let a_app = (a == 'luci-app-nikki') ? 1 : 0;
		let b_app = (b == 'luci-app-nikki') ? 1 : 0;
		if (a_app != b_app) return a_app - b_app;
		return a < b ? -1 : (a > b ? 1 : 0);
	});
	return found;
}

export function detect_platform() {
	let rel_raw = readfile('/etc/openwrt_release') ?? '';
	let distrib_id = parse_release_field(rel_raw, 'DISTRIB_ID') || 'OpenWrt';
	let distrib_release = parse_release_field(rel_raw, 'DISTRIB_RELEASE');
	let arch = parse_release_field(rel_raw, 'DISTRIB_ARCH');
	let branch = map_nikki_branch(distrib_release);

	let pkg_mgr = cmd_exists('apk') ? 'apk' : (cmd_exists('opkg') ? 'opkg' : 'unknown');
	let fw4_available = access('/sbin/fw4', 'x') || cmd_exists('fw4');

	let nikki_pkg_ver = query_pkg_version(pkg_mgr, 'nikki');
	let meta_ver = query_pkg_version(pkg_mgr, 'mihomo-meta');
	let alpha_ver = query_pkg_version(pkg_mgr, 'mihomo-alpha');

	// Read bundled manifest when installed via all-in-one nikki-dash-all package
	let bundle_meta = null;
	let bundle_raw = readfile('/usr/share/nikki-dash/bundle-versions.json');
	if (bundle_raw) {
		try {
			bundle_meta = json(bundle_raw);
		} catch (e) {}
	}
	if (length(nikki_pkg_ver) == 0 && bundle_meta?.nikki_pkg_version) {
		nikki_pkg_ver = bundle_meta.nikki_pkg_version;
	}

	let mihomo_variant = '';
	if (length(meta_ver) > 0) mihomo_variant = 'meta';
	else if (length(alpha_ver) > 0) mihomo_variant = 'alpha';
	else if (bundle_meta?.mihomo_version && cmd_exists('mihomo')) mihomo_variant = 'meta';
	else if (cmd_exists('mihomo')) mihomo_variant = 'custom';

	let luci_packages = list_luci_nikki_packages(pkg_mgr);
	let feed_url = (length(branch) > 0 && length(arch) > 0)
		? `${NIKKI_REPO_BASE}/${branch}/${arch}/nikki`
		: '';

	let feed_configured = false;
	if (pkg_mgr == 'apk') {
		let f = readfile('/etc/apk/repositories.d/customfeeds.list') ?? '';
		feed_configured = index(f, 'nikkinikki.pages.dev') >= 0;
	} else if (pkg_mgr == 'opkg') {
		let f = readfile('/etc/opkg/customfeeds.conf') ?? '';
		feed_configured = index(f, 'nikkinikki.pages.dev') >= 0;
	}

	let nikki_installed = access('/etc/init.d/nikki', 'x') && access('/etc/config/nikki', 'r');
	let mihomo_installed = cmd_exists('mihomo');
	let supported = (pkg_mgr == 'apk' || pkg_mgr == 'opkg') && fw4_available && length(branch) > 0 && length(arch) > 0;

	return {
		distrib_id: distrib_id,
		distrib_release: distrib_release,
		arch: arch,
		branch: branch,
		pkg_mgr: pkg_mgr,
		fw4_available: fw4_available,
		supported: supported,
		feed_url: feed_url,
		feed_configured: feed_configured,
		nikki_installed: nikki_installed,
		nikki_version: nikki_pkg_ver,
		mihomo_installed: mihomo_installed,
		mihomo_variant: mihomo_variant,
		mihomo_pkg_version: meta_ver || alpha_ver || (bundle_meta?.mihomo_version ?? ''),
		bundled: bundle_meta != null,
		luci_nikki_installed: length(luci_packages) > 0,
		luci_packages: luci_packages
	};
};

function ensure_nikki_feed(plat, step_cb) {
	if (plat.pkg_mgr == 'apk') {
		step_cb('configure_feed', 'running', `Configuring official Nikki APK feed (${plat.branch}/${plat.arch})`);
		ensure_dir('/etc/apk/keys', 0o755);
		ensure_dir('/etc/apk/repositories.d', 0o755);

		let key_url = `${NIKKI_REPO_BASE}/public-key.pem`;
		let kr = exec_argv(['curl', '-fsSL', '--connect-timeout', '10', '--max-time', '30', '-o', '/etc/apk/keys/nikki.pem', key_url]);
		if (kr.code != 0) {
			return err_res('FEED_KEY_FAILED', `Failed to download Nikki APK signing key: ${trim(redact_text(kr.stderr))}`);
		}

		let feeds_path = '/etc/apk/repositories.d/customfeeds.list';
		let existing = readfile(feeds_path) ?? '';
		let lines = [];
		for (let line in split(existing, '\n')) {
			if (index(line, '/nikki/') >= 0 || index(line, 'nikkinikki.pages.dev') >= 0) continue;
			if (length(trim(line)) > 0 || substr(line, 0, 1) == '#') push(lines, line);
		}
		push(lines, `${plat.feed_url}/packages.adb`);
		let wr = write_file_atomic(feeds_path, join('\n', lines) + '\n', 0o644);
		if (!wr.ok) return err_res('IO_ERROR', wr.error);

		step_cb('update_feeds', 'running', 'Running apk update');
		let ur = exec_argv(['apk', 'update'], { max_bytes: 131072 });
		if (ur.code != 0) {
			return err_res('FEED_UPDATE_FAILED', `apk update failed: ${trim(redact_text(ur.stderr || ur.stdout))}`);
		}
		return ok_res({});
	}

	if (plat.pkg_mgr == 'opkg') {
		step_cb('configure_feed', 'running', `Configuring official Nikki OPKG feed (${plat.branch}/${plat.arch})`);
		let key_tmp = make_tmp_file('nikki-key');
		let key_url = `${NIKKI_REPO_BASE}/key-build.pub`;
		let kr = exec_argv(['curl', '-fsSL', '--connect-timeout', '10', '--max-time', '30', '-o', key_tmp, key_url]);
		if (kr.code != 0) {
			safe_unlink(key_tmp);
			return err_res('FEED_KEY_FAILED', `Failed to download Nikki OPKG signing key: ${trim(redact_text(kr.stderr))}`);
		}
		let ar = exec_argv(['opkg-key', 'add', key_tmp]);
		safe_unlink(key_tmp);
		if (ar.code != 0) {
			return err_res('FEED_KEY_FAILED', `opkg-key add failed: ${trim(redact_text(ar.stderr || ar.stdout))}`);
		}

		let feeds_path = '/etc/opkg/customfeeds.conf';
		let existing = readfile(feeds_path) ?? '';
		let lines = [];
		for (let line in split(existing, '\n')) {
			if (match(trim(line), /^src\/gz[ \t]+nikki[ \t]/)) continue;
			if (length(trim(line)) > 0 || substr(line, 0, 1) == '#') push(lines, line);
		}
		push(lines, `src/gz nikki ${plat.feed_url}`);
		let wr = write_file_atomic(feeds_path, join('\n', lines) + '\n', 0o644);
		if (!wr.ok) return err_res('IO_ERROR', wr.error);

		step_cb('update_feeds', 'running', 'Running opkg update');
		let ur = exec_argv(['opkg', 'update'], { max_bytes: 131072 });
		if (ur.code != 0) {
			return err_res('FEED_UPDATE_FAILED', `opkg update failed: ${trim(redact_text(ur.stderr || ur.stdout))}`);
		}
		return ok_res({});
	}

	return err_res('UNSUPPORTED_PLATFORM', 'Neither apk nor opkg package manager was found');
}

/*
 * Installs or upgrades official Nikki core + Mihomo (meta or alpha) WITHOUT luci-app-nikki.
 * Always backs up and preserves any existing /etc/config/nikki and never auto-starts nikki.
 */
export function install_or_upgrade_core(opts, step_cb) {
	let variant = opts?.core_variant ?? 'meta';
	if (variant != 'meta' && variant != 'alpha') {
		return err_res('INVALID_PARAM', 'core_variant must be meta or alpha');
	}
	let core_pkg = (variant == 'alpha') ? 'mihomo-alpha' : 'mihomo-meta';
	let other_pkg = (variant == 'alpha') ? 'mihomo-meta' : 'mihomo-alpha';

	let plat = detect_platform();
	if (!plat.supported) {
		return err_res(
			'UNSUPPORTED_PLATFORM',
			`Automatic Nikki core installation requires firewall4 and OpenWrt 24.10 / 25.12 / SNAPSHOT (detected: ${plat.distrib_id} ${plat.distrib_release} / ${plat.arch} / ${plat.pkg_mgr})`
		);
	}

	// Backup existing /etc/config/nikki before package operation
	let prev_cfg = null;
	if (lstat('/etc/config/nikki')?.type == 'file') {
		prev_cfg = readfile('/etc/config/nikki');
		ensure_dir(BACKUP_DIR, 0o700);
		write_file_atomic(`${BACKUP_DIR}/nikki.config.before-core-${time()}.bak`, prev_cfg ?? '', 0o600);
	}

	let fr = ensure_nikki_feed(plat, step_cb);
	if (!fr.ok) return fr;

	if (plat.pkg_mgr == 'apk') {
		// Switch mihomo variant cleanly if the opposite variant is installed
		if (length(query_pkg_version('apk', other_pkg)) > 0) {
			step_cb('switch_variant', 'running', `Removing conflicting ${other_pkg}`);
			exec_argv(['apk', 'del', other_pkg], { max_bytes: 65536 });
		}
		step_cb('install_packages', 'running', `Installing ${core_pkg} and nikki core via apk (without luci-app-nikki)`);
		let ir = exec_argv(['apk', 'add', '--upgrade', core_pkg, 'nikki'], { max_bytes: 262144 });
		if (ir.code != 0) {
			return err_res('CORE_INSTALL_FAILED', trim(redact_text(ir.stderr || ir.stdout || 'apk add failed')));
		}
	} else {
		if (length(query_pkg_version('opkg', other_pkg)) > 0) {
			step_cb('switch_variant', 'running', `Removing conflicting ${other_pkg}`);
			exec_argv(['opkg', 'remove', other_pkg], { max_bytes: 65536 });
		}
		step_cb('install_packages', 'running', `Installing ${core_pkg} and nikki core via opkg (without luci-app-nikki)`);
		let ir = exec_argv(['opkg', 'install', core_pkg, 'nikki'], { max_bytes: 262144 });
		if (ir.code != 0) {
			return err_res('CORE_INSTALL_FAILED', trim(redact_text(ir.stderr || ir.stdout || 'opkg install failed')));
		}
	}

	// Restore existing /etc/config/nikki if user already had one and package replaced it
	if (prev_cfg != null && length(prev_cfg) > 0) {
		let cur_cfg = readfile('/etc/config/nikki') ?? '';
		if (cur_cfg != prev_cfg) {
			write_file_atomic('/etc/config/nikki', prev_cfg, 0o600);
		}
	}

	step_cb('verify_core', 'running', 'Verifying /etc/init.d/nikki and /usr/bin/mihomo');
	let after = detect_platform();
	if (!after.nikki_installed || !after.mihomo_installed) {
		return err_res('CORE_VERIFY_FAILED', 'Package install finished, but /etc/init.d/nikki or /usr/bin/mihomo is still missing');
	}

	return ok_res({
		platform: after,
		installed_packages: [core_pkg, 'nikki']
	});
};

/*
 * Safely removes ONLY legacy luci-app-nikki and luci-i18n-nikki-* UI packages.
 * Never removes nikki core, mihomo, or /etc/config/nikki.
 */
export function remove_luci_nikki_packages(step_cb) {
	let plat = detect_platform();
	let pkgs = plat.luci_packages ?? [];
	if (length(pkgs) == 0) {
		return ok_res({ removed: [], platform: plat, message: 'No legacy luci-app-nikki packages are installed' });
	}

	// Strict allowlist verification before calling package manager
	let safe_pkgs = [];
	for (let p in pkgs) {
		if (match(p, /^luci-(app|i18n)-nikki(-[a-z0-9_-]+)?$/)) {
			push(safe_pkgs, p);
		}
	}
	if (length(safe_pkgs) == 0) {
		return ok_res({ removed: [], platform: plat });
	}

	step_cb('remove_luci', 'running', `Removing legacy LuCI packages: ${join(', ', safe_pkgs)}`);
	let r = (plat.pkg_mgr == 'apk')
		? exec_argv(['apk', 'del', ...safe_pkgs], { max_bytes: 131072 })
		: exec_argv(['opkg', 'remove', ...safe_pkgs], { max_bytes: 131072 });

	if (r.code != 0) {
		return err_res('REMOVE_LUCI_FAILED', trim(redact_text(r.stderr || r.stdout || 'Failed to remove luci-app-nikki')));
	}

	let after = detect_platform();
	return ok_res({
		removed: safe_pkgs,
		platform: after
	});
};
