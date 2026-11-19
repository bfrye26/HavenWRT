# Haven 1.0.3 — DMZ Host + Performance Release

**Status: full release, validated on physical hardware (P09B / J4125, 6× Intel I225-V).**
This release adds a proper DMZ host control and ships the remaining performance tuning that was
applied to the reference unit after 1.0.2. No permission, rollback, or signature-validation changes.

Built on OpenWrt **v25.12.6**.

**Firmware image SHA-256:**
`89b7351a8563e5e4b244ef10de2412f814935f2158242c4d3546c4883ecdf39e`
(`openwrt-x86-64-generic-ext4-combined-efi.img.gz`)

**Installer ISO SHA-256 (dual-boot BIOS + UEFI):**
`1cd89e33c569ac9926d6a660c483733fa82c5dad7ca4589af95a6288a426956e`
(`MoCI-x86-64-Installer.iso`)

## What's new — DMZ host
A labeled **DMZ Host** card now lives on **Network → Firewall**, alongside the existing port-forwarding,
traffic-rule, zone and NAT controls:

- **Device picker** populated from live DHCP leases (hostname + IP, sorted), plus manual IP entry.
- **Explicit exposure warning + confirmation** before enabling — a DMZ forwards *every* incoming port
  to one device, bypassing the firewall for that device.
- **LAN-subnet validation** rejects out-of-subnet addresses and the router's own IP.
- Writes a single **all-ports DNAT redirect** (`src=wan, dest=lan, proto=tcpudp, reflection=1`) with no
  port options, so every TCP/UDP port reaches the host (NAT loopback included). It is detected
  structurally and kept out of the port-forwarding table.
- **Opt-in and off by default.** Enable, change host, disable, or remove at any time. Saving inherits
  the firewall apply → connectivity-check → confirm → auto-rollback flow, so a bad change cannot strand
  the router.

For most servers a specific port forward (or opt-in UPnP delegation on the Published Ports page) is
still the safer choice; the DMZ is there when you genuinely need a fully exposed host.

## What's new — performance (now in a released image)
Bundles the tuning applied to the reference unit after 1.0.2 (commit `a63b4ca`), on top of 1.0.2's
flow offload / all-core packet steering / irqbalance / performance governor / 2048 NIC rings:

- **XPS (TX steering):** each NIC TX queue mapped to its core, matching the balanced RX IRQ affinity so
  TX completions stay on the same core (less cross-core traffic).
- **Larger netdev input queue + budget:** `net.core.netdev_max_backlog=8192`, `net.core.netdev_budget=600`
  for high packet rates.

Applied at boot by `/etc/init.d/moci-performance`, so they persist across reboots and are present on
fresh installs.

## Verified on the P09B
- DMZ card renders across all six themes; the picker lists live leases; out-of-subnet and router-IP
  inputs are rejected; the save writes an all-ports redirect with no port fields.
- `fw4` accepts the port-less redirect and renders an all-ports DNAT (TCP + UDP) with reflection
  (validated render-only; no exposure left on the live network).
- Internet, Wi-Fi, and the existing Plex port forward confirmed intact after the update.

## Installing / upgrading
Same artifacts as prior releases: a signed firmware image and a guided dual-boot installer ISO.
To upgrade, upload the image (`.img.gz`) and its `.sig` on **System → Firmware Upgrade**; Haven
verifies the signature, runs `sysupgrade --test`, then flashes after confirmation. Configuration is
preserved. See the [1.0.0 notes](RELEASE-1.0.0.md) for full install/verification instructions.

> **Upgrade data-loss constraint:** full-image x86 sysupgrade does not preserve root-resident Docker
> app data. Back up app data first, or upgrade empty-app systems.

## Security posture
Unchanged: firewall4/nftables stays; the DMZ is opt-in and off by default with an explicit exposure
warning; UPnP, delegated ports and DNS publishing remain opt-in; add-ons off by default; no Docker
socket exposure; secrets never exposed to the browser.