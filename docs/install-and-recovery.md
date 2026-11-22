# 安装、升级、卸载与故障恢复指南

## 1. 环境要求

- OpenWrt / ImmortalWrt `>= 24.10`（支持 `24.10` `opkg` 与 `25.12+` `apk`，需 `firewall4`）
- **无需预先手动安装 `nikki` 或 `luci-app-nikki`**：可通过一键脚本自动装齐 `nikki` + `mihomo` 核心与 NikkiDash，或在安装 NikkiDash 后于网页内**一键安装/更新 Nikki 核心**。
- 基础依赖：`rpcd`, `rpcd-mod-ucode`, `uhttpd`, `uhttpd-mod-ubus`, `curl`, `yq`, `ucode` 及其基础模块

## 2. 安装与首次访问

### 方式 A：一键安装脚本（推荐，自动集成安装 Nikki + Mihomo 核心与 NikkiDash）

```sh
curl -fsSL https://raw.githubusercontent.com/Klop233/NikkiDash/main/install.sh | sh
```

常用参数：
- `--remove-luci`：安装完成后自动卸载旧版 `luci-app-nikki` 与 `luci-i18n-nikki-*`（完整保留核心 `nikki` 与 `/etc/config/nikki`）
- `--core-variant=alpha`：使用 `mihomo-alpha`（默认 `meta` 即 `mihomo-meta`）
- `--upgrade`：强制同步升级现有 `nikki` 与 `mihomo`
- `--skip-core`：仅安装 NikkiDash（稍后可在面板网页中点击一键安装核心）

### 方式 B：手动安装安装包（支持单独安装，进网页后再一键装核心）

- **OpenWrt 24.10 (`opkg`)**：
  ```sh
  opkg update
  opkg install /tmp/nikki-dash_*_all.ipk
  ```
- **OpenWrt / ImmortalWrt 25.12+ (`apk`)**：
  ```sh
  apk update
  apk add --allow-untrusted /tmp/nikki-dash-*.apk
  ```

安装后默认行为：
- **不修改** `/etc/config/nikki`，保留你原有的 Nikki 订阅与规则配置。
- **不自动启动** `nikki` 代理服务，也不会开放 WAN 端口。
- 自动启动独立面板服务 `nikki-dash`，默认仅监听 **LAN 接口的 `18080` 端口**（`http://<路由器LAN-IP>:18080`）。
- 首次访问请使用路由器 `root` 账号和密码登录。

### 卸载旧的 `luci-app-nikki`（可选）

确认 NikkiDash 正常运行后，可以直接在 NikkiDash「面板设置 → Nikki 核心集成与旧版 LuCI 管理」一键卸载，或在 SSH 执行（**切勿卸载 `nikki` 核心服务包**）：

```sh
# OpenWrt 25.12+ (apk)
apk del luci-i18n-nikki-zh-cn luci-app-nikki

# OpenWrt 24.10 (opkg)
opkg remove luci-i18n-nikki-zh-cn luci-app-nikki
```

## 3. 升级与卸载

- **升级**：`opkg install /tmp/nikki-dash_<new>_all.ipk`。`/etc/config/nikki_dash` 已标记为 `conffiles`，升级会保留面板与 Nikki 全部配置。
- **卸载**：
  ```sh
  opkg remove nikki-dash
  ```
  卸载时会自动停止 `nikki-dash` 并清理可能启用过的 `rpcd.nikki_dash_guest` 访客账号，**不会**停止或删除 `nikki` 配置。

## 4. 端口错误或无法访问时的恢复方法

面板服务与 OpenWrt SSH、原 LuCI 及 Nikki 代理完全独立。若误配端口或 HTTPS 证书导致无法打开面板，通过 SSH 登录路由器执行：

```sh
uci set nikki_dash.main.enabled='1'
uci set nikki_dash.main.access_mode='lan_auth'
uci set nikki_dash.main.http_port='18080'
uci commit nikki_dash
uci -q delete rpcd.nikki_dash_guest && uci commit rpcd
/etc/init.d/rpcd reload
/etc/init.d/nikki-dash restart
```

查看面板最近启动错误：

```sh
cat /var/run/nikki-dash/service.error
logread -e nikki-dash
```

## 5. 从源码构建

```bash
npm --prefix frontend ci
npm --prefix frontend test
node scripts/build-frontend.mjs
node scripts/build-ipk.mjs
```

构建产物输出在 `dist/nikki-dash_<version>_all.ipk` 及 `dist/SHA256SUMS`。
