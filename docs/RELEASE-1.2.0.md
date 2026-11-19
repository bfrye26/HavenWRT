# Haven 1.2.0 — Security & VPN

**Status: full release, validated on physical hardware (P09B / J4125, 6× Intel I225-V).**
Milestone 2 of the Tier 1–4 competitive program: threat blocking, enterprise Wi-Fi, IPv6, and a full
VPN/portal suite. No permission, rollback, or signature-validation changes.

Built on OpenWrt **v25.12.6**.

**Firmware image SHA-256:**
`17cbaea6b412f107d0b1339b6d74f71ab5c6d3dc7cd6cbbe1d691a808e5795cd`
(`openwrt-x86-64-generic-ext4-combined-efi.img.gz`)

**Installer ISO SHA-256 (dual-boot BIOS + UEFI):**
`1ca5d302fdfbddae24426dfd349977d1a3229eadf6e32ec12d0e429f628df0e1`
(`MoCI-x86-64-Installer.iso`)

## What's new

- **BanIP threat blocking** — native UI for the nftables-native banIP: enable, curated threat-feed
  selection, local allowlist, and runtime status.
- **WPA2/WPA3-Enterprise (RADIUS)** — the Wi-Fi editor now offers Enterprise security with external
  RADIUS auth/accounting server fields (uses the full wpad already shipped).
- **IPv6 WAN** — configure a `wan6` DHCPv6/SLAAC uplink (address request + prefix delegation) with live
  status, and see per-device **IPv6 leases** on the Devices page (odhcpd).
- **OpenVPN** — import a client `.ovpn` profile, or create a server (openssl PKI via a helper, EC DH to
  avoid slow dhparam) with an isolated firewall zone + WAN ingress. Baked into the image.
- **Captive portal** — openNDS (firewall4-native) splash gateway for guest networks: interface, login
  mode, session timeout, and a live client list. Baked into the image.
- **IPsec / IKEv2** — native site-to-site tunnel UI (strongSwan, PSK). The strongSwan daemon is
  **install-on-demand** (in-page Install button or System → Packages): its kernel-netlink plugin needs
  kernel crypto gates the default x86 kernel config hides, so it cannot be baked reliably; apk resolves
  the dependencies correctly at runtime.

## Verified on the P09B
- All new pages render; banIP/OpenVPN/portal/IPsec modules and the OpenVPN/openNDS binaries + helper
  present after sysupgrade; IPv6 WAN code in place.
- All 14 test suites pass, including `tests/security-vpn.test.mjs`; the features-toggle contract covers
  13 add-ons.
- Internet, Wi-Fi, and the Plex forward intact; configuration preserved.

## Hardware honesty
This J4125 has **no AES-NI**: OpenVPN/IPsec encrypt in software (expect lower throughput than
WireGuard, which stays the fast path). IPsec is install-on-demand for the kernel-config reason above.

## Installing / upgrading
Same artifacts as prior releases: a signed firmware image and a guided dual-boot installer ISO.
Upload the image (`.img.gz`) + `.sig` on **System → Firmware Upgrade**; Haven verifies the signature,
runs `sysupgrade --test`, then flashes after confirmation. Configuration is preserved. See the
[1.0.0 notes](RELEASE-1.0.0.md) for full install/verification instructions.

> **Upgrade data-loss constraint:** full-image x86 sysupgrade does not preserve root-resident Docker
> app data. Back up app data first, or upgrade empty-app systems.

## Security posture
Unchanged: firewall4/nftables stays; all new services are opt-in and off by default. VPN servers open
only their configured WAN port into an isolated zone; the captive portal gates a chosen guest bridge;
RADIUS secrets are password fields, never echoed; no Docker socket exposure; secrets never exposed to
the browser.

## Roadmap
Next: **1.3.0 Visibility & Wireless** (radio tuning, remote syslog, vnstat graphs, LLDP, UPS, SNMP,
NetFlow, speed test), then **2.0.0 Experience & Reach** (installable PWA, hardware-gated mesh + IDS/IPS,
firmware rollback).