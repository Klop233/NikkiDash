'use strict';

import { readfile } from 'fs';
import { cursor } from 'uci';
import { SCHEMA_PATH, is_safe_url, is_valid_section_id } from '/usr/share/nikki-dash/lib/common.uc';

let _schema_cache = null;

export function load_schema() {
	if (_schema_cache) return _schema_cache;
	let raw = readfile(SCHEMA_PATH);
	if (!raw) return null;
	_schema_cache = json(raw);
	return _schema_cache;
};

function to_array(v) {
	if (v == null) return [];
	if (type(v) == 'array') return v;
	return [sprintf('%s', v)];
}

export function validate_option(name, spec, val) {
	if (spec.readonly) return { ok: true, skip: true };

	if (val == null || val === '') {
		if (spec.required) {
			return { ok: false, error: `Field "${name}" is required` };
		}
		return { ok: true, empty: true };
	}

	let kind = spec.kind;
	if (kind == 'bool') {
		let s = sprintf('%s', val);
		if (s != '0' && s != '1' && val !== true && val !== false) {
			return { ok: false, error: `Field "${name}" must be boolean (0/1)` };
		}
		return { ok: true, value: (val === true || s == '1') ? '1' : '0' };
	}
	if (kind == 'tri_bool') {
		let s = sprintf('%s', val);
		if (s == '' || s == 'unmodified') return { ok: true, empty: true };
		if (s != '0' && s != '1') {
			return { ok: false, error: `Field "${name}" must be 0, 1, or unmodified` };
		}
		return { ok: true, value: s };
	}
	if (kind == 'uint' || kind == 'port') {
		let s = sprintf('%s', val);
		if (!match(s, /^[0-9]+$/)) {
			return { ok: false, error: `Field "${name}" must be an unsigned integer` };
		}
		let n = int(s);
		let min_v = spec.min ?? (kind == 'port' ? 0 : 0);
		let max_v = spec.max ?? (kind == 'port' ? 65535 : 2147483647);
		if (n < min_v || n > max_v) {
			return { ok: false, error: `Field "${name}" out of range (${min_v}-${max_v})` };
		}
		return { ok: true, value: sprintf('%d', n) };
	}
	if (kind == 'enum') {
		let s = sprintf('%s', val);
		if (index(spec.values ?? [], s) < 0) {
			return { ok: false, error: `Field "${name}" has invalid value "${s}"` };
		}
		return { ok: true, value: s };
	}
	if (kind == 'hex') {
		let s = sprintf('%s', val);
		if (!match(s, /^0x[0-9A-Fa-f]+$/)) {
			return { ok: false, error: `Field "${name}" must be hex (e.g. 0x80)` };
		}
		return { ok: true, value: s };
	}
	if (kind == 'url') {
		let s = sprintf('%s', val);
		if (!is_safe_url(s)) {
			return { ok: false, error: `Field "${name}" must be a valid http(s) URL` };
		}
		return { ok: true, value: s };
	}
	if (kind == 'hostport') {
		let s = sprintf('%s', val);
		if (!match(s, /^(\[[0-9A-Fa-f:]+\]|[0-9.]+|[A-Za-z0-9.-]+):[0-9]{1,5}$/)) {
			return { ok: false, error: `Field "${name}" must be host:port (e.g. 127.0.0.1:9090 or [::]:1053)` };
		}
		let p = int(substr(s, rindex(s, ':') + 1));
		if (p < 1 || p > 65535) {
			return { ok: false, error: `Field "${name}" port must be 1-65535` };
		}
		return { ok: true, value: s };
	}
	if (kind == 'cidr4') {
		let s = sprintf('%s', val);
		if (!match(s, /^[0-9]{1,3}(\.[0-9]{1,3}){3}(\/[0-9]{1,2})?$/)) {
			return { ok: false, error: `Field "${name}" must be valid IPv4 or CIDR4` };
		}
		return { ok: true, value: s };
	}
	if (kind == 'cidr6') {
		let s = sprintf('%s', val);
		if (!match(s, /^[0-9A-Fa-f:]+(\/[0-9]{1,3})?$/)) {
			return { ok: false, error: `Field "${name}" must be valid IPv6 or CIDR6` };
		}
		return { ok: true, value: s };
	}
	if (kind == 'cron') {
		let s = trim(sprintf('%s', val));
		if (length(s) > 120 || (index(s, chr(0)) >= 0 || match(s, /[\r\n;|&$`]/))) {
			return { ok: false, error: `Field "${name}" contains unsafe cron characters` };
		}
		let parts = split(s, /[ \t]+/);
		if (length(parts) != 5) {
			return { ok: false, error: `Field "${name}" must be a 5-field cron expression` };
		}
		return { ok: true, value: s };
	}
	if (kind == 'port_spec') {
		let s = trim(sprintf('%s', val));
		if (!match(s, /^[0-9, -]+$/)) {
			return { ok: false, error: `Field "${name}" must contain ports/ranges separated by spaces` };
		}
		return { ok: true, value: s };
	}
	if (kind == 'colon_list') {
		let arr = type(val) == 'array' ? val : split(sprintf('%s', val), ':');
		let cleaned = [];
		for (let item in arr) {
			let t = trim(sprintf('%s', item));
			if (length(t) == 0) continue;
			if ((index(t, chr(0)) >= 0 || match(t, /[\r\n]/))) {
				return { ok: false, error: `Field "${name}" contains control characters` };
			}
			push(cleaned, t);
		}
		if (length(cleaned) == 0) return { ok: true, empty: true };
		return { ok: true, value: join(':', cleaned) };
	}
	if (substr(kind, 0, 5) == 'list_') {
		let arr = to_array(val);
		let cleaned = [];
		for (let item in arr) {
			let t = trim(sprintf('%s', item));
			if (length(t) == 0) continue;
			if ((index(t, chr(0)) >= 0 || match(t, /[\r\n]/))) {
				return { ok: false, error: `Field "${name}" contains invalid characters` };
			}
			if (kind == 'list_dscp') {
				if (!match(t, /^[0-9]+$/) || int(t) < 0 || int(t) > 63) {
					return { ok: false, error: `Field "${name}" DSCP value "${t}" must be 0-63` };
				}
			} else if (kind == 'list_mac') {
				if (!match(t, /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/)) {
					return { ok: false, error: `Field "${name}" has invalid MAC "${t}"` };
				}
			} else if (kind == 'list_portrange') {
				if (!match(t, /^[0-9]{1,5}(-[0-9]{1,5})?$/)) {
					return { ok: false, error: `Field "${name}" has invalid port/range "${t}"` };
				}
			} else if (kind == 'list_cidr4') {
				if (!match(t, /^[0-9]{1,3}(\.[0-9]{1,3}){3}(\/[0-9]{1,2})?$/)) {
					return { ok: false, error: `Field "${name}" has invalid IPv4/CIDR "${t}"` };
				}
			} else if (kind == 'list_cidr6') {
				if (!match(t, /^[0-9A-Fa-f:]+(\/[0-9]{1,3})?$/)) {
					return { ok: false, error: `Field "${name}" has invalid IPv6/CIDR "${t}"` };
				}
			}
			push(cleaned, t);
		}
		return { ok: true, value: cleaned, is_list: true };
	}

	// Default string / secret / filepath / interface
	let s = sprintf('%s', val);
	if (length(s) > 2048 || (index(s, chr(0)) >= 0 || match(s, /[\r\n]/))) {
		return { ok: false, error: `Field "${name}" contains invalid control characters or is too long` };
	}
	if (kind == 'filepath' && (index(s, '..') >= 0 || substr(s, 0, 1) != '/')) {
		return { ok: false, error: `Field "${name}" must be an absolute path without ".."` };
	}
	return { ok: true, value: s };
};

export function read_nikki_config(include_secrets) {
	let schema = load_schema();
	let uci = cursor();
	let all = uci.get_all('nikki') ?? {};

	let named = {};
	let repeatable = {};
	let unknown_sections = [];
	let unknown_options = {};

	if (schema) {
		for (let rtype in schema.repeatable_sections) {
			repeatable[rtype] = [];
		}
	}

	// Collect sections in stable .index order
	let ordered = [];
	for (let sid in all) {
		let sec = all[sid];
		if (type(sec) == 'object') {
			push(ordered, { id: sid, sec: sec, idx: sec['.index'] ?? 99999 });
		}
	}
	sort(ordered, (a, b) => a.idx - b.idx);

	for (let entry in ordered) {
		let sid = entry.id;
		let sec = entry.sec;
		let stype = sec['.type'];

		if (schema && exists(schema.named_sections, sid) && stype == schema.named_sections[sid].type) {
			let spec_opts = schema.named_sections[sid].options;
			let out = {};
			let unk = {};
			for (let k in sec) {
				if (substr(k, 0, 1) == '.') continue;
				if (exists(spec_opts, k)) {
					let ospec = spec_opts[k];
					if (ospec.secret && !include_secrets) {
						out[k] = '';
						out[`${k}_set`] = length(sprintf('%s', sec[k] ?? '')) > 0;
					} else if (ospec.kind == 'colon_list') {
						out[k] = length(sec[k] ?? '') > 0 ? split(sec[k], ':') : [];
					} else if (substr(ospec.kind, 0, 5) == 'list_') {
						out[k] = to_array(sec[k]);
					} else {
						out[k] = sec[k];
					}
				} else {
					unk[k] = sec[k];
				}
			}
			named[sid] = out;
			if (length(keys(unk)) > 0) {
				unknown_options[sid] = unk;
			}
		} else if (schema && exists(schema.repeatable_sections, stype)) {
			let spec_opts = schema.repeatable_sections[stype].options;
			let row = { '.name': sid, '.anonymous': sec['.anonymous'] == true };
			let unk = {};
			for (let k in sec) {
				if (substr(k, 0, 1) == '.') continue;
				if (exists(spec_opts, k)) {
					let ospec = spec_opts[k];
					if (ospec.secret && !include_secrets) {
						row[k] = '';
						row[`${k}_set`] = length(sprintf('%s', sec[k] ?? '')) > 0;
					} else if (substr(ospec.kind, 0, 5) == 'list_') {
						row[k] = to_array(sec[k]);
					} else {
						row[k] = sec[k];
					}
				} else {
					unk[k] = sec[k];
				}
			}
			if (length(keys(unk)) > 0) row['_unknown'] = unk;
			push(repeatable[stype], row);
		} else if (stype != 'status' && stype != 'editor') {
			let copy = {};
			for (let k in sec) copy[k] = sec[k];
			push(unknown_sections, copy);
		}
	}

	return {
		schema_version: schema?.schema_version ?? 'unknown',
		named: named,
		repeatable: repeatable,
		unknown_options: unknown_options,
		unknown_sections: unknown_sections
	};
};

/*
 * Validate & apply structured changes onto an open UCI cursor for package `nikki`.
 * CRITICAL: Preserves all unknown options and unknown sections untouched!
 */
export function validate_and_stage_changes(uci, changes) {
	let schema = load_schema();
	if (!schema) return { ok: false, error: 'Schema file not found' };
	if (type(changes) != 'object') return { ok: false, error: 'Invalid changes payload' };

	let errors = [];

	// 1. Validate named sections first (before mutating)
	let staged_named = {};
	if (changes.named && type(changes.named) == 'object') {
		for (let sid in changes.named) {
			if (!exists(schema.named_sections, sid)) {
				push(errors, `Unknown named section "${sid}"`);
				continue;
			}
			let sec_spec = schema.named_sections[sid];
			let incoming = changes.named[sid];
			if (type(incoming) != 'object') {
				push(errors, `Section "${sid}" must be an object`);
				continue;
			}
			staged_named[sid] = {};
			for (let opt in incoming) {
				if (substr(opt, -4) == '_set') continue;
				if (!exists(sec_spec.options, opt)) {
					// Unknown fields are preserved in UCI; do not allow arbitrary untyped injection via named changes
					continue;
				}
				let ospec = sec_spec.options[opt];
				let val = incoming[opt];
				// Keep existing secret if left empty unless explicitly cleared via `${opt}_clear: true`
				if (ospec.secret && (val == null || val === '') && !incoming[`${opt}_clear`]) {
					continue;
				}
				let v = validate_option(`${sid}.${opt}`, ospec, val);
				if (!v.ok) {
					push(errors, v.error);
				} else if (!v.skip) {
					staged_named[sid][opt] = v;
				}
			}
		}
	}

	// 2. Validate repeatable sections
	let staged_rep = {};
	if (changes.repeatable && type(changes.repeatable) == 'object') {
		for (let rtype in changes.repeatable) {
			if (!exists(schema.repeatable_sections, rtype)) {
				push(errors, `Unknown repeatable section type "${rtype}"`);
				continue;
			}
			let rspec = schema.repeatable_sections[rtype];
			let rows = changes.repeatable[rtype];
			if (type(rows) != 'array') {
				push(errors, `Repeatable section "${rtype}" must be an array`);
				continue;
			}
			if (length(rows) > 256) {
				push(errors, `Repeatable section "${rtype}" exceeds 256 entries`);
				continue;
			}
			staged_rep[rtype] = [];
			for (let idx = 0; idx < length(rows); idx++) {
				let row = rows[idx];
				if (type(row) != 'object') {
					push(errors, `${rtype}[${idx}] must be an object`);
					continue;
				}
				let parsed_row = { '.name': row['.name'], opts: {}, _keep_secrets: {} };
				for (let opt in rspec.options) {
					let ospec = rspec.options[opt];
					if (ospec.readonly) continue;
					let val = row[opt];
					if (ospec.secret && (val == null || val === '') && !row[`${opt}_clear`]) {
						parsed_row._keep_secrets[opt] = true;
						continue;
					}
					let v = validate_option(`${rtype}[${idx}].${opt}`, ospec, val);
					if (!v.ok) {
						push(errors, v.error);
					} else if (!v.skip) {
						parsed_row.opts[opt] = v;
					}
				}
				push(staged_rep[rtype], parsed_row);
			}
		}
	}

	if (length(errors) > 0) {
		return { ok: false, error: join('; ', errors), errors: errors };
	}

	// 3. Stage named section mutations into UCI cursor (preserving unknown options!)
	for (let sid in staged_named) {
		let stype = schema.named_sections[sid].type;
		if (!uci.get('nikki', sid)) {
			uci.set('nikki', sid, stype);
		}
		for (let opt in staged_named[sid]) {
			let v = staged_named[sid][opt];
			if (v.empty) {
				uci.delete('nikki', sid, opt);
			} else if (v.is_list) {
				uci.delete('nikki', sid, opt);
				if (length(v.value) > 0) {
					uci.set('nikki', sid, opt, v.value);
				}
			} else {
				uci.set('nikki', sid, opt, v.value);
			}
		}
	}

	// 4. Stage repeatable section mutations (preserving existing unknown fields, readonly metadata, secrets, and named IDs!)
	let existing_all = uci.get_all('nikki') ?? {};
	for (let rtype in staged_rep) {
		let rspec = schema.repeatable_sections[rtype];
		let prev_by_id = {};
		let prev_ids = [];
		for (let sid in existing_all) {
			if (existing_all[sid]?.['.type'] == rtype) {
				prev_by_id[sid] = existing_all[sid];
				push(prev_ids, sid);
			}
		}

		// Delete old sections of this type and recreate in exact desired order, preserving named IDs & unknown/readonly fields
		for (let sid in prev_ids) {
			uci.delete('nikki', sid);
		}

		for (let row in staged_rep[rtype]) {
			let prev = row['.name'] ? prev_by_id[row['.name']] : null;
			let target_id = null;
			if (prev && prev['.anonymous'] != true && is_valid_section_id(row['.name'])) {
				target_id = row['.name'];
				uci.set('nikki', target_id, rtype);
			} else if (row['.name'] && !prev && rtype == 'subscription' && is_valid_section_id(row['.name'])) {
				target_id = row['.name'];
				uci.set('nikki', target_id, rtype);
			} else {
				target_id = uci.add('nikki', rtype);
			}

			// First copy preserved unknown + readonly + kept-secret options from previous section
			if (prev) {
				for (let k in prev) {
					if (substr(k, 0, 1) == '.') continue;
					let ospec = rspec.options[k];
					let is_unknown = !exists(rspec.options, k);
					let is_readonly = ospec && ospec.readonly;
					let is_kept_secret = ospec && ospec.secret && row._keep_secrets[k];
					if (is_unknown || is_readonly || is_kept_secret) {
						uci.set('nikki', target_id, k, prev[k]);
					}
				}
			}

			// Now apply validated options
			for (let opt in row.opts) {
				let v = row.opts[opt];
				if (v.empty) {
					uci.delete('nikki', target_id, opt);
				} else if (v.is_list) {
					if (length(v.value) > 0) {
						uci.set('nikki', target_id, opt, v.value);
					}
				} else {
					uci.set('nikki', target_id, opt, v.value);
				}
			}
		}
	}

	return { ok: true };
};
