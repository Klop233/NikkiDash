'use strict';

import { open, readfile, stat, lstat, lsdir, unlink, chmod } from 'fs';
import {
	NIKKI_PROFILES_DIR, NIKKI_SUBSCRIPTIONS_DIR, NIKKI_MIXIN_PATH,
	NIKKI_RUN_CONFIG, NIKKI_RULE_PROVIDERS_DIR, NIKKI_PROXY_PROVIDERS_DIR,
	BACKUP_DIR, UPLOADS_DIR, MAX_FILE_BYTES, MAX_BACKUPS_PER_TARGET,
	ensure_dir, is_valid_basename, rand_hex, write_file_atomic,
	safe_unlink, exec_argv, compute_hash_str, redact_text, err_res, ok_res
} from '/usr/share/nikki-dash/lib/common.uc';

const CATEGORIES = {
	mixin: { dir: null, fixed_path: NIKKI_MIXIN_PATH, writable: true, yaml: true },
	run_config: { dir: null, fixed_path: NIKKI_RUN_CONFIG, writable: false, yaml: true },
	profile: { dir: NIKKI_PROFILES_DIR, fixed_path: null, writable: true, yaml: true },
	subscription: { dir: NIKKI_SUBSCRIPTIONS_DIR, fixed_path: null, writable: true, yaml: true },
	rule_provider: { dir: NIKKI_RULE_PROVIDERS_DIR, fixed_path: null, writable: true, yaml: false },
	proxy_provider: { dir: NIKKI_PROXY_PROVIDERS_DIR, fixed_path: null, writable: true, yaml: true }
};

function is_binary_filename(name) {
	if (type(name) != 'string') return false;
	return match(lc(name), /\.(mrs|dat|mmdb|db|bin|gz|zip|tar|xz)$/) != null;
}

export function resolve_safe_path(category, name, for_write) {
	let spec = CATEGORIES[category];
	if (!spec) {
		return err_res('INVALID_CATEGORY', `Unsupported file category: ${category}`);
	}
	if (for_write && !spec.writable) {
		return err_res('READ_ONLY', `Category "${category}" is read-only`);
	}

	let full_path = '';
	let key_name = '';

	if (spec.fixed_path) {
		full_path = spec.fixed_path;
		key_name = category;
	} else {
		if (!is_valid_basename(name)) {
			return err_res('INVALID_FILENAME', 'Filename must be a plain basename (A-Za-z0-9._-) without path separators');
		}
		if (category == 'profile' || category == 'subscription') {
			if (!match(name, /\.(ya?ml)$/i)) {
				return err_res('INVALID_FILENAME', 'Profile and subscription files must end with .yaml or .yml');
			}
		}
		ensure_dir(spec.dir, 0o755);
		full_path = `${spec.dir}/${name}`;
		key_name = `${category}__${name}`;
	}

	let lst = lstat(full_path);
	if (lst) {
		if (lst.type == 'link') {
			return err_res('SYMLINK_REJECTED', 'Symbolic links are not permitted');
		}
		if (lst.type != 'file') {
			return err_res('NOT_REGULAR_FILE', 'Target is not a regular file');
		}
	}

	return ok_res({
		path: full_path,
		key: key_name,
		writable: spec.writable && !is_binary_filename(name),
		binary: is_binary_filename(name),
		yaml: spec.yaml,
		exists: lst != null,
		size: lst?.size ?? 0,
		mtime: lst?.mtime ?? 0
	});
};

export function validate_yaml_content(content, require_clash_keys) {
	if (type(content) != 'string') {
		return err_res('INVALID_YAML', 'Content must be a string');
	}
	if (length(content) > MAX_FILE_BYTES) {
		return err_res('FILE_TOO_LARGE', `File exceeds maximum allowed size (${MAX_FILE_BYTES} bytes)`);
	}
	ensure_dir(UPLOADS_DIR, 0o700);
	let tmp = `${UPLOADS_DIR}/val-${rand_hex(8)}.yaml`;
	let f = open(tmp, 'w', 0o600);
	if (!f) return err_res('IO_ERROR', 'Failed to allocate temp validation file');
	f.write(content);
	f.close();
	chmod(tmp, 0o600);

	let r = exec_argv(['yq', '-M', '-p', 'yaml', '-o', 'json', '.', tmp], { max_bytes: 512 * 1024 });
	if (r.code != 0) {
		safe_unlink(tmp);
		return err_res('YAML_SYNTAX_ERROR', trim(redact_text(r.stderr || 'YAML syntax validation failed')));
	}

	if (require_clash_keys) {
		let r2 = exec_argv(['yq', '-M', '-p', 'yaml', '-e', 'has("proxies") or has("proxy-providers")', tmp], { max_bytes: 4096 });
		if (r2.code != 0) {
			safe_unlink(tmp);
			return err_res('YAML_SEMANTIC_ERROR', 'Profile YAML must contain "proxies" or "proxy-providers"');
		}
	}

	safe_unlink(tmp);
	return ok_res({});
};

export function backup_file(category, name, full_path) {
	if (!lstat(full_path)) return null;
	let key = (category == 'mixin') ? 'mixin' : `${category}__${name}`;
	let bdir = `${BACKUP_DIR}/${key}`;
	ensure_dir(bdir, 0o700);

	let data = readfile(full_path);
	if (data == null) return null;

	let bid = `${time()}-${rand_hex(4)}.bak`;
	let bpath = `${bdir}/${bid}`;
	write_file_atomic(bpath, data, 0o600);

	// Prune older backups beyond MAX_BACKUPS_PER_TARGET
	let entries = lsdir(bdir) ?? [];
	let files = filter(entries, (e) => match(e, /\.bak$/) != null);
	sort(files);
	while (length(files) > MAX_BACKUPS_PER_TARGET) {
		let oldest = shift(files);
		safe_unlink(`${bdir}/${oldest}`);
	}

	return bid;
};

export function list_file_backups(category, name) {
	let r = resolve_safe_path(category, name, false);
	if (!r.ok) return r;
	let key = (category == 'mixin') ? 'mixin' : `${category}__${name}`;
	let bdir = `${BACKUP_DIR}/${key}`;
	let entries = lsdir(bdir) ?? [];
	let items = [];
	for (let e in entries) {
		if (!match(e, /^[0-9]+-[0-9a-f]+\.bak$/)) continue;
		let st = lstat(`${bdir}/${e}`);
		if (!st || st.type != 'file') continue;
		push(items, { id: e, size: st.size, mtime: st.mtime });
	}
	sort(items, (a, b) => b.mtime - a.mtime);
	return ok_res({ backups: items });
};

export function restore_file_backup(category, name, backup_id) {
	let r = resolve_safe_path(category, name, true);
	if (!r.ok) return r;
	if (!match(backup_id ?? '', /^[0-9]+-[0-9a-f]+\.bak$/)) {
		return err_res('INVALID_BACKUP_ID', 'Invalid backup identifier');
	}
	let key = (category == 'mixin') ? 'mixin' : `${category}__${name}`;
	let bpath = `${BACKUP_DIR}/${key}/${backup_id}`;
	let bst = lstat(bpath);
	if (!bst || bst.type != 'file') {
		return err_res('NOT_FOUND', 'Backup file not found');
	}
	let content = readfile(bpath);
	if (content == null) return err_res('IO_ERROR', 'Failed reading backup file');

	backup_file(category, name, r.path);
	let wr = write_file_atomic(r.path, content, 0o600);
	if (!wr.ok) return err_res('IO_ERROR', wr.error);

	return ok_res({
		restored_from: backup_id,
		size: length(content),
		revision: compute_hash_str(content)
	});
};

export function list_catalog() {
	let out = {
		mixin: [],
		run_config: [],
		profile: [],
		subscription: [],
		rule_provider: [],
		proxy_provider: []
	};

	let m_st = lstat(NIKKI_MIXIN_PATH);
	push(out.mixin, {
		name: 'mixin.yaml',
		category: 'mixin',
		writable: true,
		exists: m_st != null && m_st.type == 'file',
		size: m_st?.size ?? 0,
		mtime: m_st?.mtime ?? 0
	});

	let r_st = lstat(NIKKI_RUN_CONFIG);
	push(out.run_config, {
		name: 'config.yaml',
		category: 'run_config',
		writable: false,
		exists: r_st != null && r_st.type == 'file',
		size: r_st?.size ?? 0,
		mtime: r_st?.mtime ?? 0
	});

	let dir_cats = [
		['profile', NIKKI_PROFILES_DIR],
		['subscription', NIKKI_SUBSCRIPTIONS_DIR],
		['rule_provider', NIKKI_RULE_PROVIDERS_DIR],
		['proxy_provider', NIKKI_PROXY_PROVIDERS_DIR]
	];

	for (let pair in dir_cats) {
		let cat = pair[0];
		let dir = pair[1];
		let entries = lsdir(dir) ?? [];
		sort(entries);
		for (let e in entries) {
			if (!is_valid_basename(e)) continue;
			let st = lstat(`${dir}/${e}`);
			if (!st || st.type != 'file') continue;
			let bin = is_binary_filename(e);
			push(out[cat], {
				name: e,
				category: cat,
				writable: !bin,
				binary: bin,
				exists: true,
				size: st.size,
				mtime: st.mtime
			});
		}
	}

	return ok_res({ files: out });
};

export function read_managed_file(category, name, offset, max_bytes) {
	let r = resolve_safe_path(category, name, false);
	if (!r.ok) return r;
	if (r.binary) {
		return err_res('BINARY_FILE', 'Binary provider/database files (.mrs/.dat/.mmdb) cannot be edited as text', {
			binary: true,
			size: r.size
		});
	}
	if (!r.exists) {
		return ok_res({
			exists: false,
			writable: r.writable,
			content: '',
			size: 0,
			offset: 0,
			eof: true,
			revision: compute_hash_str('')
		});
	}
	if (r.size > MAX_FILE_BYTES) {
		return err_res('FILE_TOO_LARGE', `File size (${r.size}) exceeds display limit (${MAX_FILE_BYTES})`);
	}

	let off = int(offset ?? 0);
	if (off < 0) off = 0;
	let lim = int(max_bytes ?? (512 * 1024));
	if (lim < 1024) lim = 1024;
	if (lim > 1024 * 1024) lim = 1024 * 1024;

	let full = readfile(r.path) ?? '';
	let chunk = substr(full, off, lim);
	let eof = (off + length(chunk)) >= length(full);

	return ok_res({
		exists: true,
		writable: r.writable,
		content: chunk,
		size: length(full),
		mtime: r.mtime,
		offset: off,
		eof: eof,
		revision: compute_hash_str(full)
	});
};

export function save_managed_file(category, name, content, expected_revision, require_clash_keys) {
	let r = resolve_safe_path(category, name, true);
	if (!r.ok) return r;

	if (expected_revision && length(expected_revision) > 0) {
		let cur = r.exists ? (readfile(r.path) ?? '') : '';
		let cur_rev = compute_hash_str(cur);
		if (cur_rev != expected_revision) {
			return err_res('REVISION_CONFLICT', 'File was modified externally; reload before saving', {
				current_revision: cur_rev
			});
		}
	}

	if (r.yaml) {
		let v = validate_yaml_content(content, require_clash_keys == true);
		if (!v.ok) return v;
	} else if (length(content ?? '') > MAX_FILE_BYTES) {
		return err_res('FILE_TOO_LARGE', 'File exceeds size limit');
	}

	let bid = r.exists ? backup_file(category, name, r.path) : null;
	let wr = write_file_atomic(r.path, content, 0o600);
	if (!wr.ok) return err_res('IO_ERROR', wr.error);

	return ok_res({
		saved: true,
		backup_id: bid,
		size: length(content),
		revision: compute_hash_str(content)
	});
};

/* ==================== Chunked Upload (Handles uhttpd 64 KiB POST Limit) ==================== */

export function upload_begin(category, name, total_size, expected_revision) {
	let r = resolve_safe_path(category, name, true);
	if (!r.ok) return r;
	let sz = int(total_size ?? 0);
	if (sz < 0 || sz > MAX_FILE_BYTES) {
		return err_res('FILE_TOO_LARGE', `Upload exceeds maximum allowed size (${MAX_FILE_BYTES} bytes)`);
	}
	ensure_dir(UPLOADS_DIR, 0o700);
	let uid = rand_hex(12);
	let meta = {
		id: uid,
		category: category,
		name: name ?? '',
		total_size: sz,
		received: 0,
		expected_revision: expected_revision ?? '',
		created_at: time()
	};
	write_file_atomic(`${UPLOADS_DIR}/${uid}.meta`, sprintf('%J', meta), 0o600);
	let df = open(`${UPLOADS_DIR}/${uid}.data`, 'w', 0o600);
	if (df) df.close();
	chmod(`${UPLOADS_DIR}/${uid}.data`, 0o600);
	return ok_res({ upload_id: uid });
};

export function upload_chunk(upload_id, chunk_b64, seq) {
	if (!match(upload_id ?? '', /^[0-9a-f]{24}$/)) {
		return err_res('INVALID_UPLOAD_ID', 'Invalid upload ID');
	}
	let mpath = `${UPLOADS_DIR}/${upload_id}.meta`;
	let dpath = `${UPLOADS_DIR}/${upload_id}.data`;
	let raw_meta = readfile(mpath);
	if (!raw_meta) return err_res('NOT_FOUND', 'Upload session not found or expired');

	let meta = json(raw_meta);
	let decoded = b64dec(chunk_b64 ?? '');
	if (decoded == null) return err_res('INVALID_CHUNK', 'Invalid base64 chunk');

	if (meta.received + length(decoded) > MAX_FILE_BYTES) {
		safe_unlink(mpath);
		safe_unlink(dpath);
		return err_res('FILE_TOO_LARGE', 'Upload exceeded maximum allowed size');
	}

	let f = open(dpath, 'a', 0o600);
	if (!f) return err_res('IO_ERROR', 'Failed appending upload chunk');
	f.write(decoded);
	f.close();

	meta.received += length(decoded);
	write_file_atomic(mpath, sprintf('%J', meta), 0o600);
	return ok_res({ received: meta.received, seq: seq ?? 0 });
};

export function upload_commit(upload_id, require_clash_keys) {
	if (!match(upload_id ?? '', /^[0-9a-f]{24}$/)) {
		return err_res('INVALID_UPLOAD_ID', 'Invalid upload ID');
	}
	let mpath = `${UPLOADS_DIR}/${upload_id}.meta`;
	let dpath = `${UPLOADS_DIR}/${upload_id}.data`;
	let raw_meta = readfile(mpath);
	if (!raw_meta) return err_res('NOT_FOUND', 'Upload session not found');

	let meta = json(raw_meta);
	let content = readfile(dpath) ?? '';
	safe_unlink(mpath);
	safe_unlink(dpath);

	return save_managed_file(meta.category, meta.name, content, meta.expected_revision, require_clash_keys);
};
