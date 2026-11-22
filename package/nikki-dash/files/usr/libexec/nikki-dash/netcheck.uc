#!/usr/bin/ucode

'use strict';

import { readfile } from 'fs';
import { cursor } from 'uci';
import { connect } from 'ubus';

const action = ARGV[0];
const arg1 = ARGV[1];

function port_in_use(port_num) {
	let target_hex = sprintf('%04X', port_num);
	let files = ['/proc/net/tcp', '/proc/net/tcp6'];
	for (let p in files) {
		let content = readfile(p);
		if (!content) continue;
		let lines = split(content, '\n');
		for (let i = 1; i < length(lines); i++) {
			let cols = split(trim(lines[i]), /[ \t\r\n]+/);
			if (length(cols) < 4) continue;
			// State 0A == TCP_LISTEN
			if (cols[3] != '0A') continue;
			let local = cols[1];
			let ci = rindex(local, ':');
			if (ci >= 0 && uc(substr(local, ci + 1)) == target_hex) {
				return true;
			}
		}
	}
	return false;
}

function resolve_lan_addrs(port_num) {
	let uci = cursor();
	let ifaces = uci.get('nikki_dash', 'main', 'listen_interface');
	if (ifaces == null) ifaces = ['lan'];
	else if (type(ifaces) != 'array') ifaces = [sprintf('%s', ifaces)];

	let addrs = [];
	let ubus = connect();

	if (ubus) {
		for (let name in ifaces) {
			let st = ubus.call(`network.interface.${name}`, 'status', {});
			if (!st) continue;
			if (type(st['ipv4-address']) == 'array') {
				for (let entry in st['ipv4-address']) {
					if (entry.address) push(addrs, `${entry.address}:${port_num}`);
				}
			}
			if (type(st['ipv6-address']) == 'array') {
				for (let entry in st['ipv6-address']) {
					if (entry.address) push(addrs, `[${entry.address}]:${port_num}`);
				}
			}
			if (type(st['ipv6-prefix-assignment']) == 'array') {
				for (let entry in st['ipv6-prefix-assignment']) {
					let local = entry['local-address']?.address;
					if (local) push(addrs, `[${local}]:${port_num}`);
				}
			}
		}
	}

	// Fallback to static UCI network.<iface>.ipaddr if netifd ubus status is absent
	if (length(addrs) == 0) {
		let nuci = cursor();
		for (let name in ifaces) {
			let ip = nuci.get('network', name, 'ipaddr');
			if (type(ip) == 'string' && length(ip) > 0) {
				let clean = split(ip, '/')[0];
				if (match(clean, /^[0-9.]+$/)) push(addrs, `${clean}:${port_num}`);
			}
		}
	}

	// Always include loopback so local diagnostics & recovery remain reachable,
	// while NEVER falling back to wildcard 0.0.0.0 / [::] in LAN mode.
	push(addrs, `127.0.0.1:${port_num}`);
	if (readfile('/proc/net/if_inet6')) {
		push(addrs, `[::1]:${port_num}`);
	}

	return uniq(addrs);
}

if (action == 'check_port') {
	let p = int(arg1 ?? '0');
	if (p < 1 || p > 65535) exit(2);
	if (port_in_use(p)) exit(1);
	exit(0);
} else if (action == 'resolve_lan') {
	let p = int(arg1 ?? '18080');
	if (p < 1 || p > 65535) exit(2);
	let list = resolve_lan_addrs(p);
	print(join(' ', list), '\n');
	exit(0);
} else {
	exit(2);
}
