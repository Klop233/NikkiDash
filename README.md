# NikkiDash

面向 OpenWrt `>= 24.10` 的 **Nikki / Mihomo** 独立现代 Web 管理面板，提供类桌面 Clash 的交互体验。

## 核心特性

- **三合一整合包 (`nikki-dash-all`) + 轻量独立包 (`nikki-dash`)**：
  - **`nikki-dash-all`**（按架构提供 `x86_64`、`aarch64_generic`、`aarch64_cortex-a53`、`aarch64_cortex-a72`、`arm_cortex-a7_neon-vfpv4`、`mipsel_24kc`、`riscv64_generic`）：**单包内置 `Nikki` 透明代理脚本 + `Mihomo` 内核 + `NikkiDash` 独立面板 + LuCI「服务 → NikkiDash」入口**，一次安装全部就绪，且绝不覆盖已有 `/etc/config/nikki`。
  - **`nikki-dash`**（`all` / `noarch` 轻量包）：仅包含独立面板与 LuCI 入口，适用于已单独维护 `nikki`/`mihomo` 的路由器，亦内置一键核心安装向导。
- **路由器 LuCI「服务 → NikkiDash」入口**：内置零 Lua 依赖的原生 LuCI JS 视图，在「服务」菜单中直接提供一键打开 NikkiDash 面板、启停 Nikki / 开机自启，以及端口、访问模式、监听接口等基础设置。
- **GitHub CI 自动同步上游版本**：内置定时工作流（`Sync Upstream Nikki & Mihomo`）每日自动追踪 `nikkinikki-org/OpenWrt-nikki` 与 `MetaCubeX/mihomo` 最新版本与全架构 SHA256 校验值，自动同步、校验并创建 PR。
- **双格式原生支持**：同时构建 OpenWrt `24.10`（`.ipk` / `opkg`）与 OpenWrt / ImmortalWrt `25.12+`（`.apk` / `apk`）安装包。
- **独立端口、零常驻重后端**：独立 `uhttpd` 实例（默认仅 LAN `:18080`）+ `rpcd/ucode` 后端，路由器运行时零 Node.js / Go / Python 依赖，**不依赖 `luci-app-nikki`**。
- **FlClash 级日常体验**：总览实时流量与速率图、出站模式、当前订阅配额、出口 IP 纯净度/欺诈分与常见服务连通性检测；节点页支持双视图切换、隐藏信息节点、一键定位、嵌套策略组直达与切换自动断开旧连接；连接表支持设备/直连/代理快捷筛选与分页。
- **完整覆盖 Nikki UCI**：通过版本化 Schema 完整管理基本、procd/core、透明代理、TUN、DNS/Hosts、Sniffer、LAN/路由器访问控制、路由标记与日志策略；自动保留未识别 UCI 字段；复杂配置支持前端+服务端双重校验的高级 YAML 编辑与历史备份恢复。
- **事务安全与严谨安全边界**：写锁 + `revision` 乐观并发检测 + 自动备份 + `yq`/`mihomo -t` 校验 + 失败回滚；SID 仅驻留内存/受控会话、无 Cookie/CORS、严禁 `no_ubusauth`；支持 `LAN 认证` / `LAN 受限免密` / `WAN HTTPS` 三模式互斥；Mihomo 控制器仅后端回环白名单访问。

## 快速安装

### 方式一：单包三合一安装（推荐，免配置第三方源）

前往 [Releases](https://github.com/Klop233/NikkiDash/releases) 下载对应架构的 `nikki-dash-all` 包：

```sh
# OpenWrt / ImmortalWrt 25.12+ (apk)
apk add --allow-untrusted nikki-dash-all-<ver>_x86_64.apk

# OpenWrt 24.10 (opkg)
opkg install nikki-dash-all_<ver>_x86_64.ipk
```

### 方式二：在线一键脚本安装（OpenWrt / ImmortalWrt 24.10 & 25.12+）

自动检测架构与包管理器（`opkg` / `apk`），自动安装官方 `nikki` + `mihomo-meta` 核心与 NikkiDash（不安装旧版 `luci-app-nikki`）：

```sh
curl -fsSL https://raw.githubusercontent.com/Klop233/NikkiDash/main/install.sh | sh
```

安装同时自动清理旧版 LuCI 界面（保留核心 `nikki` 与 `/etc/config/nikki`）：

```sh
curl -fsSL https://raw.githubusercontent.com/Klop233/NikkiDash/main/install.sh | sh -s -- --remove-luci
```

## 快速构建与上游同步

```bash
npm --prefix frontend ci
npm --prefix frontend run typecheck
npm --prefix frontend test
node scripts/sync-upstream.mjs          # 同步最新 OpenWrt-nikki 与 Mihomo 版本清单
node scripts/build-frontend.mjs
node scripts/build-ipk.mjs              # 构建轻量独立 .ipk
node scripts/build-apk.mjs              # 构建轻量独立 .apk
node scripts/build-bundle.mjs --arch x86_64   # 构建 x86_64 三合一整合包（--all 构建全架构）
```

## 文档

- [安装、升级、卸载与故障恢复](docs/install-and-recovery.md)
- [安全模型与权限边界](docs/security.md)
- [RPC 接口契约](docs/rpc.md)
- [上游兼容性与 UCI 覆盖矩阵](docs/compatibility.md)
