'use strict';

import { access, lstat, readfile } from 'fs';
import { cursor } from 'uci';
import {
	DASH_VERSION, RUNTIME_DIR, exec_argv, ensure_dir, cmd_exists,
	write_file_atomic, redact_text, err_res, ok_res
} from '/usr/share/nikki-dash/lib/common.uc';

const NETCHECK = '/usr/libexec/nikki-dash/netcheck.uc';

function to_list(v) {
	if (v == null) return [];
	if (type(v) == 'array') return v;
	return [sprintf('%s', v)];
}

export function get_access_config(ubus) {
	let uci = cursor();
	let enabled = uci.get('nikki_dash', 'main', 'enabled') ?? '1';
	let access_mode = uci.get('nikki_dash', 'main', 'access_mode') ?? 'lan_auth';
	let http_port = int(uci.get('nikki_dash', 'main', 'http_port') ?? '18080');
	let https_port = int(uci.get('nikki_dash', 'main', 'https_port') ?? '18443');
	let listen_interfaces = to_list(uci.get('nikki_dash', 'main', 'listen_interface'));
	if (length(listen_interfaces) == 0) listen_interfaces = ['lan'];
	let cert = uci.get('nikki_dash', 'main', 'cert') ?? '/etc/nikki-dash/server.crt';
	let key = uci.get('nikki_dash', 'main', 'key') ?? '/etc/nikki-dash/server.key';
	let session_timeout = int(uci.get('nikki_dash', 'main', 'session_timeout') ?? '3600');
	let wan_risk_acknowledged = uci.get('nikki_dash', 'main', 'wan_risk_acknowledged') == '1';
	let theme = uci.get('nikki_dash', 'main', 'theme') ?? 'system';
	let lang = uci.get('nikki_dash', 'main', 'lang') ?? 'zh-CN';

	let ssl_lib = access('/lib/libustream-ssl.so', 'r') || access('/usr/lib/libustream-ssl.so', 'r');
	let cert_exists = lstat(cert) != null && lstat(cert).type == 'file';
	let key_exists = lstat(key) != null && lstat(key).type == 'file';
	let can_gen_cert = cmd_exists('px5g') || cmd_exists('openssl');

	let rpcd_guest = cursor().get('rpcd', 'nikki_dash_guest') != null;
	let lan_addrs = [];
	let r = exec_argv(['ucode', '-S', NETCHECK, 'resolve_lan', sprintf('%d', http_port)]);
	if (r.code == 0 && length(trim(r.stdout)) > 0) {
		lan_addrs = split(trim(r.stdout), /[ \t\r\n]+/);
	}

	let last_service_error = trim(readfile(`${RUNTIME_DIR}/service.error`) ?? '');

	return {
		version: DASH_VERSION,
		enabled: enabled == '1',
		access_mode: access_mode,
		http_port: http_port,
		https_port: https_port,
		listen_interfaces: listen_interfaces,
		cert: cert,
		key: key,
		cert_exists: cert_exists,
		key_exists: key_exists,
		ssl_supported: ssl_lib,
		can_generate_cert: can_gen_cert,
		session_timeout: session_timeout,
		wan_risk_acknowledged: wan_risk_acknowledged,
		lan_guest_active: rpcd_guest && access_mode == 'lan_guest',
		effective_listen_addrs: access_mode == 'wan_https'
			? [`0.0.0.0:${https_port}`, `[::]:${https_port}`]
			: lan_addrs,
		theme: theme,
		lang: lang,
		last_service_error: last_service_error,
		security_notes: {
			ubus_admin_boundary: 'Standard uhttpd /ubus is a general ubus RPC bridge. An authenticated root session has full router administrator privileges; NikkiDash ACLs do not narrow root permissions.',
			wan_firewall_manual: 'NikkiDash never opens WAN firewall ports automatically. You must manually configure firewall4 rules or reverse-proxy/VPN access if using WAN HTTPS.',
			recovery_cli: 'uci set nikki_dash.main.access_mode=lan_auth && uci set nikki_dash.main.http_port=18080 && uci commit nikki_dash && /etc/init.d/nikki-dash restart'
		}
	};
};

export function revoke_guest_sessions(ubus) {
	// Synchronously remove rpcd guest login section so no new guest logins can succeed
	let ruci = cursor();
	if (ruci.get('rpcd', 'nikki_dash_guest') != null) {
		ruci.delete('rpcd', 'nikki_dash_guest');
		ruci.commit('rpcd');
	}
	// Destroy active guest sessions in a detached child outside rpcd's single-threaded uloop
	system([
		'/bin/sh', '-c',
		'ucode -S /usr/libexec/nikki-dash/revoke_guest.uc >/dev/null 2>&1 </dev/null &'
	]);
};

export function generate_self_signed_cert(cert_path, key_path) {
	let idx = rindex(cert_path, '/');
	let dir = idx > 0 ? substr(cert_path, 0, idx) : '/etc/nikki-dash';
	ensure_dir(dir, 0o700);

	if (cmd_exists('px5g')) {
		let r = exec_argv([
			'px5g', 'selfsigned', '-der',
			'-days', '397',
			'-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
			'-keyout', key_path,
			'-out', cert_path,
			'-subj', '/CN=NikkiDash/O=OpenWrt'
		]);
		if (r.code == 0) return ok_res({ generated: true, tool: 'px5g' });
		return err_res('CERT_GEN_FAILED', trim(redact_text(r.stderr || 'px5g failed')));
	}

	if (cmd_exists('openssl')) {
		let r = exec_argv([
			'openssl', 'req', '-x509', '-sha256', '-nodes',
			'-days', '397',
			'-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
			'-keyout', key_path,
			'-out', cert_path,
			'-subj', '/CN=NikkiDash/O=OpenWrt'
		]);
		if (r.code == 0) return ok_res({ generated: true, tool: 'openssl' });
		return err_res('CERT_GEN_FAILED', trim(redact_text(r.stderr || 'openssl failed')));
	}

	return err_res('NO_CERT_TOOL', 'Neither px5g nor openssl is installed to generate a TLS certificate');
};

export function set_access_config(ubus, caller, args) {
	// rpcd ACL strictly restricts set_access to non-guest authenticated users ('nikki-dash' ACL).
	// Also reject calls without a non-default session unless invoked locally over ubus CLI as root.
	if (caller && caller.sid == '00000000000000000000000000000000') {
		return err_res('FORBIDDEN', 'Authentication required to change panel access settings');
	}

	let cur = get_access_config(ubus);
	let access_mode = args.access_mode ?? cur.access_mode;
	if (access_mode != 'lan_auth' && access_mode != 'lan_guest' && access_mode != 'wan_https') {
		return err_res('INVALID_PARAM', 'access_mode must be lan_auth, lan_guest, or wan_https');
	}

	let http_port = int(args.http_port ?? cur.http_port);
	let https_port = int(args.https_port ?? cur.https_port);
	let session_timeout = int(args.session_timeout ?? cur.session_timeout);
	let cert = args.cert ?? cur.cert;
	let key = args.key ?? cur.key;
	let theme = args.theme ?? cur.theme;
	let lang = args.lang ?? cur.lang;
	let listen_interfaces = args.listen_interfaces ?? cur.listen_interfaces;

	if (http_port < 1024 || http_port > 65535) {
		return err_res('INVALID_PORT', 'HTTP port must be between 1024 and 65535');
	}
	if (https_port < 1024 || https_port > 65535) {
		return err_res('INVALID_PORT', 'HTTPS port must be between 1024 and 65535');
	}
	if (session_timeout < 300 || session_timeout > 86400) {
		return err_res('INVALID_PARAM', 'session_timeout must be between 300 and 86400 seconds');
	}
	if (theme != 'system' && theme != 'dark' && theme != 'light') {
		return err_res('INVALID_PARAM', 'theme must be system, dark, or light');
	}
	if (lang != 'zh-CN' && lang != 'en-US') {
		return err_res('INVALID_PARAM', 'lang must be zh-CN or en-US');
	}
	if (type(cert) != 'string' || substr(cert, 0, 1) != '/' || index(cert, '..') >= 0 || (index(cert, chr(0)) >= 0 || match(cert, /[\r\n]/))) {
		return err_res('INVALID_PATH', 'Certificate path must be a clean absolute path');
	}
	if (type(key) != 'string' || substr(key, 0, 1) != '/' || index(key, '..') >= 0 || (index(key, chr(0)) >= 0 || match(key, /[\r\n]/))) {
		return err_res('INVALID_PATH', 'Private key path must be a clean absolute path');
	}

	let clean_ifaces = [];
	for (let iface in to_list(listen_interfaces)) {
		let t = trim(sprintf('%s', iface));
		if (match(t, /^[A-Za-z0-9_.-]{1,32}$/)) push(clean_ifaces, t);
	}
	if (length(clean_ifaces) == 0) clean_ifaces = ['lan'];

	// Check port conflict if port changed or mode switched port
	let target_port = (access_mode == 'wan_https') ? https_port : http_port;
	let current_active_port = (cur.access_mode == 'wan_https') ? cur.https_port : cur.http_port;
	if (target_port != current_active_port) {
		let pchk = exec_argv(['ucode', '-S', NETCHECK, 'check_port', sprintf('%d', target_port)]);
		if (pchk.code != 0) {
			return err_res('PORT_CONFLICT', `Target port ${target_port} is already in use on this router`);
		}
	}

	// WAN HTTPS strict preconditions
	if (access_mode == 'wan_https') {
		if (!args.confirm_wan_risk) {
			return err_res('WAN_CONFIRM_REQUIRED', 'Enabling WAN HTTPS requires explicit risk acknowledgement');
		}
		if (!cur.ssl_supported) {
			return err_res('SSL_UNAVAILABLE', 'libustream-ssl is not installed; HTTPS cannot be enabled');
		}
		let need_cert = (lstat(cert) == null || lstat(key) == null);
		if (need_cert) {
			if (args.generate_self_signed) {
				let gen = generate_self_signed_cert(cert, key);
				if (!gen.ok) return gen;
			} else {
				return err_res('CERT_MISSING', `TLS certificate (${cert}) or key (${key}) does not exist`);
			}
		}
	}

	// Mutual exclusion: revoke guest identity BEFORE applying wan_https or lan_auth
	if (access_mode != 'lan_guest') {
		revoke_guest_sessions(ubus);
	}

	let uci = cursor();
	if (!uci.get('nikki_dash', 'main')) {
		uci.set('nikki_dash', 'main', 'main');
	}
	uci.set('nikki_dash', 'main', 'access_mode', access_mode);
	uci.set('nikki_dash', 'main', 'http_port', sprintf('%d', http_port));
	uci.set('nikki_dash', 'main', 'https_port', sprintf('%d', https_port));
	uci.set('nikki_dash', 'main', 'cert', cert);
	uci.set('nikki_dash', 'main', 'key', key);
	uci.set('nikki_dash', 'main', 'session_timeout', sprintf('%d', session_timeout));
	uci.set('nikki_dash', 'main', 'wan_risk_acknowledged', access_mode == 'wan_https' ? '1' : '0');
	uci.set('nikki_dash', 'main', 'theme', theme);
	uci.set('nikki_dash', 'main', 'lang', lang);
	uci.delete('nikki_dash', 'main', 'listen_interface');
	uci.set('nikki_dash', 'main', 'listen_interface', clean_ifaces);
	uci.commit('nikki_dash');

	// Configure or remove rpcd guest login
	if (access_mode == 'lan_guest') {
		let empty_hash = trim(exec_argv(['uhttpd', '-m', '']).stdout);
		if (length(empty_hash) == 0) {
			return err_res('GUEST_HASH_FAILED', 'Failed to generate empty-password hash via uhttpd -m');
		}
		let ruci = cursor();
		ruci.set('rpcd', 'nikki_dash_guest', 'login');
		ruci.set('rpcd', 'nikki_dash_guest', 'username', 'nikki-dash-guest');
		ruci.set('rpcd', 'nikki_dash_guest', 'password', empty_hash);
		ruci.delete('rpcd', 'nikki_dash_guest', 'read');
		ruci.delete('rpcd', 'nikki_dash_guest', 'write');
		ruci.set('rpcd', 'nikki_dash_guest', 'read', ['nikki-dash-guest']);
		ruci.set('rpcd', 'nikki_dash_guest', 'write', ['nikki-dash-guest']);
		ruci.commit('rpcd');
	}

	let need_restart = (
		access_mode != cur.access_mode ||
		http_port != cur.http_port ||
		https_port != cur.https_port ||
		cert != cur.cert ||
		key != cur.key ||
		join(',', clean_ifaces) != join(',', cur.listen_interfaces)
	);

	if (need_restart) {
		// Delayed detached reload so the JSON-RPC response reaches the browser cleanly before uhttpd restarts
		system([
			'/bin/sh', '-c',
			'(sleep 1; /etc/init.d/nikki-dash restart) >/dev/null 2>&1 </dev/null &'
		]);
	}

	return ok_res({
		access: get_access_config(ubus),
		restarting: need_restart,
		next_scheme: access_mode == 'wan_https' ? 'https' : 'http',
		next_port: target_port
	});
};
