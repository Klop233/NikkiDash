# NikkiDash RPC 接口契约

所有面板接口统一注册在 ubus 对象 `nikki-dash` 下，通过独立 `uhttpd` 实例同源提供：
- 现代 Bearer 调用：`POST /ubus/call/nikki-dash`（请求头 `Authorization: Bearer <sid>`，SID 仅存于前端 JS 内存）
- 登录：`POST /ubus/call/session`（method `login`，无需 Authorization 头）

## 1. ACL 分组

| ACL 组 | 授予对象 | 允许方法 |
| --- | --- | --- |
| `unauthenticated` | 默认未登录会话 | 仅 `nikki-dash.auth_info`（以及 rpcd 内置 `session.login` / `session.access`） |
| `nikki-dash` | 路由器认证用户（如 `root`） | 全部 `nikki-dash` 读写方法 + `session.access/destroy` |
| `nikki-dash-guest` | 仅 LAN 免登录专用账号 `nikki-dash-guest` | 除 `set_access` 外的 `nikki-dash` 方法；**严禁**授予 `uci`/`file`/`exec`/`rc`/`service`/`system`/`luci.*` |

## 2. 方法清单

### 元数据与状态
- `auth_info()`: 返回 `{ version, title, access_mode, lan_guest_enabled, default_theme, default_lang, wan_warning }`。
- `capabilities()`: 返回系统依赖、版本、代理冲突列表（如 OpenClash/PassWall）、调用者身份与特性标志。
- `get_status()`: 返回 Nikki 运行状态、PID、运行时间、活动配置、健康摘要、控制器暴露状态（不含 secret）与进行中任务。
- `get_overview_metrics()`: 经回环白名单读取 Mihomo `/configs`、`/connections`、`/proxies` 汇总指标。

### Mihomo 白名单操作（禁止通用透传）
- `get_proxies()` / `select_proxy({ group, name })`
- `test_delay({ kind: 'proxy'|'group', name, url?, timeout? })`（超时钳制在 `500..10000` ms）
- `set_mode({ mode: 'rule'|'global'|'direct', persist? })`
- `get_connections()` / `close_connection({ id })` / `close_all_connections()`
- `get_rules()` / `update_provider({ kind: 'rule'|'proxy', name })`

### 配置、事务与异步长任务
- `get_config()`: 返回按 schema 解析的 UCI 配置、`revision` 摘要、未知字段记录与系统标识符（users/groups/cgroups/networks/hosts）。
- `apply_config({ revision, changes, action: 'save'|'test'|'apply', idempotency_key? })`:
  - `save`: 加锁、乐观并发检查、schema 校验后同步写入 UCI。
  - `test` / `apply`: 启动独立后台 worker（`/usr/libexec/nikki-dash/worker.uc`），执行备份 → 候选生成 → `yq`/`mihomo -t` 校验 → 提交 → 重载/等待就绪 → 明确失败时回滚。
  - 任务状态：`queued` / `running` / `succeeded` / `failed` / `rolled_back` / `rollback_failed` / `unknown`（超时返回 `unknown`，不盲目回滚）。
- `service_action({ action: 'start'|'stop'|'restart'|'reload'|'enable'|'disable', idempotency_key? })`
- `update_subscription({ section_id, reload_if_active?, idempotency_key? })`
- `get_task({ task_id })` / `list_tasks({ limit? })`

### 受控文件与分片上传（突破 uhttpd 64 KiB POST 限制）
- `list_files()` / `read_file({ category, name?, offset?, max_bytes? })`
- `save_file({ category, name?, content, expected_revision?, require_clash_keys? })`
- `upload_begin` / `upload_chunk` / `upload_commit`：支持最大 4 MiB YAML 文件分片上传、临时 `0600` 文件校验与原子落盘。
- `list_backups({ category, name? })` / `restore_backup({ category, name?, backup_id })`
- 固定目录类别：`mixin`、`profile`、`subscription`、`rule_provider`、`proxy_provider`、`run_config`（只读）。

### 订阅、配置与面板访问
- `get_profiles()` / `import_profile` / `delete_profile` / `save_subscription` / `delete_subscription` / `switch_profile`
- `fix_controller_bind({ bind_addr, clear_tls_wildcard?, apply? })`
- `get_logs({ source: 'app'|'core', tail_lines?, max_bytes? })` / `clear_logs({ source })` / `get_diagnostics()`
- `get_access()` / `set_access(...)`（仅管理员可调用）

## 3. 标准错误码
`LOCKED`, `REVISION_CONFLICT`, `VALIDATION_FAILED`, `YAML_SYNTAX_ERROR`, `YAML_SEMANTIC_ERROR`, `INVALID_FILENAME`, `SYMLINK_REJECTED`, `READ_ONLY`, `ACTIVE_PROFILE_PROTECTED`, `CONTROLLER_UNCONFIGURED`, `CONTROLLER_UNREACHABLE`, `CONTROLLER_TIMEOUT`, `CONTROLLER_AUTH_FAILED`, `WAN_CONFIRM_REQUIRED`, `SSL_UNAVAILABLE`, `CERT_MISSING`, `PORT_CONFLICT`, `FORBIDDEN`。
