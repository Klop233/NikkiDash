# 安装、升级、卸载与故障恢复指南

## 1. 环境要求

- OpenWrt `>= 24.10`（kernel `>= 5.13`，`firewall4`）
- 已安装 `nikki` 服务包及对应架构的 `mihomo` 核心（**无需**安装 `luci-app-nikki`）
- 基础依赖：`rpcd`, `rpcd-mod-ucode`, `uhttpd`, `uhttpd-mod-ubus`, `curl`, `yq`, `ucode` 及其基础模块

## 2. 安装与首次访问

将 GitHub Releases 下载的 `nikki-dash_<version>_all.ipk` 上传到路由器 `/tmp/` 后执行：

```sh
opkg update
opkg install /tmp/nikki-dash_*_all.ipk
```

（若使用 OpenWrt 25.12+ `apk`，请使用对应 `.apk` 或构建脚本输出。）

安装后默认行为：
- **不修改** `/etc/config/nikki`，保留你原有的 Nikki 订阅与规则配置。
- **不自动启动** `nikki` 代理服务，也不会开放 WAN 端口。
- 自动启动独立面板服务 `nikki-dash`，默认仅监听 **LAN 接口的 `18080` 端口**（`http://<路由器LAN-IP>:18080`）。
- 首次访问请使用路由器 `root` 账号和密码登录。

### 卸载旧的 `luci-app-nikki`（可选）

确认 NikkiDash 正常运行后，如果不再需要原 LuCI 网页界面，可仅卸载 `luci-app-nikki`（**切勿卸载 `nikki` 核心服务包**）：

```sh
opkg remove luci-app-nikki
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
