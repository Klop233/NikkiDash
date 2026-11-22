# 上游兼容性与版本锁定矩阵

本文档锁定 NikkiDash 首版（`v0.1.0`）开发与验证所依据的上游源码版本，以及对 `OpenWrt-nikki` 全部 UCI 配置与 RPC 能力的覆盖矩阵。

## 1. 锁定上游版本

| 组件 | 仓库 | 锁定版本 / Commit | 说明 |
| --- | --- | --- | --- |
| OpenWrt-nikki | `https://github.com/nikkinikki-org/OpenWrt-nikki` | `v1.26.2` / `aaf46bf02a9ab2b5a8ab3fcaa5f84c99e56585bf` | UCI 配置、init 脚本、`mixin.uc`、`hijack.ut` |
| Mihomo | `https://github.com/MetaCubeX/mihomo` | `v1.19.34` | 本地控制 API（`/version`, `/configs`, `/proxies`, `/group/*/delay`, `/connections`, `/rules`, `/providers/*`） |
| OpenWrt | `https://github.com/openwrt/openwrt` | `24.10.4` (`r28959-29397011cc`, `>=24.10`, kernel `>=5.13`, `firewall4`) | 实际运行环境容器验证基线 |
| uhttpd | `https://github.com/openwrt/uhttpd` | `93b05e0b65d91c23c5aa8fdde378df1f174ec71d` | 独立实例、`POST /ubus/call/<obj>` Bearer 认证、`UH_UBUS_MAX_POST_SIZE=65536`、`-H` json_script 响应头 |
| rpcd | `https://github.com/openwrt/rpcd` | `469d7852316ef692805396d8af744ec43604b842` | `session.login`、`session.access`、`/etc/config/rpcd` 独立受限账号、ucode 插件 |

## 2. UCI 完整覆盖矩阵 (`schema/nikki-schema.json`)

| UCI Section | 类型 | 覆盖状态 | 备注 |
| --- | --- | --- | --- |
| `config` | 具名 | 完整覆盖 | `enabled`, `profile`, `start_delay`, `scheduled_restart`, `scheduled_restart_cron`, `test_profile`, `core_only` |
| `procd` | 具名 | 完整覆盖 | `fast_reload`, 全部 `rlimit_*`, 全部 `env_*`（含 `env_safe_paths` 冒号分隔列表转换） |
| `core` | 具名 | 完整覆盖 | `redirect_listener_name`, `tproxy_listener_name`, `tun_listener_name` |
| `mixin` | 具名 | 完整覆盖 | 常规、外部控制、入站端口、TUN、DNS/Fake-IP、Sniffer、规则/Provider 开关、GeoX、`mixin_file_content` |
| `proxy` | 具名 | 完整覆盖 | `tcp_mode`, `udp_mode`, IPv4/IPv6 代理与 DNS 劫持、`router_proxy`, `lan_proxy`, `lan_inbound_interface`, 绕过与保留网段、TUN 超时 |
| `routing` | 具名 | 完整覆盖 | `tproxy/tun` fwmark/mask/pref/table、`cgroup_id`, `cgroup_name`, `dummy_device` |
| `log` | 具名 | 完整覆盖 | `clear_at_stop`, `scheduled_clear`, `scheduled_clear_cron`, 大小限制与单位 |
| `subscription` | 可重复 | 完整覆盖 | CRUD、排序、更新任务；完整兼容上游只读字段拼写 `avaliable` |
| `authentication` | 可重复 | 完整覆盖 | 密码默认掩码，留空保留原值 |
| `hosts` | 可重复 | 完整覆盖 | 域名到多 IP 列表 |
| `nameserver` | 可重复 | 完整覆盖 | 5 类上游 DNS 组 |
| `proxy_server_nameserver_policy` | 可重复 | 完整覆盖 | 兼容上游 `mixin.uc` 使用的 `dns_proxy_server_nameserver_policy` 开关 |
| `nameserver_policy` | 可重复 | 完整覆盖 | 域名分流 DNS 策略 |
| `sniff` | 可重复 | 完整覆盖 | `HTTP` / `TLS` / `QUIC` 协议端口与目标覆盖 |
| `rule_provider` | 可重复 | 完整覆盖 | `http` / `file` 来源、格式、行为与更新周期 |
| `rule` | 可重复 | 完整覆盖 | 支持增删排序及 `no_resolve` |
| `router_access_control` | 可重复 | 完整覆盖 | `user`, `group`, `cgroup`, `dns`, `proxy` |
| `lan_access_control` | 可重复 | 完整覆盖 | `ip`, `ip6`, `mac`, `dns`, `proxy` |
| 未知字段 / 未知 Section | 任意 | 自动保留 | 读取时在 UI 提示，保存时保留原值不静默丢弃 |

## 3. 与 `luci-app-nikki` 的关系

- `nikki-dash` **不依赖** `luci-app-nikki`，也不调用 `luci.nikki` RPC。
- 仅依赖 `nikki` 服务包本身提供的 `/etc/init.d/nikki`、`/etc/config/nikki` 与 `/etc/nikki/ucode/mixin.uc`。
- 诊断包功能由 NikkiDash 独立只读实现，**不会**像上游 `debug.sh` 那样临时开启并重启关闭中的 Nikki 服务。
