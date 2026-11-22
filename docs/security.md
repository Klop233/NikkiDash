# NikkiDash 安全模型与边界说明

## 1. `/ubus` 管理员边界（务必阅读）

- 独立 `uhttpd` 的 `/ubus` 是 OpenWrt 标准通用 ubus RPC 入口，而非 Nikki 专用窄网关。
- 使用路由器 `root` 账号调用 `session.login` 登录后，会话拥有 `/etc/config/rpcd` 中为 `root` 配置的完整路由器管理员权限（`read '*'`, `write '*'`）。NikkiDash 自己的最小 ACL **不会缩小** 已有 `root` 会话的权限。
- 因此，若启用 **WAN HTTPS 模式**，认证后的用户应被视为**受信任的路由器管理员**。NikkiDash 不宣称 `root` 登录后只能操作 Nikki。

## 2. 会话凭据与跨站防护

- 登录 SID **仅保存在浏览器 JavaScript 内存变量** 中，不写入 Cookie、`localStorage`、`sessionStorage` 或 URL。
- 请求使用 `POST /ubus/call/<object>` 搭配 `Authorization: Bearer <sid>` 与 `credentials: 'omit'`。
- 独立 `uhttpd` 实例严格禁用 CORS（不传 `-X`）且强制开启鉴权（严禁 `-a` / `no_ubusauth`），并启用 `-S`（禁止越界符号链接）和 `-D`（禁止目录列表）。
- 通过 `-H /usr/share/nikki-dash/headers.json` 下发安全响应头：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer` 与严格的 `Content-Security-Policy`。
- 所有日志、YAML 内容与节点名称均以纯文本节点渲染，免疫 XSS。

## 3. 三种访问模式与互斥规则

| 模式 | 监听范围 | 认证要求 | 免登录账号 `rpcd.nikki_dash_guest` |
| --- | --- | --- | --- |
| `lan_auth`（默认） | 仅解析出的 LAN IP + loopback | 路由器账号登录 | 删除并撤销所有访客会话 |
| `lan_guest` | 仅解析出的 LAN IP + loopback | 自动登录受限 `nikki-dash-guest`（使用 `uhttpd -m ''` 生成的空密码哈希，绝不使用固定 root 密码或 `no_ubusauth`） | 启用，仅授权 `nikki-dash-guest` ACL（无 `set_access`，无通用 `uci`/`file`/`exec`） |
| `wan_https` | `0.0.0.0:<https_port>` 与 `[::]:<https_port>`（仅 HTTPS） | 强制路由器账号登录 + 显式确认风险 + 有效证书 | 强制删除并立即销毁所有访客会话 |

- NikkiDash **绝不自动修改防火墙放行 WAN 端口**、不配置 UPnP/NAT/DDNS。如需外网访问，建议优先使用 WireGuard / Tailscale，或在 OpenWrt 防火墙中手动配置受控规则。

## 4. Mihomo 控制器隔离

- 浏览器永远不直接连接 Mihomo 9090 端口，也永远无法获取 `api_secret`。
- 后端调用 `curl` 时通过 `0600` 临时配置文件传递 `Authorization: Bearer`，密钥不会出现在进程命令行（`/proc/*/cmdline`）或 shell 中。
- 后端只提供白名单操作，无通用 `{method, path, body}` 透传，且所有外部命令执行均采用常量包装 + `argv` 数组传递，杜绝命令注入。
- 当检测到 Mihomo 监听在 `[::]:9090` 或 `0.0.0.0:9090` 时，面板会提示风险并提供用户确认后的一键修复（改为 `127.0.0.1:9090`），安装阶段绝不静默改动现有配置。

## 5. 并发与故障恢复边界

- NikkiDash 使用 `/var/run/nikki-dash/write.lock` 串行化自身写操作，并通过配置内容哈希 (`revision`) 检测 SSH / 原 LuCI / CLI 的外部修改（乐观并发控制）。
- 无法对外部 CLI/SSH 写入者强制加锁，因此明确不宣称与所有外部写入者具备强事务隔离。
