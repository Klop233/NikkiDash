'use strict';

import { open, readfile, stat, lstat, lsdir, unlink, chmod } from 'fs';
import { cursor } from 'uci';
import {
	TASKS_DIR, BACKUP_DIR, TMP_DIR, NIKKI_MIXIN_PATH, NIKKI_RUN_CONFIG,
	ensure_dir, rand_hex, write_file_atomic, safe_unlink, exec_argv,
	acquire_lock, release_lock, compute_config_revision, redact_text,
	err_res, ok_res
} from '/usr/share/nikki-dash/lib/common.uc';
import { validate_and_stage_changes } from '/usr/share/nikki-dash/lib/schema.uc';

const WORKER_BIN = '/usr/libexec/nikki-dash/worker.uc';
const MAX_TASK_HISTORY = 30;

export function task_path(task_id) {
	return `${TASKS_DIR}/${task_id}.json`;
};

export function write_task_state(task) {
	ensure_dir(TASKS_DIR, 0o700);
	task.updated_at = time();
	write_file_atomic(task_path(task.id), sprintf('%J', task), 0o600);
};

export function read_task_state(task_id) {
	if (!match(task_id ?? '', /^[A-Za-z0-9_-]{6,64}$/)) {
		return err_res('INVALID_TASK_ID', 'Invalid task ID');
	}
	let raw = readfile(task_path(task_id));
	if (!raw) return err_res('NOT_FOUND', 'Task not found');
	try {
		return ok_res({ task: json(raw) });
	} catch (e) {
		return err_res('CORRUPT_TASK', 'Failed to parse task record');
	}
};

export function list_recent_tasks(limit) {
	ensure_dir(TASKS_DIR, 0o700);
	let entries = lsdir(TASKS_DIR) ?? [];
	let tasks = [];
	for (let e in entries) {
		if (!match(e, /\.json$/)) continue;
		let raw = readfile(`${TASKS_DIR}/${e}`);
		if (!raw) continue;
		try {
			let t = json(raw);
			if (t && t.id) push(tasks, t);
		} catch (err) {}
	}
	sort(tasks, (a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));

	// Prune old completed tasks
	while (length(tasks) > MAX_TASK_HISTORY) {
		let old = pop(tasks);
		if (old.status != 'queued' && old.status != 'running') {
			safe_unlink(task_path(old.id));
		}
	}

	let lim = int(limit ?? 20);
	if (lim < 1) lim = 1;
	if (lim > 50) lim = 50;
	if (length(tasks) > lim) {
		tasks = slice(tasks, 0, lim);
	}
	return ok_res({ tasks: tasks });
};

function find_by_idempotency(key) {
	if (!key || length(key) < 4 || length(key) > 64) return null;
	ensure_dir(TASKS_DIR, 0o700);
	let entries = lsdir(TASKS_DIR) ?? [];
	for (let e in entries) {
		if (!match(e, /\.json$/)) continue;
		let raw = readfile(`${TASKS_DIR}/${e}`);
		if (!raw) continue;
		try {
			let t = json(raw);
			if (t && t.idempotency_key == key && (time() - (t.created_at ?? 0)) < 600) {
				return t;
			}
		} catch (err) {}
	}
	return null;
}

export function spawn_async_task(kind, payload, idempotency_key) {
	let existing = find_by_idempotency(idempotency_key);
	if (existing) {
		return ok_res({ task: existing, deduplicated: true });
	}

	ensure_dir(TASKS_DIR, 0o700);
	let tid = `t_${time()}_${rand_hex(6)}`;
	let payload_path = `${TASKS_DIR}/${tid}.payload.json`;
	write_file_atomic(payload_path, sprintf('%J', payload ?? {}), 0o600);

	let task = {
		id: tid,
		kind: kind,
		idempotency_key: idempotency_key ?? '',
		status: 'queued',
		stage: 'queued',
		created_at: time(),
		updated_at: time(),
		started_at: null,
		finished_at: null,
		steps: [],
		message: 'Queued',
		error: null,
		result: null
	};
	write_task_state(task);

	// Launch worker detached so rpcd returns immediately and browser disconnect never kills the task
	let cmd = [
		'/bin/sh', '-c',
		'ucode -S "$1" "$2" >/dev/null 2>&1 </dev/null &',
		'_nd_spawn', WORKER_BIN, tid
	];
	let rc = system(cmd);
	if (rc != 0) {
		task.status = 'failed';
		task.stage = 'spawn_failed';
		task.error = 'Failed to launch background task worker';
		task.finished_at = time();
		write_task_state(task);
		safe_unlink(payload_path);
		return err_res('SPAWN_FAILED', task.error, { task: task });
	}

	return ok_res({ task: task, deduplicated: false });
};

/*
 * Synchronous save/test helper used when action == 'save' or 'test', or inside worker for 'apply'.
 */
export function snapshot_nikki_files() {
	return {
		uci_nikki: readfile('/etc/config/nikki') ?? '',
		mixin_yaml: readfile(NIKKI_MIXIN_PATH) ?? '',
		run_config: readfile(NIKKI_RUN_CONFIG) ?? '',
		had_run_config: lstat(NIKKI_RUN_CONFIG) != null
	};
};

export function restore_nikki_snapshot(snap) {
	let ok = true;
	let r1 = write_file_atomic('/etc/config/nikki', snap.uci_nikki, 0o644);
	if (!r1.ok) ok = false;
	if (snap.mixin_yaml != null) {
		let r2 = write_file_atomic(NIKKI_MIXIN_PATH, snap.mixin_yaml, 0o600);
		if (!r2.ok) ok = false;
	}
	if (snap.had_run_config) {
		write_file_atomic(NIKKI_RUN_CONFIG, snap.run_config, 0o600);
	}
	return ok;
};

export function save_config_sync(revision, changes) {
	let lock = acquire_lock('save_config_sync', 60);
	if (!lock.ok) return err_res('LOCKED', lock.error);

	let cur_rev = compute_config_revision();
	if (revision && length(revision) > 0 && revision != cur_rev) {
		release_lock();
		return err_res('REVISION_CONFLICT', 'Configuration was modified externally; reload before saving', {
			current_revision: cur_rev
		});
	}

	let snap = snapshot_nikki_files();
	let uci = cursor();
	let stg = validate_and_stage_changes(uci, changes);
	if (!stg.ok) {
		uci.revert('nikki');
		release_lock();
		return err_res('VALIDATION_FAILED', stg.error, { errors: stg.errors });
	}

	if (!uci.commit('nikki')) {
		restore_nikki_snapshot(snap);
		release_lock();
		return err_res('COMMIT_FAILED', 'UCI commit failed; original config preserved');
	}

	let new_rev = compute_config_revision();
	release_lock();
	return ok_res({ saved: true, revision: new_rev });
};
