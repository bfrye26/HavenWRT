# Haven 1.0.0 — Full Release

**Status: full release, validated on physical hardware.** Every aspect was verified on a
real 6-port Intel I225-V P09B (J4125) router: boot, all Ethernet ports, Wi-Fi AP, WAN /
internet / DNS, firewall, the redesigned dashboard and all pages across all six themes,
every add-on toggle and dashboard, device-vendor lookup, isolated security profiles with
WAN access, WireGuard, RFC 2136 DNS publishing, UPnP / published ports, the Docker app
store, and signed opt-in updates.

Built on OpenWrt **v25.12.6**.

**Firmware image SHA-256:**
`d1a18ee1e7b3262f4fc2082839f0c2e80704a03eb9ec47fa229cc1d8b1fd70d3`
(`openwrt-x86-64-generic-ext4-combined-efi.img.gz`)

**Installer ISO SHA-256 (dual-boot BIOS + UEFI):**
`8d5cb8da689682ded6d6883eddd361813f9715431925bffc401eda6dd0339547`
(`MoCI-x86-64-Installer.iso`)

## What's in Haven 1.0.0

### A unified, calm interface
- **One design system across all six themes** (Obsidian, Cloud light, Ocean, Terminal,
  Amethyst, Copper). Semantic color tokens; calm, sentence-case components; the light
  theme renders correctly everywhere.
- **Redesigned dashboard** that answers "is my network OK right now?" at a glance:
  internet status strip, Devices / Download / Upload cards, an honest throughput graph
  (real Mbps axis, correct 3-minute window), a quiet "needs attention" panel that only
  speaks up when something is wrong, and compact CPU / memory bullets. Reboot / restart
  live in a menu, not loud buttons.

### Native add-ons, each with an on/off toggle (off by default)
A **Features** control center turns each add-on on/off (shows/hides its dashboard,
enables/disables the service at boot, starts/stops it now):
- **Network Performance** — SQM / bufferbloat, Bandwidth monitor (nlbwmon), Multi-WAN (mwan3).
- **Security & Privacy** — Ad blocking (adblock), Tailscale VPN; WireGuard via VPN & Failover;
  AdGuard Home / Pi-hole as one-click apps.
- **System & Diagnostics** — Web terminal (ttyd + htop), Statistics graphs (collectd),
  NAS / file sharing (Samba), attended upgrade check.

### Real device identity
The Devices page resolves vendors from the **full IEEE MA-L OUI registry** (~40,000
prefixes) and detects private / randomized MACs, so devices show real makers instead of
"Unknown vendor".

### Full StartWRT feature set
Unified security profiles (Admin / Children / Guest / Smart-Devices) with clear WAN-access
control; isolated networks that still reach the internet; per-device delegated port
opening and RFC 2136 DNS publishing (both opt-in); live WireGuard health + kill-switch;
Ethernet / Wi-Fi points of entry; a Docker app store with reviewed one-click templates and
native Pi-hole / AdGuard / Uptime Kuma integrations; signed, opt-in firmware updates.

## Installing

Ships as a **signed firmware image** and a **guided dual-boot installer ISO**
(`MoCI-x86-64-Installer.iso`, boots on BIOS/CSM and UEFI).

**Fresh install (recommended):** write the ISO to a USB stick (`dd if=MoCI-x86-64-Installer.iso
of=/dev/sdX bs=4M conv=fsync`, or Rufus / balenaEtcher), boot the target, and follow the guided
installer. The ISO is **fresh-install only** — never a sysupgrade payload. Requires a ≥16 GiB
disk and two wired NICs.

**Upgrade an existing Haven router:** upload the image (`.img.gz`) and its `.sig` on
System → Firmware Upgrade. Haven verifies the signature, runs `sysupgrade --test`, then
flashes after confirmation. Network / Wi-Fi / firewall configuration is preserved.

> **Upgrade data-loss constraint:** full-image x86 sysupgrade does not preserve root-resident
> Docker app data. Back up app data first, or upgrade empty-app systems.

## Verifying the artifacts

Each artifact ships with a SHA-256 checksum (`SHA256SUMS`) and a detached usign signature
(`.sig`). The public key is baked into the firmware at `/etc/moci/moci-image.pub` and committed
as `files/moci-image.pub`.

```sh
sha256sum -c SHA256SUMS
usign -V -p moci-image.pub -m openwrt-x86-64-generic-ext4-combined-efi.img.gz \
      -x openwrt-x86-64-generic-ext4-combined-efi.img.gz.sig
usign -V -p moci-image.pub -m MoCI-x86-64-Installer.iso -x MoCI-x86-64-Installer.iso.sig
```

## Security posture
- firewall4 / nftables stays; no automatic WAN publishing; UPnP, delegated ports and DNS
  publishing are opt-in / off by default (UPnP secure mode enforced).
- New add-ons are off by default; the web terminal is LAN-only and clearly warned.
- No Docker socket exposure or unrestricted LAN forwarding; sensitive-data apps require
  explicit approval; secrets are never exposed to the browser.

## Known limitations
- The web terminal is plain HTTP; when the UI is served over HTTPS, use "Open in new tab".
- Tailscale requires an interactive login (the dashboard shows the auth link).
- VPN chaining supports static IPv4 endpoints only.