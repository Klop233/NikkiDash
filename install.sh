#!/bin/sh
set -eu

# NikkiDash All-in-One Installer for OpenWrt / ImmortalWrt >= 24.10
# Automatically installs Nikki core + Mihomo (without luci-app-nikki) AND NikkiDash (.ipk or .apk).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Klop233/NikkiDash/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/Klop233/NikkiDash/main/install.sh | sh -s -- --remove-luci
#
# Options:
#   --core-variant=meta|alpha   Mihomo core package (default: meta -> mihomo-meta)
#   --version=vX.Y.Z            Install a specific NikkiDash release tag (default: latest)
#   --upgrade                   Also upgrade existing nikki & mihomo packages
#   --skip-core                 Skip installing nikki/mihomo core (can still install inside NikkiDash UI)
#   --remove-luci               Safely remove legacy luci-app-nikki & luci-i18n-nikki-* after install

DASH_REPO="Klop233/NikkiDash"
NIKKI_REPO_BASE="https://nikkinikki.pages.dev"
CORE_VARIANT="meta"
TARGET_VERSION="latest"
DO_UPGRADE="0"
SKIP_CORE="0"
REMOVE_LUCI="0"

for arg in "$@"; do
	case "$arg" in
		--core-variant=*) CORE_VARIANT="${arg#*=}" ;;
		--version=*) TARGET_VERSION="${arg#*=}" ;;
		--upgrade) DO_UPGRADE="1" ;;
		--skip-core) SKIP_CORE="1" ;;
		--remove-luci) REMOVE_LUCI="1" ;;
		-h|--help)
			sed -n '3,16p' "$0"
			exit 0
			;;
		*)
			echo "[ERROR] Unknown option: $arg" >&2
			exit 2
			;;
	esac
done

case "$CORE_VARIANT" in
	meta|alpha) ;;
	*)
		echo "[ERROR] --core-variant must be 'meta' or 'alpha'" >&2
		exit 2
		;;
esac

log() {
	echo "[NikkiDash] $*"
}

die() {
	echo "[NikkiDash][ERROR] $*" >&2
	exit 1
}

[ "$(id -u)" = "0" ] || die "Please run as root"
[ -f /etc/openwrt_release ] || die "/etc/openwrt_release not found (OpenWrt / ImmortalWrt required)"
[ -x /sbin/fw4 ] || die "firewall4 (/sbin/fw4) is required (OpenWrt >= 24.10)"

PKG_MGR=""
if [ -x /usr/bin/apk ]; then
	PKG_MGR="apk"
elif [ -x /bin/opkg ] || command -v opkg >/dev/null 2>&1; then
	PKG_MGR="opkg"
else
	die "Neither apk nor opkg package manager found"
fi

# shellcheck disable=SC1091
. /etc/openwrt_release
ARCH="${DISTRIB_ARCH:-}"
RELEASE="${DISTRIB_RELEASE:-}"
[ -n "$ARCH" ] || die "Unable to detect DISTRIB_ARCH"

BRANCH=""
case "$RELEASE" in
	*24.10*) BRANCH="openwrt-24.10" ;;
	*25.12*) BRANCH="openwrt-25.12" ;;
	*SNAPSHOT*) BRANCH="SNAPSHOT" ;;
	*) die "Unsupported OpenWrt/ImmortalWrt release: $RELEASE (supported: 24.10, 25.12, SNAPSHOT)" ;;
esac

log "Detected ${DISTRIB_ID:-OpenWrt} ${RELEASE} (${ARCH}), pkg_mgr=${PKG_MGR}, branch=${BRANCH}"

# Ensure curl is available for HTTPS downloads
if ! command -v curl >/dev/null 2>&1; then
	log "Installing curl..."
	if [ "$PKG_MGR" = "apk" ]; then
		apk update
		apk add curl
	else
		opkg update
		opkg install curl
	fi
fi

# Backup existing /etc/config/nikki before any package changes
NIKKI_CFG_BAK=""
if [ -f /etc/config/nikki ]; then
	NIKKI_CFG_BAK="/tmp/nikki.config.install.bak"
	cp /etc/config/nikki "$NIKKI_CFG_BAK"
fi

# Step 1: Install Nikki + Mihomo core automatically (without luci-app-nikki)
NEED_CORE="0"
if [ "$SKIP_CORE" = "0" ]; then
	if [ "$DO_UPGRADE" = "1" ] || [ ! -x /etc/init.d/nikki ] || ! command -v mihomo >/dev/null 2>&1; then
		NEED_CORE="1"
	fi
fi

if [ "$NEED_CORE" = "1" ]; then
	CORE_PKG="mihomo-${CORE_VARIANT}"
	OTHER_PKG="mihomo-alpha"
	[ "$CORE_VARIANT" = "alpha" ] && OTHER_PKG="mihomo-meta"
	FEED_URL="${NIKKI_REPO_BASE}/${BRANCH}/${ARCH}/nikki"

	log "Configuring official Nikki core feed (${FEED_URL})..."
	if [ "$PKG_MGR" = "apk" ]; then
		mkdir -p /etc/apk/keys /etc/apk/repositories.d
		curl -fsSL -o /etc/apk/keys/nikki.pem "${NIKKI_REPO_BASE}/public-key.pem"
		if [ -f /etc/apk/repositories.d/customfeeds.list ]; then
			sed -i '/nikkinikki\.pages\.dev/d;/\/nikki\//d' /etc/apk/repositories.d/customfeeds.list
		fi
		echo "${FEED_URL}/packages.adb" >> /etc/apk/repositories.d/customfeeds.list
		apk update
		apk info -e "$OTHER_PKG" >/dev/null 2>&1 && apk del "$OTHER_PKG" || true
		log "Installing ${CORE_PKG} and nikki core (without luci-app-nikki)..."
		apk add --upgrade "$CORE_PKG" nikki
	else
		KEY_TMP="/tmp/nikki-key-build.pub"
		curl -fsSL -o "$KEY_TMP" "${NIKKI_REPO_BASE}/key-build.pub"
		opkg-key add "$KEY_TMP"
		rm -f "$KEY_TMP"
		if [ -f /etc/opkg/customfeeds.conf ]; then
			sed -i '/^src\/gz[[:space:]]\+nikki[[:space:]]/d' /etc/opkg/customfeeds.conf
		fi
		echo "src/gz nikki ${FEED_URL}" >> /etc/opkg/customfeeds.conf
		opkg update
		opkg list-installed "$OTHER_PKG" | grep -q "^${OTHER_PKG} " && opkg remove "$OTHER_PKG" || true
		log "Installing ${CORE_PKG} and nikki core (without luci-app-nikki)..."
		opkg install "$CORE_PKG" nikki
	fi

	# Restore existing /etc/config/nikki if user already had one
	if [ -n "$NIKKI_CFG_BAK" ] && [ -s "$NIKKI_CFG_BAK" ]; then
		cp "$NIKKI_CFG_BAK" /etc/config/nikki
	fi
else
	log "Nikki core already installed (or --skip-core set); skipping core installation."
fi

# Step 2: Resolve latest NikkiDash release tag & download matching package (.apk or .ipk)
if [ "$TARGET_VERSION" = "latest" ]; then
	log "Fetching latest NikkiDash release tag..."
	TARGET_VERSION="$(curl -fsSL "https://api.github.com/repos/${DASH_REPO}/releases/latest" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
	[ -n "$TARGET_VERSION" ] || die "Failed to resolve latest release tag from GitHub"
fi

VER_NUM="${TARGET_VERSION#v}"
BASE_DL="https://github.com/${DASH_REPO}/releases/download/${TARGET_VERSION}"
TMP_DIR="/tmp/nikki-dash-install"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

log "Downloading SHA256SUMS for ${TARGET_VERSION}..."
curl -fsSL -o "${TMP_DIR}/SHA256SUMS" "${BASE_DL}/SHA256SUMS"

if [ "$PKG_MGR" = "apk" ]; then
	PKG_FILE="$(awk '/\.apk$/ {print $2; exit}' "${TMP_DIR}/SHA256SUMS")"
	[ -n "$PKG_FILE" ] || PKG_FILE="nikki-dash-${VER_NUM}-r1.apk"
else
	PKG_FILE="$(awk '/\.ipk$/ {print $2; exit}' "${TMP_DIR}/SHA256SUMS")"
	[ -n "$PKG_FILE" ] || PKG_FILE="nikki-dash_${VER_NUM}-r1_all.ipk"
fi

log "Downloading ${PKG_FILE}..."
curl -fsSL -o "${TMP_DIR}/${PKG_FILE}" "${BASE_DL}/${PKG_FILE}"

EXPECTED_SHA="$(awk -v f="$PKG_FILE" '$2 == f {print $1; exit}' "${TMP_DIR}/SHA256SUMS")"
if [ -n "$EXPECTED_SHA" ]; then
	ACTUAL_SHA="$(sha256sum "${TMP_DIR}/${PKG_FILE}" | awk '{print $1}')"
	[ "$EXPECTED_SHA" = "$ACTUAL_SHA" ] || die "SHA256 mismatch for ${PKG_FILE}! Expected ${EXPECTED_SHA}, got ${ACTUAL_SHA}"
	log "SHA256 verified: ${ACTUAL_SHA}"
fi

# Step 3: Install NikkiDash package (and required OpenWrt base dependencies)
log "Installing ${PKG_FILE}..."
if [ "$PKG_MGR" = "apk" ]; then
	apk update
	apk add --allow-untrusted "${TMP_DIR}/${PKG_FILE}"
else
	opkg update
	opkg install "${TMP_DIR}/${PKG_FILE}"
fi

rm -rf "$TMP_DIR"
[ -n "$NIKKI_CFG_BAK" ] && rm -f "$NIKKI_CFG_BAK"

# Step 4: Optional safe cleanup of legacy LuCI UI (keeps core nikki & /etc/config/nikki intact!)
if [ "$REMOVE_LUCI" = "1" ]; then
	log "Removing legacy luci-app-nikki UI packages (preserving core nikki and /etc/config/nikki)..."
	if [ "$PKG_MGR" = "apk" ]; then
		LUCI_PKGS="$(apk info | grep -E '^luci-(app|i18n)-nikki(-[a-z0-9_-]+)?$' || true)"
		if [ -n "$LUCI_PKGS" ]; then
			# shellcheck disable=SC2086
			apk del $LUCI_PKGS
		fi
	else
		LUCI_PKGS="$(opkg list-installed | awk '{print $1}' | grep -E '^luci-(app|i18n)-nikki(-[a-z0-9_-]+)?$' || true)"
		if [ -n "$LUCI_PKGS" ]; then
			# shellcheck disable=SC2086
			opkg remove $LUCI_PKGS
		fi
	fi
fi

# Step 5: Ensure rpcd & nikki-dash services are active
/etc/init.d/rpcd reload >/dev/null 2>&1 || /etc/init.d/rpcd restart >/dev/null 2>&1 || true
/etc/init.d/nikki-dash enable >/dev/null 2>&1 || true
/etc/init.d/nikki-dash restart >/dev/null 2>&1 || true

LAN_IP="$(uci -q get network.lan.ipaddr 2>/dev/null | cut -d/ -f1 || echo '192.168.1.1')"
PORT="$(uci -q get nikki_dash.main.http_port 2>/dev/null || echo '18080')"
log "Installation complete!"
log "Open NikkiDash in your LAN browser: http://${LAN_IP}:${PORT}"
log "Login with your OpenWrt router account (e.g. root)."
