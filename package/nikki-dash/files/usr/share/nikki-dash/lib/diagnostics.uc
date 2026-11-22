'use strict';

import { access, open, readfile, stat, lstat } from 'fs';
import { cursor } from 'uci';
import {
	DASH_VERSION, NIKKI_APP_LOG, NIKKI_CORE_LOG, NIKKI_RUN_CONFIG,
	NIKKI_PID_FILE, NIKKI_STARTED_FLAG, MAX_LOG_BYTES,
	cmd_exists, exec_argv, redact_text, write_file_atomic, err_res, ok_res
} from '/usr/share/nikki-dash/lib/common.uc';
import { load_schema, read_nikki_config } from '/usr/share/nikki-dash/lib/schema.uc';
import { resolve_controller, controller_public_info } from '/usr/share/nikki-dash/lib/mihomo.uc';

export function detect_conflicts(ubus) {
	let candidates = ['openclash', 'passwall', 'passwall2', 'homeproxy', 'shadowsocksr', 'dae', 'daed', 'momo'];
	let conflicts = [];
	let svc_list = ubus.call('service', 'list', {}) ?? {};

	for (let name in candidates) {
		let running = false;
		if (exists(svc_list, name)) {
			let insts = svc_list[name]?.instances;
			if (type(insts) == 'object') {
				for (let k in insts) {
					if (insts[k]?.running == true) running = true;
				}
			}
		}
		if (running) {
			push(conflicts, {
				service: name,
				running: true,
				message: `Detected running transparent proxy service "${name}". Stop or disable it before running Nikki to avoid nftables/DNS conflicts.`
			});
		}
	}
	return conflicts;
};

export function get_versions() {
	let nikki_ver = '';
	if (cmd_exists('opkg')) {
		let r = exec_argv(['opkg', 'list-installed', 'nikki']);
		if (r.code == 0 && length(trim(r.stdout)) > 0) {
			let parts = split(trim(r.stdout), /[ \t\r\n]+/);
			nikki_ver = parts[2] ?? '';
		}
	} else if (cmd_exists('apk')) {
		let r = exec_argv(['apk', 'info', '-e', 'nikki']);
		if (r.code == 0) nikki_ver = trim(r.stdout);
	}

	let core_ver = '';
	if (cmd_exists('mihomo')) {
		let r = exec_argv(['mihomo', '-v']);
		if (r.code == 0) {
			let lines = split(r.stdout, '\n');
			for (let l in lines) {
				let m = match(l, /Mihomo[ \t]+Meta[ \t]+([^ \t\r\n]+)|Mihomo[ \t]+([^ \t\r\n]+)/);
				if (m) {
					core_ver = m[1] ?? m[2] ?? trim(l);
					break;
				}
			}
			if (core_ver == '' && length(lines) > 0) core_ver = trim(lines[0]);
		}
	}

	let openwrt_ver = '';
	let rel = readfile('/etc/openwrt_release') ?? '';
	let rm = match(rel, /DISTRIB_RELEASE='([^']+)'/);
	if (rm) openwrt_ver = rm[1];

	return {
		dash: DASH_VERSION,
		nikki: nikki_ver,
		core: core_ver,
		openwrt: openwrt_ver
	};
};

export function get_capabilities(ubus, caller) {
	let schema = load_schema();
	let versions = get_versions();
	let conflicts = detect_conflicts(ubus);
	let nikki_installed = access('/etc/init.d/nikki', 'x') && access('/etc/config/nikki', 'r');
	let mihomo_installed = cmd_exists('mihomo');
	let fw4_available = cmd_exists('fw4') || cmd_exists('nft');
	let yq_available = cmd_exists('yq');
	let curl_available = cmd_exists('curl');
	let ssl_available = access('/lib/libustream-ssl.so', 'r') || access('/usr/lib/libustream-ssl.so', 'r');

	return ok_res({
		versions: versions,
		schema_version: schema?.schema_version ?? 'unknown',
		upstream_locked: schema?.upstream ?? {},
		dependencies: {
			nikki_installed: nikki_installed,
			mihomo_installed: mihomo_installed,
			fw4_available: fw4_available,
			yq_available: yq_available,
			curl_available: curl_available,
			https_available: ssl_available
		},
		conflicts: conflicts,
		caller: {
			authenticated: caller?.authenticated == true
		},
		features: {
			chunked_upload: true,
			polling_mode: true,
			websocket_streaming: false
		}
	});
};

export function get_system_identifiers(ubus) {
	let users = [];
	let passwd = readfile('/etc/passwd') ?? '';
	for (let line in split(passwd, '\n')) {
		let name = split(line, ':')[0];
		if (name && length(name) > 0) push(users, name);
	}

	let groups = [];
	let grp = readfile('/etc/group') ?? '';
	for (let line in split(grp, '\n')) {
		let name = split(line, ':')[0];
		if (name && length(name) > 0) push(groups, name);
	}

	let cgroups = [];
	if (stat('/sys/fs/cgroup')) {
		let r = exec_argv(['find', '/sys/fs/cgroup', '-mindepth', '1', '-maxdepth', '3', '-type', 'd']);
		if (r.code == 0) {
			for (let line in split(r.stdout, '\n')) {
				let t = trim(line);
				if (length(t) > 15 && index(t, 'services/nikki') < 0) {
					push(cgroups, substr(t, 15));
				}
			}
		}
	}

	let networks = [];
	let dump = ubus.call('network.interface', 'dump', {});
	if (dump && type(dump.interface) == 'array') {
		for (let iface in dump.interface) {
			if (iface.interface && iface.interface != 'loopback') {
				push(networks, iface.interface);
			}
		}
	}

	let hosts = [];
	let hints = ubus.call('luci-rpc', 'getHostHints', {});
	if (hints && type(hints) == 'object') {
		for (let mac in hints) {
			let h = hints[mac];
			push(hosts, {
				mac: mac,
				name: h?.name ?? '',
				ipaddrs: h?.ipaddrs ?? [],
				ip6addrs: h?.ip6addrs ?? []
			});
		}
	}

	return {
		users: uniq(users),
		groups: uniq(groups),
		cgroups: uniq(cgroups),
		networks: uniq(networks),
		hosts: hosts
	};
};

export function read_logs(source, tail_lines, max_bytes) {
	let path = null;
	if (source == 'app') path = NIKKI_APP_LOG;
	else if (source == 'core') path = NIKKI_CORE_LOG;
	else return err_res('INVALID_PARAM', 'Log source must be app or core');

	let st = lstat(path);
	if (!st || st.type != 'file') {
		return ok_res({ source: source, exists: false, lines: [], total_bytes: 0, truncated: false });
	}

	let lim_bytes = int(max_bytes ?? MAX_LOG_BYTES);
	if (lim_bytes < 4096) lim_bytes = 4096;
	if (lim_bytes > MAX_LOG_BYTES) lim_bytes = MAX_LOG_BYTES;

	let lim_lines = int(tail_lines ?? 400);
	if (lim_lines < 20) lim_lines = 20;
	if (lim_lines > 2000) lim_lines = 2000;

	let truncated = false;
	let content = '';
	let f = open(path, 'r');
	if (!f) return err_res('IO_ERROR', 'Failed to open log file');

	if (st.size > lim_bytes) {
		f.seek(st.size - lim_bytes, 0);
		truncated = true;
	}
	content = f.read(lim_bytes) ?? '';
	f.close();

	let sanitized = redact_text(content);
	let all_lines = split(sanitized, '\n');
	if (length(all_lines) > 0 && all_lines[length(all_lines) - 1] == '') {
		pop(all_lines);
	}
	if (truncated && length(all_lines) > 1) {
		// Drop partial first line after seek
		shift(all_lines);
	}
	if (length(all_lines) > lim_lines) {
		all_lines = slice(all_lines, length(all_lines) - lim_lines);
		truncated = true;
	}

	return ok_res({
		source: source,
		exists: true,
		total_bytes: st.size,
		truncated: truncated,
		lines: all_lines
	});
};

export function clear_logs(source) {
	if (source != 'app' && source != 'core' && source != 'all') {
		return err_res('INVALID_PARAM', 'Log source must be app, core, or all');
	}
	if ((source == 'app' || source == 'all') && lstat(NIKKI_APP_LOG)?.type == 'file') {
		write_file_atomic(NIKKI_APP_LOG, '', 0o644);
	}
	if ((source == 'core' || source == 'all') && lstat(NIKKI_CORE_LOG)?.type == 'file') {
		write_file_atomic(NIKKI_CORE_LOG, '', 0o644);
	}
	return ok_res({ cleared: source });
};

function redact_runtime_profile(obj) {
	if (type(obj) != 'object') return {};
	let out = {};
	for (let k in obj) {
		if (k == 'secret' || k == 'authentication') {
			out[k] = '***';
		} else if (k == 'proxies' && type(obj[k]) == 'array') {
			out[k] = `[${length(obj[k])} proxies redacted]`;
		} else if (k == 'proxy-providers' && type(obj[k]) == 'object') {
			let pp = {};
			for (let pk in obj[k]) {
				pp[pk] = {
					type: obj[k][pk]?.type ?? '',
					url: obj[k][pk]?.url ? '***' : '',
					interval: obj[k][pk]?.interval ?? null
				};
			}
			out[k] = pp;
		} else if (k == 'rule-providers' && type(obj[k]) == 'object') {
			let rp = {};
			for (let rk in obj[k]) {
				rp[rk] = {
					type: obj[k][rk]?.type ?? '',
					behavior: obj[k][rk]?.behavior ?? '',
					format: obj[k][rk]?.format ?? ''
				};
			}
			out[k] = rp;
		} else if (k == 'rules' && type(obj[k]) == 'array') {
			out[k] = `[${length(obj[k])} rules]`;
		} else {
			out[k] = obj[k];
		}
	}
	return out;
}

/*
 * Safe, read-only redacted diagnostic bundle.
 * Unlike upstream debug.sh, NEVER enables, modifies, or restarts Nikki!
 */
export function build_diagnostics(ubus) {
	let versions = get_versions();
	let conflicts = detect_conflicts(ubus);
	let ctrl = controller_public_info(resolve_controller());

	let cfg = read_nikki_config(false);
	// Further mask subscription URLs and LAN IPs/MACs in diagnostic bundle
	if (cfg.repeatable?.subscription) {
		for (let sub in cfg.repeatable.subscription) {
			if (sub.url) sub.url = redact_text(sub.url);
			if (sub.info_url) sub.info_url = redact_text(sub.info_url);
		}
	}
	if (cfg.repeatable?.lan_access_control) {
		for (let row in cfg.repeatable.lan_access_control) {
			if (row.ip) row.ip = map(row.ip, () => '***');
			if (row.ip6) row.ip6 = map(row.ip6, () => '***');
			if (row.mac) row.mac = map(row.mac, () => '***');
		}
	}

	let run_summary = {};
	if (access(NIKKI_RUN_CONFIG, 'r') && cmd_exists('yq')) {
		let r = exec_argv(['yq', '-M', '-p', 'yaml', '-o', 'json', NIKKI_RUN_CONFIG], { max_bytes: 1024 * 1024 });
		if (r.code == 0 && length(r.stdout) > 0) {
			try {
				run_summary = redact_runtime_profile(json(r.stdout));
			} catch (e) {}
		}
	}

	let uname_out = trim(exec_argv(['uname', '-a']).stdout);
	let nft_out = cmd_exists('nft') ? trim(exec_argv(['nft', 'list', 'table', 'inet', 'nikki']).stdout) : 'nft not available';
	let ip_rules = cmd_exists('ip') ? trim(exec_argv(['ip', 'rule', 'list']).stdout) : 'ip not available';
	let app_tail = read_logs('app', 80, 32768);
	let core_tail = read_logs('core', 80, 32768);

	let bundle = {
		generated_at: time(),
		redacted: true,
		versions: versions,
		kernel: uname_out,
		controller: ctrl,
		conflicts: conflicts,
		uci_summary: cfg,
		runtime_config_summary: run_summary,
		ip_rules: ip_rules,
		nft_nikki_present: length(nft_out) > 0 && index(nft_out, 'table inet nikki') >= 0,
		recent_app_log: app_tail.ok ? app_tail.lines : [],
		recent_core_log: core_tail.ok ? core_tail.lines : []
	};

	let md = [
		'# NikkiDash Diagnostic Bundle (Redacted)',
		'',
		`- Generated At (epoch): ${bundle.generated_at}`,
		`- NikkiDash: ${versions.dash}`,
		`- Nikki: ${versions.nikki || 'unknown'}`,
		`- Mihomo: ${versions.core || 'unknown'}`,
		`- OpenWrt: ${versions.openwrt || 'unknown'}`,
		`- Kernel: ${uname_out}`,
		`- Controller: ${ctrl.configured ? `${ctrl.protocol}://${ctrl.listen_addr} (loopback_only=${ctrl.loopback_only})` : 'not configured'}`,
		`- Conflicts: ${length(conflicts) > 0 ? join(', ', map(conflicts, (c) => c.service)) : 'none'}`,
		`- nftables inet nikki: ${bundle.nft_nikki_present ? 'loaded' : 'not loaded'}`,
		'',
		'## Redacted UCI Config',
		'```json',
		sprintf('%J', cfg),
		'```',
		'',
		'## Redacted Runtime Profile Summary',
		'```json',
		sprintf('%J', run_summary),
		'```',
		'',
		'## IP Rules',
		'```',
		ip_rules,
		'```',
		'',
		'## Recent App Log (Redacted)',
		'```',
		join('\n', bundle.recent_app_log),
		'```',
		'',
		'## Recent Core Log (Redacted)',
		'```',
		join('\n', bundle.recent_core_log),
		'```'
	];

	return ok_res({
		generated_at: bundle.generated_at,
		redacted: true,
		markdown: join('\n', md),
		summary: bundle
	});
};
