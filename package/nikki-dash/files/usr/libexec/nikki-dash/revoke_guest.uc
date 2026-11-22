#!/usr/bin/ucode

'use strict';

import { popen } from 'fs';
import { connect } from 'ubus';

let ubus = connect();
if (!ubus) exit(1);

let p = popen('ubus -S call session list', 'r');
if (!p) exit(1);

let to_destroy = [];
for (let line = p.read('line'); length(line); line = p.read('line')) {
	try {
		let msg = json(line);
		if (msg && msg.ubus_rpc_session && msg.data?.username == 'nikki-dash-guest') {
			push(to_destroy, msg.ubus_rpc_session);
		}
	} catch (e) {}
}
p.close();

for (let sid in to_destroy) {
	ubus.call('session', 'destroy', { ubus_rpc_session: sid });
}
