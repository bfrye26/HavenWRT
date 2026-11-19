include $(TOPDIR)/rules.mk

PKG_NAME:=moci
PKG_VERSION:=1.3.0
PKG_RELEASE:=1

PKG_MAINTAINER:=HudsonGraeme
PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=LICENSE

include $(INCLUDE_DIR)/package.mk

define Package/moci
  SECTION:=admin
  CATEGORY:=Administration
  TITLE:=MoCI - Modern Configuration Interface for OpenWrt
  PKGARCH:=all
  DEPENDS:=+rpcd +jsonfilter +uhttpd +uhttpd-mod-ubus
endef

define Package/moci/description
  Modern web interface for OpenWrt routers.
  Pure vanilla JavaScript SPA using OpenWrt's native ubus API.
  Works with uhttpd (standard OpenWrt) or lighttpd (TurrisOS).
endef

define Build/Compile
endef

define Package/moci/install
	$(INSTALL_DIR) $(1)/www/moci
	$(INSTALL_DATA) ./dist/moci/index.html $(1)/www/moci/
	$(INSTALL_DATA) ./dist/moci/app.css $(1)/www/moci/
	$(INSTALL_DATA) ./dist/moci/manifest.json $(1)/www/moci/

	$(INSTALL_DIR) $(1)/www/moci/icons
	$(INSTALL_DATA) ./dist/moci/icons/icon-192.png $(1)/www/moci/icons/
	$(INSTALL_DATA) ./dist/moci/icons/icon-512.png $(1)/www/moci/icons/

	$(INSTALL_DIR) $(1)/www/moci/js
	$(INSTALL_DATA) ./dist/moci/js/core.js $(1)/www/moci/js/

	$(INSTALL_DIR) $(1)/www/moci/js/modules
	# Install every built module (wildcard) so new pages are never left out of
	# the firmware image. An explicit list previously dropped wan/devices/qos/
	# published-ports/app-integrations/wifi/networks/tls, blanking those pages.
	$(INSTALL_DATA) ./dist/moci/js/modules/*.js $(1)/www/moci/js/modules/

	$(INSTALL_DIR) $(1)/www/moci/fonts
	$(INSTALL_DATA) ./dist/moci/fonts/* $(1)/www/moci/fonts/

	$(INSTALL_DIR) $(1)/www/moci/js/addons

	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./files/moci-pkg-call $(1)/usr/libexec/moci-pkg-call
	$(INSTALL_BIN) ./files/moci-service-inspect $(1)/usr/libexec/moci-service-inspect
	$(INSTALL_BIN) ./files/moci-hardware-check $(1)/usr/libexec/moci-hardware-check
	$(INSTALL_BIN) ./files/moci-verify-image $(1)/usr/libexec/moci-verify-image
	$(INSTALL_BIN) ./files/moci-openvpn $(1)/usr/libexec/moci-openvpn
	$(INSTALL_DIR) $(1)/etc/moci
	$(INSTALL_DATA) ./files/moci-image.pub $(1)/etc/moci/moci-image.pub
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/moci-wifi-scheduler $(1)/usr/sbin/moci-wifi-scheduler
	$(INSTALL_BIN) ./files/moci-dns-publish $(1)/usr/sbin/moci-dns-publish
	$(INSTALL_BIN) ./files/moci-quota $(1)/usr/sbin/moci-quota
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/init-moci-wifi-scheduler $(1)/etc/init.d/moci-wifi-scheduler
	$(INSTALL_BIN) ./files/init-moci-dns-publish $(1)/etc/init.d/moci-dns-publish
	$(INSTALL_BIN) ./files/init-moci-quota $(1)/etc/init.d/moci-quota
	$(INSTALL_BIN) ./files/init-moci-performance $(1)/etc/init.d/moci-performance
	$(INSTALL_DIR) $(1)/etc/moci-dns-publish

	# Add-ons ship off: stop/disable their services on first boot unless enabled.
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/moci-addon-defaults $(1)/etc/uci-defaults/99-moci-addon-defaults
	# Speed defaults: flow offload, all-core packet steering, irqbalance.
	$(INSTALL_BIN) ./files/moci-performance-defaults $(1)/etc/uci-defaults/98-moci-performance

	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./files/rpcd-moci $(1)/usr/libexec/rpcd/moci

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./rpcd-acl.json $(1)/usr/share/rpcd/acl.d/moci.json

	$(INSTALL_DIR) $(1)/usr/share/acl.d
	$(INSTALL_DATA) ./files/ubus-acl-moci.json $(1)/usr/share/acl.d/moci.json

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/moci.config $(1)/etc/config/moci
	$(INSTALL_CONF) ./files/moci-wifi-schedule.config $(1)/etc/config/moci_wifi_schedule
	$(INSTALL_CONF) ./files/moci-quota.config $(1)/etc/config/moci_quota

	$(INSTALL_DIR) $(1)/etc/opkg/keys
	$(INSTALL_DATA) ./files/moci-feed.pub $(1)/etc/opkg/keys/bc0c5f67deb5edb8
	$(INSTALL_CONF) ./files/moci-apps.conf $(1)/etc/opkg/moci-apps.conf

	$(INSTALL_BIN) ./files/ubus.cgi $(1)/www/moci/ubus.cgi

	$(INSTALL_DIR) $(1)/etc/lighttpd/conf.d
	$(INSTALL_DATA) ./files/lighttpd-moci.conf $(1)/etc/lighttpd/conf.d/50-moci.conf
endef

define Package/moci/conffiles
/etc/config/moci
/etc/config/moci_wifi_schedule
/etc/config/moci_quota
/etc/opkg/moci-apps.conf
endef

define Package/moci/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	kill -HUP $$(pidof ubusd) 2>/dev/null
	/etc/init.d/rpcd restart
	/etc/init.d/moci-wifi-scheduler enable 2>/dev/null || :
	/etc/init.d/moci-wifi-scheduler start 2>/dev/null || :
	/etc/init.d/moci-dns-publish enable 2>/dev/null || :
	/etc/init.d/moci-dns-publish start 2>/dev/null || :
	/etc/init.d/moci-quota enable 2>/dev/null || :
	/etc/init.d/moci-quota start 2>/dev/null || :
	if [ -f /etc/init.d/lighttpd ]; then
		/etc/init.d/lighttpd restart
		echo "MoCI installed (lighttpd). Access at http://[router-ip]/moci/"
	else
		echo "MoCI installed. Access at http://[router-ip]/moci/"
	fi
}
endef

$(eval $(call BuildPackage,moci))
