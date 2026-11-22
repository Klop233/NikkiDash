#!/usr/bin/ucode

'use strict';

import { access, lstat, open, readfile } from 'fs';
import { cursor } from 'uci';
import { connect } from 'ubus';
import {
	RUNTIME_DIR, NIKKI_RUN_CONFIG, TMP_DIR,
	ensure_dir, rand_hex, make_tmp_file, write_file_atomic, safe_unlink, exec_argv
} from '/usr/share/nikki-dash/lib/common.uc';

const PROBE_STATE_PATH = `${RUNTIME_DIR}/netprobe.json`;

function is_valid_ip(ip) {
	if (type(ip) != 'string') return false;
	let s = trim(ip);
	if (length(s) < 3 || length(s) > 45) return false;
	return match(s, /^[0-9a-fA-F:.]+$/) != null;
}

function read_json_file(path) {
	let raw = readfile(path);
	if (!raw || length(trim(raw)) == 0) return null;
	try {
		return json(raw);
	} catch (e) {
		return null;
	}
}

function detect_proxy_setup() {
	let ubus = connect();
	let svc = ubus ? ubus.call('service', 'list', { name: 'nikki' }) : null;
	let running = svc?.nikki?.instances?.nikki?.running == true;

	let uci = cursor();
	let router_proxy = uci.get('nikki', 'proxy', 'router_proxy') == '1';
	let core_only = uci.get('nikki', 'config', 'core_only') == '1';

	if (!running) {
		return { running: false, route_mode: 'direct', proxy_url: '', proxy_user: '' };
	}

	// If transparent proxy already handles router outbound traffic, plain curl follows Nikki rules directly
	if (router_proxy && !core_only) {
		return { running: true, route_mode: 'transparent', proxy_url: '', proxy_user: '' };
	}

	// Otherwise route overseas & service probes via Mihomo local inbound proxy (mixed-port / port)
	let port = 0;
	let auth = '';
	if (access(NIKKI_RUN_CONFIG, 'r')) {
		let r = exec_argv(['yq', '-M', '-p', 'yaml', '-o', 'json', NIKKI_RUN_CONFIG], { max_bytes: 512 * 1024 });
		if (r.code == 0 && length(r.stdout) > 0) {
			try {
				let cfg = json(r.stdout);
				port = int(cfg?.['mixed-port'] ?? cfg?.['port'] ?? 0);
				if (type(cfg?.authentication) == 'array' && length(cfg.authentication) > 0) {
					auth = sprintf('%s', cfg.authentication[0]);
				}
			} catch (e) {}
		}
	}
	if (port <= 0) {
		port = int(uci.get('nikki', 'mixin', 'mixed_port') ?? uci.get('nikki', 'mixin', 'http_port') ?? '0');
	}
	if (port > 0 && port <= 65535) {
		return {
			running: true,
			route_mode: 'local_proxy',
			proxy_url: `http://127.0.0.1:${port}`,
			proxy_user: auth
		};
	}

	return { running: true, route_mode: 'direct', proxy_url: '', proxy_user: '' };
}

function write_proxy_curl_cfg(setup) {
	if (!setup.proxy_url) return null;
	let cfg_file = make_tmp_file('netprobe_curl');
	let lines = [`proxy = "${setup.proxy_url}"`];
	if (length(setup.proxy_user) > 0) {
		let safe_auth = replace(setup.proxy_user, /["\\\r\n]/g, '');
		push(lines, `proxy-user = "${safe_auth}"`);
	}
	let fh = open(cfg_file, 'w', 0o600);
	if (!fh) {
		safe_unlink(cfg_file);
		return null;
	}
	fh.write(join('\n', lines) + '\n');
	fh.close();
	return cfg_file;
}

function join_nonempty(arr, sep) {
	let out = [];
	for (let v in arr) {
		let s = trim(sprintf('%s', v ?? ''));
		if (length(s) > 0 && index(out, s) < 0) push(out, s);
	}
	return join(sep, out);
}

function parse_service_line(raw, id, name, group) {
	let parts = split(trim(raw ?? ''), /[ \t\r\n]+/);
	let code = int(parts[0] ?? '0');
	let sec = 0.0;
	if (parts[1]) {
		let parsed_sec = +parts[1];
		if (parsed_sec == parsed_sec && parsed_sec > 0) sec = parsed_sec;
	}
	let ms = int(sec * 1000 + 0.5);

	let status_kind = 'fail';
	let ok = false;
	if (code >= 200 && code < 400) {
		status_kind = 'ok';
		ok = true;
	} else if (code == 401 || code == 403 || code == 429 || code == 451) {
		status_kind = 'restricted';
		ok = true;
	}

	return {
		id: id,
		name: name,
		group: group,
		ok: ok,
		status_kind: status_kind,
		http_code: code,
		latency_ms: code > 0 ? ms : null
	};
}

function classify_isp_type(pc_type, flags) {
	let pt = lc(trim(sprintf('%s', pc_type ?? '')));
	if (flags.is_tor) return { code: 'tor', label: 'Tor 出口节点' };
	if (flags.is_mobile || pt == 'wireless') return { code: 'mobile', label: '移动蜂窝网络' };
	if (flags.is_vpn || pt == 'vpn') return { code: 'vpn', label: 'VPN / 代理机房' };
	if (flags.is_datacenter || flags.is_hosting || pt == 'hosting' || pt == 'compromised server' || pt == 'socks' || pt == 'http') {
		return { code: 'hosting', label: '机房 / 数据中心 (IDC)' };
	}
	if (pt == 'education') return { code: 'education', label: '教育 / 科研网络' };
	if (pt == 'business') return { code: 'business', label: '商业宽带' };
	if (pt == 'residential' || (!flags.is_datacenter && !flags.is_hosting && !flags.is_vpn && !flags.is_proxy)) {
		return { code: 'residential', label: '住宅家宽 / 宽带 ISP' };
	}
	return { code: 'unknown', label: pc_type ? sprintf('%s', pc_type) : '未知类型' };
}

function classify_risk_level(score) {
	if (score == null) return { level: 'unknown', label: '未知' };
	if (score <= 25) return { level: 'low', label: '极低风险' };
	if (score <= 55) return { level: 'medium', label: '中等风险' };
	if (score <= 75) return { level: 'high', label: '偏高风险' };
	return { level: 'critical', label: '高风险' };
}

function run_probe() {
	ensure_dir(RUNTIME_DIR, 0o755);
	ensure_dir(TMP_DIR, 0o700);

	let setup = detect_proxy_setup();
	let proxy_cfg = write_proxy_curl_cfg(setup);

	let workdir = `${TMP_DIR}/probe-${time()}-${rand_hex(4)}`;
	ensure_dir(workdir, 0o700);

	// Phase 1: Parallel domestic IP + domestic services + overseas exit IP discovery (low concurrency = high accuracy)
	let phase1_script = `
DIR="$1"
PCFG="$2"

pcurl() {
	if [ -n "$PCFG" ]; then
		curl -4 -sS --config "$PCFG" "$@"
	else
		curl -4 -sS "$@"
	fi
}

# Domestic IP (direct)
(curl -4 -sS --noproxy '*' --connect-timeout 3 --max-time 5 "https://myip.ipip.net/json" > "$DIR/dom_ipip.json" 2>/dev/null || true) &
(curl -4 -sS --noproxy '*' --connect-timeout 3 --max-time 5 "https://api-v3.speedtest.cn/ip" > "$DIR/dom_speed.json" 2>/dev/null || true) &

# Overseas exit IP discovery
(pcurl --connect-timeout 3 --max-time 6 "https://api.ipquery.io/?format=json" > "$DIR/ov_ipquery.json" 2>/dev/null || true) &
(pcurl --connect-timeout 3 --max-time 6 "https://ipinfo.io/json" > "$DIR/ov_ipinfo.json" 2>/dev/null || true) &

# Domestic services (lightweight HEAD / range GET)
(pcurl -I -o /dev/null --connect-timeout 3 --max-time 5 -w "%{http_code} %{time_total}" "https://www.baidu.com" > "$DIR/svc_baidu.txt" 2>/dev/null || echo "000 0" > "$DIR/svc_baidu.txt") &
(pcurl -I -o /dev/null --connect-timeout 3 --max-time 5 -w "%{http_code} %{time_total}" "https://www.bilibili.com" > "$DIR/svc_bilibili.txt" 2>/dev/null || echo "000 0" > "$DIR/svc_bilibili.txt") &
(pcurl -r 0-511 -o /dev/null --connect-timeout 3 --max-time 5 -w "%{http_code} %{time_total}" "https://weixin.qq.com" > "$DIR/svc_weixin.txt" 2>/dev/null || echo "000 0" > "$DIR/svc_weixin.txt") &
(pcurl -I -o /dev/null --connect-timeout 3 --max-time 5 -w "%{http_code} %{time_total}" "https://www.taobao.com" > "$DIR/svc_taobao.txt" 2>/dev/null || echo "000 0" > "$DIR/svc_taobao.txt") &

wait
`;

	system(['/bin/sh', '-c', phase1_script, '_nd_p1', workdir, proxy_cfg ?? '']);

	// Parse Domestic IP
	let dom_ip = '';
	let dom_country = '';
	let dom_region = '';
	let dom_city = '';
	let dom_isp = '';
	let dom_asn = '';
	let dom_source = '';

	let ipip = read_json_file(`${workdir}/dom_ipip.json`);
	if (ipip && ipip.ret == 'ok' && ipip.data && is_valid_ip(ipip.data.ip)) {
		dom_ip = trim(ipip.data.ip);
		let loc = type(ipip.data.location) == 'array' ? ipip.data.location : [];
		dom_country = loc[0] ?? '';
		dom_region = loc[1] ?? '';
		dom_city = loc[2] ?? '';
		dom_isp = loc[4] ?? '';
		dom_source = 'ipip.net';
	} else {
		let spd = read_json_file(`${workdir}/dom_speed.json`);
		if (spd && spd.code == 0 && spd.data) {
			dom_ip = trim(sprintf('%s', spd.data.ip ?? ''));
			dom_country = spd.data.country ?? '';
			dom_region = spd.data.province ?? '';
			dom_city = spd.data.city ?? '';
			dom_isp = spd.data.isp ?? spd.data.operator ?? '';
			dom_source = 'speedtest.cn';
		}
	}

	// Parse Overseas IP
	let ov_ip = '';
	let ipq = read_json_file(`${workdir}/ov_ipquery.json`);
	let ipinfo = read_json_file(`${workdir}/ov_ipinfo.json`);
	if (ipq && is_valid_ip(ipq.ip)) {
		ov_ip = trim(ipq.ip);
	} else if (ipinfo && is_valid_ip(ipinfo.ip)) {
		ov_ip = trim(ipinfo.ip);
	}

	// Phase 2: Query authoritative risk score, ISP type & Chinese geo + overseas service connectivity in parallel
	let phase2_script = `
DIR="$1"
PCFG="$2"
OVIP="$3"
DOMIP="$4"

pcurl() {
	if [ -n "$PCFG" ]; then
		curl -4 -sS --config "$PCFG" "$@"
	else
		curl -4 -sS "$@"
	fi
}

check_svc() {
	OUT="$1"
	shift
	RES=$(pcurl --connect-timeout 3 --max-time 6 -o /dev/null -w "%{http_code} %{time_total}" "$@" 2>/dev/null || echo "000 0")
	CODE=$(echo "$RES" | awk '{print $1}')
	if [ "$CODE" = "000" ] || [ -z "$CODE" ]; then
		RES=$(pcurl --connect-timeout 3 --max-time 6 -o /dev/null -w "%{http_code} %{time_total}" "$@" 2>/dev/null || echo "000 0")
	fi
	echo "$RES" > "$OUT"
}

if [ -n "$OVIP" ]; then
	(pcurl --connect-timeout 3 --max-time 6 "https://proxycheck.io/v2/$OVIP?vpn=1&asn=1&risk=1" > "$DIR/ov_proxycheck.json" 2>/dev/null || true) &
	(pcurl --connect-timeout 3 --max-time 6 "http://ip-api.com/json/$OVIP?fields=status,country,countryCode,regionName,city,isp,org,as,mobile,proxy,hosting,query&lang=zh-CN" > "$DIR/ov_ipapi.json" 2>/dev/null || true) &
fi
if [ -n "$DOMIP" ]; then
	(pcurl --connect-timeout 3 --max-time 5 "http://ip-api.com/json/$DOMIP?fields=status,country,countryCode,regionName,city,isp,org,as,query&lang=zh-CN" > "$DIR/dom_ipapi.json" 2>/dev/null || true) &
fi

(check_svc "$DIR/svc_google.txt" "https://www.gstatic.com/generate_204") &
(check_svc "$DIR/svc_github.txt" -I "https://github.com") &
(check_svc "$DIR/svc_youtube.txt" "https://www.youtube.com/generate_204") &
(check_svc "$DIR/svc_cloudflare.txt" "https://cp.cloudflare.com/generate_204") &
(check_svc "$DIR/svc_openai.txt" -I "https://chatgpt.com") &
(check_svc "$DIR/svc_netflix.txt" -r 0-511 "https://www.netflix.com") &
(check_svc "$DIR/svc_telegram.txt" "https://api.telegram.org") &
(check_svc "$DIR/svc_apple.txt" -I "https://captive.apple.com/hotspot-detect.html") &

wait
`;
	system([
		'/bin/sh', '-c', phase2_script, '_nd_p2',
		workdir, proxy_cfg ?? '',
		is_valid_ip(ov_ip) ? ov_ip : '',
		is_valid_ip(dom_ip) ? dom_ip : ''
	]);

	// Enrich domestic ASN if available
	let dom_ipapi = read_json_file(`${workdir}/dom_ipapi.json`);
	if (dom_ipapi && dom_ipapi.status == 'success') {
		dom_asn = dom_ipapi.as ?? '';
		if (length(dom_isp) == 0) dom_isp = dom_ipapi.isp ?? dom_ipapi.org ?? '';
		if (length(dom_country) == 0) dom_country = dom_ipapi.country ?? '';
		if (length(dom_region) == 0) dom_region = dom_ipapi.regionName ?? '';
		if (length(dom_city) == 0) dom_city = dom_ipapi.city ?? '';
	}

	// Build unified Overseas IP + Fraud Score + ISP Type report for ov_ip
	let pc_raw = read_json_file(`${workdir}/ov_proxycheck.json`);
	let pc = (pc_raw && pc_raw.status == 'ok' && ov_ip && type(pc_raw[ov_ip]) == 'object') ? pc_raw[ov_ip] : null;
	let ov_ipapi = read_json_file(`${workdir}/ov_ipapi.json`);
	if (ov_ipapi && ov_ipapi.status != 'success') ov_ipapi = null;

	// Only trust ipq fields if ipq matched ov_ip
	let ipq_ok = (ipq && trim(ipq.ip ?? '') == ov_ip);
	let ipinfo_ok = (ipinfo && trim(ipinfo.ip ?? '') == ov_ip);

	let ov_country = ov_ipapi?.country ?? pc?.country ?? (ipq_ok ? ipq.location?.country : '') ?? (ipinfo_ok ? ipinfo.country : '') ?? '';
	let ov_country_code = ov_ipapi?.countryCode ?? pc?.isocode ?? (ipq_ok ? ipq.location?.country_code : '') ?? (ipinfo_ok ? ipinfo.country : '') ?? '';
	let ov_region = ov_ipapi?.regionName ?? (ipq_ok ? ipq.location?.state : '') ?? (ipinfo_ok ? ipinfo.region : '') ?? '';
	let ov_city = ov_ipapi?.city ?? pc?.city ?? (ipq_ok ? ipq.location?.city : '') ?? (ipinfo_ok ? ipinfo.city : '') ?? '';
	let ov_isp = pc?.provider ?? ov_ipapi?.isp ?? (ipq_ok ? ipq.isp?.isp : '') ?? '';
	let ov_org = pc?.organisation ?? ov_ipapi?.org ?? (ipq_ok ? ipq.isp?.org : '') ?? (ipinfo_ok ? ipinfo.org : '') ?? '';
	let ov_asn = pc?.asn ?? (ipq_ok ? ipq.isp?.asn : '') ?? '';
	if (length(ov_asn) == 0 && ov_ipapi?.as) {
		ov_asn = split(ov_ipapi.as, ' ')[0] ?? ov_ipapi.as;
	}

	let flags = {
		is_proxy: (pc?.proxy == 'yes') || (ipq_ok && ipq.risk?.is_proxy == true) || (ov_ipapi?.proxy == true),
		is_vpn: (lc(sprintf('%s', pc?.type ?? '')) == 'vpn') || (ipq_ok && ipq.risk?.is_vpn == true),
		is_tor: (ipq_ok && ipq.risk?.is_tor == true) || (lc(sprintf('%s', pc?.type ?? '')) == 'tor'),
		is_datacenter: (ipq_ok && ipq.risk?.is_datacenter == true) || (ov_ipapi?.hosting == true) || (lc(sprintf('%s', pc?.type ?? '')) == 'hosting'),
		is_hosting: (ov_ipapi?.hosting == true) || (ipq_ok && ipq.risk?.is_datacenter == true),
		is_mobile: (ipq_ok && ipq.risk?.is_mobile == true) || (ov_ipapi?.mobile == true) || (lc(sprintf('%s', pc?.type ?? '')) == 'wireless')
	};

	let scores = [];
	let sources = [];
	if (pc && pc.risk != null) {
		push(scores, int(pc.risk));
		push(sources, 'proxycheck.io');
	}
	if (ipq_ok && ipq.risk && ipq.risk.risk_score != null) {
		push(scores, int(ipq.risk.risk_score));
		push(sources, 'ipquery.io');
	}
	if (ov_ipapi) {
		push(sources, 'ip-api.com');
	}

	let fraud_score = null;
	if (length(scores) > 0) {
		let mx = scores[0];
		for (let i = 1; i < length(scores); i++) {
			if (scores[i] > mx) mx = scores[i];
		}
		fraud_score = mx;
	}

	// Ensure verified hosting/proxy/vpn/tor flags are honestly reflected if proxycheck was rate-limited
	if (length(ov_ip) > 0 && (!pc || pc.risk == null)) {
		let flag_floor = 0;
		if (flags.is_hosting || flags.is_datacenter) flag_floor += 35;
		if (flags.is_proxy || flags.is_vpn) flag_floor += 35;
		if (flags.is_tor) flag_floor = 95;
		if (flag_floor > 100) flag_floor = 100;
		if (fraud_score == null || flag_floor > fraud_score) {
			fraud_score = flag_floor;
		}
	}

	let isp_type = classify_isp_type(pc?.type ?? '', flags);
	let risk_meta = classify_risk_level(fraud_score);

	// Parse all 12 service checks
	let svc_defs = [
		['baidu', '百度', 'domestic'],
		['bilibili', '哔哩哔哩', 'domestic'],
		['weixin', '微信', 'domestic'],
		['taobao', '淘宝', 'domestic'],
		['google', 'Google', 'overseas'],
		['github', 'GitHub', 'overseas'],
		['youtube', 'YouTube', 'overseas'],
		['cloudflare', 'Cloudflare', 'overseas'],
		['openai', 'ChatGPT', 'overseas'],
		['netflix', 'Netflix', 'overseas'],
		['telegram', 'Telegram', 'overseas'],
		['apple', 'Apple', 'overseas']
	];
	let services = [];
	for (let d in svc_defs) {
		let line = readfile(`${workdir}/svc_${d[0]}.txt`) ?? '000 0';
		push(services, parse_service_line(line, d[0], d[1], d[2]));
	}

	// Clean temp files
	system(['rm', '-rf', workdir]);
	safe_unlink(proxy_cfg);

	let result = {
		status: 'done',
		updated_at: time(),
		route_mode: setup.route_mode,
		nikki_running: setup.running,
		domestic: {
			ok: length(dom_ip) > 0,
			ip: dom_ip,
			country: dom_country,
			region: dom_region,
			city: dom_city,
			location: join_nonempty([dom_country, dom_region, dom_city], ' · '),
			isp: dom_isp,
			asn: dom_asn,
			source: dom_source
		},
		overseas: {
			ok: length(ov_ip) > 0,
			ip: ov_ip,
			country: ov_country,
			country_code: ov_country_code,
			region: ov_region,
			city: ov_city,
			location: join_nonempty([ov_country, ov_region, ov_city], ' · '),
			isp: ov_isp,
			org: ov_org,
			asn: ov_asn,
			isp_type: isp_type.code,
			isp_type_label: isp_type.label,
			fraud_score: fraud_score,
			risk_level: risk_meta.level,
			risk_label: risk_meta.label,
			flags: flags,
			sources: uniq(sources)
		},
		services: services
	};

	write_file_atomic(PROBE_STATE_PATH, sprintf('%J', result), 0o600);
}

try {
	run_probe();
} catch (err) {
	write_file_atomic(PROBE_STATE_PATH, sprintf('%J', {
		status: 'error',
		updated_at: time(),
		error: sprintf('%s', err)
	}), 0o600);
}
