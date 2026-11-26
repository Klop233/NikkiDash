'use strict';

import { access, open, readfile } from 'fs';
import { cursor } from 'uci';
import {
	NIKKI_RUN_CONFIG, exec_argv, make_tmp_file, safe_unlink,
	url_encode, is_safe_url, redact_text, err_res, ok_res
} from '/usr/share/nikki-dash/lib/common.uc';

function parse_hostport(addr) {
	if (type(addr) != 'string' || length(trim(addr)) == 0) return null;
	let s = trim(addr);
	let host = '';
	let port = 0;

	if (substr(s, 0, 1) == '[') {
		let rb = index(s, ']');
		if (rb < 0) return null;
		host = substr(s, 1, rb - 1);
		let rest = substr(s, rb + 1);
		if (substr(rest, 0, 1) != ':') return null;
		port = int(substr(rest, 1));
	} else {
		let ci = rindex(s, ':');
		if (ci < 0) return null;
		host = substr(s, 0, ci);
		port = int(substr(s, ci + 1));
	}
	if (port < 1 || port > 65535) return null;
	return { raw: s, host: host, port: port };
}

function is_loopback_host(host) {
	return host == '127.0.0.1' || host == '::1' || host == 'localhost';
}

function is_wildcard_host(host) {
	return host == '' || host == '0.0.0.0' || host == '::' || host == '*';
}

/*
 * Reads effective controller config:
 * - When Nikki is running (or is_running == null/true): prefers generated /etc/nikki/run/config.yaml
 *   and falls back to UCI nikki.mixin.
 * - When Nikki is stopped (is_running === false): prefers UCI nikki.mixin so edits (like fixing
 *   api_listen to 127.0.0.1:9090) reflect immediately without waiting for the next restart.
 */
export function resolve_controller(is_running) {
	let profile = {};
	let source = 'none';
	let prefer_run = (is_running !== false);

	let uci = cursor();
	let uci_listen = uci.get('nikki', 'mixin', 'api_listen');
	let uci_tls_listen = uci.get('nikki', 'mixin', 'api_tls_listen');
	let uci_secret = uci.get('nikki', 'mixin', 'api_secret');

	let api_listen = null;
	let api_tls_listen = null;
	let secret = null;

	if (prefer_run && access(NIKKI_RUN_CONFIG, 'r')) {
		let r = exec_argv(['yq', '-M', '-p', 'yaml', '-o', 'json', NIKKI_RUN_CONFIG], { max_bytes: 1024 * 1024 });
		if (r.code == 0 && length(r.stdout) > 0) {
			try {
				profile = json(r.stdout) ?? {};
				api_listen = profile['external-controller'];
				api_tls_listen = profile['external-controller-tls'];
				secret = profile['secret'];
				if (api_listen || api_tls_listen) source = 'run_config';
			} catch (e) {}
		}
	}

	if (!api_listen && !api_tls_listen) {
		api_listen = uci_listen;
		api_tls_listen = uci_tls_listen;
		secret = uci_secret;
		if (api_listen || api_tls_listen) source = prefer_run ? 'uci_fallback' : 'uci';
	}

	if (!prefer_run && !api_listen && !api_tls_listen && access(NIKKI_RUN_CONFIG, 'r')) {
		let r = exec_argv(['yq', '-M', '-p', 'yaml', '-o', 'json', NIKKI_RUN_CONFIG], { max_bytes: 1024 * 1024 });
		if (r.code == 0 && length(r.stdout) > 0) {
			try {
				profile = json(r.stdout) ?? {};
				api_listen = profile['external-controller'];
				api_tls_listen = profile['external-controller-tls'];
				secret = profile['secret'];
				if (api_listen || api_tls_listen) source = 'run_config';
			} catch (e) {}
		}
	}

	let use_tls = (type(api_tls_listen) == 'string' && length(trim(api_tls_listen)) > 0);
	let raw_addr = use_tls ? api_tls_listen : api_listen;
	let parsed = parse_hostport(raw_addr);

	if (!parsed) {
		return {
			configured: false,
			source: source,
			protocol: 'http',
			listen_addr: '',
			loopback_url: '',
			loopback_only: true,
			exposed_warning: false,
			secret: ''
		};
	}

	let exposed_warning = false;
	let loopback_only = is_loopback_host(parsed.host);
	let connect_host = '127.0.0.1';

	if (is_wildcard_host(parsed.host)) {
		exposed_warning = true;
		connect_host = (parsed.host == '::') ? '127.0.0.1' : '127.0.0.1';
	} else if (is_loopback_host(parsed.host)) {
		connect_host = (parsed.host == '::1') ? '[::1]' : '127.0.0.1';
	} else {
		// Non-loopback specific IP (e.g., 192.168.100.1:9090): warn that it is reachable from LAN,
		// and only connect if it is a local address (still prefer loopback if wildcard, else warn).
		exposed_warning = true;
		connect_host = index(parsed.host, ':') >= 0 ? `[${parsed.host}]` : parsed.host;
	}

	let proto = use_tls ? 'https' : 'http';
	let loopback_url = `${proto}://${connect_host}:${parsed.port}`;

	return {
		configured: true,
		source: source,
		protocol: proto,
		listen_addr: parsed.raw,
		host: parsed.host,
		port: parsed.port,
		loopback_url: loopback_url,
		loopback_only: loopback_only,
		exposed_warning: exposed_warning,
		secret: secret ?? ''
	};
};

export function controller_public_info(ctrl) {
	let c = ctrl ?? resolve_controller();
	return {
		configured: c.configured,
		source: c.source,
		protocol: c.protocol,
		listen_addr: c.listen_addr,
		loopback_only: c.loopback_only,
		exposed_warning: c.exposed_warning,
		has_secret: length(c.secret ?? '') > 0
	};
};

/*
 * Internal allowlisted HTTP call to Mihomo controller.
 * Secret is passed via a 0600 temp curl config file — NEVER visible in argv/ps or shell!
 */
function mihomo_request(method, path, opts) {
	let ctrl = opts?.controller ?? resolve_controller();
	if (!ctrl.configured) {
		return err_res('CONTROLLER_UNCONFIGURED', 'Mihomo controller address is not configured');
	}

	let timeout_sec = opts?.timeout_sec ?? 8;
	if (timeout_sec < 1) timeout_sec = 1;
	if (timeout_sec > 20) timeout_sec = 20;

	let max_bytes = opts?.max_bytes ?? (2 * 1024 * 1024);
	let cfg_file = make_tmp_file('curlcfg');
	let body_file = null;
	let out_file = make_tmp_file('curlout');

	let cfg_lines = [];
	if (length(ctrl.secret) > 0) {
		let safe_sec = replace(ctrl.secret, /["\\\r\n]/g, '');
		push(cfg_lines, `header = "Authorization: Bearer ${safe_sec}"`);
	}
	if (opts?.json_body != null) {
		body_file = make_tmp_file('curlbody');
		let bfile_h = open(body_file, 'w', 0o600);
		if (bfile_h) {
			bfile_h.write(sprintf('%J', opts.json_body));
			bfile_h.close();
		}
		push(cfg_lines, 'header = "Content-Type: application/json"');
	}
	let cf = open(cfg_file, 'w', 0o600);
	if (cf) {
		cf.write(join('\n', cfg_lines) + '\n');
		cf.close();
	}

	let full_url = ctrl.loopback_url + path;
	if (opts?.query && length(opts.query) > 0) {
		full_url += '?' + opts.query;
	}

	let argv = [
		'curl', '-sS',
		'--connect-timeout', '3',
		'--max-time', sprintf('%d', timeout_sec),
		'--config', cfg_file,
		'-X', method,
		'-o', out_file,
		'-w', '%{http_code}'
	];
	if (ctrl.protocol == 'https') {
		push(argv, '--insecure');
	}
	if (body_file) {
		push(argv, '--data-binary', `@${body_file}`);
	}
	push(argv, full_url);

	let r = exec_argv(argv, { max_bytes: 256 });
	let raw_body = readfile(out_file) ?? '';
	if (length(raw_body) > max_bytes) {
		raw_body = substr(raw_body, 0, max_bytes);
	}

	safe_unlink(cfg_file);
	safe_unlink(body_file);
	safe_unlink(out_file);

	if (r.code != 0) {
		let err_msg = trim(redact_text(r.stderr || 'Failed to connect to Mihomo controller'));
		let err_code = (r.code == 28) ? 'CONTROLLER_TIMEOUT' : 'CONTROLLER_UNREACHABLE';
		return err_res(err_code, err_msg);
	}

	let http_code = int(trim(r.stdout));
	let parsed = null;
	if (length(raw_body) > 0) {
		try {
			parsed = json(raw_body);
		} catch (e) {
			parsed = null;
		}
	}

	if (http_code == 401 || http_code == 403) {
		return err_res('CONTROLLER_AUTH_FAILED', 'Mihomo controller rejected API secret (401/403)', { http_code: http_code });
	}
	if (http_code < 200 || http_code >= 300) {
		let detail = parsed?.message ?? trim(redact_text(substr(raw_body, 0, 300)));
		return err_res('CONTROLLER_HTTP_ERROR', detail || `Mihomo returned HTTP ${http_code}`, { http_code: http_code });
	}

	return ok_res({ http_code: http_code, data: parsed ?? {} });
}

/* ==================== Strictly Allowlisted Operations ==================== */

export function api_version(ctrl) {
	return mihomo_request('GET', '/version', { controller: ctrl, timeout_sec: 3 });
};

export function api_get_configs(ctrl) {
	return mihomo_request('GET', '/configs', { controller: ctrl, timeout_sec: 4 });
};

export function api_set_mode(mode) {
	if (mode != 'rule' && mode != 'global' && mode != 'direct') {
		return err_res('INVALID_PARAM', 'Mode must be rule, global, or direct');
	}
	return mihomo_request('PATCH', '/configs', { json_body: { mode: mode }, timeout_sec: 5 });
};

export function api_get_proxies() {
	return mihomo_request('GET', '/proxies', { timeout_sec: 6, max_bytes: 3 * 1024 * 1024 });
};

export function api_get_proxy_providers() {
	return mihomo_request('GET', '/providers/proxies', { timeout_sec: 6, max_bytes: 3 * 1024 * 1024 });
};

export function api_select_proxy(group, name) {
	if (type(group) != 'string' || length(group) == 0 || length(group) > 256 || (index(group, chr(0)) >= 0 || match(group, /[\r\n]/))) {
		return err_res('INVALID_PARAM', 'Invalid proxy group name');
	}
	if (type(name) != 'string' || length(name) == 0 || length(name) > 256 || (index(name, chr(0)) >= 0 || match(name, /[\r\n]/))) {
		return err_res('INVALID_PARAM', 'Invalid proxy node name');
	}
	return mihomo_request('PUT', `/proxies/${url_encode(group)}`, {
		json_body: { name: name },
		timeout_sec: 6
	});
};

export function api_test_delay(kind, name, test_url, timeout_ms) {
	if (kind != 'proxy' && kind != 'group') {
		return err_res('INVALID_PARAM', 'Delay test kind must be proxy or group');
	}
	if (type(name) != 'string' || length(name) == 0 || length(name) > 256 || (index(name, chr(0)) >= 0 || match(name, /[\r\n]/))) {
		return err_res('INVALID_PARAM', 'Invalid target name');
	}
	let url = (type(test_url) == 'string' && length(trim(test_url)) > 0) ? trim(test_url) : 'https://www.gstatic.com/generate_204';
	if (!is_safe_url(url)) {
		return err_res('INVALID_PARAM', 'Invalid delay test URL');
	}
	let ms = int(timeout_ms ?? 5000);
	if (ms < 500) ms = 500;
	if (ms > 10000) ms = 10000;

	let path = (kind == 'group')
		? `/group/${url_encode(name)}/delay`
		: `/proxies/${url_encode(name)}/delay`;
	let query = `url=${url_encode(url)}&timeout=${ms}`;
	let res = mihomo_request('GET', path, {
		query: query,
		timeout_sec: int(ms / 1000) + 4
	});
	// Mihomo returns HTTP 503/504 when a node times out during delay testing; normalize cleanly to delay=0
	if (!res.ok && (res.error_code == 'CONTROLLER_HTTP_ERROR' && (res.http_code == 503 || res.http_code == 504 || res.http_code == 408) || res.error_code == 'CONTROLLER_TIMEOUT')) {
		return ok_res({
			http_code: res.http_code ?? 504,
			data: { delay: 0, timeout: true, message: res.error }
		});
	}
	return res;
};

export function api_get_connections() {
	return mihomo_request('GET', '/connections', { timeout_sec: 5, max_bytes: 3 * 1024 * 1024 });
};

export function api_close_connection(id) {
	if (type(id) != 'string' || !match(id, /^[A-Za-z0-9._-]{1,128}$/)) {
		return err_res('INVALID_PARAM', 'Invalid connection ID');
	}
	return mihomo_request('DELETE', `/connections/${url_encode(id)}`, { timeout_sec: 5 });
};

export function api_close_all_connections() {
	return mihomo_request('DELETE', '/connections', { timeout_sec: 5 });
};

export function api_flush_fakeip() {
	return mihomo_request('POST', '/cache/fakeip/flush', { timeout_sec: 5 });
};

export function api_get_rules() {
	return mihomo_request('GET', '/rules', { timeout_sec: 6, max_bytes: 3 * 1024 * 1024 });
};

export function api_get_rule_providers() {
	return mihomo_request('GET', '/providers/rules', { timeout_sec: 6, max_bytes: 2 * 1024 * 1024 });
};

export function api_update_provider(kind, name) {
	if (kind != 'rule' && kind != 'proxy') {
		return err_res('INVALID_PARAM', 'Provider kind must be rule or proxy');
	}
	if (type(name) != 'string' || length(name) == 0 || length(name) > 256 || (index(name, chr(0)) >= 0 || match(name, /[\r\n\/\\]/))) {
		return err_res('INVALID_PARAM', 'Invalid provider name');
	}
	let path = (kind == 'rule')
		? `/providers/rules/${url_encode(name)}`
		: `/providers/proxies/${url_encode(name)}`;
	return mihomo_request('PUT', path, { timeout_sec: 20 });
};
