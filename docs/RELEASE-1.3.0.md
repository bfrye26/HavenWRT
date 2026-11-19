# Haven 1.3.0 — Visibility & Wireless

**Status: full release, validated on physical hardware (P09B / J4125, 6× Intel I225-V).**
Milestone 3 of the Tier 1–4 competitive program: operational visibility and wireless control. No
permission, rollback, or signature-validation changes.

Built on OpenWrt **v25.12.6**.

**Firmware image SHA-256:**
`437137ea3b7a1221b25504841c290904b6d24c639b31162276f4bcbbc91114f9`
(`openwrt-x86-64-generic-ext4-combined-efi.img.gz`)

**Installer ISO SHA-256 (dual-boot BIOS + UEFI):**
`1e8bf634fda622716661bb2e6f27e5e9bfedc8ed5d5a4a7f5d4a7fb342ff7f0a`
(`MoCI-x86-64-Installer.iso`)

## What's new

- **Wi-Fi radio tuning** — edit channel, channel width (htmode), country code, and TX power per radio,
  applied with the rollback-safe wireless flow.
- **Remote syslog** — forward system logs to a remote collector (server/port/protocol) on System → General.
- **Traffic history (vnStat)** — long-term per-interface totals with daily and monthly breakdowns.
- **LLDP neighbors** — discover directly-connected switches/APs/servers per port (via the packaged
  luci.lldpd JSON plugin).
- **UPS status** — Network UPS Tools charge/runtime/load/voltage readout (configure the driver in
  Advanced Config → nut).
- **SNMP agent** — v2c community setup with source restriction and read-only/read-write mode.
- **NetFlow exporter** — softflowd flow export (NetFlow v5/v9/IPFIX) to a collector. (softflowd does not
  export sFlow.)
- **Speed test** — a browser-based WAN test (Cloudflare endpoints, measures this client's path) plus an
  iperf3 LAN throughput panel run on the router.

## Verified on the P09B
- All six new modules render; vnStat/softflowd/iperf3/upsc binaries present after sysupgrade; radio
  tuning and remote-syslog code in place.
- All 15 test suites pass, including `tests/visibility-wireless.test.mjs`; the features-toggle contract
  covers 18 add-ons.
- Internet, Wi-Fi, and the Plex forward intact; configuration preserved.

## Installing / upgrading
Same artifacts as prior releases: a signed firmware image and a guided dual-boot installer ISO.
Upload the image (`.img.gz`) + `.sig` on **System → Firmware Upgrade**; Haven verifies the signature,
runs `sysupgrade --test`, then flashes after confirmation. Configuration is preserved. See the
[1.0.0 notes](RELEASE-1.0.0.md) for full install/verification instructions.

> **Upgrade data-loss constraint:** full-image x86 sysupgrade does not preserve root-resident Docker
> app data. Back up app data first, or upgrade empty-app systems.

## Security posture
Unchanged: firewall4/nftables stays; all new services are opt-in and off by default. SNMP warns about
the stock public community and restricts source; the speed test's WAN run is client-side and the LAN
run targets a host you specify; no Docker socket exposure; secrets never exposed to the browser.

## Roadmap
Next: **2.0.0 Experience & Reach** — installable PWA, hardware-gated mesh + IDS/IPS, and firmware
rollback.