include $(TOPDIR)/rules.mk

PKG_NAME:=nikki-dash
PKG_VERSION:=0.3.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=Klop233

PKG_BUILD_PARALLEL:=1

include $(INCLUDE_DIR)/package.mk

define Package/nikki-dash
  SECTION:=net
  CATEGORY:=Network
  TITLE:=NikkiDash - Standalone modern web dashboard for Nikki (Mihomo)
  URL:=https://github.com/Klop233/NikkiDash
  PKGARCH:=all
  DEPENDS:=+rpcd +rpcd-mod-ucode +uhttpd +uhttpd-mod-ubus +curl +yq +ucode +ucode-mod-fs +ucode-mod-uci +ucode-mod-ubus +ucode-mod-math
endef

define Package/nikki-dash/description
  NikkiDash is an independent, Clash-inspired web dashboard for Nikki/Mihomo
  on OpenWrt >=24.10. It runs on a dedicated uhttpd instance with rpcd/ucode
  APIs, requires no Node.js/Go/Python runtime, and does not depend on
  luci-app-nikki.
endef

define Package/nikki-dash/conffiles
/etc/config/nikki_dash
endef

define Build/Prepare
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/nikki-dash/install
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) $(CURDIR)/files/etc/config/nikki_dash $(1)/etc/config/nikki_dash

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) $(CURDIR)/files/etc/init.d/nikki-dash $(1)/etc/init.d/nikki-dash

	$(INSTALL_DIR) $(1)/usr/share/nikki-dash/lib
	$(INSTALL_DATA) $(CURDIR)/files/usr/share/nikki-dash/headers.json $(1)/usr/share/nikki-dash/headers.json
	$(INSTALL_DATA) $(CURDIR)/files/usr/share/nikki-dash/schema.json $(1)/usr/share/nikki-dash/schema.json
	$(INSTALL_DATA) $(CURDIR)/files/usr/share/nikki-dash/lib/common.uc $(1)/usr/share/nikki-dash/lib/common.uc
	$(INSTALL_DATA) $(CURDIR)/files/usr/share/nikki-dash/lib/schema.uc $(1)/usr/share/nikki-dash/lib/schema.uc
	$(INSTALL_DATA) $(CURDIR)/files/usr/share/nikki-dash/lib/mihomo.uc $(1)/usr/share/nikki-dash/lib/mihomo.uc
	$(INSTALL_DATA) $(CURDIR)/files/usr/share/nikki-dash/lib/files.uc $(1)/usr/share/nikki-dash/lib/files.uc
	$(INSTALL_DATA) $(CURDIR)/files/usr/share/nikki-dash/lib/tx.uc $(1)/usr/share/nikki-dash/lib/tx.uc
	$(INSTALL_DATA) $(CURDIR)/files/usr/share/nikki-dash/lib/access.uc $(1)/usr/share/nikki-dash/lib/access.uc
	$(INSTALL_DATA) $(CURDIR)/files/usr/share/nikki-dash/lib/core.uc $(1)/usr/share/nikki-dash/lib/core.uc
	$(INSTALL_DATA) $(CURDIR)/files/usr/share/nikki-dash/lib/diagnostics.uc $(1)/usr/share/nikki-dash/lib/diagnostics.uc

	$(INSTALL_DIR) $(1)/usr/libexec/nikki-dash
	$(INSTALL_BIN) $(CURDIR)/files/usr/libexec/nikki-dash/worker.uc $(1)/usr/libexec/nikki-dash/worker.uc
	$(INSTALL_BIN) $(CURDIR)/files/usr/libexec/nikki-dash/netcheck.uc $(1)/usr/libexec/nikki-dash/netcheck.uc
	$(INSTALL_BIN) $(CURDIR)/files/usr/libexec/nikki-dash/revoke_guest.uc $(1)/usr/libexec/nikki-dash/revoke_guest.uc

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) $(CURDIR)/files/usr/share/rpcd/acl.d/nikki-dash.json $(1)/usr/share/rpcd/acl.d/nikki-dash.json

	$(INSTALL_DIR) $(1)/usr/share/rpcd/ucode
	$(INSTALL_DATA) $(CURDIR)/files/usr/share/rpcd/ucode/nikki-dash $(1)/usr/share/rpcd/ucode/nikki-dash

	$(INSTALL_DIR) $(1)/www/nikki-dash
	$(CP) $(CURDIR)/files/www/nikki-dash/* $(1)/www/nikki-dash/
endef

define Package/nikki-dash/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
# Never modify /etc/config/nikki or auto-start nikki.
# Only reload rpcd ACLs/plugins and enable/restart the standalone dashboard.
/etc/init.d/rpcd reload >/dev/null 2>&1 || /etc/init.d/rpcd restart >/dev/null 2>&1 || true
/etc/init.d/nikki-dash enable >/dev/null 2>&1 || true
/etc/init.d/nikki-dash restart >/dev/null 2>&1 || true
exit 0
endef

define Package/nikki-dash/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
/etc/init.d/nikki-dash stop >/dev/null 2>&1 || true
/etc/init.d/nikki-dash disable >/dev/null 2>&1 || true
# Clean up dedicated guest login if LAN passwordless mode was active
if uci -q get rpcd.nikki_dash_guest >/dev/null 2>&1; then
	uci -q delete rpcd.nikki_dash_guest
	uci -q commit rpcd
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
fi
exit 0
endef

$(eval $(call BuildPackage,nikki-dash))
