#!/usr/bin/ucode

'use strict';

import { access, readfile, lstat } from 'fs';
import { cursor } from 'uci';
import { connect } from 'ubus';
import {
	TASKS_DIR, TMP_DIR, NIKKI_RUN_DIR, NIKKI_RUN_CONFIG, NIKKI_MIXIN_PATH,
	ensure_dir, exec_argv, acquire_lock, release_lock, safe_unlink,
	compute_config_revision, redact_text, cmd_exists, make_tmp_file, write_file_atomic
} from '/usr/share/nikki-dash/lib/common.uc';
import { validate_and_stage_changes } from '/usr/share/nikki-dash/lib/schema.uc';
import { resolve_controller, controller_public_info, api_version } from '/usr/share/nikki-dash/lib/mihomo.uc';
import { task_path, write_task_state, snapshot_nikki_files, restore_nikki_snapshot } from '/usr/share/nikki-dash/lib/tx.uc';

const task_id = ARGV[0];
if (!task_id || !match(task_id, /^[A-Za-z0-9_-]{6,64}$/)) exit(2);

let raw_task = readfile(task_path(task_id));
let payload_path = `${TASKS_DIR}/${task_id}.payload.json`;
let raw_payload = readfile(payload_path);
if (!raw_task) exit(1);

let task = json(raw_task);
let payload = raw_payload ? json(raw_payload) : {};

function step(name, status, detail) {
	push(task.steps, {
		at: time(),
		name: name,
		status: status,
		detail: redact_text(detail ?? '')
	});
	task.stage = name;
	write_task_state(task);
}

function finish(status, message, err, result) {
	task.status = status;
	task.message = redact_text(message ?? '');
	task.error = err ? redact_text(err) : null;
	task.result = result ?? null;
	task.finished_at = time();
	write_task_state(task);
	safe_unlink(payload_path);
}

function wait_for_nikki_ready(ubus, expect_running, timeout_sec) {
	let deadline = time() + (timeout_sec ?? 20);
	while (time() <= deadline) {
		let svc = ubus.call('service', 'list', { name: 'nikki' });
		let running = svc?.nikki?.instances?.nikki?.running == true;
		if (!expect_running) {
			if (!running) return { state: 'ready', running: false };
		} else {
			if (running) {
				let ctrl = resolve_controller();
				if (!ctrl.configured) {
					return { state: 'ready', running: true, controller: controller_public_info(ctrl) };
				}
				let vr = api_version(ctrl);
				if (vr.ok) {
					return { state: 'ready', running: true, version: vr.data, controller: controller_public_info(ctrl) };
				}
			}
		}
		system(['sleep', '1']);
	}
	return { state: 'timeout' };
}

function run_candidate_validation(uci) {
	let enabled = uci.get('nikki', 'config', 'enabled') == '1';
	let profile = uci.get('nikki', 'config', 'profile') ?? '';
	let core_only = uci.get('nikki', 'config', 'core_only') == '1';
	let mixin_file_content = uci.get('nikki', 'mixin', 'mixin_file_content') == '1';

	if (!enabled || length(profile) == 0) {
		return { ok: true, skipped: true, reason: 'Nikki is disabled or no profile selected' };
	}

	let colon = index(profile, ':');
	if (colon < 0) return { ok: false, error: `Invalid profile reference: ${profile}` };
	let ptype = substr(profile, 0, colon);
	let pid = substr(profile, colon + 1);
	let src_file = (ptype == 'file')
		? `/etc/nikki/profiles/${pid}`
		: (ptype == 'subscription' ? `/etc/nikki/subscriptions/${pid}.yaml` : '');

	if (!src_file || lstat(src_file)?.type != 'file') {
		return { ok: false, error: `Selected profile source file does not exist: ${src_file}` };
	}

	if (!cmd_exists('yq')) {
		return { ok: true, skipped: true, reason: 'yq unavailable' };
	}

	let cand = make_tmp_file('cand-config');
	let raw_src = readfile(src_file) ?? '';
	write_file_atomic(cand, raw_src, 0o600);

	// Test YAML syntax of base profile
	let yq_base = exec_argv(['yq', '-M', '-p', 'yaml', '-o', 'json', '.', cand], { max_bytes: 256 * 1024 });
	if (yq_base.code != 0) {
		safe_unlink(cand);
		return { ok: false, error: `Profile YAML syntax error: ${trim(yq_base.stderr)}` };
	}

	// If mixin.uc exists and not core_only, test generating merged candidate via Nikki's mixin.uc
	if (!core_only && access('/etc/nikki/ucode/mixin.uc', 'r')) {
		let mix_json = exec_argv(['ucode', '-S', '/etc/nikki/ucode/mixin.uc'], { max_bytes: 512 * 1024 });
		if (mix_json.code != 0) {
			safe_unlink(cand);
			return { ok: false, error: `Nikki mixin.uc evaluation failed: ${trim(mix_json.stderr)}` };
		}
		let mix_tmp = make_tmp_file('mix-json');
		write_file_atomic(mix_tmp, mix_json.stdout, 0o600);

		let merge_expr = '... comments="" | . as $item ireduce ({}; . * $item ) | .proxies = .nikki-proxies + .proxies | del(.nikki-proxies) | .proxy-groups = .nikki-proxy-groups + .proxy-groups | del(.nikki-proxy-groups) | .rules = .nikki-rules + .rules | del(.nikki-rules) | explode(.)';
		let merge_argv = ['yq', '-M', '-i', 'eval-all', merge_expr, cand];
		if (mixin_file_content && lstat(NIKKI_MIXIN_PATH)?.type == 'file') {
			push(merge_argv, NIKKI_MIXIN_PATH);
		}
		push(merge_argv, mix_tmp);
		let mr = exec_argv(merge_argv);
		safe_unlink(mix_tmp);
		if (mr.code != 0) {
			safe_unlink(cand);
			return { ok: false, error: `Mixin YAML merge failed: ${trim(mr.stderr)}` };
		}
	}

	// Validate generated candidate with mihomo -t if installed
	if (cmd_exists('mihomo') && access(NIKKI_RUN_DIR, 'r')) {
		let tr = exec_argv(['mihomo', '-d', NIKKI_RUN_DIR, '-f', cand, '-t'], { max_bytes: 65536 });
		if (tr.code != 0) {
			let msg = trim(tr.stdout + '\n' + tr.stderr);
			safe_unlink(cand);
			return { ok: false, error: `Mihomo config test failed: ${msg}` };
		}
	}

	safe_unlink(cand);
	return { ok: true };
}

function handle_apply_config(ubus) {
	step('lock', 'running', 'Acquiring write lock');
	let lock = acquire_lock(task_id, 180);
	if (!lock.ok) {
		finish('failed', 'Write lock busy', lock.error);
		return;
	}

	let snap = null;
	try {
		step('revision_check', 'running', 'Checking config revision');
		let cur_rev = compute_config_revision();
		if (payload.revision && length(payload.revision) > 0 && payload.revision != cur_rev) {
			release_lock();
			finish('failed', 'Revision conflict detected', 'Configuration was modified externally; reload and retry', {
				error_code: 'REVISION_CONFLICT',
				current_revision: cur_rev
			});
			return;
		}

		step('backup', 'running', 'Backing up /etc/config/nikki and mixin.yaml');
		snap = snapshot_nikki_files();

		let uci = cursor();
		if (payload.changes && type(payload.changes) == 'object') {
			step('validate_schema', 'running', 'Validating UCI schema changes');
			let stg = validate_and_stage_changes(uci, payload.changes);
			if (!stg.ok) {
				uci.revert('nikki');
				release_lock();
				finish('failed', 'Schema validation failed', stg.error, { errors: stg.errors });
				return;
			}
			if (!uci.commit('nikki')) {
				restore_nikki_snapshot(snap);
				release_lock();
				finish('rolled_back', 'UCI commit failed; restored previous config', 'UCI commit error');
				return;
			}
		}

		step('validate_profile', 'running', 'Testing candidate config with yq & mihomo -t');
		let fresh_uci = cursor();
		let val = run_candidate_validation(fresh_uci);
		if (!val.ok) {
			step('rollback', 'running', 'Validation failed; rolling back snapshot');
			let rb_ok = restore_nikki_snapshot(snap);
			release_lock();
			finish(
				rb_ok ? 'rolled_back' : 'rollback_failed',
				rb_ok ? 'Configuration test failed and was rolled back cleanly' : 'Configuration test failed and rollback encountered an error',
				val.error
			);
			return;
		}

		if (payload.action == 'test') {
			// Test-only restores snapshot if uncommitted changes were applied for testing
			restore_nikki_snapshot(snap);
			release_lock();
			finish('succeeded', 'Configuration test passed', null, { tested: true });
			return;
		}

		let should_run = fresh_uci.get('nikki', 'config', 'enabled') == '1';
		step('reload_service', 'running', should_run ? 'Restarting Nikki service' : 'Stopping Nikki service');
		let svc_cmd = should_run ? ['/etc/init.d/nikki', 'restart'] : ['/etc/init.d/nikki', 'stop'];
		let sr = exec_argv(svc_cmd, { max_bytes: 65536 });
		if (sr.code != 0) {
			step('rollback', 'running', 'Service restart failed; restoring backup');
			let rb_ok = restore_nikki_snapshot(snap);
			if (rb_ok) exec_argv(['/etc/init.d/nikki', 'restart']);
			release_lock();
			finish(
				rb_ok ? 'rolled_back' : 'rollback_failed',
				rb_ok ? 'Service restart failed and previous config was restored' : 'Service restart failed and rollback failed',
				trim(sr.stderr || sr.stdout || 'nikki init script returned non-zero')
			);
			return;
		}

		step('readiness', 'running', 'Waiting for procd & Mihomo readiness');
		let ready = wait_for_nikki_ready(ubus, should_run, 20);
		let new_rev = compute_config_revision();
		let ctrl_info = controller_public_info(resolve_controller());

		if (ready.state == 'timeout') {
			// Timeout != definite failure: do NOT blindly rollback, return unknown!
			release_lock();
			finish('unknown', 'Service reload timed out waiting for readiness; verify status before retrying', null, {
				revision: new_rev,
				controller: ctrl_info
			});
			return;
		}

		release_lock();
		finish('succeeded', 'Configuration applied and verified', null, {
			revision: new_rev,
			running: ready.running,
			controller: ctrl_info
		});
	} catch (e) {
		release_lock();
		finish('failed', 'Unexpected error during apply', sprintf('%s', e));
	}
}

function handle_service_action(ubus) {
	let act = payload.action;
	let allowed = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'];
	if (index(allowed, act) < 0) {
		finish('failed', 'Invalid service action', `Unsupported action: ${act}`);
		return;
	}

	let lock = acquire_lock(task_id, 120);
	if (!lock.ok) {
		finish('failed', 'Write lock busy', lock.error);
		return;
	}

	try {
		let uci = cursor();
		if (act == 'start') {
			uci.set('nikki', 'config', 'enabled', '1');
			uci.commit('nikki');
		} else if (act == 'stop') {
			uci.set('nikki', 'config', 'enabled', '0');
			uci.commit('nikki');
		}

		step('service_exec', 'running', `Running /etc/init.d/nikki ${act}`);
		let r = exec_argv(['/etc/init.d/nikki', act], { max_bytes: 65536 });
		if (r.code != 0) {
			release_lock();
			finish('failed', `Service ${act} failed`, trim(r.stderr || r.stdout || `Exit code ${r.code}`));
			return;
		}

		if (act == 'start' || act == 'restart' || act == 'reload' || act == 'stop') {
			let expect_up = (act != 'stop') && (cursor().get('nikki', 'config', 'enabled') == '1');
			step('readiness', 'running', expect_up ? 'Waiting for Nikki readiness' : 'Confirming Nikki stopped');
			let ready = wait_for_nikki_ready(ubus, expect_up, 20);
			if (ready.state == 'timeout') {
				release_lock();
				finish('unknown', `Timed out waiting after ${act}; check live status`, null, {
					revision: compute_config_revision()
				});
				return;
			}
			release_lock();
			finish('succeeded', `Service ${act} completed`, null, {
				running: ready.running,
				revision: compute_config_revision(),
				controller: controller_public_info(resolve_controller())
			});
			return;
		}

		release_lock();
		finish('succeeded', `Service ${act} completed`, null, {
			revision: compute_config_revision()
		});
	} catch (e) {
		release_lock();
		finish('failed', 'Unexpected error executing service action', sprintf('%s', e));
	}
}

function handle_update_subscription(ubus) {
	let sid = payload.section_id;
	if (!sid || !match(sid, /^[A-Za-z0-9_]+$/)) {
		finish('failed', 'Invalid subscription section ID', 'Invalid section_id');
		return;
	}

	let uci = cursor();
	if (uci.get('nikki', sid) != 'subscription') {
		finish('failed', 'Subscription not found', `No subscription section "${sid}" in /etc/config/nikki`);
		return;
	}

	let lock = acquire_lock(task_id, 180);
	if (!lock.ok) {
		finish('failed', 'Write lock busy', lock.error);
		return;
	}

	try {
		let sub_file = `/etc/nikki/subscriptions/${sid}.yaml`;
		let prev_content = lstat(sub_file)?.type == 'file' ? readfile(sub_file) : null;

		step('fetch_subscription', 'running', `Updating subscription ${sid} via Nikki`);
		let r = exec_argv(['/etc/init.d/nikki', 'update_subscription', sid], { max_bytes: 65536 });

		let fresh = cursor();
		let success = fresh.get('nikki', sid, 'success') == '1';
		if (r.code != 0 || !success) {
			// Ensure old subscription file is preserved if update failed
			if (prev_content != null && lstat(sub_file)?.type != 'file') {
				write_file_atomic(sub_file, prev_content, 0o600);
			}
			release_lock();
			finish('failed', 'Subscription update failed; previous subscription file preserved', trim(r.stderr || r.stdout || 'Nikki reported subscription update failure'));
			return;
		}

		// Optionally reload Nikki if this subscription is currently active and running
		let active_profile = fresh.get('nikki', 'config', 'profile') ?? '';
		let svc = ubus.call('service', 'list', { name: 'nikki' });
		let running = svc?.nikki?.instances?.nikki?.running == true;
		if (payload.reload_if_active && running && active_profile == `subscription:${sid}`) {
			step('reload_service', 'running', 'Reloading active subscription');
			exec_argv(['/etc/init.d/nikki', 'reload']);
		}

		release_lock();
		finish('succeeded', 'Subscription updated successfully', null, {
			section_id: sid,
			update: fresh.get('nikki', sid, 'update') ?? '',
			expire: fresh.get('nikki', sid, 'expire') ?? '',
			used: fresh.get('nikki', sid, 'used') ?? '',
			total: fresh.get('nikki', sid, 'total') ?? '',
			avaliable: fresh.get('nikki', sid, 'avaliable') ?? '',
			revision: compute_config_revision()
		});
	} catch (e) {
		release_lock();
		finish('failed', 'Unexpected error updating subscription', sprintf('%s', e));
	}
}

// Entry point
task.status = 'running';
task.started_at = time();
write_task_state(task);

let ubus = connect();
if (task.kind == 'apply_config') {
	handle_apply_config(ubus);
} else if (task.kind == 'service_action') {
	handle_service_action(ubus);
} else if (task.kind == 'update_subscription') {
	handle_update_subscription(ubus);
} else {
	finish('failed', 'Unknown task kind', `Unsupported task kind: ${task.kind}`);
}
