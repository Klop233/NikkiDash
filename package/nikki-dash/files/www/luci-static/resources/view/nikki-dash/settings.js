'use strict';
'require form';
'require rpc';
'require uci';
'require ui';
'require view';

var callGetStatus = rpc.declare({
	object: 'nikki-dash',
	method: 'get_status',
	expect: {}
});

var callGetAccess = rpc.declare({
	object: 'nikki-dash',
	method: 'get_access',
	expect: {}
});

var callServiceAction = rpc.declare({
	object: 'nikki-dash',
	method: 'service_action',
	params: ['action', 'idempotency_key'],
	expect: {}
});

var callNetDump = rpc.declare({
	object: 'network.interface',
	method: 'dump',
	expect: { interface: [] }
});

function buildPanelUrl(accessCfg) {
	var mode = (accessCfg && accessCfg.access_mode) || uci.get('nikki_dash', 'main', 'access_mode') || 'lan_auth';
	var isHttps = mode === 'wan_https';
	var port = isHttps
		? ((accessCfg && accessCfg.https_port) || uci.get('nikki_dash', 'main', 'https_port') || '18443')
		: ((accessCfg && accessCfg.http_port) || uci.get('nikki_dash', 'main', 'http_port') || '18080');
	var host = window.location.hostname || '192.168.1.1';
	return (isHttps ? 'https://' : 'http://') + host + ':' + port + '/';
}

function modeLabel(mode) {
	if (mode === 'lan_guest') return '仅局域网（免密）';
	if (mode === 'wan_https') return '公网 HTTPS（需登录）';
	return '仅局域网（需登录）';
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('nikki_dash'),
			L.resolveDefault(callGetStatus(), {}),
			L.resolveDefault(callGetAccess(), {}),
			L.resolveDefault(callNetDump(), [])
		]);
	},

	render: function(data) {
		var status = data[1] || {};
		var accessWrap = data[2] || {};
		var access = accessWrap.access || {};
		var ifaces = Array.isArray(data[3]) ? data[3] : [];

		var panelEnabled = uci.get('nikki_dash', 'main', 'enabled') !== '0';
		var panelUrl = buildPanelUrl(access);
		var nikkiRunning = status.running === true;
		var nikkiAutostart = status.autostart === true;
		var coreVer = status.core_version || '未检测到 Mihomo';
		var dashVer = status.dash_version || access.version || '';

		var runNikkiAction = function(action, label) {
			return callServiceAction(action, 'luci_' + action + '_' + Math.floor(Date.now() / 3000))
				.then(function(res) {
					if (res && res.ok === false) {
						ui.addNotification(null, E('p', {}, '操作失败：' + (res.error || '未知错误')), 'error');
					} else {
						ui.addNotification(null, E('p', {}, '已提交「' + label + '」任务，请稍候刷新查看状态。'), 'info');
						window.setTimeout(function() { location.reload(); }, 1800);
					}
				})
				.catch(function(err) {
					ui.addNotification(null, E('p', {}, '操作失败：' + (err && err.message ? err.message : String(err))), 'error');
				});
		};

		var m = new form.Map(
			'nikki_dash',
			'NikkiDash 服务',
			'Nikki (Mihomo) 独立现代 Web 控制面板。在此配置端口、访问模式等基础服务选项；节点切换、订阅管理、分流规则、IP 纯净度检测与高级设置在独立面板中完成。'
		);

		// Status & Quick Launch Section
		var statusSec = m.section(form.NamedSection, 'main', 'main', '运行状态与快捷入口');
		statusSec.anonymous = true;
		statusSec.addremove = false;

		statusSec.render = function() {
			var openBtn = E('a', {
				'class': 'btn cbi-button cbi-button-apply',
				'href': panelUrl,
				'target': '_blank',
				'rel': 'noopener noreferrer',
				'style': 'margin-right:8px'
			}, '打开 NikkiDash 面板');

			var toggleNikkiBtn = E('button', {
				'type': 'button',
				'class': 'btn cbi-button ' + (nikkiRunning ? 'cbi-button-reset' : 'cbi-button-action'),
				'style': 'margin-right:8px',
				'click': ui.createHandlerFn(this, function() {
					return runNikkiAction(nikkiRunning ? 'stop' : 'start', nikkiRunning ? '停止 Nikki' : '启动 Nikki');
				})
			}, nikkiRunning ? '停止 Nikki 代理' : '启动 Nikki 代理');

			var autoBtn = E('button', {
				'type': 'button',
				'class': 'btn cbi-button cbi-button-neutral',
				'click': ui.createHandlerFn(this, function() {
					return runNikkiAction(nikkiAutostart ? 'disable' : 'enable', nikkiAutostart ? '关闭 Nikki 开机自启' : '开启 Nikki 开机自启');
				})
			}, nikkiAutostart ? '关闭开机自启' : '开启开机自启');

			var rows = [
				['NikkiDash 面板', (panelEnabled ? '已启用' : '已停用') + (dashVer ? '（v' + dashVer + '）' : '') + ' · ' + modeLabel(access.access_mode || uci.get('nikki_dash', 'main', 'access_mode'))],
				['面板访问地址', E('a', { 'href': panelUrl, 'target': '_blank', 'rel': 'noopener noreferrer' }, panelUrl)],
				['Nikki 透明代理', (nikkiRunning ? '运行中（PID ' + (status.pid || '-') + '）' : '已停止') + ' · 开机自启：' + (nikkiAutostart ? '已开启' : '未开启')],
				['Mihomo 核心版本', coreVer]
			];

			if (access.last_service_error) {
				rows.push(['最近启动错误', E('span', { 'style': 'color:#c62828;font-weight:500' }, access.last_service_error)]);
			}

			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, '运行状态与快捷入口'),
				E('table', { 'class': 'table' },
					rows.map(function(r) {
						return E('tr', { 'class': 'tr' }, [
							E('td', { 'class': 'td left', 'style': 'width:26%;font-weight:500' }, r[0]),
							E('td', { 'class': 'td left' }, r[1])
						]);
					})
				),
				E('div', { 'style': 'margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center' }, [
					openBtn,
					toggleNikkiBtn,
					autoBtn
				])
			]);
		};

		// Basic Service Settings Section
		var s = m.section(form.NamedSection, 'main', 'main', '基础服务设置');
		s.addremove = false;

		var o = s.option(form.Flag, 'enabled', '启用 NikkiDash 面板', '开启后随路由器自动启动独立 Web 面板服务。');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.ListValue, 'access_mode', '访问模式', '默认仅允许局域网访问并验证路由器账号密码。');
		o.value('lan_auth', '仅局域网访问（需账号密码登录，推荐）');
		o.value('lan_guest', '仅局域网免密访问（受限访客权限）');
		o.value('wan_https', '公网 HTTPS 访问（需证书与登录验证）');
		o.default = 'lan_auth';
		o.rmempty = false;

		o = s.option(form.Value, 'http_port', 'HTTP 监听端口', '局域网访问端口，默认 18080。修改后请使用新端口打开面板。');
		o.datatype = 'port';
		o.default = '18080';
		o.placeholder = '18080';
		o.rmempty = false;
		o.depends('access_mode', 'lan_auth');
		o.depends('access_mode', 'lan_guest');

		o = s.option(form.DynamicList, 'listen_interface', '局域网监听接口', '仅绑定这些接口的局域网地址，默认 lan。');
		o.default = 'lan';
		o.depends('access_mode', 'lan_auth');
		o.depends('access_mode', 'lan_guest');
		ifaces.forEach(function(iface) {
			if (iface && iface.interface && iface.interface !== 'loopback') {
				o.value(iface.interface, iface.interface);
			}
		});

		o = s.option(form.Value, 'https_port', 'HTTPS 监听端口', '公网 HTTPS 模式监听端口，默认 18443。');
		o.datatype = 'port';
		o.default = '18443';
		o.placeholder = '18443';
		o.rmempty = false;
		o.depends('access_mode', 'wan_https');

		o = s.option(form.Flag, 'wan_risk_acknowledged', '确认公网访问安全风险', '启用公网 HTTPS 模式前必须勾选确认，并确保已配置强密码与防火墙规则。');
		o.default = '0';
		o.depends('access_mode', 'wan_https');

		o = s.option(form.Value, 'cert', 'TLS 证书文件路径', '可在 NikkiDash 独立面板中一键生成自签名证书，或填写自定义证书路径。');
		o.default = '/etc/nikki-dash/server.crt';
		o.depends('access_mode', 'wan_https');

		o = s.option(form.Value, 'key', 'TLS 私钥文件路径');
		o.default = '/etc/nikki-dash/server.key';
		o.depends('access_mode', 'wan_https');

		o = s.option(form.Value, 'session_timeout', '登录会话超时（秒）', '范围 300 ~ 86400 秒，默认 3600 秒。');
		o.datatype = 'range(300,86400)';
		o.default = '3600';
		o.rmempty = false;

		o = s.option(form.ListValue, 'theme', '默认外观主题');
		o.value('system', '跟随系统');
		o.value('light', '浅色模式');
		o.value('dark', '深色模式');
		o.default = 'system';

		o = s.option(form.ListValue, 'lang', '默认界面语言');
		o.value('zh-CN', '简体中文');
		o.value('en-US', 'English');
		o.default = 'zh-CN';

		return m.render();
	}
});
