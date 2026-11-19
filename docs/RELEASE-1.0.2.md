# Haven 1.0.2 — Performance Release

**Status: full release, validated on physical hardware (P09B / J4125, 6× Intel I225-V).**
This release tunes the firmware for maximum routing throughput and stability. It is a
performance-only update on top of 1.0.1 — no UI, permission, or behaviour changes.

Built on OpenWrt **v25.12.6**.

**Firmware image SHA-256:**
`a28d726ff4b15874db56f65b38dcfa6e7ba4292524c320d2af4cf80f3b4c8e6b`
(`openwrt-x86-64-generic-ext4-combined-efi.img.gz`)

**Installer ISO SHA-256 (dual-boot BIOS + UEFI):**
`f4287cb6ed7db3e79ab7659c5899d54cad20bb06e8989f49338933372f247613`
(`MoCI-x86-64-Installer.iso`)

## What's new — speed & stability defaults
These are now applied out of the box (and were the bottlenecks found on the audit):

- **Software flow offload enabled** — established routed flows take the nftables fast path
  (`flowtable ft` on WAN/LAN). The single biggest routed-throughput win on x86.
- **Packet steering across all cores** (`packet_steering=2`) — RX softirq spread over every
  core instead of funnelling each NIC to one core; pairs with the I225-V's 4 balanced
  hardware queues.
- **irqbalance enabled** — NIC IRQs kept distributed across cores.
- **CPU governor = performance** — cores lock at max frequency (no ramp lag under load).
- **Larger NIC ring buffers (2048)** on all ports — absorbs bursts, cuts RX drops.

Applied at boot by `/etc/init.d/moci-performance` (governor + rings) and first-boot defaults
`/etc/uci-defaults/98-moci-performance` (flow offload / steering / irqbalance), so they persist
across reboots and are present on fresh installs.

Already optimal and unchanged: NIC checksum/TSO/GSO/GRO offloads, EEE disabled, SQM available
but off by default (enable under Traffic & QoS only if you want lower latency under load).

## Verified on the P09B
- Flow offload active, all-core steering, irqbalance running, performance governor, 2048 rings.
- Stability: multi-day uptime, load ~0, ample free RAM, all core services up, watchcat watchdog
  running, negligible interface errors/drops.
- Internet, Wi-Fi, and existing port forwards confirmed intact after the update.

## Installing / upgrading
Same artifacts as prior releases: a signed firmware image and a guided dual-boot installer ISO.
To upgrade, upload the image (`.img.gz`) and its `.sig` on **System → Firmware Upgrade**; Haven
verifies the signature, runs `sysupgrade --test`, then flashes after confirmation. Configuration
is preserved. See the [1.0.0 notes](RELEASE-1.0.0.md) for full install/verification instructions.

> **Upgrade data-loss constraint:** full-image x86 sysupgrade does not preserve root-resident
> Docker app data. Back up app data first, or upgrade empty-app systems.

## Security posture
Unchanged: firewall4/nftables stays; UPnP, delegated ports and DNS publishing remain opt-in;
add-ons off by default; no Docker socket exposure; secrets never exposed to the browser.