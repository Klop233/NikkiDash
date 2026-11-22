# NikkiDash

面向 OpenWrt `>= 24.10` 的 **Nikki / Mihomo** 独立现代 Web 管理面板，提供类桌面 Clash 的交互体验。

## 核心特性

- **集成 Nikki 核心管理（无需单独手动装 `nikki`）**：提供一键安装脚本（`install.sh`）自动按架构安装官方 `nikki` + `mihomo` 核心与 NikkiDash；也可直接单独安装 `.ipk` / `.apk`，在面板向导或面板设置中**一键安装/更新 Nikki & Mihomo 核心**并清理旧版 `luci-app-nikki`。
- **双格式原生支持**：同时构建 OpenWrt `24.10`（`.ipk` / `opkg`）与 OpenWrt / ImmortalWrt `25.12+`（`.apk` / `apk`）安装包。
- **独立端口、零常驻重后端**：独立 `uhttpd` 实例（默认仅 LAN `:18080`）+ `rpcd/ucode` 后端，路由器运行时零 Node.js / Go / Python 依赖，**不依赖 `luci-app-nikki`**。
- **桌面 Clash 级日常体验**：总览实时流量与速率图、策略组与嵌套节点切换/测速、可搜索分页的连接表、运行时规则与 Provider 更新、订阅与本地配置管理、实时脱敏日志与只读诊断包。
- **完整覆盖 Nikki UCI**：通过版本化 Schema（锁定 `OpenWrt-nikki v1.26.2`）完整管理基本、procd/core、透明代理、TUN、DNS/Hosts、Sniffer、LAN/路由器访问控制、路由标记与日志策略；自动保留未识别 UCI 字段；复杂配置支持前端+服务端双重校验的高级 YAML 编辑与历史备份恢复。
- **事务安全与异步任务**：写锁 + `revision` 乐观并发检测 + 自动备份 + `yq`/`mihomo -t` 校验 + 失败回滚；长任务在 `/var/run/nikki-dash` 持久化，刷新或断网不中断。
- **严谨安全边界**：SID 仅驻留前端 JS 内存（Bearer 模式、无 Cookie/localStorage、无 CORS、严禁 `no_ubusauth`）；支持 `LAN 认证` / `LAN 受限免登录` / `WAN HTTPS` 三模式互斥；Mihomo 控制器仅后端回环白名单访问，不暴露 `api_secret`。

## 一键安装（OpenWrt / ImmortalWrt 24.10 & 25.12+）

自动检测架构与包管理器（`opkg` / `apk`），自动安装 `nikki` + `mihomo-meta` 核心与 NikkiDash（不安装旧版 `luci-app-nikki`）：

```sh
curl -fsSL https://raw.githubusercontent.com/Klop233/NikkiDash/main/install.sh | sh
```

安装同时自动清理旧版 LuCI 界面（保留核心 `nikki` 与 `/etc/config/nikki`）：

```sh
curl -fsSL https://raw.githubusercontent.com/Klop233/NikkiDash/main/install.sh | sh -s -- --remove-luci
```

## 快速构建与测试

```bash
npm --prefix frontend ci
npm --prefix frontend run typecheck
npm --prefix frontend test
node scripts/build-frontend.mjs
node scripts/build-ipk.mjs
node scripts/build-apk.mjs
```

## 文档

- [安装、升级、卸载与故障恢复](docs/install-and-recovery.md)
- [安全模型与权限边界](docs/security.md)
- [RPC 接口契约](docs/rpc.md)
- [上游兼容性与 UCI 覆盖矩阵](docs/compatibility.md)
