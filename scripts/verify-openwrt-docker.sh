#!/bin/sh
set -eu

# Live end-to-end verification inside a real OpenWrt 24.10 container.
# Tests: .ipk packaging, /etc/config/nikki preservation, ucode compilation,
# real ubusd + rpcd + standalone uhttpd + security headers + Bearer SID auth,
# unknown UCI preservation, revision conflict, path traversal/symlink rejection,
# chunked upload > 64 KiB, mock Mihomo loopback controller APIs,
# LAN guest restricted ACL + instant revocation, and WAN HTTPS cert/risk gating.

fail() {
	echo "[FAIL] $1" >&2
	exit 1
}

pass() {
	echo "[PASS] $1"
}

echo "=== 1. Verify OpenWrt 24.10 environment & install test deps (curl, yq) ==="
cat /etc/openwrt_release
mkdir -p /var/lock /tmp /var/run /var/log
if ! command -v curl >/dev/null 2>&1 || ! command -v yq >/dev/null 2>&1; then
	if [ -n "${OPENWRT_MIRROR:-}" ]; then
		sed -i "s|https://downloads.openwrt.org|${OPENWRT_MIRROR}|g" /etc/opkg/distfeeds.conf
	fi
	opkg update || fail "opkg update failed"
	opkg install curl yq ucode-mod-socket || fail "Failed to install curl/yq/ucode-mod-socket via opkg"
fi
command -v curl >/dev/null 2>&1 || fail "curl missing"
command -v yq >/dev/null 2>&1 || fail "yq missing"

# Prepare existing Nikki config (must NOT be modified by nikki-dash install!)
mkdir -p /etc/nikki/profiles /etc/nikki/subscriptions /etc/nikki/run /var/log/nikki /var/run/nikki /etc/config
cat > /etc/config/nikki <<'EOF'
config status 'status'

config config 'config'
	option init '1'
	option enabled '0'
	option profile 'file:existing.yaml'
	option test_profile '1'
	option custom_unknown_flag 'keep_me_intact'

config procd 'procd'
	option fast_reload '0'
	option rlimit_nofile_soft '65536'

config core 'core'
	option redirect_listener_name 'redir-in'

config subscription 'sub1'
	option name 'MySub'
	option url 'https://example.invalid/sub?token=secret123'
	option user_agent 'clash.meta'
	option prefer 'remote'

config mixin 'mixin'
	option mode 'rule'
	option api_listen '[::]:9090'
	option api_secret 'top-secret-mihomo-token'
	option dns_mode 'fake-ip'

config proxy 'proxy'
	option enabled '1'
	option tcp_mode 'redirect'
	option udp_mode 'tun'

config routing 'routing'
	option tproxy_route_table '80'
	option tun_route_table '81'

config log 'log'
	option clear_at_stop '1'

config custom_extension 'ext1'
	option extra_val 'preserve_section'
EOF

cat > /etc/nikki/profiles/existing.yaml <<'EOF'
proxies:
  - name: HK-01
    type: ss
    server: 1.2.3.4
    port: 443
    cipher: aes-128-gcm
    password: secret
proxy-groups:
  - name: Proxy
    type: select
    proxies:
      - HK-01
      - DIRECT
rules:
  - MATCH,Proxy
EOF

cat > /etc/nikki/run/config.yaml <<'EOF'
mode: rule
external-controller: 127.0.0.1:19090
secret: top-secret-mihomo-token
proxies:
  - name: HK-01
    type: ss
    server: 1.2.3.4
    port: 443
    password: node-secret-password
EOF

cat > /etc/nikki/mixin.yaml <<'EOF'
log-level: warning
EOF

printf '[2026-11-22 10:00:00] [App] Started with https://user:mypass@sub.example.com/get?token=abc123\n' > /var/log/nikki/app.log
printf 'time="2026-11-22T10:00:01Z" level=info msg="Bearer supersecret999 loaded"\n' > /var/log/nikki/core.log

cat > /etc/init.d/nikki <<'EOF'
#!/bin/sh
echo "mock nikki init: $*" >> /var/log/nikki/app.log
exit 0
EOF
chmod +x /etc/init.d/nikki

# Do NOT pre-register nikki in opkg status: verify nikki-dash installs standalone without nikki!
PRE_HASH="$(sha256sum /etc/config/nikki | awk '{print $1}')"

echo "=== 2. Verify & unpack built .ipk package ==="
IPK_FILE="$(ls /mnt/dist/nikki-dash_*.ipk | head -n 1)"
[ -f "$IPK_FILE" ] || fail "No .ipk found in /mnt/dist"
mkdir -p /tmp/ipk-unpack
tar -xzf "$IPK_FILE" -C /tmp/ipk-unpack
[ -f /tmp/ipk-unpack/debian-binary ] || fail "Missing debian-binary"
[ -f /tmp/ipk-unpack/control.tar.gz ] || fail "Missing control.tar.gz"
[ -f /tmp/ipk-unpack/data.tar.gz ] || fail "Missing data.tar.gz"
tar -xzf /tmp/ipk-unpack/control.tar.gz -C /tmp/ipk-unpack
grep -q 'Package: nikki-dash' /tmp/ipk-unpack/control || fail "Invalid control file"
grep -q 'Architecture: all' /tmp/ipk-unpack/control || fail "Package must be Architecture: all"
if grep '^Depends:' /tmp/ipk-unpack/control | grep -q 'luci-app-nikki'; then
	fail "Package must NOT depend on luci-app-nikki"
fi
opkg install "$IPK_FILE" || fail "opkg install failed on built .ipk!"
opkg list-installed nikki-dash | grep -q 'nikki-dash' || fail "nikki-dash not registered in opkg!"
pass ".ipk verified and installed cleanly via real opkg"

POST_HASH="$(sha256sum /etc/config/nikki | awk '{print $1}')"
[ "$PRE_HASH" = "$POST_HASH" ] || fail "/etc/config/nikki was modified during install!"
pass "Existing /etc/config/nikki preserved untouched"

echo "=== 3. Verify all ucode modules compile cleanly ==="
for f in /usr/share/nikki-dash/lib/*.uc; do
	ucode -S -e "import * as m from '$f'; if (length(keys(m)) == 0) exit(1);" || fail "Import failed: $f"
done
for f in /usr/libexec/nikki-dash/*.uc /usr/share/rpcd/ucode/nikki-dash; do
	ucode -S -c "$f" || fail "Compile failed: $f"
done
pass "All ucode modules compile cleanly on OpenWrt 24.10"

echo "=== 4. Start real ubusd, rpcd, mock Mihomo loopback controller, and standalone uhttpd ==="
mkdir -p /var/run/ubus /var/run/nikki-dash
HASH_PW="$(uhttpd -m 'testpass123')"
cat > /etc/config/rpcd <<EOF
config rpcd
	option socket /var/run/ubus/ubus.sock
	option timeout 30

config login
	option username 'root'
	option password '$HASH_PW'
	list read '*'
	list write '*'
EOF

ubusd -s /var/run/ubus/ubus.sock &
sleep 1
rpcd -s /var/run/ubus/ubus.sock -t 30 &
sleep 1

ubus list | grep -qx 'nikki-dash' || fail "nikki-dash ubus object not registered in rpcd!"
pass "rpcd loaded nikki-dash ucode plugin"

# Start lightweight loopback mock Mihomo controller on 127.0.0.1:19090 checking Bearer secret!
cat > /tmp/mock-mihomo.uc <<'EOF'
import { listen } from 'socket';
const EXPECTED = 'Bearer top-secret-mihomo-token';
let selected = 'HK-01';
let mode = 'rule';
let srv = listen('127.0.0.1', 19090);
while (true) {
	let cli = srv.accept();
	if (!cli) continue;
	let raw = cli.recv(16384) ?? '';
	let lines = split(raw, '\r\n');
	let reqline = split(lines[0] ?? '', ' ');
	let method = reqline[0] ?? '';
	let path = reqline[1] ?? '/';
	let auth = '';
	for (let l in lines) {
		if (lc(substr(l, 0, 14)) == 'authorization:') {
			auth = trim(substr(l, 14));
		}
	}
	let status = '200 OK';
	let body = '{}';
	if (auth != EXPECTED) {
		status = '401 Unauthorized';
		body = '{"message":"unauthorized"}';
	} else if (path == '/version') {
		body = '{"meta":true,"version":"v1.19.34"}';
	} else if (path == '/configs' && method == 'GET') {
		body = sprintf('{"mode":"%s"}', mode);
	} else if (path == '/configs' && method == 'PATCH') {
		let idx = index(raw, '\r\n\r\n');
		let p = idx >= 0 ? json(substr(raw, idx + 4)) : {};
		if (p?.mode) mode = p.mode;
		status = '204 No Content';
		body = '';
	} else if (path == '/proxies') {
		body = sprintf('{"proxies":{"Proxy":{"name":"Proxy","type":"Selector","now":"%s","all":["HK-01","JP-02","DIRECT"]},"HK-01":{"name":"HK-01","type":"Shadowsocks","history":[{"time":"2026-11-22T00:00:00Z","delay":42}]},"JP-02":{"name":"JP-02","type":"Shadowsocks","history":[]}}}', selected);
	} else if (index(path, '/proxies/Proxy') == 0 && method == 'PUT') {
		let idx = index(raw, '\r\n\r\n');
		let p = idx >= 0 ? json(substr(raw, idx + 4)) : {};
		if (p?.name) selected = p.name;
		status = '204 No Content';
		body = '';
	} else if (index(path, '/delay?') >= 0) {
		body = '{"delay":38}';
	} else if (path == '/connections' && method == 'GET') {
		body = '{"uploadTotal":10240,"downloadTotal":40960,"memory":16777216,"connections":[{"id":"c1","upload":100,"download":500,"start":"2026-11-22T08:00:00Z","chains":["HK-01","Proxy"],"rule":"MATCH","rulePayload":"","metadata":{"network":"tcp","type":"HTTP","sourceIP":"192.168.100.10","sourcePort":"51000","destinationIP":"1.1.1.1","destinationPort":"443","host":"example.com"}}]}';
	} else if (index(path, '/connections') == 0 && method == 'DELETE') {
		status = '204 No Content';
		body = '';
	} else if (path == '/rules') {
		body = '{"rules":[{"type":"MATCH","payload":"","proxy":"Proxy"}]}';
	} else if (path == '/providers/rules' || path == '/providers/proxies') {
		body = '{"providers":{}}';
	}
	cli.send(sprintf("HTTP/1.1 %s\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", status, length(body), body));
	cli.close();
}
EOF
ucode /tmp/mock-mihomo.uc &
MOCK_PID=$!
sleep 1

uhttpd -f -h /www/nikki-dash -r NikkiDash -I index.html -u /ubus -U /var/run/ubus/ubus.sock -S -D -H /usr/share/nikki-dash/headers.json -p 127.0.0.1:18080 &
UHTTPD_PID=$!
sleep 1

echo "=== 5. Verify static SPA & security headers ==="
HDRS="$(curl -fsSI http://127.0.0.1:18080/)"
echo "$HDRS" | grep -qi 'X-Content-Type-Options: nosniff' || fail "Missing X-Content-Type-Options"
echo "$HDRS" | grep -qi 'X-Frame-Options: DENY' || fail "Missing X-Frame-Options"
echo "$HDRS" | grep -qi 'Content-Security-Policy:' || fail "Missing CSP header"
echo "$HDRS" | grep -qi 'Referrer-Policy: no-referrer' || fail "Missing Referrer-Policy"
if echo "$HDRS" | grep -qi 'Access-Control-Allow-Origin'; then
	fail "CORS header must NOT be enabled!"
fi
curl -fsS http://127.0.0.1:18080/ | grep -q 'NikkiDash' || fail "SPA index.html not served"
pass "Standalone uhttpd serves SPA with strict security headers and no CORS"

echo "=== 6. Verify unauthenticated ACL boundary ==="
AUTH_INFO="$(curl -fsS -X POST http://127.0.0.1:18080/ubus/call/nikki-dash -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"auth_info","params":{}}')"
echo "$AUTH_INFO" | grep -q '"access_mode":"lan_auth"' || fail "auth_info unexpected: $AUTH_INFO"

UNAUTH_STATUS="$(curl -fsS -X POST http://127.0.0.1:18080/ubus/call/nikki-dash -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"get_status","params":{}}')"
echo "$UNAUTH_STATUS" | grep -q '"code":-32002' || fail "Unauthenticated get_status must be DENIED! Got: $UNAUTH_STATUS"

BAD_LOGIN="$(curl -fsS -X POST http://127.0.0.1:18080/ubus/call/session -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":3,"method":"login","params":{"username":"root","password":"wrongpassword"}}')"
echo "$BAD_LOGIN" | grep -q '"error"' || fail "Wrong password login must fail! Got: $BAD_LOGIN"
pass "Unauthenticated requests denied; bad password rejected"

echo "=== 7. Verify authenticated Bearer login + Mihomo bridge + UCI preservation ==="
LOGIN_RES="$(curl -fsS -X POST http://127.0.0.1:18080/ubus/call/session -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":4,"method":"login","params":{"username":"root","password":"testpass123"}}')"
SID="$(printf '%s' "$LOGIN_RES" | jsonfilter -e '@.result.ubus_rpc_session' 2>/dev/null || true)"
[ -n "$SID" ] || fail "Failed to obtain SID: $LOGIN_RES"

rpc_call() {
	curl -fsS -X POST "http://127.0.0.1:18080/ubus/call/$1" \
		-H 'Content-Type: application/json' \
		-H "Authorization: Bearer $SID" \
		-d "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"$2\",\"params\":$3}"
}

CAPS="$(rpc_call nikki-dash capabilities '{}')"
echo "$CAPS" | grep -q '"authenticated":true' || fail "capabilities did not detect authenticated session: $CAPS"
echo "$CAPS" | grep -q '"integrated_core_manager":true' || fail "capabilities missing integrated_core_manager: $CAPS"

CORE_ST="$(rpc_call nikki-dash get_core_status '{}')"
echo "$CORE_ST" | grep -q '"pkg_mgr":"opkg"' || fail "get_core_status failed: $CORE_ST"
echo "$CORE_ST" | grep -q '"branch":"openwrt-24.10"' || fail "get_core_status branch detection failed: $CORE_ST"

# Mihomo allowlisted APIs (loopback + 0600 curl secret config)
PROXIES="$(rpc_call nikki-dash get_proxies '{}')"
echo "$PROXIES" | grep -q '"HK-01"' || fail "get_proxies failed: $PROXIES"

SEL="$(rpc_call nikki-dash select_proxy '{"group":"Proxy","name":"JP-02"}')"
echo "$SEL" | grep -q '"ok":true' || fail "select_proxy failed: $SEL"
PROXIES2="$(rpc_call nikki-dash get_proxies '{}')"
echo "$PROXIES2" | grep -q '"now":"JP-02"' || fail "select_proxy did not take effect: $PROXIES2"

DLY="$(rpc_call nikki-dash test_delay '{"kind":"proxy","name":"HK-01","timeout":2000}')"
echo "$DLY" | grep -q '"delay":38' || fail "test_delay failed: $DLY"

MODE_RES="$(rpc_call nikki-dash set_mode '{"mode":"global","persist":false}')"
echo "$MODE_RES" | grep -q '"mode":"global"' || fail "set_mode failed: $MODE_RES"

CONNS="$(rpc_call nikki-dash get_connections '{}')"
echo "$CONNS" | grep -q '"example.com"' || fail "get_connections failed: $CONNS"

RULES="$(rpc_call nikki-dash get_rules '{}')"
echo "$RULES" | grep -q '"MATCH"' || fail "get_rules failed: $RULES"
pass "Allowlisted Mihomo loopback APIs verified (proxies, select, delay, mode, connections, rules)"

CFG="$(rpc_call nikki-dash get_config '{}')"
echo "$CFG" | grep -q '"custom_unknown_flag":"keep_me_intact"' || fail "Unknown option not reported: $CFG"
echo "$CFG" | grep -q '"preserve_section"' || fail "Unknown section not reported: $CFG"
if echo "$CFG" | grep -q 'top-secret-mihomo-token'; then
	fail "get_config leaked api_secret!"
fi
REV="$(printf '%s' "$CFG" | jsonfilter -e '@.result.revision' 2>/dev/null || true)"
[ -n "$REV" ] || fail "Missing revision hash"

CONFLICT="$(rpc_call nikki-dash apply_config '{"revision":"deadbeef","action":"save","changes":{"named":{"config":{"start_delay":"5"}}}}')"
echo "$CONFLICT" | grep -q 'REVISION_CONFLICT' || fail "Expected REVISION_CONFLICT, got: $CONFLICT"

SAVED="$(rpc_call nikki-dash apply_config "{\"revision\":\"$REV\",\"action\":\"save\",\"changes\":{\"named\":{\"config\":{\"start_delay\":\"5\"}}}}")"
echo "$SAVED" | grep -q '"saved":true' || fail "Valid save failed: $SAVED"
grep -q "keep_me_intact" /etc/config/nikki || fail "Unknown option was wiped on save!"
grep -q "preserve_section" /etc/config/nikki || fail "Unknown section was wiped on save!"
grep -q "top-secret-mihomo-token" /etc/config/nikki || fail "Secret was wiped when left blank!"
pass "UCI save, secret masking, revision conflict, and unknown-field preservation verified"

echo "=== 8. Verify chunked upload (>64 KiB YAML), path traversal, symlink, & redaction ==="
# Chunked upload of ~78 KiB valid YAML profile (exceeds uhttpd's 64 KiB single-POST limit!)
BEG="$(rpc_call nikki-dash upload_begin '{"category":"profile","name":"large.yaml","total_size":80000}')"
UID_UP="$(printf '%s' "$BEG" | jsonfilter -e '@.result.upload_id' 2>/dev/null || true)"
[ -n "$UID_UP" ] || fail "upload_begin failed: $BEG"

CH1_B64="$(ucode -e 'let s = "proxies:\n"; for (let i = 0; i < 650; i++) s += sprintf("  - {name: N%d, type: direct}\n", i); print(b64enc(s));')"
CH2_B64="$(ucode -e 'let s = ""; for (let i = 650; i < 1300; i++) s += sprintf("  - {name: N%d, type: direct}\n", i); print(b64enc(s));')"
CH3_B64="$(ucode -e 'let s = ""; for (let i = 1300; i < 1950; i++) s += sprintf("  - {name: N%d, type: direct}\n", i); print(b64enc(s));')"
CH4_B64="$(ucode -e 'let s = ""; for (let i = 1950; i < 2500; i++) s += sprintf("  - {name: N%d, type: direct}\n", i); print(b64enc(s));')"

rpc_call nikki-dash upload_chunk "{\"upload_id\":\"$UID_UP\",\"chunk_b64\":\"$CH1_B64\",\"seq\":0}" | grep -q '"ok":true' || fail "chunk 0 failed"
rpc_call nikki-dash upload_chunk "{\"upload_id\":\"$UID_UP\",\"chunk_b64\":\"$CH2_B64\",\"seq\":1}" | grep -q '"ok":true' || fail "chunk 1 failed"
rpc_call nikki-dash upload_chunk "{\"upload_id\":\"$UID_UP\",\"chunk_b64\":\"$CH3_B64\",\"seq\":2}" | grep -q '"ok":true' || fail "chunk 2 failed"
rpc_call nikki-dash upload_chunk "{\"upload_id\":\"$UID_UP\",\"chunk_b64\":\"$CH4_B64\",\"seq\":3}" | grep -q '"ok":true' || fail "chunk 3 failed"
COM="$(rpc_call nikki-dash upload_commit "{\"upload_id\":\"$UID_UP\",\"require_clash_keys\":true}")"
echo "$COM" | grep -q '"saved":true' || fail "upload_commit failed: $COM"
LARGE_SZ="$(wc -c < /etc/nikki/profiles/large.yaml)"
[ "$LARGE_SZ" -gt 65536 ] || fail "large.yaml size ($LARGE_SZ) should exceed 64 KiB"

# Bad YAML rejected by server yq validation
BAD_YAML="$(rpc_call nikki-dash save_file '{"category":"mixin","name":"mixin.yaml","content":"foo: [unclosed"}')"
echo "$BAD_YAML" | grep -q 'YAML_SYNTAX_ERROR' || fail "Invalid YAML must be rejected: $BAD_YAML"

TRAV="$(rpc_call nikki-dash read_file '{"category":"profile","name":"../../etc/passwd"}')"
echo "$TRAV" | grep -q 'INVALID_FILENAME' || fail "Path traversal was not rejected: $TRAV"

ln -s /etc/passwd /etc/nikki/profiles/evil.yaml
SYML="$(rpc_call nikki-dash read_file '{"category":"profile","name":"evil.yaml"}')"
echo "$SYML" | grep -q 'SYMLINK_REJECTED' || fail "Symlink was not rejected: $SYML"
rm -f /etc/nikki/profiles/evil.yaml

RO_SAVE="$(rpc_call nikki-dash save_file '{"category":"run_config","name":"config.yaml","content":"mode: direct\n"}')"
echo "$RO_SAVE" | grep -q 'READ_ONLY' || fail "run_config must be read-only: $RO_SAVE"

LOGS="$(rpc_call nikki-dash get_logs '{"source":"app","tail_lines":50}')"
if echo "$LOGS" | grep -q 'mypass\|abc123'; then
	fail "Logs leaked unredacted credentials: $LOGS"
fi

DIAG="$(rpc_call nikki-dash get_diagnostics '{}')"
if echo "$DIAG" | grep -q 'top-secret-mihomo-token\|secret123\|node-secret-password\|supersecret999'; then
	fail "Diagnostics leaked unredacted secret!"
fi
[ "$(uci -q get nikki.config.enabled)" = "0" ] || fail "Diagnostics unexpectedly enabled Nikki!"
pass "Chunked upload (${LARGE_SZ} bytes > 64 KiB), YAML validation, path/symlink defense, and redaction verified"

echo "=== 9. Verify async worker task lifecycle ==="
TASK_RES="$(rpc_call nikki-dash service_action '{"action":"reload","idempotency_key":"idem_test_1"}')"
TID="$(printf '%s' "$TASK_RES" | jsonfilter -e '@.result.task.id' 2>/dev/null || true)"
[ -n "$TID" ] || fail "service_action did not return task ID: $TASK_RES"
# Idempotent retry returns same task ID
TASK_RES2="$(rpc_call nikki-dash service_action '{"action":"reload","idempotency_key":"idem_test_1"}')"
echo "$TASK_RES2" | grep -q '"deduplicated":true' || fail "Idempotency check failed: $TASK_RES2"
sleep 2
TSTATE="$(rpc_call nikki-dash get_task "{\"task_id\":\"$TID\"}")"
echo "$TSTATE" | grep -q '"status":"succeeded"' || fail "Async worker task did not succeed: $TSTATE"
pass "Async worker task execution & idempotency verified"

echo "=== 10. Verify LAN guest restricted ACL, instant revocation & WAN HTTPS gating ==="
WAN_NOACK="$(rpc_call nikki-dash set_access '{"access_mode":"wan_https","https_port":18443,"confirm_wan_risk":false}')"
echo "$WAN_NOACK" | grep -q 'WAN_CONFIRM_REQUIRED' || fail "WAN without confirmation must fail: $WAN_NOACK"

GUEST_HASH="$(uhttpd -m '')"
uci set rpcd.nikki_dash_guest=login
uci set rpcd.nikki_dash_guest.username='nikki-dash-guest'
uci set rpcd.nikki_dash_guest.password="$GUEST_HASH"
uci add_list rpcd.nikki_dash_guest.read='nikki-dash-guest'
uci add_list rpcd.nikki_dash_guest.write='nikki-dash-guest'
uci commit rpcd

GUEST_LOGIN="$(curl -fsS -X POST http://127.0.0.1:18080/ubus/call/session -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":20,"method":"login","params":{"username":"nikki-dash-guest","password":""}}')"
GSID="$(printf '%s' "$GUEST_LOGIN" | jsonfilter -e '@.result.ubus_rpc_session' 2>/dev/null || true)"
[ -n "$GSID" ] || fail "Guest login failed: $GUEST_LOGIN"

G_STATUS="$(curl -fsS -X POST http://127.0.0.1:18080/ubus/call/nikki-dash -H 'Content-Type: application/json' -H "Authorization: Bearer $GSID" -d '{"jsonrpc":"2.0","id":21,"method":"get_status","params":{}}')"
echo "$G_STATUS" | grep -q '"ok":true' || fail "Guest get_status failed: $G_STATUS"

G_SETACC="$(curl -fsS -X POST http://127.0.0.1:18080/ubus/call/nikki-dash -H 'Content-Type: application/json' -H "Authorization: Bearer $GSID" -d '{"jsonrpc":"2.0","id":22,"method":"set_access","params":{"access_mode":"wan_https"}}')"
echo "$G_SETACC" | grep -q '"code":-32002' || fail "Guest set_access must be DENIED! Got: $G_SETACC"

G_CORE="$(curl -fsS -X POST http://127.0.0.1:18080/ubus/call/nikki-dash -H 'Content-Type: application/json' -H "Authorization: Bearer $GSID" -d '{"jsonrpc":"2.0","id":221,"method":"install_core","params":{"core_variant":"meta"}}')"
echo "$G_CORE" | grep -q '"code":-32002' || fail "Guest install_core must be DENIED! Got: $G_CORE"

G_RMLUCI="$(curl -fsS -X POST http://127.0.0.1:18080/ubus/call/nikki-dash -H 'Content-Type: application/json' -H "Authorization: Bearer $GSID" -d '{"jsonrpc":"2.0","id":222,"method":"remove_luci_nikki","params":{}}')"
echo "$G_RMLUCI" | grep -q '"code":-32002' || fail "Guest remove_luci_nikki must be DENIED! Got: $G_RMLUCI"

G_UCI="$(curl -fsS -X POST http://127.0.0.1:18080/ubus/call/uci -H 'Content-Type: application/json' -H "Authorization: Bearer $GSID" -d '{"jsonrpc":"2.0","id":23,"method":"get","params":{"config":"nikki"}}')"
echo "$G_UCI" | grep -q '"code":-32002\|"code":-32000' || fail "Guest generic uci must be DENIED! Got: $G_UCI"

G_FILE="$(curl -fsS -X POST http://127.0.0.1:18080/ubus/call/file -H 'Content-Type: application/json' -H "Authorization: Bearer $GSID" -d '{"jsonrpc":"2.0","id":24,"method":"read","params":{"path":"/etc/shadow"}}')"
echo "$G_FILE" | grep -q '"code":-32002\|"code":-32000' || fail "Guest generic file.read must be DENIED! Got: $G_FILE"

REV_RES="$(rpc_call nikki-dash set_access '{"access_mode":"lan_auth","http_port":18080}')"
echo "$REV_RES" | grep -q '"ok":true' || fail "Switching back to lan_auth failed: $REV_RES"
sleep 1

G_AFTER="$(curl -fsS -X POST http://127.0.0.1:18080/ubus/call/nikki-dash -H 'Content-Type: application/json' -H "Authorization: Bearer $GSID" -d '{"jsonrpc":"2.0","id":25,"method":"get_status","params":{}}')"
echo "$G_AFTER" | grep -q '"code":-32002' || fail "Revoked guest SID still worked! Got: $G_AFTER"

G_RELOGIN="$(curl -fsS -X POST http://127.0.0.1:18080/ubus/call/session -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":26,"method":"login","params":{"username":"nikki-dash-guest","password":""}}')"
echo "$G_RELOGIN" | grep -q '"error"' || fail "Guest relogin after revocation must fail! Got: $G_RELOGIN"

# Verify self-signed cert generation + WAN HTTPS config succeeds ONLY when risk confirmed
WAN_OK="$(rpc_call nikki-dash set_access '{"access_mode":"wan_https","https_port":18443,"confirm_wan_risk":true,"generate_self_signed":true}')"
echo "$WAN_OK" | grep -q '"next_scheme":"https"' || fail "WAN HTTPS with risk confirmed + self-signed cert failed: $WAN_OK"
[ -s /etc/nikki-dash/server.crt ] && [ -s /etc/nikki-dash/server.key ] || fail "Self-signed TLS cert/key not generated"
pass "LAN guest ACL, instant revocation, and WAN HTTPS cert generation verified"

kill "$UHTTPD_PID" "$MOCK_PID" >/dev/null 2>&1 || true
echo "=== ALL OPENWRT 24.10 LIVE INTEGRATION TESTS PASSED ==="
