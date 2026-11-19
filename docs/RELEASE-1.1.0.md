# Haven 1.1.0 — Trust & Control

**Status: full release, validated on physical hardware (P09B / J4125, 6× Intel I225-V).**
Milestone 1 of the Tier 1–4 competitive program: finish the reliability features and add the
per-device family controls, failover, and encrypted DNS that daily-driver users expect. No
permission, rollback, or signature-validation changes.

Built on OpenWrt **v25.12.6**.

**Firmware image SHA-256:**
`f50f5ad13931c4521f38ff373805fd2072c707abceae0702cbdbca2fefee0c81`
(`openwrt-x86-64-generic-ext4-combined-efi.img.gz`)

**Installer ISO SHA-256 (dual-boot BIOS + UEFI):**
`738eee90e988ed967f5fff81f5061a06f7369784757a7b383b56036ee37f239e`
(`MoCI-x86-64-Installer.iso`)

## What's new

### Reliability
- **Backup restore** — System → Backup now restores a configuration archive (chunked upload →
  `sysupgrade --restore`), completing the backup/restore safety net.
- **Wake-on-LAN fixed** — `etherwake` is now packaged, so the existing WoL button works on fresh installs.
- **Dead QoS tab removed** — the legacy classification tab (whose `qos-scripts` package was never
  shipped) now redirects to the supported SQM page.
- **Init-script fix** — classic init scripts no longer set `USE_PROCD=0` (which silently clobbered
  `start()` in rc.common). The bandwidth-quota and Wi-Fi-schedule cron jobs now install reliably at boot.

### Per-device family controls (Devices page)
- **Pause / resume internet** for any device — a MAC-keyed firewall REJECT rule that survives IP
  changes, applied with the rollback-safe firewall flow.
- **Daily bandwidth quotas** — cap a device's usage per day; a cron enforcer (`moci-quota`, every
  5 min) reads nlbwmon accounting and pauses the device when the cap is reached, independent of the
  manual pause. Requires Bandwidth Monitor (nlbwmon), which the quota editor enables for you.
- **Source-MAC matching** in the firewall rule editor.

### Multi-WAN / Failover (now editable)
- Full **mwan3** editing: tracked WAN interfaces, policies (failover by metric, load-balance by
  weight), and steering rules — previously read-only.

### Secure DNS (new opt-in page)
- **DNS-over-HTTPS / DNS-over-TLS** upstreams via SmartDNS (Cloudflare / Google / Quad9 presets or
  custom), plus **DNSSEC** validation via dnsmasq-full. Off by default; enabling SmartDNS makes it the
  network resolver, with an explicit warning to verify browsing afterwards.

### System
- **NTP servers** and a **daily scheduled reboot** (cron) on System → General.

## Verified on the P09B
- New pages render across themes (Multi-WAN, Secure DNS) with no console errors; device pause/quota,
  restore, and time settings exercised.
- All 13 test suites pass, including the new `tests/trust-control.test.mjs`.
- After sysupgrade: quota + Wi-Fi-schedule cron jobs auto-install at boot; `etherwake` present; ACL
  carries the restore and quota grants; internet, Wi-Fi, and the Plex forward intact; config preserved.

## Installing / upgrading
Same artifacts as prior releases: a signed firmware image and a guided dual-boot installer ISO.
To upgrade, upload the image (`.img.gz`) and its `.sig` on **System → Firmware Upgrade**; Haven
verifies the signature, runs `sysupgrade --test`, then flashes after confirmation. Configuration is
preserved. See the [1.0.0 notes](RELEASE-1.0.0.md) for full install/verification instructions.

> **Upgrade data-loss constraint:** full-image x86 sysupgrade does not preserve root-resident Docker
> app data. Back up app data first, or upgrade empty-app systems.

## Security posture
Unchanged: firewall4/nftables stays; new services are opt-in and off by default. Device pause/quotas
are local firewall rules (no WAN exposure); Secure DNS is opt-in with an explicit warning; UPnP,
delegated ports and DNS publishing remain opt-in; no Docker socket exposure; secrets never exposed to
the browser.

## Roadmap
Next: **1.2.0 Security & VPN** (OpenVPN, IPsec/IKEv2, banIP UI, captive portal + RADIUS, IPv6 WAN),
then **1.3.0 Visibility & Wireless** and **2.0.0 Experience & Reach** (installable PWA, hardware-gated
mesh + IDS/IPS).