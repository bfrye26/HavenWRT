# Haven 2.0.0 — Experience & Reach

**Status: full release, validated on physical hardware (P09B / J4125, 6× Intel I225-V).**
Milestone 4 — the final milestone of the Tier 1–4 competitive program. Haven now spans trust &
control, security & VPN, visibility & wireless, and experience & reach. No permission, rollback, or
signature-validation changes.

Built on OpenWrt **v25.12.6**.

**Firmware image SHA-256:**
`431956651cf6567cddbf0575f6ffff3a44f111e12731cd2150eb98fbe8f34040`
(`openwrt-x86-64-generic-ext4-combined-efi.img.gz`)

**Installer ISO SHA-256 (dual-boot BIOS + UEFI):**
`1635e6bcbd841bac3052a74d5c0c81a18cee9c049c606a36ae4181c442f9599b`
(`MoCI-x86-64-Installer.iso`)

## What's new in 2.0.0

- **Installable PWA** — the UI is now an installable progressive web app: manifest `id`/`scope` and
  maskable icons, a service worker that caches the app shell for offline launch, and phone-friendly
  tables. The service worker **never caches `/ubus` RPC, `/cgi-bin`, or any non-GET request**, so live
  router state and session tokens never touch disk. (Install prompts require a trusted HTTPS cert;
  the router's self-signed cert must be trusted first — ACME is available for a trusted cert.)
- **Mesh (capability-gated)** — an 802.11s mesh module that detects mesh-capable radios via `iw phy`.
  The shipped RT3070/RT5370 USB radio cannot mesh, so the module honestly shows a warning and only
  offers configuration when a mesh-capable adapter (e.g. MT7612U/mt76 or AR9271/ath9k) is present.
  batman-adv (multi-hop layer-2) is an optional install-on-demand step.
- **IDS / IPS (snort3, opt-in)** — intrusion detection/prevention, off by default and install-on-demand.
  Passive IDS (alerts only) is the safe default; inline IPS is offered behind an extra confirmation
  because it limits throughput on this CPU and requires disabling flow offload for inspected traffic.
- **Firmware rollback** — back up the running root to USB before upgrading, and revert to a previously
  saved full image via the validated sysupgrade path. Storage is **off-root only** (USB): x86 upgrades
  reformat root, so a router-resident saved image would be erased by the upgrade it should undo. A/B
  partitioning was deliberately rejected as over-engineering for this image layout.

## Hardware honesty
- **No AES-NI** on the J4125: OpenVPN/IPsec encrypt in software; WireGuard remains the fast path.
- **IDS/IPS throughput** is realistically ~150–400 Mbps on this CPU, not gigabit; inline IPS disables
  flow offload for inspected traffic. Passive IDS is recommended.
- **Mesh** requires a mesh-capable radio; the commonly shipped RT3070 cannot mesh.

## The full program (1.1.0 → 2.0.0)
- **1.1.0 Trust & Control** — backup restore, per-device pause + daily quotas, Multi-WAN editing,
  Secure DNS (DoH/DoT + DNSSEC), NTP + scheduled reboot; fixed WoL packaging and the dead QoS tab.
- **1.2.0 Security & VPN** — BanIP threat blocking, WPA-Enterprise/RADIUS, IPv6 WAN + leases, OpenVPN,
  captive portal (openNDS), IPsec/IKEv2 (install-on-demand).
- **1.3.0 Visibility & Wireless** — radio tuning, remote syslog, vnStat history, LLDP neighbors, UPS
  status, SNMP, NetFlow export, speed test (Cloudflare WAN + iperf3 LAN).
- **2.0.0 Experience & Reach** — installable PWA, capability-gated mesh, opt-in IDS/IPS, firmware rollback.

## Verified on the P09B
- PWA assets (sw.js, manifest id), mesh/IDS modules, and the rollback helper + UI present after
  sysupgrade; all 16 test suites pass; the features-toggle contract covers 19 add-ons.
- Internet, Wi-Fi, and the Plex forward intact; configuration preserved across every milestone upgrade.

## Installing / upgrading
Same artifacts as prior releases: a signed firmware image and a guided dual-boot installer ISO.
Upload the image (`.img.gz`) + `.sig` on **System → Firmware Upgrade**; Haven verifies the signature,
runs `sysupgrade --test`, then flashes after confirmation. Configuration is preserved. See the
[1.0.0 notes](RELEASE-1.0.0.md) for full install/verification instructions.

> **Upgrade data-loss constraint:** full-image x86 sysupgrade does not preserve root-resident Docker
> app data. Back up app data first, or upgrade empty-app systems.

## Security posture
Unchanged: firewall4/nftables stays; all new services are opt-in and off by default. The PWA service
worker never caches RPC/auth; mesh and IDS are capability-gated and opt-in; rollback uses off-root
storage; no Docker socket exposure; secrets never exposed to the browser.