'use strict';

import {
	open, readfile, writefile, stat, lstat, lsdir, mkdir, unlink, rename,
	access, chmod, realpath
} from 'fs';

export const DASH_VERSION = '0.6.0';
export const SCHEMA_PATH = '/usr/share/nikki-dash/schema.json';
export const RUNTIME_DIR = '/var/run/nikki-dash';
export const TASKS_DIR = '/var/run/nikki-dash/tasks';
export const UPLOADS_DIR = '/var/run/nikki-dash/uploads';
export const LOCK_DIR = '/var/run/nikki-dash/write.lock';
export const TMP_DIR = '/tmp/nikki-dash';
export const BACKUP_DIR = '/etc/nikki/.nikki-dash-backups';

export const NIKKI_HOME = '/etc/nikki';
export const NIKKI_PROFILES_DIR = '/etc/nikki/profiles';
export const NIKKI_SUBSCRIPTIONS_DIR = '/etc/nikki/subscriptions';
export const NIKKI_MIXIN_PATH = '/etc/nikki/mixin.yaml';
export const NIKKI_RUN_DIR = '/etc/nikki/run';
export const NIKKI_RUN_CONFIG = '/etc/nikki/run/config.yaml';
export const NIKKI_RULE_PROVIDERS_DIR = '/etc/nikki/run/providers/rule';
export const NIKKI_PROXY_PROVIDERS_DIR = '/etc/nikki/run/providers/proxy';
export const NIKKI_APP_LOG = '/var/log/nikki/app.log';
export const NIKKI_CORE_LOG = '/var/log/nikki/core.log';
export const NIKKI_PID_FILE = '/var/run/nikki/nikki.pid';
export const NIKKI_STARTED_FLAG = '/var/run/nikki/started.flag';

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_LOG_BYTES = 256 * 1024;
export const MAX_BACKUPS_PER_TARGET = 5;

export function ensure_dir(path, mode) {
	if (stat(path)) return true;
	let parts = split(path, '/');
	let cur = '';
	for (let i = 0; i < length(parts); i++) {
		if (parts[i] == '') continue;
		cur = cur + '/' + parts[i];
		if (!stat(cur)) {
			mkdir(cur, mode ?? 0o755);
		}
	}
	return stat(path) != null;
};

export function rand_hex(bytes) {
	let n = bytes ?? 16;
	let f = open('/dev/urandom', 'r');
	if (f) {
		let raw = f.read(n);
		f.close();
		if (raw && length(raw) > 0) {
			let out = '';
			for (let i = 0; i < length(raw); i++) {
				out += sprintf('%02x', ord(raw, i));
			}
			return out;
		}
	}
	return sprintf('%08x%08x', time(), int(time() * 2654435761) & 0xffffffff);
};

export function make_tmp_file(prefix) {
	ensure_dir(TMP_DIR, 0o700);
	let p = `${TMP_DIR}/${prefix ?? 'tmp'}-${time()}-${rand_hex(6)}`;
	let f = open(p, 'w', 0o600);
	if (f) f.close();
	chmod(p, 0o600);
	return p;
};

export function safe_unlink(path) {
	if (path && lstat(path)) {
		unlink(path);
	}
};

export function write_file_atomic(target_path, content, mode) {
	let idx = rindex(target_path, '/');
	let parent = idx > 0 ? substr(target_path, 0, idx) : '/';
	ensure_dir(parent, 0o755);

	let st = lstat(target_path);
	if (st && st.type == 'link') {
		return { ok: false, error: 'Refusing to write through symbolic link' };
	}

	let tmp = `${parent}/.nikki-dash-tmp-${rand_hex(8)}`;
	let f = open(tmp, 'w', mode ?? 0o600);
	if (!f) {
		return { ok: false, error: `Failed to create temp file in ${parent}` };
	}
	let written = f.write(content);
	f.close();
	chmod(tmp, mode ?? 0o600);

	if (written == null) {
		safe_unlink(tmp);
		return { ok: false, error: 'Failed writing temp file' };
	}
	if (!rename(tmp, target_path)) {
		safe_unlink(tmp);
		return { ok: false, error: `Atomic rename failed for ${target_path}` };
	}
	return { ok: true };
};

/*
 * Safe command execution WITHOUT shell interpolation of arguments.
 * Uses a constant wrapper that shifts out stdout/stderr paths and invokes exec "$@".
 */
export function exec_argv(argv, opts) {
	if (type(argv) != 'array' || length(argv) == 0) {
		return { code: -1, stdout: '', stderr: 'Empty argv' };
	}
	ensure_dir(TMP_DIR, 0o700);
	let out_path = make_tmp_file('out');
	let err_path = make_tmp_file('err');
	let max_out = opts?.max_bytes ?? (2 * 1024 * 1024);

	let cmd = [
		'/bin/sh', '-c',
		'out="$1"; err="$2"; shift 2; exec "$@" >"$out" 2>"$err"',
		'_nd_exec', out_path, err_path, ...argv
	];

	let code = system(cmd);
	let stdout = '';
	let stderr = '';
	let out_f = open(out_path, 'r');
	if (out_f) {
		stdout = out_f.read(max_out) ?? '';
		out_f.close();
	}
	let err_f = open(err_path, 'r');
	if (err_f) {
		stderr = err_f.read(65536) ?? '';
		err_f.close();
	}
	safe_unlink(out_path);
	safe_unlink(err_path);

	return { code: code, stdout: stdout, stderr: stderr };
};

export function cmd_exists(bin) {
	if (!bin || !match(bin, /^[A-Za-z0-9._-]+$/)) return false;
	let paths = ['/usr/bin', '/usr/sbin', '/bin', '/sbin'];
	for (let p in paths) {
		if (access(`${p}/${bin}`, 'x')) return true;
	}
	return false;
};

export function acquire_lock(owner, ttl_sec) {
	ensure_dir(RUNTIME_DIR, 0o755);
	let ttl = ttl_sec ?? 180;
	let meta_path = `${LOCK_DIR}/meta.json`;

	if (mkdir(LOCK_DIR, 0o700)) {
		write_file_atomic(meta_path, sprintf('%J', {
			owner: owner ?? 'unknown',
			created_at: time(),
			expires_at: time() + ttl
		}), 0o600);
		return { ok: true };
	}

	// Check stale lock
	let raw = readfile(meta_path);
	if (raw) {
		try {
			let meta = json(raw);
			if (meta && meta.expires_at && time() > meta.expires_at) {
				safe_unlink(meta_path);
				system(['rmdir', LOCK_DIR]);
				if (mkdir(LOCK_DIR, 0o700)) {
					write_file_atomic(meta_path, sprintf('%J', {
						owner: owner ?? 'unknown',
						created_at: time(),
						expires_at: time() + ttl
					}), 0o600);
					return { ok: true };
				}
			}
		} catch (e) {}
	}
	return { ok: false, error: 'Another write operation is currently in progress', code: 'LOCKED' };
};

export function release_lock() {
	safe_unlink(`${LOCK_DIR}/meta.json`);
	system(['rmdir', LOCK_DIR]);
};

export function compute_hash_str(str) {
	let s = str ?? '';
	let tmp = make_tmp_file('hash');
	writefile(tmp, s);
	let digest = '';
	if (cmd_exists('sha256sum')) {
		let r = exec_argv(['sha256sum', tmp]);
		if (r.code == 0 && length(r.stdout) >= 64) {
			digest = substr(trim(r.stdout), 0, 64);
		}
	}
	safe_unlink(tmp);
	if (length(digest) > 0) return digest;

	// Pure-ucode fallback deterministic FNV-1a-like digest
	let h1 = 2166136261;
	let h2 = 0x811c9dc5;
	for (let i = 0; i < length(s); i++) {
		let c = ord(s, i);
		h1 = ((h1 ^ c) * 16777619) & 0xffffffff;
		h2 = ((h2 ^ (c + i)) * 2246822519) & 0xffffffff;
	}
	return sprintf('%08x%08x%08x', h1, h2, length(s));
};

export function compute_config_revision() {
	let uci_raw = readfile('/etc/config/nikki') ?? '';
	let mixin_raw = readfile(NIKKI_MIXIN_PATH) ?? '';
	return compute_hash_str(`uci:${uci_raw}\n---\nmixin:${mixin_raw}`);
};

export function is_valid_basename(name) {
	if (type(name) != 'string') return false;
	if (length(name) < 1 || length(name) > 128) return false;
	if (name == '.' || name == '..') return false;
	if (index(name, '/') >= 0 || index(name, '\\') >= 0 || index(name, '\0') >= 0) return false;
	if (substr(name, 0, 1) == '.') return false;
	return match(name, /^[A-Za-z0-9._-]+$/) != null;
};

export function is_valid_section_id(id) {
	if (type(id) != 'string') return false;
	if (length(id) < 1 || length(id) > 64) return false;
	return match(id, /^[A-Za-z0-9_]+$/) != null;
};

export function url_encode(str) {
	if (type(str) != 'string') return '';
	let out = '';
	for (let i = 0; i < length(str); i++) {
		let c = ord(str, i);
		if (
			(c >= 48 && c <= 57) ||
			(c >= 65 && c <= 90) ||
			(c >= 97 && c <= 122) ||
			c == 45 || c == 46 || c == 95 || c == 126
		) {
			out += chr(c);
		} else {
			out += sprintf('%%%02X', c);
		}
	}
	return out;
};

export function redact_text(text) {
	if (type(text) != 'string' || length(text) == 0) return '';
	let out = text;
	// Redact credentials embedded in URLs: scheme://user:pass@host
	out = replace(out, /(https?:\/\/)([^\/ \t\r\n:@]+):([^\/ \t\r\n@]+)@/gi, (m, p1) => `${p1}***:***@`);
	// Redact sensitive query params (token, key, secret, password, auth, sub, pass)
	out = replace(out, /([?&](token|key|secret|password|pass|auth|access_token|api_key)=)([^& \t\r\n'"<>]+)/gi, (m, p1) => `${p1}***`);
	// Redact Bearer / Authorization headers
	out = replace(out, /(Bearer[ \t]+)[A-Za-z0-9._~+\/-]+=*/gi, (m, p1) => `${p1}***`);
	// Redact YAML/JSON secret/password/token values
	out = replace(out, /((secret|api_secret|password|private-key|token)[ \t]*[:=][ \t]*['"]?)([^] \t\r\n'",}]+)/gi, (m, p1) => `${p1}***`);
	return out;
};

export function is_safe_url(url) {
	if (type(url) != 'string') return false;
	if (length(url) < 8 || length(url) > 2048) return false;
	if ((index(url, chr(0)) >= 0 || match(url, /[\r\n\t ]/))) return false;
	return match(url, /^https?:\/\/[][A-Za-z0-9._~:@-]+(\/[^ \t\r\n]*)?$/i) != null;
};

export function get_caller_session(ubus, req) {
	// Note: Never call ubus.call('session', ...) synchronously from inside an rpcd plugin
	// because rpcd hosts 'session' in the same single-threaded uloop.
	// rpcd itself enforces ACLs before invoking nikki-dash methods.
	let sid = req?.args?.ubus_rpc_session ?? '';
	let authenticated = length(sid) == 32 && sid != '00000000000000000000000000000000';
	return {
		authenticated: authenticated,
		sid: sid
	};
};

export function err_res(code, message, extra) {
	let r = { ok: false, error_code: code, error: message };
	if (extra && type(extra) == 'object') {
		for (let k in extra) r[k] = extra[k];
	}
	return r;
};

export function ok_res(data) {
	let r = { ok: true };
	if (data && type(data) == 'object') {
		for (let k in data) r[k] = data[k];
	}
	return r;
};
